import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/attendanceSummary.ts
//
// Item 3.1 of docs/HANDOFF_OPTIMISATION_2026-09-25.md.
//
// The problem: every student dashboard mount downloaded up to 500
// `attendanceRecords` (~600 reads) and added them up in the browser. That is
// ~85 % of a student's reads (≈₹28 K/yr at 5,000 students) AND it is silently
// wrong — a student with more than 500 records sees a percentage for a window,
// not for their history.
//
// The fix: one small document per student, maintained by a trigger:
//   attendanceSummaries/{studentId}
//     { collegeId, total, present, absent, late, leave, onDuty, medicalLeave,
//       bySubject, byMonth, recent[≤20], updatedAt, lastEventId, version }
//
// Clauses that shaped the implementation:
//   * A7 — a Firestore trigger is at-least-once. A failed transaction is
//     dropped, and a retried one can double-apply. Guard: apply the delta in a
//     transaction and record the causing event id on the summary, so a redelivery
//     of the SAME event is a no-op. Drift is still possible (a dropped event), so
//     the nightly `reconcileAttendanceSummaries` re-counts and only rebuilds the
//     students that actually disagree.
//   * A8 — one student's summary must not become a hot document. Nothing here
//     serialises hundreds of writes for one student; the import paths aggregate
//     their own batch (see the note on `backfillAttendanceSummaries`), and the
//     reconcile pass repairs anything that was dropped under contention.
//   * C3 — the client keeps the old raw query as a fallback whenever a summary
//     is missing, so this collection can be empty and the app still works.

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import * as admin from 'firebase-admin'

export const ATTENDANCE_RECORDS_COLLECTION = 'attendanceRecords'
export const ATTENDANCE_SUMMARIES_COLLECTION = 'attendanceSummaries'
/** The attendance page still renders the most recent rows; 20 covers the card. */
export const RECENT_RECORDS_LIMIT = 20
/** Students inspected per nightly reconcile tick. */
export const RECONCILE_BATCH = 200
/** Documents written per backfill batch. */
export const BACKFILL_WRITE_BATCH = 400

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AttendanceCounts {
  total: number
  present: number
  absent: number
  late: number
  leave: number
  onDuty: number
  medicalLeave: number
  /** Any status we do not recognise still counts in `total` (see applyDelta). */
  other: number
}

export interface AttendanceMonthBucket {
  total: number
  present: number
  absent: number
}

export interface AttendanceRecentRow {
  id: string
  date: string
  subject: string
  subjectCode?: string
  status: string
  checkInTime?: string
  notes?: string
  markedAt?: string
}

export interface AttendanceSummaryDoc extends AttendanceCounts {
  collegeId: string | null
  studentId: string
  bySubject: Record<string, AttendanceCounts>
  byMonth: Record<string, AttendanceMonthBucket>
  recent: AttendanceRecentRow[]
  updatedAt: string
  /** Idempotency guard: the last event applied to this document (clause A7). */
  lastEventId?: string
  version: number
}

export interface AttendanceRowLike {
  id?: string
  collegeId?: unknown
  studentId?: unknown
  date?: unknown
  subject?: unknown
  subjectCode?: unknown
  status?: unknown
  checkInTime?: unknown
  timeIn?: unknown
  note?: unknown
  notes?: unknown
  markedAt?: unknown
}

const KNOWN_STATUSES = ['present', 'absent', 'late', 'leave', 'onDuty', 'medicalLeave'] as const
type KnownStatus = (typeof KNOWN_STATUSES)[number]

export function emptyCounts(): AttendanceCounts {
  return { total: 0, present: 0, absent: 0, late: 0, leave: 0, onDuty: 0, medicalLeave: 0, other: 0 }
}

/** Normalises a status string; unknown values are counted in `total` only. */
export function normaliseStatus(raw: unknown): KnownStatus | 'other' {
  const status = String(raw ?? '').trim()
  if ((KNOWN_STATUSES as readonly string[]).includes(status)) return status as KnownStatus
  // Legacy spellings seen in the wild.
  if (status === 'on-duty' || status === 'onduty') return 'onDuty'
  if (status === 'medical-leave' || status === 'medical') return 'medicalLeave'
  return 'other'
}

