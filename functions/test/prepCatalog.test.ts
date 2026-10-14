// functions/test/prepCatalog.test.ts
//
// Data-integrity tests for regional legacy catalogues and the new universal
// student-first Prep supplement.
//
// These run the real `validatePrepCatalog()` from src/prepShared.ts against the
// exported seed data, so a referential break (orphan topic, missing featured
// question, unknown subject tag, short explanation, …) fails before release.
//
// Covered programs: M.Com, B.Sc and BA are held to the full completeness
// contract (5 modules per subject, 2 questions per module, zero integrity
// errors). The pre-existing BBA seed file is a partial catalogue — 20 subjects
// with 1-3 topics each and no `degreeLevel` — so it is asserted against the
// weaker structural contract it actually satisfies, and is documented as such.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  validatePrepCatalog,
  PREP_PROGRAM_CATALOG,
  PREP_PROGRAM_CODES,
  PREP_SEED_CODES,
  getPrepProgramsForLevel,
  resolveSeedPrograms,
  chunkArray,
  type PrepCatalogBundle,
  type PrepSubject,
  type PrepTopic,
  type UniversalQuestion,
} from '../src/prepShared.ts'

import { BBA_SUBJECTS, SEEDED_BBA_TOPICS, SEEDED_UNIVERSAL_QUESTIONS } from '../src/data/bbaSeedData.ts'
import { MCOM_SUBJECTS, SEEDED_MCOM_TOPICS, SEEDED_MCOM_QUESTIONS } from '../src/data/mcomSeedData.ts'
import { BSC_SUBJECTS, SEEDED_BSC_TOPICS, SEEDED_BSC_QUESTIONS } from '../src/data/bscSeedData.ts'
import { BA_SUBJECTS, SEEDED_BA_TOPICS, SEEDED_BA_QUESTIONS } from '../src/data/baSeedData.ts'
import { BCOM_SUBJECTS, SEEDED_BCOM_TOPICS, SEEDED_BCOM_QUESTIONS } from '../src/data/bcomSeedData.ts'
import { CSE_COURSE_SEEDS, CSE_SUBJECTS, SEEDED_CSE_TOPICS, SEEDED_CSE_QUESTIONS } from '../src/data/cseSeedData.ts'
import { APTITUDE_SUBJECTS, SEEDED_APTITUDE_TOPICS, SEEDED_APTITUDE_QUESTIONS } from '../src/data/aptitudeSeedData.ts'
import {
  UNIVERSAL_ACADEMIC_BUNDLE,
  universalAcademicSupplementFor,
} from '../src/data/universalAcademicSupplement.ts'

interface ProgramFixture {
  programCode: string
  degreeLevel: 'undergraduate' | 'postgraduate'
  expectedSubjects: number
  expectedQuestions: number
  subjects: PrepSubject[]
  topics: Record<string, PrepTopic[]>
  questions: UniversalQuestion[]
}

/** Programs authored to the full 5-module / 80-question completeness contract. */
const COMPLETE_FIXTURES: ProgramFixture[] = [
  {
    programCode: 'mcom',
    degreeLevel: 'postgraduate',
    expectedSubjects: 8,
    expectedQuestions: 80,
    subjects: MCOM_SUBJECTS,
    topics: SEEDED_MCOM_TOPICS,
    questions: SEEDED_MCOM_QUESTIONS,
  },
  {
    programCode: 'bsc',
    degreeLevel: 'undergraduate',
    expectedSubjects: 8,
    expectedQuestions: 80,
    subjects: BSC_SUBJECTS,
    topics: SEEDED_BSC_TOPICS,
    questions: SEEDED_BSC_QUESTIONS,
  },
  {
    programCode: 'ba',
    degreeLevel: 'undergraduate',
    expectedSubjects: 8,
    expectedQuestions: 80,
    subjects: BA_SUBJECTS,
    topics: SEEDED_BA_TOPICS,
    questions: SEEDED_BA_QUESTIONS,
  },
]

/**
 * The original BBA seed file predates the completeness contract. It is checked
 * for referential soundness only, and its partial shape is pinned here so that
 * an accidental regression is still caught.
 */
const LEGACY_BBA: ProgramFixture = {
  programCode: 'bba',
  degreeLevel: 'undergraduate',
  expectedSubjects: 20,
  expectedQuestions: SEEDED_UNIVERSAL_QUESTIONS.length,
  subjects: BBA_SUBJECTS,
  topics: SEEDED_BBA_TOPICS,
  questions: SEEDED_UNIVERSAL_QUESTIONS,
}

