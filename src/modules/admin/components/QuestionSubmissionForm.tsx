// ============================================================
// VRIDDHI - QuestionSubmissionForm Component
// ============================================================
// Faculty/Admin submit questions to the universal pool
// Questions go to "pending_review" until superadmin approves
// Uses Box + flexWrap layout (no MUI Grid)
// ============================================================

import React, { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Chip,
  IconButton,
  Stepper,
  Step,
  StepLabel,
  Alert,
  CircularProgress,
  Divider,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Paper as MuiPaper,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckIcon,
  RadioButtonUnchecked as UncheckedIcon,
  CloudUpload as UploadIcon,
  ArrowForward as NextIcon,
  ArrowBack as BackIcon,
  HelpOutlined as HelpIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import { useAuth } from '../../auth/context/AuthContext';
import { questionStorageApi } from '../api/cloudStorageApi';
import { uploadQuestionImages } from '../api/questionImageUpload';
import {
  type DifficultyLevel,
  type QuestionType,
} from '../../admin/types/universalQuestionBank';

// ============================================================
// OPTION EDITOR
// ============================================================

interface Option {
  id: string;
  text: string;
  isCorrect: boolean;
}

interface OptionEditorProps {
  options: Option[];
  onChange: (options: Option[]) => void;
  correctAnswer: string;
  onCorrectChange: (id: string) => void;
}

function OptionEditor({ options, onChange, correctAnswer, onCorrectChange }: OptionEditorProps) {
  const handleTextChange = (index: number, text: string) => {
    const updated = [...options];
    updated[index] = { ...updated[index], text };
    onChange(updated);
  };

  const handleToggleCorrect = (id: string) => {
    onCorrectChange(id);
    const updated = options.map((opt) => ({
      ...opt,
      isCorrect: opt.id === id,
    }));
    onChange(updated);
  };

  const handleAddOption = () => {
    const nextId = String.fromCharCode(65 + options.length); // A, B, C, D, E...
    onChange([...options, { id: nextId, text: '', isCorrect: false }]);
  };

  const handleRemoveOption = (index: number) => {
    if (options.length <= 2) return; // Minimum 2 options
    const updated = options.filter((_, i) => i !== index);
    // Re-assign IDs
    const reassigned = updated.map((opt, i) => ({
      ...opt,
      id: String.fromCharCode(65 + i),
    }));
    onChange(reassigned);
    // Update correct answer if removed
    if (correctAnswer === options[index].id && reassigned.length > 0) {
      onCorrectChange(reassigned[0].id);
      onChange(reassigned.map((opt, i) => ({ ...opt, isCorrect: i === 0 })));
    }
  };

  return (
    <Stack spacing={1.5}>
      {options.map((option, index) => (
        <Box
          key={option.id}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 1.5,
            borderRadius: 1,
            border: '1px solid',
            borderColor: option.isCorrect ? 'success.main' : 'divider',
            bgcolor: option.isCorrect ? 'success.light' : 'background.paper',
          }}
        >
          <IconButton
            size="small"
            onClick={() => handleToggleCorrect(option.id)}
            color={option.isCorrect ? 'success' : 'default'}
          >
            {option.isCorrect ? <CheckIcon /> : <UncheckedIcon />}
          </IconButton>
          <Typography
            sx={{
              fontWeight: 700,
              minWidth: 24,
              color: option.isCorrect ? 'success.dark' : 'text.secondary',
            }}
          >
            {option.id}
          </Typography>
          <TextField
            fullWidth
            placeholder={`Option ${option.id}`}
            value={option.text}
            onChange={(e) => handleTextChange(index, e.target.value)}
            variant="standard"
            size="small"
            sx={{ flex: 1 }}
          />
          <IconButton
            size="small"
            onClick={() => handleRemoveOption(index)}
            disabled={options.length <= 2}
            color="error"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Button
        startIcon={<AddIcon />}
        onClick={handleAddOption}
        disabled={options.length >= 6}
        size="small"
        sx={{ alignSelf: 'flex-start' }}
      >
        Add Option
      </Button>
    </Stack>
  );
}

// ============================================================
// IMAGE UPLOADER
// ============================================================

interface ImageUploaderProps {
  images: File[];
  onChange: (images: File[]) => void;
}

function ImageUploader({ images, onChange }: ImageUploaderProps) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      onChange([...images, ...newFiles].slice(0, 3)); // Max 3 images
    }
  };

  const handleRemove = (index: number) => {
    onChange(images.filter((_, i) => i !== index));
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        {images.map((file, index) => (
          <Box
            key={index}
            sx={{
              position: 'relative',
              width: 100,
              height: 100,
              borderRadius: 1,
              overflow: 'hidden',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box
              component="img"
              src={URL.createObjectURL(file)}
              alt={`Upload ${index + 1}`}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <IconButton
              size="small"
              sx={{
                position: 'absolute',
                top: 2,
                right: 2,
                bgcolor: 'rgba(0,0,0,0.5)',
                color: 'white',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
              }}
              onClick={() => handleRemove(index)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        {images.length < 3 && (
          <Button
            component="label"
            sx={{
              width: 100,
              height: 100,
              border: '2px dashed',
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            <UploadIcon />
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={handleFileChange}
              multiple
            />
          </Button>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary">
        Max 3 figures (PNG, JPG or WebP) — each under 2 MB. They upload when you submit.
      </Typography>
    </Box>
  );
}

// ============================================================
// VALIDATION SUMMARY
// ============================================================

interface ValidationSummaryProps {
  errors: string[];
}

function ValidationSummary({ errors }: ValidationSummaryProps) {
  if (errors.length === 0) return null;

  return (
    <Alert severity="error" sx={{ mb: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        Please fix the following issues:
      </Typography>
      {errors.map((error, i) => (
        <Typography key={i} variant="body2">&bull; {error}</Typography>
      ))}
    </Alert>
  );
}

// ============================================================
// SUCCESS DIALOG
// ============================================================

interface SuccessDialogProps {
  open: boolean;
  onClose: () => void;
  questionId: string;
  onSubmitAnother: () => void;
}

function SuccessDialog({ open, onClose, questionId, onSubmitAnother }: SuccessDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckIcon color="success" />
          Question Submitted!
        </Box>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Alert severity="info">
            Your question has been submitted for review. It will be available in the universal pool after superadmin approval.
          </Alert>
          <MuiPaper sx={{ p: 2, bgcolor: 'background.default' }}>
            <Typography variant="body2" color="text.secondary">
              Question ID:
            </Typography>
            <Typography sx={{ fontFamily: 'monospace' }}>
              {questionId}
            </Typography>
          </MuiPaper>
          <Typography variant="body2" color="text.secondary">
            Status: <Chip label="Pending Review" size="small" color="warning" />
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={onSubmitAnother}>
          Submit Another
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

interface QuestionSubmissionFormProps {
  onClose?: () => void;
  onSuccess?: (questionId: string) => void;
}

export function QuestionSubmissionForm({ onClose, onSuccess }: QuestionSubmissionFormProps) {
  const { user } = useAuth();

  const [activeStep, setActiveStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [submittedQuestionId, setSubmittedQuestionId] = useState('');

  // Form state
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState<Option[]>([
    { id: 'A', text: '', isCorrect: false },
    { id: 'B', text: '', isCorrect: false },
    { id: 'C', text: '', isCorrect: false },
    { id: 'D', text: '', isCorrect: false },
  ]);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [explanation, setExplanation] = useState('');
  const [hint, setHint] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [subTopicId, setSubTopicId] = useState('');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [questionType, setQuestionType] = useState<QuestionType>('mcq');
  const [marks, setMarks] = useState(1);
  const [tags, setTags] = useState<string[]>([]);
  const [images, setImages] = useState<File[]>([]);

  const steps = ['Question Content', 'Configuration', 'Review & Submit'];

  // Subjects & topics (would come from API in real app)
  const subjects = [
    { id: 'math', name: 'Mathematics' },
    { id: 'physics', name: 'Physics' },
    { id: 'chemistry', name: 'Chemistry' },
    { id: 'biology', name: 'Biology' },
    { id: 'english', name: 'English' },
  ];

  const topicsBySubject: Record<string, Array<{ id: string; name: string }>> = {
    math: [
      { id: 'algebra_linear_equations', name: 'Linear Equations' },
      { id: 'algebra_quadratic', name: 'Quadratic Equations' },
      { id: 'calculus_differentiation', name: 'Differentiation' },
      { id: 'calculus_integration', name: 'Integration' },
    ],
    physics: [
      { id: 'physics_mechanics', name: 'Mechanics' },
      { id: 'physics_optics', name: 'Optics' },
      { id: 'physics_electromagnetism', name: 'Electromagnetism' },
    ],
    chemistry: [
      { id: 'chemistry_organic', name: 'Organic Chemistry' },
      { id: 'chemistry_inorganic', name: 'Inorganic Chemistry' },
    ],
    biology: [
      { id: 'biology_cell', name: 'Cell Biology' },
      { id: 'biology_genetics', name: 'Genetics' },
    ],
    english: [
      { id: 'english_grammar', name: 'Grammar' },
      { id: 'english_vocabulary', name: 'Vocabulary' },
    ],
  };

  const availableTopics = subjectId ? topicsBySubject[subjectId] || [] : [];

  const validateStep = useCallback((step: number): string[] => {
    const errors: string[] = [];

    if (step === 0) {
      if (!questionText.trim() || questionText.trim().length < 10) {
        errors.push('Question text must be at least 10 characters');
      }
      const emptyOptions = options.filter((o) => !o.text.trim());
      if (emptyOptions.length > 0) {
        errors.push(`Options ${emptyOptions.map((o) => o.id).join(', ')} cannot be empty`);
      }
      if (!correctAnswer) {
        errors.push('Please select the correct answer');
      }
      if (!explanation.trim() || explanation.trim().length < 20) {
        errors.push('Explanation must be at least 20 characters');
      }
    }

    if (step === 1) {
      if (!subjectId) errors.push('Subject is required');
      if (!topicId) errors.push('Topic is required');
      if (marks <= 0 || marks > 100) errors.push('Marks must be between 1 and 100');
    }

    return errors;
  }, [questionText, options, correctAnswer, explanation, subjectId, topicId, marks]);

  const handleNext = () => {
    const errors = validateStep(activeStep);
    if (errors.length > 0) {
      setSubmitError(errors.join('. '));
      return;
    }
    setSubmitError(null);
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setSubmitError(null);
    setActiveStep((prev) => prev - 1);
  };

  const handleSubmit = async () => {
    if (!user) {
      setSubmitError('You must be logged in to submit questions');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const collegeId = user.collegeId || localStorage.getItem('vriddhi_college_id') || 'default';
      const isSuperadmin = user.role === 'superadmin';

      // College submissions are tagged `college-contributed` and private to the
      // college until reviewed; superadmin submissions are platform-curated,
      // free, public and trusted (auto-approved). See design §6.
      const ownershipTags = isSuperadmin
        ? ['vriddhi-curated', 'free']
        : ['college-contributed'];

      const createdBy = {
        userId: user.uid || user.id || '',
        userName: user.name || (isSuperadmin ? 'Vriddhi' : 'Faculty'),
        collegeId: isSuperadmin ? null : collegeId,
        collegeName: (user as any)?.collegeName || (isSuperadmin ? 'Vriddhi' : 'Unknown College'),
        role: (isSuperadmin ? 'superadmin' : (user.role as any) || 'faculty') as 'superadmin' | 'admin' | 'faculty',
      };

      // Figures first: the upload is the slow, failure-prone half, and a
      // question document that points at an object which was never stored is
      // worse than a submission refused with a reason. The path built here is
      // the one storage.rules grants (images/questions/{collegeId}/...), so the
      // object a staff member uploads is the object a student's browser loads
      // mid-test.
      const storageCollegeId = isSuperadmin ? 'platform' : collegeId;
      const uploadedImages = images.length
        ? await uploadQuestionImages(images, {
            collegeId: storageCollegeId,
            subjectId: subjectId || 'General',
            topicId: topicId || 'General',
            questionId: `draft-${Date.now().toString(36)}`,
            questionText,
          })
        : [];

      const resolvedOptions = options.map((o) => ({
        id: o.id,
        text: o.text,
        isCorrect: o.isCorrect || o.id === correctAnswer,
      }));

      const resolvedAnswer =
        correctAnswer || resolvedOptions.find((o) => o.isCorrect)?.text || '';

      const result = await questionStorageApi.createQuestion({
        meta: {
          subjectId: subjectId || 'General',
          topicId: topicId || 'General',
          subTopicId: subTopicId || '',
          difficulty: difficulty as any,
          questionType: questionType as any,
          marks,
          language: 'en',
          tags: [...new Set([...tags, ...ownershipTags])],
          status: isSuperadmin ? 'approved' : 'pending',
          visibility: isSuperadmin ? 'public' : 'college_only',
          sharedWith: [],
          source: isSuperadmin ? 'platform' : 'college',
          storagePath: uploadedImages[0]?.storagePath || '',
          hasImage: uploadedImages.length > 0,
          qualityRating: 0,
          usageCount: 0,
          createdBy,
        },
        content: {
          questionText,
          options: resolvedOptions,
          correctAnswer: resolvedAnswer,
          explanation,
          hint,
          difficulty: difficulty as any,
          questionType: questionType as any,
          marks,
          language: 'en',
          tags: [...new Set([...tags, ...ownershipTags])],
          images: uploadedImages,
          hasImage: uploadedImages.length > 0,
          subjectId: subjectId || 'General',
          topicId: topicId || 'General',
          subTopicId: subTopicId || '',
        },
      });

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to submit question');
      }

      setSubmittedQuestionId(result.data.id);
      setSuccessOpen(true);
      if (onSuccess) onSuccess(result.data.id);
    } catch (error) {
      setSubmitError((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setQuestionText('');
    setOptions([
      { id: 'A', text: '', isCorrect: false },
      { id: 'B', text: '', isCorrect: false },
      { id: 'C', text: '', isCorrect: false },
      { id: 'D', text: '', isCorrect: false },
    ]);
    setCorrectAnswer('');
    setExplanation('');
    setHint('');
    setSubjectId('');
    setTopicId('');
    setSubTopicId('');
    setDifficulty('medium');
    setQuestionType('mcq');
    setMarks(1);
    setTags([]);
    setImages([]);
    setActiveStep(0);
    setSubmitError(null);
  };

  // Safe college name access
  const getCollegeName = () => {
    // User type has collegeId, not collegeName per memory
    return (user as any)?.collegeName || 'Unknown College';
  };

  return (
    <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h4" sx={{ fontWeight: 700 }} gutterBottom>
        Submit Question to Universal Pool
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Your question will be reviewed by a superadmin before being added to the universal pool.
      </Typography>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {submitError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {submitError}
        </Alert>
      )}

      {/* Step 1: Question Content */}
      {activeStep === 0 && (
        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
              Question Text
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={3}
              placeholder="Enter your question here..."
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              error={questionText.length > 0 && questionText.length < 10}
              helperText={questionText.length > 0 && questionText.length < 10 ? 'Minimum 10 characters' : `${questionText.length} characters`}
            />
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
              Options
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              Click the circle to mark the correct answer
            </Typography>
            <OptionEditor
              options={options}
              onChange={setOptions}
              correctAnswer={correctAnswer}
              onCorrectChange={setCorrectAnswer}
            />
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
              Explanation
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={4}
              placeholder="Provide a detailed explanation of the correct answer..."
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              error={explanation.length > 0 && explanation.length < 20}
              helperText={explanation.length > 0 && explanation.length < 20 ? 'Minimum 20 characters' : `${explanation.length} characters`}
            />
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
              Hint (Optional)
            </Typography>
            <TextField
              fullWidth
              placeholder="Optional hint for students..."
              value={hint}
              onChange={(e) => setHint(e.target.value)}
            />
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
              Images (Optional)
            </Typography>
            <ImageUploader images={images} onChange={setImages} />
          </Box>
        </Stack>
      )}

      {/* Step 2: Configuration */}
      {activeStep === 1 && (
        <Stack spacing={3}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <Box sx={{ flex: '1 1 250px', minWidth: 250 }}>
              <FormControl fullWidth>
                <InputLabel>Subject *</InputLabel>
                <Select
                  value={subjectId}
                  label="Subject *"
                  onChange={(e) => {
                    setSubjectId(e.target.value);
                    setTopicId('');
                  }}
                  error={!subjectId}
                >
                  <MenuItem value="">Select Subject</MenuItem>
                  {subjects.map((s) => (
                    <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ flex: '1 1 250px', minWidth: 250 }}>
              <FormControl fullWidth disabled={!subjectId}>
                <InputLabel>Topic *</InputLabel>
                <Select
                  value={topicId}
                  label="Topic *"
                  onChange={(e) => setTopicId(e.target.value)}
                  error={!topicId}
                >
                  <MenuItem value="">Select Topic</MenuItem>
                  {availableTopics.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <Box sx={{ flex: '1 1 200px', minWidth: 200 }}>
              <FormControl fullWidth>
                <InputLabel>Difficulty *</InputLabel>
                <Select
                  value={difficulty}
                  label="Difficulty *"
                  onChange={(e) => setDifficulty(e.target.value as DifficultyLevel)}
                >
                  <MenuItem value="easy">Easy</MenuItem>
                  <MenuItem value="medium">Medium</MenuItem>
                  <MenuItem value="hard">Hard</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ flex: '1 1 200px', minWidth: 200 }}>
              <FormControl fullWidth>
                <InputLabel>Question Type *</InputLabel>
                <Select
                  value={questionType}
                  label="Question Type *"
                  onChange={(e) => setQuestionType(e.target.value as QuestionType)}
                >
                  <MenuItem value="mcq">Multiple Choice</MenuItem>
                  <MenuItem value="true_false">True/False</MenuItem>
                  <MenuItem value="short_answer">Short Answer</MenuItem>
                  <MenuItem value="long_answer">Long Answer</MenuItem>
                  <MenuItem value="fill_in_blank">Fill in Blank</MenuItem>
                  <MenuItem value="match">Match</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ flex: '1 1 150px', minWidth: 150 }}>
              <TextField
                fullWidth
                label="Marks *"
                type="number"
                value={marks}
                onChange={(e) => setMarks(Math.max(1, Math.min(100, parseInt(e.target.value) || 0)))}
                slotProps={{ htmlInput: { min: 1, max: 100 } }}
              />
            </Box>
          </Box>

          <Box>
            <Autocomplete
              multiple
              freeSolo
              options={['algebra', 'calculus', 'mechanics', 'organic', 'cell', 'grammar']}
              value={tags}
              onChange={(_, newValue) => setTags(newValue)}
              renderInput={(params) => (
                <TextField {...params} label="Tags" placeholder="Add relevant tags..." />
              )}
            />
          </Box>
        </Stack>
      )}

      {/* Step 3: Review */}
      {activeStep === 2 && (
        <Stack spacing={3}>
          <Typography variant="h6" gutterBottom>
            Review Your Question
          </Typography>

          <MuiPaper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="primary" gutterBottom>
              Question
            </Typography>
            <Typography variant="body1" sx={{ mb: 2 }}>
              {questionText}
            </Typography>

            <Typography variant="subtitle2" color="primary" gutterBottom>
              Options
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
              {options.map((opt) => (
                <Box
                  key={opt.id}
                  sx={{
                    p: 1,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: opt.isCorrect ? 'success.main' : 'divider',
                    bgcolor: opt.isCorrect ? 'success.light' : 'transparent',
                  }}
                >
                  <Typography>
                    <strong>{opt.id}.</strong> {opt.text}
                    {opt.isCorrect && (
                      <Chip label="Correct" size="small" color="success" sx={{ ml: 1 }} />
                    )}
                  </Typography>
                </Box>
              ))}
            </Box>

            <Typography variant="subtitle2" color="primary" gutterBottom>
              Explanation
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {explanation}
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Chip label={`Subject: ${subjects.find((s) => s.id === subjectId)?.name || subjectId}`} />
              <Chip label={`Topic: ${availableTopics.find((t) => t.id === topicId)?.name || topicId}`} />
              <Chip label={`Difficulty: ${difficulty}`} />
              <Chip label={`Type: ${questionType}`} />
              <Chip label={`Marks: ${marks}`} />
              {tags.map((tag) => (
                <Chip key={tag} label={tag} variant="outlined" size="small" />
              ))}
            </Box>
          </MuiPaper>

          <Alert severity="info">
            By submitting, you agree that this question will be shared in the universal pool and may be used by any college after approval.
          </Alert>
        </Stack>
      )}

      {/* Navigation */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            disabled={activeStep === 0 || isSubmitting}
            onClick={handleBack}
            startIcon={<BackIcon />}
          >
            Back
          </Button>
          {onClose && (
            <Button onClick={onClose} color="inherit">
              Cancel
            </Button>
          )}
        </Box>

        {activeStep < steps.length - 1 ? (
          <Button
            variant="contained"
            onClick={handleNext}
            endIcon={<NextIcon />}
          >
            Next
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={isSubmitting}
            startIcon={isSubmitting ? <CircularProgress size={20} /> : <CheckIcon />}
          >
            {isSubmitting ? 'Submitting...' : 'Submit for Review'}
          </Button>
        )}
      </Box>

      {/* Success Dialog */}
      <SuccessDialog
        open={successOpen}
        onClose={() => {
          setSuccessOpen(false);
          if (onClose) onClose();
        }}
        questionId={submittedQuestionId}
        onSubmitAnother={handleReset}
      />
    </Box>
  );
}

export default QuestionSubmissionForm;