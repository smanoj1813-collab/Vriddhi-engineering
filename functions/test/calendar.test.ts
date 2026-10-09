// functions/test/calendar.ts (tests) — Auto-Scheduler v2 P4
// Academic calendar: validation is the single write door; the view builders
// and suppression helpers drive the scheduler summary and
// `generateClassSessions` holiday skips. All pure — no Firestore.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SUSPENDS_CLASSES,
  buildCalendarView,
  calendarDateKeys,
  eventCoversDate,
  eventOverlapsRange,
  suspendingEventOn,
  toCalendarEventLite,
  validateCalendarEvent,
  type CalendarEventLite,
} from '../src/calendar'

function event(over: Partial<CalendarEventLite> = {}): CalendarEventLite {
  return {
    id: over.id ?? 'ev1',
    title: over.title ?? 'Diwali',
    type: over.type ?? 'public-holiday',
    startDate: over.startDate ?? '2026-11-09',
    endDate: over.endDate ?? '2026-11-09',
    suspendsClasses: over.suspendsClasses ?? true,
  }
}

describe('validateCalendarEvent', () => {
  it('accepts a well-formed event and applies per-type suspendsClasses defaults', () => {
    const holiday = validateCalendarEvent({
      title: 'Diwali', type: 'public-holiday', startDate: '2026-11-09', endDate: '2026-11-10',
    })
    assert.equal(holiday.title, 'Diwali')
    assert.equal(holiday.suspendsClasses, true)
    assert.equal(holiday.endDate, '2026-11-10')

    const fest = validateCalendarEvent({
      title: 'College Day', type: 'fest', startDate: '2026-12-04', endDate: '2026-12-04',
    })
    assert.equal(fest.suspendsClasses, false) // fests do NOT suspend teaching

    const exam = validateCalendarEvent({
      title: 'IA exams', type: 'exam', startDate: '2027-01-05', endDate: '2027-01-10',
    })
    assert.equal(exam.suspendsClasses, true)
    assert.equal(DEFAULT_SUSPENDS_CLASSES['study-holiday'], true)
    assert.equal(DEFAULT_SUSPENDS_CLASSES.fest, false)

    // stored/submitting value always wins over the default
    const loudFest = validateCalendarEvent({
      title: 'Boycott', type: 'fest', startDate: '2026-12-05', endDate: '2026-12-05', suspendsClasses: true,
    })
    assert.equal(loudFest.suspendsClasses, true)
  })

  it('rejects a bad type', () => {
    for (const type of ['holiday', '', 'EXAM ', null, 42]) {
      assert.throws(
        () => validateCalendarEvent({ title: 'X', type, startDate: '2026-11-09', endDate: '2026-11-09' }),
        (e: any) => e.code === 'invalid-argument',
        `type=${JSON.stringify(type)} must be rejected`,
      )
    }
  })

  it('rejects endDate before startDate and malformed dates', () => {
    assert.throws(
      () => validateCalendarEvent({ title: 'X', type: 'fest', startDate: '2026-11-10', endDate: '2026-11-09' }),
      (e: any) => e.code === 'invalid-argument',
    )
    assert.throws(
      () => validateCalendarEvent({ title: 'X', type: 'fest', startDate: '2026-02-31', endDate: '2026-02-31' }),
      (e: any) => e.code === 'invalid-argument',
    )
    assert.throws(
      () => validateCalendarEvent({ title: 'X', type: 'fest', startDate: '10/09/2026', endDate: '2026-10-09' }),
      (e: any) => e.code === 'invalid-argument',
    )
  })

  it('rejects a missing (or giant) title', () => {
    for (const title of ['', '   ', null, undefined, 'x'.repeat(121)]) {
      assert.throws(
        () => validateCalendarEvent({ title, type: 'fest', startDate: '2026-11-09', endDate: '2026-11-09' }),
        (e: any) => e.code === 'invalid-argument',
      )
    }
  })
})

describe('eventCoversDate / eventOverlapsRange', () => {
  it('covers the inclusive bounds only', () => {
    const e = event({ startDate: '2026-11-09', endDate: '2026-11-11' })
    assert.equal(eventCoversDate(e, '2026-11-09'), true)
    assert.equal(eventCoversDate(e, '2026-11-10'), true)
    assert.equal(eventCoversDate(e, '2026-11-11'), true)
    assert.equal(eventCoversDate(e, '2026-11-08'), false)
    assert.equal(eventCoversDate(e, '2026-11-12'), false)
    assert.equal(eventOverlapsRange(e, '2026-11-11', '2026-12-01'), true)
    assert.equal(eventOverlapsRange(e, '2026-12-01', '2026-12-10'), false)
  })
})

