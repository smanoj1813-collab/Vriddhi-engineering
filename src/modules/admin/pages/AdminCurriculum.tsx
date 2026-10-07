// ═══════════════════════════════════════════════════════════════════════
// pages/AdminCurriculum.tsx — Curriculum → Timetable → Reschedule
//
// One screen, one flow. Before this page the same job was spread over three
// tabs of the same page and two other pages: faculty were assigned on the
// Curriculum tab, the assignment was *read* on the Mappings tab, the timetable
// was built by navigating to Class Schedule, and moving a class was something
// only the faculty app could do. An admin working through a programme walked
// semester by semester with no view of what was still missing, and a timetable
// change never reached the dated classes that had already been created.
//
// The flow now reads top to bottom:
//
//   1. Branch + batch              → whose programme are we setting up?
//   2. Semester ladder 1 … 6       → what is still unassigned / unscheduled?
//   3. The semester's subjects     → assign faculty, add timetable slots,
//                                    create dated classes, reschedule, cancel
//
// Everything that writes goes through the same server paths the rest of the
// app uses (createWeeklySchedule for the plan, generateClassSessions /
// cancelWeeklySchedule / rescheduleClass for the actual), so a class scheduled
// here is identical to one scheduled from the Class Schedule page, and the
// timetable query lives under the same cache key (`['weeklySchedules', 'admin',
// collegeId]`) so both pages update together.
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useMemo, useCallback, useEffect } from 'react'
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
  Checkbox,
  ListItemText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Tooltip,
  Alert,
  Snackbar,
  Divider,
  Stack,
  Paper,
  Grid,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  LinearProgress,
} from '@mui/material'
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Schedule as ScheduleIcon,
  School as SchoolIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckIcon,
  Refresh as RefreshIcon,
  AutoAwesome as AIIcon,
  Sync as SyncIcon,
  EventRepeat as SessionsIcon,
  SwapHoriz as RescheduleIcon,
  Cancel as CancelIcon,
  PersonAdd as PersonAddIcon,
} from '@mui/icons-material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/context/AuthContext'
import { useCurriculumMapping, facultyBranchLabel } from '../hooks/useCurriculumMapping'
import { fetchDivisionsFromStudents, fetchWeeklySchedules } from '../api/scheduleApi'
import { divisionOptions as buildDivisionOptions, divisionSelection, divisionSelectionValue } from '@/shared/utils/divisionGroups'
import {
  cancelWeeklySchedule,
  generateClassSessions,
  defaultTermWindow,
  type RescheduleClassResult,
} from '../api/classSessionApi'
import AutoMapDialog from '../components/AutoMapDialog'
import ScheduleSlotDialog, { type SlotPrefill } from '../components/ScheduleSlotDialog'
import RescheduleClassDialog from '../components/RescheduleClassDialog'
import {
  buildSemesterFlow,
  flowProgress,
  formatSlot,
  semesterStatusColor,
  semesterStatusLabel,
  sortSlots,
  type CourseFlowRow,
  type SemesterFlowRow,
} from '../utils/curriculumFlow'
import type { CurriculumDoc, ParsedCourse } from '../../../shared/types/curriculum'
import type { WeeklyClassSchedule } from '../types/schedule'
import MergedDivisionChip from '@/shared/components/MergedDivisionChip'

// ─── Empty Form State ──────────────────────────────────────────────────
interface MappingFormData {
  curriculumId: string;
  courseId: string;
  facultyId: string;
  batch: string;
  division: string;
  section: string;
}

const EMPTY_FORM: MappingFormData = {
  curriculumId: '',
  courseId: '',
  facultyId: '',
  batch: '',
  division: '',
  section: '',
}

// ─── Component ─────────────────────────────────────────────────────────

