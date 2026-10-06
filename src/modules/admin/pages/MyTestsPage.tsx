// src/modules/admin/pages/MyTestsPage.tsx
// My Tests + Create from Template.
//
// Tab 1 "My tests"  — every Create Test template of this college: edit,
//                     duplicate, schedule (gated on readiness), archive.
// Tab 2 "Templates" — the platform library. The Vriddhi assessment team
//                     authors a test, verifies it by taking it, and shares the
//                     TEST CODE. Any college's staff look that code up, read
//                     the pattern, and Duplicate it into their own college —
//                     one read + one write, because questions are embedded.
//
// Platform templates live in `paperTemplates`, which the Firestore rules make
// readable by staff of EVERY college (cross-college by design) while each
// duplicate is written into the copying college's own `papers` doc.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogContentText, DialogTitle, Divider,
  IconButton, InputAdornment, Menu, MenuItem, Paper, Stack, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField,
  Tooltip, Typography,
} from '@mui/material'
import {
  Add as AddIcon,
  Archive as ArchiveIcon,
  CheckCircle as ReadyIcon,
  ContentCopy as CopyIcon,
  Edit as EditIcon,
  MoreVert as MoreIcon,
  Public as PublicIcon,
  Refresh as RefreshIcon,
  Schedule as ScheduleIcon,
  Search as SearchIcon,
  Visibility as PreviewIcon,
  Warning as BlockedIcon,
} from '@mui/icons-material'
import { useAuth } from '@/modules/auth/context/AuthContext'
import {
  TEST_KIND_LABELS,
  TEST_SECTION_TYPE_LABELS,
  type TestTemplate,
} from '@/shared/types/testTemplate'
import { cohortLabel, sectionTotals, summaryLine, testReadiness } from '@/shared/utils/testTemplate'
import {
  archiveCollegeTest,
  duplicateIntoCollege,
  findPlatformTemplateByCode,
  listCollegeTests,
  listPlatformTemplates,
  publishPlatformTemplate,
  type TestAuthor,
} from '../api/testTemplateApi'

/** Roles allowed to push a college test into the shared platform library. */
const PUBLISHER_ROLES = ['superadmin', 'employee']

function StatusChip({ test }: { test: TestTemplate }) {
  const readiness = testReadiness(test)
  return (
    <Chip
      size="small"
      color={readiness.ready ? 'success' : 'warning'}
      icon={readiness.ready ? <ReadyIcon /> : <BlockedIcon />}
      label={readiness.ready ? 'Ready' : 'Draft'}
      variant={readiness.ready ? 'filled' : 'outlined'}
    />
  )
}

