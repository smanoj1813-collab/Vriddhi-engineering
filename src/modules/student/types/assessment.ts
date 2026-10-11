// src/modules/student/types/assessment.ts
// Complete assessment types for student test-taking

export type TestStatus = 'upcoming' | 'available' | 'ongoing' | 'completed' | 'graded' | 'missed';
export type StudentTestStatus = 'not_started' | 'in_progress' | 'submitted' | 'graded' | 'absent';

export interface StudentTestCard {
  id: string;
  assessmentId: string;
  title: string;
  subject: string;
  courseCode?: string;
  courseName?: string;
  totalMarks: number;
  duration: number; // minutes
  startDateTime: string;
  endDateTime: string;
  status: TestStatus;
  studentStatus: StudentTestStatus;
  canStart: boolean;
  instructions: string[];
  totalQuestions: number;
  marksObtained?: number;
  percentage?: number;
  grade?: string;
  timeSpent?: number;
  submittedAt?: string;
  paperId: string;
  collegeId: string;
  branch: string;
  batch: string;
  semester: number;
  division?: string;
  section?: string;
}

export interface PaperQuestion {
  id: string;
  questionId: string;
  order: number;
  marks: number;
  text: string;
  type: 'mcq' | 'multi_select' | 'true_false' | 'fill_in_blank' | 'short_answer' | 'long_answer' | 'numerical' | 'assertion_reason' | 'case_based' | 'matching' | 'coding';
  difficulty: 'easy' | 'medium' | 'hard';
  options?: { id: string; text: string; isCorrect?: boolean }[];
  hasImage?: boolean;
  imageUrl?: string;
  /**
   * Present on a coding question. `sampleCases` are public; `caseCount` is how
   * many HIDDEN tests the marks are split across — the cases themselves never
   * reach the browser.
   */
  coding?: {
    languages: string[];
    starterCode?: Record<string, string>;
    sampleCases?: Array<{ stdin?: string; expectedOutput?: string }>;
    timeLimitSeconds?: number;
    caseCount?: number;
    /** True when these numbers were generated for this student. */
    variesByStudent?: boolean;
    /** Sample runs allowed for this question; 0 = unlimited. */
    dryRunLimit?: number;
  };
  sectionId?: string;
  sectionName?: string;
  negativeMarks?: number;
  /** Numerical tolerance for auto-grading (paper-supplied) */
  tolerance?: number;
  /** Case-study / assertion prompt body shown above the question */
  caseText?: string;
  /** Matching-type pairs (manual grading in Phase 2) */
  matchPairs?: Array<{ left: string; right: string }>;
  // Review-only fields — stripped from payloads sent to the player before submit
  correctAnswer?: string | string[];
  explanation?: string;
  // Compatibility aliases used by pages
  questionText?: string;
  questionType?: string;
}

export interface StudentAnswer {
  questionId: string;
  /** A coded answer (a `coding` question). Graded by running it, not by a key. */
  coding?: { language: string; code: string };
  selectedOptionId?: string;
  selectedOptionIds?: string[];
  textAnswer?: string;
  numericalAnswer?: number;
  isFlagged: boolean;
  timeSpent: number; // seconds
  visitedAt: string;
  answeredAt?: string;
  // Compatibility alias for match-following questions
  matchedPairs?: Array<{ left: string; right: string }>;
}

export interface ActiveTest {
  studentAssessmentId: string;
  assessmentId: string;
  paperId: string;
  title: string;
  subject: string;
  totalMarks: number;
  duration: number;
  startedAt: string;
  endsAt: string;
  questions: PaperQuestion[];
  flaggedQuestions: string[];
  instructions: string[];
  negativeMarking: boolean;
  collegeId: string;
  // Compatibility alias used by instructions page
  totalQuestions?: number;
  // Phase 2 engine fields
  testId: string;
  studentStatus: StudentTestStatus;
  /** restored answers when resuming an in_progress attempt */
  answers?: Record<string, Partial<StudentAnswer>>;
  resumed?: boolean;
  enableProctoring?: boolean;
  allowResume?: boolean;
  scheduledStart?: string;
  /** 0 = unlimited tab switches; beyond this the student engine auto-submits. */
  maxTabSwitches?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  shuffleSections?: boolean;
}

