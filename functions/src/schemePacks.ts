import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// ─────────────────────────────────────────────────────────────────────────────
// University Scheme Packs — persistence (G1)
//
// WHY THIS EXISTS
// Karnataka's ~33 state universities each publish a different scheme of
// examination (marks split, IA composition, attendance slabs, pass floors,
// grade tables). The pack content lives client-side as presets and evaluates
// through src/shared/utils/schemeEngine.ts; THIS module owns trust:
//   saveSchemePack           — admins author/edit custom packs for their
//                              college (cloned from a preset or from scratch).
//                              Server-side validation rejects malformed packs
//                              (slab gaps, >100% totals, inverted ranges).
//   assignCollegeSchemePack  — binds a pack (preset code or custom doc) to a
//                              college: colleges/{id}.schemePackId. Every
//                              consumer (result importer, hall tickets,
//                              compliance dashboard) resolves through this.
//
// Reads stay client-side (schemePacks is read-only for clients; rules allow
// reads scoped to the college, writes never) — that keeps the Scheme Packs
// page fast and the write path single-door.
// ─────────────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { resolveSchedulingStaff } from './classSchedule'

// ═════════════════════════════════════════════════════════════════════════════
// Pure validation (unit tested, no Firestore)
// ═════════════════════════════════════════════════════════════════════════════

export interface SchemePackDoc {
  code: string
  name: string
  universityName: string
  schemeName: string
  applicableProgrammes: string[]
  attendance: {
    minimumPercentage: number
    marksSlabs: { min: number; max: number; marks: number; label: string }[]
    blocksExamEligibility: boolean
  }
  internalAssessment: {
    totalMarks: number
    test: { count: number; maxMarksEach: number; bestOf: number; weightInTotal: number }
    attendanceMaxMarks: number
    assignmentMaxMarks: number
  }
  semesterEndExam: { defaultMaxMarks: number; durationMinutes: number; passPercentage: number }
  passCriteria: {
    aggregatePassPercentage: number
    minimumInternalPercentage: number
    requireSemesterEndPass: boolean
  }
  gradeTable: { grade: string; gradePoint: number; minPercentage: number; description: string }[]
  mediums: string[]
  status: 'active' | 'draft' | 'archived'
  sourceNote?: string
}

const CODE_RE = /^[A-Za-z0-9_]{3,40}$/

function boundedNumber(value: unknown, field: string, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpsError('invalid-argument', `${field} must be a number between ${min} and ${max}`)
  }
  return n
}

function boundedString(value: unknown, field: string, maximum: number, required = true): string {
  const s = String(value ?? '').trim()
  if (required && !s) throw new HttpsError('invalid-argument', `${field} is required`)
  if (s.length > maximum) throw new HttpsError('invalid-argument', `${field} is too long (max ${maximum})`)
  return s
}

