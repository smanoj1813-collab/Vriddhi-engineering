// src/modules/office/api/hostelApi.ts
//
// Hostel blocks, rooms and bed allocations.
//
// Collections (under colleges/{collegeId}/, see firestore.rules):
//   hostelBlocks       one row per hostel building
//   hostelRooms        one row per room; `occupied` is kept in step with allocations
//   hostelAllocations  one row per student holding a bed, keyed by studentId
//
// Every bed change runs in a transaction that re-checks capacity and gender,
// so a stale plan or two desks at once cannot overbook a room. Allocations are
// keyed by studentId, so a student can hold at most one bed.

import { collection, doc, getDocs, orderBy, query, runTransaction, setDoc, type DocumentData } from 'firebase/firestore'
import { db } from '@/Firebase/config'
import { actor, clean, nowIso, officeCol, officeCollegeId, officeDoc, num, str } from './officeDb'
import {
  freeBeds,
  normaliseGender,
  type HostelApplicant,
  type HostelBlock,
  type HostelGender,
  type HostelPlan,
  type HostelRoom,
} from '../utils/hostelEngine'

export interface HostelAllocation {
  id: string
  studentId: string
  studentName: string
  regNo: string
  roomId: string
  blockName: string
  roomNo: string
  gender: HostelGender
  allocatedAt: string
  allocatedBy: string
}

function toBlock(id: string, d: DocumentData): HostelBlock {
  return {
    id,
    name: str(d.name),
    gender: d.gender === 'female' ? 'female' : 'male',
    warden: str(d.warden),
    active: d.active !== false,
  }
}

function toRoom(id: string, d: DocumentData): HostelRoom {
  return {
    id,
    blockId: str(d.blockId),
    blockName: str(d.blockName),
    gender: d.gender === 'female' ? 'female' : 'male',
    roomNo: str(d.roomNo),
    capacity: num(d.capacity),
    occupied: num(d.occupied),
    status: d.status === 'maintenance' ? 'maintenance' : 'active',
  }
}

function toAllocation(id: string, d: DocumentData): HostelAllocation {
  return {
    id,
    studentId: str(d.studentId, id),
    studentName: str(d.studentName),
    regNo: str(d.regNo),
    roomId: str(d.roomId),
    blockName: str(d.blockName),
    roomNo: str(d.roomNo),
    gender: d.gender === 'female' ? 'female' : 'male',
    allocatedAt: str(d.allocatedAt),
    allocatedBy: str(d.allocatedBy),
  }
}

export async function fetchHostelBlocks(cid?: string | null): Promise<HostelBlock[]> {
  const snap = await getDocs(query(officeCol('hostelBlocks', cid), orderBy('name')))
  return snap.docs.map(d => toBlock(d.id, d.data()))
}

export async function fetchHostelRooms(cid?: string | null): Promise<HostelRoom[]> {
  const snap = await getDocs(officeCol('hostelRooms', cid))
  return snap.docs.map(d => toRoom(d.id, d.data()))
    .sort((a, b) => a.blockName.localeCompare(b.blockName) || a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true }))
}

export async function fetchHostelAllocations(cid?: string | null): Promise<HostelAllocation[]> {
  const snap = await getDocs(officeCol('hostelAllocations', cid))
  return snap.docs.map(d => toAllocation(d.id, d.data()))
    .sort((a, b) => a.blockName.localeCompare(b.blockName) || a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true }))
}

export async function saveHostelBlock(input: { id?: string; name: string; gender: HostelGender; warden: string; active: boolean }, cid?: string | null): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new Error('Block name is required')
  const ref = input.id ? officeDoc('hostelBlocks', input.id, cid) : doc(collection(db, 'colleges', officeCollegeId(cid), 'hostelBlocks'))
  await setDoc(ref, clean({ name, gender: input.gender, warden: input.warden.trim(), active: input.active, updatedAt: nowIso() }), { merge: true })
  return ref.id
}

/**
 * Create or edit a room. Editing never lets capacity fall below the beds
 * already allocated — the check runs inside the transaction.
 */
