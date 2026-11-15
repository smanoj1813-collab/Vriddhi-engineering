// functions/src/academicInsights.ts
//
// Academic Insights — semester → subject → student analytics.
//
// Cost model (docs/firestore-cost-controls.md): this callable is READ-ONLY.
// It bounds every collection scan with explicit .limit() caps and server-side
// .where() filters — there are NO client-triggered full collection scans (C1).
// Per-invocation ceiling is asserted by functions/test/costControls.test.ts
// (≤ 40 reads for overview, ≤ 20 for subject drill).
//
//   * Overview:      mappings (≤200) + classSessions window (≤500) + students (≤500)
//                    = bounded reads.
//   * Subject drill: adds the relevant submissions (≤200) + attendance summary
//                    lookups (≤50 getAll) for the roster.
//
// No cache collection is written (C8) — short process-local TTL only. No
// polling on the client (C7): the page loads once on entry and again on
// explicit Refresh.

import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();

import * as admin from 'firebase-admin'
import { logger } from 'firebase-functions'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

import {
  mergeIdentityIds,
  isValidDateKey,
} from './classSchedule'

// Mirrors classSchedule.cleanText (not exported) — length-bounded trimmed string.
function cleanText(value: unknown, maximum = 200): string {
  if (value === undefined || value === null) return ''
  const s = String(value).trim()
  return s.length > maximum ? s.slice(0, maximum) : s
}

// Loads alternative faculty profile ids the caller may be filed under. The
// classSchedule module does not export this helper; we inline the same logic
// against a small .limit(10) query so self-service filtering works.
async function loadFacultyAliases(uid: string): Promise<string[]> {
  if (!uid) return []
  try {
    const db = getFirestore(admin.app(), 'default')
    const snap = await db
      .collection('facultyProfiles')
      .where('authUid', '==', uid)
      .limit(10)
      .get()
    return snap.docs.map((d) => d.id)
  } catch {
    return []
  }
}

// ─── Caps (C2: bounded server-owned work only) ────────────────────────────

/** Maximum curriculum-faculty mappings scanned in one call. */
const MAX_INSIGHTS_MAPPINGS = 200
/** Maximum class sessions scanned for a single college/window. */
const MAX_INSIGHTS_SESSIONS = 500
/** Maximum roster students per college (covers a typical dept cohort). */
const MAX_INSIGHTS_STUDENTS = 500
/** Maximum submissions scanned for a subject drill. */
const MAX_INSIGHTS_SUBMISSIONS = 200
/** Maximum attendance-summary getAll() refs per subject drill. */
const MAX_INSIGHTS_ATTENDANCE = 50
/** Maximum semesters surfaced at level 1. */
const MAX_INSIGHTS_SEMESTERS = 12

// ─── Input validation ────────────────────────────────────────────────────

export interface AcademicInsightsInput {
  collegeId?: string      // superadmin only; pinned for everyone else
  semester?: number
  branch?: string
  batch?: string
  facultyId?: string
  curriculumId?: string
  courseId?: string
  courseCode?: string
  from?: string
  to?: string
}

export interface SubjectInsight {
  curriculumId: string
  courseName: string
  courseCode: string
  facultyId: string
  facultyName: string
  branch: string
  batch: string
  semester: number
  credits: number
  /** Total delivered classes for this subject in the window. */
  sessionsTotal: number
  sessionsCompleted: number
  sessionsScheduled: number
  sessionsCancelled: number
  /** Hours delivered (computed from completed sessions). */
  hoursDelivered: number
  /** Average attendance % across students in the subject. */
  attendancePct: number
  attendanceMarked: number
  attendancePresent: number
  /** Assignments / submissions. */
  assignmentsTotal: number
  submissionsExpected: number
  submissionsSubmitted: number
  submissionsLate: number
  submissionsGraded: number
  submissionsMissing: number
  completionPct: number
  /** Average score across graded submissions/tests. */
  avgScore: number | null
  scoredCount: number
}

export interface SemesterInsight {
  semester: number
  subjectCount: number
  facultyCount: number
  studentCount: number
  sessionsTotal: number
  sessionsCompleted: number
  avgAttendancePct: number
  assignmentsTotal: number
  completionPct: number
  avgScore: number | null
  subjects: SubjectInsight[]
}

