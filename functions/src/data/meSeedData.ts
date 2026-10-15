import { buildMeCatalog } from './meSeedHelpers'
import { ME_SEMESTER_3 } from './meCoreSemester3'
import { ME_SEMESTER_4 } from './meCoreSemester4'
import { ME_SEMESTER_5 } from './meCoreSemester5'
import { ME_SEMESTERS_6_TO_7 } from './meCoreSemesters6to7'
import { ME_LABS_AND_SUPPLEMENT } from './meCoreLabsAndSupplement'

/**
 * Curator-authored Mechanical Engineering study-pack map. This is a candidate
 * VTU 2022-aligned core (Semesters 3–7 theory cores, the four PCC labs and one
 * unsemestered foundations supplement), not a complete or officially endorsed
 * scheme; see docs/PREP_ME_CONTENT_SCOPE.md for the included courses, the
 * evidence used for each, and the explicit limits. ESC/AEC/PE/OE options are
 * deliberately not seeded because their titles could not be verified.
 */
export const ME_COURSE_SEEDS = [
  ...ME_SEMESTER_3,
  ...ME_SEMESTER_4,
  ...ME_SEMESTER_5,
  ...ME_SEMESTERS_6_TO_7,
  ...ME_LABS_AND_SUPPLEMENT,
]

const ME_CATALOG = buildMeCatalog(ME_COURSE_SEEDS)

export const ME_SUBJECTS = ME_CATALOG.subjects
export const SEEDED_ME_TOPICS = ME_CATALOG.topics
export const SEEDED_ME_QUESTIONS = ME_CATALOG.questions