function flattenTopics(topics: Record<string, PrepTopic[]>): PrepTopic[] {
  return Object.values(topics).flat()
}

function bundleFor(f: ProgramFixture): PrepCatalogBundle {
  return {
    programCode: f.programCode,
    subjects: f.subjects,
    topics: f.topics,
    questions: f.questions,
  }
}

describe('validatePrepCatalog over the new Karnataka catalogues', () => {
  for (const fixture of COMPLETE_FIXTURES) {
    it(`${fixture.programCode}: reports zero integrity errors`, () => {
      const report = validatePrepCatalog(bundleFor(fixture))
      const messages = report.issues
        .filter((i) => i.level === 'error')
        .map((i) => `${i.code}: ${i.message}`)
      assert.deepEqual(messages, [], `${fixture.programCode} integrity errors:\n${messages.join('\n')}`)
      assert.equal(report.valid, true)
      assert.equal(report.errorCount, 0)
    })
  }
})

describe('module counts', () => {
  for (const fixture of COMPLETE_FIXTURES) {
    it(`${fixture.programCode}: has the expected subject count`, () => {
      assert.equal(fixture.subjects.length, fixture.expectedSubjects)
    })

    it(`${fixture.programCode}: every subject has exactly five modules`, () => {
      for (const subject of fixture.subjects) {
        const topics = fixture.topics[subject.id] ?? []
        assert.equal(topics.length, 5, `${subject.id} has ${topics.length} topics, expected 5`)
      }
    })

    it(`${fixture.programCode}: module numbers run 1..5 in order within each subject`, () => {
      for (const subject of fixture.subjects) {
        const topics = fixture.topics[subject.id] ?? []
        assert.deepEqual(
          topics.map((t) => t.moduleNumber),
          [1, 2, 3, 4, 5],
          `${subject.id} module numbers out of order`
        )
        assert.deepEqual(
          topics.map((t) => t.order),
          [1, 2, 3, 4, 5],
          `${subject.id} topic order out of sequence`
        )
      }
    })

    it(`${fixture.programCode}: total topic count is five per subject`, () => {
      const report = validatePrepCatalog(bundleFor(fixture))
      assert.equal(report.topicCount, fixture.subjects.length * 5)
      assert.equal(report.subjectCount, fixture.expectedSubjects)
    })
  }
})

