import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  startAfter,
  Timestamp,
  writeBatch,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { branchConstraint } from '@/shared/utils/branchQuery';
import { sameBranch } from '@/shared/utils/branchKey';
import { db } from '@/Firebase/config';
import {
  DEFAULT_BATCHES,
  DEFAULT_PROGRAMS,
  DEFAULT_ACADEMIC_YEARS,
  withoutTechBranches,
} from '@/shared/constants/academicPrograms';
import { Question, QuestionFilters, PaginatedResult, BulkImportResult } from '../../admin/types/questionBank';
import { Paper } from '../../admin/types/questionBank';
import {
  isPlatformPyqMeta,
  mapPlatformMetaToQuestion,
  platformPyqExamName,
  platformPyqExamYear,
  type PlatformPyqMeta,
} from '../utils/platformPyq';

// ============================================================
// UNIVERSAL QUESTION BANK TYPES
// ============================================================
import {
  type QuestionMetadata,
  type QuestionContent,
  type QuestionFilter as UniversalQuestionFilter,
  type PaginationParams,
  type PaginatedResult as UniversalPaginatedResult,
  type Paper as UniversalPaper,
  type PaperFilter,
  type PaperTemplate,
  type PaperGenerationConfig,
  type PaperGenerationResult,
  type QuestionReview,
  type ReviewStatus,
  type QuestionBankStats as UniversalStats,
  type TopicStats,
  type ApiResponse,
  type DifficultyCount,
} from '../../admin/types/universalQuestionBank';


const QUESTIONS_COLLECTION = 'questions';
const PAPERS_COLLECTION = 'papers';

/**
 * Platform-pool PYQ rows (questionBank_meta, written by the paper import
 * pipeline / seeder) surfaced read-only inside the college PYQ tab.
 * Uses a single-field `tags array-contains` query (no composite index);
 * status and exam facets are filtered in memory so pending drafts stay out.
 */
async function loadPlatformPyqMetas(): Promise<PlatformPyqMeta[]> {
  const snapshot = await getDocs(
    query(collection(db, 'questionBank_meta'), where('tags', 'array-contains', 'pyq'), limit(200))
  );
  const metas = snapshot.docs.map((snap) => {
    const data = snap.data() as Record<string, unknown>;
    return { id: snap.id, ...(data as object) } as PlatformPyqMeta;
  });
  return metas.filter((meta) => isPlatformPyqMeta(meta));
}

async function fetchPlatformPyqQuestions(filters: QuestionFilters): Promise<Question[]> {
  const approved = await loadPlatformPyqMetas();
  const filtered = approved.filter((meta) => {
    if (filters.examYear && platformPyqExamYear(meta) !== String(filters.examYear)) return false;
    if (filters.examName && platformPyqExamName(meta) !== filters.examName) return false;
    if (filters.subject && (meta.subjectName || meta.subjectId) !== filters.subject) return false;
    return true;
  });
  const rows = filtered.slice(0, 50);
  const texts = await Promise.all(
    rows.map(async (meta) => {
      try {
        const snap = await getDoc(doc(db, 'questionBank_content', meta.id));
        if (!snap.exists()) return '';
        const data = snap.data() as Record<string, unknown>;
        return String(data.questionText ?? data.text ?? '');
      } catch {
        return '';
      }
    })
  );
  return rows.map((meta, i) => mapPlatformMetaToQuestion(meta, texts[i] || undefined));
}

// Helper to strip undefined values — Firestore rejects undefined
function cleanUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) cleaned[k] = v;
  }
  return cleaned as Partial<T>;
}


// ==================== BATCH / BRANCH SUPPORT ====================

export interface BatchBranchConfig {
  batches: string[];
  branches: string[];
  academicYears: string[];
}

export const getBatchBranchConfig = async (collegeId: string): Promise<BatchBranchConfig> => {
  const configDoc = await getDoc(doc(db, 'colleges', collegeId, 'config', 'batchBranch'));
  if (configDoc.exists()) {
    const cfg = configDoc.data() as BatchBranchConfig;
    // Legacy colleges may still have engineering branch codes stored — strip them.
    const branches = withoutTechBranches(cfg.branches);
    return {
      batches: cfg.batches?.length ? cfg.batches : DEFAULT_BATCHES,
      branches: branches.length ? branches : DEFAULT_PROGRAMS,
      academicYears: cfg.academicYears?.length ? cfg.academicYears : DEFAULT_ACADEMIC_YEARS,
    };
  }
  return {
    batches: [...DEFAULT_BATCHES],
    branches: [...DEFAULT_PROGRAMS],
    academicYears: [...DEFAULT_ACADEMIC_YEARS],
  };
};

// ==================== ENHANCED QUESTION FETCHING ====================

