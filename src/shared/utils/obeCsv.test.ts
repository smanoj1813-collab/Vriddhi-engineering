// src/shared/utils/obeCsv.test.ts
// Paste-from-Excel import for attainment runs: valid rows fold cleanly,
// every bad row reports its line number, compute stays blocked on errors.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { foldScoresToStudents, parseObeScoresCsv, parseObeSurveysCsv } from './obeCsv';

const COS = ['CO1', 'CO2'];

describe('obeCsv — scores', () => {
  it('parses comma- and tab-separated pastes', () => {
    const csv = parseObeScoresCsv('studentId,co,obtained,max\nS1,CO1,8,10\nS1,CO2,6,10', COS);
    assert.deepEqual(csv.errors, []);
    assert.equal(csv.rows.length, 2);
    const tsv = parseObeScoresCsv('studentId\tco\tobtained\tmax\nS1\tCO1\t8\t10', COS);
    assert.deepEqual(tsv.errors, []);
    assert.deepEqual(tsv.rows[0], { studentId: 'S1', co: 'CO1', obtained: 8, max: 10 });
  });

  it('accepts header aliases and skips blanks and # comments', () => {
    const parsed = parseObeScoresCsv(
      'rollno, courseOutcome, scored, maxMarks\n# CIE-1 export\n\nS1, co1, 8, 10',
      COS,
    );
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].co, 'CO1');
  });

  it('rejects a bad header outright', () => {
    const parsed = parseObeScoresCsv('name,marks\nS1,8', COS);
    assert.equal(parsed.rows.length, 0);
    assert.match(parsed.errors[0], /Header must name/);
  });

  it('reports every bad row with line numbers', () => {
    const parsed = parseObeScoresCsv(
      [
        'studentId,co,obtained,max',
        'S1,CO9,8,10',
        'S2,CO1,abc,10',
        'S3,CO1,12,10',
        'S4,CO1,8,10',
        'S4,CO1,7,10',
        ',CO1,8,10',
      ].join('\n'),
      COS,
    );
    assert.equal(parsed.rows.length, 1);
    assert.deepEqual(parsed.errors, [
      'Row 2: "CO9" is not a CO on this mapping (CO1, CO2).',
      'Row 3: obtained must be a number ≥ 0.',
      'Row 4: obtained (12) exceeds max (10).',
      'Row 6: duplicate entry for S4 / CO1.',
      'Row 7: missing studentId.',
    ]);
  });

  it('folds long rows into per-student engine input', () => {
    const parsed = parseObeScoresCsv('studentId,co,obtained,max\nS1,CO1,8,10\nS1,CO2,6,10\nS2,CO1,4,10', COS);
    assert.deepEqual(foldScoresToStudents(parsed.rows), [
      { studentId: 'S1', coScores: { CO1: { obtained: 8, max: 10 }, CO2: { obtained: 6, max: 10 } } },
      { studentId: 'S2', coScores: { CO1: { obtained: 4, max: 10 } } },
    ]);
  });
});

describe('obeCsv — surveys', () => {
  it('parses survey rows and tolerates empty input', () => {
    assert.deepEqual(parseObeSurveysCsv('', COS), { surveys: [], errors: [] });
    const parsed = parseObeSurveysCsv('co,score,maxScore\nCO1,4,5\nCO1,5,5', COS);
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.surveys.length, 2);
  });

  it('validates COs and scale bounds', () => {
    const parsed = parseObeSurveysCsv('co,score,maxScore\nCO9,4,5\nCO1,9,5', COS);
    assert.equal(parsed.surveys.length, 0);
    assert.equal(parsed.errors.length, 2);
  });
});
