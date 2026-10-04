// ============================================================================
// Enums / String Unions
// ============================================================================

export type QuestionDifficulty = 'easy' | 'medium' | 'hard'
export type QuestionStatus = 'draft' | 'pending' | 'approved' | 'rejected'

export type QuestionType =
  | 'MCQ'
  | 'MSQ'
  | 'NAT'
  | 'ShortAnswer'
  | 'LongAnswer'
  | 'FillInTheBlanks'
  | 'TrueFalse'
  | 'Matching'
  | 'AssertionReason'
  | 'mcq_single'
  | 'mcq_multiple'
  | 'true_false'
  | 'fill_in_blank'
  | 'short_answer'
  | 'long_answer'
  | 'match_following'
  | 'assertion_reason'

export type PaperStatus = 'draft' | 'published' | 'archived' | 'cancelled'
export type TestStatus = 'scheduled' | 'ongoing' | 'completed' | 'cancelled' | 'upcoming' | 'published' | 'graded'
export type PaperType =
  | 'exam' | 'quiz' | 'assignment' | 'practice'
  | 'mid_term' | 'end_term' | 'mock' | 'midterm' | 'final'
export type TestVisibility = 'public' | 'private' | 'selected' | 'all_students' | 'specific_sections' | 'specific_students'

// ============================================================================
// Unified Assessment Question (Question Bank)
// ============================================================================

export interface AssessmentQuestion {
  id: string

  // Question-bank fields
  subject?: string
  topic?: string
  type?: 'mcq' | 'short_answer' | 'long_answer' | 'true_false' | 'fill_in_blank' | QuestionType
  difficulty?: QuestionDifficulty | 'easy' | 'medium' | 'hard'
  content?: string
  status?: QuestionStatus
  createdBy?: string
  createdAt?: string | Date
  updatedAt?: string | Date
  tags?: string[]
  bloomLevel?: string

  // Paper / test fields
  questionId?: string
  questionText?: string
  questionType?: QuestionType
  negativeMarks?: number
  order?: number
  topicId?: string
  sectionId?: string

  // Common
  marks: number
  options?: Array<{ id: string; text: string; isCorrect?: boolean }>
  answer?: string
  explanation?: string
  imageUrl?: string
}

// ============================================================================
// Paper Question (used by test-taking UI — has questionId not id)
// ============================================================================

export interface PaperQuestion {
  questionId: string
  order: number
  content: string
  questionText?: string       // alias for content
  type: string
  questionType?: string       // alias for type
  marks: number
  options?: Array<{ id: string; text: string; matchWith?: string }>
  imageUrl?: string
}

// ============================================================================
// Unified Paper Section
// ============================================================================

export interface PaperSection {
  id: string
  name?: string
  title?: string
  instructions?: string
  description?: string
  order?: number
  totalMarks?: number
  questionType?: string
  numQuestions?: number
  marksPerQuestion?: number
  questions?: AssessmentQuestion[]
}

// ============================================================================
// Assessment Paper (legacy bank-style)
// ============================================================================

export interface AssessmentPaper {
  id: string
  title: string
  subject: string
  program?: string
  programId?: string
  courseType?: string
  branch?: string
  batch?: string
  type: 'quiz' | 'midterm' | 'final' | 'assignment' | 'practice' | 'mock'
  paperType?: string
  duration: number
  durationMinutes?: number
  totalMarks: number
  totalQuestions?: number
  sections: PaperSection[]
  instructions?: string
  description?: string
  status: 'draft' | 'published' | 'archived'
  createdBy: string
  createdAt: string
  updatedAt?: string
}

// ============================================================================
// Assessment (hook-facing paper type)
// ============================================================================

export interface Assessment {
  id: string
  title: string
  description?: string
  type: PaperType
  status: PaperStatus
  visibility?: TestVisibility
  collegeId?: string
  courseId?: string
  subjectId?: string
  duration: number
  totalMarks: number
  startTime?: Date | string
  endTime?: Date | string
  scheduledDate?: Date | string
  startDate?: Date | string
  createdBy: string
  createdAt: Date
  updatedAt: Date
  questions?: AssessmentQuestion[]
  sections?: PaperSection[]
}

// ============================================================================
// Student Test
// ============================================================================

export interface StudentTest {
  id: string
  studentId: string
  paperId: string
  title: string
  subject: string
  scheduledAt: string
  duration: number
  totalMarks: number
  status: 'upcoming' | 'ongoing' | 'completed' | 'missed'
  score?: number
  percentage?: number
  grade?: string
}

// ============================================================================
// Student Test Card (flat — used by assessment portal UI)
// ============================================================================

export interface StudentTestCard {
  id: string
  title: string
  subject?: string
  subjectName?: string
  status: TestStatus | string
  startDateTime?: Date | string
  endDateTime?: Date | string
  durationMinutes?: number
  duration?: number
  totalMarks?: number
  paperType?: string
  score?: number
  percentage?: number
  timeRemaining?: number
  canStart?: boolean
  // Nested refs for backward compatibility
  test?: StudentTest
  paper?: AssessmentPaper
}

