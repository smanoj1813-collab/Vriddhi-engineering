// src/modules/student/utils/todayStrip.ts
//
// One Vriddhi Phase B — pure derivation behind the dashboard's Today strip.
// Kept free of React/Firebase imports so node unit tests can pin it directly.

export interface TodayItem {
  id: 'class' | 'assignment' | 'test' | 'practice'
  label: string
  to: string
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Builds the three-pillar pulse rows from data the dashboard already loaded —
 * zero extra fetches. Rows with nothing to say are omitted, except the
 * practice pick, which always offers exactly one honest destination:
 * upcoming test → Placement Prep; otherwise the best enabled practice
 * surface (Placement Prep → Coding Lab → study materials).
 */
export function buildTodayItems(input: {
  schedule: Array<{ subject?: string; startTime?: string; status?: string }>
  assignments: Array<{ status?: string }>
  tests: Array<{ status?: string; startDateTime?: string }>
  assignmentsEnabled: boolean
  placementPrepEnabled: boolean
  codingLabEnabled: boolean
  now?: number
}): TodayItem[] {
  const now = input.now ?? Date.now()
  const items: TodayItem[] = []

  const nextClass = input.schedule.find((session) =>
    session.status !== 'cancelled' && session.status !== 'completed'
  )
  if (nextClass) {
    const time = String(nextClass.startTime || '').trim()
    const subject = String(nextClass.subject || 'Class').trim()
    items.push({
      id: 'class',
      label: time ? `${time} · ${subject}` : subject,
      to: '/student/timetable',
    })
  }

  if (input.assignmentsEnabled) {
    const due = input.assignments.filter(
      (assignment) => assignment.status === 'pending' || assignment.status === 'overdue'
    ).length
    if (due > 0) {
      items.push({
        id: 'assignment',
        label: due === 1 ? '1 assignment due' : `${due} assignments due`,
        to: '/student/assignments',
      })
    }
  }

  const upcomingTests = input.tests.filter((test) => {
    if (test.status !== 'upcoming' && test.status !== 'available') return false
    const start = Date.parse(String(test.startDateTime || ''))
    return !Number.isFinite(start) || (start >= now - 60 * 60 * 1000 && start <= now + WEEK_MS)
  }).length
  if (upcomingTests > 0) {
    items.push({
      id: 'test',
      label: upcomingTests === 1 ? '1 test this week' : `${upcomingTests} tests this week`,
      to: '/student/assessments',
    })
  }

  const nextTest = input.tests
    .filter((test) => test.status === 'upcoming' || test.status === 'available')
    .sort((a, b) => Date.parse(a.startDateTime || '') - Date.parse(b.startDateTime || ''))[0]
  if (input.placementPrepEnabled) {
    items.push({
      id: 'practice',
      label: nextTest ? 'Practice: prep for your next test' : 'Practice: placement prep',
      to: '/prep',
    })
  } else if (input.codingLabEnabled) {
    items.push({ id: 'practice', label: 'Practice: Coding Lab drill', to: '/student/coding-lab' })
  } else {
    items.push({ id: 'practice', label: 'Practice: browse study materials', to: '/student/materials' })
  }

  return items
}
