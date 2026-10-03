import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// ─────────────────────────────────────────────────────────────────────────────
// Academic calendar (Auto-Scheduler v2 — P4)
//
// WHY THIS EXISTS
// Nothing in the codebase knew about Diwali. The auto-scheduler filled every
// Mon–Sat and `generateClassSessions` would happily create sessions on
// holidays, so operators were about to hand students a timetable that runs on
// College Day. This module owns the `academicCalendar` collection:
//
//   academicCalendar/{id} = {
//     collegeId, title,
//     type: 'public-holiday' | 'college-holiday' | 'study-holiday' | 'fest' | 'exam',
//     startDate, endDate,            // yyyy-mm-dd, inclusive
//     suspendsClasses: boolean,      // fests may NOT suspend teaching
//     notes?, createdBy, createdAt, updatedAt
//   }
//
//   saveCalendarEvent    — create/update one event (validate type enum, date
//                          order; overlaps allowed but warned).
//   deleteCalendarEvent  — remove one event.
//
// Reads stay client-side (rules: staff of the college + superadmin; writes
// NEVER client-side — mirror the schemePacks single-door pattern).
//
// Pure helpers (`eventCoversDate`, `buildCalendarView`, …) are exported so
// `generateClassSessions` can suppress holiday sessions and the auto-scheduler
// can report teachingDays vs blockedDays — all unit-testable without
// Firestore (functions/test/calendar.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import {
  isValidDateKey,
  daysBetween,
  dateKeysInRange,
  resolveSchedulingStaff,
  cancelScheduledSessionsForHolidayRange,
} from './classSchedule'
import type { DayOfWeek } from './classSchedule'

// ═════════════════════════════════════════════════════════════════════════════
// Types + pure validation (unit tested, no Firestore)
// ═════════════════════════════════════════════════════════════════════════════

export const CALENDAR_EVENT_TYPES = [
  'public-holiday',
  'college-holiday',
  'study-holiday',
  'fest',
  'exam',
] as const

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number]

/**
 * Per-type defaults for `suspendsClasses` (handoff §5 Q1 — spec defaults):
 * holidays and study holidays displace teaching; fests do NOT (a college day
 * still has classes around it); an exam window replaces regular classes.
 * The stored field always wins — the dialog lets an operator override it.
 */
export const DEFAULT_SUSPENDS_CLASSES: Record<CalendarEventType, boolean> = {
  'public-holiday': true,
  'college-holiday': true,
  'study-holiday': true,
  fest: false,
  exam: true,
}

export interface CalendarEventInput {
  /** Present only when updating an existing event. */
  id?: string
  title: string
  type: CalendarEventType
  /** yyyy-mm-dd, inclusive. */
  startDate: string
  /** yyyy-mm-dd, inclusive. */
  endDate: string
  suspendsClasses: boolean
  notes?: string
}

/** The subset of event fields every consumer needs, already normalised. */
export interface CalendarEventLite {
  id: string
  title: string
  type: CalendarEventType
  startDate: string
  endDate: string
  suspendsClasses: boolean
}

function boundedText(value: unknown, field: string, maximum: number): string {
  const s = String(value ?? '').trim()
  if (!s) throw new HttpsError('invalid-argument', `${field} is required`)
  if (s.length > maximum) throw new HttpsError('invalid-argument', `${field} is too long (max ${maximum})`)
  return s
}

/**
 * Structural validation for one calendar event (create or update). Throws
 * HttpsError('invalid-argument') on a bad type, a missing title, or an
 * endDate before startDate.
 */
export function validateCalendarEvent(raw: unknown): CalendarEventInput {
  const input = (raw || {}) as Record<string, unknown>

  const id = String(input.id ?? '').trim()
  if (id.length > 120) throw new HttpsError('invalid-argument', 'id is too long (max 120)')

  const title = boundedText(input.title, 'title', 120)
  const type = String(input.type ?? '').trim() as CalendarEventType
  if (!CALENDAR_EVENT_TYPES.includes(type)) {
    throw new HttpsError(
      'invalid-argument',
      `type must be one of: ${CALENDAR_EVENT_TYPES.join(', ')}`,
    )
  }
  const startDate = String(input.startDate ?? '').trim()
  const endDate = String(input.endDate ?? '').trim()
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    throw new HttpsError('invalid-argument', 'startDate and endDate are required as yyyy-mm-dd dates')
  }
  if (daysBetween(startDate, endDate) < 0) {
    throw new HttpsError('invalid-argument', 'startDate must be on or before endDate')
  }
  if (daysBetween(startDate, endDate) + 1 > 366) {
    throw new HttpsError('invalid-argument', 'An event may not span more than 366 days')
  }
  if (input.suspendsClasses !== undefined && typeof input.suspendsClasses !== 'boolean') {
    throw new HttpsError('invalid-argument', 'suspendsClasses must be a boolean')
  }
  const suspendsClasses =
    typeof input.suspendsClasses === 'boolean' ? input.suspendsClasses : DEFAULT_SUSPENDS_CLASSES[type]
  const notes = String(input.notes ?? '').trim().slice(0, 500)

  return {
    ...(id ? { id } : {}),
    title,
    type,
    startDate,
    endDate,
    suspendsClasses,
    ...(notes ? { notes } : {}),
  }
}

