import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizePrepPractice } from './journeyPractice'

test('summarizePrepPractice: empty / missing progress is all zeros', () => {
  assert.deepEqual(summarizePrepPractice(null), {
    topicsVisited: 0, topicsCompleted: 0, quizzesAttempted: 0, lastVisitedAt: null,
  })
  assert.deepEqual(summarizePrepPractice({}), {
    topicsVisited: 0, topicsCompleted: 0, quizzesAttempted: 0, lastVisitedAt: null,
  })
  assert.deepEqual(summarizePrepPractice({ topicsCompleted: {} }), {
    topicsVisited: 0, topicsCompleted: 0, quizzesAttempted: 0, lastVisitedAt: null,
  })
})

test('summarizePrepPractice: counts completed topics and quiz attempts', () => {
  const summary = summarizePrepPractice({
    topicsCompleted: {
      'arrays': { lastVisitedAt: '2026-10-01T10:00:00Z', visitedTabs: ['notes'], completed: true, quizScore: 8, quizTotal: 10, quizCompletedAt: '2026-10-01T10:20:00Z' },
      'sql': { lastVisitedAt: '2026-10-03T09:00:00Z', visitedTabs: ['notes', 'quiz'] },
      'os': { lastVisitedAt: '2026-10-02T08:00:00Z', visitedTabs: ['notes'], completed: false },
    },
  })
  assert.equal(summary.topicsVisited, 3)
  assert.equal(summary.topicsCompleted, 1)
  assert.equal(summary.quizzesAttempted, 1)
  assert.equal(summary.lastVisitedAt, '2026-10-03T09:00:00Z')
})

test('summarizePrepPractice: a quiz score alone counts as an attempt', () => {
  const summary = summarizePrepPractice({
    topicsCompleted: {
      'dbms': { quizScore: 5, quizTotal: 10 },
    },
  })
  assert.equal(summary.topicsVisited, 1)
  assert.equal(summary.quizzesAttempted, 1)
  assert.equal(summary.lastVisitedAt, null)
})
