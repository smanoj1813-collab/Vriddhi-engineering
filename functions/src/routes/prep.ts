// functions/src/routes/prep.ts
//
// PrepInsta-style Prep-Content API for UG/PG Commerce & Management.
// Shared backbone on Firebase project vriddhi-engineering:
//   - prep_subjects/{subjectId}
//   - prep_subjects/{subjectId}/topics/{topicId}
//   - universalQuestions (practice pool linkage via prepTags.topicIds)
//   - prep_progress/{uid}
//
// Endpoints:
//   GET  /subjects                      → List subjects (publicly for published, superadmin all)
//   GET  /subjects/:subjectId           → Subject details
//   GET  /subjects/:subjectId/topics    → List topics for subject
//   GET  /subjects/:subjectId/topics/:topicId → Single topic full payload
//   POST /content/draft                 → (Superadmin) Generate AI draft via capped pipeline
//   POST /content/publish               → (Superadmin) Validate & publish topic
//   POST /content/save                  → (Superadmin) Curator updates / edits
//   POST /subjects                      → (Superadmin) Create or update subject
//   GET  /practice                      → Sample random practice questions from pool
//   GET  /progress                      → (Signed in) Get learner's topic progress
//   POST /progress                      → (Signed in) Save learner's progress / quiz result
//   POST /auth/init                     → (Signed in) Set student role claim for B2C learner
//   POST /seed-bba                      → (Superadmin) Seed BBA subjects & topics across 3 years
//   POST /seed-all                      → (Superadmin) Seed every program (or a chosen subset / degree level)
//   GET  /papers                        → Previous-year question papers (published; filters + facets)
//   GET  /papers/:paperId               → One paper with every section and question
//   POST /papers                        → (Superadmin) Create or update a paper (accepts seed or full shape)
//
//   prep_papers/{paperId} holds the previous-year university question papers
//   (structured text, English). They seed through /seed-all with code 'papers'.

import { Router, Response } from 'express'
import { db, auth } from '../config/firebase'
import { FieldValue } from 'firebase-admin/firestore'
import { verifyAuth, AuthenticatedRequest } from '../middleware/auth'
import { getAuth } from 'firebase-admin/auth'
import { aiGenerationLimiter } from '../middleware/rateLimit'
import { geminiClient, openaiClient, deepseekClient } from '../config/aiProviders'
import { generateWithGeminiFallback, primaryGeminiModel, readGeminiUsage } from '../config/aiModels'
import {
  parsePrepDraft,
  validatePublishTransition,
  samplePracticeQuestions,
  buildPrepAiPrompt,
  validatePrepCatalog,
  resolveSeedPrograms,
  chunkArray,
  getPrepProgramsForLevel,
  effectiveDegreeLevel,
  effectiveTrack,
  normaliseSubtopics,
  validateCompanyCatalog,
  companyTopicIds,
  normaliseCompanyPrepSettings,
  applyCompanyPrepSettings,
  DEFAULT_COMPANY_PREP_SETTINGS,
  type CompanyPrepSettings,
  PrepCompany,
  PrepSubject,
  PrepTopic,
  UniversalQuestion,
} from '../prepShared'
import {
  BBA_SUBJECTS,
  SEEDED_BBA_TOPICS,
  SEEDED_UNIVERSAL_QUESTIONS,
} from '../data/bbaSeedData'
import {
  MCOM_SUBJECTS,
  SEEDED_MCOM_TOPICS,
  SEEDED_MCOM_QUESTIONS,
} from '../data/mcomSeedData'
import {
  BSC_SUBJECTS,
  SEEDED_BSC_TOPICS,
  SEEDED_BSC_QUESTIONS,
} from '../data/bscSeedData'
import {
  BA_SUBJECTS,
  SEEDED_BA_TOPICS,
  SEEDED_BA_QUESTIONS,
} from '../data/baSeedData'
import {
  BCOM_SUBJECTS,
  SEEDED_BCOM_TOPICS,
  SEEDED_BCOM_QUESTIONS,
} from '../data/bcomSeedData'
import { APTITUDE_SUBJECTS, SEEDED_APTITUDE_TOPICS, SEEDED_APTITUDE_QUESTIONS } from '../data/aptitudeSeedData'
import { SEEDED_COMPANIES } from '../data/companySeedData'
import { SEEDED_PREP_PAPERS } from '../data/prepPapers'
import { SEEDED_DRIVE_PYQ_FILES } from '../data/prepPapers/drivePyqFiles'
import { PREP_PAPER_FILE_SEED_CODE, planNewPaperFileSeeds, paperFileSeedResultMessage } from '../prepPaperFiles'
import {
  UNIVERSAL_ACADEMIC_BUNDLE,
  universalAcademicSupplementFor,
} from '../data/universalAcademicSupplement'
import {
  PREP_PAPER_SEED_CODE,
  PREP_PAPER_UNIVERSITIES,
  filterPrepPapers,
  normalisePrepPaperInput,
  prepPaperFacets,
  sortPrepPapers,
  toPrepPaperSummary,
  validatePrepPapers,
  type PrepPaper,
} from '../prepPapers'
import {
  frequentQuestionsForSubject,
  subjectsWithRepeats,
} from '../prepFrequentQuestions'
import {
  ANSWER_GENERATE_BATCH_LIMIT,
  PREP_MCQ_SETS_COLLECTION,
  PREP_PAPER_ANSWERS_COLLECTION,
  answerDocId,
  buildMcqSetPrompt,
  buildModelAnswerPrompt,
  collectPaperQuestions,
  mcqSetDocId,
  sanitiseMcqSet,
  sanitiseModelAnswer,
} from '../prepModelAnswers'
import { generateContentWithCache } from '../ai/contentEngine'

/**
 * Registry of every program that ships with seed data. Order is the order the
 * master seeder walks when `programs` is 'all'.
 *
 * 'bcom' is a DERIVED bundle (see data/bcomSeedData.ts): it re-writes the
 * bcom-tagged slice of the BBA/BA/B.Sc bundles with identical document bytes,
 * so its position in the walk cannot conflict with the source bundles.
 */
const PREP_SEED_BUNDLES: Array<{
  code: string
  label: string
  subjects: PrepSubject[]
  topics: Record<string, PrepTopic[]>
  questions: UniversalQuestion[]
}> = []

/**
 * Supplement each chosen academic program with the same universal toolkit plus
 * applied examples relevant to that program. Subject/topic ids are stable, so
 * seeding B.Com and BBA in either order writes identical shared documents.
 */
function withUniversalSupplement(
  code: string,
  label: string,
  subjects: PrepSubject[],
  topics: Record<string, PrepTopic[]>,
  questions: UniversalQuestion[],
) {
  const supplement = universalAcademicSupplementFor(code)
  return {
    code,
    label,
    subjects: [...subjects, ...supplement.subjects],
    topics: { ...topics, ...supplement.topics },
    questions: [...questions, ...supplement.questions],
  }
}

PREP_SEED_BUNDLES.push(
  withUniversalSupplement('bba', 'BBA', BBA_SUBJECTS, SEEDED_BBA_TOPICS, SEEDED_UNIVERSAL_QUESTIONS),
  withUniversalSupplement('bcom', 'B.Com', BCOM_SUBJECTS, SEEDED_BCOM_TOPICS, SEEDED_BCOM_QUESTIONS),
  withUniversalSupplement('bsc', 'B.Sc', BSC_SUBJECTS, SEEDED_BSC_TOPICS, SEEDED_BSC_QUESTIONS),
  withUniversalSupplement('ba', 'BA', BA_SUBJECTS, SEEDED_BA_TOPICS, SEEDED_BA_QUESTIONS),
  withUniversalSupplement('mcom', 'M.Com', MCOM_SUBJECTS, SEEDED_MCOM_TOPICS, SEEDED_MCOM_QUESTIONS),
  {
    code: 'universal',
    label: 'Universal Student Learning',
    subjects: UNIVERSAL_ACADEMIC_BUNDLE.subjects,
    topics: UNIVERSAL_ACADEMIC_BUNDLE.topics,
    questions: UNIVERSAL_ACADEMIC_BUNDLE.questions,
  },
  // Shared placement-aptitude track (QA / LR / Verbal). Not a program: the
  // subjects list every UG & PG program, so seeding once serves them all.
  { code: 'aptitude', label: 'Placement Aptitude', subjects: APTITUDE_SUBJECTS, topics: SEEDED_APTITUDE_TOPICS, questions: SEEDED_APTITUDE_QUESTIONS },
)

/** Seed code for the company-prep catalogue (prep_companies). */
const COMPANY_SEED_CODE = 'companies'

/** Firestore allows at most 500 writes per commit; stay well under it. */
const FIRESTORE_BATCH_LIMIT = 400

export const router = Router()

function todayDateId(): string {
  return new Date().toISOString().slice(0, 10)
}

function requireSuperadmin(req: AuthenticatedRequest, res: Response): boolean {
  if (req.user?.role !== 'superadmin') {
    res.status(403).json({ error: 'This operation is restricted to the platform superadmin / content team.' })
    return false
  }
  return true
}

/**
 * Provider cascade for generating structured prep guides (Gemini -> DeepSeek/OpenAI -> offline composer).
 * Returns real token counts for telemetry metering.
 */
