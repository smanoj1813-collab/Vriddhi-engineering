import test from 'node:test'
import assert from 'node:assert/strict'
import { usesPlainExamSetup } from './paperGeneratorView'

test('employees get the plain exam setup; other roles keep the scheme generator', () => {
  assert.equal(usesPlainExamSetup('employee'), true)
  assert.equal(usesPlainExamSetup('admin'), false)
  assert.equal(usesPlainExamSetup('principal'), false)
  assert.equal(usesPlainExamSetup('hod'), false)
  assert.equal(usesPlainExamSetup(undefined), false)
  assert.equal(usesPlainExamSetup(null), false)
})
