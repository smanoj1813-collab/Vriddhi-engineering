// src/shared/types/schemePack.ts
// ─── University Scheme Packs (G1) ────────────────────────────────────────────
//
// A "scheme pack" is the machine-readable form of one university's scheme of
// examination: marks split, IA composition, attendance slabs, pass criteria,
// grade table, mediums. Karnataka's ~33 state universities each publish a
// slightly different one (BCU 80+20 with 35/40 pass, Karnatak Dharwad NEP
// 60+40, 50-mark sub-3-credit courses, ...). Before G1 these constants were
// hardcoded in bcuCompliance.ts, which made every compliance screen, hall
// ticket and result import correct for exactly one university.
//
// The pure evaluation logic lives in src/shared/utils/schemeEngine.ts.
// bcuCompliance.ts keeps its historical exported API as thin wrappers over
// the BCU_SEP_2024 pack so every existing caller behaves identically.
//
// Persistence: custom packs are Firestore docs in `schemePacks`
// ({ collegeId: '<college>' | '*GLOBAL*', ...pack }), written only through
// the saveSchemePack callable (admin SDK — no client write path). A college
// points at its active pack via colleges/{id}.schemePackId; when unset the
// BCU pack is the default, matching pre-G1 behaviour exactly.

export type SchemePackStatus = 'active' | 'draft' | 'archived';

/** One attendance → IA-marks slab (inclusive both ends). */
export interface AttendanceMarksSlab {
  /** inclusive lower bound, e.g. 86 */
  min: number;
  /** inclusive upper bound, e.g. 90 */
  max: number;
  /** IA marks awarded inside the slab */
  marks: number;
  /** short label shown on dashboards, e.g. "Good — 4 marks" */
  label: string;
}

export interface SchemeAttendanceRules {
  /** Below this % the student is exam-blocked (BCU: 75). */
  minimumPercentage: number;
  /** Marks slabs, ordered ascending by min; must start at minimumPercentage. */
  marksSlabs: AttendanceMarksSlab[];
  /** When false, attendance never blocks exam eligibility (some schemes only
   *  carry attendance marks and leave blocking to the university's EB). */
  blocksExamEligibility: boolean;
}

export interface SchemeInternalAssessment {
  /** Total IA marks on a "standard" course (BCU 20, KUD-NEP-4cr 40). */
  totalMarks: number;
  test: {
    /** Tests conducted per course in a semester. */
    count: number;
    /** Max marks per test (BCU: 20). */
    maxMarksEach: number;
    /** Best-N of the tests are averaged (BCU: best 2). */
    bestOf: number;
    /** Marks the test average contributes to total IA (BCU: 10). */
    weightInTotal: number;
  };
  /** Marks contribution of the attendance slab (BCU: 5; 0 = none). */
  attendanceMaxMarks: number;
  /** Marks contribution of assignment/record/skill work (BCU: 5, KUD: rest). */
  assignmentMaxMarks: number;
}

export interface SchemeSemesterEndExam {
  /** Default SEE max marks for a standard course (BCU 80, KUD 60). */
  defaultMaxMarks: number;
  durationMinutes: number;
  /** Minimum % of SEE marks required to pass the course (BCU 35). */
  passPercentage: number;
  /**
   * Raw marks the paper is actually set for, when the university scales the
   * result down (VTU: paper is 100 marks, scaled to 50). Undefined = no
   * scaling, `defaultMaxMarks` is the paper maximum.
   */
  scaleFrom?: number;
}

export interface SchemePassCriteria {
  /** Minimum % of (SEE + IA) aggregate to pass (BCU/KUD 40). */
  aggregatePassPercentage: number;
  /** Minimum % of IA alone; 0 = none (BCU). */
  minimumInternalPercentage: number;
  /** SEE pass % must be met in addition to aggregate (BCU true). */
  requireSemesterEndPass: boolean;
}

export interface SchemeGrade {
  grade: string;
  gradePoint: number;
  /** Percentage bands are read from the top down: first min ≤ marks wins. */
  minPercentage: number;
  description: string;
}

