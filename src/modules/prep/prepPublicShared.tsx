// src/modules/prep/prepPublicShared.tsx
//
// Building blocks shared by the public /prep views (catalog, topic, company):
// program labels, the design tokens + shells the hub redesign introduced
// (stream colours, SectionHeader, Breadcrumb, ProgramControl), the tiny
// markdown renderer, share button and difficulty chip.
// Kept separate so PrepPublicViewer and PrepCompanyViews do not import each
// other.

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Button, Chip, Container, Divider, IconButton, Stack, Typography } from '@mui/material';
import { ArrowLeft, Check, ChevronRight, Share } from '@mui/icons-material';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { formatDifficultyBadge } from '@/shared/utils/prepHelpers';

// Platform catalog, mirroring PREP_PROGRAM_CATALOG in functions/src/prepShared.ts
// (kept local so the public page has no cross-app import into the functions
// source tree).
export const PROGRAMS: Array<{ code: string; label: string; level: 'undergraduate' | 'postgraduate' }> = [
  { code: 'bba', label: 'BBA', level: 'undergraduate' },
  { code: 'bcom', label: 'B.Com', level: 'undergraduate' },
  { code: 'ba', label: 'BA', level: 'undergraduate' },
  { code: 'bsc', label: 'B.Sc', level: 'undergraduate' },
  { code: 'bca', label: 'BCA', level: 'undergraduate' },
  { code: 'cse', label: 'CSE', level: 'undergraduate' },
  { code: 'ece', label: 'ECE', level: 'undergraduate' },
  { code: 'eee', label: 'EEE', level: 'undergraduate' },
  { code: 'mba', label: 'MBA', level: 'postgraduate' },
  { code: 'mcom', label: 'M.Com', level: 'postgraduate' },
  { code: 'mca', label: 'MCA', level: 'postgraduate' },
];

export const PROGRAM_LABELS: Record<string, string> = Object.fromEntries(PROGRAMS.map((p) => [p.code, p.label]));

export const AUDIENCE_LABELS: Record<string, string> = {
  ug: 'UG (BBA / B.Com / BA / B.Sc)',
  pg: 'PG (MBA / M.Com / MCA)',
  tech: 'Tech roles (BCA / MCA / CSE / ECE)',
};

// ─── Design tokens ───────────────────────────────────────────────────────────
//
// The hub redesign (docs/handoff-prep-hub-redesign.md §3) asks for a dense,
// calm surface where the subject TITLE leads and metadata is a single line.
// Colour is therefore reduced to one signal — the stream — and it is only ever
// used as a 3px rule / small swatch, never as a chip in front of a title.
// These tokens are the single place the conventions live so the hub, the
// subject pages and the company pages cannot drift apart.

/**
 * Stream → colour. Mid-tone on purpose: readable as a rule on white paper and
 * on the dark theme's #131b2e surface without needing a second palette.
 */
export const STREAM_COLORS: Record<string, string> = {
  commerce: '#0d9488', // teal-600 — accounting & commerce
  management: '#6366f1', // indigo-500 — management & OB
  economics: '#0891b2', // cyan-600
  finance: '#2563eb', // blue-600
  aptitude: '#7c3aed', // violet-600 — quant / statistics
  communication: '#db2777', // pink-600 — verbal & communication
  law: '#b45309', // amber-700
  taxation: '#047857', // emerald-700
  operations: '#ea580c', // orange-600
  strategy: '#4338ca', // indigo-700
  computing: '#0f766e', // teal-700 — computing and engineering
  electronics: '#b45309', // amber-700 — electronics and communication
  electrical: '#a16207', // yellow-700 — electrical power and machines
};

/** Slate-500 — a subject whose stream is missing or unknown. */
export const STREAM_NEUTRAL = '#64748b';

export function streamColor(stream?: string | null): string {
  return STREAM_COLORS[(stream || '').toLowerCase()] || STREAM_NEUTRAL;
}

/** `1st-year` → `1st year`. Returns null when the subject carries no year. */
export function yearGroupLabel(yearGroup?: string | null): string | null {
  if (!yearGroup) return null;
  const mapped: Record<string, string> = {
    '1st-year': '1st year',
    '2nd-year': '2nd year',
    '3rd-year': '3rd year',
    '4th-year': '4th year',
    'final-year': 'Final year',
    'pg-first-year': 'PG 1st year',
    'pg-second-year': 'PG 2nd year',
  };
  return mapped[yearGroup] || yearGroup.replace(/-/g, ' ');
}

/** `5` → `5 topics`; `1` → `1 topic`. The hub's only per-subject metadata. */
export function topicCountLabel(count?: number | null): string {
  const n = count || 0;
  return `${n} topic${n === 1 ? '' : 's'}`;
}

