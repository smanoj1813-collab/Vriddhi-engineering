// functions/src/codingVariants.ts
//
// Per-student hidden test cases.
//
// WHY
// The judge (codingJudge.ts) runs a student's program against hidden cases and
// awards marks per passing case. That is strong against "paste whatever a chat
// window wrote", because the answer has to actually work. It is weak against one
// specific attack: if the CASES become known — a student films the screen of a
// friend, someone scrapes a copy of the paper, the same paper is reused next
// semester — then a hardcoded program scores full marks without solving
// anything, and a shared answer is a shared full score.
//
// THE FIX, AND ITS LIMITS
// The faculty member writes a case as a TEMPLATE ("2 3" → "5" becomes
// "{{a}} {{b}}" → "{{a + b}}") and declares the range each placeholder is drawn
// from. Every student's paper is materialised from a seed derived from
// (testId, studentId, questionId): same numbers on every resume and re-grade for
// that student, different numbers from their neighbour. A shared or memorised
// answer then has to be a general solution to earn marks — which is precisely
// what the question is asking for.
//
// It is NOT a defence against a student who is a competent programmer with help
// on the line, and it is not intended to be. It raises the cost of the cheap
// attacks and makes "the answer key leaked" survivable.
//
// WHY EXPRESSIONS AND NOT JUST NUMBERS
// Expected outputs have to be computable, or every case would still need its
// answer written by hand for every student. The evaluator below is a
// hand-written recursive-descent parser over integer literals, placeholders,
// `+ - *`, parentheses and unary minus. No `eval`, no division (division is
// where integer-rounding disputes live, and a question needing ratios should
// say so in its own text), no functions, no floats. Anything it cannot parse is
// reported and the question falls back to hand-grading rather than being scored
// against a wrong number.

/** A placeholder the faculty member declared, and the range it is drawn from. */
export interface VariantPlaceholder {
  name: string;
  min: number;
  max: number;
}

export interface VariantSpec {
  placeholders: VariantPlaceholder[];
}

/** A case as authored: `stdin` / `expectedOutput` may contain `{{...}}`. */
export interface VariantCase {
  stdin: string;
  expectedOutput: string;
  marks?: number;
}

export interface MaterializedCase {
  stdin: string;
  expectedOutput: string;
  marks?: number;
}

export const MAX_VARIANTS_PLACEHOLDERS = 8;
export const VARIANT_VALUE_LIMIT = 1_000_000;
/** Guard on the arithmetic result, so a typo cannot produce a 30-digit answer. */
export const VARIANT_RESULT_LIMIT = 1e12;
const PLACEHOLDER_NAME = /^[a-z][a-z0-9_]{0,15}$/i;
const TOKEN = /{{\s*([^{}]+?)\s*}}/g;

/**
 * Reads the placeholder declarations off a question document. Invalid entries
 * are dropped (a malformed range cannot be drawn from) and the list is bounded;
 * a question with no valid placeholder behaves exactly as it did before this
 * feature existed.
 */
export function parseVariantSpec(raw: unknown): VariantSpec {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).placeholders ?? raw
    : raw;
  if (!Array.isArray(source)) return { placeholders: [] };
  const placeholders: VariantPlaceholder[] = [];
  for (const entry of source) {
    const value = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : null;
    const name = String(value?.name ?? '').trim();
    if (!value || !PLACEHOLDER_NAME.test(name)) continue;
    const min = Math.round(Number(value.min));
    const max = Math.round(Number(value.max));
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    const low = Math.max(-VARIANT_VALUE_LIMIT, Math.min(min, max));
    const high = Math.min(VARIANT_VALUE_LIMIT, Math.max(min, max));
    if (high < low) continue;
    if (placeholders.some((placeholder) => placeholder.name === name)) continue;
    placeholders.push({ name, min: low, max: high });
    if (placeholders.length >= MAX_VARIANTS_PLACEHOLDERS) break;
  }
  return { placeholders };
}

