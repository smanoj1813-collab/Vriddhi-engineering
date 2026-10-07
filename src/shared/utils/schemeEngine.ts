// src/shared/utils/schemeEngine.ts
// ─── Scheme-pack evaluation engine (G1) ─────────────────────────────────────
//
// Every function here takes an explicit UniversitySchemePack and is pure.
// bcuCompliance.ts re-exports these bound to the BCU_SEP_2024 pack under the
// historical names, so the pre-G1 behaviour of hall tickets, compliance
// dashboards and result imports is byte-for-byte preserved while new callers
// (Scheme Packs page, multi-university result import) drive everything from
// the college's assigned pack.

import {
  BCU_SEP_2024,
  DEFAULT_SCHEME_PACK,
  SCHEME_PACK_PRESETS,
  type UniversitySchemePack,
} from '../types/schemePack';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Accepts Firestore docs (custom packs) and presets alike: missing sections
 *  fall back to the default pack so a half-written custom doc still evaluates. */
export function normalizeSchemePack(value: unknown): UniversitySchemePack {
  if (!value || typeof value !== 'object') return DEFAULT_SCHEME_PACK;
  const partial = value as Partial<UniversitySchemePack>;
  // Structural fallback for half-written docs stays the historical shape so
  // existing custom packs normalise exactly as before.
  const base = BCU_SEP_2024;
  const attendance = { ...base.attendance, ...(partial.attendance ?? {}) };
  if (!Array.isArray(attendance.marksSlabs) || attendance.marksSlabs.length === 0) {
    attendance.marksSlabs = base.attendance.marksSlabs;
  }
  const ia = { ...base.internalAssessment, ...(partial.internalAssessment ?? {}) };
  ia.test = { ...base.internalAssessment.test, ...(partial.internalAssessment?.test ?? {}) };
  const see = { ...base.semesterEndExam, ...(partial.semesterEndExam ?? {}) };
  const pass = { ...base.passCriteria, ...(partial.passCriteria ?? {}) };
  const grades =
    Array.isArray(partial.gradeTable) && partial.gradeTable.length > 0
      ? [...partial.gradeTable].sort((a, b) => b.minPercentage - a.minPercentage)
      : base.gradeTable;
  return {
    ...base,
    ...partial,
    id: String(partial.id ?? base.id),
    code: String(partial.code ?? partial.id ?? base.code),
    name: String(partial.name ?? base.name),
    attendance,
    internalAssessment: ia,
    semesterEndExam: see,
    passCriteria: pass,
    gradeTable: grades,
  };
}

/** All built-in presets, by id/code. */
const PRESET_INDEX = new Map(SCHEME_PACK_PRESETS.map((p) => [p.code, p]));
export function getBuiltInSchemePack(codeOrId: string): UniversitySchemePack | null {
  return PRESET_INDEX.get(String(codeOrId ?? '').trim()) ?? null;
}

// ─── Attendance ──────────────────────────────────────────────────────────────

export interface SchemeAttendanceResult {
  percentage: number;
  marks: number;
  isEligible: boolean;
  remarks: string;
  /** tailwind-ish colour family used by dashboards */
  color: string;
  slabLabel: string;
}

export function calculateSchemeAttendanceMarks(
  percentage: number,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): SchemeAttendanceResult {
  const pct = Math.min(100, Math.max(0, percentage));
  const { minimumPercentage, marksSlabs, blocksExamEligibility } = pack.attendance;

  if (pct < minimumPercentage) {
    return {
      percentage: pct,
      marks: 0,
      isEligible: !blocksExamEligibility,
      remarks: blocksExamEligibility
        ? `Not eligible - Attendance below ${minimumPercentage}% (${pack.code})`
        : `Below ${minimumPercentage}% — university EB to decide (${pack.code})`,
      color: 'rose',
      slabLabel: 'Blocked',
    };
  }

  // Slabs are authored ascending; probe from the top so 95% lands in the 91+ slab.
  // Colour follows band quality: best slab emerald, then teal, then blue,
  // anything lower amber (matches the historical BCU dashboard palette).
  const ordered = [...marksSlabs].sort((a, b) => b.min - a.min);
  const slab = ordered.find((s) => pct >= s.min && pct <= s.max);
  const marks = slab ? slab.marks : 0;
  const slabLabel = slab?.label ?? 'Eligible';
  const slabColors = ['emerald', 'teal', 'blue', 'amber'] as const;
  const idx = slab ? ordered.indexOf(slab) : slabColors.length - 1;

  return {
    percentage: pct,
    marks,
    isEligible: true,
    remarks: `${slabLabel} attendance - ${marks} marks`,
    color: slabColors[Math.min(Math.max(idx, 0), slabColors.length - 1)],
    slabLabel,
  };
}

