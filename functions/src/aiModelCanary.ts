import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/aiModelCanary.ts
//
// Clause A2 of docs/HANDOFF_REVIEW_2026-09-25.md: "Model lifecycle is a dated
// constant, not a permanent one."
//
// The 1.5 Flash model was shut down on 29 Sep 2025 and production kept calling
// it for a year. The tier lists in config/aiModels.ts now carry shutdown dates,
// but a date in a file only helps if somebody looks at it. This daily function
// looks at it for us: it asks each tier's FIRST model for one short reply and
// writes the outcome to `platform/aiModelCanary`.
//
// What each outcome means:
//   ok            — the tier's primary model is alive.
//   unavailable   — the model id itself is gone/refused: the tier will already
//                   be falling through to its next entry, but the DATE has
//                   arrived and the list must be re-pointed. Logged as an error.
//   error         — a transient provider problem (quota, network); the model is
//                   not necessarily dead, so this does not page anyone.
//
// The document is server-only (default-deny rules); it exists for Cloud
// Logging alerts and for whoever is on support that week. Item 2.4 will surface
// it on the superadmin console together with `platform/stats`.

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions'
import * as admin from 'firebase-admin'

import { geminiClient } from './config/aiProviders'
import { describeModelLifecycle, geminiModelsFor, isModelUnavailableError, type AiTier } from './config/aiModels'

const TIERS: AiTier[] = ['fast', 'quality']
const CANARY_COLLECTION = 'platform'
const CANARY_DOC = 'aiModelCanary'

export interface CanaryTierResult {
  tier: AiTier
  model: string
  ok: boolean
  /** True when the model id itself was refused (fix the tier), false for a transient failure. */
  unavailable: boolean
  latencyMs: number
  error?: string
}

/** Pure shape of the document the canary writes — unit-tested. */
export function buildCanaryDoc(results: CanaryTierResult[], checkedAt: string): Record<string, unknown> {
  const tiers: Record<string, unknown> = {}
  for (const result of results) {
    tiers[result.tier] = {
      model: result.model,
      ok: result.ok,
      unavailable: result.unavailable,
      latencyMs: result.latencyMs,
      ...(result.error ? { error: result.error.slice(0, 400) } : {}),
    }
  }
  return {
    checkedAt,
    // Which tier needs attention first — read by the console/alert.
    degradedTiers: results.filter((result) => !result.ok).map((result) => result.tier),
    tiers,
    lifecycle: describeModelLifecycle(),
  }
}

export const aiModelCanary = onSchedule(
  {
    region: 'asia-south1',
    schedule: 'every day 06:30',
    timeZone: 'Asia/Kolkata',
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
  },
  async () => {
    const client = geminiClient()
    if (!client) {
      logger.warn('[AiModelCanary] GEMINI_API_KEY is not configured — canary skipped')
      return
    }

    const results: CanaryTierResult[] = []
    for (const tier of TIERS) {
      const model = geminiModelsFor(tier)[0]
      const startedAt = Date.now()
      try {
        const response = await client.getGenerativeModel({ model }).generateContent('Reply with the single word: ok')
        const reply = (response.response.text() || '').trim().slice(0, 40)
        results.push({ tier, model, ok: true, unavailable: false, latencyMs: Date.now() - startedAt })
        logger.info('[AiModelCanary] tier answered', { tier, model, reply, latencyMs: Date.now() - startedAt })
      } catch (err) {
        const unavailable = isModelUnavailableError(err)
        const message = String((err as Error)?.message || err)
        results.push({ tier, model, ok: false, unavailable, latencyMs: Date.now() - startedAt, error: message })
        // A retired model is an outage waiting for its next request: error level.
        // A transient failure is worth knowing about, but it is not an outage.
        if (unavailable) {
          logger.error('[AiModelCanary] TIER MODEL IS GONE — re-point the tier', {
            tier,
            model,
            hint: `set GEMINI_MODEL_${tier.toUpperCase()} or edit functions/src/config/aiModels.ts`,
            error: message,
          })
        } else {
          logger.warn('[AiModelCanary] tier model did not answer (transient?)', { tier, model, error: message })
        }
      }
    }

    const checkedAt = new Date().toISOString()
    await getFirestore(admin.app(), 'default').collection(CANARY_COLLECTION).doc(CANARY_DOC).set(buildCanaryDoc(results, checkedAt))
    logger.info('[AiModelCanary] report written', {
      checkedAt,
      degraded: results.filter((result) => !result.ok).map((result) => result.tier),
    })
  },
)
