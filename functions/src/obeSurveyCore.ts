// functions/src/obeSurveyCore.ts
// Pure half of the indirect-attainment survey slice: validation, sanitising and
// folding. No Firestore, no admin SDK, no imports from obe.ts — which is what
// lets `obe.ts` fold a captured round inside computeObeAttainment without a
// circular import, and lets the unit suite exercise every rule below directly.

import { HttpsError } from 'firebase-functions/v2/https'

const round2 = (n: number): number => Math.round((n + 1e-9) * 100) / 100

// ═════════════════════════════════════════════════════════════════════════════
// Pure validation + folding (unit tested, no Firestore)
// ═════════════════════════════════════════════════════════════════════════════

export const SURVEY_AUDIENCES = ['course-exit', 'program-exit', 'alumni', 'employer'] as const
export type SurveyAudience = (typeof SURVEY_AUDIENCES)[number]

export const SURVEY_SCALE_MIN = 2
export const SURVEY_SCALE_MAX = 10
export const MAX_SURVEY_COS = 12
export const MAX_SURVEY_RESPONSES = 5000
export const MAX_SURVEY_PROMPT = 300

export interface ObeSurveyValidatedCo {
  code: string
  statement?: string
}

export interface ObeSurveyValidated {
  audience: SurveyAudience
  scaleMax: number
  prompt?: string
}

function boundedString(value: unknown, field: string, maximum: number, required = true): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) {
    if (required) throw new HttpsError('invalid-argument', `${field} is required`)
    return ''
  }
  if (text.length > maximum) {
    throw new HttpsError('invalid-argument', `${field} must be at most ${maximum} characters`)
  }
  return text
}

/** Validates the survey-round payload (who is being asked, on what scale). */
export function validateObeSurveyRequest(raw: unknown): ObeSurveyValidated {
  const source = (raw ?? {}) as Record<string, unknown>
  const audience = boundedString(source.audience, 'audience', 40).toLowerCase() as SurveyAudience
  if (!SURVEY_AUDIENCES.includes(audience)) {
    throw new HttpsError('invalid-argument', 'audience must be course-exit, program-exit, alumni or employer')
  }
  const scaleRaw = source.scaleMax === undefined || source.scaleMax === null ? 5 : Number(source.scaleMax)
  if (!Number.isFinite(scaleRaw) || !Number.isInteger(scaleRaw) || scaleRaw < SURVEY_SCALE_MIN || scaleRaw > SURVEY_SCALE_MAX) {
    throw new HttpsError(
      'invalid-argument',
      `scaleMax must be a whole number between ${SURVEY_SCALE_MIN} and ${SURVEY_SCALE_MAX}`,
    )
  }
  const prompt = boundedString(source.prompt, 'prompt', MAX_SURVEY_PROMPT, false)
  return { audience, scaleMax: scaleRaw, ...(prompt ? { prompt } : {}) }
}

/**
 * Freezes the mapping's CO list onto the round. Empty statements are allowed
 * (a draft mapping can carry codes only) but the list itself must exist: a
 * survey with no questions is worse than no survey.
 */
export function buildSurveyCos(cos: Array<{ code?: unknown; statement?: unknown }>): ObeSurveyValidatedCo[] {
  const built: ObeSurveyValidatedCo[] = []
  for (const entry of cos) {
    const code = String(entry?.code ?? '').trim().toUpperCase()
    if (!code) continue
    if (built.some((co) => co.code === code)) {
      throw new HttpsError('failed-precondition', `Duplicate CO ${code} on the mapping — fix the mapping first`)
    }
    const statement = String(entry?.statement ?? '').trim()
    built.push({ code, ...(statement ? { statement: statement.slice(0, 500) } : {}) })
  }
  if (built.length === 0) {
    throw new HttpsError('failed-precondition', 'This mapping has no course outcomes to survey')
  }
  if (built.length > MAX_SURVEY_COS) {
    throw new HttpsError('invalid-argument', `A survey can carry at most ${MAX_SURVEY_COS} course outcomes`)
  }
  return built
}

