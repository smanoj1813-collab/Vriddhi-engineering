export interface ServerQuestion {
  id: string
  questionId: string
  order: number
  text: string
  type: string
  marks: number
  negativeMarks: number
  options: Array<{ id: string; text: string; isCorrect?: boolean }>
  correctAnswer?: string | string[]
  tolerance?: number
  explanation?: string
  sectionId?: string
  sectionName?: string
  difficulty?: string
  imageUrl?: string
  caseText?: string
  matchPairs?: Array<{ left: string; right: string }>
}

export interface ServerAnswer {
  questionId: string
  selectedOptionId?: string
  selectedOptionIds?: string[]
  textAnswer?: string
  numericalAnswer?: number
  matchedPairs?: Array<{ left: string; right: string }>
  isFlagged: boolean
}

export interface QuestionGrade {
  questionId: string
  isObjective: boolean
  status: 'correct' | 'incorrect' | 'unattempted' | 'pending_manual'
  marksObtained: number | null
}

export interface PaperGrade {
  autoScore: number
  autoMax: number
  manualMax: number
  correctCount: number
  incorrectCount: number
  unattemptedCount: number
  needsManualGrading: boolean
  perQuestion: QuestionGrade[]
}

/**
 * A question's outcome as the student reads it, not as the grader wrote it.
 *
 * The grading pipeline labels an objective answer `correct` / `incorrect`, but
 * a descriptive answer a faculty member marked is stored as `manual_graded`
 * with only a *number of marks* — so a paper with any descriptive question used
 * to report "0 correct" even when the student scored 10/15, and the overview
 * bars read 0/0/0 for the whole paper. `summarizePaperOutcome` turns whatever
 * the graders left behind (status labels, awarded marks, or nothing at all)
 * into one honest bucket per question.
 */
export type QuestionOutcomeStatus =
  | 'correct'
  | 'partial'
  | 'incorrect'
  | 'unattempted'
  | 'pending_manual'

export interface QuestionOutcome {
  questionId: string
  questionText: string
  questionType: string
  sectionName: string
  marks: number
  /** null while the paper is ungraded / awaiting manual grading. */
  marksObtained: number | null
  status: QuestionOutcomeStatus
  isAttempted: boolean
}

export interface SectionOutcome {
  sectionName: string
  total: number
  correct: number
  partial: number
  incorrect: number
  unattempted: number
  pending: number
  score: number
  totalMarks: number
  /** Marks the fully-correct answers carried — "3/5 correct · 15 marks". */
  correctMarks: number
  percentage: number
  accuracy: number
  timeTaken: number
}

export interface PaperOutcome {
  correctCount: number
  partialCount: number
  incorrectCount: number
  unattemptedCount: number
  pendingCount: number
  answeredCount: number
  /** Marks carried by the fully-correct answers. */
  correctMarks: number
  /** Marks awarded by every grader (auto + manual) put together. */
  awardedMarks: number
  totalMarks: number
  perQuestion: QuestionOutcome[]
  sections: SectionOutcome[]
}

export interface PaperOutcomeInput {
  questions: ServerQuestion[]
  answers: ServerAnswer[]
  /** `studentAssessments.gradingBreakdown`, or any subset of it. */
  gradingBreakdown?: Array<Record<string, unknown>> | null
  /**
   * False for an attempt that is still `submitted`: awarded marks are hidden
   * (null) and answered questions read as awaiting grading.
   */
  applyMarks?: boolean
}

const MARKS_EPSILON = 0.005

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Resolve one question's outcome. Marks, not status labels, are the source of
 * truth whenever they exist: an answer awarded full marks is correct whether an
 * auto-grader or a faculty member awarded them, and an answer awarded 10 of 15
 * is partial — never silently "0 correct".
 */