async function generateDraftWithProviders(opts: {
  subjectName: string
  topicTitle: string
  stream?: string
  difficulty?: string
  program?: string
}): Promise<{
  content: any
  provider: string
  model: string
  tokensIn: number
  tokensOut: number
  thinkingTokens: number
  cachedTokens: number
}> {
  const prompt = buildPrepAiPrompt(opts)
  let rawText = ''
  let provider = 'gemini'
  let model = primaryGeminiModel('fast')
  let tokensIn = 0
  let tokensOut = 0
  let thinkingTokens = 0
  let cachedTokens = 0

  // Item 4.1: identical (programme, subject, topic, stream, difficulty) drafts
  // are generated once. The key is content-addressing only — no college and no
  // teacher — so a draft created for one programme is reused by every operator
  // generating the same topic, and the prompt version in the key means a prompt
  // rewrite retires the old entries by itself.
  //
  // The provider cascade below stays INSIDE the generator: caching must not
  // change what happens when Gemini is unavailable.
  try {
    const cached = await generateContentWithCache(
      {
        kind: 'prepDraft',
        key: [opts.program, opts.subjectName, opts.topicTitle, opts.stream, opts.difficulty].join('|'),
        tier: 'fast',
        prompt,
        responseMimeType: 'application/json',
        temperature: 0.5,
        // The draft is edited by a human before publishing, so a day-old copy is
        // still the right starting point; a stale one is not worth a token bill.
        maxAgeMs: 30 * 24 * 60 * 60 * 1000,
        parse: (raw) => raw,
      },
      {
        generate: async () => {
          const gemini = geminiClient()
          if (gemini) {
            try {
              // Tiered list — a retired model id falls through instead of killing drafts.
              const generated = await generateWithGeminiFallback('fast', (modelId) =>
                gemini.getGenerativeModel({ model: modelId }).generateContent(prompt),
                {
                  onFallback: ({ failedModel, nextModel, error }) =>
                    console.warn('[Prep] Gemini model unavailable, trying next tier entry', {
                      failedModel,
                      nextModel,
                      error: (error as Error)?.message,
                    }),
                },
              )
              const usage = readGeminiUsage((generated.result.response as any).usageMetadata)
              if (!generated.result.response.text()) throw new Error('empty Gemini response')
              return {
                raw: generated.result.response.text(),
                model: generated.model,
                tokensIn: usage.tokensIn,
                tokensOut: usage.tokensOut,
                thinkingTokens: usage.thinkingTokens,
                cachedTokens: usage.cachedTokens,
              }
            } catch (err) {
              console.warn('[Prep] Gemini provider failed:', err)
            }
          }

          const client = deepseekClient() || openaiClient()
          if (!client) throw new Error('no provider produced a prep draft')
          const isDeepseek = !!deepseekClient()
          const completion = await client.chat.completions.create({
            model: isDeepseek ? 'deepseek-chat' : 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.5,
          })
          const text = completion.choices[0]?.message?.content || ''
          if (!text) throw new Error('no provider produced a prep draft')
          provider = isDeepseek ? 'deepseek' : 'openai'
          return {
            raw: text,
            model: isDeepseek ? 'deepseek-chat' : 'gpt-4o-mini',
            tokensIn: Number(completion.usage?.prompt_tokens) || 0,
            tokensOut: Number(completion.usage?.completion_tokens) || 0,
            thinkingTokens: 0,
            cachedTokens: 0,
          }
        },
      },
    )
    rawText = cached.content
    model = cached.model
    tokensIn = cached.tokensIn
    tokensOut = cached.tokensOut
    thinkingTokens = cached.thinkingTokens
    cachedTokens = cached.cachedTokens
    // A cache hit costs nothing, so report it as such rather than as new spend.
    if (cached.source === 'cache') provider = 'cache'
  } catch (err) {
    console.warn('[Prep] Draft generation failed, using the offline composer:', err)
  }

  // Parse candidate output
  let parsed = parsePrepDraft(rawText)

  // Dev offline composer fallback if no keys or providers unconfigured
  if (!parsed.valid || !parsed.data) {
    provider = 'offline-composer'
    tokensIn = 0
    tokensOut = 0
    parsed = parsePrepDraft({
      explanationMd: `# ${opts.topicTitle} (${opts.subjectName})

### Core Concept & Intuition
**${opts.topicTitle}** is a cornerstone topic in the undergraduate study of ${opts.subjectName} (${(opts.stream || 'management').toUpperCase()} stream). It provides the conceptual foundation for managerial decision making and operational excellence in modern enterprises.

In Indian industry (e.g. Tata, Reliance, Infosys, and high-growth startups), managers apply the core principles of ${opts.topicTitle} to optimize resource allocation, enhance process efficiency, and ensure organizational sustainability.

---

### Key Principles & Framework
- **Systematic Structure**: Breaks down complex enterprise challenges into clear, actionable components.
- **Strategic Alignment**: Ensures that departmental decisions directly support broader corporate objectives.
- **Continuous Evaluation**: Incorporates robust feedback mechanisms to measure outcomes against university syllabus standards.

---

### Real-World Business Application
Corporate leaders utilize this knowledge to navigate market uncertainties, manage stakeholder expectations, and comply with standard governance norms.

---

### Model University Examination Structure
When writing answers for 10-mark questions:
1. Define the fundamental concept with formal academic definitions.
2. Draw a neat schematic diagram or conceptual flow chart.
3. Explain the primary components using structured sub-headings.
4. Conclude with a practical Indian business case example.`,
      formulas: [
        {
          id: 'formula-1',
          label: `${opts.topicTitle} Primary Governing Formulation`,
          formula: 'Output / Outcome = f(Inputs, Strategic Framework, Execution Efficiency)',
          exampleQ: `How do practitioners measure efficiency and outcomes in ${opts.topicTitle}?`,
          exampleA: 'By comparing standard benchmark metrics against actual performance indicators over the reporting period.',
        },
      ],
      tricks: [
        {
          id: 'trick-1',
          title: `Exam Tip for ${opts.topicTitle}`,
          trick: `Always link ${opts.topicTitle} to both theoretical principles and modern Indian case studies in 10-mark university answers.`,
          whenToUse: 'Applicable in semester examinations and viva evaluations.',
        },
      ],
      howToSolve: [
        {
          id: 'step-1',
          step: 'Step 1: Problem Diagnosis & Identification',
          detail: `Identify the specific scenario constraints and core parameters related to ${opts.topicTitle}.`,
          questionType: 'Analytical University Question / Case Study',
        },
        {
          id: 'step-2',
          step: 'Step 2: Methodological Application',
          detail: 'Apply the governing theoretical framework systematically.',
          questionType: 'Analytical University Question / Case Study',
        },
        {
          id: 'step-3',
          step: 'Step 3: Managerial Conclusion',
          detail: 'Provide a structured recommendation supported by quantitative or conceptual evidence.',
          questionType: 'Analytical University Question / Case Study',
        },
      ],
    })
  }

  return { content: parsed.data, provider, model, tokensIn, tokensOut, thinkingTokens, cachedTokens }
}

// ── GET /subjects ────────────────────────────────────────────────────────────
// Publicly lists prep subjects. Filterable by program (e.g. 'bba'), stream, and yearGroup.
router.get('/subjects', async (req, res) => {
  try {
    const { program, stream, yearGroup, degreeLevel, track } = req.query
    const snap = await db.collection('prep_subjects').get()

    let subjects: PrepSubject[] = snap.docs.map((d) => {
      const data = d.data() as any
      return {
        ...data,
        id: d.id,
      }
    })

    // Non-superadmin sees only published
    const isSuperadmin = (req as any).user?.role === 'superadmin'
    if (!isSuperadmin) {
      subjects = subjects.filter((s) => s.status === 'published')
    }

    if (typeof program === 'string' && program.trim()) {
      const p = program.toLowerCase().trim()
      subjects = subjects.filter((s) => s.programs?.some((prog: string) => prog.toLowerCase() === p))
    }

    if (typeof stream === 'string' && stream.trim()) {
      const st = stream.toLowerCase().trim()
      subjects = subjects.filter((s) => s.stream?.toLowerCase() === st)
    }

    if (typeof yearGroup === 'string' && yearGroup.trim()) {
      const yg = yearGroup.toLowerCase().trim()
      subjects = subjects.filter((s) => s.yearGroup?.toLowerCase() === yg)
    }

    if (typeof degreeLevel === 'string' && degreeLevel.trim() && degreeLevel !== 'all') {
      const lvl = degreeLevel.toLowerCase().trim()
      // effectiveDegreeLevel infers 'undergraduate' for legacy records (BBA)
      // that predate the degreeLevel field. Shared aptitude subjects carry no
      // degree level and are relevant to both, so they pass this filter.
      subjects = subjects.filter((s) => effectiveTrack(s) === 'aptitude' || effectiveDegreeLevel(s) === lvl)
    }

    if (typeof track === 'string' && track.trim() && track !== 'all') {
      const tr = track.toLowerCase().trim()
      // effectiveTrack treats legacy subjects without a track as 'academic'.
      subjects = subjects.filter((s) => effectiveTrack(s) === tr)
    }

    subjects.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    res.json({ success: true, count: subjects.length, data: subjects })
  } catch (err: any) {
    console.error('[Prep] GET /subjects error:', err)
    res.status(500).json({ error: 'Failed to fetch prep subjects', detail: err.message })
  }
})

