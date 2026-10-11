// functions/src/codingAssessmentCore.ts
//
// Coding questions in an online assessment: the shape a faculty member
// authors, the comparison a sandbox verdict is turned into, and the arithmetic
// that turns "4 of 6 hidden tests passed" into marks.
//
// WHY IT IS PURE
// The engine's scoring has to be explainable to a student ("you lost 2 marks on
// test 5: output did not match") and to a SAR/NAAC reviewer. Every decision here
// is a plain function over plain data, so `functions/test/codingAssessment.test.ts`
// can pin the arithmetic and the verdict mapping without a sandbox, a Firestore
// or a network. The Judge0 HTTP plumbing lives in codeRunner.ts; this module
// never talks to it.
//
// WHY PARTIAL MARKS
// Engineering students debug; a first submission that passes 8 of 10 hidden
// cases is worth more than one that compiles but fails everything, and a
// zero-or-full-mark scheme discards that signal. Marks are therefore split
// across the hidden cases (equally, or by explicit per-case weight) and awarded
// per passing case — with the question's own marks as the ceiling, always.

/** Languages the platform can actually compile and run (mirrors the runner). */
export const CODING_LANGUAGES = ['c', 'cpp', 'java', 'python'] as const;
export type CodingLanguage = (typeof CODING_LANGUAGES)[number];

export const MAX_CODING_TEST_CASES = 20;
export const MAX_CODING_SAMPLE_CASES = 5;
export const MAX_CODING_SOURCE_CHARS = 16_000;
export const MAX_CODING_STDIN_CHARS = 4_000;
export const MAX_CODING_OUTPUT_CHARS = 4_000;
export const MAX_CODING_STARTER_CHARS = 4_000;
export const CODING_TIME_LIMIT_MIN_SECONDS = 1;
export const CODING_TIME_LIMIT_MAX_SECONDS = 10;
export const CODING_DEFAULT_TIME_LIMIT_SECONDS = 2;

/** Spellings the imports and the authoring form have produced. */
const LANGUAGE_ALIASES: Record<string, CodingLanguage> = {
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  cplusplus: 'cpp',
  'c plus plus': 'cpp',
  java: 'java',
  python: 'python',
  python3: 'python',
  py: 'python',
};

export function isCodingLanguage(value: unknown): value is CodingLanguage {
  return (CODING_LANGUAGES as readonly string[]).includes(String(value ?? '').toLowerCase().trim());
}

/** Normalises a language label, or null when the platform cannot run it. */
export function normalizeCodingLanguage(value: unknown): CodingLanguage | null {
  const key = String(value ?? '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
  return LANGUAGE_ALIASES[key] ?? null;
}

export interface CodingCase {
  stdin: string;
  expectedOutput: string;
  /** Explicit weight; when present on EVERY case the split follows it. */
  marks?: number;
}

export interface CodingQuestionConfig {
  /** Languages the student may answer in. Never empty after parsing. */
  languages: CodingLanguage[];
  starterCode: Partial<Record<CodingLanguage, string>>;
  /** Shown to the student; running these is allowed during the test. */
  sampleCases: CodingCase[];
  /** Hidden. Never sent to the browser, never stored on the attempt row. */
  testCases: CodingCase[];
  timeLimitSeconds: number;
}

function trimText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  // Normalise the line endings an editor or a paste may have introduced, then
  // cap. Trailing spaces on a line are meaningful in a program's output, so
  // only the ending newline(s) are trimmed here.
  return value.replace(/\r\n?/g, '\n').slice(0, maxChars).replace(/\n+$/, '');
}

function parseCaseList(raw: unknown, max: number): CodingCase[] {
  if (!Array.isArray(raw)) return [];
  const cases: CodingCase[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const value = entry as Record<string, unknown>;
    const stdin = trimText(value.stdin ?? value.input ?? '', MAX_CODING_STDIN_CHARS);
    const expectedOutput = trimText(
      value.expectedOutput ?? value.expected ?? value.output ?? '',
      MAX_CODING_OUTPUT_CHARS,
    );
    // A case without an expected output cannot be scored, so it is not a case.
    if (!expectedOutput) continue;
    const marks = Number(value.marks);
    cases.push({
      stdin,
      expectedOutput,
      ...(Number.isFinite(marks) && marks >= 0 ? { marks } : {}),
    });
    if (cases.length >= max) break;
  }
  return cases;
}

/**
 * Reads a coding-question configuration off a question document, accepting the
 * aliases the authoring surfaces and the question-bank import have produced.
 * Returns null when the field is absent or names no runnable language — the
 * question is then not a coding question at all, and the caller falls back to
 * the ordinary manual-graded path rather than inventing a broken one.
 */
