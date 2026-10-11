// functions/src/questionTypes.ts
//
// ONE source of truth for the question/response types the platform understands
// and — critically — the subset the online assessment engine can actually
// schedule, render and grade.
//
// WHY THIS EXISTS
// The schedulable set used to be inlined in studentAssessments.ts while the
// paper pipeline (paperParsing.ts) kept its own "supported" set that included
// `case_based` and `matching`. A paper whose first question was case-based
// therefore passed the server-side Confirm (and was flagged onlineReady),
// only to be rejected at schedule time with the cryptic "Question 1 is
// incomplete or uses an unsupported online response type" — exactly the error
// faculty saw after uploading a question paper PDF. Both sides now import the
// same sets from here.
//
// `matching` is a KNOWN type (the question bank stores and serves it) but the
// student test UI renders it as "not yet supported in online mode", so it must
// stay out of SCHEDULABLE_ONLINE_TYPES: rejecting it at Confirm time with a
// specific message beats surfacing it at schedule time.

/** Canonical (normalised) question type spellings the platform recognises. */
import { codingScheduleProblem, parseCodingConfig } from './codingAssessmentCore'

export const CANONICAL_QUESTION_TYPES = [
  'mcq',
  'multi_select',
  'true_false',
  'fill_in_blank',
  'short_answer',
  'long_answer',
  'numerical',
  'assertion_reason',
  'case_based',
  'matching',
  // A coded answer: the student writes a program, the platform compiles it in a
  // sandbox and scores it against hidden test cases (codingAssessmentCore.ts).
  'coding',
] as const

export type CanonicalQuestionType = (typeof CANONICAL_QUESTION_TYPES)[number]

/**
 * Response types the online assessment engine can schedule, render and grade:
 *   - choice types auto-grade against option flags;
 *   - fill_in_blank / numerical auto-grade against the stored answer;
 *   - short/long/case-based answers render a text box and grade manually
 *     (case-based renders its caseText plus a text answer).
 * `matching` is deliberately excluded (see module header).
 */
export const SCHEDULABLE_ONLINE_TYPES: ReadonlySet<string> = new Set([
  'mcq',
  'multi_select',
  'true_false',
  'fill_in_blank',
  'short_answer',
  'long_answer',
  'numerical',
  'assertion_reason',
  'case_based',
  'coding',
])

/** Choice types whose scheduling additionally requires at least 2 options. */
export const CHOICE_TYPES_REQUIRING_OPTIONS: ReadonlySet<string> = new Set([
  'mcq',
  'multi_select',
  'true_false',
  'assertion_reason',
])

/**
 * Normalises a raw type label (any spelling the imports have produced) to its
 * canonical form. Unknown labels fall back to the manual-graded answer types —
 * never to an objective format, which would invent auto-gradable questions.
 * Mirrors the alias tables in paperParsing.ts; keep them in sync if you add a
 * spelling.
 */
const TYPE_ALIASES: Record<string, CanonicalQuestionType> = {
  mcq: 'mcq',
  singlechoice: 'mcq',
  objective: 'mcq',
  multiplechoice: 'mcq',
  msq: 'multi_select',
  multiselect: 'multi_select',
  truefalse: 'true_false',
  tf: 'true_false',
  fillintheblank: 'fill_in_blank',
  fillintheblanks: 'fill_in_blank',
  fill_blank: 'fill_in_blank',
  fib: 'fill_in_blank',
  shortanswer: 'short_answer',
  short: 'short_answer',
  state: 'short_answer',
  longanswer: 'long_answer',
  long: 'long_answer',
  essay: 'long_answer',
  descriptive: 'long_answer',
  explain: 'long_answer',
  subjective: 'long_answer',
  numerical: 'numerical',
  nat: 'numerical',
  assertionreason: 'assertion_reason',
  casebased: 'case_based',
  casestudy: 'case_based',
  matching: 'matching',
  code: 'coding',
  coding: 'coding',
  codequestion: 'coding',
  codingquestion: 'coding',
  programming: 'coding',
  program: 'coding',
  programwrite: 'coding',
}

export function canonicalQuestionType(value: unknown): string {
  const compact = String(value || 'mcq').toLowerCase().replace(/[^a-z0-9]/g, '')
  return TYPE_ALIASES[compact] || compact
}

/** True when a raw label is a recognised type (alias or canonical). */
export function isKnownQuestionType(value: unknown): boolean {
  const compact = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (TYPE_ALIASES[compact]) return true
  // A canonical name passed verbatim (e.g. 'fill_in_blank') must also be
  // recognised — its compacted form matches no alias key.
  const verbatim = String(value ?? '').toLowerCase().trim()
  return (CANONICAL_QUESTION_TYPES as readonly string[]).includes(verbatim)
}

/** True when the (raw or canonical) type can be scheduled as an online test. */
export function isSchedulableOnlineType(value: unknown): boolean {
  return SCHEDULABLE_ONLINE_TYPES.has(canonicalQuestionType(value))
}

/** The minimum shape the schedule-time check needs (a normalised question). */
export interface SchedulableQuestionShape {
  order: number
  text: string
  type: string
  marks: number
  options: Array<{ id: string; text: string }>
  /** The coding configuration, for a `coding` question (see codingAssessmentCore). */
  coding?: unknown
}

/**
 * Finds the FIRST concrete problem that blocks a question from being
 * scheduled online, as a human sentence the faculty can act on — or null when
 * the question is fine. Replaces the single "incomplete or unsupported"
 * message that forced faculty to open the paper and guess which of four
 * different defects they were looking at.
 */
export function findSchedulingProblem(question: SchedulableQuestionShape): string | null {
  const type = canonicalQuestionType(question.type)
  if (!String(question.text ?? '').trim()) {
    return `Question ${question.order} has no question text — open the paper and add one.`
  }
  if (question.marks <= 0) {
    return `Question ${question.order} has no marks — set its marks before scheduling.`
  }
  if (!SCHEDULABLE_ONLINE_TYPES.has(type)) {
    if (type === 'matching') {
      return `Question ${question.order} is a "Match the following" question, which the online test engine does not render yet. Change it to a supported type (e.g. single-choice MCQ) in the paper.`
    }
    return `Question ${question.order} uses type "${type}", which the online test engine cannot schedule. Change it to a supported type (MCQ, True/False, Fill in the blank, Short/Long answer, Numerical, Assertion–Reason or Coding) in the paper.`
  }
  if (CHOICE_TYPES_REQUIRING_OPTIONS.has(type) && (question.options?.length || 0) < 2) {
    return `Question ${question.order} is a ${type.replace(/_/g, ' ')} question but has fewer than two options — add the missing options in the paper.`
  }
  if (type === 'coding') {
    // A coding question without hidden test cases cannot be scored — it would
    // silently contribute 0 to every student's total, which looks like a
    // grading bug rather than a missing configuration. Refuse it here, with
    // the same sentence the authoring form shows.
    const problem = codingScheduleProblem(parseCodingConfig(question.coding))
    if (problem) return `Question ${question.order} is a coding question: ${problem}`
  }
  return null
}