export function resolveQuestionOutcome(
  question: ServerQuestion,
  answer: ServerAnswer | undefined,
  grade: Record<string, unknown> | undefined,
  applyMarks = true
): QuestionOutcome {
  const marks = Math.max(0, Number(question.marks) || 0)
  const attempted = hasAnswer(answer)
  const rawStatus = String(grade?.status || '')
  const awardedRaw = finiteNumber(grade?.marksObtained)
  const awarded = applyMarks ? awardedRaw : null

  let status: QuestionOutcomeStatus
  if (!attempted) {
    status = 'unattempted'
  } else if (awarded === null) {
    status = 'pending_manual'
  } else if (awarded >= marks - MARKS_EPSILON) {
    status = 'correct'
  } else if (awarded > 0) {
    status = 'partial'
  } else if (rawStatus === 'pending_manual') {
    // A manual question with no marks recorded yet is still being graded.
    status = 'pending_manual'
  } else {
    status = 'incorrect'
  }

  return {
    questionId: question.id,
    questionText: String(question.text || ''),
    questionType: String(question.type || ''),
    sectionName: String(question.sectionName || 'General'),
    marks,
    marksObtained: status === 'pending_manual' ? null : awarded,
    status,
    isAttempted: attempted,
  }
}

/**
 * Bucket a whole paper: counts per outcome, marks the correct answers carried,
 * and the same numbers per section. Pure and dependency-free so it can be unit
 * tested and reused by every read path that shows a result.
 */
export function summarizePaperOutcome(input: PaperOutcomeInput): PaperOutcome {
  const answerMap = new Map(input.answers.map((answer) => [answer.questionId, answer]))
  const gradeMap = new Map(
    (input.gradingBreakdown || []).map((grade) => [String(grade?.questionId || ''), grade])
  )
  const applyMarks = input.applyMarks !== false

  const perQuestion: QuestionOutcome[] = input.questions.map((question) =>
    resolveQuestionOutcome(question, answerMap.get(question.id), gradeMap.get(question.id), applyMarks)
  )

  const round2 = (value: number) => Math.round(value * 100) / 100
  const summary: PaperOutcome = {
    correctCount: 0,
    partialCount: 0,
    incorrectCount: 0,
    unattemptedCount: 0,
    pendingCount: 0,
    answeredCount: 0,
    correctMarks: 0,
    awardedMarks: 0,
    totalMarks: 0,
    perQuestion,
    sections: [],
  }
  const sectionMap = new Map<string, SectionOutcome>()

  for (const outcome of perQuestion) {
    const section = sectionMap.get(outcome.sectionName) || {
      sectionName: outcome.sectionName,
      total: 0,
      correct: 0,
      partial: 0,
      incorrect: 0,
      unattempted: 0,
      pending: 0,
      score: 0,
      totalMarks: 0,
      correctMarks: 0,
      percentage: 0,
      accuracy: 0,
      timeTaken: 0,
    }
    section.total += 1
    section.totalMarks += outcome.marks
    summary.totalMarks += outcome.marks
    if (outcome.isAttempted) summary.answeredCount += 1

    switch (outcome.status) {
      case 'correct':
        section.correct += 1
        section.correctMarks += outcome.marks
        summary.correctCount += 1
        summary.correctMarks += outcome.marks
        break
      case 'partial':
        section.partial += 1
        summary.partialCount += 1
        break
      case 'incorrect':
        section.incorrect += 1
        summary.incorrectCount += 1
        break
      case 'unattempted':
        section.unattempted += 1
        summary.unattemptedCount += 1
        break
      default:
        section.pending += 1
        summary.pendingCount += 1
        break
    }

    if (outcome.marksObtained !== null) {
      section.score += outcome.marksObtained
      summary.awardedMarks += outcome.marksObtained
    }
    sectionMap.set(outcome.sectionName, section)
  }

  summary.correctMarks = round2(summary.correctMarks)
  summary.awardedMarks = round2(summary.awardedMarks)
  summary.totalMarks = round2(summary.totalMarks)
  summary.sections = [...sectionMap.values()].map((section) => ({
    ...section,
    score: round2(section.score),
    correctMarks: round2(section.correctMarks),
    totalMarks: round2(section.totalMarks),
    percentage: section.totalMarks > 0 ? Math.round((section.score / section.totalMarks) * 100) : 0,
    accuracy: section.total > 0 ? Math.round((section.correct / section.total) * 100) : 0,
  }))

  return summary
}