/** FNV-1a over the parts, so the seed is stable across processes and deploys. */
export function variantSeedFor(...parts: Array<string | number>): number {
  let hash = 0x811c9dc5;
  const source = parts.map((part) => String(part ?? '')).join('|');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: small, deterministic, and good enough to vary two integers. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface EvalSuccess {
  ok: true;
  value: number;
}
interface EvalFailure {
  ok: false;
  error: string;
}
type EvalResult = EvalSuccess | EvalFailure;

/**
 * Integer expression evaluator: numbers, placeholder names, `+ - *`,
 * parentheses, unary minus. Hand-written so the grammar is exactly what is
 * documented above and nothing else can be reached.
 */
function evaluateExpression(source: string, values: Record<string, number>): EvalResult {
  // Named here rather than left to the parser: a stray `/` in a factor position
  // would otherwise be reported as "not part of the expression", and the faculty
  // member deserves to be told they wrote a division.
  if (source.includes('/')) return { ok: false, error: 'division is not supported in test values' };
  if (source.includes('%')) return { ok: false, error: 'the remainder operator is not supported in test values' };
  let cursor = 0;

  const skipSpaces = () => {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  };

  function parseExpression(): EvalResult {
    let left = parseTerm();
    if (!left.ok) return left;
    for (;;) {
      skipSpaces();
      const operator = source[cursor];
      if (operator !== '+' && operator !== '-') return left;
      cursor += 1;
      const right = parseTerm();
      if (!right.ok) return right;
      const value: number = operator === '+' ? left.value + right.value : left.value - right.value;
      if (Math.abs(value) > VARIANT_RESULT_LIMIT) return { ok: false, error: 'the result is too large' };
      left = { ok: true, value };
    }
  }

  function parseTerm(): EvalResult {
    let left = parseFactor();
    if (!left.ok) return left;
    for (;;) {
      skipSpaces();
      const operator = source[cursor];
      if (operator !== '*') return left;
      cursor += 1;
      const right = parseFactor();
      if (!right.ok) return right;
      const value: number = left.value * right.value;
      if (Math.abs(value) > VARIANT_RESULT_LIMIT) return { ok: false, error: 'the result is too large' };
      left = { ok: true, value };
    }
  }

  function parseFactor(): EvalResult {
    skipSpaces();
    const character = source[cursor];
    if (character === '-') {
      cursor += 1;
      const operand = parseFactor();
      return operand.ok ? { ok: true, value: -operand.value } : operand;
    }
    if (character === '+') {
      cursor += 1;
      return parseFactor();
    }
    if (character === '(') {
      cursor += 1;
      const inner = parseExpression();
      if (!inner.ok) return inner;
      skipSpaces();
      if (source[cursor] !== ')') return { ok: false, error: 'a bracket is not closed' };
      cursor += 1;
      return inner;
    }
    const numberMatch = /^\d+/.exec(source.slice(cursor));
    if (numberMatch) {
      cursor += numberMatch[0].length;
      return { ok: true, value: Number(numberMatch[0]) };
    }
    const nameMatch = /^[a-z][a-z0-9_]*/i.exec(source.slice(cursor));
    if (nameMatch) {
      cursor += nameMatch[0].length;
      const value = values[nameMatch[0]];
      if (value === undefined) return { ok: false, error: `the placeholder "${nameMatch[0]}" is not declared` };
      return { ok: true, value };
    }
    return { ok: false, error: character ? `"${character}" cannot be used in test values` : 'the expression is empty' };
  }

  const result = parseExpression();
  if (!result.ok) return result;
  skipSpaces();
  if (cursor < source.length) {
    return { ok: false, error: `"${source.slice(cursor).trim()}" is not part of the expression` };
  }
  if (!Number.isSafeInteger(result.value) || Math.abs(result.value) > VARIANT_RESULT_LIMIT) {
    return { ok: false, error: 'the result is not a whole number in range' };
  }
  return result;
}

/**
 * Replaces every `{{ ... }}` in a case's text. Plain `{{name}}` inserts the
 * drawn value; `{{a + b}}` evaluates the arithmetic. Returns the text and any
 * problems found, so a broken template is reported instead of scored.
 */
export function materializeTemplate(
  text: string,
  values: Record<string, number>,
): { text: string; errors: string[] } {
  const errors: string[] = [];
  const replaced = String(text ?? '').replace(TOKEN, (_match, expression: string) => {
    const result = evaluateExpression(String(expression), values);
    if (!result.ok) {
      errors.push(`{{${String(expression).trim()}}} — ${result.error}`);
      return _match;
    }
    return String(result.value);
  });
  // A leftover double brace is template syntax the faculty member got wrong
  // (`{{}}`, `{{ a` ), and it would otherwise be compared against literally —
  // a typo that silently marks every correct answer wrong. Single braces are
  // left alone: printing a dictionary or a JSON object is a legitimate answer.
  if (errors.length === 0) {
    if (/{{\s*}}/.test(replaced)) errors.push('an empty placeholder {{}} is written in the test');
    else if (replaced.includes('{{') || replaced.includes('}}')) {
      errors.push('a placeholder in the test has unbalanced braces');
    }
  }
  return { text: replaced, errors };
}

/** True when a template actually varies between students. */
export function usesVariants(text: string, placeholders: VariantPlaceholder[]): boolean {
  if (placeholders.length === 0) return false;
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(String(text ?? ''))) !== null) {
    const expression = String(match[1]);
    if (placeholders.some((placeholder) => new RegExp(`\\b${placeholder.name}\\b`).test(expression))) return true;
  }
  return false;
}