// ── GET /subjects/:subjectId ────────────────────────────────────────────────
router.get('/subjects/:subjectId', async (req, res) => {
  try {
    const { subjectId } = req.params
    const doc = await db.collection('prep_subjects').doc(subjectId).get()
    if (!doc.exists) {
      res.status(404).json({ error: 'Subject not found' })
      return
    }
    const data = doc.data() as any
    res.json({ success: true, data: { ...data, id: doc.id } })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch subject', detail: err.message })
  }
})

// ── GET /subjects/:subjectId/topics ─────────────────────────────────────────
router.get('/subjects/:subjectId/topics', async (req, res) => {
  try {
    const { subjectId } = req.params
    const snap = await db.collection('prep_subjects').doc(subjectId).collection('topics').get()

    let topics = snap.docs.map((d) => {
      const data = d.data() as any
      return {
        ...data,
        id: d.id,
      }
    })

    const isSuperadmin = (req as any).user?.role === 'superadmin'
    if (!isSuperadmin) {
      topics = topics.filter((t) => t.status === 'published')
    }

    topics.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    res.json({ success: true, count: topics.length, data: topics })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list topics', detail: err.message })
  }
})

// ── GET /subjects/:subjectId/topics/:topicId ────────────────────────────────
router.get('/subjects/:subjectId/topics/:topicId', async (req, res) => {
  try {
    const { subjectId, topicId } = req.params
    const doc = await db.collection('prep_subjects').doc(subjectId).collection('topics').doc(topicId).get()
    if (!doc.exists) {
      res.status(404).json({ error: 'Topic not found' })
      return
    }

    const data = doc.data() as any
    const topic = { ...data, id: doc.id }
    res.json({ success: true, data: topic })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch topic', detail: err.message })
  }
})

// ── POST /content/draft (Superadmin only) ────────────────────────────────────
router.post('/content/draft', verifyAuth, aiGenerationLimiter, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return

  const { subjectId, topicId, title, stream, difficulty, program } = req.body
  if (!subjectId || !topicId || !title) {
    res.status(400).json({ error: 'Missing required fields: subjectId, topicId, title.' })
    return
  }

  try {
    // Check if subject exists
    const subjDoc = await db.collection('prep_subjects').doc(subjectId).get()
    const subjData = subjDoc.data() as PrepSubject | undefined
    const subjectName = subjData?.name || subjectId

    // Generate through AI cascade
    const { content, provider, model, tokensIn, tokensOut, thinkingTokens, cachedTokens } = await generateDraftWithProviders({
      subjectName,
      topicTitle: title,
      stream: stream || subjData?.stream || 'management',
      difficulty: difficulty || 'core',
      program: program || subjData?.programs?.[0] || 'bba',
    })

    const now = new Date().toISOString()
    const topicRef = db.collection('prep_subjects').doc(subjectId).collection('topics').doc(topicId)
    const existing = (await topicRef.get()).data() || {}

    const updatedTopic: PrepTopic = {
      id: topicId,
      subjectId,
      title: title.trim(),
      order: Number(existing.order) || 1,
      difficulty: difficulty || existing.difficulty || 'core',
      tier: existing.tier || 'free',
      status: 'draft',
      generatedBy: 'ai-draft',
      contentVersion: (Number(existing.contentVersion) || 0) + 1,
      featuredQuestionIds: existing.featuredQuestionIds || [],
      explanationMd: content.explanationMd,
      formulas: content.formulas,
      tricks: content.tricks,
      howToSolve: content.howToSolve,
      updatedAt: now,
    }

    await topicRef.set(updatedTopic, { merge: true })

    // Track AI token usage into daily telemetry doc
    if (tokensIn > 0 || tokensOut > 0) {
      const usageRef = db.collection('ai_usage').doc(todayDateId())
      await usageRef.set(
        {
          generations: FieldValue.increment(1),
          tokensIn: FieldValue.increment(tokensIn),
          tokensOut: FieldValue.increment(tokensOut),
          // Thinking bills as output on 3.x; cached input is billed at a discount. Both are tracked so the daily spend doc stays honest.
          tokensThinking: FieldValue.increment(thinkingTokens),
          tokensCached: FieldValue.increment(cachedTokens),
          model,
          lastEventAt: now,
        },
        { merge: true }
      ).catch(() => {})
    }

    res.json({
      success: true,
      message: 'Draft generated successfully.',
      provider,
      tokensIn,
      tokensOut,
      data: updatedTopic,
    })
  } catch (err: any) {
    console.error('[Prep] POST /content/draft error:', err)
    res.status(500).json({ error: 'Failed to generate prep draft', detail: err.message })
  }
})

// ── POST /content/publish (Superadmin only) ──────────────────────────────────
router.post('/content/publish', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return

  const { subjectId, topicId } = req.body
  if (!subjectId || !topicId) {
    res.status(400).json({ error: 'subjectId and topicId are required.' })
    return
  }

  try {
    const topicRef = db.collection('prep_subjects').doc(subjectId).collection('topics').doc(topicId)
    const snap = await topicRef.get()
    if (!snap.exists) {
      res.status(404).json({ error: 'Topic not found.' })
      return
    }

    const current = snap.data() as PrepTopic
    const check = validatePublishTransition(current.status, 'published')
    if (!check.allowed) {
      res.status(400).json({ error: check.reason })
      return
    }

    const now = new Date().toISOString()
    await topicRef.update({
      status: 'published',
      publishedAt: now,
      reviewedBy: req.user!.uid,
      updatedAt: now,
    })

    // Recount published topics in subject
    const topicsSnap = await db.collection('prep_subjects').doc(subjectId).collection('topics').get()
    const publishedCount = topicsSnap.docs.filter((d) => d.data().status === 'published').length
    await db.collection('prep_subjects').doc(subjectId).update({
      topicCount: publishedCount,
      updatedAt: now,
    })

    res.json({
      success: true,
      message: 'Topic published successfully.',
      topicId,
      publishedCount,
    })
  } catch (err: any) {
    console.error('[Prep] POST /content/publish error:', err)
    res.status(500).json({ error: 'Failed to publish topic', detail: err.message })
  }
})

// ── POST /content/save (Superadmin curator edits) ────────────────────────────
router.post('/content/save', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return

  const { subjectId, topicId, ...fields } = req.body
  if (!subjectId || !topicId) {
    res.status(400).json({ error: 'subjectId and topicId are required.' })
    return
  }

  try {
    const topicRef = db.collection('prep_subjects').doc(subjectId).collection('topics').doc(topicId)
    const now = new Date().toISOString()

    // Keep the two sub-topic shapes in sync: the Studio edits
    // `subtopicDetails` (title + brief); `subtopics` must mirror the titles
    // for the older readers (prep-app, legacy viewer).
    const subtopicPatch: Record<string, unknown> = {}
    if (fields.subtopicDetails !== undefined || fields.subtopics !== undefined) {
      const norm = normaliseSubtopics(fields.subtopicDetails ?? fields.subtopics)
      subtopicPatch.subtopics = norm.subtopics
      subtopicPatch.subtopicDetails = norm.subtopicDetails
    }

    const payload = {
      ...fields,
      ...subtopicPatch,
      id: topicId,
      subjectId,
      generatedBy: 'curator',
      reviewedBy: req.user!.uid,
      updatedAt: now,
    }

    await topicRef.set(payload, { merge: true })
    res.json({ success: true, message: 'Topic saved successfully.', data: payload })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save topic', detail: err.message })
  }
})

// ── POST /subjects (Superadmin CRUD) ────────────────────────────────────────
router.post('/subjects', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return

  const { id, name, stream, programs, yearGroup, icon, order, status, description } = req.body
  if (!id || !name || !stream) {
    res.status(400).json({ error: 'id, name, and stream are required.' })
    return
  }

  try {
    const now = new Date().toISOString()
    const subjectData: PrepSubject = {
      id: id.trim(),
      name: name.trim(),
      stream,
      programs: Array.isArray(programs) ? programs : ['bba'],
      yearGroup: yearGroup || '1st-year',
      icon: icon || 'BookOpen',
      order: Number(order) || 1,
      topicCount: 0,
      status: status || 'published',
      description: description || '',
      updatedAt: now,
    }

    await db.collection('prep_subjects').doc(id.trim()).set(subjectData, { merge: true })
    res.json({ success: true, message: 'Subject saved successfully.', data: subjectData })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save subject', detail: err.message })
  }
})

// ── Company prep ────────────────────────────────────────────────────────────
//
// Company guides live in prep_companies/{code}. Anonymous callers see only
// published guides; the superadmin sees everything. When the collection has
// not been seeded yet we fall back to the in-repo seed so the public page is
// never empty after a deploy.

function companyVisible(c: PrepCompany, isSuperadmin: boolean): boolean {
  return isSuperadmin || c.status === 'published'
}

async function loadCompanies(): Promise<PrepCompany[]> {
  const snap = await db.collection('prep_companies').get()
  if (snap.empty) return [...SEEDED_COMPANIES]
  return snap.docs.map((d) => ({ ...(d.data() as PrepCompany), code: d.id }))
}

// Per-college visibility. The public /prep pages are anonymous, so the
// college is resolved in this order:
//   1. verified ID token claim (signed-in student / staff), if a bearer is sent;
//   2. explicit ?collegeId= (the hub passes the learner's college when known);
//   3. none → platform defaults (everything published is visible).
// Token verification here is best-effort: an invalid or missing token simply
// means "anonymous", it never blocks the public catalogue.
const COMPANY_PREP_CONFIG_DOC = 'prep'