// ─── Shells: section header + breadcrumb ────────────────────────────────────

/**
 * The one section heading treatment used across /prep: a small uppercase
 * kicker, a bold title, at most one line of secondary meta, and an optional
 * right-aligned action. Replaces the bare `h6`s the old hub stacked.
 */
export function SectionHeader({
  kicker,
  title,
  meta,
  sx,
}: {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  /** At most one line of secondary metadata — never a second chip row. */
  meta?: React.ReactNode;
  sx?: Record<string, unknown>;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, ...sx }}
    >
      <Box sx={{ minWidth: 0 }}>
        {kicker ? (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              fontSize: 11,
              lineHeight: 1.4,
              fontWeight: 800,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: 'text.secondary',
            }}
          >
            {kicker}
          </Typography>
        ) : null}
        <Typography component="h2" variant="h6" sx={{ fontWeight: 800, lineHeight: 1.25, letterSpacing: '-0.01em' }}>
          {title}
        </Typography>
        {meta ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {meta}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}

export interface Crumb {
  label: string;
  /** Omit on the last crumb — the current page is text, never a link. */
  to?: string;
}

/**
 * "You are here" for every /prep page:
 *   Prep › BBA › Semester 3 › Business Statistics › Sampling Distributions
 * The last crumb is the current page (`aria-current="page"`); everything before
 * it is a link, so a learner can jump back to the exact program/semester.
 */
