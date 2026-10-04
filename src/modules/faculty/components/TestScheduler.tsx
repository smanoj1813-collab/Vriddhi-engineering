// src/modules/faculty/components/TestScheduler.tsx
// FIXED: usePapers and useScheduledTests imported from useAssessment (they exist there)

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Typography, Button, Stack, Card, CardContent, TextField, Select, MenuItem,
  FormControl, InputLabel, Chip, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, Alert, Paper, FormControlLabel, Checkbox, Radio, RadioGroup,
  FormLabel, Stepper, Step, StepLabel, StepContent, Autocomplete, Divider,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, CalendarToday as CalendarIcon,
  AccessTime as TimeIcon, People as PeopleIcon, Send as PublishIcon,
  Cancel as CancelIcon, CheckCircle as CheckIcon, School as SchoolIcon,
  Lock as LockIcon, Videocam as ProctorIcon, Save as SaveIcon,
} from '@mui/icons-material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { usePapers, useScheduledTests } from '../../../hooks/useAssessment';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../Firebase/config';
import { useAuth } from '../../auth/context/AuthContext';
import {
  AssessmentPaper, ScheduledTest, ScheduleTestInput, TestVisibility,
} from '../../../types/assessment';
import { isPaperOnlineReady, paperQuestionCount } from '../../../shared/utils/paperReadiness';
import { effectiveScheduledAssessmentStatus } from '../../../shared/utils/assessmentLifecycle';
import { format } from 'date-fns';

interface TestSchedulerProps {
  collegeId: string;
}

interface SectionTarget {
  id: string;
  name: string;
  section: string;
  program: string;
  branch: string;
  batch: string;
  semester: number;
}

const STEPS = ['Select Paper', 'Set Schedule', 'Choose Students', 'Review & Publish'];

/** Safely convert Timestamp | Date | string to Date */
const toDate = (value: unknown): Date => {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as any).toDate === 'function') {
    return (value as any).toDate();
  }
  return new Date();
};

