import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// ─────────────────────────────────────────────────────────────────────────────
// OBE attainment — persistence + trusted compute (Slice 2)
//
// WHY THIS EXISTS
// A CO→PO mapping typed into a browser is a claim; an NBA SAR table must be
// evidence. So the pipeline from Slice 1 (src/shared/utils/obeAttainment.ts)
// is mirrored here as the single write door:
//
//   saveObeMapping      — HOD/faculty author a per-course-term mapping draft.
//                         Published mappings are immutable: a correction is a
//                         new term mapping, never an edit (runs embed the
//                         mapping snapshot they were computed from).
//   publishObeMapping   — validates completeness (every CO mapped, 1–3
//                         correlations) and freezes the college pack's
//                         attainment rules onto the mapping.
//   computeObeAttainment — runs the 80/20 computation server-side and writes
//                         an IMMUTABLE obeRuns document. No update/delete API
//                         exists; rules deny client writes.
//
// Reads stay client-side (obeMappings/obeRuns are staff-read, college-scoped)
// — the mapping editor and SAR tables stay fast while the numbers stay
// tamper-evident.
//
// MIRROR NOTE: computeObeCourseAttainment / computeIndirectFromSurveys below
// deliberately duplicate the Slice 1 formulas (functions/ never imports from
// src/). The parity block in test/obe.test.ts pins the SAME hand-verified
// worked example as src/shared/utils/obeAttainment.test.ts — if the two ever
// disagree, one of the suites goes red.
// ─────────────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { resolveSessionWriter } from './classSchedule'

const REGION = { region: 'asia-south1' as const }

// Float-safe rounding, mirroring the Slice 1 engine: SAR tables must match
// the Excel sheets colleges cross-check against.
const round2 = (n: number): number => Math.round((n + 1e-9) * 100) / 100

// ═════════════════════════════════════════════════════════════════════════════
// Pure validation + compute (unit tested, no Firestore)
// ═════════════════════════════════════════════════════════════════════════════

export const OBE_FRAMEWORK = 'NBA-GAPC-v4.0'
const MAX_COS = 12
const MAX_STATEMENT = 500
const MAX_OUTCOMES_PER_CO = 16
const MAX_STUDENTS = 5000
const MAX_COS_PER_STUDENT = 24

export interface ObeValidatedCo {
  code: string
  statement: string
  bloomLevel?: string
}

export interface ObeValidatedMapping {
  courseCode: string
  courseTitle: string
  academicYear: string
  term: string
  programId: string
  branch: string
  facultyId: string
  framework: string
  cos: ObeValidatedCo[]
  mapping: Record<string, Record<string, number>>
  targets: Record<string, number>
  coTargets: Record<string, number>
}

function boundedString(value: unknown, field: string, maximum: number, required = true): string {
  const s = String(value ?? '').trim()
  if (required && !s) throw new HttpsError('invalid-argument', `${field} is required`)
  if (s.length > maximum) throw new HttpsError('invalid-argument', `${field} is too long (max ${maximum})`)
  return s
}

const CO_CODE = /^[A-Z0-9]{2,10}$/
const OUTCOME_CODE = /^(PO\d{1,2}|PSO\d{1,2})$/
const BLOOM_CODES = new Set(['L1', 'L2', 'L3', 'L4', 'L5', 'L6'])

function normalizeOutcomeCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!OUTCOME_CODE.test(code)) {
    throw new HttpsError('invalid-argument', `Outcome code "${raw}" must look like PO1 or PSO2`)
  }
  const num = Number(code.replace(/^(PO|PSO)/, ''))
  if (code.startsWith('PSO')) {
    if (num < 1 || num > 12) throw new HttpsError('invalid-argument', `Outcome code "${raw}" is out of range`)
  } else if (num < 1 || num > 11) {
    // GAPC v4.0 defines exactly 11 POs; PO12 belongs to the retired framework.
    throw new HttpsError('invalid-argument', `Outcome code "${raw}" is out of range (GAPC v4.0 has PO1–PO11)`)
  }
  return code
}

