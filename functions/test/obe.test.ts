// functions/test/obe.test.ts
// Slice 2: the OBE write door. Validation must reject malformed mappings
// before they can poison SAR evidence, and the server compute must stay
// formula-identical to the Slice 1 browser engine.
//
// PARITY CONTRACT: the worked example below pins the SAME hand-verified
// numbers as src/shared/utils/obeAttainment.test.ts (combined 2.9/1.2,
// PO1 2.48, PO2 2.9, PSO1 1.2). If either side drifts, one suite goes red.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeIndirectFromSurveys,
  computeObeCourseAttainment,
  defaultObeRules,
  obeMappingDocId,
  validateObeMappingDoc,
  validateObeScores,
} from '../src/obe'

function validMapping(): Record<string, unknown> {
  return {
    framework: 'NBA-GAPC-v4.0',
    courseCode: 'CS301',
    courseTitle: 'Data Structures',
    academicYear: '2025-26',
    term: 'Odd',
    programId: 'BE-CSE',
    branch: 'Computer Science',
    cos: [
      { code: 'CO1', statement: 'Apply sorting algorithms.', bloomLevel: 'L3' },
      { code: 'CO2', statement: 'Analyse tree traversals.', bloomLevel: 'L4' },
    ],
    mapping: { CO1: { PO1: 3, PO2: 2 }, CO2: { PO1: 1, PSO1: 3 } },
    targets: { PO1: 2.0, PO2: 2.0, PSO1: 2.0 },
    coTargets: { CO1: 2.0, CO2: 2.0 },
  }
}

function studentScores(above: number, total: number, co: string) {
  return Array.from({ length: total }, (_, i) => ({
    studentId: `S${i + 1}`,
    coScores: { [co]: i < above ? { obtained: 8, max: 10 } : { obtained: 4, max: 10 } },
  }))
}

describe('obe mapping validation', () => {
  it('accepts a complete mapping and normalises codes', () => {
    const mapping = validateObeMappingDoc({ ...validMapping(), courseCode: 'cs301', term: ' odd ' })
    assert.equal(mapping.courseCode, 'CS301')
    assert.equal(mapping.cos.length, 2)
    assert.deepEqual(mapping.mapping.CO1, { PO1: 3, PO2: 2 })
  })

  it('rejects a missing CO row', () => {
    assert.throws(() => validateObeMappingDoc({ ...validMapping(), mapping: { CO1: { PO1: 3 } } }), /CO2/)
  })

  it('rejects correlations outside 1–3', () => {
    assert.throws(
      () => validateObeMappingDoc({ ...validMapping(), mapping: { CO1: { PO1: 5 }, CO2: { PO1: 1 } } }),
      /correlation must be 1, 2 or 3/,
    )
  })

  it('rejects PO12 (retired 12-PO framework) and garbage codes', () => {
    assert.throws(
      () => validateObeMappingDoc({ ...validMapping(), mapping: { CO1: { PO12: 3 }, CO2: { PO1: 1 } } }),
      /PO1–PO11/,
    )
    assert.throws(
      () => validateObeMappingDoc({ ...validMapping(), mapping: { CO1: { XX1: 3 }, CO2: { PO1: 1 } } }),
      /must look like PO1 or PSO2/,
    )
  })

  it('rejects duplicate COs, bad Bloom and out-of-range targets', () => {
    const dup = validMapping()
    dup.cos = [
      { code: 'CO1', statement: 'One.' },
      { code: 'co1', statement: 'Two.' },
    ]
    assert.throws(() => validateObeMappingDoc(dup), /Duplicate CO/)
    const bloom = validMapping()
    bloom.cos = [{ code: 'CO1', statement: 'One.', bloomLevel: 'L9' }]
    assert.throws(() => validateObeMappingDoc(bloom), /L1–L6/)
    assert.throws(() => validateObeMappingDoc({ ...validMapping(), targets: { PO1: 9 } }), /0–3/)
  })

  it('rejects a wrong framework and an empty CO list', () => {
    assert.throws(() => validateObeMappingDoc({ ...validMapping(), framework: 'NBA-OLD' }), /NBA-GAPC-v4.0/)
    assert.throws(() => validateObeMappingDoc({ ...validMapping(), cos: [] }), /At least one course outcome/)
  })

  it('builds deterministic, collision-safe doc ids', () => {
    assert.equal(obeMappingDocId('c1', 'CS301', '2025-26', 'Odd'), 'C1_CS301_2025-26_ODD')
    assert.equal(obeMappingDocId('c1', 'CS 301', '2025-26', ''), 'C1_CS-301_2025-26_TERM')
  })

  it('partial mode saves half-filled drafts but still polices filled rows', () => {
    const draft = validateObeMappingDoc(
      { framework: 'NBA-GAPC-v4.0', courseCode: 'CS301', academicYear: '2025-26' },
      { allowPartial: true },
    )
    assert.equal(draft.courseCode, 'CS301')
    assert.deepEqual(draft.cos, [])
    const half = validateObeMappingDoc(
      {
        framework: 'NBA-GAPC-v4.0',
        courseCode: 'CS301',
        academicYear: '2025-26',
        cos: [{ code: 'CO1', statement: 'Apply sorting.' }],
      },
      { allowPartial: true },
    )
    assert.deepEqual(half.mapping, {})
    // …but a filled row with a bad correlation is rejected even in drafts.
    assert.throws(
      () =>
        validateObeMappingDoc(
          {
            framework: 'NBA-GAPC-v4.0',
            courseCode: 'CS301',
            academicYear: '2025-26',
            cos: [{ code: 'CO1', statement: 'Apply sorting.' }],
            mapping: { CO1: { PO1: 9 } },
          },
          { allowPartial: true },
        ),
      /correlation must be 1, 2 or 3/,
    )
    // …and strict mode still demands completeness.
    assert.throws(
      () =>
        validateObeMappingDoc({
          framework: 'NBA-GAPC-v4.0',
          courseCode: 'CS301',
          academicYear: '2025-26',
          cos: [{ code: 'CO1', statement: 'Apply sorting.' }],
          mapping: {},
        }),
      /has no PO\/PSO mapping/,
    )
  })
})