const TestScheduler: React.FC<TestSchedulerProps> = ({ collegeId }) => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const deepLinkHandled = useRef(false);
  const { papers, loading: papersLoading, error: papersError } = usePapers(collegeId);
  const { tests, schedule, publish, cancel, loading: testsLoading, error: testsError } = useScheduledTests(collegeId);

  const [showScheduler, setShowScheduler] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  // Step 1: Paper Selection
  const [selectedPaper, setSelectedPaper] = useState<AssessmentPaper | null>(null);
  // True while the server checks the selected paper's questions for
  // schedule-time problems (same validator the real schedule uses).
  const [checkingPaper, setCheckingPaper] = useState(false);

  // Step 2: Schedule
  const [testTitle, setTestTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDateTime, setStartDateTime] = useState<Date | null>(new Date());
  const [endDateTime, setEndDateTime] = useState<Date | null>(new Date(Date.now() + 3600000));
  const [durationMinutes, setDurationMinutes] = useState(30);
  // Cohort the test is labelled for (optional). The program scope lets the
  // server freeze the matching scheme pack at schedule time; branch and batch
  // narrow that assignment when supplied.
  const [program, setProgram] = useState('');
  const [branch, setBranch] = useState('');
  const [batch, setBatch] = useState('');
  const [allowLateSubmission, setAllowLateSubmission] = useState(false);
  const [lateSubmissionPenalty, setLateSubmissionPenalty] = useState(0);
  const [enableProctoring, setEnableProctoring] = useState(false);
  const [maxTabSwitches, setMaxTabSwitches] = useState(0);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [shuffleSections, setShuffleSections] = useState(false);
  const [resultPublishDate, setResultPublishDate] = useState<Date | null>(null);

  // Step 3: Visibility
  const [visibility, setVisibility] = useState<TestVisibility>('public');
  const [targetSections, setTargetSections] = useState<Array<{
    sectionId: string;
    sectionName: string;
    section: string;
    program: string;
    branch: string;
    batch: string;
    semester: number;
  }>>([]);
  const [targetStudents, setTargetStudents] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [availableSections, setAvailableSections] = useState<SectionTarget[]>([]);
  const [availableStudents, setAvailableStudents] = useState<Array<{
    id: string;
    name: string;
    regNo: string;
    sectionId: string;
    program: string;
    branch: string;
    batch: string;
    semester: number;
  }>>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);

  useEffect(() => {
    if (!collegeId) {
      setAvailableSections([]);
      setAvailableStudents([]);
      setTargetsLoading(false);
      return;
    }
    let cancelled = false;
    setTargetsLoading(true);
    getDocs(query(collection(db, 'students'), where('collegeId', '==', collegeId), limit(500)))
      .then((snapshot) => {
        if (cancelled) return;
        const students = snapshot.docs.map((student) => {
          const data = student.data();
          const section = String(data.section || data.division || '').trim();
          return {
            id: student.id,
            name: String(data.name || 'Unnamed student'),
            regNo: String(data.regNo || data.registrationNumber || ''),
            sectionId: section,
            program: String(data.programId || data.program || data.course || data.courseName || ''),
            branch: String(data.branch || data.department || ''),
            batch: String(data.batch || data.academicYear || ''),
            semester: Number(data.semester) || 0,
          };
        });
        const sections = new Map<string, SectionTarget>();
        students.forEach((student) => {
          if (!student.sectionId) return;
          const id = [student.program, student.branch, student.batch, student.semester, student.sectionId].join('|');
          sections.set(id, {
            id,
            name: [student.program, student.branch, student.batch, `Semester ${student.semester}`, `Section ${student.sectionId}`].filter(Boolean).join(' · '),
            section: student.sectionId,
            program: student.program,
            branch: student.branch,
            batch: student.batch,
            semester: student.semester,
          });
        });
        setAvailableStudents(students);
        setAvailableSections([...sections.values()].sort((left, right) => left.name.localeCompare(right.name)));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load student targets.');
      })
      .finally(() => { if (!cancelled) setTargetsLoading(false); });
    return () => { cancelled = true; };
  }, [collegeId]);

  // Distinct program / branch / batch values present in the college, for the selectors.
  const programOptions = useMemo(
    () => [...new Set(availableStudents.map((student) => student.program).filter(Boolean))].sort(),
    [availableStudents],
  );
  const branchOptions = useMemo(
    () => [...new Set(availableStudents.map((s) => s.branch).filter(Boolean))].sort(),
    [availableStudents],
  );
  const batchOptions = useMemo(
    () => [...new Set(availableStudents.map((s) => s.batch).filter(Boolean))].sort(),
    [availableStudents],
  );

  const handleNext = async () => {
    if (activeStep === 0 && !selectedPaper) {
      setError('Please select a paper');
      return;
    }
    // Surface the exact scheduling problem at the SELECT step — using the
    // same server-side validator and the same question-resolution order
    // (embedded sections, else linked bank questions) the real schedule uses
    // — instead of letting it surface at the final Publish step.
    if (activeStep === 0 && selectedPaper) {
      setCheckingPaper(true);
      setError(null);
      try {
        const response = await httpsCallable(functions, 'checkPaperScheduling')({
          paperId: selectedPaper.id,
          collegeId,
        });
        const check = response.data as { ok: boolean; issueCount: number; firstIssue: string | null };
        if (!check.ok) {
          setError(
            check.firstIssue
              || 'This paper has questions that cannot be scheduled online — open it in Papers and fix them.',
          );
          return;
        }
      } catch (err) {
        // Check unavailable (e.g. backend not redeployed yet) — proceed; the
        // schedule-time gate still enforces the same validation on Publish.
        console.warn('[TestScheduler] scheduling check unavailable', err);
      } finally {
        setCheckingPaper(false);
      }
    }
    if (activeStep === 1) {
      if (!testTitle.trim()) {
        setError('Test title is required');
        return;
      }
      if (!startDateTime || !endDateTime) {
        setError('Start and end dates are required');
        return;
      }
      if (startDateTime >= endDateTime) {
        setError('End date must be after start date');
        return;
      }
    }
    if (activeStep === 2) {
      if (visibility === 'private' && targetSections.length === 0) {
        setError('Select at least one section');
        return;
      }
      if (visibility === 'selected' && targetStudents.length === 0) {
        setError('Select at least one student');
        return;
      }
    }

    setError(null);
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
    setError(null);
  };

  const handleSchedule = async () => {
    if (!selectedPaper || !startDateTime || !endDateTime) return;

    setLoading(true);
    setError(null);

    try {
      const input: ScheduleTestInput = {
        title: testTitle,
        subject: selectedPaper.subject,
        paperId: selectedPaper.id,
        scheduledAt: startDateTime.toISOString(),
        duration: durationMinutes,
        instructions: description || undefined,
      };

      // Pass extended fields via spread to avoid type conflicts with the base ScheduleTestInput
      await schedule({
        ...input,
        startDateTime,
        endDateTime,
        program,
        courseType: selectedPaper.courseType || undefined,
        branch,
        batch,
        visibility: visibility === 'public' ? 'public' : 'selected',
        targetSections: visibility === 'private' ? targetSections : undefined,
        targetStudents: visibility === 'selected' ? targetStudents : undefined,
        allowLateSubmission,
        lateSubmissionPenalty: allowLateSubmission ? lateSubmissionPenalty : undefined,
        enableProctoring,
        maxTabSwitches,
        shuffleQuestions,
        shuffleOptions,
        shuffleSections,
        resultPublishDate: resultPublishDate || undefined,
      } as ScheduleTestInput);

      setShowScheduler(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule test');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setActiveStep(0);
    setSelectedPaper(null);
    setTestTitle('');
    setDescription('');
    setStartDateTime(new Date());
    setEndDateTime(new Date(Date.now() + 3600000));
    setDurationMinutes(30);
    setProgram('');
    setBranch('');
    setBatch('');
    setAllowLateSubmission(false);
    setLateSubmissionPenalty(0);
    setEnableProctoring(false);
    setMaxTabSwitches(0);
    setShuffleQuestions(false);
    setShuffleOptions(false);
    setShuffleSections(false);
    setResultPublishDate(null);
    setVisibility('public');
    setTargetSections([]);
    setTargetStudents([]);
  };

  const handleCancelTest = async (testId: string) => {
    if (!window.confirm('Are you sure you want to cancel this test?')) return;
    try {
      await (cancel as any)(testId, 'Cancelled by faculty');
    } catch (err) {
      console.error('Failed to cancel test:', err);
    }
  };

  const handlePublishTest = async (testId: string) => {
    try {
      await (publish as any)(testId);
    } catch (err) {
      console.error('Failed to publish test:', err);
    }
  };

  const getStatusColor = (status: string): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" => {
    switch (status) {
      case 'scheduled': return 'warning';
      case 'published': return 'info';
      case 'ongoing': return 'success';
      case 'completed': return 'default';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  };

  const typedTests = (tests || []) as ScheduledTest[];
  // Approval promotes a paper into the college's reusable source library.
  // Scheduling freezes questions into each test, so do not hide approved
  // papers merely because a different faculty member created them.
  const typedPapers = (papers || []).filter((paper: AssessmentPaper) =>
    ['approved', 'published'].includes(String(paper.status))
    && isPaperOnlineReady(paper)
  ) as AssessmentPaper[];

  // Paper Review / Generated Papers can deep-link directly into a fresh
  // schedule while retaining the source paper for any later department/test.
  useEffect(() => {
    if (deepLinkHandled.current || papersLoading) return;
    const requestedPaperId = searchParams.get('paperId');
    if (!requestedPaperId) {
      deepLinkHandled.current = true;
      return;
    }
    const requested = typedPapers.find((paper) => paper.id === requestedPaperId);
    deepLinkHandled.current = true;
    if (!requested) {
      setError('That paper is not approved and online-ready for scheduling.');
      return;
    }
    setSelectedPaper(requested);
    setProgram(requested.programId || requested.program || '');
    setBranch(requested.branch || '');
    setBatch(requested.batch || '');
    setTestTitle(requested.title ? `${requested.title} - Test` : 'Scheduled Test');
    if (requested.duration > 0) setDurationMinutes(requested.duration);
    setShowScheduler(true);
  }, [papersLoading, searchParams, typedPapers]);

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box sx={{ p: 3 }}>
        {(papersError || testsError) && (
          <Alert severity="error" sx={{ mb: 2 }}>{papersError || testsError}</Alert>
        )}
        {!showScheduler ? (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Box>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>Test Scheduler</Typography>
                <Typography variant="body2" color="text.secondary">
                  Schedule and manage tests for students
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setShowScheduler(true)}
              >
                Schedule New Test
              </Button>
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {typedTests.map((test: ScheduledTest) => {
                const effectiveStatus = effectiveScheduledAssessmentStatus(test);
                // College-wide list: faculty may publish/cancel only their own
                // tests (enforced server-side too) — hide the actions otherwise
                // so a guaranteed-rejected click never appears.
                const canManage = !user?.role
                  || user.role === 'faculty'
                    ? test.facultyId === user?.uid
                    : true;
                return (
                <Card key={test.id} variant="outlined" sx={{ flex: '1 1 350px', borderRadius: 2 }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 600 }}>{test.title}</Typography>
                      <Chip size="small" label={effectiveStatus} color={getStatusColor(effectiveStatus)} />
                    </Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      {(test as any).description || 'No description'}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
                      <Chip size="small" icon={<CalendarIcon fontSize="small" />} label={format(toDate(test.scheduledAt), 'MMM dd, yyyy')} />
                      <Chip size="small" icon={<TimeIcon fontSize="small" />} label={`${test.duration} min`} />
                      {test.branch && <Chip size="small" icon={<SchoolIcon fontSize="small" />} label={test.branch} />}
                      {test.batch && <Chip size="small" icon={<SchoolIcon fontSize="small" />} label={`Batch ${test.batch}`} />}
                      <Chip size="small" icon={<PeopleIcon fontSize="small" />} label={((test as any).visibility || 'all').replace(/_/g, ' ')} />
                    </Stack>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
                      {canManage && effectiveStatus === 'scheduled' && (
                        <Button size="small" variant="outlined" startIcon={<PublishIcon />} onClick={() => handlePublishTest(test.id)}>
                          Publish
                        </Button>
                      )}
                      {canManage && effectiveStatus !== 'completed' && effectiveStatus !== 'cancelled' && (
                        <Button size="small" color="error" startIcon={<CancelIcon />} onClick={() => handleCancelTest(test.id)}>
                          Cancel
                        </Button>
                      )}
                    </Box>
                  </CardContent>
                </Card>
                );
              })}
            </Box>

            {testsLoading && <Alert severity="info" sx={{ mt: 2 }}>Loading scheduled tests…</Alert>}
            {!testsLoading && typedTests.length === 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>No scheduled tests yet. Create your first test schedule!</Alert>
            )}
          </Box>
        ) : (
          <Paper elevation={2} sx={{ p: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>Schedule New Test</Typography>
              <Button variant="outlined" onClick={() => { setShowScheduler(false); resetForm(); }}>
                Cancel
              </Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

            <Stepper activeStep={activeStep} orientation="vertical">
              <Step>
                <StepLabel>Select Paper</StepLabel>
                <StepContent>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Click a paper to select it — click the SAME paper again (or “Clear
                    selection”) to deselect it and pick another.
                  </Typography>
                  <Alert severity="info" sx={{ mt: 1.5 }}>
                    Approved papers are reusable college templates. Each test receives its own frozen copy, so you can
                    schedule the same paper again for another date, branch, batch, section, or department.
                  </Alert>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 2 }}>
                    {typedPapers.map((paper: AssessmentPaper) => (
                      <Card
                        key={paper.id}
                        variant="outlined"
                        sx={{
                          flex: '1 1 280px',
                          cursor: 'pointer',
                          position: 'relative',
                          border: selectedPaper?.id === paper.id ? 2 : 1,
                          borderColor: selectedPaper?.id === paper.id ? 'primary.main' : 'divider',
                          bgcolor: selectedPaper?.id === paper.id ? 'primary.50' : 'background.paper',
                        }}
                        // Clicking the already-selected card DESELECTS it —
                        // the previous behaviour (re-select) left no way to
                        // switch to a different paper.
                        onClick={() => {
                          const nextPaper = selectedPaper?.id === paper.id ? null : paper;
                          setSelectedPaper(nextPaper);
                          setProgram(nextPaper?.programId || nextPaper?.program || '');
                          setBranch(nextPaper?.branch || '');
                          setBatch(nextPaper?.batch || '');
                        }}
                      >
                        {selectedPaper?.id === paper.id && (
                          <Box
                            sx={{
                              position: 'absolute',
                              top: 8,
                              right: 8,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              color: 'primary.main',
                              fontWeight: 700,
                              fontSize: 13,
                            }}
                          >
                            <CheckIcon fontSize="small" /> Selected
                          </Box>
                        )}
                        <CardContent>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{paper.title}</Typography>
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            {(paper as any).description || 'No description'}
                          </Typography>
                          <Stack direction="row" spacing={0.5}>
                            <Chip size="small" label={paper.type || (paper as any).paperType || 'exam'} />
                            <Chip size="small" label={`${paperQuestionCount(paper)} Q`} />
                            <Chip size="small" label={`${paper.totalMarks} M`} />
                            <Chip size="small" label={`${paper.duration} min`} />
                          </Stack>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                  {selectedPaper && (
                    <Box sx={{ mt: 1.5 }}>
                      <Button
                        size="small"
                        color="inherit"
                        startIcon={<CancelIcon fontSize="small" />}
                        onClick={() => {
                          setSelectedPaper(null);
                          setProgram('');
                          setBranch('');
                          setBatch('');
                        }}
                      >
                        Clear selection
                      </Button>
                    </Box>
                  )}
                  {papersLoading && <Alert severity="info" sx={{ mt: 2 }}>Loading approved papers…</Alert>}
                  {!papersLoading && typedPapers.length === 0 && (
                    <Alert severity="warning" sx={{ mt: 2 }}>
                      No online-ready papers are available. A paper needs structured questions to be scheduled
                      online — open it in Papers, use “Parse file” (or add questions by hand), review, and confirm.
                      File-only papers remain printable but cannot be scheduled here.
                    </Alert>
                  )}
                  <Box sx={{ mt: 2 }}>
                    <Button variant="contained" onClick={handleNext} disabled={!selectedPaper || checkingPaper}>
                      {checkingPaper ? 'Checking paper…' : 'Next'}
                    </Button>
                  </Box>
                </StepContent>
              </Step>

              <Step>
                <StepLabel>Set Schedule</StepLabel>
                <StepContent>
                  <Stack spacing={3}>
                    <TextField label="Test Title" value={testTitle} onChange={(e) => setTestTitle(e.target.value)} fullWidth required />
                    <TextField label="Description" multiline rows={2} value={description} onChange={(e) => setDescription(e.target.value)} fullWidth />
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                      <DateTimePicker label="Start Date & Time" value={startDateTime} onChange={(v) => setStartDateTime(v)} sx={{ flex: '1 1 250px' }} />
                      <DateTimePicker label="End Date & Time" value={endDateTime} onChange={(v) => setEndDateTime(v)} sx={{ flex: '1 1 250px' }} />
                      <TextField label="Duration (minutes)" type="number" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} sx={{ flex: '1 1 150px' }} />
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                      <FormControl sx={{ flex: '1 1 180px', minWidth: 180 }}>
                        <InputLabel id="test-program-label">Program</InputLabel>
                        <Select
                          labelId="test-program-label"
                          label="Program"
                          value={program}
                          onChange={(e) => setProgram(e.target.value)}
                        >
                          <MenuItem value="">All programs</MenuItem>
                          {program && !programOptions.includes(program) && (
                            <MenuItem value={program}>{program}</MenuItem>
                          )}
                          {programOptions.map((option) => (
                            <MenuItem key={option} value={option}>{option}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControl sx={{ flex: '1 1 180px', minWidth: 180 }}>
                        <InputLabel id="test-branch-label">Branch</InputLabel>
                        <Select
                          labelId="test-branch-label"
                          label="Branch"
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                        >
                          <MenuItem value="">All branches</MenuItem>
                          {branch && !branchOptions.includes(branch) && <MenuItem value={branch}>{branch}</MenuItem>}
                          {branchOptions.map((b) => (
                            <MenuItem key={b} value={b}>{b}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControl sx={{ flex: '1 1 180px', minWidth: 180 }}>
                        <InputLabel id="test-batch-label">Batch</InputLabel>
                        <Select
                          labelId="test-batch-label"
                          label="Batch"
                          value={batch}
                          onChange={(e) => setBatch(e.target.value)}
                        >
                          <MenuItem value="">All batches</MenuItem>
                          {batch && !batchOptions.includes(batch) && <MenuItem value={batch}>{batch}</MenuItem>}
                          {batchOptions.map((b) => (
                            <MenuItem key={b} value={b}>{b}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                      <FormControlLabel control={<Checkbox checked={allowLateSubmission} onChange={(e) => setAllowLateSubmission(e.target.checked)} />} label="Allow Late Submission" />
                      {allowLateSubmission && (
                        <TextField label="Late Penalty (%)" type="number" value={lateSubmissionPenalty} onChange={(e) => setLateSubmissionPenalty(Number(e.target.value))} size="small" sx={{ width: 150 }} />
                      )}
                      <FormControlLabel control={<Checkbox checked={enableProctoring} onChange={(e) => setEnableProctoring(e.target.checked)} />} label="Enable Basic Browser Proctoring" />
                      <TextField
                        label="Max Tab Switches (0 = unlimited)"
                        type="number"
                        value={maxTabSwitches}
                        onChange={(e) => setMaxTabSwitches(Math.max(0, Math.min(20, Math.trunc(Number(e.target.value) || 0))))}
                        helperText="Student is auto-submitted when this limit is exceeded."
                        size="small"
                        sx={{ width: 230 }}
                      />
                    </Box>
                    <Paper variant="outlined" sx={{ p: 1.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>Shuffle options (applied per student)</Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                        <FormControlLabel control={<Checkbox checked={shuffleQuestions} onChange={(e) => setShuffleQuestions(e.target.checked)} />} label="Shuffle question order within sections" />
                        <FormControlLabel control={<Checkbox checked={shuffleSections} onChange={(e) => setShuffleSections(e.target.checked)} />} label="Shuffle section order" />
                        <FormControlLabel control={<Checkbox checked={shuffleOptions} onChange={(e) => setShuffleOptions(e.target.checked)} />} label="Shuffle answer options" />
                      </Box>
                    </Paper>
                    <DateTimePicker label="Result Publish Date (optional)" value={resultPublishDate} onChange={(v) => setResultPublishDate(v)} sx={{ flex: '1 1 250px' }} />
                  </Stack>
                  <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                    <Button onClick={handleBack}>Back</Button>
                    <Button variant="contained" onClick={handleNext}>Next</Button>
                  </Box>
                </StepContent>
              </Step>

              <Step>
                <StepLabel>Choose Students</StepLabel>
                <StepContent>
                  {targetsLoading && <Alert severity="info" sx={{ mb: 2 }}>Loading sections and students…</Alert>}
                  <FormControl component="fieldset" sx={{ mb: 2 }}>
                    <FormLabel component="legend">Test Visibility</FormLabel>
                    <RadioGroup value={visibility} onChange={(e) => setVisibility(e.target.value as TestVisibility)}>
                      <FormControlLabel value="public" control={<Radio />} label="All Students" />
                      <FormControlLabel value="private" control={<Radio />} label="Specific Sections" />
                      <FormControlLabel value="selected" control={<Radio />} label="Specific Students" />
                    </RadioGroup>
                  </FormControl>

                  {visibility === 'private' && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>Select Sections</Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {availableSections.map((section) => (
                          <Chip
                            key={section.id}
                            label={section.name}
                            onClick={() => {
                              setTargetSections((prev) => {
                                const exists = prev.find((s) => s.sectionId === section.id);
                                if (exists) return prev.filter((s) => s.sectionId !== section.id);
                                return [...prev, {
                                  sectionId: section.id,
                                  sectionName: section.name,
                                  section: section.section,
                                  program: section.program,
                                  branch: section.branch,
                                  batch: section.batch,
                                  semester: section.semester,
                                }];
                              });
                            }}
                            color={targetSections.find((s) => s.sectionId === section.id) ? 'primary' : 'default'}
                            variant={targetSections.find((s) => s.sectionId === section.id) ? 'filled' : 'outlined'}
                            clickable
                          />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {visibility === 'selected' && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>Select Students</Typography>
                      <Autocomplete
                        multiple
                        options={availableStudents}
                        getOptionLabel={(option) => `${option.name} (${option.regNo})`}
                        value={availableStudents.filter((s) => targetStudents.includes(s.id))}
                        onChange={(_, newValue) => setTargetStudents(newValue.map((v) => v.id))}
                        renderInput={(params) => <TextField {...params} placeholder="Search students..." />}
                        sx={{ maxWidth: 500 }}
                      />
                    </Box>
                  )}

                  <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                    <Button onClick={handleBack}>Back</Button>
                    <Button variant="contained" onClick={handleNext}>Next</Button>
                  </Box>
                </StepContent>
              </Step>

              <Step>
                <StepLabel>Review & Publish</StepLabel>
                <StepContent>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
                    <Typography variant="h6" gutterBottom>Test Summary</Typography>
                    <Divider sx={{ mb: 2 }} />
                    <Stack spacing={1}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Paper:</Typography>
                        <Typography sx={{ fontWeight: 500 }}>{selectedPaper?.title}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Title:</Typography>
                        <Typography sx={{ fontWeight: 500 }}>{testTitle}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Duration:</Typography>
                        <Typography>{durationMinutes} minutes</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Program / Branch / Batch:</Typography>
                        <Typography>
                          {program || 'All programs'}
                          {' / '}{branch || 'All branches'} / {batch || 'All batches'}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Start:</Typography>
                        <Typography>{startDateTime ? format(startDateTime, 'PPp') : '-'}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">End:</Typography>
                        <Typography>{endDateTime ? format(endDateTime, 'PPp') : '-'}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Visibility:</Typography>
                        <Typography>{(visibility || 'public').replace(/_/g, ' ')}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Proctoring:</Typography>
                        <Typography>{enableProctoring ? 'Enabled' : 'Disabled'}</Typography>
                      </Box>
                    </Stack>
                  </Paper>

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button onClick={handleBack}>Back</Button>
                    <Button variant="contained" startIcon={<PublishIcon />} onClick={handleSchedule} disabled={loading}>
                      {loading ? 'Scheduling...' : 'Schedule Test'}
                    </Button>
                  </Box>
                </StepContent>
              </Step>
            </Stepper>
          </Paper>
        )}
      </Box>
    </LocalizationProvider>
  );
};

export default TestScheduler;