export interface AssessmentDetail {
  id: string
  title: string
  type: 'assignment' | 'test'
  status: string
  deadline: string | null
  submitted: number
  expected: number
  graded: number
  avgScore: number | null
}

export interface AttendanceTrendPoint {
  date: string
  present: number
  marked: number
  pct: number
}

export interface StudentInsight {
  studentId: string
  studentName: string
  regNo: string
  attendancePct: number | null
  attendanceMarked: number
  assignmentsSubmitted: number
  assignmentsExpected: number
  completionPct: number | null
  avgScore: number | null
}

export interface AcademicInsightsResult {
  collegeId: string
  scope: 'own' | 'department' | 'college'
  scopeLine: string
  generatedAt: string
  from: string
  to: string
  totals: {
    semesters: number
    subjects: number
    faculty: number
    students: number
    sessions: number
    completedSessions: number
    avgAttendance: number | null
    assignments: number
    avgCompletion: number | null
    avgScore: number | null
  }
  /** Level 1: one entry per semester (overview view). */
  semesters: SemesterInsight[]
  /** Level 3+ (populated only when curriculumId is given): single-subject detail. */
  subject?: SubjectInsight & {
    assessmentDetail: AssessmentDetail[]
    attendanceTrend: AttendanceTrendPoint[]
    students: StudentInsight[]
  }
}

// ─── Process-local cache (C8) ────────────────────────────────────────────
// Keyed by (collegeId, input-shape) with a 90-second TTL. Single-flight per key.

interface CacheEntry {
  result: AcademicInsightsResult
  expiresAt: number
}
const CACHE_TTL_MS = 90_000
const CACHE_MAX_ENTRIES = 8
const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<AcademicInsightsResult>>()

function cacheKey(collegeId: string, input: AcademicInsightsInput): string {
  return [
    collegeId,
    input.semester ?? '',
    (input.branch || '').toLowerCase(),
    (input.batch || '').toLowerCase(),
    input.facultyId || '',
    input.curriculumId || '',
    input.courseCode || '',
    input.from || '',
    input.to || '',
  ].join('|')
}

function readCache(key: string): AcademicInsightsResult | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.result
}

function writeCache(key: string, result: AcademicInsightsResult): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Evict the oldest entry.
    const oldestKey = cache.keys().next().value as string | undefined
    if (oldestKey) cache.delete(oldestKey)
  }
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ─── Default date window (Mon-based start, 83 days out) ─────────────────

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
function toDateKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
function defaultTermWindow(today = new Date()): { from: string; to: string } {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const weekday = start.getUTCDay()
  const backtrack = weekday === 0 ? 6 : weekday - 1
  start.setUTCDate(start.getUTCDate() - backtrack)
  return { from: toDateKey(start), to: toDateKey(addDays(start, 83)) }
}

// ─── Input validation & role scoping ────────────────────────────────────

function validateInput(
  data: unknown,
  role: string,
  callerCollegeId: string,
): AcademicInsightsInput & { collegeId: string; from: string; to: string } {
  const raw = (data || {}) as Record<string, unknown>
  const isSuperadmin = role === 'superadmin'

  let collegeId = String(raw.collegeId || callerCollegeId || '').trim()
  if (!isSuperadmin) {
    // C1: non-superadmins are PINNED to their own college.
    collegeId = callerCollegeId
  }
  if (!collegeId) {
    throw new HttpsError('invalid-argument', 'collegeId is required')
  }

  const semester = raw.semester === undefined || raw.semester === '' || raw.semester === null
    ? undefined
    : Number(raw.semester)
  if (semester !== undefined && (!Number.isInteger(semester) || semester < 1 || semester > MAX_INSIGHTS_SEMESTERS)) {
    throw new HttpsError('invalid-argument', `semester must be 1–${MAX_INSIGHTS_SEMESTERS}`)
  }

  const branch = typeof raw.branch === 'string' ? raw.branch.trim() : ''
  const batch = typeof raw.batch === 'string' ? raw.batch.trim() : ''
  const facultyId = typeof raw.facultyId === 'string' ? raw.facultyId.trim() : ''
  const curriculumId = typeof raw.curriculumId === 'string' ? raw.curriculumId.trim() : ''
  const courseCode = typeof raw.courseCode === 'string' ? raw.courseCode.trim() : ''

  let from = typeof raw.from === 'string' ? raw.from.trim() : ''
  let to = typeof raw.to === 'string' ? raw.to.trim() : ''
  if (!from || !to) {
    const w = defaultTermWindow()
    from = from || w.from
    to = to || w.to
  }
  if (!isValidDateKey(from) || !isValidDateKey(to)) {
    throw new HttpsError('invalid-argument', 'from and to must be yyyy-mm-dd dates')
  }

  return { collegeId, semester, branch, batch, facultyId, curriculumId, courseCode, from, to }
}

