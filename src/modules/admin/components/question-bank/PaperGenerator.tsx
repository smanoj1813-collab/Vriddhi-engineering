// src/components/question-bank/PaperGenerator.tsx
// ─── Paper Generator Agent Component ────────────────────

import React, { useEffect, useState } from 'react'
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Stepper,
  Step,
  StepLabel,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton,
  Divider,
  Alert,
  AlertTitle,
  Card,
  CardContent,
  CardActions,
  Stack,
  Slider,
  Switch,
  FormControlLabel,
  Grid,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material'
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  AutoAwesome as AutoIcon,
  Preview as PreviewIcon,
  Save as SaveIcon,
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
  Download as DownloadIcon,
} from '@mui/icons-material'
import { usePaperGenerator } from '../../hooks/usePaperGenerator'
import { useQuestionBank } from '../../hooks/useQuestionBank'
import { downloadPaperPDF } from '../../../../shared/utils/pdfDownloader'
import type { GenerationConfig, PaperSection } from '../../types/questionBank'
import { DEFAULT_PROGRAMS } from '@/shared/constants/academicPrograms'
import { getCollegeSchemePack } from '../../api/schemePackApi'
import QuestionPreview from './QuestionPreview'

const STEPS = ['Configure Paper', 'Define Sections', 'Review & Generate']

const EXAM_TYPES = [
  { value: 'midterm', label: 'Mid Term' },
  { value: 'endterm', label: 'End Term' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'sessional', label: 'Sessional' },
  { value: 'practical', label: 'Practical' },
] as const

const QUESTION_TYPE_OPTIONS = [
  { value: 'any', label: 'Any Type' },
  { value: 'mcq', label: 'MCQ' },
  { value: 'short', label: 'Short Answer' },
  { value: 'long', label: 'Long Answer' },
  { value: 'numerical', label: 'Numerical' },
] as const

interface PaperGeneratorProps {
  batches: string[]
  branches: string[]
  subjects: string[]
  programs?: string[]
  onPaperCreated?: (paperId: string) => void
}