/** Server-side twin of the Slice 1 mapping checks, plus payload bounds.
 *
 * Partial mode (`allowPartial`) is for DRAFT saves: course identity and any
 * rows the author has filled so far must be structurally valid, but COs may
 * be missing and mapping rows may be absent. Completeness is enforced at
 * publish time — half-filled drafts can be saved but never become evidence.
 */
export function validateObeMappingDoc(raw: unknown, opts?: { allowPartial?: boolean }): ObeValidatedMapping {
  const allowPartial = opts?.allowPartial === true
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpsError('invalid-argument', 'mapping must be an object')
  }
  const doc = raw as Record<string, unknown>
  const framework = boundedString(doc.framework, 'framework', 24)
  if (framework !== OBE_FRAMEWORK) {
    throw new HttpsError('invalid-argument', `framework must be ${OBE_FRAMEWORK}`)
  }
  const courseCode = boundedString(doc.courseCode, 'courseCode', 20).toUpperCase().replace(/\s+/g, '')
  if (!/^[A-Z0-9-]{2,20}$/.test(courseCode)) {
    throw new HttpsError('invalid-argument', 'courseCode must be 2–20 letters/digits/dashes')
  }
  const rawCos = doc.cos
  if (!allowPartial && (!Array.isArray(rawCos) || rawCos.length === 0)) {
    throw new HttpsError('invalid-argument', 'At least one course outcome is required')
  }
  const coEntries: unknown[] = Array.isArray(rawCos) ? rawCos : []
  if (coEntries.length > MAX_COS) {
    throw new HttpsError('invalid-argument', `At most ${MAX_COS} course outcomes are supported`)
  }
  const cos: ObeValidatedCo[] = []
  const seen = new Set<string>()
  for (const entry of coEntries) {
    const co = (entry ?? {}) as Record<string, unknown>
    const code = boundedString(co.code, 'cos[].code', 10).toUpperCase().replace(/\s+/g, '')
    if (!CO_CODE.test(code)) throw new HttpsError('invalid-argument', `CO code "${code}" must look like CO1`)
    if (seen.has(code)) throw new HttpsError('invalid-argument', `Duplicate CO code "${code}"`)
    seen.add(code)
    const statement = boundedString(co.statement, `${code}.statement`, MAX_STATEMENT)
    const bloomRaw = String(co.bloomLevel ?? '').trim().toUpperCase()
    if (bloomRaw && !BLOOM_CODES.has(bloomRaw)) {
      throw new HttpsError('invalid-argument', `${code}.bloomLevel must be L1–L6`)
    }
    cos.push({ code, statement, ...(bloomRaw ? { bloomLevel: bloomRaw } : {}) })
  }

  const rawMapping = doc.mapping
  if (!allowPartial && (!rawMapping || typeof rawMapping !== 'object' || Array.isArray(rawMapping))) {
    throw new HttpsError('invalid-argument', 'mapping must be an object keyed by CO code')
  }
  const mappingInput =
    rawMapping && typeof rawMapping === 'object' && !Array.isArray(rawMapping)
      ? (rawMapping as Record<string, unknown>)
      : {}
  const mapping: Record<string, Record<string, number>> = {}
  for (const co of cos) {
    const row = mappingInput[co.code]
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      if (allowPartial) continue
      throw new HttpsError('invalid-argument', `${co.code} has no PO/PSO mapping`)
    }
    const entries = Object.entries(row as Record<string, unknown>)
    if (entries.length === 0) {
      if (allowPartial) continue
      throw new HttpsError('invalid-argument', `${co.code} has no PO/PSO mapping`)
    }
    if (entries.length > MAX_OUTCOMES_PER_CO) {
      throw new HttpsError('invalid-argument', `${co.code} maps to too many outcomes (max ${MAX_OUTCOMES_PER_CO})`)
    }
    mapping[co.code] = {}
    for (const [outcomeRaw, correlationRaw] of entries) {
      const outcome = normalizeOutcomeCode(outcomeRaw)
      const correlation = Number(correlationRaw)
      if (![1, 2, 3].includes(correlation)) {
        throw new HttpsError('invalid-argument', `${co.code} → ${outcome} correlation must be 1, 2 or 3`)
      }
      mapping[co.code][outcome] = correlation
    }
  }

  const readTargets = (value: unknown, field: string): Record<string, number> => {
    if (value == null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpsError('invalid-argument', `${field} must be an object`)
    }
    const out: Record<string, number> = {}
    for (const [keyRaw, targetRaw] of Object.entries(value as Record<string, unknown>)) {
      const target = Number(targetRaw)
      if (!Number.isFinite(target) || target < 0 || target > 3) {
        throw new HttpsError('invalid-argument', `${field}.${keyRaw} must be a number 0–3`)
      }
      out[String(keyRaw).trim().toUpperCase()] = round2(target)
    }
    return out
  }

  return {
    courseCode,
    courseTitle: boundedString(doc.courseTitle, 'courseTitle', 160, false),
    academicYear: boundedString(doc.academicYear, 'academicYear', 16),
    term: boundedString(doc.term, 'term', 40, false),
    programId: boundedString(doc.programId, 'programId', 60, false),
    branch: boundedString(doc.branch, 'branch', 100, false),
    facultyId: boundedString(doc.facultyId, 'facultyId', 120, false),
    framework,
    cos,
    mapping,
    targets: readTargets(doc.targets, 'targets'),
    coTargets: readTargets(doc.coTargets, 'coTargets'),
  }
}

