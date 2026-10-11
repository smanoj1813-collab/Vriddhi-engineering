// src/shared/utils/codingQuestion.ts
//
// Pure helpers for the coding question type in the student player: the language
// list, the starter templates a student may begin from, the client-side check
// that mirrors the server's, and the one-line summary of a sample run.
//
// Nothing here talks to Firebase or the sandbox. The hard rule this module
// encodes is that the browser only ever knows about PUBLIC sample cases:
// `hiddenCaseCount` is a number, never the cases themselves.

/** One language a student may answer a coding question in. */
export interface CodingLanguageOption {
  id: 'c' | 'cpp' | 'java' | 'python';
  label: string;
  /** Shown next to the language picker so the student knows what is compiled. */
  hint: string;
  starter: string;
}

export const CODING_LANGUAGE_OPTIONS: CodingLanguageOption[] = [
  {
    id: 'python',
    label: 'Python 3',
    hint: 'Read input from stdin, print the answer.',
    starter: 'import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    # write your solution here\n    pass\n\nmain()\n',
  },
  {
    id: 'c',
    label: 'C',
    hint: 'C17, compiled with gcc. Read with scanf, print with printf.',
    starter: '#include <stdio.h>\n\nint main(void) {\n    /* write your solution here */\n    return 0;\n}\n',
  },
  {
    id: 'cpp',
    label: 'C++',
    hint: 'C++17, compiled with g++. Read with cin, print with cout.',
    starter: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // write your solution here\n    return 0;\n}\n',
  },
  {
    id: 'java',
    label: 'Java',
    hint: 'Main class named Main. Read with Scanner, print with System.out.',
    starter: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // write your solution here\n    }\n}\n',
  },
];

/** The same cap the server enforces (codingAssessmentCore.MAX_CODING_SOURCE_CHARS). */
export const CODING_SOURCE_MAX_CHARS = 16_000;

export function codingLanguageOption(id: unknown): CodingLanguageOption | null {
  const key = String(id ?? '').trim().toLowerCase();
  return CODING_LANGUAGE_OPTIONS.find((option) => option.id === key) ?? null;
}

/**
 * Starter code for a question: the faculty member's own template when they
 * wrote one, otherwise the language default so the student is never facing an
 * empty box with no idea how input arrives.
 */
export function starterForLanguage(
  language: unknown,
  providedStarters: Record<string, string> | undefined | null,
): string {
  const option = codingLanguageOption(language);
  if (!option) return '';
  const provided = providedStarters?.[option.id];
  return typeof provided === 'string' && provided.trim() ? provided : option.starter;
}

/**
 * Client-side version of the server's `codingAnswerProblem`, so the student is
 * told what is missing before the answer is submitted rather than after.
 * Returning null means the answer is worth sending.
 */
export function codingAnswerProblem(
  language: unknown,
  code: unknown,
  allowed: readonly string[] = [],
): string | null {
  const option = codingLanguageOption(language);
  if (!option) return 'Choose the language you wrote the answer in.';
  if (allowed.length > 0 && !allowed.includes(option.id)) {
    return `Answer this question in ${allowed.join(', ')}.`;
  }
  const source = typeof code === 'string' ? code : '';
  if (!source.trim()) return 'Write your solution before moving on.';
  if (source.length > CODING_SOURCE_MAX_CHARS) {
    return `Your answer is too long (${source.length.toLocaleString()} of ${CODING_SOURCE_MAX_CHARS.toLocaleString()} characters).`;
  }
  return null;
}

/** `true` when the answer is complete enough to submit. */
export function codingAnswerIsReady(
  language: unknown,
  code: unknown,
  allowed: readonly string[] = [],
): boolean {
  return codingAnswerProblem(language, code, allowed) === null;
}

export interface SampleRunResult {
  index: number;
  passed: boolean;
  status?: string;
  reason?: string;
  stdin?: string;
  expectedOutput?: string;
  got?: string;
  timeMs?: number | null;
}

/** "2 of 3 sample tests passed" — the one line above the per-case detail. */
export function summarizeSampleRun(results: SampleRunResult[] | undefined | null): string {
  const list = Array.isArray(results) ? results : [];
  if (list.length === 0) return 'No sample tests were run.';
  const passed = list.filter((result) => result.passed).length;
  if (passed === list.length) return `All ${list.length} sample tests passed.`;
  return `${passed} of ${list.length} sample tests passed.`;
}

