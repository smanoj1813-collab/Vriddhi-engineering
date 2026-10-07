// src/modules/admin/components/RescheduleClassDialog.tsx
// ─── Flow step 3: move a class, and know what the move will do ───────────────
//
// Two questions an admin actually has when a class has to move:
//
//   "Is this the new time from now on?"  → scope 'slot'
//   "Is this just this once?"            → scope 'session'
//
// The dialog answers both from the same screen. It reads the classes the slot
// has already produced (fetchSlotSessions) and previews the outcome of the move
// before anything is written — "2 classes move to Wed, 1 stays (already on
// Wednesday)" — using the same rules the server applies. The write goes through
// the `rescheduleClass` callable, which is the only thing that touches the
// documents, so delivered classes can never be rewritten from the browser.

import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { fetchSlotSessions } from '../api/scheduleApi'
import {
  rescheduleClass,
  SessionConflictError,
  toDateKey,
  type RescheduleClassResult,
  type SessionConflict,
} from '../api/classSessionApi'
import {
  DAY_LABELS,
  DAY_ORDER,
  formatDateLabel,
  formatSlot,
  previewSlotMove,
  todayKey,
} from '../utils/curriculumFlow'
import type { DayOfWeek, WeeklyClassSchedule } from '../types/schedule'

interface Props {
  open: boolean
  slot: WeeklyClassSchedule | null
  facultyOptions: { id: string; uid?: string; name: string; department?: string; branches?: string[] }[]
  onClose: () => void
  onDone: (result: RescheduleClassResult) => void
}

type Scope = 'slot' | 'session'

