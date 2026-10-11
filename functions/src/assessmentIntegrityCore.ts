// functions/src/assessmentIntegrityCore.ts
//
// Turning the proctor events an attempt already records into something a
// faculty member can act on, next to the marks.
//
// WHY THIS EXISTS
// The exam surface has blocked paste, drop, the mobile clipboard chip, bulk
// insertions, tab switches and fullscreen exits for a while — and recorded
// every one of them on the attempt row. There was no screen that showed them.
// So the events sat in Firestore while a faculty member looked at a score with
// no idea that the answer which scored full marks arrived through four blocked
// pastes and six tab switches.
//
// WHAT IT DOES AND DOES NOT CLAIM
// This module counts evidence. It does not accuse. "3 blocked pastes, 6 tab
// switches, and this answer scored full marks" is a fact a faculty member can
// investigate; "this student cheated" is a conclusion this code is not entitled
// to draw, and a machine that draws it wrongly does real damage to a real
// student. So: counts by kind, the moments, an honest `reviewSuggested` flag
// with the REASON spelled out, and — in the UI — the judged per-case detail and
// the student's own code right beside it, which is where the actual decision
// gets made.
//
// Pure by design: no Firestore, no network, so `functions/test/assessmentIntegrity.test.ts`
// can pin the counts against the event shapes the browser actually sends.

/** Event types the client emits (see src/shared/utils/examLockdown.ts). */
export const INTEGRITY_EVENT_TYPES = [
  'paste_attempt',
  'copy_attempt',
  'cut_attempt',
  'drop_attempt',
  'context_menu',
  'bulk_input',
  'keyboard_shortcut',
  'tab_switch',
  'tab_limit_warning',
  'tab_limit_exceeded',
  'fullscreen_exit',
  'fullscreen_denied',
  'window_blur',
  'auto_submit',
] as const;

export type IntegrityEventType = (typeof INTEGRITY_EVENT_TYPES)[number];

/**
 * Events that mean "text arrived from outside this test". These are the ones
 * the whole lockdown exists for, and the ones worth a review flag: a student
 * who pastes an answer has done something the instructions forbid, whether or
 * not the pasted answer was theirs.
 */
export const INSERTION_EVENT_TYPES: readonly string[] = ['paste_attempt', 'drop_attempt', 'bulk_input'];

/** Focus changed away from the test window — suspicious only in quantity. */
export const FOCUS_EVENT_TYPES: readonly string[] = ['tab_switch', 'window_blur'];

/** A review flag needs this many insertion attempts before it fires at all. */
export const REVIEW_INSERTION_THRESHOLD = 1;

export interface IntegrityEvent {
  type: string;
  at?: string;
  details?: Record<string, unknown>;
}

export interface IntegritySummary {
  /** Total events recorded on the attempt. */
  total: number;
  /** Count per event type, in the order the types are declared. */
  counts: Record<string, number>;
  /** Insertion attempts (paste / drop / bulk insert) — the lockdown's reason. */
  insertionCount: number;
  /** Tab switches and blurs. */
  focusCount: number;
  /** Number of times the tab-switch limit was reached (the attempt was submitted). */
  tabLimitExceeded: number;
  fullscreenExits: number;
  autoSubmitted: boolean;
  /** True only when there is something concrete to look at. */
  reviewSuggested: boolean;
  /** The sentence shown next to the flag — states evidence, never a verdict. */
  reason: string;
  /** The first and last event moments, for the "when" of it. */
  firstEventAt: string;
  lastEventAt: string;
  /** The most recent insertion attempts, bounded, for the detail view. */
  recentInsertions: Array<{ type: string; at: string; chars: number | null }>;
}

