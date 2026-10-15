// functions/src/prepShared.ts
//
// Pure domain types and pure decision helpers for the PrepInsta-style
// Vriddhi Prep-Content platform (UG/PG academic and placement catalogues).
// Kept strictly free of SDK dependencies for node:test decision-table testing.

export type PrepStream =
  | 'commerce'
  | 'management'
  | 'aptitude'
  | 'economics'
  | 'finance'
  | 'law'
  | 'strategy'
  | 'operations'
  | 'taxation'
  // Science, arts, computing, electronics, electrical and mechanical streams for the B.Sc, BA, MCA, CSE, ECE, EEE and ME catalogs.
  | 'mathematics'
  | 'statistics'
  | 'science'
  | 'computing'
  | 'electronics'
  | 'electrical'
  | 'mechanical'
  | 'communication'
  | 'learning'

export type PrepDifficulty = 'basic' | 'core' | 'advanced'
export type PrepStatus = 'draft' | 'in_review' | 'published'
export type PrepTier = 'free' | 'premium'

/**
 * Which catalogue a subject belongs to.
 *  - academic: semester-wise university curriculum (BBA, B.Com, M.Com, ...)
 *  - aptitude: placement aptitude shared by every program (QA, LR, Verbal)
 *  - company:  company-specific placement prep (reserved for the next phase)
 * Absent on legacy records — treated as 'academic'.
 */
export type PrepTrack = 'academic' | 'aptitude' | 'company'

/**
 * Who a topic is pitched at. Aptitude topics are shared across programs, so
 * this tag lets the same "Percentages" page serve everyone while
 * "Permutations & Probability" is flagged for tech / PG audiences.
 *  - ug:   non-technical undergraduate (BBA, B.Com, BA, B.Sc)
 *  - pg:   non-technical postgraduate (MBA, M.Com)
 *  - tech: technical / IT hiring (BCA, MCA, engineering-pattern papers)
 */
export type PrepAudience = 'ug' | 'pg' | 'tech'

// ── Company-specific placement prep ─────────────────────────────────────────
//
// A PrepCompany describes one recruiter's assessment (pattern, eligibility,
// rounds) and maps each test section onto the shared aptitude topics that
// already exist, so company prep re-uses the QA / LR / VA catalogue instead of
// duplicating it. Stored in Firestore under `prep_companies/{code}`.

export type PrepCompanyTier = 'mass' | 'premium'

export interface PrepCompanySection {
  id: string
  /** Section name as the recruiter labels it, e.g. "Numerical Ability". */
  name: string
  questions?: number
  /** Minutes allotted to the section; omit when the timer is shared. */
  minutes?: number
  /** Free-text note, e.g. "shared 25-minute timer with Advanced Reasoning". */
  note?: string
  /**
   * Aptitude topic ids (qa-* / lr-* / va-*) tested in this section, most
   * frequent first. Empty for sections the shared catalogue does not cover
   * (coding, games, spoken English) — `coverage` explains what to do instead.
   */
  topicIds: string[]
  /** 'catalogue' = fully covered by mapped topics; 'partial' / 'external' = see coverage note. */
  coverage: 'catalogue' | 'partial' | 'external'
  coverageNote?: string
}

export interface PrepCompanyRound {
  id: string
  name: string
  /** What happens in this round and what is evaluated. */
  detail: string
  /** True when failing this round ends the process. */
  eliminator?: boolean
}

export interface PrepCompanyEligibility {
  /** Program codes from PREP_PROGRAM_CATALOG this drive typically accepts. */
  programs: string[]
  /** Human-readable degree list as the recruiter phrases it. */
  degrees: string
  minPercentage?: string
  backlogs?: string
  gap?: string
  age?: string
  note?: string
}

export interface PrepCompany {
  /** URL-safe code, e.g. 'tcs-nqt'. */
  code: string
  name: string
  /** Drive / test name, e.g. "TCS National Qualifier Test (NQT)". */
  testName: string
  tagline: string
  /** Which learners this drive is relevant to; drives the hub filter. */
  audience: PrepAudience[]
  tier: PrepCompanyTier
  /** Assessment vendor / platform, e.g. "TCS iON", "AMCAT / SHL", "HackerRank". */
  platform?: string
  totalMinutes?: number
  totalQuestions?: number
  negativeMarking: boolean
  sectionalCutoff: boolean
  eligibility: PrepCompanyEligibility
  sections: PrepCompanySection[]
  rounds: PrepCompanyRound[]
  /** Markdown: how to prepare, ordered strategy, what trips candidates up. */
  strategyMd: string
  /** Short bullet tips shown as chips / list. */
  quickTips: string[]
  /** Roles / CTC bands as commonly reported; phrased as ranges, not promises. */
  rolesMd?: string
  /** ISO date the pattern was last verified against public sources. */
  patternVerifiedOn: string
  /** Public sources consulted for the pattern (URLs). */
  sources: string[]
  status: 'draft' | 'in_review' | 'published'
  order: number
  updatedAt?: string
}

/** A granular sub-topic with its own short brief (rendered under the topic). */
export interface PrepSubtopic {
  id: string
  title: string
  /** 2-6 lines of Markdown: what it is, the key idea/formula, the exam angle. */
  briefMd: string
}

export interface PrepFormula {
  id: string
  label: string
  formula: string
  exampleQ: string
  exampleA: string
}

export interface PrepTrick {
  id: string
  title: string
  trick: string
  whenToUse: string
}

export interface PrepHowToSolve {
  id: string
  step: string
  detail: string
  questionType: string
}

export interface PyqTag {
  university: string
  year: number
  marks: 2 | 5 | 10
  semester?: number
}

