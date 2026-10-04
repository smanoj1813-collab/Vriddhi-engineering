// src/shared/utils/engineeringScheme.ts
// ---------------------------------------------------------------------------
// B.E./B.Tech evaluation rules that the G1 scheme engine cannot express.
//
// The G1 engine (schemeEngine.ts) covers what every Karnataka scheme shares:
// attendance slabs, IA composition, aggregate/SEE/IA pass bars, absolute grade
// tables and SGPA. Engineering adds five things it has no vocabulary for:
//
//   1. course-type weightages  — a lab is 50:50, a project is 50:100, a
//                                seminar has no university exam at all
//   2. heads of passing        — VTU passes theory and practical SEPARATELY
//   3. SEE scaling             — the VTU paper is 100 marks, scaled to 50
//   4. relative grading        — autonomous institutions curve the cohort
//   5. OBE attainment          — CO -> PO/PSO roll-up (NBA 80/20)
//
// Everything here is driven by `pack.engineering`. A pack without that block
// (every non-tech pack) falls back to G1 behaviour, so nothing regresses.
// ---------------------------------------------------------------------------

import {
  DEFAULT_SCHEME_PACK,
  getSchemeGradeFromMarks,
  type SchemeGradeResult,
} from './schemeEngine';
import type {
  SchemeCourseTypeWeightage,
  UniversitySchemePack,
} from '../types/schemePack';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Extract the first four-digit admission year from common batch labels. */
export function getAdmissionYear(admissionBatch?: string | number | null): number | null {
  const match = String(admissionBatch ?? '').match(/(?:^|\D)((?:19|20)\d{2})(?=\D|$)/);
  return match ? Number(match[1]) : null;
}

/**
 * Apply the pack's safe CGPA conversion formula for one admission batch.
 * Only the small, explicit arithmetic grammar used by the scheme packs is
 * accepted; expressions are never evaluated as JavaScript.
 */
export function convertCgpaToPercentage(
  cgpa: number,
  admissionBatch: string | number | null | undefined,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): number | null {
  if (!Number.isFinite(cgpa)) return null;
  const conversion = pack.engineering?.percentageConversion;
  if (!conversion?.expression) return null;

  const admissionYear = getAdmissionYear(admissionBatch);
  const rule = admissionYear == null
    ? undefined
    : conversion.batchRules?.find((candidate) => {
        const exactYears = candidate.admissionYears ?? [];
        if (exactYears.includes(admissionYear)) return true;
        const from = candidate.fromAdmissionYear;
        const through = candidate.throughAdmissionYear;
        return (from == null || admissionYear >= from) && (through == null || admissionYear <= through)
          && (from != null || through != null);
      });
  const expression = rule?.expression ?? conversion.expression;
  const offsetMatch = expression.match(/^\s*\(\s*CGPA\s*([+-])\s*(\d+(?:\.\d+)?)\s*\)\s*\*\s*(\d+(?:\.\d+)?)\s*$/i);
  const directMatch = expression.match(/^\s*CGPA\s*\*\s*(\d+(?:\.\d+)?)\s*$/i);
  const multiplier = offsetMatch ? Number(offsetMatch[3]) : directMatch ? Number(directMatch[1]) : null;
  if (multiplier == null || !Number.isFinite(multiplier)) return null;
  const offset = offsetMatch
    ? (offsetMatch[1] === '-' ? -1 : 1) * Number(offsetMatch[2])
    : 0;
  return round2(Math.min(100, Math.max(0, (cgpa + offset) * multiplier)));
}

// ─── 1. Course types ─────────────────────────────────────────────────────────

/**
 * Internal/external split for a course type.
 * Falls back to the pack's own IA/SEE maxima when the pack has no engineering
 * block, so non-tech callers get exactly what they get today.
 */
export function getCourseWeightage(
  courseType = 'theory',
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): SchemeCourseTypeWeightage {
  const types = pack.engineering?.courseTypes;
  const match = types?.[courseType] ?? types?._default;
  if (match) return match;
  return {
    internal: pack.internalAssessment.totalMarks,
    external: pack.semesterEndExam.defaultMaxMarks,
  };
}

/** True when the course has no university/end-semester examination. */
export function isInternalOnlyCourse(
  courseType: string,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): boolean {
  return getCourseWeightage(courseType, pack).internalOnly === true;
}

// ─── 2. SEE scaling ──────────────────────────────────────────────────────────

/**
 * Convert raw marks on the question paper to the marks that count.
 * VTU sets a 100-mark paper and scales it to 50; BCU needs no scaling because
 * `scaleFrom` is undefined.
 */
