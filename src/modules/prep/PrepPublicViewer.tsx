// src/modules/prep/PrepPublicViewer.tsx
//
// The PUBLIC face of the Prep catalog — a shareable URL anyone can open to
// browse, check and verify the platform's prep content WITHOUT a college
// assignment (and without signing in). This is the "URL for the Prep studio"
// the platform team asked for: the authoring studio itself stays a
// superadmin surface (it writes content), but everything it publishes is
// platform-wide reference data, so browsing it needs no tenancy at all.
//
// Routes (all public, all deep-linkable):
//   /prep                                            → hub, ?program=bcom
//   /prep/subject/:subjectId                         → subject's topic list
//   /prep/subject/:subjectId/topic/:topicId          → full topic payload
//   /prep/papers                                     → previous-year question papers, ?program=bcom&sem=3
//   /prep/papers/:paperId                            → one paper as printed (PrepPapersViews.tsx)
//
// The server already enforces the boundary: GET /prep/subjects and the topic
// endpoints serve PUBLISHED content to anonymous callers and draft/review
// content only to the superadmin, so this page can never leak an unpublished
// draft even though it is reachable from any URL.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  Divider,
  Grid,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import {
  Assignment,
  AutoAwesome,
  Calculate,
  ChevronRight,
  FormatListNumbered,
  Lightbulb,
  MenuBook,
} from '@mui/icons-material';
import {
  fetchPrepSubjects,
  fetchPrepSubject,
  fetchPrepTopics,
  fetchPrepTopic,
  fetchPracticeQuestions,
  effectivePrepTrack,
  topicSubtopics,
  type PrepSubject,
  type PrepTopic,
  type UniversalQuestion,
  rememberLearnerCollege,
} from '@/shared/services/prepContentService';
import { formatStreamLabel } from '@/shared/utils/prepHelpers';
import { CompanyStrip, CompanyView } from './PrepCompanyViews';
import { FrequentQuestionsView, PapersBlock, PapersLibraryView, PaperView } from './PrepPapersViews';
import {
  AUDIENCE_LABELS,
  DifficultyChip,
  PROGRAM_LABELS,
  PrepMarkdown,
  PrepPageNav,
  ProgramControl,
  SectionHeader,
  ShareLinkButton,
  readStoredProgram,
  rememberProgram,
  renderInline,
  streamColor,
  topicCountLabel,
  yearGroupLabel,
} from './prepPublicShared';
import { useAuth } from '@/modules/auth/context/AuthContext';

// ─── Header (shared by all three views) ─────────────────────────────────────

function PrepHeader() {
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Container maxWidth="lg" sx={{ py: 1.75, display: 'flex', alignItems: 'center', gap: 1 }}>
        <MenuBook color="primary" />
        <Typography
          component={Link}
          to="/prep"
          variant="h6"
          sx={{ fontWeight: 800, color: 'text.primary', textDecoration: 'none', '&:hover': { color: 'primary.main' } }}
        >
          Vriddhi <Box component="span" sx={{ color: 'primary.main' }}>Prep</Box>
        </Typography>
        {/* Student-facing: what the page is for. (The old line led with NEP
            2020 / CBCS, which is internal vocabulary — §1 problem 8.) */}
        <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, ml: 1 }}>
          Free study packs &amp; placement prep for UG / PG students
        </Typography>
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          <Button size="small" component={Link} to="/">Open Vriddhi</Button>
          <Button size="small" component={Link} to="/login">Sign in</Button>
        </Box>
      </Container>
    </Box>
  );
}

/** One sub-topic row: title always visible, brief expands on tap. */
function SubtopicBrief({ index, title, briefMd }: { index: number; title: string; briefMd: string }) {
  const [open, setOpen] = useState(false);
  const hasBrief = Boolean(briefMd && briefMd.trim());
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Box
        role={hasBrief ? 'button' : undefined}
        tabIndex={hasBrief ? 0 : undefined}
        aria-expanded={hasBrief ? open : undefined}
        onClick={() => hasBrief && setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (!hasBrief) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, cursor: hasBrief ? 'pointer' : 'default' }}
      >
        <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', minWidth: 20 }}>{index}.</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>{title}</Typography>
        {hasBrief ? (
          <Typography variant="caption" color="primary" sx={{ fontWeight: 700 }}>{open ? 'Hide brief' : 'Brief'}</Typography>
        ) : null}
      </Box>
      {hasBrief && open ? (
        <Box sx={{ px: 1.5, pb: 1.5, pl: { xs: 1.5, sm: 5.5 } }}>
          <Divider sx={{ mb: 1 }} />
          <PrepMarkdown text={briefMd} />
        </Box>
      ) : null}
    </Box>
  );
}

