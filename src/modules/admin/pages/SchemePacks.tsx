// src/modules/admin/pages/SchemePacks.tsx
// University Scheme Packs (G1) — the control room for "which university's
// rules does this college run on". One college assigns ONE pack; presets are
// verified-in-code, customs are authored here (clone a preset and edit).
// Everything downstream (result importer, hall tickets, compliance
// dashboard) reads through getCollegeSchemePack.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControlLabel, IconButton, MenuItem,
  Stack, Switch, TextField, Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  Add as AddIcon, AssignmentTurnedIn as AssignIcon, ContentCopy as CloneIcon,
  CloudUpload as SeedIcon, Delete as DeleteIcon, Edit as EditIcon, School as SchoolIcon,
} from '@mui/icons-material';
import {
  assignCollegeSchemePack,
  fetchSchemePackAssignments,
  fetchSchemePacks,
  getCollegeSchemePack,
  saveSchemePack,
  type ListedSchemePack,
} from '../api/schemePackApi';
import { useAuth } from '@/modules/auth/context/AuthContext';
import { gapcV40AttainmentRules } from '@/shared/utils/obeAttainment';
import { DEFAULT_SCHEME_PACK, ENGINEERING_SCHEME_PACKS, SCHEME_PACK_PRESETS } from '@/shared/types/schemePack';
import type {
  AttendanceMarksSlab,
  SchemeGrade,
  UniversitySchemePack,
} from '@/shared/types/schemePack';

// ─── Editor state ────────────────────────────────────────────────────────────

interface EditorState {
  id: string | null; // null = creating
  code: string;
  name: string;
  universityName: string;
  schemeName: string;
  applicableProgrammes: string; // comma separated
  mediums: string;
  minimumPercentage: number;
  blocksExamEligibility: boolean;
  slabs: AttendanceMarksSlab[];
  iaTotal: number;
  testCount: number;
  testMaxEach: number;
  testBestOf: number;
  testWeight: number;
  attendanceMax: number;
  assignmentMax: number;
  seeMax: number;
  seeScaleFrom: number;
  seeDuration: number;
  seePass: number;
  aggPass: number;
  minInternal: number;
  requireSeePass: boolean;
  grades: SchemeGrade[];
  sourceNote: string;
  courseTypesJson: string;
  gradingMethod: 'absolute' | 'relative';
  relativeBandsJson: string;
  minCohortSizeForRelative: number;
  percentageExpression: string;
  batchRulesJson: string;
  paperTemplateJson: string;
  attainmentJson: string;
}

function packToEditor(pack: UniversitySchemePack, newCode = ''): EditorState {
  return {
    id: newCode ? null : (pack.id.includes('__') ? pack.id : null),
    code: newCode || pack.code,
    name: pack.name,
    universityName: pack.universityName,
    schemeName: pack.schemeName,
    applicableProgrammes: pack.applicableProgrammes.join(', '),
    mediums: pack.mediums.join(', '),
    minimumPercentage: pack.attendance.minimumPercentage,
    blocksExamEligibility: pack.attendance.blocksExamEligibility,
    slabs: pack.attendance.marksSlabs.map((s) => ({ ...s })),
    iaTotal: pack.internalAssessment.totalMarks,
    testCount: pack.internalAssessment.test.count,
    testMaxEach: pack.internalAssessment.test.maxMarksEach,
    testBestOf: pack.internalAssessment.test.bestOf,
    testWeight: pack.internalAssessment.test.weightInTotal,
    attendanceMax: pack.internalAssessment.attendanceMaxMarks,
    assignmentMax: pack.internalAssessment.assignmentMaxMarks,
    seeMax: pack.semesterEndExam.defaultMaxMarks,
    seeScaleFrom: pack.semesterEndExam.scaleFrom ?? 0,
    seeDuration: pack.semesterEndExam.durationMinutes,
    seePass: pack.semesterEndExam.passPercentage,
    aggPass: pack.passCriteria.aggregatePassPercentage,
    minInternal: pack.passCriteria.minimumInternalPercentage,
    requireSeePass: pack.passCriteria.requireSemesterEndPass,
    grades: pack.gradeTable.map((g) => ({ ...g })),
    sourceNote: pack.sourceNote ?? '',
    courseTypesJson: JSON.stringify(pack.engineering?.courseTypes ?? {}, null, 2),
    gradingMethod: pack.engineering?.grading?.method ?? 'absolute',
    relativeBandsJson: JSON.stringify(pack.engineering?.grading?.relativeBands ?? [], null, 2),
    minCohortSizeForRelative: pack.engineering?.grading?.minCohortSizeForRelative ?? 30,
    percentageExpression: pack.engineering?.percentageConversion?.expression ?? '',
    batchRulesJson: JSON.stringify(pack.engineering?.percentageConversion?.batchRules ?? [], null, 2),
    paperTemplateJson: JSON.stringify(pack.engineering?.paperTemplate ?? {}, null, 2),
    attainmentJson: JSON.stringify(pack.engineering?.attainment ?? {}, null, 2),
  };
}

