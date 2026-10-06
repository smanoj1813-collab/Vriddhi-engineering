// src/modules/admin/pages/CreateTestWizard.tsx
// Create Test — the 2-step wizard (details → sections) plus the confirmation
// screen with the section table. Shared by the faculty, HOD/admin and
// employee portals (routes in both modules point here).
//
// Proctoring is ON HOLD (decision D3): the wizard is 2 steps, there is no
// greyed third tab, and the saved test carries no `proctoring` block. The
// free integrity floor (clipboard lock, tab/focus counting) applies to every
// test regardless — see docs/ASSESSMENT_CREATE_TEST_FLOW.md §4.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, FormControlLabel,
  IconButton, MenuItem, Paper, Stack, Step, StepLabel, Stepper, Switch, Table,
  TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import {
  Add as AddIcon,
  ArrowBack as BackIcon,
  CheckCircle as ReadyIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Schedule as ScheduleIcon,
  Warning as BlockedIcon,
} from '@mui/icons-material'
import { useAuth } from '@/modules/auth/context/AuthContext'
import {
  TEST_KIND_LABELS,
  TEST_SECTION_TYPES,
  TEST_SECTION_TYPE_LABELS,
  defaultDeliverySettings,
  type TestCohort,
  type TestKind,
  type TestSection,
  type TestTemplate,
} from '@/shared/types/testTemplate'
import {
  MARKS_PRESETS,
  PENALTY_PRESETS,
  cohortLabel,
  createEmptySection,
  createSections,
  fractionPenalty,
  normalizeTestCode,
  sectionTotals,
  suggestTestCode,
  summaryLine,
  testReadiness,
  testTotals,
  validateSections,
  validateTestDetails,
} from '@/shared/utils/testTemplate'
import {
  createCollegeTest,
  getCollegeTest,
  updateCollegeTest,
  type TestAuthor,
} from '../api/testTemplateApi'

const STEPS = ['Test details', 'Sections']

