// src/components/question-bank/QuestionForm.tsx
// ─── Question Form Component ────────────────────────────

import React, { useState } from 'react'
import {
  Box,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Button,
  Grid,
  Typography,
  IconButton,
  Paper,
  FormControlLabel,
  Switch,
} from '@mui/material'
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material'
import type { Question, QuestionType, DifficultyLevel } from '../../types/questionBank'
import { parseLearningOutcomes } from '../../utils/questionForm'

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'mcq', label: 'Multiple Choice' },
  { value: 'true_false', label: 'True/False' },
  { value: 'fill_in_blank', label: 'Fill in Blank' },
  { value: 'short_answer', label: 'Short Answer' },
  { value: 'long_answer', label: 'Long Answer' },
  { value: 'matching', label: 'Matching' },
  { value: 'assertion_reason', label: 'Assertion & Reason' },
  { value: 'case_based', label: 'Case Based' },
]

const DIFFICULTY_LEVELS: { value: DifficultyLevel; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

interface QuestionFormProps {
  initialData?: Partial<Question>
  subjects: string[]
  onSubmit: (data: Omit<Question, 'id' | 'createdAt' | 'updatedAt' | 'collegeId' | 'createdBy' | 'createdByName' | 'usageCount' | 'linkedPaperIds'>) => void
  onCancel?: () => void
}

const QuestionForm: React.FC<QuestionFormProps> = ({
  initialData,
  subjects,
  onSubmit,
  onCancel,
}) => {
  const [formData, setFormData] = useState({
    text: initialData?.text || '',
    type: (initialData?.type || 'mcq') as QuestionType,
    difficulty: (initialData?.difficulty || 'medium') as DifficultyLevel,
    subject: initialData?.subject || '',
    chapter: initialData?.chapter || '',
    topic: initialData?.topic || '',
    marks: initialData?.marks || 1,
    negativeMarks: initialData?.negativeMarks || 0,
    options: (initialData?.options || [
      { id: 'a', text: '', isCorrect: false },
      { id: 'b', text: '', isCorrect: false },
      { id: 'c', text: '', isCorrect: false },
      { id: 'd', text: '', isCorrect: false },
    ]) as { id: string; text: string; isCorrect?: boolean }[],
    correctAnswer: (initialData?.correctAnswer || '') as string,
    explanation: initialData?.explanation || '',
    tags: initialData?.tags || [],
    bloomLevel: initialData?.bloomLevel || '',
    moduleNo: initialData?.moduleNo ? String(initialData.moduleNo) : '',
    moduleName: initialData?.moduleName || '',
    learningOutcomesText: (initialData?.learningOutcomes || []).join('\n'),
    isPYQ: initialData?.isPYQ || false,
    examYear: initialData?.examYear || '',
    examName: initialData?.examName || '',
    batch: initialData?.batch || '',
    branch: initialData?.branch || '',
    unit: initialData?.unit || '',
  })

  const [newTag, setNewTag] = useState('')

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleOptionChange = (index: number, text: string) => {
    const newOptions = [...formData.options]
    newOptions[index] = { ...newOptions[index], text }
    handleChange('options', newOptions)
  }

  const handleCorrectAnswerChange = (index: number) => {
    if (formData.type === 'mcq') {
      const newOptions = formData.options.map((opt, i) => ({
        ...opt,
        isCorrect: i === index,
      }))
      handleChange('options', newOptions)
      handleChange('correctAnswer', formData.options[index].id)
    }
  }

  const addOption = () => {
    const newId = String.fromCharCode(97 + formData.options.length)
    handleChange('options', [...formData.options, { id: newId, text: '', isCorrect: false }])
  }

  const removeOption = (index: number) => {
    if (formData.options.length <= 2) return
    const newOptions = formData.options.filter((_, i) => i !== index)
    handleChange('options', newOptions)
  }

  const addTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      handleChange('tags', [...formData.tags, newTag.trim()])
      setNewTag('')
    }
  }

  const removeTag = (tag: string) => {
    handleChange('tags', formData.tags.filter((t: string) => t !== tag))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const { moduleNo, learningOutcomesText, ...rest } = formData
    const parsedModule = Number(moduleNo)
    onSubmit({
      ...rest,
      ...(Number.isInteger(parsedModule) && parsedModule > 0 ? { moduleNo: parsedModule } : {}),
      learningOutcomes: parseLearningOutcomes(learningOutcomesText),
    } as any)
  }

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12 }}>
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Question Text *"
            value={formData.text}
            onChange={e => handleChange('text', e.target.value)}
            required
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <FormControl fullWidth>
            <InputLabel>Subject *</InputLabel>
            <Select
              value={formData.subject}
              onChange={e => handleChange('subject', e.target.value)}
              label="Subject *"
              required
            >
              {subjects.map(s => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <FormControl fullWidth>
            <InputLabel>Question Type *</InputLabel>
            <Select
              value={formData.type}
              onChange={e => handleChange('type', e.target.value)}
              label="Question Type *"
            >
              {QUESTION_TYPES.map(t => (
                <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <FormControl fullWidth>
            <InputLabel>Difficulty *</InputLabel>
            <Select
              value={formData.difficulty}
              onChange={e => handleChange('difficulty', e.target.value)}
              label="Difficulty *"
            >
              {DIFFICULTY_LEVELS.map(d => (
                <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            fullWidth
            type="number"
            label="Marks *"
            value={formData.marks}
            onChange={e => handleChange('marks', parseInt(e.target.value) || 0)}
            slotProps={{ input: { inputProps: { min: 1 } } }}
            required
          />
        </Grid>

        {formData.type === 'mcq' && (
          <Grid size={{ xs: 12 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Options *
              </Typography>
              {formData.options.map((opt, i) => (
                <Box key={opt.id} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={opt.isCorrect || false}
                        onChange={() => handleCorrectAnswerChange(i)}
                        size="small"
                      />
                    }
                    label={String.fromCharCode(97 + i)}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    value={opt.text}
                    onChange={e => handleOptionChange(i, e.target.value)}
                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                  />
                  {formData.options.length > 2 && (
                    <IconButton onClick={() => removeOption(i)} size="small" color="error">
                      <DeleteIcon />
                    </IconButton>
                  )}
                </Box>
              ))}
              <Button startIcon={<AddIcon />} onClick={addOption} size="small" variant="outlined">
                Add Option
              </Button>
            </Paper>
          </Grid>
        )}

        {formData.type !== 'mcq' && (
          <Grid size={{ xs: 12 }}>
            <TextField
              fullWidth
              label="Correct Answer"
              value={formData.correctAnswer}
              onChange={e => handleChange('correctAnswer', e.target.value)}
              placeholder="Enter the correct answer"
            />
          </Grid>
        )}

        <Grid size={{ xs: 12 }}>
          <TextField
            fullWidth
            multiline
            rows={2}
            label="Explanation"
            value={formData.explanation}
            onChange={e => handleChange('explanation', e.target.value)}
          />
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Engineering / NBA outcome tags
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Module, Bloom and course-outcome tags are used by engineering scheme paper templates and OBE attainment checks.
            </Typography>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth size="small" type="number" label="Module number"
                  value={formData.moduleNo}
                  onChange={(event) => handleChange('moduleNo', event.target.value)}
                  slotProps={{ htmlInput: { min: 1, step: 1 } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth size="small" label="Module name"
                  value={formData.moduleName}
                  onChange={(event) => handleChange('moduleName', event.target.value)}
                  placeholder="Optional module title"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Bloom level</InputLabel>
                  <Select
                    value={formData.bloomLevel}
                    label="Bloom level"
                    onChange={(event) => handleChange('bloomLevel', event.target.value)}
                  >
                    <MenuItem value="">Not tagged</MenuItem>
                    {['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((level, index) => (
                      <MenuItem key={level} value={level}>{level} · {['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'][index]}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth multiline minRows={2} size="small" label="Course outcomes / CO tags"
                  value={formData.learningOutcomesText}
                  onChange={(event) => handleChange('learningOutcomesText', event.target.value)}
                  placeholder={'CO1\nCO2'}
                  helperText="Enter one outcome code or statement per line."
                />
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Tags
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Add a tag..."
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
              />
              <Button variant="outlined" onClick={addTag} size="small">
                Add
              </Button>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {formData.tags.map((tag, i) => (
                <Chip key={i} label={tag} onDelete={() => removeTag(tag)} size="small" />
              ))}
            </Box>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
            {onCancel && (
              <Button variant="outlined" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button variant="contained" type="submit">
              {initialData?.id ? 'Update' : 'Create'} Question
            </Button>
          </Box>
        </Grid>
      </Grid>
    </Box>
  )
}

export default QuestionForm