describe('candidate CSE Prep study pack', () => {
  const cseSupplement = universalAcademicSupplementFor('cse')
  const routeBundle: PrepCatalogBundle = {
    programCode: 'cse',
    subjects: [...CSE_SUBJECTS, ...cseSupplement.subjects],
    topics: { ...SEEDED_CSE_TOPICS, ...cseSupplement.topics },
    questions: [...SEEDED_CSE_QUESTIONS, ...cseSupplement.questions],
  }

  it('validates the complete CSE seed plus the shared universal supplement', () => {
    const report = validatePrepCatalog(routeBundle)
    assert.equal(report.valid, true, report.issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'))
    assert.equal(report.errorCount, 0)
    assert.equal(report.subjectCount, 23)
    assert.equal(report.topicCount, 113)
    assert.equal(report.questionCount, 113)
  })

  it('contains 21 five-unit study packs with detailed subtopic briefs and one mapped question per unit', () => {
    assert.equal(CSE_COURSE_SEEDS.length, 21)
    assert.equal(CSE_SUBJECTS.length, 21)
    assert.equal(SEEDED_CSE_QUESTIONS.length, 105)
    for (const subject of CSE_SUBJECTS) {
      const topics = SEEDED_CSE_TOPICS[subject.id] ?? []
      assert.equal(subject.topicCount, 5, `${subject.id} subject topicCount`)
      assert.deepEqual(topics.map((topic) => topic.moduleNumber), [1, 2, 3, 4, 5], `${subject.id} module order`)
      for (const topic of topics) {
        assert.ok(topic.subtopicDetails && topic.subtopicDetails.length >= 4, `${topic.id} needs granular subtopics`)
        for (const subtopic of topic.subtopicDetails ?? []) {
          assert.ok(subtopic.briefMd.trim().length >= 20, `${subtopic.id} has a thin brief`)
        }
        assert.equal(topic.featuredQuestionIds.length, 1, `${topic.id} should map one CSE practice question`)
      }
    }
  })

  it('uses unique CSE subject, topic and question identifiers', () => {
    const topicIds = Object.values(SEEDED_CSE_TOPICS).flat().map((topic) => topic.id)
    const questionIds = SEEDED_CSE_QUESTIONS.map((question) => question.id)
    assert.equal(new Set(CSE_SUBJECTS.map((subject) => subject.id)).size, CSE_SUBJECTS.length)
    assert.equal(new Set(topicIds).size, topicIds.length)
    assert.equal(new Set(questionIds).size, questionIds.length)
    assert.ok(CSE_SUBJECTS.every((subject) => subject.programs.includes('cse') && subject.stream === 'computing'))
  })

  it('sorts candidate courses by semester and course order', () => {
    const expectedBySemester: Record<number, string[]> = {
      3: ['BCS301', 'BCS302', 'BCS303', 'BCS304', 'BCSL305', 'BCS306A', 'BCS306B'],
      4: ['BCS401', 'BCS402', 'BCS403'],
      5: ['BCS501', 'BCS502', 'BCS503', 'BCSL504'],
      6: ['BCS601', 'BCS602'],
      7: ['BCS701', 'BCS702', 'BCS703'],
    }
    for (const [semester, expected] of Object.entries(expectedBySemester)) {
      const actual = CSE_SUBJECTS
        .filter((subject) => subject.semester === Number(semester))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        .map((subject) => subject.syllabusRef?.match(/· ([A-Z0-9]+) ·/)?.[1])
      assert.deepEqual(actual, expected, `semester ${semester} order`)
    }
  })

  it('keeps the BCS302/303 practicals integrated and BCS304 as its own course', () => {
    for (const code of ['BCS302', 'BCS303', 'BCS304']) {
      assert.equal(CSE_COURSE_SEEDS.filter((course) => course.courseCode === code).length, 1, `${code} seed count`)
    }
    assert.ok(CSE_COURSE_SEEDS.some((course) => course.courseCode === 'BCS304' && course.name === 'Data Structures and Applications'))
    assert.equal(CSE_COURSE_SEEDS.filter((course) => ['BCSL302', 'BCSL303'].includes(course.courseCode ?? '')).length, 0)
    assert.ok(CSE_COURSE_SEEDS.some((course) => course.courseCode === 'BCSL305'))
  })

  it('keeps the corrected BCS402 identity and labels BCS306A/B as alternatives', () => {
    const microcontrollers = CSE_SUBJECTS.find((subject) => subject.id === 'cse-vtu22-microcontrollers')
    assert.equal(microcontrollers?.name, 'Microcontrollers')
    assert.equal(microcontrollers?.syllabusRef?.match(/· ([A-Z0-9]+) ·/)?.[1], 'BCS402')
    for (const code of ['BCS306A', 'BCS306B']) {
      const course = CSE_COURSE_SEEDS.find((entry) => entry.courseCode === code)
      assert.ok(course?.description.includes('choose this only'), `${code} option guidance`)
    }
    assert.equal(resolveSeedPrograms('cse').programs[0], 'cse')
    assert.ok(PREP_PROGRAM_CATALOG.some((program) => program.code === 'cse'))
    assert.ok(PREP_SEED_CODES.includes('cse'))
  })
})

describe('question mapping', () => {
  for (const fixture of COMPLETE_FIXTURES) {
    const topics = flattenTopics(fixture.topics)
    const questionIds = new Set(fixture.questions.map((q) => q.id))
    const topicIds = new Set(topics.map((t) => t.id))
    const subjectIds = new Set(fixture.subjects.map((s) => s.id))

    it(`${fixture.programCode}: question ids are unique`, () => {
      assert.equal(questionIds.size, fixture.questions.length)
    })

    it(`${fixture.programCode}: has two questions per module`, () => {
      assert.equal(fixture.questions.length, topics.length * 2)
      assert.equal(fixture.questions.length, fixture.expectedQuestions)
    })

    it(`${fixture.programCode}: every featured question id resolves to a real question`, () => {
      for (const topic of topics) {
        assert.equal(topic.featuredQuestionIds.length, 2, `${topic.id} must feature two questions`)
        for (const qid of topic.featuredQuestionIds) {
          assert.ok(questionIds.has(qid), `${topic.id} features unknown question "${qid}"`)
        }
      }
    })

    it(`${fixture.programCode}: every question tags a known subject and topic`, () => {
      for (const q of fixture.questions) {
        assert.ok(subjectIds.has(q.prepTags.subjectId), `${q.id} tags unknown subject "${q.prepTags.subjectId}"`)
        for (const tid of q.prepTags.topicIds) {
          assert.ok(topicIds.has(tid), `${q.id} tags unknown topic "${tid}"`)
        }
      }
    })

    it(`${fixture.programCode}: every question is reachable from the topic that features it`, () => {
      const featured = new Set<string>()
      for (const topic of topics) {
        for (const qid of topic.featuredQuestionIds) featured.add(qid)
      }
      for (const q of fixture.questions) {
        assert.ok(featured.has(q.id), `${q.id} is not featured by any topic`)
      }
      assert.equal(featured.size, fixture.questions.length)
    })

    it(`${fixture.programCode}: questions are approved and carry at least two options`, () => {
      for (const q of fixture.questions) {
        assert.equal(q.status, 'approved', `${q.id} is not approved`)
        assert.ok(q.options.length >= 2, `${q.id} has fewer than two options`)
        assert.ok(
          q.correctIndex >= 0 && q.correctIndex < q.options.length,
          `${q.id} has an out-of-range correctIndex`
        )
      }
    })
  }
})

describe('subject metadata', () => {
  for (const fixture of COMPLETE_FIXTURES) {
    it(`${fixture.programCode}: every subject declares the matching degree level`, () => {
      for (const subject of fixture.subjects) {
        assert.equal(subject.degreeLevel, fixture.degreeLevel, `${subject.id} has the wrong degreeLevel`)
      }
    })

    it(`${fixture.programCode}: every subject lists its own program code`, () => {
      for (const subject of fixture.subjects) {
        assert.ok(
          subject.programs.includes(fixture.programCode),
          `${subject.id} does not list program "${fixture.programCode}"`
        )
      }
    })
  }

  it('new Karnataka programs exist in PREP_PROGRAM_CATALOG with the right level', () => {
    const byCode = new Map(PREP_PROGRAM_CATALOG.map((p) => [p.code, p]))
    for (const code of ['ba', 'bsc', 'mcom']) {
      assert.ok(byCode.has(code), `PREP_PROGRAM_CATALOG is missing "${code}"`)
    }
    assert.equal(byCode.get('mcom')!.degreeLevel, 'postgraduate')
    assert.equal(byCode.get('bsc')!.degreeLevel, 'undergraduate')
    assert.equal(byCode.get('ba')!.degreeLevel, 'undergraduate')
  })

  it('getPrepProgramsForLevel splits the catalog by degree level', () => {
    const ug = getPrepProgramsForLevel('undergraduate').map((p) => p.code)
    const pg = getPrepProgramsForLevel('postgraduate').map((p) => p.code)
    const all = getPrepProgramsForLevel('all').map((p) => p.code)

    assert.ok(ug.includes('ba') && ug.includes('bsc') && ug.includes('bba'))
    assert.ok(pg.includes('mcom') && pg.includes('mba'))
    assert.ok(!ug.includes('mcom') && !pg.includes('ba'))
    assert.equal(all.length, PREP_PROGRAM_CATALOG.length)
    assert.equal(all.length, ug.length + pg.length)
  })
})

describe('legacy BBA catalogue (partial, pre-dates the completeness contract)', () => {
  const topics = flattenTopics(LEGACY_BBA.topics)
  const questionIds = new Set(LEGACY_BBA.questions.map((q) => q.id))
  const topicIds = new Set(topics.map((t) => t.id))
  const subjectIds = new Set(LEGACY_BBA.subjects.map((s) => s.id))

  it('pins the known partial shape so silent drift is caught', () => {
    assert.equal(LEGACY_BBA.subjects.length, 20)
    assert.equal(topics.length, 31)
    assert.equal(LEGACY_BBA.questions.length, 31)
  })

  it('has unique subject, topic and question ids', () => {
    assert.equal(subjectIds.size, LEGACY_BBA.subjects.length)
    assert.equal(topicIds.size, topics.length)
    assert.equal(questionIds.size, LEGACY_BBA.questions.length)
  })

  it('keeps every topic under its declared subject bucket', () => {
    for (const [subjectId, list] of Object.entries(LEGACY_BBA.topics)) {
      assert.ok(subjectIds.has(subjectId), `unknown subject bucket "${subjectId}"`)
      for (const topic of list) {
        assert.equal(topic.subjectId, subjectId, `${topic.id} is filed under the wrong subject`)
      }
    }
  })

  it('tags every question with a known subject and topic', () => {
    for (const q of LEGACY_BBA.questions) {
      assert.ok(subjectIds.has(q.prepTags.subjectId), `${q.id} tags unknown subject`)
      for (const tid of q.prepTags.topicIds) {
        assert.ok(topicIds.has(tid), `${q.id} tags unknown topic "${tid}"`)
      }
    }
  })

  it('keeps questions well-formed', () => {
    for (const q of LEGACY_BBA.questions) {
      assert.ok(q.questionText.trim().length > 0, `${q.id} has no text`)
      assert.ok(q.options.length >= 2, `${q.id} has fewer than two options`)
      assert.ok(q.correctIndex >= 0 && q.correctIndex < q.options.length, `${q.id} correctIndex out of range`)
    }
  })
})

describe('derived B.Com catalogue (bcom-tagged slice of the UG bundles)', () => {
  const topics = flattenTopics(SEEDED_BCOM_TOPICS)
  const questionIds = new Set(SEEDED_BCOM_QUESTIONS.map((q) => q.id))
  const topicIds = new Set(topics.map((t) => t.id))
  const subjectIds = new Set(BCOM_SUBJECTS.map((s) => s.id))

  it('actually derives content (not an empty placeholder)', () => {
    assert.ok(BCOM_SUBJECTS.length >= 10, `expected a real B.Com catalogue, got ${BCOM_SUBJECTS.length} subjects`)
    assert.ok(topics.length >= 20, `expected topics, got ${topics.length}`)
    assert.ok(SEEDED_BCOM_QUESTIONS.length >= 20, `expected questions, got ${SEEDED_BCOM_QUESTIONS.length}`)
  })

  it('every subject is bcom-tagged, from a real source bundle, and uniquely ordered', () => {
    const seenOrders = new Set<number>()
    for (const subject of BCOM_SUBJECTS) {
      assert.ok(subject.programs.includes('bcom'), `${subject.id} is not tagged for bcom`)
      assert.ok(
        BBA_SUBJECTS.some((s) => s.id === subject.id)
          || BA_SUBJECTS.some((s) => s.id === subject.id)
          || BSC_SUBJECTS.some((s) => s.id === subject.id),
        `${subject.id} is not part of any source bundle`
      )
      assert.ok(!seenOrders.has(subject.order), `duplicate order ${subject.order}`)
      seenOrders.add(subject.order)
    }
    // 1..N with no gaps
    assert.deepEqual([...seenOrders].sort((a, b) => a - b), BCOM_SUBJECTS.map((_, i) => i + 1))
  })

  it('writes byte-identical subject documents to the source bundle (no seed-order conflict)', () => {
    for (const subject of BCOM_SUBJECTS) {
      const source =
        BBA_SUBJECTS.find((s) => s.id === subject.id)
        ?? BA_SUBJECTS.find((s) => s.id === subject.id)
        ?? BSC_SUBJECTS.find((s) => s.id === subject.id)
      assert.ok(source, `${subject.id} missing from sources`)
      // `order` is the ONE field the derivation may renumber; everything the
      // seeder writes besides it must match the source bundle exactly.
      const { order: _derivedOrder, ...derivedRest } = subject
      const { order: _sourceOrder, ...sourceRest } = source
      assert.deepEqual(derivedRest, sourceRest, `${subject.id} diverges from its source subject document`)
    }
  })

  it('has unique subject, topic and question ids', () => {
    assert.equal(subjectIds.size, BCOM_SUBJECTS.length)
    assert.equal(topicIds.size, topics.length)
    assert.equal(questionIds.size, SEEDED_BCOM_QUESTIONS.length)
  })

  it('files every topic bucket under a derived subject', () => {
    for (const [subjectId, list] of Object.entries(SEEDED_BCOM_TOPICS)) {
      assert.ok(subjectIds.has(subjectId), `unknown subject bucket "${subjectId}"`)
      for (const topic of list) {
        assert.equal(topic.subjectId, subjectId, `${topic.id} is filed under the wrong subject`)
      }
    }
  })

  it('tags every question with a derived subject and a real topic', () => {
    for (const q of SEEDED_BCOM_QUESTIONS) {
      assert.ok(subjectIds.has(q.prepTags.subjectId), `${q.id} tags unknown subject`)
      for (const tid of q.prepTags.topicIds) {
        assert.ok(topicIds.has(tid), `${q.id} tags unknown topic "${tid}"`)
      }
    }
  })

  it('introduces no integrity errors beyond the sources\' documented quirks', () => {
    const report = validatePrepCatalog({
      programCode: 'bcom',
      subjects: BCOM_SUBJECTS,
      topics: SEEDED_BCOM_TOPICS,
      questions: SEEDED_BCOM_QUESTIONS,
    })
    const errors = report.issues.filter((i) => i.level === 'error')

    // Referential breaks are never acceptable in a derived bundle: every
    // error that could point at a missing/orphaned subject, topic or
    // question is one the derivation would have caused.
    const referentialCodes = new Set([
      'ORPHAN_TOPIC_BUCKET',
      'TOPIC_SUBJECT_MISMATCH',
      'SUBJECT_NO_TOPICS',
      'QUESTION_UNKNOWN_SUBJECT',
      'QUESTION_UNKNOWN_TOPIC',
      'DUPLICATE_SUBJECT_ID',
      'DUPLICATE_TOPIC_ID',
      'DUPLICATE_QUESTION_ID',
    ])
    const referential = errors.filter((i) => referentialCodes.has(i.code))
    assert.deepEqual(
      referential.map((i) => `${i.code}: ${i.message}`),
      [],
      'derived B.Com bundle must not contain referential integrity errors',
    )

    // The only tolerable residue is the legacy BBA bundle's documented
    // partial-catalog shape (topicCount 5 vs 1-3 authored topics, one
    // dangling featured id) — and even that must be present verbatim in a
    // source bundle, i.e. inherited, not invented.
    for (const issue of errors) {
      assert.ok(
        issue.code === 'TOPIC_COUNT_MISMATCH' || issue.code === 'FEATURED_QUESTION_MISSING',
        `unexpected error code in derived bundle: ${issue.code}`,
      )
      const inSource = [LEGACY_BBA, ...COMPLETE_FIXTURES].some((fixture) =>
        validatePrepCatalog(bundleFor(fixture)).issues.some(
          (s) => s.code === issue.code && s.message === issue.message,
        ),
      )
      assert.ok(inSource, `error not inherited from a source bundle: ${issue.message}`)
    }
  })
})


describe('shared placement-aptitude catalogue (QA / LR / Verbal)', () => {
  const bundle: PrepCatalogBundle = {
    programCode: 'aptitude',
    subjects: APTITUDE_SUBJECTS,
    topics: SEEDED_APTITUDE_TOPICS,
    questions: SEEDED_APTITUDE_QUESTIONS,
  }
  const topics = flattenTopics(SEEDED_APTITUDE_TOPICS)

  it('reports zero integrity errors', () => {
    const report = validatePrepCatalog(bundle)
    const messages = report.issues
      .filter((i) => i.level === 'error')
      .map((i) => `${i.code}: ${i.message}`)
    assert.deepEqual(messages, [], `aptitude integrity errors:\n${messages.join('\n')}`)
    assert.equal(report.valid, true)
  })

  it('ships three aptitude subjects on the aptitude track for every program', () => {
    assert.deepEqual(
      APTITUDE_SUBJECTS.map((s) => s.id),
      ['apt-quantitative-aptitude', 'apt-logical-reasoning', 'apt-verbal-ability'],
    )
    for (const subject of APTITUDE_SUBJECTS) {
      assert.equal(subject.track, 'aptitude', `${subject.id} is not on the aptitude track`)
      assert.equal(subject.stream === 'aptitude' || subject.stream === 'communication', true)
      assert.deepEqual([...subject.programs].sort(), [...PREP_PROGRAM_CODES].sort(), `${subject.id} must list every program`)
      assert.equal(subject.topicCount, (SEEDED_APTITUDE_TOPICS[subject.id] ?? []).length)
    }
  })

  it('every topic is grouped into a named module and ordered sequentially per subject', () => {
    for (const subject of APTITUDE_SUBJECTS) {
      const list = SEEDED_APTITUDE_TOPICS[subject.id] ?? []
      assert.ok(list.length >= 12, `${subject.id} has only ${list.length} topics`)
      assert.deepEqual(list.map((t) => t.order), list.map((_, i) => i + 1), `${subject.id} order out of sequence`)
      for (const t of list) {
        assert.ok(t.moduleNumber >= 1, `${t.id} missing moduleNumber`)
        assert.ok(t.moduleName && t.moduleName.length > 5, `${t.id} missing moduleName`)
        // Module numbers must never decrease as order increases.
      }
      for (let i = 1; i < list.length; i++) {
        assert.ok(list[i].moduleNumber >= list[i - 1].moduleNumber, `${list[i].id} module number regresses`)
      }
    }
  })

  it('every topic has sub-topics with briefs, and the legacy title list mirrors them', () => {
    for (const t of topics) {
      const details = t.subtopicDetails ?? []
      assert.ok(details.length >= 4, `${t.id} has only ${details.length} sub-topics`)
      assert.deepEqual(t.subtopics, details.map((d) => d.title), `${t.id} subtopics/subtopicDetails drift`)
      const ids = new Set<string>()
      for (const d of details) {
        assert.ok(d.id && !ids.has(d.id), `${t.id} duplicate sub-topic id ${d.id}`)
        ids.add(d.id)
        assert.ok(d.title.trim().length >= 3, `${t.id}/${d.id} empty title`)
        assert.ok(d.briefMd.trim().length >= 80, `${t.id}/${d.id} brief too short (${d.briefMd.length} chars)`)
      }
    }
  })

  it('every topic ships explanation, formulas, tricks, how-to-solve and an audience', () => {
    for (const t of topics) {
      assert.ok(t.explanationMd.length >= 800, `${t.id} explanation is thin`)
      assert.ok(t.formulas.length >= 1, `${t.id} has no formulas`)
      assert.ok(t.tricks.length >= 1, `${t.id} has no tricks`)
      assert.ok(t.howToSolve.length >= 2, `${t.id} has fewer than two how-to-solve steps`)
      assert.ok(Array.isArray(t.audience) && t.audience.length >= 1, `${t.id} has no audience`)
      assert.ok(['very_high', 'high', 'moderate'].includes(t.examFrequency as string), `${t.id} bad examFrequency`)
      assert.equal(t.status, 'published')
    }
  })

  it('every topic has at least two approved practice questions that resolve back to it', () => {
    const byTopic = new Map<string, number>()
    const ids = new Set<string>()
    for (const q of SEEDED_APTITUDE_QUESTIONS) {
      assert.ok(!ids.has(q.id), `duplicate question id ${q.id}`)
      ids.add(q.id)
      assert.equal(q.status, 'approved')
      assert.equal(q.prepTags.stream, 'aptitude')
      assert.ok(q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length, `${q.id} bad options`)
      assert.ok(q.explanation.trim().length >= 20, `${q.id} explanation too short`)
      for (const tid of q.prepTags.topicIds) byTopic.set(tid, (byTopic.get(tid) ?? 0) + 1)
    }
    for (const t of topics) {
      assert.ok((byTopic.get(t.id) ?? 0) >= 2, `${t.id} has ${byTopic.get(t.id) ?? 0} questions`)
      for (const fid of t.featuredQuestionIds) assert.ok(ids.has(fid), `${t.id} features unknown question ${fid}`)
    }
  })

  it('does not collide with any academic catalogue ids', () => {
    const academicSubjectIds = new Set(
      [...MCOM_SUBJECTS, ...BSC_SUBJECTS, ...BA_SUBJECTS, ...BCOM_SUBJECTS, ...BBA_SUBJECTS].map((s) => s.id),
    )
    const academicQuestionIds = new Set(
      [...SEEDED_MCOM_QUESTIONS, ...SEEDED_BSC_QUESTIONS, ...SEEDED_BA_QUESTIONS, ...SEEDED_BCOM_QUESTIONS, ...SEEDED_UNIVERSAL_QUESTIONS].map((q) => q.id),
    )
    for (const s of APTITUDE_SUBJECTS) assert.ok(!academicSubjectIds.has(s.id), `subject id collision ${s.id}`)
    for (const q of SEEDED_APTITUDE_QUESTIONS) assert.ok(!academicQuestionIds.has(q.id), `question id collision ${q.id}`)
  })
})

describe('universal academic supplement', () => {
  it('validates as a complete curriculum-independent pack for all Prep programs', () => {
    const report = validatePrepCatalog({
      programCode: 'universal',
      ...UNIVERSAL_ACADEMIC_BUNDLE,
    })
    assert.equal(report.valid, true, report.issues.map((issue) => issue.message).join('\n'))
    assert.equal(report.subjectCount, 5)
    assert.equal(report.topicCount, 14)
    assert.equal(report.questionCount, 14)
    assert.ok(UNIVERSAL_ACADEMIC_BUNDLE.subjects.every((subject) => !subject.syllabusRef && !subject.universityRegion))
  })

  it('is included when seeding each requested UG/commerce program', () => {
    const fixtures = [
      { code: 'bba', subjects: BBA_SUBJECTS, topics: SEEDED_BBA_TOPICS, questions: SEEDED_UNIVERSAL_QUESTIONS },
      { code: 'bcom', subjects: BCOM_SUBJECTS, topics: SEEDED_BCOM_TOPICS, questions: SEEDED_BCOM_QUESTIONS },
      { code: 'bsc', subjects: BSC_SUBJECTS, topics: SEEDED_BSC_TOPICS, questions: SEEDED_BSC_QUESTIONS },
      { code: 'ba', subjects: BA_SUBJECTS, topics: SEEDED_BA_TOPICS, questions: SEEDED_BA_QUESTIONS },
    ]
    for (const fixture of fixtures) {
      const supplement = universalAcademicSupplementFor(fixture.code)
      assert.ok(supplement.subjects.some((subject) => subject.id === 'universal-study-toolkit'), `${fixture.code} includes the shared toolkit`)
      const baseline = validatePrepCatalog({
        programCode: fixture.code,
        subjects: fixture.subjects,
        topics: fixture.topics,
        questions: fixture.questions,
      })
      const report = validatePrepCatalog({
        programCode: fixture.code,
        subjects: [...fixture.subjects, ...supplement.subjects],
        topics: { ...fixture.topics, ...supplement.topics },
        questions: [...fixture.questions, ...supplement.questions],
      })
      // Some legacy BBA rows carry documented completeness quirks. The new
      // supplement must validate on its own and must not add any new errors.
      assert.equal(report.errorCount, baseline.errorCount, `${fixture.code}: ${report.issues.map((issue) => issue.message).join('; ')}`)
    }
  })
})

describe('resolveSeedPrograms (master seeder selection)', () => {
  it('defaults to every program when nothing is supplied', () => {
    for (const input of [undefined, null, '', 'all', 'ALL']) {
      const r = resolveSeedPrograms(input)
      assert.equal(r.all, true, `expected all=true for ${JSON.stringify(input)}`)
      assert.deepEqual(r.programs, PREP_SEED_CODES)
      assert.deepEqual(r.errors, [])
    }
  })

  it('resolves a comma-separated list and trims / lowercases it', () => {
    const r = resolveSeedPrograms(' BA , mcom ')
    assert.equal(r.all, false)
    assert.deepEqual(r.programs, ['ba', 'mcom'])
    assert.deepEqual(r.errors, [])
  })

  it('resolves an array of codes', () => {
    const r = resolveSeedPrograms(['bsc', 'ba'])
    assert.deepEqual(r.programs, ['bsc', 'ba'])
    assert.equal(r.errors.length, 0)
  })

  it('de-duplicates repeated codes', () => {
    const r = resolveSeedPrograms('ba,ba,BA')
    assert.deepEqual(r.programs, ['ba'])
  })

  it('preserves request order so the operator controls seeding sequence', () => {
    assert.deepEqual(resolveSeedPrograms(['mcom', 'bba']).programs, ['mcom', 'bba'])
    assert.deepEqual(resolveSeedPrograms('mcom,bba').programs, ['mcom', 'bba'])
    // Reversing the request reverses the result.
    assert.deepEqual(resolveSeedPrograms('bba,mcom').programs, ['bba', 'mcom'])
  })

  it('reports unknown codes instead of silently dropping them', () => {
    const r = resolveSeedPrograms('ba,phd')
    assert.deepEqual(r.programs, ['ba'])
    assert.equal(r.errors.length, 1)
    assert.match(r.errors[0], /phd/)
  })

  it('rejects a non-string, non-array payload', () => {
    const r = resolveSeedPrograms(42)
    assert.equal(r.all, false)
    assert.deepEqual(r.programs, [])
    assert.equal(r.errors.length, 1)
  })

  it('escalates to all when the token "all" appears inside a list', () => {
    const r = resolveSeedPrograms('ba,all')
    assert.equal(r.all, true)
    assert.deepEqual(r.programs, PREP_SEED_CODES)
  })

  it('accepts shared tracks alongside program codes', () => {
    const r = resolveSeedPrograms('aptitude,bba,universal')
    assert.deepEqual(r.programs, ['aptitude', 'bba', 'universal'])
    assert.deepEqual(r.errors, [])
    // PREP_SEED_CODES is a superset of the program codes.
    for (const code of PREP_PROGRAM_CODES) assert.ok(PREP_SEED_CODES.includes(code))
    assert.ok(PREP_SEED_CODES.includes('aptitude'))
    assert.ok(PREP_SEED_CODES.includes('universal'))
  })
})

describe('chunkArray (Firestore batch splitting)', () => {
  it('returns an empty list for empty or non-array input', () => {
    assert.deepEqual(chunkArray([], 400), [])
    assert.deepEqual(chunkArray(undefined as any, 400), [])
  })

  it('splits into chunks no larger than the limit', () => {
    const items = Array.from({ length: 900 }, (_, i) => i)
    const chunks = chunkArray(items, 400)
    assert.deepEqual(chunks.map((c) => c.length), [400, 400, 100])
    assert.deepEqual(chunks.flat(), items)
  })

  it('never produces a chunk exceeding Firestore 500-write ceiling', () => {
    const chunks = chunkArray(Array.from({ length: 466 }, (_, i) => i), 400)
    for (const c of chunks) assert.ok(c.length <= 500)
  })

  it('keeps a single chunk when the input already fits', () => {
    assert.deepEqual(chunkArray([1, 2, 3], 400), [[1, 2, 3]])
  })

  it('falls back to width 1 for a non-positive size', () => {
    assert.deepEqual(chunkArray([1, 2], 0), [[1], [2]])
  })
})
