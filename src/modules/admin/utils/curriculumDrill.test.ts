// src/modules/admin/utils/curriculumDrill.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { SubjectInsight } from '../api/academicInsightsApi'
import {
  NO_BRANCH_KEY,
  batchOf,
  branchKeyOf,
  displayLabel,
  groupBy,
  rollup,
  sortByLabel,
  subjectKeyOf,
  academicYearToDate,
} from './curriculumDrill'

function subject(over: Partial<SubjectInsight>): SubjectInsight {
  return {
    curriculumId: 'c1', courseName: 'Course', courseCode: 'C101', facultyId: 'f1', facultyName: 'Faculty',
    branch: 'CSE', batch: '2024', semester: 3, credits: 3,
    sessionsTotal: 10, sessionsCompleted: 5, sessionsScheduled: 0, sessionsCancelled: 0, hoursDelivered: 5,
    attendancePct: 0, attendanceMarked: 0, attendancePresent: 0,
    assignmentsTotal: 0, submissionsExpected: 0, submissionsSubmitted: 0, submissionsLate: 0,
    submissionsGraded: 0, submissionsMissing: 0, completionPct: 0,
    avgScore: null, scoredCount: 0,
    ...over,
  }
}

describe('branch identity for drill grouping', () => {
  it('treats short code and B.E / B.Tech wrappers as one branch', () => {
    const a = branchKeyOf(subject({ branch: 'CSE' }))
    assert.equal(a, branchKeyOf(subject({ branch: 'B.E (CSE)' })))
    assert.equal(a, branchKeyOf(subject({ branch: 'B.Tech (CSE)' })))
  })

  it('keeps BCA specialisations as separate branches', () => {
    assert.notEqual(
      branchKeyOf(subject({ branch: 'BCA (Regular)' })),
      branchKeyOf(subject({ branch: 'BCA (AI & Data Science)' })),
    )
  })

  it('puts subjects with no branch under the no-branch key', () => {
    assert.equal(branchKeyOf(subject({ branch: '' })), NO_BRANCH_KEY)
  })

  it('labels a merged branch with the spelling most subjects use', () => {
    assert.equal(displayLabel(['CSE', 'B.E (CSE)', 'B.E (CSE)'], 'x'), 'B.E (CSE)')
    assert.equal(displayLabel([], 'No branch'), 'No branch')
  })
})

describe('batch and subject keys', () => {
  it('uses a visible label when batch is blank', () => {
    assert.equal(batchOf(subject({ batch: '  ' })), 'No batch')
    assert.equal(batchOf(subject({ batch: '2024' })), '2024')
  })

  it('keys a subject by semester and curriculum id', () => {
    assert.equal(subjectKeyOf(subject({ semester: 3, curriculumId: 'abc' })), '3__abc')
  })
})

describe('rollup', () => {
  it('weights attendance by marked counts, not by averaging percentages', () => {
    const r = rollup([
      subject({ attendanceMarked: 10, attendancePresent: 10 }),
      subject({ curriculumId: 'c2', attendanceMarked: 30, attendancePresent: 0 }),
    ])
    assert.equal(r.attendancePct, 25)
  })

  it('weights the average score by the number graded', () => {
    const r = rollup([
      subject({ avgScore: 80, scoredCount: 1 }),
      subject({ curriculumId: 'c2', avgScore: 40, scoredCount: 3 }),
    ])
    assert.equal(r.avgScore, 50)
  })

  it('ignores subjects with nothing graded when averaging scores', () => {
    const r = rollup([subject({ avgScore: null, scoredCount: 0 }), subject({ curriculumId: 'c2', avgScore: 70, scoredCount: 2 })])
    assert.equal(r.avgScore, 70)
  })

  it('returns null when there is nothing to divide by', () => {
    const r = rollup([subject({})])
    assert.equal(r.attendancePct, null)
    assert.equal(r.completionPct, null)
    assert.equal(r.avgScore, null)
  })

  it('counts distinct faculty and sums classes', () => {
    const r = rollup([
      subject({ facultyId: 'f1', sessionsCompleted: 4, sessionsTotal: 10 }),
      subject({ curriculumId: 'c2', facultyId: 'f1', sessionsCompleted: 6, sessionsTotal: 10 }),
      subject({ curriculumId: 'c3', facultyId: 'f2', sessionsCompleted: 0, sessionsTotal: 0 }),
    ])
    assert.equal(r.faculty, 2)
    assert.equal(r.sessionsCompleted, 10)
    assert.equal(r.sessionsTotal, 20)
    assert.equal(r.subjects, 3)
  })
})

describe('grouping', () => {
  it('groups in memory and keeps each subject in exactly one group', () => {
    const list = [
      subject({ branch: 'CSE', batch: '2024' }),
      subject({ curriculumId: 'c2', branch: 'B.E (CSE)', batch: '2024' }),
      subject({ curriculumId: 'c3', branch: 'ECE', batch: '2024' }),
    ]
    const groups = groupBy(list, branchKeyOf, (v) => displayLabel(v.map((s) => s.branch), 'x'))
    assert.equal(groups.length, 2)
    assert.equal(groups.reduce((n, g) => n + g.subjects.length, 0), 3)
  })

  it('sorts labels with numbers in natural order', () => {
    const groups = sortByLabel([
      { key: 'a', label: 'Semester 10', subjects: [] },
      { key: 'b', label: 'Semester 2', subjects: [] },
    ])
    assert.deepEqual(groups.map((g) => g.label), ['Semester 2', 'Semester 10'])
  })
})

describe('academic year to date window', () => {
  it('starts on 1 June of the current year from June onwards', () => {
    assert.deepEqual(academicYearToDate(new Date(2026, 10, 17)), { from: '2026-06-01', to: '2026-11-17' })
    assert.deepEqual(academicYearToDate(new Date(2026, 5, 1)), { from: '2026-06-01', to: '2026-06-01' })
  })

  it('starts on the previous 1 June before June', () => {
    assert.deepEqual(academicYearToDate(new Date(2027, 1, 7)), { from: '2026-06-01', to: '2027-02-07' })
    assert.deepEqual(academicYearToDate(new Date(2027, 4, 31)), { from: '2026-06-01', to: '2027-05-31' })
  })
})