// ─── View 1: Hub — "study my subjects" and "prepare for placements" ─────────
//
// Rebuilt from a flat catalog grid (one identical card per subject, chips
// before titles, three stacked sections) into a learner's entry point:
//
//   • two jobs side by side above the fold — semester accordion on the left
//     (7/12), tinted placement band on the right (5/12);
//   • on a phone the placement band comes FIRST as a horizontal-scroll strip,
//     then the accordion, so both are reachable in one thumb-scroll;
//   • title first, one line of metadata (`5 topics`), no description in the
//     grid — those live on the subject page;
//   • hierarchy by semester, with the last-opened semester remembered per
//     program so a reload (or a back-navigation from a subject) lands where
//     the learner left off.

/** Per-program memory of which semester groups were expanded. */
function openSemestersKey(program: string): string {
  return `vriddhi.prep.openSemesters.${program}`;
}

function readOpenSemesters(program: string): string[] | null {
  try {
    const raw = localStorage.getItem(openSemestersKey(program));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : null;
  } catch {
    return null;
  }
}

function writeOpenSemesters(program: string, keys: string[]): void {
  try {
    localStorage.setItem(openSemestersKey(program), JSON.stringify(keys));
  } catch {
    /* private mode / quota — the accordion simply starts at semester 1 */
  }
}

interface SemesterGroup {
  key: string;
  label: string;
  /** `2nd year` — only when every subject in the group agrees on it. */
  yearLabel: string | null;
  subjects: PrepSubject[];
}

/** Syllabus order, then name, so ties stay stable across refetches. */
function sortSubjects(list: PrepSubject[]): PrepSubject[] {
  return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}

function unanimousYearLabel(subjects: PrepSubject[]): string | null {
  const labels = new Set(subjects.map((s) => yearGroupLabel(s.yearGroup)).filter(Boolean));
  return labels.size === 1 ? [...labels][0] : null;
}

/**
 * §5.1 grouping rule: by `semester` when present, else by `yearGroup`, else a
 * catch-all — never a blank hole and never an arbitrary grid position.
 */
