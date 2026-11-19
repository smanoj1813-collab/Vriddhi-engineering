// functions/test/branchIds.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveBranchToken,
  resolveBranchTokens,
  toRegistryBranch,
  unknownBranchMessage,
  type RegistryBranch,
} from '../src/branchIds'

const registry: RegistryBranch[] = [
  { branchId: 1, name: 'CSE' },
  { branchId: 2, name: 'ECE' },
  { branchId: 3, name: 'BCA (Regular)' },
  { branchId: 4, name: 'BCA (Cloud & Cyber Security)' },
]

test('an ID resolves to the registry name', () => {
  assert.deepEqual(resolveBranchToken('1', registry), { branchId: 1, name: 'CSE' })
  assert.deepEqual(resolveBranchToken(' 2 ', registry), { branchId: 2, name: 'ECE' })
})

test('an unknown ID does not resolve', () => {
  assert.equal(resolveBranchToken('99', registry), null)
})

test('a name resolves by branchKey and keeps the typed spelling', () => {
  assert.deepEqual(resolveBranchToken('B.Tech (CSE)', registry), { branchId: 1, name: 'B.Tech (CSE)' })
  assert.deepEqual(resolveBranchToken('ece', registry), { branchId: 2, name: 'ece' })
})

test('BCA specialisations resolve to their own IDs', () => {
  assert.equal(resolveBranchToken('BCA (Regular)', registry)?.branchId, 3)
  assert.equal(resolveBranchToken('BCA (Cloud & Cyber Security)', registry)?.branchId, 4)
})

test('blank tokens resolve to nothing', () => {
  assert.equal(resolveBranchToken('   ', registry), null)
})

test('resolveBranchTokens collects unmatched values and keeps the first spelling per branch', () => {
  const out = resolveBranchTokens(['CSE', 'B.E (CSE)', '2', 'Mechanical', '', '77'], registry)
  assert.deepEqual(out.resolved, [
    { branchId: 1, name: 'CSE' },
    { branchId: 2, name: 'ECE' },
  ])
  assert.deepEqual(out.unmatched, ['Mechanical', '77'])
})

test('unknownBranchMessage names the values and points at the registry', () => {
  assert.match(unknownBranchMessage(['Mechanical']), /Unknown branch: Mechanical\. Add it on the Branches page/)
  assert.match(unknownBranchMessage(['A', 'B']), /Unknown branches: A, B\. Add them/)
})

test('toRegistryBranch rejects bad documents', () => {
  assert.deepEqual(toRegistryBranch({ branchId: 5, name: ' EEE ' }), { branchId: 5, name: 'EEE' })
  assert.deepEqual(toRegistryBranch({ name: 'EEE' }, '6'), { branchId: 6, name: 'EEE' })
  assert.equal(toRegistryBranch({ branchId: 0, name: 'EEE' }), null)
  assert.equal(toRegistryBranch({ branchId: 7, name: '' }), null)
})