function stringArray(value: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

/**
 * Structural validation for a pack a human (or the clone-preset UI) submits.
 * Numeric sanity only — the engine normalises/absorbs anything else.
 */
export function validateSchemePackDoc(raw: unknown): SchemePackDoc {
  const input = (raw || {}) as Record<string, unknown>

  const code = boundedString(input.code, 'code', 40).toUpperCase()
  if (!CODE_RE.test(code)) {
    throw new HttpsError('invalid-argument', 'code must be 3-40 chars, letters/digits/underscore')
  }

  // Attendance
  const at = (input.attendance || {}) as Record<string, unknown>
  const minimumPercentage = boundedNumber(at.minimumPercentage, 'attendance.minimumPercentage', 1, 100)
  const slabsRaw = Array.isArray(at.marksSlabs) ? at.marksSlabs : []
  if (slabsRaw.length === 0) {
    throw new HttpsError('invalid-argument', 'attendance.marksSlabs must have at least one slab')
  }
  if (slabsRaw.length > 8) {
    throw new HttpsError('invalid-argument', 'attendance.marksSlabs allows at most 8 slabs')
  }
  const marksSlabs = slabsRaw.map((s, i) => {
    const row = (s || {}) as Record<string, unknown>
    const min = boundedNumber(row.min, `marksSlabs[${i}].min`, 0, 100)
    const max = boundedNumber(row.max, `marksSlabs[${i}].max`, 0, 100)
    if (min > max) throw new HttpsError('invalid-argument', `marksSlabs[${i}]: min must be ≤ max`)
    return {
      min,
      max,
      marks: boundedNumber(row.marks, `marksSlabs[${i}].marks`, 0, 50),
      label: boundedString(row.label, `marksSlabs[${i}].label`, 60, false) || `${marksNote(min, max)}`,
    }
  })
  // First slab must start at the eligibility floor — otherwise "just above
  // the minimum" earns nothing while the rules imply it should.
  if (Math.min(...marksSlabs.map((s) => s.min)) > minimumPercentage + 1.5) {
    throw new HttpsError(
      'invalid-argument',
      'attendance slabs should start at (or just above) the minimumPercentage',
    )
  }

  // IA
  const iaRaw = (input.internalAssessment || {}) as Record<string, unknown>
  const testRaw = (iaRaw.test || {}) as Record<string, unknown>
  const iaTotal = boundedNumber(iaRaw.totalMarks, 'internalAssessment.totalMarks', 1, 100)
  const test = {
    count: boundedNumber(testRaw.count, 'internalAssessment.test.count', 1, 8),
    maxMarksEach: boundedNumber(testRaw.maxMarksEach, 'internalAssessment.test.maxMarksEach', 1, 100),
    bestOf: boundedNumber(testRaw.bestOf, 'internalAssessment.test.bestOf', 1, 8),
    weightInTotal: boundedNumber(testRaw.weightInTotal, 'internalAssessment.test.weightInTotal', 0, 100),
  }
  if (test.bestOf > test.count) {
    throw new HttpsError('invalid-argument', 'internalAssessment.test.bestOf cannot exceed test.count')
  }
  const internalAssessment = {
    totalMarks: iaTotal,
    test,
    attendanceMaxMarks: boundedNumber(iaRaw.attendanceMaxMarks, 'internalAssessment.attendanceMaxMarks', 0, 50),
    assignmentMaxMarks: boundedNumber(iaRaw.assignmentMaxMarks, 'internalAssessment.assignmentMaxMarks', 0, 50),
  }
  if (Math.abs(test.weightInTotal + internalAssessment.attendanceMaxMarks + internalAssessment.assignmentMaxMarks - iaTotal) > 0.51) {
    throw new HttpsError(
      'invalid-argument',
      'IA components (test weight + attendance + assignment) must add up to totalMarks',
    )
  }

  // SEE
  const seeRaw = (input.semesterEndExam || {}) as Record<string, unknown>
  const semesterEndExam = {
    defaultMaxMarks: boundedNumber(seeRaw.defaultMaxMarks, 'semesterEndExam.defaultMaxMarks', 10, 200),
    durationMinutes: boundedNumber(seeRaw.durationMinutes, 'semesterEndExam.durationMinutes', 30, 420),
    passPercentage: boundedNumber(seeRaw.passPercentage, 'semesterEndExam.passPercentage', 0, 100),
  }

  // Pass criteria
  const pcRaw = (input.passCriteria || {}) as Record<string, unknown>
  const passCriteria = {
    aggregatePassPercentage: boundedNumber(pcRaw.aggregatePassPercentage, 'passCriteria.aggregatePassPercentage', 0, 100),
    minimumInternalPercentage: boundedNumber(pcRaw.minimumInternalPercentage ?? 0, 'passCriteria.minimumInternalPercentage', 0, 100),
    requireSemesterEndPass: pcRaw.requireSemesterEndPass !== false,
  }

  // Grades
  const gradesRaw = Array.isArray(input.gradeTable) ? input.gradeTable : []
  if (gradesRaw.length < 2 || gradesRaw.length > 14) {
    throw new HttpsError('invalid-argument', 'gradeTable must have between 2 and 14 rows')
  }
  const gradeTable = gradesRaw.map((g, i) => {
    const row = (g || {}) as Record<string, unknown>
    return {
      grade: boundedString(row.grade, `gradeTable[${i}].grade`, 6),
      gradePoint: boundedNumber(row.gradePoint, `gradeTable[${i}].gradePoint`, 0, 10),
      minPercentage: boundedNumber(row.minPercentage, `gradeTable[${i}].minPercentage`, 0, 100),
      description: boundedString(row.description, `gradeTable[${i}].description`, 60, false),
    }
  })

  const statusRaw = String(input.status ?? 'active').trim()
  const status = statusRaw === 'draft' || statusRaw === 'archived' ? statusRaw : 'active'

  return {
    code,
    name: boundedString(input.name, 'name', 120),
    universityName: boundedString(input.universityName, 'universityName', 120),
    schemeName: boundedString(input.schemeName, 'schemeName', 60),
    applicableProgrammes: stringArray(input.applicableProgrammes, 'applicableProgrammes', 20),
    attendance: {
      minimumPercentage,
      marksSlabs,
      blocksExamEligibility: at.blocksExamEligibility !== false,
    },
    internalAssessment,
    semesterEndExam,
    passCriteria,
    gradeTable: [...gradeTable].sort((a, b) => b.minPercentage - a.minPercentage),
    mediums: stringArray(input.mediums, 'mediums', 6),
    status,
    ...(typeof input.sourceNote === 'string' && input.sourceNote.trim()
      ? { sourceNote: input.sourceNote.trim().slice(0, 300) }
      : {}),
  }
}

function marksNote(min: number, max: number): string {
  return `${min}%–${max}%`
}

// ═════════════════════════════════════════════════════════════════════════════
// Callables
// ═════════════════════════════════════════════════════════════════════════════

const REGION = { region: 'asia-south1' as const }

/** Built-in preset codes mirrored server-side so an "assign" of a preset
 *  needs no Firestore doc — keep in sync with src/shared/types/schemePack.ts. */
export const PRESET_SCHEME_CODES = ['BCU_SEP_2024', 'KUD_NEP_CBAE', 'GENERIC_NEP_2020']

function customPackDocId(collegeId: string, code: string): string {
  return `${collegeId}__${code}`
}

/**
 * saveSchemePack { pack, collegeId? }
 * Upserts a custom pack under the caller's college. The doc id is
 * `${collegeId}__${CODE}` so a college can never overwrite another tenant's
 * pack (or a global preset).
 */
export const saveSchemePack = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSchedulingStaff(uid, request.auth?.token || {})

  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = staff.role === 'superadmin' ? String(raw.collegeId ?? '').trim() : staff.collegeId
  if (!collegeId) throw new HttpsError('invalid-argument', 'No college is associated with this account')
  if (PRESET_SCHEME_CODES.includes(String((raw.pack as Record<string, unknown> | undefined)?.code ?? '').toUpperCase())) {
    throw new HttpsError('invalid-argument', 'Preset codes are reserved — pick a custom code')
  }

  const pack = validateSchemePackDoc(raw.pack)
  const db = getFirestore(admin.app(), 'default')
  const docId = customPackDocId(collegeId, pack.code)
  const ref = db.collection('schemePacks').doc(docId)
  const existing = await ref.get()
  if (existing.exists && String(existing.data()?.collegeId ?? '') !== collegeId) {
    throw new HttpsError('permission-denied', 'This scheme pack belongs to another college')
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  await ref.set(
    {
      ...pack,
      id: docId,
      collegeId,
      updatedAt: now,
      updatedBy: staff.name || uid,
      ...(existing.exists ? {} : { createdAt: now, createdBy: staff.name || uid }),
    },
    { merge: true },
  )
  return { id: docId, code: pack.code, name: pack.name, updated: existing.exists }
})

