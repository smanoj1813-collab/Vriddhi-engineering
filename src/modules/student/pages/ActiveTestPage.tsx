import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Card, CardContent, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, Alert, LinearProgress, Paper, CircularProgress,
  Drawer, useMediaQuery, useTheme,
} from '@mui/material';
import {
  Timer, NavigateNext, NavigateBefore, Send, PlayArrow,
  Warning, Fullscreen, Security, GridView,
} from '@mui/icons-material';
import { useAuth } from '../../auth/context/AuthContext';
import { useStudentProfile } from '../hooks/useStudentProfile';
import {
  fetchActiveTest,
  autosaveDelta,
  submitStudentAssessment,
  logProctorEvent,
} from '../api/testApi';
import QuestionRenderer from '../components/QuestionRenderer';
import {
  enteredSectionsFromAnswers,
  sectionKeyOf,
  shouldPlaySectionBreak,
} from '../examSectionBreaks';
import { MathRenderer } from '../components/MathRenderer';
import { applyExamLockdown, type ExamBlockReason } from '../../../shared/utils/examLockdown';
import type { ActiveTest, BasicProctorEvent, PaperQuestion, StudentAnswer } from '../types/assessment';

// What the student is told when the clipboard lockdown stops an action. The
// action itself is blocked whether or not the faculty enabled proctoring —
// only the reporting of it depends on that flag.
const BLOCK_MESSAGES: Record<ExamBlockReason, string> = {
  paste_attempt: 'Pasting is disabled during this test. Type your own answer.',
  copy_attempt: 'Copying is disabled during this test.',
  cut_attempt: 'Cutting is disabled during this test.',
  context_menu: 'The long-press menu is disabled during this test.',
  drop_attempt: 'Dropping text into the answer box is disabled during this test.',
  bulk_input: 'That text arrived too fast to be typed — please type your own answer.',
  keyboard_shortcut: 'This shortcut is disabled during the test.',
};

// Deterministic per-student presentation: the same student always sees the
// same shuffled order (so a refresh/resume is stable), while two students see
// different orders. Seed = testId + studentId.
function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rnd: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Build the display order: sections (optionally shuffled), questions within
// each section (optionally shuffled), and option order per question
// (optionally shuffled). Answers are keyed by question/option id, so reordering
// display never corrupts saved answers.
function buildDisplayQuestions(test: ActiveTest, studentId: string): PaperQuestion[] {
  const rnd = mulberry32(hashSeed(`${test.testId}::${studentId || 'anon'}`));
  const groups: Array<{ key: string; name: string; items: PaperQuestion[] }> = [];
  const indexByKey = new Map<string, number>();
  test.questions.forEach((q) => {
    const key = q.sectionId || 'sec-0';
    const name = q.sectionName || `Section ${indexByKey.size + 1}`;
    let g = indexByKey.has(key) ? groups[indexByKey.get(key)!] : null;
    if (!g) {
      g = { key, name, items: [] };
      indexByKey.set(key, groups.length);
      groups.push(g);
    }
    g.items.push(q);
  });
  if (test.shuffleSections && groups.length > 1) shuffleInPlace(groups, rnd);
  const out: PaperQuestion[] = [];
  groups.forEach((g) => {
    let items = g.items;
    if (test.shuffleQuestions && items.length > 1) items = shuffleInPlace([...items], rnd);
    items.forEach((q) => {
      const optionTypes = new Set(['mcq', 'multi_select']);
      if (test.shuffleOptions && optionTypes.has(q.type) && Array.isArray(q.options) && q.options.length > 1) {
        out.push({ ...q, options: shuffleInPlace([...q.options], rnd) });
      } else {
        out.push(q);
      }
    });
  });
  return out;
}

// Autosave cadence: saves only when something changed (dirty flag / pending
// delta), 3 s after the last change, with the 60 s tick as a safety net.
const AUTOSAVE_INTERVAL_MS = 60_000;
const AUTOSAVE_DEBOUNCE_MS = 3_000;
// Mandatory break between exam sections: the first time a student lands in a
// section they have not met yet, a countdown screen plays before its questions.
// The test clock runs on. Returning to a section already entered is instant —
// see ../examSectionBreaks.ts for why that is the whole rule.
const SECTION_BREAK_SECONDS = 30;
// Severity-high proctor events are still logged per-event (faculty live view);
// every other type rides along in the next autosave payload.
const DIRECT_LOG_PROCTOR_TYPES = new Set(['fullscreen_exit', 'auto_submit', 'fullscreen_denied']);

