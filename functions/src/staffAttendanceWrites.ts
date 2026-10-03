import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/staffAttendanceWrites.ts
//
// THE ONE-STOP WRITE PATH FOR staffAttendance (faculty self-mark).
//
// WHY THIS EXISTS
// The web client used to write staffAttendance/{collegeId}__{uid}__{date}
// directly against the Firestore security rules. That single expression
//
//   allow create: ... tenantWrite(request.resource.data)
//                  && (isOwnRecord(request.resource.data)
//                      || claimedRole() in ['admin', 'principal', 'hod'])
//
// has regressed repeatedly — every time something is deployed outside this
// repository (the internal employee page) the write path broke again, and a
// rules-level denial is nearly impossible to diagnose from the client.
//
// This callable makes the write path solid and immune to that regression:
//
//   1. Authorization is ONE pure, unit-tested function
//      (decideStaffAttendanceWrite) that mirrors the rules' semantics exactly:
//        * superadmin (claim or superadmins/{uid} doc) → any record;
//        * faculty → their OWN record only, in their OWN claimed college;
//        * admin / hod / principal → any record, but only in their own
//          claimed college.
//   2. The write goes through the Admin SDK, so a rules-file drift or
//      clobber can no longer block attendance. The staffAttendance rules
//      stay as defence-in-depth for READS (get/list) and any future direct
//      write — they are not the write path anymore.
//   3. The document shape is byte-identical to what the old client write
//      produced, so no reader anywhere changes.
//
// The client calls this from "My Attendance" (useMyStaffAttendance).
// Student attendance (marked per class session by management) is a
// different collection and is unaffected.

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import { normalizeRole, withApiVersion, IDENTITY_API_VERSION } from './identityShared'

export const STAFF_ATTENDANCE_COLLECTION = 'staffAttendance'

/** Every status a faculty member can record for a day (client: StaffAttendanceStatus). */
export const STAFF_ATTENDANCE_STATUSES = [
  'present',
  'late',
  'halfday',
  'absent',
  'leave',
  'medical',
  'onduty',
  'wfh',
] as const
export type StaffAttendanceStatusValue = (typeof STAFF_ATTENDANCE_STATUSES)[number]

/** The caller, resolved from the VERIFIED ID token (never from the payload). */
export interface StaffAttendanceCaller {
  uid: string
  /** Canonical claimed role (normalizeRole) — '' when the claim is absent. */
  role: string
  /** Claimed collegeId, trimmed — null when the claim is absent. */
  collegeId: string | null
  /** Superadmin claim, or a superadmins/{uid} document exists. */
  isSuperadmin: boolean
}

/** The write the client asks for. Identity fields (uid/role/college) come
 *  from the token, NOT from this payload — the payload's collegeId/facultyId
 *  are only the target coordinates and are checked against the claims. */
export interface StaffAttendanceWriteInput {
  facultyId?: unknown
  collegeId?: unknown
  facultyName?: unknown
  department?: unknown
  designation?: unknown
  date?: unknown
  status?: unknown
  checkIn?: unknown
  checkOut?: unknown
  note?: unknown
}

export type WriteDecision =
  | { ok: true; facultyId: string; collegeId: string }
  | {
      ok: false
      code: 'unauthenticated' | 'bad-date' | 'bad-status' | 'bad-faculty' | 'bad-college' | 'not-authorized'
    }

/**
 * Pure authorization + validation decision — unit-tested in
 * functions/test/staffAttendanceWrites.test.ts. Mirrors the staffAttendance
 * rules exactly, so routing the write through here changes nothing about who
 * may write what; it only moves the decision to one testable place.
 */
export function decideStaffAttendanceWrite(
  caller: StaffAttendanceCaller,
  input: StaffAttendanceWriteInput,
): WriteDecision {
  if (!caller.uid) return { ok: false, code: 'unauthenticated' }

  const date = String(input.date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return { ok: false, code: 'bad-date' }
  }

  const status = String(input.status ?? '')
  if (!(STAFF_ATTENDANCE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, code: 'bad-status' }
  }

  const facultyId = String(input.facultyId ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(facultyId)) return { ok: false, code: 'bad-faculty' }

  const collegeId = String(input.collegeId ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(collegeId)) return { ok: false, code: 'bad-college' }

  if (caller.isSuperadmin) return { ok: true, facultyId, collegeId }

  // Tenant gate first — every tenanted role must carry the claim, and the
  // target college must be the caller's own college (rules: sameCollege).
  if (caller.collegeId == null || collegeId !== caller.collegeId) {
    return { ok: false, code: 'not-authorized' }
  }

  if (caller.role === 'faculty') {
    // Self-mark only: exactly the rules' isOwnRecord (facultyId == uid).
    if (facultyId !== caller.uid) return { ok: false, code: 'not-authorized' }
    return { ok: true, facultyId, collegeId }
  }

  if (caller.role === 'admin' || caller.role === 'principal' || caller.role === 'hod') {
    // Management may mark any colleague's day, inside their own college.
    return { ok: true, facultyId, collegeId }
  }

  return { ok: false, code: 'not-authorized' }
}

