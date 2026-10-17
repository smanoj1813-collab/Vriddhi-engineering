import test from 'node:test'
import assert from 'node:assert/strict'
import { canCurriculumAction, curriculumApprovalId } from './curriculumApproval'

const rec = (status: 'draft' | 'submitted' | 'returned' | 'approved', submittedBy = 'adm') =>
  ({ collegeId: 'c1', branch: 'CSE', semester: 3, status, version: 1, submittedBy })

test('admin and the branch HOD can send a course list; other branches and principal cannot', () => {
  assert.equal(canCurriculumAction(null, 'submit', { uid: 'adm', role: 'admin' }, 'CSE').ok, true)
  assert.equal(canCurriculumAction(null, 'submit', { uid: 'h', role: 'hod', department: 'cse' }, 'CSE').ok, true)
  assert.equal(canCurriculumAction(null, 'submit', { uid: 'h', role: 'hod', department: 'ECE' }, 'CSE').ok, false)
  assert.equal(canCurriculumAction(null, 'submit', { uid: 'p', role: 'principal' }, 'CSE').ok, false)
})

test('a list already waiting for the principal cannot be sent again', () => {
  assert.equal(canCurriculumAction(rec('submitted'), 'submit', { uid: 'adm', role: 'admin' }, 'CSE').ok, false)
  assert.equal(canCurriculumAction(rec('returned'), 'submit', { uid: 'adm', role: 'admin' }, 'CSE').ok, true)
})

test('only the principal approves or returns, and never their own submission', () => {
  assert.equal(canCurriculumAction(rec('submitted'), 'approve', { uid: 'p', role: 'principal' }, 'CSE').ok, true)
  assert.equal(canCurriculumAction(rec('submitted'), 'return', { uid: 'p', role: 'principal' }, 'CSE').ok, true)
  assert.equal(canCurriculumAction(rec('submitted'), 'approve', { uid: 'h', role: 'hod', department: 'CSE' }, 'CSE').ok, false)
  assert.equal(canCurriculumAction(rec('submitted', 'p'), 'approve', { uid: 'p', role: 'principal' }, 'CSE').ok, false)
})

test('approval needs a submitted list', () => {
  assert.equal(canCurriculumAction(rec('draft'), 'approve', { uid: 'p', role: 'principal' }, 'CSE').ok, false)
  assert.equal(canCurriculumAction(null, 'approve', { uid: 'p', role: 'principal' }, 'CSE').ok, false)
})

test('approval id is stable across spellings of the branch', () => {
  assert.equal(curriculumApprovalId('c1', 'Computer  Science', 3), curriculumApprovalId('c1', 'computer science', 3))
  assert.notEqual(curriculumApprovalId('c1', 'CSE', 3), curriculumApprovalId('c1', 'CSE', 4))
})
