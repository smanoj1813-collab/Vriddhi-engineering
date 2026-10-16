import {
  buildEngineeringCatalog,
  type EngineeringCatalog,
  type EngineeringCourseSeed,
  type EngineeringModuleSeed,
  type EngineeringPackProfile,
} from './engineeringSeedHelpers'

export type CvModuleSeed = EngineeringModuleSeed
export type CvCourseSeed = EngineeringCourseSeed
export type CvCatalog = EngineeringCatalog

const CV_PROFILE: EngineeringPackProfile = {
  program: 'cv',
  label: 'Civil',
  stream: 'civil',
  icon: 'Landmark',
  publishedAt: '2026-10-16T12:00:00.000Z',
  schemeTag: 'candidate-vtu-2022-map',
}

/** Compact positional constructor shared by the Civil seed files. */
export const cvModule = (
  id: string, title: string, overview: string, subtopics: CvModuleSeed['subtopics'], keyModel: string,
  workedExample: string, examTip: string, question: string, answer: string,
  distractors: [string, string, string], explanation: string,
): CvModuleSeed => ({
  id, title, overview, subtopics, keyModel, workedExample, examTip,
  question: { question, answer, distractors, explanation },
})

export function buildCvCatalog(courses: CvCourseSeed[]): CvCatalog {
  return buildEngineeringCatalog(courses, CV_PROFILE)
}
