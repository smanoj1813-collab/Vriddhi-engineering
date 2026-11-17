import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { branchKey, branchVariants, sameBranch } from './branchKey'

describe('branchKey', () => {
  it('treats short code and B.E / B.Tech wrappers as one branch', () => {
    assert.equal(branchKey('CSE'), 'CSE')
    assert.equal(branchKey('B.E (CSE)'), 'CSE')
    assert.equal(branchKey('B.Tech (CSE)'), 'CSE')
    assert.equal(branchKey('BE(cse)'), 'CSE')
  })

  it('normalises ampersands and AND in branch names', () => {
    assert.equal(branchKey('AIML'), 'AIML')
    assert.equal(branchKey('B.E (AI & ML)'), 'AIML')
    assert.equal(branchKey('B.Tech (AI and ML)'), 'AIML')
  })

  it('keeps BCA specialisations distinct from each other and from BCA', () => {
    assert.equal(branchKey('BCA'), 'BCA')
    assert.notEqual(branchKey('BCA (Regular)'), branchKey('BCA (AI & Data Science)'))
    assert.notEqual(branchKey('BCA'), branchKey('BCA (Regular)'))
  })

  it('does not merge different branches', () => {
    assert.notEqual(branchKey('ECE'), branchKey('EEE'))
    assert.notEqual(branchKey('ISE'), branchKey('B.Tech (ISE / IT)'))
    assert.equal(branchKey('B.E'), 'BE')
  })

  it('returns an empty key for blank input', () => {
    assert.equal(branchKey(''), '')
    assert.equal(branchKey(null), '')
    assert.equal(branchKey('   '), '')
  })
})

describe('sameBranch', () => {
  it('matches across spellings and never matches blank', () => {
    assert.equal(sameBranch('CSE', 'B.E (CSE)'), true)
    assert.equal(sameBranch('ECE', 'CSE'), false)
    assert.equal(sameBranch('', ''), false)
    assert.equal(sameBranch(undefined, 'CSE'), false)
  })
})

describe('branchVariants', () => {
  const known = ['CSE', 'B.E (CSE)', 'B.Tech (CSE)', 'ECE', 'B.E (ECE)']
  it('returns every stored spelling of the same branch, including the input', () => {
    const v = branchVariants('CSE', known)
    assert.deepEqual(new Set(v), new Set(['CSE', 'B.E (CSE)', 'B.Tech (CSE)']))
  })
  it('keeps an unknown value as the only variant', () => {
    assert.deepEqual(branchVariants('Robotics', known), ['Robotics'])
  })
  it('returns nothing for blank input', () => {
    assert.deepEqual(branchVariants('', known), [])
  })
})
