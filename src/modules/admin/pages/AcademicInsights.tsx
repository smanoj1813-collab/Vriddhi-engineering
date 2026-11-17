// src/modules/admin/pages/AcademicInsights.tsx
//
// Curriculum Insights — one drill for every academic role:
//   Branch → Batch → Semester → Subject → Subject detail.
//
// Branch, batch and semester are dropdowns. Each dropdown is the same selection
// as its drill level, so the page always shows which curriculum is open.
//
// Cost rules (docs/firestore-cost-controls.md):
//  - The overview is fetched ONCE per date window (mount, Refresh, Apply dates).
//    Grouping and filtering by branch, batch and semester happen in memory.
//  - One extra call happens when a single subject is opened: its students,
//    assessments and attendance trend. Moving between levels never refetches.
//  - No polling, focus or reconnect refetches (C7).
//
// Scope rules are enforced server-side: faculty see their own subjects, HOD the
// department, principal/admin the college.

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Link,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import {
  ChevronRight as ChevronRightIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material'

import { useAuth } from '../../auth/context/AuthContext'
import {
  getAcademicInsights,
  type AcademicInsightsResult,
  type SubjectInsight,
  type StudentInsight,
  type AssessmentDetail,
  type AttendanceTrendPoint,
} from '../api/academicInsightsApi'
import AcademicInsightsCard, { progressTone } from '../components/AcademicInsightsCard'
import {
  NO_BATCH_LABEL,
  NO_BRANCH_KEY,
  batchOf,
  branchKeyOf,
  displayLabel,
  groupBy,
  rollup,
  sortByLabel,
  academicYearToDate,
  subjectKeyOf,
  type Group,
} from '../utils/curriculumDrill'

type SubjectTab = 'attendance' | 'completion' | 'assignments' | 'scores'
type SubjectDetail = NonNullable<AcademicInsightsResult['subject']>
type DateWindow = { from: string; to: string }
type ViewLevel = 'branches' | 'batches' | 'semesters' | 'subjects' | 'detail'

/** The drill selection. Each level is set only when every level above it is set. */
interface Drill {
  branch: string | null      // branchKey, or NO_BRANCH_KEY
  batch: string | null       // batch label, or NO_BATCH_LABEL
  semester: number | null
  subjectKey: string | null  // `${semester}__${curriculumId}`
}
const EMPTY_DRILL: Drill = { branch: null, batch: null, semester: null, subjectKey: null }

export default function AcademicInsights() {
  const { user } = useAuth()
  const role = String(user?.role || '')
  const collegeId = String((user as { collegeId?: string } | null)?.collegeId || '')
  const isSuperadmin = role === 'superadmin'
  const scopeCollegeId = isSuperadmin ? (collegeId || undefined) : undefined

  // Date window. The draft is what the inputs show; the applied window is what
  // the server was last asked for.
  const [draftDates, setDraftDates] = useState<DateWindow>(() => academicYearToDate())
  const [appliedDates, setAppliedDates] = useState<DateWindow>(() => academicYearToDate())

  const [overview, setOverview] = useState<AcademicInsightsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [drill, setDrill] = useState<Drill>(EMPTY_DRILL)
  const [subjectTab, setSubjectTab] = useState<SubjectTab>('attendance')

  const [detail, setDetail] = useState<SubjectDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // One overview fetch per date window. Mount, Refresh and Apply dates only.
  const loadOverview = useCallback(async (dates: DateWindow) => {
    setError(null)
    setLoading(true)
    try {
      const result = await getAcademicInsights({ collegeId: scopeCollegeId, from: dates.from, to: dates.to })
      setOverview(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Academic insights could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [scopeCollegeId])

  useEffect(() => {
    void loadOverview(appliedDates)
    // Runs once on mount; later loads are explicit (Refresh / Apply dates).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const subjects = useMemo<SubjectInsight[]>(
    () => (overview?.semesters ?? []).flatMap((sem) => sem.subjects),
    [overview],
  )

  // ── Grouping, in memory ──────────────────────────────────────────────────
  const branchGroups = useMemo(
    () => sortByLabel(groupBy(subjects, branchKeyOf, (list) => displayLabel(list.map((s) => s.branch), 'No branch'))),
    [subjects],
  )

  const inBranch = useMemo(() => {
    if (drill.branch === null) return subjects
    return branchGroups.find((g) => g.key === drill.branch)?.subjects ?? []
  }, [subjects, branchGroups, drill.branch])

  const batchGroups = useMemo(
    () => sortByLabel(groupBy(inBranch, batchOf, (list) => displayLabel(list.map(batchOf), NO_BATCH_LABEL))),
    [inBranch],
  )

  const inBatch = useMemo(() => {
    if (drill.batch === null) return inBranch
    return inBranch.filter((s) => batchOf(s) === drill.batch)
  }, [inBranch, drill.batch])

  const semesterGroups = useMemo(() => {
    const groups = groupBy(inBatch, (s) => String(s.semester), () => '')
    return groups
      .map((g) => ({ ...g, label: `Semester ${g.key}`, semester: Number(g.key) }))
      .sort((a, b) => a.semester - b.semester)
  }, [inBatch])

  const inSemester = useMemo(() => {
    if (drill.semester === null) return inBatch
    return inBatch.filter((s) => s.semester === drill.semester)
  }, [inBatch, drill.semester])

  const activeSubject = useMemo<SubjectInsight | null>(() => {
    if (drill.subjectKey === null) return null
    return subjects.find((s) => subjectKeyOf(s) === drill.subjectKey) ?? null
  }, [subjects, drill.subjectKey])

  const view: ViewLevel =
    drill.subjectKey !== null ? 'detail'
      : drill.semester !== null ? 'subjects'
        : drill.batch !== null ? 'semesters'
          : drill.branch !== null ? 'batches'
            : 'branches'

  // If a refresh removes the selected branch, batch or subject, fall back to the level above.
  useEffect(() => {
    if (!overview) return
    if (drill.branch !== null && !branchGroups.some((g) => g.key === drill.branch)) {
      setDrill(EMPTY_DRILL)
    } else if (drill.subjectKey !== null && !activeSubject) {
      setDrill((d) => ({ ...d, subjectKey: null }))
    }
  }, [overview, branchGroups, drill.branch, drill.subjectKey, activeSubject])

  // ── Subject detail: one call when a single subject is opened ─────────────
  useEffect(() => {
    if (!activeSubject) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetail(null)
    setDetailLoading(true)
    setError(null)
    void (async () => {
      try {
        const result = await getAcademicInsights({
          collegeId: scopeCollegeId,
          from: appliedDates.from,
          to: appliedDates.to,
          semester: activeSubject.semester,
          curriculumId: activeSubject.curriculumId,
        })
        if (!cancelled) setDetail(result.subject ?? null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Subject detail could not be loaded.')
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => { cancelled = true }
    // Keyed on the subject identity only; the window and college are fixed per drill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubject?.curriculumId, activeSubject?.semester])

  // ── Drill transitions. Choosing a level clears everything below it. ──────
  const pickBranch = (key: string) => setDrill({ ...EMPTY_DRILL, branch: key })
  const pickBatch = (batch: string) => setDrill({ ...EMPTY_DRILL, branch: drill.branch, batch })
  const pickSemester = (semester: number) => setDrill({ ...EMPTY_DRILL, branch: drill.branch, batch: drill.batch, semester })
  const pickSubject = (s: SubjectInsight) => {
    setSubjectTab('attendance')
    setDrill({ branch: drill.branch, batch: drill.batch, semester: s.semester, subjectKey: subjectKeyOf(s) })
  }
  const goTo = (level: 'root' | 'branch' | 'batch' | 'semester') => {
    if (level === 'root') setDrill(EMPTY_DRILL)
    else if (level === 'branch') setDrill({ ...EMPTY_DRILL, branch: drill.branch })
    else if (level === 'batch') setDrill({ ...EMPTY_DRILL, branch: drill.branch, batch: drill.batch })
    else setDrill({ ...EMPTY_DRILL, branch: drill.branch, batch: drill.batch, semester: drill.semester })
  }

  const branchLabel = branchGroups.find((g) => g.key === drill.branch)?.label ?? ''
  const subjectLabel = activeSubject ? `${activeSubject.courseName} (${activeSubject.courseCode})` : ''

  const scopedRollup = useMemo(() => rollup(inSemester), [inSemester])
  const scopedTotals = useMemo(() => {
    const semesterCount = new Set(inSemester.map((s) => s.semester)).size
    return { semesters: semesterCount }
  }, [inSemester])

  // ── Filter bar ───────────────────────────────────────────────────────────
  const batchOptions = batchGroups
  const semesterOptions = semesterGroups

  const dateCard = (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ flexWrap: 'wrap', alignItems: { md: 'center' } }}>
          <TextField
            label="From"
            type="date"
            value={draftDates.from}
            onChange={(e) => setDraftDates((p) => ({ ...p, from: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
            size="small"
          />
          <TextField
            label="To"
            type="date"
            value={draftDates.to}
            onChange={(e) => setDraftDates((p) => ({ ...p, to: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
            size="small"
          />
          <Button
            variant="outlined"
            onClick={() => { setAppliedDates(draftDates); setDrill(EMPTY_DRILL); void loadOverview(draftDates) }}
            disabled={loading}
          >
            Apply dates
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )

  const curriculumFilterCard = (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
          Choose the curriculum
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ flexWrap: 'wrap' }}>
          <TextField
            select
            label="Branch"
            value={drill.branch ?? ''}
            onChange={(e) => (e.target.value === '' ? setDrill(EMPTY_DRILL) : pickBranch(e.target.value))}
            size="small"
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">All branches</MenuItem>
            {branchGroups.map((g) => (
              <MenuItem key={g.key} value={g.key}>{g.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Batch"
            value={drill.batch ?? ''}
            onChange={(e) => (e.target.value === '' ? setDrill({ ...EMPTY_DRILL, branch: drill.branch }) : pickBatch(e.target.value))}
            size="small"
            disabled={drill.branch === null}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All batches</MenuItem>
            {batchOptions.map((g) => (
              <MenuItem key={g.key} value={g.key}>{g.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Semester"
            value={drill.semester ?? ''}
            onChange={(e) => (e.target.value === '' ? goTo('batch') : pickSemester(Number(e.target.value)))}
            size="small"
            disabled={drill.batch === null}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All semesters</MenuItem>
            {semesterOptions.map((g) => (
              <MenuItem key={g.key} value={g.semester}>{g.label}</MenuItem>
            ))}
          </TextField>
        </Stack>
        {overview?.scopeLine && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            {overview.scopeLine}
          </Typography>
        )}
      </CardContent>
    </Card>
  )

  if (loading && !overview) {
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
            Branch → batch → semester → subject → students. Coverage, attendance, completion and scores,
            aggregated on the server.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void loadOverview(appliedDates)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </Box>

      {dateCard}
      {curriculumFilterCard}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {overview && overview.truncated.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Some figures may be incomplete: the data for this date range is larger than one load can cover
          ({overview.truncated.join(', ')}). Choose a shorter date range for complete numbers.
        </Alert>
      )}

      {/* Breadcrumbs: every crumb is a real level, so the path is always visible. */}
      {view !== 'branches' && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <Box sx={{ px: 2, py: 1.5 }}>
            <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />} aria-label="Drill path">
              <Link component="button" variant="body2" underline="hover" color="inherit" onClick={() => goTo('root')}>
                All branches
              </Link>
              {drill.branch !== null && (
                view === 'batches'
                  ? <Typography variant="body2" sx={{ fontWeight: 600 }}>{branchLabel}</Typography>
                  : <Link component="button" variant="body2" underline="hover" color="inherit" onClick={() => goTo('branch')}>{branchLabel}</Link>
              )}
              {drill.batch !== null && (
                view === 'semesters'
                  ? <Typography variant="body2" sx={{ fontWeight: 600 }}>{drill.batch}</Typography>
                  : <Link component="button" variant="body2" underline="hover" color="inherit" onClick={() => goTo('batch')}>{drill.batch}</Link>
              )}
              {drill.semester !== null && (
                view === 'subjects'
                  ? <Typography variant="body2" sx={{ fontWeight: 600 }}>Semester {drill.semester}</Typography>
                  : <Link component="button" variant="body2" underline="hover" color="inherit" onClick={() => goTo('semester')}>Semester {drill.semester}</Link>
              )}
              {view === 'detail' && <Typography variant="body2" sx={{ fontWeight: 600 }}>{subjectLabel}</Typography>}
            </Breadcrumbs>
          </Box>
        </Card>
      )}

      {/* Summary for the current scope, computed from the one overview fetch. */}
      {view !== 'detail' && overview && (
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mb: 3 }}>
          <AcademicInsightsCard label="Semesters" value={scopedTotals.semesters} hint={`${scopedRollup.subjects} subjects`} />
          <AcademicInsightsCard label="Faculty" value={scopedRollup.faculty} />
          <AcademicInsightsCard
            label="Classes delivered"
            value={`${scopedRollup.sessionsCompleted} / ${scopedRollup.sessionsTotal}`}
            progress={scopedRollup.sessionsTotal > 0 ? (scopedRollup.sessionsCompleted / scopedRollup.sessionsTotal) * 100 : 0}
            tone={progressTone(scopedRollup.sessionsTotal > 0 ? (scopedRollup.sessionsCompleted / scopedRollup.sessionsTotal) * 100 : 0)}
          />
          <AcademicInsightsCard
            label="Avg attendance"
            value={scopedRollup.attendancePct !== null ? `${scopedRollup.attendancePct}%` : '—'}
            progress={scopedRollup.attendancePct ?? 0}
            tone={progressTone(scopedRollup.attendancePct)}
          />
          <AcademicInsightsCard
            label="Assignments completion"
            value={scopedRollup.completionPct !== null ? `${scopedRollup.completionPct}%` : '—'}
            progress={scopedRollup.completionPct ?? 0}
            tone={progressTone(scopedRollup.completionPct)}
          />
          <AcademicInsightsCard
            label="Avg score"
            value={scopedRollup.avgScore !== null ? `${scopedRollup.avgScore}%` : '—'}
            progress={scopedRollup.avgScore ?? 0}
            tone={progressTone(scopedRollup.avgScore)}
          />
        </Stack>
      )}

      {/* Branch cards */}
      {overview && view === 'branches' && (
        <>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>Branches</Typography>
          {branchGroups.length === 0 ? (
            <Alert severity="info">No curriculum mapped yet. Map subjects to branches and batches to see insights.</Alert>
          ) : (
            <GroupGrid
              groups={branchGroups}
              onOpen={(g) => pickBranch(g.key)}
              subtitleOf={(g) => `${new Set(g.subjects.map(batchOf)).size} batches`}
            />
          )}
        </>
      )}

      {/* Batch cards within the branch */}
      {overview && view === 'batches' && (
        <>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>Batches — {branchLabel}</Typography>
          {batchGroups.length === 0 ? (
            <Alert severity="info">No batches in this branch yet.</Alert>
          ) : (
            <GroupGrid
              groups={batchGroups}
              onOpen={(g) => pickBatch(g.key)}
              subtitleOf={(g) => `${new Set(g.subjects.map((s) => s.semester)).size} semesters`}
            />
          )}
        </>
      )}

      {/* Semester cards within the batch */}
      {overview && view === 'semesters' && (
        <>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>Semesters — {branchLabel} · {drill.batch}</Typography>
          {semesterGroups.length === 0 ? (
            <Alert severity="info">No semesters in this batch yet.</Alert>
          ) : (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
              {semesterGroups.map((g) => {
                const r = rollup(g.subjects)
                return (
                  <Card key={g.key} variant="outlined">
                    <CardActionArea onClick={() => pickSemester(g.semester)} sx={{ p: 2 }}>
                      <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{g.label}</Typography>
                          <Chip size="small" color="primary" variant="outlined" label={`${r.subjects} subjects`} />
                        </Box>
                        <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                          <MetricRow label="Faculty" value={`${r.faculty}`} />
                          <MetricRow label="Classes" value={`${r.sessionsCompleted}/${r.sessionsTotal}`} />
                          <MetricRow label="Attendance" value={r.attendancePct !== null ? `${r.attendancePct}%` : '—'} tone={progressTone(r.attendancePct)} />
                          <MetricRow label="Completion" value={r.completionPct !== null ? `${r.completionPct}%` : '—'} tone={progressTone(r.completionPct)} />
                          <MetricRow label="Avg score" value={r.avgScore !== null ? `${r.avgScore}%` : '—'} tone={progressTone(r.avgScore)} />
                        </Stack>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                          <Button size="small" endIcon={<ChevronRightIcon />} sx={{ textTransform: 'none' }} tabIndex={-1}>Open</Button>
                        </Box>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                )
              })}
            </Box>
          )}
        </>
      )}

      {/* Subject cards: name, code, branch, batch, semester and faculty are all shown. */}
      {overview && view === 'subjects' && (
        <>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Subjects — {branchLabel} · {drill.batch} · Semester {drill.semester}
          </Typography>
          {inSemester.length === 0 ? (
            <Alert severity="info">No subjects in this semester.</Alert>
          ) : (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
              {inSemester.map((sub) => (
                <Card key={subjectKeyOf(sub)} variant="outlined">
                  <CardActionArea onClick={() => pickSubject(sub)} sx={{ p: 2 }}>
                    <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{sub.courseName}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {sub.courseCode} · {sub.facultyName || 'Unassigned faculty'}
                      </Typography>
                      <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap' }}>
                        <Chip size="small" label={branchLabelOf(sub, branchGroups)} />
                        <Chip size="small" variant="outlined" label={batchOf(sub)} />
                        <Chip size="small" variant="outlined" label={`Sem ${sub.semester}`} />
                      </Stack>
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
          )}
        </>
      )}

      {/* Subject detail */}
      {view === 'detail' && (
        <>
          {detailLoading && <LinearProgress sx={{ mb: 2 }} />}
          {activeSubject && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {activeSubject.courseName}{' '}
                <Typography component="span" variant="body1" color="text.secondary">({activeSubject.courseCode})</Typography>
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap' }}>
                <Chip size="small" label={branchLabelOf(activeSubject, branchGroups)} />
                <Chip size="small" variant="outlined" label={batchOf(activeSubject)} />
                <Chip size="small" variant="outlined" label={`Semester ${activeSubject.semester}`} />
                <Chip size="small" variant="outlined" label={activeSubject.facultyName || 'Unassigned faculty'} />
              </Stack>
            </Box>
          )}

          {detail && activeSubject && (
            <>
              <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mb: 3 }}>
                <AcademicInsightsCard
                  label="Classes delivered"
                  value={`${detail.sessionsCompleted} / ${detail.sessionsTotal}`}
                  hint={`${detail.hoursDelivered.toFixed(1)}h delivered`}
                  progress={detail.sessionsTotal > 0 ? (detail.sessionsCompleted / detail.sessionsTotal) * 100 : 0}
                />
                <AcademicInsightsCard
                  label="Attendance"
                  value={`${detail.attendancePct}%`}
                  hint={`${detail.attendancePresent} of ${detail.attendanceMarked} present`}
                  progress={detail.attendancePct}
                  tone={progressTone(detail.attendancePct)}
                />
                <AcademicInsightsCard
                  label="Completion"
                  value={`${detail.completionPct}%`}
                  hint={`${detail.submissionsSubmitted}/${detail.submissionsExpected} submitted`}
                  progress={detail.completionPct}
                  tone={progressTone(detail.completionPct)}
                />
                <AcademicInsightsCard
                  label="Late submissions"
                  value={`${detail.submissionsLate}`}
                  hint={`${detail.submissionsMissing} missing`}
                />
                <AcademicInsightsCard
                  label="Avg score"
                  value={detail.avgScore !== null ? `${detail.avgScore}%` : '—'}
                  hint={`${detail.scoredCount} graded`}
                  progress={detail.avgScore ?? 0}
                  tone={progressTone(detail.avgScore)}
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

              {subjectTab === 'attendance' && <AttendanceTab trend={detail.attendanceTrend} />}
              {subjectTab === 'completion' && <StudentListTab students={detail.students} mode="completion" />}
              {subjectTab === 'assignments' && <AssignmentsTab assessments={detail.assessmentDetail} />}
              {subjectTab === 'scores' && <StudentListTab students={detail.students} mode="scores" />}
            </>
          )}
        </>
      )}

      {overview?.generatedAt && view !== 'detail' && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
          Computed {new Date(overview.generatedAt).toLocaleString()}
          {overview.collegeId ? ` · college ${overview.collegeId}` : ''}
        </Typography>
      )}
    </Box>
  )
}

/** Branch label for one subject, using the same grouping as the branch cards. */
function branchLabelOf(sub: SubjectInsight, groups: Group[]): string {
  const key = branchKeyOf(sub)
  return groups.find((g) => g.key === key)?.label ?? (sub.branch || 'No branch')
}

function GroupGrid({
  groups,
  onOpen,
  subtitleOf,
}: {
  groups: Group[]
  onOpen: (g: Group) => void
  subtitleOf: (g: Group) => string
}) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
      {groups.map((g) => {
        const r = rollup(g.subjects)
        return (
          <Card key={g.key} variant="outlined">
            <CardActionArea onClick={() => onOpen(g)} sx={{ p: 2 }}>
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{g.label}</Typography>
                  <Chip size="small" color="primary" variant="outlined" label={`${r.subjects} subjects`} />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{subtitleOf(g)}</Typography>
                <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                  <MetricRow label="Faculty" value={`${r.faculty}`} />
                  <MetricRow label="Classes" value={`${r.sessionsCompleted}/${r.sessionsTotal}`} />
                  <MetricRow label="Attendance" value={r.attendancePct !== null ? `${r.attendancePct}%` : '—'} tone={progressTone(r.attendancePct)} />
                  <MetricRow label="Completion" value={r.completionPct !== null ? `${r.completionPct}%` : '—'} tone={progressTone(r.completionPct)} />
                  <MetricRow label="Avg score" value={r.avgScore !== null ? `${r.avgScore}%` : '—'} tone={progressTone(r.avgScore)} />
                </Stack>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                  <Button size="small" endIcon={<ChevronRightIcon />} sx={{ textTransform: 'none' }} tabIndex={-1}>Open</Button>
                </Box>
              </CardContent>
            </CardActionArea>
          </Card>
        )
      })}
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
