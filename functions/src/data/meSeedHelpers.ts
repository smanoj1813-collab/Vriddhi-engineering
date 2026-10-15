import {
  buildEngineeringCatalog,
  type EngineeringCatalog,
  type EngineeringCourseSeed,
  type EngineeringModuleSeed,
  type EngineeringPackProfile,
} from './engineeringSeedHelpers'

export type MeModuleSeed = EngineeringModuleSeed
export type MeCourseSeed = EngineeringCourseSeed
export type MeCatalog = EngineeringCatalog

const ME_PROFILE: EngineeringPackProfile = {
  program: 'me',
  label: 'ME',
  stream: 'mechanical',
  icon: 'Settings',
  publishedAt: '2026-10-15T18:00:00.000Z',
  schemeTag: 'candidate-vtu-2022-map',
}

/** Compact positional constructor shared by the ME seed files. */
export const meModule = (
  id: string, title: string, overview: string, subtopics: MeModuleSeed['subtopics'], keyModel: string,
  workedExample: string, examTip: string, question: string, answer: string,
  distractors: [string, string, string], explanation: string,
): MeModuleSeed => ({
  id, title, overview, subtopics, keyModel, workedExample, examTip,
  question: { question, answer, distractors, explanation },
})

export function buildMeCatalog(courses: MeCourseSeed[]): MeCatalog {
  return buildEngineeringCatalog(courses, ME_PROFILE)
}