export const getQuestions = async (
  collegeId: string,
  filters: QuestionFilters = {},
  pageSize: number = 20,
  lastDoc?: any
): Promise<PaginatedResult<Question>> => {
  const constraints: any[] = [
    where('collegeId', '==', collegeId),
  ];

  if (filters.subject?.trim()) {
    constraints.push(where('subject', '==', filters.subject.trim()));
  }
  if (filters.difficulty) {
    constraints.push(where('difficulty', '==', filters.difficulty));
  }
  if (filters.type) {
    constraints.push(where('type', '==', filters.type));
  }
  if (filters.unit?.trim()) {
    constraints.push(where('unit', '==', filters.unit.trim()));
  }
  if (filters.batch?.trim()) {
    constraints.push(where('batch', '==', filters.batch.trim()));
  }
  if (filters.branch?.trim()) {
    constraints.push(branchConstraint(filters.branch.trim()));
  }
  if (filters.status?.trim()) {
    constraints.push(where('status', '==', filters.status.trim()));
  }
  if (filters.isPYQ !== undefined) {
    constraints.push(where('isPYQ', '==', filters.isPYQ));
  }
  if (filters.examYear?.trim()) {
    constraints.push(where('examYear', '==', filters.examYear.trim()));
  }
  if (filters.examName?.trim()) {
    constraints.push(where('examName', '==', filters.examName.trim()));
  }
  if (filters.createdBy?.trim()) {
    constraints.push(where('createdBy', '==', filters.createdBy.trim()));
  }
  if (filters.tag?.trim() || filters.tags?.length) {
    const tagValue = filters.tag?.trim() || filters.tags![0];
    constraints.push(where('tags', 'array-contains', tagValue));
  }

  const searchTerm = (filters.searchQuery || filters.search || '').trim().toLowerCase();
  if (searchTerm) {
    constraints.push(where('searchKeywords', 'array-contains', searchTerm));
  }

  constraints.push(orderBy('createdAt', 'desc'));

  if (lastDoc) {
    constraints.push(startAfter(lastDoc));
  }
  constraints.push(limit(pageSize));

  let snapshot;
  try {
    const q = query(collection(db, QUESTIONS_COLLECTION), ...constraints);
    snapshot = await getDocs(q);
  } catch (err: any) {
    if (err?.message?.includes('requires an index') || err?.code === 'failed-precondition') {
      console.warn('[getQuestions] Index missing/building, falling back to simple collegeId query:', err.message);
      const fallbackQ = query(collection(db, QUESTIONS_COLLECTION), where('collegeId', '==', collegeId), limit(100));
      snapshot = await getDocs(fallbackQ);
      let filteredDocs = snapshot.docs.filter(docSnap => {
        const data = docSnap.data() as any;
        if (filters.subject?.trim() && data.subject !== filters.subject.trim()) return false;
        if (filters.difficulty && data.difficulty !== filters.difficulty) return false;
        if (filters.type && data.type !== filters.type) return false;
        if (filters.batch?.trim() && data.batch !== filters.batch.trim()) return false;
        if (filters.branch?.trim() && !sameBranch(data.branch, filters.branch)) return false;
        if (filters.status?.trim() && data.status !== filters.status.trim()) return false;
        if (filters.createdBy?.trim() && data.createdBy !== filters.createdBy.trim()) return false;
        if (filters.isPYQ !== undefined && data.isPYQ !== filters.isPYQ) return false;
        const searchTerm = (filters.searchQuery || filters.search || '').trim().toLowerCase();
        if (searchTerm) {
          const keywords = (data.searchKeywords || []).map((k: string) => k.toLowerCase());
          const text = (data.text || '').toLowerCase();
          if (!keywords.includes(searchTerm) && !text.includes(searchTerm)) return false;
        }
        return true;
      });
      filteredDocs = filteredDocs.sort((a, b) => {
        const aData = a.data() as any;
        const bData = b.data() as any;
        const aTime = aData.createdAt?.toDate?.()?.getTime() || new Date(aData.createdAt).getTime() || 0;
        const bTime = bData.createdAt?.toDate?.()?.getTime() || new Date(bData.createdAt).getTime() || 0;
        return bTime - aTime;
      });
      const paged = filteredDocs.slice(0, pageSize);
      const questions: Question[] = paged.map(docSnap => {
        const data = docSnap.data();
        return {
          ...data,
          id: docSnap.id,
          createdBy: (data as any).createdBy || (data as any).generatedBy || (data as any).facultyId || 'unknown',
          createdByName: (data as any).createdByName || (data as any).generatedByName || (data as any).facultyName || 'Unknown',
          status: (data as any).status || 'active',
          text: (data as any).text || (data as any).questionText || (data as any).content || '',
          type: (data as any).type || (data as any).questionType || 'mcq',
          marks: (data as any).marks ?? (data as any).marksPerQuestion ?? 1,
          tags: (data as any).tags || (data as any).tagList || [],
          subject: (data as any).subject || (data as any).course || '',
          difficulty: (data as any).difficulty || 'medium',
        } as Question;
      });
      return {
        data: questions,
        total: filteredDocs.length,
        page: 1,
        limit: pageSize,
        totalPages: Math.ceil(filteredDocs.length / pageSize) || 1,
        lastDoc: paged[paged.length - 1] || null,
        hasMore: filteredDocs.length > pageSize
      };
    }
    throw err;
  }

  const questions: Question[] = [];
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const normalized = {
      ...data,
      id: docSnap.id,
      createdBy: data.createdBy || data.generatedBy || data.facultyId || 'unknown',
      createdByName: data.createdByName || data.generatedByName || data.facultyName || 'Unknown',
      status: data.status || 'active',
      text: data.text || data.questionText || data.content || '',
      type: data.type || data.questionType || 'mcq',
      marks: data.marks ?? data.marksPerQuestion ?? 1,
      tags: data.tags || data.tagList || [],
      subject: data.subject || data.course || '',
      difficulty: data.difficulty || 'medium',
    };
    questions.push(normalized as Question);
  });

  // PYQ tab bridge: platform-pool questions (imported papers / seeded bank) are
  // NOT in the college `questions` collection — merge them in read-only so the
  // "PYQ Questions" tab shows every previous-year question. First page only.
  let data = questions;
  if (filters.isPYQ === true && !lastDoc) {
    try {
      const platformRows = await fetchPlatformPyqQuestions(filters);
      const seen = new Set(questions.map((question) => question.id));
      data = [...platformRows.filter((row) => !seen.has(row.id)), ...questions];
    } catch (bridgeErr) {
      console.warn('[getQuestions] Platform PYQ bridge failed (college rows still returned):', bridgeErr);
    }
  }

  return {
    data,
    total: questions.length,
    page: 1,
    limit: pageSize,
    totalPages: Math.ceil(questions.length / pageSize) || 1,
    lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
    hasMore: snapshot.docs.length === pageSize
  };
};