export function parseCodingConfig(raw: unknown): CodingQuestionConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const requested = Array.isArray(value.languages)
    ? value.languages
    : typeof value.languages === 'string'
      ? String(value.languages).split(/[,\s]+/)
      : [];
  const languages: CodingLanguage[] = [];
  for (const item of requested) {
    const language = normalizeCodingLanguage(item);
    if (language && !languages.includes(language)) languages.push(language);
  }
  if (languages.length === 0) {
    // A coding question with no language list is answered in any supported
    // language; that is a sane default, and the run-time allowlist still
    // applies (MAX_CODING_SOURCE_CHARS, sandbox limits).
    languages.push(...CODING_LANGUAGES);
  }

  const starterRaw = value.starterCode;
  const starterCode: Partial<Record<CodingLanguage, string>> = {};
  if (starterRaw && typeof starterRaw === 'object' && !Array.isArray(starterRaw)) {
    for (const [key, text] of Object.entries(starterRaw as Record<string, unknown>)) {
      const language = normalizeCodingLanguage(key);
      const source = trimText(text, MAX_CODING_STARTER_CHARS);
      if (language && source) starterCode[language] = source;
    }
  }

  const timeLimitRaw = Number(value.timeLimitSeconds ?? value.timeLimit);
  const timeLimitSeconds = Number.isFinite(timeLimitRaw)
    ? Math.min(
        CODING_TIME_LIMIT_MAX_SECONDS,
        Math.max(CODING_TIME_LIMIT_MIN_SECONDS, Math.round(timeLimitRaw)),
      )
    : CODING_DEFAULT_TIME_LIMIT_SECONDS;

  return {
    languages,
    starterCode,
    sampleCases: parseCaseList(value.sampleCases ?? value.samples, MAX_CODING_SAMPLE_CASES),
    testCases: parseCaseList(value.testCases ?? value.hiddenCases ?? value.tests, MAX_CODING_TEST_CASES),
    timeLimitSeconds,
  };
}

/**
 * What still blocks a coding question from being scheduled online, as a
 * sentence faculty can act on — or null when it is ready. Mirrors
 * `findSchedulingProblem` in questionTypes.ts for the other types.
 */
export function codingScheduleProblem(config: CodingQuestionConfig | null): string | null {
  if (!config) return 'Coding questions need a language, starter code or at least one hidden test case.';
  if (config.languages.length === 0) return 'Pick at least one language the student may answer in.';
  if (config.testCases.length === 0) {
    return 'Add at least one hidden test case — without one there is nothing to score the code against.';
  }
  if (config.testCases.every((testCase) => !testCase.expectedOutput.trim())) {
    return 'Every hidden test case needs an expected output.';
  }
  return null;
}

/**
 * The comparison used for every case: trailing whitespace at the very end does
 * not fail an otherwise correct program (that is how almost every judge
 * behaves, and it is the difference between "right" and "right except for the
 * final newline"), but everything inside the output is significant.
 */
export function normalizeJudgeOutput(value: unknown): string {
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
    .trimEnd();
}

export type CodingCaseStatus =
  | 'accepted'
  | 'wrong_answer'
  | 'timeout'
  | 'compile_error'
  | 'runtime_error'
  | 'judge_error';

/** Judge0 status ids: 3 accepted, 4 wrong answer, 5 TLE, 6 CE, 7..12 RE, 13/14 internal. */
export function codingCaseStatusFromJudgeId(statusId: unknown): CodingCaseStatus {
  const id = Number(statusId);
  if (id === 3 || id === 4) return 'accepted';
  if (id === 5) return 'timeout';
  if (id === 6) return 'compile_error';
  if (id >= 7 && id <= 12) return 'runtime_error';
  return 'judge_error';
}

export interface JudgeCaseOutcome {
  statusId: number;
  stdout?: string | null;
  stderr?: string | null;
  compileOutput?: string | null;
  timeMs?: number | null;
  memoryKb?: number | null;
}

export interface CodingCaseVerdict {
  /** 0-based position of the case in the question's list. */
  index: number;
  passed: boolean;
  status: CodingCaseStatus;
  /** One sentence the student can act on ("Output did not match"). */
  reason: string;
  /** The student's own output, trimmed — never the expected output. */
  got: string;
  timeMs: number | null;
  memoryKb: number | null;
}

const REASON_BY_STATUS: Record<CodingCaseStatus, string> = {
  accepted: 'Accepted',
  wrong_answer: 'Output did not match',
  timeout: 'Time limit exceeded',
  compile_error: 'Compilation failed',
  runtime_error: 'The program stopped with a runtime error',
  judge_error: 'The compiler service could not run this test',
};

/**
 * Turns one sandbox result into a verdict. A case passes when the program ran
 * to completion AND its output matches — `wrong_answer` is only produced by
 * this comparison, never by the sandbox, so the same code tells the same story
 * whichever Judge0 build is installed.
 */
