// src/shared/utils/obeSurvey.ts
//
// Pure helpers for the indirect-assessment survey slice. The heavy lifting
// (folding responses onto the 0–3 scale) lives in `obeAttainment.ts` and, on
// the trusted path, in `functions/src/obeSurvey.ts`; these are the bits the
// browser needs and that unit tests can pin without a Firestore or a network.

import {
  OBE_SURVEY_SCALE_MAX,
  OBE_SURVEY_SCALE_MIN,
  STUDENT_ANSWERABLE_AUDIENCES,
  type ObeSurveyAggregate,
  type ObeSurveyCo,
  type ObeSurveyCoSummary,
  type ObeSurveyDoc,
  type ObeSurveyStatus,
} from '../types/obeSurvey';

/** Rounds a value to two decimals, like the attainment engine. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Mean rating per CO on the 0–3 attainment scale — the same normalisation
 * `indirectAttainmentFromSurveys` applies, so a survey folded here and a
 * survey folded on the server agree to the digit.
 *
 * Respondents who skipped a CO simply do not count towards it (the run dialog
 * quotes `completeCount` alongside, so a half-filled round cannot look like a
 * full one).
 */
export function summarizeSurveyScores(
  scoresByRespondent: Array<Record<string, number>>,
  cos: ObeSurveyCo[],
  scaleMax: number,
): { coSummaries: ObeSurveyCoSummary[]; surveys: { co: string; score: number; maxScore: number }[] } {
  const coSummaries: ObeSurveyCoSummary[] = [];
  for (const co of cos) {
    let total = 0;
    let count = 0;
    for (const scores of scoresByRespondent) {
      const raw = scores[co.code];
      if (!Number.isFinite(raw) || raw <= 0) continue;
      total += Math.min(raw, scaleMax);
      count += 1;
    }
    if (count === 0) continue;
    const mean = round2(total / count);
    coSummaries.push({
      co: co.code,
      mean,
      count,
      scaleMax,
      level: round2((mean / scaleMax) * 3),
    });
  }
  return {
    coSummaries,
    // One row per CO: the mean. Feeding the mean of many responses into the
    // blend is identical to feeding every response, because the blend averages.
    surveys: coSummaries.map((summary) => ({
      co: summary.co,
      score: summary.mean,
      maxScore: scaleMax,
    })),
  };
}

/**
 * COs without a usable rating yet — what the respondent still has to answer.
 * `scaleMax` is required on purpose: without it a rating of 9 on a 5-point
 * round would look answered here and be dropped by the server instead.
 */
export function unscoredCos(
  scores: Record<string, number>,
  cos: ObeSurveyCo[],
  scaleMax: number,
): string[] {
  return cos
    .filter((co) => {
      const value = scores[co.code];
      return !Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > scaleMax;
    })
    .map((co) => co.code);
}

/** True when every CO has a whole-number rating in 1..scaleMax (the submit gate). */
export function isSurveyComplete(
  scores: Record<string, number>,
  cos: ObeSurveyCo[],
  scaleMax: number,
): boolean {
  return cos.every((co) => {
    const value = scores[co.code];
    return Number.isFinite(value) && Number.isInteger(value) && value >= 1 && value <= scaleMax;
  });
}

/**
 * The aggregate as CSV, for the existing paste box in the run dialog: a
 * principal who has been collecting surveys in Excel and one who used the
 * portal end up in the same place, and the run records the same numbers.
 */
export function surveyAggregateCsv(
  aggregate: Pick<ObeSurveyAggregate, 'surveys' | 'coSummaries'>,
): string {
  const rows = aggregate.coSummaries.length
    ? aggregate.coSummaries.map((summary) => [summary.co, summary.mean, summary.scaleMax])
    : aggregate.surveys.map((row) => [row.co, row.score, row.maxScore]);
  return ['co,score,maxScore', ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * Which open rounds a given student may answer.
 *
 * Audiences the portal cannot collect (alumni, employer) are filtered out, and
 * so is any round tagged with a different programme or branch — a mechanical
 * student should not be rating the civil course's COs. A round with no tags is
 * college-wide and stays visible.
 */
export function surveysForStudent(
  surveys: ObeSurveyDoc[],
  profile: { program?: string; branch?: string } | null | undefined,
  status: ObeSurveyStatus | 'any' = 'open',
): ObeSurveyDoc[] {
  const program = (profile?.program ?? '').trim().toLowerCase();
  const branch = (profile?.branch ?? '').trim().toLowerCase();
  return surveys.filter((survey) => {
    if (status !== 'any' && survey.status !== status) return false;
    if (!STUDENT_ANSWERABLE_AUDIENCES.includes(survey.audience)) return false;
    const surveyProgram = (survey.programId ?? '').trim().toLowerCase();
    const surveyBranch = (survey.branch ?? '').trim().toLowerCase();
    if (surveyProgram && program && surveyProgram !== program) return false;
    if (surveyBranch && branch && surveyBranch !== branch) return false;
    return true;
  });
}

/** Validates a rating before it is written, so the form can point at the row. */
export function surveyRatingError(value: unknown, scaleMax: number): string | null {
  if (value === '' || value === null || value === undefined) return 'Pick a rating';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Pick a rating';
  if (!Number.isInteger(numeric)) return 'Ratings are whole numbers';
  if (numeric < 1 || numeric > scaleMax) return `Ratings run from 1 to ${scaleMax}`;
  return null;
}

/** Clamps a scale into the range the server accepts. */
export function normalizeSurveyScale(value: unknown, fallback = 5): number {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(OBE_SURVEY_SCALE_MAX, Math.max(OBE_SURVEY_SCALE_MIN, numeric));
}
