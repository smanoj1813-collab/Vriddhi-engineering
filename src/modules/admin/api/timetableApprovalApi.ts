// Client API for timetable approval. Writes go through callables (the server
// enforces the workflow); reads use scoped queries that firestore.rules allow.

import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/Firebase/config'
import type { TimetableApprovalStatus } from '../utils/timetableApproval'

export interface ApprovalRow {
  id: string
  collegeId: string
  branch: string
  branchKey: string
  semester: number
  status: TimetableApprovalStatus
  version: number
  draftCount?: number
  submittedBy?: string
  submittedAt?: string
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
  fallbackReason?: string
  legacyCutover?: boolean
}

export interface DraftSlot {
  id: string
  dayOfWeek: string
  startTime: string
  endTime: string
  subject: string
  subjectCode: string
  facultyId: string
  facultyName: string
  facultyInitials: string
  room: string
  batch: string
  division: string
  type: string
}

/** Slot as entered in the editor; the server validates and cleans it. */
export type SlotInput = Omit<DraftSlot, 'id' | 'facultyInitials'>

export function branchKeyOf(branch: string | null | undefined): string {
  return String(branch ?? '').trim().toLowerCase()
}

export async function listApprovals(collegeId: string, hodDepartment?: string): Promise<ApprovalRow[]> {
  const constraints = [where('collegeId', '==', collegeId)]
  if (hodDepartment) constraints.push(where('branchKey', '==', branchKeyOf(hodDepartment)))
  const snap = await getDocs(query(collection(db, 'timetableApprovals'), ...constraints))
  return snap.docs
    .map(d => ({ id: d.id, ...(d.data() as Omit<ApprovalRow, 'id'>) }))
    .sort((a, b) => `${a.branch}${a.semester}`.localeCompare(`${b.branch}${b.semester}`))
}

export async function listDrafts(collegeId: string, approvalId: string, hodDepartment?: string): Promise<DraftSlot[]> {
  const constraints = [where('collegeId', '==', collegeId), where('approvalId', '==', approvalId)]
  if (hodDepartment) constraints.push(where('branchKey', '==', branchKeyOf(hodDepartment)))
  const snap = await getDocs(query(collection(db, 'timetableDrafts'), ...constraints))
  const order = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  return snap.docs
    .map(d => ({ id: d.id, ...(d.data() as Omit<DraftSlot, 'id'>) }))
    .sort((a, b) => order.indexOf(a.dayOfWeek) - order.indexOf(b.dayOfWeek) || a.startTime.localeCompare(b.startTime))
}

export interface ScopeInput {
  collegeId: string
  branch: string
  semester: number
}

export const callSaveTimetableDraft = (input: ScopeInput & { slots: SlotInput[] }) =>
  httpsCallable<typeof input, { ok: boolean; draftCount: number }>(functions, 'saveTimetableDraft')(input).then(r => r.data)

export const callCopyLiveToDraft = (input: ScopeInput) =>
  httpsCallable<typeof input, { ok: boolean; draftCount: number }>(functions, 'copyLiveToDraft')(input).then(r => r.data)

export const callSubmitTimetable = (input: ScopeInput) =>
  httpsCallable<typeof input, { ok: boolean; version: number }>(functions, 'submitTimetable')(input).then(r => r.data)

export const callReviewTimetable = (input: ScopeInput & {
  decision: 'approve' | 'return'
  note?: string
  fallbackReason?: string
}) =>
  httpsCallable<typeof input, { ok: boolean; status: string; liveCount?: number; retired?: number }>(functions, 'reviewTimetable')(input).then(r => r.data)

export const callMarkLegacyTimetablesApproved = (input: { collegeId: string }) =>
  httpsCallable<typeof input, { ok: boolean; marked: number; skipped: number }>(functions, 'markLegacyTimetablesApproved')(input).then(r => r.data)
