// functions/test/codingAssessment.test.ts
//
// Pins the scoring contract for coding questions. This is the arithmetic a
// student's marks come out of, so the tests are deliberately about the edges:
// marks that must add back up to the question total, a program that is right
// except for a trailing newline, and answers the sandbox cannot run.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFrozenQuestionChunks, normalizeQuestion, publicQuestion } from '../src/studentAssessments';
import { materializeCases, studentCaseSeed } from '../src/codingVariants';
import { findSchedulingProblem } from '../src/questionTypes';
import {
  MAX_CODING_SOURCE_CHARS,
  allocateCaseMarks,
  caseMarkWeights,
  codingAnswerProblem,
  codingCaseStatusFromJudgeId,
  codingScheduleProblem,
  gradeCodingCases,
  normalizeCodingLanguage,
  normalizeJudgeOutput,
  parseCodingConfig,
  verdictForCase,
  type CodingCase,
  type CodingCaseVerdict,
} from '../src/codingAssessmentCore';

function casesFrom(pairs: Array<[string, string]>): CodingCase[] {
  return pairs.map(([stdin, expectedOutput]) => ({ stdin, expectedOutput }));
}

describe('parseCodingConfig', () => {
  it('normalises language spellings and defaults to every runnable language', () => {
    assert.equal(normalizeCodingLanguage('C++'), 'cpp');
    assert.equal(normalizeCodingLanguage('python3'), 'python');
    assert.equal(normalizeCodingLanguage('JavaScript'), null);

    const withList = parseCodingConfig({ languages: ['C++', 'python3', 'javascript'] });
    assert.deepEqual(withList?.languages, ['cpp', 'python']);
    const withoutList = parseCodingConfig({ testCases: [{ stdin: '1', expectedOutput: '1' }] });
    assert.deepEqual(withoutList?.languages, ['c', 'cpp', 'java', 'python']);
  });

  it('reads case aliases, drops unusable cases and caps the lists', () => {
    const config = parseCodingConfig({
      languages: ['python'],
      testCases: [
        { input: '2 3', output: '5' },
        { stdin: '4 4', expected: '8' },
        { stdin: 'no expected output' },
      ],
      samples: [{ stdin: '1 1', expectedOutput: '2' }],
    });
    assert.equal(config?.testCases.length, 2);
    assert.equal(config?.testCases[0].stdin, '2 3');
    assert.equal(config?.sampleCases.length, 1);
    assert.equal(config?.sampleCases[0].expectedOutput, '2');
  });

  it('is null only for a value that is not a config at all', () => {
    assert.equal(parseCodingConfig(null), null);
    assert.equal(parseCodingConfig('coding'), null);
    assert.equal(parseCodingConfig([]), null);
    // An empty object is a coding question with defaults — usable enough to
    // author into, and the scheduling check is what refuses it.
    assert.deepEqual(parseCodingConfig({})?.languages, ['c', 'cpp', 'java', 'python']);
    assert.equal(parseCodingConfig({})?.testCases.length, 0);
    assert.notEqual(codingScheduleProblem(parseCodingConfig({})), null);
  });

  it('clamps the time limit into the range the sandbox accepts', () => {
    assert.equal(parseCodingConfig({ timeLimitSeconds: 0 })?.timeLimitSeconds, 1);
    assert.equal(parseCodingConfig({ timeLimitSeconds: 99 })?.timeLimitSeconds, 10);
    assert.equal(parseCodingConfig({})?.timeLimitSeconds, 2);
  });
});

describe('codingScheduleProblem', () => {
  it('refuses a coding question that has nothing to score against', () => {
    const config = parseCodingConfig({ languages: ['python'] });
    assert.match(String(codingScheduleProblem(config)), /at least one hidden test case/);
    assert.equal(codingScheduleProblem(null), 'Coding questions need a language, starter code or at least one hidden test case.');
  });

  it('passes a question with a hidden case and its expected output', () => {
    const config = parseCodingConfig({
      languages: ['python'],
      testCases: [{ stdin: '2 3', expectedOutput: '5' }],
    });
    assert.equal(codingScheduleProblem(config), null);
  });
});

