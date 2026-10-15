import {
  buildEngineeringCatalog,
  type EngineeringCatalog,
  type EngineeringCourseSeed,
  type EngineeringModuleSeed,
  type EngineeringPackProfile,
} from './engineeringSeedHelpers'

export type EeeModuleSeed = EngineeringModuleSeed
export type EeeCourseSeed = EngineeringCourseSeed
export type EeeCatalog = EngineeringCatalog

const EEE_PROFILE: EngineeringPackProfile = {
  program: 'eee',
  label: 'EEE',
  stream: 'electrical',
  icon: 'Zap',
  publishedAt: '2026-10-15T12:00:00.000Z',
  schemeTag: 'candidate-vtu-2022-map',
}

/** Compact positional constructor shared by the EEE seed files. */
export const eeeModule = (
  id: string, title: string, overview: string, subtopics: EeeModuleSeed['subtopics'], keyModel: string,
  workedExample: string, examTip: string, question: string, answer: string,
  distractors: [string, string, string], explanation: string,
): EeeModuleSeed => ({
  id, title, overview, subtopics, keyModel, workedExample, examTip,
  question: { question, answer, distractors, explanation },
})

export function buildEeeCatalog(courses: EeeCourseSeed[]): EeeCatalog {
  return buildEngineeringCatalog(courses, EEE_PROFILE)
}
