// src/shared/utils/testQuestions.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendSectionQuestion,
  bankQuestionFits,
  emptyWrittenDraft,
  removeSectionQuestion,
  sectionSupportsQuestions,
  syncSectionQuestionMarks,
  sectionSupportsWrittenQuestions,
  snapshotFromBankQuestion,
  validateWrittenQuestion,
  writtenQuestionPayload,
  type BankQuestionLike,
} from './testQuestions'
import type { TestSection } from '../types/testTemplate'

const section = (over: Partial<TestSection> = {}): TestSection => ({
  id: 's1',
  order: 1,
  name: 'Quants',
  type: 'mcq',
  durationMinutes: 30,
  instructions: '',
  defaultCorrectMarks: 2,
  defaultPenalty: 0.5,
  plannedQuestions: 0,
  lockOnSubmit: false,
  questions: [],
  ...over,
})

const mcq: BankQuestionLike = {
  id: 'q1',
  text: 'What is 2+2?',
  type: 'mcq',
  options: [
    { id: 'A', text: '3', isCorrect: false },
    { id: 'B', text: '4', isCorrect: true },
  ],
}

test('section types: which ones take questions', () => {
  assert.equal(sectionSupportsQuestions('mcq'), true)
  assert.equal(sectionSupportsQuestions('msq'), true)
  assert.equal(sectionSupportsQuestions('numerical'), true)
  assert.equal(sectionSupportsQuestions('descriptive'), false)
  assert.equal(sectionSupportsQuestions('coding'), false)
  assert.equal(sectionSupportsWrittenQuestions('mcq'), true)
  assert.equal(sectionSupportsWrittenQuestions('msq'), false)
})

test('bank fit: MCQ section takes single-correct MCQ and true/false, not numerical', () => {
  assert.equal(bankQuestionFits(section(), mcq), true)
  const multi: BankQuestionLike = { ...mcq, options: [{ id: 'A', text: 'a', isCorrect: true }, { id: 'B', text: 'b', isCorrect: true }] }
  assert.equal(bankQuestionFits(section(), multi), false)
  assert.equal(bankQuestionFits(section(), { ...mcq, type: 'true_false' }), true)
  assert.equal(bankQuestionFits(section(), { id: 'n', text: 'x', type: 'numerical' }), false)
  assert.equal(bankQuestionFits(section(), { ...mcq, options: [{ id: 'A', text: 'only', isCorrect: true }] }), false)
})

test('bank fit: MSQ section needs two or more correct options', () => {
  const msq = section({ type: 'msq' })
  const single = mcq
  const multi: BankQuestionLike = {
    ...mcq,
    options: [
      { id: 'A', text: 'a', isCorrect: true },
      { id: 'B', text: 'b', isCorrect: true },
      { id: 'C', text: 'c', isCorrect: false },
    ],
  }
  assert.equal(bankQuestionFits(msq, single), false)
  assert.equal(bankQuestionFits(msq, multi), true)
  // Graded as multi_select so the answer key scores all correct options.
  assert.equal(snapshotFromBankQuestion(msq, multi, 1).type, 'multi_select')
  assert.equal(snapshotFromBankQuestion(section(), mcq, 1).type, 'mcq')
})

test('snapshot keeps options with the answer key and the section defaults', () => {
  const snap = snapshotFromBankQuestion(section(), { ...mcq, marks: undefined, negativeMarks: undefined }, 3)
  assert.equal(snap.questionId, 'q1')
  assert.equal(snap.order, 3)
  assert.equal(snap.marks, 2)
  assert.equal(snap.negativeMarks, 0.5)
  assert.deepEqual(snap.options?.map((o) => o.isCorrect), [false, true])
})

test('marks and penalty follow the section, not the bank or the draft', () => {
  const s = section({ defaultCorrectMarks: 4, defaultPenalty: 1 })
  const snap = snapshotFromBankQuestion(s, { ...mcq, marks: 2, negativeMarks: 0.5 }, 1)
  assert.equal(snap.marks, 4)
  assert.equal(snap.negativeMarks, 1)
  const payload = writtenQuestionPayload(s, { ...emptyWrittenDraft(s), text: 'x', options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: false }] })
  assert.equal(payload.marks, 4)
  assert.equal(payload.negativeMarks, 1)
})

test('changing the section marks updates every question in it', () => {
  const s = section({ defaultCorrectMarks: 1 })
  let t = appendSectionQuestion(s, snapshotFromBankQuestion(s, mcq, 1))
  t = appendSectionQuestion(t, snapshotFromBankQuestion(s, { ...mcq, id: 'q2' }, 2))
  const changed = syncSectionQuestionMarks({ ...t, defaultCorrectMarks: 2, defaultPenalty: 0.5 })
  assert.deepEqual(changed.questions.map((q) => [q.marks, q.negativeMarks]), [[2, 0.5], [2, 0.5]])
  const total = changed.questions.reduce((sum, q) => sum + q.marks, 0)
  assert.equal(total, 4)
})

test('written MCQ: needs exactly one correct option', () => {
  const draft = emptyWrittenDraft(section())
  draft.text = 'Pick one'
  draft.options[0].text = 'a'
  draft.options[1].text = 'b'
  draft.options[2].text = ''
  draft.options[3].text = ''
  assert.deepEqual(validateWrittenQuestion(section(), draft), [])

  const twoCorrect = { ...draft, options: draft.options.map((o) => ({ ...o, isCorrect: true })) }
  assert.ok(validateWrittenQuestion(section(), twoCorrect).some((e) => e.includes('exactly one')))

  const tooFew = { ...draft, options: [{ text: 'only', isCorrect: true }, { text: '', isCorrect: false }] }
  assert.ok(validateWrittenQuestion(section(), tooFew).some((e) => e.includes('at least two')))
})

test('written MCQ payload: options get letter ids and the correct letter is stored', () => {
  const draft = emptyWrittenDraft(section())
  draft.text = ' Pick one '
  draft.options[0] = { text: 'x', isCorrect: false }
  draft.options[1] = { text: 'y', isCorrect: false }
  draft.options[2] = { text: 'z', isCorrect: true }
  draft.options[3] = { text: '', isCorrect: false }
  const payload = writtenQuestionPayload(section(), draft)
  assert.equal(payload.text, 'Pick one')
  assert.equal(payload.type, 'mcq')
  assert.equal(payload.correctAnswer, 'C')
  assert.deepEqual(payload.options?.map((o) => o.id), ['A', 'B', 'C'])
})

test('written numerical: needs an answer and stores it as a string', () => {
  const num = section({ type: 'numerical' })
  const draft = { ...emptyWrittenDraft(num), text: 'Value of g?', numericalAnswer: ' 9.8 ' }
  assert.deepEqual(validateWrittenQuestion(num, draft), [])
  assert.equal(writtenQuestionPayload(num, draft).correctAnswer, '9.8')
  assert.ok(validateWrittenQuestion(num, { ...draft, numericalAnswer: '' }).length > 0)
})

test('append and remove keep order and refuse duplicates', () => {
  const snap = (id: string) => snapshotFromBankQuestion(section(), { ...mcq, id }, 0)
  let s = appendSectionQuestion(section(), snap('a'))
  s = appendSectionQuestion(s, snap('b'))
  s = appendSectionQuestion(s, snap('a'))
  assert.deepEqual(s.questions.map((q) => [q.questionId, q.order]), [['a', 1], ['b', 2]])
  s = removeSectionQuestion(s, 'a')
  assert.deepEqual(s.questions.map((q) => [q.questionId, q.order]), [['b', 1]])
})