describe('normalizeJudgeOutput', () => {
  it('ignores a trailing newline and trailing spaces, but nothing else', () => {
    assert.equal(normalizeJudgeOutput('5\n'), '5');
    assert.equal(normalizeJudgeOutput('5'), '5');
    assert.equal(normalizeJudgeOutput('5\r\n'), '5');
    assert.equal(normalizeJudgeOutput('a\nb\n'), 'a\nb');
    assert.equal(normalizeJudgeOutput('a \nb'), 'a\nb');
    assert.notEqual(normalizeJudgeOutput('5 6'), '5\n6');
    assert.notEqual(normalizeJudgeOutput(''), normalizeJudgeOutput('0'));
  });
});

describe('allocateCaseMarks', () => {
  it('always adds back up to the question total', () => {
    const split = allocateCaseMarks(10, 3);
    assert.deepEqual(split, [3.34, 3.33, 3.33]);
    assert.equal(Math.round(split.reduce((a, b) => a + b, 0) * 100) / 100, 10);

    for (const [marks, count] of [[5, 4], [1, 3], [7.5, 6], [100, 20]] as const) {
      const parts = allocateCaseMarks(marks, count);
      assert.equal(parts.length, count);
      assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100, marks);
    }
  });

  it('returns nothing for a question with no cases or no marks', () => {
    assert.deepEqual(allocateCaseMarks(10, 0), []);
    assert.deepEqual(allocateCaseMarks(0, 3), []);
  });
});

describe('caseMarkWeights', () => {
  it('uses an equal split when the cases carry no weights', () => {
    assert.deepEqual(caseMarkWeights(casesFrom([['a', '1'], ['b', '2']]), 5), [2.5, 2.5]);
  });

  it('honours per-case weights and normalises them to the question marks', () => {
    const cases: CodingCase[] = [
      { stdin: 'a', expectedOutput: '1', marks: 1 },
      { stdin: 'b', expectedOutput: '2', marks: 3 },
    ];
    assert.deepEqual(caseMarkWeights(cases, 10), [2.5, 7.5]);
  });

  it('falls back to an equal split when the weights are all zero', () => {
    const cases: CodingCase[] = [
      { stdin: 'a', expectedOutput: '1', marks: 0 },
      { stdin: 'b', expectedOutput: '2', marks: 0 },
    ];
    assert.deepEqual(caseMarkWeights(cases, 4), [2, 2]);
  });
});

describe('verdictForCase', () => {
  it('passes a program whose output matches after normalisation', () => {
    const verdict = verdictForCase(0, { statusId: 3, stdout: '5\n', timeMs: 0.12, memoryKb: 3200 }, '5');
    assert.equal(verdict.passed, true);
    assert.equal(verdict.status, 'accepted');
    assert.equal(verdict.reason, 'Accepted');
    assert.equal(verdict.timeMs, 120);
  });

  it('fails a program that runs but prints the wrong answer, and never echoes the expected output', () => {
    const verdict = verdictForCase(2, { statusId: 3, stdout: '7\n' }, '5');
    assert.equal(verdict.passed, false);
    assert.equal(verdict.status, 'wrong_answer');
    assert.equal(verdict.reason, 'Output did not match');
    assert.equal(verdict.got, '7');
    assert.ok(!JSON.stringify(verdict).includes('"5"'));
  });

  it('names the sandbox failure in a sentence a student can act on', () => {
    assert.equal(verdictForCase(0, { statusId: 5 }, '5').reason, 'Time limit exceeded');
    assert.equal(verdictForCase(0, { statusId: 6 }, '5').status, 'compile_error');
    assert.equal(verdictForCase(0, { statusId: 6 }, '5').reason, 'Compilation failed');
    assert.equal(verdictForCase(0, { statusId: 11 }, '5').status, 'runtime_error');
    assert.equal(verdictForCase(0, { statusId: 13 }, '5').status, 'judge_error');
    assert.equal(verdictForCase(0, { statusId: 1 }, '5').status, 'judge_error');
  });

  it('maps Judge0 status ids exactly', () => {
    assert.equal(codingCaseStatusFromJudgeId(3), 'accepted');
    assert.equal(codingCaseStatusFromJudgeId(4), 'accepted');
    assert.equal(codingCaseStatusFromJudgeId(5), 'timeout');
    assert.equal(codingCaseStatusFromJudgeId(6), 'compile_error');
    assert.equal(codingCaseStatusFromJudgeId(12), 'runtime_error');
    assert.equal(codingCaseStatusFromJudgeId(14), 'judge_error');
  });
});

