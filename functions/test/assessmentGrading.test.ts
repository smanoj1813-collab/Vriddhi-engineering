import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  gradeAssessmentPaper,
  gradeFromPercentage,
  gradeFromPercentageForScheme,
  summarizePaperOutcome,
  type ServerQuestion,
} from '../src/assessmentGrading'

function question(overrides: Partial<ServerQuestion>): ServerQuestion {
  return {
    id: 'q1',
    questionId: 'q1',
    order: 1,
    text: 'Question',
    type: 'mcq',
    marks: 2,
    negativeMarks: 0.5,
    options: [
      { id: 'a', text: 'A', isCorrect: true },
      { id: 'b', text: 'B' },
    ],
    ...overrides,
  }
}

describe('server assessment grading', () => {
  it('grades objective answers and applies configured negative marks', () => {
    const graded = gradeAssessmentPaper(
      [question({ id: 'correct', questionId: 'correct' }), question({ id: 'wrong', questionId: 'wrong' })],
      [
        { questionId: 'correct', selectedOptionId: 'a', isFlagged: false },
        { questionId: 'wrong', selectedOptionId: 'b', isFlagged: false },
      ]
    )
    assert.equal(graded.autoScore, 1.5)
    assert.equal(graded.correctCount, 1)
    assert.equal(graded.incorrectCount, 1)
  })

  it('requires an exact set for multi-select questions', () => {
    const q = question({
      type: 'multi_select',
      options: [
        { id: 'a', text: 'A', isCorrect: true },
        { id: 'b', text: 'B', isCorrect: true },
        { id: 'c', text: 'C' },
      ],
    })
    assert.equal(
      gradeAssessmentPaper([q], [{ questionId: 'q1', selectedOptionIds: ['b', 'a'], isFlagged: false }]).correctCount,
      1
    )
    assert.equal(
      gradeAssessmentPaper([q], [{ questionId: 'q1', selectedOptionIds: ['a'], isFlagged: false }]).incorrectCount,
      1
    )
  })

  it('normalizes exact fill-in answers and respects numerical tolerance', () => {
    const fill = question({ id: 'fill', questionId: 'fill', type: 'fill_in_blank', correctAnswer: ['New Delhi', 'Delhi'], options: [] })
    const number = question({ id: 'number', questionId: 'number', type: 'numerical', correctAnswer: '3.14', tolerance: 0.01, options: [] })
    const graded = gradeAssessmentPaper([fill, number], [
      { questionId: 'fill', textAnswer: '  new   delhi ', isFlagged: false },
      { questionId: 'number', numericalAnswer: 3.145, isFlagged: false },
    ])
    assert.equal(graded.correctCount, 2)
  })

  it('leaves subjective and unsupported matching answers for manual grading', () => {
    const graded = gradeAssessmentPaper(
      [
        question({ id: 'essay', questionId: 'essay', type: 'long_answer', marks: 10, options: [] }),
        question({ id: 'match', questionId: 'match', type: 'matching', marks: 4, options: [] }),
      ],
      [{ questionId: 'essay', textAnswer: 'Response', isFlagged: false }]
    )
    assert.equal(graded.needsManualGrading, true)
    assert.equal(graded.manualMax, 14)
    assert.equal(graded.perQuestion[0].status, 'pending_manual')
  })

  it('does not require faculty grading when subjective questions were not attempted', () => {
    const graded = gradeAssessmentPaper(
      [question({ id: 'essay', questionId: 'essay', type: 'long_answer', marks: 10, options: [] })],
      []
    )
    assert.equal(graded.needsManualGrading, false)
    assert.equal(graded.manualMax, 10)
    assert.equal(graded.unattemptedCount, 1)
  })

  it('derives grade bands only on the server', () => {
    assert.deepEqual(gradeFromPercentage(90), { grade: 'A+', gradePoint: 10 })
    assert.deepEqual(gradeFromPercentage(39.99), { grade: 'F', gradePoint: 0 })
  })

  it('uses the resolved pack grade table and never curves below its absolute pass floor', () => {
    const scheme = {
      gradeTable: [
        { grade: 'O', gradePoint: 10, minPercentage: 90 },
        { grade: 'A', gradePoint: 8, minPercentage: 70 },
        { grade: 'P', gradePoint: 4, minPercentage: 40 },
        { grade: 'F', gradePoint: 0, minPercentage: 0 },
      ],
      passCriteria: { aggregatePassPercentage: 40 },
      engineering: {
        grading: {
          method: 'relative' as const,
          minCohortSizeForRelative: 30,
          relativeBands: [
            { grade: 'A', gradePoint: 8, minPercentile: 50, absoluteMinPercentage: 40 },
            { grade: 'F', gradePoint: 0, minPercentile: 0, absoluteMinPercentage: 40 },
          ],
        },
      },
    }
    assert.deepEqual(gradeFromPercentageForScheme(39.99, scheme, { percentile: 99, size: 100 }), {
      grade: 'F', gradePoint: 0, method: 'absolute',
    })
    assert.deepEqual(gradeFromPercentageForScheme(72, scheme, { percentile: 70, size: 40 }), {
      grade: 'A', gradePoint: 8, method: 'relative',
    })
    assert.deepEqual(gradeFromPercentageForScheme(72, scheme), {
      grade: 'A', gradePoint: 8, method: 'absolute',
    })
    assert.deepEqual(gradeFromPercentageForScheme(45, {
      ...scheme,
      assessmentPassPercentage: 50,
    }), {
      grade: 'F', gradePoint: 0, method: 'absolute',
    })
  })
})

