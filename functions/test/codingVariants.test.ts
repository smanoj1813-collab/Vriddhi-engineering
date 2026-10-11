// functions/test/codingVariants.test.ts
//
// The property that matters: the SAME student always gets the SAME numbers (or
// a resume, a re-grade and an audit would disagree), and two students do not.
// Plus the evaluator's edges — an expression it cannot parse must be reported,
// never guessed at, because a wrong expected output scores correct code as
// wrong.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VARIANT_VALUE_LIMIT,
  materializeCases,
  materializeTemplate,
  mulberry32,
  parseVariantSpec,
  studentCaseSeed,
  usesVariants,
  variantSeedFor,
  variantSpecProblem,
  variantSummary,
  type VariantCase,
  type VariantPlaceholder,
} from '../src/codingVariants';

const ab: VariantPlaceholder[] = [
  { name: 'a', min: 1, max: 90 },
  { name: 'b', min: 1, max: 90 },
];

function sumCases(): VariantCase[] {
  return [
    { stdin: '{{a}} {{b}}', expectedOutput: '{{a + b}}' },
    { stdin: '{{a}} {{b}}', expectedOutput: '{{a + b}}' },
  ];
}

describe('parseVariantSpec', () => {
  it('reads declarations, normalises numbers and bounds the list', () => {
    const spec = parseVariantSpec({ placeholders: [{ name: 'a', min: '1', max: '9.7' }] });
    assert.deepEqual(spec.placeholders, [{ name: 'a', min: 1, max: 10 }]);
    assert.deepEqual(parseVariantSpec(null).placeholders, []);
    assert.deepEqual(parseVariantSpec([{ name: 'a', min: 5, max: 1 }]).placeholders, [{ name: 'a', min: 1, max: 5 }]);
  });

  it('drops entries a value cannot be drawn from', () => {
    const spec = parseVariantSpec([
      { name: '9bad', min: 1, max: 2 },
      { name: 'ok', min: 'x', max: 'y' },
      { name: 'a', min: 1, max: 2 },
      { name: 'a', min: 3, max: 4 },
    ]);
    assert.deepEqual(spec.placeholders, [{ name: 'a', min: 1, max: 2 }]);
  });

  it('accepts a bare array (the authoring form writes one)', () => {
    assert.deepEqual(parseVariantSpec([{ name: 'n', min: 2, max: 2 }]).placeholders, [{ name: 'n', min: 2, max: 2 }]);
  });
});

