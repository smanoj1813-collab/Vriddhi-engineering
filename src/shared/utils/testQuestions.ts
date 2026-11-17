// src/shared/utils/testQuestions.ts
// ─── Attaching questions to a Create Test section ────────────────────────────
//
// A section stores a SNAPSHOT of each question (docs/ASSESSMENT_CREATE_TEST_FLOW.md
// §1): text, type, options with the answer key, marks and penalty. Duplicating a
// test then costs one write, and a student never reads the question bank.
//
// Pure helpers only — no Firestore. The dialog and the wizard call these.
//
// Scope of this round:
//   • mcq      → bank MCQ / true-false, or a written single-correct MCQ
//   • numerical→ bank numerical, or a written numerical question
//   • msq      → bank MCQs with two or more correct options, stored as multi_select
//                (no written MSQ yet)
//   • descriptive, coding → not attachable yet (coding needs its test-case config,
//     which the snapshot does not carry)

import type {
  TestSection,
  TestSectionQuestion,
  TestSectionType,
} from '../types/testTemplate';

/** Bank question types each section type can hold. */
export const SECTION_BANK_TYPES: Readonly<Record<TestSectionType, readonly string[]>> = {
  mcq: ['mcq', 'true_false'],
  msq: ['mcq'],
  numerical: ['numerical'],
  descriptive: [],
  coding: [],
};

/** Whether the dialog can attach anything to this section type yet. */
export function sectionSupportsQuestions(type: TestSectionType): boolean {
  return SECTION_BANK_TYPES[type].length > 0;
}

/** Whether a section type can be written by hand (not just picked from the bank). */
export function sectionSupportsWrittenQuestions(type: TestSectionType): boolean {
  return type === 'mcq' || type === 'numerical';
}

/** Minimal bank-question shape the helpers need. */
export interface BankQuestionLike {
  id: string;
  text: string;
  type: string;
  marks?: number;
  negativeMarks?: number;
  difficulty?: string;
  topic?: string;
  options?: Array<{ id: string; text: string; isCorrect?: boolean }>;
  correctAnswer?: string | string[];
}

function correctCount(q: BankQuestionLike): number {
  return (q.options ?? []).filter((o) => o.isCorrect).length;
}

/**
 * Can this bank question go into a section of this type?
 *
 * The grader scores an `mcq` automatically only when it has exactly one correct
 * option (functions/src/assessmentGrading.ts). So an MCQ section takes only
 * single-correct MCQs, and an MSQ section takes multi-correct MCQs, which are
 * stored as `multi_select` (see snapshotFromBankQuestion).
 */
export function bankQuestionFits(section: Pick<TestSection, 'type'>, q: BankQuestionLike): boolean {
  if (!SECTION_BANK_TYPES[section.type].includes(q.type)) return false;
  if (q.type === 'mcq') {
    if ((q.options ?? []).length < 2) return false;
    const correct = correctCount(q);
    return section.type === 'msq' ? correct >= 2 : correct === 1;
  }
  return true;
}

/** True when a section already holds this question (by bank id). */
export function sectionHasQuestion(section: Pick<TestSection, 'questions'>, questionId: string): boolean {
  return (section.questions ?? []).some((q) => q.questionId === questionId);
}

/** Snapshot of a bank question as stored on the section. */
export function snapshotFromBankQuestion(
  section: Pick<TestSection, 'type' | 'defaultCorrectMarks' | 'defaultPenalty'>,
  q: BankQuestionLike,
  order: number,
): TestSectionQuestion {
  // A multi-correct MCQ in an MSQ section is graded as multi_select.
  const type = section.type === 'msq' && q.type === 'mcq' && correctCount(q) >= 2 ? 'multi_select' : q.type
  return {
    questionId: q.id,
    order,
    marks: Number.isFinite(q.marks) && (q.marks as number) > 0 ? (q.marks as number) : section.defaultCorrectMarks,
    negativeMarks: Number.isFinite(q.negativeMarks) ? (q.negativeMarks as number) : section.defaultPenalty,
    text: q.text,
    type,
    ...(q.difficulty ? { difficulty: q.difficulty } : {}),
    ...(q.topic ? { topic: q.topic } : {}),
    ...(q.options?.length
      ? {
          options: q.options.map((o, i) => ({
            id: o.id || String.fromCharCode(65 + Math.min(i, 25)),
            text: o.text,
            isCorrect: Boolean(o.isCorrect),
          })),
        }
      : {}),
    ...(q.correctAnswer !== undefined ? { correctAnswer: q.correctAnswer } : {}),
  };
}

