import test from 'node:test'
import assert from 'node:assert/strict'
import { canEnrol, orderedStops, routeSeatsLeft, summariseTransport, type TransportEnrolment, type TransportRoute } from './transportEngine'

const route = (over: Partial<TransportRoute> = {}): TransportRoute => ({
  id: 'r1', name: 'Route 1', vehicleNo: 'KA-01-1234', driver: 'D', driverPhone: '', capacity: 2, enrolled: 0, active: true,
  stops: [
    { id: 's2', name: 'Bannerghatta', order: 2, annualFee: 20000 },
    { id: 's1', name: 'Jayanagar', order: 1, annualFee: 15000 },
  ],
  ...over,
})

const enrol = (studentId: string, stopId: string): TransportEnrolment => ({
  studentId, studentName: studentId, regNo: studentId, routeId: 'r1', routeName: 'Route 1', stopId, stopName: stopId, annualFee: 0,
})

test('seats left never goes negative and is zero for inactive routes', () => {
  assert.equal(routeSeatsLeft(route({ enrolled: 1 })), 1)
  assert.equal(routeSeatsLeft(route({ enrolled: 5 })), 0)
  assert.equal(routeSeatsLeft(route({ active: false })), 0)
})

test('canEnrol explains each reason a student cannot board', () => {
  const r = route({ enrolled: 0 })
  assert.equal(canEnrol(undefined, 's1'), 'Route not found')
  assert.equal(canEnrol(route({ active: false }), 's1'), 'Route is inactive')
  assert.equal(canEnrol(r, 'nope'), 'Stop is not on this route')
  assert.equal(canEnrol(r, 's1'), null)
  assert.match(canEnrol(route({ enrolled: 2 }), 's1') ?? '', /is full \(2 seats\)/)
})

test('stops are returned in pickup order', () => {
  assert.deepEqual(orderedStops(route()).map(s => s.id), ['s1', 's2'])
})

test('summary counts enrolments per stop and flags over-capacity from the list, not the counter', () => {
  const [s] = summariseTransport([route({ enrolled: 0 })], [enrol('a', 's1'), enrol('b', 's1'), enrol('c', 's2')])
  assert.equal(s.enrolled, 3)
  assert.equal(s.overCapacity, true)
  assert.equal(s.seatsLeft, 0)
  assert.deepEqual(s.stops, [
    { stopId: 's1', stopName: 'Jayanagar', count: 2 },
    { stopId: 's2', stopName: 'Bannerghatta', count: 1 },
  ])
})
