// src/modules/student/pages/TestResultPage.tsx
// Phase 2: reads the authoritative studentAssessments row via fetchTestResult.
// - submitted + manual grading pending → "awaiting grading" state (no answers shown)
// - graded → score card, section analysis, question-wise review, leaderboard
//
// Every count on this page comes from `utils/resultOutcome`, which derives the
// buckets from the marks each grader awarded (auto or manual). Reading the
// objective-only counters the server used to return made a paper with
// descriptive questions report "0/8 correct · 0/8 incorrect · 0/8 unattempted"
// next to a perfectly good 15/20 score.
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box, Typography, Button, Card, CardContent, Chip, LinearProgress,
  Tabs, Tab, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Paper, Avatar, Skeleton, Alert, Stack,
} from '@mui/material';
import {
  CheckCircle, Cancel, EmojiEvents, TrendingUp, BarChart,
  Visibility, ArrowBack, School, Timer, NavigateNext, NavigateBefore,
  HourglassEmpty, RemoveCircleOutlined,
} from '@mui/icons-material';
import { useAuth } from '../../auth/context/AuthContext';
import { useStudentProfile } from '../hooks/useStudentProfile';
import { useStudentData } from '../hooks/useStudentData';
import { fetchTestResult } from '../api/testApi';
import { MathRenderer } from '../components/MathRenderer';
import TextSizeControl from '../../../shared/components/TextSizeControl';
import type { TestResultDetail } from '../types/assessment';
import {
  outcomeColor,
  outcomeLabel,
  resolveQuestionOutcomeStatus,
  resolveResultPerformance,
  resolveSectionSummaries,
  type QuestionOutcomeStatus,
  type ResultQuestionLike,
} from '../utils/resultOutcome';

interface TabPanelProps { children?: React.ReactNode; index: number; value: number; }

/**
 * One gutter for every tab. The overview used to be padded while the section
 * analysis table ran edge-to-edge, which is what made the window look
 * misaligned when switching tabs.
 */
const TAB_CONTENT_SX = { px: { xs: 2, md: 3 }, py: { xs: 2, md: 3 } } as const;

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => (
  <Box role="tabpanel" hidden={value !== index} sx={{ ...TAB_CONTENT_SX, overflowX: 'hidden' }}>
    {value === index && children}
  </Box>
);

type ResultDetail = TestResultDetail & {
  pendingManualGrading?: boolean;
  autoScore?: number;
  autoMax?: number;
  manualPending?: boolean;
  partialCount?: number;
  pendingCount?: number;
  correctMarks?: number;
  awardedMarks?: number;
};