export interface ObeSurveyResponseInput {
  uid?: unknown
  scores?: unknown
  scaleMax?: unknown
}

export interface ObeSanitizedResponse {
  uid: string
  scores: Record<string, number>
  dropped: string[]
}

/**
 * Clamps one stored response to the round's own CO list and scale.
 *
 * A client can write anything into the scores map (rules pin the identity, not
 * the numbers), so every rating is re-checked here: unknown COs are dropped,
 * non-integers and out-of-range values are dropped rather than rounded — a
 * rating of 0 means "not answered", never a bottom score, and inventing a 1
 * out of it would drag a CO's mean down in evidence.
 */
export function sanitizeSurveyResponse(
  response: ObeSurveyResponseInput,
  coCodes: string[],
  scaleMax: number,
): ObeSanitizedResponse {
  const uid = String(response?.uid ?? '').trim()
  const scoresRaw = (response?.scores ?? {}) as Record<string, unknown>
  const allowed = new Set(coCodes.map((code) => code.toUpperCase()))
  const scores: Record<string, number> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(scoresRaw)) {
    const co = key.trim().toUpperCase()
    if (!allowed.has(co)) {
      dropped.push(co || '(blank)')
      continue
    }
    const numeric = Number(value)
    // 0 = skipped; out-of-scale or fractional = corrupt. None may become a
    // rating: a Likert answer is a whole number inside the round's scale.
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 1 || numeric > scaleMax) {
      if (numeric !== 0) dropped.push(co)
      continue
    }
    scores[co] = numeric
  }
  return { uid, scores, dropped }
}

export interface ObeSurveyCoSummary {
  co: string
  mean: number
  count: number
  scaleMax: number
  level: number
}

export interface ObeSurveyFold {
  responseCount: number
  completeCount: number
  coSummaries: ObeSurveyCoSummary[]
  surveys: { co: string; score: number; maxScore: number }[]
}

/**
 * Folds raw responses onto the 0–3 scale, one summary row per CO.
 *
 * Feeding the per-CO MEAN into the blend is identical to feeding every
 * individual response, because computeIndirectFromSurveys averages — so a round
 * of 40 responses and its collapsed 6-row summary produce the same level. The
 * parity test in test/obeSurvey.test.ts pins that identity against
 * computeIndirectFromSurveys, the same way the direct side does.
 *
 * `completeCount` is reported separately: a CO answered by 3 of 40 respondents
 * must not be quotable in a SAR as if 40 people agreed.
 */
export function foldSurveyResponses(args: {
  responses: ObeSurveyResponseInput[]
  coCodes: string[]
  scaleMax: number
}): ObeSurveyFold {
  const { coCodes, scaleMax } = args
  const sanitized = args.responses
    .slice(0, MAX_SURVEY_RESPONSES)
    .map((response) => sanitizeSurveyResponse(response, coCodes, scaleMax))

  const coSummaries: ObeSurveyCoSummary[] = []
  for (const co of coCodes) {
    const code = co.toUpperCase()
    let total = 0
    let count = 0
    for (const response of sanitized) {
      const score = response.scores[code]
      if (score === undefined) continue
      total += score
      count += 1
    }
    if (count === 0) continue
    const mean = round2(total / count)
    coSummaries.push({ co: code, mean, count, scaleMax, level: round2((mean / scaleMax) * 3) })
  }

  const completeCount = sanitized.filter(
    (response) => coCodes.length > 0 && coCodes.every((co) => response.scores[co.toUpperCase()] !== undefined),
  ).length

  return {
    responseCount: sanitized.filter((response) => Object.keys(response.scores).length > 0).length,
    completeCount,
    coSummaries,
    surveys: coSummaries.map((summary) => ({ co: summary.co, score: summary.mean, maxScore: scaleMax })),
  }
}