describe('seeding', () => {
  it('is stable across calls and processes, and differs per student and question', () => {
    const base = { testId: 't1', studentId: 's1', questionId: 'q1' };
    assert.equal(studentCaseSeed(base), studentCaseSeed(base));
    assert.notEqual(studentCaseSeed(base), studentCaseSeed({ ...base, studentId: 's2' }));
    assert.notEqual(studentCaseSeed(base), studentCaseSeed({ ...base, questionId: 'q2' }));
    assert.notEqual(studentCaseSeed(base), studentCaseSeed({ ...base, testId: 't2' }));
    assert.equal(variantSeedFor('a', 1), variantSeedFor('a', 1));
    assert.notEqual(variantSeedFor('a', 1), variantSeedFor('a', 2));
  });

  it('draws the whole declared range and is reproducible from a seed', () => {
    const first = mulberry32(42);
    const second = mulberry32(42);
    const draws = Array.from({ length: 50 }, () => first());
    assert.deepEqual(draws, Array.from({ length: 50 }, () => second()));
    assert.ok(draws.every((value) => value >= 0 && value < 1));
    const distinct = new Set(draws.map((value) => Math.floor(value * 90) + 1));
    assert.ok(distinct.size >= 25, `expected a spread of values, got ${distinct.size}`);
    // Over a full question's worth of draws every part of the range is reached
    // and no single value dominates, which is what "vary the numbers" means in
    // practice (50 draws over 90 buckets lands ~40 distinct; a 2000-draw run is
    // the version worth asserting tightly).
    const many = mulberry32(7);
    const buckets = new Map<number, number>();
    for (let index = 0; index < 2000; index += 1) {
      const bucket = Math.floor(many() * 90);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    assert.equal(buckets.size, 90);
    const counts = [...buckets.values()];
    assert.ok(Math.min(...counts) >= 5, `a value was drawn only ${Math.min(...counts)} times in 2000`);
    assert.ok(Math.max(...counts) <= 60, `a value was drawn ${Math.max(...counts)} times in 2000`);
  });
});

describe('materializeTemplate', () => {
  const values = { a: 7, b: 3 };

  it('inserts placeholders and evaluates arithmetic', () => {
    assert.equal(materializeTemplate('{{a}} {{b}}', values).text, '7 3');
    assert.equal(materializeTemplate('{{a + b}}', values).text, '10');
    assert.equal(materializeTemplate('{{a - b}}', values).text, '4');
    assert.equal(materializeTemplate('{{a * b}}', values).text, '21');
    assert.equal(materializeTemplate('{{ (a + b) * 2 }}', values).text, '20');
    assert.equal(materializeTemplate('{{ -a }}', values).text, '-7');
    assert.equal(materializeTemplate('sum is {{a+b}}', values).text, 'sum is 10');
    assert.equal(materializeTemplate('{{a}} {{a}}', values).text, '7 7');
  });

  it('leaves text with no tokens alone', () => {
    assert.deepEqual(materializeTemplate('plain 5', values), { text: 'plain 5', errors: [] });
    assert.deepEqual(materializeTemplate('', values), { text: '', errors: [] });
  });

  it('reports what it cannot evaluate instead of guessing', () => {
    assert.match(materializeTemplate('{{c + 1}}', values).errors.join(), /"c" is not declared/);
    assert.match(materializeTemplate('{{a / b}}', values).errors.join(), /division is not supported/);
    assert.match(materializeTemplate('{{a % b}}', values).errors.join(), /remainder operator is not supported/);
    assert.match(materializeTemplate('{{a ** b}}', values).errors.join(), /cannot be used/);
    assert.match(materializeTemplate('{{a +}}', values).errors.join(), /empty|not part/);
    assert.match(materializeTemplate('{{(a + b}}', values).errors.join(), /bracket is not closed/);
    assert.match(materializeTemplate('{{}}', values).errors.join(), /empty placeholder/);
    assert.match(materializeTemplate('{{ a', values).errors.join(), /unbalanced braces/);
    // Single braces are legitimate output (a printed dictionary), not a typo.
    assert.deepEqual(materializeTemplate("{'k': 1}", values), { text: "{'k': 1}", errors: [] });
    assert.match(materializeTemplate('{{a + b}} {{c}}', values).errors.join(), /"c" is not declared/);
  });

  it('refuses a result no question could expect', () => {
    const huge = { n: 999_999 };
    assert.match(materializeTemplate('{{n * n * n}}', huge).errors.join(), /too large/);
  });
});

describe('materializeCases', () => {
  it('gives the same student the same numbers every time', () => {
    const seed = studentCaseSeed({ testId: 't1', studentId: 's1', questionId: 'q1' });
    const first = materializeCases(sumCases(), ab, seed);
    const second = materializeCases(sumCases(), ab, seed);
    assert.deepEqual(first.cases, second.cases);
    assert.equal(first.errors.length, 0);
    assert.equal(first.varied, true);
    // The expected output really is the sum of the drawn inputs.
    const [left, right] = first.cases[0].stdin.split(' ').map(Number);
    assert.equal(Number(first.cases[0].expectedOutput), left + right);
  });

  it('gives two students different numbers', () => {
    const one = materializeCases(sumCases(), ab, studentCaseSeed({ testId: 't1', studentId: 's1', questionId: 'q1' }));
    const two = materializeCases(sumCases(), ab, studentCaseSeed({ testId: 't1', studentId: 's2', questionId: 'q1' }));
    assert.notDeepEqual(one.cases, two.cases);
  });

  it('varies the cases within one student, not just between students', () => {
    const result = materializeCases(sumCases(), ab, 12345);
    assert.notEqual(result.cases[0].stdin, result.cases[1].stdin);
  });

  it('honours a single-value range, so both students can share a fixed part', () => {
    const fixed: VariantPlaceholder[] = [{ name: 'limit', min: 100, max: 100 }];
    const cases: VariantCase[] = [{ stdin: '{{limit}}', expectedOutput: '{{limit}}' }];
    const one = materializeCases(cases, fixed, studentCaseSeed({ testId: 't', studentId: 'a', questionId: 'q' }));
    const two = materializeCases(cases, fixed, studentCaseSeed({ testId: 't', studentId: 'b', questionId: 'q' }));
    assert.equal(one.cases[0].stdin, '100');
    assert.deepEqual(one.cases, two.cases);
  });

  it('copies cases untouched when no placeholder is declared', () => {
    const cases: VariantCase[] = [{ stdin: '2 3', expectedOutput: '5', marks: 2 }];
    const result = materializeCases(cases, [], 999);
    assert.deepEqual(result.cases, [{ stdin: '2 3', expectedOutput: '5', marks: 2 }]);
    assert.equal(result.varied, false);
    assert.equal(result.errors.length, 0);
  });

  it('reports which test and which side a broken template is on', () => {
    const cases: VariantCase[] = [
      { stdin: '{{a}}', expectedOutput: '{{a}}' },
      { stdin: '{{nope}}', expectedOutput: '{{a}}' },
    ];
    const result = materializeCases(cases, [{ name: 'a', min: 1, max: 3 }], 7);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Test 2 input: .*"nope" is not declared/);
  });

  it('keeps per-case weights through materialisation', () => {
    const cases: VariantCase[] = [{ stdin: '{{a}}', expectedOutput: '{{a}}', marks: 3 }];
    assert.equal(materializeCases(cases, [{ name: 'a', min: 1, max: 2 }], 1).cases[0].marks, 3);
  });
});