export function verdictForCase(
  index: number,
  outcome: JudgeCaseOutcome,
  expectedOutput: string,
): CodingCaseVerdict {
  const status = codingCaseStatusFromJudgeId(outcome.statusId);
  const got = normalizeJudgeOutput(outcome.stdout ?? '').slice(0, MAX_CODING_OUTPUT_CHARS);
  const timeMs = Number.isFinite(Number(outcome.timeMs)) ? Math.round(Number(outcome.timeMs) * 1000) : null;
  const memoryKb = Number.isFinite(Number(outcome.memoryKb)) ? Math.round(Number(outcome.memoryKb)) : null;

  if (status !== 'accepted') {
    return { index, passed: false, status, reason: REASON_BY_STATUS[status], got: '', timeMs, memoryKb };
  }
  const matched = got === normalizeJudgeOutput(expectedOutput);
  return {
    index,
    passed: matched,
    status: matched ? 'accepted' : 'wrong_answer',
    reason: matched ? REASON_BY_STATUS.accepted : REASON_BY_STATUS.wrong_answer,
    got,
    timeMs,
    memoryKb,
  };
}

/**
 * Splits a question's marks across its cases, in paise-style hundredths so the
 * parts always add back up to the whole: 10 marks over 3 cases is
 * [3.34, 3.33, 3.33], never [3.33, 3.33, 3.33] and a phantom missing paisa.
 */
export function allocateCaseMarks(totalMarks: number, caseCount: number): number[] {
  const count = Math.floor(caseCount);
  if (!Number.isFinite(totalMarks) || totalMarks <= 0 || count <= 0) return [];
  const totalHundredths = Math.round(totalMarks * 100);
  const base = Math.floor(totalHundredths / count);
  let remainder = totalHundredths - base * count;
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return (base + extra) / 100;
  });
}

/**
 * Per-case weights for a question. Equal split by default; when the faculty
 * member has given EVERY case its own marks, that weighting is honoured and
 * normalised so the question is still worth exactly its marks.
 */
export function caseMarkWeights(cases: CodingCase[], totalMarks: number): number[] {
  if (cases.length === 0) return [];
  const weighted = cases.every((testCase) => Number.isFinite(Number(testCase.marks)) && Number(testCase.marks) >= 0);
  if (!weighted) return allocateCaseMarks(totalMarks, cases.length);
  const sum = cases.reduce((acc, testCase) => acc + Number(testCase.marks), 0);
  if (sum <= 0) return allocateCaseMarks(totalMarks, cases.length);
  const scale = totalMarks / sum;
  return cases.map((testCase) => Math.round(Number(testCase.marks) * scale * 100) / 100);
}

export interface CodingGrade {
  marksObtained: number;
  marksMax: number;
  passedCount: number;
  caseCount: number;
  /** True only when every case passed — the honest "solved it" flag. */
  solved: boolean;
  breakdown: Array<{ index: number; marks: number; passed: boolean; status: CodingCaseStatus }>;
}

/**
 * Marks for one coded answer: the sum of the weights of the passing cases,
 * rounded to two decimals and capped at the question's marks.
 */
export function gradeCodingCases(
  cases: CodingCase[],
  verdicts: CodingCaseVerdict[],
  totalMarks: number,
): CodingGrade {
  const weights = caseMarkWeights(cases, totalMarks);
  const byIndex = new Map(verdicts.map((verdict) => [verdict.index, verdict]));
  const breakdown: CodingGrade['breakdown'] = [];
  let awarded = 0;
  let passedCount = 0;

  cases.forEach((_, index) => {
    const verdict = byIndex.get(index);
    const passed = Boolean(verdict?.passed);
    const marks = passed ? weights[index] ?? 0 : 0;
    if (passed) {
      awarded += marks;
      passedCount += 1;
    }
    breakdown.push({ index, marks, passed, status: verdict?.status ?? 'judge_error' });
  });

  const marksObtained = Math.min(totalMarks, Math.round(awarded * 100) / 100);
  return {
    marksObtained,
    marksMax: Math.max(0, Math.round(totalMarks * 100) / 100),
    passedCount,
    caseCount: cases.length,
    solved: cases.length > 0 && passedCount === cases.length,
    breakdown,
  };
}

/**
 * Whether an answer is worth sending to the sandbox at all: a language the
 * question allows, and real code (not just whitespace, not a lone `}`).
 */
export function codingAnswerProblem(
  language: unknown,
  code: unknown,
  allowed: readonly CodingLanguage[] = CODING_LANGUAGES,
): string | null {
  const normalized = normalizeCodingLanguage(language);
  if (!normalized) return 'Choose the language you wrote the answer in.';
  if (allowed.length > 0 && !allowed.includes(normalized)) {
    return `Answer in ${allowed.join(', ')} for this question.`;
  }
  const source = typeof code === 'string' ? code : '';
  if (!source.trim()) return 'Write some code before submitting.';
  if (source.length > MAX_CODING_SOURCE_CHARS) {
    return `Keep the answer under ${MAX_CODING_SOURCE_CHARS.toLocaleString()} characters.`;
  }
  return null;
}