export async function saveHostelRoom(
  input: { id?: string; blockId: string; blockName: string; gender: HostelGender; roomNo: string; capacity: number; status: 'active' | 'maintenance' },
  cid?: string | null,
): Promise<string> {
  const roomNo = input.roomNo.trim()
  if (!roomNo) throw new Error('Room number is required')
  if (!Number.isInteger(input.capacity) || input.capacity < 1) throw new Error('Capacity must be a whole number of at least 1')
  const ref = input.id ? officeDoc('hostelRooms', input.id, cid) : doc(collection(db, 'colleges', officeCollegeId(cid), 'hostelRooms'))
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref)
    const occupied = snap.exists() ? num(snap.data().occupied) : 0
    if (input.capacity < occupied) throw new Error(`Capacity cannot be below the ${occupied} bed(s) already allocated`)
    tx.set(ref, clean({
      blockId: input.blockId,
      blockName: input.blockName,
      gender: input.gender,
      roomNo,
      capacity: input.capacity,
      status: input.status,
      occupied,
      updatedAt: nowIso(),
    }), { merge: true })
  })
  return ref.id
}

/** Books one bed for one student. Throws a readable reason if the bed cannot be given. */
export async function allocateHostelBed(applicant: HostelApplicant, roomId: string, cid?: string | null): Promise<void> {
  const gender = normaliseGender(applicant.gender)
  if (!gender) throw new Error(`${applicant.name}: gender not recorded — cannot allocate automatically`)
  const allocRef = officeDoc('hostelAllocations', applicant.studentId, cid)
  const roomRef = officeDoc('hostelRooms', roomId, cid)
  const who = actor()
  await runTransaction(db, async tx => {
    const existing = await tx.get(allocRef)
    if (existing.exists()) throw new Error(`${applicant.name} already has a bed in ${str(existing.data().blockName)} ${str(existing.data().roomNo)}`)
    const roomSnap = await tx.get(roomRef)
    if (!roomSnap.exists()) throw new Error('Room not found')
    const room = toRoom(roomSnap.id, roomSnap.data())
    if (room.gender !== gender) throw new Error(`${applicant.name}: room is for ${room.gender === 'male' ? 'boys' : 'girls'}`)
    if (freeBeds(room) <= 0) throw new Error(`Room ${room.blockName} ${room.roomNo} has no free bed`)
    tx.set(allocRef, clean({
      studentId: applicant.studentId,
      studentName: applicant.name,
      regNo: applicant.regNo,
      roomId: room.id,
      blockName: room.blockName,
      roomNo: room.roomNo,
      gender,
      allocatedAt: nowIso(),
      allocatedBy: who.name,
      allocatedByUid: who.uid,
    }))
    tx.update(roomRef, { occupied: room.occupied + 1, updatedAt: nowIso() })
  })
}

/** Frees a student's bed. The allocation row is removed, so the bed history is not kept here. */
export async function vacateHostelBed(studentId: string, cid?: string | null): Promise<void> {
  const allocRef = officeDoc('hostelAllocations', studentId, cid)
  await runTransaction(db, async tx => {
    const alloc = await tx.get(allocRef)
    if (!alloc.exists()) throw new Error('This student has no bed allocated')
    const roomRef = officeDoc('hostelRooms', str(alloc.data().roomId), cid)
    const roomSnap = await tx.get(roomRef)
    if (roomSnap.exists()) {
      tx.update(roomRef, { occupied: Math.max(0, num(roomSnap.data().occupied) - 1), updatedAt: nowIso() })
    }
    tx.delete(allocRef)
  })
}

export interface HostelApplyResult {
  placed: number
  failed: Array<{ studentId: string; name: string; reason: string }>
}

/**
 * Applies a plan from allocateHostelRooms one bed at a time. Each bed is its
 * own transaction, so a failure on one student doesn't roll back the others;
 * failures are returned for the desk to review.
 */
export async function applyHostelPlan(plan: HostelPlan, cid?: string | null): Promise<HostelApplyResult> {
  const result: HostelApplyResult = { placed: 0, failed: [] }
  for (const a of plan.assignments) {
    try {
      await allocateHostelBed({ studentId: a.studentId, name: a.studentName, regNo: a.regNo, gender: a.gender }, a.roomId, cid)
      result.placed += 1
    } catch (e) {
      result.failed.push({ studentId: a.studentId, name: a.studentName, reason: e instanceof Error ? e.message : 'Could not allocate' })
    }
  }
  return result
}
