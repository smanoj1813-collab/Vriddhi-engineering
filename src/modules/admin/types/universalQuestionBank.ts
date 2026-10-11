// ============================================================
// VRIDDHI - Universal Question Bank Types
// ============================================================

// ============================================================
// CORE TYPES
// ============================================================

export type DifficultyLevel = 'easy' | 'medium' | 'hard';
export type QuestionType =
  | 'mcq'
  | 'true_false'
  | 'short_answer'
  | 'long_answer'
  | 'fill_in_blank'
  | 'match'
  | 'matching'
  | 'numerical'
  | 'case_based'
  | 'assertion_reason';
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'needs_revision';
export type Visibility = 'public' | 'college_only' | 'shared_with';
export type PaperStatus = 'draft' | 'published' | 'archived';

export interface CreatedBy {
  userId: string;
  userName: string;
  collegeId: string | null;
  collegeName: string;
  role: 'superadmin' | 'admin' | 'faculty';
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ============================================================
// QUESTION CONTENT (Stored in Cloud Storage)
// ============================================================

export interface QuestionImage {
  url: string;
  altText: string;
  storagePath: string;
}

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface QuestionContent {
  id: string;
  version: number;
  questionText: string;
  options: QuestionOption[];
  correctAnswer: string;
  explanation: string;
  hint: string;
  topicId: string;
  subjectId: string;
  subTopicId: string;
  difficulty: DifficultyLevel;
  questionType: QuestionType;
  marks: number;
  language: string;
  tags: string[];
  images: QuestionImage[];
  hasImage: boolean;
  createdBy: CreatedBy;
  source: string;
  status: ReviewStatus;
  visibility: Visibility;
  sharedWith: string[];
  quality: {
    rating: number;
    reviewCount: number;
    flagged: boolean;
  };
  usageStats: {
    usedInPapers: number;
    usedInAssessments: number;
    collegesUsing: string[];
  };
  versions: string[];
  storagePath: string;
  metadataDocId: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// QUESTION METADATA (Stored in Firestore)
// ============================================================

export interface QuestionMetadata {
  id: string;
  topicId: string;
  subjectId: string;
  subTopicId: string;
  difficulty: DifficultyLevel;
  questionType: QuestionType;
  marks: number;
  language: string;
  tags: string[];
  status: ReviewStatus;
  visibility: Visibility;
  sharedWith: string[];
  /** Origin of the question: 'platform' (Vriddhi-curated, free) or 'college'. */
  source: string;
  storagePath: string;
  hasImage: boolean;
  qualityRating: number;
  usageCount: number;
  createdBy: CreatedBy;
  createdAt: string;
  updatedAt: string;
  /** Denormalised preview for list views — avoids reading questionBank_content. */
  previewText?: string;
  /** Tokenised search index: lowercased words truncated to 20 chars (see questionBankApi search). */
  searchKeywords?: string[];
}

// ============================================================
// QUESTION REVIEW
// ============================================================

export interface QuestionReview {
  id: string;
  questionId: string;
  submittedBy: CreatedBy;
  submittedAt: string;
  status: ReviewStatus;
  reviewedAt?: string;
  reviewerId?: string;
  reviewerName?: string;
  reviewComment?: string;
  /** Department tag of the submitter — used for HOD-scoped review queues. */
  department?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// PAPER TYPES
// ============================================================

export interface PaperQuestionRef {
  questionId: string;
  order: number;
  marks: number;
  isRequired: boolean;
}

export interface DifficultyCount {
  easy: number;
  medium: number;
  hard: number;
}

export interface Paper {
  id: string;
  title: string;
  description: string;
  subjectId: string;
  topicIds: string[];
  questions: PaperQuestionRef[];
  totalQuestions: number;
  totalMarks: number;
  duration: number;
  difficultyDistribution: DifficultyCount;
  topicDistribution: Record<string, number>;
  createdBy: CreatedBy;
  visibility: Visibility;
  sharedWith: string[];
  isTemplate: boolean;
  parentTemplateId?: string;
  status: PaperStatus;
  storagePath: string;
  usageStats: {
    timesUsed: number;
    collegesUsing: string[];
  };
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PaperTemplate {
  id: string;
  name: string;
  description: string;
  subjectId: string;
  topicDistribution: Record<string, DifficultyCount>;
  totalMarks: number;
  duration: number;
  difficultyDistribution: DifficultyCount;
  usageCount: number;
  createdBy: CreatedBy;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// PAPER GENERATION
// ============================================================

export interface PaperGenerationConfig {
  templateId?: string;
  title: string;
  description: string;
  subjectId: string;
  topicIds: string[];
  totalQuestions: number;
  totalMarks: number;
  duration: number;
  difficultyDistribution: DifficultyCount;
  randomizeOrder: boolean;
  randomizeOptions: boolean;
  visibility: Visibility;
  sharedWith?: string[];
  excludeQuestionIds?: string[];
  includeQuestionIds?: string[];
}

export interface PaperGenerationResult {
  paper: Paper;
  warnings: string[];
  excludedTopics: string[];
  usedQuestionIds: string[];
}

// ============================================================
// FILTERS & PAGINATION
// ============================================================

export interface QuestionFilter {
  subjectId?: string;
  topicId?: string;
  subTopicId?: string;
  difficulty?: DifficultyLevel;
  questionType?: QuestionType;
  status?: ReviewStatus;
  tags?: string[];
  searchQuery?: string;
  /** Viewer context for visibility gating — the college whose view we render. */
  collegeId?: string | null;
  /** When true the viewer is a superadmin and sees all visibilities. */
  viewerIsSuperadmin?: boolean;
}

export interface PaperFilter {
  subjectId?: string;
  topicId?: string;
  createdBy?: string;
  collegeId?: string;
  visibility?: Visibility;
  status?: PaperStatus;
  searchQuery?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

// ============================================================
// STATS
// ============================================================

export interface TopicStats {
  topicId: string;
  totalQuestions: number;
  byDifficulty: DifficultyCount;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  averageQuality: number;
  totalUsage: number;
}

export interface QuestionBankStats {
  totalQuestions: number;
  totalPapers: number;
  totalTemplates: number;
  bySubject: Record<string, number>;
  byDifficulty: DifficultyCount;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  pendingReviews: number;
  totalColleges: number;
  totalContributors: number;
}

// ============================================================
// BULK OPERATIONS
// ============================================================

export interface BulkUploadResult {
  success: boolean;
  totalProcessed: number;
  successCount: number;
  errorCount: number;
  errors: Array<{
    row: number;
    error: string;
    data: unknown;
  }>;
  createdQuestionIds: string[];
}

// ============================================================
// CACHE
// ============================================================

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

// ============================================================
// STORAGE PATHS
// ============================================================

export const STORAGE_PATHS = {
  questions: (subjectId: string, topicId: string, questionId: string) =>
    `questions/${subjectId}/${topicId}/${questionId}.json`,
  // Canonical question-figure path — keep identical to questionImagePath() in
  // src/shared/utils/questionImage.ts. storage.rules grants exactly this shape
  // (images/questions/{collegeId}/{subjectId}/{topicId}/{questionId}/{file})
  // and the college segment is the tenant boundary.
  questionImage: (collegeId: string, subjectId: string, topicId: string, questionId: string, filename: string) =>
    `images/questions/${collegeId}/${subjectId}/${topicId}/${questionId}/${filename}`,
  paper: (collegeId: string | null, paperId: string) =>
    `papers/${collegeId || 'public'}/${paperId}.json`,
  template: (templateId: string) =>
    `templates/${templateId}.json`,
  topicManifest: (subjectId: string, topicId: string) =>
    `manifests/topics/${subjectId}/${topicId}.json`,
  masterManifest: () =>
    `manifests/master.json`,
  bulkExport: (filename: string) =>
    `exports/${filename}`,
};

// ============================================================
// DEFAULTS
// ============================================================

export const DEFAULTS = {
  PAGE_SIZE: 20,
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes
  MAX_CACHE_SIZE: 500,
};