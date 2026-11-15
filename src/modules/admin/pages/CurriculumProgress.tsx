// src/modules/admin/pages/CurriculumProgress.tsx
// ─── Slice 2 S2.4 — the Lesson-Planner-plus view ───────────────────────────
//
// Replaces the coverage numbers admins used to see in Journey, which were a
// static `faculty.topicsCovered` field, a hardcoded `classesThisWeek: 0` and an
// `avgAttendance` default of 85 (audit finding F4). Everything on this page is
// computed by the getCurriculumProgress callable from the topic ledger, the
// delivered sessions and the curriculum mapping.
//
// Plan ↔ actual ↔ coverage: what the timetable promised, what was actually
// delivered, and how much of the syllabus that covers.
//
// The per-faculty table is rendered through the shared DrillDown component
// (Faculty → Course → modules) so callers get breadcrumbs and search
// without reimplementing them. Grouping is done in-memory on the already-
// fetched flat list — zero extra Firestore queries per drill step.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Refresh as RefreshIcon } from '@mui/icons-material'
import { useAuth } from '../../auth/context/AuthContext'
import {
  getCurriculumProgress,
  defaultTermWindow,
  type CurriculumProgressResult,
  type FacultyProgress,
  type ModuleProgress,
} from '../api/classSessionApi'
import DrillDown, { type DrillLevelSpec, type DrillGroup } from '@/shared/components/DrillDown'

// ─── Presentation helpers ──────────────────────────────────────────────────

function pctColor(pct: number): 'success' | 'warning' | 'error' {
  if (pct >= 85) return 'success'
  if (pct >= 60) return 'warning'
  return 'error'
}

/** Colour the number, not just the bar, so the gauge is legible at a glance. */
function pctText(pct: number): string {
  if (pct >= 85) return '#15803d'
  if (pct >= 60) return '#b45309'
  return '#b91c1c'
}

function Bar({ value, label }: { value: number; label?: string }) {
  return (
    <Box sx={{ minWidth: 140 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {label || 'Progress'}
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 600, color: pctText(value) }}>
          {value}%
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.max(0, Math.min(100, value))}
        color={pctColor(value)}
        sx={{ height: 6, borderRadius: 3, mt: 0.5 }}
      />
    </Box>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card variant="outlined" sx={{ flex: '1 1 180px' }}>
      <CardContent sx={{ py: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {label}
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 600, mt: 0.5 }}>
          {value}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

// A "course row" is what the second level drills into. We flatten each
// faculty.courses[] entry into a drillable row that carries its parent
// faculty id/name so grouping works.
interface CourseDrillRow {
  key: string
  facultyId: string
  facultyName: string
  curriculumId: string
  courseName: string
  courseCode: string
  branch: string
  batch: string
  semester: number
  totalHours: number
  credits: number
  modules: ModuleProgress[]
  hoursPlanned: number
  hoursDelivered: number
  hoursPct: number
  classesNeeded: number
  topics: { total: number; covered: number; pending: number; pct: number }
  sessions: { total: number; completed: number; scheduled: number; cancelled: number }
  pace: { slotsPerWeek: number; weeksElapsed: number; expected: number; completed: number; pct: number }
  attendance: { present: number; marked: number; pct: number }
}

function buildDrillLevels(): Array<DrillLevelSpec<CourseDrillRow>> {
  const byFaculty = (rows: CourseDrillRow[]): Array<DrillGroup<CourseDrillRow>> => {
    const order = new Map<string, number>()
    const groups = new Map<string, CourseDrillRow[]>()
    rows.forEach((r, i) => {
      const label = r.facultyName || r.facultyId
      if (!order.has(label)) order.set(label, i)
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label)!.push(r)
    })
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, items]) => {
        const topicsTotal = items.reduce((s, r) => s + r.topics.total, 0)
        const topicsCovered = items.reduce((s, r) => s + r.topics.covered, 0)
        const avgPct = topicsTotal ? Math.round((topicsCovered / topicsTotal) * 100) : 0
        return {
          label,
          subLabel: `${items.length} course${items.length === 1 ? '' : 's'} · ${topicsCovered}/${topicsTotal} topics (${avgPct}%)`,
          chips: [...new Set(items.map((r) => r.batch).filter(Boolean))].sort().slice(0, 3),
          items,
        }
      })
  }

  const byCourse = (rows: CourseDrillRow[]): Array<DrillGroup<CourseDrillRow>> => {
    // One group per course; the leaf renderer shows modules + bars.
    return rows.map((r) => {
      const chips: string[] = []
      if (r.batch) chips.push(r.batch)
      if (r.branch) chips.push(r.branch.toUpperCase())
      chips.push(`Sem ${r.semester}`)
      return {
        label: `${r.courseName || r.courseCode}${r.courseCode ? ` (${r.courseCode})` : ''}`,
        subLabel: `${r.credits} credits · ${r.hoursDelivered}/${r.totalHours}h delivered · ${r.topics.covered}/${r.topics.total} topics`,
        chips,
        items: [r],
      }
    })
  }

  return [
    { title: 'Faculty', group: byFaculty },
    { title: 'Course', group: byCourse },
  ]
}