function companyPrepSettingsRef(collegeId: string) {
  return db.collection('colleges').doc(collegeId).collection('config').doc(COMPANY_PREP_CONFIG_DOC)
}

async function loadCompanyPrepSettings(collegeId: string | undefined): Promise<CompanyPrepSettings> {
  if (!collegeId) return DEFAULT_COMPANY_PREP_SETTINGS
  try {
    const snap = await companyPrepSettingsRef(collegeId).get()
    return normaliseCompanyPrepSettings(snap.exists ? (snap.data() as any)?.companyPrep : undefined)
  } catch (err) {
    console.warn('[Prep] company prep settings unreadable for', collegeId, err)
    return DEFAULT_COMPANY_PREP_SETTINGS
  }
}

async function resolvePublicCaller(req: any): Promise<{ isSuperadmin: boolean; collegeId?: string }> {
  const header = String(req.headers?.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (token) {
    try {
      const decoded = (await getAuth().verifyIdToken(token)) as unknown as { role?: unknown; collegeId?: unknown }
      const role = String(decoded.role || '').toLowerCase()
      const claimCollege = typeof decoded.collegeId === 'string' && decoded.collegeId ? decoded.collegeId : undefined
      if (role === 'superadmin') {
        // Superadmin may preview any college's view with ?collegeId=.
        const preview = typeof req.query?.collegeId === 'string' ? req.query.collegeId.trim() : ''
        return { isSuperadmin: true, collegeId: preview || undefined }
      }
      if (claimCollege) return { isSuperadmin: false, collegeId: claimCollege }
    } catch {
      // fall through to anonymous handling
    }
  }
  const queryCollege = typeof req.query?.collegeId === 'string' ? req.query.collegeId.trim() : ''
  return { isSuperadmin: false, collegeId: /^[A-Za-z0-9_-]{1,64}$/.test(queryCollege) ? queryCollege : undefined }
}

/** Loads the guides a caller may see: publication state + their college's toggles. */
async function loadVisibleCompanies(req: any): Promise<{ companies: PrepCompany[]; caller: { isSuperadmin: boolean; collegeId?: string }; settings: CompanyPrepSettings }> {
  const caller = await resolvePublicCaller(req)
  const [all, settings] = await Promise.all([loadCompanies(), loadCompanyPrepSettings(caller.collegeId)])
  const published = all.filter((c) => companyVisible(c, caller.isSuperadmin))
  // A superadmin previewing a college sees exactly what that college sees.
  const companies = caller.collegeId ? applyCompanyPrepSettings(published, settings) : published
  return { companies, caller, settings }
}

// GET /companies/settings?collegeId= — the college's visibility toggles.
// Company-specific placement prep is a PLATFORM control: only the superadmin
// reads or changes which company guides a college's learners see. College
// staff get a 403 (the UI shows them a "managed by the platform team" note).
router.get('/companies/settings', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Company prep visibility is managed by the platform superadmin.' })
      return
    }
    const collegeId = resolveCollegeForSettings(req)
    if (!collegeId) {
      res.status(400).json({ error: 'collegeId is required.' })
      return
    }
    const settings = await loadCompanyPrepSettings(collegeId)
    const all = (await loadCompanies()).filter((c) => c.status === 'published')
    const companies = all
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      .map((c) => ({ code: c.code, name: c.name, testName: c.testName, tier: c.tier, programs: c.eligibility?.programs || [], hidden: settings.hiddenCompanies.includes(c.code) }))
    res.json({ success: true, collegeId, settings, companies })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load company prep settings', detail: err.message })
  }
})

// PUT /companies/settings — save the toggles. Body: { collegeId?, enabled, hiddenCompanies }.
// Superadmin-only: the prep catalogue a college sees is platform curriculum,
// not a college-side setting.
router.put('/companies/settings', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Company prep visibility is managed by the platform superadmin.' })
      return
    }
    const collegeId = resolveCollegeForSettings(req)
    if (!collegeId) {
      res.status(400).json({ error: 'collegeId is required.' })
      return
    }
    const known = new Set((await loadCompanies()).map((c) => c.code))
    const incoming = normaliseCompanyPrepSettings(req.body || {})
    const unknown = incoming.hiddenCompanies.filter((c) => !known.has(c))
    if (unknown.length) {
      res.status(400).json({ error: `Unknown company code(s): ${unknown.join(', ')}` })
      return
    }
    const settings: CompanyPrepSettings = {
      enabled: incoming.enabled,
      hiddenCompanies: incoming.hiddenCompanies,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user!.uid,
    }
    await companyPrepSettingsRef(collegeId).set({ companyPrep: settings }, { merge: true })
    res.json({ success: true, collegeId, settings })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save company prep settings', detail: err.message })
  }
})

// The settings endpoints above are superadmin-only (they gate the role before
// calling this), so this resolver only needs to answer for a superadmin: an
// explicit ?collegeId= / body.collegeId, else their own claim.
function resolveCollegeForSettings(req: AuthenticatedRequest): string | null {
  const role = req.user?.role || ''
  if (role === 'superadmin') {
    const requested =
      (typeof req.query?.collegeId === 'string' && req.query.collegeId) ||
      (typeof req.body?.collegeId === 'string' && req.body.collegeId) ||
      req.user?.collegeId ||
      ''
    return requested ? String(requested).trim() : null
  }
  return null
}

// GET /companies?program=bca&audience=tech
router.get('/companies', async (req, res) => {
  try {
    let { companies } = await loadVisibleCompanies(req)

    const program = String(req.query.program || '').toLowerCase().trim()
    if (program) companies = companies.filter((c) => (c.eligibility?.programs || []).includes(program))
    const audience = String(req.query.audience || '').toLowerCase().trim()
    if (audience) companies = companies.filter((c) => (c.audience || []).includes(audience as any))

    companies.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    // List view: strip the long markdown so the hub payload stays small.
    const data = companies.map(({ strategyMd, rolesMd, ...rest }) => ({
      ...rest,
      topicCount: companyTopicIds(rest).length,
    }))
    res.json({ success: true, count: data.length, data })
  } catch (err: any) {
    console.error('[Prep] GET /companies error:', err)
    res.status(500).json({ error: 'Failed to fetch company prep guides', detail: err.message })
  }
})

// GET /companies/:code — full guide plus the resolved topic cards it maps to.
router.get('/companies/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').toLowerCase().trim()
    const { companies, caller } = await loadVisibleCompanies(req)
    const isSuperadmin = caller.isSuperadmin
    const company = companies.find((c) => c.code === code)
    if (!company) {
      res.status(404).json({ error: 'Company prep guide not found' })
      return
    }

    // Resolve the mapped topics to lightweight cards (title, subject, module,
    // difficulty, frequency) so the client can render the checklist without
    // N round trips. Prefer Firestore (curated edits) and fall back to seed.
    const wanted = companyTopicIds(company)
    const seededById = new Map(Object.values(SEEDED_APTITUDE_TOPICS).flat().map((t) => [t.id, t]))
    const cards: Array<{
      id: string
      subjectId: string
      title: string
      moduleName?: string
      difficulty: string
      examFrequency?: string
      subtopicCount: number
    }> = []
    const subjectsSnap = await db.collection('prep_subjects').where('track', '==', 'aptitude').get()
    const liveTopics = new Map<string, any>()
    for (const subj of subjectsSnap.docs) {
      const topicsSnap = await subj.ref.collection('topics').get()
      for (const t of topicsSnap.docs) {
        const data = t.data()
        if (isSuperadmin || data.status === 'published') liveTopics.set(t.id, { ...data, id: t.id })
      }
    }
    for (const tid of wanted) {
      const t = liveTopics.get(tid) || (liveTopics.size === 0 ? seededById.get(tid) : undefined)
      if (!t) continue
      cards.push({
        id: t.id,
        subjectId: t.subjectId,
        title: t.title,
        moduleName: t.moduleName,
        difficulty: t.difficulty,
        examFrequency: t.examFrequency,
        subtopicCount: Array.isArray(t.subtopicDetails) && t.subtopicDetails.length > 0
          ? t.subtopicDetails.length
          : Array.isArray(t.subtopics) ? t.subtopics.length : 0,
      })
    }

    res.json({ success: true, data: company, topics: cards })
  } catch (err: any) {
    console.error('[Prep] GET /companies/:code error:', err)
    res.status(500).json({ error: 'Failed to fetch company prep guide', detail: err.message })
  }
})

