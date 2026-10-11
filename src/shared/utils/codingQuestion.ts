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
 * What the student is told about the tests deciding their marks. Shows the
 * COUNT (which is fair — a student should know how much is riding on hidden
 * tests) and never the cases.
 */
export function hiddenTestSummary(hiddenCaseCount: unknown): string {
  const count = Number(hiddenCaseCount);
  if (!Number.isFinite(count) || count <= 0) return 'This answer is graded by your faculty member.';
  return `Graded automatically against ${count} hidden test${count === 1 ? '' : 's'} — marks are awarded per test that passes.`;
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