/** Non-empty output, trimmed for display — the "your program printed" pane. */
export function displayOutput(value: unknown, maxChars = 2000): string {
  const text = typeof value === 'string' ? value : '';
  const trimmed = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!trimmed.trim()) return '(no output)';
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}\n… truncated` : trimmed;
}

/**
 * How many sample runs the student has left, or null when the question is
 * unlimited or the count is not known yet. Shown next to the Run button: a
 * student who does not know the budget rations clicks they do not need, and one
 * who does not know it ran out thinks the button is broken.
 */
export function dryRunsLeftText(remaining: unknown): string | null {
  const value = Number(remaining);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return 'No sample runs left — you can still submit your answer.';
  return `${value} sample run${value === 1 ? '' : 's'} left.`;
}

/**
 * A per-student question: the same question, drawn with this student's own
 * numbers, so an answer copied from someone else does not fit. Students are
 * told plainly — it is fairer, and it removes the "my friend's answer was
 * accepted" conversation at the faculty desk.
 */
export function variantNotice(variesByStudent: unknown): string | null {
  return variesByStudent === true
    ? 'The numbers in these tests are generated for you — a friend\'s answer with their numbers will not pass yours.'
    : null;
}

/**
 * What the student is told about the tests deciding their marks. Shows the
 * COUNT (which is fair — a student should know how much is riding on hidden
 * tests) and never the cases.
 */
export function hiddenTestSummary(hiddenCaseCount: unknown): string {
  const count = Number(hiddenCaseCount);
  if (!Number.isFinite(count) || count <= 0) return 'This answer is graded by your faculty member.';
  return `Graded automatically against ${count} hidden test${count === 1 ? '' : 's'} — marks are awarded per test that passes.`;
}

/** A placeholder a test case may draw: `{{a}}` inserts it, `{{a + b}}` uses it. */
export interface CodingPlaceholder {
  name: string;
  min: number;
  max: number;
}

/** The shape the authoring form edits and the server scores. */
export interface CodingConfigLike {
  languages?: string[];
  starterCode?: Record<string, string>;
  sampleCases?: Array<{ stdin?: string; expectedOutput?: string }>;
  testCases?: Array<{ stdin?: string; expectedOutput?: string }>;
  timeLimitSeconds?: number;
  placeholders?: CodingPlaceholder[];
  dryRunLimit?: number;
}

export const CODING_MAX_PLACEHOLDERS = 8;

/** Dry-run budgets a faculty member can pick. 0 = unlimited. */
export const CODING_DRY_RUN_CHOICES = [10, 25, 50, 100, 0] as const;
export const CODING_DEFAULT_DRY_RUN_LIMIT = 25;

/** "25 runs" / "Unlimited runs" — one label, used by the form and the report. */
export function dryRunLimitLabel(limit: unknown): string {
  const value = Math.round(Number(limit) || 0);
  if (value <= 0) return 'Unlimited sample runs';
  return `${value} sample run${value === 1 ? '' : 's'} per student`;
}
const PLACEHOLDER_NAME = /^[a-z][a-z0-9_]{0,15}$/i;
const PLACEHOLDER_TOKEN = /{{\s*([^{}]+?)\s*}}/g;

/**
 * Client-side check of the test VALUES. This is a lint, not the authority: the
 * server re-parses and evaluates every template before anything is scheduled
 * (functions/src/codingVariants.ts) and refuses the paper if it cannot. What
 * this catches is the typo a faculty member would rather see while typing —
 * a token naming a placeholder they forgot to declare, a division the evaluator
 * does not support, unbalanced braces.
 */
export function codingTemplateProblem(config: CodingConfigLike | null | undefined): string | null {
  const placeholders = config?.placeholders || [];
  const names = new Set(placeholders.map((placeholder) => String(placeholder.name || '').trim()));
  const cases = [...(config?.testCases || []), ...(config?.sampleCases || [])];
  for (const testCase of cases) {
    for (const side of ['stdin', 'expectedOutput'] as const) {
      const text = String(testCase?.[side] || '');
      PLACEHOLDER_TOKEN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PLACEHOLDER_TOKEN.exec(text)) !== null) {
        const expression = String(match[1]);
        if (expression.includes('/') || expression.includes('%')) {
          return 'Test values support +, − and × only — move any division into the question itself.';
        }
        const referenced = expression.match(/[a-z][a-z0-9_]*/gi) || [];
        if (referenced.length === 0) return `"{{${expression}}}" has nothing to work out.`;
        const unknown = referenced.find((name) => !names.has(name));
        if (unknown) return `"{{${expression}}}" uses ${unknown}, which is not one of your placeholders.`;
      }
      if (/{{\s*}}/.test(text)) return 'A test value has an empty {{}} — put a placeholder name inside it.';
      if (!/{{\s*([^{}]+?)\s*}}/.test(text) && (text.includes('{{') || text.includes('}}'))) {
        return 'A test value has unbalanced braces — check your {{placeholders}}.';
      }
    }
  }
  return null;
}

/** Problems with the declared placeholders, in the form's words. */
export function codingPlaceholderProblem(placeholders: CodingPlaceholder[] | undefined): string | null {
  const list = placeholders || [];
  if (list.length > CODING_MAX_PLACEHOLDERS) return `Keep it to ${CODING_MAX_PLACEHOLDERS} placeholders.`;
  const seen = new Set<string>();
  for (const placeholder of list) {
    const name = String(placeholder.name || '').trim();
    if (!PLACEHOLDER_NAME.test(name)) {
      return `"${name || '(blank)'}" is not a placeholder name — letters, digits and underscore, starting with a letter.`;
    }
    if (seen.has(name)) return `"${name}" is declared twice.`;
    seen.add(name);
    if (!Number.isInteger(Number(placeholder.min)) || !Number.isInteger(Number(placeholder.max))) {
      return `Give ${name} whole-number bounds.`;
    }
    if (Number(placeholder.min) > Number(placeholder.max)) return `The low bound for ${name} is above the high bound.`;
  }
  return null;
}

export const CODING_MAX_HIDDEN_CASES = 20;
export const CODING_MAX_SAMPLE_CASES = 5;
export const CODING_TIME_LIMITS = [1, 2, 3, 5, 10];

/**
 * Why a coding question cannot be scheduled yet, in the same words the server's
 * `codingScheduleProblem` uses — so the authoring form refuses the question at
 * the point it is written, not after the paper has been confirmed.
 */
export function codingConfigProblem(config: CodingConfigLike | null | undefined): string | null {
  if (!config) return 'Add the languages and hidden test cases for this coding question.';
  const languages = (config.languages || []).filter((id) => codingLanguageOption(id));
  if (languages.length === 0) return 'Pick at least one language the student may answer in.';
  const testCases = (config.testCases || []).filter((testCase) => String(testCase?.expectedOutput || '').trim());
  if (testCases.length === 0) {
    return 'Add at least one hidden test case with its expected output — without one there is nothing to score the code against.';
  }
  if (testCases.length > CODING_MAX_HIDDEN_CASES) {
    return `Keep it to ${CODING_MAX_HIDDEN_CASES} hidden tests; a paper does not need more.`;
  }
  if ((config.sampleCases || []).length > CODING_MAX_SAMPLE_CASES) {
    return `Keep it to ${CODING_MAX_SAMPLE_CASES} sample tests.`;
  }
  const timeLimit = Number(config.timeLimitSeconds);
  if (Number.isFinite(timeLimit) && (timeLimit < 1 || timeLimit > 10)) {
    return 'Set the time limit between 1 and 10 seconds per test.';
  }
  return codingPlaceholderProblem(config.placeholders) || codingTemplateProblem(config);
}

/** Tab inserts two spaces: a textarea in a browser has no editor to do it. */
export function applyTabIndent(value: string, selectionStart: number, selectionEnd: number): {
  value: string;
  caret: number;
} {
  const indent = '  ';
  const next = `${value.slice(0, selectionStart)}${indent}${value.slice(selectionEnd)}`;
  return { value: next, caret: selectionStart + indent.length };
}
