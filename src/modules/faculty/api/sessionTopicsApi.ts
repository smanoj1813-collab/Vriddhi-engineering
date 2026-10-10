// src/modules/faculty/api/sessionTopicsApi.ts
// ─── Slice 2 S2.3 — what a faculty member can tag on a class ───────────────
//
// Feeds the topic picker shown when a session is marked complete, and the
// faculty Topics page's "Curriculum topics" section.
//
// There are two topic stores and nothing joins them:
//   * `topics/*`        — the superadmin curriculum bank. Field is `name`, plus
//                         `subject` / `course` / `semester`. Superadmin writes
//                         only (see `match /topics` in firestore.rules).
//                         Bank rows carry NO facultyId — assignment to a person
//                         is derived from the subjects on their
//                         curriculumFacultyMappings. (Any code that queries the
//                         bank BY facultyId is querying the wrong address; the
//                         dead readers that did — facultyApi.fetchFacultyTopics
//                         and getCurriculumProgress's bank join — are gone.)
//   * `facultyTopics/*` — the faculty's own ledger. Field is `title`, plus
//                         `subject` / `course`. The faculty owns these rows
//                         (see `match /facultyTopics` in the rules).
//
// The merge keeps both, filtered to the session's subject where possible, and
// de-duplicates on a normalised title so the same topic taught from either
// store does not appear twice.

import { collection, doc, query, where, getDocs, getDoc, limit } from 'firebase/firestore'
import { db } from '@/Firebase/config'
import { resolveFacultyAliases, listMappings } from '../../admin/api/curriculumMappingApi'
import { fetchFacultyWeeklySchedule } from '../../admin/api/scheduleApi'

export interface SessionTopicOption {
  /** Document id — `topics/*` ids go into the session's `topicIds`. */
  id: string
  title: string
  moduleNo?: string
  moduleName?: string
  unit?: string
  status: string
  /** Which store the option came from. */
  source: 'curriculum' | 'ledger'
  covered: boolean
  subject?: string
  course?: string
  semester?: number
}

const COVERED = ['covered', 'completed']