describe('obe score validation', () => {
  it('clamps over-max marks like the browser engine', () => {
    const rows = validateObeScores(
      [{ studentId: 'S1', coScores: { CO1: { obtained: 99, max: 10 } } }],
      ['CO1'],
    )
    assert.deepEqual(rows[0].coScores, { CO1: { obtained: 10, max: 10 } })
  })

  it('rejects unknown COs, bad numbers and empty payloads', () => {
    assert.throws(() => validateObeScores([{ studentId: 'S1', coScores: { CO9: { obtained: 1, max: 2 } } }], ['CO1']), /not a CO/)
    assert.throws(() => validateObeScores([{ studentId: 'S1', coScores: { CO1: { obtained: -1, max: 10 } } }], ['CO1']), /obtained/)
    assert.throws(() => validateObeScores([], ['CO1']), /non-empty/)
  })
})

describe('obe server compute (parity with Slice 1)', () => {
  it('reproduces the hand-verified worked example', () => {
    const scores = [
      ...studentScores(8, 10, 'CO1').map((s, i) => ({
        studentId: s.studentId,
        coScores: {
          CO1: s.coScores.CO1,
          // CO2: first 5 clear (8/10), rest 4/10 — 50% → level 1.
          CO2: i < 5 ? { obtained: 8, max: 10 } : { obtained: 4, max: 10 },
        },
      })),
    ]
    const { coResults, outcomes } = computeObeCourseAttainment({
      scores,
      mapping: { CO1: { PO1: 3, PO2: 2 }, CO2: { PO1: 1, PSO1: 3 } },
      indirect: { CO1: 2.5, CO2: 2.0 },
      rules: defaultObeRules(),
    })
    assert.deepEqual(
      coResults.map((c) => [c.co, c.direct, c.combined]),
      [
        ['CO1', 3, 2.9],
        ['CO2', 1, 1.2],
      ],
    )
    assert.deepEqual(outcomes, { PO1: 2.48, PO2: 2.9, PSO1: 1.2 })
  })

  it('computes indirect attainment from raw surveys', () => {
    assert.deepEqual(
      computeIndirectFromSurveys([
        { co: 'CO1', score: 4, maxScore: 5 },
        { co: 'CO1', score: 5, maxScore: 5 },
        { co: 'CO2', score: 2, maxScore: 3 },
      ]),
      { CO1: 2.7, CO2: 2 },
    )
  })

  it('ships NBA-standard default rules', () => {
    assert.deepEqual(defaultObeRules(), {
      coThresholdPercentage: 60,
      levels: [
        { level: 3, minPercentStudents: 70 },
        { level: 2, minPercentStudents: 60 },
        { level: 1, minPercentStudents: 50 },
      ],
      directWeight: 0.8,
      indirectWeight: 0.2,
    })
  })
})