export interface MaterializeResult {
  cases: MaterializedCase[];
  errors: string[];
  /** True when at least one value depended on the student. */
  varied: boolean;
}

/**
 * Materialises a question's cases for one student.
 *
 * Values are drawn case by case, in declaration order, from a PRNG seeded with
 * the student's seed — so the same student gets the same inputs on every resume,
 * re-grade and audit, while another student gets different ones. With no
 * placeholders declared this is a straight copy, which is what keeps questions
 * written before this feature behaving identically.
 */
export function materializeCases(
  cases: VariantCase[],
  placeholders: VariantPlaceholder[],
  seed: number,
): MaterializeResult {
  const errors: string[] = [];
  if (placeholders.length === 0) {
    return {
      cases: cases.map((testCase) => ({
        stdin: testCase.stdin,
        expectedOutput: testCase.expectedOutput,
        ...(testCase.marks === undefined ? {} : { marks: testCase.marks }),
      })),
      errors,
      varied: false,
    };
  }

  const random = mulberry32(seed);
  const materialized: MaterializedCase[] = [];
  let varied = false;

  cases.forEach((testCase, index) => {
    const values: Record<string, number> = {};
    for (const placeholder of placeholders) {
      const span = placeholder.max - placeholder.min + 1;
      values[placeholder.name] = placeholder.min + Math.floor(random() * span);
    }
    const stdin = materializeTemplate(testCase.stdin, values);
    const expected = materializeTemplate(testCase.expectedOutput, values);
    stdin.errors.forEach((error) => errors.push(`Test ${index + 1} input: ${error}`));
    expected.errors.forEach((error) => errors.push(`Test ${index + 1} expected output: ${error}`));
    if (usesVariants(testCase.stdin, placeholders) || usesVariants(testCase.expectedOutput, placeholders)) {
      varied = true;
    }
    materialized.push({
      stdin: stdin.text,
      expectedOutput: expected.text,
      ...(testCase.marks === undefined ? {} : { marks: testCase.marks }),
    });
  });

  return { cases: materialized, errors, varied };
}

/**
 * The one place a student's seed is computed. Everything that has to agree about
 * a student's numbers — the judge, the in-test sample run, the frozen paper the
 * player is served, an audit later — calls this with the same three values.
 */
export function studentCaseSeed(input: {
  testId: string;
  studentId: string;
  questionId: string;
}): number {
  return variantSeedFor('coding-v1', input.testId, input.studentId, input.questionId);
}

/** What faculty are told when a question varies by student. */
export function variantSummary(placeholders: VariantPlaceholder[]): string {
  if (placeholders.length === 0) return 'Every student gets the same tests.';
  const names = placeholders.map((placeholder) => `${placeholder.name} (${placeholder.min}–${placeholder.max})`);
  return `Each student's tests draw ${names.join(', ')}, so a memorised answer to one student's numbers does not pass another's.`;
}

/** Problems with a declared placeholder list, in the authoring form's words. */
export function variantSpecProblem(placeholders: VariantPlaceholder[]): string | null {
  if (placeholders.length > MAX_VARIANTS_PLACEHOLDERS) {
    return `Keep it to ${MAX_VARIANTS_PLACEHOLDERS} placeholders per question.`;
  }
  for (const placeholder of placeholders) {
    if (!PLACEHOLDER_NAME.test(placeholder.name)) {
      return `"${placeholder.name}" is not a placeholder name — use letters, digits and underscore, starting with a letter.`;
    }
    if (!Number.isInteger(placeholder.min) || !Number.isInteger(placeholder.max)) {
      return `Give ${placeholder.name} whole-number bounds.`;
    }
    if (Math.abs(placeholder.min) > VARIANT_VALUE_LIMIT || Math.abs(placeholder.max) > VARIANT_VALUE_LIMIT) {
      return `Keep ${placeholder.name} between -${VARIANT_VALUE_LIMIT.toLocaleString()} and ${VARIANT_VALUE_LIMIT.toLocaleString()}.`;
    }
    if (placeholder.min > placeholder.max) return `The low bound for ${placeholder.name} is above the high bound.`;
  }
  const names = new Set<string>();
  for (const placeholder of placeholders) {
    if (names.has(placeholder.name)) return `"${placeholder.name}" is declared twice.`;
    names.add(placeholder.name);
  }
  return null;
}