// GET /companies/:code/mock?count=20 — sample approved questions from the
// company's mapped topics, weighted by section size so the mix resembles the
// real paper. Sections without mapped topics (coding, games) contribute none.
router.get('/companies/:code/mock', async (req, res) => {
  try {
    const code = String(req.params.code || '').toLowerCase().trim()
    const { companies } = await loadVisibleCompanies(req)
    const company = companies.find((c) => c.code === code)
    if (!company) {
      res.status(404).json({ error: 'Company prep guide not found' })
      return
    }
    const count = Math.min(Math.max(Number(req.query.count) || 20, 5), 30)

    // Weight by the real paper's section size, but discount 'partial'
    // sections (spoken / game-based blocks the MCQ pool only approximates) so
    // the mock is dominated by sections the catalogue genuinely covers.
    const sectionWeight = (sec: PrepCompany['sections'][number]) =>
      sec.coverage === 'catalogue' ? (sec.questions || 10) : Math.max(2, Math.round((sec.questions || 10) / 5))
    const mappedSections = company.sections.filter((sec) => (sec.topicIds || []).length > 0)
    const weightTotal = mappedSections.reduce((n, sec) => n + sectionWeight(sec), 0)

    const snap = await db.collection('universalQuestions').where('status', '==', 'approved').where('prepTags.stream', '==', 'aptitude').get()
    let pool: UniversalQuestion[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UniversalQuestion, 'id'>) }))
    if (pool.length === 0) pool = SEEDED_APTITUDE_QUESTIONS

    const used = new Set<string>()
    const out: Array<UniversalQuestion & { sectionId: string; sectionName: string }> = []
    for (const sec of mappedSections) {
      const share = Math.max(1, Math.round((count * sectionWeight(sec)) / weightTotal))
      const secPool = pool.filter((q) => !used.has(q.id) && q.prepTags.topicIds.some((tid) => sec.topicIds.includes(tid)))
      for (const q of samplePracticeQuestions(secPool, share)) {
        used.add(q.id)
        out.push({ ...q, sectionId: sec.id, sectionName: sec.name })
      }
    }
    res.json({ success: true, count: out.length, data: out.slice(0, count) })
  } catch (err: any) {
    console.error('[Prep] GET /companies/:code/mock error:', err)
    res.status(500).json({ error: 'Failed to build company mock', detail: err.message })
  }
})

// POST /companies (superadmin) — create or update a guide in place.
router.post('/companies', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return
  try {
    const body = (req.body || {}) as Partial<PrepCompany>
    const code = String(body.code || '').toLowerCase().trim()
    if (!code || !/^[a-z0-9-]+$/.test(code)) {
      res.status(400).json({ error: 'code is required and must be lowercase, URL-safe.' })
      return
    }
    const report = validateCompanyCatalog({
      companies: [{ ...(body as PrepCompany), code }],
      knownTopicIds: Object.values(SEEDED_APTITUDE_TOPICS).flat().map((t) => t.id),
    })
    if (!report.valid) {
      res.status(400).json({ error: 'Company guide failed validation.', issues: report.issues })
      return
    }
    const payload = { ...body, code, updatedAt: new Date().toISOString() }
    await db.collection('prep_companies').doc(code).set(payload, { merge: true })
    res.json({ success: true, data: payload, warnings: report.issues })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save company guide', detail: err.message })
  }
})

// ── Previous-year question papers ───────────────────────────────────────────
// prep_papers/{paperId}. Anonymous callers see published papers only (the
// public /prep pages), so this can never leak a draft even from a shared URL.

async function loadVisiblePapers(req: AuthenticatedRequest | any): Promise<PrepPaper[]> {
  const snap = await db.collection('prep_papers').get()
  let papers: PrepPaper[] = snap.docs.map((d) => ({ ...(d.data() as PrepPaper), id: d.id }))
  const { isSuperadmin } = await resolvePublicCaller(req)
  if (!isSuperadmin) papers = papers.filter((p) => p.status === 'published')
  return papers
}

// GET /papers?program=bcom&semester=3&university=bcu&year=2024&subjectId=&scheme=nep&q=tax
router.get('/papers', async (req, res) => {
  try {
    const papers = await loadVisiblePapers(req)
    const { program, semester, university, year, subjectId, scheme, q } = req.query
    const matched = filterPrepPapers(papers, {
      program: typeof program === 'string' ? program : undefined,
      semester: typeof semester === 'string' ? semester : undefined,
      university: typeof university === 'string' ? university : undefined,
      year: typeof year === 'string' ? year : undefined,
      subjectId: typeof subjectId === 'string' ? subjectId : undefined,
      scheme: typeof scheme === 'string' ? scheme : undefined,
      q: typeof q === 'string' ? q : undefined,
    })
    const data = sortPrepPapers(matched).map(toPrepPaperSummary)
    // Facets describe everything the caller may see for the chosen program,
    // so the filter chips never offer a university/year with zero papers.
    const facetBase = typeof program === 'string' && program.trim() ? filterPrepPapers(papers, { program }) : papers
    res.json({
      success: true,
      count: data.length,
      data,
      facets: prepPaperFacets(facetBase),
      universities: PREP_PAPER_UNIVERSITIES,
    })
  } catch (err: any) {
    console.error('[Prep] GET /papers error:', err)
    res.status(500).json({ error: 'Failed to fetch question papers', detail: err.message })
  }
})

// GET /papers/frequent?program=bcom&subject=Financial%20Accounting&limit=25
// Item 3.3: the questions that keep coming back, computed from the papers the
// caller may already see. Pure CPU over data already in the catalogue — no AI,
// no extra collection, no per-student storage. Cached publicly for an hour
// because the answer only changes when a paper is added.
router.get('/papers/frequent', async (req, res) => {
  try {
    const papers = await loadVisiblePapers(req)
    const { program, subject, limit, minCount } = req.query
    const programFilter = typeof program === 'string' && program.trim() ? program.trim().toLowerCase() : ''
    const visible = programFilter
      ? papers.filter((paper) => paper.program.toLowerCase() === programFilter || paper.legacyProgram === programFilter)
      : papers

    const subjectFilter = typeof subject === 'string' ? subject.trim() : ''
    if (!subjectFilter) {
      // No subject chosen yet: tell the client which subjects actually repeat so
      // the picker never offers an empty tab.
      res.json({
        success: true,
        subject: null,
        subjects: subjectsWithRepeats(visible, { minCount: Number(minCount) || undefined }),
        count: 0,
        data: [],
      })
      return
    }

    const data = frequentQuestionsForSubject(visible, subjectFilter, {
      limit: Math.min(100, Math.max(1, Number(limit) || 25)),
      minCount: Number(minCount) || undefined,
    })
    res.set('Cache-Control', 'public, max-age=3600')
    res.json({
      success: true,
      subject: subjectFilter,
      subjects: subjectsWithRepeats(visible, { minCount: Number(minCount) || undefined }),
      count: data.length,
      data,
    })
  } catch (err: any) {
    console.error('[Prep] GET /papers/frequent error:', err)
    res.status(500).json({ error: 'Failed to group repeated questions', detail: err.message })
  }
})

router.get('/papers/:paperId', async (req, res) => {
  try {
    const { paperId } = req.params
    const doc = await db.collection('prep_papers').doc(paperId).get()
    if (!doc.exists) {
      res.status(404).json({ error: 'Question paper not found' })
      return
    }
    const paper = { ...(doc.data() as PrepPaper), id: doc.id }
    const { isSuperadmin } = await resolvePublicCaller(req)
    if (paper.status !== 'published' && !isSuperadmin) {
      res.status(404).json({ error: 'Question paper not found' })
      return
    }
    // Model answers ride along with the paper: published ones for everybody,
    // drafts/rejects only for the reviewer who has to deal with them.
    const answers = await loadPaperAnswers(doc.id, isSuperadmin)
    res.json({
      success: true,
      data: paper,
      answers: answers.answers,
      answersByQid: Object.fromEntries(answers.answers.map((answer) => [answer.qid, answer])),
      answerDrafts: isSuperadmin ? answers.drafts : undefined,
    })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch question paper', detail: err.message })
  }
})

// ── Model answers (item 3.4) and quick-revision MCQs (item 3.5) ─────────────
// Generated once per question by the platform content team, reviewed by a
// human, and only then visible. Drafts are never served to a student: the
// status filter is applied here, in the Admin-SDK read, not in the client.

interface PrepPaperAnswer {
  paperId: string
  qid: string
  sectionId: string
  label: string
  question: string
  marks: number
  status: 'draft' | 'published' | 'rejected'
  answerMd: string
  model?: string
  promptVersion?: string
  generatedAt?: string
  generatedBy?: string | null
  reviewedAt?: string
  reviewedBy?: string | null
  issues?: string[]
}

/** Published answers, plus the drafts when the caller is the reviewer. */
async function loadPaperAnswers(
  paperId: string,
  includeDrafts: boolean,
): Promise<{ answers: PrepPaperAnswer[]; drafts: PrepPaperAnswer[] }> {
  const snap = await db.collection(PREP_PAPER_ANSWERS_COLLECTION).where('paperId', '==', paperId).get()
  const all = snap.docs.map((doc) => ({ ...(doc.data() as PrepPaperAnswer), id: doc.id }))
  const published = all
    .filter((answer) => answer.status === 'published')
    .sort((a, b) => a.qid.localeCompare(b.qid))
  const drafts = includeDrafts ? all.filter((answer) => answer.status !== 'published') : []
  return { answers: published, drafts }
}