export function isSchemeExamEligible(
  attendancePercentage: number,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): boolean {
  if (!pack.attendance.blocksExamEligibility) return true;
  return attendancePercentage >= pack.attendance.minimumPercentage;
}

// ─── Internal assessment ─────────────────────────────────────────────────────

export interface SchemeIAInput {
  /** raw test marks, one per conducted test, each out of test.maxMarksEach */
  testMarks: number[];
  /** marks out of internalAssessment.assignmentMaxMarks */
  assignmentMarks: number;
  attendancePercentage: number;
}

export interface SchemeIAResult {
  testAverage: number;
  attendanceMarks: number;
  assignmentMarks: number;
  totalIA: number;
  totalPossible: number;
  isEligible: boolean;
  breakdown: string;
}

export function calculateSchemeInternalMarks(
  input: SchemeIAInput,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): SchemeIAResult {
  const ia = pack.internalAssessment;
  const bestOf = Math.max(1, Math.min(ia.test.bestOf || 1, input.testMarks.length || 1));
  const sorted = [...(input.testMarks || [])].sort((a, b) => b - a);
  const bestN = sorted.slice(0, bestOf);
  const bestAvgRaw = bestN.length > 0 ? bestN.reduce((a, b) => a + b, 0) / bestN.length : 0;
  const testAverage =
    ia.test.maxMarksEach > 0 ? (bestAvgRaw / ia.test.maxMarksEach) * ia.test.weightInTotal : 0;

  const att = calculateSchemeAttendanceMarks(input.attendancePercentage, pack);
  const attMarks = att.isEligible
    ? Math.min(ia.attendanceMaxMarks, att.marks)
    : 0;

  const assignMarks = Math.min(
    ia.assignmentMaxMarks,
    Math.max(0, input.assignmentMarks || 0),
  );

  const totalIA = testAverage + attMarks + assignMarks;
  return {
    testAverage: round2(testAverage),
    attendanceMarks: attMarks,
    assignmentMarks: assignMarks,
    totalIA: round2(totalIA),
    totalPossible: ia.totalMarks,
    isEligible: att.isEligible,
    breakdown:
      `Tests: ${testAverage.toFixed(1)}/${ia.test.weightInTotal} (best ${bestOf} avg: ${bestAvgRaw.toFixed(1)}/${ia.test.maxMarksEach})` +
      ` + Attendance: ${attMarks}/${ia.attendanceMaxMarks} (${input.attendancePercentage}%)` +
      ` + Assignment: ${assignMarks}/${ia.assignmentMaxMarks} = ${totalIA.toFixed(1)}/${ia.totalMarks}`,
  };
}

// ─── Pass criteria ───────────────────────────────────────────────────────────

export interface SchemePassInput {
  /** SEE (semester-end exam) marks scored */
  semesterEndMarks: number;
  internalMarks: number;
  /** Per-course overrides (KUD 50-mark courses, 75-mark papers, ...). */
  maxSemesterEndMarks?: number;
  maxInternalMarks?: number;
}

export interface SchemePassResult {
  semesterEndPercentage: number;
  internalPercentage: number;
  aggregatePercentage: number;
  totalMarks: number;
  maxTotal: number;
  isPassInSemesterEnd: boolean;
  isPassInInternal: boolean;
  isPassInAggregate: boolean;
  isPass: boolean;
  remarks: string;
}

