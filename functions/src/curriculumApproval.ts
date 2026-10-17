// Curriculum course-list callables.
//
//   verifyCurriculumList        operations, admin or superadmin: confirm the active
//                               course list for a branch and semester. Timetable
//                               writes are blocked until it is verified.
//   reviewCurriculumApproval    principal: approve or return (sign-off, not a gate).
//
// requireVerifiedCurriculum() is called by the timetable callables before they
// write drafts or send to the HOD.
// Client writes to `curriculumApprovals` are denied by firestore.rules.

import * as admin from 'firebase-admin'
import { createHash } from 'node:crypto'
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  canReviewCurriculum,
  canVerifyCurriculum,
  curriculumApprovalId,
  curriculumGate,
  normaliseCurriculumBranch,
  type CurriculumActor,
  type CurriculumApprovalRecord,
} from './curriculumApprovalRules'

const APPROVALS = 'curriculumApprovals'
const CURRICULUM = 'curriculum'
const STAFF_ROLES = ['operations', 'admin', 'principal', 'superadmin']
const OPTS = { region: 'asia-south1', memory: '256MiB' as const, timeoutSeconds: 60, minInstances: 0, maxInstances: 5 }

function db() {
  return getFirestore(admin.app(), 'default')
}

function fail(code: 'invalid-argument' | 'permission-denied' | 'failed-precondition' | 'not-found', message: string): never {
  throw new HttpsError(code, message)
}

async function staffFor(uid: string, token: Record<string, unknown>) {
  const userDoc = await db().collection('users').doc(uid).get()
  const user = userDoc.data()
  const role = String(token.role || user?.role || '')
  const claimCollege = String(token.collegeId || user?.collegeId || '')
  if (!userDoc.exists || !STAFF_ROLES.includes(role)) fail('permission-denied', 'Operations, admin or principal access is required')
  if (role !== 'superadmin' && !claimCollege) fail('permission-denied', 'Your account is not linked to a college')
  return { uid, role, department: String(token.department || user?.department || ''), collegeId: claimCollege }
}

function requireCollege(actor: { role: string; collegeId: string }, requested: unknown): string {
  const requestedId = String(requested || '').trim()
  if (actor.role === 'superadmin') {
    if (!requestedId) fail('invalid-argument', 'collegeId is required')
    return requestedId
  }
  if (requestedId && requestedId !== actor.collegeId) fail('permission-denied', 'That course list belongs to another college')
  return actor.collegeId
}

function requireScope(raw: Record<string, unknown>) {
  const branch = String(raw.branch || '').trim().replace(/\s+/g, ' ')
  const semester = Number(raw.semester)
  if (!branch) fail('invalid-argument', 'branch is required')
  if (!Number.isInteger(semester) || semester < 1 || semester > 8) fail('invalid-argument', 'semester must be 1 to 8')
  return { branch, semester }
}

/** The active course-list documents for one college, branch and semester. */
async function activeCourseLists(collegeId: string, branch: string, semester: number): Promise<QueryDocumentSnapshot[]> {
  const snap = await db().collection(CURRICULUM)
    .where('collegeId', '==', collegeId)
    .where('branch', '==', branch)
    .where('semester', '==', semester)
    .get()
  return snap.docs.filter(d => (d.data().status ?? 'active') === 'active')
}

/** Stable hash of the course lists: changes when any course changes. */
function fingerprintOf(docs: QueryDocumentSnapshot[]): { fingerprint: string; courseCount: number; ids: string[] } {
  const sorted = [...docs].sort((a, b) => a.id.localeCompare(b.id))
  const payload = sorted.map(d => ({ id: d.id, courses: d.data().courses ?? [] }))
  const courseCount = sorted.reduce((n, d) => n + (Array.isArray(d.data().courses) ? d.data().courses.length : 0), 0)
  return {
    fingerprint: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    courseCount,
    ids: sorted.map(d => d.id),
  }
}

