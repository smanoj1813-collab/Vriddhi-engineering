import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cohortLabel,
  createEmptySection,
  createSections,
  duplicateTemplate,
  fractionPenalty,
  lifecycleFor,
  normalizeTestCode,
  sectionTotals,
  sectionTypeIsAutoGraded,
  suggestTestCode,
  summaryLine,
  testReadiness,
  testTotals,
  validateSections,
  validateTestDetails,
} from './testTemplate'
import { defaultDeliverySettings, type TestTemplate } from '../types/testTemplate'

const sectionWithQuestions = createEmptySection(1, {
  name: 'MCQ',
  durationMinutes: 30,
  defaultCorrectMarks: 2,
  defaultPenalty: 0.5,
  plannedQuestions: 20,
  questions: [
    { questionId: 'q1', order: 1, marks: 2, negativeMarks: 0.5 },
    { questionId: 'q2', order: 2, marks: 3, negativeMarks: 0.5 },
  ],
})

const emptyCoding = createEmptySection(2, {
  name: 'Coding',
  type: 'coding',
  durationMinutes: 60,
  defaultCorrectMarks: 10,
  plannedQuestions: 3,
})

test('test codes normalise for sharing', () => {
  assert.equal(normalizeTestCode(' cse dbms iat1 2026 '), 'CSE-DBMS-IAT1-2026')
  assert.equal(normalizeTestCode('a//b__c'), 'A-B-C')
  assert.equal(normalizeTestCode('---'), '')
  assert.equal(normalizeTestCode(''), '')
  // Capped and never left with a trailing dash.
  assert.equal(normalizeTestCode('X'.repeat(40)).length, 32)
  assert.equal(normalizeTestCode(`${'Y'.repeat(31)}-ZZZ`).endsWith('-'), false)
})

test('code suggestions use what the author already typed', () => {
  assert.equal(
    suggestTestCode({ branch: 'CSE', subject: 'DBMS', kind: 'internal', year: 2026 }),
    'CSE-DBMS-IAT-2026',
  )
  assert.equal(suggestTestCode({ subject: 'Aptitude', kind: 'mock_drive' }), 'APTITUDE-MOCK')
  // Nothing to go on → still a usable code, never an empty one.
  assert.ok(suggestTestCode({}).startsWith('TEST-'))
})

test('penalty fractions follow the 1/4-of-correct pattern', () => {
  assert.equal(fractionPenalty(4, 4), 1)
  assert.equal(fractionPenalty(1, 3), 0.33)
  assert.equal(fractionPenalty(2, 0), 0)
  assert.equal(fractionPenalty(0, 4), 0)
})

test('section totals count real questions, falling back to the plan', () => {
  assert.deepEqual(sectionTotals(sectionWithQuestions), { questions: 2, marks: 5, durationMinutes: 30 })
  // No questions yet → planned × default marks, so the wizard shows a total.
  assert.deepEqual(sectionTotals(emptyCoding), { questions: 0, marks: 30, durationMinutes: 60 })
})

test('test totals and the summary bar aggregate every section', () => {
  const totals = testTotals([sectionWithQuestions, emptyCoding])
  assert.equal(totals.sections, 2)
  assert.equal(totals.questions, 2)
  assert.equal(totals.plannedQuestions, 23)
  assert.equal(totals.marks, 35)
  assert.equal(totals.durationMinutes, 90)
  assert.equal(summaryLine([sectionWithQuestions, emptyCoding]), '2 sections · 2 questions · 35 marks · 90 min')
})

test('createSections clamps the count and numbers sections from 1', () => {
  assert.equal(createSections(3).length, 3)
  assert.deepEqual(createSections(3).map((s) => s.order), [1, 2, 3])
  assert.equal(createSections(0).length, 1)
  assert.equal(createSections(999).length, 20)
  // Ids are unique so React keys and question routing never collide.
  assert.equal(new Set(createSections(5).map((s) => s.id)).size, 5)
})

test('step 1 validation', () => {
  assert.deepEqual(validateTestDetails({ title: 'DBMS IAT-1', testCode: 'CSE-DBMS', sectionCount: 2, maxTabSwitches: 3 }), [])
  const errors = validateTestDetails({ title: 'x', testCode: '', sectionCount: 0, maxTabSwitches: -1 })
  assert.equal(errors.length, 4)
})

