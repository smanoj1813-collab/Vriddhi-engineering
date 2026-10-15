import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allocateHostelRooms,
  freeBeds,
  normaliseGender,
  summariseHostel,
  type HostelApplicant,
  type HostelRoom,
} from './hostelEngine'

const room = (over: Partial<HostelRoom> & Pick<HostelRoom, 'id' | 'blockName' | 'roomNo' | 'gender' | 'capacity'>): HostelRoom => ({
  blockId: 'b', occupied: 0, status: 'active', ...over,
})

const app = (over: Partial<HostelApplicant> & Pick<HostelApplicant, 'studentId' | 'regNo'>): HostelApplicant => ({
  name: over.studentId, gender: 'Male', distanceKm: 0, appliedAt: '2026-06-01T00:00:00Z', ...over,
})

test('normaliseGender accepts the common spellings and rejects anything else', () => {
  assert.equal(normaliseGender('Male'), 'male')
  assert.equal(normaliseGender(' f '), 'female')
  assert.equal(normaliseGender('Girls'), 'female')
  assert.equal(normaliseGender('other'), null)
  assert.equal(normaliseGender(undefined), null)
  assert.equal(normaliseGender(42), null)
})

test('freeBeds ignores rooms under maintenance and never goes negative', () => {
  assert.equal(freeBeds({ capacity: 3, occupied: 1, status: 'active' }), 2)
  assert.equal(freeBeds({ capacity: 3, occupied: 1, status: 'maintenance' }), 0)
  assert.equal(freeBeds({ capacity: 2, occupied: 5, status: 'active' }), 0)
})

test('summariseHostel reports beds per gender and skips rooms under maintenance', () => {
  const s = summariseHostel([
    room({ id: 'a', blockName: 'A', roomNo: '1', gender: 'male', capacity: 3, occupied: 2 }),
    room({ id: 'b', blockName: 'A', roomNo: '2', gender: 'male', capacity: 3, status: 'maintenance' }),
    room({ id: 'c', blockName: 'G', roomNo: '1', gender: 'female', capacity: 2 }),
  ])
  assert.deepEqual(s.male, { gender: 'male', rooms: 1, beds: 3, occupied: 2, free: 1 })
  assert.deepEqual(s.female, { gender: 'female', rooms: 1, beds: 2, occupied: 0, free: 2 })
})

test('boys are placed only in boys rooms and girls only in girls rooms', () => {
  const rooms = [room({ id: 'g1', blockName: 'G', roomNo: '1', gender: 'female', capacity: 4 })]
  const plan = allocateHostelRooms([app({ studentId: 's1', regNo: '1', gender: 'Male' })], rooms)
  assert.equal(plan.assignments.length, 0)
  assert.match(plan.unplaced[0].reason, /No free bed in boys hostel/)
})

test('farther students are placed first, then earliest application, then reg no', () => {
  const rooms = [room({ id: 'r1', blockName: 'A', roomNo: '1', gender: 'male', capacity: 2 })]
  const plan = allocateHostelRooms([
    app({ studentId: 'near', regNo: '1', distanceKm: 5 }),
    app({ studentId: 'far-late', regNo: '2', distanceKm: 80, appliedAt: '2026-06-03T00:00:00Z' }),
    app({ studentId: 'far-early', regNo: '3', distanceKm: 80, appliedAt: '2026-06-02T00:00:00Z' }),
  ], rooms)
  assert.deepEqual(plan.assignments.map(a => a.studentId), ['far-early', 'far-late'])
  assert.deepEqual(plan.unplaced.map(u => u.studentId), ['near'])
})

test('never books more beds than are free, counting beds taken earlier in the same plan', () => {
  const rooms = [
    room({ id: 'r1', blockName: 'A', roomNo: '1', gender: 'male', capacity: 2, occupied: 1 }),
    room({ id: 'r2', blockName: 'A', roomNo: '2', gender: 'male', capacity: 1 }),
  ]
  const plan = allocateHostelRooms(
    [1, 2, 3].map(i => app({ studentId: `s${i}`, regNo: `${i}` })),
    rooms,
  )
  assert.equal(plan.assignments.length, 2)
  assert.deepEqual(plan.assignments.map(a => a.roomId), ['r1', 'r2'])
  assert.equal(plan.unplaced.length, 1)
})

test('students who already hold a bed are skipped', () => {
  const rooms = [room({ id: 'r1', blockName: 'A', roomNo: '1', gender: 'male', capacity: 3 })]
  const plan = allocateHostelRooms(
    [app({ studentId: 'held', regNo: '1' }), app({ studentId: 'new', regNo: '2' })],
    rooms,
    new Set(['held']),
  )
  assert.deepEqual(plan.assignments.map(a => a.studentId), ['new'])
  assert.equal(plan.unplaced.length, 0)
})

test('missing or unknown gender is flagged for manual assignment, not guessed', () => {
  const rooms = [room({ id: 'r1', blockName: 'A', roomNo: '1', gender: 'male', capacity: 3 })]
  const plan = allocateHostelRooms([app({ studentId: 'x', regNo: '1', gender: undefined })], rooms)
  assert.equal(plan.assignments.length, 0)
  assert.equal(plan.unplaced[0].reason, 'Gender not recorded — assign manually')
})

test('rooms under maintenance and rooms with no free bed are not used', () => {
  const rooms = [
    room({ id: 'm', blockName: 'A', roomNo: '1', gender: 'male', capacity: 3, status: 'maintenance' }),
    room({ id: 'full', blockName: 'A', roomNo: '2', gender: 'male', capacity: 1, occupied: 1 }),
  ]
  const plan = allocateHostelRooms([app({ studentId: 's', regNo: '1' })], rooms)
  assert.equal(plan.assignments.length, 0)
})

test('the plan is deterministic regardless of input order', () => {
  const rooms = [
    room({ id: 'r2', blockName: 'B', roomNo: '1', gender: 'male', capacity: 1 }),
    room({ id: 'r1', blockName: 'A', roomNo: '10', gender: 'male', capacity: 1 }),
    room({ id: 'r3', blockName: 'A', roomNo: '9', gender: 'male', capacity: 1 }),
  ]
  const apps = [app({ studentId: 'a', regNo: '1' }), app({ studentId: 'b', regNo: '2' }), app({ studentId: 'c', regNo: '3' })]
  const one = allocateHostelRooms(apps, rooms).assignments.map(a => a.roomId)
  const two = allocateHostelRooms([...apps].reverse(), [...rooms].reverse()).assignments.map(a => a.roomId)
  assert.deepEqual(one, two)
  // Block A rooms sort numerically (9 before 10), then block B.
  assert.deepEqual(one, ['r3', 'r1', 'r2'])
})
