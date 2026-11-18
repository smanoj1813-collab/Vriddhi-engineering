// src/shared/utils/branchRegistry.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  branchLabel,
  findRegistryBranch,
  registryIdsFor,
  sortRegistry,
  toRegistryEntry,
  type BranchRegistryEntry,
} from './branchRegistry'

const registry: BranchRegistryEntry[] = [
  { branchId: 2, name: 'ECE' },
  { branchId: 1, name: 'CSE' },
  { branchId: 3, name: 'BCA (Regular)' },
  { branchId: 4, name: 'BCA (Cloud & Cyber Security)' },
]

test('toRegistryEntry reads valid documents and rejects bad ones', () => {
  assert.deepEqual(toRegistryEntry({ branchId: 7, name: ' ECE ' }), { branchId: 7, name: 'ECE' })
  assert.deepEqual(toRegistryEntry({ name: 'ECE' }, '8'), { branchId: 8, name: 'ECE' })
  assert.equal(toRegistryEntry({ branchId: 0, name: 'ECE' }), null)
  assert.equal(toRegistryEntry({ branchId: 3, name: '  ' }), null)
  assert.equal(toRegistryEntry(null), null)
})

test('sortRegistry orders by ID', () => {
  assert.deepEqual(sortRegistry(registry).map((b) => b.branchId), [1, 2, 3, 4])
})

test('spelling variants of one branch resolve to its ID', () => {
  assert.equal(findRegistryBranch('CSE', registry)?.branchId, 1)
  assert.equal(findRegistryBranch('B.Tech (CSE)', registry)?.branchId, 1)
  assert.equal(findRegistryBranch('B.E (CSE)', registry)?.branchId, 1)
  assert.equal(findRegistryBranch('ece', registry)?.branchId, 2)
})

test('BCA specialisations stay distinct', () => {
  assert.equal(findRegistryBranch('BCA (Regular)', registry)?.branchId, 3)
  assert.equal(findRegistryBranch('BCA (Cloud & Cyber Security)', registry)?.branchId, 4)
})

test('registryIdsFor returns sorted unique IDs and reports unknown names', () => {
  const out = registryIdsFor(['B.E (CSE)', 'B.Tech (CSE)', '', 'Mechanical', 'BCA (Regular)', 'ECE'], registry)
  assert.deepEqual(out.ids, [1, 2, 3])
  assert.deepEqual(out.unmatched, ['Mechanical'])
})

test('branchLabel shows the name, or the ID when the registry lacks it', () => {
  assert.equal(branchLabel(1, registry), 'CSE')
  assert.equal(branchLabel(99, registry), 'Branch 99')
})
