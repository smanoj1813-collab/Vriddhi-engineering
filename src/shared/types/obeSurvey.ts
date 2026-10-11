// src/shared/types/obeSurvey.ts
//
// Indirect-attainment survey capture (Slice 5).
//
// `computeObeAttainment` has always accepted `surveys: {co, score, maxScore}[]`
// — the 20% of the NBA 80/20 blend — but until now the only way to get numbers
// in was pasting them from Excel, so a college without a separate survey tool
// simply had no indirect attainment. These are the documents behind the
// in-portal path:
//
//   obeSurveys/{surveyId}                          the round (staff-created)
//   obeSurveyResponses/{surveyId}__{uid}           one respondent's answers
//
// Both are top-level collections carrying `collegeId`, like obeMappings and
// obeRuns. Surveys are created from a PUBLISHED mapping — the CO list is
// copied (and frozen) from it, so a respondent can never answer a CO that the
// mapping does not define, and a re-published mapping cannot silently change
// what an already-collected response meant.

import type { ObeCourseOutcome } from './obe';

/**
 * Who is being surveyed. NBA SAR criterion 3 wants at least one indirect
 * source; the four below are the ones Indian colleges actually keep on file.
 */
export type ObeSurveyAudience = 'course-exit' | 'program-exit' | 'alumni' | 'employer';

export const OBE_SURVEY_AUDIENCES: Array<{ id: ObeSurveyAudience; label: string; hint: string }> = [
  {
    id: 'course-exit',
    label: 'Course exit survey',
    hint: 'Filled by the students who just finished this course, one rating per CO.',
  },
  {
    id: 'program-exit',
    label: 'Program exit survey',
    hint: 'Final-year students rate how far the programme met each CO of this course.',
  },
  {
    id: 'alumni',
    label: 'Alumni survey',
    hint: 'Graduates rate the same COs in hindsight. Collected outside the student portal.',
  },
  {
    id: 'employer',
    label: 'Employer survey',
    hint: 'Recruiters rate the graduates they hired. Collected outside the student portal.',
  },
];

/** Audiences the student portal can collect; the rest are staff-entered. */
export const STUDENT_ANSWERABLE_AUDIENCES: ObeSurveyAudience[] = ['course-exit', 'program-exit'];

export type ObeSurveyStatus = 'open' | 'closed';

/** One Likert rating scale bound. `scaleMax` is the top of the scale (e.g. 5). */
export const OBE_SURVEY_SCALE_MIN = 2;
export const OBE_SURVEY_SCALE_MAX = 10;

/** A CO as frozen onto the survey at creation time. */
export interface ObeSurveyCo {
  code: string;
  statement?: string;
}

/**
 * One survey round. Written only by the `saveObeSurvey` callable (rules deny
 * client writes), so `cos` and the college scope are trustworthy.
 */
export interface ObeSurveyDoc {
  id: string;
  collegeId: string;
  /** The published mapping this round was opened from. */
  mappingId: string;
  courseCode: string;
  courseTitle?: string;
  programId?: string;
  branch?: string;
  academicYear: string;
  term?: string;
  audience: ObeSurveyAudience;
  /** Frozen CO list — the questions respondents rate. */
  cos: ObeSurveyCo[];
  /** Top of the Likert scale. A rating is an integer in 1..scaleMax. */
  scaleMax: number;
  /** Optional wording shown above the CO list. */
  prompt?: string;
  status: ObeSurveyStatus;
  createdAt?: unknown;
  createdBy?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  closedAt?: unknown;
  closedBy?: string;
}

/**
 * One respondent's answers. `scores` maps CO code → rating in 1..scaleMax.
 * The document id is `{surveyId}__{uid}`, which is what the security rules pin,
 * so a student can only ever write their own row and only under their own id.
 */
export interface ObeSurveyResponseDoc {
  id: string;
  surveyId: string;
  collegeId: string;
  uid: string;
  name?: string;
  role: 'student';
  scores: Record<string, number>;
  scaleMax: number;
  /** Client clock — shown for sorting, never used as evidence of order. */
  submittedAtMs?: number;
  updatedAtMs?: number;
}

/** Per-CO aggregate of a round, on the same 0–3 scale the direct engine uses. */
export interface ObeSurveyCoSummary {
  co: string;
  /** Mean raw rating across respondents. */
  mean: number;
  /** Ratings counted for this CO. */
  count: number;
  scaleMax: number;
  /** Mean on the 0–3 attainment scale the blend consumes. */
  level: number;
}

/** What `previewObeSurveyScores` returns to the run dialog. */
export interface ObeSurveyAggregate {
  surveyId: string;
  audience: ObeSurveyAudience;
  status: ObeSurveyStatus;
  scaleMax: number;
  responseCount: number;
  /** Respondents who scored every CO — the honest denominator to quote in a SAR. */
  completeCount: number;
  coSummaries: ObeSurveyCoSummary[];
  /** Directly feedable into computeObeAttainment / the surveys CSV box. */
  surveys: { co: string; score: number; maxScore: number }[];
}
