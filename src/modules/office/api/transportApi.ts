// src/modules/office/api/transportApi.ts
//
// Transport routes, stops and student enrolments.
//
// Collections (under colleges/{collegeId}/, see firestore.rules):
//   transportRoutes       one row per vehicle route, with its stops embedded
//   transportEnrolments   one row per student boarding a route, keyed by studentId
//
// Enrolment and removal run in transactions that re-check seats and the
// stop, so two desks cannot overfill a vehicle. A student has at most one
// enrolment because the row is keyed by studentId.

import { collection, doc, getDocs, orderBy, query, runTransaction, setDoc, type DocumentData } from 'firebase/firestore'
import { db } from '@/Firebase/config'
import { actor, clean, nowIso, officeCol, officeCollegeId, officeDoc, num, str } from './officeDb'
import { canEnrol, type TransportEnrolment, type TransportRoute, type TransportStop } from '../utils/transportEngine'

export interface TransportRouteInput {
  id?: string
  name: string
  vehicleNo: string
  driver: string
  driverPhone: string
  capacity: number
  active: boolean
  stops: Array<{ id: string; name: string; order: number; annualFee: number }>
}

function toStop(raw: unknown): TransportStop {
  const s = (raw ?? {}) as Record<string, unknown>
  return { id: str(s.id), name: str(s.name), order: num(s.order), annualFee: num(s.annualFee) }
}

function toRoute(id: string, d: DocumentData): TransportRoute {
  const stops = Array.isArray(d.stops) ? d.stops.map(toStop) : []
  return {
    id,
    name: str(d.name),
    vehicleNo: str(d.vehicleNo),
    driver: str(d.driver),
    driverPhone: str(d.driverPhone),
    capacity: num(d.capacity),
    enrolled: num(d.enrolled),
    stops,
    active: d.active !== false,
  }
}

function toEnrolment(id: string, d: DocumentData): TransportEnrolment {
  return {
    studentId: str(d.studentId, id),
    studentName: str(d.studentName),
    regNo: str(d.regNo),
    routeId: str(d.routeId),
    routeName: str(d.routeName),
    stopId: str(d.stopId),
    stopName: str(d.stopName),
    annualFee: num(d.annualFee),
  }
}

export async function fetchTransportRoutes(cid?: string | null): Promise<TransportRoute[]> {
  const snap = await getDocs(query(officeCol('transportRoutes', cid), orderBy('name')))
  return snap.docs.map(d => toRoute(d.id, d.data()))
}

export async function fetchTransportEnrolments(cid?: string | null): Promise<TransportEnrolment[]> {
  const snap = await getDocs(officeCol('transportEnrolments', cid))
  return snap.docs.map(d => toEnrolment(d.id, d.data()))
    .sort((a, b) => a.routeName.localeCompare(b.routeName) || a.stopName.localeCompare(b.stopName) || a.regNo.localeCompare(b.regNo, undefined, { numeric: true }))
}

function validateRouteInput(input: TransportRouteInput): void {
  if (!input.name.trim()) throw new Error('Route name is required')
  if (!input.vehicleNo.trim()) throw new Error('Vehicle number is required')
  if (!Number.isInteger(input.capacity) || input.capacity < 1) throw new Error('Seats must be a whole number of at least 1')
  if (input.stops.length === 0) throw new Error('Add at least one stop')
  if (input.stops.some(s => !s.name.trim())) throw new Error('Every stop needs a name')
  if (input.stops.some(s => s.annualFee < 0)) throw new Error('Stop fees cannot be negative')
}

/**
 * Create or edit a route. The enrolled counter is never written here, so
 * editing a route cannot lose or double-count its students. Seats cannot be
 * cut below the number already enrolled.
 */
export async function saveTransportRoute(input: TransportRouteInput, cid?: string | null): Promise<string> {
  validateRouteInput(input)
  const ref = input.id ? officeDoc('transportRoutes', input.id, cid) : doc(collection(db, 'colleges', officeCollegeId(cid), 'transportRoutes'))
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref)
    const enrolled = snap.exists() ? num(snap.data().enrolled) : 0
    if (input.capacity < enrolled) throw new Error(`Seats cannot be below the ${enrolled} student(s) already enrolled`)
    tx.set(ref, clean({
      name: input.name.trim(),
      vehicleNo: input.vehicleNo.trim(),
      driver: input.driver.trim(),
      driverPhone: input.driverPhone.trim(),
      capacity: input.capacity,
      active: input.active,
      stops: input.stops.map(s => ({ id: s.id, name: s.name.trim(), order: s.order, annualFee: s.annualFee })),
      enrolled,
      updatedAt: nowIso(),
    }), { merge: true })
  })
  return ref.id
}

export interface TransportEnrolRequest {
  studentId: string
  studentName: string
  regNo: string
}

/** Enrols one student at a stop. Checks seats, the stop and any existing enrolment in the same transaction. */
export async function enrolTransport(student: TransportEnrolRequest, routeId: string, stopId: string, cid?: string | null): Promise<void> {
  const enrolRef = officeDoc('transportEnrolments', student.studentId, cid)
  const routeRef = officeDoc('transportRoutes', routeId, cid)
  const who = actor()
  await runTransaction(db, async tx => {
    const existing = await tx.get(enrolRef)
    if (existing.exists()) throw new Error(`${student.studentName} is already enrolled on ${str(existing.data().routeName)} (${str(existing.data().stopName)})`)
    const routeSnap = await tx.get(routeRef)
    const route = routeSnap.exists() ? toRoute(routeSnap.id, routeSnap.data()) : undefined
    const reason = canEnrol(route, stopId)
    if (reason || !route) throw new Error(reason ?? 'Route not found')
    const stop = route.stops.find(s => s.id === stopId)!
    tx.set(enrolRef, clean({
      studentId: student.studentId,
      studentName: student.studentName,
      regNo: student.regNo,
      routeId: route.id,
      routeName: route.name,
      stopId: stop.id,
      stopName: stop.name,
      annualFee: stop.annualFee,
      enrolledAt: nowIso(),
      enrolledBy: who.name,
    }))
    tx.update(routeRef, { enrolled: route.enrolled + 1, updatedAt: nowIso() })
  })
}

/** Removes a student's enrolment and frees the seat. */
export async function removeTransportEnrolment(studentId: string, cid?: string | null): Promise<void> {
  const enrolRef = officeDoc('transportEnrolments', studentId, cid)
  await runTransaction(db, async tx => {
    const enrol = await tx.get(enrolRef)
    if (!enrol.exists()) throw new Error('This student is not enrolled on a route')
    const routeRef = officeDoc('transportRoutes', str(enrol.data().routeId), cid)
    const routeSnap = await tx.get(routeRef)
    if (routeSnap.exists()) {
      tx.update(routeRef, { enrolled: Math.max(0, num(routeSnap.data().enrolled) - 1), updatedAt: nowIso() })
    }
    tx.delete(enrolRef)
  })
}