/**
 * assignCollegeSchemePack { schemePackId, collegeId? }
 * Binds a pack (preset code or custom doc id) to the caller's college.
 * Pass an empty schemePackId to clear the binding (college falls back to BCU).
 */
export const assignCollegeSchemePack = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSchedulingStaff(uid, request.auth?.token || {})

  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = staff.role === 'superadmin' ? String(raw.collegeId ?? '').trim() : staff.collegeId
  if (!collegeId) throw new HttpsError('invalid-argument', 'No college is associated with this account')
  const schemePackId = String(raw.schemePackId ?? '').trim()

  let resolvedName = 'default (BCU)'
  if (schemePackId) {
    if (PRESET_SCHEME_CODES.includes(schemePackId)) {
      resolvedName = `preset ${schemePackId}`
    } else {
      const snap = await getFirestore(admin.app(), 'default').collection('schemePacks').doc(schemePackId).get()
      if (!snap.exists) throw new HttpsError('not-found', 'Scheme pack not found')
      if (String(snap.data()?.collegeId ?? '') !== collegeId) {
        throw new HttpsError('permission-denied', 'This scheme pack belongs to another college')
      }
      resolvedName = String(snap.data()?.name || schemePackId)
    }
  }

  await getFirestore(admin.app(), 'default').collection('colleges').doc(collegeId).set(
    {
      schemePackId: schemePackId || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return { collegeId, schemePackId: schemePackId || null, resolvedName }
})