export interface PrepTopicContent {
  explanationMd: string
  formulas: PrepFormula[]
  tricks: PrepTrick[]
  howToSolve: PrepHowToSolve[]
  moduleNumber?: number
  moduleName?: string
  /** Sub-topic titles (kept for the list views and legacy records). */
  subtopics?: string[]
  /** Sub-topics with briefs. When present, `subtopics` mirrors its titles. */
  subtopicDetails?: PrepSubtopic[]
  examFrequency?: 'very_high' | 'high' | 'moderate'
  pyqHighlights?: string[]
}

export interface PrepTopic extends PrepTopicContent {
  id: string
  subjectId: string
  title: string
  order: number
  difficulty: PrepDifficulty
  featuredQuestionIds: string[]
  status: PrepStatus
  generatedBy: 'ai-draft' | 'curator'
  contentVersion: number
  reviewedBy?: string | null
  publishedAt?: string | null
  tier: PrepTier
  /** Audience tags for shared (aptitude) topics. Absent => everyone. */
  audience?: PrepAudience[]
  updatedAt?: string
}

export interface PrepSubject {
  id: string
  name: string
  stream: PrepStream
  programs: string[] // ['bba', 'bcom', 'mba', ...]
  /** Catalogue this subject belongs to. Absent on legacy records => 'academic'. */
  track?: PrepTrack
  /** UG vs PG. Absent on legacy (BBA) records — inferred as undergraduate. */
  degreeLevel?: PrepDegreeLevel
  /** Academic year grouping; engineering programs may span four years. */
  yearGroup?: '1st-year' | '2nd-year' | '3rd-year' | '4th-year' | 'final-year' | 'pg-first-year' | 'pg-second-year'
  semester?: number // UG 1 to 8, PG 1 to 4
  universityRegion?: 'karnataka' | 'national'
  syllabusRef?: string
  icon: string
  order: number
  topicCount: number
  status: PrepStatus
  description?: string
  updatedAt?: string
}

export interface UniversalQuestion {
  id: string
  questionText: string
  options: string[]
  correctIndex: number
  explanation: string
  difficulty: PrepDifficulty
  status: 'approved' | 'pending' | 'rejected'
  prepTags: {
    subjectId: string
    topicIds: string[]
    stream?: string
    program?: string
  }
  pyqTag?: PyqTag
  tags?: string[]
  createdAt?: string
}

const VALID_STATUSES: PrepStatus[] = ['draft', 'in_review', 'published']

/**
 * Validates the state machine transitions for prep content authoring:
 * Draft → In Review → Published. Also allows curators to send back for
 * review or draft revision.
 */
export function validatePublishTransition(
  currentStatus?: string | null,
  nextStatus?: string | null
): { allowed: boolean; reason?: string } {
  if (!nextStatus || !VALID_STATUSES.includes(nextStatus as PrepStatus)) {
    return {
      allowed: false,
      reason: `Target status "${nextStatus}" is not a valid status (must be one of: ${VALID_STATUSES.join(', ')})`,
    }
  }

  // New document creation defaults to draft or in_review
  if (!currentStatus) {
    return { allowed: true }
  }

  if (!VALID_STATUSES.includes(currentStatus as PrepStatus)) {
    return {
      allowed: false,
      reason: `Current status "${currentStatus}" is invalid.`,
    }
  }

  // Idempotent
  if (currentStatus === nextStatus) {
    return { allowed: true }
  }

  // Draft can go to in_review or published (superadmin direct publish)
  if (currentStatus === 'draft') {
    return { allowed: true }
  }

  // In review can go to published or back to draft for rewrite
  if (currentStatus === 'in_review') {
    return { allowed: true }
  }

  // Published can be un-published back to in_review or draft for major updates
  if (currentStatus === 'published') {
    return { allowed: true }
  }

  return { allowed: false, reason: `Transition from ${currentStatus} to ${nextStatus} is not permitted.` }
}

/**
 * Accepts sub-topics as plain strings, as `{ title, briefMd }` objects, or a
 * mix of both, and returns the two synchronised shapes the topic stores:
 * `subtopics` (titles only, for list views and legacy readers) and
 * `subtopicDetails` (titles + briefs). Entries without a title are dropped.
 */
export function normaliseSubtopics(raw: unknown): {
  subtopics: string[]
  subtopicDetails: PrepSubtopic[]
} {
  const list = Array.isArray(raw) ? raw : []
  const details: PrepSubtopic[] = []
  list.forEach((entry: any, idx: number) => {
    if (typeof entry === 'string') {
      const title = entry.trim()
      if (title) details.push({ id: `sub-${idx + 1}`, title, briefMd: '' })
      return
    }
    if (entry && typeof entry === 'object') {
      const title = String(entry.title ?? entry.name ?? entry.label ?? '').trim()
      if (!title) return
      const briefMd = String(entry.briefMd ?? entry.brief ?? entry.summary ?? entry.description ?? '').trim()
      const id = String(entry.id || `sub-${idx + 1}`).trim() || `sub-${idx + 1}`
      details.push({ id, title, briefMd })
    }
  })
  const hasAnyBrief = details.some((d) => d.briefMd.length > 0)
  return {
    subtopics: details.map((d) => d.title),
    // Only persist the detailed shape when at least one brief exists, so a
    // plain string list round-trips unchanged.
    subtopicDetails: hasAnyBrief ? details : [],
  }
}

/**
 * Parses and validates structured AI or curator output into the 4 mandatory sections:
 * 1. explanationMd (Markdown content)
 * 2. formulas (Formula cards with example Q&A)
 * 3. tricks (Shortcuts, mnemonics & exam tricks)
 * 4. howToSolve (Step-by-step problem-solving framework)
 */