const PaperGenerator: React.FC<PaperGeneratorProps> = ({
  batches,
  branches,
  subjects,
  programs = DEFAULT_PROGRAMS,
  onPaperCreated,
}) => {
  const { generate, generatedResult, generating, error, clearGenerated, currentPaper } = usePaperGenerator()
  const { stats } = useQuestionBank()

  const [activeStep, setActiveStep] = useState(0)
  const [showPreview, setShowPreview] = useState(false)
  const [downloadState, setDownloadState] = useState<{ busy: boolean; notice?: string; error?: string }>({ busy: false })

  const handleDownloadPDF = async () => {
    const paper = generatedResult?.paper
    if (!paper) return
    setDownloadState({ busy: true })
    try {
      // Falls back to the in-browser renderer when the server answers 503 { fallback: 'client' }.
      // The generated sections (with question text) are passed so no refetch is needed.
      const result = await downloadPaperPDF(paper.id, paper.title || 'paper', {
        paper: { ...paper, sections: generatedResult?.sections || paper.sections || [] },
      })
      setDownloadState({ busy: false, notice: result.renderedBy === 'client' ? result.notice : undefined })
    } catch (err: any) {
      setDownloadState({ busy: false, error: err?.message || 'Failed to download PDF' })
    }
  }

  // Paper config
  const [config, setConfig] = useState<{
    title: string
    subject: string
    examType: string
    totalMarks: number
    duration: number
    batch: string
    branch: string
    program: string
    courseType: string
    useSchemeTemplate: boolean
    date: string
    instructions: string[]
    includePYQ: boolean
    pyqRatio: number
    mode: 'bank' | 'ai' | 'hybrid'
    numSets: number
  }>({
    title: '',
    subject: '',
    examType: 'midterm',
    totalMarks: 100,
    duration: 180,
    batch: '',
    branch: '',
    program: '',
    courseType: '_default',
    useSchemeTemplate: false,
    date: new Date().toISOString().split('T')[0],
    instructions: [
      'All questions are compulsory unless stated otherwise.',
      'Write your name and roll number on the answer sheet.',
      'No electronic devices allowed.',
    ],
    includePYQ: false,
    pyqRatio: 0.2,
    mode: 'bank',
    numSets: 1,
  })

  const [resolvedScheme, setResolvedScheme] = useState<Awaited<ReturnType<typeof getCollegeSchemePack>> | null>(null)
  const availablePrograms = programs.length > 0 ? programs : DEFAULT_PROGRAMS
  const courseTypeOptions = Object.keys(resolvedScheme?.pack.engineering?.courseTypes ?? { _default: { internal: 0, external: 0 } })
  const schemeTemplate = resolvedScheme?.pack.engineering?.paperTemplate

  useEffect(() => {
    let active = true
    getCollegeSchemePack(undefined, {
      programId: config.program,
      branchId: config.branch,
      admissionBatch: config.batch,
    }).then((resolved) => {
      if (active) setResolvedScheme(resolved)
    }).catch(() => {
      if (active) setResolvedScheme(null)
    })
    return () => { active = false }
  }, [config.program, config.branch, config.batch])

  const applySchemeTemplate = () => {
    if (!schemeTemplate) return
    const difficultyMix = (count: number) => {
      const easy = Math.floor(count / 3)
      const hard = Math.floor(count / 3)
      return { easy, medium: count - easy - hard, hard }
    }
    const nextSections: PaperSection[] = schemeTemplate.modules
      ? Array.from({ length: schemeTemplate.modules }, (_, index) => {
          const moduleNo = index + 1
          const numQuestions = schemeTemplate.questionsPerModule ?? 2
          const toAttempt = 1
          const title = `Module ${moduleNo}`
          return {
            id: `scheme-module-${moduleNo}`,
            name: title,
            title,
            description: `Choose ${toAttempt} of ${numQuestions} questions`,
            marksPerQuestion: schemeTemplate.marksPerFullQuestion ?? Math.max(1, Math.floor(schemeTemplate.rawTotal / schemeTemplate.modules!)),
            numQuestions,
            compulsory: false,
            toAttempt,
            moduleNo,
            unitFilter: String(moduleNo),
            questionType: 'any',
            difficulty: 'mixed',
            difficultyMix: difficultyMix(numQuestions),
          }
        })
      : (schemeTemplate.sections ?? []).map((section, index) => ({
          id: `scheme-${section.code || index + 1}`,
          name: section.label,
          title: section.label,
          description: `Choose ${section.toAttempt} of ${section.questions} questions`,
          marksPerQuestion: section.marksEach,
          numQuestions: section.questions,
          compulsory: section.toAttempt >= section.questions,
          toAttempt: section.toAttempt,
          questionType: 'any',
          difficulty: 'mixed',
          difficultyMix: difficultyMix(section.questions),
        }))
    if (nextSections.length === 0) return
    setSections(nextSections)
    setConfig((previous) => ({
      ...previous,
      totalMarks: schemeTemplate.rawTotal,
      duration: schemeTemplate.durationMinutes,
      mode: 'bank',
      numSets: 1,
      useSchemeTemplate: true,
    }))
  }

  // Sections - now with all required PaperSection fields
  const [sections, setSections] = useState<PaperSection[]>([
    {
      id: 'sec-a',
      name: 'Section A',
      title: 'Section A',
      description: 'Multiple Choice Questions',
      marksPerQuestion: 2,
      numQuestions: 10,
      compulsory: true,
      questionType: 'mcq',
      difficulty: 'medium',
      difficultyMix: { easy: 4, medium: 4, hard: 2 },
    },
    {
      id: 'sec-b',
      name: 'Section B',
      title: 'Section B',
      description: 'Short Answer Questions',
      marksPerQuestion: 5,
      numQuestions: 6,
      compulsory: true,
      questionType: 'short',
      difficulty: 'medium',
      difficultyMix: { easy: 2, medium: 3, hard: 1 },
    },
    {
      id: 'sec-c',
      name: 'Section C',
      title: 'Section C',
      description: 'Long Answer Questions',
      marksPerQuestion: 10,
      numQuestions: 3,
      compulsory: true,
      questionType: 'long',
      difficulty: 'medium',
      difficultyMix: { easy: 1, medium: 1, hard: 1 },
    },
  ])

  const [newInstruction, setNewInstruction] = useState('')

  // ─── Handlers ─────────────────────────────────────────
  const handleConfigChange = (field: string, value: any) => {
    setConfig((prev: any) => ({ ...prev, [field]: value }))
  }

  const handleSectionChange = (index: number, field: string, value: any) => {
    setSections(prev =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    )
  }

  const handleDifficultyChange = (index: number, level: 'easy' | 'medium' | 'hard', value: number) => {
    setSections(prev =>
      prev.map((s, i) =>
        i === index
          ? { ...s, difficultyMix: { ...s.difficultyMix!, [level]: value } }
          : s
      )
    )
  }

  const addSection = () => {
    const nextChar = String.fromCharCode(65 + sections.length)
    const newId = `sec-${nextChar.toLowerCase()}`
    setSections(prev => [
      ...prev,
      {
        id: newId,
        name: `Section ${nextChar}`,
        title: `Section ${nextChar}`,
        description: '',
        marksPerQuestion: 5,
        numQuestions: 5,
        compulsory: true,
        questionType: 'any',
        difficulty: 'medium',
        difficultyMix: { easy: 2, medium: 2, hard: 1 },
      },
    ])
  }

  const removeSection = (index: number) => {
    setSections(prev => prev.filter((_, i) => i !== index))
  }

  const addInstruction = () => {
    if (newInstruction.trim()) {
      setConfig((prev: any) => ({
        ...prev,
        instructions: [...prev.instructions, newInstruction.trim()],
      }))
      setNewInstruction('')
    }
  }

  const removeInstruction = (index: number) => {
    setConfig((prev: any) => ({
      ...prev,
      instructions: prev.instructions.filter((_: string, i: number) => i !== index),
    }))
  }

  // ─── Validation ───────────────────────────────────────
  const validateStep = (step: number): boolean => {
    if (step === 0) {
      if (!config.title.trim()) return false
      if (!config.subject) return false
      if (!config.batch) return false
      if (!config.branch) return false
      if (config.totalMarks <= 0) return false
      if (config.duration <= 0) return false
    }
    if (step === 1) {
      if (sections.length === 0) return false
      for (const sec of sections) {
        if (!sec.name.trim()) return false
        if (sec.numQuestions <= 0) return false
        if (sec.marksPerQuestion <= 0) return false
        const totalDiff = (sec.difficultyMix?.easy || 0) + (sec.difficultyMix?.medium || 0) + (sec.difficultyMix?.hard || 0)
        if (totalDiff !== sec.numQuestions) return false
      }
    }
    return true
  }

  // ─── Generate ─────────────────────────────────────────
  const handleGenerate = async () => {
    const generationConfig: any = {
      subject: config.subject,
      totalMarks: config.totalMarks,
      duration: config.duration,
      title: config.title,
      instructions: config.instructions,
      sections,
      mode: config.mode,
      numSets: config.numSets,
      batch: config.batch,
      branch: config.branch,
      program: config.program,
      courseType: config.courseType,
      useSchemeTemplate: config.useSchemeTemplate,
    }

    try {
      await generate(generationConfig)
      setActiveStep(2)
    } catch {
      // Error handled by hook
    }
  }

  // ─── Navigation ───────────────────────────────────────
  const handleNext = () => {
    if (validateStep(activeStep)) {
      if (activeStep === 1) {
        handleGenerate()
      } else {
        setActiveStep(prev => prev + 1)
      }
    }
  }

  const handleBack = () => {
    setActiveStep(prev => prev - 1)
    if (activeStep === 2) clearGenerated()
  }

  const handleReset = () => {
    setActiveStep(0)
    clearGenerated()
  }

  const applyPreset = (preset: 'midterm50' | 'final100' | 'quiz20') => {
    if (preset === 'midterm50') {
      setConfig(prev => ({ ...prev, totalMarks: 50, duration: 90, examType: 'midterm' }))
      setSections([
        { id: 'sec-a', name: 'Section A', title: 'Section A', description: 'Multiple Choice Questions', marksPerQuestion: 1, numQuestions: 10, compulsory: true, questionType: 'mcq', difficulty: 'medium', difficultyMix: { easy: 4, medium: 4, hard: 2 } },
        { id: 'sec-b', name: 'Section B', title: 'Section B', description: 'Short Answer Questions', marksPerQuestion: 5, numQuestions: 4, compulsory: true, questionType: 'short', difficulty: 'medium', difficultyMix: { easy: 1, medium: 2, hard: 1 } },
        { id: 'sec-c', name: 'Section C', title: 'Section C', description: 'Long Answer Questions', marksPerQuestion: 10, numQuestions: 2, compulsory: true, questionType: 'long', difficulty: 'medium', difficultyMix: { easy: 0, medium: 1, hard: 1 } },
      ])
    } else if (preset === 'final100') {
      setConfig(prev => ({ ...prev, totalMarks: 100, duration: 180, examType: 'endterm' }))
      setSections([
        { id: 'sec-a', name: 'Section A', title: 'Section A', description: 'Multiple Choice Questions', marksPerQuestion: 2, numQuestions: 10, compulsory: true, questionType: 'mcq', difficulty: 'medium', difficultyMix: { easy: 4, medium: 4, hard: 2 } },
        { id: 'sec-b', name: 'Section B', title: 'Section B', description: 'Short Answer Questions', marksPerQuestion: 5, numQuestions: 6, compulsory: true, questionType: 'short', difficulty: 'medium', difficultyMix: { easy: 2, medium: 3, hard: 1 } },
        { id: 'sec-c', name: 'Section C', title: 'Section C', description: 'Long Answer Questions', marksPerQuestion: 10, numQuestions: 5, compulsory: true, questionType: 'long', difficulty: 'medium', difficultyMix: { easy: 1, medium: 3, hard: 1 } },
      ])
    } else if (preset === 'quiz20') {
      setConfig(prev => ({ ...prev, totalMarks: 20, duration: 25, examType: 'quiz' }))
      setSections([
        { id: 'sec-a', name: 'Section A', title: 'Section A', description: 'Quick MCQ Section', marksPerQuestion: 1, numQuestions: 10, compulsory: true, questionType: 'mcq', difficulty: 'easy', difficultyMix: { easy: 6, medium: 3, hard: 1 } },
        { id: 'sec-b', name: 'Section B', title: 'Section B', description: 'Concept Questions', marksPerQuestion: 5, numQuestions: 2, compulsory: true, questionType: 'short', difficulty: 'medium', difficultyMix: { easy: 1, medium: 1, hard: 0 } },
      ])
    }
  }

  // ─── Render Steps ─────────────────────────────────────
  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <Box sx={{ mt: 3 }}>
            {/* Quick Blueprint Presets */}
            <Box sx={{ mb: 3, p: 2, borderRadius: 2.5, bgcolor: 'background.default', border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', display: 'block', mb: 1 }}>
                ⚡ Quick Exam Blueprint Presets
              </Typography>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" color="primary" onClick={() => applyPreset('midterm50')}>
                  Midterm Exam (50 Marks · 90m)
                </Button>
                <Button size="small" variant="outlined" color="secondary" onClick={() => applyPreset('final100')}>
                  Final Semester (100 Marks · 180m)
                </Button>
                <Button size="small" variant="outlined" color="info" onClick={() => applyPreset('quiz20')}>
                  Quick Quiz (20 Marks · 25m)
                </Button>
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {resolvedScheme
                    ? `Scheme: ${resolvedScheme.pack.name} · resolved by ${resolvedScheme.resolution}`
                    : 'Scheme pack unavailable; standard paper presets remain available.'}
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!schemeTemplate}
                  onClick={applySchemeTemplate}
                >
                  Apply scheme paper template{schemeTemplate ? ` · ${schemeTemplate.code}` : ''}
                </Button>
              </Stack>
            </Box>

            <Grid container spacing={3}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  label="Paper Title *"
                  value={config.title}
                  onChange={e => handleConfigChange('title', e.target.value)}
                  placeholder="e.g., Mid Term Examination - Mathematics I"
                />
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Subject *</InputLabel>
                  <Select
                    value={config.subject}
                    onChange={e => handleConfigChange('subject', e.target.value)}
                    label="Subject *"
                  >
                    {subjects.map(s => (
                      <MenuItem key={s} value={s}>{s}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Programme (scheme scope)</InputLabel>
                  <Select
                    value={config.program}
                    onChange={e => handleConfigChange('program', e.target.value)}
                    label="Programme (scheme scope)"
                  >
                    <MenuItem value="">College default</MenuItem>
                    {availablePrograms.map((program) => (
                      <MenuItem key={program} value={program}>{program}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Exam Type *</InputLabel>
                  <Select
                    value={config.examType}
                    onChange={e => handleConfigChange('examType', e.target.value)}
                    label="Exam Type *"
                  >
                    {EXAM_TYPES.map(t => (
                      <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <TextField
                  fullWidth
                  type="number"
                  label="Total Marks *"
                  value={config.totalMarks}
                  onChange={e => handleConfigChange('totalMarks', parseInt(e.target.value) || 0)}
                  slotProps={{ input: { inputProps: { min: 1 } } }}
                />
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <TextField
                  fullWidth
                  type="number"
                  label="Duration (minutes) *"
                  value={config.duration}
                  onChange={e => handleConfigChange('duration', parseInt(e.target.value) || 0)}
                  slotProps={{ input: { inputProps: { min: 1 } } }}
                />
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <FormControl fullWidth>
                  <InputLabel>Batch *</InputLabel>
                  <Select
                    value={config.batch}
                    onChange={e => handleConfigChange('batch', e.target.value)}
                    label="Batch *"
                  >
                    {batches.map(b => (
                      <MenuItem key={b} value={b}>{b}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <FormControl fullWidth>
                  <InputLabel>Branch *</InputLabel>
                  <Select
                    value={config.branch}
                    onChange={e => handleConfigChange('branch', e.target.value)}
                    label="Branch *"
                  >
                    {branches.map(b => (
                      <MenuItem key={b} value={b}>{b}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              {resolvedScheme?.pack.engineering?.courseTypes && (
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <FormControl fullWidth>
                    <InputLabel>Course type</InputLabel>
                    <Select
                      value={config.courseType}
                      onChange={e => handleConfigChange('courseType', e.target.value)}
                      label="Course type"
                    >
                      {courseTypeOptions.map((courseType) => (
                        <MenuItem key={courseType} value={courseType}>{courseType}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              )}

              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <FormControl fullWidth>
                  <InputLabel>Generation Engine</InputLabel>
                  <Select
                    value={config.mode}
                    onChange={e => handleConfigChange('mode', e.target.value)}
                    label="Generation Engine"
                  >
                    <MenuItem value="bank">📚 Question Bank Only</MenuItem>
                    <MenuItem value="ai">🤖 AI Agent (One-Shot Creation)</MenuItem>
                    <MenuItem value="hybrid">🔄 Hybrid (Bank + AI Auto-Fill)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <FormControl fullWidth>
                  <InputLabel>Exam Sets (Parallel Sets)</InputLabel>
                  <Select
                    value={config.numSets}
                    onChange={e => handleConfigChange('numSets', Number(e.target.value) || 1)}
                    label="Exam Sets (Parallel Sets)"
                  >
                    <MenuItem value={1}>1 Set (Standard Paper)</MenuItem>
                    <MenuItem value={2}>2 Sets (Set A &amp; Set B)</MenuItem>
                    <MenuItem value={3}>3 Sets (Set A, B &amp; C)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  type="date"
                  label="Exam Date *"
                  value={config.date}
                  onChange={e => handleConfigChange('date', e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>

              <Grid size={{ xs: 12 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Instructions
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="Add an instruction..."
                      value={newInstruction}
                      onChange={e => setNewInstruction(e.target.value)}
                      onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addInstruction())}
                    />
                    <Button variant="outlined" onClick={addInstruction} size="small">
                      Add
                    </Button>
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {config.instructions.map((inst, i) => (
                      <Chip
                        key={i}
                        label={`${i + 1}. ${inst}`}
                        onDelete={() => removeInstruction(i)}
                        size="small"
                        sx={{ maxWidth: '100%' }}
                      />
                    ))}
                  </Box>
                </Paper>
              </Grid>

              <Grid size={{ xs: 12 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.includePYQ}
                        onChange={e => handleConfigChange('includePYQ', e.target.checked)}
                      />
                    }
                    label="Include Previous Year Questions (PYQ)"
                  />
                  {config.includePYQ && (
                    <Box sx={{ mt: 2, px: 2 }}>
                      <Typography variant="body2" gutterBottom>
                        PYQ Ratio: {Math.round(config.pyqRatio * 100)}%
                      </Typography>
                      <Slider
                        value={config.pyqRatio}
                        onChange={(_, v) => handleConfigChange('pyqRatio', v as number)}
                        min={0}
                        max={1}
                        step={0.05}
                        marks={[
                          { value: 0, label: '0%' },
                          { value: 0.25, label: '25%' },
                          { value: 0.5, label: '50%' },
                          { value: 0.75, label: '75%' },
                          { value: 1, label: '100%' },
                        ]}
                        valueLabelDisplay="auto"
                        valueLabelFormat={v => `${Math.round(v * 100)}%`}
                      />
                    </Box>
                  )}
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )

      case 1:
        return (
          <Box sx={{ mt: 3 }}>
            {sections.map((section, index) => (
              <Card key={section.id} variant="outlined" sx={{ mb: 2 }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6">{section.name}</Typography>
                    {sections.length > 1 && (
                      <IconButton onClick={() => removeSection(index)} color="error" size="small">
                        <DeleteIcon />
                      </IconButton>
                    )}
                  </Box>

                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <TextField
                        fullWidth
                        label="Section Name *"
                        value={section.name}
                        onChange={e => handleSectionChange(index, 'name', e.target.value)}
                        size="small"
                      />
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <TextField
                        fullWidth
                        label="Description"
                        value={section.description || ''}
                        onChange={e => handleSectionChange(index, 'description', e.target.value)}
                        size="small"
                        placeholder="e.g., MCQs from Unit 1-3"
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <TextField
                        fullWidth
                        type="number"
                        label="Questions *"
                        value={section.numQuestions}
                        onChange={e => handleSectionChange(index, 'numQuestions', parseInt(e.target.value) || 0)}
                        size="small"
                        slotProps={{ input: { inputProps: { min: 1 } } }}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <TextField
                        fullWidth
                        type="number"
                        label="Marks/Q *"
                        value={section.marksPerQuestion}
                        onChange={e => handleSectionChange(index, 'marksPerQuestion', parseInt(e.target.value) || 0)}
                        size="small"
                        slotProps={{ input: { inputProps: { min: 1 } } }}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Question Type</InputLabel>
                        <Select
                          value={section.questionType}
                          onChange={e => handleSectionChange(index, 'questionType', e.target.value)}
                          label="Question Type"
                        >
                          {QUESTION_TYPE_OPTIONS.map(t => (
                            <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={section.compulsory || false}
                            onChange={e => handleSectionChange(index, 'compulsory', e.target.checked)}
                          />
                        }
                        label="Compulsory"
                      />
                    </Grid>
                  </Grid>

                  <Box sx={{ mt: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      Difficulty Mix (must total {section.numQuestions})
                    </Typography>
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                      {(['easy', 'medium', 'hard'] as const).map(level => (
                        <Grid size={{ xs: 4 }} key={level}>
                          <TextField
                            fullWidth
                            type="number"
                            label={level.charAt(0).toUpperCase() + level.slice(1)}
                            value={section.difficultyMix?.[level] || 0}
                            onChange={e =>
                              handleDifficultyChange(index, level, parseInt(e.target.value) || 0)
                            }
                            size="small"
                            slotProps={{ input: { inputProps: { min: 0 } } }}
                            color={
                              level === 'easy' ? 'success' : level === 'medium' ? 'warning' : 'error'
                            }
                          />
                        </Grid>
                      ))}
                    </Grid>
                    {(section.difficultyMix?.easy || 0) +
                      (section.difficultyMix?.medium || 0) +
                      (section.difficultyMix?.hard || 0) !== section.numQuestions && (
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        Difficulty mix must total {section.numQuestions} questions
                      </Alert>
                    )}
                  </Box>

                  <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
                    <Typography variant="caption" color="text.secondary">
                      Section Total: {(section.toAttempt ?? section.numQuestions) * section.marksPerQuestion} answerable marks
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            ))}

            <Button
              startIcon={<AddIcon />}
              onClick={addSection}
              variant="outlined"
              size="small"
              sx={{ mb: 2 }}
            >
              Add Section
            </Button>

            <Paper variant="outlined" sx={{ p: 2, backgroundColor: 'action.hover' }}>
              <Typography variant="subtitle2">
                Paper Summary
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total Questions: {sections.reduce((sum, s) => sum + s.numQuestions, 0)} | 
                Total Marks: {sections.reduce((sum, s) => sum + (s.toAttempt ?? s.numQuestions) * s.marksPerQuestion, 0)} / {config.totalMarks}
              </Typography>
              {sections.reduce((sum, s) => sum + (s.toAttempt ?? s.numQuestions) * s.marksPerQuestion, 0) !== config.totalMarks && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  Answerable section totals ({sections.reduce((sum, s) => sum + (s.toAttempt ?? s.numQuestions) * s.marksPerQuestion, 0)})
                  don't match configured total marks ({config.totalMarks}). The generator will still work.
                </Alert>
              )}
            </Paper>
          </Box>
        )

      case 2:
        if (generating) {
          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
              <CircularProgress size={60} sx={{ mb: 3 }} />
              <Typography variant="h6">Generating Paper...</Typography>
              <Typography variant="body2" color="text.secondary">
                Selecting questions from the bank based on your criteria
              </Typography>
            </Box>
          )
        }

        if (!generatedResult) {
          return (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">Something went wrong. Please go back and try again.</Typography>
            </Box>
          )
        }

        return (
          <Box sx={{ mt: 3 }}>
            {generatedResult?.warnings && generatedResult.warnings.length > 0 && (
              <Alert severity="warning" sx={{ mb: 3 }}>
                <AlertTitle>Warnings</AlertTitle>
                {(generatedResult?.warnings || []).map((w: string, i: number) => (
                  <Typography key={i} variant="body2">• {w}</Typography>
                ))}
              </Alert>
            )}

            {generatedResult.paper && (
              <Paper sx={{ p: 3, mb: 3, backgroundColor: 'success.light', color: 'success.contrastText' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <CheckIcon />
                  <Typography variant="h6">Paper Generated Successfully!</Typography>
                </Box>
                <Typography variant="body2">
                  <strong>{generatedResult.paper.title}</strong> — {generatedResult.paper.totalQuestions} questions, {generatedResult.paper.totalMarks} marks
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                  Paper ID: {generatedResult.paper.id} | Status: Draft
                </Typography>
              </Paper>
            )}

            {downloadState.error && (
              <Alert severity="error" sx={{ mb: 3 }} onClose={() => setDownloadState({ busy: false })}>
                {downloadState.error}
              </Alert>
            )}
            {downloadState.notice && (
              <Alert severity="info" sx={{ mb: 3 }} onClose={() => setDownloadState({ busy: false })}>
                {downloadState.notice}
              </Alert>
            )}

            {generatedResult?.sections?.map((sec, idx) => (
              <Card key={idx} variant="outlined" sx={{ mb: 2 }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6">
                      {sec.section?.name || sec.title} ({sec.matched || 0}/{sec.requested || sec.numQuestions} matched)
                    </Typography>
                    <Chip
                      label={`${sec.section?.marksPerQuestion || sec.marksPerQuestion} marks each`}
                      size="small"
                      color={(sec.matched || 0) === (sec.requested || sec.numQuestions) ? 'success' : 'warning'}
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {sec.section?.description || sec.instructions || ''}
                  </Typography>

                  <Divider sx={{ my: 1 }} />

                  {sec.questions.map((q, qIdx) => (
                    q && (
                      <Box key={q.id} sx={{ mb: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography variant="subtitle2">
                            Q{qIdx + 1}.
                          </Typography>
                          <Chip
                            label={q.difficulty}
                            size="small"
                            color={
                              q.difficulty === 'easy' ? 'success' :
                              q.difficulty === 'medium' ? 'warning' : 'error'
                            }
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                          {q.isPYQ && (
                            <Chip label="PYQ" size="small" color="secondary" sx={{ height: 20, fontSize: '0.7rem' }} />
                          )}
                        </Box>
                        <Typography variant="body2" sx={{ pl: 3 }}>
                          {(q.text || '').substring(0, 120)}{(q.text || '').length > 120 ? '...' : ''}
                        </Typography>
                      </Box>
                    )
                  ))}
                </CardContent>
              </Card>
            ))}

            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 3 }}>
              <Button
                variant="outlined"
                startIcon={<PreviewIcon />}
                onClick={() => setShowPreview(true)}
              >
                Full Preview
              </Button>
              {generatedResult.paper && (
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownloadPDF}
                  disabled={downloadState.busy}
                >
                  {downloadState.busy ? 'Preparing PDF…' : 'Download PDF'}
                </Button>
              )}
              {generatedResult.paper && (
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={() => onPaperCreated?.(generatedResult.paper!.id)}
                >
                  Done
                </Button>
              )}
            </Box>
          </Box>
        )

      default:
        return null
    }
  }

  return (
    <Box>
      <Typography variant="h5" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoIcon color="primary" />
        Paper Generator Agent
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Configure your paper and let the agent pick the best questions from your bank.
      </Typography>

      <Stepper activeStep={activeStep} sx={{ mt: 3, mb: 2 }}>
        {STEPS.map(label => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {renderStepContent()}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
        <Button
          disabled={activeStep === 0 || generating}
          onClick={handleBack}
          variant="outlined"
        >
          Back
        </Button>

        {activeStep < 2 ? (
          <Button
            variant="contained"
            onClick={handleNext}
            disabled={!validateStep(activeStep) || generating}
            startIcon={activeStep === 1 ? <AutoIcon /> : undefined}
          >
            {activeStep === 1 ? 'Generate Paper' : 'Next'}
          </Button>
        ) : (
          <Button variant="outlined" onClick={handleReset}>
            Create Another
          </Button>
        )}
      </Box>

      {/* Full Preview Dialog */}
      <Dialog open={showPreview} onClose={() => setShowPreview(false)} maxWidth="md" fullWidth>
        <DialogTitle>Paper Preview: {generatedResult?.paper?.title || 'Untitled'}</DialogTitle>
        <DialogContent dividers>
          {generatedResult?.sections?.map((sec, idx) => (
            <Box key={idx} sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                {sec.section?.name || sec.title}
              </Typography>
              {sec.questions.map((q, qIdx) => (
                q && (
                  <Box key={q.id} sx={{ mb: 2, pl: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Q{qIdx + 1}. [{q.marks || sec.section?.marksPerQuestion || sec.marksPerQuestion} marks]
                    </Typography>
                    <QuestionPreview question={q} />
                  </Box>
                )
              ))}
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPreview(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default PaperGenerator