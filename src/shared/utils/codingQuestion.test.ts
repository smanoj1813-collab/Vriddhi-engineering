// src/shared/utils/codingQuestion.test.ts
//
// The browser-side half of the coding contract. What matters here is that the
// student is told the same thing the server enforces (so an answer is never
// refused after the fact), and that nothing in this module can reveal a hidden
// test case — it only ever sees a COUNT.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_LANGUAGE_OPTIONS,
  codingConfigProblem,
  codingPlaceholderProblem,
  codingTemplateProblem,
  variantNotice,
  CODING_SOURCE_MAX_CHARS,
  applyTabIndent,
  codingAnswerIsReady,
  codingAnswerProblem,
  codingLanguageOption,
  displayOutput,
  hiddenTestSummary,
  starterForLanguage,
  summarizeSampleRun,
} from './codingQuestion';

test('the language list matches the server runner', () => {
  assert.deepEqual(
    CODING_LANGUAGE_OPTIONS.map((option) => option.id).sort(),
    ['c', 'cpp', 'java', 'python'],
  );
  assert.equal(codingLanguageOption('C++'), null, 'only the ids the server accepts');
  assert.equal(codingLanguageOption('python')?.label, 'Python 3');
  assert.ok(CODING_LANGUAGE_OPTIONS.every((option) => option.starter.trim().length > 0));
});

test('starter code prefers the faculty template and falls back to the default', () => {
  assert.equal(starterForLanguage('python', { python: 'print(1)' }), 'print(1)');
  assert.match(starterForLanguage('python', {}), /sys\.stdin/);
  assert.match(starterForLanguage('java', { python: 'print(1)' }), /class Main/);
  assert.equal(starterForLanguage('rust', {}), '');
});

test('the client check mirrors the server, including the character cap', () => {
  assert.equal(codingAnswerProblem('python', 'print(1)'), null);
  assert.equal(codingAnswerIsReady('python', 'print(1)'), true);
  assert.match(String(codingAnswerProblem('', 'print(1)')), /Choose the language/);
  assert.match(String(codingAnswerProblem('java', 'class A{}', ['python'])), /Answer this question in python/);
  assert.match(String(codingAnswerProblem('python', '   ')), /Write your solution/);
  assert.equal(codingAnswerIsReady('python', 'x'.repeat(CODING_SOURCE_MAX_CHARS + 1)), false);
});

test('a sample run is summarised in one honest line', () => {
  assert.equal(summarizeSampleRun([]), 'No sample tests were run.');
  assert.equal(summarizeSampleRun(null), 'No sample tests were run.');
  assert.equal(
    summarizeSampleRun([{ index: 0, passed: true }, { index: 1, passed: true }]),
    'All 2 sample tests passed.',
  );
  assert.equal(
    summarizeSampleRun([{ index: 0, passed: true }, { index: 1, passed: false }]),
    '1 of 2 sample tests passed.',
  );
});

test('display output never renders an empty pane as blank', () => {
  assert.equal(displayOutput(''), '(no output)');
  assert.equal(displayOutput('   \n '), '(no output)');
  assert.equal(displayOutput('5\n'), '5');
  assert.match(String(displayOutput('x'.repeat(50), 10)), /truncated/);
});

test('the student is told how much rides on the hidden tests, never what they are', () => {
  assert.match(hiddenTestSummary(5), /5 hidden tests/);
  assert.match(hiddenTestSummary(1), /1 hidden test —/);
  assert.match(hiddenTestSummary(0), /graded by your faculty member/);
  assert.match(hiddenTestSummary(undefined), /graded by your faculty member/);
});

test('tab indents instead of leaving the code box', () => {
  assert.deepEqual(applyTabIndent('ab', 2, 2), { value: 'ab  ', caret: 4 });
  assert.deepEqual(applyTabIndent('abcd', 1, 3), { value: 'a  d', caret: 3 });
});

