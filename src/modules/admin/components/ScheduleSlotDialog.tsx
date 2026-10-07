// src/modules/admin/components/ScheduleSlotDialog.tsx
// ─── Flow step 2: put a subject on the timetable without leaving the page ────
//
// AdminCurriculum used to send the admin to the Class Schedule page with a
// prefilled form, which means the flow left the screen the admin was working
// on and came back with no memory of it. This dialog is the same creation path
// (createWeeklySchedule → the timetable) plus the one thing the flow needs to
// stay connected: an optional immediate materialisation of the next few weeks,
// through the same `generateClassSessions` callable the timetable page uses.
//
// Nothing here writes a class session directly — the server decides what a
// session looks like (S2.2), so a slot scheduled from here is byte-identical to
// one scheduled from the Class Schedule page.

import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  FormHelperText,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  createWeeklySchedule,
  checkScheduleClashes,
  type ClashCheckResult,
} from '../api/scheduleApi'
import {
  generateClassSessions,
  SessionConflictError,
  defaultTermWindow,
} from '../api/classSessionApi'
import { DAY_LABELS, DAY_ORDER } from '../utils/curriculumFlow'
import type { ClassType, DayOfWeek, WeeklyClassSchedule, WeeklyScheduleFormData } from '../types/schedule'
import { divisionSelection, divisionSelectionValue } from '@/shared/utils/divisionGroups'

export interface SlotPrefill {
  subject: string
  subjectCode: string
  facultyId: string
  facultyName: string
  branch: string
  batch: string
  semester: number
  division: string
  section: string
}

interface Props {
  open: boolean
  collegeId: string
  prefill: SlotPrefill | null
  facultyOptions: { id: string; uid?: string; name: string; department?: string; branches?: string[] }[]
  divisionOptions?: string[]
  onClose: () => void
  onSaved: (payload: { slot: WeeklyClassSchedule; generated: number; sessionsError?: string }) => void
}

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