const ActiveTestPage: React.FC = () => {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { profile } = useStudentProfile(user?.uid);

  const [activeTest, setActiveTest] = useState<ActiveTest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showEnterGate, setShowEnterGate] = useState(true);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Partial<StudentAnswer>>>({});
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [proctorWarning, setProctorWarning] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  // Display order = seeded shuffle (sections → questions → options) per the
  // test's scheduling flags; null until the test has loaded.
  const [displayQuestions, setDisplayQuestions] = useState<PaperQuestion[] | null>(null);
  const [showTabLimitWarning, setShowTabLimitWarning] = useState(false);
  // 30-second gap between sections: { targetIndex, sectionName, sectionKey }
  // while the break countdown is showing; null while a section is being answered.
  // sectionKey is carried here (not read off `questions` in the countdown
  // effect below) because that effect runs before the display list exists.
  const [sectionTransition, setSectionTransition] = useState<{ targetIndex: number; sectionName: string; sectionKey: string } | null>(null);
  // Sections the student has already been inside this sitting. A ref, not
  // state: nothing renders from it, and a re-render must not re-arm a break.
  const enteredSectionsRef = useRef<Set<string>>(new Set());
  const [transitionRemaining, setTransitionRemaining] = useState(SECTION_BREAK_SECONDS);

  const collegeId = profile?.collegeId || user?.collegeId || '';
  const studentId = profile?.id || '';

  // refs mirror state for intervals/closures
  const submitLock = useRef(false);
  // Root of the exam surface: the clipboard lockdown scopes its selection and
  // callout suppression to this subtree (falling back to <body> if unset).
  const examRootRef = useRef<HTMLDivElement>(null);
  const answersRef = useRef<Record<string, Partial<StudentAnswer>>>({});
  const proctorEventsRef = useRef<BasicProctorEvent[]>([]);
  const timeRemainingRef = useRef(0);
  const activeTestRef = useRef<ActiveTest | null>(null);
  // Autosave state: answers changed since the last server ack, proctor events
  // not yet flushed, and the in-flight save (concurrent triggers must not stack).
  const dirtyRef = useRef(false);
  const pendingDeltaRef = useRef<Record<string, Partial<StudentAnswer>>>({});
  const pendingProctorRef = useRef<BasicProctorEvent[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingPromiseRef = useRef<Promise<void> | null>(null);
  const submittedRef = useRef(false);
  const runAutosaveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const scheduleDebouncedAutosaveRef = useRef<() => void>(() => {});
  // Tab-switch accounting: count kept in a ref so the visibility handler can
  // act on the limit synchronously (auto-submit) without waiting on state.
  const tabSwitchCountRef = useRef(0);
  // Blur events are coalesced: each blur only bumps a counter (no write); the
  // count is flushed as ONE window_blur event on the next tab_switch or the
  // periodic tick. This is what removed the blur-storm writes/reads.
  const blurCountRef = useRef(0);

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { timeRemainingRef.current = timeRemaining; }, [timeRemaining]);
  useEffect(() => { activeTestRef.current = activeTest; }, [activeTest]);
  useEffect(() => { submittedRef.current = submitted; }, [submitted]);

  /* ─── load ─── */
  useEffect(() => {
    if (!testId || !collegeId || !studentId) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const test = await fetchActiveTest(collegeId, testId, studentId);
        if (cancelled) return;
        if (!test) {
          setLoadError('This test is not available. It may have been removed.');
          setLoading(false);
          return;
        }
        if (test.studentStatus === 'submitted' || test.studentStatus === 'graded') {
          navigate(`/student/test/${testId}/result`, { replace: true });
          return;
        }
        if (test.studentStatus === 'not_started') {
          // Must go through the instructions page so the row transitions correctly
          navigate(`/student/test/${testId}/instructions`, { replace: true });
          return;
        }
        if (test.questions.length === 0) {
          setActiveTest(test);
          setLoadError('This test has no questions yet. Please contact your faculty.');
          setLoading(false);
          return;
        }
        // in_progress → resume with restored answers + remaining time from startedAt
        const remaining = Math.max(0, Math.floor((new Date(test.endsAt).getTime() - Date.now()) / 1000));
        setActiveTest(test);
        const displayOrder = buildDisplayQuestions(test, studentId);
        setDisplayQuestions(displayOrder);
        setAnswers(test.answers || {});
        answersRef.current = test.answers || {};
        // Which sections already owe nothing: the one the paper opens on (the
        // student is standing in it, they did not cross into it), plus any
        // section with saved work — so a reload never bills 30 seconds for
        // material the student has already met.
        const entered = enteredSectionsFromAnswers(test.questions, test.answers);
        entered.add(sectionKeyOf(displayOrder[0]));
        enteredSectionsRef.current = entered;
        setTimeRemaining(remaining);
        timeRemainingRef.current = remaining;
        setCurrentQIndex(0);
        tabSwitchCountRef.current = 0;
        setTabSwitchCount(0);
        blurCountRef.current = 0;
        setLoading(false);
        if (remaining <= 0) void doSubmit(true);
      } catch {
        if (!cancelled) {
          setLoadError('Could not load this test.');
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, collegeId, studentId]);

  /* ─── proctoring: buffer + batched flush (high-severity types log direct) ─── */
  const recordProctorEvent = useCallback(
    (type: BasicProctorEvent['type'], details?: Record<string, unknown>) => {
      const event: BasicProctorEvent = { type, at: new Date().toISOString(), details };
      proctorEventsRef.current = [...proctorEventsRef.current.slice(-199), event];
      const t = activeTestRef.current;
      if (!t?.enableProctoring || !t.studentAssessmentId) return;
      if (DIRECT_LOG_PROCTOR_TYPES.has(type)) {
        // best-effort immediate log for the faculty live view
        void logProctorEvent(t.collegeId, t.testId, t.studentAssessmentId, studentId, event).catch(() => undefined);
      } else {
        // batched: flushed with the next autosave (one doc, not one per event)
        pendingProctorRef.current = [...pendingProctorRef.current.slice(-199), event];
        scheduleDebouncedAutosaveRef.current();
      }
    },
    [studentId]
  );

  /* ─── submit ─── */
  const doSubmit = useCallback(
    async (auto = false) => {
      const t = activeTestRef.current;
      if (!t || submitLock.current || !studentId) return;
      submitLock.current = true;
      setSubmitting(true);
      if (auto) recordProctorEvent('auto_submit', { remaining: 0 });

      const durationSec = (t.duration || 0) * 60;
      const timeSpent = Math.max(0, durationSec - timeRemainingRef.current);

      try {
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
        await submitStudentAssessment({
          collegeId: t.collegeId,
          testId: t.testId,
          student: {
            id: studentId,
            name: profile?.name || user?.name || '',
            regNo: profile?.regNo || '',
          },
          studentAssessmentId: t.studentAssessmentId,
          answers: answersRef.current,
          timeSpent,
          proctorEvents: proctorEventsRef.current,
          autoSubmitted: auto,
        });
        // Submit carries the full answer set: drop the pending delta/events so
        // the unmount flush can't replay them against a closed attempt.
        pendingDeltaRef.current = {};
        pendingProctorRef.current = [];
        dirtyRef.current = false;
        setSubmitted(true);
        setShowSubmitConfirm(false);
        setTimeout(() => navigate(`/student/test/${t.testId}/result`, { replace: true }), 1200);
      } catch (err) {
        submitLock.current = false;
        setSubmitting(false);
        setLoadError(err instanceof Error ? err.message : 'Failed to submit. Please try again.');
      }
    },
    [navigate, profile, recordProctorEvent, studentId, user]
  );

  /* ─── timer ─── */
  useEffect(() => {
    if (!activeTest || submitted) return;
    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          void doSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [activeTest, submitted, doSubmit]);

  /* ─── 30-second gap between exam sections ─── */
  useEffect(() => {
    if (!sectionTransition || submitted) return;
    if (transitionRemaining <= 0) {
      // The break has been paid for; from now on this section is open both ways.
      enteredSectionsRef.current.add(sectionTransition.sectionKey);
      setCurrentQIndex(sectionTransition.targetIndex);
      setSectionTransition(null);
      return;
    }
    const id = setTimeout(() => setTransitionRemaining((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [sectionTransition, transitionRemaining, submitted]);

  /* ─── autosave: dirty flag + delta + 3 s debounce + 60 s safety tick ─── */
  const runAutosave = useCallback(async () => {
    const t = activeTestRef.current;
    if (!t || !t.studentAssessmentId || submitted || submitLock.current) return;
    // Clean: nothing changed since the last ack — no call, no reads.
    if (Object.keys(pendingDeltaRef.current).length === 0 && pendingProctorRef.current.length === 0) return;
    if (savingPromiseRef.current) return; // in flight: pending stays, next trigger retries
    const delta = { ...pendingDeltaRef.current };
    const events = pendingProctorRef.current.slice();
    const promise = autosaveDelta(t.studentAssessmentId, delta, events)
      .then(() => {
        pendingDeltaRef.current = {};
        pendingProctorRef.current = [];
        dirtyRef.current = false;
        setLastSavedAt(new Date());
      })
      .catch(() => {
        // Pending answers/events are kept and retried on the next trigger.
        recordProctorEvent('autosave_error');
      })
      .finally(() => { savingPromiseRef.current = null; });
    savingPromiseRef.current = promise;
    await promise;
  }, [submitted, recordProctorEvent]);

  useEffect(() => { runAutosaveRef.current = runAutosave; });

  const scheduleDebouncedAutosave = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => { void runAutosaveRef.current(); }, AUTOSAVE_DEBOUNCE_MS);
  }, []);

  useEffect(() => { scheduleDebouncedAutosaveRef.current = scheduleDebouncedAutosave; });

  // Final flush for pagehide / tab hidden: waits for any in-flight save, then
  // sends what is still pending so a backgrounded/closed tab loses no answers.
  const flushNow = useCallback(async () => {
    const inFlight = savingPromiseRef.current;
    if (inFlight) {
      try { await inFlight; } catch { /* failure keeps the data pending */ }
    }
    await runAutosave();
  }, [runAutosave]);

  useEffect(() => {
    if (!activeTest || submitted) return;
    const tick = () => {
      // Flush any coalesced blurs as ONE event (instead of one write each).
      if (blurCountRef.current > 0) {
        const count = blurCountRef.current;
        blurCountRef.current = 0;
        recordProctorEvent('window_blur', { count });
      }
      void runAutosave();
    };
    const id = setInterval(tick, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [activeTest, submitted, runAutosave, recordProctorEvent]);

  // Closing the tab / refreshing mid-test: warn the student so a test in
  // progress is never silently abandoned (their answers autosave either way).
  useEffect(() => {
    if (!activeTest || submitted) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeTest, submitted]);

  useEffect(() => {
    if (!activeTest || submitted) return;
    const onPageHide = () => { void flushNow(); };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [activeTest, submitted, flushNow]);

  // In-app navigation never fires pagehide, but the document (and its network
  // connection) survives: a fire-and-forget flush usually lands in time.
  useEffect(() => {
    return () => {
      const t = activeTestRef.current;
      if (
        t?.studentAssessmentId
        && !submittedRef.current
        && !submitLock.current
        && (Object.keys(pendingDeltaRef.current).length > 0 || pendingProctorRef.current.length > 0)
      ) {
        void autosaveDelta(t.studentAssessmentId, { ...pendingDeltaRef.current }, pendingProctorRef.current.slice())
          .catch(() => undefined);
      }
    };
  }, []);

  /* ─── proctoring listeners (mounted while a test is active) ─── */
  useEffect(() => {
    if (!activeTest || submitted) return;
    const proctored = !!activeTest.enableProctoring;

    const warn = (msg: string) => {
      setProctorWarning(msg);
      setTimeout(() => setProctorWarning(null), 4000);
    };

    const onVisibility = () => {
      if (document.hidden) {
        tabSwitchCountRef.current += 1;
        setTabSwitchCount(tabSwitchCountRef.current);
        // Coalesce the blur storm: fold all blurs since the last switch into
        // this one event instead of writing a proctor row per blur.
        const blurs = blurCountRef.current;
        blurCountRef.current = 0;
        recordProctorEvent('tab_switch', { hidden: true, blursSinceLast: blurs });
        // The browser may suspend this tab shortly: flush pending answers +
        // the tab_switch event before that can happen.
        void flushNow();

        const limit = activeTestRef.current?.maxTabSwitches || 0;
        if (limit > 0) {
          if (tabSwitchCountRef.current >= limit) {
            recordProctorEvent('tab_limit_exceeded', { limit, count: tabSwitchCountRef.current });
            void flushNow();
            // Enforce the limit the faculty set at scheduling time.
            void doSubmit(true);
          } else if (tabSwitchCountRef.current === limit - 1) {
            recordProctorEvent('tab_limit_warning', { limit, count: tabSwitchCountRef.current });
            setShowTabLimitWarning(true);
          }
        } else if (proctored) {
          warn('Tab switch detected and logged. Stay on the test window.');
        }
      }
    };
    const onBlur = () => {
      // Count only — no event, no autosave per blur (cost fix). The count is
      // flushed as part of the next tab_switch or the periodic tick below.
      blurCountRef.current += 1;
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && proctored && !submitLock.current) {
        recordProctorEvent('fullscreen_exit');
        warn('You exited fullscreen. Re-enter to continue.');
      }
    };
    // Clipboard lockdown: enforced for EVERY test, proctored or not. The old
    // gate on `enableProctoring` left unproctored papers wide open to pasted
    // answers, and bubble-phase `paste` listeners never covered the mobile
    // paths (long-press Paste, keyboard clipboard chip, drag-and-drop).
    // See src/shared/utils/examLockdown.ts.
    const disposeLockdown = applyExamLockdown({
      root: examRootRef.current,
      onBlock: (reason, details) => {
        recordProctorEvent(reason, details);
        warn(BLOCK_MESSAGES[reason] ?? 'That action is disabled during this test.');
      },
    });

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      disposeLockdown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTest, submitted, recordProctorEvent, flushNow, doSubmit]);

  /* ─── helpers ─── */
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleAnswer = (questionId: string, answer: Partial<StudentAnswer>) => {
    setAnswers((prev) => {
      const merged = {
        ...prev[questionId],
        ...answer,
        questionId,
        visitedAt: prev[questionId]?.visitedAt || new Date().toISOString(),
        answeredAt: new Date().toISOString(),
      };
      // Track the change so the next autosave sends only this delta.
      pendingDeltaRef.current = { ...pendingDeltaRef.current, [questionId]: merged };
      dirtyRef.current = true;
      return { ...prev, [questionId]: merged };
    });
    scheduleDebouncedAutosave();
  };

  const toggleFlag = (questionId: string) => {
    setAnswers((prev) => {
      const merged = {
        ...prev[questionId],
        questionId,
        isFlagged: !prev[questionId]?.isFlagged,
        visitedAt: prev[questionId]?.visitedAt || new Date().toISOString(),
      };
      pendingDeltaRef.current = { ...pendingDeltaRef.current, [questionId]: merged };
      dirtyRef.current = true;
      return { ...prev, [questionId]: merged };
    });
    scheduleDebouncedAutosave();
  };

  const enterTest = async () => {
    const t = activeTestRef.current;
    setShowEnterGate(false);
    // Fullscreen for every test (not just proctored) — this is the exam
    // surface. The click on "Begin Test" is the user gesture the browser
    // requires for requestFullscreen.
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        if (t?.enableProctoring) recordProctorEvent('fullscreen_denied');
        else {
          setProctorWarning('Fullscreen was blocked by the browser. Use the browser\'s fullscreen button for the intended exam experience.');
          setTimeout(() => setProctorWarning(null), 8000);
        }
      }
    }
  };

  /* ─── render ─── */
  if (loading) {
    return (
      <Box sx={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <CircularProgress />
        <Typography color="text.secondary">Loading test…</Typography>
      </Box>
    );
  }

  if (loadError || !activeTest) {
    return (
      <Box sx={{ p: 4, maxWidth: 600, mx: 'auto' }}>
        <Alert severity="warning" sx={{ mb: 2 }}>{loadError || 'Test not found'}</Alert>
        <Button variant="outlined" onClick={() => navigate('/student/assessments')}>Back to Assessments</Button>
      </Box>
    );
  }

  if (submitted) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center', p: 4, borderRadius: 3 }}>
          <Send color="success" sx={{ fontSize: 64, mb: 2 }} />
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>Test Submitted!</Typography>
          <Typography variant="body1" color="text.secondary">Redirecting to results…</Typography>
          <LinearProgress sx={{ mt: 3 }} />
        </Card>
      </Box>
    );
  }

  // Display order (seeded shuffle) — answers are keyed by question id, so the
  // saved answers map onto the display list 1:1 and resume is stable.
  const questions = displayQuestions && displayQuestions.length > 0 ? displayQuestions : activeTest.questions;
  if (questions.length === 0) {
    return (
      <Box sx={{ p: 4, maxWidth: 600, mx: 'auto' }}>
        <Alert severity="info">This test has no questions yet.</Alert>
        <Button sx={{ mt: 2 }} variant="outlined" onClick={() => navigate('/student/assessments')}>Back</Button>
      </Box>
    );
  }

  const isAnswered = (qid: string) => {
    const a = answers[qid];
    if (!a) return false;
    return !!(a.selectedOptionId || a.selectedOptionIds?.length || (a.textAnswer && a.textAnswer.trim()) || a.numericalAnswer !== undefined);
  };
  const currentQ = questions[currentQIndex];
  const answeredCount = questions.filter((q) => isAnswered(q.id)).length;
  const flaggedCount = questions.filter((q) => answers[q.id]?.isFlagged).length;
  const unansweredCount = questions.length - answeredCount;
  const isLast = currentQIndex === questions.length - 1;
  const progress = ((currentQIndex + 1) / questions.length) * 100;

  // Section view of the display list: contiguous groups sharing a sectionId.
  // Drives the header chip, the grouped palette, and the "Next section" button.
  const sections: Array<{ key: string; name: string; indices: number[]; answered: number }> = [];
  {
    const byKey = new Map<string, number>();
    questions.forEach((q, i) => {
      const key = q.sectionId || 'sec-0';
      if (!byKey.has(key)) {
        byKey.set(key, sections.length);
        sections.push({ key, name: q.sectionName || `Section ${sections.length + 1}`, indices: [], answered: 0 });
      }
      const g = sections[byKey.get(key)!];
      g.indices.push(i);
      if (isAnswered(q.id)) g.answered += 1;
    });
  }
  const currentSection = sections.find((g) => g.indices.includes(currentQIndex));
  const positionInSection = currentSection ? currentSection.indices.indexOf(currentQIndex) + 1 : 0;
  const isLastInSection = !!currentSection && currentQIndex === currentSection.indices[currentSection.indices.length - 1];
  const maxTabSwitches = activeTest.maxTabSwitches || 0;

  // Section-aware navigation: within a section, and back into one the student
  // has already been inside, is instant. Only a section they have not met yet
  // owes the 30-second gap screen before its first question.
  const navigateToIndex = (idx: number) => {
    if (idx < 0 || idx >= questions.length || idx === currentQIndex) return;
    if (sectionTransition) return;
    const targetKey = sectionKeyOf(questions[idx]);
    if (!shouldPlaySectionBreak({ targetKey, currentKey: sectionKeyOf(currentQ), enteredKeys: enteredSectionsRef.current })) {
      enteredSectionsRef.current.add(targetKey);
      setCurrentQIndex(idx);
      return;
    }
    const targetSection = sections.find((g) => g.indices.includes(idx));
    setTransitionRemaining(SECTION_BREAK_SECONDS);
    setSectionTransition({ targetIndex: idx, sectionName: targetSection?.name || 'Next section', sectionKey: targetKey });
  };

  // Palette body shared by the desktop sidebar card and the phone bottom sheet.
  const paletteContent = (
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Question Palette</Typography>
              <Box sx={{ mb: 3 }}>
                {sections.map((sec) => (
                  <Box key={sec.key} sx={{ mb: 1.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary' }}>
                      {sec.name} · {sec.answered}/{sec.indices.length}
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
                      {sec.indices.map((idx) => {
                        const q = questions[idx];
                        const answered = isAnswered(q.id);
                        const flagged = !!answers[q.id]?.isFlagged;
                        const isCurrent = idx === currentQIndex;
                        return (
                          <Button key={q.id} onClick={() => { navigateToIndex(idx); setPaletteOpen(false); }} sx={{
                            minWidth: 44, height: 44, borderRadius: 2, fontWeight: 700,
                            border: isCurrent ? 2 : 1, borderColor: isCurrent ? 'primary.main' : 'divider',
                            bgcolor: answered ? 'success.main' : flagged ? 'warning.light' : 'grey.100',
                            color: answered ? 'white' : 'text.primary',
                            '&:hover': { bgcolor: answered ? 'success.dark' : 'primary.100' },
                          }}>{idx + 1}</Button>
                        );
                      })}
                    </Box>
                  </Box>
                ))}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <LegendItem color="success.main" label="Answered" />
                <LegendItem color="warning.light" label="Flagged" />
                <LegendItem color="grey.100" label="Not visited" />
                <LegendItem color="primary.main" label="Current" outline />
              </Box>
              <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Summary</Typography>
                <Typography variant="caption" color="text.secondary">
                  {answeredCount} answered • {unansweredCount} unanswered • {flaggedCount} flagged
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  Answers are saved automatically
                </Typography>
              </Box>
            </CardContent>
  );

  if (showEnterGate) {
    return (
      <Box sx={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Card sx={{ maxWidth: 520, width: '100%', textAlign: 'center', p: 4, borderRadius: 3 }}>
          <Fullscreen color="primary" sx={{ fontSize: 56, mb: 1 }} />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
            {activeTest.resumed ? 'Resume your test' : 'Ready to begin'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            <MathRenderer text={activeTest.title} inline /> · {questions.length} questions ·{' '}
            {formatTime(timeRemaining)} remaining
          </Typography>
          {activeTest.enableProctoring ? (
            <Alert severity="warning" sx={{ textAlign: 'left', mb: 2 }} icon={<Security />}>
              Proctoring active: the test opens in fullscreen. Tab switches, clipboard use and
              shortcut keys are logged.
            </Alert>
          ) : (
            <Alert severity="info" sx={{ textAlign: 'left', mb: 2 }} icon={<Security />}>
              Copy, paste, drag-and-drop and the long-press menu are switched off while you answer.
              Type every answer yourself — pasted text is rejected.
            </Alert>
          )}
          {timeRemaining <= 300 && (
            <Alert severity="error" sx={{ mb: 2 }}>Hurry — less than 5 minutes left!</Alert>
          )}
          <Button variant="contained" color="success" size="large" startIcon={<PlayArrow />} onClick={enterTest} sx={{ px: 5, py: 1.5, fontWeight: 700 }}>
            {activeTest.resumed ? 'Re-enter Test' : 'Enter Test'}
          </Button>
        </Card>
      </Box>
    );
  }

  return (
    <Box ref={examRootRef} sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <Paper elevation={2} sx={{ position: 'sticky', top: 0, zIndex: 50, px: { xs: 1.5, md: 4 }, py: { xs: 1, md: 2 }, pt: { xs: 'calc(8px + env(safe-area-inset-top))', md: 2 }, display: 'flex', flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'space-between', gap: { xs: 1, md: 2 }, borderRadius: 0 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: '0.95rem', md: '1.25rem' } }} noWrap>{activeTest.title}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            Q {currentQIndex + 1}/{questions.length}
            {currentSection ? ` · ${currentSection.name} (${positionInSection}/${currentSection.indices.length})` : ''}
            {lastSavedAt && ` · saved ${lastSavedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, md: 2 }, flexShrink: 0 }}>
          {/* Tab switching is still counted, still logged for the faculty live
              view and still auto-submits at `maxTabSwitches` — but the running
              tally is not shown here. A visible counter is a second scoreboard
              the student cannot do anything about, and it advertises that
              leaving the tab is being scored rather than noticed. The alert on
              the switch itself and the at-limit dialog stay: those tell the
              student something they can act on. */}
          <Chip icon={<Timer />} label={formatTime(timeRemaining)} color={timeRemaining < 300 ? 'error' : 'primary'} sx={{ fontWeight: 700, fontSize: { xs: '0.9rem', md: '1rem' }, px: { xs: 0, md: 1 }, fontVariantNumeric: 'tabular-nums' }} />
          {!isMobile && (
            <Button variant="contained" color="success" startIcon={<Send />} onClick={() => setShowSubmitConfirm(true)} disabled={submitting}>Submit</Button>
          )}
        </Box>
      </Paper>

      {proctorWarning && (
        <Alert severity="error" sx={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 2000, boxShadow: 6, maxWidth: '90vw' }}>
          {proctorWarning}
        </Alert>
      )}

      <Box sx={{ maxWidth: 1200, mx: 'auto', p: { xs: 1.5, md: 4 }, pb: { xs: 'calc(96px + env(safe-area-inset-bottom))', md: 4 }, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 600px', minWidth: 0 }}>
          {sectionTransition ? (
            <Card sx={{ borderRadius: 3, mb: 3 }}>
              <CardContent sx={{ p: { xs: 3, md: 8 }, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: { md: 320 } }}>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {sectionTransition.sectionName}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Section break — your next section starts in
                </Typography>
                <Typography variant="h1" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'primary.main', lineHeight: 1 }}>
                  {formatTime(transitionRemaining)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 3 }}>
                  The test timer keeps running during the break.
                </Typography>
              </CardContent>
            </Card>
          ) : (
          <Card sx={{ borderRadius: 3, mb: 3 }}>
            <CardContent sx={{ p: { xs: 2, md: 4 } }}>
              <QuestionRenderer
                question={currentQ}
                answer={answers[currentQ.id]}
                onAnswer={(ans) => handleAnswer(currentQ.id, ans)}
                isFlagged={!!answers[currentQ.id]?.isFlagged}
                onToggleFlag={() => toggleFlag(currentQ.id)}
                questionNumber={currentQIndex + 1}
                lockClipboard
                testId={activeTest.testId}
              />

              {!isMobile && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
                  <Button variant="outlined" startIcon={<NavigateBefore />} disabled={currentQIndex === 0 || !!sectionTransition} onClick={() => navigateToIndex(currentQIndex - 1)}>Previous</Button>
                  {isLast ? (
                    <Button variant="contained" color="success" endIcon={<Send />} onClick={() => setShowSubmitConfirm(true)}>Finish &amp; Submit</Button>
                  ) : (
                    <Button variant="contained" endIcon={<NavigateNext />} disabled={!!sectionTransition} onClick={() => navigateToIndex(currentQIndex + 1)}>{isLastInSection ? 'Next Section' : 'Next'}</Button>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
          )}

          <Box sx={{ px: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="caption" color="text.secondary">Progress</Typography>
              <Typography variant="caption" color="text.secondary">{Math.round(progress)}%</Typography>
            </Box>
            <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 4 }} />
          </Box>
        </Box>

        {isMobile ? (
          <Drawer
            anchor="bottom"
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '75vh', pb: 'env(safe-area-inset-bottom)' } } }}
          >
            <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'grey.300', mx: 'auto', mt: 1 }} />
            {paletteContent}
          </Drawer>
        ) : (
        <Box sx={{ flex: '0 0 280px' }}>
          <Card sx={{ borderRadius: 3, position: 'sticky', top: 100 }}>
            {paletteContent}
          </Card>
        </Box>
        )}
      </Box>

      {/* Mobile: thumb-reachable Prev / Palette / Next / Submit bar */}
      {isMobile && (
        <Paper elevation={8} sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, px: 1.5, py: 1, pb: 'calc(8px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center', gap: 1, borderRadius: 0 }}>
          <Button variant="outlined" sx={{ minWidth: 0, px: 1.5, minHeight: 44 }} disabled={currentQIndex === 0 || !!sectionTransition} onClick={() => navigateToIndex(currentQIndex - 1)} aria-label="Previous question"><NavigateBefore /></Button>
          <Button variant="outlined" startIcon={<GridView />} sx={{ flex: 1, minHeight: 44 }} onClick={() => setPaletteOpen(true)}>
            {answeredCount}/{questions.length}
          </Button>
          {isLast ? (
            <Button variant="contained" color="success" endIcon={<Send />} sx={{ flex: 1, minHeight: 44 }} onClick={() => setShowSubmitConfirm(true)} disabled={submitting}>Submit</Button>
          ) : (
            <>
              <Button variant="contained" sx={{ minWidth: 0, px: 1.5, minHeight: 44 }} disabled={!!sectionTransition} onClick={() => navigateToIndex(currentQIndex + 1)} aria-label="Next question"><NavigateNext /></Button>
              <Button variant="contained" color="success" sx={{ minWidth: 0, px: 1.5, minHeight: 44 }} onClick={() => setShowSubmitConfirm(true)} disabled={submitting} aria-label="Submit test"><Send fontSize="small" /></Button>
            </>
          )}
        </Paper>
      )}


      <Dialog open={showSubmitConfirm} onClose={() => setShowSubmitConfirm(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Warning color="warning" />Submit Test?</DialogTitle>
        <DialogContent>
          {unansweredCount > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              You have <strong>{unansweredCount}</strong> unanswered question{unansweredCount > 1 ? 's' : ''}. Are you sure you want to submit?
            </Alert>
          )}
          <Typography variant="body1">Once submitted, you cannot change your answers. The test will be finalized.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSubmitConfirm(false)} variant="outlined">Continue Test</Button>
          <Button onClick={() => void doSubmit(false)} variant="contained" color="success" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Yes, Submit'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showTabLimitWarning} onClose={() => setShowTabLimitWarning(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Warning color="error" />Tab Switch Limit</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>
            You have used {tabSwitchCount} of {maxTabSwitches} allowed tab switch{maxTabSwitches > 1 ? 'es' : ''}.
          </Alert>
          <Typography variant="body1">
            Switching to another tab one more time will <strong>automatically submit</strong> your test. Stay focused to continue.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowTabLimitWarning(false)} variant="contained" color="primary">Stay in Test</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

const LegendItem: React.FC<{ color: string; label: string; outline?: boolean }> = ({ color, label, outline }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
    <Box sx={{ width: 20, height: 20, borderRadius: 1, bgcolor: color, border: outline ? 2 : 0, borderColor: 'primary.main' }} />
    <Typography variant="caption" color="text.secondary">{label}</Typography>
  </Box>
);

export default ActiveTestPage;
