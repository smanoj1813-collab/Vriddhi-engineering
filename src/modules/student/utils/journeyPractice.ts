// src/modules/student/utils/journeyPractice.ts
//
// One Vriddhi Phase D — the practice pillar joins the Journey spine. This is
// a pure derivation over the learner's existing Placement Prep progress
// (GET /prep/progress → prep_progress/{uid}), so the journey page can add the
// row with zero new backend surface. Pinned by unit tests.

export interface PrepPracticeEntry {
  lastVisitedAt?: string
  visitedTabs?: string[]
  completed?: boolean
  quizScore?: number
  quizTotal?: number
  quizCompletedAt?: string
}

export interface PrepPracticeSummary {
  topicsVisited: number
  topicsCompleted: number
  quizzesAttempted: number
  /** ISO timestamp of the most recent practice touch, or null when none. */
  lastVisitedAt: string | null
}

export function summarizePrepPractice(
  progress: { topicsCompleted?: Record<string, PrepPracticeEntry> } | null | undefined
): PrepPracticeSummary {
  const entries = Object.values(progress?.topicsCompleted || {})
  let lastVisitedAt: string | null = null
  let topicsCompleted = 0
  let quizzesAttempted = 0

  for (const entry of entries) {
    if (entry.completed === true) topicsCompleted += 1
    if (entry.quizScore !== undefined || entry.quizCompletedAt) quizzesAttempted += 1
    if (entry.lastVisitedAt && (!lastVisitedAt || entry.lastVisitedAt > lastVisitedAt)) {
      lastVisitedAt = entry.lastVisitedAt
    }
  }

  return { topicsVisited: entries.length, topicsCompleted, quizzesAttempted, lastVisitedAt }
}
