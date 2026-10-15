import { buildEceCatalog } from './eceSeedHelpers'
import { ECE_SEMESTER_3 } from './eceCoreSemester3'
import { ECE_SEMESTER_4 } from './eceCoreSemester4'
import { ECE_SEMESTER_5 } from './eceCoreSemester5'
import { ECE_SEMESTERS_6_TO_7 } from './eceCoreSemesters6to7'
import { ECE_LABS_AND_OPTIONS } from './eceCoreLabsAndOptions'

/**
 * Curator-authored ECE study-pack map. This is a candidate VTU 2022-aligned
 * core (Semesters 3–7 theory cores, the four PCC labs, the two most common
 * ESC options and one unsemestered foundations supplement), not a complete or
 * officially endorsed scheme; see docs/PREP_ECE_CONTENT_SCOPE.md for the
 * included courses, the evidence used for each, and the explicit limits.
 */
export const ECE_COURSE_SEEDS = [
  ...ECE_SEMESTER_3,
  ...ECE_SEMESTER_4,
  ...ECE_SEMESTER_5,
  ...ECE_SEMESTERS_6_TO_7,
  ...ECE_LABS_AND_OPTIONS,
]

const ECE_CATALOG = buildEceCatalog(ECE_COURSE_SEEDS)

export const ECE_SUBJECTS = ECE_CATALOG.subjects
export const SEEDED_ECE_TOPICS = ECE_CATALOG.topics
export const SEEDED_ECE_QUESTIONS = ECE_CATALOG.questions
