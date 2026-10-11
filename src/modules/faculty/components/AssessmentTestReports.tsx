import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import * as XLSX from '@e965/xlsx';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,  Tooltip,
} from '@mui/material';
import {
  Add,
  ArrowBack,
  BarChart,
  CheckCircle,
  Delete,
  FileDownload,
  GppMaybeOutlined,
  HourglassTop,
  Public,
  Tune,
  VisibilityOutlined,
  Warning,
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/Firebase/config';
import { useAuth } from '../../auth/context/AuthContext';
import { useScheduledTests } from '../../../hooks/useAssessment';
import type {
  AssessmentTestReport,
  PerformanceCategory,
  ScheduledTest,
} from '../../../types/assessment';

/*
 * Shared test completion + report view.
 *
 * Used by:
 *  - /faculty/assessments → "My tests" tab (faculty, hod, mentor)
 *  - /admin/test-reports  (admin, principal, hod, superadmin)
 *
 * The server (listManagedAssessmentTests / getAssessmentTestReport) serves the
 * college-wide list and reports to every assessment manager, so every faculty
 * member, principal, and admin sees the same completed-test + report data.
 *
 * Report extras:
 *  - Status categories ("Good to Go ≥ 70%" etc.) are college-configured
 *    (getAssessmentConfig / saveAssessmentConfig), never hardcoded.
 *  - One-click Excel export of the conducted test: student, roll no, course,
 *    class section, exam section, score earned, total score, percentage,
 *    category and attempt status (multi-section tests export one row per
 *    student per exam section, like the legacy CSV report).
 */

/* ─── helpers ── */

const toMs = (value: string | Date | { toDate?: () => Date } | undefined | null): number => {
  if (!value) return NaN;
  const d = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : (value as { toDate?: () => Date }).toDate ? (value as { toDate: () => Date }).toDate() : new Date(String(value));
  return d.getTime();
};

const fmtDateTime = (value: Date | string | null | undefined): string => {
  if (!value) return '—';
  const ms = toMs(value);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const fmtDuration = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
};

type TestPhase = 'cancelled' | 'upcoming' | 'live' | 'completed';

const derivePhase = (test: ScheduledTest, now: number): TestPhase => {
  if (test.status === 'cancelled') return 'cancelled';
  const start = toMs(test.startDateTime);
  const end = toMs(test.endDateTime);
  if (!Number.isNaN(start) && now < start) return 'upcoming';
  if (!Number.isNaN(end) && now > end) return 'completed';
  return 'live';
};

const PHASE_CHIP: Record<TestPhase, { label: string; color: 'default' | 'info' | 'warning' | 'success' | 'error' }> = {
  upcoming: { label: 'Upcoming', color: 'info' },
  live: { label: 'In progress', color: 'warning' },
  completed: { label: 'Completed', color: 'success' },
  cancelled: { label: 'Cancelled', color: 'error' },
};

const CATEGORY_TONES: Array<'success' | 'warning' | 'error' | 'info' | 'default'> = [
  'success', 'warning', 'error', 'info', 'default', 'default',
];

const sortCategories = (categories: PerformanceCategory[]): PerformanceCategory[] =>
  [...categories].sort((a, b) => b.minPercent - a.minPercent);

/* ─── status-category settings dialog ── */

function CategorySettingsDialog({
  open,
  onClose,
  categories,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  categories: PerformanceCategory[];
  onSaved: (categories: PerformanceCategory[]) => void;
}) {
  const [rows, setRows] = useState<Array<{ label: string; minPercent: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRows(sortCategories(categories).map((category) => ({ label: category.label, minPercent: String(category.minPercent) })));
      setError(null);
    }
  }, [open, categories]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const fn = httpsCallable<
        { performanceCategories: Array<{ label: string; minPercent: number }> },
        { success: boolean; performanceCategories: PerformanceCategory[] }
      >(functions, 'saveAssessmentConfig');
      const res = await fn({
        performanceCategories: rows.map((row) => ({ label: row.label.trim(), minPercent: Number(row.minPercent) })),
      });
      onSaved(res.data.performanceCategories);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Status categories</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Applied to every test report and Excel export in this college. A student&rsquo;s
          percentage is matched against the first category whose minimum it meets —
          list the highest range first.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {rows.map((row, index) => (
            <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                size="small"
                label="Label"
                value={row.label}
                onChange={(event) => setRows((current) => current.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)))}
                sx={{ flex: 1 }}
              />
              <TextField
                size="small"
                label="Min %"
                type="number"
                value={row.minPercent}
                onChange={(event) => setRows((current) => current.map((item, i) => (i === index ? { ...item, minPercent: event.target.value } : item)))}
                slotProps={{ htmlInput: { min: 0, max: 100, step: 1 } }}
                sx={{ width: 110 }}
              />
              <IconButton
                aria-label="Remove category"
                size="small"
                color="error"
                disabled={rows.length <= 1}
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              >
                <Delete fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>
        <Button
          size="small"
          startIcon={<Add />}
          sx={{ mt: 1.5 }}
          disabled={rows.length >= 6}
          onClick={() => setRows((current) => [...current, { label: '', minPercent: '' }])}
        >
          Add category
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save categories'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ─── single-test report ─── */

function TestReport({ testId, onBack }: { testId: string; onBack: () => void }) {
  const { user } = useAuth();
  const collegeId = user?.collegeId || '';
  const [report, setReport] = useState<AssessmentTestReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<PerformanceCategory[]>([]);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const fn = httpsCallable<{ testId: string }, AssessmentTestReport>(functions, 'getAssessmentTestReport');
      const res = await fn({ testId });
      setReport(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The test report could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [testId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // College-configured status categories (defaults applied server-side when
  // the college has not customised them).
  useEffect(() => {
    let active = true;
    const fn = httpsCallable<
      { collegeId?: string },
      { performanceCategories: PerformanceCategory[] }
    >(functions, 'getAssessmentConfig');
    fn({ collegeId }).then((res) => { if (active) setCategories(res.data.performanceCategories); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  // While the test window is open, keep the report live.
  useEffect(() => {
    if (!report) return;
    const now = Date.now();
    const start = toMs(report.test.startDateTime);
    const end = toMs(report.test.endDateTime);
    const live = !Number.isNaN(start) && !Number.isNaN(end) && now >= start && now <= end;
    if (!live) return;
    const id = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(id);
  }, [report, load]);

  if (loading && !report) {
    return (
      <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error && !report) {
    return (
      <>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button variant="outlined" onClick={onBack}>Back to my tests</Button>
      </>
    );
  }
  if (!report) return null;

  const { test, summary, students } = report;
  const sortedCategories = sortCategories(categories);
  const categoryFor = (percentage: number | null | undefined): { label: string; tone: (typeof CATEGORY_TONES)[number] } | null => {
    if (percentage === null || percentage === undefined || !Number.isFinite(percentage)) return null;
    const index = sortedCategories.findIndex((category) => percentage >= category.minPercent);
    if (index === -1) return null;
    return { label: sortedCategories[index].label, tone: CATEGORY_TONES[index] || 'default' };
  };
  const canEditCategories = ['superadmin', 'admin', 'principal', 'hod'].includes(user?.role || '');

  const attemptLabel = (status: string, needsManualGrading: boolean): string => {
    if (status === 'graded') return 'Graded';
    if (status === 'in_progress') return 'In progress';
    if (status === 'submitted') return needsManualGrading ? 'Awaiting grading' : 'Submitted';
    return 'Not started';
  };

  const exportExcel = () => {
    setExporting(true);
    try {
      const rows: Array<Record<string, string | number>> = [];
      let serial = 0;
      for (const s of students) {
        const category = categoryFor(s.percentage)?.label || '';
        const base: Record<string, string | number> = {
          'Student Name': s.studentName,
          'Roll No': s.regNo || '',
          'Course': s.branch || '',
          'Class Section': s.section || '',
          'Semester': s.semester || '',
          'Total Score': s.totalMarks,
          'Percentage': s.percentage === null ? '' : `${s.percentage}%`,
          'Status': category,
          'Attempt': attemptLabel(s.status, s.needsManualGrading),
        };
        const sections = s.sectionScores && s.sectionScores.length > 0 ? s.sectionScores : null;
        if (sections) {
          // Multi-section test: one row per student per exam section,
          // mirroring the legacy per-section CSV report.
          for (const section of sections) {
            serial += 1;
            rows.push({
              'S.No': serial,
              ...base,
              'Exam Section': section.sectionName,
              'Score Earned': `${section.score} / ${section.max}`,
            });
          }
        } else {
          serial += 1;
          const score = s.marksObtained !== null
            ? s.marksObtained
            : s.status === 'submitted' && s.autoScore !== null
              ? `${s.autoScore} auto (manual pending)`
              : '';
          rows.push({
            'S.No': serial,
            ...base,
            'Exam Section': test.sections && test.sections.length === 1 ? test.sections[0].name : '—',
            'Score Earned': score,
          });
        }
      }
      const header = ['S.No', 'Student Name', 'Roll No', 'Course', 'Class Section', 'Semester', 'Exam Section', 'Score Earned', 'Total Score', 'Percentage', 'Status', 'Attempt'];
      const ws = XLSX.utils.json_to_sheet(rows, { header });
      ws['!cols'] = [{ wch: 6 }, { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 13 }, { wch: 10 }, { wch: 18 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 18 }];

      const summaryRows: Array<Array<string | number>> = [
        ['Test', test.title],
        ['Subject', test.subject],
        ['Faculty', test.facultyName || ''],
        ['Branch', test.branch || ''],
        ['Batch', test.batch || ''],
        ['Window', `${fmtDateTime(test.startDateTime)} – ${fmtDateTime(test.endDateTime)}`],
        ['Total marks', test.totalMarks],
        ['Questions', test.totalQuestions],
        [],
        ['Started', test.totalStarted || ''],
        ['Submitted', summary.submitted],
        ['Graded', summary.graded],
        ['Awaiting grading', summary.pendingManual],
        ['Average %', summary.avgPercentage === null ? '' : `${summary.avgPercentage}%`],
        ['Highest %', summary.maxPercentage === null ? '' : `${summary.maxPercentage}%`],
        ['Lowest %', summary.minPercentage === null ? '' : `${summary.minPercentage}%`],
        [],
        ['Status categories', '(percentage must be at least)'],
        ...sortedCategories.map((category) => [category.label, `>= ${category.minPercent}%`]),
      ];
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
      wsSummary['!cols'] = [{ wch: 22 }, { wch: 56 }];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, ws, 'Results');
      XLSX.utils.book_append_sheet(workbook, wsSummary, 'Summary');
      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(workbook, `${(test.title || 'test-report').replace(/[^\w\- ]+/g, '').trim()}_${date}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const stat = (label: string, value: ReactNode, hint?: string) => (
    <Box key={label} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2, minWidth: 120, flex: '1 1 120px' }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>{value}</Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </Box>
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Button startIcon={<ArrowBack />} variant="outlined" onClick={onBack}>Back</Button>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{test.title || 'Test report'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {test.subject}
            {[test.branch, test.batch].filter(Boolean).length > 0
              ? ` · ${[test.branch, test.batch].filter(Boolean).join(' · ')}`
              : ''}
            {test.facultyName ? ` · by ${test.facultyName}` : ''} · {test.totalQuestions} questions · {test.totalMarks} marks · {fmtDateTime(test.startDateTime)} – {fmtDateTime(test.endDateTime)}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {test.enableProctoring && <Chip size="small" label="Proctored" color="warning" />}
          {test.maxTabSwitches > 0 && <Chip size="small" label={`Max ${test.maxTabSwitches} tab switches`} color="warning" />}
          {(test.shuffleQuestions || test.shuffleSections || test.shuffleOptions) && <Chip size="small" label="Shuffled" />}
        </Box>
      </Box>

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 3 }}>
        {stat('Submitted', `${summary.submitted} / ${test.totalStarted || summary.submitted || '—'}`, 'of students who started')}
        {stat('Graded', summary.graded)}
        {stat('Awaiting grading', summary.pendingManual, 'manual marks due')}
        {stat('In progress', summary.inProgress)}
        {stat('Average', summary.avgPercentage === null ? '—' : `${summary.avgPercentage}%`)}
        {stat('Highest', summary.maxPercentage === null ? '—' : `${summary.maxPercentage}%`)}
        {stat('Lowest', summary.minPercentage === null ? '—' : `${summary.minPercentage}%`)}
        {stat('Late', summary.lateSubmissions, 'with penalty')}
        {stat('Auto-submitted', summary.autoSubmittedCount, 'time/tab limit')}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<FileDownload />}
          disabled={students.length === 0 || exporting}
          onClick={exportExcel}
        >
          {exporting ? 'Preparing…' : 'Download Excel report'}
        </Button>
        {canEditCategories && (
          <Button variant="outlined" size="small" startIcon={<Tune />} onClick={() => setCategoryDialogOpen(true)}>
            Status categories
          </Button>
        )}
      </Box>

      {summary.pendingManual > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {summary.pendingManual} submission{summary.pendingManual > 1 ? 's' : ''} awaiting manual grading — the scheduling faculty (or an admin) can complete it in the manual grading flow.
        </Alert>
      )}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Student results ({students.length})</Typography>
          {students.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              No student attempts recorded for this test yet.
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Student</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Score</TableCell>
                    <TableCell align="right">%</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Grade</TableCell>
                    <TableCell align="right">Time</TableCell>
                    <TableCell>Submitted</TableCell>
                    <TableCell>Flags</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {students.map((s) => {
                    const category = categoryFor(s.percentage);
                    return (
                      <TableRow key={s.studentId} hover>
                        <TableCell>
                          <Typography sx={{ fontWeight: 600 }}>{s.studentName}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {s.regNo}{s.branch ? ` · ${s.branch}` : ''}{s.section ? ` · Sec ${s.section}` : ''}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {s.status === 'graded' && <Chip size="small" color="success" label="Graded" />}
                          {s.status === 'submitted' && (s.needsManualGrading
                            ? <Chip size="small" color="info" label="Awaiting grading" />
                            : <Chip size="small" color="info" label="Submitted" />)}
                          {s.status === 'in_progress' && <Chip size="small" color="warning" label="In progress" />}
                          {s.status === 'not_started' && <Chip size="small" label="Not started" />}
                        </TableCell>
                        <TableCell align="right">
                          {s.status === 'graded' && s.marksObtained !== null
                            ? `${s.marksObtained} / ${s.totalMarks}`
                            : s.status === 'submitted' && s.autoScore !== null
                              ? `${s.autoScore} auto + manual`
                              : '—'}
                        </TableCell>
                        <TableCell align="right">{s.percentage === null ? '—' : `${s.percentage}%`}</TableCell>
                        <TableCell>
                          {category ? <Chip size="small" color={category.tone} label={category.label} /> : '—'}
                        </TableCell>
                        <TableCell>{s.grade || '—'}</TableCell>
                        <TableCell align="right">{s.status === 'in_progress' ? '—' : fmtDuration(s.timeSpent)}</TableCell>
                        <TableCell>
                          {s.submittedAt ? fmtDateTime(s.submittedAt) : '—'}
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {s.isLateSubmission && <Chip size="small" color="warning" label={`Late −${s.latePenaltyPercentage}%`} />}
                            {s.autoSubmitted && <Chip size="small" color="error" icon={<HourglassTop />} label="Auto" />}
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* The columns above state the evidence; this says what the evidence is.
          A faculty member reading "Review · 3 blocked" for the first time needs
          to know what was blocked and that the code/answers are the thing to
          look at — not that a system has decided somebody cheated. */}
      {students.some((student) => student.integrity?.reviewSuggested) && (
        <Alert severity="warning" icon={<GppMaybeOutlined />} sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {students.filter((student) => student.integrity?.reviewSuggested).length} attempt(s) need a look
          </Typography>
          <Typography variant="body2">
            These students tried to paste or drop text into an answer while the test was running, and the
            attempt was blocked and recorded. The lockdown blocks the action for every test, proctored or not.
            It does not tell you what they were trying to insert — open the attempt and read the answer next to
            the marks, then decide. A switched-away window or a fullscreen exit on its own is not evidence of
            anything: read those counts as intensity, not intent.
          </Typography>
        </Alert>
      )}

      {/* The columns above state the evidence; this says what the evidence is.
          A faculty member reading "Review · 3 blocked" for the first time needs
          to know what was blocked and that the answers are what to look at —
          not that a system has decided somebody cheated. */}
      {students.some((student) => student.integrity?.reviewSuggested) && (
        <Alert severity="warning" icon={<GppMaybeOutlined />} sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {students.filter((student) => student.integrity?.reviewSuggested).length} attempt(s) need a look
          </Typography>
          <Typography variant="body2">
            These students tried to paste or drop text into an answer while the test was running; the attempt was
            blocked and recorded. The lockdown applies to every test, proctored or not. It does not tell you what
            they were trying to insert — open the attempt, read the answer next to the marks, then decide. A
            switched-away window or a fullscreen exit on its own is not evidence of anything: read those counts as
            intensity, not intent.
          </Typography>
        </Alert>
      )}

      <CategorySettingsDialog
        open={categoryDialogOpen}
        onClose={() => setCategoryDialogOpen(false)}
        categories={categories}
        onSaved={setCategories}
      />
    </Box>
  );
}

/* ─── list + report entry ─── */

export default function AssessmentTestReports({ showScheduleHint = false }: { showScheduleHint?: boolean }) {
  const { user } = useAuth();
  const collegeId = user?.collegeId || '';
  const { tests, loading, error, refresh, publish, cancel } = useScheduledTests(collegeId);
  const [reportTestId, setReportTestId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);

  // Keep phase chips (upcoming → in progress → completed) current.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (reportTestId) {
    return <TestReport testId={reportTestId} onBack={() => setReportTestId(null)} />;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          My tests ({tests.length})
        </Typography>
        <Button variant="outlined" size="small" onClick={() => { void refresh(); }}>Refresh</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && (
        <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress />
        </Box>
      )}
      {!loading && tests.length === 0 && (
        <Alert severity="info">
          No tests scheduled yet{showScheduleHint ? ' — use the “Schedule a test” tab' : ''}.
        </Alert>
      )}
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        {tests.map((test) => {
          const phase = derivePhase(test, now);
          const chip = PHASE_CHIP[phase];
          const submitted = Number(test.totalSubmitted) || 0;
          const graded = Number(test.totalGraded) || 0;
          const started = Number(test.totalStarted) || 0;
          // Server policy: faculty may publish/cancel only their own tests;
          // hod/principal/admin/superadmin may manage any test in the college.
          const canManage = !user?.role
            || user.role === 'faculty'
              ? test.facultyId === user?.uid
              : true;
          return (
            <Card key={test.id} variant="outlined">
              <CardContent sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, p: 2.5 }}>
                <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>{test.title || 'Test'}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {test.subject} · {test.totalQuestions} questions · {test.totalMarks} marks
                  </Typography>
                  {test.facultyName && (
                    <Typography variant="body2" color="text.secondary">
                      Scheduled by {test.facultyName}
                      {user?.name && test.facultyName === user.name ? ' (you)' : ''}
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary">
                    {fmtDateTime(test.startDateTime)} – {fmtDateTime(test.endDateTime)}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                    {test.branch && <Chip size="small" label={test.branch} />}
                    {test.batch && <Chip size="small" label={`Batch ${test.batch}`} />}
                    {test.enableProctoring && <Chip size="small" label="Proctored" color="warning" />}
                    {Number(test.maxTabSwitches) > 0 && <Chip size="small" label={`Max ${test.maxTabSwitches} tab switches`} />}
                    {(test.shuffleQuestions || test.shuffleSections || test.shuffleOptions) && <Chip size="small" label="Shuffled" />}
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: 'flex-end' }}>
                  <Chip label={chip.label} color={chip.color} size="small" icon={phase === 'live' ? <Warning /> : phase === 'completed' ? <CheckCircle /> : <HourglassTop />} />
                  <Typography variant="body2" color="text.secondary">
                    {started} started · {submitted} submitted{graded > 0 ? ` · ${graded} graded` : ''}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button variant="contained" size="small" startIcon={<BarChart />} onClick={() => setReportTestId(test.id)}>
                    Report
                  </Button>
                  {test.status === 'scheduled' && canManage && (
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<Public />}
                      disabled={busyId === test.id}
                      onClick={async () => {
                        setBusyId(test.id);
                        try {
                          await publish(test.id);
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      Publish
                    </Button>
                  )}
                  {(test.status === 'scheduled' || test.status === 'published') && canManage && (
                    <Button
                      variant="outlined"
                      size="small"
                      color="error"
                      disabled={busyId === test.id}
                      onClick={async () => {
                        if (!window.confirm('Cancel this test? Students will no longer be able to take it.')) return;
                        setBusyId(test.id);
                        try {
                          await cancel(test.id, 'Cancelled by faculty');
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}