export interface ObeScoreRow {
  studentId: string
  coScores: Record<string, { obtained: number; max: number }>
}

/** Validates (and clamps, like the Slice 1 engine) per-student CO scores. */
export function validateObeScores(raw: unknown, coCodes: string[]): ObeScoreRow[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpsError('invalid-argument', 'studentScores must be a non-empty array')
  }
  if (raw.length > MAX_STUDENTS) {
    throw new HttpsError('invalid-argument', `At most ${MAX_STUDENTS} students per run`)
  }
  const allowed = new Set(coCodes)
  return raw.map((entry, index) => {
    const row = (entry ?? {}) as Record<string, unknown>
    const studentId = boundedString(row.studentId, `studentScores[${index}].studentId`, 120)
    const coScoresRaw = row.coScores
    if (!coScoresRaw || typeof coScoresRaw !== 'object' || Array.isArray(coScoresRaw)) {
      throw new HttpsError('invalid-argument', `studentScores[${index}].coScores must be an object`)
    }
    const entries = Object.entries(coScoresRaw as Record<string, unknown>)
    if (entries.length > MAX_COS_PER_STUDENT) {
      throw new HttpsError('invalid-argument', `studentScores[${index}] carries too many COs`)
    }
    const coScores: ObeScoreRow['coScores'] = {}
    for (const [coRaw, scoreRaw] of entries) {
      const co = String(coRaw).trim().toUpperCase()
      if (!allowed.has(co)) throw new HttpsError('invalid-argument', `${co} is not a CO on this mapping`)
      const score = (scoreRaw ?? {}) as Record<string, unknown>
      const obtained = Number(score.obtained)
      const max = Number(score.max)
      if (!Number.isFinite(obtained) || !Number.isFinite(max) || obtained < 0 || max <= 0) {
        throw new HttpsError('invalid-argument', `${studentId}.${co} needs obtained ≥ 0 and max > 0`)
      }
      coScores[co] = { obtained: round2(Math.min(obtained, max)), max: round2(max) }
    }
    return { studentId, coScores }
  })
}

export interface ObeRulesSnapshot {
  coThresholdPercentage: number
  levels: { level: number; minPercentStudents: number }[]
  directWeight: number
  indirectWeight: number
}

/** NBA conventions used when the college pack leaves attainment unconfigured. */
export function defaultObeRules(): ObeRulesSnapshot {
  return {
    coThresholdPercentage: 60,
    levels: [
      { level: 3, minPercentStudents: 70 },
      { level: 2, minPercentStudents: 60 },
      { level: 1, minPercentStudents: 50 },
    ],
    directWeight: 0.8,
    indirectWeight: 0.2,
  }
}