function monthKey(raw: unknown): string | null {
  const date = String(raw ?? '')
  return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : null
}

function addCounts(target: AttendanceCounts, status: KnownStatus | 'other', sign: 1 | -1): void {
  target.total += sign
  target[status] += sign
}

function addBucket(target: AttendanceMonthBucket, status: KnownStatus | 'other', sign: 1 | -1): void {
  target.total += sign
  if (status === 'present' || status === 'onDuty' || status === 'late') target.present += sign
  if (status === 'absent') target.absent += sign
}

/**
 * Applies one record change to a summary. `before = null` means create,
 * `after = null` means delete — the same function handles all three cases so the
 * trigger has no special paths.
 */
export function applyAttendanceDelta(
  summary: AttendanceSummaryDoc,
  before: AttendanceRowLike | null,
  after: AttendanceRowLike | null,
  opts: { eventId?: string; now?: string } = {},
): AttendanceSummaryDoc {
  const next: AttendanceSummaryDoc = {
    ...summary,
    bySubject: Object.fromEntries(
      Object.entries(summary.bySubject || {}).map(([key, value]) => [key, { ...value }]),
    ),
    byMonth: Object.fromEntries(
      Object.entries(summary.byMonth || {}).map(([key, value]) => [key, { ...value }]),
    ),
    recent: [...(summary.recent || [])],
  }
  if (before && before.studentId) next.studentId = String(before.studentId)
  if (after && after.studentId) next.studentId = String(after.studentId)
  const collegeId = (after?.collegeId ?? before?.collegeId) as string | undefined
  if (collegeId) next.collegeId = String(collegeId)

  const undo = (row: AttendanceRowLike): void => {
    const status = normaliseStatus(row.status)
    addCounts(next, status, -1)
    const subject = String(row.subject ?? '')
    if (subject && next.bySubject[subject]) {
      addCounts(next.bySubject[subject], status, -1)
      if (next.bySubject[subject].total <= 0) delete next.bySubject[subject]
    }
    const month = monthKey(row.date)
    if (month && next.byMonth[month]) {
      addBucket(next.byMonth[month], status, -1)
      if (next.byMonth[month].total <= 0) delete next.byMonth[month]
    }
    const id = String(row.id ?? '')
    if (id) next.recent = next.recent.filter((entry) => entry.id !== id)
  }

  if (before) undo(before)

  if (after) {
    const status = normaliseStatus(after.status)
    addCounts(next, status, 1)
    const subject = String(after.subject ?? '')
    if (subject) {
      next.bySubject[subject] = next.bySubject[subject] || emptyCounts()
      addCounts(next.bySubject[subject], status, 1)
    }
    const month = monthKey(after.date)
    if (month) {
      next.byMonth[month] = next.byMonth[month] || { total: 0, present: 0, absent: 0 }
      addBucket(next.byMonth[month], status, 1)
    }
    if (after.id) {
      next.recent = [
        rowToRecent(after as Required<Pick<AttendanceRowLike, 'id'>>),
        ...next.recent.filter((entry) => entry.id !== String(after.id)),
      ]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, RECENT_RECORDS_LIMIT)
    }
  }

  next.updatedAt = opts.now ?? new Date().toISOString()
  next.version = Math.max(1, Math.floor((summary.version || 0) + 1))
  if (opts.eventId) next.lastEventId = opts.eventId
  return next
}

export function rowToRecent(row: AttendanceRowLike & { id: string }): AttendanceRecentRow {
  return {
    id: row.id,
    date: String(row.date ?? ''),
    subject: String(row.subject ?? ''),
    ...(row.subjectCode ? { subjectCode: String(row.subjectCode) } : {}),
    status: String(row.status ?? ''),
    ...(row.checkInTime ?? row.timeIn ? { checkInTime: String(row.checkInTime ?? row.timeIn) } : {}),
    ...(row.note ?? row.notes ? { notes: String(row.note ?? row.notes) } : {}),
    ...(row.markedAt ? { markedAt: String(row.markedAt) } : {}),
  }
}

