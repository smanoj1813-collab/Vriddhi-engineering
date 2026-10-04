// ═══════════════════════════════════════════════════════════════════════
// QUESTION BANK TYPES — COMPLETE (covers all project usages)
// ═══════════════════════════════════════════════════════════════════════

export type QuestionType =
  | 'mcq'
  | 'true_false'
  | 'fill_in_blank'
  | 'short_answer'
  | 'long_answer'
  | 'matching'
  | 'assertion_reason'
  | 'case_based'
  | 'short'
  | 'long'
  | 'numerical';

export type DifficultyLevel = 'easy' | 'medium' | 'hard';

export type QuestionStatus = 'active' | 'inactive' | 'draft';

export type PaperStatus = 'draft' | 'published' | 'archived';

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  difficulty: DifficultyLevel;
  subject: string;
  chapter?: string;
  topic?: string;
  unit?: string;
  /** Third tier of the hierarchy (subject → topic → sub-topic). */
  subTopic?: string;
  marks: number;
  negativeMarks?: number;
  options?: QuestionOption[];
  correctAnswer?: string | string[];
  explanation?: string;
  tags?: string[];
  searchKeywords?: string[];
  batch?: string;
  branch?: string;
  status: QuestionStatus;
  isPYQ?: boolean;
  examYear?: string;
  examName?: string;
  /** Platform-pool row (questionBank_meta) surfaced read-only in the college bank. */
  isPlatform?: boolean;
  linkedPapers?: string[];
  linkedPaperIds?: string[];
  usageCount?: number;
  bloomLevel?: string;
  /** BCP-47-style app language code: en | hi | kn | ta | te | ml */
  language?: string;
  createdBy: string;
  createdByName?: string;
  collegeId: string;
  createdAt: string;
  updatedAt?: string;
  // ═══ NEW: Curriculum Linkage ═══
  curriculumId?: string;
  courseId?: string;
  courseName?: string;
  courseCode?: string;
  moduleId?: string;
  moduleName?: string;
  moduleNo?: number;
  learningOutcomes?: string[];
}

// ═══════════════════════════════════════════════════════════════════════
// AI GENERATED QUESTION TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface GeneratedQuestion {
  id?: string;
  /** Firestore document id returned by the backend for an already-persisted AI question. */
  firestoreId?: string;
  text: string;
  type: QuestionType;
  difficulty: DifficultyLevel;
  subject: string;
  chapter?: string;
  topic?: string;
  unit?: string;
  marks: number;
  negativeMarks?: number;
  options?: QuestionOption[];
  correctAnswer?: string | string[];
  explanation?: string;
  tags?: string[];
  searchKeywords?: string[];
  batch?: string;
  branch?: string;
  status?: QuestionStatus;
  isPYQ?: boolean;
  examYear?: string;
  examName?: string;
  bloomLevel?: string;
  language?: string;
  generatedAt?: string;
  createdBy?: string;
  collegeId?: string;
  // ═══ NEW: Curriculum Linkage ═══
  curriculumId?: string;
  courseId?: string;
  courseName?: string;
  courseCode?: string;
  moduleId?: string;
  moduleName?: string;
  moduleNo?: number;
  learningOutcomes?: string[];
}

// ═══════════════════════════════════════════════════════════════════════
// PAPER BUILDER TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface DifficultyMix {
  easy: number;
  medium: number;
  hard: number;
}

export interface PaperSection {
  id: string;
  title: string;
  name: string; // non-optional for backward compat (PaperGenerator uses .trim())
  instructions?: string;
  description?: string;
  questionType: QuestionType | 'any';
  numQuestions: number;
  marksPerQuestion: number;
  difficulty?: DifficultyLevel | 'mixed';
  difficultyMix?: DifficultyMix;
  topicFilter?: string;
  unitFilter?: string;
  compulsory?: boolean;
  /** Choice pattern from a university scheme pack (e.g. answer one of two). */
  toAttempt?: number;
  moduleNo?: number;
  questions?: Question[];
  section?: PaperSection; // nested reference for PaperGenerator
}

