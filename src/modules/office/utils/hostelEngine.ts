// src/modules/office/utils/hostelEngine.ts
//
// Pure hostel rules: gender normalisation, bed counts and the room allocation
// plan. No Firestore access here — the API layer applies a plan inside
// transactions so two desks can never book the same bed.

export type HostelGender = 'male' | 'female'

export interface HostelBlock {
  id: string
  name: string
  gender: HostelGender
  warden: string
  active: boolean
}

export interface HostelRoom {
  id: string
  blockId: string
  blockName: string
  gender: HostelGender
  roomNo: string
  capacity: number
  /** Beds currently allocated — maintained by the API in the same transaction as allocations. */
  occupied: number
  status: 'active' | 'maintenance'
}

export interface HostelApplicant {
  studentId: string
  name: string
  regNo: string
  /** Raw gender value from the student record (e.g. "Male", "F"). */
  gender?: string
  /** Distance from home in km; farther students are placed first. */
  distanceKm?: number
  /** ISO timestamp of the application — ties are broken by earliest application. */
  appliedAt?: string
}

export interface HostelAssignment {
  studentId: string
  studentName: string
  regNo: string
  roomId: string
  blockName: string
  roomNo: string
  gender: HostelGender
}

export interface HostelUnplaced {
  studentId: string
  studentName: string
  regNo: string
  reason: string
}

export interface HostelPlan {
  assignments: HostelAssignment[]
  unplaced: HostelUnplaced[]
}

export const HOSTEL_GENDER_LABEL: Record<HostelGender, string> = { male: 'Boys', female: 'Girls' }

/** Maps the free-text gender values found in student records to a hostel gender. */
export function normaliseGender(raw: unknown): HostelGender | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (['m', 'male', 'boy', 'boys', 'man'].includes(v)) return 'male'
  if (['f', 'female', 'girl', 'girls', 'woman'].includes(v)) return 'female'
  return null
}

export function freeBeds(room: Pick<HostelRoom, 'capacity' | 'occupied' | 'status'>): number {
  if (room.status !== 'active') return 0
  return Math.max(0, Math.floor(room.capacity) - Math.floor(room.occupied))
}

export interface HostelSummary {
  gender: HostelGender
  rooms: number
  beds: number
  occupied: number
  free: number
}

/** Bed totals per hostel gender, for the overview cards. */
export function summariseHostel(rooms: HostelRoom[]): Record<HostelGender, HostelSummary> {
  const out: Record<HostelGender, HostelSummary> = {
    male: { gender: 'male', rooms: 0, beds: 0, occupied: 0, free: 0 },
    female: { gender: 'female', rooms: 0, beds: 0, occupied: 0, free: 0 },
  }
  for (const r of rooms) {
    if (r.status !== 'active') continue
    const s = out[r.gender]
    s.rooms += 1
    s.beds += r.capacity
    s.occupied += r.occupied
    s.free += freeBeds(r)
  }
  return out
}

/**
 * Plans bed assignments for the applicants.
 *
 * Order of placement: farther-from-home first (the usual hostel priority),
 * then earliest application, then registration number, so the same input
 * always gives the same plan. Each applicant takes the first room in
 * block/room order with a free bed of their gender. Students who already
 * hold a bed are skipped; students with no recognisable gender are flagged
 * for manual assignment rather than guessed.
 */
export function allocateHostelRooms(
  applicants: HostelApplicant[],
  rooms: HostelRoom[],
  alreadyAllocated: ReadonlySet<string> = new Set(),
): HostelPlan {
  const free = new Map<string, number>()
  for (const r of rooms) free.set(r.id, freeBeds(r))

  const orderedRooms = [...rooms]
    .filter(r => r.status === 'active')
    .sort((a, b) => a.blockName.localeCompare(b.blockName) || a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true }))

  const queue = applicants
    .filter(a => !alreadyAllocated.has(a.studentId))
    .sort((a, b) =>
      (b.distanceKm ?? 0) - (a.distanceKm ?? 0)
      || (a.appliedAt ?? '').localeCompare(b.appliedAt ?? '')
      || a.regNo.localeCompare(b.regNo, undefined, { numeric: true }),
    )

  const assignments: HostelAssignment[] = []
  const unplaced: HostelUnplaced[] = []

  for (const a of queue) {
    const gender = normaliseGender(a.gender)
    if (!gender) {
      unplaced.push({ studentId: a.studentId, studentName: a.name, regNo: a.regNo, reason: 'Gender not recorded — assign manually' })
      continue
    }
    const room = orderedRooms.find(r => r.gender === gender && (free.get(r.id) ?? 0) > 0)
    if (!room) {
      unplaced.push({ studentId: a.studentId, studentName: a.name, regNo: a.regNo, reason: `No free bed in ${HOSTEL_GENDER_LABEL[gender].toLowerCase()} hostel` })
      continue
    }
    free.set(room.id, (free.get(room.id) ?? 0) - 1)
    assignments.push({
      studentId: a.studentId,
      studentName: a.name,
      regNo: a.regNo,
      roomId: room.id,
      blockName: room.blockName,
      roomNo: room.roomNo,
      gender,
    })
  }

  return { assignments, unplaced }
}