export function Breadcrumb({ items }: { items: Array<Crumb | null | undefined> }) {
  const crumbs = items.filter((c): c is Crumb => Boolean(c && c.label));
  if (crumbs.length === 0) return null;
  return (
    <Box component="nav" aria-label="Breadcrumb" sx={{ minWidth: 0 }}>
      <Box
        component="ol"
        sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.25, m: 0, p: 0, listStyle: 'none' }}
      >
        {crumbs.map((crumb, idx) => {
          const last = idx === crumbs.length - 1;
          return (
            <Box component="li" key={`${crumb.label}-${idx}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
              {idx > 0 ? <ChevronRight sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }} aria-hidden /> : null}
              {crumb.to && !last ? (
                <Typography
                  component={Link}
                  to={crumb.to}
                  variant="body2"
                  sx={{
                    color: 'text.secondary',
                    textDecoration: 'none',
                    fontSize: 13,
                    borderRadius: 1,
                    '&:hover': { color: 'primary.main', textDecoration: 'underline' },
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'secondary.main', outlineOffset: 2 },
                  }}
                >
                  {crumb.label}
                </Typography>
              ) : (
                <Typography
                  variant="body2"
                  aria-current={last ? 'page' : undefined}
                  sx={{
                    fontSize: 13,
                    fontWeight: last ? 700 : 500,
                    color: last ? 'text.primary' : 'text.secondary',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {crumb.label}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * The single nav row every /prep page uses (§3.5 "same header treatment"):
 * back arrow → breadcrumb → share. Replaces three slightly different
 * "Back to …" buttons that did not tell the learner where they were.
 */
export function PrepPageNav({
  crumbs,
  sharePath,
  backTo,
}: {
  crumbs: Array<Crumb | null | undefined>;
  sharePath: string;
  /** Usually the program's hub URL, so browser-style back stays available. */
  backTo?: string;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0, flex: 1 }}>
        {backTo ? (
          <IconButton
            component={Link}
            to={backTo}
            size="small"
            aria-label="Back to the prep catalog"
            sx={{ ml: -0.5, flexShrink: 0, color: 'text.secondary' }}
          >
            <ArrowLeft fontSize="small" />
          </IconButton>
        ) : null}
        <Breadcrumb items={crumbs} />
      </Stack>
      <Box sx={{ flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
        <ShareLinkButton path={sharePath} />
      </Box>
      <Box sx={{ flexShrink: 0, display: { xs: 'block', sm: 'none' } }}>
        <ShareLinkButton path={sharePath} compact />
      </Box>
    </Stack>
  );
}

// ─── Program picker (segmented, UG / PG, sticky) ────────────────────────────

const PROGRAM_STORAGE_KEY = 'vriddhi.prep.program';

/** Last program the learner picked on this device (used when the URL has none). */
export function readStoredProgram(): string | null {
  try {
    const raw = localStorage.getItem(PROGRAM_STORAGE_KEY);
    return raw && PROGRAM_LABELS[raw] ? raw : null;
  } catch {
    return null;
  }
}

export function rememberProgram(code: string): void {
  try {
    if (PROGRAM_LABELS[code]) localStorage.setItem(PROGRAM_STORAGE_KEY, code);
  } catch {
    /* private mode / quota — the URL param still carries the choice */
  }
}

const PROGRAM_GROUPS: Array<{ key: 'undergraduate' | 'postgraduate'; label: string }> = [
  { key: 'undergraduate', label: 'Undergraduate' },
  { key: 'postgraduate', label: 'Postgraduate' },
];

/**
 * Segmented UG / PG program control. Replaces the old row of undifferentiated
 * pills (`BBA B.Com … MCA (PG)`): the level is now a visible group label
 * instead of a suffix, the bar scrolls sideways on a phone instead of wrapping
 * unpredictably, and it sticks to the top while the catalog scrolls.
 */
export function ProgramControl({
  active,
  onPick,
  action,
  sticky = true,
  programOptions = PROGRAMS,
}: {
  active: string;
  onPick: (code: string) => void;
  /** Right-aligned slot — the hub keeps the page's share button here. */
  action?: React.ReactNode;
  sticky?: boolean;
  programOptions?: typeof PROGRAMS;
}) {
  return (
    <Box
      sx={{
        position: sticky ? 'sticky' : 'relative',
        top: 0,
        zIndex: 20,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Container maxWidth="lg" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        {/* The pills scroll sideways on a phone; the action stays pinned right
            so it never hides at the end of the overflow. */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            overflowX: 'auto',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
        {PROGRAM_GROUPS.map((group, groupIdx) => {
          const programs = programOptions.filter((p) => p.level === group.key);
          if (programs.length === 0) return null;
          return (
            <React.Fragment key={group.key}>
              {groupIdx > 0 ? (
                <Divider orientation="vertical" flexItem sx={{ my: 0.5, mx: 0.25, flexShrink: 0 }} />
              ) : null}
              <Typography
                variant="caption"
                sx={{
                  display: { xs: 'none', sm: 'block' },
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  color: 'text.secondary',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {group.label}
              </Typography>
              <Box role="group" aria-label={`${group.label} programs`} sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                {programs.map((p) => {
                  const on = p.code === active;
                  return (
                    <Box
                      key={p.code}
                      component="button"
                      type="button"
                      onClick={() => onPick(p.code)}
                      aria-current={on ? 'true' : undefined}
                      aria-pressed={on}
                      title={`${p.label} — ${group.label}`}
                      sx={{
                        font: 'inherit',
                        fontSize: 13,
                        fontWeight: on ? 800 : 600,
                        lineHeight: 1,
                        px: 1.25,
                        py: 0.875,
                        borderRadius: 999,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        border: '1px solid',
                        borderColor: on ? 'primary.main' : 'divider',
                        bgcolor: on ? 'primary.main' : 'transparent',
                        color: on ? 'primary.contrastText' : 'text.primary',
                        transition: 'background-color .15s ease, color .15s ease, border-color .15s ease',
                        '&:hover': { bgcolor: on ? 'primary.dark' : 'action.hover' },
                        '&:focus-visible': { outline: '2px solid', outlineColor: 'secondary.main', outlineOffset: 2 },
                      }}
                    >
                      {p.label}
                    </Box>
                  );
                })}
              </Box>
            </React.Fragment>
          );
        })}
        </Box>
        {action ? <Box sx={{ pl: 0.5, flexShrink: 0 }}>{action}</Box> : null}
      </Container>
    </Box>
  );
}

// ─── Tiny markdown renderer (headings, lists, bold/italic/code, KaTeX) ──────

export function renderInline(text: string, keyBase: string): React.ReactNode[] {
  // $math$ → KaTeX inline, `code` → <code>, **bold** / *italic*
  const parts: React.ReactNode[] = [];
  const pattern = /(\$[^$\n]+\$)|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (match[1]) {
      const math = token.slice(1, -1);
      let html = '';
      try {
        html = katex.renderToString(math, { throwOnError: false });
      } catch {
        html = '';
      }
      parts.push(
        <code key={`${keyBase}-m${i}`} style={{ fontFamily: 'inherit' }}>
          {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : math}
        </code>
      );
    } else if (match[2]) {
      parts.push(<code key={`${keyBase}-c${i}`} style={{ background: 'rgba(0,0,0,0.06)', padding: '0 4px', borderRadius: 4 }}>{token.slice(1, -1)}</code>);
    } else if (match[3]) {
      parts.push(<strong key={`${keyBase}-b${i}`}>{token.slice(2, -2)}</strong>);
    } else if (match[4]) {
      parts.push(<em key={`${keyBase}-i${i}`}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function PrepMarkdown({ text }: { text: string }) {
  const lines = (text || '').split('\n');
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items;
    const ordered = list.ordered;
    blocks.push(
      ordered ? (
        <ol key={key++} style={{ margin: '8px 0', paddingLeft: 22 }}>
          {items.map((it, idx) => (
            <li key={idx} style={{ marginBottom: 4 }}>{renderInline(it, `li${key}-${idx}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key++} style={{ margin: '8px 0', paddingLeft: 22 }}>
          {items.map((it, idx) => (
            <li key={idx} style={{ marginBottom: 4 }}>{renderInline(it, `lu${key}-${idx}`)}</li>
          ))}
        </ul>
      )
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const displayMath = line.match(/^\$\$[\s\S]+\$\$/);
    if (displayMath) {
      flushList();
      let html = '';
      try {
        html = katex.renderToString(displayMath[0].slice(2, -2).trim(), { displayMode: true, throwOnError: false });
      } catch {
        html = '';
      }
      blocks.push(
        <Box key={key++} sx={{ my: 1.5, px: 2, py: 1, bgcolor: 'rgba(13,148,136,0.06)', borderRadius: 2, overflowX: 'auto', textAlign: 'center' }}>
          {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : displayMath[0]}
        </Box>
      );
      continue;
    }
    // ![Caption](https://…) on its own line → figure block. Only http(s)
    // URLs are rendered (the Studio "Upload image" control produces exactly
    // this syntax with a Storage URL).
    const image = line.match(/^!\[([^\]]*)\]\((https?:\/\/\S+?)\)\s*$/);
    if (image) {
      flushList();
      blocks.push(
        <Box key={key++} sx={{ my: 1.5, textAlign: 'center' }}>
          <img
            src={image[2]}
            alt={image[1] || 'Diagram'}
            loading="lazy"
            style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)' }}
          />
          {image[1] ? (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {image[1]}
            </Typography>
          ) : null}
        </Box>,
      );
      continue;
    }
    if (!line.trim()) {
      flushList();
      continue;
    }
    if (line.startsWith('### ')) {
      flushList();
      blocks.push(<Typography key={key++} variant="subtitle2" sx={{ mt: 2, mb: 0.5, fontWeight: 700 }}>{line.slice(4)}</Typography>);
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      blocks.push(<Typography key={key++} variant="h6" sx={{ mt: 2, mb: 0.5, fontWeight: 700 }}>{line.slice(3)}</Typography>);
      continue;
    }
    if (line.startsWith('# ')) {
      flushList();
      blocks.push(<Typography key={key++} variant="h5" sx={{ mt: 1, mb: 0.5, fontWeight: 800 }}>{line.slice(2)}</Typography>);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushList();
      blocks.push(<Divider key={key++} sx={{ my: 1.5 }} />);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet || numbered)![1]);
      continue;
    }
    flushList();
    blocks.push(<Typography key={key++} variant="body2" sx={{ my: 0.5, lineHeight: 1.7 }}>{renderInline(line, `p${key}`)}</Typography>);
  }
  flushList();
  return <Box>{blocks}</Box>;
}