function parseEditorJson(text: string, label: string, emptyValue: unknown = {}): unknown {
  if (!text.trim()) return emptyValue;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

function editorToPayload(s: EditorState): Record<string, unknown> {
  const split = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const courseTypes = parseEditorJson(s.courseTypesJson, 'Course types') as Record<string, unknown>;
  const relativeBands = parseEditorJson(s.relativeBandsJson, 'Relative grade bands', []) as unknown[];
  const batchRules = parseEditorJson(s.batchRulesJson, 'CGPA batch rules', []) as unknown[];
  const paperTemplate = parseEditorJson(s.paperTemplateJson, 'Question-paper template') as Record<string, unknown>;
  const attainment = parseEditorJson(s.attainmentJson, 'OBE attainment rules') as Record<string, unknown>;
  if (!courseTypes || Array.isArray(courseTypes) || typeof courseTypes !== 'object') throw new Error('Course types must be a JSON object.');
  if (!Array.isArray(relativeBands)) throw new Error('Relative grade bands must be a JSON array.');
  if (!Array.isArray(batchRules)) throw new Error('CGPA batch rules must be a JSON array.');
  if (!paperTemplate || Array.isArray(paperTemplate) || typeof paperTemplate !== 'object') throw new Error('Question-paper template must be a JSON object.');
  if (!attainment || Array.isArray(attainment) || typeof attainment !== 'object') throw new Error('OBE attainment rules must be a JSON object.');

  const hasEngineering = Object.keys(courseTypes).length > 0
    || Boolean(s.percentageExpression.trim())
    || relativeBands.length > 0
    || Object.keys(paperTemplate).length > 0
    || Object.keys(attainment).length > 0;
  const engineering = hasEngineering ? {
    ...(Object.keys(courseTypes).length ? { courseTypes } : {}),
    grading: {
      method: s.gradingMethod,
      minCohortSizeForRelative: s.minCohortSizeForRelative,
      ...(relativeBands.length ? { relativeBands } : {}),
    },
    ...(s.percentageExpression.trim() ? {
      percentageConversion: {
        expression: s.percentageExpression.trim(),
        ...(batchRules.length ? { batchRules } : {}),
      },
    } : {}),
    ...(Object.keys(paperTemplate).length ? { paperTemplate } : {}),
    ...(Object.keys(attainment).length ? { attainment } : {}),
  } : undefined;

  return {
    code: s.code,
    name: s.name,
    universityName: s.universityName,
    schemeName: s.schemeName,
    applicableProgrammes: split(s.applicableProgrammes),
    mediums: split(s.mediums),
    attendance: {
      minimumPercentage: s.minimumPercentage,
      marksSlabs: s.slabs,
      blocksExamEligibility: s.blocksExamEligibility,
    },
    internalAssessment: {
      totalMarks: s.iaTotal,
      test: {
        count: s.testCount,
        maxMarksEach: s.testMaxEach,
        bestOf: s.testBestOf,
        weightInTotal: s.testWeight,
      },
      attendanceMaxMarks: s.attendanceMax,
      assignmentMaxMarks: s.assignmentMax,
    },
    semesterEndExam: {
      defaultMaxMarks: s.seeMax,
      ...(s.seeScaleFrom > 0 ? { scaleFrom: s.seeScaleFrom } : {}),
      durationMinutes: s.seeDuration,
      passPercentage: s.seePass,
    },
    passCriteria: {
      aggregatePassPercentage: s.aggPass,
      minimumInternalPercentage: s.minInternal,
      requireSemesterEndPass: s.requireSeePass,
    },
    gradeTable: s.grades,
    status: 'active',
    sourceNote: s.sourceNote,
    ...(engineering ? { engineering } : {}),
  };
}

// ─── Small field helper ──────────────────────────────────────────────────────

function Num({ label, value, onChange, width = 120 }: { label: string; value: number; onChange: (n: number) => void; width?: number }) {
  return (
    <TextField
      label={label}
      size="small"
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      sx={{ width }}
      slotProps={{ htmlInput: { min: 0 } }}
    />
  );
}

// A new custom pack starts from the engineering baseline (VTU 2022). The old
// BCU starting point left the picker with the other non-engineering presets —
// see src/shared/utils/schemePackVisibility.ts for the plug-back note.
const NEW_PACK_TEMPLATE = ENGINEERING_SCHEME_PACKS[0] ?? DEFAULT_SCHEME_PACK;

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SchemePacks() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState('');
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [scopeForm, setScopeForm] = useState({ programId: '', branchId: '', admissionBatch: '', schemePackId: '' });

  const assignedQuery = useQuery({
    queryKey: ['schemePack', 'assigned'],
    queryFn: () => getCollegeSchemePack(),
  });
  const packsQuery = useQuery({
    queryKey: ['schemePack', 'list'],
    queryFn: () => fetchSchemePacks(),
  });
  const assignmentsQuery = useQuery({
    queryKey: ['schemePack', 'assignments'],
    queryFn: () => fetchSchemePackAssignments(),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['schemePack'] });
    queryClient.invalidateQueries({ queryKey: ['bcuCompliancePack'] });
    queryClient.invalidateQueries({ queryKey: ['resultImporterPack'] });
  };

  const assignMutation = useMutation({
    mutationFn: (input: {
      id: string | null;
      scope?: { programId: string; branchId?: string; admissionBatch?: string };
    }) => assignCollegeSchemePack(input.id, input.scope),
    onSuccess: () => { setScopeDialogOpen(false); refresh(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Assignment failed'),
  });
  const seedMutation = useMutation({
    mutationFn: async () => {
      const presets = SCHEME_PACK_PRESETS.filter((pack) =>
        pack.code === 'VTU_BE_2022_5050' || pack.code === 'AUTONOMOUS_ENGINEERING_5050'
      );
      if (presets.length !== 2) throw new Error('Both engineering presets must be available before seeding.');
      // Each write goes through saveSchemePack's superadmin-only callable.
      return Promise.all(presets.map((pack) =>
        saveSchemePack(pack as unknown as Record<string, unknown>, { global: true })
      ));
    },
    onSuccess: refresh,
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Global preset seeding failed'),
  });
  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => saveSchemePack(payload),
    onSuccess: () => { setEditor(null); refresh(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'),
  });

  const assignedId = assignedQuery.data?.schemePackId ?? null;
  const assignedName = assignedQuery.data?.pack.name ?? '…';
  const packs = packsQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];

  const startScopeAssignment = () => {
    setError('');
    setScopeForm({
      programId: '',
      branchId: '',
      admissionBatch: '',
      schemePackId: assignedId || packs[0]?.pack.code || '',
    });
    setScopeDialogOpen(true);
  };

  const submitScopeAssignment = () => {
    const programId = scopeForm.programId.trim();
    const branchId = scopeForm.branchId.trim();
    const admissionBatch = scopeForm.admissionBatch.trim();
    if (!scopeForm.schemePackId || !programId) {
      setError('Select a scheme pack and enter a programme for the scoped assignment.');
      return;
    }
    if (Boolean(branchId) !== Boolean(admissionBatch)) {
      setError('Enter both branch and admission batch for a cohort-specific assignment, or leave both blank for programme-wide.');
      return;
    }
    assignMutation.mutate({
      id: scopeForm.schemePackId,
      scope: { programId, ...(branchId ? { branchId, admissionBatch } : {}) },
    });
  };

  const assignmentLabel = (assignment: { programId: string; branchId?: string; admissionBatch?: string; schemePackId: string }) => {
    const pack = packs.find((item) => item.pack.id === assignment.schemePackId || item.pack.code === assignment.schemePackId);
    return `${assignment.programId}${assignment.branchId ? ` · ${assignment.branchId} · ${assignment.admissionBatch}` : ' · all branches/batches'} → ${pack?.pack.name || assignment.schemePackId}`;
  };

  const facts = (p: UniversitySchemePack) =>
    `${p.semesterEndExam.defaultMaxMarks} SEE + ${p.internalAssessment.totalMarks} IA · ` +
    `${p.attendance.minimumPercentage}% attendance floor · ` +
    `${p.semesterEndExam.passPercentage}% exam / ${p.passCriteria.aggregatePassPercentage}% aggregate to pass · ` +
    `${p.mediums.join(' / ') || 'English'}` +
    (p.engineering ? ` · Engineering: ${Object.keys(p.engineering.courseTypes ?? {}).length} course types, ${p.engineering.grading?.method ?? 'absolute'} grading` : '');

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>University Scheme Packs</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 640 }}>
            College defaults can be overridden by programme, then by programme + branch + admission batch.
            Packs carry marks, grading, CGPA conversion, paper templates and attainment rules; each academic
            consumer resolves the most specific matching assignment.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip
            icon={<AssignIcon />}
            color="primary"
            variant="outlined"
            label={`Active: ${assignedName}${assignedId ? '' : ' (default)'}`}
            sx={{ maxWidth: 360 }}
          />
          {isSuperadmin && (
            <Button
              variant="outlined"
              startIcon={<SeedIcon />}
              disabled={seedMutation.isPending}
              onClick={() => seedMutation.mutate()}
            >
              {seedMutation.isPending ? 'Seeding…' : 'Seed engineering presets'}
            </Button>
          )}
          <Button variant="outlined" startIcon={<AssignIcon />} onClick={startScopeAssignment}>
            Assign by programme / cohort
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => { setError(''); setEditor(packToEditor(NEW_PACK_TEMPLATE, 'CUSTOM_' + Math.random().toString(36).slice(2, 7).toUpperCase())); }}
          >
            New Pack
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {assignments.length > 0 && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Programme and cohort overrides</Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              {assignments.map((assignment, index) => (
                <Chip
                  key={`${assignment.programId}:${assignment.branchId || ''}:${assignment.admissionBatch || ''}:${index}`}
                  label={assignmentLabel(assignment)}
                  variant="outlined"
                  onDelete={() => assignMutation.mutate({
                    id: null,
                    scope: {
                      programId: assignment.programId,
                      ...(assignment.branchId ? { branchId: assignment.branchId, admissionBatch: assignment.admissionBatch } : {}),
                    },
                  })}
                  disabled={assignMutation.isPending}
                />
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Grid container spacing={2}>
        {packs.map((item: ListedSchemePack) => {
          const p = item.pack;
          const isAssigned = (assignedId ?? p.code) === p.code || assignedId === p.id;
          return (
            <Grid key={item.origin + ':' + (item.origin === 'custom' ? p.id : p.code)} size={{ xs: 12, md: 6, lg: 4 }}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                    <SchoolIcon color={isAssigned ? 'primary' : 'disabled'} fontSize="small" />
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>{p.name}</Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.5} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Chip size="small" label={p.code} variant="outlined" />
                    <Chip size="small" label={item.origin === 'preset' ? 'Built-in preset' : 'Custom'} color={item.origin === 'preset' ? 'default' : 'secondary'} variant="outlined" />
                    {isAssigned && <Chip size="small" color="success" label="Assigned" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{p.universityName} · {p.schemeName}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>{facts(p)}</Typography>
                  {p.sourceNote && (
                    <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 1 }}>
                      Source: {p.sourceNote}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant={isAssigned ? 'outlined' : 'contained'}
                      disabled={isAssigned || assignMutation.isPending}
                      onClick={() => assignMutation.mutate({ id: item.origin === 'preset' ? p.code : p.id })}
                    >
                      {isAssigned ? 'Assigned' : 'Assign to College'}
                    </Button>
                    <Button
                      size="small"
                      startIcon={item.origin === 'custom' ? <EditIcon /> : <CloneIcon />}
                      onClick={() => {
                        setError('');
                        setEditor(
                          item.origin === 'custom'
                            ? packToEditor(p)
                            : packToEditor(p, p.code.includes('KUD') ? 'CUSTOM_KUD' : 'CUSTOM_' + p.code),
                        );
                      }}
                    >
                      {item.origin === 'custom' ? 'Edit' : 'Clone'}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
        {packs.length === 0 && (
          <Grid size={{ xs: 12 }}>
            <Alert severity="info">Loading packs…</Alert>
          </Grid>
        )}
      </Grid>

      {/* ─── Scoped assignment dialog ─── */}
      <Dialog open={scopeDialogOpen} onClose={() => setScopeDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign a programme or cohort scheme pack</DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            A programme-wide assignment applies when branch and batch are blank. Fill in both branch and admission batch to create a cohort override; it takes precedence over the programme assignment.
          </Alert>
          <Stack spacing={2}>
            <TextField
              select
              fullWidth
              label="Scheme pack"
              value={scopeForm.schemePackId}
              onChange={(event) => setScopeForm({ ...scopeForm, schemePackId: event.target.value })}
            >
              {packs.map((item) => (
                <MenuItem key={`${item.origin}:${item.pack.id}`} value={item.origin === 'preset' ? item.pack.code : item.pack.id}>
                  {item.pack.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              required
              fullWidth
              label="Programme (for example, B.E.)"
              value={scopeForm.programId}
              onChange={(event) => setScopeForm({ ...scopeForm, programId: event.target.value })}
            />
            <TextField
              fullWidth
              label="Branch (optional for programme-wide)"
              value={scopeForm.branchId}
              onChange={(event) => setScopeForm({ ...scopeForm, branchId: event.target.value })}
            />
            <TextField
              fullWidth
              label="Admission batch (optional for programme-wide)"
              placeholder="2022-2026"
              value={scopeForm.admissionBatch}
              onChange={(event) => setScopeForm({ ...scopeForm, admissionBatch: event.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScopeDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={assignMutation.isPending} onClick={submitScopeAssignment}>
            {assignMutation.isPending ? 'Assigning…' : 'Save scoped assignment'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ─── Editor dialog ─── */}
      <Dialog open={!!editor} onClose={() => setEditor(null)} maxWidth="md" fullWidth>
        {editor && (
          <>
            <DialogTitle>{editor.id ? `Edit custom pack (${editor.code})` : 'Create custom pack'}</DialogTitle>
            <DialogContent dividers>
              <Typography variant="overline" color="text.secondary">Identity</Typography>
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5, mb: 2 }}>
                <TextField label="Code" size="small" value={editor.code} disabled={!!editor.id}
                  onChange={(e) => setEditor({ ...editor, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} sx={{ width: 200 }}
                  helperText="letters/digits/underscore" />
                <TextField label="Display name" size="small" value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} sx={{ minWidth: 260, flex: 1 }} />
                <TextField label="University" size="small" value={editor.universityName} onChange={(e) => setEditor({ ...editor, universityName: e.target.value })} sx={{ minWidth: 240, flex: 1 }} />
                <TextField label="Scheme name" size="small" value={editor.schemeName} onChange={(e) => setEditor({ ...editor, schemeName: e.target.value })} sx={{ width: 180 }} />
                <TextField label="Programmes (comma)" size="small" value={editor.applicableProgrammes} onChange={(e) => setEditor({ ...editor, applicableProgrammes: e.target.value })} sx={{ minWidth: 240, flex: 1 }} />
                <TextField label="Mediums (comma)" size="small" value={editor.mediums} onChange={(e) => setEditor({ ...editor, mediums: e.target.value })} sx={{ width: 220 }} />
              </Stack>

              <Divider sx={{ my: 2 }} />
              <Typography variant="overline" color="text.secondary">Attendance</Typography>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mb: 1 }}>
                <Num label="Minimum %" value={editor.minimumPercentage} onChange={(n) => setEditor({ ...editor, minimumPercentage: n })} />
                <FormControlLabel
                  control={<Switch checked={editor.blocksExamEligibility} onChange={(e) => setEditor({ ...editor, blocksExamEligibility: e.target.checked })} />}
                  label="Blocks exam eligibility below minimum"
                />
              </Stack>
              {editor.slabs.map((s, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ mb: 0.5, alignItems: 'center' }}>
                  <Num label="From %" width={100} value={s.min} onChange={(n) => setEditor({ ...editor, slabs: editor.slabs.map((x, j) => (j === i ? { ...x, min: n } : x)) })} />
                  <Num label="To %" width={100} value={s.max} onChange={(n) => setEditor({ ...editor, slabs: editor.slabs.map((x, j) => (j === i ? { ...x, max: n } : x)) })} />
                  <Num label="Marks" width={90} value={s.marks} onChange={(n) => setEditor({ ...editor, slabs: editor.slabs.map((x, j) => (j === i ? { ...x, marks: n } : x)) })} />
                  <TextField size="small" label="Label" value={s.label} onChange={(e) => setEditor({ ...editor, slabs: editor.slabs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} sx={{ width: 170 }} />
                  <IconButton size="small" onClick={() => setEditor({ ...editor, slabs: editor.slabs.filter((_, j) => j !== i) })}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
              ))}
              <Button size="small" onClick={() => setEditor({ ...editor, slabs: [...editor.slabs, { min: editor.minimumPercentage, max: 100, marks: 1, label: 'New slab' }] })}>+ Add slab</Button>

              <Divider sx={{ my: 2 }} />
              <Typography variant="overline" color="text.secondary">Internal assessment</Typography>
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1, mb: 1 }}>
                <Num label="IA total" value={editor.iaTotal} onChange={(n) => setEditor({ ...editor, iaTotal: n })} />
                <Num label="Tests" value={editor.testCount} onChange={(n) => setEditor({ ...editor, testCount: n })} />
                <Num label="Max each" value={editor.testMaxEach} onChange={(n) => setEditor({ ...editor, testMaxEach: n })} />
                <Num label="Best of" value={editor.testBestOf} onChange={(n) => setEditor({ ...editor, testBestOf: n })} />
                <Num label="Test weight" value={editor.testWeight} onChange={(n) => setEditor({ ...editor, testWeight: n })} />
                <Num label="Attendance max" value={editor.attendanceMax} onChange={(n) => setEditor({ ...editor, attendanceMax: n })} />
                <Num label="Assignment max" value={editor.assignmentMax} onChange={(n) => setEditor({ ...editor, assignmentMax: n })} />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Test weight + attendance max + assignment max must add up to the IA total ({editor.testWeight + editor.attendanceMax + editor.assignmentMax} / {editor.iaTotal}).
              </Typography>

              <Divider sx={{ my: 2 }} />
              <Typography variant="overline" color="text.secondary">Semester-end exam & pass criteria</Typography>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mb: 1 }}>
                <Num label="SEE max marks" value={editor.seeMax} onChange={(n) => setEditor({ ...editor, seeMax: n })} />
                <Num label="Raw paper marks (optional)" value={editor.seeScaleFrom} onChange={(n) => setEditor({ ...editor, seeScaleFrom: n })} />
                <Num label="Duration (min)" value={editor.seeDuration} onChange={(n) => setEditor({ ...editor, seeDuration: n })} />
                <Num label="SEE pass %" value={editor.seePass} onChange={(n) => setEditor({ ...editor, seePass: n })} />
                <Num label="Aggregate pass %" value={editor.aggPass} onChange={(n) => setEditor({ ...editor, aggPass: n })} />
                <Num label="Min internal %" value={editor.minInternal} onChange={(n) => setEditor({ ...editor, minInternal: n })} />
                <FormControlLabel
                  control={<Switch checked={editor.requireSeePass} onChange={(e) => setEditor({ ...editor, requireSeePass: e.target.checked })} />}
                  label="SEE pass required in addition to aggregate"
                />
              </Stack>

              <Divider sx={{ my: 2 }} />
              <Typography variant="overline" color="text.secondary">Grade table (descending)</Typography>
              {editor.grades.map((g, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ mb: 0.5, alignItems: 'center' }}>
                  <TextField size="small" label="Grade" value={g.grade} onChange={(e) => setEditor({ ...editor, grades: editor.grades.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)) })} sx={{ width: 90 }} />
                  <Num label="Point" width={90} value={g.gradePoint} onChange={(n) => setEditor({ ...editor, grades: editor.grades.map((x, j) => (j === i ? { ...x, gradePoint: n } : x)) })} />
                  <Num label="Min %" width={100} value={g.minPercentage} onChange={(n) => setEditor({ ...editor, grades: editor.grades.map((x, j) => (j === i ? { ...x, minPercentage: n } : x)) })} />
                  <TextField size="small" label="Description" value={g.description} onChange={(e) => setEditor({ ...editor, grades: editor.grades.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} sx={{ width: 180 }} />
                  <IconButton size="small" onClick={() => setEditor({ ...editor, grades: editor.grades.filter((_, j) => j !== i) })}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
              ))}
              <Button size="small" onClick={() => setEditor({ ...editor, grades: [...editor.grades, { grade: 'P', gradePoint: 4, minPercentage: 35, description: 'Pass' }] })}>+ Add grade</Button>

              <Divider sx={{ my: 2 }} />
              <Typography variant="overline" color="text.secondary">Engineering extension (optional)</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                JSON fields preserve pack-driven course-type weightages, explicit CGPA batch formulas, relative grade bands, paper templates and NBA/OBE attainment settings. Leave them empty on non-engineering packs.
              </Typography>
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth multiline minRows={6} size="small" label="Course-type weightages (JSON)"
                    value={editor.courseTypesJson}
                    onChange={(event) => setEditor({ ...editor, courseTypesJson: event.target.value })}
                    helperText="Use _default for unlisted course types; add heads/internalSplit where required."
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1.5}>
                    <TextField
                      select size="small" label="Grading method" value={editor.gradingMethod}
                      onChange={(event) => setEditor({ ...editor, gradingMethod: event.target.value as 'absolute' | 'relative' })}
                    >
                      <MenuItem value="absolute">Absolute grade table</MenuItem>
                      <MenuItem value="relative">Relative cohort bands</MenuItem>
                    </TextField>
                    <Num label="Minimum cohort for relative grading" width={280} value={editor.minCohortSizeForRelative} onChange={(n) => setEditor({ ...editor, minCohortSizeForRelative: n })} />
                    <TextField
                      fullWidth multiline minRows={3} size="small" label="Relative grade bands (JSON array)"
                      value={editor.relativeBandsJson}
                      onChange={(event) => setEditor({ ...editor, relativeBandsJson: event.target.value })}
                      helperText="Percentile bands may specify absoluteMinPercentage; the absolute pass floor is never overridden."
                    />
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth size="small" label="CGPA percentage fallback formula"
                    placeholder="CGPA * 10" value={editor.percentageExpression}
                    onChange={(event) => setEditor({ ...editor, percentageExpression: event.target.value })}
                    helperText="Only CGPA * N or (CGPA ± N) * N is accepted; formulas are not evaluated as code."
                  />
                  <TextField
                    fullWidth multiline minRows={5} size="small" sx={{ mt: 1.5 }} label="Admission-batch conversion rules (JSON array)"
                    value={editor.batchRulesJson}
                    onChange={(event) => setEditor({ ...editor, batchRulesJson: event.target.value })}
                    helperText="Use admissionYears or fromAdmissionYear/throughAdmissionYear and an explicit expression."
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth multiline minRows={8} size="small" label="Question-paper template (JSON object)"
                    value={editor.paperTemplateJson}
                    onChange={(event) => setEditor({ ...editor, paperTemplateJson: event.target.value })}
                    helperText="Module format or sections, rawTotal, durationMinutes, and optional difficulty targets."
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary">
                      NBA / OBE attainment rules (JSON object)
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setEditor({
                        ...editor,
                        attainmentJson: JSON.stringify(gapcV40AttainmentRules(), null, 2),
                      })}
                    >
                      Apply NBA GAPC v4.0 defaults
                    </Button>
                  </Stack>
                  <TextField
                    fullWidth multiline minRows={4} size="small" label="NBA / OBE attainment rules (JSON object)"
                    value={editor.attainmentJson}
                    onChange={(event) => setEditor({ ...editor, attainmentJson: event.target.value })}
                    helperText="80/20 direct+indirect blend, 60% CO threshold, 3/2/1 levels at 70/60/50% of students — edit after stamping if the university differs."
                  />
                </Grid>
              </Grid>

              <Divider sx={{ my: 2 }} />
              <TextField fullWidth size="small" label="Source note (syllabus / regulations reference)" value={editor.sourceNote} onChange={(e) => setEditor({ ...editor, sourceNote: e.target.value })} />

              {saveMutation.isError && <Alert severity="error" sx={{ mt: 2 }}>{saveMutation.error instanceof Error ? saveMutation.error.message : 'Save failed'}</Alert>}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditor(null)}>Cancel</Button>
              <Button
                variant="contained"
                disabled={saveMutation.isPending || !editor.code || !editor.name || !editor.universityName}
                onClick={() => {
                  try {
                    setError('');
                    saveMutation.mutate(editorToPayload(editor));
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : 'The pack contains invalid engineering JSON.');
                  }
                }}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save pack'}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
