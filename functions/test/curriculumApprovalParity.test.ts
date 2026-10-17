// Keeps the server (functions/src/curriculumApprovalRules.ts) and client
// (src/modules/admin/utils/curriculumApproval.ts) curriculum rules in step.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as server from '../src/curriculumApprovalRules'
import * as client from '../../src/modules/admin/utils/curriculumApproval'

const actors = [
  { uid: 'o', role: 'operations' }, { uid: 'a', role: 'admin' }, { uid: 'su', role: 'superadmin' },
  { uid: 'h', role: 'hod', department: 'CSE' }, { uid: 'p', role: 'principal' }, { uid: 'f', role: 'faculty' },
] as const
const fingerprints = [null, 'fp1', 'fp2'] as const
const records = [
  null,
  { collegeId: 'c', branch: 'CSE', semester: 3, reviewStatus: 'pending', version: 1 },
  { collegeId: 'c', branch: 'CSE', semester: 3, reviewStatus: 'approved', version: 1, verifiedFingerprint: 'fp1' },
  { collegeId: 'c', branch: 'CSE', semester: 3, reviewStatus: 'pending', version: 1, verifiedFingerprint: 'fp2' },
] as const

test('server and client curriculum rules agree on every case', () => {
  let compared = 0
  for (const actor of actors) {
    assert.equal(server.canVerifyCurriculum(actor).ok, client.canVerifyCurriculum(actor).ok, `verify ${actor.role}`)
    assert.equal(server.canReviewCurriculum(actor).ok, client.canReviewCurriculum(actor).ok, `review ${actor.role}`)
    compared += 2
    for (const rec of records) {
      for (const fp of fingerprints) {
        const s = server.curriculumGate(rec as never, fp, 'CSE', 3).ok
        const c = client.curriculumGate(rec as never, fp, 'CSE', 3).ok
        assert.equal(s, c, `gate ${rec?.verifiedFingerprint}/${fp}`)
        compared++
      }
    }
  }
  assert.ok(compared > 50)
  assert.equal(server.curriculumApprovalId('c1', 'Computer Science', 3), client.curriculumApprovalId('c1', 'Computer Science', 3))
})
