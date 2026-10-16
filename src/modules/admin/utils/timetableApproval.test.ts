import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyTimetableAction,
  canTimetableAction,
  isLiveEligible,
  legacyApprovedRecord,
  normaliseBranch,
  timetableApprovalId,
  type TimetableActor,
  type TimetableApprovalRecord,
} from './timetableApproval'

const ops: TimetableActor = { uid: 'ops1', role: 'operations' }
const hodCse: TimetableActor = { uid: 'hod1', role: 'hod', department: 'CSE' }
const hodEce: TimetableActor = { uid: 'hod2', role: 'hod', department: 'ECE' }
const principal: TimetableActor = { uid: 'p1', role: 'principal' }
const at = '2026-10-16T10:00:00Z'
const base = { collegeId: 'c1', branch: 'CSE', semester: 3 }

const submitted = (): TimetableApprovalRecord => ({
  ...base, status: 'submitted', version: 1, submittedBy: 'ops1', submittedAt: at,
})

test('only operations can submit, and only from draft or returned', () => {
  assert.equal(canTimetableAction(null, 'submit', ops).ok, true)
  assert.equal(canTimetableAction(null, 'submit', hodCse).ok, false)
  assert.equal(canTimetableAction(null, 'submit', principal).ok, false)
  assert.equal(canTimetableAction(submitted(), 'submit', ops).ok, false)
  const returned: TimetableApprovalRecord = { ...submitted(), status: 'returned' }
  assert.equal(canTimetableAction(returned, 'submit', ops).ok, true)
})

test('a submitted timetable is locked for editing', () => {
  assert.equal(canTimetableAction(submitted(), 'edit', ops).ok, false)
  const returned: TimetableApprovalRecord = { ...submitted(), status: 'returned' }
  assert.equal(canTimetableAction(returned, 'edit', ops).ok, true)
  assert.equal(canTimetableAction(null, 'edit', ops).ok, true)
})

test('the HOD of the matching branch can approve', () => {
  assert.equal(canTimetableAction(submitted(), 'approve', hodCse).ok, true)
  assert.equal(canTimetableAction(submitted(), 'return', hodCse).ok, true)
})

test('a HOD of another branch cannot approve', () => {
  const r = canTimetableAction(submitted(), 'approve', hodEce)
  assert.equal(r.ok, false)
})

test('operations cannot approve their own submission', () => {
  const opsAsHod: TimetableActor = { uid: 'ops1', role: 'hod', department: 'CSE' }
  assert.equal(canTimetableAction(submitted(), 'approve', opsAsHod).ok, false)
})

test('operations cannot approve even if they are not the submitter', () => {
  const otherOps: TimetableActor = { uid: 'ops2', role: 'operations' }
  assert.equal(canTimetableAction(submitted(), 'approve', otherOps).ok, false)
})

test('principal needs a fallback reason to approve', () => {
  assert.equal(canTimetableAction(submitted(), 'approve', principal).ok, false)
  assert.equal(canTimetableAction(submitted(), 'approve', principal, { fallbackReason: 'hod' }).ok, false)
  assert.equal(
    canTimetableAction(submitted(), 'approve', principal, { fallbackReason: 'HOD on leave, no delegate' }).ok,
    true,
  )
})

test('approve and return need a submitted record', () => {
  assert.equal(canTimetableAction(null, 'approve', hodCse).ok, false)
  const draft: TimetableApprovalRecord = { ...base, status: 'draft', version: 0 }
  assert.equal(canTimetableAction(draft, 'approve', hodCse).ok, false)
})

test('submit increments the version and records the submitter', () => {
  const r = applyTimetableAction(null, 'submit', ops, at, { ...base, collegeId: 'c1', branch: 'CSE', semester: 3 })
  assert.equal(r.status, 'submitted')
  assert.equal(r.version, 1)
  assert.equal(r.submittedBy, 'ops1')
})

test('approve by principal records the fallback reason', () => {
  const r = applyTimetableAction(submitted(), 'approve', principal, at, {
    ...base, fallbackReason: '  HOD on leave  ', note: 'ok',
  })
  assert.equal(r.status, 'approved')
  assert.equal(r.reviewedBy, 'p1')
  assert.equal(r.fallbackReason, 'HOD on leave')
  assert.equal(r.reviewNote, 'ok')
})

test('HOD approval carries no fallback reason', () => {
  const r = applyTimetableAction(submitted(), 'approve', hodCse, at, { ...base, fallbackReason: 'x' })
  assert.equal(r.fallbackReason, undefined)
})

test('return keeps the version so ops can resubmit as the next version', () => {
  const ret = applyTimetableAction(submitted(), 'return', hodCse, at, { ...base, note: 'Lab clash on Tue' })
  assert.equal(ret.status, 'returned')
  assert.equal(ret.version, 1)
  const again = applyTimetableAction(ret, 'submit', ops, at, base)
  assert.equal(again.version, 2)
  assert.equal(again.reviewNote, undefined)
})

test('only approved timetables are live-eligible', () => {
  assert.equal(isLiveEligible(null), false)
  assert.equal(isLiveEligible(submitted()), false)
  assert.equal(isLiveEligible(legacyApprovedRecord('c1', 'CSE', 3, at)), true)
})

test('legacy cut-over marks existing timetables approved', () => {
  const r = legacyApprovedRecord('c1', 'CSE', 3, at)
  assert.equal(r.legacyCutover, true)
  assert.equal(r.status, 'approved')
})

test('branch names match regardless of case and spacing', () => {
  assert.equal(normaliseBranch('  Computer   Science '), 'computer science')
  const hod: TimetableActor = { uid: 'h', role: 'hod', department: 'computer  science' }
  const rec = { ...submitted(), branch: 'Computer Science' }
  assert.equal(canTimetableAction(rec, 'approve', hod).ok, true)
})

test('an HOD with no department cannot approve', () => {
  const hod: TimetableActor = { uid: 'h', role: 'hod' }
  assert.equal(canTimetableAction(submitted(), 'approve', hod).ok, false)
})

test('approval doc id is stable and safe for Firestore', () => {
  assert.equal(timetableApprovalId('c1', 'Computer Science', 3), 'c1__computer-science__sem3')
  assert.equal(timetableApprovalId('c1', 'CSE', 3), timetableApprovalId('c1', ' cse ', 3))
})
