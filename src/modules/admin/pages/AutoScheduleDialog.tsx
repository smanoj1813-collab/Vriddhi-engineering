// src/modules/admin/pages/AutoScheduleDialog.tsx
// G4 auto-scheduler dialog (Auto-Scheduler v2): config → dry-run preview (grid
// + hours/day + faculty load + unplaced + calendar) → apply. The server is the
// only writer; this is a pure remote-plan renderer (same preview→approve
// discipline as AutoMap).
//
// v2 operator controls:
//   P1  Date range (from/to) — the applicability window written to every doc.
//   P2  Per-course table — include checkbox + weekly-periods override,
//       prefilled from the preview's demand list.
//   P3  Pattern (Uniform · Spread · Random) + Room pick (Least-loaded ·
//       Random) + a visible seed with 🎲 regenerate. Same seed = same grid,
//       so preview == apply and a run is reproducible weeks later.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, FormHelperText, IconButton, InputLabel, ListItemText, MenuItem, Select, Stack, Switch,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
  Table, TableBody, TableCell, TableHead, TableRow, Checkbox,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  AutoFixHigh as AutoIcon,
  Casino as SeedIcon,
  Close as CloseIcon,
  EventBusy as BlockIcon,
  PlayArrow as PreviewIcon,
  PublishRounded as ApplyIcon,
} from '@mui/icons-material';
import { db } from '@/Firebase/config';
import {
  autoGenerateWeeklySchedule,
  type AutoSchedulePlan,
  type AutoScheduleRequest,
  type AutoScheduleResponse,
  type PlacementStrategy,
  type RoomStrategy,
  type FacultyDayPreference,
  type TeachingGroupMode,
} from '../api/autoScheduleApi';
import type { DayOfWeek } from '../types/schedule';
import { fetchDivisionsFromStudents } from '../api/scheduleApi';
import { divisionOptions as buildDivisionOptions, divisionSelection, divisionSelectionValue } from '@/shared/utils/divisionGroups';

interface CurriculumOption {
  id: string;
  title: string;
  branch: string;
  semester: number;
}

const ALL_DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const STRATEGY_INFO: Record<PlacementStrategy, string> = {
  uniform: 'Deterministic placement using the selected faculty-day preference and earliest legal periods.',
  spread: 'Rotates tie-breaks and early/late starts; the chosen faculty-day preference still applies.',
  random: 'Seeded variation within equally preferred choices; hard constraints are unchanged.',
};

const ROOM_INFO: Record<RoomStrategy, string> = {
  leastLoaded: 'Fill the emptiest room first (spreads utilisation).',
  random: 'Seeded pick among the rooms free for that span.',
};