describe('toCalendarEventLite', () => {
  it('parses defensively and drops malformed docs', () => {
    const ok = toCalendarEventLite('id-1', {
      title: 'Diwali', type: 'public-holiday', startDate: '2026-11-09', endDate: '2026-11-09', suspendsClasses: true,
    })
    assert.deepEqual(ok, event({ id: 'id-1' }))
    assert.equal(toCalendarEventLite('id-2', { title: '', type: 'fest', startDate: '2026-01-01', endDate: '2026-01-01' }), null)
    assert.equal(toCalendarEventLite('id-3', { title: 'X', type: 'nope', startDate: '2026-01-01', endDate: '2026-01-01' }), null)
    // Legacy docs without the field default to suspends (safe for students).
    const legacy = toCalendarEventLite('id-4', { title: 'Old', type: 'exam', startDate: '2026-01-01', endDate: '2026-01-01' })
    assert.equal(legacy?.suspendsClasses, true)
    const fest = toCalendarEventLite('id-5', { title: 'Fest', type: 'fest', startDate: '2026-01-01', endDate: '2026-01-01', suspendsClasses: false })
    assert.equal(fest?.suspendsClasses, false)
  })
})

describe('suspendingEventOn', () => {
  it('finds a suspendsClasses event and ignores fests', () => {
    const diwali = event({ id: 'd', title: 'Diwali', startDate: '2026-11-09', endDate: '2026-11-09' })
    const fest = event({ id: 'f', title: 'College Day', type: 'fest', startDate: '2026-12-04', endDate: '2026-12-04', suspendsClasses: false })
    assert.equal(suspendingEventOn([diwali, fest], '2026-11-09')?.title, 'Diwali')
    assert.equal(suspendingEventOn([diwali, fest], '2026-12-04'), null) // fest → sessions run
    assert.equal(suspendingEventOn([diwali, fest], '2026-12-05'), null)
  })
})

describe('buildCalendarView', () => {
  const gridDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const

  it('marks blocked weekdays with the event title', () => {
    // 2026-11-09 is a Monday.
    const view = buildCalendarView(
      [event({ title: 'Diwali', startDate: '2026-11-09', endDate: '2026-11-09' })],
      [...gridDays],
    )
    const mon = view.blockedWeekdays.find((w) => w.day === 'monday')
    assert.deepEqual(mon?.titles, ['Diwali'])
    assert.equal(view.blockedWeekdays.length, 1)
  })

  it('splits teachingDays vs blockedDays inside a dateRange; fests do not block', () => {
    // Window Mon 2026-11-09 → Fri 2026-11-13 = 5 grid days.
    const view = buildCalendarView(
      [
        event({ id: 'd', title: 'Diwali', startDate: '2026-11-09', endDate: '2026-11-09' }), // Mon holiday
        event({ id: 's', title: 'Study holidays', type: 'study-holiday', startDate: '2026-11-11', endDate: '2026-11-12' }), // Wed–Thu
        event({ id: 'f', title: 'College Day', type: 'fest', startDate: '2026-11-13', endDate: '2026-11-13', suspendsClasses: false }), // Fri fest
      ],
      [...gridDays],
      { from: '2026-11-09', to: '2026-11-13' },
    )
    assert.equal(view.teachingDays, 2) // Tue + Fri (fest day still teaches)
    assert.equal(view.blockedDays, 3) // Mon + Wed + Thu
    assert.deepEqual(view.blockedBreakdown, { 'public-holiday': 1, 'study-holiday': 2 })
    const blocked = view.blockedDates.filter((b) => b.suspendsClasses).map((b) => b.date)
    assert.deepEqual(blocked, ['2026-11-09', '2026-11-11', '2026-11-12'])
    // the fest is visible as context but suspends nothing
    assert.ok(view.blockedDates.some((b) => b.date === '2026-11-13' && !b.suspendsClasses))
  })

  it('without a dateRange returns events + weekday marks but no day counts', () => {
    const view = buildCalendarView([event()], ['monday'])
    assert.equal(view.teachingDays, undefined)
    assert.equal(view.blockedDays, undefined)
    assert.equal(view.events.length, 1)
    assert.equal(view.blockedDates.length, 0)
  })
})

describe('buildCalendarView over semester-length spans', () => {
  it('does not throw for a full-semester dateRange (> 92 days)', () => {
    const view = buildCalendarView([], ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], {
      from: '2026-08-01',
      to: '2027-01-31',
    })
    assert.ok((view.teachingDays ?? 0) > 100)
  })

  it('does not throw for a calendar event longer than 92 days', () => {
    const view = buildCalendarView(
      [{ id: 'sem', title: 'Odd semester', type: 'exam', startDate: '2026-08-01', endDate: '2027-01-31', suspendsClasses: false }],
      ['monday', 'friday'],
    )
    assert.deepEqual(view.blockedWeekdays.map((row) => row.day), ['monday', 'friday'])
  })

  it('calendarDateKeys clips reversed or invalid spans to an empty list', () => {
    assert.deepEqual(calendarDateKeys('2026-02-10', '2026-02-01'), [])
    assert.deepEqual(calendarDateKeys('bad', '2026-02-01'), [])
    assert.equal(calendarDateKeys('2026-01-01', '2026-01-03').length, 3)
  })
})
