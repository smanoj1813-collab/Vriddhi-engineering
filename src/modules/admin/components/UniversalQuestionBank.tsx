// ============================================================
// VRIDDHI - UniversalQuestionBank Component
// ============================================================
// Browse, search, filter, and preview questions from the universal pool
// Uses Box + flexWrap layout (no MUI Grid)
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Pagination,
  CircularProgress,
  Alert,
  Tooltip,
  Divider,
  Paper as MuiPaper,
  Stack,
  Badge,
  ToggleButtonGroup,
  ToggleButton,
  Autocomplete,
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  Visibility as ViewIcon,
  Add as AddIcon,
  Star as StarIcon,
  Image as ImageIcon,
  CheckCircle as ApprovedIcon,
  Pending as PendingIcon,
  School as SchoolIcon,
  Bookmark as BookmarkIcon,
  BookmarkBorder as BookmarkBorderIcon,
  Clear as ClearIcon,
  PictureAsPdf as PdfIcon,
  TableRows as TableIcon,
  GridView as GridIcon,
} from '@mui/icons-material';
import { useQuestionBank } from '../../../modules/admin/hooks/useQuestionBank';
import { useAuth } from '../../auth/context/AuthContext';
import {
  type QuestionMetadata,
  type QuestionContent,
  type QuestionFilter,
  type DifficultyLevel,
  type QuestionType,
  type ReviewStatus,
} from '../../admin/types/universalQuestionBank';
import QuestionSubmissionForm from './QuestionSubmissionForm';
import { paperStorageApi } from '../api/cloudStorageApi';
import { useNavigate } from 'react-router-dom';
import QuestionPDFExport from './question-bank/QuestionPDFExport';
import FacultyBankAdmin from './question-bank/FacultyBankAdmin';
import * as questionBankService from '../../admin/services/questionBankAPI';

export type BloomTaxonomyLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';

export const DIFFICULTY_CONFIG: Record<string, { label: string; color: string }> = {
  easy: { label: 'Easy', color: '#4caf50' },
  medium: { label: 'Medium', color: '#ff9800' },
  hard: { label: 'Hard', color: '#f44336' },
};

export const BLOOM_LEVELS: Record<string, { label: string; color: string }> = {
  remember: { label: 'Remember', color: '#4caf50' },
  understand: { label: 'Understand', color: '#2196f3' },
  apply: { label: 'Apply', color: '#ff9800' },
  analyze: { label: 'Analyze', color: '#9c27b0' },
  evaluate: { label: 'Evaluate', color: '#f44336' },
  create: { label: 'Create', color: '#e91e63' },
};

// ============================================================
// QUESTION CARD (compact view for browsing)
// ============================================================

interface QuestionCardProps {
  metadata: QuestionMetadata;
  isSelected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onAddToCollection?: () => void;
  isInCollection?: boolean;
}