export function checkSchemePassCriteria(
  input: SchemePassInput,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): SchemePassResult {
  const maxSee = input.maxSemesterEndMarks && input.maxSemesterEndMarks > 0
    ? input.maxSemesterEndMarks
    : pack.semesterEndExam.defaultMaxMarks;
  const maxInt = input.maxInternalMarks && input.maxInternalMarks > 0
    ? input.maxInternalMarks
    : pack.internalAssessment.totalMarks;
  const maxTotal = maxSee + maxInt;
  const total = input.semesterEndMarks + input.internalMarks;

  const seePerc = maxSee > 0 ? (input.semesterEndMarks / maxSee) * 100 : 0;
  const intPerc = maxInt > 0 ? (input.internalMarks / maxInt) * 100 : 0;
  const aggPerc = maxTotal > 0 ? (total / maxTotal) * 100 : 0;

  const isPassInSemesterEnd = seePerc >= pack.semesterEndExam.passPercentage;
  const isPassInInternal = intPerc >= pack.passCriteria.minimumInternalPercentage;
  const isPassInAggregate = aggPerc >= pack.passCriteria.aggregatePassPercentage;

  const isPass =
    isPassInAggregate &&
    (!pack.passCriteria.requireSemesterEndPass || isPassInSemesterEnd) &&
    isPassInInternal;

  const failures: string[] = [];
  if (pack.passCriteria.requireSemesterEndPass && !isPassInSemesterEnd) {
    failures.push(
      `need ${pack.semesterEndExam.passPercentage}% in university exam (${round2((pack.semesterEndExam.passPercentage / 100) * maxSee)}/${maxSee}), got ${seePerc.toFixed(1)}%`,
    );
  }
  if (!isPassInInternal && pack.passCriteria.minimumInternalPercentage > 0) {
    failures.push(`need ${pack.passCriteria.minimumInternalPercentage}% in IA, got ${intPerc.toFixed(1)}%`);
  }
  if (!isPassInAggregate) {
    failures.push(`need ${pack.passCriteria.aggregatePassPercentage}% aggregate, got ${aggPerc.toFixed(1)}%`);
  }

  return {
    semesterEndPercentage: round2(seePerc),
    internalPercentage: round2(intPerc),
    aggregatePercentage: round2(aggPerc),
    totalMarks: total,
    maxTotal,
    isPassInSemesterEnd,
    isPassInInternal,
    isPassInAggregate,
    isPass,
    remarks: isPass
      ? `Pass - ${seePerc.toFixed(1)}% in university exam, ${aggPerc.toFixed(1)}% aggregate (${pack.code})`
      : `Fail - ${failures.join('; ')}`,
  };
}

// ─── Grades & SGPA/CGPA ──────────────────────────────────────────────────────

export interface SchemeGradeResult {
  grade: string;
  gradePoint: number;
  description: string;
}

export function getSchemeGradeFromMarks(
  marks: number,
  maxMarks = 100,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): SchemeGradeResult {
  const perc = maxMarks > 0 ? (marks / maxMarks) * 100 : 0;
  for (const row of pack.gradeTable) {
    if (perc >= row.minPercentage) {
      return { grade: row.grade, gradePoint: row.gradePoint, description: row.description };
    }
  }
  const last = pack.gradeTable[pack.gradeTable.length - 1] ?? { grade: 'F', gradePoint: 0, description: 'Fail' };
  return { grade: last.grade, gradePoint: last.gradePoint ?? 0, description: last.description };
}

export interface SchemeSubjectGrade {
  credits: number;
  gradePoint: number;
}

export function calculateSchemeSGPA(subjects: SchemeSubjectGrade[]): number {
  if (subjects.length === 0) return 0;
  const totalCredits = subjects.reduce((sum, s) => sum + s.credits, 0);
  const totalPoints = subjects.reduce((sum, s) => sum + s.credits * s.gradePoint, 0);
  return totalCredits > 0 ? totalPoints / totalCredits : 0;
}

// ─── Eligibility messaging (hall tickets) ────────────────────────────────────

export function getSchemeAttendanceEligibilityMessage(
  percentage: number,
  pack: UniversitySchemePack = DEFAULT_SCHEME_PACK,
): string {
  const min = pack.attendance.minimumPercentage;
  if (pack.attendance.blocksExamEligibility && percentage < min) {
    return `Not eligible for university exam - Attendance ${percentage.toFixed(1)}% is below ${min}% minimum (${pack.code})`;
  }
  const att = calculateSchemeAttendanceMarks(percentage, pack);
  return `Eligible - ${percentage.toFixed(1)}% attendance (${att.marks} IA marks)`;
}

// re-export for convenience — most callers want the default alongside the fns.
export { BCU_SEP_2024, DEFAULT_SCHEME_PACK };
export type { UniversitySchemePack };