describe('usesVariants', () => {
  it('is true only when a declared placeholder is actually used', () => {
    assert.equal(usesVariants('{{a}}', ab), true);
    assert.equal(usesVariants('{{a + b}}', ab), true);
    assert.equal(usesVariants('fixed 5', ab), false);
    assert.equal(usesVariants('{{z}}', ab), false);
    assert.equal(usesVariants('{{a}}', []), false);
    // A name that merely contains a declared one is not a use of it.
    assert.equal(usesVariants('{{aa}}', [{ name: 'a', min: 1, max: 2 }]), false);
  });
});

describe('authoring messages', () => {
  it('summarises what varies, in one sentence', () => {
    assert.match(variantSummary(ab), /a \(1–90\), b \(1–90\)/);
    assert.match(variantSummary([]), /same tests/);
  });

  it('names the problem with a declared range', () => {
    assert.equal(variantSpecProblem(ab), null);
    assert.match(String(variantSpecProblem([{ name: '9bad', min: 1, max: 2 }])), /not a placeholder name/);
    assert.match(String(variantSpecProblem([{ name: 'a', min: 5, max: 1 }])), /low bound/);
    assert.match(String(variantSpecProblem([{ name: 'a', min: 1.5, max: 3 }])), /whole-number bounds/);
    assert.match(
      String(variantSpecProblem([{ name: 'a', min: -VARIANT_VALUE_LIMIT - 1, max: 0 }])),
      /between/,
    );
    assert.match(String(variantSpecProblem([{ name: 'a', min: 1, max: 2 }, { name: 'a', min: 3, max: 4 }])), /declared twice/);
  });
});