export function scaleSemesterEndMarks(
  rawMarks: number,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): number {
  const see = pack.semesterEndExam;
  const from = see.scaleFrom && see.scaleFrom > 0 ? see.scaleFrom : see.defaultMaxMarks;
  if (from <= 0) return 0;
  const scaled = (Math.max(0, rawMarks) / from) * see.defaultMaxMarks;
  return round2(Math.min(scaled, see.defaultMaxMarks));
}

/**
 * VTU bars a student from the SEE entirely below 40% in CIE. That is a
 * different outcome from failing: the grade is NE (not eligible), not F.
 */
export function isEligibleForEndSemester(
  internalPercentage: number,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): boolean {
  return internalPercentage >= (pack.passCriteria.minimumInternalPercentage ?? 0);
}

// ─── 3. Heads of passing ─────────────────────────────────────────────────────

export interface SchemeHeadMark {
  code: string;
  marks: number;
  maxMarks: number;
}

export interface SchemeHeadsResult {
  heads: { code: string; percentage: number; isPass: boolean }[];
  isPass: boolean;
  remarks: string;
}

/**
 * Evaluate every head of a course independently. VTU treats theory and
 * practical as separate heads: clearing one does not clear the other.
 * Courses with a single head degrade to a straightforward pass check.
 */
export function checkHeadsOfPassing(
  heads: SchemeHeadMark[],
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
  minimumHeadPercentage = pack.passCriteria.aggregatePassPercentage,
): SchemeHeadsResult {
  const evaluated = heads.map((head) => {
    const percentage = head.maxMarks > 0 ? (head.marks / head.maxMarks) * 100 : 0;
    return { code: head.code, percentage: round2(percentage), isPass: percentage >= minimumHeadPercentage };
  });
  const failed = evaluated.filter((h) => !h.isPass);
  return {
    heads: evaluated,
    isPass: failed.length === 0,
    remarks: failed.length === 0
      ? `Pass — all heads cleared at ${minimumHeadPercentage}%`
      : `Fail — ${failed.map((h) => `${h.code} ${h.percentage}%`).join(', ')} (needs ${minimumHeadPercentage}%)`,
  };
}

// ─── 4. Relative grading ─────────────────────────────────────────────────────

export interface SchemeGradeInput {
  /** percentage the student actually scored */
  percentage: number;
  /** student's percentile inside the cohort (0-100) — relative grading only */
  percentile?: number | null;
  /** number of students in the cohort — relative grading only */
  cohortSize?: number | null;
}

/**
 * Grade a student against the pack: relative bands when the pack curves and
 * the cohort is large enough, otherwise the absolute grade table.
 *
 * The absolute floor always wins: a student below `absoluteMinPercentage`
 * fails no matter how flattering the percentile is.
 */
export function getSchemeGrade(
  input: SchemeGradeInput,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): SchemeGradeResult & { method: 'absolute' | 'relative' } {
  const grading = pack.engineering?.grading;
  const passFloor = pack.passCriteria.aggregatePassPercentage ?? 0;
  if (grading?.method === 'relative' && (!Number.isFinite(input.percentage) || input.percentage < passFloor)) {
    return { grade: 'F', gradePoint: 0, description: 'Fail', method: 'absolute' };
  }

  const bands = grading?.relativeBands;
  const minCohort = grading?.minCohortSizeForRelative ?? 0;

  const canCurve =
    grading?.method === 'relative' &&
    Array.isArray(bands) &&
    bands.length > 0 &&
    input.percentile != null &&
    (input.cohortSize ?? 0) >= minCohort;

  if (canCurve && bands) {
    const ordered = [...bands].sort((a, b) => b.minPercentile - a.minPercentile);
    for (const band of ordered) {
      if (input.percentile! >= band.minPercentile) {
        if (band.absoluteMinPercentage != null && input.percentage < band.absoluteMinPercentage) continue;
        return {
          grade: band.grade,
          gradePoint: band.gradePoint,
          description: band.description ?? band.grade,
          method: 'relative',
        };
      }
    }
  }

  const absolute = getSchemeGradeFromMarks(input.percentage, 100, pack);
  return { ...absolute, method: 'absolute' };
}

// ─── 5. OBE attainment (NBA 80/20) ───────────────────────────────────────────

export interface SchemeAttainmentInput {
  studentScores: { studentId: string; coScores: Record<string, { obtained: number; max: number }> }[];
  /** { CO1: { PO1: 3, PO2: 2 } } — correlation 1..3 */
  coPoMap: Record<string, Record<string, number>>;
  /** optional indirect attainment per CO on a 0..3 scale */
  indirect?: Record<string, number>;
}

export interface SchemeAttainmentReport {
  framework?: string;
  isEnabled: boolean;
  coAttainment: {
    co: string;
    directLevel: number;
    percentStudentsAboveThreshold: number;
    combined: number;
  }[];
  poAttainment: Record<string, number>;
}