// ── Result-page outcome summary ─────────────────────────────────────────
// Regression: a paper with descriptive questions is graded as
// `manual_graded` + marks, which used to be counted as "0 correct" — the
// student's result page then read 0/8 correct, 0/8 incorrect, 0/8
// unattempted even though it showed 15/20 marks.
describe('summarizePaperOutcome', () => {
  const mcq = (id: string, marks = 1): ServerQuestion =>
    question({ id, questionId: id, marks, type: 'mcq', sectionName: 'Section A — MCQ' })
  const shortAnswer = (id: string, marks: number): ServerQuestion =>
    question({ id, questionId: id, marks, type: 'short_answer', sectionName: 'Section B — Short answers', options: [] })

  it('counts manually graded answers by the marks they were awarded', () => {
    const questions = [
      mcq('a1'), mcq('a2'), mcq('a3'), mcq('a4'), mcq('a5'),
      shortAnswer('b1', 5), shortAnswer('b2', 5), shortAnswer('b3', 5),
    ]
    const answers = questions.map((q) => ({ questionId: q.id, textAnswer: 'answer', isFlagged: false }))
    const gradingBreakdown = [
      ...['a1', 'a2', 'a3', 'a4', 'a5'].map((questionId) => ({ questionId, status: 'manual_graded', marksObtained: 1 })),
      { questionId: 'b1', status: 'manual_graded', marksObtained: 4 },
      { questionId: 'b2', status: 'manual_graded', marksObtained: 3 },
      { questionId: 'b3', status: 'manual_graded', marksObtained: 3 },
    ]
    const summary = summarizePaperOutcome({ questions, answers, gradingBreakdown })

    // 5 full-marks answers are correct, the three short answers earned part of
    // their marks — never "0 correct" for a paper worth 15/20.
    assert.equal(summary.correctCount, 5)
    assert.equal(summary.partialCount, 3)
    assert.equal(summary.incorrectCount, 0)
    assert.equal(summary.unattemptedCount, 0)
    assert.equal(summary.correctMarks, 5)
    assert.equal(summary.awardedMarks, 15)
    assert.equal(summary.totalMarks, 20)
    assert.equal(summary.answeredCount, 8)

    const sectionA = summary.sections.find((s) => s.sectionName === 'Section A — MCQ')
    const sectionB = summary.sections.find((s) => s.sectionName === 'Section B — Short answers')
    assert.deepEqual(
      { correct: sectionA?.correct, total: sectionA?.total, score: sectionA?.score, totalMarks: sectionA?.totalMarks, correctMarks: sectionA?.correctMarks, percentage: sectionA?.percentage },
      { correct: 5, total: 5, score: 5, totalMarks: 5, correctMarks: 5, percentage: 100 }
    )
    assert.deepEqual(
      { correct: sectionB?.correct, partial: sectionB?.partial, total: sectionB?.total, score: sectionB?.score, totalMarks: sectionB?.totalMarks, percentage: sectionB?.percentage },
      { correct: 0, partial: 3, total: 3, score: 10, totalMarks: 15, percentage: 67 }
    )
  })

  it('counts auto-graded objective answers, penalties and blanks honestly', () => {
    const questions = [mcq('right'), question({ id: 'wrong', questionId: 'wrong', marks: 2, type: 'mcq', negativeMarks: 0.5 }), mcq('blank')]
    const answers = [
      { questionId: 'right', selectedOptionId: 'a', isFlagged: false },
      { questionId: 'wrong', selectedOptionId: 'b', isFlagged: false },
    ]
    const summary = summarizePaperOutcome({
      questions,
      answers,
      gradingBreakdown: [
        { questionId: 'right', status: 'correct', marksObtained: 1 },
        { questionId: 'wrong', status: 'incorrect', marksObtained: -0.5 },
        { questionId: 'blank', status: 'unattempted', marksObtained: 0 },
      ],
    })
    assert.equal(summary.correctCount, 1)
    assert.equal(summary.incorrectCount, 1)
    assert.equal(summary.unattemptedCount, 1)
    assert.equal(summary.awardedMarks, 0.5)
    assert.equal(summary.correctMarks, 1)
  })

  it('hides awarded marks and reports pending while the paper is ungraded', () => {
    const questions = [shortAnswer('b1', 10), mcq('a1')]
    const summary = summarizePaperOutcome({
      questions,
      answers: [{ questionId: 'b1', textAnswer: 'essay text', isFlagged: false }],
      gradingBreakdown: [{ questionId: 'b1', status: 'pending_manual', marksObtained: null }],
      applyMarks: false,
    })
    assert.equal(summary.pendingCount, 1)
    assert.equal(summary.unattemptedCount, 1)
    assert.equal(summary.correctCount, 0)
    assert.equal(summary.perQuestion[0].marksObtained, null)
  })

  it('treats a blank answer as unattempted even when the blank earned no marks', () => {
    const summary = summarizePaperOutcome({
      questions: [shortAnswer('b1', 5)],
      answers: [],
      gradingBreakdown: [{ questionId: 'b1', status: 'incorrect', marksObtained: 0 }],
    })
    assert.equal(summary.unattemptedCount, 1)
    assert.equal(summary.incorrectCount, 0)
    assert.equal(summary.perQuestion[0].status, 'unattempted')
  })
})
