import { buildCseCatalog } from './cseSeedHelpers'
import { CSE_SEMESTERS_1_TO_3 } from './cseCoreSemesters1to3'
import { CSE_SEMESTER_4 } from './cseCoreSemester4'
import { CSE_SEMESTERS_5_TO_7 } from './cseCoreSemesters5to7'
import { CSE_LABS_AND_OPTIONS } from './cseCoreLabsAndOptions'

/**
 * Curator-authored CSE study-pack map. This is a candidate VTU 2022-aligned
 * core, not a complete or officially endorsed scheme; see
 * docs/PREP_CSE_CONTENT_SCOPE.md for included semesters, source checks, and
 * the explicit scope limitations.
 */
export const CSE_COURSE_SEEDS = [
  ...CSE_SEMESTERS_1_TO_3,
  ...CSE_SEMESTER_4,
  ...CSE_SEMESTERS_5_TO_7,
  ...CSE_LABS_AND_OPTIONS,
]

const CSE_CATALOG = buildCseCatalog(CSE_COURSE_SEEDS)

export const CSE_SUBJECTS = CSE_CATALOG.subjects
export const SEEDED_CSE_TOPICS = CSE_CATALOG.topics
export const SEEDED_CSE_QUESTIONS = CSE_CATALOG.questions