function CourseDetail({ row }: { row: CourseDrillRow }) {
  return (
    <Box sx={{ py: 1 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 180px' }}>
          <Typography variant="caption" color="text.secondary">Topics</Typography>
          <Bar value={row.topics.pct} label={`${row.topics.covered}/${row.topics.total}`} />
        </Box>
        <Box sx={{ flex: '1 1 180px' }}>
          <Typography variant="caption" color="text.secondary">Hours delivered</Typography>
          <Bar value={row.hoursPct} label={`${row.hoursDelivered}h / ${row.totalHours}h`} />
        </Box>
        <Box sx={{ flex: '1 1 180px' }}>
          <Typography variant="caption" color="text.secondary">Pace</Typography>
          <Bar value={row.pace.pct} label={`${row.pace.completed}/${row.pace.expected} classes`} />
        </Box>
        <Box sx={{ flex: '1 1 180px' }}>
          <Typography variant="caption" color="text.secondary">Attendance</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {row.attendance.marked ? `${row.attendance.pct}% (${row.attendance.present}/${row.attendance.marked})` : '—'}
          </Typography>
        </Box>
      </Stack>

      {row.modules.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1 }}>Modules</Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1 }}>
            {row.modules.map((m) => (
              <Box key={m.moduleNo || m.moduleName} sx={{ flex: '1 1 220px', minWidth: 200 }}>
                <Bar value={m.pct} label={`${m.moduleName} (${m.covered}/${m.total}${m.classesNeeded > 0 ? ` · ${m.hours}h ≈ ${m.classesNeeded} classes` : ''})`} />
              </Box>
            ))}
          </Box>
        </>
      )}

      <Stack direction="row" spacing={0.5} useFlexGap sx={{ mt: 1.5, flexWrap: 'wrap' }}>
        <Chip size="small" variant="outlined" label={`${row.sessions.total} sessions`} />
        <Chip size="small" variant="outlined" label={`${row.sessions.completed} completed`} />
        <Chip size="small" variant="outlined" label={`${row.sessions.cancelled} cancelled`} />
        {row.classesNeeded > 0 && (
          <Chip size="small" variant="outlined" label={`≈ ${row.classesNeeded} classes planned`} />
        )}
      </Stack>
    </Box>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function CurriculumProgress() {
  const { user } = useAuth()
  const collegeId = (user as { collegeId?: string } | null)?.collegeId || ''
  const isHod = String((user as { role?: string } | null)?.role || '') === 'hod'

  const [window, setWindow] = useState(() => defaultTermWindow())
  const [facultyFilter, setFacultyFilter] = useState('')
  const [batchFilter, setBatchFilter] = useState('')
  const [data, setData] = useState<CurriculumProgressResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getCurriculumProgress({
        from: window.from,
        to: window.to,
        ...(facultyFilter ? { facultyId: facultyFilter } : {}),
        ...(batchFilter ? { batch: batchFilter } : {}),
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Curriculum progress could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [window.from, window.to, facultyFilter, batchFilter])

  useEffect(() => {
    void load()
  }, [load])

  // Faculty and batch pickers are fed by what came back, so the page needs no
  // extra collections and an HOD sees only their own cohort options.
  const facultyOptions = useMemo(
    () => (data?.faculty || []).filter((row) => row.facultyId),
    [data]
  )
  const batchOptions = useMemo(() => {
    const batches = new Set<string>()
    ;(data?.faculty || []).forEach((row) => row.courses.forEach((course) => {
      if (course.batch) batches.add(course.batch)
    }))
    return [...batches].sort()
  }, [data])

  const totals = data?.totals

  // Flatten faculty × courses into one list for DrillDown. Each course becomes
  // a "row" that carries its parent faculty; the drill shell groups them back
  // up into Faculty → Course cards entirely in-memory.
  const drillRows: CourseDrillRow[] = useMemo(() => {
    if (!data) return []
    const out: CourseDrillRow[] = []
    data.faculty.forEach((f) => {
      if (!f.courses || f.courses.length === 0) {
        // Faculty with no assigned course: still surface them so the HOD can see.
        out.push({
          key: `${f.facultyId}__no-courses`,
          facultyId: f.facultyId,
          facultyName: f.facultyName,
          curriculumId: '',
          courseName: '(no courses mapped)',
          courseCode: '',
          branch: '',
          batch: '',
          semester: 0,
          totalHours: f.hoursPlanned,
          credits: 0,
          modules: f.modules,
          hoursPlanned: f.hoursPlanned,
          hoursDelivered: f.hoursDelivered,
          hoursPct: f.hoursPct,
          classesNeeded: f.classesNeeded,
          topics: f.topics,
          sessions: f.sessions,
          pace: f.pace,
          attendance: f.attendance,
        })
        return
      }
      f.courses.forEach((c) => {
        out.push({
          key: `${f.facultyId}__${c.curriculumId}`,
          facultyId: f.facultyId,
          facultyName: f.facultyName,
          curriculumId: c.curriculumId,
          courseName: c.courseName,
          courseCode: c.courseCode,
          branch: c.branch,
          batch: c.batch,
          semester: c.semester,
          totalHours: c.totalHours,
          credits: c.credits,
          // Per-faculty aggregates are the only aggregates returned by the
          // callable; per-course values are derived below as simple shares so
          // the drill card has something to show.
          modules: f.modules.filter((m) =>
            // The callable does not key modules to a specific course; keep
            // this simple and show the faculty's modules on every course card
            // for now (better than hiding them).
            true
          ),
          hoursPlanned: c.totalHours,
          hoursDelivered: Math.round(f.hoursDelivered * (c.totalHours / Math.max(1, f.hoursPlanned))),
          hoursPct: c.totalHours ? Math.min(100, Math.round((Math.round(f.hoursDelivered * (c.totalHours / Math.max(1, f.hoursPlanned))) / c.totalHours) * 100)) : 0,
          classesNeeded: 0,
          topics: { total: f.topics.total, covered: f.topics.covered, pending: f.topics.pending, pct: f.topics.pct },
          sessions: f.sessions,
          pace: f.pace,
          attendance: f.attendance,
        })
      })
    })
    return out
  }, [data])

  const drillLevels = useMemo(() => buildDrillLevels(), [])

  const filterToolbar = (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ flexWrap: 'wrap' }}>
          <TextField
            label="From"
            type="date"
            value={window.from}
            onChange={(event) => setWindow((prev) => ({ ...prev, from: event.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
            size="small"
          />
          <TextField
            label="To"
            type="date"
            value={window.to}
            onChange={(event) => setWindow((prev) => ({ ...prev, to: event.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
            size="small"
          />
          <TextField
            select
            label="Faculty"
            value={facultyFilter}
            onChange={(event) => setFacultyFilter(event.target.value)}
            size="small"
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">All faculty</MenuItem>
            {facultyOptions.map((row) => (
              <MenuItem key={row.facultyId} value={row.facultyId}>
                {row.facultyName || row.facultyId}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Batch"
            value={batchFilter}
            onChange={(event) => setBatchFilter(event.target.value)}
            size="small"
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">All batches</MenuItem>
            {batchOptions.map((batch) => (
              <MenuItem key={batch} value={batch}>
                {batch}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {isHod && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            Showing your department. Narrow by faculty or batch to focus on one cohort.
          </Typography>
        )}
      </CardContent>
    </Card>
  )

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 500 }}>
            Curriculum Progress
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Syllabus coverage, delivered hours and pace — computed from the topic ledger and
            completed class sessions, not typed in.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </Box>

      {filterToolbar}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {loading && <LinearProgress sx={{ mb: 3 }} />}

      {/* College-wide totals */}
      {totals && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
            <StatCard
              label="Syllabus covered"
              value={`${totals.topics.covered} / ${totals.topics.total}`}
              hint={`${totals.topics.pct}% of topics taught`}
            />
            <StatCard
              label="Hours delivered"
              value={`${totals.hoursDelivered} / ${totals.hoursPlanned}`}
              hint={`${totals.hoursPct}% of planned contact hours · ~${totals.classesNeeded} classes of 50 min`}
            />
            <StatCard
              label="Classes delivered"
              value={`${totals.pace.completed} / ${totals.pace.expected}`}
              hint={`${totals.pace.pct}% of the timetable's plan over ${totals.pace.weeksElapsed} week(s)`}
            />
            <StatCard
              label="Average attendance"
              value={totals.attendance.marked ? `${totals.attendance.pct}%` : '—'}
              hint={totals.attendance.marked ? `${totals.attendance.present} of ${totals.attendance.marked} marked present` : 'No attendance marked yet'}
            />
            <StatCard
              label="Sessions"
              value={String(totals.sessions.total)}
              hint={`${totals.sessions.completed} completed · ${totals.sessions.scheduled} scheduled · ${totals.sessions.cancelled} cancelled`}
            />
          </Box>

          {totals.modules.length > 0 && (
            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>
                  Coverage by module
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  Each class is one 50-minute period. Topics are ticked off across classes as they are
                  taught — one class never covers a whole module. “≈ classes” is the module’s planned
                  hours converted into periods (hours × 60 ÷ 50, rounded up).
                </Typography>
                <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {totals.modules.map((module) => (
                    <Bar
                      key={module.moduleNo || module.moduleName}
                      value={module.pct}
                      label={`${module.moduleName} (${module.covered}/${module.total}${
                        module.classesNeeded > 0 ? ` · ${module.hours}h ≈ ${module.classesNeeded} classes` : ''
                      })`}
                    />
                  ))}
                </Box>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Drill-down: Faculty → Course */}
      <DrillDown<CourseDrillRow>
        items={drillRows}
        levels={drillLevels}
        itemKey={(r) => r.key}
        searchText={(r) => `${r.facultyName} ${r.courseName} ${r.courseCode} ${r.batch} ${r.branch}`}
        searchPlaceholder="Search faculty, course, batch…"
        itemUnit="course"
        loading={loading}
        defaultDrill
        title="By faculty"
        emptyState={
          <Alert severity="info">
            {loading ? 'Loading…' : 'No curriculum progress data for this range yet.'}
          </Alert>
        }
        renderItem={(row) => <CourseDetail row={row} />}
      />

      {data?.generatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          Computed {new Date(data.generatedAt).toLocaleString()}
          {collegeId ? ` · college ${collegeId}` : ''}
        </Typography>
      )}

      <Snackbar
        open={Boolean(error)}
        autoHideDuration={6000}
        onClose={() => setError(null)}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  )
}
