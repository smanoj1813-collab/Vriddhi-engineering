// functions/test/academicInsightsMatch.test.ts
//
// Generated class sessions carry `subjectCode` and `subject` but no
// `courseCode` or `curriculumId`. Before this matcher handled those fields,
// every generated class went unmatched and each semester showed 0/0 classes
// in Curriculum Insights, even though the timetable had slots.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { findSubjectForSession } from '../src/academicInsights'
import type { SubjectInsight } from '../src/academicInsights'

function subject(overrides: Partial<SubjectInsight> = {}): SubjectInsight {
  return {
    curriculumId: 'cur-1',
    courseName: 'Applied Engineering Physics',
    courseCode: 'CSE-BPHY102',
    facultyId: 'fac-1',
    facultyName: 'Gangadhar',
    branch: 'CSE',
    batch: '2026',
    semester: 1,
    ...overrides,
  } as unknown as SubjectInsight
}

function subjectsOf(...items: SubjectInsight[]) {
  return new Map(items.map((s, i) => [`k${i}`, s]))
}

const base = { id: 's1', date: '2026-11-10', status: 'completed' }

describe('findSubjectForSession (generated sessions)', () => {
  it('matches a generated session by subjectCode', () => {
    const subs = subjectsOf(subject())
    const found = findSubjectForSession(subs, {
      ...base,
      facultyId: 'fac-1',
      courseCode: 'CSE-BPHY102', // what the matcher reads from subjectCode
      subject: 'Applied Engineering Physics',
      semester: 1,
    })
    assert.equal(found?.courseCode, 'CSE-BPHY102')
  })

  it('falls back to the subject name for the same faculty and semester', () => {
    const subs = subjectsOf(subject({ courseCode: '' }))
    const found = findSubjectForSession(subs, {
      ...base,
      facultyId: 'fac-1',
      subject: 'applied engineering physics',
      semester: 1,
    })
    assert.ok(found, 'name match expected')
  })

  it('does not merge a subject name across semesters', () => {
    const subs = subjectsOf(subject({ courseCode: '', semester: 1 }))
    const found = findSubjectForSession(subs, {
      ...base,
      facultyId: 'fac-1',
      subject: 'Applied Engineering Physics',
      semester: 3,
    })
    assert.equal(found, null)
  })

  it('does not match a name taught by a different faculty', () => {
    const subs = subjectsOf(subject({ courseCode: '', facultyId: 'fac-1' }))
    const found = findSubjectForSession(subs, {
      ...base,
      facultyId: 'fac-2',
      subject: 'Applied Engineering Physics',
      semester: 1,
    })
    assert.equal(found, null)
  })

  it('still matches by curriculumId first', () => {
    const subs = subjectsOf(subject({ curriculumId: 'cur-9', courseCode: '' }))
    const found = findSubjectForSession(subs, {
      ...base,
      facultyId: 'fac-1',
      curriculumId: 'cur-9',
    })
    assert.equal(found?.curriculumId, 'cur-9')
  })
})
