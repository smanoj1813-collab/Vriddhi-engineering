import test from 'node:test'
import assert from 'node:assert/strict'
import { canReviewCurriculum, canVerifyCurriculum, curriculumApprovalId, curriculumGate } from './curriculumApproval'

const rec = (over: Record<string, unknown> = {}) => ({
  collegeId: 'c1', branch: 'CSE', semester: 3, reviewStatus: 'pending' as const, version: 1, ...over,
}) as Parameters<typeof curriculumGate>[0]

test('operations, admin and superadmin can verify; HOD and principal cannot', () => {
  assert.equal(canVerifyCurriculum({ uid: 'o', role: 'operations' }).ok, true)
  assert.equal(canVerifyCurriculum({ uid: 'a', role: 'admin' }).ok, true)
  assert.equal(canVerifyCurriculum({ uid: 'h', role: 'hod', department: 'CSE' }).ok, false)
  assert.equal(canVerifyCurriculum({ uid: 'p', role: 'principal' }).ok, false)
})

test('only the principal reviews', () => {
  assert.equal(canReviewCurriculum({ uid: 'p', role: 'principal' }).ok, true)
  assert.equal(canReviewCurriculum({ uid: 'o', role: 'operations' }).ok, false)
  assert.equal(canReviewCurriculum({ uid: 'a', role: 'admin' }).ok, false)
})

test('scheduling is blocked until the list is verified, and again after it changes', () => {
  assert.equal(curriculumGate(null, null, 'CSE', 3).ok, false)
  assert.equal(curriculumGate(null, 'fp1', 'CSE', 3).ok, false)
  assert.equal(curriculumGate(rec(), 'fp1', 'CSE', 3).ok, false)
  assert.equal(curriculumGate(rec({ verifiedFingerprint: 'fp1' }), 'fp1', 'CSE', 3).ok, true)
  assert.equal(curriculumGate(rec({ verifiedFingerprint: 'fp1' }), 'fp2', 'CSE', 3).ok, false)
})

test('the principal sign-off does not gate scheduling', () => {
  const approved = rec({ verifiedFingerprint: 'fp1', reviewStatus: 'approved', reviewFingerprint: 'fp1' })
  const pending = rec({ verifiedFingerprint: 'fp1' })
  assert.equal(curriculumGate(approved, 'fp1', 'CSE', 3).ok, true)
  assert.equal(curriculumGate(pending, 'fp1', 'CSE', 3).ok, true)
})

test('approval id is stable across spellings of the branch', () => {
  assert.equal(curriculumApprovalId('c1', 'Computer  Science', 3), curriculumApprovalId('c1', 'computer science', 3))
  assert.notEqual(curriculumApprovalId('c1', 'CSE', 3), curriculumApprovalId('c1', 'CSE', 4))
})
