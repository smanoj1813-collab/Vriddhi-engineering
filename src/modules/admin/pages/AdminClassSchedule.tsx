// src/pages/AdminClassSchedule.tsx
import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import AutoScheduleDialog from './AutoScheduleDialog'
import AutoMapDialog from '../components/AutoMapDialog'
import { useCurriculumMapping } from '../hooks/useCurriculumMapping'
import type { CurriculumDoc } from '../../../shared/types/curriculum'
import HolidayBanner from '@/shared/components/HolidayBanner'
import { useAcademicCalendar } from '@/shared/hooks/useAcademicCalendar'
import { KARNATAKA_PUBLIC_HOLIDAYS } from '@/shared/data/karnatakaPublicHolidays'
import { eventCoversDate } from '@/shared/types/calendarEvent'
import MergedDivisionChip from '@/shared/components/MergedDivisionChip'

import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Select,
  FormControl,
  FormHelperText,
  InputLabel,
  ListItemText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Tabs,
  Tab,
  Card,
  CardContent,
  Tooltip,
  Alert,
  Snackbar,
  Divider,
  Stack,
  Paper,
  Checkbox,
  FormControlLabel,
  Autocomplete,
} from '@mui/material'
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  UploadFile as UploadIcon,
  Download as DownloadIcon,
  CalendarToday as CalendarIcon,
  AutoFixHigh as AutoIcon,
  EventBusy as EventBusyIcon,
  AutoAwesomeMotion as MaterialiseIcon,
  Assignment as AssignmentIcon,
} from '@mui/icons-material'
import { useAdminSchedule } from '../hooks/useAdminSchedule'
import { useAuth } from '../../auth/context/AuthContext'
import {
  generateClassSessions,
  cancelWeeklySchedule,
  defaultTermWindow,
  isValidDateKey,
  SessionConflictError,
  type GenerateSessionsResult,
  type SessionConflict,
} from '../api/classSessionApi'
import { downloadTimetablePDF, downloadTimetableJPG, cohortLabel } from '@/shared/utils/timetableExport'
import { divisionOptions as buildDivisionOptions, divisionSelection, divisionSelectionValue } from '@/shared/utils/divisionGroups'
import type { WeeklyScheduleFormData, DayOfWeek, ClassType } from '../types/schedule'
import type { SubjectInfo } from '../api/scheduleApi'
import {
  previewScheduleImport,
  applyScheduleImport,
  type ScheduleImportResult,
} from '../api/scheduleImportApi'

const DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const CLASS_TYPES: ClassType[] = ['lecture', 'lab', 'tutorial', 'seminar', 'workshop']

const EMPTY_FORM: WeeklyScheduleFormData = {
  subject: '',
  subjectCode: '',
  facultyId: '',
  branch: '',
  batch: '',
  semester: 1,
  division: '',
  section: '',
  room: '',
  dayOfWeek: 'monday',
  startTime: '09:00',
  endTime: '10:00',
  type: 'lecture',
}

// ─── Helper: Get actual date for a day of week ────────
function getDateForDayOfWeek(dayOfWeek: DayOfWeek): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const targetDay = days.indexOf(dayOfWeek)
  const today = new Date()
  const currentDay = today.getDay()
  const diff = targetDay - currentDay
  const targetDate = new Date(today)
  targetDate.setDate(today.getDate() + diff)
  return targetDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Helper: Get next occurrence date ──────────────────
function getNextOccurrence(dayOfWeek: DayOfWeek): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const targetDay = days.indexOf(dayOfWeek)
  const today = new Date()
  const currentDay = today.getDay()
  let diff = targetDay - currentDay
  if (diff < 0) diff += 7
  if (diff === 0) diff = 7 // if today, show next week
  const targetDate = new Date(today)
  targetDate.setDate(today.getDate() + diff)
  return targetDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ─── Helper: next occurrence as a yyyy-mm-dd key (holiday banner, v2 P4) ─────
function dateKeyForNextOccurrence(dayOfWeek: DayOfWeek): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const targetDay = days.indexOf(dayOfWeek)
  const today = new Date()
  const currentDay = today.getDay()
  let diff = targetDay - currentDay
  if (diff < 0) diff += 7
  if (diff === 0) diff = 7 // mirror getNextOccurrence: today → next week
  const targetDate = new Date(today)
  targetDate.setDate(today.getDate() + diff)
  return `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`
}

// ─── CSV Template ─────────────────────────────────────
const CSV_TEMPLATE = `subject,subjectCode,facultyId,facultyName,branch,batch,semester,division,section,room,dayOfWeek,startTime,endTime,type
Business Statistics,BST101,faculty_id_here,Dr. Smith,B.Com,2026,4,"A,B",,301,monday,09:00,10:00,lecture
Financial Accounting,FAC101,faculty_id_here,Dr. Jones,B.Com,2026,4,A,A,302,monday,10:00,11:00,lecture
Computer Applications,CAP101,faculty_id_here,Dr. Lee,BCA,2026,4,B,B,303,tuesday,09:00,10:00,lab`

