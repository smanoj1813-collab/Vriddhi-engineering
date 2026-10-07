// src/shared/components/question-bank/UnifiedQuestionBank.tsx
// ONE question bank for every portal (faculty, HOD, principal/admin).
//
// Replaces the legacy per-role pages that carried the degree-college layout
// (FacultyQuestionBank's All/My/PYQ/Linked tabs, the admin
// QuestionBankManager cards). Everything is engineering-first: questions are
// organised by Branch → Semester → Course → Module, and every row shows its
// Course Outcome (CO), RBT / Bloom level and marks so paper setters can build
// VTU / autonomous OBE papers straight from the bank.
//
// Role behaviour (same screen, different powers):
//   • faculty        → add / upload (goes to HOD review), edit + delete own rows
//   • hod / admin /
//     superadmin /
//     employee       → publish directly, edit + delete any college row,
//                      Review Queue tab
//   • principal      → read-only oversight (+ Review Queue visibility)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  AutoAwesome as AIIcon,
  Clear as ClearIcon,
  CloudUpload as CloudUploadIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Search as SearchIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { useAuth } from '@/modules/auth/context/AuthContext';
import type { Question, QuestionFilters, DifficultyLevel } from '@/modules/admin/types/questionBank';
import {
  createQuestion,
  deleteQuestion,
  getBatchBranchConfig,
  getQuestionStats,
  getQuestions,
  updateQuestion,
} from '@/modules/admin/api/questionBankApi';
import FacultyQuestionForm from '@/modules/admin/components/question-bank/FacultyQuestionForm';
import QuestionPDFExport from '@/modules/admin/components/question-bank/QuestionPDFExport';
import UniversalQuestionBank from '@/modules/admin/components/UniversalQuestionBank';
import ReviewQueue from '@/modules/admin/components/ReviewQueue';
import QuestionUploadEditor from '@/shared/components/question-paper/QuestionUploadEditor';
import { DEFAULT_SUBJECTS } from '@/shared/constants/academicPrograms';

export type UnifiedQuestionBankTab = 'college' | 'universal' | 'review';

const REVIEWER_ROLES = new Set(['hod', 'admin', 'superadmin', 'employee', 'principal']);
const PUBLISHER_ROLES = new Set(['hod', 'admin', 'superadmin', 'employee']);

const RBT_LEVELS = [
  { value: 'L1', label: 'L1 · Remember' },
  { value: 'L2', label: 'L2 · Understand' },
  { value: 'L3', label: 'L3 · Apply' },
  { value: 'L4', label: 'L4 · Analyse' },
  { value: 'L5', label: 'L5 · Evaluate' },
  { value: 'L6', label: 'L6 · Create' },
];
const BLOOM_WORD_TO_LEVEL: Record<string, string> = {
  remember: 'L1', knowledge: 'L1',
  understand: 'L2', comprehension: 'L2',
  apply: 'L3', application: 'L3',
  analyse: 'L4', analyze: 'L4', analysis: 'L4',
  evaluate: 'L5', evaluation: 'L5',
  create: 'L6', synthesis: 'L6',
};
const MODULES = [1, 2, 3, 4, 5];
const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];
const PAGE_SIZE = 50;

type Scope = 'all' | 'mine' | 'pyq';

// ─── Engineering metadata readers (tolerant of legacy field names) ──────────

type LooseQuestion = Question & Record<string, unknown>;

export function questionRbtLevel(q: Question): string {
  const raw = String((q as LooseQuestion).rbtLevel ?? q.bloomLevel ?? '').trim();
  if (!raw) return '';
  const level = raw.toUpperCase().match(/L\s*([1-6])/);
  if (level) return `L${level[1]}`;
  return BLOOM_WORD_TO_LEVEL[raw.toLowerCase()] ?? raw;
}