const EMPTY_ATTAINMENT: SchemeAttainmentReport = {
  isEnabled: false,
  coAttainment: [],
  poAttainment: {},
};

/**
 * CO attainment from assessment data, then the CO -> PO roll-up.
 *
 * Direct attainment is the level (0-3) earned by the share of students who
 * cleared `coThresholdPercentage` of each CO's marks. Indirect attainment
 * (surveys) is blended at the configured weights, defaulting to NBA's 80/20.
 */
export function calculateAttainment(
  input: SchemeAttainmentInput,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): SchemeAttainmentReport {
  const rules = pack.engineering?.attainment;
  if (!rules?.enabled) return EMPTY_ATTAINMENT;

  const threshold = rules.coThresholdPercentage ?? 60;
  const directWeight = rules.directWeight ?? 0.8;
  const indirectWeight = rules.indirectWeight ?? 0.2;
  const levels = [...(rules.levels ?? [])].sort((a, b) => b.minPercentStudents - a.minPercentStudents);

  const coAttainment: SchemeAttainmentReport['coAttainment'] = [];

  for (const co of Object.keys(input.coPoMap)) {
    let above = 0;
    let attempted = 0;
    for (const student of input.studentScores) {
      const score = student.coScores?.[co];
      if (!score || !score.max) continue;
      attempted += 1;
      if ((score.obtained / score.max) * 100 >= threshold) above += 1;
    }
    const percent = attempted > 0 ? (above / attempted) * 100 : 0;
    let level = 0;
    for (const rule of levels) {
      if (percent >= rule.minPercentStudents) { level = rule.level; break; }
    }
    const indirect = input.indirect?.[co];
    const combined = indirect != null ? round2(level * directWeight + indirect * indirectWeight) : round2(level);
    coAttainment.push({ co, directLevel: level, percentStudentsAboveThreshold: round2(percent), combined });
  }

  const byCo = new Map(coAttainment.map((c) => [c.co, c.combined]));
  const totals: Record<string, { weighted: number; weight: number }> = {};
  for (const co of Object.keys(input.coPoMap)) {
    const value = byCo.get(co) ?? 0;
    for (const [po, correlation] of Object.entries(input.coPoMap[co] ?? {})) {
      if (!correlation) continue;
      totals[po] = totals[po] ?? { weighted: 0, weight: 0 };
      totals[po].weighted += value * correlation;
      totals[po].weight += correlation;
    }
  }

  const poAttainment: Record<string, number> = {};
  for (const [po, total] of Object.entries(totals)) {
    poAttainment[po] = total.weight > 0 ? round2(total.weighted / total.weight) : 0;
  }

  return { framework: rules.framework, isEnabled: true, coAttainment, poAttainment };
}

// ─── 6. Question paper ───────────────────────────────────────────────────────

