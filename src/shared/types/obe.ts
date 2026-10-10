// src/shared/types/obe.ts
//
// Outcome-Based Education (OBE) domain model for NBA accreditation.
//
// This sits beside the scheme-pack engine: scheme packs carry the *rules*
// (thresholds, levels, weights — see SchemeAttainmentRules), while this module
// carries the *framework vocabulary* (GAPC v4.0 outcomes, Bloom levels) and the
// inputs/outputs of the attainment pipeline in `../utils/obeAttainment.ts`.
//
// Pipeline: CO-tagged question marks → per-student CO scores → tool-wise &
// overall direct attainment → (+ indirect surveys, 80/20) → CO attainment →
// PO/PSO roll-up → program-level roll-up → targets/gaps → SAR tables.

/** NBA accreditation framework identifier. */
export type ObeFramework = 'NBA-GAPC-v4.0';

/** One programme outcome (or programme-specific outcome) definition. */
export interface ObeOutcomeDefinition {
  code: string;
  title: string;
  statement: string;
}

/**
 * The 11 Programme Outcomes under NBA GAPC v4.0 (Revised SAR 2025, aligned
 * with the Washington Accord 2021 review). This replaced the earlier 12-PO
 * framework: old PO6 (Engineer and Society) + old PO7 (Environment and
 * Sustainability) merged into the new PO6, old PO8–PO12 shifted to PO7–PO11,
 * and old PO5 was renamed from "Modern Tool Usage".
 */
export const GAPC_V4_PROGRAM_OUTCOMES: ObeOutcomeDefinition[] = [
  {
    code: 'PO1',
    title: 'Engineering Knowledge',
    statement:
      'Apply knowledge of mathematics, science and engineering fundamentals to the solution of complex engineering problems.',
  },
  {
    code: 'PO2',
    title: 'Problem Analysis',
    statement:
      'Identify, formulate and analyse complex engineering problems reaching substantiated conclusions.',
  },
  {
    code: 'PO3',
    title: 'Design / Development of Solutions',
    statement:
      'Design solutions for complex engineering problems with consideration for public health, safety, culture, society and environment.',
  },
  {
    code: 'PO4',
    title: 'Conduct Investigations of Complex Problems',
    statement:
      'Use research-based knowledge and methods including design of experiments, analysis and interpretation of data.',
  },
  {
    code: 'PO5',
    title: 'Engineering Tool Usage',
    statement:
      'Create, select and apply appropriate techniques, resources and modern engineering and IT tools, including prediction and modelling, to complex engineering problems.',
  },
  {
    code: 'PO6',
    title: 'The Engineer and the World',
    statement:
      'Apply reasoning informed by contextual knowledge to assess societal, health, safety, legal and cultural issues and the consequent responsibilities.',
  },
  {
    code: 'PO7',
    title: 'Ethics',
    statement:
      'Apply ethical principles and commit to professional ethics, human values, diversity and inclusion.',
  },
  {
    code: 'PO8',
    title: 'Individual and Collaborative Team Work',
    statement:
      'Function effectively as an individual, and as a member or leader in diverse teams and multidisciplinary settings.',
  },
  {
    code: 'PO9',
    title: 'Communication',
    statement:
      'Communicate effectively on complex engineering activities with the engineering community and society at large.',
  },
  {
    code: 'PO10',
    title: 'Project Management and Finance',
    statement:
      'Demonstrate knowledge of engineering and management principles and apply them to manage projects in multidisciplinary environments.',
  },
  {
    code: 'PO11',
    title: 'Life-Long Learning',
    statement:
      'Recognise the need for, and engage in, independent and life-long learning in the broadest context of technological change.',
  },
];

/** Bloom's cognitive levels, as used on CO definitions and question tags. */
export interface ObeBloomLevel {
  code: string;
  label: string;
  /** L3+ counts as higher-order for paper-pattern checks. */
  higherOrder: boolean;
}

export const BLOOM_LEVELS: ObeBloomLevel[] = [
  { code: 'L1', label: 'Remember', higherOrder: false },
  { code: 'L2', label: 'Understand', higherOrder: false },
  { code: 'L3', label: 'Apply', higherOrder: true },
  { code: 'L4', label: 'Analyze', higherOrder: true },
  { code: 'L5', label: 'Evaluate', higherOrder: true },
  { code: 'L6', label: 'Create', higherOrder: true },
];