export interface PaperConfig {
  title: string;
  subject: string;
  totalMarks: number;
  duration: number;
  instructions?: string | string[];
  negativeMarking?: boolean;
  negativeMarkingValue?: number;
  passingPercentage?: number;
  examType?: string;
  batch?: string;
  branch?: string;
  program?: string;
  courseType?: string;
  schemePackId?: string;
  schemePackCode?: string;
  schemePackResolution?: 'cohort' | 'programme' | 'college' | 'platform';
  schemeTemplateCode?: string;
  date?: string;
}

export interface GeneratedSection extends PaperSection {
  questions: Question[];
  matched: number;
  requested: number;
}

export interface GeneratedPaper {
  id: string;
  title: string;
  subject: string;
  totalMarks: number;
  duration: number;
  instructions?: string | string[];
  negativeMarking?: boolean;
  negativeMarkingValue?: number;
  sections: GeneratedSection[];
  totalQuestions: number;
  warnings?: string[];
  createdAt: string;
  createdBy: string;
  collegeId: string;
}

export interface GeneratedPaperResult {
  id?: string;
  title?: string;
  subject?: string;
  totalMarks?: number;
  duration?: number;
  totalQuestions?: number;
  success: boolean;
  paper?: GeneratedPaper;
  warnings?: string[];
  sections?: GeneratedSection[];
  generatedAt?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// FILTERS & STATS
// ═══════════════════════════════════════════════════════════════════════

export interface QuestionFilters {
  subject?: string;
  difficulty?: DifficultyLevel;
  type?: QuestionType;
  status?: QuestionStatus;
  search?: string;
  searchQuery?: string;
  chapter?: string;
  topic?: string;
  unit?: string;
  batch?: string;
  branch?: string;
  isPYQ?: boolean;
  examYear?: string;
  examName?: string;
  createdBy?: string;
  linkedToPaper?: boolean;
  tag?: string;
  tags?: string[];
}

export interface QuestionBankStats {
  totalQuestions: number;
  total?: number;
  pyqCount?: number;
  linkedCount?: number;
  unusedCount?: number;
  bySubject?: Record<string, number>;
  byDifficulty?: Record<DifficultyLevel, number>;
  byType?: Record<QuestionType, number>;
  byStatus?: Record<string, number>;
  byBatch?: Record<string, number>;
  byBranch?: Record<string, number>;
  recentlyAdded?: Question[];
  mostUsed?: Question[];
}

// ═══════════════════════════════════════════════════════════════════════
// PAPER / EXAM TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface Paper {
  id: string;
  title: string;
  subject: string;
  totalMarks: number;
  duration: number;
  instructions?: string | string[];
  sections: PaperSection[];
  status: PaperStatus;
  createdBy: string;
  collegeId: string;
  createdAt: string;
  updatedAt?: string;
  usageCount?: number;
  linkedQuestionIds: string[]; // non-optional for spread [...]
  questionIds?: string[];
  totalQuestions?: number;
  examType?: string;
  negativeMarking?: boolean;
  passingPercentage?: number;
}

export interface ExamPaper {
  id: string;
  title: string;
  subject: string;
  totalMarks: number;
  duration: number;
  instructions?: string;
  sections: PaperSection[];
  status: PaperStatus;
  createdBy: string;
  collegeId: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PaperTemplate {
  id: string;
  name: string;
  description?: string;
  subject: string;
  sections: PaperSection[];
  createdBy: string;
  collegeId: string;
}

export interface GenerationConfig {
  title: string;
  subject: string;
  totalMarks: number;
  duration: number;
  sections: PaperSection[];
  negativeMarking?: boolean;
  negativeMarkingValue?: number;
  instructions?: string | string[];
}

// ═══════════════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  lastDoc?: any;
  totalPages?: number;
}

export interface BulkImportResult {
  success: number;
  failed: number;
  errors: string[];
  imported?: Question[];
  total?: number;
  importedIds: string[]; // non-optional for .push()
  createdIds: string[]; // non-optional for .push()
}

// ═══════════════════════════════════════════════════════════════════════
// LEGACY / ALIAS TYPES
// ═══════════════════════════════════════════════════════════════════════

export type QuestionBankEntry = Question;