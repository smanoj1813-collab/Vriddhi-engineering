// functions/src/ai/contentEngine.ts
//
// Item 4.1 of docs/HANDOFF_OPTIMISATION_2026-09-25.md — one place where
// generated content is produced, and one place where it is cached.
//
// The economics: a study pack costs roughly ₹0.4–0.6 of Gemini output tokens
// and is asked for over and over for the same (subject, topic) — every new
// student of that subject pays again. The cache turns the second and later
// asks into a Firestore read.
//
// Two rules the design keeps:
//   1. The cache key may contain ONLY content-addressing fields (kind, subject,
//      topic, programme, language, model, prompt version). Never a student id,
//      never a name, never anything from `users/*`. A cache that keys on
//      student data would hand one student another's pack — and would store
//      personal data in a second place.
//   2. A model change or a prompt change IS a cache invalidation: both are part
//      of the hash, so nobody has to remember to clear the cache on deploy.
//
// The I/O wrapper takes its Firestore/Gemini dependencies as arguments so the
// whole flow (hit, miss, stale, generation failure, counter bookkeeping) is
// unit-testable without an emulator — see functions/test/contentEngine.test.ts.

import { createHash } from 'node:crypto'

import { FieldValue } from 'firebase-admin/firestore'

import { db } from '../config/firebase'
import { geminiClient } from '../config/aiProviders'
import {
  generateWithGeminiFallback,
  primaryGeminiModel,
  readGeminiUsage,
  type AiTier,
} from '../config/aiModels'

/** Cache entries live here; server-only (see firestore.rules). */
export const AI_CONTENT_CACHE_COLLECTION = 'aiContentCache'
/** Hit/miss counters, folded into `platform/stats` by refreshPlatformStats. */
export const AI_CACHE_STATS_DOC_PATH = 'platform/aiCacheStats'

/**
 * Prompt versions. Bump the matching one whenever a prompt's text or output
 * schema changes — that is what makes the old entries unreachable.
 */
export const AI_PROMPT_VERSIONS = {
  studyPack: 'study-pack-v1',
  prepDraft: 'prep-draft-v1',
  paperAnswer: 'paper-answer-v1',
  mcqSet: 'mcq-set-v1',
  questionSet: 'question-set-v1',
  // Item 4.2 — Placement Pack extensions. Keys are content-addressing only
  // (profile + job description hash), never a student identity.
  coverLetter: 'cover-letter-v1',
  linkedinAbout: 'linkedin-about-v1',
  interviewQuestions: 'interview-questions-v1',
} as const

export type PromptKind = keyof typeof AI_PROMPT_VERSIONS

/** How long an entry may be reused. Syllabus content is stable, so this is long. */
export const DEFAULT_CACHE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000 // 180 days

export interface CacheKeyParts {
  kind: string
  /** Content-addressing parts, in order: subject|topic|programme|language|… */
  key: string
  /** Model id the content was produced with — part of the hash, by design. */
  model: string
  promptVersion: string
}

/** Cache identity for a request, before hashing. Exported for the tests. */
export function cacheKeyString(parts: CacheKeyParts): string {
  return [parts.kind, parts.key, parts.model, parts.promptVersion]
    .map((value) => normalizeKeyPart(value))
    .join('|')
}

/**
 * Case/whitespace-insensitive key parts. "Financial Accounting " and
 * "financial accounting" are the same syllabus topic and must share an entry —
 * otherwise the cache misses whenever a client changes its capitalisation.
 */
export function normalizeKeyPart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** sha256 of the cache identity — a legal Firestore document id. */
export function cacheDocId(parts: CacheKeyParts): string {
  return createHash('sha256').update(cacheKeyString(parts)).digest('hex')
}

export interface CacheEntry {
  content: unknown
  model: string
  promptVersion: string
  createdAt?: string
  hits?: number
}

export interface CacheReadResult {
  entry: CacheEntry | null
  /** 'hit' | 'stale' | 'miss' — 'stale' means we found it but must not reuse it. */
  status: 'hit' | 'stale' | 'miss'
}

