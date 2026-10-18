// src/hooks/useAdminSchedule.ts
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchWeeklySchedules,
  createWeeklySchedule,
  updateWeeklySchedule,
  deactivateWeeklySchedule,
  deleteWeeklySchedule,
  bulkCreateWeeklySchedules,
  fetchFacultyList,
  fetchSubjectsFromFaculty,
  fetchBatchesFromStudents,
  fetchBranchesFromStudents,
  fetchDivisionsFromStudents,
} from '../api/scheduleApi'
import type { WeeklyClassSchedule, WeeklyScheduleFormData, DayOfWeek } from '../types/schedule'
import { useAuth } from '../../auth/context/AuthContext'
import { writeScheduleAudit, type ScheduleAuditEntry } from '../api/curriculumApprovalApi'
import {
  callDeleteDraftSlot,
  callUpsertDraftSlot,
  fetchDraftSchedules,
  type DraftSlotInput,
} from '../api/timetableApprovalApi'

const DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

/** Maps a form row onto the server's draft-slot shape (the server looks up faculty). */
function toDraftSlot(data: Partial<WeeklyScheduleFormData> & { facultyId?: string }): DraftSlotInput {
  return {
    subject: data.subject ?? '',
    subjectCode: data.subjectCode ?? '',
    facultyId: data.facultyId ?? '',
    branch: data.branch ?? '',
    batch: data.batch ?? '',
    semester: Number(data.semester),
    division: data.division ?? '',
    section: data.section ?? '',
    room: data.room ?? '',
    dayOfWeek: data.dayOfWeek ?? '',
    startTime: data.startTime ?? '',
    endTime: data.endTime ?? '',
    type: data.type ?? 'lecture',
    ...(data.assignment !== undefined ? { assignment: data.assignment } : {}),
  }
}

/**
 * `draftMode` is the operations path: reads come from the timetable drafts and
 * every write goes to a draft, so the live timetable changes only after the
 * branch HOD approves it. Other roles keep direct live writes.
 */
export function useAdminSchedule(collegeId: string, options: { draftMode?: boolean } = {}) {
  const draftMode = !!options.draftMode
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Phase 3: every direct live edit leaves an append-only audit entry.
  // A failed entry fails the action so the admin knows the trail is incomplete.
  const auditLive = async (
    action: ScheduleAuditEntry['action'],
    row: Partial<WeeklyClassSchedule> & { count?: number },
  ) => {
    if (draftMode || !user) return
    const what = row.count
      ? `${row.count} classes`
      : [row.subject, row.dayOfWeek, row.startTime && row.endTime ? `${row.startTime}-${row.endTime}` : '']
          .filter(Boolean).join(' · ')
    await writeScheduleAudit({
      collegeId,
      actorUid: user.uid,
      actorName: user.name || user.displayName || user.email || '',
      actorRole: user.role,
      action,
      summary: what || 'class',
      branch: String(row.branch ?? ''),
      semester: Number(row.semester) || 0,
      at: new Date().toISOString(),
    })
  }
  const queryKey = ['weeklySchedules', 'admin', collegeId, draftMode ? 'draft' : 'live']

  const { data: schedules, isLoading: schedulesLoading } = useQuery({
    queryKey,
    queryFn: () => (draftMode
      ? fetchDraftSchedules(collegeId) as unknown as Promise<WeeklyClassSchedule[]>
      : fetchWeeklySchedules(collegeId)),
    enabled: !!collegeId,
  })

  // Fetch reference data for dropdowns
  const { data: facultyList, isLoading: facultyLoading } = useQuery({
    queryKey: ['facultyList', collegeId],
    queryFn: () => fetchFacultyList(collegeId),
    enabled: !!collegeId,
  })

  const { data: subjects, isLoading: subjectsLoading } = useQuery({
    queryKey: ['subjects', collegeId],
    queryFn: () => fetchSubjectsFromFaculty(collegeId),
    enabled: !!collegeId,
  })

  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ['batches', collegeId],
    queryFn: () => fetchBatchesFromStudents(collegeId),
    enabled: !!collegeId,
  })

  const { data: branches, isLoading: branchesLoading } = useQuery({
    queryKey: ['branches', collegeId],
    queryFn: () => fetchBranchesFromStudents(collegeId),
    enabled: !!collegeId,
  })

  const { data: divisions, isLoading: divisionsLoading } = useQuery({
    queryKey: ['divisions', collegeId],
    queryFn: () => fetchDivisionsFromStudents(collegeId),
    enabled: !!collegeId,
  })

  // Group by day
  const weeklySchedule = (schedules || []).reduce((acc, schedule) => {
    const day = schedule.dayOfWeek
    if (!acc[day]) acc[day] = []
    acc[day].push(schedule)
    return acc
  }, {} as Record<DayOfWeek, WeeklyClassSchedule[]>)

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: WeeklyScheduleFormData) => (draftMode
      ? callUpsertDraftSlot({ collegeId, slot: toDraftSlot(data) }).then(() => undefined)
      : createWeeklySchedule(data).then(() => auditLive('create', data as Partial<WeeklyClassSchedule>))),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WeeklyScheduleFormData> }) => {
      if (!draftMode) {
        return updateWeeklySchedule(id, data).then(() =>
          auditLive('update', { ...(schedules || []).find(s => s.id === id), ...(data as Partial<WeeklyClassSchedule>) }))
      }
      // Drafts are replaced whole, so merge the edit onto the current row first.
      const current = (schedules || []).find(s => s.id === id)
      if (!current) throw new Error('That class is no longer in the draft. Refresh and try again.')
      const merged = { ...current, ...data } as unknown as Partial<WeeklyScheduleFormData> & { facultyId?: string }
      return callUpsertDraftSlot({ collegeId, slotId: id, slot: toDraftSlot(merged) }).then(() => undefined)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => (draftMode
      ? callDeleteDraftSlot({ collegeId, slotId: id }).then(() => undefined)
      : deactivateWeeklySchedule(id).then(() => auditLive('deactivate', (schedules || []).find(s => s.id === id) ?? {}))),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => (draftMode
      ? callDeleteDraftSlot({ collegeId, slotId: id }).then(() => undefined)
      : deleteWeeklySchedule(id).then(() => auditLive('delete', (schedules || []).find(s => s.id === id) ?? {}))),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const bulkCreateMutation = useMutation({
    mutationFn: async (items: WeeklyScheduleFormData[]) => {
      if (!draftMode) {
        await bulkCreateWeeklySchedules(items)
        await auditLive('bulk-create', { count: items.length, branch: items[0]?.branch, semester: items[0]?.semester })
        return
      }
      for (const item of items) {
        await callUpsertDraftSlot({ collegeId, slot: toDraftSlot(item) })
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const isLoading =
    schedulesLoading ||
    facultyLoading ||
    subjectsLoading ||
    batchesLoading ||
    branchesLoading ||
    divisionsLoading

  return {
    schedules: schedules || [],
    weeklySchedule,
    facultyList: facultyList || [],
    subjects: subjects || [],
    batches: batches || [],
    branches: branches || [],
    divisions: divisions || [],
    isLoading,
    createSchedule: createMutation.mutate,
    updateSchedule: updateMutation.mutate,
    deactivateSchedule: deactivateMutation.mutate,
    deleteSchedule: deleteMutation.mutate,
    bulkCreate: bulkCreateMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeactivating: deactivateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isBulkCreating: bulkCreateMutation.isPending,
  }
}