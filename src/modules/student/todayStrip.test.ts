import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTodayItems } from './utils/todayStrip'

const NOW = Date.parse('2026-10-05T09:00:00+05:30')

const base = {
  schedule: [] as Array<{ subject?: string; startTime?: string; status?: string }>,
  assignments: [] as Array<{ status?: string }>,
  tests: [] as Array<{ status?: string; startDateTime?: string }>,
  assignmentsEnabled: true,
  placementPrepEnabled: true,
  codingLabEnabled: false,
  now: NOW,
}

test('today strip: empty college day still offers one practice pick', () => {
  const items = buildTodayItems(base)
  assert.deepEqual(items.map((item) => item.id), ['practice'])
  assert.equal(items[0].to, '/prep')
})

test('today strip: next class skips cancelled and completed sessions', () => {
  const items = buildTodayItems({
    ...base,
    schedule: [
      { subject: 'DBMS', startTime: '10:00', status: 'cancelled' },
      { subject: 'Maths', startTime: '11:00', status: 'completed' },
      { subject: 'OS', startTime: '12:00', status: 'scheduled' },
    ],
  })
  const klass = items.find((item) => item.id === 'class')
  assert.equal(klass?.label, '12:00 · OS')
  assert.equal(klass?.to, '/student/timetable')
})

test('today strip: due assignments count pending + overdue only, respect the toggle', () => {
  const withWork = {
    ...base,
    assignments: [{ status: 'pending' }, { status: 'overdue' }, { status: 'graded' }],
  }
  const shown = buildTodayItems(withWork).find((item) => item.id === 'assignment')
  assert.equal(shown?.label, '2 assignments due')

  const toggledOff = buildTodayItems({ ...withWork, assignmentsEnabled: false })
  assert.ok(!toggledOff.some((item) => item.id === 'assignment'))

  const singular = buildTodayItems({ ...base, assignments: [{ status: 'pending' }] })
  assert.equal(singular.find((item) => item.id === 'assignment')?.label, '1 assignment due')
})

test('today strip: tests this week counts upcoming/available inside the window', () => {
  const items = buildTodayItems({
    ...base,
    tests: [
      { status: 'upcoming', startDateTime: '2026-10-07T10:00:00+05:30' },
      { status: 'available', startDateTime: '2026-10-09T10:00:00+05:30' },
      { status: 'upcoming', startDateTime: '2026-10-30T10:00:00+05:30' }, // beyond 7 days
      { status: 'completed', startDateTime: '2026-10-06T10:00:00+05:30' },
    ],
  })
  assert.equal(items.find((item) => item.id === 'test')?.label, '2 tests this week')
})

test('today strip: practice pick prefers prep, falls back to Coding Lab, then materials', () => {
  assert.equal(buildTodayItems(base).find((i) => i.id === 'practice')?.to, '/prep')

  const noPrep = buildTodayItems({ ...base, placementPrepEnabled: false, codingLabEnabled: true })
  assert.equal(noPrep.find((i) => i.id === 'practice')?.to, '/student/coding-lab')

  const neither = buildTodayItems({ ...base, placementPrepEnabled: false, codingLabEnabled: false })
  assert.equal(neither.find((i) => i.id === 'practice')?.to, '/student/materials')
})

test('today strip: an upcoming test personalises the prep pick', () => {
  const items = buildTodayItems({
    ...base,
    tests: [{ status: 'upcoming', startDateTime: '2026-10-07T10:00:00+05:30' }],
  })
  assert.equal(items.find((i) => i.id === 'practice')?.label, 'Practice: prep for your next test')
})