const OBJECTIVE_OPTION_TYPES = new Set([
  'mcq',
  'single_choice',
  'true_false',
  'assertion_reason',
  'case_based',
])

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en')
}

function selectedCorrectIds(question: ServerQuestion): string[] {
  const flagged = question.options.filter((option) => option.isCorrect).map((option) => option.id)
  if (flagged.length > 0) return flagged
  const raw = Array.isArray(question.correctAnswer)
    ? question.correctAnswer
    : question.correctAnswer === undefined
      ? []
      : [question.correctAnswer]
  return raw.map(String).map((answer) => {
    const matchingOption = question.options.find((option) =>
      option.id === answer || normalizeText(option.text) === normalizeText(answer)
    )
    return matchingOption?.id || answer
  })
}

function hasAnswer(answer: ServerAnswer | undefined): boolean {
  if (!answer) return false
  return Boolean(
    answer.selectedOptionId
    || answer.selectedOptionIds?.length
    || answer.textAnswer?.trim()
    || answer.numericalAnswer !== undefined
    || answer.matchedPairs?.length
  )
}

function equalSets(left: string[], right: string[]): boolean {
  const a = [...new Set(left.map(String))].sort()
  const b = [...new Set(right.map(String))].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/** Grades only answer forms whose correctness can be determined exactly. */
export function gradeAssessmentPaper(
  questions: ServerQuestion[],
  answers: ServerAnswer[]
): PaperGrade {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]))
  const result: PaperGrade = {
    autoScore: 0,
    autoMax: 0,
    manualMax: 0,
    correctCount: 0,
    incorrectCount: 0,
    unattemptedCount: 0,
    needsManualGrading: false,
    perQuestion: [],
  }

  for (const question of questions) {
    const type = question.type.toLowerCase().replace(/\s+/g, '_')
    const answer = byQuestion.get(question.id) || byQuestion.get(question.questionId)
    const marks = Math.max(0, question.marks)
    const penalty = Math.max(0, question.negativeMarks)
    const correctIds = selectedCorrectIds(question)
    const optionBased = OBJECTIVE_OPTION_TYPES.has(type) && correctIds.length === 1
    const multiSelect = type === 'multi_select' && correctIds.length > 0
    const exactText = type === 'fill_in_blank' && question.correctAnswer !== undefined
    const numerical = type === 'numerical' && question.correctAnswer !== undefined
    const isObjective = optionBased || multiSelect || exactText || numerical

    if (!isObjective) {
      result.manualMax += marks
      const attempted = hasAnswer(answer)
      if (attempted) result.needsManualGrading = true
      result.perQuestion.push({
        questionId: question.id,
        isObjective: false,
        status: attempted ? 'pending_manual' : 'unattempted',
        marksObtained: null,
      })
      if (!hasAnswer(answer)) result.unattemptedCount += 1
      continue
    }

    result.autoMax += marks
    if (!hasAnswer(answer)) {
      result.unattemptedCount += 1
      result.perQuestion.push({
        questionId: question.id,
        isObjective: true,
        status: 'unattempted',
        marksObtained: 0,
      })
      continue
    }

    let correct = false
    if (optionBased) {
      correct = String(answer?.selectedOptionId || '') === correctIds[0]
    } else if (multiSelect) {
      correct = equalSets(answer?.selectedOptionIds || [], correctIds)
    } else if (exactText) {
      const accepted = Array.isArray(question.correctAnswer)
        ? question.correctAnswer
        : [question.correctAnswer as string]
      correct = accepted.some((value) => normalizeText(value) === normalizeText(answer?.textAnswer))
    } else if (numerical) {
      const expected = Number(Array.isArray(question.correctAnswer)
        ? question.correctAnswer[0]
        : question.correctAnswer)
      const actual = Number(answer?.numericalAnswer)
      const tolerance = Math.max(0, Number(question.tolerance) || 0)
      correct = Number.isFinite(expected)
        && Number.isFinite(actual)
        && Math.abs(expected - actual) <= tolerance
    }

    if (correct) {
      result.autoScore += marks
      result.correctCount += 1
      result.perQuestion.push({
        questionId: question.id,
        isObjective: true,
        status: 'correct',
        marksObtained: marks,
      })
    } else {
      result.autoScore -= penalty
      result.incorrectCount += 1
      result.perQuestion.push({
        questionId: question.id,
        isObjective: true,
        status: 'incorrect',
        marksObtained: -penalty,
      })
    }
  }

  return result
}

