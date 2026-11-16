// src/modules/admin/pages/AcademicInsights.tsx
//
// Academic Insights — four-level drill: Semesters → Subjects → Subject detail → Students.
//
// All aggregation is server-side in functions/src/academicInsights.ts (see
// docs/firestore-cost-controls.md for the per-invocation read ceiling). The
// page loads once on mount, once on explicit Refresh, and again after a
// successful drill-in (C7 — no interval/focus/reconnect polling).
//
// Scope rules: faculty/mentor see only their own subjects; HOD sees the
// department (same branch/batch filters apply); admin/principal/superadmin
// see college-wide. The scopeLine copy reflects this.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  ArrowBack as ArrowBackIcon,
  ChevronRight as ChevronRightIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material'
import { Link } from 'react-router-dom'

import { useAuth } from '../../auth/context/AuthContext'
import {
  getAcademicInsights,
  type AcademicInsightsResult,
  type SemesterInsight,
  type SubjectInsight,
  type StudentInsight,
  type AssessmentDetail,
  type AttendanceTrendPoint,
} from '../api/academicInsightsApi'
import { defaultTermWindow } from '../api/classSessionApi'
import AcademicInsightsCard, { progressTone } from '../components/AcademicInsightsCard'

type SubjectTab = 'attendance' | 'completion' | 'assignments' | 'scores'