export const getAllQuestions = async (
  collegeId: string,
  pageSize: number = 100
): Promise<Question[]> => {
  try {
    const q = query(
      collection(db, QUESTIONS_COLLECTION),
      where('collegeId', '==', collegeId),
      orderBy('createdAt', 'desc'),
      limit(pageSize)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        ...data,
        id: docSnap.id,
        createdBy: data.createdBy || data.generatedBy || 'unknown',
        createdByName: data.createdByName || data.generatedByName || 'Unknown',
        status: data.status || 'active',
        text: data.text || data.questionText || data.content || '',
        type: data.type || data.questionType || 'mcq',
        marks: data.marks ?? data.marksPerQuestion ?? 1,
        tags: data.tags || data.tagList || [],
        subject: data.subject || data.course || '',
        difficulty: data.difficulty || 'medium',
      } as Question;
    });
  } catch (err: any) {
    if (err?.message?.includes('requires an index') || err?.code === 'failed-precondition') {
      console.warn('[getAllQuestions] Index missing, fallback');
      const fallbackQ = query(collection(db, QUESTIONS_COLLECTION), where('collegeId', '==', collegeId), limit(pageSize));
      const snapshot = await getDocs(fallbackQ);
      return snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          ...data,
          id: docSnap.id,
          createdBy: data.createdBy || data.generatedBy || 'unknown',
          createdByName: data.createdByName || data.generatedByName || 'Unknown',
          status: data.status || 'active',
          text: data.text || data.questionText || data.content || '',
          type: data.type || data.questionType || 'mcq',
          marks: data.marks ?? data.marksPerQuestion ?? 1,
          tags: data.tags || data.tagList || [],
          subject: data.subject || data.course || '',
          difficulty: data.difficulty || 'medium',
        } as Question;
      });
    }
    throw err;
  }
};

export const getQuestionById = async (questionId: string): Promise<Question | null> => {
  const docRef = doc(db, QUESTIONS_COLLECTION, questionId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    return {
      ...data,
      id: docSnap.id,
      createdBy: data.createdBy || data.generatedBy || 'unknown',
      createdByName: data.createdByName || data.generatedByName || 'Unknown',
      status: data.status || 'active',
      text: data.text || data.questionText || data.content || '',
      type: data.type || data.questionType || 'mcq',
      marks: data.marks ?? data.marksPerQuestion ?? 1,
      tags: data.tags || data.tagList || [],
      subject: data.subject || data.course || '',
      difficulty: data.difficulty || 'medium',
    } as Question;
  }
  return null;
};

// ==================== CRUD OPERATIONS ====================

export const createQuestion = async (
  collegeId: string,
  questionData: Omit<Question, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'linkedPaperIds' | 'collegeId'>
): Promise<Question> => {
  const now = Timestamp.now();

  const searchKeywords = [
    questionData.text?.toLowerCase(),
    questionData.subject?.toLowerCase(),
    questionData.topic?.toLowerCase(),
    questionData.chapter?.toLowerCase(),
    ...(questionData.tags?.map((t: string) => t.toLowerCase()) || [])
  ].filter(Boolean);

  const cleanedData = cleanUndefined(questionData as any);
  const docRef = await addDoc(collection(db, QUESTIONS_COLLECTION), {
    ...cleanedData,
    collegeId,
    searchKeywords,
    usageCount: 0,
    linkedPaperIds: [],
    createdAt: now,
    updatedAt: now
  });

  return {
    id: docRef.id,
    ...questionData,
    collegeId,
    usageCount: 0,
    linkedPaperIds: [],
    createdAt: now.toDate().toISOString(),
    updatedAt: now.toDate().toISOString()
  } as Question;
};

export const updateQuestion = async (
  questionId: string,
  updates: Partial<Question>
): Promise<void> => {
  const docRef = doc(db, QUESTIONS_COLLECTION, questionId);

  const updateData: any = { ...updates, updatedAt: Timestamp.now() };

  if (updates.text || updates.subject || updates.topic || updates.tags || updates.chapter) {
    const currentDoc = await getDoc(docRef);
    const current = currentDoc.data() as Question;
    updateData.searchKeywords = [
      (updates.text || current.text)?.toLowerCase(),
      (updates.subject || current.subject)?.toLowerCase(),
      (updates.topic || current.topic)?.toLowerCase(),
      (updates.chapter || current.chapter)?.toLowerCase(),
      ...(updates.tags || current.tags || []).map((t: string) => t.toLowerCase())
    ].filter(Boolean);
  }

  await updateDoc(docRef, updateData);
};

export const deleteQuestion = async (questionId: string): Promise<void> => {
  const question = await getQuestionById(questionId);
  if (question && question.linkedPaperIds && question.linkedPaperIds.length > 0) {
    const batch = writeBatch(db);

    for (const paperId of question.linkedPaperIds || []) {
      const paperRef = doc(db, PAPERS_COLLECTION, paperId);
      batch.update(paperRef, {
        questionIds: arrayRemove(questionId),
        updatedAt: Timestamp.now()
      });
    }

    await batch.commit();
  }

  await deleteDoc(doc(db, QUESTIONS_COLLECTION, questionId));
};

// ==================== BULK IMPORT ====================

export const bulkImportQuestions = async (
  collegeId: string,
  questions: Omit<Question, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'linkedPaperIds' | 'collegeId'>[]
): Promise<BulkImportResult> => {
  const results: BulkImportResult = {
    total: questions.length,
    success: 0,
    failed: 0,
    errors: [],
    imported: [],
    importedIds: [],
    createdIds: []
  };

  const BATCH_SIZE = 500;
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const chunk = questions.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    const chunkResults: string[] = [];
    const chunkErrors: { row: number; message: string; question?: string }[] = [];

    for (let j = 0; j < chunk.length; j++) {
      const questionData = chunk[j];
      const globalRow = i + j + 1;
      try {
        const searchKeywords = [
          questionData.text?.toLowerCase(),
          questionData.subject?.toLowerCase(),
          questionData.topic?.toLowerCase(),
          questionData.subTopic?.toLowerCase(),
          questionData.chapter?.toLowerCase(),
          ...(questionData.tags?.map((t: string) => t.toLowerCase()) || [])
        ].filter(Boolean);

        const docRef = doc(collection(db, QUESTIONS_COLLECTION));
        const cleanedQuestionData = cleanUndefined(questionData as any);
        batch.set(docRef, {
          ...cleanedQuestionData,
          collegeId,
          searchKeywords,
          usageCount: 0,
          linkedPaperIds: [],
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });

        chunkResults.push(docRef.id);
        results.success++;
      } catch (error: any) {
        results.failed++;
        chunkErrors.push({
          row: globalRow,
          message: error.message,
          question: questionData.text?.substring(0, 100) || 'Unknown'
        });
      }
    }

    try {
      await batch.commit();
      results.importedIds.push(...chunkResults);
      results.createdIds.push(...chunkResults);
    } catch (error: any) {
      results.failed += chunkResults.length;
      results.success -= chunkResults.length;
      chunkErrors.push({
        row: Math.floor(i / BATCH_SIZE) + 1,
        message: error.message,
        question: `Batch ${Math.floor(i / BATCH_SIZE) + 1}`
      });
    }

    results.errors.push(...chunkErrors.map(e => e.message));
  }

  return results;
};