export function gradeFromPercentage(percentage: number): { grade: string; gradePoint: number } {
  if (percentage >= 90) return { grade: 'A+', gradePoint: 10 }
  if (percentage >= 80) return { grade: 'A', gradePoint: 9 }
  if (percentage >= 70) return { grade: 'B+', gradePoint: 8 }
  if (percentage >= 60) return { grade: 'B', gradePoint: 7 }
  if (percentage >= 50) return { grade: 'C', gradePoint: 6 }
  if (percentage >= 40) return { grade: 'D', gradePoint: 5 }
  return { grade: 'F', gradePoint: 0 }
}

export interface SchemeGradingSnapshot {
  gradeTable?: Array<{ grade: string; gradePoint: number; minPercentage: number }>
  passCriteria?: { aggregatePassPercentage?: number }
  /** Per-assessment override, kept separate from the immutable pack criteria. */
  assessmentPassPercentage?: number
  engineering?: {
    grading?: {
      method?: 'absolute' | 'relative'
      minCohortSizeForRelative?: number
      relativeBands?: Array<{
        grade: string
        gradePoint: number
        minPercentile: number
        absoluteMinPercentage?: number
      }>
    }
  }
}

/** Scheme-aware server grade; an absolute pass floor always wins over curves. */
export function gradeFromPercentageForScheme(
  percentage: number,
  scheme?: SchemeGradingSnapshot | null,
  cohort?: { percentile?: number | null; size?: number | null },
): { grade: string; gradePoint: number; method: 'absolute' | 'relative' } {
  if (!Number.isFinite(percentage)) return { ...gradeFromPercentage(0), method: 'absolute' }
  const configuredPassFloor = Number(scheme?.passCriteria?.aggregatePassPercentage ?? 40)
  const assessmentPassFloor = Number(scheme?.assessmentPassPercentage ?? 0)
  const passFloor = Math.max(
    Number.isFinite(configuredPassFloor) ? configuredPassFloor : 40,
    Number.isFinite(assessmentPassFloor) ? assessmentPassFloor : 0,
  )
  if (percentage < passFloor) return { grade: 'F', gradePoint: 0, method: 'absolute' }

  const grading = scheme?.engineering?.grading
  const bands = grading?.relativeBands
  const minCohort = Number(grading?.minCohortSizeForRelative ?? 0)
  if (
    grading?.method === 'relative'
    && Array.isArray(bands)
    && bands.length > 0
    && cohort?.percentile != null
    && Number.isFinite(cohort.percentile)
    && Number(cohort.size ?? 0) >= minCohort
  ) {
    for (const band of [...bands].sort((left, right) => right.minPercentile - left.minPercentile)) {
      if (cohort.percentile >= band.minPercentile) {
        if (band.absoluteMinPercentage != null && percentage < band.absoluteMinPercentage) continue
        return { grade: band.grade, gradePoint: band.gradePoint, method: 'relative' }
      }
    }
  }

  const table = scheme?.gradeTable;
  if (Array.isArray(table) && table.length > 0) {
    const matched = [...table]
      .sort((left, right) => right.minPercentage - left.minPercentage)
      .find((row) => percentage >= row.minPercentage)
    if (matched) return { grade: matched.grade, gradePoint: matched.gradePoint, method: 'absolute' }
  }
  return { ...gradeFromPercentage(percentage), method: 'absolute' }
}