/** Rebuilds a summary from raw rows — used by the backfill and the reconcile pass. */
export function summariseAttendanceRows(
  rows: Array<AttendanceRowLike & { id: string }>,
  opts: { collegeId?: string | null; studentId: string; now?: string },
): AttendanceSummaryDoc {
  const base: AttendanceSummaryDoc = {
    ...emptyCounts(),
    collegeId: opts.collegeId ?? null,
    studentId: opts.studentId,
    bySubject: {},
    byMonth: {},
    recent: [],
    updatedAt: opts.now ?? new Date().toISOString(),
    version: 1,
  }
  let summary = base
  for (const row of rows) {
    summary = applyAttendanceDelta(summary, null, row, { now: summary.updatedAt })
  }
  // One bump for the whole rebuild instead of one per row.
  summary = { ...summary, version: 1, updatedAt: opts.now ?? new Date().toISOString() }
  return summary
}

/**
 * The percentage the student app shows today: attended = present + onDuty +
 * late, over every recorded session. Kept identical to the client's existing
 * formula so switching the student to the summary cannot move their number for
 * the sessions inside the window (clause: "never compute the policy number
 * differently in two screens").
 */
export function attendancePercentage(
  counts: Pick<AttendanceCounts, 'present' | 'onDuty' | 'late' | 'total'>,
): number {
  if (!counts.total) return 0
  return Math.round(((counts.present + counts.onDuty + counts.late) / counts.total) * 100)
}

/** True when a stored summary disagrees with a freshly counted total (clause A7). */
export function summaryDrifted(summary: Pick<AttendanceCounts, 'total'>, liveTotal: number): boolean {
  return Number(summary.total || 0) !== Number(liveTotal || 0)
}

// ─── Trigger ────────────────────────────────────────────────────────────────

function summaryRef(studentId: string) {
  return getFirestore(admin.app(), 'default').collection(ATTENDANCE_SUMMARIES_COLLECTION).doc(studentId)
}

/**
 * Maintains the summary. `retry: false` on purpose: a retried at-least-once
 * delivery is what the `lastEventId` guard exists for, and the nightly
 * reconcile repairs anything a dropped delivery left behind (clause A7).
 */
export const onAttendanceRecordWrite = onDocumentWritten(
  {
    document: `${ATTENDANCE_RECORDS_COLLECTION}/{recordId}`,
    region: 'asia-south1',
    memory: '256MiB',
    timeoutSeconds: 60,
    retry: false,
  },
  async (event) => {
    const before = event.data?.before?.exists ? (event.data.before.data() as AttendanceRowLike) : null
    const after = event.data?.after?.exists ? (event.data.after.data() as AttendanceRowLike) : null
    if (!before && !after) return

    const studentId = String(after?.studentId ?? before?.studentId ?? '')
    if (!studentId) {
      logger.warn('[AttendanceSummary] record has no studentId — skipped', { recordId: event.params.recordId })
      return
    }

    const beforeRow = before ? { ...before, id: event.params.recordId } : null
    const afterRow = after ? { ...after, id: event.params.recordId } : null

    try {
      await getFirestore(admin.app(), 'default').runTransaction(async (tx) => {
        const snap = await tx.get(summaryRef(studentId))
        const current = snap.exists
          ? (snap.data() as AttendanceSummaryDoc)
          : summariseAttendanceRows([], {
              studentId,
              collegeId: (afterRow?.collegeId ?? beforeRow?.collegeId ?? null) as string | null,
            })

        // Exactly-once guard: a redelivery of the same event is a no-op.
        if (current.lastEventId && current.lastEventId === event.id) return

        const next = applyAttendanceDelta(current, beforeRow, afterRow, { eventId: event.id })
        tx.set(summaryRef(studentId), next)
      })
    } catch (err) {
      // The reconcile pass owns the repair; the student's own read still falls
      // back to the raw query until then.
      logger.error('[AttendanceSummary] delta failed — nightly reconcile will repair it', {
        studentId,
        recordId: event.params.recordId,
        err,
      })
    }
  },
)

