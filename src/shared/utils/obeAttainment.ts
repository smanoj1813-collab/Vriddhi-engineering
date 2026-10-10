// src/shared/utils/obeAttainment.ts
//
// NBA / OBE attainment pipeline (GAPC v4.0, 11 POs, 80/20 direct+indirect).
//
// Pure functions + unit tests, following the scheme-engine convention. This
// module builds on `calculateAttainment` in engineeringScheme.ts (course-level
// direct levels + 80/20 blend + CO→PO roll-up) and adds the pieces an
// accreditation product needs around it:
//
//   1. Question→CO aggregation (CO-tagged marks become per-student CO scores)
//   2. Tool-wise direct attainment (CIE-1/2/3, assignment, SEE, …)
//   3. Indirect attainment from raw survey responses
//   4. Generalised CO→outcome roll-up (POs *and* PSOs)
//   5. Program-level (credit-weighted) PO/PSO attainment
//   6. Target-vs-attained gaps, mapping validation, SAR-ready table builders
//
// Thresholds/levels/weights always come from the college's scheme pack
// (`SchemeAttainmentRules`); the `*_DEFAULTS` here are only the widely used
// NBA conventions for packs that leave them blank.

import type {
  ObeMappingMatrix,
  ObeProgramCourseContribution,
  ObeQuestionCoTags,
  ObeQuestionMark,
  ObeSarCoRow,
  ObeSarOutcomeRow,
  ObeStudentCoScores,
  ObeSurveyResponse,
  ObeTargetGap,
} from '../types/obe';
import type { SchemeAttainmentRules } from '../types/schemePack';

// 1e-9 guards the .xx5 boundary: without it, (2.9×3+1.2)/4 lands on
// 2.474999… in binary floating point and rounds to 2.47 instead of 2.48.
// (The accumulated error there is ~3e-14, far above Number.EPSILON.)
// SAR tables must match the Excel sheets colleges cross-check against.
const round2 = (n: number): number => Math.round((n + 1e-9) * 100) / 100;

/** NBA convention: % of students scoring ≥ threshold that earns each level. */
export const DEFAULT_ATTAINMENT_LEVELS = [
  { level: 3, minPercentStudents: 70 },
  { level: 2, minPercentStudents: 60 },
  { level: 1, minPercentStudents: 50 },
] as const;

/** NBA convention: a student clears a CO at 60% of the CO's marks. */
export const DEFAULT_CO_THRESHOLD_PERCENTAGE = 60;

/** NBA standard blend: 80% direct (assessments) + 20% indirect (surveys). */
export const DEFAULT_DIRECT_WEIGHT = 0.8;
export const DEFAULT_INDIRECT_WEIGHT = 0.2;

/** Correlation strengths allowed in a CO→PO/PSO matrix. */
export const CORRELATION_SCALE = [1, 2, 3] as const;

function levelsOf(rules?: SchemeAttainmentRules): { level: number; minPercentStudents: number }[] {
  const levels = rules?.levels?.length ? rules.levels : [...DEFAULT_ATTAINMENT_LEVELS];
  return [...levels].sort((a, b) => b.minPercentStudents - a.minPercentStudents);
}

function thresholdOf(rules?: SchemeAttainmentRules): number {
  return rules?.coThresholdPercentage ?? DEFAULT_CO_THRESHOLD_PERCENTAGE;
}

/**
 * Level (0–3) earned by a percentage of students clearing the threshold.
 * Levels are walked from the top, so overlapping bands resolve to the best.
 */
export function levelForPercentage(percent: number, rules?: SchemeAttainmentRules): number {
  for (const rule of levelsOf(rules)) {
    if (percent >= rule.minPercentStudents) return rule.level;
  }
  return 0;
}

// ─── 1. Question→CO aggregation ──────────────────────────────────────────────
// Questions in the bank already carry CO tags (QuestionForm: Bloom + CO tags).
// This folds per-question marks into the per-student, per-CO scores the
// attainment engine consumes. A question tagged to several COs splits its
// marks equally; untagged or zero-max questions are ignored (never crash a
// 500-student import on one bad row).

export function aggregateQuestionMarksToCoScores(
  marks: ObeQuestionMark[],
  coTags: ObeQuestionCoTags,
): ObeStudentCoScores[] {
  const byStudent = new Map<string, Record<string, { obtained: number; max: number }>>();
  for (const mark of marks) {
    const tags = (coTags[mark.questionId] ?? []).filter(Boolean);
    if (!mark.studentId || !mark.max || mark.max <= 0 || tags.length === 0) continue;
    const obtained = Math.max(0, Math.min(mark.obtained, mark.max));
    const share = 1 / tags.length;
    let bucket = byStudent.get(mark.studentId);
    if (!bucket) {
      bucket = {};
      byStudent.set(mark.studentId, bucket);
    }
    for (const co of tags) {
      bucket[co] = bucket[co] ?? { obtained: 0, max: 0 };
      bucket[co].obtained += obtained * share;
      bucket[co].max += mark.max * share;
    }
  }
  return [...byStudent.entries()]
    .map(([studentId, coScores]) => ({
      studentId,
      coScores: Object.fromEntries(
        Object.entries(coScores).map(([co, score]) => [
          co,
          { obtained: round2(score.obtained), max: round2(score.max) },
        ]),
      ),
    }))
    .sort((a, b) => a.studentId.localeCompare(b.studentId));
}