// POST /papers/answers/generate (Superadmin) — { paperId, qids?: string[] }
// Generates at most ANSWER_GENERATE_BATCH_LIMIT answers per call so one request
// can never turn into an unbounded token bill; call again for the next batch.
router.post('/papers/answers/generate', verifyAuth, aiGenerationLimiter, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return
  try {
    const { paperId, qids, regenerate } = req.body as { paperId?: string; qids?: string[]; regenerate?: boolean }
    if (!paperId) {
      res.status(400).json({ error: 'paperId is required' })
      return
    }
    const doc = await db.collection('prep_papers').doc(paperId).get()
    if (!doc.exists) {
      res.status(404).json({ error: 'Question paper not found' })
      return
    }
    const paper = { ...(doc.data() as PrepPaper), id: doc.id }
    if (paper.contentType === 'source_pdf') {
      res.status(400).json({ error: 'Original-PDF PYQs have no verified question text. Review a transcription before generating answers or MCQs.' })
      return
    }
    const all = collectPaperQuestions(paper)
    const wanted = Array.isArray(qids) && qids.length > 0 ? all.filter((q) => qids.includes(q.qid)) : all
    if (wanted.length === 0) {
      res.status(400).json({ error: 'No matching questions on this paper.' })
      return
    }
    const batch = wanted.slice(0, ANSWER_GENERATE_BATCH_LIMIT)

    // Already-answered questions are skipped unless the operator asks for a
    // regeneration, so a second call continues the paper instead of re-paying
    // for the first 25 questions.
    const existing = await db.collection(PREP_PAPER_ANSWERS_COLLECTION).where('paperId', '==', paperId).get()
    const done = new Set(existing.docs.map((d) => (d.data() as PrepPaperAnswer).qid))

    const results: Array<{ qid: string; status: string; issues?: string[]; words?: number }> = []
    for (const question of batch) {
      if (done.has(question.qid) && !regenerate) {
        results.push({ qid: question.qid, status: 'already_answered' })
        continue
      }
      const prompt = buildModelAnswerPrompt({
        question: question.text,
        parts: question.parts,
        marks: question.marks,
        subjectName: paper.subjectName,
        programLabel: paper.programLabel,
        universityName: paper.universityName,
        examYear: paper.examYear,
      })
      try {
        const generated = await generateContentWithCache(
          {
            kind: 'paperAnswer',
            // Content-addressing only: the same question of the same paper with
            // the same marks is the same work, whoever asks for it.
            key: [paper.program, paper.subjectName, paper.examYear, question.sectionId, question.label, question.marks].join('|'),
            tier: 'fast',
            prompt,
            parse: (raw) => sanitiseModelAnswer(raw, question.marks),
          },
        )
        const sanitised = generated.content
        if (!sanitised.ok) {
          results.push({ qid: question.qid, status: 'rejected_by_sanitiser', issues: sanitised.issues })
          continue
        }
        const docId = answerDocId(paperId, question.qid)
        const payload: PrepPaperAnswer = {
          paperId,
          qid: question.qid,
          sectionId: question.sectionId,
          label: question.label,
          question: question.text,
          marks: question.marks,
          status: 'draft',
          answerMd: sanitised.answerMd,
          model: generated.model,
          promptVersion: generated.promptVersion,
          generatedAt: new Date().toISOString(),
          generatedBy: req.user?.uid || null,
          reviewedAt: '',
          reviewedBy: null,
          issues: sanitised.issues,
        }
        await db.collection(PREP_PAPER_ANSWERS_COLLECTION).doc(docId).set(payload, { merge: true })
        results.push({
          qid: question.qid,
          status: 'drafted',
          issues: sanitised.issues,
          words: sanitised.answerMd.split(/\s+/).filter(Boolean).length,
        })
      } catch (err: any) {
        console.error('[Prep] answer generation failed for', question.qid, err)
        results.push({ qid: question.qid, status: 'failed', issues: [String(err?.message || err)] })
      }
    }

    res.json({
      success: true,
      paperId,
      requested: wanted.length,
      attempted: batch.length,
      remaining: Math.max(0, wanted.length - batch.length),
      results,
    })
  } catch (err: any) {
    console.error('[Prep] POST /papers/answers/generate error:', err)
    res.status(500).json({ error: 'Failed to generate model answers', detail: err.message })
  }
})

// GET /papers/answers?paperId= — published for everyone, drafts for the reviewer.
router.get('/papers/answers', async (req, res) => {
  try {
    const paperId = String(req.query.paperId || '').trim()
    if (!paperId) {
      res.status(400).json({ error: 'paperId is required' })
      return
    }
    const isSuperadmin = (req as any).user?.role === 'superadmin'
    const { answers, drafts } = await loadPaperAnswers(paperId, isSuperadmin)
    res.json({ success: true, count: answers.length, data: answers, drafts: isSuperadmin ? drafts : undefined })
  } catch (err: any) {
    console.error('[Prep] GET /papers/answers error:', err)
    res.status(500).json({ error: 'Failed to fetch model answers', detail: err.message })
  }
})

// POST /papers/answers/review (Superadmin) — { ids: string[], action }
// Publish or reject. Publishing is the ONLY way an answer becomes visible to a
// student, so this endpoint is the human gate the label promises.
router.post('/papers/answers/review', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return
  try {
    const { ids, action } = req.body as { ids?: string[]; action?: string }
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids is required' })
      return
    }
    if (action !== 'publish' && action !== 'reject' && action !== 'reopen') {
      res.status(400).json({ error: "action must be 'publish', 'reject' or 'reopen'" })
      return
    }
    const nextStatus: PrepPaperAnswer['status'] =
      action === 'publish' ? 'published' : action === 'reject' ? 'rejected' : 'draft'
    const now = new Date().toISOString()
    const batch = db.batch()
    for (const id of ids.slice(0, 500)) {
      batch.set(
        db.collection(PREP_PAPER_ANSWERS_COLLECTION).doc(id),
        { status: nextStatus, reviewedAt: now, reviewedBy: req.user?.uid || null },
        { merge: true },
      )
    }
    await batch.commit()
    res.json({ success: true, updated: ids.slice(0, 500).length, status: nextStatus })
  } catch (err: any) {
    console.error('[Prep] POST /papers/answers/review error:', err)
    res.status(500).json({ error: 'Failed to update model answers', detail: err.message })
  }
})

// POST /papers/mcq-sets/generate (Superadmin) — { paperId, qids?: string[] }
// Quick-revision MCQs for a paper, from the same questions (and, when it has
// been published, the reviewed answer as the source of truth).
router.post('/papers/mcq-sets/generate', verifyAuth, aiGenerationLimiter, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return
  try {
    const { paperId, qids } = req.body as { paperId?: string; qids?: string[] }
    if (!paperId) {
      res.status(400).json({ error: 'paperId is required' })
      return
    }
    const doc = await db.collection('prep_papers').doc(paperId).get()
    if (!doc.exists) {
      res.status(404).json({ error: 'Question paper not found' })
      return
    }
    const paper = { ...(doc.data() as PrepPaper), id: doc.id }
    if (paper.contentType === 'source_pdf') {
      res.status(400).json({ error: 'Original-PDF PYQs have no verified question text. Review a transcription before generating answers or MCQs.' })
      return
    }
    const all = collectPaperQuestions(paper)
    const wanted = Array.isArray(qids) && qids.length > 0 ? all.filter((q) => qids.includes(q.qid)) : all
    if (wanted.length === 0) {
      res.status(400).json({ error: 'No matching questions on this paper.' })
      return
    }
    const prompt = buildMcqSetPrompt({
      subjectName: paper.subjectName,
      programLabel: paper.programLabel,
      questions: wanted.map((question) => question.text),
      perTopic: 5,
    })
    const generated = await generateContentWithCache({
      kind: 'mcqSet',
      key: [paper.program, paper.subjectName, paper.examYear, wanted.map((q) => q.qid).join(',')].join('|'),
      tier: 'fast',
      prompt,
      responseMimeType: 'application/json',
      parse: (raw) => sanitiseMcqSet(raw),
    })
    const sanitised = generated.content
    if (!sanitised.ok) {
      res.status(502).json({ error: 'The model did not return usable questions. Try again.', issues: sanitised.issues })
      return
    }
    const docId = mcqSetDocId(paperId, wanted.map((q) => q.qid).join('_'))
    const payload = {
      paperId,
      subjectName: paper.subjectName,
      program: paper.program,
      examYear: paper.examYear,
      qids: wanted.map((q) => q.qid),
      status: 'draft' as const,
      items: sanitised.items,
      issues: sanitised.issues,
      model: generated.model,
      promptVersion: generated.promptVersion,
      generatedAt: new Date().toISOString(),
      generatedBy: req.user?.uid || null,
    }
    await db.collection(PREP_MCQ_SETS_COLLECTION).doc(docId).set(payload, { merge: true })
    res.json({ success: true, data: payload, count: sanitised.items.length, issues: sanitised.issues })
  } catch (err: any) {
    console.error('[Prep] POST /papers/mcq-sets/generate error:', err)
    res.status(500).json({ error: 'Failed to generate quick-revision questions', detail: err.message })
  }
})

// GET /papers/mcq-sets?paperId= — published sets only, unless superadmin.
router.get('/papers/mcq-sets', async (req, res) => {
  try {
    const paperId = String(req.query.paperId || '').trim()
    const isSuperadmin = (req as any).user?.role === 'superadmin'
    let queryRef: FirebaseFirestore.Query = db.collection(PREP_MCQ_SETS_COLLECTION)
    if (paperId) queryRef = queryRef.where('paperId', '==', paperId)
    const snap = await queryRef.get()
    const rows = snap.docs
      .map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id } as Record<string, unknown> & { id: string; status?: string }))
      .filter((row) => isSuperadmin || row.status === 'published')
    res.json({ success: true, count: rows.length, data: rows })
  } catch (err: any) {
    console.error('[Prep] GET /papers/mcq-sets error:', err)
    res.status(500).json({ error: 'Failed to fetch quick-revision sets', detail: err.message })
  }
})

