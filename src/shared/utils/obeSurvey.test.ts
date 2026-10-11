import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSurveyComplete,
  normalizeSurveyScale,
  summarizeSurveyScores,
  surveyAggregateCsv,
  surveyRatingError,
  surveysForStudent,
  unscoredCos,
} from './obeSurvey';
import { indirectAttainmentFromSurveys } from './obeAttainment';
import { parseObeSurveysCsv } from './obeCsv';
import type { ObeSurveyDoc } from '../types/obeSurvey';

const COS = [
  { code: 'CO1', statement: 'Apply cost accounting methods.' },
  { code: 'CO2', statement: 'Prepare and audit cost records.' },
];

test('summarizeSurveyScores averages each CO onto the 0–3 scale', () => {
  const { coSummaries, surveys } = summarizeSurveyScores(
    [{ CO1: 4, CO2: 5 }, { CO1: 5, CO2: 4 }],
    COS,
    5,
  );
  assert.deepEqual(coSummaries.map((s) => s.co), ['CO1', 'CO2']);
  assert.equal(coSummaries[0].mean, 4.5);
  assert.equal(coSummaries[0].count, 2);
  assert.equal(coSummaries[0].level, 2.7);
  assert.deepEqual(surveys, [
    { co: 'CO1', score: 4.5, maxScore: 5 },
    { co: 'CO2', score: 4.5, maxScore: 5 },
  ]);
});

test('summarizeSurveyScores skips blanks, clamps over-scale ratings and drops unexplained COs', () => {
  const { coSummaries } = summarizeSurveyScores(
    [
      { CO1: 9, CO2: 5 }, // CO1 over the 5-point scale → clamped to 5
      { CO1: 0, CO2: 1 }, // CO1 not answered → not counted; CO2 answered
      { CO2: 2 },
    ],
    COS,
    5,
  );
  const co1 = coSummaries.find((s) => s.co === 'CO1');
  const co2 = coSummaries.find((s) => s.co === 'CO2');
  assert.equal(co1?.mean, 5);
  assert.equal(co1?.count, 1);
  assert.equal(co2?.mean, 2.67);
  assert.equal(co2?.count, 3);
});

test('summary COs with no ratings are omitted rather than reported as zero', () => {
  const { coSummaries, surveys } = summarizeSurveyScores([{ CO1: 3 }], COS, 5);
  assert.deepEqual(coSummaries.map((s) => s.co), ['CO1']);
  assert.deepEqual(surveys.map((s) => s.co), ['CO1']);
});

test('a folded survey lands on the same level as the raw responses it came from', () => {
  const raw = [
    { co: 'CO1', score: 5, maxScore: 5 },
    { co: 'CO1', score: 4, maxScore: 5 },
    { co: 'CO2', score: 3, maxScore: 5 },
    { co: 'CO2', score: 3, maxScore: 5 },
  ];
  const rawLevels = indirectAttainmentFromSurveys(raw);
  const { surveys } = summarizeSurveyScores(
    [{ CO1: 5, CO2: 3 }, { CO1: 4, CO2: 3 }],
    COS,
    5,
  );
  assert.deepEqual(indirectAttainmentFromSurveys(surveys), rawLevels);
});

test('the aggregate CSV is accepted by the run dialog’s own parser', () => {
  const { coSummaries, surveys } = summarizeSurveyScores([{ CO1: 5, CO2: 4 }, { CO1: 4, CO2: 4 }], COS, 5);
  const parsed = parseObeSurveysCsv(surveyAggregateCsv({ coSummaries, surveys }), ['CO1', 'CO2']);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.surveys, [
    { co: 'CO1', score: 4.5, maxScore: 5 },
    { co: 'CO2', score: 4, maxScore: 5 },
  ]);
});

test('unscoredCos and isSurveyComplete agree about what is still missing', () => {
  assert.deepEqual(unscoredCos({ CO1: 4 }, COS, 5), ['CO2']);
  assert.equal(isSurveyComplete({ CO1: 4 }, COS, 5), false);
  assert.deepEqual(unscoredCos({ CO1: 4, CO2: 5 }, COS, 5), []);
  assert.equal(isSurveyComplete({ CO1: 4, CO2: 5 }, COS, 5), true);
  // A rating outside the scale, or a fractional one, is not a rating.
  assert.deepEqual(unscoredCos({ CO1: 4, CO2: 9 }, COS, 5), ['CO2']);
  assert.equal(isSurveyComplete({ CO1: 4, CO2: 9 }, COS, 5), false);
  assert.deepEqual(unscoredCos({ CO1: 4, CO2: 4.5 }, COS, 5), ['CO2']);
  assert.equal(isSurveyComplete({ CO1: 4, CO2: 4.5 }, COS, 5), false);
});

test('surveyRatingError names the problem per row', () => {
  assert.equal(surveyRatingError(4, 5), null);
  assert.equal(surveyRatingError(0, 5), 'Ratings run from 1 to 5');
  assert.equal(surveyRatingError(6, 5), 'Ratings run from 1 to 5');
  assert.equal(surveyRatingError(4.5, 5), 'Ratings are whole numbers');
  assert.equal(surveyRatingError('', 5), 'Pick a rating');
});

test('normalizeSurveyScale clamps and falls back', () => {
  assert.equal(normalizeSurveyScale(5), 5);
  assert.equal(normalizeSurveyScale(1), 2);
  assert.equal(normalizeSurveyScale(99), 10);
  assert.equal(normalizeSurveyScale('4'), 4);
  assert.equal(normalizeSurveyScale(undefined), 5);
});

function survey(overrides: Partial<ObeSurveyDoc>): ObeSurveyDoc {
  return {
    id: 's1',
    collegeId: 'college-a',
    mappingId: 'm1',
    courseCode: 'BCA301',
    academicYear: '2025-26',
    audience: 'course-exit',
    cos: COS,
    scaleMax: 5,
    status: 'open',
    ...overrides,
  };
}

test('surveysForStudent keeps answerable, in-scope rounds and hides the rest', () => {
  const visible = surveysForStudent(
    [
      survey({ id: 'open-course-exit' }),
      survey({ id: 'closed', status: 'closed' }),
      survey({ id: 'alumni', audience: 'alumni' }),
      survey({ id: 'other-branch', branch: 'Mechanical' }),
      survey({ id: 'my-branch', branch: 'Computer Science' }),
      survey({ id: 'untagged' }),
    ],
    { program: 'BCA', branch: 'Computer Science' },
  );
  assert.deepEqual(visible.map((s) => s.id), ['open-course-exit', 'my-branch', 'untagged']);
});

test('surveysForStudent falls back to showing untagged rounds when the profile is empty', () => {
  const visible = surveysForStudent(
    [survey({ id: 'tagged', branch: 'Mechanical' }), survey({ id: 'untagged' })],
    null,
  );
  assert.deepEqual(visible.map((s) => s.id), ['tagged', 'untagged']);
  // Closed rounds can still be listed for a "you already answered" view.
  assert.deepEqual(surveysForStudent([survey({ id: 'closed', status: 'closed' })], null, 'any').map((s) => s.id), ['closed']);
});