function groupAcademicSubjects(subjects: PrepSubject[]): SemesterGroup[] {
  const bySemester = new Map<number, PrepSubject[]>();
  const byYear = new Map<string, PrepSubject[]>();
  const other: PrepSubject[] = [];

  for (const subject of subjects) {
    if (typeof subject.semester === 'number' && subject.semester > 0) {
      const list = bySemester.get(subject.semester) || [];
      list.push(subject);
      bySemester.set(subject.semester, list);
    } else if (subject.yearGroup) {
      const list = byYear.get(subject.yearGroup) || [];
      list.push(subject);
      byYear.set(subject.yearGroup, list);
    } else {
      other.push(subject);
    }
  }

  const groups: SemesterGroup[] = [];
  for (const semester of [...bySemester.keys()].sort((a, b) => a - b)) {
    const items = sortSubjects(bySemester.get(semester) || []);
    groups.push({
      key: `sem-${semester}`,
      label: `Semester ${semester}`,
      yearLabel: unanimousYearLabel(items),
      subjects: items,
    });
  }
  // Year groups keep syllabus order (1st → 2nd → final) and sort after the
  // numbered semesters, since a program that ships both is rare and the
  // numbered ones are the ones students navigate by.
  const yearOrder = ['1st-year', '2nd-year', 'final-year'];
  const years = [...byYear.keys()].sort((a, b) => {
    const ia = yearOrder.indexOf(a);
    const ib = yearOrder.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  for (const year of years) {
    groups.push({
      key: `year-${year}`,
      label: yearGroupLabel(year) || year,
      yearLabel: null,
      subjects: sortSubjects(byYear.get(year) || []),
    });
  }
  if (other.length > 0) {
    groups.push({ key: 'other', label: 'Other study packs', yearLabel: null, subjects: sortSubjects(other) });
  }
  return groups;
}

/** `/prep/subject/:id` plus the program the learner came from, so "back" lands
 *  on the same catalog (and the same open semester) rather than a default. */
function subjectPath(subjectId: string, program?: string | null): string {
  return program ? `/prep/subject/${subjectId}?program=${program}` : `/prep/subject/${subjectId}`;
}

function HubView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = String(searchParams.get('program') || '').toLowerCase();
  // URL wins; otherwise the last program this device looked at; otherwise BBA.
  const program = PROGRAM_LABELS[fromUrl] ? fromUrl : readStoredProgram() || 'bba';
  // `?sem=3` — a subject/topic breadcrumb points back at the semester it lives
  // in, so "back" reopens that group even if another one was expanded last.
  const semParam = String(searchParams.get('sem') || '').trim();
  const requestedSemester = /^\d{1,2}$/.test(semParam) ? `sem-${Number(semParam)}` : null;

  const [subjects, setSubjects] = useState<PrepSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPrepSubjects({ program })
      .then((data) => !cancelled && setSubjects(data))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load the catalog.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [program, attempt]);

  const pickProgram = (code: string) => {
    rememberProgram(code);
    const next = new URLSearchParams(searchParams);
    next.set('program', code);
    // A semester hint belongs to the program it was created under.
    next.delete('sem');
    // replace: paging through programs must not bury the browser back button.
    setSearchParams(next, { replace: true });
  };

  // Academic subjects are scoped to the program; aptitude subjects are the
  // shared placement catalogue (QA / LR / Verbal) listed for every program.
  const academicSubjects = useMemo(() => subjects.filter((s) => effectivePrepTrack(s) === 'academic'), [subjects]);
  const aptitudeSubjects = useMemo(() => subjects.filter((s) => effectivePrepTrack(s) === 'aptitude'), [subjects]);
  const groups = useMemo(() => groupAcademicSubjects(academicSubjects), [academicSubjects]);
  const topicTotal = academicSubjects.reduce((n, s) => n + (s.topicCount || 0), 0);

  // Expanded semester groups. `null` = not resolved yet for this program, so
  // the first group renders open instead of flashing a collapsed accordion.
  const [openKeys, setOpenKeys] = useState<string[] | null>(null);
  useEffect(() => {
    setOpenKeys(null);
  }, [program, requestedSemester]);
  useEffect(() => {
    if (openKeys !== null || loading || groups.length === 0) return;
    if (requestedSemester && groups.some((g) => g.key === requestedSemester)) {
      setOpenKeys([requestedSemester]);
      return;
    }
    const stored = (readOpenSemesters(program) || []).filter((k) => groups.some((g) => g.key === k));
    setOpenKeys(stored.length > 0 ? stored : [groups[0].key]);
  }, [openKeys, loading, groups, program, requestedSemester]);

  const open = openKeys ?? (groups.length > 0 ? [groups[0].key] : []);
  const toggleGroup = (key: string) => {
    const next = open.includes(key) ? open.filter((k) => k !== key) : [...open, key];
    setOpenKeys(next);
    writeOpenSemesters(program, next);
  };

  const nothingPublished = !loading && !error && subjects.length === 0;

  return (
    <>
      <ProgramControl
        active={program}
        onPick={pickProgram}
        action={<ShareLinkButton path={`/prep?program=${program}`} compact />}
      />
      <Container maxWidth="lg" sx={{ py: { xs: 2, md: 3 } }}>
        {error ? (
          <Card variant="outlined">
            <Stack spacing={1.5} sx={{ p: 3, alignItems: 'flex-start' }}>
              <Typography sx={{ fontWeight: 700 }}>Could not load the {PROGRAM_LABELS[program]} catalog</Typography>
              <Typography variant="body2" color="error.main">{error}</Typography>
              <Button size="small" variant="outlined" onClick={() => setAttempt((a) => a + 1)}>Try again</Button>
            </Stack>
          </Card>
        ) : nothingPublished ? (
          <Card variant="outlined">
            <Box sx={{ p: { xs: 3, md: 4 }, textAlign: 'center' }}>
              <Typography variant="h6" sx={{ fontWeight: 800 }} gutterBottom>
                No published {PROGRAM_LABELS[program]} packs yet
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 620, mx: 'auto' }}>
                Study packs for this program are still being written. Try another program above — the placement
                aptitude packs are shared by every UG and PG program.
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                A superadmin can seed this catalog from Superadmin → Prep Content Studio.
              </Typography>
            </Box>
          </Card>
        ) : (
          <Grid container spacing={{ xs: 2, md: 3 }} sx={{ alignItems: 'flex-start' }}>
            {/* Study column first in the DOM (it is the page's main job, so a
                screen reader meets it first); the placement band is pulled
                above it visually on a phone with CSS order (§3.2). */}
            <Grid size={{ xs: 12, md: 7 }} sx={{ order: { xs: 2, md: 1 }, minWidth: 0 }}>
              <Stack spacing={1.5}>
                <SectionHeader
                  kicker="Study"
                  title="Study your subjects"
                  meta={
                    loading
                      ? `Loading ${PROGRAM_LABELS[program]} packs…`
                      : `${PROGRAM_LABELS[program]} · ${academicSubjects.length} subject${academicSubjects.length === 1 ? '' : 's'} · ${topicTotal} topics`
                  }
                />
                {loading ? (
                  <Stack spacing={1}>
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} variant="rounded" height={48} sx={{ borderRadius: 2.5 }} />
                    ))}
                  </Stack>
                ) : groups.length === 0 ? (
                  <EmptyBlock
                    title={`No ${PROGRAM_LABELS[program]} subjects published yet`}
                    body="The semester packs for this program are still being written. The aptitude packs and company guides for placement prep are available right now."
                  />
                ) : (
                  <Stack spacing={1}>
                    {groups.map((group) => (
                      <SemesterSection
                        key={group.key}
                        group={group}
                        program={program}
                        open={open.includes(group.key)}
                        onToggle={() => toggleGroup(group.key)}
                      />
                    ))}
                  </Stack>
                )}
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }} sx={{ order: { xs: 1, md: 2 }, minWidth: 0 }}>
              <Stack spacing={{ xs: 2, md: 3 }}>
                <PlacementBlock program={program} subjects={aptitudeSubjects} loading={loading} />
                <PapersBlock program={program} />
              </Stack>
            </Grid>
          </Grid>
        )}
      </Container>
    </>
  );
}