// POST /papers/mcq-sets/review (Superadmin) — same gate as model answers.
router.post('/papers/mcq-sets/review', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return
  try {
    const { ids, action } = req.body as { ids?: string[]; action?: string }
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids is required' })
      return
    }
    if (action !== 'publish' && action !== 'reject' && action !== 'reopen') {
      res.status(400).json({ error: "action must be 'publish', 'reject' or 'reopen'" })
      return
    }
    const nextStatus = action === 'publish' ? 'published' : action === 'reject' ? 'rejected' : 'draft'
    const now = new Date().toISOString()
    const batch = db.batch()
    for (const id of ids.slice(0, 200)) {
      batch.set(
        db.collection(PREP_MCQ_SETS_COLLECTION).doc(id),
        { status: nextStatus, reviewedAt: now, reviewedBy: req.user?.uid || null },
        { merge: true },
      )
    }
    await batch.commit()
    res.json({ success: true, updated: ids.slice(0, 200).length, status: nextStatus })
  } catch (err: any) {
    console.error('[Prep] POST /papers/mcq-sets/review error:', err)
    res.status(500).json({ error: 'Failed to update quick-revision sets', detail: err.message })
  }
})

// POST /papers (Superadmin) — body is either a compact seed record or a full paper.
router.post('/papers', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return
  try {
    const { paper, report } = normalisePrepPaperInput(req.body)
    if (!paper) {
      res.status(400).json({ error: 'Question paper failed validation.', issues: report.issues })
      return
    }
    const data = { ...paper, updatedAt: new Date().toISOString(), updatedBy: req.user?.uid || null }
    await db.collection('prep_papers').doc(paper.id).set(data, { merge: true })
    res.json({ success: true, data, warnings: report.issues })
  } catch (err: any) {
    console.error('[Prep] POST /papers error:', err)
    res.status(500).json({ error: 'Failed to save question paper', detail: err.message })
  }
})

// ── GET /practice (Randomly sample questions from approved pool) ────────────
router.get('/practice', async (req, res) => {
  try {
    const topicId = String(req.query.topicId || '').trim()
    const subjectId = String(req.query.subjectId || '').trim()
    const count = Number(req.query.count) || 10

    let query: FirebaseFirestore.Query = db.collection('universalQuestions').where('status', '==', 'approved')

    if (topicId) {
      query = query.where('prepTags.topicIds', 'array-contains', topicId)
    } else if (subjectId) {
      query = query.where('prepTags.subjectId', '==', subjectId)
    }

    const snap = await query.get()
    let pool: UniversalQuestion[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<UniversalQuestion, 'id'>),
    }))

    // If pool is empty or low, check seeded fallback questions
    if (pool.length === 0) {
      const seededMatches = SEEDED_UNIVERSAL_QUESTIONS.filter(
        (q) =>
          (!topicId || q.prepTags.topicIds.includes(topicId)) ||
          (!subjectId || q.prepTags.subjectId === subjectId)
      )
      if (seededMatches.length > 0) {
        pool = seededMatches
      } else {
        // Fallback generic questions for this topic
        pool = [
          {
            id: `practice-${topicId || 'generic'}-1`,
            questionText: `Which fundamental principle is central to understanding ${topicId.replace(/-/g, ' ') || 'management'}?`,
            options: [
              'Systematic alignment of organizational objectives with operational processes',
              'Maximizing short-term discretionary cash outflows without control',
              'Ignoring regulatory frameworks and university standards',
              'Disregarding double-entry equilibrium and internal audit checks',
            ],
            correctIndex: 0,
            explanation: 'Academic frameworks emphasize aligning operational actions systematically with strategic enterprise goals.',
            difficulty: 'core',
            status: 'approved',
            prepTags: { subjectId: subjectId || 'general', topicIds: [topicId] },
          },
          {
            id: `practice-${topicId || 'generic'}-2`,
            questionText: `When analyzing practical problems in this domain, what is the primary initial step?`,
            options: [
              'Execute random computations without reviewing given parameters',
              'Extract given quantitative data, identify governing equations, and state assumptions',
              'Skip the problem statement and guess the final conclusion',
              'Assume all variables are zero regardless of the context',
            ],
            correctIndex: 1,
            explanation: 'Methodological rigor requires extracting given data and selecting the governing formula before calculation.',
            difficulty: 'basic',
            status: 'approved',
            prepTags: { subjectId: subjectId || 'general', topicIds: [topicId] },
          },
        ]
      }
    }

    const sampled = samplePracticeQuestions(pool, count)
    res.json({
      success: true,
      topicId: topicId || null,
      subjectId: subjectId || null,
      count: sampled.length,
      data: sampled,
    })
  } catch (err: any) {
    console.error('[Prep] GET /practice error:', err)
    res.status(500).json({ error: 'Failed to fetch practice questions', detail: err.message })
  }
})

// ── GET /progress (Signed in learner) ────────────────────────────────────────
router.get('/progress', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid
    const doc = await db.collection('prep_progress').doc(uid).get()
    const progress = doc.exists ? doc.data() : { topicsCompleted: {} }
    res.json({ success: true, data: progress })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch learner progress', detail: err.message })
  }
})

// ── POST /progress (Signed in learner) ───────────────────────────────────────
router.post('/progress', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid
    const { topicId, visitedTab, quizScore, quizTotal, completed } = req.body
    if (!topicId) {
      res.status(400).json({ error: 'topicId is required.' })
      return
    }

    const progressRef = db.collection('prep_progress').doc(uid)
    const snap = await progressRef.get()
    const current = snap.exists ? (snap.data() || {}) : {}
    const topicsMap = current.topicsCompleted || {}

    const existing = topicsMap[topicId] || {}
    const visitedSet = new Set<string>(existing.visitedTabs || [])
    if (visitedTab) visitedSet.add(visitedTab)

    const updatedTopicProgress = {
      ...existing,
      lastVisitedAt: new Date().toISOString(),
      visitedTabs: Array.from(visitedSet),
      ...(completed !== undefined ? { completed: Boolean(completed) } : {}),
      ...(quizScore !== undefined ? { quizScore, quizTotal, quizCompletedAt: new Date().toISOString() } : {}),
    }

    topicsMap[topicId] = updatedTopicProgress

    await progressRef.set(
      {
        uid,
        topicsCompleted: topicsMap,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    )

    res.json({ success: true, data: updatedTopicProgress })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to record progress', detail: err.message })
  }
})

// ── POST /auth/init (B2C learner role self-initialization) ────────────────────
router.post('/auth/init', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid
    const userRecord = await auth.getUser(uid)
    const existingClaims = (userRecord.customClaims || {}) as Record<string, unknown>

    // If account has no role claim, grant 'student' role (B2C learner, collegeId: null)
    let role = existingClaims.role as string | undefined
    if (!role) {
      await auth.setCustomUserClaims(uid, {
        ...existingClaims,
        role: 'student',
        collegeId: null,
      })
      role = 'student'
    }

    // Upsert into users/{uid}
    const userDocRef = db.collection('users').doc(uid)
    const userSnap = await userDocRef.get()
    if (!userSnap.exists) {
      await userDocRef.set({
        uid,
        email: userRecord.email || null,
        name: userRecord.displayName || 'B2C Student',
        role: 'student',
        collegeId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }

    res.json({
      success: true,
      uid,
      role,
      collegeId: null,
      message: 'B2C learner identity initialised successfully.',
    })
  } catch (err: any) {
    console.error('[Prep] POST /auth/init error:', err)
    res.status(500).json({ error: 'Failed to initialise learner identity', detail: err.message })
  }
})

// ── POST /seed-bba (Superadmin one-click curriculum population) ──────────────
router.post('/seed-bba', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return

  try {
    const batch = db.batch()
    let subjectCount = 0
    let topicCount = 0
    let questionCount = 0

    // 1. Seed Subjects
    for (const subj of BBA_SUBJECTS) {
      const ref = db.collection('prep_subjects').doc(subj.id)
      batch.set(ref, subj, { merge: true })
      subjectCount++
    }

    // 2. Seed Topics
    for (const [subjectId, topics] of Object.entries(SEEDED_BBA_TOPICS)) {
      for (const topic of topics) {
        const topicRef = db.collection('prep_subjects').doc(subjectId).collection('topics').doc(topic.id)
        batch.set(topicRef, topic, { merge: true })
        topicCount++
      }
    }

    // 3. Seed Practice Questions
    for (const q of SEEDED_UNIVERSAL_QUESTIONS) {
      const qRef = db.collection('universalQuestions').doc(q.id)
      batch.set(qRef, q, { merge: true })
      questionCount++
    }

    await batch.commit()

    res.json({
      success: true,
      message: `Seeded BBA catalog: ${subjectCount} subjects, ${topicCount} full topics, and ${questionCount} universal practice questions.`,
      subjectCount,
      topicCount,
      questionCount,
    })
  } catch (err: any) {
    console.error('[Prep] POST /seed-bba error:', err)
    res.status(500).json({ error: 'Failed to seed BBA catalog', detail: err.message })
  }
})