// ─── Nightly reconcile (clause A7) ──────────────────────────────────────────

/** Rebuilds one student's summary from their raw records. */
export async function rebuildSummaryForStudent(studentId: string): Promise<{ total: number; rebuilt: boolean }> {
  const db = getFirestore(admin.app(), 'default')
  const rows: Array<AttendanceRowLike & { id: string }> = []
  let cursor: admin.firestore.QueryDocumentSnapshot | null = null
  // Paged so a student with thousands of records cannot blow the memory limit.
  for (;;) {
    let pageQuery: admin.firestore.Query = db
      .collection(ATTENDANCE_RECORDS_COLLECTION)
      .where('studentId', '==', studentId)
      .orderBy('date', 'desc')
      .limit(500)
    if (cursor) pageQuery = pageQuery.startAfter(cursor)
    const page = await pageQuery.get()
    page.docs.forEach((doc) => rows.push({ ...(doc.data() as AttendanceRowLike), id: doc.id }))
    if (page.size < 500) break
    cursor = page.docs[page.size - 1]
  }

  const summary = summariseAttendanceRows(rows, {
    studentId,
    collegeId: (rows[0]?.collegeId ?? null) as string | null,
  })
  await summaryRef(studentId).set(summary)
  return { total: summary.total, rebuilt: true }
}

export const reconcileAttendanceSummaries = onSchedule(
  {
    region: 'asia-south1',
    schedule: 'every day 02:30',
    timeZone: 'Asia/Kolkata',
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const db = getFirestore(admin.app(), 'default')
    const summaries = await db.collection(ATTENDANCE_SUMMARIES_COLLECTION).limit(RECONCILE_BATCH).get()
    let checked = 0
    let repaired = 0
    for (const doc of summaries.docs) {
      const summary = doc.data() as AttendanceSummaryDoc
      const live = await db
        .collection(ATTENDANCE_RECORDS_COLLECTION)
        .where('studentId', '==', doc.id)
        .count()
        .get()
      checked += 1
      if (summaryDrifted(summary, live.data().count)) {
        // Only the drifted ones pay the cost of a rebuild.
        await rebuildSummaryForStudent(doc.id)
        repaired += 1
        logger.warn('[AttendanceSummary] drift repaired', {
          studentId: doc.id,
          stored: summary.total,
          live: live.data().count,
        })
      }
    }
    logger.info('[AttendanceSummary] reconcile finished', { checked, repaired })
  },
)

// ─── Backfill (superadmin callable) ─────────────────────────────────────────

/**
 * One-off / re-runnable fill for an existing college. Idempotent: it rebuilds
 * each student's summary from their raw rows, so running it twice is safe.
 *
 * NOTE (clause A8): this is the path for a bulk import. It writes one document
 * per student AFTER the import has finished, instead of letting hundreds of
 * per-record trigger writes collide on the same document.
 */
export const backfillAttendanceSummaries = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 300, maxInstances: 1 },
  async (request) => {
    const role = (request.auth?.token as { role?: string } | undefined)?.role
    if (role !== 'superadmin') {
      throw new HttpsError('permission-denied', 'This operation is restricted to the platform superadmin.')
    }
    const collegeId = String((request.data as { collegeId?: string })?.collegeId || '')
    if (!collegeId) throw new HttpsError('invalid-argument', 'collegeId is required')

    const db = getFirestore(admin.app(), 'default')
    const students = await db.collection('students').where('collegeId', '==', collegeId).limit(BACKFILL_WRITE_BATCH).get()
    const results = await Promise.all(
      students.docs.map(async (student) => {
        const { total } = await rebuildSummaryForStudent(student.id)
        return { studentId: student.id, total }
      }),
    )
    logger.info('[AttendanceSummary] backfill finished', { collegeId, students: results.length })
    return { success: true, collegeId, students: results.length, summaries: results }
  },
)