const TestResultPage: React.FC = () => {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useStudentProfile(user?.uid);
  const collegeId = profile?.collegeId || user?.collegeId || '';
  const studentId = profile?.id || '';

  const [result, setResult] = useState<ResultDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [selectedQuestion, setSelectedQuestion] = useState(0);

  useEffect(() => {
    if (!testId || !collegeId || !studentId) return;
    let cancelled = false;
    setLoading(true);
    fetchTestResult(collegeId, testId, studentId)
      .then((r) => {
        if (cancelled) return;
        setResult(r as ResultDetail);
        if (!r) setError('No submission found for this test.');
      })
      .catch((err) => !cancelled && setError(
        err instanceof Error ? err.message : 'Could not load this result.'
      ))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [testId, collegeId, studentId]);

  // Hooks must run before the early returns below, so the derived numbers are
  // computed from whatever result we have (null while loading is fine).
  const questions = useMemo(
    () => ((result?.questionResults || []) as unknown as ResultQuestionLike[]),
    [result]
  );
  const performance = useMemo(() => resolveResultPerformance(result || {}), [result]);
  const sections = useMemo(() => resolveSectionSummaries(result || {}), [result]);

  if (loading) return <ResultSkeleton />;
  if (error || !result) {
    return (
      <Box sx={{ p: 4, maxWidth: 600, mx: 'auto' }}>
        <Alert severity="info">
          {error || 'This result is not available yet. Results appear once your submission has been graded.'}
        </Alert>
        <Box sx={{ mt: 2 }}>
          <Button variant="outlined" onClick={() => navigate('/student/assessments')}>Back to Assessments</Button>
        </Box>
      </Box>
    );
  }

  const isGraded = !result.pendingManualGrading && !!result.gradedAt;
  const percentage = isGraded
    ? result.percentage || (result.totalMarks ? Math.round((result.marksObtained / result.totalMarks) * 100) : 0)
    : 0;
  const isPassed = percentage >= result.passingPercentage;
  const grade = isGraded ? result.grade || getGrade(percentage) : '—';

  /* ── Pending manual grading ── */
  if (!isGraded) {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 900, mx: 'auto', pb: 8 }}>
        <ResultToolbar onBack={() => navigate('/student/assessments')} />
        <Card sx={{ borderRadius: 4 }}>
          <CardContent sx={{ p: { xs: 3, md: 5 }, textAlign: 'center' }}>
            <HourglassEmpty color="warning" sx={{ fontSize: 64, mb: 2 }} />
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>Submitted — awaiting grading</Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              <MathRenderer text={result.title} inline /> · submitted{' '}
              {result.submittedAt ? new Date(result.submittedAt).toLocaleString('en-IN') : 'recently'}
            </Typography>
            <Alert severity="info" sx={{ textAlign: 'left', mb: 3 }}>
              Objective answers are scored instantly. This paper includes descriptive questions that
              your faculty must grade — your final score, grade and answer review will appear here
              once grading is complete.
            </Alert>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
              <ResultStat icon={<CheckCircle color="success" />} label="Answered" value={`${performance.answered}/${result.totalQuestions}`} />
              <ResultStat icon={<Timer color="info" />} label="Time Taken" value={formatDuration(result.timeSpent)} />
              <ResultStat icon={<School color="primary" />} label="Status" value="Under review" />
            </Box>
            <Button variant="outlined" sx={{ mt: 4 }} onClick={() => navigate('/student/assessments')}>
              Back to Assessments
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  const tabSx = { minHeight: 48 };

  /* ── Graded ── */
  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto', pb: 8 }}>
      <ResultToolbar onBack={() => navigate('/student/assessments')} />

      {/* Score Card */}
      <Card sx={{ borderRadius: 4, mb: 4, overflow: 'visible', position: 'relative' }}>
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
              <Box sx={{
                width: 160, height: 160, borderRadius: '50%', border: 8,
                borderColor: isPassed ? 'success.main' : 'error.main',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}>
                <Typography variant="h3" sx={{ fontWeight: 800 }} color={isPassed ? 'success.main' : 'error.main'}>
                  {percentage}%
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {result.marksObtained}/{result.totalMarks}
                </Typography>
              </Box>
              <Chip label={isPassed ? 'PASSED' : 'FAILED'} color={isPassed ? 'success' : 'error'}
                sx={{ position: 'absolute', bottom: -10, fontWeight: 700, fontSize: '0.75rem' }} />
            </Box>

            <Box sx={{ flex: 1, minWidth: 250 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
                <MathRenderer text={result.title} inline />
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }} gutterBottom>
                {result.subject} • Completed on{' '}
                {result.completedAt ? new Date(result.completedAt).toLocaleDateString('en-IN') : '—'}
                {result.gradedAt && ` · Graded ${new Date(result.gradedAt).toLocaleDateString('en-IN')}`}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 2 }}>
                {result.rank ? <ResultStat icon={<EmojiEvents color="warning" />} label="Rank" value={`#${result.rank}`} /> : null}
                <ResultStat icon={<School color="primary" />} label="Grade" value={grade} />
                <ResultStat icon={<Timer color="info" />} label="Time Taken" value={formatDuration(result.timeSpent)} />
                <ResultStat
                  icon={<CheckCircle color="success" />}
                  label="Correct answers"
                  value={`${performance.correct}/${performance.totalQuestions}`}
                />
              </Box>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {result.facultyFeedback && (
        <Alert severity="info" sx={{ mb: 4 }}>
          <strong>Faculty feedback:</strong> {result.facultyFeedback}
        </Alert>
      )}

      {/* One Vriddhi Phase C — a result is never a dead end. Every graded
          paper offers at least one honest next step back into Practice or
          Learning; links respect the college's module visibility. */}
      <ResultNextSteps subject={result.subject} />

      {/* Tabs */}
      <Card sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ borderBottom: 1, borderColor: 'divider', px: { xs: 1, md: 2 } }}
        >
          <Tab sx={tabSx} label="Overview" icon={<BarChart fontSize="small" />} iconPosition="start" />
          {sections.length > 0 && (
            <Tab sx={tabSx} label="Section Analysis" icon={<TrendingUp fontSize="small" />} iconPosition="start" />
          )}
          {questions.length > 0 && (
            <Tab sx={tabSx} label="Question-wise" icon={<Visibility fontSize="small" />} iconPosition="start" />
          )}
          {result.leaderboard?.length > 1 && (
            <Tab sx={tabSx} label="Leaderboard" icon={<EmojiEvents fontSize="small" />} iconPosition="start" />
          )}
        </Tabs>

        {/* Tab 0: Overview */}
        <TabPanel value={activeTab} index={0}>
          <Box sx={{ display: 'grid', gap: { xs: 3, md: 4 }, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Performance Summary</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                  {performance.answered}/{performance.totalQuestions} answered
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 2 }}>
                Full marks count as correct, part marks as partially correct.
              </Typography>
              <Stack spacing={2}>
                <PerformanceBar
                  label="Correct"
                  value={performance.correct}
                  total={performance.totalQuestions}
                  marks={performance.correctMarks}
                  color="success"
                />
                {performance.partial > 0 && (
                  <PerformanceBar
                    label="Partially correct"
                    value={performance.partial}
                    total={performance.totalQuestions}
                    marks={performance.partialMarks}
                    color="warning"
                  />
                )}
                <PerformanceBar
                  label="Incorrect"
                  value={performance.incorrect}
                  total={performance.totalQuestions}
                  marks={performance.incorrectMarks}
                  color="error"
                />
                <PerformanceBar
                  label="Unattempted"
                  value={performance.unattempted}
                  total={performance.totalQuestions}
                  marks={null}
                  color="grey"
                />
                {performance.pending > 0 && (
                  <PerformanceBar
                    label="Awaiting review"
                    value={performance.pending}
                    total={performance.totalQuestions}
                    marks={null}
                    color="warning"
                  />
                )}
              </Stack>
            </Box>

            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>Section Performance</Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 2 }}>
                Correct answers, and the marks they carried.
              </Typography>
              {sections.length === 0 && (
                <Alert severity="info" variant="outlined">This paper has no sections — open Question-wise for the detail.</Alert>
              )}
              <Stack spacing={2}>
                {sections.map((section) => (
                  <Card key={section.sectionName} variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>
                          <MathRenderer text={section.sectionName} inline />
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
                          color={section.percentage >= 60 ? 'success.main' : 'error.main'}
                        >
                          {section.percentage}%
                        </Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, section.percentage))}
                        sx={{
                          height: 8, borderRadius: 4, bgcolor: 'grey.100',
                          '& .MuiLinearProgress-bar': {
                            bgcolor: section.percentage >= 60 ? 'success.main' : 'error.main', borderRadius: 4,
                          },
                        }} />
                      <Box sx={{ mt: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 2, rowGap: 0.25 }}>
                        <ScoreLine label="Correct" value={`${section.correct}/${section.total}`} strong />
                        <ScoreLine label="Marks" value={`${section.score}/${section.totalMarks}`} strong />
                        {section.partial > 0 && <ScoreLine label="Partially correct" value={String(section.partial)} />}
                        {section.incorrect > 0 && <ScoreLine label="Incorrect" value={String(section.incorrect)} />}
                        {section.unattempted > 0 && <ScoreLine label="Unattempted" value={String(section.unattempted)} />}
                        {section.correct > 0 && (
                          <ScoreLine label="Marks carried by correct answers" value={String(section.correctMarks)} />
                        )}
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Box>
          </Box>
        </TabPanel>

        {/* Tab 1: Section Analysis */}
        <TabPanel value={activeTab} index={1}>
          <SectionAnalysis sections={sections} />
        </TabPanel>

        {/* Tab 2: Question-wise review */}
        <TabPanel value={activeTab} index={2}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            <Box sx={{ flex: '0 0 200px', display: { xs: 'none', md: 'block' } }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }} gutterBottom>Questions</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
                {questions.map((q, idx) => (
                  <QuestionPaletteButton
                    key={q.questionId || idx}
                    index={idx}
                    status={resolveQuestionOutcomeStatus(q)}
                    selected={selectedQuestion === idx}
                    onSelect={setSelectedQuestion}
                  />
                ))}
              </Box>
              <QuestionLegend />
            </Box>
            <Box sx={{ flex: 1, minWidth: { xs: 0, sm: 300 }, width: '100%' }}>
              {/* Phones: horizontal question strip replaces the hidden side palette */}
              <Box sx={{ display: { xs: 'flex', md: 'none' }, gap: 1, overflowX: 'auto', pb: 1, mb: 2, mx: -2, px: 2, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
                {questions.map((q, idx) => (
                  <QuestionPaletteButton
                    key={q.questionId || idx}
                    index={idx}
                    status={resolveQuestionOutcomeStatus(q)}
                    selected={selectedQuestion === idx}
                    onSelect={setSelectedQuestion}
                    horizontal
                  />
                ))}
              </Box>
              {result.questionResults[selectedQuestion] && (
                <QuestionDetailCard question={result.questionResults[selectedQuestion]} questionNumber={selectedQuestion + 1} />
              )}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
                <Button startIcon={<NavigateBefore />} disabled={selectedQuestion === 0}
                  onClick={() => setSelectedQuestion((p) => p - 1)}>Previous</Button>
                <Button endIcon={<NavigateNext />} disabled={selectedQuestion === result.questionResults.length - 1}
                  onClick={() => setSelectedQuestion((p) => p + 1)}>Next</Button>
              </Box>
            </Box>
          </Box>
        </TabPanel>

        {/* Tab 3: Leaderboard */}
        <TabPanel value={activeTab} index={3}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell><strong>Rank</strong></TableCell>
                  <TableCell><strong>Student</strong></TableCell>
                  <TableCell align="right"><strong>Score</strong></TableCell>
                  <TableCell align="right"><strong>%</strong></TableCell>
                  <TableCell align="right"><strong>Time</strong></TableCell>
                  <TableCell align="center"><strong>Status</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(result.leaderboard || []).map((entry) => (
                  <TableRow key={entry.studentId} hover sx={entry.isCurrentUser ? { bgcolor: 'action.selected' } : {}}>
                    <TableCell>
                      <Chip size="small" label={`#${entry.rank}`}
                        sx={{
                          fontWeight: 700,
                          bgcolor: entry.rank === 1 ? 'warning.main' : entry.rank <= 3 ? 'grey.300' : undefined,
                          color: entry.rank <= 3 ? 'white' : undefined,
                        }} />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>{entry.studentName[0]}</Avatar>
                        <Typography variant="body2" sx={{ fontWeight: entry.isCurrentUser ? 700 : 400 }}>
                          {entry.isCurrentUser ? 'You' : entry.studentName}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{entry.score}/{entry.totalMarks}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{entry.percentage}%</TableCell>
                    <TableCell align="right">{formatDuration(entry.timeTaken)}</TableCell>
                    <TableCell align="center">
                      <Chip size="small" label={entry.isPassed ? 'Passed' : 'Failed'} color={entry.isPassed ? 'success' : 'error'} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>
      </Card>
    </Box>
  );
};

/* ── Page chrome ─────────────────────────────────────────────────────── */

const ResultToolbar: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
    <Button startIcon={<ArrowBack />} onClick={onBack}>Back to Assessments</Button>
    <TextSizeControl />
  </Box>
);

/**
 * One Vriddhi Phase C — the assessment → practice/learning loop. Every graded
 * paper ends with at least one honest next step: practice the same subject in
 * Placement Prep (when the college keeps it visible) or open the study
 * materials. Nothing here fabricates readiness — it only routes the student to
 * the surfaces that already exist.
 */
const ResultNextSteps: React.FC<{ subject: string }> = ({ subject }) => {
  const { placementPrepEnabled } = useStudentData();
  const subjectLabel = String(subject || '').trim();

  return (
    <Card variant="outlined" sx={{ borderRadius: 3, mb: 4 }}>
      <CardContent sx={{ p: { xs: 2.5, md: 3 }, '&:last-child': { pb: 3 } }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
          Next steps
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Turn this result into progress — one of these will move you forward.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          {placementPrepEnabled && (
            <Button
              variant="contained"
              color="primary"
              component={RouterLink}
              to="/prep"
              data-testid="result-loop-practice"
            >
              {subjectLabel ? `Practice ${subjectLabel} questions` : 'Practice similar questions'}
            </Button>
          )}
          <Button
            variant="outlined"
            component={RouterLink}
            to="/student/materials"
            data-testid="result-loop-study"
          >
            {subjectLabel ? `Study ${subjectLabel} materials` : 'Open study materials'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
};

/* ── Aligned metric primitives ───────────────────────────────────────── */

const ScoreLine: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <>
    <Typography
      variant="caption"
      sx={{ color: strong ? 'text.primary' : 'text.secondary', fontWeight: strong ? 600 : 400, minWidth: 0, overflowWrap: 'anywhere' }}
    >
      {label}
    </Typography>
    <Typography
      variant="caption"
      sx={{ fontWeight: strong ? 700 : 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    >
      {value}
    </Typography>
  </>
);

const PERFORMANCE_COLORS: Record<string, string> = {
  success: '#2e7d32',
  warning: '#ed6c02',
  error: '#d32f2f',
  grey: '#9e9e9e',
};

const PerformanceBar: React.FC<{
  label: string;
  value: number;
  total: number;
  marks: number | null;
  color: 'success' | 'warning' | 'error' | 'grey';
}> = ({ label, value, total, marks, color }) => {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', columnGap: 2, alignItems: 'baseline', mb: 0.5 }}>
        <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{label}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {value}/{total}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', minWidth: 58, textAlign: 'right' }}>
          {marks === null ? '—' : `${marks} ${Math.abs(marks) === 1 ? 'mark' : 'marks'}`}
        </Typography>
      </Box>
      <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, pct))}
        sx={{
          height: 10, borderRadius: 5, bgcolor: 'grey.100',
          '& .MuiLinearProgress-bar': { bgcolor: PERFORMANCE_COLORS[color], borderRadius: 5 },
        }} />
    </Box>
  );
};

/**
 * Section analysis: the same rows as a table on a laptop and as aligned cards
 * on a phone, so nothing is cut off by a seven-column table on a narrow
 * screen. Every number is right-aligned in a tabular font, which is what makes
 * the columns line up instead of drifting with the label lengths.
 */
const SectionAnalysis: React.FC<{ sections: ReturnType<typeof resolveSectionSummaries> }> = ({ sections }) => {
  if (sections.length === 0) {
    return <Alert severity="info" variant="outlined">No section structure was stored for this paper.</Alert>;
  }

  const totalQuestions = sections.reduce((sum, section) => sum + section.total, 0);
  const totals = sections.reduce(
    (acc, section) => ({
      correct: acc.correct + section.correct,
      partial: acc.partial + section.partial,
      incorrect: acc.incorrect + section.incorrect,
      unattempted: acc.unattempted + section.unattempted,
      score: acc.score + section.score,
      totalMarks: acc.totalMarks + section.totalMarks,
    }),
    { correct: 0, partial: 0, incorrect: 0, unattempted: 0, score: 0, totalMarks: 0 }
  );
  const overallPercentage = totals.totalMarks > 0 ? Math.round((totals.score / totals.totalMarks) * 100) : 0;

  const numericCell = { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const };

  return (
    <Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Every number is per question. Partially correct answers earned some, not all, of their marks.
      </Typography>

      {/* Phone: one card per section, labels left / numbers right */}
      <Stack spacing={2} sx={{ display: { xs: 'flex', md: 'none' } }}>
        {sections.map((section) => (
          <Card key={section.sectionName} variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>
                  <MathRenderer text={section.sectionName} inline />
                </Typography>
                <Chip
                  size="small"
                  label={`${section.percentage}%`}
                  color={section.percentage >= 60 ? 'success' : 'error'}
                  sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
                />
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 2, rowGap: 0.5 }}>
                <ScoreLine label="Questions" value={String(section.total)} />
                <ScoreLine label="Correct" value={`${section.correct}/${section.total}`} strong />
                <ScoreLine label="Partially correct" value={String(section.partial)} />
                <ScoreLine label="Incorrect" value={String(section.incorrect)} />
                <ScoreLine label="Unattempted" value={String(section.unattempted)} />
                <ScoreLine label="Marks" value={`${section.score}/${section.totalMarks}`} strong />
                <ScoreLine label="Marks carried by correct answers" value={String(section.correctMarks)} />
              </Box>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {/* Laptop: the same data as a table, all numbers in one optical column */}
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, display: { xs: 'none', md: 'block' } }}>
        <Table size="small" sx={{ tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell sx={{ width: '30%' }}><strong>Section</strong></TableCell>
              <TableCell align="right"><strong>Qs</strong></TableCell>
              <TableCell align="right"><strong>Correct</strong></TableCell>
              <TableCell align="right"><strong>Partial</strong></TableCell>
              <TableCell align="right"><strong>Incorrect</strong></TableCell>
              <TableCell align="right"><strong>Unattempted</strong></TableCell>
              <TableCell align="right"><strong>Score</strong></TableCell>
              <TableCell align="right"><strong>%</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sections.map((section) => (
              <TableRow key={section.sectionName} hover>
                <TableCell sx={{ overflowWrap: 'anywhere' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    <MathRenderer text={section.sectionName} inline />
                  </Typography>
                </TableCell>
                <TableCell sx={numericCell}>{section.total}</TableCell>
                <TableCell sx={{ ...numericCell, color: 'success.main', fontWeight: 700 }}>{section.correct}</TableCell>
                <TableCell sx={{ ...numericCell, color: section.partial > 0 ? 'warning.main' : 'text.secondary', fontWeight: section.partial > 0 ? 600 : 400 }}>{section.partial}</TableCell>
                <TableCell sx={{ ...numericCell, color: 'error.main' }}>{section.incorrect}</TableCell>
                <TableCell sx={{ ...numericCell, color: 'text.secondary' }}>{section.unattempted}</TableCell>
                <TableCell sx={{ ...numericCell, fontWeight: 700 }}>{section.score}/{section.totalMarks}</TableCell>
                <TableCell sx={numericCell}>
                  <Chip size="small" label={`${section.percentage}%`} color={section.percentage >= 60 ? 'success' : 'error'}
                    sx={{ fontVariantNumeric: 'tabular-nums' }} />
                </TableCell>
              </TableRow>
            ))}
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
              <TableCell sx={{ ...numericCell, fontWeight: 700 }}>{totalQuestions}</TableCell>
              <TableCell sx={{ ...numericCell, fontWeight: 700 }}>{totals.correct}</TableCell>
              <TableCell sx={{ ...numericCell, fontWeight: 700 }}>{totals.partial}</TableCell>
              <TableCell sx={{ ...numericCell, fontWeight: 700 }}>{totals.incorrect}</TableCell>
              <TableCell sx={{ ...numericCell, fontWeight: 700 }}>{totals.unattempted}</TableCell>
              <TableCell sx={{ ...numericCell, fontWeight: 700 }}>{totals.score}/{totals.totalMarks}</TableCell>
              <TableCell sx={{ ...numericCell, fontWeight: 700 }}>{overallPercentage}%</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

const QuestionPaletteButton: React.FC<{
  index: number;
  status: QuestionOutcomeStatus;
  selected: boolean;
  onSelect: (index: number) => void;
  horizontal?: boolean;
}> = ({ index, status, selected, onSelect, horizontal = false }) => {
  const color = PALETTE_COLORS[status];
  return (
    <Button
      onClick={() => onSelect(index)}
      aria-label={`Question ${index + 1}: ${outcomeLabel(status)}`}
      sx={{
        minWidth: 40, width: 40, height: 40, p: 0, borderRadius: 1,
        ...(horizontal ? { flexShrink: 0 } : {}),
        bgcolor: color,
        color: status === 'unattempted' ? 'text.primary' : 'white',
        fontWeight: 700, fontSize: '0.75rem',
        border: selected ? 2 : 0, borderColor: 'primary.main',
      }}
    >
      {index + 1}
    </Button>
  );
};

const PALETTE_COLORS: Record<QuestionOutcomeStatus, string> = {
  correct: 'success.main',
  partial: 'warning.main',
  pending_manual: 'warning.light',
  incorrect: 'error.main',
  unattempted: 'grey.300',
};

const QuestionLegend: React.FC = () => (
  <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 1, rowGap: 0.5, alignItems: 'center' }}>
    {(Object.keys(PALETTE_COLORS) as QuestionOutcomeStatus[]).map((status) => (
      <React.Fragment key={status}>
        <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: PALETTE_COLORS[status] }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{outcomeLabel(status)}</Typography>
      </React.Fragment>
    ))}
  </Box>
);

/* ── Small pieces ────────────────────────────────────────────────────── */

const ResultStat: React.FC<{ icon: React.ReactNode; label: string; value: string | number }> = ({ icon, label, value }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
    {icon}
    <Box>
      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body1" sx={{ fontWeight: 700 }}>{value}</Typography>
    </Box>
  </Box>
);

const QuestionDetailCard: React.FC<{ question: any; questionNumber: number }> = ({ question, questionNumber }) => {
  const outcome = resolveQuestionOutcomeStatus(question as ResultQuestionLike);
  const label = outcomeLabel(outcome);
  const color = outcomeColor(outcome);
  const marksObtained = typeof question.marksObtained === 'number' ? question.marksObtained : null;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip label={`Q${questionNumber}`} size="small" color="primary" sx={{ fontWeight: 700 }} />
            <Chip label={label} size="small" color={color} />
            {question.sectionName && <Chip label={question.sectionName} size="small" variant="outlined" />}
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {marksObtained === null ? '—' : marksObtained} / {question.marks} marks
          </Typography>
        </Box>

        <Box sx={{ mb: 3, overflowWrap: 'anywhere' }}>
          <MathRenderer text={question.questionText || ''} />
        </Box>

        {question.options && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
            {question.options.map((opt: string, idx: number) => {
              const isCorrect = question.correctAnswer === opt;
              const isSelected = question.studentAnswer === opt;
              return (
                <Box key={idx} sx={{
                  p: 1.5, borderRadius: 2, border: 1,
                  borderColor: isCorrect ? 'success.main' : isSelected ? 'error.main' : 'divider',
                  bgcolor: isCorrect ? 'rgba(76,175,80,0.08)' : isSelected ? 'rgba(244,67,54,0.08)' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 1,
                }}>
                  <Chip size="small" label={String.fromCharCode(65 + idx)} sx={{ minWidth: 28 }} />
                  <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}><MathRenderer text={opt} inline /></Box>
                  {isCorrect && <CheckCircle color="success" fontSize="small" />}
                  {isSelected && !isCorrect && <Cancel color="error" fontSize="small" />}
                </Box>
              );
            })}
          </Box>
        )}

        {question.studentAnswer !== undefined && question.studentAnswer !== '' && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: outcome === 'correct' ? 'rgba(76,175,80,0.05)' : 'rgba(244,67,54,0.05)', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} gutterBottom color={outcome === 'correct' ? 'success.main' : outcome === 'partial' ? 'warning.main' : 'error.main'}>
              Your Answer:
            </Typography>
            <Box sx={{ overflowWrap: 'anywhere' }}>
              <MathRenderer text={String(question.studentAnswer)} inline />
            </Box>
          </Paper>
        )}

        {outcome !== 'correct' && question.correctAnswer && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'rgba(76,175,80,0.05)', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'success.main' }} gutterBottom>
              Correct Answer:
            </Typography>
            <Box sx={{ overflowWrap: 'anywhere' }}>
              <MathRenderer text={String(question.correctAnswer)} inline />
            </Box>
          </Paper>
        )}

        {outcome === 'partial' && marksObtained !== null && (
          <Alert severity="warning" icon={<RemoveCircleOutlined fontSize="inherit" />} sx={{ mb: 2 }}>
            Partially correct — {marksObtained} of {question.marks} marks awarded.
          </Alert>
        )}

        {question.explanation && (
          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'rgba(33,150,243,0.05)', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'info.main' }} gutterBottom>Explanation</Typography>
            <Box sx={{ overflowWrap: 'anywhere' }}>
              <MathRenderer text={question.explanation} />
            </Box>
          </Paper>
        )}
      </CardContent>
    </Card>
  );
};

const ResultSkeleton: React.FC = () => (
  <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
    <Skeleton variant="text" width={200} height={30} sx={{ mb: 2 }} />
    <Skeleton variant="rounded" height={200} sx={{ mb: 4 }} />
    <Skeleton variant="rounded" height={400} />
  </Box>
);

const getGrade = (percentage: number): string => {
  if (percentage >= 90) return 'A+'; if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B'; if (percentage >= 60) return 'C';
  if (percentage >= 50) return 'D'; return 'F';
};

const formatDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) { const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; }
  return `${m}m ${s}s`;
};

export default TestResultPage;