/** Inclusive [startDate, endDate] membership test (already-normalised keys). */
export function eventCoversDate(
  event: Pick<CalendarEventLite, 'startDate' | 'endDate'>,
  dateKey: string,
): boolean {
  return dateKey >= event.startDate && dateKey <= event.endDate
}

/** True when the event touches the [from, to] window at all. */
export function eventOverlapsRange(
  event: Pick<CalendarEventLite, 'startDate' | 'endDate'>,
  from: string,
  to: string,
): boolean {
  return event.startDate <= to && event.endDate >= from
}

/** Defensive parse of one Firestore doc into a CalendarEventLite (or null). */
export function toCalendarEventLite(
  id: string,
  data: Record<string, unknown>,
): CalendarEventLite | null {
  const title = String(data.title ?? '').trim()
  const type = String(data.type ?? '').trim() as CalendarEventType
  const startDate = String(data.startDate ?? '').trim()
  const endDate = String(data.endDate ?? '').trim()
  if (!title || !CALENDAR_EVENT_TYPES.includes(type)) return null
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) return null
  return {
    id,
    title,
    type,
    startDate,
    endDate,
    suspendsClasses: data.suspendsClasses !== false,
  }
}

// ─── Calendar view for the scheduler + preview ───────────────────────────────

export interface BlockedDate {
  date: string
  title: string
  type: CalendarEventType
  suspendsClasses: boolean
}

export interface CalendarView {
  /** Events overlapping the window (or the 12-month horizon without one). */
  events: CalendarEventLite[]
  /** Every grid weekday that has ≥1 blocked date in the window, with titles. */
  blockedWeekdays: { day: DayOfWeek; titles: string[] }[]
  /** Per-date detail for the preview ("⛔ Holiday — no classes"). */
  blockedDates: BlockedDate[]
  /** Grid-day occurrences in the window (teaching days + blocked days). */
  teachingDays?: number
  blockedDays?: number
  /** How many teaching dates each event type knocks out. */
  blockedBreakdown: Record<string, number>
}