export function computeIndirectFromSurveys(
  surveys: { co: string; score: number; maxScore: number }[],
): Record<string, number> {
  const sums = new Map<string, { total: number; count: number }>()
  for (const response of surveys) {
    if (!response.co || !response.maxScore || response.maxScore <= 0) continue
    const clamped = Math.max(0, Math.min(response.score, response.maxScore))
    const scaled = (clamped / response.maxScore) * 3
    const bucket = sums.get(response.co) ?? { total: 0, count: 0 }
    bucket.total += scaled
    bucket.count += 1
    sums.set(response.co, bucket)
  }
  return Object.fromEntries(
    [...sums.entries()].map(([co, bucket]) => [co, round2(bucket.total / bucket.count)]),
  )
}

export interface ObeCourseAttainmentResult {
  coResults: {
    co: string
    attempted: number
    percentAboveThreshold: number
    direct: number
    indirect: number | null
    combined: number
  }[]
  outcomes: Record<string, number>
}

/**
 * Server-side twin of the Slice 1 course computation: direct levels from the
 * share of students clearing the threshold, 80/20 indirect blend, weighted
 * CO→PO/PSO roll-up. Kept formula-identical; parity-tested both sides.
 */
export function computeObeCourseAttainment(args: {
  scores: ObeScoreRow[]
  mapping: Record<string, Record<string, number>>
  indirect?: Record<string, number>
  rules?: ObeRulesSnapshot
}): ObeCourseAttainmentResult {
  const rules = args.rules ?? defaultObeRules()
  const levels = [...rules.levels].sort((a, b) => b.minPercentStudents - a.minPercentStudents)
  const coResults: ObeCourseAttainmentResult['coResults'] = []

  for (const co of Object.keys(args.mapping)) {
    let above = 0
    let attempted = 0
    for (const student of args.scores) {
      const score = student.coScores?.[co]
      if (!score || !score.max || score.max <= 0) continue
      attempted += 1
      if ((score.obtained / score.max) * 100 >= rules.coThresholdPercentage) above += 1
    }
    const percent = attempted > 0 ? (above / attempted) * 100 : 0
    let direct = 0
    for (const rule of levels) {
      if (percent >= rule.minPercentStudents) {
        direct = rule.level
        break
      }
    }
    const indirect = args.indirect?.[co] ?? null
    let combined = direct
    if (indirect != null) {
      const total = rules.directWeight + rules.indirectWeight
      combined = total > 0 ? (direct * rules.directWeight + indirect * rules.indirectWeight) / total : direct
    }
    coResults.push({
      co,
      attempted,
      percentAboveThreshold: round2(percent),
      direct,
      indirect,
      combined: round2(combined),
    })
  }

  const byCo = new Map(coResults.map((c) => [c.co, c.combined]))
  const totals: Record<string, { weighted: number; weight: number }> = {}
  for (const co of Object.keys(args.mapping)) {
    const value = byCo.get(co) ?? 0
    for (const [outcome, correlation] of Object.entries(args.mapping[co] ?? {})) {
      if (!correlation || correlation <= 0) continue
      totals[outcome] = totals[outcome] ?? { weighted: 0, weight: 0 }
      totals[outcome].weighted += value * correlation
      totals[outcome].weight += correlation
    }
  }
  const outcomes: Record<string, number> = {}
  for (const [outcome, total] of Object.entries(totals)) {
    outcomes[outcome] = total.weight > 0 ? round2(total.weighted / total.weight) : 0
  }
  return { coResults, outcomes }
}

/** Deterministic doc id: one mapping per college × course × year × term. */
export function obeMappingDocId(collegeId: string, courseCode: string, academicYear: string, term: string): string {
  const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'X'
  return [slug(collegeId), slug(courseCode), slug(academicYear), slug(term || 'TERM')].join('_')
}

// ═════════════════════════════════════════════════════════════════════════════
// Callables
// ═════════════════════════════════════════════════════════════════════════════

function obeDb() {
  return getFirestore(admin.app(), 'default')
}

