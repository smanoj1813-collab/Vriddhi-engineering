// src/shared/utils/obeCsv.test.ts
// Paste-from-Excel import for attainment runs: valid rows fold cleanly,
// every bad row reports its line number, compute stays blocked on errors.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSarResultsCsv, foldScoresToStudents, parseObeScoresCsv, parseObeSurveysCsv } from './obeCsv';

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

describe('obeCsv — SAR results export', () => {
  it('builds the two-table evidence CSV the reviewer sees on screen', () => {
    const csv = buildSarResultsCsv({
      courseCode: 'CS301',
      label: 'CIE+SEE run',
      students: 60,
      tools: ['CIE-1 (60 students)', 'SEE (58 students)'],
      coRows: [
        { co: 'CO1', statement: 'Apply sorting.', direct: 3, indirect: 2.4, combined: 2.88, target: 2, status: 'attained' },
        { co: 'CO2', direct: 1, indirect: null, combined: 0.8, status: 'no-target' },
      ],
      outcomeRows: [
        { outcome: 'PO1', title: 'Engineering Knowledge', attainment: 2.48, target: 2, gap: 0.48, status: 'attained' },
      ],
    });
    assert.equal(
      csv,
      [
        'course,run,students,tools',
        'CS301,CIE+SEE run,60,CIE-1 (60 students) + SEE (58 students)',
        '',
        'CO attainment',
        'co,statement,direct,indirect,combined,target,status',
        'CO1,Apply sorting.,3,2.4,2.88,2,attained',
        'CO2,,1,,0.8,,no-target',
        '',
        'PO/PSO attainment',
        'outcome,title,attainment,target,gap,status',
        'PO1,Engineering Knowledge,2.48,2,0.48,attained',
      ].join('\n') + '\n',
    );
  });

  it('escapes commas and quotes per Excel', () => {
    const csv = buildSarResultsCsv({
      courseCode: 'CS301',
      label: 'CIE+SEE, final',
      students: 1,
      tools: [],
      coRows: [
        { co: 'CO1', statement: 'Apply "sorting", fast.', direct: 3, indirect: null, combined: 2.4, status: 'no-target' },
      ],
      outcomeRows: [],
    });
    assert.ok(csv.includes('"CIE+SEE, final"'));
    assert.ok(csv.includes('"Apply ""sorting"", fast."'));
  });
});