export default function CreateTestWizard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { id: routeId } = useParams()
  const basePath = location.pathname.startsWith('/faculty') ? '/faculty' : '/admin'

  const author: TestAuthor = {
    uid: user?.uid || user?.id || '',
    name: user?.name || 'Staff',
    collegeId: user?.collegeId || localStorage.getItem('vriddhi_college_id') || '',
  }

  const [step, setStep] = useState(0)
  const [savedId, setSavedId] = useState<string | null>(routeId ?? null)
  const [loading, setLoading] = useState(Boolean(routeId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // ── Step 1 state ───────────────────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [testCode, setTestCode] = useState('')
  const [kind, setKind] = useState<TestKind>('internal')
  const [subject, setSubject] = useState('')
  const [program, setProgram] = useState('')
  const [branch, setBranch] = useState('')
  const [semester, setSemester] = useState<number | ''>('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [cohorts, setCohorts] = useState<TestCohort[]>([])
  const [cohortDraft, setCohortDraft] = useState<TestCohort>({})
  const [delivery, setDelivery] = useState(defaultDeliverySettings())
  const [sectionCount, setSectionCount] = useState(1)

  // ── Step 2 state ───────────────────────────────────────────────────────────
  const [sections, setSections] = useState<TestSection[]>(() => createSections(1))
  const [sectionIndex, setSectionIndex] = useState(0)

  useEffect(() => {
    if (!routeId) return
    let cancelled = false
    getCollegeTest(routeId)
      .then((test) => {
        if (cancelled || !test) return
        setTitle(test.title)
        setTestCode(test.testCode)
        setKind(test.kind)
        setSubject(test.subject ?? '')
        setProgram(test.program ?? '')
        setBranch(test.branch ?? '')
        setSemester(typeof test.semester === 'number' ? test.semester : '')
        setDescription(test.description)
        setInstructions(test.instructions)
        setCohorts(test.cohorts)
        setDelivery(test.delivery)
        setSections(test.sections.length ? test.sections : createSections(1))
        setSectionCount(test.sections.length || 1)
        setDone(true)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this test.'))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [routeId])

  const draftTemplate: Omit<TestTemplate, 'id' | 'scope'> = useMemo(() => ({
    title,
    testCode: normalizeTestCode(testCode),
    kind,
    subject,
    program,
    branch,
    ...(semester === '' ? {} : { semester: Number(semester) }),
    description,
    instructions,
    cohorts,
    delivery,
    sections,
    testStatus: 'draft',
    collegeId: author.collegeId,
    createdBy: author.uid,
    createdByName: author.name,
  }), [title, testCode, kind, subject, program, branch, semester, description, instructions, cohorts, delivery, sections, author.collegeId, author.uid, author.name])

  const readiness = useMemo(
    () => testReadiness({ title, testCode, sections }),
    [title, testCode, sections],
  )
  const totals = useMemo(() => testTotals(sections), [sections])

  const updateSection = (index: number, patch: Partial<TestSection>) => {
    setSections((prev) => prev.map((section, i) => (i === index ? { ...section, ...patch } : section)))
  }

  const handleNextFromDetails = () => {
    const errors = validateTestDetails({ title, testCode, sectionCount, maxTabSwitches: delivery.maxTabSwitches })
    if (errors.length) { setError(errors[0]); return }
    setError('')
    // Section count is add-only: growing adds blanks, shrinking is refused
    // (a locked-forever count is a support ticket — §4).
    setSections((prev) => (sectionCount > prev.length
      ? [...prev, ...Array.from({ length: sectionCount - prev.length }, (_, i) => createEmptySection(prev.length + i + 1))]
      : prev))
    setStep(1)
  }

  const handleSave = async () => {
    const errors = validateSections(sections)
    if (errors.length) { setError(errors[0]); return }
    if (!author.collegeId) { setError('No college is linked to this account.'); return }
    setSaving(true)
    setError('')
    try {
      if (savedId) {
        await updateCollegeTest(savedId, draftTemplate, author)
      } else {
        const id = await createCollegeTest(draftTemplate, author)
        setSavedId(id)
      }
      setDone(true)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the test.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <Box sx={{ p: 4 }}><Typography color="text.secondary">Loading test…</Typography></Box>
  }

  // ── Confirmation screen ────────────────────────────────────────────────────
  if (step === 2 && done) {
    return (
      <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <Button size="small" startIcon={<BackIcon />} onClick={() => navigate(`${basePath}/my-tests`)}>My Tests</Button>
        </Stack>
        <Alert severity="success" sx={{ mb: 2 }}>
          <strong>{title}</strong> is saved. Add questions to each section from the table below, then schedule it.
        </Alert>

        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Stack direction="row" sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {normalizeTestCode(testCode)} · {TEST_KIND_LABELS[kind]} · {summaryLine(sections)}
                </Typography>
              </Box>
              <Chip
                color={readiness.ready ? 'success' : 'warning'}
                icon={readiness.ready ? <ReadyIcon /> : <BlockedIcon />}
                label={readiness.ready ? 'Ready to schedule' : 'Draft — questions pending'}
              />
            </Stack>
            {cohorts.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                {cohorts.map((cohort, i) => <Chip key={i} size="small" variant="outlined" label={cohortLabel(cohort)} />)}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Paper variant="outlined" sx={{ mb: 2, overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>S.No</TableCell>
                <TableCell>Section name</TableCell>
                <TableCell align="right">Questions</TableCell>
                <TableCell align="right">Total marks</TableCell>
                <TableCell align="right">Duration</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Add / edit questions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sections.map((section, index) => {
                const t = sectionTotals(section)
                return (
                  <TableRow key={section.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>{section.name}</TableCell>
                    <TableCell align="right">
                      {t.questions}
                      {section.plannedQuestions ? ` / ${section.plannedQuestions}` : ''}
                    </TableCell>
                    <TableCell align="right">{t.marks}</TableCell>
                    <TableCell align="right">{t.durationMinutes} min</TableCell>
                    <TableCell><Chip size="small" label={TEST_SECTION_TYPE_LABELS[section.type]} variant="outlined" /></TableCell>
                    <TableCell align="right">
                      <Tooltip title="Question attachment ships in the next round (library picker + custom editor). The section structure is saved.">
                        <span>
                          <Button size="small" startIcon={<AddIcon />} disabled>Add questions</Button>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Paper>

        {!readiness.ready && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Before this test can be scheduled: {readiness.blockers.join(' ')}
          </Alert>
        )}

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setStep(0)}>Edit test</Button>
          <Button variant="outlined" startIcon={<CopyIcon />} onClick={() => navigate(`${basePath}/my-tests`)}>
            Duplicate from My Tests
          </Button>
          <Tooltip title={readiness.ready ? '' : 'Every section needs at least one question first.'}>
            <span>
              <Button
                variant="contained"
                startIcon={<ScheduleIcon />}
                disabled={!readiness.ready}
                onClick={() => navigate(`${basePath}${basePath === '/faculty' ? '/assessments' : '/schedule-tests'}`)}
              >
                Schedule this test
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Box>
    )
  }

  // ── Wizard ─────────────────────────────────────────────────────────────────
  const section = sections[sectionIndex] ?? sections[0]

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>{savedId ? 'Edit Test' : 'Create Test'}</Typography>
      <Typography variant="body2" color="text.secondary">
        Note — nothing here is final. You can edit every field later.
      </Typography>

      <Stepper activeStep={step} sx={{ my: 3 }}>
        {STEPS.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {step === 0 && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="overline" color="text.secondary">Step 1 of 2</Typography>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Name of the test" required value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField
                  label="Test code" required value={testCode}
                  onChange={(e) => setTestCode(e.target.value)}
                  onBlur={() => setTestCode(normalizeTestCode(testCode))}
                  helperText="Shared with colleagues to find this test. Letters, numbers and dashes."
                  sx={{ flex: 1 }}
                />
                <Button
                  onClick={() => setTestCode(suggestTestCode({ branch, subject, kind, year: new Date().getFullYear() }))}
                  sx={{ alignSelf: 'flex-start', mt: 1 }}
                >
                  Suggest
                </Button>
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField select label="Test type" value={kind} onChange={(e) => setKind(e.target.value as TestKind)} sx={{ minWidth: 220 }}>
                  {(Object.keys(TEST_KIND_LABELS) as TestKind[]).map((value) => (
                    <MenuItem key={value} value={value}>{TEST_KIND_LABELS[value]}</MenuItem>
                  ))}
                </TextField>
                <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} sx={{ flex: 1 }} />
                <TextField
                  label="Number of sections" type="number" value={sectionCount}
                  onChange={(e) => setSectionCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  disabled={Boolean(savedId)}
                  helperText={savedId ? 'Add more sections in step 2' : 'You can add more later; you cannot remove below this.'}
                  sx={{ width: 220 }}
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField label="Programme" value={program} onChange={(e) => setProgram(e.target.value)} sx={{ flex: 1 }} />
                <TextField label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} sx={{ flex: 1 }} />
                <TextField
                  label="Semester" type="number" value={semester}
                  onChange={(e) => setSemester(e.target.value === '' ? '' : Number(e.target.value))}
                  sx={{ width: 160 }}
                />
              </Stack>

              <Divider />
              <Typography variant="overline" color="text.secondary">Who the test is for</Typography>
              <Typography variant="caption" color="text.secondary">
                Leave empty to keep it open to every batch — the scheduler picks the exact students later.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField size="small" label="Branch" value={cohortDraft.branch ?? ''} onChange={(e) => setCohortDraft({ ...cohortDraft, branch: e.target.value })} />
                <TextField size="small" label="Batch" value={cohortDraft.batch ?? ''} onChange={(e) => setCohortDraft({ ...cohortDraft, batch: e.target.value })} />
                <TextField size="small" label="Section" value={cohortDraft.section ?? ''} onChange={(e) => setCohortDraft({ ...cohortDraft, section: e.target.value })} />
                <Button
                  startIcon={<AddIcon />}
                  onClick={() => {
                    if (!cohortDraft.branch && !cohortDraft.batch && !cohortDraft.section) return
                    setCohorts([...cohorts, cohortDraft])
                    setCohortDraft({})
                  }}
                >
                  Add
                </Button>
              </Stack>
              {cohorts.length > 0 && (
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                  {cohorts.map((cohort, i) => (
                    <Chip key={i} label={cohortLabel(cohort)} onDelete={() => setCohorts(cohorts.filter((_, j) => j !== i))} />
                  ))}
                </Stack>
              )}

              <Divider />
              <TextField label="Test description" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} fullWidth />
              <TextField label="Test instructions (shown before the test starts)" value={instructions} onChange={(e) => setInstructions(e.target.value)} multiline minRows={3} fullWidth />

              <Divider />
              <Typography variant="overline" color="text.secondary">Delivery</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                <TextField
                  label="Tab switches allowed" type="number" value={delivery.maxTabSwitches}
                  onChange={(e) => setDelivery({ ...delivery, maxTabSwitches: Math.max(0, Number(e.target.value) || 0) })}
                  helperText="0 = no switching tolerated"
                  sx={{ width: 220 }}
                />
                <FormControlLabel
                  control={<Switch checked={delivery.shuffleQuestions} onChange={(e) => setDelivery({ ...delivery, shuffleQuestions: e.target.checked })} />}
                  label="Jumble questions"
                />
                <FormControlLabel
                  control={<Switch checked={delivery.shuffleOptions} onChange={(e) => setDelivery({ ...delivery, shuffleOptions: e.target.checked })} />}
                  label="Jumble options"
                />
                <FormControlLabel
                  control={<Switch checked={delivery.shuffleSections} onChange={(e) => setDelivery({ ...delivery, shuffleSections: e.target.checked })} />}
                  label="Jumble sections"
                />
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                <FormControlLabel
                  control={(
                    <Switch
                      checked={delivery.candidateReport.enabled}
                      onChange={(e) => setDelivery({ ...delivery, candidateReport: { ...delivery.candidateReport, enabled: e.target.checked } })}
                    />
                  )}
                  label="Show performance report to candidates"
                />
                <TextField
                  select size="small" label="When" sx={{ width: 220 }}
                  value={delivery.candidateReport.when}
                  disabled={!delivery.candidateReport.enabled}
                  onChange={(e) => setDelivery({ ...delivery, candidateReport: { ...delivery.candidateReport, when: e.target.value as 'immediately' | 'after_window' | 'manual' } })}
                >
                  <MenuItem value="immediately">Immediately after submit</MenuItem>
                  <MenuItem value="after_window">After the test window closes</MenuItem>
                  <MenuItem value="manual">When staff release it</MenuItem>
                </TextField>
                {['score', 'answers', 'explanations', 'stats'].map((item) => (
                  <Chip
                    key={item}
                    size="small"
                    label={item}
                    variant={delivery.candidateReport.show.includes(item) ? 'filled' : 'outlined'}
                    color={delivery.candidateReport.show.includes(item) ? 'primary' : 'default'}
                    disabled={!delivery.candidateReport.enabled}
                    onClick={() => setDelivery({
                      ...delivery,
                      candidateReport: {
                        ...delivery.candidateReport,
                        show: delivery.candidateReport.show.includes(item)
                          ? delivery.candidateReport.show.filter((x) => x !== item)
                          : [...delivery.candidateReport.show, item],
                      },
                    })}
                  />
                ))}
              </Stack>

              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button onClick={() => navigate(`${basePath}/my-tests`)}>Cancel</Button>
                <Button variant="contained" onClick={handleNextFromDetails}>Next</Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      {step === 1 && section && (
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="overline" color="text.secondary">Step 2 of 2 — section {sectionIndex + 1}/{sections.length}</Typography>
              <Chip size="small" label={summaryLine(sections)} />
            </Stack>

            <Stack spacing={2} sx={{ mt: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField
                  label="Name of the section" required value={section.name}
                  onChange={(e) => updateSection(sectionIndex, { name: e.target.value })}
                  sx={{ flex: 1 }}
                />
                <TextField
                  select label="Type of section" value={section.type}
                  onChange={(e) => updateSection(sectionIndex, { type: e.target.value as TestSection['type'] })}
                  sx={{ minWidth: 240 }}
                >
                  {TEST_SECTION_TYPES.map((value) => (
                    <MenuItem key={value} value={value}>{TEST_SECTION_TYPE_LABELS[value]}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Duration (minutes)" type="number" value={section.durationMinutes}
                  onChange={(e) => updateSection(sectionIndex, { durationMinutes: Math.max(0, Number(e.target.value) || 0) })}
                  sx={{ width: 190 }}
                />
              </Stack>

              <TextField
                label="Section instructions" value={section.instructions}
                onChange={(e) => updateSection(sectionIndex, { instructions: e.target.value })}
                multiline minRows={2} fullWidth
              />

              <Box>
                <Typography variant="overline" color="text.secondary">Default correct marks</Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mt: 0.5 }}>
                  {MARKS_PRESETS.map((value) => (
                    <Chip
                      key={value} label={value} clickable
                      color={section.defaultCorrectMarks === value ? 'primary' : 'default'}
                      variant={section.defaultCorrectMarks === value ? 'filled' : 'outlined'}
                      onClick={() => updateSection(sectionIndex, { defaultCorrectMarks: value })}
                    />
                  ))}
                  <TextField
                    size="small" type="number" label="Custom" sx={{ width: 120 }}
                    value={section.defaultCorrectMarks}
                    onChange={(e) => updateSection(sectionIndex, { defaultCorrectMarks: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  You can set custom marks per question when you add questions.
                </Typography>
              </Box>

              <Box>
                <Typography variant="overline" color="text.secondary">Default incorrect mark penalty</Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mt: 0.5 }}>
                  {PENALTY_PRESETS.map((value) => (
                    <Chip
                      key={value} label={value === 0 ? 'None' : value} clickable
                      color={section.defaultPenalty === value ? 'primary' : 'default'}
                      variant={section.defaultPenalty === value ? 'filled' : 'outlined'}
                      onClick={() => updateSection(sectionIndex, { defaultPenalty: value })}
                    />
                  ))}
                  <Chip
                    label="1/4 of correct" clickable variant="outlined"
                    onClick={() => updateSection(sectionIndex, { defaultPenalty: fractionPenalty(section.defaultCorrectMarks, 4) })}
                  />
                  <Chip
                    label="1/3 of correct" clickable variant="outlined"
                    onClick={() => updateSection(sectionIndex, { defaultPenalty: fractionPenalty(section.defaultCorrectMarks, 3) })}
                  />
                  <TextField
                    size="small" type="number" label="Custom" sx={{ width: 120 }}
                    value={section.defaultPenalty}
                    onChange={(e) => updateSection(sectionIndex, { defaultPenalty: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </Stack>
              </Box>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'center' }}>
                <TextField
                  label="Planned questions" type="number" value={section.plannedQuestions}
                  onChange={(e) => updateSection(sectionIndex, { plannedQuestions: Math.max(0, Number(e.target.value) || 0) })}
                  helperText="Target used by the pool-health check"
                  sx={{ width: 220 }}
                />
                <FormControlLabel
                  control={<Switch checked={section.lockOnSubmit} onChange={(e) => updateSection(sectionIndex, { lockOnSubmit: e.target.checked })} />}
                  label="Lock this section once submitted"
                />
              </Stack>

              <Divider />
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 }}>
                <Stack direction="row" spacing={1}>
                  <Button disabled={sectionIndex === 0} onClick={() => setSectionIndex(sectionIndex - 1)}>Previous</Button>
                  <Button
                    disabled={sectionIndex >= sections.length - 1}
                    onClick={() => setSectionIndex(sectionIndex + 1)}
                  >
                    Next section
                  </Button>
                  <Button
                    startIcon={<AddIcon />}
                    onClick={() => {
                      setSections([...sections, createEmptySection(sections.length + 1)])
                      setSectionIndex(sections.length)
                    }}
                  >
                    Add section
                  </Button>
                  {sections.length > 1 && (
                    <IconButton
                      aria-label="Remove this section"
                      onClick={() => {
                        const next = sections.filter((_, i) => i !== sectionIndex).map((s, i) => ({ ...s, order: i + 1 }))
                        setSections(next)
                        setSectionIndex(Math.max(0, sectionIndex - 1))
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
                <Stack direction="row" spacing={1}>
                  <Button onClick={() => setStep(0)}>Back to details</Button>
                  <Button variant="contained" disabled={saving} onClick={handleSave}>
                    {saving ? 'Saving…' : savedId ? 'Save changes' : 'Create test'}
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        {totals.sections} section{totals.sections === 1 ? '' : 's'} · {totals.marks} marks planned
      </Typography>
    </Box>
  )
}
