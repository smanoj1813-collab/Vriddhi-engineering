// src/modules/admin/api/academicInsightsApi.ts
//
// Client wrapper for the getAcademicInsights callable. Translates callable
// errors into admin-facing copy via describeSessionError so session-expiry and
// permission issues read as plain English.

import { httpsCallable } from 'firebase/functions'
import { functions } from '@/Firebase/config'
import {
  describeSessionError,
  SESSION_WRITER_MESSAGES,
} from '@/shared/utils/sessionErrorMessage'

export interface AcademicInsightsInput {
  collegeId?: string
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
  sessionsTotal: number
  sessionsCompleted: number
  sessionsScheduled: number
  sessionsCancelled: number
  hoursDelivered: number
  attendancePct: number
  attendanceMarked: number
  attendancePresent: number
  assignmentsTotal: number
  submissionsExpected: number
  submissionsSubmitted: number
  submissionsLate: number
  submissionsGraded: number
  submissionsMissing: number
  completionPct: number
  avgScore: number | null
  scoredCount: number
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
  semesters: SemesterInsight[]
  /** Capped collections that hit their read limit; numbers may be incomplete when non-empty. */
  truncated: string[]
  subject?: SubjectInsight & {
    assessmentDetail: AssessmentDetail[]
    attendanceTrend: AttendanceTrendPoint[]
    students: StudentInsight[]
  }
}

/**
 * Load academic insights. Input filters are all optional; server pins
 * non-superadmins to their own college. Without `curriculumId`, returns
 * overview (semester rollups). With `curriculumId`, returns subject drill
 * (assessments + attendance trend + ranked students).
 *
 * Cost: ≤ 40 reads on overview, ≤ 20 on subject drill (per-invocation
 * ceiling asserted by functions/test/costControls.test.ts). No polling —
 * caller loads on mount / explicit Refresh / successful write (C7).
 */
export async function getAcademicInsights(
  input: AcademicInsightsInput = {},
): Promise<AcademicInsightsResult> {
  const call = httpsCallable<Record<string, unknown>, AcademicInsightsResult>(
    functions,
    'getAcademicInsights'
  )
  try {
    const response = await call({
      ...(input.collegeId ? { collegeId: input.collegeId } : {}),
      ...(input.semester !== undefined ? { semester: input.semester } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.batch ? { batch: input.batch } : {}),
      ...(input.facultyId ? { facultyId: input.facultyId } : {}),
      ...(input.curriculumId ? { curriculumId: input.curriculumId } : {}),
      ...(input.courseId ? { courseId: input.courseId } : {}),
      ...(input.courseCode ? { courseCode: input.courseCode } : {}),
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
    })
    return response.data
  } catch (error) {
    throw new Error(
      describeSessionError(
        error,
        'Academic insights could not be loaded.',
        SESSION_WRITER_MESSAGES,
      )
    )
  }
}
