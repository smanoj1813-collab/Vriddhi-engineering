// functions/test/obeSurvey.test.ts
// Slice 5: the indirect-attainment survey door.
//
// Two properties matter and are pinned here:
//   1. A stored response can never widen its own meaning — unknown COs, zeros,
//      fractions and out-of-scale ratings are dropped, not rounded into
//      evidence.
//   2. Folding many responses into one row per CO is level-identical to feeding
//      every raw response to the engine, which is what lets the run dialog show
//      a mean and the run record the same number (same parity contract as the
//      direct side in obe.test.ts).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeIndirectFromSurveys } from '../src/obe'
import {
  buildSurveyCos,
  foldSurveyResponses,
  sanitizeSurveyResponse,
  validateObeSurveyRequest,
} from '../src/obeSurveyCore'

function expectHttpsError(fn: () => unknown, code: string, messagePart?: string) {
  let thrown: unknown = null
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown, 'expected the call to throw')
  const https = thrown as { code?: string; message?: string }
  assert.equal(https.code, code)
  if (messagePart) assert.match(String(https.message), new RegExp(messagePart))
}

describe('obe survey request validation', () => {
  it('accepts the four SAR audiences and defaults the scale to 5', () => {
    for (const audience of ['course-exit', 'program-exit', 'alumni', 'employer']) {
      assert.deepEqual(validateObeSurveyRequest({ audience, mappingId: 'm1' }), { audience, scaleMax: 5 })
    }
  })

  it('normalises case and accepts a bounded prompt', () => {
    const validated = validateObeSurveyRequest({ audience: 'Course-Exit', scaleMax: 4, prompt: '  How well did the course meet each outcome?  ' })
    assert.equal(validated.audience, 'course-exit')
    assert.equal(validated.scaleMax, 4)
    assert.equal(validated.prompt, 'How well did the course meet each outcome?')
  })

  it('rejects an unknown audience, a fractional scale and an out-of-range scale', () => {
    expectHttpsError(() => validateObeSurveyRequest({ audience: 'students' }), 'invalid-argument', 'audience must be')
    expectHttpsError(() => validateObeSurveyRequest({ audience: 'alumni', scaleMax: 4.5 }), 'invalid-argument', 'whole number')
    expectHttpsError(() => validateObeSurveyRequest({ audience: 'alumni', scaleMax: 11 }), 'invalid-argument', 'between 2 and 10')
    expectHttpsError(() => validateObeSurveyRequest({ audience: 'alumni', scaleMax: 1 }), 'invalid-argument', 'between 2 and 10')
  })

  it('caps the prompt length so a round cannot smuggle a page of text', () => {
    expectHttpsError(
      () => validateObeSurveyRequest({ audience: 'alumni', prompt: 'x'.repeat(301) }),
      'invalid-argument',
      'at most 300 characters',
    )
  })
})

describe('obe survey CO snapshot', () => {
  it('normalises codes, keeps statements and drops blank rows', () => {
    const cos = buildSurveyCos([
      { code: 'co1', statement: 'Apply cost accounting.' },
      { code: ' CO2 ', statement: '' },
      { code: '   ' },
    ])
    assert.deepEqual(cos, [
      { code: 'CO1', statement: 'Apply cost accounting.' },
      { code: 'CO2' },
    ])
  })

  it('refuses a mapping with no COs and one with duplicates', () => {
    expectHttpsError(() => buildSurveyCos([]), 'failed-precondition', 'no course outcomes')
    expectHttpsError(() => buildSurveyCos([{ code: 'CO1' }, { code: 'co1' }]), 'failed-precondition', 'Duplicate CO CO1')
  })

  it('caps the CO list at 12, like the mapping it came from', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ code: `CO${i + 1}` }))
    expectHttpsError(() => buildSurveyCos(many), 'invalid-argument', 'at most 12')
    assert.equal(buildSurveyCos(many.slice(0, 12)).length, 12)
  })
})