// ==================== PAPER LINKAGE ====================

export const linkQuestionToPaper = async (
  questionId: string,
  paperId: string
): Promise<void> => {
  const batch = writeBatch(db);

  batch.update(doc(db, QUESTIONS_COLLECTION, questionId), {
    linkedPaperIds: arrayUnion(paperId),
    updatedAt: Timestamp.now()
  });

  batch.update(doc(db, PAPERS_COLLECTION, paperId), {
    questionIds: arrayUnion(questionId),
    updatedAt: Timestamp.now()
  });

  await batch.commit();
};

export const unlinkQuestionFromPaper = async (
  questionId: string,
  paperId: string
): Promise<void> => {
  const batch = writeBatch(db);

  batch.update(doc(db, QUESTIONS_COLLECTION, questionId), {
    linkedPaperIds: arrayRemove(paperId),
    updatedAt: Timestamp.now()
  });

  batch.update(doc(db, PAPERS_COLLECTION, paperId), {
    questionIds: arrayRemove(questionId),
    updatedAt: Timestamp.now()
  });

  await batch.commit();
};

export const getLinkedPapers = async (questionId: string): Promise<Paper[]> => {
  const question = await getQuestionById(questionId);
  if (!question || !question.linkedPaperIds?.length) {
    return [];
  }

  const papers: Paper[] = [];
  const batchSize = 10;
  const ids = question.linkedPaperIds;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchPromises = batch.map(id => getDoc(doc(db, PAPERS_COLLECTION, id)));
    const batchResults = await Promise.all(batchPromises);

    batchResults.forEach(paperDoc => {
      if (paperDoc.exists()) {
        papers.push({ id: paperDoc.id, ...paperDoc.data() } as Paper);
      }
    });
  }

  return papers;
};

export const getQuestionsByPaper = async (paperId: string): Promise<Question[]> => {
  const paperDoc = await getDoc(doc(db, PAPERS_COLLECTION, paperId));
  if (!paperDoc.exists()) return [];

  const paper = paperDoc.data() as Paper;
  if (!paper.questionIds?.length && !paper.linkedQuestionIds?.length) return [];

  const ids = paper.questionIds || paper.linkedQuestionIds || [];
  const questions: Question[] = [];
  const batchSize = 10;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchPromises = batch.map(id => getDoc(doc(db, QUESTIONS_COLLECTION, id)));
    const batchResults = await Promise.all(batchPromises);

    batchResults.forEach(q => {
      if (q.exists()) {
        const data = q.data();
        questions.push({
          ...data,
          id: q.id,
          createdBy: data.createdBy || data.generatedBy || 'unknown',
          createdByName: data.createdByName || data.generatedByName || 'Unknown',
          status: data.status || 'active',
          text: data.text || data.questionText || data.content || '',
          type: data.type || data.questionType || 'mcq',
          marks: data.marks ?? data.marksPerQuestion ?? 1,
          tags: data.tags || data.tagList || [],
          subject: data.subject || data.course || '',
          difficulty: data.difficulty || 'medium',
        } as Question);
      }
    });
  }

  return questions;
};

// ==================== STATISTICS & ANALYTICS ====================

export const getQuestionStats = async (collegeId: string) => {
  const q = query(
    collection(db, QUESTIONS_COLLECTION),
    where('collegeId', '==', collegeId)
  );

  const snapshot = await getDocs(q);

  const stats = {
    total: 0,
    bySubject: {} as Record<string, number>,
    byDifficulty: {} as Record<string, number>,
    byType: {} as Record<string, number>,
    byBatch: {} as Record<string, number>,
    byBranch: {} as Record<string, number>,
    pyqCount: 0,
    linkedCount: 0,
    unusedCount: 0
  };

  snapshot.forEach((doc) => {
    const q = doc.data();
    stats.total++;

    const subject = q.subject || q.course || 'Unknown';
    const type = q.type || q.questionType || 'unknown';
    const difficulty = q.difficulty || 'medium';
    const batch = q.batch || 'Unspecified';
    const branch = q.branch || 'Unspecified';

    stats.bySubject[subject] = (stats.bySubject[subject] || 0) + 1;
    stats.byDifficulty[difficulty] = (stats.byDifficulty[difficulty] || 0) + 1;
    stats.byType[type] = (stats.byType[type] || 0) + 1;
    stats.byBatch[batch] = (stats.byBatch[batch] || 0) + 1;
    stats.byBranch[branch] = (stats.byBranch[branch] || 0) + 1;

    if (q.isPYQ) stats.pyqCount++;
    if ((q.linkedPaperIds || []).length > 0) stats.linkedCount++;
    if ((q.usageCount || 0) === 0) stats.unusedCount++;
  });

  return stats;
};

// ==================== PYQ SPECIFIC ====================