async function loadRecord(id: string): Promise<CurriculumApprovalRecord | null> {
  const snap = await db().collection(APPROVALS).doc(id).get()
  return snap.exists ? (snap.data() as CurriculumApprovalRecord) : null
}

/**
 * Throws unless the course list for this branch and semester is verified and
 * unchanged since. Called by the timetable callables before any draft write.
 */
export async function requireVerifiedCurriculum(collegeId: string, branch: string, semester: number): Promise<void> {
  const id = curriculumApprovalId(collegeId, branch, semester)
  const record = await loadRecord(id)
  const docs = await activeCourseLists(collegeId, branch, semester)
  const current = docs.length ? fingerprintOf(docs).fingerprint : null
  const check = curriculumGate(record, current, branch, semester)
  if (!check.ok) fail('failed-precondition', check.reason)
}

export const verifyCurriculumList = onCall(OPTS, async (request) => {
  const uid = request.auth?.uid
  if (!uid) fail('permission-denied', 'Authentication is required')
  const actor = await staffFor(uid, request.auth?.token || {})
  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = requireCollege(actor, raw.collegeId)
  const { branch, semester } = requireScope(raw)
  const check = canVerifyCurriculum(actor as CurriculumActor)
  if (!check.ok) fail('permission-denied', check.reason)

  const docs = await activeCourseLists(collegeId, branch, semester)
  if (docs.length === 0) fail('failed-precondition', 'There is no course list for this branch and semester yet. The superadmin assigns it first.')
  const { fingerprint, courseCount, ids } = fingerprintOf(docs)

  const id = curriculumApprovalId(collegeId, branch, semester)
  const record = await loadRecord(id)
  const at = new Date().toISOString()
  // A principal approval holds only for the content it reviewed. Otherwise the
  // review goes back to pending.
  const keepReview = record?.reviewStatus === 'approved' && record.reviewFingerprint === fingerprint
  await db().collection(APPROVALS).doc(id).set({
    collegeId,
    branch,
    branchKey: normaliseCurriculumBranch(branch),
    semester,
    verifiedFingerprint: fingerprint,
    verifiedBy: uid,
    verifiedAt: at,
    courseCount,
    curriculumIds: ids,
    reviewStatus: keepReview ? 'approved' : 'pending',
    version: (record?.version ?? 0) + 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  return { ok: true, approvalId: id, courseCount, reviewKept: keepReview }
})

export const reviewCurriculumApproval = onCall(OPTS, async (request) => {
  const uid = request.auth?.uid
  if (!uid) fail('permission-denied', 'Authentication is required')
  const actor = await staffFor(uid, request.auth?.token || {})
  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = requireCollege(actor, raw.collegeId)
  const { branch, semester } = requireScope(raw)
  const decision = String(raw.decision || '')
  if (decision !== 'approve' && decision !== 'return') fail('invalid-argument', 'decision must be approve or return')
  const action = decision as 'approve' | 'return'
  const note = String(raw.note || '').trim().slice(0, 500)
  if (action === 'return' && note.length < 3) fail('invalid-argument', 'Give a reason when returning a course list')
  const check = canReviewCurriculum(actor as CurriculumActor)
  if (!check.ok) fail('permission-denied', check.reason)

  const docs = await activeCourseLists(collegeId, branch, semester)
  if (docs.length === 0) fail('failed-precondition', 'There is no course list for this branch and semester yet.')
  const { fingerprint } = fingerprintOf(docs)

  const id = curriculumApprovalId(collegeId, branch, semester)
  const record = await loadRecord(id)
  const at = new Date().toISOString()
  const reviewStatus = action === 'approve' ? 'approved' : 'returned'
  await db().collection(APPROVALS).doc(id).set({
    collegeId,
    branch,
    branchKey: normaliseCurriculumBranch(branch),
    semester,
    reviewStatus,
    reviewedBy: uid,
    reviewedAt: at,
    reviewNote: note,
    ...(action === 'approve' ? { reviewFingerprint: fingerprint } : {}),
    version: (record?.version ?? 0),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  return { ok: true, status: reviewStatus }
})