export function parsePrepDraft(raw: unknown): {
  valid: boolean
  data?: PrepTopicContent
  errors: string[]
} {
  const errors: string[] = []

  let parsed: any = raw
  if (typeof raw === 'string') {
    let cleaned = raw.trim()
    // Strip markdown code fences if LLM wrapped JSON in ```json ... ```
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    }
    try {
      parsed = JSON.parse(cleaned)
    } catch (e) {
      return {
        valid: false,
        errors: [`Invalid JSON output from generator: ${(e as Error).message}`],
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, errors: ['Generator output must be a JSON object.'] }
  }

  // 1. explanationMd
  const rawExplanation = parsed.explanationMd ?? parsed.explanation ?? parsed.contentMd
  let explanationMd = ''
  if (typeof rawExplanation === 'string' && rawExplanation.trim().length >= 30) {
    explanationMd = rawExplanation.trim()
  } else {
    errors.push('explanationMd must be a non-empty Markdown string (at least 30 characters).')
  }

  // 2. formulas
  const rawFormulas = Array.isArray(parsed.formulas) ? parsed.formulas : []
  const formulas: PrepFormula[] = rawFormulas.map((f: any, idx: number) => ({
    id: String(f?.id || `formula-${idx + 1}`),
    label: String(f?.label || f?.title || `Formula ${idx + 1}`).trim(),
    formula: String(f?.formula || f?.equation || '').trim(),
    exampleQ: String(f?.exampleQ || f?.exampleQuestion || f?.example || '').trim(),
    exampleA: String(f?.exampleA || f?.exampleAnswer || f?.solution || '').trim(),
  }))

  // 3. tricks
  const rawTricks = Array.isArray(parsed.tricks) ? parsed.tricks : []
  const tricks: PrepTrick[] = rawTricks.map((t: any, idx: number) => ({
    id: String(t?.id || `trick-${idx + 1}`),
    title: String(t?.title || t?.label || `Shortcut / Exam Tip ${idx + 1}`).trim(),
    trick: String(t?.trick || t?.description || t?.tip || '').trim(),
    whenToUse: String(t?.whenToUse || t?.context || 'Examination problem solving').trim(),
  }))

  // 4. howToSolve
  const rawHowToSolve = Array.isArray(parsed.howToSolve) ? parsed.howToSolve : []
  const howToSolve: PrepHowToSolve[] = rawHowToSolve.map((h: any, idx: number) => ({
    id: String(h?.id || `step-${idx + 1}`),
    step: String(h?.step || h?.title || `Step ${idx + 1}`).trim(),
    detail: String(h?.detail || h?.explanation || h?.description || '').trim(),
    questionType: String(h?.questionType || h?.category || 'Standard Examination Problem').trim(),
  }))

  // Optional module & subtopics metadata
  const moduleNumber = Number(parsed.moduleNumber) || undefined
  const moduleName = typeof parsed.moduleName === 'string' && parsed.moduleName.trim() ? parsed.moduleName.trim() : undefined
  const { subtopics, subtopicDetails } = normaliseSubtopics(
    parsed.subtopicDetails ?? parsed.subtopics
  )

  const examFrequency = ['very_high', 'high', 'moderate'].includes(parsed.examFrequency)
    ? parsed.examFrequency
    : undefined
  const rawPyq = Array.isArray(parsed.pyqHighlights) ? parsed.pyqHighlights : []
  const pyqHighlights = rawPyq
    .map((p: any) => (typeof p === 'string' ? p.trim() : String(p || '').trim()))
    .filter(Boolean)

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      explanationMd,
      formulas,
      tricks,
      howToSolve,
      ...(moduleNumber ? { moduleNumber } : {}),
      ...(moduleName ? { moduleName } : {}),
      ...(subtopics.length > 0 ? { subtopics } : {}),
      ...(subtopicDetails.length > 0 ? { subtopicDetails } : {}),
      ...(examFrequency ? { examFrequency } : {}),
      ...(pyqHighlights.length > 0 ? { pyqHighlights } : {}),
    },
    errors: [],
  }
}

/**
 * Samples practice questions without replacement up to `count` (clamped between 1 and 30).
 * If pool size <= requested count, returns a randomly shuffled copy of the whole pool.
 * If pool is empty, returns empty array without throwing.
 */
export function samplePracticeQuestions<T>(
  questions: T[],
  requestedCount: number,
  rng: () => number = Math.random
): T[] {
  if (!Array.isArray(questions) || questions.length === 0) {
    return []
  }

  const desired = Number.isFinite(requestedCount) && requestedCount > 0
    ? Math.min(Math.max(1, Math.floor(requestedCount)), 30)
    : 10

  const targetCount = Math.min(desired, questions.length)

  // Fisher-Yates partial shuffle
  const copy = [...questions]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const temp = copy[i]
    copy[i] = copy[j]
    copy[j] = temp
  }

  return copy.slice(0, targetCount)
}

/**
 * Builds the academic AI system prompt for generating comprehensive BBA/Commerce
 * Prep topic content.
 */