describe('gradeCodingCases', () => {
  const cases = casesFrom([['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]);

  it('awards one part per passing test, capped at the question marks', () => {
    const verdicts: CodingCaseVerdict[] = [
      { index: 0, passed: true, status: 'accepted', reason: 'Accepted', got: '1', timeMs: 10, memoryKb: 1 },
      { index: 1, passed: true, status: 'accepted', reason: 'Accepted', got: '2', timeMs: 10, memoryKb: 1 },
      { index: 2, passed: false, status: 'wrong_answer', reason: 'Output did not match', got: '9', timeMs: 10, memoryKb: 1 },
      { index: 3, passed: false, status: 'timeout', reason: 'Time limit exceeded', got: '', timeMs: 3000, memoryKb: 1 },
    ];
    const grade = gradeCodingCases(cases, verdicts, 8);
    assert.equal(grade.marksObtained, 4);
    assert.equal(grade.passedCount, 2);
    assert.equal(grade.caseCount, 4);
    assert.equal(grade.solved, false);
    assert.deepEqual(grade.breakdown.map((item) => item.marks), [2, 2, 0, 0]);
  });

  it('gives full marks only when every case passes', () => {
    const verdicts = cases.map((_, index) => ({
      index,
      passed: true,
      status: 'accepted' as const,
      reason: 'Accepted',
      got: '',
      timeMs: 5,
      memoryKb: 1,
    }));
    const grade = gradeCodingCases(cases, verdicts, 5);
    assert.equal(grade.marksObtained, 5);
    assert.equal(grade.solved, true);
  });

  it('awards nothing when a case never got a verdict (compiler unavailable)', () => {
    const grade = gradeCodingCases(cases, [], 5);
    assert.equal(grade.marksObtained, 0);
    assert.equal(grade.passedCount, 0);
    assert.equal(grade.breakdown.length, 4);
    assert.equal(grade.breakdown[0].status, 'judge_error');
  });
});

describe('codingAnswerProblem', () => {
  it('accepts real code in an allowed language', () => {
    assert.equal(codingAnswerProblem('python', 'print(1)', ['python', 'java']), null);
    assert.equal(codingAnswerProblem('py', 'print(1)'), null);
  });

  it('refuses a missing language, an unlisted language and an empty answer', () => {
    assert.match(String(codingAnswerProblem('', 'print(1)')), /Choose the language/);
    assert.match(String(codingAnswerProblem('java', 'class A {}', ['python'])), /Answer in python/);
    assert.match(String(codingAnswerProblem('python', '   \n  ')), /Write some code/);
    assert.match(
      String(codingAnswerProblem('python', 'x'.repeat(MAX_CODING_SOURCE_CHARS + 1))),
      /under 16,000 characters/,
    );
  });
});

// ─── the hidden cases must not leave the server ────────────────────────
//
// Everything above is about scoring. This is about the thing the whole feature
// rests on: a student's browser receives the languages, the starter code, the
// public samples and a COUNT of hidden tests — never a hidden case. The frozen
// chunk payload is what the player is served during a test, so this asserts on
// exactly that, in the presence of a deliberately distinctive expected output.

describe('a coding question never leaks its hidden tests', () => {
  const HIDDEN_INPUT = '7 11 13';
  const HIDDEN_OUTPUT = 'ANSWER-31-NEVER-IN-THE-BROWSER';

  function codingDoc() {
    return {
      text: 'Read two integers and print their sum.',
      type: 'coding',
      marks: 6,
      coding: {
        languages: ['python', 'cpp'],
        starterCode: { python: 'print(1)' },
        sampleCases: [{ stdin: '1 1', expectedOutput: '2' }],
        testCases: [{ stdin: HIDDEN_INPUT, expectedOutput: HIDDEN_OUTPUT }],
        timeLimitSeconds: 2,
      },
    };
  }

  it('keeps the hidden cases on the server question object', () => {
    const question = normalizeQuestion(codingDoc(), 'q1', 1);
    assert.equal(question.coding?.testCases.length, 1);
    assert.equal(question.coding?.testCases[0].expectedOutput, HIDDEN_OUTPUT);
  })

  it('strips them from the frozen chunks the student is served', () => {
    const questions = [normalizeQuestion(codingDoc(), 'q1', 1)];
    const chunks = buildFrozenQuestionChunks(questions);
    const payload = JSON.stringify(chunks);
    assert.ok(!payload.includes(HIDDEN_OUTPUT), 'the expected output of a hidden case reached the player payload');
    assert.ok(!payload.includes(HIDDEN_INPUT), 'the input of a hidden case reached the player payload');
    assert.ok(!payload.includes('testCases'), 'the hidden-case list reached the player payload');
    // What the student DOES get, so the check above is not passing by omission.
    assert.equal(chunks[0].questions[0].coding?.caseCount, 1);
    assert.equal(chunks[0].questions[0].coding?.sampleCases?.length, 1);
  })
})

// ─── per-student variants, end to end through the payload ──────────────
//
// The frozen question chunks are written ONCE PER TEST and shared by the whole
// batch, so the templated form has to live there and the materialised numbers
// have to be produced per student further out. If that ever inverts, every
// student in a test gets the same numbers — and the point of the feature is
// that they do not.

describe('variants: the shared payload stays templated', () => {
  function variantDoc() {
    return {
      text: 'Read two integers and print their sum.',
      type: 'coding',
      marks: 5,
      coding: {
        languages: ['python'],
        placeholders: [
          { name: 'a', min: 1, max: 90 },
          { name: 'b', min: 1, max: 90 },
        ],
        sampleCases: [{ stdin: '{{a}} {{b}}', expectedOutput: '{{a + b}}' }],
        testCases: [
          { stdin: '{{a}} {{b}}', expectedOutput: '{{a + b}}' },
          { stdin: '{{a}} {{b}}', expectedOutput: '{{a + b}}' },
        ],
      },
    };
  }

  it('keeps the templates in the frozen chunks, and the hidden cases out', () => {
    const [question] = [normalizeQuestion(variantDoc(), 'q1', 1)];
    const payload = JSON.stringify(buildFrozenQuestionChunks([question]));
    assert.ok(!payload.includes('testCases'));
    const chunkQuestion = buildFrozenQuestionChunks([question])[0].questions[0];
    assert.equal(chunkQuestion.coding?.variesByStudent, true);
    // The template is what a shared chunk may hold...
    assert.match(String(chunkQuestion.coding?.sampleCases?.[0]?.stdin), /\{\{a\}\}/);
  })

  it('materialises the same student to the same numbers as the judge will use', () => {
    const [question] = [normalizeQuestion(variantDoc(), 'q1', 1)];
    const seed = studentCaseSeed({ testId: 'test-9', studentId: 'student-9', questionId: question.id });
    const samples = materializeCases(question.coding!.sampleCases, question.coding!.placeholders, seed);
    const hidden = materializeCases(question.coding!.testCases, question.coding!.placeholders, seed);

    // What the student debugs against is what is scored: same draw sequence.
    assert.equal(samples.cases[0].stdin, hidden.cases[0].stdin);
    assert.equal(samples.cases[0].expectedOutput, hidden.cases[0].expectedOutput);
    // And their second test differs from their first (the draw advances).
    assert.notEqual(hidden.cases[0].stdin, hidden.cases[1].stdin);
    // The expected output really is the sum of the two drawn inputs.
    const [left, right] = hidden.cases[0].stdin.split(' ').map(Number);
    assert.equal(Number(hidden.cases[0].expectedOutput), left + right);
  })

  it('gives a different student different numbers for the same question', () => {
    const [question] = [normalizeQuestion(variantDoc(), 'q1', 1)];
    const mine = materializeCases(
      question.coding!.testCases,
      question.coding!.placeholders,
      studentCaseSeed({ testId: 'test-9', studentId: 'student-9', questionId: question.id }),
    );
    const theirs = materializeCases(
      question.coding!.testCases,
      question.coding!.placeholders,
      studentCaseSeed({ testId: 'test-9', studentId: 'student-10', questionId: question.id }),
    );
    assert.notDeepEqual(mine.cases, theirs.cases);
  })

  it('refuses to schedule a question whose template cannot be evaluated', () => {
    const question = normalizeQuestion(
      {
        text: 'Read two integers and print their sum.',
        type: 'coding',
        marks: 5,
        coding: {
          languages: ['python'],
          placeholders: [{ name: 'a', min: 1, max: 9 }],
          testCases: [{ stdin: '{{a}} {{b}}', expectedOutput: '{{a + b}}' }],
        },
      },
      'q1',
      1,
    );
    const problem = findSchedulingProblem({
      order: 1,
      text: question.text,
      type: question.type,
      marks: question.marks,
      options: [],
      coding: question.coding,
    });
    assert.match(String(problem), /"b" is not declared/);
  })
})

// ─── the resume path must draw the same numbers, not fall back to shared ones ──
//
// A resumed attempt is rebuilt from the frozen chunks, which are SHARED by the
// whole batch and therefore hold templates. Round-tripping a chunk question back
// through publicQuestion is what applies the student's own draw. If the
// declarations did not survive that round trip, resumes would silently hand the
// student the template — or worse, the same numbers as everyone else.

describe('resume: a chunk-shaped question still materialises for the student', () => {
  const doc = {
    text: 'Read two integers and print their sum.',
    type: 'coding',
    marks: 4,
    coding: {
      languages: ['python'],
      placeholders: [
        { name: 'a', min: 1, max: 90 },
        { name: 'b', min: 1, max: 90 },
      ],
      sampleCases: [{ stdin: '{{a}} {{b}}', expectedOutput: '{{a + b}}' }],
      testCases: [{ stdin: '{{a}} {{b}}', expectedOutput: '{{a + b}}' }],
    },
  };

  it('parses the declarations back out of a public payload', () => {
    const question = normalizeQuestion(doc, 'q1', 1);
    const asServed = publicQuestion(question); // no seed: the frozen chunk's shape
    const roundTripped = normalizeQuestion(asServed as unknown as Record<string, unknown>, 'q1', 1);
    assert.equal(roundTripped.coding?.placeholders.length, 2);
  });

  it('gives the resumed student exactly what the judge will score against', () => {
    const question = normalizeQuestion(doc, 'q1', 1);
    const seed = studentCaseSeed({ testId: 'test-3', studentId: 'student-3', questionId: question.id });

    // What the test-start path serves, then the same question as a resume would
    // rebuild it (chunk -> publicQuestion with the student's seed).
    const atStart = publicQuestion(question, seed);
    const chunk = buildFrozenQuestionChunks([question])[0].questions[0];
    const atResume = publicQuestion(chunk as unknown as ReturnType<typeof publicQuestion>, seed) as ReturnType<typeof publicQuestion>;

    assert.deepEqual(atResume.coding?.sampleCases, atStart.coding?.sampleCases);
    const [left, right] = String(atResume.coding?.sampleCases?.[0]?.stdin).split(' ').map(Number);
    assert.equal(Number(atResume.coding?.sampleCases?.[0]?.expectedOutput), left + right);

    // And the hidden tests the judge materialises draw the same sequence.
    const hidden = materializeCases(question.coding!.testCases, question.coding!.placeholders, seed);
    assert.equal(hidden.cases[0].stdin, `${left} ${right}`);
  });
})