export default function MyTestsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const basePath = location.pathname.startsWith('/faculty') ? '/faculty' : '/admin'
  const schedulePath = basePath === '/faculty' ? '/faculty/assessments' : '/admin/schedule-tests'

  const author: TestAuthor = useMemo(() => ({
    uid: user?.uid || user?.id || '',
    name: user?.name || 'Staff',
    collegeId: user?.collegeId || localStorage.getItem('vriddhi_college_id') || '',
  }), [user])

  const canPublish = PUBLISHER_ROLES.includes(String(user?.role ?? ''))

  const [tab, setTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tests, setTests] = useState<TestTemplate[]>([])
  const [templates, setTemplates] = useState<TestTemplate[]>([])
  const [search, setSearch] = useState('')
  const [codeLookup, setCodeLookup] = useState('')
  const [busyId, setBusyId] = useState('')
  const [preview, setPreview] = useState<TestTemplate | null>(null)
  const [menu, setMenu] = useState<{ anchor: HTMLElement; test: TestTemplate } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [mine, library] = await Promise.all([
        listCollegeTests(author.collegeId),
        listPlatformTemplates().catch(() => [] as TestTemplate[]),
      ])
      setTests(mine)
      setTemplates(library)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your tests.')
    } finally {
      setLoading(false)
    }
  }, [author.collegeId])

  useEffect(() => { void load() }, [load])

  const filteredTests = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return tests
    return tests.filter((t) => `${t.title} ${t.testCode} ${t.subject ?? ''} ${t.createdByName}`.toLowerCase().includes(term))
  }, [tests, search])

  const filteredTemplates = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return templates
    return templates.filter((t) => `${t.title} ${t.testCode} ${t.subject ?? ''}`.toLowerCase().includes(term))
  }, [templates, search])

  const handleDuplicate = async (source: TestTemplate) => {
    setBusyId(source.id)
    setError('')
    try {
      const id = await duplicateIntoCollege(source, author)
      setNotice(
        source.scope === 'platform'
          ? `"${source.title}" copied into your college. Review and schedule it.`
          : `Copy of "${source.title}" created.`,
      )
      await load()
      navigate(`${basePath}/create-test/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not duplicate this test.')
    } finally {
      setBusyId('')
    }
  }

  const handleLookup = async () => {
    setError('')
    setNotice('')
    try {
      const found = await findPlatformTemplateByCode(codeLookup)
      if (!found) { setError(`No shared test found for code "${codeLookup}".`); return }
      setPreview(found)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed.')
    }
  }

  const handleArchive = async (test: TestTemplate) => {
    setBusyId(test.id)
    try {
      await archiveCollegeTest(test.id)
      setNotice(`"${test.title}" archived.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive this test.')
    } finally {
      setBusyId('')
    }
  }

  const handlePublish = async (test: TestTemplate) => {
    setBusyId(test.id)
    try {
      await publishPlatformTemplate(test, author)
      setNotice(`"${test.title}" is now shared with every college as ${test.testCode}.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish this template.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>My Tests</Typography>
          <Typography variant="body2" color="text.secondary">
            Build a test once, duplicate it every term — or start from a test the Vriddhi assessment team has shared.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Reload">
            <IconButton onClick={() => void load()}><RefreshIcon /></IconButton>
          </Tooltip>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate(`${basePath}/create-test`)}>
            Create Test
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mt: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}

      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mt: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label={`My tests (${tests.length})`} />
        <Tab label={`Create from template (${templates.length})`} icon={<PublicIcon fontSize="small" />} iconPosition="end" />
      </Tabs>

      <TextField
        size="small"
        placeholder={tab === 0 ? 'Search your tests…' : 'Search shared templates…'}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mt: 2, width: { xs: '100%', sm: 360 } }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
      />

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}

      {/* ── Tab 1: my tests ─────────────────────────────────────────────── */}
      {!loading && tab === 0 && (
        filteredTests.length === 0 ? (
          <Card variant="outlined" sx={{ mt: 2 }}>
            <CardContent sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>No tests yet</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Create one from scratch, or duplicate a shared template to get a ready pattern in two clicks.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate(`${basePath}/create-test`)}>Create Test</Button>
                <Button startIcon={<PublicIcon />} onClick={() => setTab(1)}>Browse templates</Button>
              </Stack>
            </CardContent>
          </Card>
        ) : (
          <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Test</TableCell>
                  <TableCell>Code</TableCell>
                  <TableCell align="right">Sections</TableCell>
                  <TableCell align="right">Questions</TableCell>
                  <TableCell align="right">Marks</TableCell>
                  <TableCell align="right">Duration</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Owner</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredTests.map((test) => {
                  const totals = test.sections.reduce(
                    (acc, s) => {
                      const t = sectionTotals(s)
                      return { q: acc.q + t.questions, m: acc.m + t.marks, d: acc.d + t.durationMinutes }
                    },
                    { q: 0, m: 0, d: 0 },
                  )
                  const readiness = testReadiness(test)
                  return (
                    <TableRow key={test.id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{test.title}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {TEST_KIND_LABELS[test.kind]}
                          {test.subject ? ` · ${test.subject}` : ''}
                          {test.source ? ' · copied' : ''}
                        </Typography>
                      </TableCell>
                      <TableCell><Chip size="small" variant="outlined" label={test.testCode || '—'} /></TableCell>
                      <TableCell align="right">{test.sections.length}</TableCell>
                      <TableCell align="right">{totals.q}</TableCell>
                      <TableCell align="right">{totals.m}</TableCell>
                      <TableCell align="right">{totals.d} min</TableCell>
                      <TableCell><StatusChip test={test} /></TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">{test.createdByName || '—'}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                          <Tooltip title="Edit">
                            <IconButton size="small" onClick={() => navigate(`${basePath}/create-test/${test.id}`)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Duplicate">
                            <span>
                              <IconButton size="small" disabled={busyId === test.id} onClick={() => void handleDuplicate(test)}>
                                <CopyIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={readiness.ready ? 'Schedule' : readiness.blockers.join(' ')}>
                            <span>
                              <IconButton size="small" disabled={!readiness.ready} onClick={() => navigate(schedulePath)}>
                                <ScheduleIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <IconButton size="small" onClick={(e) => setMenu({ anchor: e.currentTarget, test })}>
                            <MoreIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* ── Tab 2: platform templates ───────────────────────────────────── */}
      {!loading && tab === 1 && (
        <Box sx={{ mt: 2 }}>
          <Card variant="outlined" sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Have a test ID?</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                The Vriddhi assessment team shares a test code once a pattern has been built and verified. Paste it
                here to review the pattern, then duplicate it into your college.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  size="small" placeholder="e.g. VQ-APTITUDE-01" value={codeLookup}
                  onChange={(e) => setCodeLookup(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleLookup() }}
                  sx={{ width: { xs: '100%', sm: 300 } }}
                />
                <Button variant="outlined" onClick={() => void handleLookup()} disabled={!codeLookup.trim()}>Look up</Button>
              </Stack>
            </CardContent>
          </Card>

          {filteredTemplates.length === 0 ? (
            <Alert severity="info">
              No shared templates are published yet. Once the assessment team publishes one, it appears here for every
              college.
            </Alert>
          ) : (
            <Stack spacing={1.5}>
              {filteredTemplates.map((template) => (
                <Card key={template.id} variant="outlined">
                  <CardContent>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                      <Box sx={{ minWidth: 240 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{template.title}</Typography>
                          <Chip size="small" label={template.testCode} variant="outlined" />
                          <Chip size="small" color="info" icon={<PublicIcon />} label="All colleges" />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {TEST_KIND_LABELS[template.kind]} · {summaryLine(template.sections)}
                        </Typography>
                        {template.templateNotes && (
                          <Typography variant="caption" color="text.secondary">{template.templateNotes}</Typography>
                        )}
                      </Box>
                      <Stack direction="row" spacing={1}>
                        <Button size="small" startIcon={<PreviewIcon />} onClick={() => setPreview(template)}>
                          View pattern
                        </Button>
                        <Button
                          size="small" variant="contained" startIcon={<CopyIcon />}
                          disabled={busyId === template.id}
                          onClick={() => void handleDuplicate(template)}
                        >
                          Duplicate
                        </Button>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* Row overflow menu */}
      <Menu anchorEl={menu?.anchor ?? null} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { if (menu) setPreview(menu.test); setMenu(null) }}>
          <PreviewIcon fontSize="small" style={{ marginRight: 8 }} /> View pattern
        </MenuItem>
        {canPublish && (
          <MenuItem
            onClick={() => { if (menu) void handlePublish(menu.test); setMenu(null) }}
          >
            <PublicIcon fontSize="small" style={{ marginRight: 8 }} /> Share with all colleges
          </MenuItem>
        )}
        <Divider />
        <MenuItem
          onClick={() => { if (menu) void handleArchive(menu.test); setMenu(null) }}
          sx={{ color: 'error.main' }}
        >
          <ArchiveIcon fontSize="small" style={{ marginRight: 8 }} /> Archive
        </MenuItem>
      </Menu>

      {/* Pattern preview — what a faculty member verifies before duplicating */}
      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {preview?.title}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {preview?.testCode} · {preview ? summaryLine(preview.sections) : ''}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {preview?.description && <DialogContentText sx={{ mb: 2 }}>{preview.description}</DialogContentText>}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Section</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Questions</TableCell>
                <TableCell align="right">Marks</TableCell>
                <TableCell align="right">Duration</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(preview?.sections ?? []).map((section, index) => {
                const t = sectionTotals(section)
                return (
                  <TableRow key={section.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>{section.name}</TableCell>
                    <TableCell>{TEST_SECTION_TYPE_LABELS[section.type]}</TableCell>
                    <TableCell align="right">{t.questions}</TableCell>
                    <TableCell align="right">{t.marks}</TableCell>
                    <TableCell align="right">{t.durationMinutes} min</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {preview?.cohorts?.length ? (
            <Stack direction="row" spacing={0.5} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 0.5 }}>
              {preview.cohorts.map((cohort, i) => <Chip key={i} size="small" variant="outlined" label={cohortLabel(cohort)} />)}
            </Stack>
          ) : null}
          {preview?.instructions && (
            <Alert severity="info" sx={{ mt: 2 }}>{preview.instructions}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)}>Close</Button>
          {preview && (
            <Button
              variant="contained" startIcon={<CopyIcon />}
              onClick={() => { const source = preview; setPreview(null); void handleDuplicate(source) }}
            >
              Duplicate to my college
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  )
}
