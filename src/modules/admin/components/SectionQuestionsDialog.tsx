// src/modules/admin/components/SectionQuestionsDialog.tsx
// ─── Add / remove questions for one section of a Create Test template ────────
//
// Two doors (docs/ASSESSMENT_CREATE_TEST_FLOW.md §5):
//   1. From the question bank — one bounded page at a time, filtered to the
//      section's type. Ticked questions are copied into the section as snapshots.
//   2. Write a new question — MCQ or numerical. It is saved to the bank by default
//      so it can be reused, and then copied into the section.
//
// The parent owns the template and persists each change (onChange returns a
// promise; a rejection is shown here and the parent reverts).

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import {
  appendSectionQuestion,
  bankQuestionFits,
  emptyWrittenDraft,
  removeSectionQuestion,
  sectionHasQuestion,
  sectionSupportsWrittenQuestions,
  snapshotFromBankQuestion,
  validateWrittenQuestion,
  writtenQuestionPayload,
  type WrittenQuestionDraft,
  type BankQuestionLike,
} from '@/shared/utils/testQuestions';
import { TEST_SECTION_TYPE_LABELS, type TestSection } from '@/shared/types/testTemplate';
import { getQuestions, createQuestion } from '../api/questionBankApi';
import type { Question, QuestionType } from '../types/questionBank';

const BANK_PAGE_SIZE = 50;

interface Props {
  open: boolean;
  section: TestSection | null;
  collegeId: string;
  author: { uid: string; name: string };
  /** Subject of the test, used as the default subject for new bank questions. */
  testSubject?: string;
  onClose: () => void;
  /** Persists the updated section. Reject to show the error here. */
  onChange: (next: TestSection) => Promise<void>;
}