const ScheduleSlotDialog: React.FC<Props> = ({
  open,
  collegeId,
  prefill,
  facultyOptions,
  divisionOptions = [],
  onClose,
  onSaved,
}) => {
  const [form, setForm] = useState<WeeklyScheduleFormData>({ ...EMPTY_FORM })
  const [materialise, setMaterialise] = useState(true)
  const [saving, setSaving] = useState(false)
  const [clashes, setClashes] = useState<ClashCheckResult['clashes']>([])
  const [error, setError] = useState('')

  // Prefill from the course row that opened the dialog. The rows are the
  // curriculum's own subjects, so the admin only has to choose a day and time.
  // The mapping keeps the Auth uid (the canonical curriculum key) while the
  // timetable stores the faculty PROFILE document id — that is the id every
  // faculty-facing reader resolves to. Translate on the way in so a slot
  // scheduled from the flow carries the same id the Class Schedule page writes.
  const profileIdFor = (facultyId: string): string => {
    const match = facultyOptions.find(f => f.id === facultyId || f.uid === facultyId)
    return match?.id || facultyId
  }

  useEffect(() => {
    if (!open || !prefill) return
    setForm({
      ...EMPTY_FORM,
      subject: prefill.subject || '',
      subjectCode: prefill.subjectCode || '',
      facultyId: prefill.facultyId ? profileIdFor(prefill.facultyId) : '',
      branch: prefill.branch || '',
      batch: prefill.batch || '',
      semester: prefill.semester || 1,
      division: prefill.division || '',
      section: prefill.section || '',
    })
    setClashes([])
    setError('')
    setMaterialise(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill, facultyOptions.length])

  const timeInvalid = useMemo(() => {
    if (!form.startTime || !form.endTime) return true
    return form.endTime <= form.startTime
  }, [form.startTime, form.endTime])

  const canSave = Boolean(
    collegeId && form.subject.trim() && form.facultyId && form.branch.trim() && form.batch.trim() && !timeInvalid,
  )

  const entry = useMemo(
    () => ({
      collegeId,
      subject: form.subject.trim(),
      subjectCode: form.subjectCode.trim(),
      facultyId: form.facultyId,
      facultyName: facultyOptions.find(f => f.id === form.facultyId)?.name || '',
      branch: form.branch.trim(),
      batch: form.batch.trim(),
      semester: Number(form.semester) || 1,
      division: form.division || '',
      section: form.section || '',
      room: form.room.trim(),
      dayOfWeek: form.dayOfWeek as DayOfWeek,
      startTime: form.startTime,
      endTime: form.endTime,
      type: (form.type || 'lecture') as ClassType,
      isActive: true,
    }),
    [collegeId, form, facultyOptions],
  )

  const handleSave = async (force = false) => {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      // Advisory check while the admin is still in the dialog: the server
      // refuses a hard clash at materialisation, so catching it here is a
      // courtesy, not the enforcement.
      if (!force) {
        const checked = await checkScheduleClashes(entry)
        if (checked.hasClashes) {
          setClashes(checked.clashes)
          setSaving(false)
          return
        }
      }

      const slot = await createWeeklySchedule(form)
      let generated = 0
      let sessionsError = ''
      if (materialise) {
        const term = defaultTermWindow()
        try {
          const result = await generateClassSessions({
            from: term.from,
            to: term.to,
            weeklyScheduleId: slot.id,
          })
          generated = result.created
          if (result.skippedConflicts > 0) {
            sessionsError = `${result.skippedConflicts} class(es) were skipped: they would double-book a faculty member or a room.`
          }
          if (result.skippedHolidayCount) {
            sessionsError = `${sessionsError} ${result.skippedHolidayCount} date(s) fall on a holiday.`.trim()
          }
        } catch (genError) {
          sessionsError =
            genError instanceof SessionConflictError
              ? genError.message
              : genError instanceof Error
                ? genError.message
                : 'The class was added, but its dated sessions could not be created.'
        }
      }

      onSaved({ slot, generated, sessionsError })
      setSaving(false)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The class could not be scheduled.')
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Schedule this class
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Adds it to the weekly timetable and, unless you untick it, creates the dated classes for the next
          four weeks so attendance and the student timetable line up straight away.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {clashes.length > 0 && (
            <Alert severity="warning">
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                This clashes with {clashes.length} existing class{clashes.length === 1 ? '' : 'es'}:
              </Typography>
              <Stack spacing={0.5}>
                {clashes.slice(0, 4).map((clash, index) => (
                  <Typography key={index} variant="caption">
                    {clash.kind === 'faculty' ? 'Faculty' : clash.kind === 'room' ? 'Room' : 'Batch'} ·{' '}
                    {DAY_LABELS[clash.dayOfWeek] || clash.dayOfWeek} {clash.startTime}–{clash.endTime} ·{' '}
                    {clash.existingDetails || clash.message}
                  </Typography>
                ))}
              </Stack>
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label="Subject"
              value={form.subject}
              onChange={e => setForm(prev => ({ ...prev, subject: e.target.value }))}
              sx={{ flex: '1 1 240px' }}
            />
            <TextField
              size="small"
              label="Subject code"
              value={form.subjectCode}
              onChange={e => setForm(prev => ({ ...prev, subjectCode: e.target.value }))}
              sx={{ flex: '0 1 150px' }}
            />
          </Box>

          <FormControl fullWidth size="small">
            <InputLabel>Faculty</InputLabel>
            <Select
              label="Faculty"
              value={form.facultyId}
              onChange={e => setForm(prev => ({ ...prev, facultyId: e.target.value }))}
            >
              {facultyOptions.map(faculty => (
                <MenuItem key={faculty.id} value={faculty.id}>
                  {faculty.name}
                  {(faculty.branches?.length || faculty.department) ? ` — ${(faculty.branches?.length ? faculty.branches : [faculty.department]).join(', ')}` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel id="slot-division-label">Divisions taught together</InputLabel>
            <Select
              labelId="slot-division-label"
              multiple
              label="Divisions taught together"
              value={divisionSelection(form.division)}
              renderValue={(selected) => Array.isArray(selected) && selected.length > 0 ? selected.join(' + ') : 'Whole batch'}
              onChange={event => {
                const value = event.target.value
                const selected = divisionSelection(Array.isArray(value) ? value : String(value).split(','))
                setForm(prev => ({ ...prev, division: divisionSelectionValue(selected) }))
              }}
            >
              {divisionOptions.map(item => (
                <MenuItem key={item} value={item}>
                  <Checkbox size="small" checked={divisionSelection(form.division).includes(item)} />
                  <ListItemText primary={`Division ${item}`} />
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>Select divisions sharing this lecture. Leave blank to make it a whole-batch class.</FormHelperText>
          </FormControl>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ flex: '1 1 130px' }}>
              <InputLabel>Day</InputLabel>
              <Select
                label="Day"
                value={form.dayOfWeek}
                onChange={e => setForm(prev => ({ ...prev, dayOfWeek: e.target.value as DayOfWeek }))}
              >
                {DAY_ORDER.map(day => (
                  <MenuItem key={day} value={day}>
                    {DAY_LABELS[day]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              type="time"
              label="From"
              value={form.startTime}
              onChange={e => setForm(prev => ({ ...prev, startTime: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ flex: '1 1 110px' }}
            />
            <TextField
              size="small"
              type="time"
              label="To"
              value={form.endTime}
              error={timeInvalid}
              helperText={timeInvalid ? 'Must end after it starts' : ''}
              onChange={e => setForm(prev => ({ ...prev, endTime: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ flex: '1 1 110px' }}
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label="Room"
              value={form.room}
              onChange={e => setForm(prev => ({ ...prev, room: e.target.value }))}
              sx={{ flex: '1 1 140px' }}
            />
            <FormControl size="small" sx={{ flex: '1 1 140px' }}>
              <InputLabel>Type</InputLabel>
              <Select
                label="Type"
                value={form.type}
                onChange={e => setForm(prev => ({ ...prev, type: e.target.value as ClassType }))}
              >
                {CLASS_TYPES.map(type => (
                  <MenuItem key={type} value={type} sx={{ textTransform: 'capitalize' }}>
                    {type}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip size="small" variant="outlined" label={form.branch || 'No branch'} />
            <Chip size="small" variant="outlined" label={form.batch || 'No batch'} />
            <Chip size="small" variant="outlined" label={`Sem ${form.semester}`} />
            {(form.division || form.section) && (
              <Chip
                size="small"
                variant="outlined"
                label={[form.division && `Div ${form.division}`, form.section && `Sec ${form.section}`]
                  .filter(Boolean)
                  .join(' · ')}
              />
            )}
          </Box>

          <FormControlLabel
            control={
              <Checkbox checked={materialise} onChange={e => setMaterialise(e.target.checked)} size="small" />
            }
            label={
              <Typography variant="body2">
                Create the dated classes for the next four weeks (needed for attendance)
              </Typography>
            }
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {clashes.length > 0 && (
          <Button color="warning" onClick={() => handleSave(true)} disabled={saving}>
            Schedule anyway
          </Button>
        )}
        <Button variant="contained" onClick={() => handleSave(false)} disabled={!canSave || saving}>
          {saving ? 'Scheduling…' : 'Add to timetable'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ScheduleSlotDialog