/** Fresh enough to reuse? An entry with no timestamp is treated as stale. */
export function isCacheEntryFresh(
  entry: CacheEntry | null,
  options: { now?: number; maxAgeMs?: number } = {},
): boolean {
  if (!entry || entry.content === undefined || entry.content === null) return false
  // An empty capture is not content: a model that returned nothing must not
  // turn into a cached "nothing" that is served for the next six months.
  if (typeof entry.content === 'string' && entry.content.trim() === '') return false
  const now = options.now ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS
  const createdAt = entry.createdAt ? Date.parse(entry.createdAt) : NaN
  if (!Number.isFinite(createdAt)) return false
  return now - createdAt <= maxAgeMs
}

/** Pure lookup decision — the branch the wrapper takes, on its own. */
export function decideCacheUse(
  entry: CacheEntry | null,
  options: { now?: number; maxAgeMs?: number } = {},
): { status: 'hit' | 'stale' | 'miss'; reusable: boolean } {
  if (!entry) return { status: 'miss', reusable: false }
  return isCacheEntryFresh(entry, options)
    ? { status: 'hit', reusable: true }
    : { status: 'stale', reusable: false }
}

export interface GenerateRequest<T> {
  kind: PromptKind
  /** Content-addressing key parts, e.g. `bba|sem1|microeconomics|demand`. */
  key: string
  tier: AiTier
  prompt: string
  /** Optional response mime type, e.g. 'application/json'. */
  responseMimeType?: string
  temperature?: number
  maxAgeMs?: number
  /** Set false to always regenerate (a "Regenerate" button), still storing the result. */
  allowCache?: boolean
  /** Turns the raw model text into the shape callers use; throws if unusable. */
  parse: (raw: string) => T
}

export interface GenerateResult<T> {
  content: T
  /** Where the content came from — the counter the operator watches. */
  source: 'cache' | 'model'
  model: string
  promptVersion: string
  cacheDocId: string
  tokensIn: number
  tokensOut: number
  thinkingTokens: number
  cachedTokens: number
}

export interface ContentEngineDeps {
  /** Reads one cache entry. Returns null when absent. */
  readCache: (docId: string) => Promise<CacheEntry | null>
  /** Stores one cache entry (called on a miss/stale generation). */
  writeCache: (docId: string, entry: CacheEntry) => Promise<void>
  /** Counts a hit or a miss. Failures here must never fail the request. */
  recordUsage: (event: {
    status: 'hit' | 'miss'
    kind: string
    tokensIn: number
    tokensOut: number
  }) => Promise<void>
  /** Produces raw text plus usage for the given model tier. */
  generate: (request: {
    tier: AiTier
    prompt: string
    responseMimeType?: string
    temperature?: number
  }) => Promise<{ raw: string; model: string; tokensIn: number; tokensOut: number; thinkingTokens: number; cachedTokens: number }>
  /** Injectable clock, so TTL behaviour is testable. */
  now: () => number
}