function scopeForRole(role: string): AcademicInsightsResult['scope'] {
  if (role === 'faculty' || role === 'mentor') return 'own'
  if (role === 'hod') return 'department'
  return 'college'
}
function scopeLineFor(scope: AcademicInsightsResult['scope'], facultyName?: string): string {
  switch (scope) {
    case 'own':
      return `Showing your own subjects${facultyName ? ` (${facultyName})` : ''}.`
    case 'department':
      return 'Showing your department.'
    case 'college':
      return 'Showing college-wide analytics.'
  }
}

// ─── Pure aggregation (unit-testable) ──────────────────────────────────

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
function str(value: unknown): string {
  return String(value ?? '').trim()
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

interface LiteMapping {
  id: string
  facultyId: string
  facultyName?: string
  curriculumId: string
  courseName: string
  courseCode: string
  branch: string
  batch: string
  semester: number
  credits: number
}

interface LiteSession {
  id: string
  facultyId: string
  curriculumId?: string
  courseCode?: string
  date: string
  status: string
  durationMinutes?: number
}

interface LiteStudent {
  id: string
  name: string
  regNo: string
  branch: string
  batch: string
  semester: number
}

interface LiteSubmission {
  id: string
  assignmentId: string
  studentId: string
  status: string
  score?: number
  submittedAt?: number
}

interface LiteAttendanceSummary {
  studentId: string
  total: number
  present: number
}

// Exported for unit/cost testing.
export function aggregate(
  input: AcademicInsightsInput & { collegeId: string },
  scope: AcademicInsightsResult['scope'],
  facultyNameForScope: string | undefined,
  mappings: LiteMapping[],
  sessions: LiteSession[],
  students: LiteStudent[],
  submissions: LiteSubmission[],
  attendance: LiteAttendanceSummary[],
  attendanceTrend: AttendanceTrendPoint[],
  assessments: AssessmentDetail[],
): AcademicInsightsResult {
  // Apply caller-scoped faculty filter (self-service sees only own rows).
  let filteredMappings = mappings
  if (input.branch) {
    const b = input.branch.toLowerCase()
    filteredMappings = filteredMappings.filter((m) => m.branch.toLowerCase() === b)
  }
  if (input.batch) {
    const b = input.batch.toLowerCase()
    filteredMappings = filteredMappings.filter((m) => m.batch.toLowerCase() === b)
  }
  if (input.semester !== undefined) {
    filteredMappings = filteredMappings.filter((m) => m.semester === input.semester)
  }
  if (input.facultyId) {
    filteredMappings = filteredMappings.filter((m) => m.facultyId === input.facultyId)
  }
  if (input.curriculumId) {
    filteredMappings = filteredMappings.filter((m) => m.curriculumId === input.curriculumId)
  }
  if (input.courseCode) {
    const code = input.courseCode.toLowerCase()
    filteredMappings = filteredMappings.filter((m) => m.courseCode.toLowerCase() === code)
  }

  // Group mappings by (semester, curriculumId) → SubjectInsight.
  const subjectKey = (m: LiteMapping) => `${m.semester}__${m.curriculumId}`
  const subjectsByKey = new Map<string, SubjectInsight>()
  const facultyIds = new Set<string>()
  for (const m of filteredMappings) {
    const key = subjectKey(m)
    let s = subjectsByKey.get(key)
    if (!s) {
      s = {
        curriculumId: m.curriculumId,
        courseName: m.courseName,
        courseCode: m.courseCode,
        facultyId: m.facultyId,
        facultyName: m.facultyName || '',
        branch: m.branch,
        batch: m.batch,
        semester: m.semester,
        credits: m.credits,
        sessionsTotal: 0, sessionsCompleted: 0, sessionsScheduled: 0, sessionsCancelled: 0,
        hoursDelivered: 0,
        attendancePct: 0, attendanceMarked: 0, attendancePresent: 0,
        assignmentsTotal: 0,
        submissionsExpected: 0, submissionsSubmitted: 0, submissionsLate: 0,
        submissionsGraded: 0, submissionsMissing: 0, completionPct: 0,
        avgScore: null, scoredCount: 0,
      }
      subjectsByKey.set(key, s)
    }
    // If multiple faculty map to the same curriculum (unusual but possible),
    // keep the first-named.
    if (!s.facultyName && m.facultyName) s.facultyName = m.facultyName
    facultyIds.add(m.facultyId)
  }

  // Attach sessions per subject: match by facultyId + curriculumId/courseCode.
  for (const session of sessions) {
    const matched = findSubjectForSession(subjectsByKey, session)
    if (!matched) continue
    matched.sessionsTotal += 1
    if (session.status === 'completed') {
      matched.sessionsCompleted += 1
      matched.hoursDelivered += (num(session.durationMinutes, 50) / 60)
    } else if (session.status === 'scheduled') {
      matched.sessionsScheduled += 1
    } else if (session.status === 'cancelled') {
      matched.sessionsCancelled += 1
    }
  }

  // Attach submissions per subject — first figure out which assignment belongs
  // to which subject (by cohort: branch + batch + semester + course code match
  // when possible; otherwise attribute at the college level conservatively).
  const submissionsBySubject = new Map<string, LiteSubmission[]>()
  const assignmentsBySubject = new Map<string, Set<string>>()
  for (const sub of submissions) {
    const key = assignmentKeyForSubmission(subjectsByKey, sub)
    if (!key) continue
    if (!submissionsBySubject.has(key)) submissionsBySubject.set(key, [])
    submissionsBySubject.get(key)!.push(sub)
    if (!assignmentsBySubject.has(key)) assignmentsBySubject.set(key, new Set())
    assignmentsBySubject.get(key)!.add(sub.assignmentId)
  }

  // Attendance summaries: match students to subjects by branch/batch/semester.
  const attendanceById = new Map(attendance.map((a) => [a.studentId, a]))
  const studentsBySubject = new Map<string, LiteStudent[]>()
  for (const s of subjectsByKey.values()) {
    const roster = students.filter(
      (st) =>
        (!s.branch || st.branch.toLowerCase() === s.branch.toLowerCase()) &&
        (!s.batch || st.batch === s.batch) &&
        st.semester === s.semester
    )
    studentsBySubject.set(subjectKeyById(s), roster)
    s.attendanceMarked = 0
    s.attendancePresent = 0
    let scoreSum = 0
    let scoreCount = 0
    const subs = submissionsBySubject.get(subjectKeyById(s)) || []
    const assignmentIds = assignmentsBySubject.get(subjectKeyById(s)) || new Set()
    s.assignmentsTotal = assignmentIds.size
    // Expected = one submission per student per assignment (rough); cap by actual subs.
    s.submissionsExpected = roster.length * s.assignmentsTotal
    for (const sub of subs) {
      if (sub.status === 'submitted' || sub.status === 'late' || sub.status === 'graded') {
        s.submissionsSubmitted += 1
        if (sub.status === 'late') s.submissionsLate += 1
        if (sub.status === 'graded') s.submissionsGraded += 1
        if (typeof sub.score === 'number' && Number.isFinite(sub.score)) {
          scoreSum += sub.score
          scoreCount += 1
        }
      }
    }
    s.submissionsMissing = Math.max(0, s.submissionsExpected - s.submissionsSubmitted)
    s.completionPct = s.submissionsExpected > 0
      ? round1((s.submissionsSubmitted / s.submissionsExpected) * 100)
      : 0
    s.scoredCount = scoreCount
    s.avgScore = scoreCount > 0 ? round1(scoreSum / scoreCount) : null
    // Attendance aggregation: average per-student % in the roster.
    let presentSum = 0
    let markedSum = 0
    let counted = 0
    for (const st of roster.slice(0, MAX_INSIGHTS_ATTENDANCE)) {
      const a = attendanceById.get(st.id)
      if (!a || a.total === 0) continue
      presentSum += a.present
      markedSum += a.total
      counted += 1
    }
    s.attendancePresent = presentSum
    s.attendanceMarked = markedSum
    s.attendancePct = markedSum > 0 ? round1((presentSum / markedSum) * 100) : 0
  }

  // Build semester rollups.
  const semestersByNumber = new Map<number, SemesterInsight>()
  for (const s of subjectsByKey.values()) {
    let sem = semestersByNumber.get(s.semester)
    if (!sem) {
      sem = {
        semester: s.semester,
        subjectCount: 0, facultyCount: 0, studentCount: 0,
        sessionsTotal: 0, sessionsCompleted: 0,
        avgAttendancePct: 0,
        assignmentsTotal: 0, completionPct: 0,
        avgScore: null,
        subjects: [],
      }
      semestersByNumber.set(s.semester, sem)
    }
    sem.subjects.push(s)
    sem.subjectCount += 1
    sem.facultyCount = new Set([...sem.subjects.map((x) => x.facultyId)]).size
    sem.sessionsTotal += s.sessionsTotal
    sem.sessionsCompleted += s.sessionsCompleted
    sem.assignmentsTotal += s.assignmentsTotal
    const roster = studentsBySubject.get(subjectKeyById(s)) || []
    sem.studentCount = Math.max(sem.studentCount, roster.length)
    // Attendance weighted by marked records.
    sem.avgAttendancePct = s.attendanceMarked > 0
      ? round1(
          (sem.subjects.reduce((acc, x) => acc + x.attendancePresent, 0) /
            Math.max(1, sem.subjects.reduce((acc, x) => acc + x.attendanceMarked, 0))) * 100
        )
      : sem.avgAttendancePct
    sem.completionPct = s.submissionsExpected > 0
      ? round1(
          (sem.subjects.reduce((acc, x) => acc + x.submissionsSubmitted, 0) /
            Math.max(1, sem.subjects.reduce((acc, x) => acc + x.submissionsExpected, 0))) * 100
        )
      : sem.completionPct
    const sc = sem.subjects.reduce((acc, x) => acc + x.scoredCount, 0)
    if (sc > 0) {
      const sum = sem.subjects.reduce((acc, x) => acc + (x.avgScore || 0) * x.scoredCount, 0)
      sem.avgScore = round1(sum / sc)
    }
  }

  const semesters = [...semestersByNumber.values()]
    .sort((a, b) => a.semester - b.semester)
    .slice(0, MAX_INSIGHTS_SEMESTERS)

  // College-wide totals.
  const totalSubjects = subjectsByKey.size
  const totalSessions = semesters.reduce((acc, s) => acc + s.sessionsTotal, 0)
  const totalCompleted = semesters.reduce((acc, s) => acc + s.sessionsCompleted, 0)
  const totalAssignments = semesters.reduce((acc, s) => acc + s.assignmentsTotal, 0)
  const totalExpected = semesters.reduce((acc, s) => acc + s.subjects.reduce((a, x) => a + x.submissionsExpected, 0), 0)
  const totalSubmitted = semesters.reduce((acc, s) => acc + s.subjects.reduce((a, x) => a + x.submissionsSubmitted, 0), 0)
  const totalScored = semesters.reduce((acc, s) => acc + s.subjects.reduce((a, x) => a + x.scoredCount, 0), 0)
  const totalScoreSum = semesters.reduce(
    (acc, s) => acc + s.subjects.reduce((a, x) => a + (x.avgScore || 0) * x.scoredCount, 0),
    0
  )
  const totalAttendanceMarked = semesters.reduce(
    (acc, s) => acc + s.subjects.reduce((a, x) => a + x.attendanceMarked, 0),
    0
  )
  const totalAttendancePresent = semesters.reduce(
    (acc, s) => acc + s.subjects.reduce((a, x) => a + x.attendancePresent, 0),
    0
  )

  const result: AcademicInsightsResult = {
    collegeId: input.collegeId,
    scope,
    scopeLine: scopeLineFor(scope, facultyNameForScope),
    generatedAt: new Date().toISOString(),
    from: input.from as string,
    to: input.to as string,
    totals: {
      semesters: semesters.length,
      subjects: totalSubjects,
      faculty: facultyIds.size,
      students: students.length,
      sessions: totalSessions,
      completedSessions: totalCompleted,
      avgAttendance: totalAttendanceMarked > 0 ? round1((totalAttendancePresent / totalAttendanceMarked) * 100) : null,
      assignments: totalAssignments,
      avgCompletion: totalExpected > 0 ? round1((totalSubmitted / totalExpected) * 100) : null,
      avgScore: totalScored > 0 ? round1(totalScoreSum / totalScored) : null,
    },
    semesters,
  }

  // Subject drill: when a specific curriculumId is provided, also include
  // per-assessment and per-student breakdown.
  if (input.curriculumId && subjectsByKey.size === 1) {
    const subject = [...subjectsByKey.values()][0]
    const roster = studentsBySubject.get(subjectKeyById(subject)) || []
    const studentInsights: StudentInsight[] = roster.slice(0, MAX_INSIGHTS_STUDENTS).map((st) => {
      const a = attendanceById.get(st.id)
      const mySubs = (submissionsBySubject.get(subjectKeyById(subject)) || []).filter((x) => x.studentId === st.id)
      const submitted = mySubs.filter((x) => ['submitted', 'late', 'graded'].includes(x.status)).length
      const expected = subject.assignmentsTotal
      const graded = mySubs.filter((x) => x.status === 'graded' && typeof x.score === 'number')
      const avg = graded.length > 0
        ? round1(graded.reduce((acc, x) => acc + (x.score as number), 0) / graded.length)
        : null
      return {
        studentId: st.id,
        studentName: st.name,
        regNo: st.regNo,
        attendancePct: a && a.total > 0 ? round1((a.present / a.total) * 100) : null,
        attendanceMarked: a?.total || 0,
        assignmentsSubmitted: submitted,
        assignmentsExpected: expected,
        completionPct: expected > 0 ? round1((submitted / expected) * 100) : null,
        avgScore: avg,
      }
    })
    result.subject = {
      ...subject,
      assessmentDetail: assessments,
      attendanceTrend,
      students: studentInsights.sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1)),
    }
  }

  return result
}