const RescheduleClassDialog: React.FC<Props> = ({ open, slot, facultyOptions, onClose, onDone }) => {
  const [scope, setScope] = useState<Scope>('slot')
  const [dayOfWeek, setDayOfWeek] = useState<DayOfWeek>('monday')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [room, setRoom] = useState('')
  const [facultyId, setFacultyId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [newDate, setNewDate] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflicts, setConflicts] = useState<SessionConflict[]>([])

  const today = todayKey()

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['slotSessions', slot?.id],
    queryFn: () => fetchSlotSessions(slot!.id),
    enabled: open && !!slot?.id,
  })

  useEffect(() => {
    if (!open || !slot) return
    setScope('slot')
    setDayOfWeek(slot.dayOfWeek)
    setStartTime(slot.startTime)
    setEndTime(slot.endTime)
    setRoom(slot.room || '')
    setFacultyId(slot.facultyId || '')
    setNewDate('')
    setReason('')
    setError('')
    setConflicts([])
  }, [open, slot])

  // The classes a move can still act on: future, still scheduled, unmarked.
  const upcoming = useMemo(
    () =>
      sessions.filter(
        session =>
          (session.status || 'scheduled') === 'scheduled' &&
          session.date >= today &&
          !session.attendanceMarked &&
          (session.topicsCovered || []).length === 0,
      ),
    [sessions, today],
  )

  useEffect(() => {
    if (scope !== 'session') return
    if (upcoming.length === 0) {
      setSessionId('')
      return
    }
    if (!upcoming.some(session => session.id === sessionId)) {
      setSessionId(upcoming[0].id)
      setNewDate(upcoming[0].date)
    }
  }, [scope, upcoming, sessionId])

  const selectedSession = upcoming.find(session => session.id === sessionId) || null

  const preview = useMemo(
    () => (scope === 'slot' ? previewSlotMove({ sessions: upcoming, newDay: dayOfWeek, from: today }) : []),
    [scope, upcoming, dayOfWeek, today],
  )

  const moveCount = preview.filter(row => row.action === 'move').length
  const keepCount = preview.filter(row => row.action === 'keep').length
  const mergeCount = preview.filter(row => row.action === 'merge').length

  const timeInvalid = !startTime || !endTime || endTime <= startTime
  const canSave =
    !!slot &&
    !timeInvalid &&
    (scope === 'slot' ? true : Boolean(sessionId && newDate)) &&
    !(scope === 'session' && newDate < today)

  const handleSave = async (allowConflicts = false) => {
    if (!slot || !canSave) return
    setSaving(true)
    setError('')
    setConflicts([])
    try {
      const result = await rescheduleClass({
        weeklyScheduleId: slot.id,
        scope,
        ...(scope === 'session' ? { sessionId, date: newDate } : {}),
        ...(scope === 'slot' ? { dayOfWeek } : {}),
        startTime,
        endTime,
        room,
        ...(facultyId ? { facultyId, facultyName: facultyOptions.find(f => f.id === facultyId)?.name || '' } : {}),
        ...(reason ? { reason } : {}),
        from: today,
        ...(allowConflicts ? { allowConflicts: true } : {}),
      })
      onDone(result)
      setSaving(false)
      onClose()
    } catch (err) {
      if (err instanceof SessionConflictError) {
        setConflicts(err.conflicts)
        setError(err.message)
      } else {
        setError(err instanceof Error ? err.message : 'The class could not be rescheduled.')
      }
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Reschedule {slot ? `“${slot.subject}”` : 'class'}
        {slot && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Currently {formatSlot(slot)} · {slot.branch} · {slot.batch}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && (
            <Alert severity="error">
              {error}
              {conflicts.length > 0 && (
                <Stack spacing={0.5} sx={{ mt: 1 }}>
                  {conflicts.slice(0, 4).map((conflict, index) => (
                    <Typography key={index} variant="caption">
                      {conflict.kind} · {formatDateLabel(conflict.date)} {conflict.startTime}–{conflict.endTime}
                    </Typography>
                  ))}
                </Stack>
              )}
            </Alert>
          )}

          <ToggleButtonGroup
            exclusive
            size="small"
            value={scope}
            onChange={(_, value: Scope | null) => value && setScope(value)}
          >
            <ToggleButton value="slot">From this day on (whole timetable slot)</ToggleButton>
            <ToggleButton value="session">Just one class</ToggleButton>
          </ToggleButtonGroup>

          {scope === 'session' ? (
            <>
              <FormControl fullWidth size="small">
                <InputLabel>Which class</InputLabel>
                <Select
                  label="Which class"
                  value={sessionId}
                  onChange={e => {
                    setSessionId(e.target.value)
                    const picked = upcoming.find(session => session.id === e.target.value)
                    if (picked) setNewDate(picked.date)
                  }}
                >
                  {upcoming.map(session => (
                    <MenuItem key={session.id} value={session.id}>
                      {formatDateLabel(session.date)} · {session.timeSlot || 'time not set'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                type="date"
                label="Move to"
                value={newDate}
                error={Boolean(newDate) && newDate < today}
                helperText={newDate && newDate < today ? 'Pick today or later' : ''}
                onChange={e => setNewDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              {selectedSession && (
                <Typography variant="caption" color="text.secondary">
                  The recurring timetable keeps its {DAY_LABELS[slot?.dayOfWeek || 'monday']} slot — only this one
                  class moves. Use “From this day on” to change the weekly pattern.
                </Typography>
              )}
            </>
          ) : (
            <FormControl fullWidth size="small">
              <InputLabel>New day</InputLabel>
              <Select
                label="New day"
                value={dayOfWeek}
                onChange={e => setDayOfWeek(e.target.value as DayOfWeek)}
              >
                {DAY_ORDER.map(day => (
                  <MenuItem key={day} value={day}>
                    {DAY_LABELS[day]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              type="time"
              label="From"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ flex: '1 1 120px' }}
            />
            <TextField
              size="small"
              type="time"
              label="To"
              value={endTime}
              error={timeInvalid}
              helperText={timeInvalid ? 'Must end after it starts' : ''}
              onChange={e => setEndTime(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ flex: '1 1 120px' }}
            />
            <TextField
              size="small"
              label="Room"
              value={room}
              onChange={e => setRoom(e.target.value)}
              sx={{ flex: '1 1 120px' }}
            />
          </Box>

          <FormControl fullWidth size="small">
            <InputLabel>Faculty</InputLabel>
            {/* Slots carry the faculty profile id — keep the timetable's
                identity, not the curriculum mapping's uid. */}
            <Select label="Faculty" value={facultyId} onChange={e => setFacultyId(e.target.value)}>
              {facultyOptions.map(faculty => (
                <MenuItem key={faculty.id} value={faculty.id}>
                  {faculty.name}
                  {(faculty.branches?.length || faculty.department) ? ` — ${(faculty.branches?.length ? faculty.branches : [faculty.department]).join(', ')}` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            size="small"
            label="Reason (shown to faculty and students)"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />

          <Divider />

          {/* What the move will do, before it does it */}
          {isLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Reading the classes this slot has already produced…
              </Typography>
            </Box>
          ) : upcoming.length === 0 ? (
            <Alert severity="info">
              No dated class exists for this slot yet. The timetable change applies from the next generation
              run; use “Create the dated classes” on the subject row if attendance needs them now.
            </Alert>
          ) : scope === 'slot' ? (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {moveCount > 0
                  ? `${moveCount} class${moveCount === 1 ? '' : 'es'} will move`
                  : 'Nothing needs to move'}
                {keepCount > 0 ? ` · ${keepCount} already on ${DAY_LABELS[dayOfWeek]}` : ''}
                {mergeCount > 0 ? ` · ${mergeCount} already exist at the destination` : ''}
              </Typography>
              <Stack spacing={0.5}>
                {preview.slice(0, 6).map(row => (
                  <Box key={row.date} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ minWidth: 96 }}>
                      {formatDateLabel(row.date)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      →
                    </Typography>
                    <Typography variant="caption" sx={{ minWidth: 96 }}>
                      {row.action === 'move' ? formatDateLabel(row.newDate) : 'stays'}
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={row.action === 'move' ? 'primary' : row.action === 'merge' ? 'warning' : 'default'}
                      label={row.action === 'move' ? 'moves' : row.action === 'merge' ? 'merges' : 'unchanged'}
                      sx={{ height: 18, fontSize: 11 }}
                    />
                  </Box>
                ))}
                {preview.length > 6 && (
                  <Typography variant="caption" color="text.disabled">
                    …and {preview.length - 6} more
                  </Typography>
                )}
              </Stack>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {selectedSession
                ? `${formatDateLabel(selectedSession.date)} moves to ${formatDateLabel(newDate)}.`
                : 'Pick the class to move.'}
            </Typography>
          )}

          <Typography variant="caption" color="text.disabled">
            Classes that were already delivered, marked or covered are never changed.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {conflicts.length > 0 && (
          <Button color="warning" onClick={() => handleSave(true)} disabled={saving}>
            Move anyway
          </Button>
        )}
        <Button variant="contained" onClick={() => handleSave(false)} disabled={!canSave || saving}>
          {saving ? 'Moving…' : 'Confirm move'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default RescheduleClassDialog
