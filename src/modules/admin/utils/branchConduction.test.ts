import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bucketTest, branchLabel, summarizeBranchConduction, toMillis } from './branchConduction'

const NOW = Date.parse('2026-10-05T12:00:00+05:30')
const BEFORE = '2026-10-05T09:00:00+05:30'
const AFTER = '2026-10-06T09:00:00+05:30'
const WAY_AFTER = '2026-10-20T09:00:00+05:30'

test('toMillis accepts ISO strings, Dates and Firestore-like timestamps', () => {
  assert.equal(toMillis(BEFORE), Date.parse(BEFORE))
  assert.equal(toMillis(new Date(BEFORE)), Date.parse(BEFORE))
  assert.equal(toMillis({ toDate: () => new Date(BEFORE) }), Date.parse(BEFORE))
  assert.equal(toMillis(null), null)
  assert.equal(toMillis('not-a-date'), null)
})

test('bucketTest mirrors the server lifecycle rules', () => {
  assert.equal(bucketTest('cancelled', Date.parse(BEFORE), Date.parse(AFTER), NOW), 'cancelled')
  assert.equal(bucketTest('completed', Date.parse(BEFORE), Date.parse(AFTER), NOW), 'completed')
  // stale 'published' but the window has passed → completed
  assert.equal(bucketTest('published', Date.parse(BEFORE), Date.parse(BEFORE), NOW), 'completed')
  assert.equal(bucketTest('published', Date.parse(BEFORE), Date.parse(AFTER), NOW), 'ongoing')
  assert.equal(bucketTest('scheduled', Date.parse(AFTER), Date.parse(WAY_AFTER), NOW), 'upcoming')
})

test('branchLabel falls back to program, then College-wide', () => {
  assert.equal(branchLabel({ id: '1', branch: 'CSE' }), 'CSE')
  assert.equal(branchLabel({ id: '1', program: 'B.E.' }), 'B.E.')
  assert.equal(branchLabel({ id: '1' }), 'College-wide')
})

test('summarizeBranchConduction groups, counts and lists active tests', () => {
  const summaries = summarizeBranchConduction(
    [
      { id: 'a', title: 'DBMS Midterm', subject: 'DBMS', branch: 'CSE', status: 'published', startDateTime: BEFORE, endDateTime: AFTER },
      { id: 'b', title: 'OS Quiz', branch: 'CSE', status: 'scheduled', startDateTime: AFTER, endDateTime: WAY_AFTER },
      { id: 'c', title: 'Maths IAT-1', branch: 'CSE', status: 'completed', startDateTime: BEFORE, endDateTime: BEFORE },
      { id: 'd', title: 'Cancelled one', branch: 'CSE', status: 'cancelled', startDateTime: BEFORE, endDateTime: AFTER },
      { id: 'e', title: 'ECE basics', branch: 'ECE', status: 'scheduled', startDateTime: AFTER, endDateTime: WAY_AFTER },
    ],
    NOW
  )

  assert.deepEqual(summaries.map((s) => s.branch), ['CSE', 'ECE'])
  const cse = summaries[0]
  assert.equal(cse.upcoming, 1)
  assert.equal(cse.ongoing, 1)
  assert.equal(cse.completed, 1)
  // cancelled not counted, active lists ongoing first (soonest)
  assert.deepEqual(cse.active.map((t) => t.id), ['a', 'b'])
  assert.equal(summaries[1].upcoming, 1)
})

test('summarizeBranchConduction: empty input → empty summary', () => {
  assert.deepEqual(summarizeBranchConduction([], NOW), [])
})
