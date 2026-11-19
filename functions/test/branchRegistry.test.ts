// functions/test/branchRegistry.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_BRANCH_NAME_CHARS, nextBranchId, normaliseBranchName } from '../src/branchRegistry'

test('normaliseBranchName trims, collapses spaces and keeps the spelling', () => {
  assert.equal(normaliseBranchName('  B.Tech   CSE  '), 'B.Tech CSE')
  assert.equal(normaliseBranchName(null), '')
  assert.equal(normaliseBranchName(undefined), '')
  assert.equal(normaliseBranchName('x'.repeat(500)).length, MAX_BRANCH_NAME_CHARS)
})

test('nextBranchId counts up from the last issued ID', () => {
  assert.equal(nextBranchId(0), 1)
  assert.equal(nextBranchId(1), 2)
  assert.equal(nextBranchId(41), 42)
})

test('nextBranchId starts at 1 for a missing or corrupt counter', () => {
  assert.equal(nextBranchId(undefined), 1)
  assert.equal(nextBranchId('abc'), 1)
  assert.equal(nextBranchId(-3), 1)
  assert.equal(nextBranchId(2.5), 1)
})