export function buildPrepAiPrompt(opts: {
  subjectName: string
  topicTitle: string
  stream?: string
  difficulty?: string
  program?: string
  moduleName?: string
  semester?: number
  universityRegion?: 'karnataka' | 'national'
}): string {
  const {
    subjectName,
    topicTitle,
    stream = 'management',
    difficulty = 'core',
    program = 'bba',
    moduleName,
    semester,
    universityRegion = 'karnataka',
  } = opts

  const regionContext =
    universityRegion === 'karnataka'
      ? 'Karnataka State Higher Education Council (KSHEC NEP 2020 CBCS model, Bangalore University BU/BCU/BNU, Mysore University UOM, VTU, Mangalore University)'
      : 'UGC National Curriculum Framework (NEP 2020)'

  return `You are an expert university professor and lead curriculum author for undergraduate & postgraduate commerce and management (${program.toUpperCase()} under ${regionContext}).

Generate a complete, high-yield, structured Study Guide for:
Subject: "${subjectName}" ${semester ? `(Semester ${semester})` : ''}
${moduleName ? `Module: "${moduleName}"` : ''}
Topic: "${topicTitle}"
Academic Stream: "${stream}"
Difficulty Level: "${difficulty}"

You MUST output ONLY a valid JSON object matching this schema with NO markdown code fences and NO conversational filler:
{
  "subtopics": [
    { "title": "Granular subtopic 1 covering fundamental definition and scope", "briefMd": "3-5 line Markdown brief: what it is, the key idea or formula, and how examiners test it" },
    { "title": "Granular subtopic 2 covering core analytical framework or mechanism", "briefMd": "3-5 line Markdown brief" },
    { "title": "Granular subtopic 3 covering practical corporate application", "briefMd": "3-5 line Markdown brief" },
    { "title": "Granular subtopic 4 covering examination pitfalls and model answers", "briefMd": "3-5 line Markdown brief" }
  ],
  "explanationMd": "# Comprehensive Markdown Explanation\\n\\n### Core Concept & Intuition\\nExplain the concept clearly with high academic rigour, accompanied by an intuitive modern business case analogy (e.g. Tata, Reliance, Infosys, Zomato, Apple).\\n\\n### Key Principles & Frameworks\\nBreak down the essential principles, rules, or components systematically using bullet points, comparison tables, or clear headings.\\n\\n### Real-World Business Application\\nHow corporate leaders, accountants, financial analysts, or operations managers apply this in practice in India.\\n\\n### Examination Focus & Model Structure\\nKey points university examiners award full marks for in 5-mark and 10-mark questions.",
  "formulas": [
    {
      "id": "formula-1",
      "label": "Formula / Governing Equation / Journal Entry Rule",
      "formula": "Standard mathematical equation or accounting rule (e.g. P/V Ratio = (Contribution / Sales) * 100)",
      "exampleQ": "A clear, realistic numerical or practical question",
      "exampleA": "Step-by-step solution showing working and final answer"
    }
  ],
  "tricks": [
    {
      "id": "trick-1",
      "title": "Mnemonic or Quick-Recall Shortcut",
      "trick": "The exact mnemonic, shortcut method, or mental model to recall or compute this quickly without errors",
      "whenToUse": "When to apply this in exams or case study analysis"
    }
  ],
  "howToSolve": [
    {
      "id": "step-1",
      "step": "Step 1: Identify Given Data & Key Constraints",
      "detail": "Detailed explanation of what to extract first from the question scenario",
      "questionType": "Numerical calculation / 10-Mark Analytical Question"
    },
    {
      "id": "step-2",
      "step": "Step 2: Apply Governing Rule or Formula",
      "detail": "How to execute the computation or structure the analytical argument",
      "questionType": "Numerical calculation / 10-Mark Analytical Question"
    },
    {
      "id": "step-3",
      "step": "Step 3: Verification & Concluding Interpretation",
      "detail": "Final check and required managerial interpretation",
      "questionType": "Numerical calculation / 10-Mark Analytical Question"
    }
  ]
}

Note: For theoretical subjects (like Business Law or Principles of Management), in "formulas" you can provide legal maxims, journal entry rules, or core analytical equations.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-program catalog layer (UG + PG, Karnataka NEP 2020 / CBCS)
//
// Everything below is pure data + pure functions so the seeding controller and
// the node:test integrity suite share one source of truth.
// ─────────────────────────────────────────────────────────────────────────────

export type PrepDegreeLevel = 'undergraduate' | 'postgraduate'

export interface PrepProgramInfo {
  /** Lowercase canonical program code used in PrepSubject.programs / seed APIs. */
  code: string
  /** Human label shown in the Prep App program selector. */
  label: string
  degreeLevel: PrepDegreeLevel
  /** Full degree name, used for the AI authoring prompt context. */
  fullName: string
}

/**
 * Canonical program catalog for the Vriddhi Prep platform.
 * UG: BBA, B.Com, BCA, B.Sc, BA, CSE, ECE, EEE, ME  |  PG: MBA, M.Com, MCA
 */
export const PREP_PROGRAM_CATALOG: PrepProgramInfo[] = [
  { code: 'bba', label: 'BBA', degreeLevel: 'undergraduate', fullName: 'Bachelor of Business Administration' },
  { code: 'bcom', label: 'B.Com', degreeLevel: 'undergraduate', fullName: 'Bachelor of Commerce' },
  { code: 'bca', label: 'BCA', degreeLevel: 'undergraduate', fullName: 'Bachelor of Computer Applications' },
  { code: 'bsc', label: 'B.Sc', degreeLevel: 'undergraduate', fullName: 'Bachelor of Science' },
  { code: 'ba', label: 'BA', degreeLevel: 'undergraduate', fullName: 'Bachelor of Arts' },
  { code: 'cse', label: 'CSE', degreeLevel: 'undergraduate', fullName: 'Bachelor of Engineering / Technology in Computer Science and Engineering' },
  { code: 'ece', label: 'ECE', degreeLevel: 'undergraduate', fullName: 'Bachelor of Engineering / Technology in Electronics and Communication Engineering' },
  { code: 'eee', label: 'EEE', degreeLevel: 'undergraduate', fullName: 'Bachelor of Engineering / Technology in Electrical and Electronics Engineering' },
  { code: 'me', label: 'ME', degreeLevel: 'undergraduate', fullName: 'Bachelor of Engineering / Technology in Mechanical Engineering' },
  { code: 'mba', label: 'MBA', degreeLevel: 'postgraduate', fullName: 'Master of Business Administration' },
  { code: 'mcom', label: 'M.Com', degreeLevel: 'postgraduate', fullName: 'Master of Commerce' },
  { code: 'mca', label: 'MCA', degreeLevel: 'postgraduate', fullName: 'Master of Computer Applications' },
]

/** Lowercase program codes, e.g. ['bba', 'bcom', ...]. */
export const PREP_PROGRAM_CODES: string[] = PREP_PROGRAM_CATALOG.map((p) => p.code)

/**
 * Non-program catalogues that can also be seeded. 'aptitude' is the shared
 * placement bundle (Quantitative Aptitude, Logical Reasoning, Verbal Ability);
 * 'universal' is cross-program concept mastery; 'companies' are company
 * placement guides; 'papers' are previous-year university question papers.
 */
export const PREP_TRACK_SEED_CODES: string[] = ['aptitude', 'companies', 'papers', 'universal', 'pyq-files']

/** Everything `/prep/seed-all` understands: program codes + track bundles. */
export const PREP_SEED_CODES: string[] = [...PREP_PROGRAM_CODES, ...PREP_TRACK_SEED_CODES]

/** Normalises a subject's catalogue; legacy records without the field are academic. */
export function effectiveTrack(subject?: { track?: PrepTrack | string | null } | null): PrepTrack {
  const t = subject?.track
  return t === 'aptitude' || t === 'company' ? t : 'academic'
}

export function getPrepProgramInfo(code?: string | null): PrepProgramInfo | null {
  if (!code) return null
  const norm = code.toLowerCase().trim()
  return PREP_PROGRAM_CATALOG.find((p) => p.code === norm) || null
}

export function getPrepProgramsForLevel(level?: PrepDegreeLevel | string | null): PrepProgramInfo[] {
  if (!level || level === 'all') return [...PREP_PROGRAM_CATALOG]
  const norm = String(level).toLowerCase().trim()
  return PREP_PROGRAM_CATALOG.filter((p) => p.degreeLevel === norm)
}

export function resolveProgramDegreeLevel(code?: string | null): PrepDegreeLevel | null {
  return getPrepProgramInfo(code)?.degreeLevel ?? null
}


/**
 * Normalises a subject's effective degree level. Subjects authored before the
 * multi-program layer (BBA) omit the field and are treated as undergraduate.
 */
export function effectiveDegreeLevel(subject?: {
  degreeLevel?: PrepDegreeLevel | string | null
  programs?: string[] | null
} | null): PrepDegreeLevel {
  if (!subject) return 'undergraduate'
  if (subject.degreeLevel === 'postgraduate' || subject.degreeLevel === 'undergraduate') {
    return subject.degreeLevel
  }
  // Infer from the program catalog when the field is absent.
  const inferred = (subject.programs || [])
    .map((p) => resolveProgramDegreeLevel(p))
    .find((lvl): lvl is PrepDegreeLevel => lvl === 'postgraduate')
  return inferred ?? 'undergraduate'
}

/**
 * Splits an array into chunks no larger than `size`. Used to keep every
 * Firestore batch under the 500-writes-per-commit hard limit.
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (!Array.isArray(items) || items.length === 0) return []
  const width = Number.isFinite(size) && size > 0 ? Math.floor(size) : 1
  const out: T[][] = []
  for (let i = 0; i < items.length; i += width) {
    out.push(items.slice(i, i + width))
  }
  return out
}

/**
 * Resolves which programs a `/prep/seed-all` request should seed.
 * Accepts: nothing (=> all), 'all', a CSV string, or an array of codes.
 * Unknown codes are reported as errors rather than silently dropped.
 */
export function resolveSeedPrograms(
  input?: unknown
): { programs: string[]; all: boolean; errors: string[] } {
  const errors: string[] = []

  if (input === undefined || input === null || input === '') {
    return { programs: [...PREP_SEED_CODES], all: true, errors }
  }

  let rawList: unknown[] = []
  if (Array.isArray(input)) {
    rawList = input
  } else if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed || trimmed.toLowerCase() === 'all') {
      return { programs: [...PREP_SEED_CODES], all: true, errors }
    }
    rawList = trimmed.split(',')
  } else {
    return {
      programs: [],
      all: false,
      errors: ['programs must be a program code, a comma-separated list, or an array of codes.'],
    }
  }

  const resolved: string[] = []
  for (const entry of rawList) {
    const code = String(entry ?? '').toLowerCase().trim()
    if (!code) continue
    if (code === 'all') {
      return { programs: [...PREP_SEED_CODES], all: true, errors }
    }
    if (!PREP_SEED_CODES.includes(code)) {
      errors.push(`Unknown program "${String(entry)}". Valid codes: ${PREP_SEED_CODES.join(', ')}.`)
      continue
    }
    if (!resolved.includes(code)) resolved.push(code)
  }

  if (errors.length > 0 && resolved.length === 0) {
    return { programs: [], all: false, errors }
  }
  return { programs: resolved, all: false, errors }
}

/**
 * Filters a catalog's subjects down to the ones actually belonging to the
 * requested programs, plus the topics/questions that hang off them. Used by
 * the seed controller so `?programs=mcom` never touches the BBA catalog.
 */
export function filterCatalogByPrograms<T extends { programs?: string[] | null }>(
  subjects: T[],
  programs: string[]
): T[] {
  if (!Array.isArray(subjects)) return []
  if (!Array.isArray(programs) || programs.length === 0) return [...subjects]
  const wanted = programs.map((p) => p.toLowerCase().trim())
  return subjects.filter((s) =>
    (s.programs || []).some((p) => wanted.includes(String(p).toLowerCase().trim()))
  )
}

export interface PrepCatalogBundle {
  programCode: string
  subjects: PrepSubject[]
  topics: Record<string, PrepTopic[]>
  questions: UniversalQuestion[]
}

export interface CatalogIssue {
  level: 'error' | 'warning'
  code: string
  message: string
}

export interface CatalogIntegrityReport {
  programCode: string
  subjectCount: number
  topicCount: number
  questionCount: number
  issues: CatalogIssue[]
  errorCount: number
  warningCount: number
  valid: boolean
}

/**
 * Verifies referential integrity of a seeded curriculum bundle:
 *  - unique subject / topic / question ids
 *  - subject.topicCount matches the number of topics actually authored
 *  - every topic.subjectId matches the record it is filed under
 *  - every topic carries the 4 mandatory PrepInsta sections
 *  - every featuredQuestionId points at a real question
 *  - every question's prepTags.subjectId / topicIds resolve inside the bundle
 *  - MCQ options are well-formed and correctIndex is in range
 */
export function validatePrepCatalog(bundle: PrepCatalogBundle): CatalogIntegrityReport {
  const issues: CatalogIssue[] = []
  const err = (code: string, message: string) => issues.push({ level: 'error', code, message })
  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message })

  const subjects = Array.isArray(bundle?.subjects) ? bundle.subjects : []
  const topicsBySubject = bundle?.topics && typeof bundle.topics === 'object' ? bundle.topics : {}
  const questions = Array.isArray(bundle?.questions) ? bundle.questions : []

  // ── Subjects ──
  const subjectIds = new Set<string>()
  for (const subject of subjects) {
    if (!subject?.id) {
      err('SUBJECT_MISSING_ID', 'A subject is missing its id.')
      continue
    }
    if (subjectIds.has(subject.id)) {
      err('DUPLICATE_SUBJECT_ID', `Duplicate subject id "${subject.id}".`)
    }
    subjectIds.add(subject.id)

    if (!subject.name?.trim()) {
      err('SUBJECT_MISSING_NAME', `Subject "${subject.id}" has no name.`)
    }
    if (!Array.isArray(subject.programs) || subject.programs.length === 0) {
      err('SUBJECT_NO_PROGRAMS', `Subject "${subject.id}" declares no programs.`)
    }
    if (typeof subject.order !== 'number') {
      err('SUBJECT_BAD_ORDER', `Subject "${subject.id}" has a non-numeric order.`)
    }

    const authored = topicsBySubject[subject.id]
    if (!Array.isArray(authored) || authored.length === 0) {
      err('SUBJECT_NO_TOPICS', `Subject "${subject.id}" has no topics authored.`)
      continue
    }
    if (subject.topicCount !== authored.length) {
      err(
        'TOPIC_COUNT_MISMATCH',
        `Subject "${subject.id}" declares topicCount ${subject.topicCount} but ${authored.length} topics are authored.`
      )
    }
  }

  // Orphan topic buckets (keyed under a subject id that was never declared).
  for (const key of Object.keys(topicsBySubject)) {
    if (!subjectIds.has(key)) {
      err('ORPHAN_TOPIC_BUCKET', `Topics are filed under unknown subject id "${key}".`)
    }
  }

  // ── Topics ──
  const topicIds = new Set<string>()
  let topicCount = 0
  for (const [subjectId, list] of Object.entries(topicsBySubject)) {
    for (const topic of list || []) {
      topicCount++
      if (!topic?.id) {
        err('TOPIC_MISSING_ID', `A topic under subject "${subjectId}" is missing its id.`)
        continue
      }
      if (topicIds.has(topic.id)) {
        err('DUPLICATE_TOPIC_ID', `Duplicate topic id "${topic.id}".`)
      }
      topicIds.add(topic.id)

      if (topic.subjectId !== subjectId) {
        err(
          'TOPIC_SUBJECT_MISMATCH',
          `Topic "${topic.id}" declares subjectId "${topic.subjectId}" but is filed under "${subjectId}".`
        )
      }
      if (!topic.title?.trim()) {
        err('TOPIC_MISSING_TITLE', `Topic "${topic.id}" has no title.`)
      }
      if (typeof topic.explanationMd !== 'string' || topic.explanationMd.trim().length < 30) {
        err('TOPIC_SHORT_EXPLANATION', `Topic "${topic.id}" explanationMd is missing or under 30 characters.`)
      }
      if (!Array.isArray(topic.formulas) || topic.formulas.length === 0) {
        err('TOPIC_NO_FORMULAS', `Topic "${topic.id}" has no formulas section.`)
      }
      if (!Array.isArray(topic.tricks) || topic.tricks.length === 0) {
        err('TOPIC_NO_TRICKS', `Topic "${topic.id}" has no tricks section.`)
      }
      if (!Array.isArray(topic.howToSolve) || topic.howToSolve.length === 0) {
        err('TOPIC_NO_HOW_TO_SOLVE', `Topic "${topic.id}" has no howToSolve section.`)
      }
      if (!Array.isArray(topic.featuredQuestionIds) || topic.featuredQuestionIds.length === 0) {
        warn('TOPIC_NO_FEATURED_QUESTIONS', `Topic "${topic.id}" features no practice questions.`)
      }
      if (topic.subtopicDetails !== undefined) {
        if (!Array.isArray(topic.subtopicDetails)) {
          err('TOPIC_BAD_SUBTOPIC_DETAILS', `Topic "${topic.id}" subtopicDetails must be an array.`)
        } else {
          const seen = new Set<string>()
          for (const sub of topic.subtopicDetails) {
            if (!sub?.id || !sub?.title?.trim()) {
              err('SUBTOPIC_MISSING_ID_OR_TITLE', `Topic "${topic.id}" has a sub-topic without id/title.`)
              continue
            }
            if (seen.has(sub.id)) {
              err('DUPLICATE_SUBTOPIC_ID', `Topic "${topic.id}" repeats sub-topic id "${sub.id}".`)
            }
            seen.add(sub.id)
            if (typeof sub.briefMd !== 'string' || sub.briefMd.trim().length < 20) {
              warn('SUBTOPIC_SHORT_BRIEF', `Sub-topic "${sub.id}" of topic "${topic.id}" has no brief (under 20 characters).`)
            }
          }
          const titles = topic.subtopicDetails.map((d) => d.title)
          if (Array.isArray(topic.subtopics) && topic.subtopics.join('\u0001') !== titles.join('\u0001')) {
            warn('SUBTOPICS_OUT_OF_SYNC', `Topic "${topic.id}" subtopics[] does not mirror subtopicDetails titles.`)
          }
        }
      }
    }
  }

  // ── Questions ──
  const questionIds = new Set<string>()
  for (const q of questions) {
    if (!q?.id) {
      err('QUESTION_MISSING_ID', 'A question is missing its id.')
      continue
    }
    if (questionIds.has(q.id)) {
      err('DUPLICATE_QUESTION_ID', `Duplicate question id "${q.id}".`)
    }
    questionIds.add(q.id)

    if (!q.questionText?.trim()) {
      err('QUESTION_NO_TEXT', `Question "${q.id}" has no questionText.`)
    }
    if (!Array.isArray(q.options) || q.options.length < 2) {
      err('QUESTION_BAD_OPTIONS', `Question "${q.id}" needs at least 2 options.`)
    } else if (
      !Number.isInteger(q.correctIndex) ||
      q.correctIndex < 0 ||
      q.correctIndex >= q.options.length
    ) {
      err(
        'QUESTION_BAD_CORRECT_INDEX',
        `Question "${q.id}" correctIndex ${q.correctIndex} is out of range for ${q.options.length} options.`
      )
    }
    if (!q.explanation?.trim()) {
      err('QUESTION_NO_EXPLANATION', `Question "${q.id}" has no explanation.`)
    }

    const tags = q.prepTags || ({} as UniversalQuestion['prepTags'])
    if (tags.subjectId && !subjectIds.has(tags.subjectId)) {
      err(
        'QUESTION_UNKNOWN_SUBJECT',
        `Question "${q.id}" is tagged with unknown subjectId "${tags.subjectId}".`
      )
    }
    for (const topicId of tags.topicIds || []) {
      if (!topicIds.has(topicId)) {
        err('QUESTION_UNKNOWN_TOPIC', `Question "${q.id}" is tagged with unknown topicId "${topicId}".`)
      }
    }
  }

  // ── Featured question references ──
  for (const [, list] of Object.entries(topicsBySubject)) {
    for (const topic of list || []) {
      for (const qid of topic?.featuredQuestionIds || []) {
        if (!questionIds.has(qid)) {
          err(
            'FEATURED_QUESTION_MISSING',
            `Topic "${topic.id}" features unknown question id "${qid}".`
          )
        }
      }
    }
  }

  const errorCount = issues.filter((i) => i.level === 'error').length
  return {
    programCode: bundle?.programCode || 'unknown',
    subjectCount: subjects.length,
    topicCount,
    questionCount: questions.length,
    issues,
    errorCount,
    warningCount: issues.length - errorCount,
    valid: errorCount === 0,
  }
}

// ── Company catalogue integrity ─────────────────────────────────────────────

export interface CompanyCatalogBundle {
  companies: PrepCompany[]
  /** Every aptitude topic id the company sections may reference. */
  knownTopicIds: Set<string> | string[]
}

/**
 * Verifies a company-prep bundle: unique codes, well-formed sections / rounds,
 * every mapped topic id resolves to a seeded aptitude topic, every section
 * that claims catalogue coverage actually maps at least one topic, and the
 * eligibility programs are valid catalogue codes.
 */
export function validateCompanyCatalog(bundle: CompanyCatalogBundle): CatalogIntegrityReport {
  const issues: CatalogIssue[] = []
  const err = (code: string, message: string) => issues.push({ level: 'error', code, message })
  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message })

  const companies = Array.isArray(bundle?.companies) ? bundle.companies : []
  const known = bundle?.knownTopicIds instanceof Set ? bundle.knownTopicIds : new Set(bundle?.knownTopicIds || [])
  const codes = new Set<string>()

  for (const c of companies) {
    if (!c?.code || !/^[a-z0-9-]+$/.test(c.code)) {
      err('COMPANY_BAD_CODE', `Company "${c?.name || '?'}" needs a lowercase URL-safe code.`)
      continue
    }
    if (codes.has(c.code)) err('DUPLICATE_COMPANY_CODE', `Duplicate company code "${c.code}".`)
    codes.add(c.code)

    if (!c.name || !c.testName) err('COMPANY_MISSING_NAME', `Company "${c.code}" needs name and testName.`)
    if (!c.strategyMd || c.strategyMd.trim().length < 200) {
      err('COMPANY_THIN_STRATEGY', `Company "${c.code}" strategyMd is under 200 characters.`)
    }
    if (!Array.isArray(c.audience) || c.audience.length === 0) {
      err('COMPANY_NO_AUDIENCE', `Company "${c.code}" has no audience.`)
    }
    if (!c.patternVerifiedOn || Number.isNaN(Date.parse(c.patternVerifiedOn))) {
      err('COMPANY_BAD_VERIFIED_DATE', `Company "${c.code}" patternVerifiedOn must be an ISO date.`)
    }
    if (!Array.isArray(c.sources) || c.sources.length === 0) {
      warn('COMPANY_NO_SOURCES', `Company "${c.code}" lists no public sources for its pattern.`)
    }

    const programs = c.eligibility?.programs || []
    if (programs.length === 0) err('COMPANY_NO_PROGRAMS', `Company "${c.code}" eligibility lists no programs.`)
    for (const p of programs) {
      if (!PREP_PROGRAM_CODES.includes(p)) err('COMPANY_UNKNOWN_PROGRAM', `Company "${c.code}" eligibility has unknown program "${p}".`)
    }

    const sectionIds = new Set<string>()
    if (!Array.isArray(c.sections) || c.sections.length === 0) {
      err('COMPANY_NO_SECTIONS', `Company "${c.code}" has no sections.`)
    }
    let mappedAny = false
    for (const sec of c.sections || []) {
      if (!sec.id || sectionIds.has(sec.id)) err('COMPANY_BAD_SECTION_ID', `Company "${c.code}" has a missing/duplicate section id "${sec.id}".`)
      sectionIds.add(sec.id)
      if (!sec.name) err('COMPANY_SECTION_NO_NAME', `Company "${c.code}" section "${sec.id}" has no name.`)
      const ids = Array.isArray(sec.topicIds) ? sec.topicIds : []
      for (const tid of ids) {
        if (!known.has(tid)) err('COMPANY_UNKNOWN_TOPIC', `Company "${c.code}" section "${sec.id}" maps unknown topic "${tid}".`)
      }
      if (new Set(ids).size !== ids.length) warn('COMPANY_DUP_TOPIC', `Company "${c.code}" section "${sec.id}" repeats a topic id.`)
      if (sec.coverage === 'catalogue' && ids.length === 0) {
        err('COMPANY_SECTION_UNMAPPED', `Company "${c.code}" section "${sec.id}" claims catalogue coverage but maps no topics.`)
      }
      if (sec.coverage !== 'catalogue' && !(sec.coverageNote && sec.coverageNote.trim().length >= 20)) {
        warn('COMPANY_SECTION_NO_COVERAGE_NOTE', `Company "${c.code}" section "${sec.id}" is ${sec.coverage} but has no coverage note.`)
      }
      if (ids.length > 0) mappedAny = true
    }
    if (!mappedAny) err('COMPANY_NOTHING_MAPPED', `Company "${c.code}" maps no aptitude topics at all.`)

    const roundIds = new Set<string>()
    if (!Array.isArray(c.rounds) || c.rounds.length === 0) warn('COMPANY_NO_ROUNDS', `Company "${c.code}" lists no rounds.`)
    for (const r of c.rounds || []) {
      if (!r.id || roundIds.has(r.id)) err('COMPANY_BAD_ROUND_ID', `Company "${c.code}" has a missing/duplicate round id "${r.id}".`)
      roundIds.add(r.id)
      if (!r.name || !r.detail) err('COMPANY_ROUND_INCOMPLETE', `Company "${c.code}" round "${r.id}" needs name and detail.`)
    }
  }

  const errorCount = issues.filter((i) => i.level === 'error').length
  const warningCount = issues.length - errorCount
  return {
    programCode: 'companies',
    subjectCount: companies.length,
    topicCount: companies.reduce((n, c) => n + (c.sections || []).length, 0),
    questionCount: 0,
    issues,
    errorCount,
    warningCount,
    valid: errorCount === 0,
  }
}

/**
 * Collects the distinct aptitude topic ids a company tests, most-frequent
 * first (section order, then position within the section). Used to build the
 * "topics to prepare" checklist and to sample a company mock.
 */
export function companyTopicIds(company: Pick<PrepCompany, 'sections'>): string[] {
  const out: string[] = []
  for (const sec of company?.sections || []) {
    for (const tid of sec.topicIds || []) if (!out.includes(tid)) out.push(tid)
  }
  return out
}

// ─── Company prep: per-college visibility ────────────────────────────────────
//
// Company guides are authored once for the platform, but a college may not
// want all of them (or any of them) in front of its learners — a commerce
// college might hide Capgemini, a college running its own drive might hide
// the whole strip until placements start. The decision lives per college at
// colleges/{collegeId}/config/prep → companyPrep and is applied server-side
// on every company endpoint, so a hidden guide is hidden on deep links too.

export interface CompanyPrepSettings {
  /** Master switch: false hides the entire company-prep section for the college. */
  enabled: boolean
  /** Company codes hidden for this college (ignored when enabled is false). */
  hiddenCompanies: string[]
  updatedAt?: string
  updatedBy?: string
}

export const DEFAULT_COMPANY_PREP_SETTINGS: CompanyPrepSettings = { enabled: true, hiddenCompanies: [] }

/** Coerce whatever is stored (or posted) into a well-formed settings object. */
export function normaliseCompanyPrepSettings(raw: unknown): CompanyPrepSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const enabled = src.enabled === undefined ? true : Boolean(src.enabled)
  const hidden = Array.isArray(src.hiddenCompanies) ? src.hiddenCompanies : []
  const hiddenCompanies = Array.from(
    new Set(
      hidden
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.toLowerCase().trim())
        .filter((c) => /^[a-z0-9-]+$/.test(c)),
    ),
  )
  const out: CompanyPrepSettings = { enabled, hiddenCompanies }
  if (typeof src.updatedAt === 'string') out.updatedAt = src.updatedAt
  if (typeof src.updatedBy === 'string') out.updatedBy = src.updatedBy
  return out
}

/** Filter a company list down to what a college's learners may see. */
export function applyCompanyPrepSettings<T extends { code: string }>(
  companies: T[],
  settings: CompanyPrepSettings | null | undefined,
): T[] {
  if (!settings) return companies
  if (!settings.enabled) return []
  if (settings.hiddenCompanies.length === 0) return companies
  const hidden = new Set(settings.hiddenCompanies)
  return companies.filter((c) => !hidden.has(c.code))
}

/** True when a single company is visible under the given settings. */
export function isCompanyVisibleForCollege(code: string, settings: CompanyPrepSettings | null | undefined): boolean {
  return applyCompanyPrepSettings([{ code }], settings).length === 1
}