// ============================================================================
// Submission & Answer Types
// ============================================================================

export interface StudentAnswer {
  questionId: string
  questionText?: string
  selectedOption?: string
  selectedOptions?: string[]
  selectedOptionIds?: string[]
  answerText?: string
  textAnswer?: string
  matchedPairs?: Array<{ left: string; right: string }>
  marksObtained?: number
  maxMarks?: number
  isCorrect?: boolean
  timeSpent?: number
}

export interface StudentSubmission {
  id: string
  testId: string
  studentId: string
  answers: Array<{
    questionId: string
    answer: string | string[]
    marksObtained?: number
    timeSpent?: number
  }>
  submittedAt: string
  totalScore?: number
  percentage?: number
  status: 'submitted' | 'graded' | 'pending'
}

// ============================================================================
// Active Test State
// ============================================================================

export interface ActiveTest {
  testId: string
  studentId: string
  paperId: string
  paperTitle?: string
  allowNavigation?: boolean
  questions: PaperQuestion[]
  flaggedQuestions: string[]
  currentQuestionIndex: number
  answers: Record<string, Partial<StudentAnswer>>
  startTime: string
  endTime?: string
  timeRemaining: number
  status: 'in_progress' | 'submitted' | 'timed_out'
}

export interface ActiveTestState {
  test: ActiveTest | null
  loading: boolean
  error: string | null
  currentQuestion: number
  flaggedQuestions: string[]
  answers: Record<string, string | string[]>
  timeRemaining: number
}

// ============================================================================
// Analytics & Results
// ============================================================================

export interface TestAnalytics {
  testId: string
  totalStudents: number
  submittedCount: number
  averageScore: number
  highestScore: number
  lowestScore: number
  passRate: number
  questionStats: Array<{
    questionId: string
    correctCount: number
    incorrectCount: number
    averageTime: number
    difficultyIndex: number
  }>
}

export interface TestResultSummary {
  testId: string
  testTitle?: string
  title?: string
  subject?: string
  totalStudents: number
  attempted: number
  passed: number
  failed: number
  averageScore: number
  highestScore: number
  lowestScore: number
  totalMarks?: number
  marksObtained?: number
  percentage?: number
  grade?: string
  gradePoint?: number
  timeSpent?: number
  facultyFeedback?: string
  rank?: number
  classAverage?: number
  averageTimePerQuestion?: number
  questionScores: Array<{
    questionId: string
    questionText?: string
    isCorrect: boolean
    yourAnswer?: string
    correctAnswer?: string
    marksObtained?: number
    maxMarks?: number
    yourScore?: number
    maxScore?: number
    feedback?: string
    timeSpent?: number
  }>
  sectionScores?: Array<{
    sectionId: string
    sectionName: string
    sectionTitle?: string
    score: number
    maxScore: number
  }>
  totalParticipants?: number
  classHighest?: number
  completedAt?: Date
}

export interface TestResultView {
  resultId: string
  studentId: string
  studentName: string
  rollNumber?: string
  score: number
  maxScore: number
  percentage: number
  grade?: string
  status: 'pass' | 'fail' | 'absent'
  submittedAt?: Date
  answers: StudentAnswer[]
  timeTaken?: number
}

// ============================================================================
// Review Queue & Notifications
// ============================================================================

export interface ReviewQueueItem {
  id: string
  type: 'question' | 'paper' | 'submission'
  title: string
  submittedBy: string
  submittedAt: string
  status: 'pending' | 'approved' | 'rejected'
  priority: 'low' | 'medium' | 'high'
  data: unknown
}

