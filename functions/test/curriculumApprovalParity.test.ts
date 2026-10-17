// Keeps the server (functions/src/curriculumApprovalRules.ts) and client
// (src/modules/admin/utils/curriculumApproval.ts) curriculum approval rules in step.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as server from '../src/curriculumApprovalRules'
import * as client from '../../src/modules/admin/utils/curriculumApproval'

const statuses = [null, 'draft', 'submitted', 'returned', 'approved'] as const
const actions = ['submit', 'approve', 'return'] as const
const branches = ['CSE', 'ece']
const actors = [
  { uid: 'adm', role: 'admin' },
  { uid: 'su', role: 'superadmin' },
  { uid: 'hod1', role: 'hod', department: 'CSE' },
  { uid: 'hod2', role: 'hod', department: 'Mechanical' },
  { uid: 'hodNoDept', role: 'hod' },
  { uid: 'p1', role: 'principal' },
  { uid: 'ops1', role: 'operations' },
  { uid: 'f1', role: 'faculty' },
] as const

test('server and client curriculum approval rules agree on every case', () => {
  let compared = 0
  for (const status of statuses) {
    for (const action of actions) {
      for (const actor of actors) {
        for (const branch of branches) {
          for (const submittedBy of [undefined, 'adm', actor.uid, 'someone-else']) {
            const rec = status ? { collegeId: 'c', branch: 'CSE', semester: 3, status, version: 1, submittedBy } : null
            const s = server.canCurriculumAction(rec, action, actor, branch)
            const c = client.canCurriculumAction(rec, action, actor, branch)
            assert.equal(s.ok, c.ok, `${status}/${action}/${actor.role}/${branch}/${submittedBy}`)
            compared++
          }
        }
      }
    }
  }
  assert.ok(compared > 500)
  assert.equal(server.curriculumApprovalId('c1', 'Computer Science', 3), client.curriculumApprovalId('c1', 'Computer Science', 3))
})