/** Fresh run seed — shown in the dialog; 🎲 rolls another. */
function newSeed(): string {
  return `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

interface Props {
  collegeId: string;
  open: boolean;
  onClose: () => void;
  /** called after a successful apply so the timetable reloads */
  onApplied: () => void;
  divisionOptions?: string[];
}

interface FormState {
  curriculumId: string;
  batch: string;
  division: string;
  section: string;
  periodsPerDay: number;
  startTime: string;
  periodMinutes: number;
  breakAfterPeriod: number;
  breakMinutes: number;
  labSpan: number;
  rooms: string;
  maxPerDay: number;
  targetClassesPerDay: number;
  facultyDayPreference: FacultyDayPreference;
  teachingGroupMode: TeachingGroupMode;
  maxWeeklyPeriods: number;
  dateFrom: string;
  dateTo: string;
  strategy: PlacementStrategy;
  roomStrategy: RoomStrategy;
  seed: string;
}

function teachingScopeLabel(division?: string, section?: string): string {
  return [
    division ? `Div ${division.replace(/,/g, '+')}` : '',
    section ? `Sec ${section.replace(/,/g, '+')}` : '',
  ].filter(Boolean).join(' / ')
}

const initialForm: FormState = {
  curriculumId: '',
  batch: String(new Date().getFullYear()),
  division: '',
  section: '',
  periodsPerDay: 5,
  startTime: '08:00',
  periodMinutes: 50,
  breakAfterPeriod: 3,
  breakMinutes: 15,
  labSpan: 2,
  rooms: 'Room 1, Room 2, Room 3',
  maxPerDay: 4,
  targetClassesPerDay: 3,
  facultyDayPreference: 'compact',
  teachingGroupMode: 'mapping',
  maxWeeklyPeriods: 24,
  dateFrom: '',
  dateTo: '',
  strategy: 'uniform',
  roomStrategy: 'leastLoaded',
  seed: '',
};

interface OverrideEdit {
  include?: boolean;
  periods?: number | null;
}

export default function AutoScheduleDialog({ collegeId, open, onClose, onApplied, divisionOptions: knownDivisionOptions = [] }: Props) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [preview, setPreview] = useState<AutoScheduleResponse | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState('');
  const [appliedInfo, setAppliedInfo] = useState('');
  // P2 — user edits only. Untouched rows send NO override, so the server's
  // derivation (and its truthful "0 contact hours" unplaced reason) survives.
  const [overrides, setOverrides] = useState<Record<string, OverrideEdit>>({});
  // Last known demand list (survives config edits that invalidate the preview).
  const [demand, setDemand] = useState<AutoSchedulePlan['demand']>([]);

  const divisionValuesQuery = useQuery({
    queryKey: ['autoScheduleDivisionOptions', collegeId],
    enabled: !!collegeId && open,
    queryFn: () => fetchDivisionsFromStudents(collegeId),
  });
  const availableDivisions = useMemo(
    () => buildDivisionOptions([...(divisionValuesQuery.data ?? []), ...knownDivisionOptions]),
    [divisionValuesQuery.data, knownDivisionOptions],
  );
  const selectedDivisions = useMemo(() => divisionSelection(form.division), [form.division]);

  const curriculaQuery = useQuery({
    queryKey: ['autoScheduleCurricula', collegeId],
    enabled: !!collegeId && open,
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, 'curriculum'), where('collegeId', '==', collegeId)),
      );
      const out: CurriculumOption[] = snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          if (String(data.status ?? 'active') === 'archived') return null;
          return {
            id: d.id,
            title: String(data.title ?? `${data.branch ?? ''} Sem ${data.semester ?? ''}`),
            branch: String(data.branch ?? ''),
            semester: Number(data.semester ?? 0) || 0,
          };
        })
        .filter((c): c is CurriculumOption => c !== null)
        .sort((a, b) => a.title.localeCompare(b.title));
      return out;
    },
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setPreview(null); // config changed → previous plan is stale
    setAppliedInfo('');
  };

  /** Cohort identity changed — the override table no longer describes these courses. */
  const setCohort = (key: 'curriculumId' | 'batch' | 'division' | 'section', value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setPreview(null);
    setAppliedInfo('');
    setOverrides({});
    setDemand([]);
  };

  const buildRequest = (dryRun: boolean): AutoScheduleRequest => {
    const overrideRows = Object.entries(overrides).map(([demandKey, edit]) => ({
      demandKey,
      ...(edit.include === undefined ? {} : { include: edit.include }),
      ...(edit.periods === undefined || edit.periods === null ? {} : { weeklyPeriods: edit.periods }),
    }));
    return {
      curriculumId: form.curriculumId,
      batch: form.batch.trim(),
      division: form.division.trim() || undefined,
      section: form.section.trim() || undefined,
      grid: {
        days: ALL_DAYS,
        periodsPerDay: form.periodsPerDay,
        startTime: form.startTime,
        periodMinutes: form.periodMinutes,
        breakAfterPeriod: form.breakAfterPeriod,
        breakMinutes: form.breakMinutes,
        labSpan: form.labSpan,
      },
      rooms: form.rooms.split(',').map((r) => r.trim()).filter(Boolean),
      maxPeriodsPerDayPerFaculty: form.maxPerDay,
      targetFacultyClassesPerDay: form.targetClassesPerDay,
      facultyDayPreference: form.facultyDayPreference,
      teachingGroupMode: form.teachingGroupMode,
      maxWeeklyPeriodsPerFaculty: form.maxWeeklyPeriods,
      dryRun,
      ...(form.dateFrom
        ? { dateRange: { from: form.dateFrom, ...(form.dateTo ? { to: form.dateTo } : {}) } }
        : {}),
      strategy: form.strategy,
      ...(form.strategy === 'random' || form.roomStrategy === 'random'
        ? { randomSeed: form.seed || undefined }
        : {}),
      roomStrategy: form.roomStrategy,
      ...(overrideRows.length > 0 ? { courseOverrides: overrideRows } : {}),
    };
  };

  const run = async (dryRun: boolean) => {
    setError('');
    setBusy(dryRun ? 'preview' : 'apply');
    try {
      const res = await autoGenerateWeeklySchedule(buildRequest(dryRun));
      setPreview(res);
      if (Array.isArray(res.plan.demand) && res.plan.demand.length > 0) setDemand(res.plan.demand);
      // Server generated a seed for a seedless random run — pin it locally so
      // apply replays exactly the previewed grid.
      if (res.randomSeed && !form.seed) setForm((f) => ({ ...f, seed: res.randomSeed as string }));
      if (!dryRun) {
        setAppliedInfo(res.draft
          ? `Saved as a draft: ${res.created ?? res.plan.placements.length} slots. The HOD must approve it before it goes live.`
          : `Applied: ${res.created ?? res.plan.placements.length} slots written to the timetable${form.dateFrom ? ` (valid ${form.dateFrom}${form.dateTo ? ` → ${form.dateTo}` : ''})` : ''}`);
        onApplied();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto-schedule failed');
    } finally {
      setBusy(null);
    }
  };

  const plan: AutoSchedulePlan | null = preview?.plan ?? null;
  const dayHeader = (d: DayOfWeek) => d.slice(0, 3).toUpperCase();

  const gridRows = useMemo(() => {
    if (!plan) return [];
    const rows = [];
    for (let p = 1; p <= plan.grid.periodsPerDay; p++) {
      const cells = plan.grid.days.map((day) =>
        plan.placements.filter((x) => x.dayOfWeek === day && x.periodIndex === p),
      );
      const time = plan.placements.find((x) => x.periodIndex === p);
      rows.push({ period: p, time: time ? `${time.startTime}` : '', cells });
    }
    return rows;
  }, [plan]);

  const canRun = !!form.curriculumId && form.batch.trim().length > 0 && busy === null;
  const dateRangeInvalid = !!form.dateTo && !!form.dateFrom && form.dateTo < form.dateFrom;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoIcon color="primary" />
        Auto-generate timetable
        <Box sx={{ flex: 1 }} />
        {plan && (
          <Chip
            size="small"
            color={plan.summary.unplacedCourses > 0 ? 'warning' : 'success'}
            label={`${plan.summary.periodsPlaced}/${plan.summary.periodsRequested} periods placed`}
          />
        )}
        <IconButton size="small" onClick={onClose} disabled={!!busy}><CloseIcon /></IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {appliedInfo && <Alert severity="success" sx={{ mb: 2 }}>{appliedInfo}</Alert>}
        {preview?.warnings?.map((w, i) => (
          <Alert key={i} severity="info" sx={{ mb: 1 }}>{w}</Alert>
        ))}

        {/* ─── Config ─── */}
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              select fullWidth size="small" label="Curriculum" value={form.curriculumId}
              onChange={(e) => setCohort('curriculumId', e.target.value)}
            >
              {curriculaQuery.data?.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.title} ({c.branch} · Sem {c.semester})</MenuItem>
              )) ?? <MenuItem disabled value="">Loading…</MenuItem>}
            </TextField>
          </Grid>
          <Grid size={{ xs: 4, md: 2 }}>
            <TextField fullWidth size="small" label="Batch" value={form.batch} onChange={(e) => setCohort('batch', e.target.value)} placeholder="2026" helperText="Multi-intake: 2027, 2028" />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="auto-schedule-divisions-label">Limit to divisions</InputLabel>
              <Select
                labelId="auto-schedule-divisions-label"
                multiple
                label="Limit to divisions"
                value={selectedDivisions}
                renderValue={(selected) => Array.isArray(selected) && selected.length > 0 ? selected.join(' + ') : 'All mapped groups'}
                onChange={(event) => {
                  const value = event.target.value
                  const selected = divisionSelection(Array.isArray(value) ? value : String(value).split(','))
                  setCohort('division', divisionSelectionValue(selected))
                }}
              >
                {availableDivisions.map((item) => (
                  <MenuItem key={item} value={item}>
                    <Checkbox size="small" checked={selectedDivisions.includes(item)} />
                    <ListItemText primary={`Division ${item}`} />
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>Blank includes all mapped groups; merges are defined on each curriculum mapping.</FormHelperText>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 4, md: 2 }}>
            <TextField fullWidth size="small" label="Section (opt.)" value={form.section} onChange={(e) => setCohort('section', e.target.value)} placeholder="A" />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField fullWidth size="small" label="Rooms (comma-separated)" value={form.rooms} onChange={(e) => set('rooms', e.target.value)} />
          </Grid>

          {/* P1 — applicability window */}
          <Grid size={{ xs: 6, md: 2 }}>
            <TextField
              fullWidth size="small" type="date" label="Applies from" value={form.dateFrom}
              onChange={(e) => set('dateFrom', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              error={dateRangeInvalid}
            />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <TextField
              fullWidth size="small" type="date" label="…to (optional)" value={form.dateTo}
              onChange={(e) => set('dateTo', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              error={dateRangeInvalid}
              helperText={dateRangeInvalid ? 'to < from' : 'Empty = open-ended'}
            />
          </Grid>

          <Grid size={{ xs: 3, md: 1.5 }}>
            <TextField fullWidth size="small" type="number" label="Periods/day" value={form.periodsPerDay}
              onChange={(e) => set('periodsPerDay', Number(e.target.value) || 5)} />
          </Grid>
          <Grid size={{ xs: 3, md: 1.5 }}>
            <TextField fullWidth size="small" type="time" label="Starts" value={form.startTime}
              onChange={(e) => set('startTime', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 3, md: 1.5 }}>
            <TextField fullWidth size="small" type="number" label="Min/period" value={form.periodMinutes}
              onChange={(e) => set('periodMinutes', Number(e.target.value) || 50)} />
          </Grid>
          <Grid size={{ xs: 3, md: 1.5 }}>
            <TextField fullWidth size="small" type="number" label="Break after P#" value={form.breakAfterPeriod}
              onChange={(e) => set('breakAfterPeriod', Number(e.target.value) || 0)} />
          </Grid>
          <Grid size={{ xs: 3, md: 1.5 }}>
            <TextField fullWidth size="small" type="number" label="Break (min)" value={form.breakMinutes}
              onChange={(e) => set('breakMinutes', Number(e.target.value) || 15)} />
          </Grid>
          <Grid size={{ xs: 3, md: 1.5 }}>
            <TextField fullWidth size="small" type="number" label="Lab span" value={form.labSpan}
              onChange={(e) => set('labSpan', Number(e.target.value) || 2)} />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <TextField fullWidth size="small" type="number" label="Faculty max periods/day" value={form.maxPerDay}
              onChange={(e) => {
                const maxPerDay = Number(e.target.value) || 4;
                setForm((current) => ({ ...current, maxPerDay, targetClassesPerDay: Math.min(current.targetClassesPerDay, maxPerDay) }));
                setPreview(null);
                setAppliedInfo('');
              }}
              helperText="Hard limit" slotProps={{ htmlInput: { min: 1, max: 10 } }} />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <TextField fullWidth size="small" type="number" label="Target classes/day" value={form.targetClassesPerDay}
              onChange={(e) => set('targetClassesPerDay', Math.max(1, Math.min(form.maxPerDay, 10, Number(e.target.value) || 3)))}
              helperText="Soft target (default 3)" slotProps={{ htmlInput: { min: 1, max: Math.min(10, form.maxPerDay) } }} />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <TextField fullWidth size="small" type="number" label="Faculty max/week" value={form.maxWeeklyPeriods}
              onChange={(e) => set('maxWeeklyPeriods', Number(e.target.value) || 24)}
              helperText="Default 24 periods" slotProps={{ htmlInput: { min: 1, max: 60 } }} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Typography variant="caption" color="text.secondary">Faculty day preference</Typography>
            <ToggleButtonGroup
              exclusive size="small" fullWidth value={form.facultyDayPreference}
              onChange={(_, value: FacultyDayPreference | null) => value && set('facultyDayPreference', value)}
            >
              <ToggleButton value="compact">Compact days</ToggleButton>
              <ToggleButton value="balanced">Student balance</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Compact fills toward your target, allowing one extra meeting when it fits before opening another day; in Separate groups mode, it also prefers same-day A/B/C rotation when capacity allows.
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Typography variant="caption" color="text.secondary">Mapped multi-division classes</Typography>
            <ToggleButtonGroup
              exclusive size="small" fullWidth value={form.teachingGroupMode}
              onChange={(_, value: TeachingGroupMode | null) => value && set('teachingGroupMode', value)}
            >
              <ToggleButton value="mapping">Respect mapping</ToggleButton>
              <ToggleButton value="separate">Separate groups</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Separate turns A,B,C into distinct classes; mapping mode keeps them together.
            </Typography>
          </Grid>

          {/* P3 — pattern + room pick + seed */}
          <Grid size={{ xs: 12, md: 5 }}>
            <Typography variant="caption" color="text.secondary">Pattern</Typography>
            <ToggleButtonGroup
              exclusive size="small" fullWidth value={form.strategy}
              onChange={(_, v: PlacementStrategy | null) => v && set('strategy', v)}
            >
              <ToggleButton value="uniform">Uniform</ToggleButton>
              <ToggleButton value="spread">Spread</ToggleButton>
              <ToggleButton value="random">Random</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {STRATEGY_INFO[form.strategy]}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Typography variant="caption" color="text.secondary">Room pick</Typography>
            <ToggleButtonGroup
              exclusive size="small" fullWidth value={form.roomStrategy}
              onChange={(_, v: RoomStrategy | null) => v && set('roomStrategy', v)}
            >
              <ToggleButton value="leastLoaded">Least-loaded</ToggleButton>
              <ToggleButton value="random">Random</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {ROOM_INFO[form.roomStrategy]}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="caption" color="text.secondary">Seed (same seed = same grid)</Typography>
            <Stack direction="row" spacing={0.5}>
              <TextField
                fullWidth size="small" value={form.seed} placeholder="auto"
                onChange={(e) => set('seed', e.target.value)}
              />
              <Tooltip title="Roll a new seed">
                <IconButton onClick={() => set('seed', newSeed())}><SeedIcon /></IconButton>
              </Tooltip>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Preview and Apply replay this seed — regenerate for a different layout.
            </Typography>
          </Grid>
        </Grid>

        {/* ─── P4 — calendar summary ─── */}
        {plan?.calendar && (
          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
            <Chip
              size="small"
              icon={<BlockIcon />}
              color={(plan.summary.blockedDays ?? 0) > 0 ? 'warning' : 'default'}
              label={
                plan.summary.teachingDays !== undefined
                  ? `Teaching days: ${plan.summary.teachingDays} · Blocked: ${plan.summary.blockedDays ?? 0}`
                  : `${(plan.calendar?.events ?? []).length} calendar events`
              }
            />
            {Object.entries(plan.summary.blockedBreakdown ?? {}).map(([type, n]) => (
              <Chip key={type} size="small" variant="outlined" label={`${type}: ${n} day${n === 1 ? '' : 's'}`} />
            ))}
            {plan.calendar?.blockedWeekdays.map((bw) => (
              <Chip key={bw.day} size="small" color="warning" variant="outlined" label={`${dayHeader(bw.day)} ⛔ ${bw.titles.join(' · ')}`} />
            ))}
          </Stack>
        )}

        {/* ─── P2 — course overrides ─── */}
        {demand.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Courses this run {Object.keys(overrides).length > 0 ? `(${Object.keys(overrides).length} edited — clear edits by closing the dialog)` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Each row is one teaching group. A weekly-period override applies to every group from that curriculum mapping.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">In</TableCell>
                  <TableCell>Course / teaching group</TableCell>
                  <TableCell>Faculty</TableCell>
                  <TableCell sx={{ width: 130 }}>Periods/week</TableCell>
                  <TableCell>Note</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {demand.map((row) => {
                  const edit = overrides[row.demandKey] ?? {};
                  const included = edit.include ?? row.included;
                  const periods = edit.periods !== undefined ? edit.periods : row.periodsRequested;
                  const group = teachingScopeLabel(row.division, row.section) || 'Whole batch';
                  return (
                    <TableRow key={row.demandKey} hover>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={included}
                          onChange={(e) =>
                            setOverrides((o) => ({ ...o, [row.demandKey]: { ...o[row.demandKey], include: e.target.checked } }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <b>{row.courseCode}</b> {row.courseName}
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {group}
                        </Typography>
                      </TableCell>
                      <TableCell>{row.facultyName}</TableCell>
                      <TableCell>
                        <TextField
                          size="small" type="number" value={periods} disabled={!included}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            setOverrides((o) => ({ ...o, [row.demandKey]: { ...o[row.demandKey], periods: v } }));
                          }}
                          sx={{ width: 100 }}
                          slotProps={{ htmlInput: { min: 0, max: 40 } }}
                        />
                      </TableCell>
                      <TableCell>
                        {row.source === 'zero-hours' ? (
                          <Typography variant="caption" color="warning.main">{row.reason ?? 'course has 0 contact hours — set weeklyPeriods'}</Typography>
                        ) : row.source === 'override' ? (
                          <Chip size="small" variant="outlined" label="overridden" />
                        ) : row.source === 'excluded' ? (
                          <Typography variant="caption" color="text.secondary">{row.reason ?? 'excluded'}</Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary">from curriculum hours</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* ─── Preview ─── */}
        {plan && (
          <Box sx={{ mt: 3 }}>
            {/* daily coverage — the "hours per day" answer */}
            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
              {plan.dailyCoverage.map((d) => (
                <Chip
                  key={d.day}
                  variant={d.periods === 0 ? 'outlined' : 'filled'}
                  color={d.utilization >= 0.8 ? 'success' : d.utilization >= 0.4 ? 'primary' : 'default'}
                  label={`${dayHeader(d.day)} ${d.periods}p · ${d.hours}h (${Math.round(d.utilization * 100)}%)`}
                />
              ))}
            </Stack>

            {plan.cohortDailyCoverage.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Stack direction="row" spacing={1} sx={{ mb: 0.75, flexWrap: 'wrap', rowGap: 0.5 }}>
                  <Typography variant="subtitle2">Student-group density · target 4–5 classes/day</Typography>
                  <Chip size="small" variant="outlined" label={`${plan.summary.divisionsInTarget ?? 0}/${new Set(plan.cohortDailyCoverage.map((x) => x.division)).size} divisions on target all week`} />
                </Stack>
                {[...new Set(plan.cohortDailyCoverage.map((x) => x.division))].map((division) => (
                  <Stack key={division} direction="row" spacing={0.75} sx={{ mb: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Chip size="small" variant="outlined" label={division === 'All' ? 'Whole batch' : `Division ${division}`} />
                    {plan.cohortDailyCoverage.filter((x) => x.division === division).map((item) => (
                      <Chip
                        key={`${division}-${item.day}`}
                        size="small"
                        color={item.onTarget ? 'success' : item.classes > item.targetMax ? 'warning' : 'default'}
                        variant={item.onTarget ? 'filled' : 'outlined'}
                        label={`${dayHeader(item.day)} ${item.classes} class${item.classes === 1 ? '' : 'es'}${item.onTarget ? ' ✓' : ''}`}
                      />
                    ))}
                  </Stack>
                ))}
              </Box>
            )}

            {/* grid */}
            <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: 8, textAlign: 'left' }}>Period</th>
                    {plan.grid.days.map((d) => (
                      <th key={d} style={{ padding: 8, textAlign: 'left' }}>{dayHeader(d)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gridRows.map((row) => (
                    <tr key={row.period} style={{ borderTop: '1px solid rgba(128,128,128,0.2)' }}>
                      <td style={{ padding: 8, whiteSpace: 'nowrap', fontWeight: 600 }}>
                        P{row.period}
                        <Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">{row.time}</Typography>
                      </td>
                      {row.cells.map((cell, ci) => (
                        <td key={ci} style={{ padding: 4, verticalAlign: 'top' }}>
                          {cell.length === 0 ? (
                            <Typography variant="caption" color="text.disabled">—</Typography>
                          ) : (
                            cell.map((x, i) => {
                              const group = teachingScopeLabel(x.division, x.section)
                              return (
                                <Box key={i} sx={{
                                  p: 0.5, mb: 0.5, borderRadius: 1, fontSize: 11, lineHeight: 1.2,
                                  bgcolor: x.type === 'lab' ? 'secondary.50' : 'primary.50',
                                  border: '1px solid',
                                  borderColor: x.type === 'lab' ? 'secondary.200' : 'primary.200',
                                }}>
                                  <b>{x.subjectCode || x.subject}</b>
                                  <div>{x.facultyName.split(' ').slice(-1)[0]} · {x.room}{group ? ` · ${group}` : ''}{x.type === 'lab' ? ' · lab' : ''}</div>
                                </Box>
                              )
                            })
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>

            <Grid container spacing={2} sx={{ mt: 1 }}>
              {/* faculty load */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Faculty weekly load</Typography>
                {plan.facultyLoad.length === 0 && <Typography variant="caption" color="text.secondary">No faculty loaded.</Typography>}
                {plan.facultyLoad.map((f) => (
                  <Box key={f.facultyId} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.25 }}>
                      <Typography variant="body2" sx={{ flex: 1 }} noWrap>{f.facultyName}</Typography>
                      <Chip size="small" variant="outlined" label={`existing ${f.existingWeekly}`} />
                      <Chip size="small" color={f.demandExceeded || f.overloaded ? 'error' : 'primary'}
                        label={`${f.projectedWeekly}/${f.capacity} projected`} />
                      <Chip size="small" variant="outlined" label={`${f.placedWeekly} placed`} />
                    </Stack>
                    {plan.facultyDailyLoad.some((row) => row.facultyId === f.facultyId) && (
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5, pl: 1 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>Daily:</Typography>
                        {plan.facultyDailyLoad.filter((row) => row.facultyId === f.facultyId).map((row) => (
                          <Chip
                            key={`${f.facultyId}-${row.day}`}
                            size="small"
                            color={row.targetMet ? 'success' : 'warning'}
                            variant={row.targetMet ? 'filled' : 'outlined'}
                            label={`${dayHeader(row.day)} ${row.classes} class${row.classes === 1 ? '' : 'es'} · ${row.periods}p`}
                          />
                        ))}
                      </Stack>
                    )}
                    {f.demandExceeded && (
                      <Alert severity="warning" sx={{ mt: 0.5, py: 0.25 }}>
                        Load arithmetic: {f.existingWeekly} existing + {f.requestedWeekly} requested = {f.projectedWeekly}/{f.capacity} periods/week.
                        {f.mergeSuggestions.length > 0 && (
                          <Box component="span" sx={{ display: 'block' }}>{f.mergeSuggestions.join(' · ')}</Box>
                        )}
                      </Alert>
                    )}
                    {f.demandBreakdown.map((line) => (
                      <Typography key={`${f.facultyId}-${line.courseId}-${line.groups.join('|')}`} variant="caption" color="text.secondary" sx={{ display: 'block', pl: 1 }}>
                        {line.subject}: {line.groupsServed} group{line.groupsServed === 1 ? '' : 's'} × {line.periodsPerGroup} = {line.periodsRequested} periods/week
                        {line.groupsServed > 0 ? ` (${line.groups.join('; ')})` : ''}
                      </Typography>
                    ))}
                  </Box>
                ))}
              </Grid>
              {/* unplaced */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Unplaced</Typography>
                {plan.unplaced.length === 0 ? (
                  <Alert severity="success" icon={false} sx={{ py: 0.5 }}>Every requested period found a slot.</Alert>
                ) : (
                  plan.unplaced.map((u) => {
                    const group = teachingScopeLabel(u.division, u.section) || 'Whole batch'
                    return (
                      <Alert key={`${u.mappingId}|${u.division}|${u.section}`} severity="warning" sx={{ mb: 0.5, py: 0.5 }}>
                        {u.subject} · {group}: placed {u.periodsPlaced}/{u.periodsRequested} — {u.reason}
                      </Alert>
                    )
                  })
                )}
              </Grid>
            </Grid>
          </Box>
        )}

        <Divider sx={{ mt: 2 }} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Daily faculty target is a preference, not a requirement; max periods/day and max periods/week remain hard limits. Faculty counts are meetings (a multi-period lab is one class) plus occupied periods. Cohort/faculty/room clashes and one meeting per subject/group/day remain hard constraints.
        </Typography>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={!!busy}>Close</Button>
        <Button
          variant="outlined" startIcon={<PreviewIcon />}
          disabled={!canRun || dateRangeInvalid} onClick={() => run(true)}
        >
          {busy === 'preview' ? 'Planning…' : 'Preview (no writes)'}
        </Button>
        <Button
          variant="contained" startIcon={<ApplyIcon />}
          disabled={!canRun || dateRangeInvalid || !plan || plan.placements.length === 0}
          onClick={() => run(false)}
        >
          {busy === 'apply' ? 'Writing…' : `Apply ${plan ? `${plan.placements.length} slots` : ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
