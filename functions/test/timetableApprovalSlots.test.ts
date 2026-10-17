import test from 'node:test'
import assert from 'node:assert/strict'
import { pickSlotFields } from '../src/timetableApprovalRules'

test('pickSlotFields keeps timetable fields and drops client-only or system data', () => {
  const picked = pickSlotFields({
    subject: 'Maths',
    facultyId: 'f1',
    facultyName: 'Asha',
    branch: 'CSE',
    semester: 3,
    assignment: { title: 'HW1', maxScore: 10, deadline: '2026-11-01' },
    isActive: false,
    collegeId: 'other-college',
    approvalId: 'x',
    createdAt: 'then',
    randomClientField: 'nope',
  })
  assert.deepEqual(Object.keys(picked).sort(), ['assignment', 'branch', 'facultyId', 'facultyName', 'semester', 'subject'])
  assert.equal(picked.branch, 'CSE')
})

test('pickSlotFields keeps an explicit null assignment (clears it on the live slot) and skips undefined', () => {
  const picked = pickSlotFields({ subject: 'Maths', assignment: null, room: undefined })
  assert.equal(picked.assignment, null)
  assert.equal('room' in picked, false)
})
