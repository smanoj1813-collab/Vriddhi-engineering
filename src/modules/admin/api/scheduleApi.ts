// src/api/scheduleApi.ts
// ─── Firestore CRUD for Class Schedules (Weekly Recurring + Daily Sessions) ─────────────────

import { sameBranch } from '@/shared/utils/branchKey';
import { db } from '@/Firebase/config'
import {
  collection, query, where, getDocs, addDoc, updateDoc, doc,
  deleteDoc, orderBy, limit, writeBatch, getDoc, deleteField
} from 'firebase/firestore'
import type {
  ClassSchedule,
  ClassStatus,
  ScheduleFilters,
  WeeklyClassSchedule,
  WeeklyScheduleFormData,
  DayOfWeek,
  ClassType,
} from '../types/schedule'
import {
  findClashes,
  findBatchClashes,
  validateScheduleEntry,
  type ScheduleEntry,
  type Clash,
} from '@/shared/utils/timetableConflicts'
import { ensureClassSession } from './classSessionApi'
import { normalizeSessionDate } from '@/shared/utils/sessionDate'
import { divisionValuesFromStudentRecords } from '@/shared/utils/divisionGroups'

export type { ScheduleFilters }

// ─── Read Cap (per-module, NOT shared) ──────────────────

const MAX_READS_PER_SESSION = 2000
let sessionReadCount = 0

function trackRead(docCount: number) {
  sessionReadCount += docCount
  if (sessionReadCount > MAX_READS_PER_SESSION) {
    console.warn(`[ScheduleApi] Session read cap exceeded: ${sessionReadCount}/${MAX_READS_PER_SESSION}`)
  }
}

export function getReadStats() {
  return { used: sessionReadCount, remaining: Math.max(0, MAX_READS_PER_SESSION - sessionReadCount) }
}

export function resetReadStats() {
  sessionReadCount = 0
}

// ─── Helper: Get collegeId from localStorage ──────────────

function getCollegeId(): string {
  const id = localStorage.getItem('vriddhi_college_id')
  if (!id) {
    // Returning '' used to mean `colleges//weeklySchedules` — a query against a path that
    // cannot exist, so the page rendered an empty table and looked like a data problem.
    throw new Error(
      'This sign-in carries no college to scope queries to. Sign out and back in so the ' +
        'token is refreshed; if it persists, an administrator must link this profile to a ' +
        'college (Access Control → Identity repair).'
    )
  }
  return id
}

// ─── Helper: Convert Firestore doc to ClassSchedule ─────

function docToSchedule(d: any, id: string): ClassSchedule {
  return {
    id,
    subject: d.subject || '',
    subjectCode: d.subjectCode || '',
    facultyId: d.facultyId || '',
    facultyName: d.facultyName || '',
    facultyInitials: d.facultyInitials || d.facultyName?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || '',
    branch: d.branch || '',
    batch: d.batch || '',
    semester: d.semester || 0,
    division: d.division || '',
    section: d.section || '',
    room: d.room || '',
    // S2.2: three writers have put three shapes in this field — a yyyy-mm-dd
    // string, an ISO datetime and a Firestore Timestamp. Every filter and sort
    // downstream assumes the string form, so normalise on the way out.
    date: normalizeSessionDate(d.date),
    timeSlot: d.timeSlot || (d.startTime && d.endTime ? `${d.startTime}-${d.endTime}` : ''),
    duration: d.duration || d.durationMinutes || 60,
    type: d.type || 'lecture',
    status: d.status || 'scheduled',
    // The `topicsCovered || topicsPlanned` fallback from the original reader is
    // kept deliberately: rows written before S2.2 only ever had one or the
    // other, and the UI reads whichever is present.
    topicsCovered: d.topicsCovered || d.topicsPlanned || [],
    attendanceCount: d.attendanceCount || 0,
    totalStudents: d.totalStudents || 0,
    notes: d.notes || '',
    createdAt: d.createdAt || new Date().toISOString(),
    updatedAt: d.updatedAt || new Date().toISOString(),
    // ─── Slice 2 fields ──────────────────────────────────────────────────
    weeklyScheduleId: d.weeklyScheduleId || '',
    topicIds: d.topicIds || [],
    durationMinutes: d.durationMinutes || d.duration || 60,
    source: d.source || '',
    attendanceMarked: d.attendanceMarked || false,
    presentCount: d.presentCount || 0,
  }
}

/**
 * Every dated class a recurring slot has produced, earliest first.
 *
 * Equality on `weeklyScheduleId` alone (no composite index needed) and the
 * date/status filtering happens in code: a slot has one document a week, so
 * the result set is small even for a whole term. Used by the reschedule
 * dialog to show exactly which classes a move will touch.
 */
