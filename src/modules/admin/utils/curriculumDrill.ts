// src/modules/admin/utils/curriculumDrill.ts
//
// Pure grouping and rollup helpers for the Curriculum Insights drill-down.
// Everything here works on the subjects returned by ONE overview fetch, so the
// page never re-queries to change branch, batch or semester.
//
// Branch identity uses the shared branchKey rule: "CSE", "B.E (CSE)" and
// "B.Tech (CSE)" are one branch. BCA specialisations stay distinct.

import type { SubjectInsight } from '../api/academicInsightsApi'
import { branchKey } from '../../../shared/utils/branchKey'

export const NO_BRANCH_KEY = '__none__'
export const NO_BATCH_LABEL = 'No batch'

export function branchKeyOf(s: SubjectInsight): string {
  return branchKey(s.branch) || NO_BRANCH_KEY
}
export function batchOf(s: SubjectInsight): string {
  return (s.batch || '').trim() || NO_BATCH_LABEL
}
export function subjectKeyOf(s: Pick<SubjectInsight, 'semester' | 'curriculumId'>): string {
  return `${s.semester}__${s.curriculumId}`
}

/** Show the spelling most subjects use, e.g. "B.E (CSE)" rather than a short code. */
export function displayLabel(values: string[], fallback: string): string {
  const counts = new Map<string, number>()
  for (const v of values) {
    const t = (v || '').trim()
    if (t) counts.set(t, (counts.get(t) || 0) + 1)
  }
  let best = fallback
  let bestCount = 0
  for (const [label, count] of counts) {
    if (count > bestCount) { best = label; bestCount = count }
  }
  return best
}

export function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null
}

export interface Rollup {
  subjects: number
  faculty: number
  sessionsCompleted: number
  sessionsTotal: number
  attendancePct: number | null
  completionPct: number | null
  avgScore: number | null
}

/** Totals for any group of subjects, computed from counts so that averages stay correct. */
export function rollup(list: SubjectInsight[]): Rollup {
  let sessionsCompleted = 0
  let sessionsTotal = 0
  let marked = 0
  let present = 0
  let expected = 0
  let submitted = 0
  let scoreSum = 0
  let scored = 0
  const faculty = new Set<string>()
  for (const s of list) {
    sessionsCompleted += s.sessionsCompleted
    sessionsTotal += s.sessionsTotal
    marked += s.attendanceMarked
    present += s.attendancePresent
    expected += s.submissionsExpected
    submitted += s.submissionsSubmitted
    if (s.avgScore !== null && s.scoredCount > 0) {
      scoreSum += s.avgScore * s.scoredCount
      scored += s.scoredCount
    }
    const f = s.facultyId || s.facultyName
    if (f) faculty.add(f)
  }
  return {
    subjects: list.length,
    faculty: faculty.size,
    sessionsCompleted,
    sessionsTotal,
    attendancePct: pct(present, marked),
    completionPct: pct(submitted, expected),
    avgScore: scored > 0 ? Math.round((scoreSum / scored) * 10) / 10 : null,
  }
}

export interface Group {
  key: string
  label: string
  subjects: SubjectInsight[]
}

/** Group a list by a key, keeping the list in the given order of first appearance. */
export function groupBy(
  list: SubjectInsight[],
  keyOf: (s: SubjectInsight) => string,
  labelOf: (values: SubjectInsight[]) => string,
): Group[] {
  const map = new Map<string, SubjectInsight[]>()
  for (const s of list) {
    const k = keyOf(s)
    const bucket = map.get(k)
    if (bucket) bucket.push(s)
    else map.set(k, [s])
  }
  return [...map.entries()].map(([key, subjects]) => ({ key, label: labelOf(subjects), subjects }))
}

export function sortByLabel(groups: Group[]): Group[] {
  return [...groups].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}
