import {
  buildEngineeringCatalog,
  type EngineeringCatalog,
  type EngineeringCourseSeed,
  type EngineeringModuleSeed,
  type EngineeringPackProfile,
} from './engineeringSeedHelpers'

export type EceModuleSeed = EngineeringModuleSeed
export type EceCourseSeed = EngineeringCourseSeed
export type EceCatalog = EngineeringCatalog

const ECE_PROFILE: EngineeringPackProfile = {
  program: 'ece',
  label: 'ECE',
  stream: 'electronics',
  icon: 'CircuitBoard',
  publishedAt: '2026-10-15T09:00:00.000Z',
  schemeTag: 'candidate-vtu-2022-map',
}

/** Compact positional constructor shared by the ECE seed files. */
export const eceModule = (
  id: string, title: string, overview: string, subtopics: EceModuleSeed['subtopics'], keyModel: string,
  workedExample: string, examTip: string, question: string, answer: string,
  distractors: [string, string, string], explanation: string,
): EceModuleSeed => ({
  id, title, overview, subtopics, keyModel, workedExample, examTip,
  question: { question, answer, distractors, explanation },
})

export function buildEceCatalog(courses: EceCourseSeed[]): EceCatalog {
  return buildEngineeringCatalog(courses, ECE_PROFILE)
}
