import { buildEeeCatalog } from './eeeSeedHelpers'
import { EEE_SEMESTER_3 } from './eeeCoreSemester3'
import { EEE_SEMESTER_4 } from './eeeCoreSemester4'
import { EEE_SEMESTER_5 } from './eeeCoreSemester5'
import { EEE_SEMESTERS_6_TO_7 } from './eeeCoreSemesters6to7'
import { EEE_LABS_AND_SUPPLEMENT } from './eeeCoreLabsAndSupplement'

/**
 * Curator-authored EEE study-pack map. This is a candidate VTU 2022-aligned
 * core (Semesters 3–7 theory cores, the four PCC labs and one unsemestered
 * foundations supplement), not a complete or officially endorsed scheme; see
 * docs/PREP_EEE_CONTENT_SCOPE.md for the included courses, the evidence used
 * for each, and the explicit limits. ESC/AEC options are deliberately not
 * seeded because their titles could not be verified.
 */
export const EEE_COURSE_SEEDS = [
  ...EEE_SEMESTER_3,
  ...EEE_SEMESTER_4,
  ...EEE_SEMESTER_5,
  ...EEE_SEMESTERS_6_TO_7,
  ...EEE_LABS_AND_SUPPLEMENT,
]

const EEE_CATALOG = buildEeeCatalog(EEE_COURSE_SEEDS)

export const EEE_SUBJECTS = EEE_CATALOG.subjects
export const SEEDED_EEE_TOPICS = EEE_CATALOG.topics
export const SEEDED_EEE_QUESTIONS = EEE_CATALOG.questions