/** Best-effort read of the college pack's attainment rules; NBA defaults win ties. */
async function snapshotCollegeObeRules(collegeId: string): Promise<ObeRulesSnapshot> {
  const fallback = defaultObeRules()
  try {
    const db = obeDb()
    const college = await db.collection('colleges').doc(collegeId).get()
    const schemePackId = String(college.data()?.schemePackId ?? '').trim()
    if (!schemePackId) return fallback
    const pack = await db.collection('schemePacks').doc(schemePackId).get()
    const attainment = (pack.data()?.engineering as Record<string, unknown> | undefined)?.attainment as
      | Record<string, unknown>
      | undefined
    if (!attainment || typeof attainment !== 'object') return fallback
    const num = (v: unknown, dflt: number) => (Number.isFinite(Number(v)) ? Number(v) : dflt)
    const levelsRaw = Array.isArray(attainment.levels) ? attainment.levels : []
    const levels = levelsRaw
      .map((l) => (l ?? {}) as Record<string, unknown>)
      .filter((l) => Number.isFinite(Number(l.level)) && Number.isFinite(Number(l.minPercentStudents)))
      .map((l) => ({ level: Number(l.level), minPercentStudents: Number(l.minPercentStudents) }))
    return {
      coThresholdPercentage: num(attainment.coThresholdPercentage, fallback.coThresholdPercentage),
      levels: levels.length ? levels : fallback.levels,
      directWeight: num(attainment.directWeight, fallback.directWeight),
      indirectWeight: num(attainment.indirectWeight, fallback.indirectWeight),
    }
  } catch {
    return fallback
  }
}

export const saveObeMapping = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSessionWriter(uid, request.auth?.token || {})
  const raw = (request.data || {}) as Record<string, unknown>
  // Teaching staff file under their own college; a superadmin may pass an
  // explicit collegeId (mirrors the scheme-pack write door).
  const collegeId =
    staff.role === 'superadmin' && typeof raw.collegeId === 'string' && raw.collegeId.trim()
      ? raw.collegeId.trim()
      : staff.collegeId
  if (!collegeId) throw new HttpsError('invalid-argument', 'No college is associated with this account')

  const mapping = validateObeMappingDoc(raw.mapping ?? raw, { allowPartial: true })
  const db = obeDb()
  const docId = obeMappingDocId(collegeId, mapping.courseCode, mapping.academicYear, mapping.term)
  const ref = db.collection('obeMappings').doc(docId)
  const existing = await ref.get()
  if (existing.exists) {
    const data = existing.data() || {}
    if (String(data.collegeId ?? '') !== collegeId) {
      throw new HttpsError('permission-denied', 'This mapping belongs to another college')
    }
    if (data.status === 'published') {
      throw new HttpsError(
        'failed-precondition',
        'Published mappings are immutable evidence — create a new term mapping instead',
      )
    }
  }
  const now = admin.firestore.FieldValue.serverTimestamp()
  await ref.set(
    {
      ...mapping,
      id: docId,
      collegeId,
      status: 'draft',
      updatedAt: now,
      updatedBy: staff.name || uid,
      ...(existing.exists ? {} : { createdAt: now, createdBy: staff.name || uid }),
    },
    { merge: true },
  )
  return { id: docId, status: 'draft', updated: existing.exists }
})

export const publishObeMapping = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSessionWriter(uid, request.auth?.token || {})
  const mappingId = String((request.data || {}).mappingId ?? '').trim()
  if (!mappingId) throw new HttpsError('invalid-argument', 'mappingId is required')

  const db = obeDb()
  const ref = db.collection('obeMappings').doc(mappingId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Mapping not found')
  const data = snap.data() || {}
  const collegeId = String(data.collegeId ?? '')
  if (staff.role !== 'superadmin' && collegeId !== staff.collegeId) {
    throw new HttpsError('permission-denied', 'This mapping belongs to another college')
  }
  if (!collegeId) throw new HttpsError('failed-precondition', 'Mapping has no college scope')
  if (data.status === 'published') return { id: mappingId, status: 'published', republished: false }
  if (data.status === 'archived') {
    throw new HttpsError('failed-precondition', 'Archived mappings cannot be published')
  }
  // Re-validate the stored payload: completeness is enforced at publish time,
  // so half-filled drafts can be saved but never become evidence.
  const mapping = validateObeMappingDoc(data)
  const rulesSnapshot = await snapshotCollegeObeRules(collegeId)
  const now = admin.firestore.FieldValue.serverTimestamp()
  await ref.set(
    {
      ...mapping,
      rulesSnapshot,
      status: 'published',
      publishedAt: now,
      publishedBy: staff.name || uid,
      updatedAt: now,
      updatedBy: staff.name || uid,
    },
    { merge: true },
  )
  return { id: mappingId, status: 'published' }
})