export default function AcademicInsights() {
  const { user } = useAuth()
  const role = String(user?.role || '')
  const collegeId = String((user as { collegeId?: string } | null)?.collegeId || '')
  const isSuperadmin = role === 'superadmin'

  const [window, setWindow] = useState(() => defaultTermWindow())
  const [semesterFilter, setSemesterFilter] = useState<number | ''>('')
  const [branchFilter, setBranchFilter] = useState('')
  const [batchFilter, setBatchFilter] = useState('')
  const [facultyFilter, setFacultyFilter] = useState('')

  const [data, setData] = useState<AcademicInsightsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Drill state: 'overview' | 'semester' | 'subject'
  const [view, setView] = useState<'overview' | 'semester' | 'subject'>('overview')
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null)
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string | null>(null)
  const [subjectTab, setSubjectTab] = useState<SubjectTab>('attendance')
  const [subjectLoading, setSubjectLoading] = useState(false)

  const load = useCallback(
    async (drill?: { semester?: number; curriculumId?: string }) => {
      setError(null)
      if (drill) setSubjectLoading(true)
      else setLoading(true)
      try {
        const result = await getAcademicInsights({
          collegeId: isSuperadmin ? (collegeId || undefined) : undefined,
          from: window.from,
          to: window.to,
          semester: drill?.semester ?? (semesterFilter || undefined),
          branch: branchFilter || undefined,
          batch: batchFilter || undefined,
          facultyId: facultyFilter || undefined,
          curriculumId: drill?.curriculumId,
        })
        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Academic insights could not be loaded.')
      } finally {
        setLoading(false)
        setSubjectLoading(false)
      }
    },
    [isSuperadmin, collegeId, window.from, window.to, semesterFilter, branchFilter, batchFilter, facultyFilter]
  )

  // Initial load.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await getAcademicInsights({
          collegeId: isSuperadmin ? (collegeId || undefined) : undefined,
          from: window.from,
          to: window.to,
        })
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Academic insights could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // Only run on mount — manual Refresh calls load().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Second effect: subject drill-in loads with curriculumId.
  useEffect(() => {
    if (view !== 'subject' || !selectedCurriculumId || !selectedSemester) return
    let cancelled = false
    void (async () => {
      setSubjectLoading(true)
      setError(null)
      try {
        const result = await getAcademicInsights({
          collegeId: isSuperadmin ? (collegeId || undefined) : undefined,
          from: window.from,
          to: window.to,
          semester: selectedSemester,
          branch: branchFilter || undefined,
          batch: batchFilter || undefined,
          facultyId: facultyFilter || undefined,
          curriculumId: selectedCurriculumId,
        })
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Subject detail could not be loaded.')
      } finally {
        if (!cancelled) setSubjectLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedCurriculumId])

  const semesters = data?.semesters || []
  const semOptions = useMemo(() => semesters.map((s) => s.semester).sort((a, b) => a - b), [semesters])

  const activeSemester: SemesterInsight | null = useMemo(() => {
    if (selectedSemester === null || !data) return null
    return data.semesters.find((s) => s.semester === selectedSemester) || null
  }, [data, selectedSemester])

  const activeSubject: SubjectInsight | null = useMemo(() => {
    if (!activeSemester || !selectedCurriculumId) return null
    return activeSemester.subjects.find((s) => s.curriculumId === selectedCurriculumId) || null
  }, [activeSemester, selectedCurriculumId])

  const handleDrillSemester = (semester: number) => {
    setSelectedSemester(semester)
    setView('semester')
  }
  const handleDrillSubject = (subject: SubjectInsight) => {
    setSelectedCurriculumId(subject.curriculumId)
    setView('subject')
  }
  const handleBack = () => {
    if (view === 'subject') { setView('semester'); setSelectedCurriculumId(null) }
    else if (view === 'semester') { setView('overview'); setSelectedSemester(null) }
  }

  const filterCard = (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ flexWrap: 'wrap' }}>
          <TextField
            label="From"
            type="date"
            value={window.from}
            onChange={(e) => setWindow((p) => ({ ...p, from: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
            size="small"
          />
          <TextField
            label="To"
            type="date"
            value={window.to}
            onChange={(e) => setWindow((p) => ({ ...p, to: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
            size="small"
          />
          <TextField
            select
            label="Semester"
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value === '' ? '' : Number(e.target.value))}
            size="small"
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">All semesters</MenuItem>
            {semOptions.map((s) => (
              <MenuItem key={s} value={s}>Semester {s}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Branch"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            size="small"
            sx={{ minWidth: 140 }}
          />
          <TextField
            label="Batch"
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            size="small"
            sx={{ minWidth: 140 }}
          />
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Apply filters'}
          </Button>
        </Stack>
        {data?.scopeLine && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            {data.scopeLine}
          </Typography>
        )}
      </CardContent>
    </Card>
  )

  if (loading && !data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Curriculum Insights
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Semester → subject → student analytics: coverage, attendance, completion and scores —
            aggregated server-side, never typed in.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </Box>

      {filterCard}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Breadcrumbs */}
      {view !== 'overview' && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" onClick={handleBack} aria-label="Go back">
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />}>
              <Link to="#" style={{ color: 'inherit', textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); setView('overview'); setSelectedSemester(null); setSelectedCurriculumId(null) }}>
                <Typography variant="body2" sx={{ cursor: 'pointer' }}>Semesters</Typography>
              </Link>
              {selectedSemester !== null && (() => {
                const showingSemester = view === 'semester'
                return showingSemester ? (
                  <Typography key="sem-current" variant="body2" sx={{ fontWeight: 600 }}>Semester {selectedSemester}</Typography>
                ) : (
                  <Link key="sem-link" to="#" style={{ color: 'inherit', textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); setView('semester'); setSelectedCurriculumId(null) }}>
                    <Typography variant="body2" sx={{ cursor: 'pointer' }}>Semester {selectedSemester}</Typography>
                  </Link>
                )
              })()}
              {view === 'subject' && activeSubject && (
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {activeSubject.courseName} ({activeSubject.courseCode})
                </Typography>
              )}
            </Breadcrumbs>
          </Box>
        </Card>
      )}

      {/* Overview stats */}
      {data && view === 'overview' && (
        <>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mb: 3 }}>
            <AcademicInsightsCard label="Semesters" value={data.totals.semesters} hint={`${data.totals.subjects} subjects`} />
            <AcademicInsightsCard label="Faculty" value={data.totals.faculty} hint={`${data.totals.students} students`} />
            <AcademicInsightsCard
              label="Classes delivered"
              value={`${data.totals.completedSessions} / ${data.totals.sessions}`}
              progress={data.totals.sessions > 0 ? (data.totals.completedSessions / data.totals.sessions) * 100 : 0}
              tone={progressTone(data.totals.sessions > 0 ? (data.totals.completedSessions / data.totals.sessions) * 100 : 0)}
            />
            <AcademicInsightsCard
              label="Avg attendance"
              value={data.totals.avgAttendance !== null ? `${data.totals.avgAttendance}%` : '—'}
              progress={data.totals.avgAttendance ?? 0}
              tone={progressTone(data.totals.avgAttendance)}
            />
            <AcademicInsightsCard
              label="Assignments completion"
              value={data.totals.avgCompletion !== null ? `${data.totals.avgCompletion}%` : '—'}
              progress={data.totals.avgCompletion ?? 0}
              tone={progressTone(data.totals.avgCompletion)}
            />
            <AcademicInsightsCard
              label="Avg score"
              value={data.totals.avgScore !== null ? `${data.totals.avgScore}%` : '—'}
              progress={data.totals.avgScore ?? 0}
              tone={progressTone(data.totals.avgScore)}
            />
          </Stack>

          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>Semesters</Typography>
          <Box
            sx={{
              display: 'grid', gap: 2,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
            }}
          >
            {semesters.map((sem) => (
              <Card key={sem.semester} variant="outlined">
                <CardActionArea onClick={() => handleDrillSemester(sem.semester)} sx={{ p: 2 }}>
                  <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Semester {sem.semester}</Typography>
                      <Chip size="small" color="primary" variant="outlined" label={`${sem.subjectCount} subjects`} />
                    </Box>
                    <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                      <MetricRow label="Faculty" value={`${sem.facultyCount}`} />
                      <MetricRow label="Students" value={`${sem.studentCount}`} />
                      <MetricRow
                        label="Attendance"
                        value={`${sem.avgAttendancePct}%`}
                        tone={progressTone(sem.avgAttendancePct)}
                      />
                      <MetricRow
                        label="Completion"
                        value={`${sem.completionPct}%`}
                        tone={progressTone(sem.completionPct)}
                      />
                      <MetricRow
                        label="Avg score"
                        value={sem.avgScore !== null ? `${sem.avgScore}%` : '—'}
                        tone={progressTone(sem.avgScore)}
                      />
                    </Stack>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                      <Button size="small" endIcon={<ChevronRightIcon />} sx={{ textTransform: 'none' }} tabIndex={-1}>Open</Button>
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </>
      )}

      {/* Semester view */}
      {data && view === 'semester' && activeSemester && (
        <>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mb: 3 }}>
            <AcademicInsightsCard label="Subjects" value={activeSemester.subjectCount} />
            <AcademicInsightsCard label="Faculty" value={activeSemester.facultyCount} />
            <AcademicInsightsCard label="Students" value={activeSemester.studentCount} />
            <AcademicInsightsCard
              label="Avg attendance"
              value={`${activeSemester.avgAttendancePct}%`}
              progress={activeSemester.avgAttendancePct}
              tone={progressTone(activeSemester.avgAttendancePct)}
            />
            <AcademicInsightsCard
              label="Completion"
              value={`${activeSemester.completionPct}%`}
              progress={activeSemester.completionPct}
              tone={progressTone(activeSemester.completionPct)}
            />
          </Stack>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>Subjects — Semester {activeSemester.semester}</Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
            {activeSemester.subjects.map((sub) => (
              <Card key={sub.curriculumId} variant="outlined">
                <CardActionArea onClick={() => handleDrillSubject(sub)} sx={{ p: 2 }}>
                  <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {sub.courseName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {sub.courseCode} · {sub.facultyName || 'Unassigned'}
                      {sub.batch && ` · ${sub.batch}`}
                    </Typography>
                    <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                      <MetricRow label="Classes" value={`${sub.sessionsCompleted}/${sub.sessionsTotal}`} />
                      <MetricRow label="Attendance" value={`${sub.attendancePct}%`} tone={progressTone(sub.attendancePct)} />
                      <MetricRow label="Completion" value={`${sub.completionPct}%`} tone={progressTone(sub.completionPct)} />
                      <MetricRow label="Avg score" value={sub.avgScore !== null ? `${sub.avgScore}%` : '—'} tone={progressTone(sub.avgScore)} />
                    </Stack>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                      <Button size="small" endIcon={<ChevronRightIcon />} sx={{ textTransform: 'none' }} tabIndex={-1}>Open</Button>
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </>
      )}

      {/* Subject view */}
      {data && view === 'subject' && (subjectLoading || activeSubject) && (
        <>
          {subjectLoading && <LinearProgress sx={{ mb: 2 }} />}
          {activeSubject && data.subject && (
            <>
              <Box sx={{ mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  {activeSubject.courseName}{' '}
                  <Typography component="span" variant="body1" color="text.secondary">({activeSubject.courseCode})</Typography>
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {activeSubject.facultyName || 'Unassigned faculty'} · Semester {activeSubject.semester}
                  {activeSubject.batch && ` · ${activeSubject.batch}`}
                  {activeSubject.branch && ` · ${activeSubject.branch.toUpperCase()}`}
                </Typography>
              </Box>

              <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mb: 3 }}>
                <AcademicInsightsCard
                  label="Classes delivered"
                  value={`${activeSubject.sessionsCompleted} / ${activeSubject.sessionsTotal}`}
                  hint={`${activeSubject.hoursDelivered.toFixed(1)}h delivered`}
                  progress={activeSubject.sessionsTotal > 0 ? (activeSubject.sessionsCompleted / activeSubject.sessionsTotal) * 100 : 0}
                />
                <AcademicInsightsCard
                  label="Attendance"
                  value={`${activeSubject.attendancePct}%`}
                  hint={`${activeSubject.attendancePresent} of ${activeSubject.attendanceMarked} present`}
                  progress={activeSubject.attendancePct}
                  tone={progressTone(activeSubject.attendancePct)}
                />
                <AcademicInsightsCard
                  label="Completion"
                  value={`${activeSubject.completionPct}%`}
                  hint={`${activeSubject.submissionsSubmitted}/${activeSubject.submissionsExpected} submitted`}
                  progress={activeSubject.completionPct}
                  tone={progressTone(activeSubject.completionPct)}
                />
                <AcademicInsightsCard
                  label="Late submissions"
                  value={`${activeSubject.submissionsLate}`}
                  hint={`${activeSubject.submissionsMissing} missing`}
                />
                <AcademicInsightsCard
                  label="Avg score"
                  value={activeSubject.avgScore !== null ? `${activeSubject.avgScore}%` : '—'}
                  hint={`${activeSubject.scoredCount} graded`}
                  progress={activeSubject.avgScore ?? 0}
                  tone={progressTone(activeSubject.avgScore)}
                />
              </Stack>

              <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                <Tabs value={subjectTab} onChange={(_, v) => setSubjectTab(v)}>
                  <Tab label="Attendance" value="attendance" />
                  <Tab label="Completion" value="completion" />
                  <Tab label="Assignments" value="assignments" />
                  <Tab label="Scores" value="scores" />
                </Tabs>
              </Box>

              {subjectTab === 'attendance' && (
                <AttendanceTab trend={data.subject.attendanceTrend} />
              )}
              {subjectTab === 'completion' && (
                <StudentListTab students={data.subject.students} mode="completion" />
              )}
              {subjectTab === 'assignments' && (
                <AssignmentsTab assessments={data.subject.assessmentDetail} />
              )}
              {subjectTab === 'scores' && (
                <StudentListTab students={data.subject.students} mode="scores" />
              )}
            </>
          )}
        </>
      )}

      {data?.generatedAt && view === 'overview' && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
          Computed {new Date(data.generatedAt).toLocaleString()}
          {data.collegeId ? ` · college ${data.collegeId}` : ''}
        </Typography>
      )}
    </Box>
  )
}

function MetricRow({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  const color = tone === 'success' ? '#15803d' : tone === 'warning' ? '#b45309' : tone === 'danger' ? '#b91c1c' : 'inherit'
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, color }}>{value}</Typography>
    </Box>
  )
}

function AttendanceTab({ trend }: { trend: AttendanceTrendPoint[] }) {
  if (trend.length === 0) {
    return <Alert severity="info">No attendance data for this window yet.</Alert>
  }
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Daily attendance trend</Typography>
        <Stack spacing={1}>
          {trend.map((p) => (
            <Box key={p.date}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption">{p.date}</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600, color: p.pct >= 75 ? '#15803d' : p.pct >= 50 ? '#b45309' : '#b91c1c' }}>
                  {p.pct}% ({p.present}/{p.marked})
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={p.pct}
                color={p.pct >= 75 ? 'success' : p.pct >= 50 ? 'warning' : 'error'}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}

function AssignmentsTab({ assessments }: { assessments: AssessmentDetail[] }) {
  if (assessments.length === 0) {
    return <Alert severity="info">No assignments found for this subject.</Alert>
  }
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>Assessments</Typography>
        <Stack divider={<Divider flexItem />} spacing={1.5}>
          {assessments.map((a) => (
            <Box key={a.id}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{a.title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {a.status}{a.deadline ? ` · due ${a.deadline.slice(0, 10)}` : ''}
                  </Typography>
                </Box>
                <Chip size="small" label={a.avgScore !== null ? `Avg ${a.avgScore}%` : `${a.submitted}/${a.expected}`} />
              </Box>
              <LinearProgress
                variant="determinate"
                value={a.expected > 0 ? (a.submitted / a.expected) * 100 : 0}
                color={a.expected > 0 && (a.submitted / a.expected) >= 0.75 ? 'success' : 'warning'}
                sx={{ height: 6, borderRadius: 3, mt: 1 }}
              />
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}

function StudentListTab({ students, mode }: { students: StudentInsight[]; mode: 'completion' | 'scores' }) {
  if (students.length === 0) {
    return <Alert severity="info">No student data in this window.</Alert>
  }
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 0 }}>
        <Box sx={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.04)' }}>
                <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, fontSize: 13 }}>Student</th>
                <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, fontSize: 13 }}>Attendance</th>
                <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, fontSize: 13 }}>Completion</th>
                <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, fontSize: 13 }}>Avg score</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.studentId} style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                  <td style={{ padding: 12, fontSize: 14 }}>
                    {s.studentName}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{s.regNo}</Typography>
                  </td>
                  <td style={{ padding: 12, fontSize: 14, color: s.attendancePct === null ? '#94a3b8' : s.attendancePct >= 75 ? '#15803d' : s.attendancePct >= 50 ? '#b45309' : '#b91c1c' }}>
                    {s.attendancePct !== null ? `${s.attendancePct}%` : '—'}
                    {s.attendanceMarked > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{s.attendanceMarked} marked</Typography>}
                  </td>
                  <td style={{ padding: 12, fontSize: 14 }}>
                    {s.completionPct !== null ? `${s.completionPct}%` : '—'}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{s.assignmentsSubmitted}/{s.assignmentsExpected}</Typography>
                  </td>
                  <td style={{ padding: 12, fontSize: 14, color: s.avgScore === null ? '#94a3b8' : s.avgScore >= 60 ? '#15803d' : s.avgScore >= 40 ? '#b45309' : '#b91c1c', fontWeight: 600 }}>
                    {s.avgScore !== null ? `${s.avgScore}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      </CardContent>
    </Card>
  )
}
