// src/modules/office/hooks/useHostelTransport.ts
// React-query hooks for the hostel and transport offices.

import { useQuery } from '@tanstack/react-query'
import { fetchStudents } from '@/modules/admin/api/dashboardApi'
import { fetchHostelAllocations, fetchHostelBlocks, fetchHostelRooms } from '../api/hostelApi'
import { fetchTransportEnrolments, fetchTransportRoutes } from '../api/transportApi'
import { useCollegeId } from './useLibrary'

export const hostelKeys = {
  blocks: (cid: string) => ['office', 'hostel', 'blocks', cid] as const,
  rooms: (cid: string) => ['office', 'hostel', 'rooms', cid] as const,
  allocations: (cid: string) => ['office', 'hostel', 'allocations', cid] as const,
}

export const transportKeys = {
  routes: (cid: string) => ['office', 'transport', 'routes', cid] as const,
  enrolments: (cid: string) => ['office', 'transport', 'enrolments', cid] as const,
}


export function useHostelBlocks() {
  const cid = useCollegeId()
  return useQuery({ queryKey: hostelKeys.blocks(cid), queryFn: () => fetchHostelBlocks(cid), enabled: !!cid, staleTime: 60 * 1000 })
}

export function useHostelRooms() {
  const cid = useCollegeId()
  return useQuery({ queryKey: hostelKeys.rooms(cid), queryFn: () => fetchHostelRooms(cid), enabled: !!cid, staleTime: 15 * 1000 })
}

export function useHostelAllocations() {
  const cid = useCollegeId()
  return useQuery({ queryKey: hostelKeys.allocations(cid), queryFn: () => fetchHostelAllocations(cid), enabled: !!cid, staleTime: 15 * 1000 })
}

export function useTransportRoutes() {
  const cid = useCollegeId()
  return useQuery({ queryKey: transportKeys.routes(cid), queryFn: () => fetchTransportRoutes(cid), enabled: !!cid, staleTime: 30 * 1000 })
}

export function useTransportEnrolments() {
  const cid = useCollegeId()
  return useQuery({ queryKey: transportKeys.enrolments(cid), queryFn: () => fetchTransportEnrolments(cid), enabled: !!cid, staleTime: 15 * 1000 })
}

/** Active students, used by the pickers. Gender comes from the student doc when present. */
export function useActiveStudents() {
  return useQuery({ queryKey: ['office', 'hostel', 'students'], queryFn: () => fetchStudents(), staleTime: 5 * 60 * 1000 })
}