export default function SectionQuestionsDialog({
  open, section, collegeId, author, testSubject, onClose, onChange,
}: Props) {
  const [tab, setTab] = useState<'bank' | 'write'>('bank');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bank state
  const [bank, setBank] = useState<Question[]>([]);
  const [cursor, setCursor] = useState<unknown>(null);
  const [hasMore, setHasMore] = useState(false);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankLoaded, setBankLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Written-question state
  const [draft, setDraft] = useState<WrittenQuestionDraft | null>(null);
  const [saveToBank, setSaveToBank] = useState(true);
  const [subjectForBank, setSubjectForBank] = useState('');

  const sectionType = section?.type ?? 'mcq';
  const canWrite = section ? sectionSupportsWrittenQuestions(section.type) : false;

  // Reset when the dialog opens for a section.
  useEffect(() => {
    if (!open || !section) return;
    setError(null);
    setPicked(new Set());
    setTab('bank');
    setBank([]);
    setCursor(null);
    setHasMore(false);
    setBankLoaded(false);
    setDraft(section ? emptyWrittenDraft(section) : null);
    setSubjectForBank(testSubject ?? '');
    // Only when the dialog opens or switches section; not on every section edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, section?.id]);

  const loadBank = useCallback(async (after: unknown) => {
    if (!collegeId) return;
    setBankLoading(true);
    setError(null);
    try {
      const page = await getQuestions(collegeId, {}, BANK_PAGE_SIZE, after ?? undefined);
      setBank((prev) => (after ? [...prev, ...page.data] : page.data));
      setCursor(page.lastDoc ?? null);
      setHasMore(Boolean(page.hasMore));
      setBankLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the question bank.');
    } finally {
      setBankLoading(false);
    }
  }, [collegeId]);

  // First page when the bank tab is shown.
  useEffect(() => {
    if (open && tab === 'bank' && !bankLoaded && !bankLoading) void loadBank(null);
  }, [open, tab, bankLoaded, bankLoading, loadBank]);

  const fitting = useMemo(() => {
    if (!section) return [];
    const term = search.trim().toLowerCase();
    return bank.filter((q) => {
      if (!bankQuestionFits(section, q as unknown as BankQuestionLike)) return false;
      if (sectionHasQuestion(section, q.id)) return false;
      if (!term) return true;
      return [q.text, q.topic, q.subject, q.chapter].some((v) => (v || '').toLowerCase().includes(term));
    });
  }, [bank, search, section]);

  if (!section) return null;

  const persist = async (next: TestSection) => {
    setBusy(true);
    setError(null);
    try {
      await onChange(next);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the section.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addPicked = async () => {
    let next: TestSection = section;
    const chosen = bank.filter((q) => picked.has(q.id));
    for (const q of chosen) {
      next = appendSectionQuestion(next, snapshotFromBankQuestion(next, q as unknown as BankQuestionLike, (next.questions?.length ?? 0) + 1));
    }
    if (chosen.length === 0) return;
    if (await persist(next)) setPicked(new Set());
  };

  const removeOne = async (questionId: string) => {
    await persist(removeSectionQuestion(section, questionId));
  };

  const saveWritten = async () => {
    if (!draft) return;
    const problems = validateWrittenQuestion(section, draft);
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true);
    setError(null);
    try {
      const payload = writtenQuestionPayload(section, draft);
      let questionId: string;
      if (saveToBank) {
        const subject = subjectForBank.trim() || testSubject?.trim() || 'General';
        const saved = await createQuestion(collegeId, {
          ...payload,
          type: payload.type as QuestionType,
          subject,
          status: 'active',
          createdBy: author.uid,
          createdByName: author.name,
        } as Parameters<typeof createQuestion>[1]);
        questionId = saved.id;
      } else {
        questionId = `test-${section.id}-${Date.now().toString(36)}`;
      }
      const snap = snapshotFromBankQuestion(section, { ...payload, id: questionId } as BankQuestionLike, (section.questions?.length ?? 0) + 1);
      const next = appendSectionQuestion(section, snap);
      await onChange(next);
      setDraft(emptyWrittenDraft(section));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the question.');
    } finally {
      setBusy(false);
    }
  };

  const setOption = (i: number, patch: Partial<{ text: string; isCorrect: boolean }>) => {
    if (!draft) return;
    const options = draft.options.map((o, idx) => {
      if (idx === i) return { ...o, ...patch };
      // One correct answer: picking a new one clears the rest.
      if (patch.isCorrect && section.type === 'mcq') return { ...o, isCorrect: false };
      return o;
    });
    setDraft({ ...draft, options });
  };

  const addOption = () => {
    if (!draft || draft.options.length >= 6) return;
    setDraft({ ...draft, options: [...draft.options, { text: '', isCorrect: false }] });
  };

  const removeOption = (i: number) => {
    if (!draft || draft.options.length <= 2) return;
    setDraft({ ...draft, options: draft.options.filter((_, idx) => idx !== i) });
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>
        {section.name || 'Section'} — questions
        <Typography variant="body2" color="text.secondary">
          {TEST_SECTION_TYPE_LABELS[sectionType]} · {section.questions?.length ?? 0} added · {section.defaultCorrectMarks} marks each
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>In this section</Typography>
        {(section.questions?.length ?? 0) === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No questions yet. Add some from the bank or write one below.
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mb: 2 }}>
            {section.questions.map((q) => (
              <Stack key={q.questionId} direction="row" spacing={1} sx={{ alignItems: 'center', p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Chip size="small" label={`Q${q.order}`} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap title={q.text}>
                  {q.text || 'Untitled question'}
                </Typography>
                <Chip size="small" variant="outlined" label={`${section.defaultCorrectMarks} marks`} />
                {section.defaultPenalty > 0 && <Chip size="small" variant="outlined" label={`−${section.defaultPenalty}`} />}
                <Tooltip title="Remove from this section">
                  <span>
                    <IconButton size="small" color="error" disabled={busy} onClick={() => removeOne(q.questionId)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        )}

        <Divider sx={{ mb: 2 }} />

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab value="bank" label="From question bank" />
          <Tab value="write" label="Write a question" disabled={!canWrite} />
        </Tabs>

        {tab === 'bank' && (
          <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5, alignItems: { sm: 'center' } }}>
              <TextField
                size="small"
                label="Search loaded questions"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                sx={{ flex: 1 }}
              />
              <Typography variant="caption" color="text.secondary">
                Showing {fitting.length} that fit this section
              </Typography>
            </Stack>

            {fitting.length === 0 && bankLoaded && !bankLoading && (
              <Alert severity="info" sx={{ mb: 1 }}>
                {bank.length === 0
                  ? 'The question bank is empty for this college. Write a question here, or add questions in Question Bank first.'
                  : `No ${TEST_SECTION_TYPE_LABELS[sectionType].toLowerCase()} questions in the loaded page. Load more, or write one.`}
              </Alert>
            )}

            <Stack spacing={0.5} sx={{ maxHeight: 340, overflowY: 'auto', mb: 1 }}>
              {fitting.map((q) => (
                <FormControlLabel
                  key={q.id}
                  sx={{ alignItems: 'flex-start', m: 0, p: 1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                  control={
                    <Checkbox
                      size="small"
                      checked={picked.has(q.id)}
                      onChange={(e) => setPicked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(q.id); else next.delete(q.id);
                        return next;
                      })}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{q.text}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {[q.subject, q.topic, q.difficulty, `${section.defaultCorrectMarks} marks`].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                  }
                />
              ))}
            </Stack>

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
              <Button size="small" disabled={!hasMore || bankLoading} onClick={() => loadBank(cursor)}>
                {bankLoading ? 'Loading…' : hasMore ? 'Load more from the bank' : 'No more questions in the bank'}
              </Button>
              <Button variant="contained" disabled={picked.size === 0 || busy} onClick={addPicked}>
                Add {picked.size || ''} selected
              </Button>
            </Stack>
          </Box>
        )}

        {tab === 'write' && draft && canWrite && (
          <Stack spacing={2}>
            <TextField
              label="Question"
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              multiline
              minRows={2}
              fullWidth
            />

            {section.type === 'mcq' && (
              <Box>
                <Typography variant="caption" color="text.secondary">Options — select the one correct answer</Typography>
                <RadioGroup
                  value={String(draft.options.findIndex((o) => o.isCorrect))}
                  onChange={(e) => setOption(Number(e.target.value), { isCorrect: true })}
                >
                  {draft.options.map((o, i) => (
                    <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <FormControlLabel value={String(i)} control={<Radio size="small" />} label="" sx={{ mr: 0 }} />
                      <TextField
                        size="small"
                        fullWidth
                        label={`Option ${String.fromCharCode(65 + i)}`}
                        value={o.text}
                        onChange={(e) => setOption(i, { text: e.target.value })}
                      />
                      <IconButton size="small" disabled={draft.options.length <= 2} onClick={() => removeOption(i)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                </RadioGroup>
                <Button size="small" startIcon={<AddIcon />} disabled={draft.options.length >= 6} onClick={addOption}>
                  Add option
                </Button>
              </Box>
            )}

            {section.type === 'numerical' && (
              <TextField
                label="Correct answer"
                value={draft.numericalAnswer}
                onChange={(e) => setDraft({ ...draft, numericalAnswer: e.target.value })}
                helperText="Typed exactly as the student should enter it, e.g. 9.8"
                fullWidth
              />
            )}

            <Typography variant="caption" color="text.secondary">
              Each question carries {section.defaultCorrectMarks} mark{section.defaultCorrectMarks === 1 ? '' : 's'}
              {section.defaultPenalty > 0 ? ` with −${section.defaultPenalty} for a wrong answer` : ''}, as set on the section.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label="Topic (optional)"
                value={draft.topic}
                onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
                size="small"
                fullWidth
              />
              <TextField
                select
                label="Difficulty"
                value={draft.difficulty}
                onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as WrittenQuestionDraft['difficulty'] })}
                size="small"
                sx={{ minWidth: 130 }}
              >
                <MenuItem value="easy">Easy</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="hard">Hard</MenuItem>
              </TextField>
            </Stack>

            <Box>
              <FormControlLabel
                control={<Checkbox checked={saveToBank} onChange={(e) => setSaveToBank(e.target.checked)} />}
                label="Also save to the question bank so it can be reused"
              />
              {saveToBank && (
                <TextField
                  size="small"
                  label="Subject for the bank"
                  value={subjectForBank}
                  onChange={(e) => setSubjectForBank(e.target.value)}
                  sx={{ mt: 1, minWidth: 260 }}
                  helperText="Used to find this question later in the bank"
                />
              )}
            </Box>

            <Box>
              <Button variant="contained" disabled={busy} onClick={saveWritten}>
                {busy ? 'Saving…' : 'Add question to section'}
              </Button>
            </Box>
          </Stack>
        )}

        {tab === 'write' && !canWrite && (
          <Alert severity="info">
            {TEST_SECTION_TYPE_LABELS[sectionType]} sections take questions from the bank only.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
