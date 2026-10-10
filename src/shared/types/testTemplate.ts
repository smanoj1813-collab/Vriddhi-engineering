// src/shared/types/testTemplate.ts
// ─── Test template (Create Test flow) ────────────────────────────────────────
//
// A "test" in the Create Test flow IS a sectioned paper. We deliberately did
// NOT add a new top-level collection (docs/ASSESSMENT_CREATE_TEST_FLOW.md §1):
//
//   • college tests  → papers/{id}          (+ docKind: 'test_template')
//   • platform tests → paperTemplates/{id}  (+ scope: 'platform')
//
// Both are client-writable by college staff under the CURRENT rules, so the
// whole authoring surface deploys as hosting only — no new Cloud Run service,
// no new collection, no new composite index, no migration.
//
// Rules-imposed invariants we must respect on papers/{id} (see
// firestore.rules `match /papers/{id}`):
//   • create requires status == 'draft' AND verificationStatus == 'draft'
//   • update may not touch collegeId / createdBy / status / verificationStatus
// ⇒ the authoring lifecycle therefore lives in OUR OWN field, `testStatus`,
//   and `status` stays 'draft' for the life of the template. Scheduling (the
//   callable) is what turns a template into a live test, exactly as before.

export type TestSectionType = 'mcq' | 'msq' | 'numerical' | 'descriptive' | 'coding'

export const TEST_SECTION_TYPES: readonly TestSectionType[] = [
  'mcq', 'msq', 'numerical', 'descriptive', 'coding',
]

export const TEST_SECTION_TYPE_LABELS: Record<TestSectionType, string> = {
  mcq: 'MCQ (single correct)',
  msq: 'MSQ (multiple correct)',
  numerical: 'Numerical answer',
  descriptive: 'Descriptive (manual grading)',
  coding: 'Coding',
}

/** Authoring lifecycle — ours, not the Firestore-rules `status` field. */
export type TestLifecycle = 'draft' | 'ready' | 'archived'

export type TestKind = 'internal' | 'practice' | 'mock_drive' | 'diagnostic'

export const TEST_KIND_LABELS: Record<TestKind, string> = {
  internal: 'Internal test (IAT)',
  practice: 'Practice test',
  mock_drive: 'Mock placement drive',
  diagnostic: 'Diagnostic',
}

/** When candidates may see their performance report. */
export type CandidateReportWhen = 'immediately' | 'after_window' | 'manual'

export interface CandidateReportSettings {
  enabled: boolean
  when: CandidateReportWhen
  /** score | answers | explanations | stats */
  show: string[]
}

export interface TestDeliverySettings {
  shuffleQuestions: boolean
  shuffleOptions: boolean
  shuffleSections: boolean
  /** 0 = no limit. The ladder (warn → warn → auto-submit) lives in the player. */
  maxTabSwitches: number
  candidateReport: CandidateReportSettings
}

/** Cohort label the test is authored for; the scheduler resolves real students. */
export interface TestCohort {
  program?: string
  branch?: string
  batch?: string
  section?: string
  semester?: number
}

/**
 * Questions are EMBEDDED (snapshot), not referenced. Two reasons:
 *   1. duplicating a test — the central feature of the platform template
 *      library — becomes one read + one write, whatever its size;
 *   2. a platform template stays readable by a college that has no access to
 *      the authoring college's question docs.
 */
export interface TestSectionQuestion {
  questionId: string
  order: number
  marks: number
  negativeMarks: number
  /** Snapshot of the question text so lists/previews need no extra reads. */
  text?: string
  type?: string
  difficulty?: string
  topic?: string
}

export interface TestSection {
  id: string
  order: number
  name: string
  type: TestSectionType
  durationMinutes: number
  instructions: string
  defaultCorrectMarks: number
  /** Absolute marks deducted per wrong answer. 0 = no negative marking. */
  defaultPenalty: number
  /** Authoring target, used by the pool-health meter. 0 = unset. */
  plannedQuestions: number
  /** Section locks when the candidate submits it (mock drives) or not (IATs). */
  lockOnSubmit: boolean
  questions: TestSectionQuestion[]
}

/** Where a test came from — shown as provenance on My Tests. */
export interface TestSource {
  kind: 'platform_template' | 'duplicate'
  refId: string
  refCode?: string
  refTitle?: string
}

export interface TestTemplate {
  id: string
  title: string
  /** Human-shareable code. Platform templates share THIS as the "test ID". */
  testCode: string
  kind: TestKind
  subject?: string
  program?: string
  branch?: string
  semester?: number
  description: string
  instructions: string
  cohorts: TestCohort[]
  delivery: TestDeliverySettings
  sections: TestSection[]
  testStatus: TestLifecycle
  /** 'college' for papers/{id}; 'platform' for paperTemplates/{id}. */
  scope: 'college' | 'platform'
  collegeId: string
  createdBy: string
  createdByName: string
  createdAt?: string
  updatedAt?: string
  source?: TestSource
  /** Platform templates only: a short note from the Vriddhi assessment team. */
  templateNotes?: string
}

/** Marker written on papers/{id} so the Create Test list ignores legacy papers. */
export const TEST_TEMPLATE_DOC_KIND = 'test_template'

/** Default delivery settings for a brand-new test. */
export function defaultDeliverySettings(): TestDeliverySettings {
  return {
    shuffleQuestions: true,
    shuffleOptions: true,
    shuffleSections: false,
    maxTabSwitches: 3,
    candidateReport: {
      enabled: true,
      when: 'after_window',
      show: ['score', 'answers', 'explanations'],
    },
  }
}
