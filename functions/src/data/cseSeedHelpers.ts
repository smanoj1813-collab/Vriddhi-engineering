import {
  buildEngineeringCatalog,
  type EngineeringCatalog,
  type EngineeringCourseSeed,
  type EngineeringModuleSeed,
  type EngineeringPackProfile,
  type EngineeringQuestionSeed,
} from './engineeringSeedHelpers'

// The CSE pack predates the shared engineering builder; these aliases keep the
// existing seed files and tests unchanged while both branches share one
// implementation (see engineeringSeedHelpers.ts).
export type CseQuestionSeed = EngineeringQuestionSeed
export type CseModuleSeed = EngineeringModuleSeed
export type CseCourseSeed = EngineeringCourseSeed
export type CseCatalog = EngineeringCatalog

const CSE_PROFILE: EngineeringPackProfile = {
  program: 'cse',
  label: 'CSE',
  stream: 'computing',
  icon: 'Code2',
  publishedAt: '2026-10-13T09:00:00.000Z',
  schemeTag: 'candidate-vtu-2022-map',
}

/**
 * Turn the compact, curator-authored curriculum map into the same content
 * contract used by the other Prep catalogues: an explanation, key model,
 * exam tip, solve method, granular subtopic briefs and a tagged practice item.
 */
export function buildCseCatalog(courses: CseCourseSeed[]): CseCatalog {
  return buildEngineeringCatalog(courses, CSE_PROFILE)
}