export async function fetchSlotSessions(weeklyScheduleId: string): Promise<ClassSchedule[]> {
  const slotId = String(weeklyScheduleId || '').trim()
  if (!slotId) return []
  try {
    const snap = await getDocs(
      query(
        collection(db, 'classSessions'),
        where('weeklyScheduleId', '==', slotId),
        limit(400)
      )
    )
    trackRead(snap.size)
    return snap.docs
      .map(d => docToSchedule(d.data(), d.id))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch (err) {
    console.error('[ScheduleApi] Slot session fetch failed:', err)
    // A missing read must not break the timetable the admin can still edit —
    // an empty list degrades the dialog to "no dated classes yet".
    return []
  }
}

// ─── Helper: Convert Firestore doc to WeeklyClassSchedule ─

function docToWeeklySchedule(d: any, id: string): WeeklyClassSchedule {
  const rawAssignment = d.assignment
  return {
    id,
    collegeId: d.collegeId || '',
    subject: d.subject || '',
    subjectCode: d.subjectCode || '',
    facultyId: d.facultyId || '',
    facultyName: d.facultyName || '',
    facultyInitials: d.facultyInitials || d.facultyName?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || '',
    branch: d.branch || '',
    batch: d.batch || '',
    semester: d.semester || 0,
    division: d.division || '',
    section: d.section || '',
    room: d.room || '',
    dayOfWeek: d.dayOfWeek || 'monday',
    startTime: d.startTime || '09:00',
    endTime: d.endTime || '10:00',
    type: d.type || 'lecture',
    isActive: d.isActive !== false,
    createdAt: d.createdAt || new Date().toISOString(),
    updatedAt: d.updatedAt || new Date().toISOString(),
    // Optional attached assignment — read defensively so a partial or legacy
    // document never breaks the timetable grid.
    ...(rawAssignment
      && typeof rawAssignment === 'object'
      && String(rawAssignment.title || '').trim()
      ? {
          assignment: {
            title: String(rawAssignment.title).trim(),
            maxScore: Number(rawAssignment.maxScore) || 0,
            deadline: String(rawAssignment.deadline || '').slice(0, 10),
          },
        }
      : {}),
    ...(d.assignmentId ? { assignmentId: String(d.assignmentId) } : {}),
  }
}

// ═══════════════════════════════════════════════════════════════
// DAILY CLASS SESSIONS (existing functionality)
// ═══════════════════════════════════════════════════════════════

export async function fetchSchedules(
  collegeId: string,
  filters: ScheduleFilters & { search?: string }
): Promise<ClassSchedule[]> {
  if (sessionReadCount >= MAX_READS_PER_SESSION) return []
  if (!collegeId) {
    console.warn('[ScheduleApi] No collegeId provided, returning empty')
    return []
  }

  try {
    const constraints: any[] = [
      where('collegeId', '==', collegeId),
      orderBy('date', 'asc'),
      orderBy('timeSlot', 'asc'),
      limit(200),
    ]

    const q = query(collection(db, 'classSessions'), ...constraints)
    const snap = await getDocs(q)
    trackRead(snap.size)

    let schedules = snap.docs.map(d => docToSchedule(d.data(), d.id))

    if (filters.status && filters.status !== 'all') {
      schedules = schedules.filter(s => s.status === filters.status)
    }
    if (filters.dateFrom) {
      schedules = schedules.filter(s => s.date >= filters.dateFrom)
    }
    if (filters.dateTo) {
      schedules = schedules.filter(s => s.date <= filters.dateTo)
    }
    if (filters.branch && filters.branch !== 'all') {
      schedules = schedules.filter(s => sameBranch(s.branch, filters.branch))
    }
    if (filters.batch && filters.batch !== 'all') {
      schedules = schedules.filter(s => s.batch === filters.batch)
    }
    if (filters.faculty && filters.faculty !== 'all') {
      schedules = schedules.filter(s => s.facultyId === filters.faculty)
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      schedules = schedules.filter(s =>
        s.subject.toLowerCase().includes(searchLower) ||
        s.subjectCode.toLowerCase().includes(searchLower) ||
        s.facultyName.toLowerCase().includes(searchLower) ||
        s.branch.toLowerCase().includes(searchLower) ||
        s.room.toLowerCase().includes(searchLower)
      )
    }

    return schedules
  } catch (err) {
    console.error('[ScheduleApi] Fetch failed:', err)
    throw new Error('Failed to load schedules. Please try again.')
  }
}

/**
 * S2.2: this used to `addDoc` straight from the browser with an ISO-datetime
 * `date` and its own field set — one of the two incompatible `classSessions`
 * writers behind audit finding F2. It is now a thin wrapper over
 * `ensureClassSession`, so the shape is decided in one place (the callable) and
 * an ad-hoc class for the same faculty/date/time/subject cannot be created
 * twice.
 */
export async function createSchedule(collegeId: string, data: Partial<ClassSchedule>): Promise<ClassSchedule> {
  const result = await ensureClassSession({
    date: normalizeSessionDate(data.date) || data.date || '',
    weeklyScheduleId: data.weeklyScheduleId,
    facultyId: data.facultyId,
    facultyName: data.facultyName,
    subject: data.subject,
    subjectCode: data.subjectCode,
    branch: data.branch,
    batch: data.batch,
    semester: data.semester,
    division: data.division,
    section: data.section,
    room: data.room,
    // ClassSchedule carries a combined "09:00-10:00" slot; the callable wants
    // the two ends separately.
    startTime: data.timeSlot ? data.timeSlot.split('-')[0]?.trim() : undefined,
    endTime: data.timeSlot ? data.timeSlot.split('-')[1]?.trim() : undefined,
    type: data.type,
  })

  const now = new Date().toISOString()
  return docToSchedule(
    {
      ...data,
      collegeId,
      date: result.date || data.date || '',
      status: (result.status || data.status || 'scheduled') as ClassStatus,
      type: data.type || 'lecture',
      topicsCovered: data.topicsCovered || [],
      attendanceCount: data.attendanceCount || 0,
      totalStudents: data.totalStudents || 0,
      notes: data.notes || '',
      createdAt: now,
      updatedAt: now,
    },
    result.id
  )
}

export async function updateSchedule(collegeId: string, id: string, data: Partial<ClassSchedule>): Promise<void> {
  await updateDoc(doc(db, 'classSessions', id), {
    ...data,
    updatedAt: new Date().toISOString(),
  })
}

export async function deleteSchedule(collegeId: string, id: string): Promise<void> {
  await deleteDoc(doc(db, 'classSessions', id))
}

export async function bulkCreateSchedules(collegeId: string, items: Partial<ClassSchedule>[]): Promise<void> {
  const batch = writeBatch(db)
  const now = new Date().toISOString()
  items.forEach(item => {
    const docRef = doc(collection(db, 'classSessions'))
    batch.set(docRef, {
      ...item,
      collegeId,
      status: item.status || 'scheduled',
      type: item.type || 'lecture',
      topicsCovered: item.topicsCovered || [],
      attendanceCount: 0,
      totalStudents: 0,
      notes: item.notes || '',
      createdAt: now,
      updatedAt: now,
    })
  })
  await batch.commit()
}

export function computeScheduleStats(schedules: ClassSchedule[]) {
  return {
    total: schedules.length,
    scheduled: schedules.filter(s => s.status === 'scheduled').length,
    ongoing: schedules.filter(s => s.status === 'ongoing').length,
    completed: schedules.filter(s => s.status === 'completed').length,
    cancelled: schedules.filter(s => s.status === 'cancelled').length,
  }
}

// ═══════════════════════════════════════════════════════════════
// WEEKLY RECURRING SCHEDULES (NEW — connects Admin → Faculty → Student)
// ═══════════════════════════════════════════════════════════════

const WEEKLY_COLLECTION = 'weeklySchedules'

// ─── Fetch all weekly schedules for a college ───────────

export async function fetchWeeklySchedules(collegeId?: string): Promise<WeeklyClassSchedule[]> {
  const cid = collegeId || getCollegeId()
  console.log('[ScheduleApi] fetchWeeklySchedules — collegeId:', cid)

  if (!cid) {
    console.warn('[ScheduleApi] No collegeId available')
    return []
  }

  try {
    // Simple query: just filter by collegeId, no composite index needed
    const q = query(
      collection(db, WEEKLY_COLLECTION),
      where('collegeId', '==', cid),
      limit(300)
    )
    const snap = await getDocs(q)
    console.log('[ScheduleApi] fetchWeeklySchedules — docs found:', snap.size)
    trackRead(snap.size)

    const results = snap.docs
      .map(d => docToWeeklySchedule(d.data(), d.id))
      .filter(s => s.isActive) // client-side filter for isActive
      .sort((a, b) => {
        const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        const dayDiff = dayOrder.indexOf(a.dayOfWeek) - dayOrder.indexOf(b.dayOfWeek)
        if (dayDiff !== 0) return dayDiff
        return a.startTime.localeCompare(b.startTime)
      })

    console.log('[ScheduleApi] fetchWeeklySchedules — active results:', results.length)
    return results
  } catch (err) {
    console.error('[ScheduleApi] Weekly fetch failed:', err)
    return []
  }
}

// ─── Fetch weekly schedules for a specific faculty ──────

export async function fetchFacultyWeeklySchedule(facultyId: string): Promise<WeeklyClassSchedule[]> {
  console.log('[ScheduleApi] fetchFacultyWeeklySchedule — facultyId:', facultyId)
  if (!facultyId) {
    console.warn('[ScheduleApi] No facultyId provided')
    return []
  }

  try {
    // Keep each Firestore query to one equality constraint. Admin schedules use
    // the faculty profile document ID, while signed-in faculty usually have an
    // Auth UID. Try the UID directly, then resolve its faculty profile.
    const runScheduleQuery = (id: string) => getDocs(query(
      collection(db, WEEKLY_COLLECTION),
      where('facultyId', '==', id),
      limit(100)
    ))

    let snap = await runScheduleQuery(facultyId)
    trackRead(snap.size)

    if (snap.empty) {
      const profileSnap = await getDocs(query(
        collection(db, 'faculty'),
        where('uid', '==', facultyId),
        limit(1)
      ))
      trackRead(profileSnap.size)
      const profileId = profileSnap.docs[0]?.id
      if (profileId && profileId !== facultyId) {
        snap = await runScheduleQuery(profileId)
        trackRead(snap.size)
      }
    }

    console.log('[ScheduleApi] fetchFacultyWeeklySchedule — docs found:', snap.size)
    return snap.docs
      .map(d => docToWeeklySchedule(d.data(), d.id))
      .filter(schedule => schedule.isActive)
      .sort((a, b) => {
        const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        const dayDiff = dayOrder.indexOf(a.dayOfWeek) - dayOrder.indexOf(b.dayOfWeek)
        if (dayDiff !== 0) return dayDiff
        return a.startTime.localeCompare(b.startTime)
      })
  } catch (err) {
    console.error('[ScheduleApi] Faculty weekly fetch failed:', err)
    throw new Error('Failed to load your weekly schedule. Please try again.')
  }
}

// ─── Fetch weekly schedules by faculty NAME (fallback when ID doesn't match) ─

export async function fetchFacultyWeeklyScheduleByName(facultyName: string): Promise<WeeklyClassSchedule[]> {
  console.log('[ScheduleApi] fetchFacultyWeeklyScheduleByName — facultyName:', facultyName)
  if (!facultyName) {
    console.warn('[ScheduleApi] No facultyName provided')
    return []
  }

  try {
    const q = query(
      collection(db, WEEKLY_COLLECTION),
      where('facultyName', '==', facultyName),
      where('isActive', '==', true),
      limit(100)
    )
    const snap = await getDocs(q)
    console.log('[ScheduleApi] fetchFacultyWeeklyScheduleByName — docs found:', snap.size)
    trackRead(snap.size)

    return snap.docs
      .map(d => docToWeeklySchedule(d.data(), d.id))
      .sort((a, b) => {
        const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        const dayDiff = dayOrder.indexOf(a.dayOfWeek) - dayOrder.indexOf(b.dayOfWeek)
        if (dayDiff !== 0) return dayDiff
        return a.startTime.localeCompare(b.startTime)
      })
  } catch (err) {
    console.error('[ScheduleApi] Faculty weekly by name fetch failed:', err)
    return []
  }
}

// ─── Fetch weekly schedules for students (by branch, batch, semester) ─

export async function fetchStudentWeeklySchedule(
  branch: string,
  batch: string,
  semester: number,
  section?: string
): Promise<WeeklyClassSchedule[]> {
  console.log('[ScheduleApi] fetchStudentWeeklySchedule — branch:', branch, 'batch:', batch, 'semester:', semester, 'section:', section)
  if (!branch || !batch || !semester) {
    console.warn('[ScheduleApi] Missing student params')
    return []
  }

  try {
    // Build query with minimal constraints to avoid composite index issues
    const constraints: any[] = [
      where('branch', '==', branch),
      where('batch', '==', batch),
      where('semester', '==', semester),
      where('isActive', '==', true),
      limit(100)
    ]

    if (section) {
      constraints.splice(3, 0, where('section', '==', section))
    }

    const q = query(collection(db, WEEKLY_COLLECTION), ...constraints)
    const snap = await getDocs(q)
    console.log('[ScheduleApi] fetchStudentWeeklySchedule — docs found:', snap.size)
    trackRead(snap.size)

    return snap.docs
      .map(d => docToWeeklySchedule(d.data(), d.id))
      .sort((a, b) => {
        const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        const dayDiff = dayOrder.indexOf(a.dayOfWeek) - dayOrder.indexOf(b.dayOfWeek)
        if (dayDiff !== 0) return dayDiff
        return a.startTime.localeCompare(b.startTime)
      })
  } catch (err) {
    console.error('[ScheduleApi] Student weekly fetch failed:', err)
    return []
  }
}

// ─── Create Weekly Schedule ─────────────────────────────

export async function createWeeklySchedule(data: WeeklyScheduleFormData): Promise<WeeklyClassSchedule> {
  const collegeId = getCollegeId()
  if (!collegeId) {
    throw new Error('No collegeId found. Cannot create schedule.')
  }

  const now = new Date().toISOString()

  // Fetch faculty name
  let facultyName = ''
  let facultyInitials = ''
  try {
    const facultyDoc = await getDoc(doc(db, 'faculty', data.facultyId))
    if (facultyDoc.exists()) {
      const fData = facultyDoc.data()
      facultyName = fData.name || `${fData.firstName || ''} ${fData.lastName || ''}`.trim()
      facultyInitials = facultyName.split(' ').map((n: string) => n[0]).join('').toUpperCase()
    }
  } catch (e) {
    console.warn('[ScheduleApi] Could not fetch faculty name:', e)
  }

  const docData = {
    collegeId,
    subject: data.subject,
    subjectCode: data.subjectCode,
    facultyId: data.facultyId,
    facultyName: facultyName || data.facultyId,
    facultyInitials: facultyInitials || data.facultyId.substring(0, 2).toUpperCase(),
    branch: data.branch,
    batch: data.batch,
    semester: data.semester,
    division: data.division,
    section: data.section || '',
    room: data.room,
    dayOfWeek: data.dayOfWeek,
    startTime: data.startTime,
    endTime: data.endTime,
    type: data.type || 'lecture',
    isActive: true,
    // Optional attached assignment — validated server-side when sessions are
    // generated, so a bad value here only skips the link, not the class.
    ...(data.assignment ? { assignment: data.assignment } : {}),
    createdAt: now,
    updatedAt: now,
  }

  console.log('[ScheduleApi] Creating weekly schedule:', docData)
  const docRef = await addDoc(collection(db, WEEKLY_COLLECTION), docData)
  console.log('[ScheduleApi] Created with ID:', docRef.id)
  return docToWeeklySchedule(docData, docRef.id)
}

// ─── Update Weekly Schedule ─────────────────────────────

export async function updateWeeklySchedule(id: string, data: Partial<WeeklyScheduleFormData>): Promise<void> {
  const updateData: Record<string, any> = {
    updatedAt: new Date().toISOString(),
  }

  if (data.subject !== undefined) updateData.subject = data.subject
  if (data.subjectCode !== undefined) updateData.subjectCode = data.subjectCode
  if (data.facultyId !== undefined) {
    updateData.facultyId = data.facultyId
    try {
      const facultyDoc = await getDoc(doc(db, 'faculty', data.facultyId))
      if (facultyDoc.exists()) {
        const fData = facultyDoc.data()
        const name = fData.name || `${fData.firstName || ''} ${fData.lastName || ''}`.trim()
        updateData.facultyName = name
        updateData.facultyInitials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
      }
    } catch (e) {
      console.warn('[ScheduleApi] Could not fetch faculty name:', e)
    }
  }
  if (data.branch !== undefined) updateData.branch = data.branch
  if (data.batch !== undefined) updateData.batch = data.batch
  if (data.semester !== undefined) updateData.semester = data.semester
  if (data.division !== undefined) updateData.division = data.division
  if (data.section !== undefined) updateData.section = data.section
  if (data.room !== undefined) updateData.room = data.room
  if (data.dayOfWeek !== undefined) updateData.dayOfWeek = data.dayOfWeek
  if (data.startTime !== undefined) updateData.startTime = data.startTime
  if (data.endTime !== undefined) updateData.endTime = data.endTime
  if (data.type !== undefined) updateData.type = data.type
  // Optional attached assignment: `null` removes it (and any materialised
  // link stays on already-generated sessions), an object (re)sets it.
  if (data.assignment !== undefined) {
    if (data.assignment === null) {
      updateData.assignment = deleteField()
      updateData.assignmentId = deleteField()
    } else {
      updateData.assignment = data.assignment
    }
  }

  await updateDoc(doc(db, WEEKLY_COLLECTION, id), updateData)
}

// ─── Soft Delete ────────────────────────────────────────

export async function deactivateWeeklySchedule(id: string): Promise<void> {
  await updateDoc(doc(db, WEEKLY_COLLECTION, id), {
    isActive: false,
    updatedAt: new Date().toISOString(),
  })
}

// ─── Hard Delete Weekly Schedule ────────────────────────

export async function deleteWeeklySchedule(id: string): Promise<void> {
  await deleteDoc(doc(db, WEEKLY_COLLECTION, id))
}

// ─── Bulk Create Weekly Schedules ───────────────────────

export async function bulkCreateWeeklySchedules(items: WeeklyScheduleFormData[]): Promise<void> {
  const collegeId = getCollegeId()
  if (!collegeId) throw new Error('No collegeId found')

  const batch = writeBatch(db)
  const now = new Date().toISOString()

  for (const data of items) {
    let facultyName = ''
    let facultyInitials = ''
    try {
      const facultyDoc = await getDoc(doc(db, 'faculty', data.facultyId))
      if (facultyDoc.exists()) {
        const fData = facultyDoc.data()
        facultyName = fData.name || `${fData.firstName || ''} ${fData.lastName || ''}`.trim()
        facultyInitials = facultyName.split(' ').map((n: string) => n[0]).join('').toUpperCase()
      }
    } catch (e) {
      console.warn('[ScheduleApi] Could not fetch faculty name:', e)
    }

    const docRef = doc(collection(db, WEEKLY_COLLECTION))
    batch.set(docRef, {
      collegeId,
      subject: data.subject,
      subjectCode: data.subjectCode,
      facultyId: data.facultyId,
      facultyName: facultyName || data.facultyId,
      facultyInitials: facultyInitials || data.facultyId.substring(0, 2).toUpperCase(),
      branch: data.branch,
      batch: data.batch,
      semester: data.semester,
      division: data.division,
      section: data.section || '',
      room: data.room,
      dayOfWeek: data.dayOfWeek,
      startTime: data.startTime,
      endTime: data.endTime,
      type: data.type || 'lecture',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
  }

  await batch.commit()
}

// ═══════════════════════════════════════════════════════════════
// FACULTY & STUDENT HELPERS
// ═══════════════════════════════════════════════════════════════

export async function fetchFacultyList(collegeId: string): Promise<{ id: string; name: string; initials: string; department: string }[]> {
  if (!collegeId) {
    console.warn('[ScheduleApi] fetchFacultyList: No collegeId provided')
    return []
  }
  try {
    let q = query(
      collection(db, 'faculty'),
      where('collegeId', '==', collegeId),
      limit(100)
    )
    let snap = await getDocs(q)

    if (snap.empty) {
      console.log('[ScheduleApi] No faculty with collegeId, trying unfiltered...')
      q = query(collection(db, 'faculty'), limit(100))
      snap = await getDocs(q)
    }

    trackRead(snap.size)
    return snap.docs.map(d => {
      const data = d.data()
      const name = data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown'
      const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
      return {
        id: d.id,
        name,
        initials: data.initials || initials,
        department: data.department || '',
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    console.warn('[ScheduleApi] Faculty fetch failed:', err)
    return []
  }
}

export interface SubjectInfo {
  name: string
  code: string
  facultyId: string
  facultyName: string
  ug: boolean
  pg: boolean
}

export async function fetchSubjectsFromFaculty(collegeId: string): Promise<SubjectInfo[]> {
  if (!collegeId) return []
  try {
    let q = query(
      collection(db, 'faculty'),
      where('collegeId', '==', collegeId),
      limit(100)
    )
    let snap = await getDocs(q)

    if (snap.empty) {
      q = query(collection(db, 'faculty'), limit(100))
      snap = await getDocs(q)
    }

    trackRead(snap.size)
    const subjects: SubjectInfo[] = []
    const seen = new Set<string>()

    snap.docs.forEach(d => {
      const data = d.data()
      const facultyName = data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown'

      if (Array.isArray(data.subjectsUG)) {
        data.subjectsUG.forEach((subj: any) => {
          const name = typeof subj === 'string' ? subj : (subj.name || subj.subjectName || '')
          const code = typeof subj === 'string' ? '' : (subj.code || subj.subjectCode || '')
          if (name && !seen.has(name)) {
            seen.add(name)
            subjects.push({ name, code, facultyId: d.id, facultyName, ug: true, pg: false })
          }
        })
      }

      if (Array.isArray(data.subjectsPG)) {
        data.subjectsPG.forEach((subj: any) => {
          const name = typeof subj === 'string' ? subj : (subj.name || subj.subjectName || '')
          const code = typeof subj === 'string' ? '' : (subj.code || subj.subjectCode || '')
          const key = `${name}_${d.id}`
          if (name && !seen.has(key)) {
            seen.add(key)
            const existing = subjects.find(s => s.name === name && s.facultyId === d.id)
            if (existing) {
              existing.pg = true
            } else {
              subjects.push({ name, code, facultyId: d.id, facultyName, ug: false, pg: true })
            }
          }
        })
      }
    })

    return subjects.sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    console.warn('[ScheduleApi] Subjects fetch failed:', err)
    return []
  }
}

export async function fetchBatchesFromStudents(collegeId: string): Promise<string[]> {
  if (!collegeId) return []
  try {
    let q = query(
      collection(db, 'students'),
      where('collegeId', '==', collegeId),
      limit(500)
    )
    let snap = await getDocs(q)

    if (snap.empty) {
      q = query(collection(db, 'students'), limit(500))
      snap = await getDocs(q)
    }

    trackRead(snap.size)
    const batches = new Set<string>()
    snap.docs.forEach(d => {
      const data = d.data()
      const batch = data.batch || data.yearOfAdmission || data.admissionYear || ''
      if (batch) batches.add(String(batch))
    })

    return Array.from(batches).sort()
  } catch (err) {
    console.warn('[ScheduleApi] Batches fetch failed:', err)
    return []
  }
}

export async function fetchBranchesFromStudents(collegeId: string): Promise<string[]> {
  if (!collegeId) return []
  try {
    let q = query(
      collection(db, 'students'),
      where('collegeId', '==', collegeId),
      limit(500)
    )
    let snap = await getDocs(q)

    if (snap.empty) {
      q = query(collection(db, 'students'), limit(500))
      snap = await getDocs(q)
    }

    trackRead(snap.size)
    const branches = new Set<string>()
    snap.docs.forEach(d => {
      const data = d.data()
      const branch = data.branch || data.department || data.course || ''
      if (branch) branches.add(String(branch))
    })

    return Array.from(branches).sort()
  } catch (err) {
    console.warn('[ScheduleApi] Branches fetch failed:', err)
    return []
  }
}

export async function fetchDivisionsFromStudents(collegeId: string): Promise<string[]> {
  if (!collegeId) return []
  try {
    // Never fall back to an unscoped students query: division options are
    // tenant-specific and may be shown in admin mapping/schedule forms.
    const snap = await getDocs(query(
      collection(db, 'students'),
      where('collegeId', '==', collegeId),
      limit(500)
    ))

    trackRead(snap.size)
    return divisionValuesFromStudentRecords(snap.docs.map((document) => document.data()))
  } catch (err) {
    console.warn('[ScheduleApi] Divisions fetch failed:', err)
    return []
  }
}

export function getClassTimeStatus(startTime: string, endTime: string): 'upcoming' | 'ongoing' | 'completed' {
  const now = new Date()
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  if (currentTime < startTime) return 'upcoming'
  if (currentTime > endTime) return 'completed'
  return 'ongoing'
}

export function getTodayDayOfWeek(): DayOfWeek {
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() as DayOfWeek
  return day
}

// ══════════════════════════════════════════════════════════════════════════════════════
// CLASH DETECTION — integrated from timetableConflicts
// ══════════════════════════════════════════════════════════════════════════════════════

export interface ClashCheckResult {
  hasClashes: boolean
  clashes: Clash[]
  warnings: string[]
}

/**
 * Check for clashes when creating a single weekly schedule entry.
 * Returns all clashes found against existing schedules.
 */
export async function checkScheduleClashes(
  entry: Omit<ScheduleEntry, 'id' | 'isActive'>,
  ignoreId?: string
): Promise<ClashCheckResult> {
  const collegeId = entry.collegeId || getCollegeId()
  if (!collegeId) {
    return { hasClashes: false, clashes: [], warnings: ['No collegeId provided'] }
  }

  // Validate the entry first
  const validation = validateScheduleEntry(entry as Partial<ScheduleEntry>)
  if (!validation.valid) {
    return {
      hasClashes: false,
      clashes: [],
      warnings: validation.errors,
    }
  }

  try {
    // Fetch existing schedules for the college
    const existing = await fetchWeeklySchedules(collegeId)
    
    // Convert to ScheduleEntry format for clash detection
    const existingEntries: ScheduleEntry[] = existing
      .filter(s => !ignoreId || s.id !== ignoreId)
      .map(s => ({
        id: s.id,
        collegeId: s.collegeId,
        subject: s.subject,
        subjectCode: s.subjectCode || '',
        facultyId: s.facultyId,
        facultyName: s.facultyName,
        branch: s.branch,
        batch: s.batch,
        semester: s.semester,
        division: s.division,
        section: s.section || '',
        room: s.room,
        dayOfWeek: s.dayOfWeek as DayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        type: (s.type || 'lecture') as ClassType,
        isActive: s.isActive,
      }))

    const clashes = findClashes(entry as ScheduleEntry, existingEntries, ignoreId)

    return {
      hasClashes: clashes.length > 0,
      clashes,
      warnings: validation.warnings,
    }
  } catch (err) {
    console.error('[ScheduleApi] Clash check failed:', err)
    return {
      hasClashes: false,
      clashes: [],
      warnings: ['Failed to check for clashes'],
    }
  }
}

/**
 * Check for clashes in a batch of schedule entries.
 * Useful for bulk create operations.
 */
export async function checkBatchScheduleClashes(
  entries: Array<Omit<ScheduleEntry, 'id' | 'isActive'>>
): Promise<Map<number, Clash[]>> {
  return findBatchClashes(entries)
}

/**
 * Block schedule creation/update if clashes exist.
 * Throws an error with clash details if clashes are found.
 */
export async function createWeeklyScheduleWithClashCheck(
  data: WeeklyScheduleFormData
): Promise<{ schedule: WeeklyClassSchedule; warnings: string[] }> {
  const collegeId = getCollegeId()
  
  const entry = {
    collegeId,
    subject: data.subject,
    subjectCode: data.subjectCode,
    facultyId: data.facultyId,
    facultyName: '',
    branch: data.branch,
    batch: data.batch,
    semester: data.semester,
    division: data.division,
    section: data.section || '',
    room: data.room,
    dayOfWeek: data.dayOfWeek,
    startTime: data.startTime,
    endTime: data.endTime,
    type: data.type || 'lecture',
  }

  const clashResult = await checkScheduleClashes(entry)
  
  if (clashResult.hasClashes) {
    const messages = clashResult.clashes.map(c => c.message).join('; ')
    throw new Error(`Schedule clash detected: ${messages}`)
  }

  const schedule = await createWeeklySchedule(data)
  return { schedule, warnings: clashResult.warnings }
}

/**
 * Update weekly schedule with clash check (excludes current entry).
 */
export async function updateWeeklyScheduleWithClashCheck(
  id: string,
  data: Partial<WeeklyScheduleFormData>
): Promise<void> {
  // Get current schedule to build the full entry
  const existingQuery = query(
    collection(db, WEEKLY_COLLECTION),
    where('collegeId', '==', getCollegeId()),
    limit(1)
  )
  const existingSnap = await getDocs(existingQuery)
  
  // Build the entry with updates applied
  const entry: Omit<ScheduleEntry, 'id' | 'isActive'> = {
    collegeId: getCollegeId(),
    subject: data.subject || '',
    subjectCode: data.subjectCode || '',
    facultyId: data.facultyId || '',
    facultyName: '',
    branch: data.branch || '',
    batch: data.batch || '',
    semester: data.semester || 0,
    division: data.division || '',
    section: data.section || '',
    room: data.room || '',
    dayOfWeek: data.dayOfWeek || 'monday',
    startTime: data.startTime || '09:00',
    endTime: data.endTime || '10:00',
    type: data.type || 'lecture',
  }

  const clashResult = await checkScheduleClashes(entry, id)
  
  if (clashResult.hasClashes) {
    const messages = clashResult.clashes.map(c => c.message).join('; ')
    throw new Error(`Schedule clash detected: ${messages}`)
  }

  await updateWeeklySchedule(id, data)
}

/**
 * Bulk create weekly schedules with clash check for each entry.
 * Returns list of failed entries with clash reasons.
 */
export async function bulkCreateWeeklySchedulesWithClashCheck(
  items: WeeklyScheduleFormData[]
): Promise<{ success: number; failed: Array<{ index: number; reason: string }> }> {
  const collegeId = getCollegeId()
  const result = { success: 0, failed: [] as Array<{ index: number; reason: string }> }

  // First check for internal clashes within the batch
  const batchEntries = items.map(item => ({
    collegeId,
    subject: item.subject,
    subjectCode: item.subjectCode,
    facultyId: item.facultyId,
    facultyName: '',
    branch: item.branch,
    batch: item.batch,
    semester: item.semester,
    division: item.division,
    section: item.section || '',
    room: item.room,
    dayOfWeek: item.dayOfWeek,
    startTime: item.startTime,
    endTime: item.endTime,
    type: item.type || 'lecture',
  }))

  const internalClashes = findBatchClashes(batchEntries)
  
  // Check against existing schedules
  for (let i = 0; i < items.length; i++) {
    if (internalClashes.has(i)) {
      result.failed.push({
        index: i,
        reason: `Internal clash with another entry in this batch`,
      })
      continue
    }

    try {
      await createWeeklyScheduleWithClashCheck(items[i])
      result.success++
    } catch (err: any) {
      result.failed.push({
        index: i,
        reason: err.message || 'Unknown error',
      })
    }
  }

  return result
}
