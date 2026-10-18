// Keeps the server rules (functions/src/timetableApprovalRules.ts) and the
// client rules (src/modules/admin/utils/timetableApproval.ts) in step: every
// combination of record status, action, actor and fallback reason must give
// the same decision on both sides.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as server from '../src/timetableApprovalRules'
import * as client from '../../src/modules/admin/utils/timetableApproval'

const statuses = [null, 'draft', 'submitted', 'returned', 'approved'] as const
const actions = ['edit', 'submit', 'approve', 'return'] as const
const actors = [
  { uid: 'ops1', role: 'operations' },
  { uid: 'ops2', role: 'operations' },
  { uid: 'su', role: 'superadmin' },
  { uid: 'hod1', role: 'hod', department: 'CSE' },
  { uid: 'hod2', role: 'hod', department: 'ECE' },
  { uid: 'hodNoDept', role: 'hod' },
  { uid: 'p1', role: 'principal' },
  { uid: 'f1', role: 'faculty' },
  { uid: 'ops1', role: 'hod', department: 'CSE' },
]
const reasons = [undefined, '', 'short', 'HOD on leave, no delegate']

test('server and client timetable rules agree on every case', () => {
  let compared = 0
  for (const status of statuses) {
    for (const action of actions) {
      for (const actor of actors) {
        for (const fallbackReason of reasons) {
          const base = { collegeId: 'c1', branch: 'CSE', semester: 3 }
          const record = status === null ? null : {
            ...base, status, version: 1, submittedBy: 'ops1',
          }
          const s = server.canTimetableAction(record as server.ApprovalRecord | null, action, actor, { fallbackReason })
          const c = client.canTimetableAction(record as client.TimetableApprovalRecord | null, action, actor, { fallbackReason })
          assert.deepEqual(s, c, `status=${status} action=${action} actor=${JSON.stringify(actor)} reason=${fallbackReason}`)
          compared++
        }
      }
    }
  }
  assert.equal(compared, statuses.length * actions.length * actors.length * reasons.length)
})

test('approval ids are identical on both sides', () => {
  for (const branch of ['CSE', ' Computer  Science ', 'B.E. (ECE)']) {
    assert.equal(server.timetableApprovalId('c1', branch, 4), client.timetableApprovalId('c1', branch, 4))
  }
})
