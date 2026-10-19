import test from 'node:test'
import assert from 'node:assert/strict'
import { employeeGrantAllows } from '../src/employeeGrants'
import { canTimetableAction, type ApprovalRecord, type ApprovalActor } from '../src/timetableApprovalRules'
import { canVerifyCurriculum, canReviewCurriculum, type CurriculumActor } from '../src/curriculumApprovalRules'

const active = { status: 'active', grants: ['schedule', 'curriculum'], activeCollegeId: 'college-a' }

test('a grant is honoured only for the active college', () => {
  assert.equal(employeeGrantAllows(active, 'college-a', 'schedule'), true)
  assert.equal(employeeGrantAllows(active, 'college-b', 'schedule'), false)
})

test('a missing grant is refused', () => {
  assert.equal(employeeGrantAllows(active, 'college-a', 'papers'), false)
  assert.equal(employeeGrantAllows({ ...active, grants: [] }, 'college-a', 'schedule'), false)
})

test('suspended or unassigned employees hold no grant', () => {
  assert.equal(employeeGrantAllows({ ...active, status: 'suspended' }, 'college-a', 'schedule'), false)
  assert.equal(employeeGrantAllows(null, 'college-a', 'schedule'), false)
  assert.equal(employeeGrantAllows({ ...active, activeCollegeId: null }, 'college-a', 'schedule'), false)
  assert.equal(employeeGrantAllows(active, '', 'schedule'), false)
})

test('malformed grants do not grant access', () => {
  assert.equal(employeeGrantAllows({ ...active, grants: 'schedule' }, 'college-a', 'schedule'), false)
})

const employee: ApprovalActor = { uid: 'emp-1', role: 'employee', department: '' }
const draft: ApprovalRecord = { collegeId: 'college-a', branch: 'CSE', semester: 3, status: 'draft', version: 0 }
const submittedByOps: ApprovalRecord = { ...draft, status: 'submitted', submittedBy: 'ops-1' }

test('an employee edits and submits drafts like operations', () => {
  assert.equal(canTimetableAction(draft, 'edit', employee).ok, true)
  assert.equal(canTimetableAction(draft, 'submit', employee).ok, true)
})

test('an employee cannot approve or return a timetable', () => {
  assert.equal(canTimetableAction(submittedByOps, 'approve', employee).ok, false)
  assert.equal(canTimetableAction(submittedByOps, 'return', employee).ok, false)
})

test('an employee verifies the course list but cannot approve it', () => {
  const actor = { uid: 'emp-1', role: 'employee', department: '', collegeId: 'college-a' } as unknown as CurriculumActor
  assert.equal(canVerifyCurriculum(actor).ok, true)
  assert.equal(canReviewCurriculum(actor).ok, false)
})