const EMPTY_SUMMARY: IntegritySummary = {
  total: 0,
  counts: {},
  insertionCount: 0,
  focusCount: 0,
  tabLimitExceeded: 0,
  fullscreenExits: 0,
  autoSubmitted: false,
  reviewSuggested: false,
  reason: '',
  firstEventAt: '',
  lastEventAt: '',
  recentInsertions: [],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function charsOf(details: Record<string, unknown> | undefined): number | null {
  const chars = Number(details?.chars);
  return Number.isFinite(chars) && chars >= 0 ? Math.round(chars) : null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Counts an attempt's proctor events into the summary the faculty report shows.
 *
 * `scoredFullMarks` is optional and only sharpens the wording: an insertion
 * attempt on a paper the student also failed is noise, the same attempt on a
 * paper they aced is the thing worth reading. It never changes WHETHER the flag
 * fires — that would make the flag depend on performance, which is exactly the
 * kind of inference this module refuses to make.
 */
export function summarizeIntegrity(
  events: unknown,
  options: { scoredFullMarks?: boolean; autoSubmitted?: boolean; maxEvents?: number } = {},
): IntegritySummary {
  const list: IntegrityEvent[] = Array.isArray(events)
    ? events
        .filter(isObject)
        .map((event) => ({
          type: String(event.type || '').slice(0, 80),
          at: typeof event.at === 'string' ? event.at.slice(0, 40) : '',
          details: isObject(event.details) ? (event.details as Record<string, unknown>) : undefined,
        }))
        .filter((event) => event.type.length > 0)
    : [];
  if (list.length === 0) {
    return { ...EMPTY_SUMMARY, autoSubmitted: options.autoSubmitted === true };
  }

  const counts: Record<string, number> = {};
  let insertionCount = 0;
  let focusCount = 0;
  let tabLimitExceeded = 0;
  let fullscreenExits = 0;
  let autoSubmitted = options.autoSubmitted === true;
  const insertions: IntegritySummary['recentInsertions'] = [];

  for (const event of list) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    if (INSERTION_EVENT_TYPES.includes(event.type)) {
      insertionCount += 1;
      insertions.push({ type: event.type, at: event.at || '', chars: charsOf(event.details) });
    }
    if (FOCUS_EVENT_TYPES.includes(event.type)) focusCount += 1;
    if (event.type === 'tab_limit_exceeded') tabLimitExceeded += 1;
    if (event.type === 'fullscreen_exit') fullscreenExits += 1;
    if (event.type === 'auto_submit') autoSubmitted = true;
  }

  // The engine auto-submits the attempt the moment the tab-switch limit is
  // reached (ActiveTestPage → doSubmit(true)), so the flag on that event IS the
  // auto-submission. Reading it from the event keeps the summary correct even
  // when the row's own autoSubmitted field is missing.
  if (tabLimitExceeded > 0) autoSubmitted = true;

  const bounded = options.maxEvents && options.maxEvents > 0 ? list.slice(-options.maxEvents) : list;
  const firstEventAt = bounded[0]?.at || '';
  const lastEventAt = bounded[bounded.length - 1]?.at || '';

  const parts: string[] = [];
  if (insertionCount > 0) {
    parts.push(`${plural(insertionCount, 'blocked attempt', 'blocked attempts')} to paste or drop text into an answer`);
  }
  if (focusCount > 0) parts.push(`${plural(focusCount, 'switch', 'switches')} away from the test window`);
  if (fullscreenExits > 0) parts.push(`${plural(fullscreenExits, 'fullscreen exit', 'fullscreen exits')}`);
  if (autoSubmitted) parts.push('submitted automatically');

  const reviewSuggested = insertionCount >= REVIEW_INSERTION_THRESHOLD;
  const reason = reviewSuggested
    ? `${parts.join(', ')}.${options.scoredFullMarks ? ' The answer scored full marks — worth reading the code beside it.' : ''}`
    : parts.length > 0
      ? `${parts.join(', ')}.`
      : '';

  return {
    total: list.length,
    counts,
    insertionCount,
    focusCount,
    tabLimitExceeded,
    fullscreenExits,
    autoSubmitted,
    reviewSuggested,
    reason,
    firstEventAt,
    lastEventAt,
    recentInsertions: insertions.slice(-10),
  };
}

/**
 * Whether a graded attempt earned full marks, for the sharper wording above.
 * Deliberately tolerant of the shapes different grading paths leave behind
 * (percentage, or marks against a total) and silent when it cannot tell.
 */
export function scoredFullMarks(row: {
  marksObtained?: unknown;
  totalMarks?: unknown;
  percentage?: unknown;
}): boolean {
  const percentage = Number(row.percentage);
  if (Number.isFinite(percentage) && percentage > 0) return percentage >= 99.5;
  const marks = Number(row.marksObtained);
  const total = Number(row.totalMarks);
  if (Number.isFinite(marks) && Number.isFinite(total) && total > 0) return marks >= total - 0.005;
  return false;
}

/** The one-line label the report column shows, or '' when there is nothing. */
export function integrityLabel(summary: IntegritySummary): string {
  if (summary.total === 0) return '';
  if (summary.reviewSuggested) return 'Review';
  if (summary.focusCount > 0 || summary.fullscreenExits > 0) return 'Noted';
  return '';
}