// ─── Engineering extension (B.E. / B.Tech) ───────────────────────────────────
// Optional and additive: every non-tech pack simply omits this block, and the
// G1 engine keeps behaving exactly as it does today. Engineering colleges need
// course-type weightages, separate heads of passing, relative grading, OBE
// attainment and a university-specific question-paper pattern — none of which
// exist in a non-tech scheme of examination.

/** Internal/external split for one kind of course (VTU theory 50:50, project 50:100). */
export interface SchemeCourseTypeWeightage {
  internal: number;
  external: number;
  /** Separate heads of passing inside one course, e.g. ['theory', 'practical']. */
  heads?: string[];
  /** How the internal marks divide across the heads, e.g. { theory: 30, practical: 20 }. */
  internalSplit?: Record<string, number>;
  /** True when the course has no university/end-semester exam (seminar, internship). */
  internalOnly?: boolean;
}

/** One band of a relative (cohort-percentile) grading curve. */
export interface SchemeRelativeGradeBand {
  grade: string;
  gradePoint: number;
  /** Minimum cohort percentile that earns this grade. */
  minPercentile: number;
  /** Hard floor: below this percentage the student still fails. */
  absoluteMinPercentage?: number;
  description?: string;
}

/** Question-paper pattern published by the university. */
export interface SchemePaperTemplate {
  code: string;
  /** Module-based pattern (VTU): N modules, K questions each, answer one per module. */
  modules?: number;
  questionsPerModule?: number;
  marksPerFullQuestion?: number;
  maxSubQuestions?: number;
  /** Section-based pattern (autonomous / non-tech): Part A, Part B, ... */
  sections?: {
    code: string;
    label: string;
    questions: number;
    toAttempt: number;
    marksEach: number;
  }[];
  /** Marks the paper is set for, before scaling (VTU 100). */
  rawTotal: number;
  durationMinutes: number;
  /** Minimum share of L3+ (Bloom) questions, 0-100. */
  minHigherOrderPercentage?: number;
  /** Target difficulty index 0-1 (0.5 = balanced). */
  difficultyTarget?: number;
}

/** NBA / OBE outcome attainment configuration. */
export interface SchemeAttainmentRules {
  enabled: boolean;
  framework?: string;
  /** Share of students that must clear the CO threshold for attainment level 1/2/3. */
  levels?: { level: number; minPercentStudents: number }[];
  /** A CO counts as attained for a student at or above this % of the CO's marks. */
  coThresholdPercentage?: number;
  directWeight?: number;
  indirectWeight?: number;
  /** Correlation strengths allowed in the CO→PO matrix. */
  correlationScale?: number[];
}

export interface SchemeEngineeringRules {
  /** Weightage by course type; `_default` is used for unlisted types. */
  courseTypes?: Record<string, SchemeCourseTypeWeightage>;
  /**
   * Grading method. `absolute` uses the pack gradeTable (VTU). `relative`
   * uses the cohort curve in `relativeBands`, falling back to the gradeTable
   * when the cohort is too small to curve.
   */
  grading?: {
    method: 'absolute' | 'relative';
    relativeBands?: SchemeRelativeGradeBand[];
    /** Below this cohort size, grade absolutely (a curve of 6 students is noise). */
    minCohortSizeForRelative?: number;
  };
  /** Marks conversion from CGPA, applied per admission batch. */
  percentageConversion?: { expression: string; note?: string };
  paperTemplate?: SchemePaperTemplate;
  attainment?: SchemeAttainmentRules;
}