/** A question written in the dialog. */
export interface WrittenQuestionDraft {
  text: string;
  options: Array<{ text: string; isCorrect: boolean }>;
  /** Numerical answer, as typed. */
  numericalAnswer: string;
  marks: number | '';
  negativeMarks: number | '';
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export function emptyWrittenDraft(section: Pick<TestSection, 'defaultCorrectMarks' | 'defaultPenalty'>): WrittenQuestionDraft {
  return {
    text: '',
    options: [
      { text: '', isCorrect: true },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false },
    ],
    numericalAnswer: '',
    marks: section.defaultCorrectMarks || '',
    negativeMarks: section.defaultPenalty || 0,
    topic: '',
    difficulty: 'medium',
  };
}

/** Validation for a written question. Empty array = valid. */
export function validateWrittenQuestion(section: Pick<TestSection, 'type'>, draft: WrittenQuestionDraft): string[] {
  const errors: string[] = [];
  if (!sectionSupportsWrittenQuestions(section.type)) {
    errors.push('This section type takes questions from the question bank only.');
    return errors;
  }
  if (!draft.text.trim()) errors.push('Question text is required.');
  if (draft.marks === '' || !(Number(draft.marks) > 0)) errors.push('Marks must be greater than zero.');
  if (draft.negativeMarks !== '' && Number(draft.negativeMarks) < 0) errors.push('Negative marks cannot be negative.');
  if (section.type === 'mcq') {
    const filled = draft.options.filter((o) => o.text.trim());
    if (filled.length < 2) errors.push('An MCQ needs at least two options.');
    const correct = draft.options.filter((o) => o.isCorrect && o.text.trim());
    if (correct.length !== 1) errors.push('Mark exactly one option as correct.');
    if (draft.options.some((o) => o.isCorrect && !o.text.trim())) errors.push('The correct option is empty.');
  }
  if (section.type === 'numerical' && !draft.numericalAnswer.trim()) {
    errors.push('Enter the correct numerical answer.');
  }
  return errors;
}

/**
 * Builds the bank payload for a written question. The same object becomes the
 * snapshot and, when "save to question bank" is on, the bank document.
 */
export function writtenQuestionPayload(
  section: Pick<TestSection, 'type' | 'defaultCorrectMarks' | 'defaultPenalty'>,
  draft: WrittenQuestionDraft,
): Omit<BankQuestionLike, 'id'> {
  const marks = Number(draft.marks);
  const negativeMarks = draft.negativeMarks === '' ? section.defaultPenalty : Number(draft.negativeMarks);
  if (section.type === 'numerical') {
    return {
      text: draft.text.trim(),
      type: 'numerical',
      marks,
      negativeMarks,
      difficulty: draft.difficulty,
      ...(draft.topic.trim() ? { topic: draft.topic.trim() } : {}),
      correctAnswer: draft.numericalAnswer.trim(),
    };
  }
  const options = draft.options
    .filter((o) => o.text.trim())
    .map((o, i) => ({ id: String.fromCharCode(65 + i), text: o.text.trim(), isCorrect: o.isCorrect }));
  const correct = options.find((o) => o.isCorrect);
  return {
    text: draft.text.trim(),
    type: 'mcq',
    marks,
    negativeMarks,
    difficulty: draft.difficulty,
    ...(draft.topic.trim() ? { topic: draft.topic.trim() } : {}),
    options,
    correctAnswer: correct ? correct.id : '',
  };
}

/** Adds a question to a section in order, refusing duplicates. */
export function appendSectionQuestion(section: TestSection, question: TestSectionQuestion): TestSection {
  if (sectionHasQuestion(section, question.questionId)) return section;
  const questions = [...(section.questions ?? []), question].map((q, i) => ({ ...q, order: i + 1 }));
  return { ...section, questions };
}

/** Removes a question and renumbers the rest. */
export function removeSectionQuestion(section: TestSection, questionId: string): TestSection {
  const questions = (section.questions ?? [])
    .filter((q) => q.questionId !== questionId)
    .map((q, i) => ({ ...q, order: i + 1 }));
  return { ...section, questions };
}