export const archiveObeMapping = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSessionWriter(uid, request.auth?.token || {})
  const mappingId = String((request.data || {}).mappingId ?? '').trim()
  if (!mappingId) throw new HttpsError('invalid-argument', 'mappingId is required')

  const db = obeDb()
  const ref = db.collection('obeMappings').doc(mappingId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Mapping not found')
  const data = snap.data() || {}
  if (staff.role !== 'superadmin' && String(data.collegeId ?? '') !== staff.collegeId) {
    throw new HttpsError('permission-denied', 'This mapping belongs to another college')
  }
  if (data.status === 'published') {
    throw new HttpsError('failed-precondition', 'Published mappings are evidence and cannot be archived')
  }
  if (data.status === 'archived') return { id: mappingId, status: 'archived' }
  const now = admin.firestore.FieldValue.serverTimestamp()
  await ref.set({ status: 'archived', updatedAt: now, updatedBy: staff.name || uid }, { merge: true })
  return { id: mappingId, status: 'archived' }
})

export const computeObeAttainment = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSessionWriter(uid, request.auth?.token || {})
  const raw = (request.data || {}) as Record<string, unknown>
  const mappingId = String(raw.mappingId ?? '').trim()
  if (!mappingId) throw new HttpsError('invalid-argument', 'mappingId is required')

  const db = obeDb()
  const snap = await db.collection('obeMappings').doc(mappingId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Mapping not found')
  const data = snap.data() || {}
  const collegeId = String(data.collegeId ?? '')
  if (staff.role !== 'superadmin' && collegeId !== staff.collegeId) {
    throw new HttpsError('permission-denied', 'This mapping belongs to another college')
  }
  if (data.status !== 'published') {
    throw new HttpsError('failed-precondition', 'Only published mappings can be computed')
  }
  const mapping = validateObeMappingDoc(data)
  const scores = validateObeScores(raw.studentScores, mapping.cos.map((c) => c.code))

  const surveysRaw = Array.isArray(raw.surveys) ? raw.surveys : []
  if (surveysRaw.length > MAX_STUDENTS * 4) {
    throw new HttpsError('invalid-argument', 'Too many survey responses for one run')
  }
  const surveys = surveysRaw.map((entry) => {
    const s = (entry ?? {}) as Record<string, unknown>
    return {
      co: String(s.co ?? '').trim().toUpperCase(),
      score: Number(s.score),
      maxScore: Number(s.maxScore),
    }
  })
  const indirect = computeIndirectFromSurveys(surveys)
  const rules = (data.rulesSnapshot as ObeRulesSnapshot | undefined) ?? defaultObeRules()
  const { coResults, outcomes } = computeObeCourseAttainment({ scores, mapping: mapping.mapping, indirect, rules })

  const gaps = Object.entries(outcomes)
    .map(([outcome, attained]) => {
      const target = Number(mapping.targets[outcome] ?? 0)
      return { outcome, attained, target: round2(target), gap: round2(attained - target), met: attained >= target }
    })
    .sort((a, b) => a.outcome.localeCompare(b.outcome))

  const tools = [...new Set((Array.isArray(raw.tools) ? raw.tools : []).map((t) => String(t ?? '').trim()).filter(Boolean))].slice(0, 24)
  const label = String(raw.label ?? '').trim().slice(0, 120)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const runRef = db.collection('obeRuns').doc()
  await runRef.set({
    id: runRef.id,
    collegeId,
    mappingId,
    ...(label ? { label } : {}),
    mappingSnapshot: {
      cos: mapping.cos,
      mapping: mapping.mapping,
      rules,
      targets: mapping.targets,
      coTargets: mapping.coTargets,
    },
    studentCount: scores.length,
    tools,
    coResults,
    outcomes,
    gaps,
    createdAt: now,
    createdBy: staff.name || uid,
  })
  return { runId: runRef.id, studentCount: scores.length, coResults, outcomes, gaps }
})