/** Same deterministic id the client and the rules contract use. */
export function staffAttendanceDocId(collegeId: string, facultyId: string, date: string): string {
  const safe = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safe(collegeId)}__${safe(facultyId)}__${safe(date)}`
}

/** Verbatim port of the client's hoursBetween (midnight wrap, 0.1h rounding). */
export function hoursBetween(checkIn: unknown, checkOut: unknown): number {
  const parse = (v: unknown): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
    if (!m) return null
    const h = Number(m[1])
    const min = Number(m[2])
    if (h > 23 || min > 59) return null
    return h * 60 + min
  }
  const a = parse(checkIn)
  const b = parse(checkOut)
  if (a == null || b == null) return 0
  const diff = b - a
  const minutes = diff >= 0 ? diff : diff + 24 * 60
  return Math.round((minutes / 60) * 10) / 10
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function boundedString(value: unknown, max: number): string {
  const s = String(value ?? '').trim()
  return s.length > max ? s.slice(0, max) : s
}

/**
 * Build the document EXACTLY as the old client write did (same fields, same
 * defaults), with the audit fields derived server-side:
 *   source   — 'self' for a faculty self-mark, 'admin' for management;
 *   markedBy — the verified caller uid, never a client-supplied value.
 */
export function buildAttendanceDocument(
  input: StaffAttendanceWriteInput,
  decided: { facultyId: string; collegeId: string },
  caller: StaffAttendanceCaller,
  nowIso: string,
): Record<string, unknown> {
  const date = String(input.date)
  const status = String(input.status)
  const checkIn = boundedString(input.checkIn, 5)
  const checkOut = boundedString(input.checkOut, 5)
  const source = caller.role === 'faculty' ? 'self' : 'admin'
  return {
    collegeId: decided.collegeId,
    facultyId: decided.facultyId,
    facultyName: boundedString(input.facultyName, 200) || 'Unknown',
    department: boundedString(input.department, 100) || 'General',
    designation: boundedString(input.designation, 100),
    date,
    month: date.slice(0, 7),
    status,
    checkIn,
    checkOut,
    hoursWorked: hoursBetween(checkIn, checkOut),
    note: boundedString(input.note, 1000),
    source,
    markedBy: caller.uid,
    markedAt: nowIso,
  }
}

/** Resolve the superadmin marker the same way the rules' exists() does. */
async function superadminDocExists(uid: string): Promise<boolean> {
  const doc = await getFirestore(admin.app(), 'default').collection('superadmins').doc(uid).get()
  return doc.exists
}

// ─── Callable ────────────────────────────────────────────────────────────────

export const saveMyStaffAttendance = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.')
    }

    const raw = (request.data ?? {}) as Record<string, unknown>
    const token = (request.auth.token ?? {}) as Record<string, unknown>

    const role = normalizeRole(token.role)
    const rawCollege = token.collegeId
    const collegeId = typeof rawCollege === 'string' && rawCollege.trim() ? rawCollege.trim() : null

    const caller: StaffAttendanceCaller = {
      uid: request.auth.uid,
      role,
      collegeId,
      isSuperadmin: role === 'superadmin' || (await superadminDocExists(request.auth.uid)),
    }

    const decision = decideStaffAttendanceWrite(caller, raw)
    if (!decision.ok) {
      if (decision.code === 'not-authorized') {
        throw new HttpsError(
          'permission-denied',
          'You may only save your own attendance, in your own college.' +
            ' If you believe this is wrong, ask a superadmin to run Access Control → Identity Repair, then sign out and back in.',
        )
      }
      throw new HttpsError('invalid-argument', `Invalid attendance request (${decision.code}).`)
    }

    // Validate the time fields before touching the database.
    for (const key of ['checkIn', 'checkOut'] as const) {
      const v = String(raw[key] ?? '').trim()
      if (v && !TIME_RE.test(v)) {
        throw new HttpsError('invalid-argument', `${key} must look like HH:MM.`)
      }
    }

    const docId = staffAttendanceDocId(decision.collegeId, decision.facultyId, String(raw.date))
    const ref = getFirestore(admin.app(), 'default').collection(STAFF_ATTENDANCE_COLLECTION).doc(docId)
    const now = admin.firestore.Timestamp.now()
    const doc = buildAttendanceDocument(raw, decision, caller, new Date().toISOString())

    try {
      await getFirestore(admin.app(), 'default').runTransaction(async (tx) => {
        const existing = await tx.get(ref)
        const toWrite: Record<string, unknown> = { ...doc, updatedAt: now }
        // createdAt stays meaningful: first write only.
        if (!existing.exists) toWrite.createdAt = now
        tx.set(ref, toWrite, { merge: true })
      })
    } catch (err) {
      logger.error('staffAttendance write failed', err)
      throw new HttpsError('internal', 'Could not save your attendance. Try again.')
    }

    return withApiVersion({ id: docId, apiVersion: IDENTITY_API_VERSION })
  },
)