export interface TestResultSummary {
  studentAssessmentId: string;
  assessmentId: string;
  title: string;
  subject: string;
  totalMarks: number;
  marksObtained: number;
  percentage: number;
  grade: string;
  gradePoint: number;
  timeSpent: number;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  unattemptedCount: number;
  sectionWise: {
    sectionId: string;
    sectionName: string;
    totalMarks: number;
    marksObtained: number;
    questionsCount: number;
    answeredCount: number;
  }[];
  questionResults: {
    questionId: string;
    order: number;
    marks: number;
    marksObtained: number;
    status: 'correct' | 'incorrect' | 'unattempted' | 'partial';
    yourAnswer: string;
    correctAnswer: string;
    explanation?: string;
  }[];
  rank?: number;
  totalStudents?: number;
  facultyFeedback?: string;
  submittedAt: string;
  gradedAt?: string;
  // Dashboard compatibility aliases
  testId?: string;
  score?: number;
  completedAt?: string;
}

export interface TestResultDetail {
  studentAssessmentId: string;
  assessmentId: string;
  title: string;
  subject: string;
  totalMarks: number;
  marksObtained: number;
  percentage: number;
  grade: string;
  gradePoint: number;
  timeSpent: number;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  /** Answers that earned some, but not all, of their marks. */
  partialCount?: number;
  incorrectCount: number;
  unattemptedCount: number;
  /** Descriptive answers the faculty has not marked yet (graded papers: 0). */
  pendingCount?: number;
  /** Marks carried by the fully-correct answers. */
  correctMarks?: number;
  /** Every mark awarded, auto and manual together. */
  awardedMarks?: number;
  sectionScores: {
    sectionName: string;
    total: number;
    correct: number;
    partial?: number;
    incorrect: number;
    unattempted?: number;
    pending?: number;
    score: number;
    totalMarks: number;
    /** Marks carried by this section's fully-correct answers. */
    correctMarks?: number;
    percentage: number;
    timeTaken: number;
    accuracy: number;
  }[];
  questionResults: {
    questionId: string;
    questionText: string;
    questionType?: string;
    sectionName?: string;
    marks: number;
    /** null while the answer is still being graded. */
    marksObtained?: number | null;
    /** correct | partial | incorrect | unattempted | pending_manual */
    status?: string;
    options?: string[];
    correctAnswer?: string;
    studentAnswer?: string;
    isCorrect: boolean;
    isAttempted: boolean;
    explanation?: string;
  }[];
  leaderboard: {
    studentId: string;
    studentName: string;
    avatar?: string;
    rank: number;
    score: number;
    totalMarks: number;
    percentage: number;
    timeTaken: number;
    isPassed: boolean;
    isCurrentUser?: boolean;
  }[];
  rank?: number;
  totalStudents?: number;
  facultyFeedback?: string;
  submittedAt: string;
  gradedAt?: string;
  passingPercentage: number;
  percentile: number;
  completedAt: string;
  flaggedCount: number;
}

export interface AssessmentQuestion {
  id: string;
  text: string;
  type: string;
  difficulty: string;
  subject: string;
  chapter?: string;
  topic?: string;
  marks: number;
  negativeMarks?: number;
  options?: { id: string; text: string; isCorrect?: boolean }[];
  correctAnswer?: string;
  explanation?: string;
  tags: string[];
  bloomLevel?: string;
  status: string;
  collegeId: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  linkedPaperIds: string[];
  isPYQ?: boolean;
}

