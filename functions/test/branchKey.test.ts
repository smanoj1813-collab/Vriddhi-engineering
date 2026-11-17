import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { branchKey, branchVariants, sameBranch } from '../src/branchKey'

describe('functions branchKey mirror', () => {
  it('maps short code and B.E / B.Tech wrappers to one key', () => {
    assert.equal(branchKey('CSE'), 'CSE')
    assert.equal(branchKey('B.E (CSE)'), 'CSE')
    assert.equal(branchKey('B.Tech (CSE)'), 'CSE')
    assert.equal(branchKey('B.E (AI & ML)'), 'AIML')
  })

  it('keeps BCA specialisations and different branches apart', () => {
    assert.notEqual(branchKey('BCA (Regular)'), branchKey('BCA (AI & Data Science)'))
    assert.notEqual(branchKey('ECE'), branchKey('EEE'))
    assert.equal(sameBranch('', ''), false)
  })

  it('lists every known spelling of the branch for Firestore in-queries', () => {
    const v = new Set(branchVariants('CSE'))
    assert.ok(v.has('CSE'))
    assert.ok(v.has('B.E (CSE)'))
    assert.ok(v.has('B.Tech (CSE)'))
    assert.ok(!v.has('ECE'))
  })

  it('keeps an unknown value as the only variant', () => {
    assert.deepEqual(branchVariants('Robotics'), ['Robotics'])
    assert.deepEqual(branchVariants(''), [])
  })
})
