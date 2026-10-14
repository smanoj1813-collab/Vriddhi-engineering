import type { PrepSubject, PrepTopic, UniversalQuestion } from '../prepShared'

export type CseQuestionSeed = {
  question: string
  answer: string
  distractors: [string, string, string]
  explanation: string
}

export type CseModuleSeed = {
  id: string
  title: string
  overview: string
  subtopics: Array<[title: string, brief: string]>
  keyModel: string
  workedExample: string
  examTip: string
  question: CseQuestionSeed
}

export type CseCourseSeed = {
  id: string
  name: string
  semester?: number
  order: number
  courseCode?: string
  description: string
  scopeNote?: string
  modules: CseModuleSeed[]
}

export type CseCatalog = {
  subjects: PrepSubject[]
  topics: Record<string, PrepTopic[]>
  questions: UniversalQuestion[]
}

const PUBLISHED_AT = '2026-10-13T09:00:00.000Z'

function yearGroupForSemester(semester?: number): PrepSubject['yearGroup'] {
  if (!semester) return undefined
  if (semester <= 2) return '1st-year'
  if (semester <= 4) return '2nd-year'
  if (semester <= 6) return '3rd-year'
  return '4th-year'
}

/**
 * Turn the compact, curator-authored curriculum map into the same content
 * contract used by the other Prep catalogues: an explanation, key model,
 * exam tip, solve method, granular subtopic briefs and a tagged practice item.
 */
export function buildCseCatalog(courses: CseCourseSeed[]): CseCatalog {
  const subjects: PrepSubject[] = []
  const topics: Record<string, PrepTopic[]> = {}
  const questions: UniversalQuestion[] = []

  for (const course of courses) {
    const courseRef = course.courseCode
      ? `Candidate VTU 2022 map · ${course.courseCode} · Semester ${course.semester} · verify against current college syllabus`
      : course.scopeNote
    subjects.push({
      id: course.id,
      name: course.name,
      stream: 'computing',
      programs: ['cse'],
      track: 'academic',
      degreeLevel: 'undergraduate',
      yearGroup: yearGroupForSemester(course.semester),
      semester: course.semester,
      universityRegion: course.courseCode ? 'karnataka' : undefined,
      syllabusRef: courseRef,
      icon: 'Code2',
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
        publishedAt: PUBLISHED_AT,
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
            questionType: 'CSE theory / numerical / design question',
          },
          {
            id: `solve-${module.id}-2`,
            step: '2. Apply the method and show the work',
            detail: `Use the relevant subtopic from ${module.title}; state the key model (${module.keyModel}), then show the intermediate steps rather than jumping to the result. ${module.examTip}`,
            questionType: 'CSE theory / numerical / design question',
          },
          {
            id: `solve-${module.id}-3`,
            step: '3. Verify and interpret',
            detail: `Check the worked result against the given conditions and one edge case. Where applicable, state time/space cost, resource use, or a security/correctness limitation.`,
            questionType: 'CSE theory / numerical / design question',
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
          stream: 'computing',
          program: 'cse',
        },
        tags: course.courseCode
          ? ['cse', 'candidate-vtu-2022-map', 'module-review']
          : ['cse', 'supplemental', 'module-review'],
      }
      questions.push(question)
      return topic
    })
  }

  return { subjects, topics, questions }
}