/** Dashed placeholder so a block never renders as an empty hole (§3.2). */
function EmptyBlock({ title, body }: { title: string; body: string }) {
  return (
    <Box
      sx={{
        border: '1px dashed',
        borderColor: 'divider',
        borderRadius: 2.5,
        px: 2,
        py: 3,
        textAlign: 'center',
        bgcolor: 'background.paper',
      }}
    >
      <Typography sx={{ fontWeight: 700, fontSize: 15 }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 460, mx: 'auto' }}>
        {body}
      </Typography>
    </Box>
  );
}

/** One collapsible semester: `Semester 3 · 2nd year · 3 subjects`. */
function SemesterSection({
  group,
  program,
  open,
  onToggle,
}: {
  group: SemesterGroup;
  program: string;
  open: boolean;
  onToggle: () => void;
}) {
  const buttonId = `prep-sem-${group.key}-toggle`;
  const panelId = `prep-sem-${group.key}-panel`;
  const meta = [group.yearLabel, `${group.subjects.length} subject${group.subjects.length === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2.5, bgcolor: 'background.paper', overflow: 'hidden' }}>
      <Box
        component="button"
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          py: 1,
          font: 'inherit',
          textAlign: 'left',
          color: 'text.primary',
          border: 0,
          cursor: 'pointer',
          bgcolor: open ? 'action.hover' : 'transparent',
          '&:hover': { bgcolor: 'action.hover' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'secondary.main', outlineOffset: -2 },
        }}
      >
        <ChevronRight
          aria-hidden
          sx={{
            fontSize: 20,
            flexShrink: 0,
            color: 'text.secondary',
            transition: 'transform .18s ease',
            transform: open ? 'rotate(90deg)' : 'none',
          }}
        />
        <Typography
          sx={{
            flex: 1,
            minWidth: 0,
            fontWeight: 800,
            fontSize: 15,
            lineHeight: 1.35,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {group.label}
          <Box component="span" sx={{ fontWeight: 600, fontSize: 13, color: 'text.secondary' }}>
            {' · '}
            {meta}
          </Box>
        </Typography>
      </Box>
      <Collapse in={open}>
        <Box id={panelId} role="region" aria-labelledby={buttonId} sx={{ px: 1.25, pb: 1.25 }}>
          <Stack spacing={0.75}>
            {group.subjects.map((subject) => (
              <SubjectRow key={subject.id} subject={subject} program={program} />
            ))}
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * One subject: a 3px rule in the stream colour, the title, and a single line
 * of metadata. No chips before the title, no truncated description (§1 #2, #6).
 */
function SubjectRow({ subject, program }: { subject: PrepSubject; program: string }) {
  const color = streamColor(subject.stream);
  return (
    <CardActionArea
      component={Link}
      to={subjectPath(subject.id, program)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: 0.875,
        borderRadius: 2,
        bgcolor: 'background.default',
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: `3px solid ${color}`,
        '&:hover': { borderColor: 'primary.light', borderLeftColor: color, bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'secondary.main', outlineOffset: 1 },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontWeight: 700,
            fontSize: 14.5,
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {subject.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {topicCountLabel(subject.topicCount)}
        </Typography>
      </Box>
      <ChevronRight aria-hidden sx={{ fontSize: 18, color: 'text.disabled', flexShrink: 0 }} />
    </CardActionArea>
  );
}

// ─── Placement block (aptitude tiles + company guides) ──────────────────────

/**
 * Short, tile-sized names for the three shared aptitude packs. The catalog
 * names are correct on the subject page but too long for a 130px tile, so the
 * hub uses these; anything added later falls back to its own name.
 */
const APTITUDE_TILES: Record<string, { monogram: string; label: string }> = {
  'apt-quantitative-aptitude': { monogram: 'QA', label: 'Quantitative Aptitude' },
  'apt-logical-reasoning': { monogram: 'LR', label: 'Logical Reasoning' },
  'apt-verbal-ability': { monogram: 'VA', label: 'Verbal Ability' },
};

function aptitudeTile(subject: PrepSubject): { monogram: string; label: string } {
  const known = APTITUDE_TILES[subject.id];
  if (known) return known;
  const words = subject.name.split(/[\s&,/-]+/).filter(Boolean);
  const monogram = words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return { monogram: monogram || 'AP', label: subject.name };
}

/**
 * The tinted band that makes placement prep visible without scrolling (§1 #4):
 * three compact aptitude tiles + the company guides, always rendered — a
 * college that hides company prep simply loses the company sub-block.
 */
function PlacementBlock({ program, subjects, loading }: { program: string; subjects: PrepSubject[]; loading: boolean }) {
  return (
    <Box
      sx={{
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        p: { xs: 1.5, md: 2 },
        backgroundImage: (theme) =>
          theme.palette.mode === 'dark'
            ? 'linear-gradient(155deg, rgba(99,102,241,0.20) 0%, rgba(13,148,136,0.12) 55%, rgba(19,27,46,0) 100%)'
            : 'linear-gradient(155deg, rgba(99,102,241,0.10) 0%, rgba(13,148,136,0.07) 55%, rgba(255,255,255,0) 100%)',
      }}
    >
      <SectionHeader
        kicker="Placement"
        title="Prepare for placements"
        meta="The aptitude core every recruiter tests, plus company-wise guides."
      />

      <Box sx={{ mt: 1.5 }}>
        {loading ? (
          <Box sx={{ display: 'flex', gap: 1 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} variant="rounded" height={86} sx={{ flex: 1, borderRadius: 2 }} />
            ))}
          </Box>
        ) : subjects.length === 0 ? (
          <EmptyBlock
            title="Aptitude packs not published yet"
            body="Quantitative Aptitude, Logical Reasoning and Verbal Ability are being published for all programs."
          />
        ) : (
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              flexWrap: { xs: 'nowrap', md: 'wrap' },
              overflowX: { xs: 'auto', md: 'visible' },
              pb: { xs: 0.5, md: 0 },
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            {subjects.map((subject) => (
              <Box key={subject.id} sx={{ flex: { xs: '0 0 132px', md: '1 1 calc(33.333% - 6px)' }, minWidth: 0 }}>
                <AptitudeTile subject={subject} program={program} />
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Box sx={{ mt: 2 }}>
        <CompanyStrip program={program} />
      </Box>
    </Box>
  );
}

function AptitudeTile({ subject, program }: { subject: PrepSubject; program: string }) {
  const { monogram, label } = aptitudeTile(subject);
  const color = streamColor(subject.stream);
  return (
    <CardActionArea
      component={Link}
      to={subjectPath(subject.id, program)}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 0.75,
        p: 1.25,
        borderRadius: 2,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        '&:hover': { borderColor: 'primary.light', bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'secondary.main', outlineOffset: 1 },
      }}
    >
      <Box
        aria-hidden
        sx={{
          width: 30,
          height: 30,
          borderRadius: 1.5,
          display: 'grid',
          placeItems: 'center',
          // Tinted swatch, near-black letters: the colour stays decorative so
          // the monogram keeps ≥ 4.5:1 contrast in both themes.
          bgcolor: `${color}24`,
          color: 'text.primary',
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: '.02em',
        }}
      >
        {monogram}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontWeight: 800,
            fontSize: 13.5,
            lineHeight: 1.25,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {topicCountLabel(subject.topicCount)}
        </Typography>
      </Box>
    </CardActionArea>
  );
}

// ─── View 2: Subject (topic list) ───────────────────────────────────────────

function SubjectView({ subjectId }: { subjectId: string }) {
  const [searchParams] = useSearchParams();
  const urlProgram = String(searchParams.get('program') || '').toLowerCase();
  const [subject, setSubject] = useState<PrepSubject | null>(null);
  const [topics, setTopics] = useState<PrepTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchPrepSubject(subjectId).catch(() => null), fetchPrepTopics(subjectId).catch(() => [])])
      .then(([subj, tops]) => {
        if (cancelled) return;
        if (!subj) {
          setError('This subject does not exist or is not published.');
          return;
        }
        setSubject(subj);
        setTopics(tops);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [subjectId]);

  if (loading) return <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;
  if (error) return <Container maxWidth="lg" sx={{ py: 3 }}><Card><Box sx={{ p: 3, color: 'error.main' }}>{error}</Box></Card></Container>;
  if (!subject) return null;

  const isAptitude = effectivePrepTrack(subject) === 'aptitude';
  // The hub links here with `?program=`, so "back" returns to the catalog the
  // learner was actually browsing; a bare deep link falls back to the
  // subject's own program list.
  const backProgram = PROGRAM_LABELS[urlProgram] ? urlProgram : subject.programs?.[0] || readStoredProgram() || 'bba';
  const hubPath = `/prep?program=${backProgram}`;
  const crumbs = [
    { label: 'Prep', to: '/prep' },
    { label: PROGRAM_LABELS[backProgram] || backProgram, to: hubPath },
    isAptitude ? { label: 'Placement aptitude', to: hubPath } : null,
    subject.semester ? { label: `Semester ${subject.semester}`, to: `${hubPath}&sem=${subject.semester}` } : null,
    { label: subject.name },
  ];
  // Group topics by module (moduleNumber + moduleName). Academic subjects use
  // one topic per module, which collapses to a single group and renders as
  // before; aptitude subjects have several topics per module.
  const moduleGroups: Array<{ key: string; label: string; topics: PrepTopic[] }> = [];
  for (const t of topics) {
    const key = `${t.moduleNumber ?? t.order}`;
    let g = moduleGroups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: t.moduleName || `Module ${t.moduleNumber ?? t.order}`, topics: [] };
      moduleGroups.push(g);
    }
    g.topics.push(t);
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={2}>
        <PrepPageNav crumbs={crumbs} sharePath={`/prep/subject/${subject.id}`} backTo={hubPath} />
        <Typography variant="h4" sx={{ fontWeight: 800 }}>{subject.name}</Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }} useFlexGap>
          <Chip label={formatStreamLabel(subject.stream)} size="small" />
          {subject.semester ? <Chip size="small" variant="outlined" label={`Semester ${subject.semester}`} /> : null}
          {subject.yearGroup ? <Chip size="small" variant="outlined" label={subject.yearGroup} /> : null}
          {isAptitude ? (
            <Chip size="small" variant="outlined" color="primary" label="All UG & PG programs" />
          ) : (
            (subject.programs || []).map((p) => (
              <Chip key={p} size="small" variant="outlined" color="primary" label={PROGRAM_LABELS[p] || p} />
            ))
          )}
          {subject.syllabusRef ? <Chip size="small" variant="outlined" label={subject.syllabusRef} /> : null}
        </Stack>
        {subject.description ? (
          <Typography variant="body1" color="text.secondary">{subject.description}</Typography>
        ) : null}

        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {isAptitude ? 'Modules & topics' : 'Module Topics'}
        </Typography>
        {topics.length === 0 ? (
          <Card><Box sx={{ p: 3, color: 'text.secondary' }}>No published topics yet for this subject.</Box></Card>
        ) : (
          <Stack spacing={3}>
            {moduleGroups.map((group) => (
              <Stack spacing={1.5} key={group.key}>
                {moduleGroups.length > 1 ? (
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{group.label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {group.topics.length} topic{group.topics.length === 1 ? '' : 's'} · {group.topics.reduce((n, t) => n + topicSubtopics(t).length, 0)} sub-topics
                    </Typography>
                  </Box>
                ) : null}
                <Grid container spacing={2}>
                  {group.topics.map((topic) => {
                    const subs = topicSubtopics(topic);
                    return (
                      <Grid size={{ xs: 12, sm: 6 }} key={topic.id}>
                        <Card variant="outlined" sx={{ height: '100%' }}>
                          <CardActionArea
                            component={Link}
                            to={`/prep/subject/${subject.id}/topic/${topic.id}?program=${backProgram}`}
                            sx={{ height: '100%', p: 2 }}
                          >
                            <Stack spacing={1}>
                              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700 }}>
                                  {moduleGroups.length > 1
                                    ? `Topic ${topic.order}`
                                    : topic.moduleName ? `Module ${topic.moduleNumber ?? topic.order} — ${topic.moduleName}` : `Module ${topic.order}`}
                                </Typography>
                                <Stack direction="row" spacing={0.5}>
                                  {topic.examFrequency === 'very_high' ? <Chip size="small" color="warning" variant="outlined" label="Very high frequency" /> : null}
                                  <DifficultyChip difficulty={topic.difficulty} />
                                </Stack>
                              </Stack>
                              <Typography variant="h6" sx={{ fontWeight: 700 }}>{topic.title}</Typography>
                              {subs.length > 0 ? (
                                <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                  {subs.length} sub-topics: {subs.map((st) => st.title).join(' · ')}
                                </Typography>
                              ) : null}
                            </Stack>
                          </CardActionArea>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}

// ─── View 3: Topic (the four sections + practice preview) ───────────────────

function TopicView({ subjectId, topicId }: { subjectId: string; topicId: string }) {
  const [searchParams] = useSearchParams();
  const urlProgram = String(searchParams.get('program') || '').toLowerCase();
  const [topic, setTopic] = useState<PrepTopic | null>(null);
  // Fetched only to name the breadcrumb (`… › Business Statistics › Topic`);
  // a failure here must never block the topic itself.
  const [subject, setSubject] = useState<PrepSubject | null>(null);
  const [practice, setPractice] = useState<UniversalQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'explanation' | 'formulas' | 'tricks' | 'howtosolve' | 'practice'>('explanation');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setActiveSection('explanation');
    Promise.all([
      fetchPrepTopic(subjectId, topicId).catch(() => null),
      fetchPrepSubject(subjectId).catch(() => null),
      fetchPracticeQuestions({ topicId, count: 6 }).catch(() => []),
    ])
      .then(([top, subj, questions]) => {
        if (cancelled) return;
        if (!top) {
          setError('This topic does not exist or is not published.');
          return;
        }
        setTopic(top);
        setSubject(subj);
        setPractice(questions);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [subjectId, topicId]);

  if (loading) return <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;
  if (error) return <Container maxWidth="lg" sx={{ py: 3 }}><Card><Box sx={{ p: 3, color: 'error.main' }}>{error}</Box></Card></Container>;
  if (!topic) return null;

  const backProgram = PROGRAM_LABELS[urlProgram] ? urlProgram : subject?.programs?.[0] || readStoredProgram() || 'bba';
  const hubPath = `/prep?program=${backProgram}`;
  const subjectHref = `/prep/subject/${subjectId}?program=${backProgram}`;
  const isAptitudeSubject = effectivePrepTrack(subject) === 'aptitude';
  const crumbs = [
    { label: 'Prep', to: '/prep' },
    { label: PROGRAM_LABELS[backProgram] || backProgram, to: hubPath },
    isAptitudeSubject ? { label: 'Placement aptitude', to: hubPath } : null,
    subject?.semester ? { label: `Semester ${subject.semester}`, to: `${hubPath}&sem=${subject.semester}` } : null,
    { label: subject?.name || 'Subject', to: subjectHref },
    { label: topic.title },
  ];

  const subtopics = topicSubtopics(topic);

  const sections: Array<{ id: typeof activeSection; label: string; icon: React.ReactElement }> = [
    { id: 'explanation', label: 'Explanation', icon: <MenuBook fontSize="small" /> },
    { id: 'formulas', label: 'Formulas', icon: <Calculate fontSize="small" /> },
    { id: 'tricks', label: 'Tricks', icon: <Lightbulb fontSize="small" /> },
    { id: 'howtosolve', label: 'How to Solve', icon: <FormatListNumbered fontSize="small" /> },
    { id: 'practice', label: 'Practice', icon: <Assignment fontSize="small" /> },
  ];

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={2}>
        <PrepPageNav
          crumbs={crumbs}
          sharePath={`/prep/subject/${subjectId}/topic/${topicId}`}
          backTo={subjectHref}
        />

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <AutoAwesome color="primary" fontSize="small" />
          <Typography variant="h5" sx={{ fontWeight: 800 }}>{topic.title}</Typography>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }} useFlexGap>
          {topic.moduleName ? <Chip size="small" variant="outlined" label={topic.moduleName} /> : null}
          <DifficultyChip difficulty={topic.difficulty} />
          <Chip size="small" variant="outlined" label={topic.tier === 'free' ? 'Free' : 'Premium'} color={topic.tier === 'free' ? 'success' : 'secondary'} />
          {topic.examFrequency ? <Chip size="small" variant="outlined" label={`Exam frequency: ${topic.examFrequency.replace(/_/g, ' ')}`} /> : null}
          {(topic.audience || []).length > 0 && (topic.audience || []).length < 3 ? (
            <Chip size="small" variant="outlined" label={`Mainly for: ${(topic.audience || []).map((a) => AUDIENCE_LABELS[a] || a).join(', ')}`} />
          ) : null}
        </Stack>

        {subtopics.length > 0 ? (
          <Card variant="outlined">
            <Box sx={{ p: { xs: 2, md: 2.5 } }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>What this topic covers</Typography>
              <Typography variant="caption" color="text.secondary">
                {subtopics.length} sub-topics — expand any one for a quick brief before reading the full explanation.
              </Typography>
              <Stack spacing={1} sx={{ mt: 1.5 }}>
                {subtopics.map((st, idx) => (
                  <SubtopicBrief key={st.id || idx} index={idx + 1} title={st.title} briefMd={st.briefMd} />
                ))}
              </Stack>
            </Box>
          </Card>
        ) : null}

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }} useFlexGap>
          {sections.map((s) => (
            <Chip
              key={s.id}
              icon={s.icon}
              label={s.label}
              onClick={() => setActiveSection(s.id)}
              color={activeSection === s.id ? 'primary' : 'default'}
              variant={activeSection === s.id ? 'filled' : 'outlined'}
            />
          ))}
        </Stack>

        <Card>
          <Box sx={{ p: { xs: 2, md: 3 } }}>
            {activeSection === 'explanation' && <PrepMarkdown text={topic.explanationMd || 'No explanation published yet.'} />}
            {activeSection === 'formulas' && (
              (topic.formulas || []).length === 0 ? (
                <Typography color="text.secondary">No formulas published yet.</Typography>
              ) : (
                <Stack spacing={2}>
                  {topic.formulas.map((f) => (
                    <Box key={f.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{f.label}</Typography>
                      <Box sx={{ overflowX: 'auto' }}>
                        <PrepMarkdown text={`$$${f.formula}$$`} />
                      </Box>
                      {f.exampleQ ? (
                        <Box sx={{ mt: 1.5 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>Example</Typography>
                          <Typography variant="body2">{renderInline(f.exampleQ, 'eq')}</Typography>
                          <Typography variant="body2" color="text.secondary">{renderInline(f.exampleA || '', 'ea')}</Typography>
                        </Box>
                      ) : null}
                    </Box>
                  ))}
                </Stack>
              )
            )}
            {activeSection === 'tricks' && (
              (topic.tricks || []).length === 0 ? (
                <Typography color="text.secondary">No tricks published yet.</Typography>
              ) : (
                <Stack spacing={2}>
                  {topic.tricks.map((t) => (
                    <Box key={t.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t.title}</Typography>
                      <Typography variant="body2" sx={{ my: 0.5 }}>{renderInline(t.trick, 'trick')}</Typography>
                      {t.whenToUse ? (
                        <Typography variant="caption" color="text.secondary">When to use: {t.whenToUse}</Typography>
                      ) : null}
                    </Box>
                  ))}
                </Stack>
              )
            )}
            {activeSection === 'howtosolve' && (
              (topic.howToSolve || []).length === 0 ? (
                <Typography color="text.secondary">No solve guide published yet.</Typography>
              ) : (
                <Stack spacing={2}>
                  {topic.howToSolve.map((s) => (
                    <Box key={s.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{s.step}</Typography>
                      <Typography variant="body2" sx={{ my: 0.5 }}>{renderInline(s.detail, 'solve')}</Typography>
                      {s.questionType ? (
                        <Typography variant="caption" color="text.secondary">{s.questionType}</Typography>
                      ) : null}
                    </Box>
                  ))}
                </Stack>
              )
            )}
            {activeSection === 'practice' && (
              practice.length === 0 ? (
                <Typography color="text.secondary">No practice questions linked to this topic yet.</Typography>
              ) : (
                <Stack spacing={2}>
                  {practice.map((q, idx) => (
                    <Box key={q.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mb: 1 }}>
                        <Typography sx={{ fontWeight: 800 }}>{idx + 1}.</Typography>
                        <Typography sx={{ fontWeight: 500, flex: 1 }}>{renderInline(q.questionText, `q${idx}`)}</Typography>
                        <DifficultyChip difficulty={q.difficulty} />
                      </Stack>
                      <Stack spacing={0.5}>
                        {q.options.map((opt, oIdx) => (
                          <Box
                            key={oIdx}
                            sx={{
                              px: 1.5,
                              py: 0.75,
                              borderRadius: 1.5,
                              border: 1,
                              borderColor: oIdx === q.correctIndex ? 'success.main' : 'divider',
                              bgcolor: oIdx === q.correctIndex ? 'success.main' : 'transparent',
                              color: oIdx === q.correctIndex ? 'common.white' : 'text.primary',
                              opacity: oIdx === q.correctIndex ? 0.9 : 1,
                            }}
                          >
                            {String.fromCharCode(65 + oIdx)}. {opt}
                          </Box>
                        ))}
                      </Stack>
                      <Box sx={{ mt: 1, px: 1.5, py: 1, bgcolor: 'rgba(13,148,136,0.06)', borderRadius: 1.5 }}>
                        <Typography variant="body2" color="text.secondary">{q.explanation}</Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              )
            )}
          </Box>
        </Card>
      </Stack>
    </Container>
  );
}

// ─── Page shell ─────────────────────────────────────────────────────────────

export default function PrepPublicViewer({
  view,
}: {
  view: 'hub' | 'subject' | 'topic' | 'company' | 'papers' | 'paper' | 'repeats'
}) {
  const params = useParams<{ subjectId: string; topicId: string; companyCode: string; paperId: string }>();
  // The prep pages are public, but a signed-in learner's college decides
  // which company guides they may see. Remember it so anonymous follow-up
  // visits (and the strip on this page) are filtered the same way.
  const { user } = useAuth();
  useEffect(() => {
    rememberLearnerCollege(user?.collegeId);
  }, [user?.collegeId]);
  const body = useMemo(() => {
    if (view === 'hub') return <HubView />;
    if (view === 'subject') return <SubjectView subjectId={params.subjectId || ''} />;
    if (view === 'company') return <CompanyView code={params.companyCode || ''} />;
    if (view === 'papers') return <PapersLibraryView />;
    if (view === 'repeats') return <FrequentQuestionsView />;
    if (view === 'paper') return <PaperView paperId={params.paperId || ''} />;
    return <TopicView subjectId={params.subjectId || ''} topicId={params.topicId || ''} />;
  }, [view, params.subjectId, params.topicId, params.companyCode, params.paperId]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <PrepHeader />
      {/* One Vriddhi Phase C — the practice → assessment loop, reversed. A
          signed-in student practising here is one tap from their scheduled
          tests; the assessments page itself enforces the college toggles, so
          this link never points at a hidden surface. */}
      {user?.role === 'student' && (
        <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
          <Container maxWidth="lg" sx={{ py: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">
              Practising for a scheduled test?
            </Typography>
            <Button
              size="small"
              component={Link}
              to="/student/assessments"
              data-testid="prep-loop-assessments"
            >
              See my upcoming tests →
            </Button>
          </Container>
        </Box>
      )}
      {body}
      <Box component="footer" sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          Vriddhi Prep — Karnataka NEP 2020 / CBCS platform curriculum. Content is platform-wide and
          needs no college assignment; only published material is visible here.
        </Typography>
      </Box>
    </Box>
  );
}