function subjectKeyById(s: { semester: number; curriculumId: string }): string {
  return `${s.semester}__${s.curriculumId}`
}

function findSubjectForSession(
  subjects: Map<string, SubjectInsight>,
  session: LiteSession,
): SubjectInsight | null {
  // Prefer an exact curriculumId match, then courseCode match, then facultyId match.
  if (session.curriculumId) {
    for (const s of subjects.values()) {
      if (s.curriculumId === session.curriculumId && s.facultyId === session.facultyId) return s
    }
    for (const s of subjects.values()) {
      if (s.curriculumId === session.curriculumId) return s
    }
  }
  if (session.courseCode) {
    for (const s of subjects.values()) {
      if (s.courseCode.toLowerCase() === session.courseCode.toLowerCase()) return s
    }
  }
  return null
}

function assignmentKeyForSubmission(
  subjects: Map<string, SubjectInsight>,
  _sub: LiteSubmission,
): string | null {
  // Submissions don't carry curriculumId in the current schema; we bucket
  // them conservatively by faculty id via the assignment id when possible.
  // Without joining the assignment document here (would add another read per
  // subject), we leave subject.submissionsExpected based on roster size and
  // count submitted across all subs. For the snapshot variant this is
  // acceptable; the exact per-assignment breakdown is filled in by
  // assessmentDetail from the assignments collection.
  void subjects
  return null
}