export interface AssessmentPaper {
  id: string;
  title: string;
  subject: string;
  subjectId?: string;
  examType: string;
  totalMarks: number;
  totalQuestions: number;
  duration: number;
  sections: {
    id: string;
    name: string;
    title: string;
    description?: string;
    marksPerQuestion: number;
    numQuestions: number;
    compulsory: boolean;
    questionType: string;
    difficulty: string;
    questions?: PaperQuestion[];
  }[];
  instructions: string[];
  status: 'draft' | 'published' | 'archived';
  collegeId: string;
  createdBy: string;
  createdByName: string;
  linkedQuestionIds: string[];
  batch: string;
  branch: string;
  semester?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaperInput {
  title: string;
  subject: string;
  examType: string;
  totalMarks: number;
  duration: number;
  sections: {
    name: string;
    description?: string;
    marksPerQuestion: number;
    numQuestions: number;
    compulsory: boolean;
    questionType: string;
    difficulty: string;
    difficultyMix?: { easy: number; medium: number; hard: number };
  }[];
  instructions: string[];
  batch: string;
  branch: string;
  semester?: number;
  collegeId: string;
  createdBy: string;
  createdByName: string;
}

export interface ScheduledTest {
  id: string;
  assessmentId?: string;
  paperId: string;
  paperTitle: string;
  subject: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  branch: string;
  batch: string;
  semester: number;
  division?: string;
  section?: string;
  startDateTime: string;
  endDateTime: string;
  duration: number;
  totalMarks: number;
  totalQuestions: number;
  instructions: string[];
  status: 'scheduled' | 'published' | 'active' | 'completed' | 'cancelled';
  totalRegistered: number;
  totalStarted: number;
  totalSubmitted: number;
  totalGraded?: number;
  title?: string;
  description?: string;
  resultPublishDate?: string | null;
  allowLateSubmission?: boolean;
  enableProctoring?: boolean;
  maxTabSwitches?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  shuffleSections?: boolean;
  negativeMarking: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleTestInput {
  paperId: string;
  paperTitle: string;
  subject: string;
  collegeId: string;
  facultyId: string;
  facultyName: string;
  branch: string;
  batch: string;
  semester: number;
  division?: string;
  section?: string;
  startDateTime: string;
  endDateTime: string;
  duration: number;
  totalMarks: number;
  totalQuestions: number;
  instructions: string[];
  negativeMarking: boolean;
}

export interface ProctorEvent {
  id: string;
  studentAssessmentId: string;
  eventType: 'tab_switch' | 'window_blur' | 'copy_paste' | 'right_click' | 'fullscreen_exit' | 'multiple_faces' | 'no_face' | 'suspicious_activity' | 'auto_submit';
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface TestAnalytics {
  assessmentId: string;
  totalStudents: number;
  startedCount: number;
  submittedCount: number;
  absentCount: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  passCount: number;
  failCount: number;
  gradeDistribution: Record<string, number>;
  sectionWiseAverage: Record<string, number>;
  questionWiseStats: {
    questionId: string;
    correctPercentage: number;
    averageTime: number;
  }[];
}

/* ═════════════════════════════════════════════════════════════════════
   Phase 2 — test engine contract types
   Authoritative flow: scheduledTests (+ assessmentQuestions snapshot)
   → studentAssessments (not_started → in_progress → submitted → graded)
   ═════════════════════════════════════════════════════════════════════ */

/** Metadata + own-row state shown on the instructions page. */
export interface TestInstructionsData {
  testId: string;
  studentAssessmentId: string | null;
  title: string;
  subject: string;
  totalMarks: number;
  totalQuestions: number;
  duration: number;
  instructions: string[];
  negativeMarking: boolean;
  enableProctoring: boolean;
  questionTypes: string[];
  studentStatus: StudentTestStatus;
  startedAt?: string;
  endsAt?: string;
  submittedAt?: string;
  marksObtained?: number;
  grade?: string;
  needsManualGrading?: boolean;
  resultReleased?: boolean;
  /** Server-authoritative start time — the test may not start before this. */
  scheduledStart?: string;
  /** 0 = unlimited tab switches; beyond this the student engine auto-submits. */
  maxTabSwitches?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  shuffleSections?: boolean;
}

export interface SubmitOutcome {
  studentAssessmentId: string;
  testId: string;
  /** `graded` immediately when the paper is fully objective, else `submitted` */
  status: 'submitted' | 'graded';
  autoScore: number;
  autoMax: number;
  manualMax: number;
  needsManualGrading: boolean;
  marksObtained: number | null;
  percentage: number | null;
  grade: string | null;
  correctCount: number;
  incorrectCount: number;
  unattemptedCount: number;
  answeredCount: number;
  timeSpent: number;
}

/** A single persisted proctoring event (basic browser proctoring). */
export interface BasicProctorEvent {
  type: 'tab_switch' | 'window_blur' | 'fullscreen_exit' | 'copy_attempt' | 'paste_attempt' | 'context_menu' | 'keyboard_shortcut' | 'auto_submit' | 'autosave_error' | string;
  at: string;
  details?: Record<string, unknown>;
}