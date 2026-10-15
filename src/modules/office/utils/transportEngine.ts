// src/modules/office/utils/transportEngine.ts
//
// Pure transport rules: seat counts per route, stop validation and the
// occupancy summary. Enrolment itself is applied transactionally in the API.

export interface TransportStop {
  id: string
  name: string
  /** Order along the route, starting from 1 at the first pickup. */
  order: number
  /** Annual transport fee for students boarding at this stop, in INR. */
  annualFee: number
}

export interface TransportRoute {
  id: string
  name: string
  vehicleNo: string
  driver: string
  driverPhone: string
  /** Seats on the vehicle. */
  capacity: number
  /** Students currently enrolled — maintained by the API in the same transaction as enrolments. */
  enrolled: number
  stops: TransportStop[]
  active: boolean
}

export interface TransportEnrolment {
  studentId: string
  studentName: string
  regNo: string
  routeId: string
  routeName: string
  stopId: string
  stopName: string
  annualFee: number
}

export function routeSeatsLeft(route: Pick<TransportRoute, 'capacity' | 'enrolled' | 'active'>): number {
  if (!route.active) return 0
  return Math.max(0, Math.floor(route.capacity) - Math.floor(route.enrolled))
}

/** Returns a reason when a student cannot board at this stop, or null when they can. */
export function canEnrol(route: TransportRoute | undefined, stopId: string): string | null {
  if (!route) return 'Route not found'
  if (!route.active) return 'Route is inactive'
  if (!route.stops.some(s => s.id === stopId)) return 'Stop is not on this route'
  if (routeSeatsLeft(route) <= 0) return `${route.name} is full (${route.capacity} seats)`
  return null
}

/** Stops in pickup order, for display and for the stop selector. */
export function orderedStops(route: TransportRoute): TransportStop[] {
  return [...route.stops].sort((a, b) => a.order - b.order)
}

export interface TransportRouteSummary {
  routeId: string
  routeName: string
  capacity: number
  enrolled: number
  seatsLeft: number
  overCapacity: boolean
  stops: Array<{ stopId: string; stopName: string; count: number }>
}

/**
 * Occupancy per route and per stop, computed from the enrolment list (not the
 * stored counter) so that a drifting counter shows up as a mismatch.
 */
export function summariseTransport(routes: TransportRoute[], enrolments: TransportEnrolment[]): TransportRouteSummary[] {
  return routes.map(route => {
    const mine = enrolments.filter(e => e.routeId === route.id)
    return {
      routeId: route.id,
      routeName: route.name,
      capacity: route.capacity,
      enrolled: mine.length,
      seatsLeft: Math.max(0, route.capacity - mine.length),
      overCapacity: mine.length > route.capacity,
      stops: orderedStops(route).map(s => ({
        stopId: s.id,
        stopName: s.name,
        count: mine.filter(e => e.stopId === s.id).length,
      })),
    }
  })
}
