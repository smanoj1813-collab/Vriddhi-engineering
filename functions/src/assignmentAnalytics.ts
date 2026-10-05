import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/assignmentAnalytics.ts
// ─── Assignment completion analytics (course / module / batch / division) ──
//
// Reporting on how well the college is clearing its assignments, computed from
// the same three collections the rest of the flow already writes:
//
//   assignments   (faculty + admin schedule linkage, cohort/specific targeting)
//   submissions   (student uploads, status: submitted / late / graded)
//   students      (the roster that defines the "expected" denominator)
//
// The callable is staff-only; a faculty member sees only their own
// assignments, every other academic role sees the whole college. The math
// itself lives in pure exported functions so the unit tests can pin the
// percentages without a Firestore round-trip.

import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { resolveAssignmentStaff } from './studentPortal'
import { assertAssignmentsEnabled } from './collegeModules'

// ─── Input shapes (defensively parsed from documents) ───────────────────────

export interface AnalyticsStudent {
  id: string
  collegeId: string
  branch: string
  batch: string
  division: string
  semester: number
}

export interface AnalyticsAssignmentCohort {
  branch: string
  batch: string
  division: string
  semester: number
}

export interface AnalyticsAssignment {
  id: string
  title: string
  status: string // published | ongoing | closed | graded
  subject: string
  subjectCode: string
  deadline: Date | null
  courseName: string
  moduleId: string
  moduleTitle: string
  targetType: 'cohort' | 'specific'
  cohort: AnalyticsAssignmentCohort
  studentIds: string[]
}

export interface AnalyticsSubmission {
  id: string
  assignmentId: string
  studentId: string
  status: string // pending | submitted | late | missing | graded
  submittedAt: number | null // epoch ms
}

// ─── Pure computation ────────────────────────────────────────────────────────

/** A submission counts toward completion once a file actually landed. */
export const SUBMITTED_STATUSES = ['submitted', 'late', 'graded']

/** Statuses that no longer accept (or need) further submissions. */
const FINISHED_STATUSES = ['closed', 'graded']

const fold = (value: unknown) => String(value ?? '').trim().toLowerCase()

/**
 * Does this student fall inside the assignment's target audience? Mirrors
 * `assignmentTargetsStudent` in studentPortal.ts (the student-facing read
 * path) so the analytics denominator and the student's own visibility can
 * never disagree: cohort dimensions are AND-ed, compared case-insensitively,
 * and an empty cohort targets nobody rather than everybody.
 */
export function analyticsAssignmentTargetsStudent(
  assignment: AnalyticsAssignment,
  student: AnalyticsStudent
): boolean {
  if (assignment.targetType === 'specific') {
    return assignment.studentIds.includes(student.id)
  }
  const cohort = assignment.cohort
  if (!cohort.branch && !cohort.batch && !cohort.division && !cohort.semester) return false
  if (cohort.branch && fold(cohort.branch) !== fold(student.branch)) return false
  if (cohort.batch && fold(cohort.batch) !== fold(student.batch)) return false
  if (cohort.division && fold(cohort.division) !== fold(student.division)) return false
  if (cohort.semester && student.semester && cohort.semester !== student.semester) return false
  return true
}

/** How many roster students the assignment was actually aimed at. */
export function expectedStudentCount(
  assignment: AnalyticsAssignment,
  students: AnalyticsStudent[]
): number {
  return students.filter((student) => analyticsAssignmentTargetsStudent(assignment, student)).length
}

export interface AssignmentCompletion {
  assignmentId: string
  title: string
  status: string
  subject: string
  subjectCode: string
  /** Linked course (falls back to the plain subject when no course was attached). */
  courseName: string
  moduleId: string
  moduleTitle: string
  batch: string
  division: string
  deadline: string | null
  deadlinePassed: boolean
  overdue: boolean
  overdueDays: number
  expected: number
  submitted: number
  late: number
  graded: number
  missing: number
  completionPct: number
}

export interface GroupCompletion {
  key: string
  label: string
  assignments: number
  expected: number
  submitted: number
  late: number
  graded: number
  missing: number
  pct: number
}

export interface AssignmentAnalyticsSummary {
  overall: {
    assignments: number
    expected: number
    submitted: number
    late: number
    graded: number
    missing: number
    pct: number
    overdue: number
    ungraded: number
  }
  groups: {
    byCourse: GroupCompletion[]
    byModule: GroupCompletion[]
    byBatch: GroupCompletion[]
    byDivision: GroupCompletion[]
  }
  /** Past deadline with students who have not submitted yet, worst first. */
  overdueAlerts: AssignmentCompletion[]
  /** One row per assignment, soonest deadline first. */
  rows: AssignmentCompletion[]
}

function groupPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((numerator / denominator) * 100)))
}

export function computeAssignmentCompletion(
  assignment: AnalyticsAssignment,
  submissions: AnalyticsSubmission[],
  expected: number,
  now: number
): AssignmentCompletion {
  const mine = submissions.filter((s) => s.assignmentId === assignment.id)
  // One row per student: a late resubmission must not double-count.
  const byStudent = new Map<string, AnalyticsSubmission>()
  for (const sub of mine) {
    const existing = byStudent.get(sub.studentId)
    if (!existing || (sub.submittedAt ?? 0) >= (existing.submittedAt ?? 0)) {
      byStudent.set(sub.studentId, sub)
    }
  }
  const unique = [...byStudent.values()]
  const submitted = unique.filter((s) => SUBMITTED_STATUSES.includes(s.status)).length
  const late = unique.filter((s) => s.status === 'late').length
  const graded = unique.filter((s) => s.status === 'graded').length
  const missing = Math.max(0, expected - submitted)
  const deadlinePassed = Boolean(assignment.deadline && assignment.deadline.getTime() < now)
  const overdue =
    deadlinePassed && !FINISHED_STATUSES.includes(assignment.status) && missing > 0
  const overdueDays = deadlinePassed && assignment.deadline
    ? Math.max(0, Math.floor((now - assignment.deadline.getTime()) / 86_400_000))
    : 0

  return {
    assignmentId: assignment.id,
    title: assignment.title,
    status: assignment.status,
    subject: assignment.subject,
    subjectCode: assignment.subjectCode,
    courseName: assignment.courseName || assignment.subject || 'General',
    moduleId: assignment.moduleId,
    moduleTitle: assignment.moduleTitle,
    batch: assignment.targetType === 'cohort' ? assignment.cohort.batch : '',
    division: assignment.targetType === 'cohort' ? assignment.cohort.division : '',
    deadline: assignment.deadline ? assignment.deadline.toISOString() : null,
    deadlinePassed,
    overdue,
    overdueDays,
    expected,
    submitted,
    late,
    graded,
    missing,
    completionPct: groupPercent(submitted, expected),
  }
}

function buildGroup(
  rows: AssignmentCompletion[],
  keyOf: (row: AssignmentCompletion) => string | null
): GroupCompletion[] {
  const buckets = new Map<string, GroupCompletion>()
  for (const row of rows) {
    const key = keyOf(row)
    if (key === null) continue
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        key,
        label: key,
        assignments: 0,
        expected: 0,
        submitted: 0,
        late: 0,
        graded: 0,
        missing: 0,
        pct: 0,
      }
      buckets.set(key, bucket)
    }
    bucket.assignments += 1
    bucket.expected += row.expected
    bucket.submitted += row.submitted
    bucket.late += row.late
    bucket.graded += row.graded
    bucket.missing += row.missing
  }
  for (const bucket of buckets.values()) bucket.pct = groupPercent(bucket.submitted, bucket.expected)
  return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Full analytics snapshot. Pure and deterministic for a given `now`, which is
 * what makes the unit tests meaningful.
 */
export function buildAssignmentAnalytics(
  assignments: AnalyticsAssignment[],
  submissions: AnalyticsSubmission[],
  students: AnalyticsStudent[],
  now: number
): AssignmentAnalyticsSummary {
  const rows = assignments
    .map((assignment) =>
      computeAssignmentCompletion(assignment, submissions, expectedStudentCount(assignment, students), now)
    )
    .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || '') || a.title.localeCompare(b.title))

  const overall = rows.reduce(
    (acc, row) => {
      acc.expected += row.expected
      acc.submitted += row.submitted
      acc.late += row.late
      acc.graded += row.graded
      acc.missing += row.missing
      return acc
    },
    { expected: 0, submitted: 0, late: 0, graded: 0, missing: 0 }
  )

  return {
    overall: {
      assignments: rows.length,
      expected: overall.expected,
      submitted: overall.submitted,
      late: overall.late,
      graded: overall.graded,
      missing: overall.missing,
      pct: groupPercent(overall.submitted, overall.expected),
      overdue: rows.filter((row) => row.overdue).length,
      ungraded: Math.max(0, overall.submitted - overall.graded),
    },
    groups: {
      byCourse: buildGroup(rows, (row) => row.courseName || 'General'),
      byModule: buildGroup(rows, (row) => row.moduleTitle || null),
      byBatch: buildGroup(rows, (row) => (row.batch ? row.batch : null)),
      byDivision: buildGroup(rows, (row) => (row.division ? row.division : null)),
    },
    overdueAlerts: rows
      .filter((row) => row.overdue)
      .sort((a, b) => b.overdueDays - a.overdueDays || a.title.localeCompare(b.title)),
    rows,
  }
}