const AdminCurriculum: React.FC = () => {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const collegeId = user?.collegeId || ''

  const {
    curriculumList,
    mappings,
    facultyList,
    loading,
    error,
    selectedBranch,
    setSelectedBranch,
    selectedBatch,
    setSelectedBatch,
    assignFaculty,
    updateFacultyAssignment,
    removeMapping,
    refresh,
    refreshCurriculum,
    getFacultySubjects,
    branches,
    batches,
  } = useCurriculumMapping(collegeId)

  // ─── The timetable, under the key the Class Schedule page uses ───────
  // Same key, same query: a slot created or cancelled on either page is
  // immediately visible on the other, and a reschedule made here invalidates
  // for both.
  const { data: weeklySchedules = [], isLoading: schedulesLoading } = useQuery({
    queryKey: ['weeklySchedules', 'admin', collegeId],
    queryFn: () => fetchWeeklySchedules(collegeId),
    enabled: !!collegeId,
  })
  const { data: studentDivisionValues = [] } = useQuery({
    queryKey: ['divisionOptions', collegeId],
    queryFn: () => fetchDivisionsFromStudents(collegeId),
    enabled: !!collegeId,
  })
  const divisionOptions = useMemo(
    () => buildDivisionOptions([
      ...studentDivisionValues,
      ...weeklySchedules.map((slot) => slot.division),
      ...mappings.map((mapping) => mapping.division),
    ]),
    [studentDivisionValues, weeklySchedules, mappings],
  )

  const [selectedSemester, setSelectedSemester] = useState<number>(1)
  const [openMappingDialog, setOpenMappingDialog] = useState(false)
  const [editingMapping, setEditingMapping] = useState<string | null>(null)
  const [formData, setFormData] = useState<MappingFormData>({ ...EMPTY_FORM })
  const [autoMapFor, setAutoMapFor] = useState<CurriculumDoc | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [schedulePrefill, setSchedulePrefill] = useState<SlotPrefill | null>(null)
  const [rescheduleSlot, setRescheduleSlot] = useState<WeeklyClassSchedule | null>(null)
  const [busySlotId, setBusySlotId] = useState<string | null>(null)
  const [expandedCurriculum, setExpandedCurriculum] = useState<string | null>(null)
  const [snackbar, setSnackbar] = useState<{
    open: boolean
    message: string
    severity: 'success' | 'error' | 'info' | 'warning'
  }>({ open: false, message: '', severity: 'success' })

  const notify = useCallback(
    (message: string, severity: 'success' | 'error' | 'info' | 'warning' = 'success') =>
      setSnackbar({ open: true, message, severity }),
    [],
  )

  const invalidateTimetable = useCallback(
    (slotId?: string) => {
      queryClient.invalidateQueries({ queryKey: ['weeklySchedules'] })
      if (slotId) queryClient.invalidateQueries({ queryKey: ['slotSessions', slotId] })
    },
    [queryClient],
  )

  // ─── The semester ladder ─────────────────────────────────────────────
  const flow = useMemo<SemesterFlowRow[]>(
    () =>
      buildSemesterFlow({
        curricula: curriculumList,
        mappings,
        slots: weeklySchedules,
        branch: selectedBranch,
        batch: selectedBatch,
      }),
    [curriculumList, mappings, weeklySchedules, selectedBranch, selectedBatch],
  )

  const progress = useMemo(() => flowProgress(flow), [flow])
  const activeSemester = flow.find(row => row.semester === selectedSemester) || flow[0]

  // Land on the first semester that still has work to do, once, on first load.
  const [landed, setLanded] = useState(false)
  useEffect(() => {
    if (landed || flow.length === 0 || !activeSemester) return
    if (activeSemester.status !== 'empty') {
      setLanded(true)
      return
    }
    const firstWithCourses = flow.find(row => row.courseCount > 0)
    if (firstWithCourses) {
      setSelectedSemester(firstWithCourses.semester)
      setLanded(true)
    }
  }, [landed, flow, activeSemester])

  // ─── Faculty options, subject-matched like the schedule form ─────────
  const selectedCourseName = useMemo(() => {
    if (!formData.courseId) return ''
    const curriculum = curriculumList.find(c => c.id === formData.curriculumId)
    const course = curriculum?.courses.find(c => c.id === formData.courseId)
    return course?.name || ''
  }, [formData.courseId, formData.curriculumId, curriculumList])

  const selectedCurriculumBranch = useMemo(
    () => (curriculumList.find(c => c.id === formData.curriculumId)?.branch || '').trim().toLowerCase(),
    [curriculumList, formData.curriculumId],
  )

  const facultyOptions = useMemo(() => {
    const q = selectedCourseName.trim().toLowerCase()
    const branchKey = selectedCurriculumBranch
    return facultyList
      .map(f => {
        const subjects = getFacultySubjects(f.id)
        const matches = q.length > 0 && subjects.some(s => s.toLowerCase() === q)
        const branchList = (f.branches && f.branches.length ? f.branches : [f.department]).map(b => String(b || '').toLowerCase())
        const sameBranch = Boolean(branchKey) && branchList.some(b => b === branchKey || b.includes(`(${branchKey})`) || branchKey.includes(b))
        return { ...f, subjects, matches, sameBranch }
      })
      .sort((a, b) => {
        if (a.sameBranch !== b.sameBranch) return a.sameBranch ? -1 : 1
        if (a.matches !== b.matches) return a.matches ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }, [facultyList, getFacultySubjects, selectedCourseName, selectedCurriculumBranch])

  // ─── Handlers: faculty assignment ────────────────────────────────────
  const handleOpenMapping = (curriculum: CurriculumDoc, course?: ParsedCourse, existing?: CourseFlowRow['mapping']) => {
    setEditingMapping(existing?.id || null)
    setFormData({
      ...EMPTY_FORM,
      curriculumId: curriculum.id,
      courseId: course?.id || '',
      facultyId: existing?.facultyId || '',
      batch: existing?.batch || (selectedBatch !== 'all' ? selectedBatch : ''),
      division: existing?.division || '',
      section: existing?.section || '',
    })
    setOpenMappingDialog(true)
  }

  const handleCloseMapping = () => {
    setOpenMappingDialog(false)
    setEditingMapping(null)
    setFormData({ ...EMPTY_FORM })
  }

  const handleSubmitMapping = async () => {
    if (!formData.curriculumId || !formData.courseId || !formData.facultyId || !formData.batch) {
      notify('Please fill all required fields', 'error')
      return
    }

    const curriculum = curriculumList.find(c => c.id === formData.curriculumId)
    const course = curriculum?.courses.find(c => c.id === formData.courseId)
    const faculty = facultyList.find(f => f.id === formData.facultyId || f.uid === formData.facultyId)

    if (!faculty) {
      notify('Please select a faculty member', 'error')
      return
    }

    if (editingMapping) {
      const result = await updateFacultyAssignment(editingMapping, {
        // Same rule as create: the Auth uid is the canonical faculty key, so
        // an edit cannot silently re-key the mapping back to the profile doc
        // id the faculty app cannot match.
        facultyId: faculty.uid || faculty.id,
        facultyName: faculty.name,
        facultyEmail: faculty.email || null,
        batch: formData.batch,
        division: formData.division || null,
        section: formData.section || null,
      })
      if (result) {
        notify('Assignment updated successfully')
        handleCloseMapping()
      } else {
        notify(error || 'Failed to update', 'error')
      }
    } else {
      if (!curriculum || !course) {
        notify('Please select a curriculum and course', 'error')
        return
      }
      const result = await assignFaculty(
        curriculum,
        course,
        faculty,
        formData.batch,
        formData.division || undefined,
        formData.section || undefined,
        user?.name || user?.email || 'Admin',
      )
      if (result) {
        notify('Faculty assigned successfully')
        handleCloseMapping()
      } else {
        notify(error || 'Failed to assign', 'error')
      }
    }
  }

  const handleDeleteMapping = async (mappingId: string) => {
    if (!window.confirm('Remove this faculty assignment? The timetable slots stay where they are.')) return
    const success = await removeMapping(mappingId)
    notify(success ? 'Assignment removed' : error || 'Failed to remove', success ? 'success' : 'error')
  }

  /**
   * Rewrite every mapping on the selected curriculum so it carries the
   * semester of the course it points at, rather than the curriculum's own
   * (primary) semester. A parsed curriculum can bundle courses from more than
   * one semester under one header, and mappings were historically written with
   * that header value — so a 5th-semester elective was filed under semester 6
   * and never showed up for the students who take it.
   */
  const handleSyncSemesters = async (curriculum: CurriculumDoc) => {
    const semesterByCourse = new Map(curriculum.courses.map(c => [c.id, c.semester]))
    const stale = mappings.filter(m => {
      if (m.curriculumId !== curriculum.id || m.status !== 'active') return false
      const courseSemester = semesterByCourse.get(m.courseId)
      return courseSemester !== undefined && courseSemester !== m.semester
    })

    if (stale.length === 0) {
      notify('Semesters are already in sync with each course.', 'info')
      return
    }

    const preview = stale
      .slice(0, 5)
      .map(m => `${m.courseCode}: Sem ${m.semester} → Sem ${semesterByCourse.get(m.courseId)}`)
      .join('\n')
    const overflow = stale.length > 5 ? `\n…and ${stale.length - 5} more` : ''

    if (
      !window.confirm(
        `${stale.length} mapping${stale.length === 1 ? '' : 's'} will be moved to their course's own semester:\n\n${preview}${overflow}\n\nContinue?`,
      )
    )
      return

    setSyncing(true)
    let updated = 0
    try {
      for (const mapping of stale) {
        const result = await updateFacultyAssignment(mapping.id, {
          semester: semesterByCourse.get(mapping.courseId)!,
        })
        if (result) updated += 1
      }
    } finally {
      setSyncing(false)
    }

    if (updated === stale.length) {
      notify(`${updated} mapping${updated === 1 ? '' : 's'} synced to their course semester.`)
    } else if (updated > 0) {
      notify(`Synced ${updated} of ${stale.length} — ${stale.length - updated} failed. ${error || ''}`.trim(), 'warning')
    } else {
      notify(error || 'Failed to sync semesters', 'error')
    }
  }

  // ─── Handlers: timetable ─────────────────────────────────────────────
  const handleOpenSchedule = (row: CourseFlowRow) => {
    setSchedulePrefill({
      subject: row.course.name,
      subjectCode: row.course.code,
      facultyId: row.mapping?.facultyId || '',
      facultyName: row.mapping?.facultyName || '',
      branch: row.course.branch || row.curriculum.branch || '',
      batch: row.mapping?.batch || (selectedBatch !== 'all' ? selectedBatch : ''),
      semester: row.course.semester ?? row.curriculum.semester,
      division: row.mapping?.division || '',
      section: row.mapping?.section || '',
    })
  }

  const handleSlotSaved = (payload: { slot: WeeklyClassSchedule; generated: number; sessionsError?: string }) => {
    invalidateTimetable(payload.slot.id)
    const parts = [`Class added to the timetable (${formatSlot(payload.slot)})`]
    if (payload.generated > 0) {
      parts.push(`${payload.generated} dated class${payload.generated === 1 ? '' : 'es'} created`)
    }
    if (payload.sessionsError) parts.push(payload.sessionsError)
    notify(parts.join(' · '), payload.sessionsError ? 'warning' : 'success')
  }

  /** Materialise (or top up) the dated classes for one slot. Idempotent. */
  const handleCreateSessions = async (slot: WeeklyClassSchedule) => {
    setBusySlotId(slot.id)
    try {
      const window = defaultTermWindow()
      const result = await generateClassSessions({
        from: window.from,
        to: window.to,
        weeklyScheduleId: slot.id,
      })
      invalidateTimetable(slot.id)
      notify(
        result.created === 0
          ? `Already up to date — ${result.skippedExisting} dated class(es) exist for this slot.`
          : `Created ${result.created} dated class(es) for “${slot.subject}”.`,
        result.skippedConflicts > 0 ? 'warning' : 'success',
      )
    } catch (err) {
      notify(err instanceof Error ? err.message : 'The dated classes could not be created.', 'error')
    } finally {
      setBusySlotId(null)
    }
  }

  const handleCancelSlot = async (slot: WeeklyClassSchedule) => {
    if (
      !window.confirm(
        `Switch off “${slot.subject}” ${formatSlot(slot)}?\n\n` +
          'Every unmarked class it generated from today onwards is cancelled, and the slot stops producing ' +
          'new ones. Classes already delivered or marked are left untouched.',
      )
    )
      return
    setBusySlotId(slot.id)
    try {
      const result = await cancelWeeklySchedule({
        weeklyScheduleId: slot.id,
        reason: 'Cancelled from the curriculum flow',
      })
      invalidateTimetable(slot.id)
      notify(
        result.cancelled === 0
          ? 'Slot switched off — no future class needed cancelling.'
          : `Slot switched off and ${result.cancelled} future class(es) cancelled.`,
      )
    } catch (err) {
      notify(err instanceof Error ? err.message : 'The slot could not be cancelled.', 'error')
    } finally {
      setBusySlotId(null)
    }
  }

  const handleRescheduled = (result: RescheduleClassResult) => {
    invalidateTimetable(result.weeklyScheduleId)
    queryClient.invalidateQueries({ queryKey: ['slotSessions'] })
    notify(
      [
        result.message,
        result.unchanged > 0 && result.scope === 'slot' ? `${result.unchanged} already on the new day` : '',
        result.skippedMarked > 0 ? `${result.skippedMarked} already delivered — left in place` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      'success',
    )
  }

  // ─── Loading / error states ──────────────────────────────────────────
  if (!collegeId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Your account is not linked to a college. Log out and back in, or ask an administrator.</Alert>
      </Box>
    )
  }

  if (loading && curriculumList.length === 0) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h6" sx={{ color: 'text.secondary' }}>
            Loading curriculum centre…
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.disabled', mt: 1 }}>
            Fetching curriculum list, mappings & faculty.
          </Typography>
        </Box>
      </Box>
    )
  }

  if (error && curriculumList.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Could not load curriculum data
          </Typography>
          <Typography variant="body2">{error}</Typography>
          <Button variant="contained" onClick={() => window.location.reload()} sx={{ mt: 2 }}>
            Reload page
          </Button>
        </Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* ────────────────────── Header ────────────────────── */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          mb: 3,
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <SchoolIcon sx={{ color: 'primary.main' }} /> Curriculum → Timetable
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 720 }}>
            Work down the semesters: assign a faculty member to each subject, put it on the timetable, and
            reschedule it here when plans change — the dated classes, attendance and the student timetable follow.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => { refreshCurriculum(); refresh() }}>
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AIIcon />}
            onClick={() => {
              const first = activeSemester?.courses[0]?.curriculum || curriculumList[0]
              if (first) setAutoMapFor(first)
            }}
            disabled={curriculumList.length === 0}
          >
            Auto-Map
          </Button>
        </Box>
      </Box>

      {/* ────────────────────── Step 1 + progress ────────────────────── */}
      <Paper elevation={0} variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="branch-label">Branch</InputLabel>
            <Select
              labelId="branch-label"
              value={selectedBranch}
              label="Branch"
              onChange={e => setSelectedBranch(e.target.value)}
            >
              <MenuItem value="all">All branches</MenuItem>
              {branches.map(b => (
                <MenuItem key={b} value={b}>
                  {b}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="batch-label">Batch</InputLabel>
            <Select
              labelId="batch-label"
              value={selectedBatch}
              label="Batch"
              onChange={e => setSelectedBatch(e.target.value)}
            >
              <MenuItem value="all">All batches</MenuItem>
              {batches.map(b => (
                <MenuItem key={b} value={b}>
                  {b}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {progress.scheduled} of {progress.courses} subjects on the timetable
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {progress.pct}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progress.pct}
              color={progress.pct === 100 ? 'success' : progress.pct >= 50 ? 'primary' : 'warning'}
              sx={{ height: 8, borderRadius: 4 }}
            />
            <Typography variant="caption" color="text.secondary">
              {progress.unassigned} without faculty · {progress.unscheduled} not scheduled
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* ────────────────────── Step 2: the semester ladder ────────────────────── */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        1. Pick a semester
      </Typography>
      <Grid container spacing={1.5} sx={{ mb: 3 }}>
        {flow.map(row => {
          const selected = row.semester === activeSemester?.semester
          return (
            <Grid size={{ xs: 6, sm: 4, md: 2 }} key={row.semester}>
              <Paper
                elevation={0}
                variant="outlined"
                onClick={() => setSelectedSemester(row.semester)}
                sx={{
                  p: 1.5,
                  cursor: 'pointer',
                  height: '100%',
                  borderColor: selected ? 'primary.main' : 'divider',
                  borderWidth: selected ? 2 : 1,
                  bgcolor: selected ? 'action.selected' : 'background.paper',
                  '&:hover': { borderColor: 'primary.main' },
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Semester {row.semester}
                  </Typography>
                  <Chip
                    size="small"
                    color={semesterStatusColor(row)}
                    variant={row.status === 'empty' ? 'outlined' : 'filled'}
                    label={row.status === 'ready' ? 'ready' : row.status === 'empty' ? '—' : 'to do'}
                    sx={{ height: 18, fontSize: 11 }}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  {semesterStatusLabel(row)}
                </Typography>
                {row.weeklyClasses > 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {row.weeklyClasses} class{row.weeklyClasses === 1 ? '' : 'es'}/week
                  </Typography>
                )}
              </Paper>
            </Grid>
          )
        })}
      </Grid>

      {/* ────────────────────── Step 3: the semester's subjects ────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          2. Assign faculty, schedule the class, reschedule when it moves
        </Typography>
        {activeSemester?.courses[0]?.curriculum && (
          <Tooltip title="Rewrite each assignment's semester to match the course it points at">
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={<SyncIcon />}
                onClick={() => handleSyncSemesters(activeSemester.courses[0].curriculum)}
                disabled={syncing}
              >
                {syncing ? 'Syncing…' : 'Sync semesters'}
              </Button>
            </span>
          </Tooltip>
        )}
      </Box>

      {facultyList.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No active faculty found for this college — add faculty members before assigning subjects.
        </Alert>
      )}

      <Paper elevation={0} variant="outlined" sx={{ mb: 3, overflowX: 'auto' }}>
        {!activeSemester || activeSemester.courses.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              No subjects for semester {activeSemester?.semester ?? selectedSemester}{' '}
              {selectedBranch !== 'all' ? `in ${selectedBranch}` : ''}.
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
              Import the syllabus for this semester from Curriculum in the super-admin workspace, or pick another
              branch or semester above.
            </Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 600, bgcolor: 'action.hover' } }}>
                <TableCell>Subject</TableCell>
                <TableCell>Faculty</TableCell>
                <TableCell>Timetable</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {activeSemester.courses.map(row => {
                const slots = sortSlots(row.slots)
                return (
                  <TableRow key={row.course.id} hover sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell sx={{ verticalAlign: 'top', minWidth: 220 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {row.course.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.course.code} · {row.course.credits} credits
                        {row.course.totalHours ? ` · ${row.course.totalHours} hrs` : ''} ·{' '}
                        {row.curriculum.branch} · Sem {row.course.semester}
                      </Typography>
                      {slots.length > 0 && (
                        <Chip
                          size="small"
                          color="success"
                          icon={<CheckIcon />}
                          label={`${slots.length} class${slots.length === 1 ? '' : 'es'}/week`}
                          sx={{ mt: 0.5, height: 20, fontSize: 11 }}
                        />
                      )}
                    </TableCell>

                    <TableCell sx={{ verticalAlign: 'top', minWidth: 180 }}>
                      {row.mapping ? (
                        <>
                          <Typography variant="body2">{row.mapping.facultyName}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {row.mapping.batch}
                            {row.mapping.division ? ` · Div ${row.mapping.division.replace(/,/g, '+')}` : ''}
                            {row.mapping.section ? ` · Sec ${row.mapping.section.replace(/,/g, '+')}` : ''}
                          </Typography>
                          <Box sx={{ mt: 0.5 }}>
                            <MergedDivisionChip division={[row.mapping.division, row.mapping.section].filter(Boolean).join(',')} />
                          </Box>
                        </>
                      ) : (
                        <Chip size="small" color="error" variant="outlined" label="No faculty assigned" />
                      )}
                    </TableCell>

                    <TableCell sx={{ verticalAlign: 'top', minWidth: 260 }}>
                      {slots.length === 0 ? (
                        <Typography variant="caption" color="text.secondary">
                          Not on the timetable yet.
                        </Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          {slots.map(slot => (
                            <Box key={slot.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Chip size="small" variant="outlined" label={formatSlot(slot)} />
                              <Tooltip title="Create the dated classes for the next term (needed for attendance). Safe to run twice.">
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={() => handleCreateSessions(slot)}
                                    disabled={busySlotId === slot.id}
                                  >
                                    <SessionsIcon fontSize="inherit" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title="Reschedule — move this slot, or just one class">
                                <IconButton size="small" onClick={() => setRescheduleSlot(slot)}>
                                  <RescheduleIcon fontSize="inherit" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Switch the slot off and cancel its future classes">
                                <span>
                                  <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => handleCancelSlot(slot)}
                                    disabled={busySlotId === slot.id}
                                  >
                                    <CancelIcon fontSize="inherit" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </Box>
                          ))}
                        </Stack>
                      )}
                    </TableCell>

                    <TableCell align="right" sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <Tooltip title={row.mapping ? 'Change the faculty member' : 'Assign a faculty member'}>
                        <Button
                          size="small"
                          variant={row.mapping ? 'text' : 'contained'}
                          startIcon={row.mapping ? <EditIcon /> : <PersonAddIcon />}
                          onClick={() => handleOpenMapping(row.curriculum, row.course, row.mapping)}
                        >
                          {row.mapping ? 'Reassign' : 'Assign'}
                        </Button>
                      </Tooltip>
                      <Tooltip title={slots.length > 0 ? 'Add another weekly slot' : 'Put this subject on the timetable'}>
                        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => handleOpenSchedule(row)} sx={{ ml: 1 }}>
                          {slots.length > 0 ? 'Add slot' : 'Schedule'}
                        </Button>
                      </Tooltip>
                      {row.mapping && (
                        <Tooltip title="Remove this faculty assignment">
                          <IconButton size="small" color="error" onClick={() => handleDeleteMapping(row.mapping!.id)} sx={{ ml: 0.5 }}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Paper>

      {schedulesLoading && (
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 2 }}>
          Loading the timetable…
        </Typography>
      )}

      {/* ────────────────────── Every curriculum on file ────────────────────── */}
      <Divider sx={{ my: 3 }} />
      <Accordion expanded={expandedCurriculum === 'all'} onChange={(_, open) => setExpandedCurriculum(open ? 'all' : null)}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            All curricula on file ({curriculumList.length})
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Branch</TableCell>
                <TableCell>Semester</TableCell>
                <TableCell>Scheme</TableCell>
                <TableCell>Subjects</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {curriculumList.map(c => (
                <TableRow key={c.id} sx={{ '&:last-child td': { border: 0 } }}>
                  <TableCell>{c.branch}</TableCell>
                  <TableCell>Semester {c.semester}</TableCell>
                  <TableCell>{c.scheme}</TableCell>
                  <TableCell>{c.courses.length}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => {
                        setSelectedBranch(c.branch)
                        setSelectedSemester(c.semester)
                      }}
                    >
                      <EditIcon fontSize="small" /> Work on this
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {curriculumList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      No curriculum has been imported for this college yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </AccordionDetails>
      </Accordion>

      {/* ────────────────────── Mapping dialog ────────────────────── */}
      <Dialog open={openMappingDialog} onClose={handleCloseMapping} maxWidth="sm" fullWidth>
        <DialogTitle>{editingMapping ? 'Edit Faculty Assignment' : 'Assign Faculty'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1, minWidth: 320 }}>
            <FormControl fullWidth>
              <InputLabel id="curriculum-label">Curriculum</InputLabel>
              <Select
                labelId="curriculum-label"
                value={formData.curriculumId}
                label="Curriculum"
                onChange={e => setFormData(prev => ({ ...prev, curriculumId: e.target.value }))}
                disabled={!!editingMapping}
              >
                {curriculumList.map(c => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.branch} · Sem {c.semester}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="course-label">Course</InputLabel>
              <Select
                labelId="course-label"
                value={formData.courseId}
                label="Course"
                onChange={e => setFormData(prev => ({ ...prev, courseId: e.target.value }))}
                disabled={!!editingMapping}
              >
                {(curriculumList.find(c => c.id === formData.curriculumId)?.courses || []).map(c => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="faculty-label">Faculty</InputLabel>
              <Select
                labelId="faculty-label"
                value={formData.facultyId}
                label="Faculty"
                onChange={e => setFormData(prev => ({ ...prev, facultyId: e.target.value }))}
                renderValue={(value) => {
                  const f = facultyOptions.find(x => (x.uid || x.id) === value)
                  return f ? `${f.name} — ${facultyBranchLabel(f)}` : String(value || '')
                }}
              >
                {facultyOptions.map(f => (
                  <MenuItem key={f.uid || f.id} value={f.uid || f.id} sx={{ display: 'block' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{f.name}</Typography>
                      {f.sameBranch && <Chip label="this branch" size="small" color="primary" variant="outlined" />}
                      {f.matches && <Chip label="subject match" size="small" variant="outlined" />}
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      Branch: {facultyBranchLabel(f)}
                    </Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                size="small"
                fullWidth
                label="Batch"
                value={formData.batch}
                onChange={e => setFormData(prev => ({ ...prev, batch: e.target.value }))}
              />
              <FormControl fullWidth size="small">
                <InputLabel id="mapping-divisions-label">Divisions taught together</InputLabel>
                <Select
                  labelId="mapping-divisions-label"
                  multiple
                  label="Divisions taught together"
                  value={divisionSelection(formData.division)}
                  renderValue={(selected) => Array.isArray(selected) && selected.length > 0 ? selected.join(' + ') : 'All division groups'}
                  onChange={event => {
                    const value = event.target.value
                    const selected = divisionSelection(Array.isArray(value) ? value : String(value).split(','))
                    setFormData(prev => ({ ...prev, division: divisionSelectionValue(selected) }))
                  }}
                >
                  {divisionOptions.map(item => (
                    <MenuItem key={item} value={item}>
                      <Checkbox size="small" checked={divisionSelection(formData.division).includes(item)} />
                      <ListItemText primary={`Division ${item}`} />
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>Select divisions sharing this lecture. Leave blank for separate division groups.</FormHelperText>
              </FormControl>
              <TextField
                size="small"
                fullWidth
                label="Section"
                value={formData.section}
                onChange={e => setFormData(prev => ({ ...prev, section: e.target.value }))}
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseMapping}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmitMapping}>
            {editingMapping ? 'Update' : 'Assign'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ────────────────────── Schedule / reschedule dialogs ────────────────────── */}
      <ScheduleSlotDialog
        open={Boolean(schedulePrefill)}
        collegeId={collegeId}
        prefill={schedulePrefill}
        facultyOptions={facultyList}
        divisionOptions={divisionOptions}
        onClose={() => setSchedulePrefill(null)}
        onSaved={handleSlotSaved}
      />

      <RescheduleClassDialog
        open={Boolean(rescheduleSlot)}
        slot={rescheduleSlot}
        facultyOptions={facultyList}
        onClose={() => setRescheduleSlot(null)}
        onDone={handleRescheduled}
      />

      {autoMapFor && (
        <AutoMapDialog
          curriculum={autoMapFor}
          knownBatches={batches}
          divisionOptions={divisionOptions}
          onClose={() => setAutoMapFor(null)}
          onApplied={created => {
            refresh()
            notify(
              created > 0
                ? `${created} subject${created === 1 ? '' : 's'} auto-mapped — review them below`
                : 'No new mappings were applied',
              created > 0 ? 'success' : 'info',
            )
          }}
        />
      )}

      {/* ────────────────────── Snackbar ────────────────────── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={7000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
      >
        <Alert
          onClose={() => setSnackbar(s => ({ ...s, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default AdminCurriculum