describe('obe survey response sanitising', () => {
  const COS = ['CO1', 'CO2']

  it('keeps in-range ratings and reports unknown COs as dropped', () => {
    const result = sanitizeSurveyResponse({ uid: 'u1', scores: { CO1: 4, CO2: 5, CO9: 3 } }, COS, 5)
    assert.deepEqual(result.scores, { CO1: 4, CO2: 5 })
    assert.deepEqual(result.dropped, ['CO9'])
  })

  it('treats zero as skipped and drops it silently, never as a bottom rating', () => {
    const result = sanitizeSurveyResponse({ uid: 'u1', scores: { CO1: 0, CO2: 2 } }, COS, 5)
    assert.deepEqual(result.scores, { CO2: 2 })
    assert.deepEqual(result.dropped, [])
  })

  it('drops fractions, out-of-scale values and non-numbers', () => {
    const result = sanitizeSurveyResponse(
      { uid: 'u1', scores: { CO1: 4.5, CO2: 9 } },
      COS,
      5,
    )
    assert.deepEqual(result.scores, {})
    assert.deepEqual(result.dropped.sort(), ['CO1', 'CO2'])
  })

  it('survives a hostile payload shape', () => {
    assert.deepEqual(sanitizeSurveyResponse({ uid: 42, scores: null }, COS, 5), {
      uid: '42',
      scores: {},
      dropped: [],
    })
  })
})

describe('obe survey folding', () => {
  const COS = ['CO1', 'CO2']

  it('reports a mean per CO with its own denominator', () => {
    const fold = foldSurveyResponses({
      coCodes: COS,
      scaleMax: 5,
      responses: [
        { uid: 'u1', scores: { CO1: 5, CO2: 4 } },
        { uid: 'u2', scores: { CO1: 4, CO2: 4 } },
        { uid: 'u3', scores: { CO2: 3 } },
      ],
    })
    assert.equal(fold.responseCount, 3)
    assert.equal(fold.completeCount, 2)
    assert.deepEqual(fold.coSummaries, [
      { co: 'CO1', mean: 4.5, count: 2, scaleMax: 5, level: 2.7 },
      { co: 'CO2', mean: 3.67, count: 3, scaleMax: 5, level: 2.2 },
    ])
    assert.deepEqual(fold.surveys, [
      { co: 'CO1', score: 4.5, maxScore: 5 },
      { co: 'CO2', score: 3.67, maxScore: 5 },
    ])
  })

  it('collapsing responses to one row per CO does not move the level', () => {
    const responses = [
      { uid: 'u1', scores: { CO1: 5, CO2: 3 } },
      { uid: 'u2', scores: { CO1: 4, CO2: 3 } },
      { uid: 'u3', scores: { CO1: 4, CO2: 2 } },
    ]
    const rawRows = responses.flatMap((response) =>
      Object.entries(response.scores).map(([co, score]) => ({ co, score, maxScore: 5 })),
    )
    const fold = foldSurveyResponses({ coCodes: COS, scaleMax: 5, responses })
    assert.deepEqual(computeIndirectFromSurveys(fold.surveys), computeIndirectFromSurveys(rawRows))
  })

  it('counts only responses that carry at least one usable rating', () => {
    const fold = foldSurveyResponses({
      coCodes: COS,
      scaleMax: 5,
      responses: [
        { uid: 'u1', scores: { CO1: 4 } },
        { uid: 'u2', scores: {} },
        { uid: 'u3', scores: { CO1: 0, CO2: 99 } },
      ],
    })
    assert.equal(fold.responseCount, 1)
    assert.equal(fold.completeCount, 0)
    assert.equal(fold.coSummaries.length, 1)
  })

  it('omits a CO nobody answered instead of reporting it as 0', () => {
    const fold = foldSurveyResponses({ coCodes: COS, scaleMax: 5, responses: [{ uid: 'u1', scores: { CO2: 5 } }] })
    assert.deepEqual(fold.coSummaries.map((s) => s.co), ['CO2'])
    assert.deepEqual(fold.surveys.map((s) => s.co), ['CO2'])
  })

  it('handles an empty round without inventing rows', () => {
    const fold = foldSurveyResponses({ coCodes: COS, scaleMax: 5, responses: [] })
    assert.deepEqual(fold, { responseCount: 0, completeCount: 0, coSummaries: [], surveys: [] })
  })
})