// ─── Share link ──────────────────────────────────────────────────────────────

export function ShareLinkButton({ path, compact = false }: { path: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${path}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can be unavailable on http origins; fall back to a
      // transient prompt so the link is still retrievable.
      window.prompt('Copy this link:', url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  // The hub's sticky program bar has no room for a label, so it asks for the
  // icon-only form; every other page keeps the labelled button.
  if (compact) {
    return (
      <IconButton
        size="small"
        onClick={copy}
        aria-label={copied ? 'Link copied' : 'Share or copy link to this page'}
        sx={{ color: copied ? 'success.main' : 'text.secondary' }}
      >
        {copied ? <Check fontSize="small" /> : <Share fontSize="small" />}
      </IconButton>
    );
  }
  return (
    <Button size="small" variant="outlined" onClick={copy} startIcon={copied ? <Check fontSize="inherit" /> : <Share fontSize="inherit" />}>
      {copied ? 'Link copied' : 'Share / copy link'}
    </Button>
  );
}


export function DifficultyChip({ difficulty }: { difficulty?: string }) {
  // formatDifficultyBadge returns Tailwind classes (studio-tab styling); this
  // public page is MUI, so map the difficulty onto MUI chip colors instead.
  const norm = (difficulty || '').toLowerCase();
  const color =
    norm === 'basic' ? ('success' as const)
      : norm === 'advanced' ? ('secondary' as const)
        : ('primary' as const);
  return <Chip size="small" label={formatDifficultyBadge(difficulty).label} color={color} variant="outlined" />;
}