export interface BankQuestion {
  id: string;
  marks: number;
  module?: number;
  co?: string;
  bloomLevel?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface SchemePaperSection {
  code: string;
  label: string;
  marksEach?: number;
  toAttempt?: number;
  questions: BankQuestion[];
  subTotal: number;
}

export interface SchemePaper {
  templateCode: string;
  durationMinutes: number;
  rawTotal: number;
  sections: SchemePaperSection[];
  selected: BankQuestion[];
  answerableMarks: number;
}

export interface SchemePaperCheck {
  code: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

const DIFFICULTY_WEIGHT: Record<string, number> = { easy: 0.25, medium: 0.5, hard: 0.75 };
const DIFFICULTY_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

function spread(pool: BankQuestion[], count: number): BankQuestion[] {
  if (pool.length <= count) return pool.slice(0, count);
  const ranked = [...pool].sort((a, b) => {
    const byDifficulty = (DIFFICULTY_RANK[a.difficulty ?? 'medium'] ?? 1) - (DIFFICULTY_RANK[b.difficulty ?? 'medium'] ?? 1);
    return byDifficulty !== 0 ? byDifficulty : a.id.localeCompare(b.id);
  });
  const stride = Math.max(1, Math.floor(ranked.length / Math.max(count, 1)));
  const picked: BankQuestion[] = [];
  for (let i = 0; picked.length < count && i < ranked.length; i += stride) picked.push(ranked[i]);
  for (let i = 0; picked.length < count && i < ranked.length; i += 1) {
    if (!picked.includes(ranked[i])) picked.push(ranked[i]);
  }
  return picked;
}

/**
 * Build a question paper from the pack's published pattern, then validate it.
 * Supports the two shapes Indian universities actually use: VTU's module
 * pattern (2 questions per module, answer one from each) and the section
 * pattern used by autonomous and non-tech colleges (Part A / B / C).
 */
export function generateSchemePaper(
  questions: BankQuestion[],
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): { paper: SchemePaper; checks: SchemePaperCheck[] } {
  const template = pack.engineering?.paperTemplate;
  if (!template) {
    throw new Error(`Pack ${pack.code} has no engineering.paperTemplate`);
  }

  const sections: SchemePaperSection[] = [];
  const selected: BankQuestion[] = [];

  if (template.sections && template.sections.length > 0) {
    for (const section of template.sections) {
      const pool = questions.filter((q) => q.marks === section.marksEach);
      const picked = spread(pool, section.questions);
      selected.push(...picked);
      sections.push({
        code: section.code,
        label: section.label,
        marksEach: section.marksEach,
        toAttempt: section.toAttempt,
        questions: picked,
        subTotal: section.toAttempt * section.marksEach,
      });
    }
  } else {
    const modules = template.modules ?? 5;
    const perModule = template.questionsPerModule ?? 2;
    for (let module = 1; module <= modules; module += 1) {
      const pool = questions.filter((q) => q.module === module);
      const picked = spread(pool, perModule);
      selected.push(...picked);
      sections.push({
        code: `MODULE_${module}`,
        label: `Module ${module}`,
        marksEach: template.marksPerFullQuestion,
        toAttempt: 1,
        questions: picked,
        subTotal: template.marksPerFullQuestion ?? 0,
      });
    }
  }

  const answerableMarks = sections.reduce((sum, section) => sum + section.subTotal, 0);
  const paper: SchemePaper = {
    templateCode: template.code,
    durationMinutes: template.durationMinutes,
    rawTotal: template.rawTotal,
    sections,
    selected,
    answerableMarks,
  };

  return { paper, checks: validateSchemePaper(paper, pack) };
}

/** Coverage/bloom/difficulty checks on a generated paper. */
export function validateSchemePaper(
  paper: SchemePaper,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): SchemePaperCheck[] {
  const template = pack.engineering?.paperTemplate;
  const checks: SchemePaperCheck[] = [];
  if (!template) {
    return [{ code: 'TEMPLATE', status: 'fail', message: `Pack ${pack.code} has no paper template` }];
  }

  checks.push(
    paper.answerableMarks === template.rawTotal
      ? { code: 'TOTAL_MARKS', status: 'pass', message: `Answerable marks ${paper.answerableMarks} match the pattern` }
      : { code: 'TOTAL_MARKS', status: 'fail', message: `Answerable marks ${paper.answerableMarks}, pattern needs ${template.rawTotal}` },
  );

  if (template.modules) {
    const covered = new Set(paper.selected.map((q) => q.module).filter((m): m is number => typeof m === 'number'));
    const missing: number[] = [];
    for (let module = 1; module <= template.modules; module += 1) if (!covered.has(module)) missing.push(module);
    checks.push(
      missing.length === 0
        ? { code: 'MODULE_COVERAGE', status: 'pass', message: `All ${template.modules} modules covered` }
        : { code: 'MODULE_COVERAGE', status: 'fail', message: `Modules missing: ${missing.join(', ')}` },
    );
  }

  const untagged = paper.selected.filter((q) => !q.co).length;
  checks.push(
    untagged === 0
      ? { code: 'CO_TAGGED', status: 'pass', message: 'Every question is tagged to a course outcome' }
      : { code: 'CO_TAGGED', status: 'fail', message: `${untagged} question(s) without a CO tag` },
  );

  const higherOrder = paper.selected.filter((q) => /L[3-6]/i.test(q.bloomLevel ?? '')).length;
  const higherPct = paper.selected.length > 0 ? (higherOrder / paper.selected.length) * 100 : 0;
  if (template.minHigherOrderPercentage != null) {
    checks.push(
      higherPct >= template.minHigherOrderPercentage
        ? { code: 'BLOOM_MIX', status: 'pass', message: `${round2(higherPct)}% higher-order (min ${template.minHigherOrderPercentage}%)` }
        : { code: 'BLOOM_MIX', status: 'warn', message: `Only ${round2(higherPct)}% higher-order (min ${template.minHigherOrderPercentage}%)` },
    );
  }

  if (template.difficultyTarget != null && paper.selected.length > 0) {
    const index =
      paper.selected.reduce((sum, q) => sum + (DIFFICULTY_WEIGHT[q.difficulty ?? 'medium'] ?? 0.5), 0) /
      paper.selected.length;
    const distance = Math.abs(index - template.difficultyTarget);
    checks.push(
      distance <= 0.15
        ? { code: 'DIFFICULTY', status: 'pass', message: `Difficulty index ${round2(index)} vs target ${template.difficultyTarget}` }
        : { code: 'DIFFICULTY', status: 'warn', message: `Difficulty index ${round2(index)} is off target ${template.difficultyTarget}` },
    );
  }

  return checks;
}
