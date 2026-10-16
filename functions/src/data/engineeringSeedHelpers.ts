import type { PrepStream, PrepSubject, PrepTopic, UniversalQuestion } from '../prepShared'

/**
 * Shared builder for the curator-authored engineering study packs (CSE, ECE,
 * EEE, ME).
 *
 * Each branch supplies a compact curriculum map — courses, five modules per
 * course, granular subtopic briefs and one tagged practice item per module —
 * and this turns it into the same content contract used by every other Prep
 * catalogue. Branch-specific wording (program code, stream, tags, question
 * type label) is injected through an `EngineeringPackProfile` so every
 * engineering pack stays structurally identical and is validated by the same
 * tests.
 */

export type EngineeringQuestionSeed = {
  question: string
  answer: string
  distractors: [string, string, string]
  explanation: string
}

export type EngineeringModuleSeed = {
  id: string
  title: string
  overview: string
  subtopics: Array<[title: string, brief: string]>
  keyModel: string
  workedExample: string
  examTip: string
  question: EngineeringQuestionSeed
}

export type EngineeringCourseSeed = {
  id: string
  name: string
  semester?: number
  order: number
  courseCode?: string
  description: string
  scopeNote?: string
  /** Override the pack-level stream for a course (e.g. a management core in an engineering scheme). */
  stream?: PrepStream
  modules: EngineeringModuleSeed[]
}

export type EngineeringCatalog = {
  subjects: PrepSubject[]
  topics: Record<string, PrepTopic[]>
  questions: UniversalQuestion[]
}

export type EngineeringPackProfile = {
  /** Lowercase program code, e.g. 'cse' or 'ece'. */
  program: string
  /** Short branch label used inside solve-method question-type text, e.g. 'CSE'. */
  label: string
  stream: PrepStream
  icon: string
  publishedAt: string
  /** Extra tag applied to practice items that carry an official course code. */
  schemeTag: string
}

function yearGroupForSemester(semester?: number): PrepSubject['yearGroup'] {
  if (!semester) return undefined
  if (semester <= 2) return '1st-year'
  if (semester <= 4) return '2nd-year'
  if (semester <= 6) return '3rd-year'
  return '4th-year'
}

export function buildEngineeringCatalog(courses: EngineeringCourseSeed[], profile: EngineeringPackProfile): EngineeringCatalog {
  const subjects: PrepSubject[] = []
  const topics: Record<string, PrepTopic[]> = {}
  const questions: UniversalQuestion[] = []
  const questionType = `${profile.label} theory / numerical / design question`

  for (const course of courses) {
    const courseRef = course.courseCode
      ? `Candidate VTU 2022 map · ${course.courseCode} · Semester ${course.semester} · verify against current college syllabus`
      : course.scopeNote
    const yearGroup = yearGroupForSemester(course.semester)
    const stream = course.stream ?? profile.stream
    subjects.push({
      id: course.id,
      name: course.name,
      stream,
      programs: [profile.program],
      track: 'academic',
      degreeLevel: 'undergraduate',
      // Firestore rejects explicit `undefined` values. Unsemestered supplements
      // intentionally have no year/semester/region, so omit those optional
      // properties instead of writing them as undefined.
      ...(yearGroup ? { yearGroup } : {}),
      ...(course.semester !== undefined ? { semester: course.semester } : {}),
      ...(course.courseCode ? { universityRegion: 'karnataka' as const } : {}),
      ...(courseRef ? { syllabusRef: courseRef } : {}),
      icon: profile.icon,
      order: course.order,
      topicCount: course.modules.length,
      status: 'published',
      description: course.description,
    })

    topics[course.id] = course.modules.map((module, index) => {
      const moduleNumber = index + 1
      const subtopicDetails = module.subtopics.map(([title, brief], subIndex) => ({
        id: `${module.id}-sub${subIndex + 1}`,
        title,
        briefMd: brief,
      }))
      const questionId = `q-${module.id}`
      const topic: PrepTopic = {
        id: module.id,
        subjectId: course.id,
        title: module.title,
        moduleNumber,
        moduleName: `Module ${moduleNumber}: ${module.title}`,
        order: moduleNumber,
        difficulty: moduleNumber === 1 ? 'basic' : 'core',
        tier: 'free',
        status: 'published',
        generatedBy: 'curator',
        contentVersion: 1,
        publishedAt: profile.publishedAt,
        examFrequency: 'high',
        audience: ['tech'],
        featuredQuestionIds: [questionId],
        subtopics: subtopicDetails.map((subtopic) => subtopic.title),
        subtopicDetails,
        explanationMd: [
          `# ${module.title}`,
          module.overview,
          '## Topics and subtopics',
          ...subtopicDetails.map((subtopic, subIndex) =>
            `### ${subIndex + 1}. ${subtopic.title}\n${subtopic.briefMd}`,
          ),
          '## Worked application',
          module.workedExample,
          '## Exam focus',
          `State the assumptions, name the representation or model, show the reasoning in order, and finish by checking a boundary case. ${module.examTip}`,
        ].join('\n\n'),
        formulas: [{
          id: `model-${module.id}`,
          label: 'Key model / relationship',
          formula: module.keyModel,
          exampleQ: `How does the key model apply to ${module.title}?`,
          exampleA: module.workedExample,
        }],
        tricks: [{
          id: `tip-${module.id}`,
          title: 'Exam and implementation check',
          trick: module.examTip,
          whenToUse: 'When explaining the concept, tracing an algorithm, or justifying a design choice.',
        }],
        howToSolve: [
          {
            id: `solve-${module.id}-1`,
            step: '1. Model the problem',
            detail: `Identify the input, required result, constraints and assumptions. Select the representation that matches ${module.title}, and write down the invariant or property that must remain true.`,
            questionType,
          },
          {
            id: `solve-${module.id}-2`,
            step: '2. Apply the method and show the work',
            detail: `Use the relevant subtopic from ${module.title}; state the key model (${module.keyModel}), then show the intermediate steps rather than jumping to the result. ${module.examTip}`,
            questionType,
          },
          {
            id: `solve-${module.id}-3`,
            step: '3. Verify and interpret',
            detail: `Check the worked result against the given conditions and one edge case. Where applicable, state time/space cost, resource use, or a security/correctness limitation.`,
            questionType,
          },
        ],
      }

      const question: UniversalQuestion = {
        id: questionId,
        questionText: module.question.question,
        options: [module.question.answer, ...module.question.distractors],
        correctIndex: 0,
        explanation: module.question.explanation,
        difficulty: 'core',
        status: 'approved',
        prepTags: {
          subjectId: course.id,
          topicIds: [module.id],
          stream,
          program: profile.program,
        },
        tags: course.courseCode
          ? [profile.program, profile.schemeTag, 'module-review']
          : [profile.program, 'supplemental', 'module-review'],
      }
      questions.push(question)
      return topic
    })
  }

  return { subjects, topics, questions }
}
