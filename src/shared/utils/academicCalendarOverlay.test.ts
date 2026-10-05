import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  expandAcademicCalendar,
  isAcademicOverlayId,
  isDateKey,
  overlayLabel,
  rangeDayCount,
  type AcademicCalendarSource,
} from './academicCalendarOverlay'

const dasara: AcademicCalendarSource = {
  id: 'ev1',
  title: 'Dasara Break',
  type: 'college-holiday',
  startDate: '2026-10-01',
  endDate: '2026-10-05',
  suspendsClasses: true,
}
const fest: AcademicCalendarSource = {
  id: 'ev2',
  title: 'Tech Fest',
  type: 'fest',
  startDate: '2026-10-05',
  endDate: '2026-10-05',
  suspendsClasses: false,
}
const iat: AcademicCalendarSource = {
  id: 'ev3',
  title: 'IAT-2 window',
  type: 'exam',
  startDate: '2026-11-02',
  endDate: '2026-11-04',
  suspendsClasses: true,
}

test('date-key helpers', () => {
  assert.equal(isDateKey('2026-10-05'), true)
  assert.equal(isDateKey('2026-1-5'), false)
  assert.equal(rangeDayCount('2026-10-01', '2026-10-05'), 5)
  assert.equal(rangeDayCount('2026-10-05', '2026-10-05'), 1)
  // Month and year rollovers.
  assert.equal(rangeDayCount('2026-10-30', '2026-11-02'), 4)
  assert.equal(rangeDayCount('2026-12-31', '2027-01-01'), 2)
  // Invalid ranges contribute nothing instead of throwing.
  assert.equal(rangeDayCount('2026-10-05', '2026-10-01'), 0)
  assert.equal(rangeDayCount('', '2026-10-01'), 0)
})

test('a multi-day break becomes one entry per covered day', () => {
  const entries = expandAcademicCalendar([dasara], '2026-10-01', '2026-10-31')
  assert.equal(entries.length, 5)
  assert.deepEqual(entries.map((e) => e.date), [
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  ])
  assert.deepEqual(entries.map((e) => e.dayIndex), [1, 2, 3, 4, 5])
  assert.equal(entries[0].dayCount, 5)
  assert.equal(entries[0].kind, 'holiday')
  assert.equal(entries[0].suspendsClasses, true)
  assert.equal(entries[0].id, 'acad_ev1_2026-10-01')
  assert.equal(isAcademicOverlayId(entries[0].id), true)
  assert.equal(isAcademicOverlayId('sched_abc_3'), false)
})

test('events are clipped to the visible window but keep their true day numbers', () => {
  const entries = expandAcademicCalendar([dasara], '2026-10-03', '2026-10-04')
  assert.deepEqual(entries.map((e) => e.date), ['2026-10-03', '2026-10-04'])
  // Day 3 and 4 of 5 — the break began before the window opened.
  assert.deepEqual(entries.map((e) => e.dayIndex), [3, 4])
  assert.equal(overlayLabel(entries[0]), 'Dasara Break (Day 3 of 5)')
  assert.equal(overlayLabel({ title: 'Tech Fest', dayIndex: 1, dayCount: 1 }), 'Tech Fest')
})

test('types map to paint kinds; out-of-window events are dropped; output is sorted', () => {
  const entries = expandAcademicCalendar([iat, fest, dasara], '2026-10-04', '2026-10-06')
  assert.deepEqual(
    entries.map((e) => `${e.date}:${e.title}:${e.kind}`),
    [
      '2026-10-04:Dasara Break:holiday',
      '2026-10-05:Dasara Break:holiday',
      '2026-10-05:Tech Fest:fest',
    ],
  )
  // A fest does not suspend classes; the exam window is in another month.
  assert.equal(entries[2].suspendsClasses, false)
  assert.equal(expandAcademicCalendar([iat], '2026-11-01', '2026-11-30').length, 3)
  assert.equal(expandAcademicCalendar([iat], '2026-11-01', '2026-11-30')[0].kind, 'exam')
})

test('empty / invalid windows return nothing', () => {
  assert.deepEqual(expandAcademicCalendar([], '2026-10-01', '2026-10-31'), [])
  assert.deepEqual(expandAcademicCalendar([dasara], '2026-10-31', '2026-10-01'), [])
  assert.deepEqual(expandAcademicCalendar([dasara], 'nope', '2026-10-01'), [])
})