test('step 2 validation catches the marks traps', () => {
  assert.deepEqual(validateSections([sectionWithQuestions, emptyCoding]), [])
  const bad = createEmptySection(1, { name: 'Bad', durationMinutes: 0, defaultCorrectMarks: 1, defaultPenalty: 2 })
  const errors = validateSections([bad])
  assert.ok(errors.some((e) => e.includes('duration')))
  assert.ok(errors.some((e) => e.includes('penalty cannot exceed')))
  // Duplicate names are rejected — sections are addressed by name everywhere.
  const dupes = validateSections([createEmptySection(1, { name: 'MCQ' }), createEmptySection(2, { name: 'mcq' })])
  assert.ok(dupes.some((e) => e.includes('unique')))
})

test('readiness: a section without questions blocks scheduling', () => {
  const ready = testReadiness({ title: 'T', testCode: 'T-1', sections: [sectionWithQuestions] })
  assert.deepEqual(ready, { ready: true, blockers: [] })

  const blocked = testReadiness({ title: 'T', testCode: 'T-1', sections: [sectionWithQuestions, emptyCoding] })
  assert.equal(blocked.ready, false)
  assert.deepEqual(blocked.blockers, ['Coding: no questions added yet.'])

  assert.equal(testReadiness({ title: '', testCode: '', sections: [] }).blockers.length, 3)
  assert.equal(lifecycleFor({ title: 'T', testCode: 'T-1', sections: [sectionWithQuestions] }), 'ready')
  assert.equal(lifecycleFor({ title: 'T', testCode: 'T-1', sections: [emptyCoding] }), 'draft')
})

const platformTemplate: TestTemplate = {
  id: 'tpl_1',
  title: 'Cloud Computing — Technical MCQ',
  testCode: 'VQ-CLOUD-01',
  kind: 'mock_drive',
  subject: 'Cloud Computing',
  description: 'Vriddhi assessment team pattern',
  instructions: 'No tab switching',
  cohorts: [{ branch: 'CSE', batch: '2023' }],
  delivery: defaultDeliverySettings(),
  sections: [sectionWithQuestions],
  testStatus: 'ready',
  scope: 'platform',
  collegeId: 'platform',
  createdBy: 'vriddhi_team',
  createdByName: 'Vriddhi Assessments',
}

test('duplicating a platform template hands a ready college draft to the faculty', () => {
  const copy = duplicateTemplate(platformTemplate, {
    collegeId: 'college_9',
    createdBy: 'uid_42',
    createdByName: 'Prof. R',
  })
  assert.equal(copy.title, 'Cloud Computing — Technical MCQ (copy)')
  assert.equal(copy.testCode, 'VQ-CLOUD-01-COPY')
  assert.equal(copy.scope, 'college')
  assert.equal(copy.collegeId, 'college_9')
  assert.equal(copy.createdBy, 'uid_42')
  // Questions ride along (embedded), so the copy is schedulable immediately.
  assert.equal(copy.sections[0].questions.length, 2)
  assert.equal(copy.testStatus, 'ready')
  // Provenance is recorded; cohorts are NOT inherited — they are the copying
  // college's decision.
  assert.deepEqual(copy.source, {
    kind: 'platform_template',
    refId: 'tpl_1',
    refCode: 'VQ-CLOUD-01',
    refTitle: 'Cloud Computing — Technical MCQ',
  })
  assert.deepEqual(copy.cohorts, [])
  // Section ids are regenerated so the copy and the original never collide.
  assert.notEqual(copy.sections[0].id, platformTemplate.sections[0].id)
})

test('duplicating own test records a plain duplicate and respects overrides', () => {
  const own: TestTemplate = { ...platformTemplate, id: 'p1', scope: 'college', collegeId: 'college_9' }
  const copy = duplicateTemplate(own, {
    title: 'DBMS IAT-2',
    testCode: 'cse dbms iat2',
    collegeId: 'college_9',
    createdBy: 'uid_42',
    createdByName: 'Prof. R',
  })
  assert.equal(copy.title, 'DBMS IAT-2')
  assert.equal(copy.testCode, 'CSE-DBMS-IAT2')
  assert.equal(copy.source?.kind, 'duplicate')
})

test('display helpers', () => {
  assert.equal(cohortLabel({ program: 'B.E.', branch: 'CSE', batch: '2023', section: 'A' }), 'B.E. · CSE · 2023 · Sec A')
  assert.equal(cohortLabel({}), 'All students')
  assert.equal(sectionTypeIsAutoGraded('mcq'), true)
  assert.equal(sectionTypeIsAutoGraded('descriptive'), false)
  assert.equal(sectionTypeIsAutoGraded('coding'), false)
})
