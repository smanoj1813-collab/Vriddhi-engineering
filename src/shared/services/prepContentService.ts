// src/shared/services/prepContentService.ts
//
// Client service for the PrepInsta-style Prep-Content platform
// (university study packs and placement-preparation catalogues).
// Uses apiBase to resolve the Cloud Function endpoint and authedFetch.

import { apiUrl, assertJsonResponse } from '@/shared/api/apiBase'

/**
 * 'academic' = university-syllabus subjects scoped to a program/semester.
 * 'aptitude' = placement-prep catalogues (QA / LR / Verbal) shared by every
 * program. Legacy subjects without a track are academic.
 */
export type PrepTrack = 'academic' | 'aptitude' | 'company'

/** Which learners a topic is primarily aimed at (aptitude track only). */
export type PrepAudience = 'ug' | 'pg' | 'tech'

export interface PrepSubtopic {
  id: string
  title: string
  briefMd: string
}

export interface PrepSubject {
  id: string
  name: string
  stream: 'commerce' | 'management' | 'aptitude' | 'communication' | 'economics' | 'finance' | 'law' | 'strategy' | 'operations' | 'taxation' | 'computing' | 'electronics'
  programs: string[]
  track?: PrepTrack
  degreeLevel?: 'undergraduate' | 'postgraduate'
  yearGroup?: '1st-year' | '2nd-year' | '3rd-year' | '4th-year' | 'final-year' | 'pg-first-year' | 'pg-second-year'
  semester?: number
  universityRegion?: 'karnataka' | 'national'
  syllabusRef?: string
  icon: string
  order: number
  topicCount: number
  status: 'draft' | 'in_review' | 'published'
  description?: string
  updatedAt?: string
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

export interface PrepTopic {
  id: string
  subjectId: string
  title: string
  order: number
  difficulty: 'basic' | 'core' | 'advanced'
  moduleNumber?: number
  moduleName?: string
  subtopics?: string[]
  /** Sub-topics with a short brief each; `subtopics` mirrors the titles. */
  subtopicDetails?: PrepSubtopic[]
  examFrequency?: 'very_high' | 'high' | 'moderate'
  pyqHighlights?: string[]
  audience?: PrepAudience[]
  explanationMd: string
  formulas: PrepFormula[]
  tricks: PrepTrick[]
  howToSolve: PrepHowToSolve[]
  featuredQuestionIds: string[]
  status: 'draft' | 'in_review' | 'published'
  generatedBy: 'ai-draft' | 'curator'
  contentVersion: number
  reviewedBy?: string | null
  publishedAt?: string | null
  tier: 'free' | 'premium'
  updatedAt?: string
}

export interface UniversalQuestion {
  id: string
  questionText: string
  options: string[]
  correctIndex: number
  explanation: string
  difficulty: 'basic' | 'core' | 'advanced'
  status: 'approved' | 'pending' | 'rejected'
  prepTags: {
    subjectId: string
    topicIds: string[]
    stream?: string
    program?: string
  }
}

// ── Company-specific placement prep (mirrors functions/src/prepShared.ts) ──

export interface PrepCompanySection {
  id: string
  name: string
  questions?: number
  minutes?: number
  note?: string
  topicIds: string[]
  coverage: 'catalogue' | 'partial' | 'external'
  coverageNote?: string
}

export interface PrepCompanyRound {
  id: string
  name: string
  detail: string
  eliminator?: boolean
}

export interface PrepCompanyEligibility {
  programs: string[]
  degrees: string
  minPercentage?: string
  backlogs?: string
  gap?: string
  age?: string
  note?: string
}

export interface PrepCompany {
  code: string
  name: string
  testName: string
  tagline: string
  audience: PrepAudience[]
  tier: 'mass' | 'premium'
  platform?: string
  totalMinutes?: number
  totalQuestions?: number
  negativeMarking: boolean
  sectionalCutoff: boolean
  eligibility: PrepCompanyEligibility
  sections: PrepCompanySection[]
  rounds: PrepCompanyRound[]
  strategyMd?: string
  quickTips: string[]
  rolesMd?: string
  patternVerifiedOn: string
  sources: string[]
  status: 'draft' | 'in_review' | 'published'
  order: number
  updatedAt?: string
  /** List endpoint only: number of distinct aptitude topics mapped. */
  topicCount?: number
}

/** Lightweight topic card returned with a company guide. */
export interface PrepCompanyTopicCard {
  id: string
  subjectId: string
  title: string
  moduleName?: string
  difficulty: string
  examFrequency?: string
  subtopicCount: number
}

export type PrepCompanyMockQuestion = UniversalQuestion & { sectionId: string; sectionName: string }

export interface LearnerProgressData {
  topicsCompleted?: Record<
    string,
    {
      lastVisitedAt: string
      visitedTabs: string[]
      completed?: boolean
      quizScore?: number
      quizTotal?: number
      quizCompletedAt?: string
    }
  >
  updatedAt?: string
}

async function getBearerToken(): Promise<string | null> {
  const stored =
    localStorage.getItem('token') ||
    sessionStorage.getItem('token') ||
    localStorage.getItem('vriddhi_auth_token')
  if (stored) return stored
  try {
    const { auth } = await import('@/Firebase/config')
    if (auth.currentUser) return await auth.currentUser.getIdToken()
  } catch {}
  return null
}

async function authedFetch(endpoint: string, init: RequestInit = {}): Promise<Response> {
  const token = await getBearerToken()
  const url = apiUrl(endpoint)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const response = await fetch(url, {
    ...init,
    headers,
  })
  await assertJsonResponse(response, url)
  return response
}

export async function fetchPrepSubjects(params?: {
  program?: string
  stream?: string
  yearGroup?: string
}): Promise<PrepSubject[]> {
  const qs = new URLSearchParams()
  if (params?.program) qs.set('program', params.program)
  if (params?.stream) qs.set('stream', params.stream)
  if (params?.yearGroup) qs.set('yearGroup', params.yearGroup)

  const res = await authedFetch(`/prep/subjects${qs.toString() ? `?${qs.toString()}` : ''}`, { method: 'GET' })
  const data = await res.json()
  return data.data || []
}

export async function fetchPrepSubject(subjectId: string): Promise<PrepSubject> {
  const res = await authedFetch(`/prep/subjects/${encodeURIComponent(subjectId)}`, { method: 'GET' })
  const data = await res.json()
  return data.data
}

export async function fetchPrepTopics(subjectId: string): Promise<PrepTopic[]> {
  const res = await authedFetch(`/prep/subjects/${encodeURIComponent(subjectId)}/topics`, { method: 'GET' })
  const data = await res.json()
  return data.data || []
}

export async function fetchPrepTopic(subjectId: string, topicId: string): Promise<PrepTopic> {
  const res = await authedFetch(`/prep/subjects/${encodeURIComponent(subjectId)}/topics/${encodeURIComponent(topicId)}`, { method: 'GET' })
  const data = await res.json()
  return data.data
}

export async function generatePrepDraft(payload: {
  subjectId: string
  topicId: string
  title: string
  stream?: string
  difficulty?: string
  program?: string
}): Promise<{ data: PrepTopic; provider: string; tokensIn: number; tokensOut: number }> {
  const res = await authedFetch('/prep/content/draft', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function publishPrepTopic(payload: {
  subjectId: string
  topicId: string
}): Promise<{ success: boolean; message: string; publishedCount: number }> {
  const res = await authedFetch('/prep/content/publish', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function savePrepTopic(
  payload: Partial<PrepTopic> & { subjectId: string; topicId: string }
): Promise<{ success: boolean; data: PrepTopic }> {
  const res = await authedFetch('/prep/content/save', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function savePrepSubject(
  payload: Partial<PrepSubject> & { id: string; name: string; stream: string }
): Promise<{ success: boolean; data: PrepSubject }> {
  const res = await authedFetch('/prep/subjects', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function fetchPracticeQuestions(params: {
  topicId?: string
  subjectId?: string
  count?: number
}): Promise<UniversalQuestion[]> {
  const qs = new URLSearchParams()
  if (params.topicId) qs.set('topicId', params.topicId)
  if (params.subjectId) qs.set('subjectId', params.subjectId)
  if (params.count) qs.set('count', String(params.count))

  const res = await authedFetch(`/prep/practice?${qs.toString()}`, { method: 'GET' })
  const data = await res.json()
  return data.data || []
}

export async function fetchLearnerProgress(): Promise<LearnerProgressData> {
  const res = await authedFetch('/prep/progress', { method: 'GET' })
  const data = await res.json()
  return data.data || { topicsCompleted: {} }
}

export async function recordLearnerProgress(payload: {
  topicId: string
  subjectId?: string
  visitedTab?: string
  quizScore?: number
  quizTotal?: number
  completed?: boolean
}): Promise<{ success: boolean; data: any }> {
  const res = await authedFetch('/prep/progress', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return res.json()
}

export async function seedBbaCatalog(): Promise<{
  success: boolean
  message: string
  subjectCount: number
  topicCount: number
  questionCount: number
}> {
  const res = await authedFetch('/prep/seed-bba', {
    method: 'POST',
  })
  return res.json()
}

export interface PrepSeedProgramResult {
  code: string
  label: string
  subjectCount: number
  topicCount: number
  questionCount: number
  /** Only on paper bundles: reviewed text or original-PDF file links. */
  paperCount?: number
  skippedPaperCount?: number
  valid: boolean
  errorCount: number
  warningCount: number
}

export interface PrepSeedAllResult {
  success: boolean
  message: string
  paperCount?: number
  skippedPaperFileCount?: number
  programs: string[]
  unseedable?: string[]
  subjectCount: number
  topicCount: number
  questionCount: number
  perProgram: PrepSeedProgramResult[]
}

/**
 * Master seeder: every program that ships with seed data (BBA, B.Com, B.Sc,
 * BA, M.Com), or a chosen subset such as `['ba']` / `'ba,bcom'`. The old
 * studio button only wired up BBA, which is why "seeded B.Com and BA" was
 * impossible from the UI — this is the endpoint those programs live in.
 */
export async function seedPrepCatalog(programs?: string | string[]): Promise<PrepSeedAllResult> {
  const res = await authedFetch('/prep/seed-all', {
    method: 'POST',
    body: JSON.stringify(programs ? { programs } : { programs: 'all' }),
  })
  return res.json()
}

/** Legacy subjects have no track; treat them as academic. */
export function effectivePrepTrack(subject: Pick<PrepSubject, 'track'> | null | undefined): PrepTrack {
  return subject?.track === 'aptitude' ? 'aptitude' : 'academic'
}

/**
 * Returns the sub-topics of a topic as detail records, synthesising empty
 * briefs for legacy topics that only carry a `subtopics` title list.
 */
export function topicSubtopics(topic: Pick<PrepTopic, 'subtopics' | 'subtopicDetails'> | null | undefined): PrepSubtopic[] {
  if (!topic) return []
  if (Array.isArray(topic.subtopicDetails) && topic.subtopicDetails.length > 0) return topic.subtopicDetails
  return (topic.subtopics ?? []).map((title, idx) => ({ id: `sub-${idx + 1}`, title, briefMd: '' }))
}

/**
 * The public /prep pages are anonymous, so when the learner's college is
 * known client-side it is passed along and the server applies that college's
 * company-prep toggles. Signed-in learners are resolved from the token instead.
 */
function learnerCollegeId(): string | undefined {
  try {
    const raw = localStorage.getItem('vriddhi.prep.collegeId') || sessionStorage.getItem('vriddhi.prep.collegeId')
    return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : undefined
  } catch {
    return undefined
  }
}

export function rememberLearnerCollege(collegeId: string | null | undefined): void {
  try {
    if (collegeId) localStorage.setItem('vriddhi.prep.collegeId', collegeId)
  } catch {}
}

function withCollege(qs: URLSearchParams): URLSearchParams {
  const c = learnerCollegeId()
  if (c && !qs.has('collegeId')) qs.set('collegeId', c)
  return qs
}

export async function fetchPrepCompanies(params?: { program?: string; audience?: string; collegeId?: string }): Promise<PrepCompany[]> {
  const qs = new URLSearchParams()
  if (params?.program) qs.set('program', params.program)
  if (params?.audience) qs.set('audience', params.audience)
  if (params?.collegeId) qs.set('collegeId', params.collegeId)
  withCollege(qs)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await authedFetch(`/prep/companies${suffix}`)
  const json = await res.json()
  return json.data as PrepCompany[]
}

export async function fetchPrepCompany(code: string): Promise<{ company: PrepCompany; topics: PrepCompanyTopicCard[] }> {
  const qs = withCollege(new URLSearchParams())
  const res = await authedFetch(`/prep/companies/${encodeURIComponent(code)}${qs.toString() ? `?${qs}` : ''}`)
  const json = await res.json()
  return { company: json.data as PrepCompany, topics: (json.topics || []) as PrepCompanyTopicCard[] }
}

export async function fetchPrepCompanyMock(code: string, count = 20): Promise<PrepCompanyMockQuestion[]> {
  const qs = withCollege(new URLSearchParams({ count: String(count) }))
  const res = await authedFetch(`/prep/companies/${encodeURIComponent(code)}/mock?${qs}`)
  const json = await res.json()
  return (json.data || []) as PrepCompanyMockQuestion[]
}

// ─── Company prep: per-college visibility toggles ───────────────────────────

export interface CompanyPrepSettings {
  enabled: boolean
  hiddenCompanies: string[]
  updatedAt?: string
  updatedBy?: string
}

export interface CompanyPrepSettingsRow {
  code: string
  name: string
  testName: string
  tier: string
  programs: string[]
  hidden: boolean
}

export async function fetchCompanyPrepSettings(collegeId?: string): Promise<{
  collegeId: string
  settings: CompanyPrepSettings
  companies: CompanyPrepSettingsRow[]
}> {
  const qs = collegeId ? `?collegeId=${encodeURIComponent(collegeId)}` : ''
  const res = await authedFetch(`/prep/companies/settings${qs}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to load company prep settings')
  return { collegeId: json.collegeId, settings: json.settings, companies: json.companies || [] }
}

export async function saveCompanyPrepSettings(
  settings: { enabled: boolean; hiddenCompanies: string[] },
  collegeId?: string,
): Promise<CompanyPrepSettings> {
  const res = await authedFetch('/prep/companies/settings', {
    method: 'PUT',
    body: JSON.stringify({ ...settings, ...(collegeId ? { collegeId } : {}) }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to save company prep settings')
  return json.settings as CompanyPrepSettings
}

// ── Previous-year university question papers (mirrors functions/src/prepPapers.ts) ──

/** Extra original-PDF categories; the academic study-pack catalogue is unchanged. */
export const PREP_PAPER_FILE_PROGRAMS = [
  { code: 'bsw', label: 'BSW', degreeLevel: 'undergraduate' as const },
  { code: 'ma', label: 'MA', degreeLevel: 'postgraduate' as const },
  { code: 'med', label: 'M.Ed', degreeLevel: 'postgraduate' as const },
  { code: 'mlib', label: 'M.Lib', degreeLevel: 'postgraduate' as const },
  { code: 'msw', label: 'MSW', degreeLevel: 'postgraduate' as const },
  { code: 'languages', label: 'Languages', degreeLevel: 'undergraduate' as const },
  { code: 'open-electives', label: 'Open Electives', degreeLevel: 'postgraduate' as const },
  { code: 'ug-open-elective', label: 'UG Open Elective', degreeLevel: 'undergraduate' as const },
]

export interface PrepPaperQuestion {
  label: string
  text: string
  marks?: number
  parts?: string[]
}

export interface PrepPaperSection {
  id: string
  title: string
  instruction: string
  answerCount: number
  marksEach: number
  totalMarks: number
  questions: PrepPaperQuestion[]
}

export interface PrepPaperSource {
  title: string
  url: string
  publisher: string
  retrievedOn: string
  note?: string
}

export interface PrepPaper {
  id: string
  contentType?: 'structured' | 'source_pdf'
  isPYQ?: boolean
  sourceFile?: { fileName: string; url: string; folderPath?: string; driveFileId?: string }
  program: string
  programLabel: string
  legacyProgram?: string | null
  degreeLevel: 'undergraduate' | 'postgraduate'
  universityCode: string
  universityName: string
  scheme: string
  semester: number
  subjectName: string
  subjectArea?: string | null
  paperCode?: string | null
  paperNumber?: string | null
  examMonth: string
  examYear: number
  examLabel: string
  durationMinutes: number
  maxMarks: number
  instructions: string[]
  sections: PrepPaperSection[]
  questionCount: number
  prepSubjectId?: string | null
  tags: string[]
  source: PrepPaperSource
  language: 'en' | 'kn' | 'mixed' | 'und'
  status: 'draft' | 'published'
  tier: 'free' | 'premium'
  contentVersion: number
  updatedAt?: string
}

/** List rows: the paper without its sections. */
export type PrepPaperSummary = Omit<PrepPaper, 'sections' | 'instructions'> & { sectionCount: number }

export interface PrepPaperFacets {
  universities: Array<{ code: string; name: string; count: number }>
  years: number[]
  semesters: number[]
  programs: Array<{ code: string; count: number }>
}

export interface PrepPaperUniversity {
  code: string
  name: string
  shortName: string
  city: string
}

export interface PrepPaperListResult {
  papers: PrepPaperSummary[]
  facets: PrepPaperFacets
  universities: PrepPaperUniversity[]
}

/**
 * Item 3.3 — a question that has appeared in several papers, with the years and
 * papers it came from. `count` is how many times it was asked.
 */
export interface FrequentQuestion {
  question: string
  key: string
  subjectName: string
  program: string
  marks: number | null
  count: number
  years: number[]
  examLabels: string[]
  paperIds: string[]
  variants: string[]
}

export interface FrequentQuestionListResult {
  subject: string | null
  subjects: Array<{ subjectName: string; repeated: number }>
  questions: FrequentQuestion[]
}

/**
 * Repeat groupings for one subject. With no subject, the response lists the
 * subjects that DO repeat (so the picker cannot offer an empty tab).
 */
export async function fetchFrequentQuestions(params: {
  program?: string
  subject?: string
  limit?: number
  minCount?: number
}): Promise<FrequentQuestionListResult> {
  const qs = new URLSearchParams()
  if (params.program) qs.set('program', params.program)
  if (params.subject) qs.set('subject', params.subject)
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.minCount) qs.set('minCount', String(params.minCount))
  const res = await authedFetch(`/prep/papers/frequent${qs.toString() ? `?${qs.toString()}` : ''}`, { method: 'GET' })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to load repeated questions')
  return {
    subject: json.subject ?? null,
    subjects: json.subjects || [],
    questions: json.data || [],
  }
}

export async function fetchPrepPapers(params?: {
  program?: string
  semester?: number | string
  university?: string
  year?: number | string
  subjectId?: string
  scheme?: string
  q?: string
}): Promise<PrepPaperListResult> {
  const qs = new URLSearchParams()
  if (params?.program) qs.set('program', params.program)
  if (params?.semester !== undefined && params.semester !== '') qs.set('semester', String(params.semester))
  if (params?.university) qs.set('university', params.university)
  if (params?.year !== undefined && params.year !== '') qs.set('year', String(params.year))
  if (params?.subjectId) qs.set('subjectId', params.subjectId)
  if (params?.scheme) qs.set('scheme', params.scheme)
  if (params?.q) qs.set('q', params.q)
  const res = await authedFetch(`/prep/papers${qs.toString() ? `?${qs.toString()}` : ''}`, { method: 'GET' })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to load question papers')
  return {
    papers: json.data || [],
    facets: json.facets || { universities: [], years: [], semesters: [], programs: [] },
    universities: json.universities || [],
  }
}

export async function fetchPrepPaper(paperId: string): Promise<PrepPaper> {
  const res = await authedFetch(`/prep/papers/${encodeURIComponent(paperId)}`, { method: 'GET' })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Question paper not found')
  return json.data
}

// ── Model answers (item 3.4) and quick-revision MCQs (item 3.5) ─────────────

export type PrepAnswerStatus = 'draft' | 'published' | 'rejected'

export interface PrepPaperAnswer {
  id?: string
  paperId: string
  qid: string
  sectionId: string
  label: string
  question: string
  marks: number
  status: PrepAnswerStatus
  answerMd: string
  model?: string
  generatedAt?: string
  reviewedAt?: string
  issues?: string[]
}

export interface PrepPaperAnswersResult {
  answers: PrepPaperAnswer[]
  /** Reviewer-only: drafts and rejects, present only for a superadmin caller. */
  drafts?: PrepPaperAnswer[]
  /** Keyed by qid, so the paper view does not scan a list per question. */
  byQid: Record<string, PrepPaperAnswer>
}

/** Published model answers for a paper (plus drafts when the caller reviews). */
export async function fetchPrepPaperAnswers(paperId: string): Promise<PrepPaperAnswersResult> {
  const res = await authedFetch(`/prep/papers/answers?paperId=${encodeURIComponent(paperId)}`, { method: 'GET' })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to load model answers')
  const answers: PrepPaperAnswer[] = json.data || []
  return {
    answers,
    drafts: json.drafts,
    byQid: Object.fromEntries(answers.map((answer) => [answer.qid, answer])),
  }
}

/** Superadmin: generate up to 25 model answers for one paper per call. */
export async function generatePrepPaperAnswers(
  paperId: string,
  qids?: string[],
  regenerate = false,
): Promise<{ requested: number; attempted: number; remaining: number; results: Array<{ qid: string; status: string; issues?: string[] }> }> {
  const res = await authedFetch('/prep/papers/answers/generate', {
    method: 'POST',
    body: JSON.stringify({ paperId, qids, regenerate }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to generate model answers')
  return json
}

/** Superadmin: publish, reject or reopen generated answers. */
export async function reviewPrepPaperAnswers(
  ids: string[],
  action: 'publish' | 'reject' | 'reopen',
): Promise<{ updated: number; status: PrepAnswerStatus }> {
  const res = await authedFetch('/prep/papers/answers/review', {
    method: 'POST',
    body: JSON.stringify({ ids, action }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to update model answers')
  return json
}

export interface PrepMcqItem {
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

export interface PrepMcqSet {
  id: string
  paperId: string
  subjectName: string
  status: PrepAnswerStatus
  items: PrepMcqItem[]
  issues?: string[]
}

/** Published quick-revision sets (all of them for a superadmin). */
export async function fetchPrepMcqSets(paperId?: string): Promise<PrepMcqSet[]> {
  const qs = paperId ? `?paperId=${encodeURIComponent(paperId)}` : ''
  const res = await authedFetch(`/prep/papers/mcq-sets${qs}`, { method: 'GET' })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to load quick-revision questions')
  return json.data || []
}

/** Superadmin: generate a quick-revision set from a paper's questions. */
export async function generatePrepMcqSet(paperId: string, qids?: string[]): Promise<{ data: PrepMcqSet; count: number; issues: string[] }> {
  const res = await authedFetch('/prep/papers/mcq-sets/generate', {
    method: 'POST',
    body: JSON.stringify({ paperId, qids }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to generate quick-revision questions')
  return json
}

/** Superadmin: publish or reject generated quick-revision sets. */
export async function reviewPrepMcqSets(
  ids: string[],
  action: 'publish' | 'reject' | 'reopen',
): Promise<{ updated: number; status: PrepAnswerStatus }> {
  const res = await authedFetch('/prep/papers/mcq-sets/review', {
    method: 'POST',
    body: JSON.stringify({ ids, action }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to update quick-revision sets')
  return json
}

/** The public label for a reviewed answer. Kept in one place, like the server's. */
export const MODEL_ANSWER_LABEL = 'Model answer · AI-generated, reviewed'

/** Superadmin: create or update one paper (compact seed shape or full paper). */
export async function savePrepPaper(payload: Record<string, unknown>): Promise<{ data: PrepPaper; warnings: Array<{ level: string; code: string; message: string }> }> {
  const res = await authedFetch('/prep/papers', { method: 'POST', body: JSON.stringify(payload) })
  const json = await res.json()
  if (!res.ok) {
    const detail = Array.isArray(json.issues) ? json.issues.map((i: { message: string }) => i.message).join(' ') : ''
    throw new Error(`${json.error || 'Failed to save question paper'}${detail ? ` ${detail}` : ''}`)
  }
  return { data: json.data, warnings: json.warnings || [] }
}

/** BBM etc. — programs that were renamed; papers under the old name sit inside the new program. */
export const PREP_PAPER_LEGACY_LABELS: Record<string, string> = { bbm: 'BBM' }
