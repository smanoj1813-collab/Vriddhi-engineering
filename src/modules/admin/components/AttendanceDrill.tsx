// src/modules/admin/components/AttendanceDrill.tsx
//
// Attendance drill-down for principal, HOD and admin: Branch → Batch → Subject.
//
// It receives ONE academic-insights result (the page fetches it once) and
// groups it in memory. Clicking a level never triggers a read, which is the
// same rule as the Curriculum Insights drill (docs/firestore-cost-controls.md).

import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  LinearProgress,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  CircularProgress,
} from '@mui/material';
import type { AcademicInsightsResult, SubjectInsight } from '../api/academicInsightsApi';
import {
  batchOf,
  branchKeyOf,
  displayLabel,
  groupBy,
  NO_BATCH_LABEL,
  rollup,
  sortByLabel,
  type Group,
} from '../utils/curriculumDrill';

interface Props {
  result: AcademicInsightsResult | null;
  loading: boolean;
  error: string | null;
  /** Shown under the title, e.g. "Academic year to date (1 Jun 2026 – today)". */
  windowLabel: string;
}

function percentText(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

export default function AttendanceDrill({ result, loading, error, windowLabel }: Props) {
  const [branchKey, setBranchKey] = useState<string | null>(null);
  const [batchKey, setBatchKey] = useState<string | null>(null);

  const subjects: SubjectInsight[] = useMemo(
    () => (result?.semesters ?? []).flatMap((sem) => sem.subjects ?? []),
    [result],
  );

  const branches: Group[] = useMemo(
    () => sortByLabel(groupBy(
      subjects,
      branchKeyOf,
      (list) => displayLabel(list.map((s) => s.branch), 'No branch'),
    )),
    [subjects],
  );

  const selectedBranch = branches.find((b) => b.key === branchKey) ?? null;

  const batches: Group[] = useMemo(
    () => (selectedBranch
      ? sortByLabel(groupBy(selectedBranch.subjects, batchOf, (list) => batchOf(list[0])))
      : []),
    [selectedBranch],
  );

  const selectedBatch = batches.find((b) => b.key === batchKey) ?? null;

  const subjectRows: SubjectInsight[] = useMemo(
    () => (selectedBatch
      ? [...selectedBatch.subjects].sort((a, b) => (a.semester - b.semester) || a.courseName.localeCompare(b.courseName))
      : []),
    [selectedBatch],
  );

  const goBranch = () => { setBranchKey(null); setBatchKey(null); };
  const goBatch = () => setBatchKey(null);

  if (loading && !result) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={32} sx={{ color: '#0d9488' }} />
      </Box>
    );
  }
  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (!result || subjects.length === 0) {
    return (
      <Alert severity="info">
        No assigned subjects found for {windowLabel.toLowerCase()}. Subjects appear once faculty are
        mapped to a curriculum.
      </Alert>
    );
  }

  const summaryCard = (label: string, list: SubjectInsight[], onClick?: () => void, title?: string) => {
    const r = rollup(list);
    const body = (
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title ?? label}</Typography>
        <Typography variant="caption" color="text.secondary">
          {r.subjects} subject{r.subjects === 1 ? '' : 's'} · {r.faculty} faculty
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'baseline' }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>{percentText(r.attendancePct)}</Typography>
          <Typography variant="caption" color="text.secondary">attendance</Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, r.attendancePct ?? 0)}
          sx={{ mt: 1, height: 6, borderRadius: 3 }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {r.sessionsCompleted} / {r.sessionsTotal} classes held
        </Typography>
      </CardContent>
    );
    return (
      <Card key={label} variant="outlined" sx={{ height: '100%' }}>
        {onClick ? <CardActionArea onClick={onClick}>{body}</CardActionArea> : body}
      </Card>
    );
  };

  const crumbs = (
    <Breadcrumbs sx={{ mb: 2 }}>
      <Link component="button" variant="body2" onClick={goBranch} underline="hover" color="inherit">
        All branches
      </Link>
      {selectedBranch && (
        <Link
          component="button"
          variant="body2"
          onClick={goBatch}
          underline="hover"
          color={selectedBatch ? 'inherit' : 'text.primary'}
        >
          {selectedBranch.label}
        </Link>
      )}
      {selectedBatch && <Typography variant="body2" color="text.primary">Batch {selectedBatch.label}</Typography>}
    </Breadcrumbs>
  );

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Attendance drill-down</Typography>
        <Chip size="small" variant="outlined" label={windowLabel} />
      </Stack>
      {crumbs}

      {!selectedBranch && (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' } }}>
          {branches.map((g) => summaryCard(
            g.key,
            g.subjects,
            () => setBranchKey(g.key),
            g.label,
          ))}
        </Box>
      )}

      {selectedBranch && !selectedBatch && (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' } }}>
          {batches.map((g) => summaryCard(
            g.key,
            g.subjects,
            () => setBatchKey(g.key),
            g.key === NO_BATCH_LABEL ? NO_BATCH_LABEL : `Batch ${g.key}`,
          ))}
        </Box>
      )}

      {selectedBatch && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Semester</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>Faculty</TableCell>
                <TableCell align="right">Classes held</TableCell>
                <TableCell align="right">Attendance</TableCell>
                <TableCell align="right">Students marked</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {subjectRows.map((s) => {
                const r = rollup([s]);
                return (
                  <TableRow key={`${s.semester}-${s.curriculumId}-${s.facultyId}`} hover>
                    <TableCell>{s.semester}</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.courseName || 'Untitled subject'}</Typography>
                      {s.courseCode && (
                        <Typography variant="caption" color="text.secondary">{s.courseCode}</Typography>
                      )}
                    </TableCell>
                    <TableCell>{s.facultyName || '—'}</TableCell>
                    <TableCell align="right">{s.sessionsCompleted} / {s.sessionsTotal}</TableCell>
                    <TableCell align="right">{percentText(r.attendancePct)}</TableCell>
                    <TableCell align="right">{s.attendanceMarked}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

    </Box>
  );
}
