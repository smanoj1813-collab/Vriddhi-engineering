// src/shared/utils/testTemplate.ts
// Pure helpers behind the Create Test flow: codes, section defaults, totals,
// validation, readiness and duplication. No Firestore, no React — every rule
// that decides "is this test sane / schedulable" is unit tested here.

import {
  TEST_TEMPLATE_DOC_KIND,
  defaultDeliverySettings,
  type TestCohort,
  type TestKind,
  type TestSection,
  type TestSectionType,
  type TestTemplate,
} from '@/shared/types/testTemplate'

export { TEST_TEMPLATE_DOC_KIND }

// ─── Test code ───────────────────────────────────────────────────────────────

/** Max length of a test code — long enough for CSE-DBMS-IAT1-2026. */
export const TEST_CODE_MAX = 32

/**
 * Codes are shared verbally and over WhatsApp ("schedule template VQ-DBMS-01"),
 * so they normalise hard: upper case, A–Z 0–9 and '-' only, no repeated or
 * edge dashes, capped length.
 */
export function normalizeTestCode(input: string): string {
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, TEST_CODE_MAX)
    .replace(/-$/, '')
}

const KIND_CODE: Record<TestKind, string> = {
  internal: 'IAT',
  practice: 'PRAC',
  mock_drive: 'MOCK',
  diagnostic: 'DIAG',
}

/** Suggest a code from what the author has already typed. Never random-only. */
export function suggestTestCode(parts: {
  branch?: string
  subject?: string
  kind?: TestKind
  year?: number | string
}): string {
  const bits = [
    parts.branch,
    parts.subject,
    parts.kind ? KIND_CODE[parts.kind] : '',
    parts.year ? String(parts.year) : '',
  ].filter(Boolean)
  const code = normalizeTestCode(bits.join('-'))
  return code || normalizeTestCode(`TEST-${Date.now().toString(36)}`)
}

// ─── Sections ────────────────────────────────────────────────────────────────

export const MARKS_PRESETS = [1, 2, 3, 5, 10] as const
export const PENALTY_PRESETS = [0, 0.25, 0.5, 1] as const

/** 1/4-of-correct style penalties, rounded to 2dp (Karnataka's usual pattern). */
export function fractionPenalty(correctMarks: number, denominator: number): number {
  if (!Number.isFinite(correctMarks) || correctMarks <= 0) return 0
  if (!Number.isFinite(denominator) || denominator <= 0) return 0
  return Math.round((correctMarks / denominator) * 100) / 100
}

export function createEmptySection(order: number, overrides: Partial<TestSection> = {}): TestSection {
  return {
    id: `s${order}_${Math.random().toString(36).slice(2, 8)}`,
    order,
    name: `Section ${order}`,
    type: 'mcq',
    durationMinutes: 30,
    instructions: '',
    defaultCorrectMarks: 1,
    defaultPenalty: 0,
    plannedQuestions: 0,
    lockOnSubmit: false,
    questions: [],
    ...overrides,
  }
}

/** Build N empty sections (wizard step 2 pages through them 1/N … N/N). */
export function createSections(count: number): TestSection[] {
  const n = Math.max(1, Math.min(20, Math.floor(count) || 1))
  return Array.from({ length: n }, (_, i) => createEmptySection(i + 1))
}

export interface SectionTotals {
  questions: number
  marks: number
  durationMinutes: number
}

/**
 * Marks come from the questions actually added; an empty section falls back to
 * its plan (`plannedQuestions × defaultCorrectMarks`) so the wizard can show a
 * believable total before any question exists.
 */
export function sectionTotals(section: TestSection): SectionTotals {
  const questions = section.questions?.length ?? 0
  const marks = questions > 0
    ? section.questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0)
    : (Number(section.plannedQuestions) || 0) * (Number(section.defaultCorrectMarks) || 0)
  return {
    questions,
    marks: Math.round(marks * 100) / 100,
    durationMinutes: Number(section.durationMinutes) || 0,
  }
}