/** A course outcome defined for one course offering. */
export interface ObeCourseOutcome {
  code: string;
  statement: string;
  bloomLevel?: string;
}

/**
 * CO → PO/PSO correlation matrix.
 * `{ CO1: { PO1: 3, PO2: 2, PSO1: 1 } }` — strengths 1 (slight) to 3 (substantial).
 */
export type ObeMappingMatrix = Record<string, Record<string, number>>;

/** One student's marks on one question (the question carries CO tags). */
export interface ObeQuestionMark {
  studentId: string;
  questionId: string;
  obtained: number;
  max: number;
  /** Direct-assessment tool this mark came from (CIE-1, assignment, SEE …). */
  tool?: string;
}

/** CO tags for one question; multi-CO questions split marks equally by default. */
export type ObeQuestionCoTags = Record<string, string[]>;

/** Per-student, per-CO aggregated scores — the engine's core input. */
export interface ObeStudentCoScores {
  studentId: string;
  coScores: Record<string, { obtained: number; max: number }>;
}

/** Direct attainment of one CO under one assessment tool. */
export interface ObeToolCoAttainment {
  tool: string;
  co: string;
  attempted: number;
  percentAboveThreshold: number;
  level: number;
}

/** One indirect-attainment survey response (course/program exit, alumni …). */
export interface ObeSurveyResponse {
  co: string;
  score: number;
  maxScore: number;
}

/** One course's contribution to program-level PO/PSO attainment. */
export interface ObeProgramCourseContribution {
  courseCode: string;
  credits: number;
  /** Combined CO→outcome roll-up for this course (POs and PSOs mixed). */
  outcomeAttainment: Record<string, number>;
}

/** Target-vs-attained evaluation for one outcome. */
export interface ObeTargetGap {
  outcome: string;
  attained: number;
  target: number;
  gap: number;
  met: boolean;
}

/** One row of the SAR course-level CO attainment table. */
export interface ObeSarCoRow {
  co: string;
  statement?: string;
  direct: number;
  indirect: number | null;
  combined: number;
  target?: number;
  status: 'attained' | 'not-attained' | 'no-target';
}

/** One row of the SAR PO/PSO attainment table (course or program level). */
export interface ObeSarOutcomeRow {
  outcome: string;
  title?: string;
  attainment: number;
  target?: number;
  gap?: number;
  status: 'attained' | 'not-attained' | 'no-target';
}

// ─── Firestore documents ────────────────────────────────────────────────────
// obeMappings: one per course offering per term (draft → published → archived).
// obeRuns: immutable computed evidence — every run embeds the mapping + rules
// snapshot it was computed from, so a SAR table is reproducible years later.
// Writes go through the functions/src/obe.ts callables only; security rules
// deny all client writes (same single-door pattern as scheme packs).

export type ObeMappingStatus = 'draft' | 'published' | 'archived';

/** Rules frozen at publish time so runs stay reproducible. */
export interface ObeRulesSnapshot {
  coThresholdPercentage: number;
  levels: { level: number; minPercentStudents: number }[];
  directWeight: number;
  indirectWeight: number;
}

export interface ObeMappingDoc {
  id: string;
  collegeId: string;
  programId?: string;
  branch?: string;
  courseCode: string;
  courseTitle?: string;
  academicYear: string;
  term?: string;
  facultyId?: string;
  framework: ObeFramework;
  cos: ObeCourseOutcome[];
  mapping: ObeMappingMatrix;
  targets?: Record<string, number>;
  coTargets?: Record<string, number>;
  rulesSnapshot?: ObeRulesSnapshot;
  status: ObeMappingStatus;
  createdAt?: unknown;
  createdBy?: string;
  updatedAt?: unknown;
  updatedBy?: string;
  publishedAt?: unknown;
  publishedBy?: string;
}

export interface ObeRunCoResult {
  co: string;
  attempted: number;
  percentAboveThreshold: number;
  direct: number;
  indirect: number | null;
  combined: number;
}

export interface ObeRunDoc {
  id: string;
  collegeId: string;
  mappingId: string;
  label?: string;
  mappingSnapshot: {
    cos: ObeCourseOutcome[];
    mapping: ObeMappingMatrix;
    rules: ObeRulesSnapshot;
  };
  studentCount: number;
  tools: string[];
  coResults: ObeRunCoResult[];
  outcomes: Record<string, number>;
  gaps: ObeTargetGap[];
  createdAt?: unknown;
  createdBy?: string;
}
