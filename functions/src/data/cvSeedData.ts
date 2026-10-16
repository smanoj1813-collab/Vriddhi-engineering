import { buildCvCatalog } from './cvSeedHelpers'
import { CV_SEMESTER_3 } from './cvCoreSemester3'
import { CV_SEMESTER_4 } from './cvCoreSemester4'
import { CV_SEMESTER_5 } from './cvCoreSemester5'
import { CV_SEMESTERS_6_TO_7 } from './cvCoreSemesters6to7'
import { CV_LABS_AND_SUPPLEMENT } from './cvCoreLabsAndSupplement'

/**
 * Curator-authored Civil Engineering study-pack map. This is a candidate
 * VTU 2022-aligned core (Semesters 3–7 theory cores, the four PCC labs and one
 * unsemestered foundations supplement), not a complete or officially endorsed
 * scheme; see docs/PREP_CV_CONTENT_SCOPE.md for the included courses, the
 * evidence used for each, and the explicit limits. ESC/AEC/PE/OE options are
 * deliberately not seeded because their titles could not be verified.
 */
export const CV_COURSE_SEEDS = [
  ...CV_SEMESTER_3,
  ...CV_SEMESTER_4,
  ...CV_SEMESTER_5,
  ...CV_SEMESTERS_6_TO_7,
  ...CV_LABS_AND_SUPPLEMENT,
]

const CV_CATALOG = buildCvCatalog(CV_COURSE_SEEDS)

export const CV_SUBJECTS = CV_CATALOG.subjects
export const SEEDED_CV_TOPICS = CV_CATALOG.topics
export const SEEDED_CV_QUESTIONS = CV_CATALOG.questions
