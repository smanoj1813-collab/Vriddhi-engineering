// functions/test/schemePacks.test.ts
// Validate G1 pack authoring — the single write door into the multi-university
// compliance engine: a malformed pack would silently corrupt result imports,
// hall-ticket blocking and every compliance number.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateSchemePackDoc,
  PRESET_SCHEME_CODES,
  selectSchemePackAssignment,
  normalizeSchemePackAssignmentScope,
  type StoredSchemePackAssignment,
} from '../src/schemePacks'

function validPack(): Record<string, unknown> {
  return {
    code: 'MYSU_NEP_2023',
    name: 'University of Mysore — NEP 2023',
    universityName: 'University of Mysore',
    schemeName: 'NEP 2023',
    applicableProgrammes: ['BA', 'B.Com'],
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
    semesterEndExam: { defaultMaxMarks: 60, durationMinutes: 180, passPercentage: 35 },
    passCriteria: {
      aggregatePassPercentage: 40,
      minimumInternalPercentage: 0,
      requireSemesterEndPass: true,
    },
    gradeTable: [
      { grade: 'O', gradePoint: 10, minPercentage: 90, description: 'Outstanding' },
      { grade: 'A', gradePoint: 8, minPercentage: 70, description: 'Very Good' },
      { grade: 'P', gradePoint: 4, minPercentage: 35, description: 'Pass' },
      { grade: 'F', gradePoint: 0, minPercentage: 0, description: 'Fail' },
    ],
    mediums: ['English', 'Kannada'],
    status: 'active',
  }
}

describe('validateSchemePackDoc', () => {
  it('accepts a well-formed pack and normalises it', () => {
    const pack = validateSchemePackDoc(validPack())
    assert.equal(pack.code, 'MYSU_NEP_2023')
    assert.equal(pack.internalAssessment.totalMarks, 40)
    // grades come back sorted for the engine's descending probe
    assert.deepEqual(
      pack.gradeTable.map((g) => g.minPercentage),
      [90, 70, 35, 0],
    )
  })

  it('rejects an inverted attendance slab', () => {
    const raw = validPack()
    ;(raw.attendance as Record<string, unknown>).marksSlabs = [{ min: 90, max: 80, marks: 2, label: 'x' }]
    assert.throws(() => validateSchemePackDoc(raw), /min must be/)
  })

  it('rejects slabs floating far above the eligibility floor', () => {
    const raw = validPack()
    ;(raw.attendance as Record<string, unknown>).marksSlabs = [{ min: 95, max: 100, marks: 2, label: 'x' }]
    assert.throws(() => validateSchemePackDoc(raw), /minimumPercentage/)
  })

  it('rejects IA components that do not add up to totalMarks', () => {
    const raw = validPack()
    const ia = raw.internalAssessment as Record<string, unknown>
    ia.assignmentMaxMarks = 10 // 20 + 5 + 10 = 35 ≠ 40
    assert.throws(() => validateSchemePackDoc(raw), /add up to totalMarks/)
  })

  it('rejects bestOf exceeding the number of tests', () => {
    const raw = validPack()
    const ia = raw.internalAssessment as Record<string, unknown>
    ia.test = { count: 2, maxMarksEach: 40, bestOf: 3, weightInTotal: 20 }
    assert.throws(() => validateSchemePackDoc(raw), /bestOf/)
  })

  it('rejects malformed codes and over-long grade tables', () => {
    const raw = validPack()
    raw.code = 'bad code!'
    assert.throws(() => validateSchemePackDoc(raw), /code/)
    const raw2 = validPack()
    raw2.gradeTable = [{ grade: 'O', gradePoint: 10, minPercentage: 90, description: '' }]
    assert.throws(() => validateSchemePackDoc(raw2), /gradeTable/)
  })

  it('keeps the preset codes reserved (sync-check with client presets)', () => {
    assert.deepEqual(PRESET_SCHEME_CODES, [
      'BCU_SEP_2024',
      'KUD_NEP_CBAE',
      'GENERIC_NEP_2020',
      'VTU_2022_BE_BTECH',
      'VTU_BE_2022_5050',
      'AUTONOMOUS_ENGINEERING_5050',
    ])
  })

  it('defaults status to active and trims notes', () => {
    const raw = validPack()
    raw.status = 'nonsense'
    raw.sourceNote = '  verified 2026  '
    const pack = validateSchemePackDoc(raw)
    assert.equal(pack.status, 'active')
    assert.equal(pack.sourceNote, 'verified 2026')
  })

  it('preserves and validates engineering fields including batch-specific conversion', () => {
    const raw = validPack()
    raw.semesterEndExam = {
      defaultMaxMarks: 50,
      scaleFrom: 100,
      durationMinutes: 180,
      passPercentage: 35,
    }
    raw.engineering = {
      courseTypes: {
        _default: { internal: 50, external: 50 },
        lab: { internal: 50, external: 50, heads: ['practical'] },
      },
      grading: { method: 'absolute' },
      percentageConversion: {
        expression: 'CGPA * 10',
        batchRules: [{ admissionYears: [2015, 2017, 2018], expression: '(CGPA - 0.75) * 10' }],
      },
      paperTemplate: { code: 'VTU_10Q_5MODULES_20M', modules: 5, questionsPerModule: 2, marksPerFullQuestion: 20, rawTotal: 100, durationMinutes: 180 },
      attainment: { enabled: true, levels: [{ level: 3, minPercentStudents: 80 }] },
    }
    const pack = validateSchemePackDoc(raw)
    assert.equal(pack.semesterEndExam.scaleFrom, 100)
    assert.equal(pack.engineering?.courseTypes?._default.external, 50)
    assert.equal(pack.engineering?.percentageConversion?.batchRules?.[0]?.admissionYears?.[0], 2015)
    assert.equal(pack.engineering?.paperTemplate?.modules, 5)
    assert.equal(pack.engineering?.attainment?.enabled, true)
  })

  it('rejects executable or otherwise unsupported CGPA formulas', () => {
    const raw = validPack()
    raw.engineering = { percentageConversion: { expression: 'CGPA * 10; globalThis.pwned = true' } }
    assert.throws(() => validateSchemePackDoc(raw), /supported CGPA arithmetic formula/)
  })
})

describe('normalizeSchemePackAssignmentScope', () => {
  it('collapses whitespace in programme, branch and batch identifiers', () => {
    assert.deepEqual(
      normalizeSchemePackAssignmentScope({
        programId: '  B.E.   ',
        branchId: 'Computer   Science   Engineering',
        admissionBatch: '2022-2026',
      }),
      { programId: 'B.E.', branchId: 'Computer Science Engineering', admissionBatch: '2022-2026' },
    )
  })
})

describe('selectSchemePackAssignment', () => {
  const rows: StoredSchemePackAssignment[] = [
    { schemePackId: 'PROGRAMME', programId: 'B.E.' },
    { schemePackId: 'CSE_2022', programId: 'B.E.', branchId: 'Computer Science', admissionBatch: '2022-2026' },
  ]

  it('chooses a cohort override before the programme and otherwise falls back to programme', () => {
    assert.equal(selectSchemePackAssignment(rows, {
      programId: 'b.e.', branchId: 'computer science', admissionBatch: '2022-2026',
    })?.schemePackId, 'CSE_2022')
    assert.equal(selectSchemePackAssignment(rows, { programId: 'B.E.', branchId: 'Electrical', admissionBatch: '2022-2026' })?.schemePackId, 'PROGRAMME')
    assert.equal(selectSchemePackAssignment(rows, { programId: 'MCA' }), null)
  })
})