export interface TestTotals extends SectionTotals {
  sections: number
  plannedQuestions: number
}

export function testTotals(sections: readonly TestSection[]): TestTotals {
  return sections.reduce<TestTotals>((totals, section) => {
    const t = sectionTotals(section)
    return {
      sections: totals.sections + 1,
      questions: totals.questions + t.questions,
      plannedQuestions: totals.plannedQuestions + (Number(section.plannedQuestions) || 0),
      marks: Math.round((totals.marks + t.marks) * 100) / 100,
      durationMinutes: totals.durationMinutes + t.durationMinutes,
    }
  }, { sections: 0, questions: 0, plannedQuestions: 0, marks: 0, durationMinutes: 0 })
}

/** "3 sections · 60 questions · 120 marks · 90 min" — the wizard summary bar. */
export function summaryLine(sections: readonly TestSection[]): string {
  const t = testTotals(sections)
  const q = t.questions || t.plannedQuestions
  return `${t.sections} section${t.sections === 1 ? '' : 's'} · ${q} question${q === 1 ? '' : 's'} · ${t.marks} marks · ${t.durationMinutes} min`
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface TestDetailsDraft {
  title: string
  testCode: string
  sectionCount: number
  maxTabSwitches: number
}

export function validateTestDetails(draft: TestDetailsDraft): string[] {
  const errors: string[] = []
  const title = draft.title?.trim() ?? ''
  if (title.length < 3) errors.push('Test name must be at least 3 characters.')
  if (title.length > 120) errors.push('Test name must be 120 characters or fewer.')
  if (!normalizeTestCode(draft.testCode)) errors.push('Test code is required.')
  if (!Number.isFinite(draft.sectionCount) || draft.sectionCount < 1 || draft.sectionCount > 20) {
    errors.push('A test needs between 1 and 20 sections.')
  }
  if (!Number.isFinite(draft.maxTabSwitches) || draft.maxTabSwitches < 0 || draft.maxTabSwitches > 50) {
    errors.push('Tab switches allowed must be between 0 and 50.')
  }
  return errors
}

export function validateSection(section: TestSection, index: number): string[] {
  const label = section.name?.trim() || `Section ${index + 1}`
  const errors: string[] = []
  if (!section.name?.trim()) errors.push(`${label}: name is required.`)
  if (!Number.isFinite(section.durationMinutes) || section.durationMinutes < 1 || section.durationMinutes > 600) {
    errors.push(`${label}: duration must be between 1 and 600 minutes.`)
  }
  if (!Number.isFinite(section.defaultCorrectMarks) || section.defaultCorrectMarks <= 0 || section.defaultCorrectMarks > 100) {
    errors.push(`${label}: default correct marks must be between 0.25 and 100.`)
  }
  if (!Number.isFinite(section.defaultPenalty) || section.defaultPenalty < 0 || section.defaultPenalty > 100) {
    errors.push(`${label}: penalty cannot be negative.`)
  }
  if (section.defaultPenalty > section.defaultCorrectMarks) {
    errors.push(`${label}: penalty cannot exceed the correct marks.`)
  }
  if (section.plannedQuestions < 0 || section.plannedQuestions > 500) {
    errors.push(`${label}: planned questions must be between 0 and 500.`)
  }
  return errors
}

export function validateSections(sections: readonly TestSection[]): string[] {
  const errors = sections.flatMap((section, index) => validateSection(section, index))
  const names = sections.map((s) => s.name?.trim().toLowerCase()).filter(Boolean)
  if (new Set(names).size !== names.length) errors.push('Section names must be unique.')
  return errors
}

// ─── Readiness (can this test be scheduled?) ─────────────────────────────────

export interface TestReadiness {
  ready: boolean
  blockers: string[]
}

/**
 * A test may be scheduled only when every section carries at least one
 * question and the basics are sane. Mirrors the schedule-time server
 * validation (`isPaperOnlineReady`) so the UI never offers a schedule the
 * callable would reject.
 */
export function testReadiness(template: Pick<TestTemplate, 'title' | 'testCode' | 'sections'>): TestReadiness {
  const blockers: string[] = []
  if (!template.title?.trim()) blockers.push('Test name is missing.')
  if (!normalizeTestCode(template.testCode || '')) blockers.push('Test code is missing.')
  if (!template.sections?.length) blockers.push('The test has no sections.')
  for (const [index, section] of (template.sections ?? []).entries()) {
    const label = section.name?.trim() || `Section ${index + 1}`
    if (!section.questions?.length) blockers.push(`${label}: no questions added yet.`)
  }
  const totals = testTotals(template.sections ?? [])
  if (totals.questions > 0 && totals.marks <= 0) blockers.push('Total marks must be greater than zero.')
  return { ready: blockers.length === 0, blockers }
}

/** Lifecycle derived from readiness — `testStatus` is stored, never guessed. */
export function lifecycleFor(template: Pick<TestTemplate, 'title' | 'testCode' | 'sections'>): 'draft' | 'ready' {
  return testReadiness(template).ready ? 'ready' : 'draft'
}

// ─── Duplication (the platform-template feature) ─────────────────────────────

export interface DuplicateOptions {
  title?: string
  testCode?: string
  collegeId: string
  createdBy: string
  createdByName: string
  /** Where this copy came from, so the college can trace the original. */
  source?: TestTemplate['source']
}

/**
 * Clone a test (own test, or a platform template shared by the Vriddhi
 * assessment team) into a fresh college draft: new section ids, provenance
 * recorded, lifecycle recomputed, ownership transferred. Questions ride along
 * because they are embedded — one read, one write, any size.
 */
export function duplicateTemplate(source: TestTemplate, options: DuplicateOptions): Omit<TestTemplate, 'id'> {
  const title = options.title?.trim() || `${source.title} (copy)`
  const testCode = normalizeTestCode(options.testCode || `${source.testCode}-COPY`)
  const sections = (source.sections ?? []).map((section, index) => ({
    ...section,
    id: `s${index + 1}_${Math.random().toString(36).slice(2, 8)}`,
    order: index + 1,
    questions: (section.questions ?? []).map((question, qIndex) => ({ ...question, order: qIndex + 1 })),
  }))
  const next: Omit<TestTemplate, 'id'> = {
    title,
    testCode,
    kind: source.kind,
    ...(source.subject ? { subject: source.subject } : {}),
    ...(source.program ? { program: source.program } : {}),
    ...(source.branch ? { branch: source.branch } : {}),
    ...(typeof source.semester === 'number' ? { semester: source.semester } : {}),
    description: source.description ?? '',
    instructions: source.instructions ?? '',
    // A copy belongs to the copying college: cohorts are theirs to pick.
    cohorts: [],
    delivery: { ...defaultDeliverySettings(), ...source.delivery },
    sections,
    testStatus: lifecycleFor({ title, testCode, sections }),
    scope: 'college',
    collegeId: options.collegeId,
    createdBy: options.createdBy,
    createdByName: options.createdByName,
    ...(options.source
      ? { source: options.source }
      : {
        source: {
          kind: source.scope === 'platform' ? 'platform_template' : 'duplicate',
          refId: source.id,
          refCode: source.testCode,
          refTitle: source.title,
        },
      }),
  }
  return next
}

// ─── Display helpers ─────────────────────────────────────────────────────────

export function cohortLabel(cohort: TestCohort): string {
  const bits = [cohort.program, cohort.branch, cohort.batch, cohort.section ? `Sec ${cohort.section}` : '']
    .map((value) => (value ?? '').toString().trim())
    .filter(Boolean)
  return bits.length ? bits.join(' · ') : 'All students'
}

export function sectionTypeIsAutoGraded(type: TestSectionType): boolean {
  return type === 'mcq' || type === 'msq' || type === 'numerical'
}