export interface UniversitySchemePack {
  /** doc id when read from Firestore; matches `code` for built-in presets. */
  id: string;
  /** short stable code, e.g. 'BCU_SEP_2024' */
  code: string;
  /** display name, e.g. 'Bengaluru City University — SEP 2024' */
  name: string;
  universityName: string;
  /** scheme label, e.g. 'SEP 2024', 'NEP 2020 CBAE' */
  schemeName: string;
  /** programmes this pack covers, e.g. ['BA','B.Com','BBA'] (display only) */
  applicableProgrammes: string[];
  attendance: SchemeAttendanceRules;
  internalAssessment: SchemeInternalAssessment;
  semesterEndExam: SchemeSemesterEndExam;
  passCriteria: SchemePassCriteria;
  /** descending by minPercentage; the engine probes in array order. */
  gradeTable: SchemeGrade[];
  /** mediums the university paper is set in, e.g. ['English','Kannada'] */
  mediums: string[];
  status: SchemePackStatus;
  /** true on the built-in presets; true marks the college default among customs */
  isDefault?: boolean;
  /** where the numbers came from (syllabus PDF / regulations page) */
  sourceNote?: string;
  /**
   * B.E./B.Tech-only rules (course-type weightages, relative grading, OBE
   * attainment, paper pattern). Absent on every non-tech pack.
   */
  engineering?: SchemeEngineeringRules;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Built-in presets ────────────────────────────────────────────────────────
// Verified against the sources cited in sourceNote. These are *code* so the
// app keeps working before any Firestore seeding: a college that has never
// touched scheme packs behaves exactly as the old BCU build.
//
// The standard NEP grade ladder is shared by every Karnataka scheme we know
// of; only the percentage floors differ between packs.

const STANDARD_GRADE_TABLE: SchemeGrade[] = [
  { grade: 'O', gradePoint: 10, minPercentage: 90, description: 'Outstanding' },
  { grade: 'A+', gradePoint: 9, minPercentage: 80, description: 'Excellent' },
  { grade: 'A', gradePoint: 8, minPercentage: 70, description: 'Very Good' },
  { grade: 'B+', gradePoint: 7, minPercentage: 60, description: 'Good' },
  { grade: 'B', gradePoint: 6, minPercentage: 50, description: 'Above Average' },
  { grade: 'C', gradePoint: 5, minPercentage: 40, description: 'Average' },
  { grade: 'P', gradePoint: 4, minPercentage: 35, description: 'Pass' },
  { grade: 'F', gradePoint: 0, minPercentage: 0, description: 'Fail' },
];

export const BCU_SEP_2024: UniversitySchemePack = {
  id: 'BCU_SEP_2024',
  code: 'BCU_SEP_2024',
  name: 'Bengaluru City University — SEP 2024',
  universityName: 'Bengaluru City University',
  schemeName: 'SEP 2024',
  applicableProgrammes: ['BA', 'B.Com', 'BBA', 'BCA', 'B.Sc', 'BSW'],
  attendance: {
    minimumPercentage: 75,
    marksSlabs: [
      { min: 76, max: 80, marks: 2, label: 'Minimum eligible' },
      { min: 81, max: 85, marks: 3, label: 'Satisfactory' },
      { min: 86, max: 90, marks: 4, label: 'Good' },
      { min: 91, max: 100, marks: 5, label: 'Excellent' },
    ],
    blocksExamEligibility: true,
  },
  internalAssessment: {
    totalMarks: 20,
    test: { count: 3, maxMarksEach: 20, bestOf: 2, weightInTotal: 10 },
    attendanceMaxMarks: 5,
    assignmentMaxMarks: 5,
  },
  semesterEndExam: {
    defaultMaxMarks: 80,
    durationMinutes: 180,
    passPercentage: 35,
  },
  passCriteria: {
    aggregatePassPercentage: 40,
    minimumInternalPercentage: 0,
    requireSemesterEndPass: true,
  },
  gradeTable: STANDARD_GRADE_TABLE,
  mediums: ['English', 'Kannada'],
  status: 'active',
  isDefault: true,
  sourceNote: 'BCU BBA Syllabus SEP 2024 — Scheme of Examination; NEP 2020 model regulations',
};

/**
 * Karnatak University Dharwad NEP CBAE (verified from kud.ac.in NEP PDFs):
 * 3–6 credit courses are 100 marks = 40 CIE + 60 SEE; <3 credit courses are
 * 50 marks. SEE and IA pass floors mirror UGC-NEP 40%, SEE pass required.
 */
export const KUD_NEP_CBAE: UniversitySchemePack = {
  id: 'KUD_NEP_CBAE',
  code: 'KUD_NEP_CBAE',
  name: 'Karnatak University Dharwad — NEP CBAE',
  universityName: 'Karnatak University, Dharwad',
  schemeName: 'NEP 2020 CBAE',
  applicableProgrammes: ['BA', 'B.Com', 'BBA', 'BCA', 'B.Sc', 'BSW', 'B.Voc'],
  attendance: {
    minimumPercentage: 75,
    marksSlabs: [
      { min: 76, max: 85, marks: 2, label: 'Minimum eligible' },
      { min: 86, max: 100, marks: 3, label: 'Good' },
    ],
    blocksExamEligibility: true,
  },
  internalAssessment: {
    totalMarks: 40,
    test: { count: 3, maxMarksEach: 40, bestOf: 2, weightInTotal: 20 },
    attendanceMaxMarks: 5,
    assignmentMaxMarks: 15,
  },
  semesterEndExam: {
    defaultMaxMarks: 60,
    durationMinutes: 180,
    passPercentage: 35,
  },
  passCriteria: {
    aggregatePassPercentage: 40,
    minimumInternalPercentage: 0,
    requireSemesterEndPass: true,
  },
  gradeTable: STANDARD_GRADE_TABLE,
  mediums: ['English', 'Kannada'],
  status: 'active',
  isDefault: false,
  sourceNote: 'KUD UG Regulations (NEP CBAE) — kud.ac.in/file_upload/nep/UG REGULATIONS.pdf; B.Com/BBA scheme PDFs',
};

/** Generic NEP-2020 defaults for any other Karnataka university until its own
 *  pack is authored: 60 SEE + 40 CIE, 75% attendance, 40% aggregate pass. */
export const GENERIC_NEP_2020: UniversitySchemePack = {
  id: 'GENERIC_NEP_2020',
  code: 'GENERIC_NEP_2020',
  name: 'Generic — NEP 2020 (60 + 40)',
  universityName: 'Any Karnataka state university',
  schemeName: 'NEP 2020 (generic)',
  applicableProgrammes: [],
  attendance: {
    minimumPercentage: 75,
    marksSlabs: [
      { min: 76, max: 90, marks: 2, label: 'Minimum eligible' },
      { min: 91, max: 100, marks: 3, label: 'Good' },
    ],
    blocksExamEligibility: true,
  },
  internalAssessment: {
    totalMarks: 40,
    test: { count: 2, maxMarksEach: 40, bestOf: 2, weightInTotal: 30 },
    attendanceMaxMarks: 5,
    assignmentMaxMarks: 5,
  },
  semesterEndExam: {
    defaultMaxMarks: 60,
    durationMinutes: 180,
    passPercentage: 35,
  },
  passCriteria: {
    aggregatePassPercentage: 40,
    minimumInternalPercentage: 0,
    requireSemesterEndPass: true,
  },
  gradeTable: STANDARD_GRADE_TABLE,
  mediums: ['English', 'Kannada'],
  status: 'active',
  isDefault: false,
  sourceNote: 'UGC NEP 2020 model curriculum defaults',
};

/**
 * VTU letter grades (VTU publishes no 5-point row: D is 6, E is 4).
 * Verified against VTU's own regulations PDFs.
 */
const VTU_GRADE_TABLE: SchemeGrade[] = [
  { grade: 'S', gradePoint: 10, minPercentage: 90, description: 'Outstanding' },
  { grade: 'A', gradePoint: 9, minPercentage: 80, description: 'Excellent' },
  { grade: 'B', gradePoint: 8, minPercentage: 70, description: 'Very Good' },
  { grade: 'C', gradePoint: 7, minPercentage: 60, description: 'Good' },
  { grade: 'D', gradePoint: 6, minPercentage: 55, description: 'Above Average' },
  { grade: 'E', gradePoint: 4, minPercentage: 50, description: 'Average / Pass' },
  { grade: 'F', gradePoint: 0, minPercentage: 0, description: 'Fail' },
];

/**
 * VTU 2022 Scheme (OBE & CBCS) — B.E./B.Tech.
 *
 * CIE 50 + SEE 50 for every course. Three independent bars:
 *   1. CIE >= 40%  -> otherwise the student is NOT ELIGIBLE to sit the SEE
 *   2. SEE >= 35%  -> otherwise the course is failed, whatever the aggregate
 *   3. CIE + SEE >= 40% aggregate
 * The SEE paper is set for 100 marks and scaled down to 50.
 */
export const VTU_2022_BE_BTECH: UniversitySchemePack = {
  id: 'VTU_2022_BE_BTECH',
  code: 'VTU_2022_BE_BTECH',
  name: 'Visvesvaraya Technological University — 2022 Scheme (OBE & CBCS)',
  universityName: 'Visvesvaraya Technological University, Belagavi',
  schemeName: '2022 Scheme (OBE & CBCS)',
  applicableProgrammes: ['B.E.', 'B.Tech'],
  attendance: {
    minimumPercentage: 75,
    // VTU carries no attendance marks; the slab exists only so the eligibility
    // gate has a table to walk.
    marksSlabs: [{ min: 75, max: 100, marks: 0, label: 'No attendance marks' }],
    blocksExamEligibility: true,
  },
  internalAssessment: {
    totalMarks: 50,
    // Two IATs of 20 marks each, averaged and scaled to 25; the remaining 25
    // are CCE (any two of assignment / quiz / seminar / case study / MOOC ...).
    test: { count: 2, maxMarksEach: 20, bestOf: 2, weightInTotal: 25 },
    attendanceMaxMarks: 0,
    assignmentMaxMarks: 25,
  },
  semesterEndExam: {
    defaultMaxMarks: 50,
    scaleFrom: 100,
    durationMinutes: 180,
    passPercentage: 35,
  },
  passCriteria: {
    aggregatePassPercentage: 40,
    minimumInternalPercentage: 40,
    requireSemesterEndPass: true,
  },
  gradeTable: VTU_GRADE_TABLE,
  mediums: ['English'],
  status: 'active',
  isDefault: false,
  sourceNote:
    'VTU (Award of B.E./B.Tech Degree) Regulations 2022 — 22OB 4.2 (CIE), 22OB 6.3 (passing standards), 22OB 6.1 (absolute grading)',
  engineering: {
    courseTypes: {
      _default: { internal: 50, external: 50 },
      theory: { internal: 50, external: 50 },
      ipcc: { internal: 50, external: 50, heads: ['theory', 'practical'], internalSplit: { theory: 30, practical: 20 } },
      lab: { internal: 50, external: 50, heads: ['practical'] },
      project: { internal: 50, external: 100 },
      seminar: { internal: 100, external: 0, internalOnly: true },
      internship: { internal: 50, external: 50 },
    },
    grading: { method: 'absolute' },
    percentageConversion: {
      expression: 'CGPA * 10',
      note: '2021-22 batch onwards. 2015/2017/2018 batches used (CGPA - 0.75) * 10.',
    },
    paperTemplate: {
      code: 'VTU_10Q_5MODULES_20M',
      modules: 5,
      questionsPerModule: 2,
      marksPerFullQuestion: 20,
      maxSubQuestions: 3,
      rawTotal: 100,
      durationMinutes: 180,
      minHigherOrderPercentage: 40,
    },
    attainment: {
      enabled: true,
      framework: 'NBA_GAPC_V4',
      levels: [
        { level: 3, minPercentStudents: 80 },
        { level: 2, minPercentStudents: 70 },
        { level: 1, minPercentStudents: 60 },
      ],
      coThresholdPercentage: 60,
      directWeight: 0.8,
      indirectWeight: 0.2,
      correlationScale: [1, 2, 3],
    },
  },
};

/**
 * Autonomous engineering college — 50:50 with RELATIVE grading.
 *
 * Where VTU grades absolutely, autonomous institutions curve: grades follow
 * the cohort percentile while pass/fail still respects an absolute floor.
 * The curve is disabled below `minCohortSizeForRelative` students.
 */
export const AUTONOMOUS_ENGINEERING_5050: UniversitySchemePack = {
  id: 'AUTONOMOUS_ENGINEERING_5050',
  code: 'AUTONOMOUS_ENGINEERING_5050',
  name: 'Autonomous Engineering College — 50:50, relative grading',
  universityName: 'Institution-specific (template defaults)',
  schemeName: 'Autonomous 50:50',
  applicableProgrammes: ['B.E.', 'B.Tech'],
  attendance: {
    minimumPercentage: 75,
    marksSlabs: [{ min: 75, max: 100, marks: 0, label: 'No attendance marks' }],
    blocksExamEligibility: true,
  },
  internalAssessment: {
    totalMarks: 50,
    test: { count: 2, maxMarksEach: 50, bestOf: 2, weightInTotal: 40 },
    attendanceMaxMarks: 0,
    assignmentMaxMarks: 10,
  },
  semesterEndExam: {
    defaultMaxMarks: 50,
    scaleFrom: 100,
    durationMinutes: 180,
    passPercentage: 35,
  },
  passCriteria: {
    aggregatePassPercentage: 40,
    minimumInternalPercentage: 40,
    requireSemesterEndPass: true,
  },
  gradeTable: STANDARD_GRADE_TABLE,
  mediums: ['English'],
  status: 'active',
  isDefault: false,
  sourceNote:
    'Template defaults for autonomous institutions (Anna University R2021 grades relatively); edit per college.',
  engineering: {
    courseTypes: {
      _default: { internal: 50, external: 50 },
      theory: { internal: 50, external: 50 },
      lab: { internal: 50, external: 50, heads: ['practical'] },
      project: { internal: 40, external: 60 },
      seminar: { internal: 100, external: 0, internalOnly: true },
    },
    grading: {
      method: 'relative',
      minCohortSizeForRelative: 30,
      relativeBands: [
        { grade: 'O', gradePoint: 10, minPercentile: 95, absoluteMinPercentage: 40, description: 'Outstanding' },
        { grade: 'A+', gradePoint: 9, minPercentile: 85, absoluteMinPercentage: 40, description: 'Excellent' },
        { grade: 'A', gradePoint: 8, minPercentile: 70, absoluteMinPercentage: 40, description: 'Very Good' },
        { grade: 'B+', gradePoint: 7, minPercentile: 55, absoluteMinPercentage: 40, description: 'Good' },
        { grade: 'B', gradePoint: 6, minPercentile: 40, absoluteMinPercentage: 40, description: 'Above Average' },
        { grade: 'C', gradePoint: 5, minPercentile: 20, absoluteMinPercentage: 40, description: 'Average' },
        { grade: 'P', gradePoint: 4, minPercentile: 0, absoluteMinPercentage: 40, description: 'Pass' },
      ],
    },
    percentageConversion: { expression: 'CGPA * 10' },
    paperTemplate: {
      code: 'AUTONOMOUS_SECTIONS_ABC',
      sections: [
        { code: 'A', label: 'Short answers', questions: 10, toAttempt: 10, marksEach: 2 },
        { code: 'B', label: 'Medium answers', questions: 6, toAttempt: 5, marksEach: 8 },
        { code: 'C', label: 'Long answers', questions: 4, toAttempt: 2, marksEach: 20 },
      ],
      rawTotal: 100,
      durationMinutes: 180,
      minHigherOrderPercentage: 50,
      difficultyTarget: 0.5,
    },
    attainment: {
      enabled: true,
      framework: 'NBA_GAPC_V4',
      levels: [
        { level: 3, minPercentStudents: 80 },
        { level: 2, minPercentStudents: 70 },
        { level: 1, minPercentStudents: 60 },
      ],
      coThresholdPercentage: 60,
      directWeight: 0.8,
      indirectWeight: 0.2,
      correlationScale: [1, 2, 3],
    },
  },
};

export const SCHEME_PACK_PRESETS: UniversitySchemePack[] = [
  BCU_SEP_2024,
  KUD_NEP_CBAE,
  GENERIC_NEP_2020,
  VTU_2022_BE_BTECH,
  AUTONOMOUS_ENGINEERING_5050,
];

/** Packs that carry B.E./B.Tech rules — used to gate engineering-only surfaces. */
export const ENGINEERING_SCHEME_PACKS: UniversitySchemePack[] = [
  VTU_2022_BE_BTECH,
  AUTONOMOUS_ENGINEERING_5050,
];

/** Pack applied when a college has none assigned — pre-G1 behaviour. */
export const DEFAULT_SCHEME_PACK = BCU_SEP_2024;
