// Client API for curriculum course-list approval and the schedule audit trail.
// Approval writes go through callables (the server enforces the workflow).
// Reads use scoped queries that firestore.rules allow.

import { addDoc, collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/Firebase/config'
import type { CurriculumApprovalStatus } from '../utils/curriculumApproval'

export interface CurriculumScope {
  branch: string
  semester: number
  /** Active course-list documents for this branch and semester. */
  listCount: number
  courseCount: number
}

export interface CurriculumApprovalRow {
  id: string
  collegeId: string
  branch: string
  semester: number
  status: CurriculumApprovalStatus
  version: number
  courseCount?: number
  submittedBy?: string
  submittedAt?: string
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
  approvedBy?: string
  approvedAt?: string
}

export const callSubmitCurriculumForApproval = (input: { collegeId: string; branch: string; semester: number }) =>
  httpsCallable<typeof input, { ok: boolean; approvalId: string; version: number; courseCount: number }>(
    functions, 'submitCurriculumForApproval',
  )(input).then(r => r.data)

export const callReviewCurriculumApproval = (input: {
  collegeId: string
  branch: string
  semester: number
  decision: 'approve' | 'return'
  note?: string
}) => httpsCallable<typeof input, { ok: boolean; status: string }>(functions, 'reviewCurriculumApproval')(input).then(r => r.data)

/** Branch and semester pairs that have active course lists, with their size. */
export async function listCurriculumScopes(collegeId: string): Promise<CurriculumScope[]> {
  const snap = await getDocs(query(collection(db, 'curriculum'), where('collegeId', '==', collegeId)))
  const byKey = new Map<string, CurriculumScope>()
  for (const d of snap.docs) {
    const x = d.data()
    if ((x.status ?? 'active') !== 'active') continue
    const branch = String(x.branch ?? '').trim()
    const semester = Number(x.semester)
    if (!branch || !Number.isInteger(semester)) continue
    const key = `${branch.toLowerCase()}|${semester}`
    const courses = Array.isArray(x.courses) ? x.courses.length : Number(x.totalCourses) || 0
    const row = byKey.get(key) ?? { branch, semester, listCount: 0, courseCount: 0 }
    row.listCount += 1
    row.courseCount += courses
    byKey.set(key, row)
  }
  return [...byKey.values()].sort((a, b) => a.branch.localeCompare(b.branch) || a.semester - b.semester)
}

export async function listCurriculumApprovals(collegeId: string): Promise<CurriculumApprovalRow[]> {
  const snap = await getDocs(query(collection(db, 'curriculumApprovals'), where('collegeId', '==', collegeId)))
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<CurriculumApprovalRow, 'id'>) }))
}

// ─── Schedule audit trail (direct live edits by admin) ───

export interface ScheduleAuditEntry {
  id: string
  collegeId: string
  actorUid: string
  actorName: string
  actorRole: string
  action: 'create' | 'update' | 'deactivate' | 'delete' | 'bulk-create'
  summary: string
  branch: string
  semester: number
  /** ISO time, set by the client when the edit was saved. */
  at: string
}

export async function writeScheduleAudit(entry: Omit<ScheduleAuditEntry, 'id'>): Promise<void> {
  await addDoc(collection(db, 'scheduleAuditLog'), entry)
}

/** Most recent direct edits. Sorted in the client so no composite index is needed. */
export async function listScheduleAudit(collegeId: string, limit = 50): Promise<ScheduleAuditEntry[]> {
  const snap = await getDocs(query(collection(db, 'scheduleAuditLog'), where('collegeId', '==', collegeId)))
  return snap.docs
    .map(d => ({ id: d.id, ...(d.data() as Omit<ScheduleAuditEntry, 'id'>) }))
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
    .slice(0, limit)
}