// ─── 2. Tool-wise direct attainment ──────────────────────────────────────────
// SARs ask for CO attainment per assessment tool (CIE-1, CIE-2, assignment,
// SEE, lab …) before the overall figure. `toolOf` reads the tool tag carried
// on each mark; pass one bucket per tool through this to build the table.

export interface ObeDirectLevelInput {
  scores: ObeStudentCoScores[];
  co: string;
  rules?: SchemeAttainmentRules;
}

export function directLevelForCo(
  input: ObeDirectLevelInput,
): { attempted: number; percentAboveThreshold: number; level: number } {
  const threshold = thresholdOf(input.rules);
  let above = 0;
  let attempted = 0;
  for (const student of input.scores) {
    const score = student.coScores?.[input.co];
    if (!score || !score.max || score.max <= 0) continue;
    attempted += 1;
    if ((score.obtained / score.max) * 100 >= threshold) above += 1;
  }
  const percent = attempted > 0 ? (above / attempted) * 100 : 0;
  return { attempted, percentAboveThreshold: round2(percent), level: levelForPercentage(percent, input.rules) };
}

/** Groups question marks by tool, then aggregates each tool to CO scores. */
export function aggregateMarksByTool(
  marks: ObeQuestionMark[],
  coTags: ObeQuestionCoTags,
): Record<string, ObeStudentCoScores[]> {
  const byTool = new Map<string, ObeQuestionMark[]>();
  for (const mark of marks) {
    const tool = (mark.tool ?? '').trim() || 'unassigned';
    if (!byTool.has(tool)) byTool.set(tool, []);
    byTool.get(tool)!.push(mark);
  }
  return Object.fromEntries(
    [...byTool.entries()].map(([tool, toolMarks]) => [tool, aggregateQuestionMarksToCoScores(toolMarks, coTags)]),
  );
}

// ─── 3. Indirect attainment from surveys ────────────────────────────────────
// Course-exit / program-exit / alumni surveys arrive as raw Likert responses;
// NBA blends them on the same 0–3 scale as direct levels.

export function indirectAttainmentFromSurveys(
  responses: ObeSurveyResponse[],
): Record<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const response of responses) {
    if (!response.co || !response.maxScore || response.maxScore <= 0) continue;
    const clamped = Math.max(0, Math.min(response.score, response.maxScore));
    const scaled = (clamped / response.maxScore) * 3;
    const bucket = sums.get(response.co) ?? { total: 0, count: 0 };
    bucket.total += scaled;
    bucket.count += 1;
    sums.set(response.co, bucket);
  }
  return Object.fromEntries(
    [...sums.entries()].map(([co, bucket]) => [co, round2(bucket.total / bucket.count)]),
  );
}

/** NBA 80/20 blend of a direct level with an indirect score (either may be absent). */
export function combineDirectIndirect(
  direct: number | null,
  indirect: number | null,
  rules?: SchemeAttainmentRules,
): number {
  if (direct == null && indirect == null) return 0;
  if (direct == null) return round2(indirect!);
  if (indirect == null) return round2(direct);
  const dw = rules?.directWeight ?? DEFAULT_DIRECT_WEIGHT;
  const iw = rules?.indirectWeight ?? DEFAULT_INDIRECT_WEIGHT;
  const total = dw + iw;
  if (total <= 0) return round2(direct);
  return round2((direct * dw + indirect * iw) / total);
}

// ─── 4. Generalised CO→outcome roll-up (POs and PSOs) ───────────────────────
// Weighted mean of combined CO values through the correlation matrix:
// outcome = Σ(co × correlation) / Σ(correlation). Works for any outcome codes.

export function rollUpOutcomes(
  coCombined: Record<string, number>,
  mapping: ObeMappingMatrix,
): Record<string, number> {
  const totals: Record<string, { weighted: number; weight: number }> = {};
  for (const [co, value] of Object.entries(coCombined)) {
    if (value == null || Number.isNaN(value)) continue;
    for (const [outcome, correlation] of Object.entries(mapping[co] ?? {})) {
      if (!correlation || correlation <= 0) continue;
      totals[outcome] = totals[outcome] ?? { weighted: 0, weight: 0 };
      totals[outcome].weighted += value * correlation;
      totals[outcome].weight += correlation;
    }
  }
  return Object.fromEntries(
    Object.entries(totals).map(([outcome, total]) => [
      outcome,
      total.weight > 0 ? round2(total.weighted / total.weight) : 0,
    ]),
  );
}

// ─── 5. Program-level PO/PSO attainment ─────────────────────────────────────
// SAR program tables aggregate course outcomes weighted by course credits,
// so a 4-credit core course counts more than a 1-credit lab.