const AdminClassSchedule: React.FC = () => {
  const { user } = useAuth()
  const collegeId = user?.collegeId || localStorage.getItem('vriddhi_college_id') || ''
  const location = useLocation()
  const navigate = useNavigate()
  const calendarQuery = useAcademicCalendar(collegeId || undefined)

  // ─── Prefill from AdminCurriculum "Schedule Class" ────────────────────
  // AdminCurriculum navigates here with state.prefill for the selected mapping.
  const prefill = useMemo(() => {
    const state = location.state as { prefill?: Partial<WeeklyScheduleFormData> } | null
    return state?.prefill ?? null
  }, [location.state])

  // Operations edits the timetable as drafts; the HOD approves before it is live.
  const draftMode = user?.role === 'operations'
  const {
    weeklySchedule,
    facultyList,
    subjects,
    batches,
    branches,
    divisions,
    isLoading,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    isCreating,
    isUpdating,
  } = useAdminSchedule(collegeId, { draftMode })

  const [selectedDay, setSelectedDay] = useState<DayOfWeek>('monday')
  // ─── Timetable export (PDF / JPG) ───
  const [exportOpen, setExportOpen] = useState(false)
  const [exportCohort, setExportCohort] = useState('__all__')
  const [exporting, setExporting] = useState<'' | 'pdf' | 'jpg'>('')
  const allSlots = useMemo(
    () => DAYS.flatMap((d) => (weeklySchedule[d] || []).filter((s: any) => s.isActive !== false)),
    [weeklySchedule]
  )
  const divisionOptions = useMemo(
    () => buildDivisionOptions([...divisions, ...allSlots.map((slot: any) => slot.division)]),
    [divisions, allSlots],
  )
  const cohortOptions = useMemo(
    () => [...new Set(allSlots.map((s: any) => cohortLabel(s)).filter(Boolean))].sort(),
    [allSlots]
  )
  const handleExport = async (format: 'pdf' | 'jpg') => {
    const all = exportCohort === '__all__'
    const slots = all ? allSlots : allSlots.filter((s: any) => cohortLabel(s) === exportCohort)
    const opts = {
      title: `${(user as any)?.collegeName || 'Class'} — Weekly Timetable`,
      subtitle: all ? 'All classes' : exportCohort,
      days: DAYS,
      slots,
      showCohort: all,
      fileName: `timetable_${(all ? 'all' : exportCohort).replace(/[^a-z0-9]+/gi, '_')}`,
    }
    setExporting(format)
    try {
      if (format === 'pdf') await downloadTimetablePDF(opts)
      else await downloadTimetableJPG(opts)
    } catch (err) {
      console.error('[timetable export]', err)
      alert('Export failed. Please try again.')
    } finally {
      setExporting('')
    }
  }
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<WeeklyScheduleFormData>({ ...EMPTY_FORM })
  // Optional "attach an assignment" toggle — the timetable-side equivalent of
  // the faculty's curriculum link. generateClassSessions turns it into one
  // draft assignment per slot for the faculty to publish.
  const [attachAssignment, setAttachAssignment] = useState(false)
  const [assignTitle, setAssignTitle] = useState('')
  const [assignMaxScore, setAssignMaxScore] = useState(20)
  const [assignDeadline, setAssignDeadline] = useState('')
  const [snackbar, setSnackbar] = useState<{
    open: boolean
    message: string
    severity: 'success' | 'error' | 'warning'
  }>({
    open: false,
    message: '',
    severity: 'success',
  })
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [autoScheduleOpen, setAutoScheduleOpen] = useState(false)
  // Auto-map moved here from the principal's Curriculum page. Operations picks
  // the curriculum, maps faculty, then auto-generates a draft.
  const curriculumMapping = useCurriculumMapping(collegeId)
  const [autoMapPickerOpen, setAutoMapPickerOpen] = useState(false)
  const [autoMapPickId, setAutoMapPickId] = useState('')
  const [autoMapCurriculum, setAutoMapCurriculum] = useState<CurriculumDoc | null>(null)
  const queryClient = useQueryClient()
  const [csvText, setCsvText] = useState('')
  // Server-side import review: preview (dryRun) → apply. Nothing is written
  // until the admin sees the per-row report and confirms.
  const [importPreview, setImportPreview] = useState<ScheduleImportResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // ─── Slice 2: materialise weekly slots into real class sessions ────────
  // The grid above is the *plan*; classSessions are the *actual*. Until Slice 2
  // nothing connected them, so a class only existed once somebody typed it in.
  const [generateOpen, setGenerateOpen] = useState(false)
  const [generateWindow, setGenerateWindow] = useState(() => defaultTermWindow())
  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<GenerateSessionsResult | null>(null)
  const [generateConflicts, setGenerateConflicts] = useState<SessionConflict[]>([])
  const [skipConflicting, setSkipConflicting] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const missingKnownHolidays = useMemo(() => {
    const { from, to } = generateWindow
    if (!isValidDateKey(from) || !isValidDateKey(to) || from > to || !calendarQuery.data) return []
    return KARNATAKA_PUBLIC_HOLIDAYS
      .filter((holiday) => holiday.date >= from && holiday.date <= to)
      // A suspending holiday blocks a date; an explicit non-suspending event
      // means the college reviewed the date and intentionally teaches.
      .filter((holiday) => !(calendarQuery.data ?? []).some((event) => eventCoversDate(event, holiday.date)))
  }, [generateWindow, calendarQuery.data])

  // ─── Apply prefill from AdminCurriculum "Schedule Class" ──────────────
  useEffect(() => {
    if (!prefill || !prefill.subject) return
    setFormData({
      ...EMPTY_FORM,
      subject: prefill.subject || '',
      subjectCode: prefill.subjectCode || '',
      facultyId: prefill.facultyId || '',
      branch: prefill.branch || '',
      batch: prefill.batch || '',
      semester: prefill.semester ?? 1,
      division: prefill.division || '',
      section: prefill.section || '',
      dayOfWeek: 'monday',
      startTime: '09:00',
      endTime: '10:00',
      type: 'lecture',
      room: '',
    })
    resetAssignmentForm()
    setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  const daySchedules = weeklySchedule[selectedDay] || []

  // Subjects the selected faculty is mapped to, then every other subject the
  // college teaches. A principal (or an admin covering for a faculty member
  // whose subject mapping is missing) can always pick a subject, and can type
  // one that is not in the list at all — the subject is a required field, but
  // an empty dropdown must never be the reason a class cannot be scheduled.
  const facultySubjects = useMemo(() => {
    if (!formData.facultyId) return []
    return subjects.filter(s => s.facultyId === formData.facultyId)
  }, [formData.facultyId, subjects])

  const subjectOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: SubjectInfo[] = []
    for (const subject of [...facultySubjects, ...subjects]) {
      const key = subject.name.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      options.push(subject)
    }
    return options
  }, [facultySubjects, subjects])

  const resetAssignmentForm = () => {
    setAttachAssignment(false)
    setAssignTitle('')
    setAssignMaxScore(20)
    setAssignDeadline('')
  }

  const applyAssignmentForm = (schedule?: typeof daySchedules[0]) => {
    setAttachAssignment(Boolean(schedule?.assignment))
    setAssignTitle(schedule?.assignment?.title || '')
    setAssignMaxScore(schedule?.assignment?.maxScore || 20)
    setAssignDeadline(schedule?.assignment?.deadline || '')
  }

  const handleOpen = (schedule?: typeof daySchedules[0]) => {
    if (schedule) {
      setEditingId(schedule.id)
      setFormData({
        subject: schedule.subject,
        subjectCode: schedule.subjectCode,
        facultyId: schedule.facultyId,
        branch: schedule.branch,
        batch: schedule.batch,
        semester: schedule.semester,
        division: schedule.division,
        section: schedule.section || '',
        room: schedule.room,
        dayOfWeek: schedule.dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        type: schedule.type,
      })
      applyAssignmentForm(schedule)
    } else {
      setEditingId(null)
      setFormData({ ...EMPTY_FORM, dayOfWeek: selectedDay })
      resetAssignmentForm()
    }
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
    setEditingId(null)
    setFormData({ ...EMPTY_FORM })
    resetAssignmentForm()
  }

  const handleSubmit = () => {
    const missing = ([
      ['Subject', formData.subject],
      ['Faculty', formData.facultyId],
      ['Branch', formData.branch],
      ['Batch', formData.batch],
      ['Room', formData.room],
    ] as Array<[string, string]>).filter(([, value]) => !value).map(([label]) => label)
    if (missing.length > 0) {
      setSnackbar({
        open: true,
        message: `Please fill: ${missing.join(', ')}. Type the subject name if it is not in the list.`,
        severity: 'error',
      })
      return
    }

    if (attachAssignment) {
      if (!assignTitle.trim() || !assignDeadline || !(Number(assignMaxScore) > 0)) {
        setSnackbar({ open: true, message: 'Attach assignment needs a title, max score and deadline', severity: 'error' })
        return
      }
      if (assignDeadline < new Date().toISOString().slice(0, 10)) {
        setSnackbar({ open: true, message: 'The assignment deadline must be in the future', severity: 'error' })
        return
      }
    }

    // Editing a slot that previously had an attachment: unchecking the toggle
    // clears it. Creating without the toggle leaves the field out entirely.
    const assignmentPayload = attachAssignment
      ? { title: assignTitle.trim(), maxScore: Number(assignMaxScore), deadline: assignDeadline }
      : editingId ? null : undefined

    if (editingId) {
      updateSchedule(
        { id: editingId, data: { ...formData, assignment: assignmentPayload ?? null } },
        {
          onSuccess: () => {
            setSnackbar({ open: true, message: 'Schedule updated successfully', severity: 'success' })
            handleClose()
          },
          onError: () => {
            setSnackbar({ open: true, message: 'Failed to update schedule', severity: 'error' })
          },
        }
      )
    } else {
      createSchedule(
        {
          ...formData,
          ...(assignmentPayload ? { assignment: assignmentPayload } : {}),
        },
        {
          onSuccess: () => {
            setSnackbar({ open: true, message: 'Schedule created successfully', severity: 'success' })
            handleClose()
          },
          onError: () => {
            setSnackbar({ open: true, message: 'Failed to create schedule', severity: 'error' })
          },
        }
      )
    }
  }

  const handleDuplicate = (schedule: typeof daySchedules[0]) => {
    setFormData({
      subject: schedule.subject,
      subjectCode: schedule.subjectCode,
      facultyId: schedule.facultyId,
      branch: schedule.branch,
      batch: schedule.batch,
      semester: schedule.semester,
      division: schedule.division,
      section: schedule.section || '',
      room: schedule.room,
      dayOfWeek: schedule.dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      type: schedule.type,
    })
    // The copy starts unattached; the admin can re-enable the same config.
    applyAssignmentForm(undefined)
    setEditingId(null)
    setOpen(true)
  }

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this schedule?')) {
      deleteSchedule(id, {
        onSuccess: () => setSnackbar({ open: true, message: 'Schedule deleted', severity: 'success' }),
        onError: () => setSnackbar({ open: true, message: 'Failed to delete', severity: 'error' }),
      })
    }
  }

  // ─── Slice 2 S2.1: generate / cancel real class sessions ────────────────
  // Server-side callables: the college is taken from the caller's auth claim,
  // not from localStorage, and generation is idempotent so a double-click
  // cannot double-book a term.

  const handleOpenGenerate = () => {
    setGenerateWindow(defaultTermWindow())
    setGenerateResult(null)
    setGenerateConflicts([])
    setSkipConflicting(false)
    setGenerateOpen(true)
  }

  const handleGenerate = async () => {
    const { from, to } = generateWindow
    if (!isValidDateKey(from) || !isValidDateKey(to)) {
      setSnackbar({ open: true, message: 'Enter both dates as yyyy-mm-dd', severity: 'error' })
      return
    }
    if (from > to) {
      setSnackbar({ open: true, message: 'The start date must be on or before the end date', severity: 'error' })
      return
    }
    if (calendarQuery.isError) {
      setSnackbar({ open: true, message: 'Could not verify the academic calendar. Restore calendar access before generating sessions.', severity: 'error' })
      return
    }
    if (calendarQuery.isLoading || calendarQuery.data === undefined) {
      setSnackbar({ open: true, message: 'Wait for the academic calendar to load before generating sessions.', severity: 'warning' })
      return
    }
    if (missingKnownHolidays.length > 0) {
      setSnackbar({ open: true, message: 'Add or import the known holidays before generating sessions. If the college teaches on one, add an explicit non-suspending calendar event.', severity: 'warning' })
      return
    }
    setGenerating(true)
    setGenerateResult(null)
    setGenerateConflicts([])
    try {
      const result = await generateClassSessions({ from, to, skipConflicting })
      setGenerateResult(result)
      setGenerateConflicts(result.conflicts || [])
      const skipped = result.skippedConflicts || 0
      const skippedHolidays = result.skippedHolidayCount || 0
      const cancelledHolidays = result.cancelledHolidaySessions || 0
      const linked = result.assignmentsLinked || 0
      const linkedNote =
        linked > 0
          ? ` ${linked} attached assignment draft(s) were created — the faculty publishes them from Assignments.`
          : ''
      const holidayNote = [
        skippedHolidays > 0 ? ` ${skippedHolidays} occurrence(s) were excluded by the academic calendar.` : '',
        cancelledHolidays > 0 ? ` ${cancelledHolidays} already-generated future session(s) were cancelled for holidays.` : '',
      ].join('')
      setSnackbar({
        open: true,
        severity: skipped > 0 || cancelledHolidays > 0 ? 'warning' : 'success',
        message:
          result.created === 0 && skipped === 0 && skippedHolidays === 0 && cancelledHolidays === 0
            ? `Already up to date — ${result.skippedExisting} session(s) existed for ${result.slotsScanned} slot(s), nothing new created.${linkedNote}`
            : skipped > 0
              ? `Created ${result.created} session(s) and skipped ${skipped} that would double-book a faculty member or a room.${holidayNote}${linkedNote}`
              : `Created ${result.created} class session(s) from ${result.slotsScanned} weekly slot(s).${holidayNote}${linkedNote}`,
      })
    } catch (error) {
      // S2.5: the server refuses to materialise a timetable that double-books.
      // Surface the individual clashes so the admin can fix the slot rather
      // than guess which one blocked the run.
      if (error instanceof SessionConflictError) {
        setGenerateConflicts(error.conflicts)
        setSnackbar({ open: true, severity: 'error', message: error.message })
      } else {
        setSnackbar({
          open: true,
          severity: 'error',
          message: error instanceof Error ? error.message : 'Failed to generate class sessions',
        })
      }
    } finally {
      setGenerating(false)
    }
  }

  const handleCancelSlot = async (schedule: typeof daySchedules[0]) => {
    const confirmed = window.confirm(
      `Cancel "${schedule.subject}" (${schedule.dayOfWeek} ${schedule.startTime})?\n\n` +
        'Every unmarked session it generated from today onwards will be cancelled and the slot ' +
        'will be switched off. Past and already-marked sessions are left untouched.'
    )
    if (!confirmed) return
    setCancellingId(schedule.id)
    try {
      const result = await cancelWeeklySchedule({
        weeklyScheduleId: schedule.id,
        reason: 'Cancelled from the timetable manager',
      })
      setSnackbar({
        open: true,
        severity: 'success',
        message:
          result.cancelled === 0
            ? 'Slot switched off — no future unmarked sessions needed cancelling.'
            : `Slot switched off and ${result.cancelled} future session(s) cancelled.`,
      })
    } catch (error) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: error instanceof Error ? error.message : 'Failed to cancel the weekly schedule',
      })
    } finally {
      setCancellingId(null)
    }
  }

  // ─── Bulk Upload ──────────────────────────────────────
  const handleDownloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'schedule_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Bulk import, step 1: server-side preview (writes nothing) ──────────────
  // The old client-side split(',') + writeBatch had no validation or clash
  // check. Now the callable parses, normalises, de-duplicates, runs the same
  // clash maths as generateClassSessions, and cross-references the curriculum
  // mappings — then we only apply what the admin approves.
  const handlePreviewImport = async () => {
    if (!csvText.trim()) {
      setImportError('Paste the CSV content first')
      return
    }
    setPreviewing(true)
    setImportError(null)
    setImportPreview(null)
    try {
      const res = await previewScheduleImport({ csv: csvText })
      setImportPreview(res)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to preview the import')
    } finally {
      setPreviewing(false)
    }
  }

  // ── Bulk import, step 2: apply the valid rows ─────────────────────────────
  const handleApplyImport = async () => {
    if (!importPreview || importPreview.plan.totals.valid === 0) return
    setPreviewing(true)
    setImportError(null)
    try {
      const res = await applyScheduleImport({ csv: csvText })
      const skipped = res.plan.totals.total - res.plan.totals.valid
      setSnackbar({
        open: true,
        message: `${res.created ?? res.plan.totals.valid} schedule(s) imported${skipped > 0 ? `, ${skipped} skipped` : ''}`,
        severity: 'success',
      })
      setBulkDialogOpen(false)
      setCsvText('')
      setImportPreview(null)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to apply the import')
    } finally {
      setPreviewing(false)
    }
  }

  const closeBulkDialog = () => {
    setBulkDialogOpen(false)
    setCsvText('')
    setImportPreview(null)
    setImportError(null)
  }

  if (!collegeId) {
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', gap: 2 }}>
        <Typography variant="h6" color="warning.main">⚠ College ID not found</Typography>
        <Typography color="text.secondary" sx={{ textAlign: 'center', maxWidth: 480 }}>
          Your account does not have a college ID linked. Please log out and log back in,
          or contact your administrator to link your account to a college.
        </Typography>
      </Box>
    )
  }

  if (isLoading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Typography>Loading schedules...</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* Header */}
      {draftMode && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Changes here are drafts. Students and faculty see a branch's timetable only after its HOD approves it.
          Generating sessions and bulk upload are disabled until the timetable is approved.
          Auto-generate saves a draft for HOD approval.
        </Alert>
      )}
      {!draftMode && user?.role === 'admin' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Direct edits here go live at once and skip the HOD approval. Every change is logged in the audit trail, which the principal can see.
        </Alert>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 500 }}>
            Class Schedule Manager
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {draftMode
              ? 'Prepare branch and semester timetables as drafts, then send them to the HOD'
              : 'Manage weekly recurring class schedules for all branches and batches'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => setExportOpen(true)}
          >
            Download
          </Button>
{!draftMode && (
          <Tooltip title="Creates dated class sessions from this weekly timetable for a term — needed for faculty attendance, rescheduling and the student timetable.">
          <Button
            variant="outlined"
            startIcon={<MaterialiseIcon />}
            onClick={handleOpenGenerate}
          >
            Generate Sessions
          </Button>
          </Tooltip>

)}<Button
            variant="outlined"
            startIcon={<AutoIcon />}
            onClick={() => setAutoMapPickerOpen(true)}
            disabled={curriculumMapping.curriculumList.length === 0}
          >
            Auto-Map Faculty
          </Button>
        {(
          <Button
            variant="outlined"
            startIcon={<AutoIcon />}
            onClick={() => setAutoScheduleOpen(true)}
          >
            Auto Generate
          </Button>

)}{!draftMode && (
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => setBulkDialogOpen(true)}
          >
            Bulk Upload
          </Button>

)}          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpen()}
            disabled={isCreating}
          >
            Add Class
          </Button>
        </Box>
      </Box>

      <Dialog open={autoMapPickerOpen} onClose={() => setAutoMapPickerOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Auto-map faculty</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Curriculum</InputLabel>
            <Select
              label="Curriculum"
              value={autoMapPickId}
              onChange={e => setAutoMapPickId(String(e.target.value))}
            >
              {curriculumMapping.curriculumList.map(c => (
                <MenuItem key={c.id} value={c.id}>
                  {c.branch} · Semester {c.semester}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAutoMapPickerOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!autoMapPickId}
            onClick={() => {
              const picked = curriculumMapping.curriculumList.find(c => c.id === autoMapPickId) || null
              setAutoMapCurriculum(picked)
              setAutoMapPickerOpen(false)
            }}
          >
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      {autoMapCurriculum && (
        <AutoMapDialog
          curriculum={autoMapCurriculum}
          knownBatches={batches}
          divisionOptions={divisionOptions}
          onClose={() => setAutoMapCurriculum(null)}
          onApplied={created => {
            setAutoMapCurriculum(null)
            curriculumMapping.refresh()
            setSnackbar({ open: true, message: created > 0
              ? `${created} subject${created === 1 ? '' : 's'} auto-mapped`
              : 'No new mappings were applied', severity: created > 0 ? 'success' : 'warning' })
          }}
        />
      )}

      <AutoScheduleDialog
        collegeId={collegeId}
        open={autoScheduleOpen}
        onClose={() => setAutoScheduleOpen(false)}
        onApplied={() => queryClient.invalidateQueries({ queryKey: ['weeklySchedules'] })}
        divisionOptions={divisionOptions}
      />

      {/* Empty-data banners */}
      {facultyList.length === 0 && (
        <Box sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: 'warning.main', color: 'warning.contrastText' }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            ⚠ No faculty found for this college. Add faculty members before creating schedules.
          </Typography>
        </Box>
      )}

      {/* Day Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={selectedDay}
          onChange={(_, v) => setSelectedDay(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {DAYS.map(day => (
            <Tab
              key={day}
              value={day}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <span style={{ textTransform: 'capitalize' }}>{day}</span>
                  <Chip
                    label={weeklySchedule[day]?.length || 0}
                    size="small"
                    color={weeklySchedule[day]?.length ? 'primary' : 'default'}
                    sx={{ height: 20, fontSize: 12 }}
                  />
                </Box>
              }
            />
          ))}
        </Tabs>
      </Box>

      {/* Date indicator */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <CalendarIcon fontSize="small" color="action" />
        <Typography variant="body2" color="text.secondary">
          Next {selectedDay.charAt(0).toUpperCase() + selectedDay.slice(1)}: <strong>{getDateForDayOfWeek(selectedDay)}</strong>
          {' '}&middot; Next occurrence: <strong>{getNextOccurrence(selectedDay)}</strong>
        </Typography>
      </Box>

      {/* P4: academic-calendar banner — the next occurrence of this weekday */}
      <HolidayBanner date={dateKeyForNextOccurrence(selectedDay)} collegeId={collegeId} />

      {/* Schedule Table */}
      <Card variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell sx={{ fontWeight: 600 }}>Time</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Subject</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Faculty</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Branch / Batch</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Room</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {daySchedules.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                  <Typography color="text.secondary">
                    No classes scheduled for {selectedDay}
                  </Typography>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => handleOpen()}
                    sx={{ mt: 1 }}
                  >
                    Add first class
                  </Button>
                </TableCell>
              </TableRow>
            )}
            {daySchedules.map(schedule => (
              <TableRow key={schedule.id} hover>
                <TableCell>
                  <Typography sx={{ fontWeight: 500, fontSize: 14 }}>
                    {schedule.startTime} - {schedule.endTime}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {getNextOccurrence(schedule.dayOfWeek)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontWeight: 500, fontSize: 14 }}>
                    {schedule.subject}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {schedule.subjectCode}
                  </Typography>
                  {schedule.assignment && (
                    <Tooltip
                      title={
                        schedule.assignmentId
                          ? 'A draft assignment has been created for this slot — the faculty publishes it from Assignments.'
                          : 'Generate Sessions will create a draft assignment for this slot (due ' +
                            schedule.assignment.deadline + ') for the faculty to publish.'
                      }
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        color="secondary"
                        icon={<AssignmentIcon />}
                        label={
                          schedule.assignmentId
                            ? `Assignment · ${schedule.assignment.deadline}`
                            : `Assigns · due ${schedule.assignment.deadline}`
                        }
                        sx={{ height: 20, fontSize: 11, mt: 0.5 }}
                      />
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ fontSize: 14 }}>{schedule.facultyName}</Typography>
                    {schedule.facultyInitials && (
                      <Chip label={schedule.facultyInitials} size="small" variant="outlined" sx={{ height: 22 }} />
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: 14 }}>
                    {schedule.branch} &middot; {schedule.batch}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Sem {schedule.semester}
                    {schedule.division && ` · Div ${schedule.division.replace(/,/g, '+')}`}
                    {schedule.section && ` · Sec ${schedule.section.replace(/,/g, '+')}`}
                  </Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <MergedDivisionChip division={[schedule.division, schedule.section].filter(Boolean).join(',')} />
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip label={schedule.room} size="small" variant="outlined" />
                </TableCell>
                <TableCell>
                  <Chip
                    label={schedule.type}
                    size="small"
                    color={schedule.type === 'lab' ? 'secondary' : 'default'}
                    sx={{ textTransform: 'capitalize' }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                    <Tooltip title="Duplicate">
                      <IconButton size="small" onClick={() => handleDuplicate(schedule)}>
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => handleOpen(schedule)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
{!draftMode && (
                    <Tooltip title="Cancel slot and its future sessions">
                      <span>
                        <IconButton
                          size="small"
                          color="warning"
                          disabled={cancellingId === schedule.id}
                          onClick={() => handleCancelSlot(schedule)}
                        >
                          <EventBusyIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>

)}                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => handleDelete(schedule.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Weekly Overview Cards */}
      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 500 }}>
          Weekly Overview
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {DAYS.map(day => {
            const count = weeklySchedule[day]?.length || 0
            return (
              <Card
                key={day}
                variant="outlined"
                onClick={() => setSelectedDay(day)}
                sx={{
                  flex: '1 1 140px',
                  minWidth: 140,
                  cursor: 'pointer',
                  borderColor: selectedDay === day ? 'primary.main' : 'divider',
                  bgcolor: selectedDay === day ? 'primary.light' : 'background.paper',
                  transition: 'all 0.2s',
                }}
              >
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography
                    variant="body2"
                    sx={{
                      textTransform: 'capitalize',
                      fontWeight: selectedDay === day ? 600 : 400,
                      color: selectedDay === day ? 'primary.main' : 'text.primary',
                    }}
                  >
                    {day}
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 600, mt: 1 }}>
                    {count}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {count === 1 ? 'class' : 'classes'}
                  </Typography>
                  {count > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Next: {getNextOccurrence(day)}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </Box>
      </Box>

      {/* Create/Edit Dialog */}
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingId ? 'Edit Class Schedule' : 'Add New Class Schedule'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }}>
            {/* Faculty */}
            <Box sx={{ flex: '1 1 250px' }}>
              <FormControl fullWidth size="small">
                <InputLabel>Faculty *</InputLabel>
                <Select
                  value={formData.facultyId}
                  onChange={e => {
                    const facultyId = e.target.value
                    setFormData(prev => ({ ...prev, facultyId, subject: '', subjectCode: '' }))
                  }}
                  label="Faculty *"
                >
                  {facultyList.map(f => (
                    <MenuItem key={f.id} value={f.id}>
                      {f.name} {f.department && `(${f.department})`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* Subject — pick from the college's subjects or type one in */}
            <Box sx={{ flex: '1 1 250px' }}>
              <Autocomplete<SubjectInfo, false, false, true>
                freeSolo
                size="small"
                options={subjectOptions}
                value={formData.subject}
                groupBy={option =>
                  typeof option === 'string'
                    ? 'Typed subject'
                    : option.facultyId && option.facultyId === formData.facultyId
                      ? 'This faculty'
                      : 'Other subjects in this college'
                }
                getOptionLabel={option =>
                  typeof option === 'string' ? option : `${option.name}${option.code ? ` (${option.code})` : ''}`
                }
                isOptionEqualToValue={(option, value) =>
                  (typeof option === 'string' ? option : option.name) ===
                  (typeof value === 'string' ? value : value.name)
                }
                onChange={(_, value) => {
                  const name = typeof value === 'string' ? value : value?.name || ''
                  const code = typeof value === 'string' ? '' : value?.code || ''
                  setFormData(prev => ({ ...prev, subject: name, subjectCode: code }))
                }}
                onInputChange={(_, inputValue, reason) => {
                  if (reason === 'input' || reason === 'clear') {
                    setFormData(prev => ({ ...prev, subject: inputValue, subjectCode: '' }))
                  }
                }}
                renderInput={params => (
                  <TextField
                    {...params}
                    label="Subject *"
                    placeholder="Type to search, or type a new subject"
                    helperText={
                      facultySubjects.length === 0
                        ? 'No subject is mapped to this faculty yet — type the subject name to schedule the class.'
                        : 'Not in the list? Type the subject name.'
                    }
                  />
                )}
              />
            </Box>

            {/* Branch */}
            <Box sx={{ flex: '1 1 200px' }}>
              <FormControl fullWidth size="small">
                <InputLabel>Branch *</InputLabel>
                <Select
                  value={formData.branch}
                  onChange={e => setFormData(prev => ({ ...prev, branch: e.target.value }))}
                  label="Branch *"
                >
                  {branches.map(b => (
                    <MenuItem key={b} value={b}>{b}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* Batch */}
            <Box sx={{ flex: '1 1 200px' }}>
              <FormControl fullWidth size="small">
                <InputLabel>Batch *</InputLabel>
                <Select
                  value={formData.batch}
                  onChange={e => setFormData(prev => ({ ...prev, batch: e.target.value }))}
                  label="Batch *"
                >
                  {batches.map(b => (
                    <MenuItem key={b} value={b}>{b}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* Semester */}
            <Box sx={{ flex: '1 1 120px' }}>
              <TextField
                fullWidth
                size="small"
                label="Semester *"
                type="number"
                value={formData.semester}
                onChange={e => setFormData(prev => ({ ...prev, semester: Number(e.target.value) }))}
                slotProps={{ htmlInput: { min: 1, max: 10 } }}
              />
            </Box>

            {/* A comma-separated division letter list is the existing stored group shape. */}
            <Box sx={{ flex: '1 1 220px' }}>
              <FormControl fullWidth size="small">
                <InputLabel id="schedule-divisions-label">Divisions taught together</InputLabel>
                <Select
                  labelId="schedule-divisions-label"
                  multiple
                  value={divisionSelection(formData.division)}
                  onChange={event => {
                    const value = event.target.value
                    const selected = divisionSelection(Array.isArray(value) ? value : String(value).split(','))
                    setFormData(prev => ({ ...prev, division: divisionSelectionValue(selected) }))
                  }}
                  label="Divisions taught together"
                  renderValue={selected => Array.isArray(selected) && selected.length > 0 ? selected.join(' + ') : 'Whole batch'}
                >
                  {divisionOptions.map(item => (
                    <MenuItem key={item} value={item}>
                      <Checkbox size="small" checked={divisionSelection(formData.division).includes(item)} />
                      <ListItemText primary={`Division ${item}`} />
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>Select divisions sharing one lecture; leave blank for a whole-batch class.</FormHelperText>
              </FormControl>
            </Box>

            {/* Section */}
            <Box sx={{ flex: '1 1 120px' }}>
              <TextField
                fullWidth
                size="small"
                label="Section"
                value={formData.section}
                onChange={e => setFormData(prev => ({ ...prev, section: e.target.value.toUpperCase() }))}
                placeholder="A, B, C"
              />
            </Box>

            {/* Day */}
            <Box sx={{ flex: '1 1 150px' }}>
              <FormControl fullWidth size="small">
                <InputLabel>Day *</InputLabel>
                <Select
                  value={formData.dayOfWeek}
                  onChange={e => setFormData(prev => ({ ...prev, dayOfWeek: e.target.value as DayOfWeek }))}
                  label="Day *"
                >
                  {DAYS.map(d => (
                    <MenuItem key={d} value={d} sx={{ textTransform: 'capitalize' }}>
                      {d}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {/* Start Time */}
            <Box sx={{ flex: '1 1 140px' }}>
              <TextField
                fullWidth
                size="small"
                label="Start Time *"
                type="time"
                value={formData.startTime}
                onChange={e => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>

            {/* End Time */}
            <Box sx={{ flex: '1 1 140px' }}>
              <TextField
                fullWidth
                size="small"
                label="End Time *"
                type="time"
                value={formData.endTime}
                onChange={e => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>

            {/* Room */}
            <Box sx={{ flex: '1 1 150px' }}>
              <TextField
                fullWidth
                size="small"
                label="Room *"
                value={formData.room}
                onChange={e => setFormData(prev => ({ ...prev, room: e.target.value }))}
                placeholder="e.g. 301-A (use the largest hall for merged classes)"
              />
            </Box>

            {/* Type */}
            <Box sx={{ flex: '1 1 150px' }}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select
                  value={formData.type}
                  onChange={e => setFormData(prev => ({ ...prev, type: e.target.value as ClassType }))}
                  label="Type"
                >
                  {CLASS_TYPES.map(t => (
                    <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>
                      {t}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </Box>

          {/* Optional assignment attachment — timetable-side one-stop link */}
          <Box sx={{ mt: 2, p: 2, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={attachAssignment}
                  onChange={e => setAttachAssignment(e.target.checked)}
                  size="small"
                />
              }
              label={
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Attach an assignment to this class (optional)
                </Typography>
              }
            />
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: attachAssignment ? 1.5 : 0 }}>
              “Generate Sessions” creates one draft assignment for this slot — same subject and cohort as the
              class above — and the faculty publishes it from Assignments. Students get the deadline
              notification on publish. Leave off for a plain class.
            </Typography>
            {attachAssignment && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 0.5 }}>
                <Box sx={{ flex: '2 1 260px' }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Assignment title *"
                    value={assignTitle}
                    onChange={e => setAssignTitle(e.target.value)}
                    placeholder="e.g., Week 4 worksheet"
                  />
                </Box>
                <Box sx={{ flex: '1 1 120px' }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Max score *"
                    type="number"
                    value={assignMaxScore}
                    onChange={e => setAssignMaxScore(Number(e.target.value) || 0)}
                    slotProps={{ htmlInput: { min: 1, max: 500 } }}
                  />
                </Box>
                <Box sx={{ flex: '1 1 160px' }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Deadline *"
                    type="date"
                    value={assignDeadline}
                    onChange={e => setAssignDeadline(e.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </Box>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isCreating || isUpdating}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={isCreating || isUpdating}
          >
            {editingId ? (isUpdating ? 'Updating...' : 'Update') : (isCreating ? 'Creating...' : 'Create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Upload Dialog — preview → approve (server-side validation & clashes) */}
      <Dialog open={bulkDialogOpen} onClose={closeBulkDialog} maxWidth="lg" fullWidth>
        <DialogTitle>Bulk Upload Schedules</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              Columns: subject, subjectCode, facultyId, facultyName, branch, batch, semester, division, section, room, dayOfWeek, startTime, endTime, type. For one merged class, quote the CSV division field as "A,B" and leave section blank; it is stored as A,B.
              Every row is validated, de-duplicated and clash-checked before anything is written — review the report, then apply.
            </Alert>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleDownloadTemplate}
              size="small"
            >
              Download CSV Template
            </Button>
            <TextField
              multiline
              rows={8}
              fullWidth
              label="Paste CSV content here"
              value={csvText}
              onChange={e => { setCsvText(e.target.value); setImportPreview(null); setImportError(null) }}
              placeholder={CSV_TEMPLATE}
              sx={{ fontFamily: 'monospace' }}
            />

            {importError && <Alert severity="error">{importError}</Alert>}

            {importPreview && (
              <Box>
                <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', gap: 1 }}>
                  <Chip label={`${importPreview.plan.totals.valid} valid`} color="success" size="small" />
                  {importPreview.plan.totals.clash > 0 && (
                    <Chip label={`${importPreview.plan.totals.clash} clash`} color="error" size="small" />
                  )}
                  {importPreview.plan.totals.duplicate > 0 && (
                    <Chip label={`${importPreview.plan.totals.duplicate} duplicate`} color="warning" size="small" />
                  )}
                  {importPreview.plan.totals.invalid > 0 && (
                    <Chip label={`${importPreview.plan.totals.invalid} invalid`} color="error" variant="outlined" size="small" />
                  )}
                </Stack>
                <Box sx={{ maxHeight: 320, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell sx={{ fontWeight: 600, width: 56 }}>Line</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Subject</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>When</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Details</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {importPreview.plan.rows.map(row => {
                        const color = row.status === 'valid' ? 'success' : row.status === 'duplicate' ? 'warning' : 'error'
                        return (
                          <TableRow key={row.line} hover sx={{ opacity: row.status === 'valid' && row.warnings.length === 0 ? 0.75 : 1 }}>
                            <TableCell>{row.line}</TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontWeight: 500 }}>{row.subject}</Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">{row.dayOfWeek} {row.startTime}–{row.endTime}</Typography>
                            </TableCell>
                            <TableCell>
                              <Chip label={row.status} size="small" color={color} variant={row.status === 'valid' ? 'outlined' : 'filled'} />
                            </TableCell>
                            <TableCell sx={{ maxWidth: 380 }}>
                              <Typography variant="caption" color={row.status === 'valid' ? 'text.secondary' : 'error.main'}>
                                {row.reasons.join('; ')}
                              </Typography>
                              {row.warnings.length > 0 && (
                                <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                                  ⚠ {row.warnings.join('; ')}
                                </Typography>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeBulkDialog}>Close</Button>
          {!importPreview && (
            <Button
              variant="contained"
              onClick={handlePreviewImport}
              disabled={previewing || !csvText.trim()}
            >
              {previewing ? 'Checking…' : 'Check import'}
            </Button>
          )}
          {importPreview && (
            <Button
              variant="contained"
              onClick={handleApplyImport}
              disabled={previewing || importPreview.plan.totals.valid === 0}
            >
              {previewing ? 'Importing…' : `Apply ${importPreview.plan.totals.valid} valid row${importPreview.plan.totals.valid === 1 ? '' : 's'}`}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ─── Timetable download ─── */}
      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Download timetable</DialogTitle>
        <DialogContent>
          <TextField
            select
            fullWidth
            size="small"
            label="Class"
            value={exportCohort}
            onChange={(e) => setExportCohort(e.target.value)}
            sx={{ mt: 1 }}
          >
            <MenuItem value="__all__">All classes ({allSlots.length} slots)</MenuItem>
            {cohortOptions.map((c) => (
              <MenuItem key={c} value={c}>{c}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExportOpen(false)}>Close</Button>
          <Button variant="outlined" onClick={() => handleExport('jpg')} disabled={!!exporting}>
            {exporting === 'jpg' ? 'Preparing…' : 'Download JPG'}
          </Button>
          <Button variant="contained" onClick={() => handleExport('pdf')} disabled={!!exporting}>
            {exporting === 'pdf' ? 'Preparing…' : 'Download PDF'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ─── Slice 2: Generate class sessions from the weekly timetable ──── */}
      <Dialog open={generateOpen} onClose={() => setGenerateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Generate class sessions</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Turns the active weekly timetable into real class sessions that faculty can mark
            attendance and topic coverage against. Running it twice over the same range is safe —
            each slot-day maps to one session, so nothing is duplicated. Suspending
            holidays in Academic Calendar are excluded; future unmarked sessions already
            created for those dates are cancelled. Import the college's public holidays first.
          </Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="From"
              type="date"
              value={generateWindow.from}
              onChange={e => setGenerateWindow(prev => ({ ...prev, from: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              label="To (max 92 days)"
              type="date"
              value={generateWindow.to}
              onChange={e => setGenerateWindow(prev => ({ ...prev, to: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Stack>
          {calendarQuery.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Could not verify the college calendar in this view. Session generation only skips holidays that are stored in Academic Calendar.
              <Button size="small" sx={{ ml: 1 }} onClick={() => navigate('/admin/academic-calendar')}>Open calendar</Button>
            </Alert>
          )}
          {missingKnownHolidays.length > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              <b>Known Karnataka holidays are missing from this college calendar:</b>{' '}
              {missingKnownHolidays.map((holiday) => `${holiday.title} (${holiday.date})`).join(' · ')}.
              Add or import these dates before generating sessions. If the college teaches on one, add an explicit non-suspending calendar event to record that decision.
              <Button size="small" sx={{ ml: 1 }} onClick={() => navigate('/admin/academic-calendar')}>Review/import</Button>
            </Alert>
          )}
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Checkbox
                checked={skipConflicting}
                onChange={event => setSkipConflicting(event.target.checked)}
              />
            }
            label="Skip slots that clash instead of stopping"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Faculty and room double-bookings are refused by default so a bad timetable is not
            scattered across the whole term. Tick this to generate everything else and list what was
            skipped.
          </Typography>

          {generateResult && (
            <Alert
              severity={(generateResult.skippedConflicts || 0) > 0 || (generateResult.cancelledHolidaySessions || 0) > 0 ? 'warning' : 'success'}
              sx={{ mt: 2 }}
            >
              {generateResult.created} created · {generateResult.skippedExisting} already existed
              {(generateResult.skippedConflicts || 0) > 0 && ` · ${generateResult.skippedConflicts} skipped (clash)`}
              {(generateResult.skippedHolidayCount || 0) > 0 && ` · ${generateResult.skippedHolidayCount} occurrence(s) excluded by holiday calendar`}
              {(generateResult.cancelledHolidaySessions || 0) > 0 && ` · ${generateResult.cancelledHolidaySessions} existing session(s) cancelled`}
              {' · '}{generateResult.slotsScanned} active slot(s) × {generateResult.scheduledOccurrences} occurrence(s)
              in range.
              {(generateResult.assignmentsLinked || 0) > 0 && (
                <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                  {generateResult.assignmentsLinked} assignment draft(s) linked for faculty review & publish.
                </Typography>
              )}
            </Alert>
          )}

          {generateConflicts.length > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                {generateConflicts.length} clash(es) found
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {generateConflicts.slice(0, 8).map((conflict, index) => (
                  <li key={`${conflict.sessionId}-${conflict.kind}-${index}`}>
                    <Typography variant="caption">
                      {conflict.message}
                      {conflict.conflictsWith && ` (${conflict.conflictsWith})`}
                    </Typography>
                  </li>
                ))}
              </Box>
              {generateConflicts.length > 8 && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                  …and {generateConflicts.length - 8} more.
                </Typography>
              )}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenerateOpen(false)}>Close</Button>
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={generating || calendarQuery.isLoading || calendarQuery.isError || missingKnownHolidays.length > 0}
          >
            {generating ? 'Generating...' : generateResult ? 'Generate again' : 'Generate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default AdminClassSchedule