export const getPYQQuestions = async (
  collegeId: string,
  filters: { examYear?: string; examName?: string; subject?: string } = {}
): Promise<Question[]> => {
  const constraints: any[] = [
    where('collegeId', '==', collegeId),
    where('isPYQ', '==', true),
    orderBy('examYear', 'desc')
  ];

  if (filters.examYear) {
    constraints.push(where('examYear', '==', filters.examYear));
  }
  if (filters.examName) {
    constraints.push(where('examName', '==', filters.examName));
  }
  if (filters.subject) {
    constraints.push(where('subject', '==', filters.subject));
  }

  const q = query(collection(db, QUESTIONS_COLLECTION), ...constraints);
  const snapshot = await getDocs(q);

  const questions: Question[] = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    questions.push({
      ...data,
      id: doc.id,
      createdBy: data.createdBy || data.generatedBy || 'unknown',
      createdByName: data.createdByName || data.generatedByName || 'Unknown',
      status: data.status || 'active',
      text: data.text || data.questionText || data.content || '',
      type: data.type || data.questionType || 'mcq',
      marks: data.marks ?? data.marksPerQuestion ?? 1,
      tags: data.tags || data.tagList || [],
      subject: data.subject || data.course || '',
      difficulty: data.difficulty || 'medium',
    } as Question);
  });

  return questions;
};

export const getPYQExamYears = async (collegeId: string): Promise<string[]> => {
  const q = query(
    collection(db, QUESTIONS_COLLECTION),
    where('collegeId', '==', collegeId),
    where('isPYQ', '==', true)
  );

  const snapshot = await getDocs(q);
  const years = new Set<string>();

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.examYear) years.add(data.examYear);
  });

  // Include years from imported/seeded platform PYQs (best effort).
  try {
    (await loadPlatformPyqMetas()).forEach((meta) => {
      const year = platformPyqExamYear(meta);
      if (year) years.add(year);
    });
  } catch (bridgeErr) {
    console.warn('[getPYQExamYears] Platform PYQ bridge failed:', bridgeErr);
  }

  return Array.from(years).sort().reverse();
};

export const getPYQExamNames = async (collegeId: string, examYear?: string): Promise<string[]> => {
  const constraints: any[] = [
    where('collegeId', '==', collegeId),
    where('isPYQ', '==', true)
  ];

  if (examYear) {
    constraints.push(where('examYear', '==', examYear));
  }

  const q = query(collection(db, QUESTIONS_COLLECTION), ...constraints);
  const snapshot = await getDocs(q);
  const names = new Set<string>();

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.examName) names.add(data.examName);
  });

  // Include exam names from imported/seeded platform PYQs (best effort).
  try {
    (await loadPlatformPyqMetas()).forEach((meta) => {
      if (examYear && platformPyqExamYear(meta) !== String(examYear)) return;
      names.add(platformPyqExamName(meta));
    });
  } catch (bridgeErr) {
    console.warn('[getPYQExamNames] Platform PYQ bridge failed:', bridgeErr);
  }

  return Array.from(names).sort();
};

// ==================== DUPLICATE DETECTION ====================

export const findDuplicateQuestions = async (
  collegeId: string,
  text: string,
  threshold: number = 0.85
): Promise<Question[]> => {
  const keyword = (text || '').toLowerCase().substring(0, 20);
  const q = query(
    collection(db, QUESTIONS_COLLECTION),
    where('collegeId', '==', collegeId),
    where('searchKeywords', 'array-contains', keyword),
    limit(50)
  );

  const snapshot = await getDocs(q);
  const candidates: Question[] = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    candidates.push({
      ...data,
      id: doc.id,
      createdBy: data.createdBy || data.generatedBy || 'unknown',
      createdByName: data.createdByName || data.generatedByName || 'Unknown',
      status: data.status || 'active',
      text: data.text || data.questionText || data.content || '',
      type: data.type || data.questionType || 'mcq',
      marks: data.marks ?? data.marksPerQuestion ?? 1,
      tags: data.tags || data.tagList || [],
      subject: data.subject || data.course || '',
      difficulty: data.difficulty || 'medium',
    } as Question);
  });

  const textWords = new Set((text || '').toLowerCase().split(/\s+/));
  return candidates.filter(q => {
    const qWords = new Set((q.text || '').toLowerCase().split(/\s+/));
    const intersection = new Set([...textWords].filter(x => qWords.has(x)));
    const union = new Set([...textWords, ...qWords]);
    const similarity = intersection.size / union.size;
    return similarity >= threshold;
  });
};

// ============================================================
// UNIVERSAL QUESTION BANK API STUBS
// ============================================================
// These are placeholder implementations that bridge the
// college-specific questionBankApi to the universal system.
// Replace with real implementations when the universal backend
// is fully built.
// ============================================================

// --- helpers for universal bank consumption layer ---
function isVisibleToCollegeGate(
  meta: QuestionMetadata,
  viewerCollegeId?: string | null,
  viewerIsSuperadmin = false,
): boolean {
  if (viewerIsSuperadmin) return true;
  const vis = (meta.visibility as string) || 'college_only';
  if (vis === 'public') return true;
  if (!viewerCollegeId) return false;
  if (vis === 'college_only') return meta.createdBy?.collegeId === viewerCollegeId;
  if (vis === 'shared_with') return (meta.sharedWith || []).includes(viewerCollegeId);
  return false;
}

function matchesSearch(meta: QuestionMetadata, searchQuery: string): boolean {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  // Search across denormalised fields that are always present without reading content.
  const haystack = [
    (meta as any).previewText || '',
    meta.subjectId || '',
    meta.topicId || '',
    (meta as any).subTopicId || '',
    meta.questionType || '',
    meta.difficulty || '',
    (meta.tags || []).join(' '),
    (meta as any).searchKeywords ? (meta as any).searchKeywords.join(' ') : '',
  ]
    .join(' ')
    .toLowerCase();
  // All tokens must appear (AND). Falls back to substring for old docs without searchKeywords.
  return tokens.every((tok) => haystack.includes(tok));
}