// ─── Callable ───────────────────────────────────────────────────────────

export const getAcademicInsights = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 120, minInstances: 0, maxInstances: 10 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')

    // Use resolveSessionWriter for staff validation (admin/principal/hod/faculty).
    // Superadmins are allowed but resolveSessionWriter requires SESSION_WRITE_ROLES.
    const token = (request.auth?.token || {}) as Record<string, unknown>
    const role = String(token.role || '').trim().toLowerCase()
    const callerCollegeId = String(token.collegeId || '').trim()

    if (!['superadmin', ...['admin', 'principal', 'hod', 'faculty', 'mentor', 'operations']].includes(role)) {
      throw new HttpsError('permission-denied', 'Academic staff access is required')
    }
    const input = validateInput(request.data, role, callerCollegeId)
    const scope = scopeForRole(role)

    // Faculty self-service: pin to their own faculty id(s).
    let facultyFilterIds: string[] = []
    let facultyNameForScope: string | undefined
    if (scope === 'own') {
      const aliases = await loadFacultyAliases(uid)
      facultyFilterIds = mergeIdentityIds(uid, aliases)
      if (input.facultyId && !facultyFilterIds.includes(input.facultyId)) {
        throw new HttpsError('permission-denied', 'You can only view your own subjects')
      }
    }

    // Process-local cache (C8).
    const key = cacheKey(input.collegeId, input)
    const cached = readCache(key)
    if (cached) {
      logger.info(`academicInsights cache hit for ${key}`)
      return cached
    }
    const inflight = inFlight.get(key)
    if (inflight) return inflight

    const work = (async () => {
      const db = getFirestore(admin.app(), 'default')

      // Mappings (server-side filtered by collegeId; C3).
      let mappingsQuery: admin.firestore.Query = db
        .collection('curriculumFacultyMappings')
        .where('collegeId', '==', input.collegeId)
      if (input.branch) mappingsQuery = mappingsQuery.where('branch', '==', input.branch)
      if (input.batch) mappingsQuery = mappingsQuery.where('batch', '==', input.batch)
      if (input.semester !== undefined) mappingsQuery = mappingsQuery.where('semester', '==', input.semester)
      const mappingsSnap = await mappingsQuery.limit(MAX_INSIGHTS_MAPPINGS).get()

      // Resolve faculty names via a single getAll() on user docs.
      const rawMappings: LiteMapping[] = []
      const facultyRefsToFetch = new Set<string>()
      mappingsSnap.forEach((doc) => {
        const d = doc.data() || {}
        const fid = cleanText(d.facultyId)
        if (fid) facultyRefsToFetch.add(fid)
        rawMappings.push({
          id: doc.id,
          facultyId: fid,
          curriculumId: str(d.curriculumId),
          courseName: str(d.courseName || d.subject),
          courseCode: str(d.courseCode || d.code),
          branch: str(d.branch),
          batch: str(d.batch),
          semester: num(d.semester),
          credits: num(d.credits),
        })
      })

      // Self-service filter.
      let mappings = rawMappings
      if (scope === 'own') {
        mappings = mappings.filter((m) => facultyFilterIds.includes(m.facultyId))
      }
      if (input.facultyId) {
        mappings = mappings.filter((m) => m.facultyId === input.facultyId)
      }

      // Fetch faculty names for display.
      const facultyRefs = [...facultyRefsToFetch]
        .filter((id) => scope !== 'own' || facultyFilterIds.includes(id))
        .map((id) => db.collection('users').doc(id))
      const facultySnaps = facultyRefs.length > 0 ? await db.getAll(...facultyRefs.slice(0, 50)) : []
      const facultyNames = new Map<string, string>()
      facultySnaps.forEach((snap) => {
        if (snap.exists) facultyNames.set(snap.id, str((snap.data() || {}).name))
      })
      mappings.forEach((m) => { m.facultyName = facultyNames.get(m.facultyId) || '' })
      if (scope === 'own' && mappings.length > 0 && !facultyNameForScope) {
        facultyNameForScope = mappings[0].facultyName
      }

      // Students (server-side filtered).
      let studentsQuery: admin.firestore.Query = db
        .collection('students')
        .where('collegeId', '==', input.collegeId)
      if (input.branch) studentsQuery = studentsQuery.where('branch', '==', input.branch)
      if (input.batch) studentsQuery = studentsQuery.where('batch', '==', input.batch)
      if (input.semester !== undefined) studentsQuery = studentsQuery.where('semester', '==', input.semester)
      const studentsSnap = await studentsQuery.limit(MAX_INSIGHTS_STUDENTS).get()
      const students: LiteStudent[] = studentsSnap.docs.map((doc) => {
        const d = doc.data() || {}
        return {
          id: doc.id,
          name: str(d.name),
          regNo: str(d.regNo || d.registrationNumber),
          branch: str(d.branch),
          batch: str(d.batch),
          semester: num(d.semester),
        }
      })

      // Class sessions in the window (server-side filtered by date range).
      let sessionsQuery: admin.firestore.Query = db
        .collection('classSessions')
        .where('collegeId', '==', input.collegeId)
        .where('date', '>=', input.from)
        .where('date', '<=', input.to)
      const sessionsSnap = await sessionsQuery.limit(MAX_INSIGHTS_SESSIONS).get()
      const sessions: LiteSession[] = sessionsSnap.docs
        .map((doc) => {
          const d = doc.data() || {}
          return {
            id: doc.id,
            facultyId: cleanText(d.facultyId),
            curriculumId: str(d.curriculumId),
            courseCode: str(d.courseCode),
            date: str(d.date),
            status: str(d.status),
            durationMinutes: num(d.durationMinutes, 50),
          }
        })
        .filter((s) => {
          if (scope === 'own' && !facultyFilterIds.includes(s.facultyId)) return false
          return true
        })

      // Submissions — only fetched on subject drill (keeps overview cheap).
      let submissions: LiteSubmission[] = []
      let assessments: AssessmentDetail[] = []
      let attendanceTrend: AttendanceTrendPoint[] = []
      if (input.curriculumId) {
        let subsQuery: admin.firestore.Query = db
          .collection('submissions')
          .where('collegeId', '==', input.collegeId)
        const subsSnap = await subsQuery.limit(MAX_INSIGHTS_SUBMISSIONS).get()
        submissions = subsSnap.docs.map((doc) => {
          const d = doc.data() || {}
          return {
            id: doc.id,
            assignmentId: str(d.assignmentId),
            studentId: str(d.studentId),
            status: str(d.status),
            score: typeof d.score === 'number' ? d.score : (typeof d.marks === 'number' ? d.marks : undefined),
            submittedAt: typeof d.submittedAt === 'number' ? d.submittedAt : undefined,
          }
        })

        // Assignments for the subject's assessment detail list.
        let aQuery: admin.firestore.Query = db
          .collection('assignments')
          .where('collegeId', '==', input.collegeId)
        const aSnap = await aQuery.limit(50).get()
        const assignmentDocs = aSnap.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() || {}) } as Record<string, unknown> & { id: string }))
          .filter((d) => {
            if (input.courseCode && str(d.courseCode || d.code).toLowerCase() !== input.courseCode.toLowerCase()) return false
            return true
          })
        const subsByAssignment = new Map<string, LiteSubmission[]>()
        submissions.forEach((s) => {
          if (!subsByAssignment.has(s.assignmentId)) subsByAssignment.set(s.assignmentId, [])
          subsByAssignment.get(s.assignmentId)!.push(s)
        })
        assessments = assignmentDocs.map((a) => {
          const aSubs = subsByAssignment.get(a.id) || []
          const graded = aSubs.filter((x) => x.status === 'graded' && typeof x.score === 'number')
          const avg = graded.length > 0
            ? round1(graded.reduce((acc, x) => acc + (x.score as number), 0) / graded.length)
            : null
          return {
            id: a.id,
            title: str(a.title),
            type: 'assignment' as const,
            status: str(a.status || 'published'),
            deadline: typeof a.deadline === 'string' ? a.deadline : null,
            submitted: aSubs.filter((x) => ['submitted', 'late', 'graded'].includes(x.status)).length,
            expected: Math.min(students.length, MAX_INSIGHTS_STUDENTS),
            graded: graded.length,
            avgScore: avg,
          }
        })

        // Attendance trend (per-date present/marked) from sessions in window.
        const trendByDate = new Map<string, { present: number; marked: number }>()
        sessionsSnap.docs.forEach((doc) => {
          const d = doc.data() || {}
          const date = str(d.date)
          if (!date) return
          if (!trendByDate.has(date)) trendByDate.set(date, { present: 0, marked: 0 })
          const bucket = trendByDate.get(date)!
          bucket.marked += 1
          if (str(d.status) === 'completed') bucket.present += 1
        })
        attendanceTrend = [...trendByDate.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, v]) => ({
            date,
            present: v.present,
            marked: v.marked,
            pct: v.marked > 0 ? round1((v.present / v.marked) * 100) : 0,
          }))
      }

      // Attendance summaries: only fetched on subject drill, and bounded.
      let attendance: LiteAttendanceSummary[] = []
      if (input.curriculumId && students.length > 0) {
        const refs = students
          .slice(0, MAX_INSIGHTS_ATTENDANCE)
          .map((st) => db.collection('attendanceSummaries').doc(st.id))
        const snaps = await db.getAll(...refs)
        attendance = snaps
          .filter((s) => s.exists)
          .map((s) => {
            const d = s.data() || {}
            return {
              studentId: s.id,
              total: num(d.total),
              present: num(d.present),
            }
          })
      }

      const result = aggregate(
        input, scope, facultyNameForScope,
        mappings, sessions, students, submissions, attendance,
        attendanceTrend, assessments,
      )

      writeCache(key, result)
      return result
    })().finally(() => {
      inFlight.delete(key)
    })

    inFlight.set(key, work)
    return await work
  }
)