export interface TestNotification {
  id: string
  testId: string
  studentId: string
  type: 'reminder' | 'started' | 'ending_soon' | 'submitted' | 'graded'
  message: string
  read: boolean
  createdAt: string
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateQuestionInput {
  subject: string
  topic: string
  type: AssessmentQuestion['type']
  difficulty: QuestionDifficulty
  marks: number
  content: string
  options?: Array<{ id: string; text: string; isCorrect?: boolean }>
  answer?: string
  explanation?: string
  tags?: string[]
  bloomLevel?: string
}

export interface CreatePaperInput {
  title: string;
  description?: string;
  subject?: string
  type?: AssessmentPaper['type'] | string
  paperType?: string
  subjectId?: string
  courseId?: string
  semester?: number
  duration?: number
  durationMinutes?: number
  totalMarks?: number
  sections?: any[]
  instructions?: string
  shuffleQuestions?: boolean
  shuffleOptions?: boolean
  showResultImmediately?: boolean
  allowNavigation?: boolean
  allowMultipleAttempts?: boolean
  maxAttempts?: number
  passingMarks?: number
  hasNegativeMarking?: boolean
}

export interface ScheduleTestInput {
  paperId: string
  title: string
  subject?: string
  program?: string
  programId?: string
  courseType?: string
  branch?: string
  batch?: string
  description?: string
  scheduledAt?: string
  startDateTime?: Date | string
  endDateTime?: Date | string
  duration?: number
  durationMinutes?: number
  visibility?: TestVisibility | string
  targetSections?: Array<{
    sectionId: string
    sectionName: string
    section?: string
    program?: string
    branch?: string
    batch?: string
    semester?: number
  }>
  targetStudents?: string[]
  accessCode?: string
  allowLateSubmission?: boolean
  lateSubmissionPenalty?: number
  enableProctoring?: boolean
  requireFaceVerification?: boolean
  resultPublishDate?: Date | string
  instructions?: string
}

export interface SubmitTestInput {
  testId: string
  studentId: string
  answers: Array<{
    questionId: string
    answer: string | string[]
    timeSpent?: number
  }>
}

// ============================================================================
// Filter Types
// ============================================================================

export interface QuestionFilter {
  subject?: string
  topic?: string
  type?: AssessmentQuestion['type']
  difficulty?: QuestionDifficulty
  status?: QuestionStatus
  search?: string
  createdBy?: string
}

export interface TestFilter {
  subject?: string
  type?: AssessmentPaper['type']
  status?: string
  batch?: string
  search?: string
  dateFrom?: string
  dateTo?: string
}

export interface AssessmentFilterOptions {
  collegeId?: string
  status?: string
  type?: string
  search?: string
  dateFrom?: string
  dateTo?: string
}

// ============================================================================
// Scheduled Test
// ============================================================================

export interface ScheduledTest {
  id: string
  paperId: string
  title: string
  subject: string
  batch: string
  scheduledAt: string
  startDateTime?: Date | string
  endDateTime?: Date | string
  duration: number
  durationMinutes?: number
  status: 'upcoming' | 'ongoing' | 'completed' | 'scheduled' | 'published' | 'cancelled'
  description?: string
  visibility?: TestVisibility | string
  accessCode?: string
  allowLateSubmission?: boolean
  lateSubmissionPenalty?: number
  enableProctoring?: boolean
  requireFaceVerification?: boolean
  resultPublishDate?: Date | string
  targetSections?: Array<{ sectionId: string; sectionName: string }>
  targetStudents?: string[]
  createdBy: string
  facultyId?: string
  facultyName?: string
  branch?: string
  // Server-maintained progress counters (incremented on register/start/submit/
  // grade) — the faculty "My tests" list reads these, zero extra queries.
  totalRegistered?: number
  totalStarted?: number
  totalSubmitted?: number
  totalGraded?: number
  totalQuestions?: number
  totalMarks?: number
  // Scheduling-time options (new fields; undefined on older tests).
  maxTabSwitches?: number
  shuffleQuestions?: boolean
  shuffleOptions?: boolean
  shuffleSections?: boolean
}

export interface PerformanceCategory {
  label: string
  minPercent: number
}

export interface AssessmentTestReportTest {
  id: string
  title: string
  subject: string
  facultyName?: string
  branch?: string
  batch?: string
  status: string
  sections?: Array<{ id: string; name: string; questionCount: number; totalMarks: number }>
  startDateTime: string
  endDateTime: string
  resultPublishDate: string | null
  totalQuestions: number
  totalMarks: number
  enableProctoring: boolean
  maxTabSwitches: number
  shuffleQuestions: boolean
  shuffleOptions: boolean
  shuffleSections: boolean
  totalRegistered: number
  totalStarted: number
  totalSubmitted: number
  totalGraded: number
}

export interface AssessmentTestReportStudent {
  studentId: string
  studentName: string
  regNo: string
  status: 'not_started' | 'in_progress' | 'submitted' | 'graded' | string
  branch?: string
  section?: string
  semester?: number
  batch?: string
  sectionScores?: Array<{ sectionId: string; sectionName: string; score: number; max: number }> | null
  totalMarks: number
  autoScore: number | null
  marksObtained: number | null
  percentage: number | null
  grade: string | null
  timeSpent: number | null
  submittedAt: string | null
  isLateSubmission: boolean
  latePenaltyPercentage: number
  autoSubmitted: boolean
  needsManualGrading: boolean
}

export interface AssessmentTestReportSummary {
  totalScheduled: number
  submitted: number
  graded: number
  pendingManual: number
  inProgress: number
  notStarted: number
  lateSubmissions: number
  autoSubmittedCount: number
  avgPercentage: number | null
  maxPercentage: number | null
  minPercentage: number | null
  avgMarksObtained: number | null
}

export interface AssessmentTestReport {
  test: AssessmentTestReportTest
  summary: AssessmentTestReportSummary
  students: AssessmentTestReportStudent[]
}

// ============================================================================
// Student Assessment (for faculty hooks)
// ============================================================================

export interface StudentAssessment {
  id: string
  studentId?: string
  assessmentId?: string
  status: 'submitted' | 'graded' | 'pending' | string
  percentage?: number
  score?: number
  submittedAt?: string | Date
}