export function calculateProgramOutcomeAttainment(
  courses: ObeProgramCourseContribution[],
): Record<string, number> {
  const totals: Record<string, { weighted: number; credits: number }> = {};
  for (const course of courses) {
    const credits = course.credits > 0 ? course.credits : 0;
    if (credits <= 0) continue;
    for (const [outcome, value] of Object.entries(course.outcomeAttainment ?? {})) {
      if (value == null || Number.isNaN(value)) continue;
      totals[outcome] = totals[outcome] ?? { weighted: 0, credits: 0 };
      totals[outcome].weighted += value * credits;
      totals[outcome].credits += credits;
    }
  }
  return Object.fromEntries(
    Object.entries(totals).map(([outcome, total]) => [
      outcome,
      total.credits > 0 ? round2(total.weighted / total.credits) : 0,
    ]),
  );
}

// ─── 6. Targets, gaps, validation ───────────────────────────────────────────

export function evaluateOutcomeTargets(
  attainment: Record<string, number>,
  targets: Record<string, number>,
): ObeTargetGap[] {
  return Object.entries(attainment)
    .map(([outcome, attained]) => {
      const target = targets[outcome] ?? 0;
      return {
        outcome,
        attained: round2(attained),
        target: round2(target),
        gap: round2(attained - target),
        met: attained >= target,
      };
    })
    .sort((a, b) => a.outcome.localeCompare(b.outcome));
}

export interface ObeMappingValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Pre-flight checks before an attainment run: every CO mapped, correlations on
 * the 1–3 scale, every expected outcome covered by at least one CO. Errors
 * block the run; warnings (uncovered POs) flag thin evidence for the SAR.
 */
export function validateMapping(
  mapping: ObeMappingMatrix,
  courseOutcomes: string[],
  expectedOutcomes: string[] = [],
): ObeMappingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (courseOutcomes.length === 0) errors.push('No course outcomes defined.');
  for (const co of courseOutcomes) {
    const row = mapping[co];
    if (!row || Object.keys(row).length === 0) {
      errors.push(`${co} has no PO/PSO mapping.`);
      continue;
    }
    for (const [outcome, correlation] of Object.entries(row)) {
      if (!CORRELATION_SCALE.includes(correlation as 1 | 2 | 3)) {
        errors.push(`${co} → ${outcome} correlation must be 1, 2 or 3 (found ${correlation}).`);
      }
    }
  }
  const covered = new Set<string>();
  for (const row of Object.values(mapping)) {
    for (const [outcome, correlation] of Object.entries(row)) {
      if (correlation && correlation > 0) covered.add(outcome);
    }
  }
  for (const outcome of expectedOutcomes) {
    if (!covered.has(outcome)) warnings.push(`${outcome} is not addressed by any CO mapping.`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

// ─── 7. SAR-ready table builders ────────────────────────────────────────────
// Pure data rows; the UI renders them and the export layer prints them. Course
// tables feed SAR criterion 3 (course outcomes); program tables feed the
// PO/PSO attainment summaries.

export function buildSarCoTable(args: {
  cos: { code: string; statement?: string }[];
  direct: Record<string, number>;
  indirect?: Record<string, number>;
  combined: Record<string, number>;
  targets?: Record<string, number>;
}): ObeSarCoRow[] {
  return args.cos.map((co) => {
    const target = args.targets?.[co.code];
    const combined = args.combined[co.code] ?? 0;
    return {
      co: co.code,
      statement: co.statement,
      direct: args.direct[co.code] ?? 0,
      indirect: args.indirect?.[co.code] ?? null,
      combined: round2(combined),
      target,
      status: target == null ? 'no-target' : combined >= target ? 'attained' : 'not-attained',
    };
  });
}

export function buildSarOutcomeTable(args: {
  outcomes: { code: string; title?: string }[];
  attainment: Record<string, number>;
  targets?: Record<string, number>;
}): ObeSarOutcomeRow[] {
  return args.outcomes.map((outcome) => {
    const attainment = args.attainment[outcome.code] ?? 0;
    const target = args.targets?.[outcome.code];
    return {
      outcome: outcome.code,
      title: outcome.title,
      attainment: round2(attainment),
      target,
      gap: target == null ? undefined : round2(attainment - target),
      status: target == null ? 'no-target' : attainment >= target ? 'attained' : 'not-attained',
    };
  });
}

/**
 * One-click GAPC v4.0 rule fragment for scheme packs: applies the NBA-standard
 * thresholds/levels/weights so a college starts from convention instead of a
 * blank JSON object. The SchemePacks editor can stamp this onto a pack.
 */
export function gapcV40AttainmentRules(): SchemeAttainmentRules {
  return {
    enabled: true,
    framework: 'NBA-GAPC-v4.0',
    levels: [...DEFAULT_ATTAINMENT_LEVELS],
    coThresholdPercentage: DEFAULT_CO_THRESHOLD_PERCENTAGE,
    directWeight: DEFAULT_DIRECT_WEIGHT,
    indirectWeight: DEFAULT_INDIRECT_WEIGHT,
    correlationScale: [...CORRELATION_SCALE],
  };
}