/** Default dependencies: Firestore for storage, Gemini for generation. */
export function defaultDeps(): ContentEngineDeps {
  return {
    readCache: async (docId) => {
      const snap = await db.collection(AI_CONTENT_CACHE_COLLECTION).doc(docId).get()
      if (!snap.exists) return null
      return snap.data() as CacheEntry
    },
    writeCache: async (docId, entry) => {
      await db.collection(AI_CONTENT_CACHE_COLLECTION).doc(docId).set(entry, { merge: true })
    },
    recordUsage: async (event) => {
      // Best-effort: a counter write must never break a student's request.
      await db
        .doc(AI_CACHE_STATS_DOC_PATH)
        .set(
          {
            hits: FieldValue.increment(event.status === 'hit' ? 1 : 0),
            misses: FieldValue.increment(event.status === 'miss' ? 1 : 0),
            tokensServedFromCache: FieldValue.increment(event.status === 'hit' ? event.tokensOut : 0),
            [`byKind.${event.kind}.hits`]: FieldValue.increment(event.status === 'hit' ? 1 : 0),
            [`byKind.${event.kind}.misses`]: FieldValue.increment(event.status === 'miss' ? 1 : 0),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        )
    },
    generate: async ({ tier, prompt, responseMimeType, temperature }) => {
      const client = geminiClient()
      if (!client) throw new Error('GEMINI_API_KEY is not configured')
      const generated = await generateWithGeminiFallback(tier, (modelId) =>
        client
          .getGenerativeModel({
            model: modelId,
            generationConfig: {
              ...(responseMimeType ? { responseMimeType } : {}),
              ...(temperature === undefined ? {} : { temperature }),
            },
          })
          .generateContent(prompt),
      )
      const usage = readGeminiUsage((generated.result.response as any).usageMetadata)
      return {
        raw: generated.result.response.text(),
        model: generated.model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        thinkingTokens: usage.thinkingTokens,
        cachedTokens: usage.cachedTokens,
      }
    },
    now: () => Date.now(),
  }
}

/**
 * The one entry point. Cache hit → return the stored content and count a hit.
 * Miss/stale → generate, store, count a miss.
 *
 * The model id is only known AFTER generation, so the cache read happens with
 * the tier's primary model (what the next request would also compute). If the
 * tier falls through to a different model the entry is stored under the model
 * that actually produced it, and the next request will miss once, generate
 * again on the primary, and re-cache — correct, and self-healing after a
 * fallback event.
 */
export async function generateContentWithCache<T>(
  request: GenerateRequest<T>,
  overrides: Partial<ContentEngineDeps> = {},
): Promise<GenerateResult<T>> {
  const deps: ContentEngineDeps = { ...defaultDeps(), ...overrides }
  const promptVersion = AI_PROMPT_VERSIONS[request.kind]
  const primaryModel = primaryModelForTier(request.tier)
  const lookupId = cacheDocId({
    kind: request.kind,
    key: request.key,
    model: primaryModel,
    promptVersion,
  })

  if (request.allowCache !== false) {
    let cached: CacheEntry | null = null
    try {
      cached = await deps.readCache(lookupId)
    } catch (err) {
      // A cache read failure is a miss, never a failed request.
      console.warn('[AI cache] read failed, generating instead:', (err as Error)?.message)
      cached = null
    }
    const decision = decideCacheUse(cached, { now: deps.now(), maxAgeMs: request.maxAgeMs })
    if (decision.reusable && cached) {
      try {
        const content = request.parse(
          typeof cached.content === 'string' ? cached.content : JSON.stringify(cached.content),
        )
        await deps.recordUsage({ status: 'hit', kind: request.kind, tokensIn: 0, tokensOut: 0 }).catch(() => {})
        return {
          content,
          source: 'cache',
          model: cached.model || primaryModel,
          promptVersion,
          cacheDocId: lookupId,
          tokensIn: 0,
          tokensOut: 0,
          thinkingTokens: 0,
          cachedTokens: 0,
        }
      } catch (err) {
        // Content that no longer parses (schema moved on) is a miss, not an error.
        console.warn('[AI cache] stored content no longer parses, regenerating:', (err as Error)?.message)
      }
    }
  }

  const generated = await deps.generate({
    tier: request.tier,
    prompt: request.prompt,
    responseMimeType: request.responseMimeType,
    temperature: request.temperature,
  })
  const content = request.parse(generated.raw)

  const storedId = cacheDocId({
    kind: request.kind,
    key: request.key,
    model: generated.model,
    promptVersion,
  })
  await deps
    .writeCache(storedId, {
      content: generated.raw,
      model: generated.model,
      promptVersion,
      createdAt: new Date(deps.now()).toISOString(),
    })
    .catch((err) => console.warn('[AI cache] write failed:', (err as Error)?.message))
  await deps
    .recordUsage({
      status: 'miss',
      kind: request.kind,
      tokensIn: generated.tokensIn,
      tokensOut: generated.tokensOut,
    })
    .catch(() => {})

  return {
    content,
    source: 'model',
    model: generated.model,
    promptVersion,
    cacheDocId: storedId,
    tokensIn: generated.tokensIn,
    tokensOut: generated.tokensOut,
    thinkingTokens: generated.thinkingTokens,
    cachedTokens: generated.cachedTokens,
  }
}

/**
 * The tier's primary model. The cache read happens before generation, so the
 * key must be computed from the tier the caller asked for — the same value the
 * next caller will compute.
 */
export function primaryModelForTier(tier: AiTier): string {
  return primaryGeminiModel(tier)
}