// ─── Document parsing ────────────────────────────────────────────────────────

function toEpoch(value: unknown): number | null {
  if (value instanceof admin.firestore.Timestamp) return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const converted = (value as { toDate: () => Date }).toDate()
    return converted instanceof Date ? converted.getTime() : null
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'number') return value
  return null
}

function parseDeadline(value: unknown): Date | null {
  const ms = toEpoch(value)
  return ms === null ? null : new Date(ms)
}

export function parseAnalyticsAssignment(id: string, data: admin.firestore.DocumentData): AnalyticsAssignment {
  const cohort = data.cohort && typeof data.cohort === 'object' ? (data.cohort as Record<string, unknown>) : {}
  const targetType = String(data.targetType || 'cohort') === 'specific' ? 'specific' : 'cohort'
  return {
    id,
    title: String(data.title || 'Untitled assignment'),
    status: String(data.status || 'published'),
    subject: String(data.subject || ''),
    subjectCode: String(data.subjectCode || ''),
    deadline: parseDeadline(data.deadline ?? data.dueDate),
    courseName: String(data.courseName || ''),
    moduleId: String(data.moduleId || ''),
    moduleTitle: String(data.moduleTitle || ''),
    targetType,
    cohort: {
      branch: String(cohort.branch || ''),
      batch: String(cohort.batch || ''),
      division: String(cohort.division || cohort.section || ''),
      semester: Number(cohort.semester) || 0,
    },
    studentIds: Array.isArray(data.studentIds) ? data.studentIds.map(String) : [],
  }
}

export function parseAnalyticsSubmission(id: string, data: admin.firestore.DocumentData): AnalyticsSubmission {
  return {
    id,
    assignmentId: String(data.assignmentId || ''),
    studentId: String(data.studentId || ''),
    status: String(data.status || 'pending'),
    submittedAt: toEpoch(data.submittedAt),
  }
}

export function parseAnalyticsStudent(id: string, data: admin.firestore.DocumentData): AnalyticsStudent {
  return {
    id,
    collegeId: String(data.collegeId || ''),
    branch: String(data.branch || data.department || ''),
    batch: String(data.batch || data.academicYear || ''),
    division: String(data.division || data.section || ''),
    semester: Number(data.semester) || 0,
  }
}

// ─── Callable ────────────────────────────────────────────────────────────────

const ANALYZED_STATUSES = ['published', 'ongoing', 'closed', 'graded']

/**
 * Staff-only completion report. Tenancy comes from the auth claim (never the
 * client): a faculty member is restricted to their own assignments, everyone
 * else in an academic role sees the whole college.
 */
export const getAssignmentAnalytics = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveAssignmentStaff(uid, request.auth?.token || {})
    await assertAssignmentsEnabled(staff.collegeId)
    const db = getFirestore(admin.app(), 'default')

    // Faculty see their own assignments; everyone else sees the college. Both
    // queries use indexes that already ship in firestore.indexes.json
    // (collegeId+facultyUid+createdAt / collegeId+status).
    const assignmentSnap =
      staff.role === 'faculty'
        ? await db
            .collection('assignments')
            .where('collegeId', '==', staff.collegeId)
            .where('facultyUid', '==', uid)
            .orderBy('createdAt', 'desc')
            .limit(500)
            .get()
        : await db
            .collection('assignments')
            .where('collegeId', '==', staff.collegeId)
            .where('status', 'in', ANALYZED_STATUSES)
            .limit(500)
            .get()

    const [submissionsSnap, studentsSnap] = await Promise.all([
      db.collection('submissions').where('collegeId', '==', staff.collegeId).limit(2000).get(),
      db.collection('students').where('collegeId', '==', staff.collegeId).limit(2000).get(),
    ])

    const assignments = assignmentSnap.docs.map((d) => parseAnalyticsAssignment(d.id, d.data()))
    const submissions = submissionsSnap.docs.map((d) => parseAnalyticsSubmission(d.id, d.data()))
    const students = studentsSnap.docs.map((d) => parseAnalyticsStudent(d.id, d.data()))

    const summary = buildAssignmentAnalytics(assignments, submissions, students, Date.now())

    logger.info('[AssignmentAnalytics] report generated', {
      collegeId: staff.collegeId,
      role: staff.role,
      assignments: summary.overall.assignments,
      overdue: summary.overall.overdue,
    })

    return {
      collegeId: staff.collegeId,
      scope: staff.role === 'faculty' ? 'own' : 'college',
      generatedAt: new Date().toISOString(),
      rosterSize: students.length,
      ...summary,
    }
  }
)