/** Loose key for de-duplication: "Integration  by Parts" === "integration by parts". */
function topicKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function matchesSubject(candidate: string | undefined, wanted: string): boolean {
  if (!wanted) return true
  const a = topicKey(candidate || '')
  const b = topicKey(wanted)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

/** Subjects this faculty member teaches, from curriculum mappings + timetable. */
async function fetchTaughtSubjects(facultyId: string, collegeId = ''): Promise<Set<string>> {
  const subjects = new Set<string>()
  const aliases = await resolveFacultyAliases(facultyId).catch(() => null)

  // Scope the mapping read to the college (or, failing that, to the caller's
  // own facultyId) BEFORE any alias matching — an unscoped `limit(200)` over
  // the whole collection pulled every other college's rows into the browser
  // just to drop them client-side. listMappings already implements the
  // single-equality query + alias-tolerant filter, and the college-scoped
  // variant is what the tightened curriculumFacultyMappings rules allow.
  try {
    const mine = await listMappings({
      ...(collegeId ? { collegeId } : { facultyId }),
      facultyAliases: aliases?.ids,
      facultyEmail: aliases?.email || undefined,
      status: 'active',
    })
    mine.forEach((m) => {
      const name = String(m.courseName || '').trim()
      const code = String(m.courseCode || '').trim()
      if (name) subjects.add(name.toLowerCase())
      if (code) subjects.add(code.toLowerCase())
    })
  } catch (err) {
    console.warn('[SessionTopics] mapping subject lookup failed:', err)
  }

  // The timetable is the second source of "what do I teach" — it works even
  // when no curriculum has been mapped yet.
  try {
    const weekly = await fetchFacultyWeeklySchedule(facultyId)
    weekly.forEach((w) => {
      if (w.subject) subjects.add(String(w.subject).trim().toLowerCase())
      if (w.subjectCode) subjects.add(String(w.subjectCode).trim().toLowerCase())
    })
  } catch (err) {
    console.warn('[SessionTopics] schedule subject lookup failed:', err)
  }

  subjects.delete('')
  return subjects
}

/**
 * Curriculum topics for this faculty member, from BOTH real sources:
 *
 * 1. The ASSIGNED CURRICULUM documents (primary). When a college assigns a
 *    syllabus, the parsed topics live inside the curriculum document —
 *    courses[].modules[].topics as plain strings — NOT in the legacy
 *    `topics/*` bank. A page that only queries `topics/*` therefore shows
 *    nothing for colleges that never used the legacy manual-topic flow,
 *    which is exactly the "Topics shows nothing" report. Here each active
 *    mapping for this faculty is resolved to its curriculum document and the
 *    course's modules are flattened into topic rows.
 *
 * 2. The legacy `topics/*` bank (secondary, filtered to the subjects the
 *    faculty teaches — mappings first, timetable as fallback). Included so
 *    manually curated bank topics still appear alongside syllabus topics.
 *
 * Curriculum-derived rows win de-duplication over bank rows with the same
 * title, because they carry the module context.
 */
export async function fetchFacultyCurriculumTopics(
  facultyId: string,
  collegeId?: string,
): Promise<SessionTopicOption[]> {
  if (!facultyId) return []

  // The mappings query is broadest (and alias-tolerant) when scoped by
  // college; fall back to the localStorage path selector the other faculty
  // APIs use so callers that omit collegeId still get profile-id-keyed rows.
  const cid = collegeId || localStorage.getItem('vriddhi_college_id') || ''

  const results = new Map<string, { option: SessionTopicOption; priority: number }>()
  const add = (option: SessionTopicOption, priority: number) => {
    const key = topicKey(option.title)
    if (!key) return
    const existing = results.get(key)
    if (!existing) {
      results.set(key, { option, priority })
      return
    }
    // Higher priority wins the row (curriculum rows carry the module context),
    // but a topic already marked covered in the legacy bank must not be
    // downgraded to "pending" by a same-titled row that knows nothing about it.
    const covered = existing.option.covered || option.covered
    if (priority > existing.priority) results.set(key, { option: { ...option, covered }, priority })
    else if (covered !== existing.option.covered) {
      results.set(key, { option: { ...existing.option, covered }, priority: existing.priority })
    }
  }

  const aliases = await resolveFacultyAliases(facultyId).catch(() => null)

  // ─── 1. Topics flattened from the assigned curriculum documents ─────────
  try {
    const mappings = await listMappings({
      facultyId,
      collegeId: cid,
      facultyAliases: aliases?.ids,
      facultyEmail: aliases?.email || undefined,
      status: 'active',
    })

    for (const mapping of mappings.slice(0, 20)) {
      try {
        const snap = await getDoc(doc(db, 'curriculum', mapping.curriculumId))
        if (!snap.exists()) continue
        const courses: any[] = Array.isArray(snap.data().courses) ? snap.data().courses : []
        const course =
          courses.find((c) => String(c.id || '') === mapping.courseId) ||
          courses.find((c) => String(c.code || '') === mapping.courseCode) ||
          courses.find((c) => String(c.name || '') === mapping.courseName)
        if (!course) continue

        const modules: any[] = Array.isArray(course.modules) ? course.modules : []
        modules.forEach((m, moduleIndex) => {
          const topics: string[] = Array.isArray(m.topics) ? m.topics : []
          topics.forEach((rawTopic, topicIndex) => {
            const title = String(rawTopic || '').trim()
            if (!title) return
            add(
              {
                id: `${mapping.curriculumId}__${String(m.id || m.moduleNo || moduleIndex)}__${topicKey(title) || topicIndex}`,
                title,
                moduleNo: String(m.moduleNo ?? ''),
                moduleName: String(m.moduleName || m.title || ''),
                status: 'active',
                source: 'curriculum',
                covered: false,
                subject: String(course.name || mapping.courseName || ''),
                course: String(course.code || mapping.courseCode || ''),
                semester: Number(course.semester || mapping.semester) || undefined,
              },
              2,
            )
          })
        })
      } catch (err) {
        console.warn('[SessionTopics] curriculum document read failed:', mapping.curriculumId, err)
      }
    }
  } catch (err) {
    console.warn('[SessionTopics] mapping lookup failed:', err)
  }

  // ─── 2. Legacy bank (topics/*), filtered to the subjects taught ──────────
  try {
    const [taught, bankSnap] = await Promise.all([
      fetchTaughtSubjects(facultyId, cid),
      getDocs(query(collection(db, 'topics'), limit(500))).catch((err) => {
        console.warn('[SessionTopics] curriculum bank lookup failed:', err)
        return null
      }),
    ])

    bankSnap?.docs.forEach((d) => {
      const data = d.data()
      const title = String(data.name || data.title || '').trim()
      if (!title) return
      const option: SessionTopicOption = {
        id: d.id,
        title,
        moduleNo: String(data.moduleNo || ''),
        moduleName: String(data.moduleName || ''),
        unit: String(data.unit || ''),
        status: String(data.status || 'active'),
        source: 'curriculum',
        covered: COVERED.includes(String(data.status || '').toLowerCase()),
        subject: String(data.subject || ''),
        course: String(data.course || ''),
        semester: Number(data.semester) || undefined,
      }
      // Bank rows are only relevant when their subject matches what the
      // faculty teaches; with nothing resolvable, surface the whole bank.
      if (
        taught.size === 0 ||
        [...taught].some((s) => matchesSubject(option.subject, s) || matchesSubject(option.course, s))
      ) {
        add(option, 1)
      }
    })
  } catch (err) {
    console.warn('[SessionTopics] bank merge failed:', err)
  }

  return [...results.values()]
    .map(({ option }) => option)
    .sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * Topic options for one class, best-effort from both stores.
 *
 * Subject filtering is a nicety, not a filter that can fail closed: if nothing
 * matches the session's subject the unfiltered list is returned.
 */
export async function fetchSessionTopicOptions(input: {
  facultyId: string
  subject?: string
  subjectCode?: string
  /** Caller's college claim — scopes the mapping reads (see fetchTaughtSubjects). */
  collegeId?: string
}): Promise<SessionTopicOption[]> {
  const { facultyId, subject = '', subjectCode = '', collegeId = '' } = input
  if (!facultyId) return []

  const results = new Map<string, SessionTopicOption>()

  const add = (option: SessionTopicOption) => {
    const key = topicKey(option.title)
    if (!key) return
    const existing = results.get(key)
    if (!existing) {
      results.set(key, option)
      return
    }
    // A curriculum row wins over a ledger row with the same title, because
    // only the curriculum row has a stable id to store in `topicIds` — but
    // COVERAGE lives on the ledger row, and a curriculum row is always
    // `covered: false`. Keeping the curriculum row verbatim meant a topic the
    // teacher had already covered kept rendering as pending in the picker,
    // because the row that knows it is covered was the one being discarded.
    // The flag is OR'd across both stores.
    if (existing.source === 'ledger' && option.source === 'curriculum') {
      results.set(key, { ...option, covered: existing.covered || option.covered })
      return
    }
    if (existing.covered && !option.covered) results.set(key, { ...option, covered: true })
  }

  // ─── Curriculum bank: topics for the subjects this faculty teaches ──────
  try {
    const bank = await fetchFacultyCurriculumTopics(facultyId, collegeId)
    bank.forEach(add)
  } catch (err) {
    console.warn('[SessionTopics] curriculum topic lookup failed:', err)
  }

  // ─── Faculty ledger: rows the faculty already plans against ─────────────
  try {
    const snap = await getDocs(
      query(collection(db, 'facultyTopics'), where('facultyId', '==', facultyId), limit(300))
    )
    snap.docs.forEach((d) => {
      const data = d.data()
      const title = String(data.title || data.name || '').trim()
      if (!title) return
      add({
        id: d.id,
        title,
        moduleNo: String(data.moduleNo || ''),
        moduleName: String(data.moduleName || ''),
        unit: String(data.unit || ''),
        status: String(data.status || 'pending'),
        source: 'ledger',
        covered: COVERED.includes(String(data.status || '').toLowerCase()),
        subject: String(data.subject || ''),
      })
    })
  } catch (err) {
    console.warn('[SessionTopics] faculty topic lookup failed:', err)
  }

  const all = [...results.values()].sort((a, b) => a.title.localeCompare(b.title))
  const wanted = subject || subjectCode
  const filtered = wanted ? all.filter((option) => matchesSubject(option.subject, wanted)) : all
  return filtered.length > 0 ? filtered : all
}