function QuestionCard({
  metadata,
  isSelected,
  onSelect,
  onPreview,
  onAddToCollection,
  isInCollection = false,
}: QuestionCardProps) {
  const diffConfig = DIFFICULTY_CONFIG[metadata.difficulty] || DIFFICULTY_CONFIG.medium;
  const bloomConfig = BLOOM_LEVELS[(metadata as any).bloomLevel || 'understand'] || BLOOM_LEVELS.understand;

  return (
    <MuiPaper
      elevation={isSelected ? 4 : 1}
      sx={{
        p: 2,
        borderRadius: 2,
        border: isSelected ? '2px solid' : '1px solid',
        borderColor: isSelected ? 'primary.main' : 'divider',
        bgcolor: isSelected ? 'action.selected' : 'background.paper',
        transition: 'all 0.2s',
        '&:hover': {
          borderColor: 'primary.light',
          transform: 'translateY(-2px)',
          boxShadow: 3,
        },
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Top row: Subject, Type, Status */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          <Chip
            label={(metadata as any).subjectName || metadata.subjectId || 'Subject'}
            size="small"
            color="primary"
            variant="outlined"
          />
          <Chip
            label={metadata.questionType.toUpperCase()}
            size="small"
            variant="outlined"
          />
          <Chip
            label={diffConfig.label}
            size="small"
            sx={{ bgcolor: diffConfig.color, color: 'white', fontWeight: 'bold' }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {metadata.hasImage && (
            <Tooltip title="Contains diagram/image">
              <ImageIcon fontSize="small" color="action" />
            </Tooltip>
          )}
          {metadata.status === 'approved' && (
            <Tooltip title="Approved & Verified">
              <ApprovedIcon fontSize="small" color="success" />
            </Tooltip>
          )}
          {metadata.status === 'pending' && (
            <Tooltip title="Pending Review">
              <PendingIcon fontSize="small" color="warning" />
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Question preview text */}
      <Typography
        variant="body2"
        sx={{
          flex: 1,
          mb: 1.5,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          lineHeight: 1.4,
        }}
      >
        {(metadata as any).previewText || (metadata as any).text || (metadata as any).questionText || 'Question text'}
      </Typography>

      {/* Metadata tags */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
        {(metadata as any).topicName && (
          <Chip
            label={(metadata as any).topicName}
            size="small"
            variant="filled"
            sx={{ fontSize: '0.7rem', height: 20 }}
          />
        )}
        {bloomConfig && (
          <Chip
            label={bloomConfig.label}
            size="small"
            sx={{
              fontSize: '0.7rem',
              height: 20,
              bgcolor: `${bloomConfig.color}20`,
              color: bloomConfig.color,
            }}
          />
        )}
        {metadata.tags?.slice(0, 2).map((tag, idx) => (
          <Chip
            key={idx}
            label={`#${tag}`}
            size="small"
            variant="outlined"
            sx={{ fontSize: '0.65rem', height: 18 }}
          />
        ))}
        {metadata.tags && metadata.tags.length > 2 && (
          <Typography variant="caption" color="text.secondary">
            +{metadata.tags.length - 2}
          </Typography>
        )}
      </Box>

      <Divider sx={{ my: 1 }} />

      {/* Bottom row: Usage, Marks, Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {metadata.marks} mark{metadata.marks > 1 ? 's' : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Used: {metadata.usageCount || 0}x
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {onAddToCollection && (
            <Tooltip title={isInCollection ? 'Remove from collection' : 'Save to collection'}>
              <IconButton size="small" onClick={onAddToCollection}>
                {isInCollection ? (
                  <BookmarkIcon fontSize="small" color="primary" />
                ) : (
                  <BookmarkBorderIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Quick Preview">
            <IconButton size="small" onClick={onPreview}>
              <ViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button
            size="small"
            variant={isSelected ? 'contained' : 'outlined'}
            color={isSelected ? 'success' : 'primary'}
            onClick={onSelect}
          >
            {isSelected ? 'Selected' : 'Select'}
          </Button>
        </Box>
      </Box>
    </MuiPaper>
  );
}

// ============================================================
// QUESTION PREVIEW DIALOG
// ============================================================

interface QuestionPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  question: QuestionContent | null;
  loading: boolean;
}

function QuestionPreviewDialog({
  open,
  onClose,
  question,
  loading,
}: QuestionPreviewDialogProps) {
  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">Question Details</Typography>
          {question && (
            <Chip
              label={`${question.marks} Mark${question.marks > 1 ? 's' : ''}`}
              color="primary"
              size="small"
            />
          )}
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : question ? (
          <Stack spacing={2.5}>
            {/* Question Text */}
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Question
              </Typography>
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', fontWeight: 500 }}>
                {question.questionText}
              </Typography>
            </Box>

            {/* Options if MCQ */}
            {question.options && question.options.length > 0 && (
              <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Options
                </Typography>
                <Stack spacing={1}>
                  {question.options.map((opt) => (
                    <Box
                      key={opt.id}
                      sx={{
                        p: 1.5,
                        borderRadius: 1,
                        bgcolor: opt.isCorrect ? 'success.light' : 'action.hover',
                        color: opt.isCorrect ? 'success.contrastText' : 'text.primary',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                      }}
                    >
                      <Chip
                        label={opt.id}
                        size="small"
                        color={opt.isCorrect ? 'success' : 'default'}
                      />
                      <Typography variant="body2">{opt.text}</Typography>
                      {opt.isCorrect && (
                        <Chip
                          label="Correct Answer"
                          size="small"
                          color="success"
                          sx={{ ml: 'auto' }}
                        />
                      )}
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}

            {/* Explanation */}
            {question.explanation && (
              <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Explanation
                </Typography>
                <Alert severity="info" sx={{ whiteSpace: 'pre-wrap' }}>
                  {question.explanation}
                </Alert>
              </Box>
            )}

            {/* Hint */}
            {question.hint && (
              <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Hint for Students
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  {question.hint}
                </Typography>
              </Box>
            )}

            {/* Tags & Metadata */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Chip label={`Type: ${question.questionType.toUpperCase()}`} size="small" />
              <Chip label={`Difficulty: ${question.difficulty}`} size="small" />
              {(question as any).bloomLevel && (
                <Chip label={`Bloom: ${(question as any).bloomLevel}`} size="small" />
              )}
              {question.tags?.map((t, i) => (
                <Chip key={i} label={`#${t}`} size="small" variant="outlined" />
              ))}
            </Box>
          </Stack>
        ) : (
          <Typography color="text.secondary">No question data available</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ============================================================
// FILTER PANEL
// ============================================================

interface FilterPanelProps {
  filter: QuestionFilter;
  onFilterChange: (filter: QuestionFilter) => void;
  subjects: { id: string; name: string }[];
  topics: { id: string; name: string; subjectId: string }[];
}

function FilterPanel({
  filter,
  onFilterChange,
  subjects,
  topics,
}: FilterPanelProps) {
  const [selectedSubject, setSelectedSubject] = useState(filter.subjectId || '');

  // Keep internal subject in sync when filter is cleared externally
  useEffect(() => {
    setSelectedSubject(filter.subjectId || '');
  }, [filter.subjectId]);

  const filteredTopics = topics.filter(
    (t) => !selectedSubject || t.subjectId === selectedSubject
  );

  const handleSubjectChange = (subjectId: string) => {
    setSelectedSubject(subjectId);
    onFilterChange({
      ...filter,
      subjectId: subjectId || undefined,
      topicId: undefined,
    });
  };

  const handleTopicChange = (topicId: string) => {
    onFilterChange({
      ...filter,
      topicId: topicId || undefined,
    });
  };

  const handleDifficultyChange = (difficulty: DifficultyLevel | '') => {
    onFilterChange({
      ...filter,
      difficulty: difficulty || undefined,
    });
  };

  const handleTypeChange = (type: QuestionType | '') => {
    onFilterChange({
      ...filter,
      questionType: type || undefined,
    });
  };

  const handleClear = () => {
    setSelectedSubject('');
    onFilterChange({ status: 'approved' as ReviewStatus });
  };

  return (
    <MuiPaper sx={{ p: 2, borderRadius: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        {/* Subject */}
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Subject</InputLabel>
          <Select
            value={selectedSubject}
            label="Subject"
            onChange={(e) => handleSubjectChange(e.target.value)}
          >
            <MenuItem value="">All Subjects</MenuItem>
            {subjects.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Topic */}
        <FormControl size="small" sx={{ minWidth: 150 }} disabled={!selectedSubject}>
          <InputLabel>Topic</InputLabel>
          <Select
            value={filter.topicId || ''}
            label="Topic"
            onChange={(e) => handleTopicChange(e.target.value)}
          >
            <MenuItem value="">All Topics</MenuItem>
            {filteredTopics.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Difficulty */}
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Difficulty</InputLabel>
          <Select
            value={filter.difficulty || ''}
            label="Difficulty"
            onChange={(e) => handleDifficultyChange(e.target.value as DifficultyLevel)}
          >
            <MenuItem value="">All Difficulties</MenuItem>
            <MenuItem value="easy">Easy</MenuItem>
            <MenuItem value="medium">Medium</MenuItem>
            <MenuItem value="hard">Hard</MenuItem>
          </Select>
        </FormControl>

        {/* Question Type */}
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Type</InputLabel>
          <Select
            value={filter.questionType || ''}
            label="Type"
            onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
          >
            <MenuItem value="">All Types</MenuItem>
            <MenuItem value="mcq">MCQ</MenuItem>
            <MenuItem value="short">Short Answer</MenuItem>
            <MenuItem value="long">Long Answer</MenuItem>
            <MenuItem value="numerical">Numerical</MenuItem>
          </Select>
        </FormControl>

        {/* Clear button */}
        <Button
          size="small"
          startIcon={<ClearIcon />}
          onClick={handleClear}
          sx={{ ml: 'auto' }}
        >
          Clear
        </Button>
      </Box>
    </MuiPaper>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export interface UniversalQuestionBankProps {
  onQuestionSelect?: (questionId: string) => void;
  onAddToPaper?: (questionId: string) => void;
  selectedQuestionIds?: string[];
  showSubmitButton?: boolean;
  onSubmitQuestion?: () => void;
}

export function UniversalQuestionBank({
  onQuestionSelect,
  onAddToPaper,
  selectedQuestionIds = [],
  showSubmitButton = true,
  onSubmitQuestion,
}: UniversalQuestionBankProps) {
  const { user } = useAuth();
  const collegeId = user?.collegeId || localStorage.getItem('vriddhi_college_id') || '';
  const isSuperadmin = user?.role === 'superadmin';
  // /admin/paper-generator left the HOD/admin portal (HOD round); only the
  // roles still allowed on that route may be sent there. Everyone else keeps
  // the in-dialog "Create Paper" flow. Mirrors PAPER_CRAFT_ROLES in
  // src/modules/admin/routes.tsx — widen both together to plug it back.
  const canOpenAdminPaperGenerator = user?.role === 'superadmin' || user?.role === 'employee';

  // ── Correct universal-store binding (was legacy college store + cast) ──
  const {
    universalQuestions,
    selectedQuestion,
    loadingUniversal,
    errorsUniversal,
    pagination,
    universalStats,
    searchUniversalQuestions,
    loadQuestionDetail,
    loadUniversalStats,
  } = useQuestionBank();

  const questions: QuestionMetadata[] = universalQuestions || [];
  const loading = loadingUniversal.questions || false;
  const error = errorsUniversal.questions || null;
  // QuestionBankStats uses totalQuestions; legacy alias keeps total for compat
  const stats: any = universalStats || null;

  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Approved is the universal enum — 'active' is legacy CollegeQuestion.status and matches nothing.
  const [filter, setFilter] = useState<QuestionFilter>({
    status: 'approved' as ReviewStatus,
  });
  const [searchText, setSearchText] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewQuestionId, setPreviewQuestionId] = useState<string | null>(null);
  const navigate = useNavigate();

  // Internal selection when parent doesn't control it (faculty/principal/superadmin standalone)
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());
  const [paperDialogOpen, setPaperDialogOpen] = useState(false);
  const [paperTitle, setPaperTitle] = useState('');
  const [paperSubject, setPaperSubject] = useState('');
  const [paperDuration, setPaperDuration] = useState(60);
  const [paperCreating, setPaperCreating] = useState(false);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [paperSuccess, setPaperSuccess] = useState<{ id: string; title: string } | null>(null);

  // Derive picker options from real bank data, not a hardcoded demo list.
  // Falls back to a minimal generic set only before the first load.
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([
    { id: 'General', name: 'General' },
  ]);
  const [topics, setTopics] = useState<{ id: string; name: string; subjectId: string }[]>([]);

  // Build viewer context once per user to enforce the visibility gate in search().
  // Without this every college saw every other college's college_only rows (see §3).
  const buildViewerFilter = useCallback(
    (base: QuestionFilter, query?: string): QuestionFilter => ({
      ...base,
      searchQuery: query ?? searchText ?? undefined,
      collegeId: collegeId || null,
      viewerIsSuperadmin: isSuperadmin,
    } as unknown as QuestionFilter),
    [collegeId, isSuperadmin, searchText]
  );

  // Load initial data — viewer context decides which visibilities are included.
  useEffect(() => {
    searchUniversalQuestions(buildViewerFilter(filter, ''), 1);
    loadUniversalStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collegeId, isSuperadmin]);

  // Derive subject/topic pickers from the loaded page + stats distinct counts.
  useEffect(() => {
    if (!questions.length && !stats?.bySubject) return;

    // Subjects: distinct subjectId from current page plus known keys from stats
    const subjectIds = new Set<string>();
    questions.forEach((q) => {
      if (q.subjectId) subjectIds.add(q.subjectId);
    });
    if (stats?.bySubject) {
      Object.keys(stats.bySubject).forEach((k) => subjectIds.add(k));
    }
    if (subjectIds.size) {
      const derived = Array.from(subjectIds)
        .filter(Boolean)
        .sort()
        .map((id) => ({ id, name: id }));
      setSubjects((prev) => {
        // Keep any previously seen ids and append new ones; prevents picker thrash
        const seen = new Set(prev.map((p) => p.id));
        const next = [...prev];
        for (const s of derived) if (!seen.has(s.id)) { next.push(s); seen.add(s.id); }
        // Remove the initial 'General' placeholder once real data arrives, unless it's the only entry
        if (next.length > 1 && next[0]?.id === 'General' && subjectIds.has('General') === false) {
          return next.slice(1);
        }
        return next;
      });
    }

    // Topics: distinct topicId per subject from current page
    if (questions.length) {
      const topicMap = new Map<string, { id: string; name: string; subjectId: string }>();
      questions.forEach((q) => {
        if (!q.topicId) return;
        if (!topicMap.has(q.topicId)) {
          topicMap.set(q.topicId, { id: q.topicId, name: q.topicId, subjectId: q.subjectId || 'General' });
        }
      });
      if (topicMap.size) {
        const derivedTopics = Array.from(topicMap.values()).sort((a, b) => a.id.localeCompare(b.id));
        setTopics((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          const next = [...prev];
          for (const t of derivedTopics) if (!seen.has(t.id)) { next.push(t); seen.add(t.id); }
          return next;
        });
      }
    }
  }, [questions, stats]);

  // Search when filter or text changes (debounced) — honours viewer context and pagination page 1
  useEffect(() => {
    const timer = setTimeout(() => {
      searchUniversalQuestions(buildViewerFilter(filter), 1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filter, searchText, buildViewerFilter, searchUniversalQuestions]);

  const handlePreview = (questionId: string) => {
    setPreviewQuestionId(questionId);
    loadQuestionDetail(questionId);
    setPreviewOpen(true);
  };

  const isExternallyControlled = typeof onQuestionSelect === 'function';
  const effectiveSelectedIds: Set<string> = isExternallyControlled
    ? new Set(selectedQuestionIds)
    : internalSelectedIds;

  const handleQuestionClick = (questionId: string) => {
    if (isExternallyControlled) {
      onQuestionSelect!(questionId);
      if (onAddToPaper) onAddToPaper(questionId);
    } else {
      setInternalSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(questionId)) next.delete(questionId);
        else next.add(questionId);
        return next;
      });
    }
  };

  // Bookmark button also toggles selection as quick add
  const handleBookmarkToggle = (questionId: string) => {
    handleQuestionClick(questionId);
  };

  const handlePageChange = (_: React.ChangeEvent<unknown>, page: number) => {
    searchUniversalQuestions(buildViewerFilter(filter), page);
  };

  const handleManualSearch = () => {
    searchUniversalQuestions(buildViewerFilter(filter), 1);
  };

  const isQuestionSelected = (id: string) => effectiveSelectedIds.has(id);

  const selectedCount = effectiveSelectedIds.size;
  const selectedIdsArray = Array.from(effectiveSelectedIds);

  const handleClearSelection = () => {
    if (isExternallyControlled) {
      selectedIdsArray.forEach((id) => onQuestionSelect!(id));
    } else {
      setInternalSelectedIds(new Set());
    }
  };

  const handleOpenPaperDialog = () => {
    const first = questions.find((q: any) => effectiveSelectedIds.has((q as any).id));
    const subj = (first as any)?.subjectId || filter.subjectId || subjects[0]?.id || 'General';
    setPaperSubject(subj);
    setPaperTitle(subj ? `${subj} Paper — ${new Date().toLocaleDateString()}` : 'New Paper');
    setPaperDuration(60);
    setPaperError(null);
    setPaperSuccess(null);
    setPaperDialogOpen(true);
  };

  const handleCreatePaperFromSelection = async () => {
    if (!paperTitle.trim()) {
      setPaperError('Title is required');
      return;
    }
    if (selectedCount === 0) {
      setPaperError('Select at least one question');
      return;
    }
    setPaperCreating(true);
    setPaperError(null);
    try {
      const now = new Date().toISOString();
      const refs = selectedIdsArray.map((qid, idx) => {
        const meta: any = questions.find((q: any) => (q as any).id === qid);
        return {
          questionId: qid,
          order: idx + 1,
          marks: meta?.marks || 2,
          isRequired: true,
        };
      });
      const totalMarks = refs.reduce((s: number, r: any) => s + r.marks, 0);
      const dist: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
      const topicDist: Record<string, number> = {};
      selectedIdsArray.forEach((qid) => {
        const meta: any = questions.find((q: any) => (q as any).id === qid);
        if (meta?.difficulty) dist[meta.difficulty] = (dist[meta.difficulty] || 0) + 1;
        if (meta?.topicId) topicDist[meta.topicId] = (topicDist[meta.topicId] || 0) + 1;
      });
      const paper: any = {
        id: '',
        title: paperTitle.trim(),
        description: `Created from Universal Bank selection (${selectedCount} questions)`,
        subjectId: paperSubject || filter.subjectId || 'General',
        topicIds: Object.keys(topicDist),
        questions: refs,
        totalQuestions: refs.length,
        totalMarks,
        duration: paperDuration,
        difficultyDistribution: dist,
        topicDistribution: topicDist,
        createdBy: {
          userId: user?.uid || user?.id || '',
          userName: user?.name || user?.displayName || 'Unknown',
          collegeId: collegeId || null,
          collegeName: '',
          role: (user?.role as any) || 'faculty',
        },
        visibility: isSuperadmin ? 'public' : 'college_only',
        sharedWith: [],
        isTemplate: false,
        status: 'draft',
        storagePath: '',
        usageStats: { timesUsed: 0, collegesUsing: [] },
        tags: ['universal-selection'],
        createdAt: now,
        updatedAt: now,
      };
      const res = await paperStorageApi.uploadPaper(paper);
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to create paper');
      const newId = res.data.storagePath.split('/')[1] || '';
      setPaperSuccess({ id: newId, title: paper.title });
      if (!isExternallyControlled) setInternalSelectedIds(new Set());
    } catch (e: any) {
      setPaperError(e.message || 'Failed to create paper');
    } finally {
      setPaperCreating(false);
    }
  };

  const toMetadata = (q: any): QuestionMetadata => ({
    id: q.id || '',
    subjectId: q.subjectId || q.subject || '',
    subjectName: q.subjectName || q.subject || '',
    topicId: q.topicId || q.topic || '',
    topicName: q.topicName || q.topic || '',
    difficulty: q.difficulty || 'medium',
    questionType: q.questionType || q.type || 'mcq',
    marks: q.marks || 1,
    bloomLevel: q.bloomLevel || 'understand',
    previewText: q.previewText || q.text || q.questionText || '',
    searchKeywords: q.searchKeywords || [],
    status: (q.status as ReviewStatus) || 'approved',
    visibility: q.visibility || 'public',
    sharedWith: q.sharedWith || [],
    source: q.source || 'platform',
    storagePath: q.storagePath || '',
    hasImage: Boolean(q.hasImage || q.imageUrl),
    qualityRating: q.qualityRating || 0,
    usageCount: q.usageCount || 0,
    tags: q.tags || [],
    createdBy: q.createdBy || { userId: '', userName: 'Unknown', collegeId: null, collegeName: '', role: 'faculty' as const },
    createdAt: q.createdAt || new Date().toISOString(),
    updatedAt: q.updatedAt || new Date().toISOString(),
  } as unknown as QuestionMetadata);

  return (
    <Box sx={{ p: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
            Universal Question Bank
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Browse, search, and export academic questions across all subjects
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, val) => val && setViewMode(val)}
            size="small"
          >
            <ToggleButton value="grid" aria-label="grid view">
              <GridIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="table" aria-label="table view">
              <TableIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>

          <Button
            variant="outlined"
            startIcon={<PdfIcon />}
            onClick={() => setExportOpen(true)}
          >
            Export PDF
          </Button>

          {showSubmitButton && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                if (onSubmitQuestion) {
                  onSubmitQuestion();
                } else {
                  setSubmissionOpen(true);
                }
              }}
            >
              Submit Question
            </Button>
          )}
        </Box>
      </Box>

      {viewMode === 'table' ? (
        <FacultyBankAdmin />
      ) : (
        <>
          {/* Search bar */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <TextField
              fullWidth
              placeholder="Search by tags, topic, or keywords..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />,
                },
              }}
              size="small"
            />
            <Button
              variant="outlined"
              onClick={handleManualSearch}
            >
              Search
            </Button>
          </Box>

          {/* Filters */}
          <Box sx={{ mb: 3 }}>
            <FilterPanel
              filter={filter}
              onFilterChange={setFilter}
              subjects={subjects}
              topics={topics}
            />
          </Box>

          {/* Error */}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Stats bar */}
          {stats && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
              <Chip label={`Total: ${stats.totalQuestions ?? (stats as any).total ?? 0}`} color="primary" />
              <Chip label={`Easy: ${stats.byDifficulty?.easy || 0}`} variant="outlined" />
              <Chip label={`Medium: ${stats.byDifficulty?.medium || 0}`} variant="outlined" />
              <Chip label={`Hard: ${stats.byDifficulty?.hard || 0}`} variant="outlined" />
              <Chip label={`Pending Review: ${(stats as any).pendingReviews || 0}`} color="warning" />
            </Box>
          )}

          {/* Results count */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Showing {questions.length} of {pagination?.total || questions.length} questions
            {(pagination?.totalPages || 0) > 1 && ` (Page ${pagination?.page || 1} of ${pagination?.totalPages || 1})`}
          </Typography>

          {/* Question grid */}
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : questions.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <Typography variant="h6" color="text.secondary">
                No questions found
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Try adjusting your filters or search terms
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {questions.map((q) => (
                <Box key={q.id || Math.random()} sx={{ flex: '1 1 350px', minWidth: 300, maxWidth: 500 }}>
                  <QuestionCard
                    metadata={toMetadata(q as any)}
                    isSelected={isQuestionSelected((q as any).id || '')}
                    onSelect={() => handleQuestionClick((q as any).id || '')}
                    onPreview={() => handlePreview((q as any).id || '')}
                    onAddToCollection={() => handleBookmarkToggle((q as any).id || '')}
                    isInCollection={isQuestionSelected((q as any).id || '')}
                  />
                </Box>
              ))}
            </Box>
          )}

          {/* Pagination */}
          {(pagination?.totalPages || 0) > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
              <Pagination
                count={pagination?.totalPages || 1}
                page={pagination?.page || 1}
                onChange={handlePageChange}
                color="primary"
              />
            </Box>
          )}

          {/* Selection bar — one-stop paper wiring */}
          {selectedCount > 0 && (
            <MuiPaper
              sx={{
                position: 'sticky',
                bottom: 16,
                mt: 3,
                p: 1.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1.5,
                border: '1px solid',
                borderColor: 'primary.light',
                bgcolor: 'primary.light',
                color: 'primary.contrastText',
                boxShadow: 6,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Chip label={`${selectedCount} selected`} color="primary" sx={{ bgcolor: 'white', color: 'primary.main', fontWeight: 700 }} />
                <Typography variant="body2" sx={{ color: 'white', fontWeight: 600, display: { xs: 'none', sm: 'block' } }}>
                  {selectedCount === 1 ? '1 question ready for paper' : `${selectedCount} questions ready for paper`}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" variant="outlined" onClick={handleClearSelection} sx={{ bgcolor: 'white' }}>
                  Clear
                </Button>
                <Button size="small" variant="contained" color="success" onClick={handleOpenPaperDialog}>
                  Create Paper
                </Button>
                {canOpenAdminPaperGenerator && (
                  <Button
                    size="small"
                    variant="contained"
                    sx={{ bgcolor: 'white', color: 'primary.main' }}
                    onClick={() => {
                      if (collegeId) {
                        navigate('/admin/paper-generator', { state: { universalSelection: selectedIdsArray } });
                      } else {
                        handleOpenPaperDialog();
                      }
                    }}
                  >
                    Go to Generator
                  </Button>
                )}
              </Box>
            </MuiPaper>
          )}

          {/* Create Paper from selection — one-stop */}
          <Dialog open={paperDialogOpen} onClose={() => setPaperDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Create Paper from {selectedCount} questions</DialogTitle>
            <DialogContent dividers>
              {paperSuccess ? (
                <Alert severity="success" sx={{ mb: 2 }}>
                  Paper “{paperSuccess.title}” created (ID: {paperSuccess.id}). You can preview it in Papers → Generated.
                </Alert>
              ) : null}
              {paperError && <Alert severity="error" sx={{ mb: 2 }}>{paperError}</Alert>}
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField label="Paper Title *" value={paperTitle} onChange={(e) => setPaperTitle(e.target.value)} fullWidth autoFocus />
                <FormControl fullWidth>
                  <InputLabel>Subject</InputLabel>
                  <Select value={paperSubject} label="Subject" onChange={(e) => setPaperSubject(e.target.value)}>
                    {subjects.map((s) => (
                      <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField label="Duration (minutes)" type="number" value={paperDuration} onChange={(e) => setPaperDuration(parseInt(e.target.value) || 60)} slotProps={{ htmlInput: { min: 10 } }} />
                <Typography variant="caption" color="text.secondary">
                  {selectedCount} questions • Total marks ~{selectedIdsArray.reduce((s, id) => { const m: any = questions.find((q: any) => (q as any).id === id); return s + (m?.marks || 2); }, 0)} • Visibility: {isSuperadmin ? 'public' : 'college_only'}
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPaperDialogOpen(false)} disabled={paperCreating}>Cancel</Button>
              {paperSuccess ? (
                <>
                  <Button
                    onClick={() => {
                      setPaperDialogOpen(false);
                      if (isSuperadmin) navigate('/superadmin/question-bank');
                      else if (user?.role === 'faculty') navigate('/faculty/papers');
                      else if (canOpenAdminPaperGenerator) navigate('/admin/paper-generator');
                    }}
                  >
                    Done
                  </Button>
                  {canOpenAdminPaperGenerator && (
                    <Button
                      variant="contained"
                      onClick={() => {
                        navigate('/admin/paper-generator');
                      }}
                    >
                      View Papers
                    </Button>
                  )}
                </>
              ) : (
                <Button variant="contained" onClick={handleCreatePaperFromSelection} disabled={paperCreating || selectedCount === 0}>
                  {paperCreating ? <CircularProgress size={18} /> : 'Create Paper'}
                </Button>
              )}
            </DialogActions>
          </Dialog>

          {/* Preview Dialog */}
          <QuestionPreviewDialog
            open={previewOpen}
            onClose={() => { setPreviewOpen(false); setPreviewQuestionId(null); }}
            question={selectedQuestion}
            loading={loadingUniversal.questionDetail || false}
          />
        </>
      )}

      {/* Submission Dialog */}
      <Dialog
        open={submissionOpen}
        onClose={() => setSubmissionOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <QuestionSubmissionForm
          onClose={() => setSubmissionOpen(false)}
          onSuccess={() => {
            setSubmissionOpen(false);
            searchUniversalQuestions(buildViewerFilter(filter), 1);
          }}
        />
      </Dialog>

      {/* PDF Export Dialog — uses denormalised preview so meta-only rows don't crash */}
      <QuestionPDFExport
        questions={questions as any}
        title={filter.subjectId || 'Question Bank'}
      />
    </Box>
  );
}

export default UniversalQuestionBank;