test('the authoring check refuses a coding question that cannot be scored', () => {
  // The same sentence the server uses at Confirm time, so faculty are told at
  // the point they write the question instead of after the paper is locked.
  assert.match(
    String(codingConfigProblem({ languages: ['python'], testCases: [{ stdin: '1', expectedOutput: '' }] })),
    /at least one hidden test case/,
  )
  assert.match(String(codingConfigProblem({ languages: [], testCases: [{ expectedOutput: '5' }] })), /at least one language/);
  assert.match(String(codingConfigProblem(null)), /Add the languages and hidden test cases/);
  assert.match(
    String(codingConfigProblem({ languages: ['rust'], testCases: [{ expectedOutput: '5' }] })),
    /at least one language/,
    'a language the runner cannot compile is not a language',
  );
});

test('the authoring check passes a properly filled coding question', () => {
  assert.equal(
    codingConfigProblem({
      languages: ['python', 'cpp'],
      starterCode: { python: 'print(1)' },
      sampleCases: [{ stdin: '1 1', expectedOutput: '2' }],
      testCases: [
        { stdin: '2 3', expectedOutput: '5' },
        { stdin: '4 4', expectedOutput: '8' },
      ],
      timeLimitSeconds: 2,
    }),
    null,
  );
});

test('the authoring check bounds the lists and the time limit', () => {
  const many = Array.from({ length: 21 }, () => ({ stdin: '1', expectedOutput: '1' }));
  assert.match(String(codingConfigProblem({ languages: ['python'], testCases: many })), /20 hidden tests/);
  assert.match(
    String(codingConfigProblem({ languages: ['python'], testCases: [{ expectedOutput: '1' }], timeLimitSeconds: 30 })),
    /between 1 and 10 seconds/,
  );
});

test('the placeholder check refuses names and ranges that cannot be drawn', () => {
  assert.equal(codingPlaceholderProblem([{ name: 'a', min: 1, max: 90 }]), null);
  assert.match(String(codingPlaceholderProblem([{ name: '1a', min: 1, max: 2 }])), /not a placeholder name/);
  assert.match(String(codingPlaceholderProblem([{ name: 'a', min: 5, max: 1 }])), /low bound/);
  assert.match(
    String(codingPlaceholderProblem([{ name: 'a', min: 1, max: 2 }, { name: 'a', min: 3, max: 4 }])),
    /declared twice/,
  );
});

test('the value check catches the typos a faculty member would want to see', () => {
  const placeholders = [{ name: 'a', min: 1, max: 9 }, { name: 'b', min: 1, max: 9 }];
  assert.equal(
    codingTemplateProblem({
      placeholders,
      testCases: [{ stdin: '{{a}} {{b}}', expectedOutput: '{{a + b}}' }],
    }),
    null,
  );
  assert.match(
    String(codingTemplateProblem({ placeholders, testCases: [{ expectedOutput: '{{a + c}}' }] })),
    /uses c, which is not one of your placeholders/,
  );
  assert.match(
    String(codingTemplateProblem({ placeholders, testCases: [{ expectedOutput: '{{a / b}}' }] })),
    /\+, − and × only/,
  );
  assert.match(
    String(codingTemplateProblem({ placeholders, testCases: [{ expectedOutput: '{{}}' }] })),
    /empty \{\{\}\}/,
  );
  assert.match(
    String(codingTemplateProblem({ placeholders, testCases: [{ expectedOutput: '{{a' }] })),
    /unbalanced braces/,
  );
});

test('a broken template makes the whole question unready', () => {
  const problem = codingConfigProblem({
    languages: ['python'],
    testCases: [{ stdin: '{{a}}', expectedOutput: '{{a + b}}' }],
    placeholders: [{ name: 'a', min: 1, max: 9 }],
  });
  assert.match(String(problem), /uses b/);
});

test('a per-student question says so, and a fixed one says nothing', () => {
  assert.match(String(variantNotice(true)), /generated for you/);
  assert.equal(variantNotice(false), null);
  assert.equal(variantNotice(undefined), null);
});
