// functions/test/collegeModules.test.ts
// College-level optional module toggles — pure model contract tests.
// The Firestore-reading wrappers (readCollegeModuleSettings /
// assertAssignmentsEnabled) are exercised through these normalisers: the
// callable gate throws only when normalised settings say enabled === false.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLLEGE_MODULE_IDS,
  defaultCollegeModuleSettings,
  isCollegeModuleEnabled,
  normaliseCollegeModuleSettings,
} from '../src/collegeModules'

test('defaults: every optional module ships ON (missing config never disables a live module)', () => {
  const settings = defaultCollegeModuleSettings()
  for (const id of COLLEGE_MODULE_IDS) {
    assert.equal(settings[id].enabled, true, `${id} defaults to enabled`)
  }
})

test('normalise: missing or malformed documents yield the defaults', () => {
  for (const raw of [undefined, null, {}, { assignments: {} }, { assignments: 'nope' }, [1, 2], 'x']) {
    const settings = normaliseCollegeModuleSettings(raw)
    assert.equal(isCollegeModuleEnabled(settings, 'assignments'), true, String(raw))
  }
})

test('normalise: an explicit enabled:false is the ONLY off switch', () => {
  const off = normaliseCollegeModuleSettings({ assignments: { enabled: false } })
  assert.equal(isCollegeModuleEnabled(off, 'assignments'), false)

  const on = normaliseCollegeModuleSettings({ assignments: { enabled: true } })
  assert.equal(isCollegeModuleEnabled(on, 'assignments'), true)

  // Truthy/falsy lookalikes are not booleans and must fall back to the default.
  const lookalikes = normaliseCollegeModuleSettings({ assignments: { enabled: 'false' } })
  assert.equal(isCollegeModuleEnabled(lookalikes, 'assignments'), true)
})

test('normalise: unknown keys are ignored, known keys survive a merge', () => {
  const settings = normaliseCollegeModuleSettings({
    assignments: { enabled: false },
    futureModule: { enabled: true },
    updatedAt: 'whatever',
  })
  assert.deepEqual(Object.keys(settings), [...COLLEGE_MODULE_IDS])
  assert.equal(settings.assignments.enabled, false)
})

test('isCollegeModuleEnabled: null settings (read failure) fail open', () => {
  assert.equal(isCollegeModuleEnabled(null, 'assignments'), true)
  assert.equal(isCollegeModuleEnabled(undefined, 'assignments'), true)
})