// --- Question Metadata API ---
export const questionMetadataApi = {
  async search(
    filter: UniversalQuestionFilter,
    pagination: PaginationParams
  ): Promise<ApiResponse<UniversalPaginatedResult<QuestionMetadata>>> {
    try {
      const constraints: any[] = [];
      if (filter.subjectId) constraints.push(where('subjectId', '==', filter.subjectId));
      if (filter.topicId) constraints.push(where('topicId', '==', filter.topicId));
      if (filter.subTopicId) constraints.push(where('subTopicId', '==', filter.subTopicId));
      if (filter.difficulty) constraints.push(where('difficulty', '==', filter.difficulty));
      if (filter.questionType) constraints.push(where('questionType', '==', filter.questionType));
      if (filter.status) constraints.push(where('status', '==', filter.status));
      if (filter.tags?.length) constraints.push(where('tags', 'array-contains-any', filter.tags));
      // NOTE: we deliberately DO NOT add a Firestore where('createdBy.collegeId','==',collegeId)
      // filter here — that would hide public platform content (createdBy.collegeId == null) from
      // colleges. Visibility is enforced client-side via isVisibleToCollegeGate() below so public
      // + own-college + shared_with are all correctly surfaced. The legacy exact-match filter is
      // what caused the cross-tenant leak when it was absent; the gate below is what closes it.

      // searchQuery is applied client-side after fetch so old rows that lack searchKeywords still
      // match, and we avoid a required composite index on searchKeywords + every other filter.
      // If a keyword index exists Firestore will still benefit when we add it, but the fallback is
      // correct without it.

      constraints.push(orderBy('createdAt', 'desc'));
      const page = Math.max(1, pagination.page || 1);
      const lim = Math.max(1, pagination.limit || 20);
      // Firestore offset() charges for skipped docs and is not available in all SDK builds;
      // we emulate pagination by fetching page*limit and slicing. This still makes
      // \"Load more\" actually advance — the previous impl ignored page and always returned page 1.
      // The cost is page*limit reads per request, which is bounded (20–40) and well within
      // free-tier for the bank's scale.
      constraints.push(limit(page * lim));

      let snapshot;
      try {
        const q = query(collection(db, 'questionBank_meta'), ...constraints);
        snapshot = await getDocs(q);
      } catch (idxErr: any) {
        const msg = String(idxErr?.message || '');
        const isIndex = msg.includes('requires an index') || idxErr?.code === 'failed-precondition';
        if (!isIndex) throw idxErr;
        // Fallback: minimal indexed query (status only) and filter the rest in memory.
        // This keeps the UI functional while the composite index builds, at the cost of
        // reading up to 100 docs server-side and discarding non-matches.
        console.warn('[questionMetadataApi.search] composite index missing, falling back:', msg);
        const fbConstraints: any[] = [];
        if (filter.status) fbConstraints.push(where('status', '==', filter.status));
        fbConstraints.push(orderBy('createdAt', 'desc'));
        fbConstraints.push(limit(100));
        const fbQ = query(collection(db, 'questionBank_meta'), ...fbConstraints);
        const fbSnap = await getDocs(fbQ);
        let docs = fbSnap.docs.map((d) => ({ id: d.id, ...d.data() } as QuestionMetadata));
        // In-memory filter for the constraints we couldn't apply server-side
        docs = docs.filter((m) => {
          if (filter.subjectId && m.subjectId !== filter.subjectId) return false;
          if (filter.topicId && m.topicId !== filter.topicId) return false;
          if (filter.subTopicId && (m as any).subTopicId !== filter.subTopicId) return false;
          if (filter.difficulty && m.difficulty !== filter.difficulty) return false;
          if (filter.questionType && m.questionType !== filter.questionType) return false;
          if (filter.tags?.length && !filter.tags.some((t) => (m.tags || []).includes(t))) return false;
          return true;
        });
        // Visibility + search gates
        const viewerId = (filter as any).collegeId as string | null | undefined;
        const isSuper = Boolean((filter as any).viewerIsSuperadmin);
        docs = docs.filter((m) => isVisibleToCollegeGate(m, viewerId, isSuper));
        if (filter.searchQuery?.trim()) {
          docs = docs.filter((m) => matchesSearch(m, filter.searchQuery!));
        }
        // Manual pagination after filtering (page-scoped total — see handoff §3)
        const total = docs.length;
        const paged = docs.slice((page - 1) * lim, (page - 1) * lim + lim);
        return {
          success: true,
          data: {
            data: paged,
            page,
            limit: lim,
            total,
            totalPages: Math.ceil(total / lim) || 1,
            hasNextPage: (page * lim) < total,
            hasPrevPage: page > 1,
          },
        };
      }

      let data: QuestionMetadata[] = [];
      snapshot.forEach((docSnap) => {
        data.push({ id: docSnap.id, ...docSnap.data() } as QuestionMetadata);
      });

      // Client-side visibility gate — closes the cross-tenant leak where any staff could
      // read every college's college_only/shared_with rows. Rules allow the read; this
      // gate decides what the UI actually surfaces. Superadmin bypasses it.
      const viewerId = (filter as any).collegeId as string | null | undefined;
      const isSuper = Boolean((filter as any).viewerIsSuperadmin);
      const beforeGate = data.length;
      let filtered = data.filter((m) => isVisibleToCollegeGate(m, viewerId, isSuper));

      // Search gate (client-side substring so old docs without searchKeywords still work)
      if (filter.searchQuery?.trim()) {
        filtered = filtered.filter((m) => matchesSearch(m, filter.searchQuery!));
      }

      // If we filtered heavily, data may be smaller than the page size even though more
      // matching docs exist beyond the limit window. Totals are therefore page-scoped
      // (cheap gate) — the handoff calls this out explicitly. The two-query merge
      // alternative (public + own-college) would give exact totals but needs additional
      // indexes (visibility, createdAt) and (createdBy.collegeId, createdAt).
      // We fetched page*lim docs; slice to the requested page window so page 2
      // doesn't return pages 1+2 together.
      const totalFiltered = filtered.length;
      const paged = filtered.slice((page - 1) * lim, (page - 1) * lim + lim);
      const hasNextPage =
        paged.length === lim && (snapshot.size === page * lim || totalFiltered > page * lim);

      return {
        success: true,
        data: {
          data: paged,
          page,
          limit: lim,
          total: totalFiltered,
          totalPages: Math.ceil(totalFiltered / lim) || 1,
          hasNextPage,
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async getById(id: string): Promise<ApiResponse<QuestionMetadata>> {
    try {
      const docSnap = await getDoc(doc(db, 'questionBank_meta', id));
      if (!docSnap.exists()) return { success: false, error: 'Not found' };
      return { success: true, data: { id: docSnap.id, ...docSnap.data() } as QuestionMetadata };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async getByIds(ids: string[]): Promise<ApiResponse<QuestionMetadata[]>> {
    try {
      const results: QuestionMetadata[] = [];
      for (const id of ids) {
        const res = await this.getById(id);
        if (res.success && res.data) results.push(res.data);
      }
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async getRandomQuestionIds(
    topicId: string,
    difficulty: string,
    count: number,
    excludeIds: string[]
  ): Promise<ApiResponse<string[]>> {
    try {
      let q = query(
        collection(db, 'questionBank_meta'),
        where('topicId', '==', topicId),
        where('difficulty', '==', difficulty),
        where('status', '==', 'approved'),
        limit(count * 3)
      );
      const snapshot = await getDocs(q);
      const ids: string[] = [];
      snapshot.forEach((docSnap) => {
        if (!excludeIds.includes(docSnap.id)) ids.push(docSnap.id);
      });
      // Shuffle and take count
      const shuffled = ids.sort(() => Math.random() - 0.5).slice(0, count);
      return { success: true, data: shuffled };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async updateStatus(
    questionId: string,
    status: ReviewStatus,
    reviewerId: string
  ): Promise<ApiResponse<void>> {
    try {
      await updateDoc(doc(db, 'questionBank_meta', questionId), {
        status,
        reviewedBy: reviewerId,
        updatedAt: new Date().toISOString(),
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async incrementUsage(questionId: string, collegeId: string): Promise<ApiResponse<void>> {
    try {
      const ref = doc(db, 'questionBank_meta', questionId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { success: false, error: 'Not found' };
      const current = snap.data();
      await updateDoc(ref, {
        usageCount: (current.usageCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// --- Paper API ---
export const paperApi = {
  async create(paper: UniversalPaper): Promise<ApiResponse<{ id: string }>> {
    try {
      const docRef = await addDoc(collection(db, 'papers_universal'), {
        ...paper,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return { success: true, data: { id: docRef.id } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async getById(id: string): Promise<ApiResponse<UniversalPaper>> {
    try {
      const docSnap = await getDoc(doc(db, 'papers_universal', id));
      if (!docSnap.exists()) return { success: false, error: 'Not found' };
      return { success: true, data: { id: docSnap.id, ...docSnap.data() } as UniversalPaper };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async search(
    filter: PaperFilter,
    pagination: PaginationParams
  ): Promise<ApiResponse<UniversalPaginatedResult<UniversalPaper>>> {
    try {
      const constraints: any[] = [];
      if (filter.subjectId) constraints.push(where('subjectId', '==', filter.subjectId));
      if (filter.topicId) constraints.push(where('topicIds', 'array-contains', filter.topicId));
      if (filter.createdBy) constraints.push(where('createdBy.userId', '==', filter.createdBy));
      if (filter.collegeId) constraints.push(where('createdBy.collegeId', '==', filter.collegeId));
      if (filter.visibility) constraints.push(where('visibility', '==', filter.visibility));
      if (filter.status) constraints.push(where('status', '==', filter.status));

      constraints.push(orderBy('createdAt', 'desc'));
      constraints.push(limit(pagination.limit));

      const q = query(collection(db, 'papers_universal'), ...constraints);
      const snapshot = await getDocs(q);

      const data: UniversalPaper[] = [];
      snapshot.forEach((docSnap) => {
        data.push({ id: docSnap.id, ...docSnap.data() } as UniversalPaper);
      });

      return {
        success: true,
        data: {
          data,
          page: pagination.page,
          limit: pagination.limit,
          total: data.length,
          totalPages: Math.ceil(data.length / pagination.limit) || 1,
          hasNextPage: data.length === pagination.limit,
          hasPrevPage: pagination.page > 1,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// --- Paper Template API ---
export const paperTemplateApi = {
  async getAll(): Promise<ApiResponse<PaperTemplate[]>> {
    try {
      const q = query(collection(db, 'paperTemplates'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const data: PaperTemplate[] = [];
      snapshot.forEach((docSnap) => {
        data.push({ id: docSnap.id, ...docSnap.data() } as PaperTemplate);
      });
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async getById(id: string): Promise<ApiResponse<PaperTemplate>> {
    try {
      const docSnap = await getDoc(doc(db, 'paperTemplates', id));
      if (!docSnap.exists()) return { success: false, error: 'Not found' };
      return { success: true, data: { id: docSnap.id, ...docSnap.data() } as PaperTemplate };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async incrementUsage(templateId: string): Promise<ApiResponse<void>> {
    try {
      const ref = doc(db, 'paperTemplates', templateId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { success: false, error: 'Not found' };
      const current = snap.data();
      await updateDoc(ref, {
        usageCount: (current.usageCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// --- Review Queue API ---
export const reviewQueueApi = {
  // Loads reviews of EVERY status (pending + approved + rejected). The Review
  // Queue's tabs and stats cards filter client-side, so a pending-only query
  // here left the Approved / Rejected / All tabs permanently empty.
  async getAll(): Promise<ApiResponse<QuestionReview[]>> {
    try {
      const q = query(
        collection(db, 'questionReviews'),
        orderBy('submittedAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const data: QuestionReview[] = [];
      snapshot.forEach((docSnap) => {
        data.push({ id: docSnap.id, ...docSnap.data() } as QuestionReview);
      });
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async submit(
    review: Omit<QuestionReview, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ApiResponse<{ id: string }>> {
    try {
      const now = new Date().toISOString();
      const docRef = await addDoc(collection(db, 'questionReviews'), {
        ...review,
        createdAt: now,
        updatedAt: now,
      });
      return { success: true, data: { id: docRef.id } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async review(
    reviewId: string,
    status: ReviewStatus,
    reviewerId: string,
    reviewerName: string,
    comment?: string
  ): Promise<ApiResponse<void>> {
    try {
      await updateDoc(doc(db, 'questionReviews', reviewId), {
        status,
        reviewerId,
        reviewerName,
        reviewComment: comment || '',
        reviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  // Bulk "approve all" for the Review Queue (used after a paper import drops
  // dozens of pending drafts at once). One call performs the SAME two writes
  // per question that `review()` + `questionMetadataApi.updateStatus()` do for
  // a single approval, but packed into Firestore write batches instead of one
  // round-trip per question.
  async approveMany(
    items: Array<{ reviewId: string; questionId: string }>,
    reviewerId: string,
    reviewerName: string,
    comment?: string
  ): Promise<ApiResponse<{ approved: number; failed: number }>> {
    const now = new Date().toISOString();
    const approvedIds = new Set<string>();
    const failedIds = new Set<string>();

    const writeItem = async (item: { reviewId: string; questionId: string }) => {
      try {
        await updateDoc(doc(db, 'questionReviews', item.reviewId), {
          status: 'approved' as ReviewStatus,
          reviewerId,
          reviewerName,
          reviewComment: comment || '',
          reviewedAt: now,
          updatedAt: now,
        });
        await updateDoc(doc(db, 'questionBank_meta', item.questionId), {
          status: 'approved' as ReviewStatus,
          reviewedBy: reviewerId,
          updatedAt: now,
        });
        approvedIds.add(item.reviewId);
      } catch {
        failedIds.add(item.reviewId);
      }
    };

    try {
      // 2 writes per item → chunks of 200 stay under the 500-op batch limit.
      // Batches are atomic, so a chunk that fails (e.g. a draft whose meta doc
      // is missing) is retried item-by-item to let the healthy rows through.
      const CHUNK = 200;
      for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK);
        try {
          const batch = writeBatch(db);
          chunk.forEach((item) => {
            batch.update(doc(db, 'questionReviews', item.reviewId), {
              status: 'approved' as ReviewStatus,
              reviewerId,
              reviewerName,
              reviewComment: comment || '',
              reviewedAt: now,
              updatedAt: now,
            });
            batch.update(doc(db, 'questionBank_meta', item.questionId), {
              status: 'approved' as ReviewStatus,
              reviewedBy: reviewerId,
              updatedAt: now,
            });
          });
          await batch.commit();
          chunk.forEach((item) => approvedIds.add(item.reviewId));
        } catch {
          for (const item of chunk) {
            if (!approvedIds.has(item.reviewId)) await writeItem(item);
          }
        }
      }
      return { success: true, data: { approved: approvedIds.size, failed: failedIds.size } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};

// --- Stats API ---
export const statsApi = {
  async getQuestionBankStats(): Promise<ApiResponse<UniversalStats>> {
    try {
      const metaSnap = await getDocs(collection(db, 'questionBank_meta'));
      const papersSnap = await getDocs(collection(db, 'papers_universal'));
      const templatesSnap = await getDocs(collection(db, 'paperTemplates'));
      const reviewsSnap = await getDocs(
        query(collection(db, 'questionReviews'), where('status', '==', 'pending'))
      );

      const bySubject: Record<string, number> = {};
      const byDifficulty: DifficultyCount = { easy: 0, medium: 0, hard: 0 };
      const byType: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      const colleges = new Set<string>();
      const contributors = new Set<string>();

      metaSnap.forEach((docSnap) => {
        const d = docSnap.data();
        bySubject[d.subjectId || 'Unknown'] = (bySubject[d.subjectId || 'Unknown'] || 0) + 1;
        if (d.difficulty) byDifficulty[d.difficulty as keyof DifficultyCount]++;
        byType[d.questionType || 'unknown'] = (byType[d.questionType || 'unknown'] || 0) + 1;
        byStatus[d.status || 'unknown'] = (byStatus[d.status || 'unknown'] || 0) + 1;
        if (d.createdBy?.collegeId) colleges.add(d.createdBy.collegeId);
        if (d.createdBy?.userId) contributors.add(d.createdBy.userId);
      });

      return {
        success: true,
        data: {
          totalQuestions: metaSnap.size,
          totalPapers: papersSnap.size,
          totalTemplates: templatesSnap.size,
          bySubject,
          byDifficulty,
          byType,
          byStatus,
          pendingReviews: reviewsSnap.size,
          totalColleges: colleges.size,
          totalContributors: contributors.size,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },

  async getTopicStats(topicId: string): Promise<ApiResponse<TopicStats>> {
    try {
      const q = query(
        collection(db, 'questionBank_meta'),
        where('topicId', '==', topicId)
      );
      const snapshot = await getDocs(q);

      const byDifficulty: DifficultyCount = { easy: 0, medium: 0, hard: 0 };
      const byType: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      let totalUsage = 0;
      let qualitySum = 0;

      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.difficulty) byDifficulty[d.difficulty as keyof DifficultyCount]++;
        byType[d.questionType || 'unknown'] = (byType[d.questionType || 'unknown'] || 0) + 1;
        byStatus[d.status || 'unknown'] = (byStatus[d.status || 'unknown'] || 0) + 1;
        totalUsage += d.usageCount || 0;
        qualitySum += d.qualityRating || 0;
      });

      return {
        success: true,
        data: {
          topicId,
          totalQuestions: snapshot.size,
          byDifficulty,
          byType,
          byStatus,
          averageQuality: snapshot.size > 0 ? qualitySum / snapshot.size : 0,
          totalUsage,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
};