export function questionCourseOutcome(q: Question): string {
  const loose = q as LooseQuestion;
  const direct = String(loose.co ?? loose.courseOutcome ?? '').trim();
  if (direct) return direct.toUpperCase().startsWith('CO') ? direct.toUpperCase() : `CO${direct}`;
  const fromTags = (q.tags ?? []).find((t) => /^co\s*\d+$/i.test(String(t).trim()));
  if (fromTags) return String(fromTags).replace(/\s+/g, '').toUpperCase();
  const fromOutcomes = (q.learningOutcomes ?? []).find((t) => /^co\s*\d+/i.test(String(t).trim()));
  return fromOutcomes ? String(fromOutcomes).trim().split(/[\s:—-]/)[0].toUpperCase() : '';
}

export function questionModule(q: Question): number | null {
  const loose = q as LooseQuestion;
  const n = Number(q.moduleNo ?? loose.module ?? loose.unitNo ?? 0);
  if (Number.isFinite(n) && n > 0) return n;
  const unit = String(q.unit ?? '').match(/(\d+)/);
  return unit ? Number(unit[1]) : null;
}

export function questionSemester(q: Question): number | null {
  const n = Number((q as LooseQuestion).semester ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function statusChip(status: string) {
  const s = (status || 'active').toLowerCase();
  if (s === 'active' || s === 'approved' || s === 'published') return <Chip size="small" color="success" label="Published" />;
  if (s === 'draft') return <Chip size="small" label="Draft" />;
  if (s.includes('pending') || s.includes('review')) return <Chip size="small" color="warning" label="In review" />;
  if (s === 'rejected') return <Chip size="small" color="error" label="Rejected" />;
  return <Chip size="small" label={status} />;
}

// ─── Page ────────────────────────────────────────────────────────────────────

interface Props {
  initialTab?: UnifiedQuestionBankTab;
}

export default function UnifiedQuestionBank({ initialTab = 'college' }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = String(user?.role || 'faculty');
  const collegeId = user?.collegeId || '';
  const userId = (user as { id?: string; uid?: string } | null)?.id || (user as { uid?: string } | null)?.uid || '';
  const canReview = REVIEWER_ROLES.has(role);
  const canPublish = PUBLISHER_ROLES.has(role);
  const canAuthor = role !== 'principal';
  const portalBase = role === 'faculty' ? '/faculty' : '/admin';

  const tabs: UnifiedQuestionBankTab[] = canReview ? ['college', 'universal', 'review'] : ['college', 'universal'];
  const [tab, setTab] = useState<UnifiedQuestionBankTab>(tabs.includes(initialTab) ? initialTab : 'college');
  useEffect(() => {
    setTab(tabs.includes(initialTab) ? initialTab : 'college');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab, canReview]);

  // Config
  const [branches, setBranches] = useState<string[]>([]);
  const [batches, setBatches] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [configError, setConfigError] = useState('');

  useEffect(() => {
    if (!collegeId) return;
    Promise.all([getBatchBranchConfig(collegeId), getQuestionStats(collegeId).catch(() => null)])
      .then(([cfg, stats]) => {
        setBranches(cfg.branches || []);
        setBatches(cfg.batches || []);
        const derived = Object.keys((stats as { bySubject?: Record<string, number> } | null)?.bySubject || {});
        setSubjects(derived.length ? derived.sort() : DEFAULT_SUBJECTS);
      })
      .catch((e: unknown) => setConfigError(e instanceof Error ? e.message : 'Failed to load question bank configuration'));
  }, [collegeId]);

  // Filters
  const [scope, setScope] = useState<Scope>('all');
  const [branch, setBranch] = useState('');
  const [subject, setSubject] = useState('');
  const [difficulty, setDifficulty] = useState<DifficultyLevel | ''>('');
  const [semester, setSemester] = useState<number | ''>('');
  const [moduleNo, setModuleNo] = useState<number | ''>('');
  const [rbt, setRbt] = useState('');
  const [co, setCo] = useState('');
  const [search, setSearch] = useState('');

  // Data
  const [questions, setQuestions] = useState<Question[]>([]);
  const [lastDoc, setLastDoc] = useState<unknown>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const serverFilters = useMemo<QuestionFilters>(() => ({
    ...(branch ? { branch } : {}),
    ...(subject ? { subject } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(scope === 'pyq' ? { isPYQ: true } : {}),
    ...(scope === 'mine' && userId ? { createdBy: userId } : {}),
  }), [branch, subject, difficulty, scope, userId]);

  const load = useCallback(async (reset: boolean) => {
    if (!collegeId) return;
    setLoading(true);
    setError('');
    try {
      const res = await getQuestions(collegeId, serverFilters, PAGE_SIZE, reset ? undefined : lastDoc);
      setQuestions((prev) => (reset ? res.data : [...prev, ...res.data]));
      setLastDoc(res.lastDoc ?? null);
      setHasMore(Boolean(res.hasMore));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load questions');
    } finally {
      setLoading(false);
    }
  }, [collegeId, serverFilters, lastDoc]);

  // Reload from the first page whenever a server-side filter changes.
  useEffect(() => {
    if (tab === 'college') void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collegeId, serverFilters, tab]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return questions.filter((q) => {
      if (semester && questionSemester(q) !== semester) return false;
      if (moduleNo && questionModule(q) !== moduleNo) return false;
      if (rbt && questionRbtLevel(q) !== rbt) return false;
      if (co && questionCourseOutcome(q) !== co) return false;
      if (term) {
        const hay = [q.text, q.subject, q.courseName, q.courseCode, q.topic, q.moduleName, ...(q.tags ?? [])]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [questions, semester, moduleNo, rbt, co, search]);

  const coOptions = useMemo(() => {
    const set = new Set<string>(['CO1', 'CO2', 'CO3', 'CO4', 'CO5']);
    questions.forEach((q) => { const v = questionCourseOutcome(q); if (v) set.add(v); });
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [questions]);

  const clearFilters = () => {
    setScope('all'); setBranch(''); setSubject(''); setDifficulty('');
    setSemester(''); setModuleNo(''); setRbt(''); setCo(''); setSearch('');
  };

  // Authoring
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<Question | null>(null);

  const canModify = (q: Question) => !q.isPlatform && (canPublish || (canAuthor && q.createdBy === userId));

  const handleSubmit = async (data: Partial<Question>) => {
    try {
      if (editing) {
        await updateQuestion(editing.id, data);
        setToast('Question updated');
      } else {
        await createQuestion(collegeId, {
          ...data,
          // Faculty additions go to the HOD review queue; HOD/admin publish.
          status: canPublish ? (data.status || 'active') : 'draft',
          createdBy: userId,
          createdByName: user?.name || user?.email || 'Unknown',
        } as Omit<Question, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'linkedPaperIds' | 'collegeId'>);
        setToast(canPublish ? 'Question published to the bank' : 'Question saved — your HOD will review it');
      }
      setFormOpen(false);
      setEditing(null);
      void load(true);
    } catch (e: unknown) {
      setToast(`Save failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  const handleDelete = async (q: Question) => {
    if (!window.confirm('Delete this question? Linked papers will lose it as well.')) return;
    try {
      await deleteQuestion(q.id);
      setQuestions((prev) => prev.filter((x) => x.id !== q.id));
      setToast('Question deleted');
    } catch (e: unknown) {
      setToast(`Delete failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  if (!collegeId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Please sign in with a college account to use the question bank.</Alert>
      </Box>
    );
  }

  const tabLabel: Record<UnifiedQuestionBankTab, string> = {
    college: 'College Bank',
    universal: 'Universal Pool',
    review: 'Review Queue',
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-end' }, gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Question Bank</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
            One bank for the whole college — organised by branch, semester, course and module, with CO and RBT
            level on every question for OBE-compliant CIE / SEE papers.
          </Typography>
        </Box>
        {tab === 'college' && canAuthor && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button variant="outlined" startIcon={<AIIcon />} onClick={() => navigate(`${portalBase}/ai-questions`)}>
              AI generate
            </Button>
            <Button variant="outlined" startIcon={<CloudUploadIcon />} onClick={() => setUploadOpen(true)}>
              Upload questions
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setEditing(null); setFormOpen(true); }}>
              Add question
            </Button>
          </Stack>
        )}
      </Stack>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
          {tabs.map((t) => <Tab key={t} value={t} label={tabLabel[t]} />)}
        </Tabs>
      </Paper>

      {configError && <Alert severity="warning" sx={{ mb: 2 }}>{configError}</Alert>}

      {tab === 'college' && (
        <>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
              <TextField
                size="small"
                placeholder="Search question text, course, topic…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                sx={{ minWidth: 260, flex: '1 1 260px' }}
                slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
              />
              <FilterSelect label="Show" value={scope} onChange={(v) => setScope((v || 'all') as Scope)} width={150}
                options={[{ value: 'all', label: 'All questions' }, { value: 'mine', label: 'My questions' }, { value: 'pyq', label: 'Previous-year (PYQ)' }]} />
              <FilterSelect label="Branch" value={branch} onChange={setBranch} width={180}
                options={branches.map((b) => ({ value: b, label: b }))} />
              <FilterSelect label="Semester" value={semester === '' ? '' : String(semester)} onChange={(v) => setSemester(v ? Number(v) : '')} width={120}
                options={SEMESTERS.map((s) => ({ value: String(s), label: `Sem ${s}` }))} />
              <FilterSelect label="Course" value={subject} onChange={setSubject} width={220}
                options={subjects.map((s) => ({ value: s, label: s }))} />
              <FilterSelect label="Module" value={moduleNo === '' ? '' : String(moduleNo)} onChange={(v) => setModuleNo(v ? Number(v) : '')} width={120}
                options={MODULES.map((m) => ({ value: String(m), label: `Module ${m}` }))} />
              <FilterSelect label="CO" value={co} onChange={setCo} width={100}
                options={coOptions.map((c) => ({ value: c, label: c }))} />
              <FilterSelect label="RBT level" value={rbt} onChange={setRbt} width={160} options={RBT_LEVELS} />
              <FilterSelect label="Difficulty" value={difficulty} onChange={(v) => setDifficulty(v as DifficultyLevel | '')} width={130}
                options={[{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
              <Button size="small" startIcon={<ClearIcon />} onClick={clearFilters}>Clear</Button>
              <Box sx={{ ml: 'auto' }}>
                <QuestionPDFExport questions={visible} title={subject || 'Question Bank'} />
              </Box>
            </Stack>
          </Paper>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, minWidth: 320 }}>Question</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Course</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Branch · Sem</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">Module</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">CO</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">RBT</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">Marks</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((q) => {
                  const mod = questionModule(q);
                  const sem = questionSemester(q);
                  return (
                    <TableRow key={q.id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {q.text}
                        </Typography>
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                          <Chip size="small" variant="outlined" label={String(q.type).replace(/_/g, ' ')} />
                          <Chip size="small" variant="outlined" label={q.difficulty}
                            color={q.difficulty === 'hard' ? 'error' : q.difficulty === 'medium' ? 'warning' : 'success'} />
                          {q.isPYQ && <Chip size="small" color="secondary" label={`PYQ${q.examYear ? ` ${q.examYear}` : ''}`} />}
                          {q.isPlatform && <Chip size="small" label="Platform" />}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{q.courseCode || q.subject || '—'}</Typography>
                        {q.courseCode && q.subject && <Typography variant="caption" color="text.secondary">{q.courseName || q.subject}</Typography>}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{q.branch || '—'}</Typography>
                        <Typography variant="caption" color="text.secondary">{sem ? `Sem ${sem}` : ''}{q.batch ? `${sem ? ' · ' : ''}${q.batch}` : ''}</Typography>
                      </TableCell>
                      <TableCell align="center">{mod ? `M${mod}` : '—'}</TableCell>
                      <TableCell align="center">{questionCourseOutcome(q) || '—'}</TableCell>
                      <TableCell align="center">{questionRbtLevel(q) || '—'}</TableCell>
                      <TableCell align="center">{q.marks}</TableCell>
                      <TableCell>{statusChip(String(q.status))}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="Preview"><IconButton size="small" onClick={() => setPreview(q)}><ViewIcon fontSize="small" /></IconButton></Tooltip>
                        {canModify(q) && (
                          <>
                            <Tooltip title="Edit"><IconButton size="small" onClick={() => { setEditing(q); setFormOpen(true); }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                            <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => handleDelete(q)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!loading && visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 6 }}>
                      <Typography color="text.secondary">
                        No questions match these filters. {canAuthor ? 'Add or upload questions to start the bank.' : ''}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, mt: 2 }}>
            {loading && <CircularProgress size={22} />}
            {!loading && hasMore && <Button onClick={() => load(false)}>Load more</Button>}
            <Typography variant="caption" color="text.secondary">
              Showing {visible.length} of {questions.length} loaded
            </Typography>
          </Box>
        </>
      )}

      {tab === 'universal' && <UniversalQuestionBank showSubmitButton={canAuthor} />}
      {tab === 'review' && canReview && <ReviewQueue />}

      {/* Add / edit */}
      <Dialog open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? 'Edit question' : 'Add question'}</DialogTitle>
        <DialogContent dividers>
          {!canPublish && !editing && (
            <Alert severity="info" sx={{ mb: 2 }}>New questions are sent to your HOD for review before they appear in papers.</Alert>
          )}
          <FacultyQuestionForm
            initialData={editing || undefined}
            subjects={subjects}
            onSubmit={(data) => { void handleSubmit(data); }}
            onCancel={() => { setFormOpen(false); setEditing(null); }}
          />
        </DialogContent>
      </Dialog>

      {/* Preview */}
      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Question preview</DialogTitle>
        <DialogContent dividers>
          {preview && (
            <Stack spacing={1.5}>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>{preview.text}</Typography>
              {preview.options && preview.options.length > 0 && (
                <Stack spacing={0.5}>
                  {preview.options.map((o, i) => (
                    <Typography key={o.id || i} variant="body2" sx={{ fontWeight: o.isCorrect ? 700 : 400, color: o.isCorrect ? 'success.main' : 'text.primary' }}>
                      {String.fromCharCode(65 + i)}. {o.text}
                    </Typography>
                  ))}
                </Stack>
              )}
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                <Chip size="small" label={preview.courseCode || preview.subject} />
                {questionModule(preview) && <Chip size="small" label={`Module ${questionModule(preview)}`} />}
                {questionCourseOutcome(preview) && <Chip size="small" label={questionCourseOutcome(preview)} />}
                {questionRbtLevel(preview) && <Chip size="small" label={`RBT ${questionRbtLevel(preview)}`} />}
                <Chip size="small" label={`${preview.marks} marks`} />
              </Stack>
              {preview.explanation && (
                <Alert severity="info" variant="outlined">{preview.explanation}</Alert>
              )}
              <Typography variant="caption" color="text.secondary">Added by {preview.createdByName || '—'}</Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setPreview(null)}>Close</Button></DialogActions>
      </Dialog>

      <QuestionUploadEditor
        open={uploadOpen}
        collegeId={collegeId}
        createdBy={userId}
        createdByName={user?.name || ''}
        subjects={subjects}
        batches={batches}
        branches={branches}
        canPublishDirectly={canPublish}
        onClose={() => setUploadOpen(false)}
        onSaved={(count, status) => {
          setToast(status === 'draft' ? `${count} question(s) saved as draft` : `${count} question(s) added to the bank`);
          void load(true);
        }}
      />
      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast('')} message={toast} />
    </Box>
  );
}

function FilterSelect({
  label, value, onChange, options, width,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  width: number;
}) {
  return (
    <FormControl size="small" sx={{ width }}>
      <InputLabel>{label}</InputLabel>
      <Select label={label} value={value} onChange={(e) => onChange(String(e.target.value))}>
        <MenuItem value=""><em>All</em></MenuItem>
        {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </Select>
    </FormControl>
  );
}