/** The weekday of a yyyy-mm-dd key, without touching local time. */
export function weekdayKeyOf(dateKey: string): DayOfWeek {
  const [year, month, day] = dateKey.split('-').map(Number)
  const names: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return names[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
}

/**
 * Roll the college's events into the shape the auto-scheduler preview shows:
 * blocked weekdays (with event titles) always; teachingDays vs blockedDays
 * when a concrete dateRange is in play (a Mon holiday only voids the Mondays
 * inside the window — weekly patterns still place Mon slots).
 *
 * Only `suspendsClasses` events count against teachingDays; a fest with
 * suspendsClasses:false is listed as context but costs zero teaching days.
 */
export function buildCalendarView(
  events: CalendarEventLite[],
  gridDays: DayOfWeek[],
  dateRange?: { from: string; to?: string },
): CalendarView {
  const from = dateRange?.from
  const to = dateRange?.to ?? dateRange?.from
  const inWindow = events.filter((e) => (from && to ? eventOverlapsRange(e, from, to) : true))

  const blockedDates: BlockedDate[] = []
  const blockedBreakdown: Record<string, number> = {}
  let teachingDays: number | undefined
  let blockedDays: number | undefined

  if (from && to) {
    const daySet = new Set(gridDays)
    let teaching = 0
    for (const date of dateKeysInRange(from, to)) {
      if (!daySet.has(weekdayKeyOf(date))) continue
      const covering = inWindow.filter((e) => eventCoversDate(e, date))
      const suspending = covering.find((e) => e.suspendsClasses)
      if (suspending) {
        blockedDays = (blockedDays ?? 0) + 1
        blockedBreakdown[suspending.type] = (blockedBreakdown[suspending.type] ?? 0) + 1
        blockedDates.push({
          date,
          title: suspending.title,
          type: suspending.type,
          suspendsClasses: true,
        })
      } else {
        teaching += 1
        for (const e of covering) {
          if (!e.suspendsClasses) {
            blockedDates.push({ date, title: e.title, type: e.type, suspendsClasses: false })
          }
        }
      }
    }
    teachingDays = teaching
    blockedDays = blockedDays ?? 0
  }

  const weekdayTitles = new Map<DayOfWeek, string[]>()
  for (const e of inWindow) {
    const titles = weekdayTitles.get(weekdayKeyOf(e.startDate)) ?? []
    // Cover every weekday the range touches (multi-day study holidays).
    for (const date of dateKeysInRange(e.startDate, e.endDate)) {
      const day = weekdayKeyOf(date)
      const list = weekdayTitles.get(day) ?? []
      if (!list.includes(e.title)) list.push(e.title)
      weekdayTitles.set(day, list)
    }
    if (titles.length === 0 && !weekdayTitles.has(weekdayKeyOf(e.startDate))) {
      weekdayTitles.set(weekdayKeyOf(e.startDate), [e.title])
    }
  }
  const blockedWeekdays = gridDays
    .map((day) => ({ day, titles: weekdayTitles.get(day) ?? [] }))
    .filter((row) => row.titles.length > 0)

  return {
    events: inWindow.sort((a, b) => a.startDate.localeCompare(b.startDate)),
    blockedWeekdays,
    blockedDates,
    teachingDays,
    blockedDays,
    blockedBreakdown,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Session suppression (shared with generateClassSessions)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The first suspendsClasses event covering `dateKey`, or null. Used by
 * `generateClassSessions` (classSchedule.ts) to skip creation and record
 * `{ date, reason: 'Holiday: Diwali' }` in its skipped summary.
 */
export function suspendingEventOn(
  events: CalendarEventLite[],
  dateKey: string,
): CalendarEventLite | null {
  return events.find((e) => e.suspendsClasses && eventCoversDate(e, dateKey)) ?? null
}

// ═════════════════════════════════════════════════════════════════════════════
// Callables — the single write door (schemePacks pattern)
// ═════════════════════════════════════════════════════════════════════════════

const REGION = { region: 'asia-south1' as const }
/** Bounded read of one college's calendar (12-month horizon is plenty). */
export const MAX_CALENDAR_READ = 200

/**
 * saveCalendarEvent { event: {id?, title, type, startDate, endDate,
 * suspendsClasses?, notes?}, collegeId? }
 * Upserts one event under the caller's college. Overlapping events are legal
 * (a fest inside study holidays happens) but the response warns so the
 * operator spots the collision before students do.
 */
export const saveCalendarEvent = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSchedulingStaff(uid, request.auth?.token || {})

  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = staff.role === 'superadmin' ? String(raw.collegeId ?? '').trim() : staff.collegeId
  if (!collegeId) throw new HttpsError('invalid-argument', 'No college is associated with this account')

  const event = validateCalendarEvent(raw.event)
  const db = getFirestore(admin.app(), 'default')
  const ref = event.id
    ? db.collection('academicCalendar').doc(event.id)
    : db.collection('academicCalendar').doc()
  const existing = event.id ? await ref.get() : null
  if (existing && existing.exists && String(existing.data()?.collegeId ?? '') !== collegeId) {
    throw new HttpsError('permission-denied', 'This calendar event belongs to another college')
  }

  // Overlaps allowed but warned (handoff P4).
  const windowSnap = await db
    .collection('academicCalendar')
    .where('collegeId', '==', collegeId)
    .limit(MAX_CALENDAR_READ)
    .get()
  const overlaps = windowSnap.docs
    .filter((d) => d.id !== ref.id)
    .map((d) => toCalendarEventLite(d.id, d.data() as Record<string, unknown>))
    .filter((e): e is CalendarEventLite => e !== null)
    .filter((e) => e.startDate <= event.endDate && e.endDate >= event.startDate)

  const now = admin.firestore.FieldValue.serverTimestamp()
  const isUpdate = Boolean(existing && existing.exists)
  await ref.set(
    {
      title: event.title,
      type: event.type,
      startDate: event.startDate,
      endDate: event.endDate,
      suspendsClasses: event.suspendsClasses,
      notes: event.notes ?? '',
      collegeId,
      updatedAt: now,
      updatedBy: staff.name || uid,
      ...(isUpdate ? {} : { createdAt: now, createdBy: staff.name || uid }),
    },
    { merge: true },
  )

  const warnings = overlaps.map((e) => `Overlaps “${e.title}” (${e.startDate} → ${e.endDate})`)
  let cancelledSessions = 0
  if (event.suspendsClasses) {
    try {
      cancelledSessions = await cancelScheduledSessionsForHolidayRange(db, {
        collegeId,
        startDate: event.startDate,
        endDate: event.endDate,
        title: event.title,
        actorUid: uid,
      })
    } catch (error) {
      // The calendar save already committed. Surface reconciliation failure
      // instead of making the caller believe the event itself was not saved.
      logger.error('[calendar] holiday session reconciliation failed', {
        collegeId,
        eventId: ref.id,
        error,
      })
      warnings.push('Calendar event saved, but existing future sessions could not all be reconciled. Save again or regenerate the affected date range.')
    }
  }

  return {
    id: ref.id,
    updated: isUpdate,
    cancelledSessions,
    warnings,
  }
})

/**
 * deleteCalendarEvent { id, collegeId? }
 * Removes one event. Tenancy is enforced here — rules deny client deletes.
 */
export const deleteCalendarEvent = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSchedulingStaff(uid, request.auth?.token || {})

  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = staff.role === 'superadmin' ? String(raw.collegeId ?? '').trim() : staff.collegeId
  const id = String(raw.id ?? '').trim()
  if (!id) throw new HttpsError('invalid-argument', 'id is required')

  const db = getFirestore(admin.app(), 'default')
  const ref = db.collection('academicCalendar').doc(id)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Calendar event not found')
  if (String(snap.data()?.collegeId ?? '') !== collegeId) {
    throw new HttpsError('permission-denied', 'This calendar event belongs to another college')
  }
  await ref.delete()
  return { id }
})