// ── POST /seed-all (Superadmin master curriculum population) ─────────────────
//
// One-click population of every program that ships with seed data, or a chosen
// subset. Accepts:
//   { "programs": "all" }                 → every program (default)
//   { "programs": "ba,mcom" }             → comma separated codes
//   { "programs": ["ba", "bsc"] }         → array of codes
//   { "programs": "undergraduate" }       → every UG program in the catalog
//
// Writes are accumulated and committed in chunks of FIRESTORE_BATCH_LIMIT to
// stay under Firestore's 500-writes-per-commit ceiling. Every write uses
// { merge: true } so re-running the seeder refreshes content in place.
//
// Each selected catalog is also passed through validatePrepCatalog() and the
// integrity report is returned, so the operator can see any referential gap
// without a separate round trip.
router.post('/seed-all', verifyAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireSuperadmin(req, res)) return

  try {
    const body = req.body || {}
    const requested = body.programs ?? body.program ?? 'all'

    // Allow selecting by degree level as well as by explicit program codes.
    const seedableCodes = PREP_SEED_BUNDLES.map((b) => b.code)
    const asLevel = typeof requested === 'string' ? requested.trim().toLowerCase() : ''
    const byLevel =
      asLevel === 'undergraduate' || asLevel === 'postgraduate'
        ? getPrepProgramsForLevel(asLevel)
            .map((p) => p.code)
            .filter((code) => seedableCodes.includes(code))
        : null

    const selection = resolveSeedPrograms(byLevel ?? requested)
    // Honour the caller's ordering rather than the registry's, so a chosen
    // subset seeds in exactly the sequence requested.
    const bundles = selection.programs
      .map((code) => PREP_SEED_BUNDLES.find((b) => b.code === code))
      .filter((b): b is (typeof PREP_SEED_BUNDLES)[number] => Boolean(b))
    // Company-prep bundle: not a subject/topic bundle, so handled separately.
    const seedCompanies = selection.programs.includes(COMPANY_SEED_CODE)
    // Previous-year question papers: prep_papers, also handled separately.
    const seedPapers = selection.programs.includes(PREP_PAPER_SEED_CODE)
    const seedPaperFiles = selection.programs.includes(PREP_PAPER_FILE_SEED_CODE)
    // Valid program codes that simply have no seed bundle yet.
    const unseedable = selection.programs.filter(
      (code) => !seedableCodes.includes(code) && code !== COMPANY_SEED_CODE && code !== PREP_PAPER_SEED_CODE && code !== PREP_PAPER_FILE_SEED_CODE
    )

    if (selection.errors.length > 0 && bundles.length === 0 && !seedCompanies && !seedPapers && !seedPaperFiles) {
      res.status(400).json({
        error: 'No seedable programs matched the request.',
        errors: selection.errors,
        available: seedableCodes,
      })
      return
    }

    if (bundles.length === 0 && !seedCompanies && !seedPapers && !seedPaperFiles) {
      res.status(400).json({
        error: 'The requested programs have no seed data yet.',
        errors: selection.errors,
        unseedable,
        available: seedableCodes,
      })
      return
    }

    // Stage every write up front so counts are exact and chunks are uniform.
    type StagedWrite = { ref: FirebaseFirestore.DocumentReference; data: Record<string, any>; createOnly?: boolean }
    const writes: StagedWrite[] = []
    const perProgram: Array<{
      code: string
      label: string
      subjectCount: number
      topicCount: number
      questionCount: number
      paperCount?: number
      skippedPaperCount?: number
      valid: boolean
      errorCount: number
      warningCount: number
    }> = []

    for (const bundle of bundles) {
      const report = validatePrepCatalog({
        programCode: bundle.code,
        subjects: bundle.subjects,
        topics: bundle.topics,
        questions: bundle.questions,
      })

      let subjectCount = 0
      let topicCount = 0
      let questionCount = 0

      for (const subj of bundle.subjects) {
        writes.push({ ref: db.collection('prep_subjects').doc(subj.id), data: subj as any })
        subjectCount++
      }

      for (const [subjectId, topics] of Object.entries(bundle.topics)) {
        for (const topic of topics) {
          writes.push({
            ref: db.collection('prep_subjects').doc(subjectId).collection('topics').doc(topic.id),
            data: topic as any,
          })
          topicCount++
        }
      }

      for (const q of bundle.questions) {
        writes.push({ ref: db.collection('universalQuestions').doc(q.id), data: q as any })
        questionCount++
      }

      perProgram.push({
        code: bundle.code,
        label: bundle.label,
        subjectCount,
        topicCount,
        questionCount,
        valid: report.valid,
        errorCount: report.errorCount,
        warningCount: report.warningCount,
      })
    }

    if (seedCompanies) {
      const report = validateCompanyCatalog({
        companies: SEEDED_COMPANIES,
        knownTopicIds: Object.values(SEEDED_APTITUDE_TOPICS).flat().map((t) => t.id),
      })
      for (const company of SEEDED_COMPANIES) {
        writes.push({ ref: db.collection('prep_companies').doc(company.code), data: company as any })
      }
      perProgram.push({
        code: COMPANY_SEED_CODE,
        label: 'Company Prep',
        subjectCount: SEEDED_COMPANIES.length,
        topicCount: 0,
        questionCount: 0,
        valid: report.valid,
        errorCount: report.errorCount,
        warningCount: report.warningCount,
      })
    }

    if (seedPapers) {
      const knownSubjectIds = new Set(PREP_SEED_BUNDLES.flatMap((b) => b.subjects.map((s) => s.id)))
      const report = validatePrepPapers(SEEDED_PREP_PAPERS, { knownSubjectIds })
      for (const paper of SEEDED_PREP_PAPERS) {
        writes.push({ ref: db.collection('prep_papers').doc(paper.id), data: paper as any })
      }
      perProgram.push({
        code: PREP_PAPER_SEED_CODE,
        label: 'Previous Year Papers',
        subjectCount: 0,
        topicCount: 0,
        questionCount: 0,
        paperCount: SEEDED_PREP_PAPERS.length,
        valid: report.valid,
        errorCount: report.errorCount,
        warningCount: report.warningCount,
      })
    }

    let addedPaperFileCount = 0
    let skippedPaperFileCount = 0
    if (seedPaperFiles) {
      const report = validatePrepPapers(SEEDED_DRIVE_PYQ_FILES)
      if (!report.valid) {
        res.status(400).json({ error: 'Original-PDF PYQ bundle failed validation. No data was written.', issues: report.issues })
        return
      }
      const existingIds: string[] = []
      // Read by known ID, not the entire corpus; preserve existing source rows,
      // reviewed transcriptions, draft decisions and metadata corrections.
      for (const group of chunkArray(SEEDED_DRIVE_PYQ_FILES, 200)) {
        const existing = await db.getAll(...group.map((paper) => db.collection('prep_papers').doc(paper.id)))
        existingIds.push(...existing.filter((doc) => doc.exists).map((doc) => doc.id))
      }
      const plan = planNewPaperFileSeeds(SEEDED_DRIVE_PYQ_FILES, existingIds)
      addedPaperFileCount = plan.papers.length
      skippedPaperFileCount = plan.skipped
      for (const paper of plan.papers) {
        writes.push({ ref: db.collection('prep_papers').doc(paper.id), data: paper as any, createOnly: true })
      }
      perProgram.push({
        code: PREP_PAPER_FILE_SEED_CODE,
        label: 'Shared PYQ PDFs (English / Kannada languages)',
        subjectCount: 0, topicCount: 0, questionCount: 0,
        paperCount: addedPaperFileCount, skippedPaperCount: skippedPaperFileCount,
        valid: report.valid, errorCount: report.errorCount, warningCount: report.warningCount,
      })
    }
    const totalPaperCount = (seedPapers ? SEEDED_PREP_PAPERS.length : 0) + addedPaperFileCount

    // Commit in chunks; Firestore rejects batches larger than 500 writes.
    const chunks = chunkArray(writes, FIRESTORE_BATCH_LIMIT)
    for (const chunk of chunks) {
      const batch = db.batch()
      for (const w of chunk) {
        if (w.createOnly) batch.create(w.ref, w.data)
        else batch.set(w.ref, w.data, { merge: true })
      }
      await batch.commit()
    }

    const totals = perProgram.reduce(
      (acc, p) => ({
        subjectCount: acc.subjectCount + p.subjectCount,
        topicCount: acc.topicCount + p.topicCount,
        questionCount: acc.questionCount + p.questionCount,
      }),
      { subjectCount: 0, topicCount: 0, questionCount: 0 }
    )

    const onlyPaperFiles = seedPaperFiles && !seedPapers && !seedCompanies && bundles.length === 0
    const preservedFilesNotice = skippedPaperFileCount ? ` ${skippedPaperFileCount} existing original-PDF PYQ records preserved.` : ''

    res.json({
      success: true,
      message: onlyPaperFiles ? paperFileSeedResultMessage(addedPaperFileCount, skippedPaperFileCount) : `Seeded ${perProgram.length} bundle(s): ${totals.subjectCount - (seedCompanies ? SEEDED_COMPANIES.length : 0)} subjects, ${totals.topicCount} topics, ${totals.questionCount} universal practice questions${seedCompanies ? `, ${SEEDED_COMPANIES.length} company prep guides` : ''}${totalPaperCount ? `, ${totalPaperCount} previous-year question papers` : ''} across ${chunks.length} commit(s).${preservedFilesNotice}`,
      paperCount: totalPaperCount,
      skippedPaperFileCount,
      programs: selection.programs,
      errors: selection.errors,
      unseedable,
      ...totals,
      perProgram,
      writes: writes.length,
      commits: chunks.length,
    })
  } catch (err: any) {
    console.error('[Prep] POST /seed-all error:', err)
    res.status(500).json({ error: 'Failed to seed prep catalog', detail: err.message })
  }
})
