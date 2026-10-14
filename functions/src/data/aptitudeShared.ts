// functions/src/data/aptitudeShared.ts
//
// Small authoring helpers shared by the placement-aptitude seed files
// (aptitudeQuantSeedData.ts, aptitudeReasoningSeedData.ts,
// aptitudeVerbalSeedData.ts). They exist only so each topic literal stays
// short and the two sub-topic shapes (`subtopics` titles + `subtopicDetails`
// briefs) can never drift apart.

import type { PrepSubtopic, PrepTopic, UniversalQuestion, PrepAudience, PrepDifficulty } from '../prepShared'

export const APTITUDE_PUBLISHED_AT = '2026-09-18T09:00:00.000Z'

/** Subject ids for the three shared aptitude catalogues. */
export const QA_SUBJECT_ID = 'apt-quantitative-aptitude'
export const LR_SUBJECT_ID = 'apt-logical-reasoning'
export const VA_SUBJECT_ID = 'apt-verbal-ability'

/** Every program in the catalogue lists the shared aptitude subjects. */
export const ALL_PROGRAMS = ['bba', 'bcom', 'bca', 'bsc', 'ba', 'cse', 'mba', 'mcom', 'mca']

export const ALL_AUDIENCES: PrepAudience[] = ['ug', 'pg', 'tech']

/** Builds a PrepSubtopic list from `[title, briefMd]` tuples. */
export function subs(topicId: string, entries: Array<[string, string]>): PrepSubtopic[] {
  return entries.map(([title, briefMd], idx) => ({
    id: `${topicId}-s${idx + 1}`,
    title,
    briefMd: briefMd.trim(),
  }))
}

type TopicInput = Omit<
  PrepTopic,
  'subtopics' | 'subtopicDetails' | 'status' | 'generatedBy' | 'contentVersion' | 'publishedAt' | 'tier'
> & {
  subtopicDetails: PrepSubtopic[]
  tier?: PrepTopic['tier']
}

/** Fills the boilerplate fields every seeded aptitude topic shares. */
export function topic(input: TopicInput): PrepTopic {
  return {
    tier: 'free',
    status: 'published',
    generatedBy: 'curator',
    contentVersion: 1,
    publishedAt: APTITUDE_PUBLISHED_AT,
    audience: ALL_AUDIENCES,
    ...input,
    subtopics: input.subtopicDetails.map((s) => s.title),
  }
}

type QuestionInput = {
  id: string
  subjectId: string
  topicId: string
  q: string
  options: string[]
  answer: number
  why: string
  difficulty?: PrepDifficulty
}

/** Compact MCQ literal for the shared aptitude pool. */
export function mcq(input: QuestionInput): UniversalQuestion {
  return {
    id: input.id,
    questionText: input.q,
    options: input.options,
    correctIndex: input.answer,
    explanation: input.why,
    difficulty: input.difficulty ?? 'core',
    status: 'approved',
    prepTags: {
      subjectId: input.subjectId,
      topicIds: [input.topicId],
      stream: 'aptitude',
      program: 'all',
    },
    tags: ['placement', 'aptitude'],
  }
}
