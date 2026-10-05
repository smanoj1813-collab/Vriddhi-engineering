// src/shared/utils/academicCalendarOverlay.ts
// ─── Academic calendar → day-grid overlay ────────────────────────────────────
//
// The college academic calendar (academicCalendar/{id}, written only through
// the saveCalendarEvent callable) stores DATE RANGES: a Dasara break is one
// document with startDate/endDate. Every day-grid calendar in the product —
// the faculty calendar is the first — needs those ranges exploded into one
// read-only entry per covered day, clipped to the window actually on screen.
//
// Pure and side-effect free so it can be unit tested without Firestore:
// inputs are plain yyyy-mm-dd strings, which compare correctly with `<=`.

import type { CalendarEvent, CalendarEventType } from '@/shared/types/calendarEvent'

/** The subset of an academic event this overlay needs. */
export type AcademicCalendarSource = Pick<
  CalendarEvent,
  'id' | 'title' | 'type' | 'startDate' | 'endDate' | 'suspendsClasses'
> & { notes?: string }

/** How a college event type is painted on a faculty/staff day grid. */
export type OverlayKind = 'holiday' | 'exam' | 'fest'

export interface AcademicOverlayEntry {
  /** Stable synthetic id: `acad_{eventId}_{date}` — never a Firestore doc id. */
  id: string
  /** yyyy-mm-dd this entry belongs to. */
  date: string
  title: string
  /** The original academic type, kept for tooltips/filters. */
  sourceType: CalendarEventType
  kind: OverlayKind
  suspendsClasses: boolean
  notes?: string
  /** Multi-day ranges say "Day 2 of 5" instead of repeating a bare title. */
  dayIndex: number
  dayCount: number
}

const KIND_BY_TYPE: Record<CalendarEventType, OverlayKind> = {
  'public-holiday': 'holiday',
  'college-holiday': 'holiday',
  'study-holiday': 'holiday',
  fest: 'fest',
  exam: 'exam',
}

/** yyyy-mm-dd → yyyy-mm-dd, one day later (UTC maths: no DST surprises). */
function nextDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const next = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1))
  return next.toISOString().slice(0, 10)
}

/** True for a well-formed yyyy-mm-dd key. */
export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** Inclusive day count of a range, or 0 when the range is invalid. */
export function rangeDayCount(startDate: string, endDate: string): number {
  if (!isDateKey(startDate) || !isDateKey(endDate) || endDate < startDate) return 0
  let count = 0
  for (let key = startDate; key <= endDate; key = nextDateKey(key)) {
    count += 1
    // A malformed pair can never run away: the product caps academic events
    // at an academic year, and this guard keeps a bad doc from hanging a tab.
    if (count > 400) break
  }
  return count
}

/**
 * Explode academic events into per-day entries inside [windowStart, windowEnd]
 * (both inclusive, yyyy-mm-dd). Events outside the window contribute nothing;
 * an event that straddles the edge contributes only its visible days, while
 * `dayIndex`/`dayCount` still describe the FULL range so the UI can say
 * "Day 1 of 5" on a break that started last month.
 *
 * Output is sorted by date, then by title, so renders are deterministic.
 */
export function expandAcademicCalendar(
  events: readonly AcademicCalendarSource[],
  windowStart: string,
  windowEnd: string,
): AcademicOverlayEntry[] {
  if (!isDateKey(windowStart) || !isDateKey(windowEnd) || windowEnd < windowStart) return []
  const entries: AcademicOverlayEntry[] = []

  for (const event of events) {
    const dayCount = rangeDayCount(event.startDate, event.endDate)
    if (dayCount === 0) continue
    if (event.endDate < windowStart || event.startDate > windowEnd) continue

    let dayIndex = 0
    for (let key = event.startDate; key <= event.endDate; key = nextDateKey(key)) {
      dayIndex += 1
      if (key < windowStart) continue
      if (key > windowEnd) break
      entries.push({
        id: `acad_${event.id}_${key}`,
        date: key,
        title: event.title,
        sourceType: event.type,
        kind: KIND_BY_TYPE[event.type] ?? 'holiday',
        suspendsClasses: event.suspendsClasses !== false,
        ...(event.notes ? { notes: event.notes } : {}),
        dayIndex,
        dayCount,
      })
    }
  }

  return entries.sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date.localeCompare(b.date)))
}

/** True for an id produced by this module — those entries are never editable. */
export function isAcademicOverlayId(id: string): boolean {
  return id.startsWith('acad_')
}

/** "Dasara Break" → "Dasara Break (Day 2 of 5)" for multi-day ranges. */
export function overlayLabel(entry: Pick<AcademicOverlayEntry, 'title' | 'dayIndex' | 'dayCount'>): string {
  return entry.dayCount > 1 ? `${entry.title} (Day ${entry.dayIndex} of ${entry.dayCount})` : entry.title
}
