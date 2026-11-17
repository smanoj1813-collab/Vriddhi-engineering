// api/assessmentsApi.ts
// ============================================
// ASSESSMENTS API — Complete Firebase Operations
// ============================================

import { branchConstraint } from '@/shared/utils/branchQuery';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy,
  addDoc, updateDoc, deleteDoc, Timestamp,
  limit, startAfter, QueryConstraint,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions as cloudFunctions } from '@/Firebase/config';

import type {
  Assessment, StudentAssessment, StudentAnswer,
  CreateAssessmentInput, UpdateAssessmentInput,
  AssessmentFilterOptions, AssessmentStats, AssessmentSection,
  AIGenerationConfig, BulkGradeInput,
  AssessmentPaper, CreatePaperInput, PaperSection, PaperQuestion,
  ScheduledTest, ScheduleTestInput, ReviewQueueItem,
  TestAnalytics,
} from '../types/assessment';
import { computeAssessmentStats } from '../utils/assessmentStats';

// ═══════════════════════════════════════════════════════════════════════
// Assessments
// ═══════════════════════════════════════════════════════════════════════

export async function createAssessment(input: CreateAssessmentInput): Promise<Assessment> {
  const now = Timestamp.now();
  const data = {
    ...input,
    status: input.status || 'draft',
    createdAt: now,
    updatedAt: now,
  };
  const docRef = await addDoc(collection(db, 'assessments'), data);
  return { id: docRef.id, ...data, createdAt: now.toDate().toISOString(), updatedAt: now.toDate().toISOString() } as unknown as Assessment;
}

export async function getAssessmentById(id: string): Promise<Assessment | null> {
  const docRef = doc(db, 'assessments', id);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return null;
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: data.createdAt?.toDate?.().toISOString() || '',
    updatedAt: data.updatedAt?.toDate?.().toISOString() || '',
  } as unknown as Assessment;
}

export async function listAssessments(options: AssessmentFilterOptions = {}): Promise<Assessment[]> {
  const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
  if (options.collegeId) constraints.push(where('collegeId', '==', options.collegeId));
  if (options.subjectId) constraints.push(where('subjectId', '==', options.subjectId));
  if (options.courseId) constraints.push(where('courseId', '==', options.courseId));
  if (options.status) constraints.push(where('status', '==', options.status));
  if (options.type) constraints.push(where('type', '==', options.type));
  if (options.facultyId) constraints.push(where('createdBy', '==', options.facultyId));
  if (options.curriculumId) constraints.push(where('curriculumId', '==', options.curriculumId));
  if (options.branch) constraints.push(branchConstraint(options.branch));
  if (options.semester !== undefined) constraints.push(where('semester', '==', options.semester));
  if (options.batch) constraints.push(where('batch', '==', options.batch));
  if (options.division) constraints.push(where('division', '==', options.division));
  if (options.section) constraints.push(where('section', '==', options.section));
  if (options.mode) constraints.push(where('mode', '==', options.mode));

  const q = query(collection(db, 'assessments'), ...constraints);
  const snapshot = await getDocs(q);
  let items = snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.().toISOString() || '',
      updatedAt: data.updatedAt?.toDate?.().toISOString() || '',
    } as unknown as Assessment;
  });

  if (options.scheduledDateFrom) {
    items = items.filter((a) =>
      a.scheduledDate && new Date(a.scheduledDate as string) >= new Date(options.scheduledDateFrom as string)
    );
  }
  if (options.scheduledDateTo) {
    items = items.filter((a) =>
      a.scheduledDate && new Date(a.scheduledDate as string) <= new Date(options.scheduledDateTo as string)
    );
  }
  if (options.search || options.searchQuery) {
    const term = (options.search || options.searchQuery || '').toLowerCase();
    items = items.filter((a) =>
      (a.title?.toLowerCase() || '').includes(term) ||
      (a.courseCode?.toLowerCase() || '').includes(term) ||
      (a.courseName?.toLowerCase() || '').includes(term)
    );
  }

  return items;
}

export async function updateAssessment(id: string, updates: UpdateAssessmentInput): Promise<Assessment> {
  const docRef = doc(db, 'assessments', id);
  const data = { ...updates, updatedAt: Timestamp.now() };
  await updateDoc(docRef, data);
  const updated = await getDoc(docRef);
  const updatedData = updated.data()!;
  return {
    id: updated.id,
    ...updatedData,
    createdAt: updatedData.createdAt?.toDate?.().toISOString() || '',
    updatedAt: updatedData.updatedAt?.toDate?.().toISOString() || '',
  } as unknown as Assessment;
}

export async function deleteAssessment(id: string): Promise<void> {
  await deleteDoc(doc(db, 'assessments', id));
}

export async function publishAssessment(assessmentId: string): Promise<Assessment> {
  return updateAssessment(assessmentId, { status: 'published' });
}

export async function activateAssessment(assessmentId: string): Promise<Assessment> {
  return updateAssessment(assessmentId, { status: 'active' });
}

export async function completeAssessment(assessmentId: string): Promise<Assessment> {
  return updateAssessment(assessmentId, { status: 'completed' });
}

export async function archiveAssessment(assessmentId: string): Promise<Assessment> {
  return updateAssessment(assessmentId, { status: 'archived' });
}

// ═══════════════════════════════════════════════════════════════════════
// Student Assessments
// ═══════════════════════════════════════════════════════════════════════

export async function createStudentAssessment(
  _assessment: Assessment,
  _student: { id: string; name: string; regNo: string }
): Promise<StudentAssessment> {
  throw new Error('Student attempts are created by the secure startMyStudentTest workflow. Target students when scheduling the test instead.');
}

export async function getStudentAssessment(id: string): Promise<StudentAssessment | null> {
  const docRef = doc(db, 'studentAssessments', id);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return null;
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: data.createdAt?.toDate?.().toISOString() || '',
    updatedAt: data.updatedAt?.toDate?.().toISOString() || '',
  } as unknown as StudentAssessment;
}

export async function listStudentAssessments(filters: { assessmentId?: string; studentId?: string; status?: string } = {}): Promise<StudentAssessment[]> {
  const constraints: QueryConstraint[] = [];
  if (filters.assessmentId) constraints.push(where('assessmentId', '==', filters.assessmentId));
  if (filters.studentId) constraints.push(where('studentId', '==', filters.studentId));
  if (filters.status) constraints.push(where('status', '==', filters.status));

  const q = query(collection(db, 'studentAssessments'), ...constraints, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.().toISOString() || '',
      updatedAt: data.updatedAt?.toDate?.().toISOString() || '',
    } as unknown as StudentAssessment;
  });
}

export async function startAssessment(_studentAssessmentId: string): Promise<StudentAssessment> {
  throw new Error('Only the authenticated student can start an eligible test through startMyStudentTest.');
}

export async function submitAssessment(
  _studentAssessmentId: string,
  _answers: StudentAnswer[],
  _timeSpent: number
): Promise<StudentAssessment> {
  throw new Error('Student submissions must use the secure submitMyStudentTest workflow.');
}

export async function gradeAssessment(
  studentAssessmentId: string,
  marksObtained: number,
  _percentage: number,
  _grade: string,
  _gradePoint: number,
  feedback?: string,
  _gradedBy?: string
): Promise<StudentAssessment> {
  const gradeSubmission = httpsCallable<
    { studentAssessmentId: string; marksObtained: number; feedback?: string },
    { success: boolean }
  >(cloudFunctions, 'gradeStudentAssessmentSubmission');
  await gradeSubmission({ studentAssessmentId, marksObtained, feedback });
  const updated = await getStudentAssessment(studentAssessmentId);
  if (!updated) throw new Error('The graded student assessment could not be reloaded.');
  return updated;
}

export async function autoGradeStudentAssessment(
  studentAssessmentId: string,
  _questions: any[]
): Promise<StudentAssessment> {
  const current = await getStudentAssessment(studentAssessmentId);
  if (!current) throw new Error('Student assessment not found.');
  // Objective grading is performed atomically by submitMyStudentTest. The
  // browser is intentionally unable to re-run or overwrite that score.
  return current;
}

export async function bulkCreateStudentAssessments(
  _assessment: Assessment,
  _students: Array<{ id: string; name: string; regNo: string }>
): Promise<StudentAssessment[]> {
  throw new Error('Attempts are created from server-validated schedule eligibility when each student starts the test.');
}

export async function bulkGradeAssessments(inputs: BulkGradeInput[]): Promise<void> {
  await Promise.all(inputs.map((input) => gradeAssessment(
    input.studentAssessmentId,
    input.marksObtained,
    input.percentage,
    input.grade,
    input.gradePoint,
    input.feedback
  )));
}

export async function recalculateAssessmentStats(_assessmentId: string): Promise<void> {
  // Stats are now derived on demand from the assessment list via
  // computeAssessmentStats() (see getAssessmentStats below), so there is no
  // persisted aggregate to recompute. Kept as a resolved no-op for API
  // compatibility with existing callers.
}

export async function getAssessmentStats(collegeId: string): Promise<AssessmentStats> {
  // Aggregate from the SAME list the table renders — no second source of truth.
  const assessments = await listAssessments(collegeId ? { collegeId } : {});
  return computeAssessmentStats(assessments);
}

export async function getAssessmentAverageScore(assessmentId: string): Promise<number> {
  const q = query(collection(db, 'studentAssessments'), where('assessmentId', '==', assessmentId), where('status', '==', 'graded'));
  const snapshot = await getDocs(q);
  let totalScore = 0;
  let scoreCount = 0;
  snapshot.docs.forEach((d) => {
    const sa = d.data() as StudentAssessment;
    if ((sa.percentage || 0) > 0) {
      totalScore += sa.percentage || 0;
      scoreCount++;
    }
  });
  return scoreCount > 0 ? totalScore / scoreCount : 0;
}

// ═══════════════════════════════════════════════════════════════════════
// Review Queue
// ═══════════════════════════════════════════════════════════════════════

export async function getPendingReviews(): Promise<ReviewQueueItem[]> {
  const q = query(collection(db, 'reviewQueue'), where('status', '==', 'pending'), orderBy('submittedAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      type: data.type || 'question',
      itemId: data.questionId || data.paperId || d.id,
      title: data.title || 'Untitled',
      status: data.status || 'pending',
      submittedBy: data.submittedBy || '',
      submittedByName: data.submittedByName || 'Unknown',
      submittedByRole: data.submittedByRole || 'faculty',
      submittedAt: data.submittedAt?.toDate?.().toISOString() || new Date().toISOString(),
      questionId: data.questionId,
      paperId: data.paperId,
      rejectionReason: data.rejectionReason,
      reviewedBy: data.reviewedBy,
      reviewedAt: data.reviewedAt?.toDate?.().toISOString() || '',
    } as unknown as ReviewQueueItem;
  });
}

export async function approveQuestion(questionId: string, reviewerId: string, reviewerName: string, _comment?: string): Promise<boolean> {
  await updateDoc(doc(db, 'questions', questionId), { status: 'approved', reviewedBy: reviewerId, reviewedByName: reviewerName, reviewedAt: Timestamp.now() });
  return true;
}

export async function rejectQuestion(questionId: string, reviewerId: string, reviewerName: string, reason: string): Promise<boolean> {
  await updateDoc(doc(db, 'questions', questionId), { status: 'rejected', reviewedBy: reviewerId, reviewedByName: reviewerName, reviewedAt: Timestamp.now(), rejectionReason: reason });
  return true;
}

export async function approvePaper(paperId: string, reviewerId: string, reviewerName: string, _comment?: string): Promise<boolean> {
  await updateDoc(doc(db, 'papers', paperId), { status: 'approved', reviewedBy: reviewerId, reviewedByName: reviewerName, reviewedAt: Timestamp.now() });
  return true;
}

export async function rejectPaper(paperId: string, reviewerId: string, reviewerName: string, reason: string): Promise<boolean> {
  await updateDoc(doc(db, 'papers', paperId), { status: 'rejected', reviewedBy: reviewerId, reviewedByName: reviewerName, reviewedAt: Timestamp.now(), rejectionReason: reason });
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// Papers
// ═══════════════════════════════════════════════════════════════════════

export async function createPaper(input: CreatePaperInput): Promise<AssessmentPaper> {
  const now = Timestamp.now();
  const totalMarks = input.sections.reduce((sum, s) => sum + (s.totalMarks || 0), 0);
  const totalQuestions = input.sections.reduce((sum, s) => sum + (s.questions?.length || 0), 0);
  const data = {
    ...input,
    totalMarks,
    totalQuestions,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
  const docRef = await addDoc(collection(db, 'papers'), data);
  return { id: docRef.id, ...data, createdAt: now.toDate().toISOString(), updatedAt: now.toDate().toISOString() } as unknown as AssessmentPaper;
}

export async function getPaperById(id: string): Promise<AssessmentPaper | null> {
  const docRef = doc(db, 'papers', id);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return null;
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    createdAt: data.createdAt?.toDate?.().toISOString() || '',
    updatedAt: data.updatedAt?.toDate?.().toISOString() || '',
  } as unknown as AssessmentPaper;
}

export async function listPapers(collegeId: string, filters?: { status?: string; subject?: string; createdBy?: string }): Promise<AssessmentPaper[]> {
  const constraints: QueryConstraint[] = [where('collegeId', '==', collegeId), orderBy('createdAt', 'desc')];
  if (filters?.status) constraints.push(where('status', '==', filters.status));
  if (filters?.subject) constraints.push(where('subjectId', '==', filters.subject));
  if (filters?.createdBy) constraints.push(where('createdBy', '==', filters.createdBy));

  const q = query(collection(db, 'papers'), ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.().toISOString() || '',
      updatedAt: data.updatedAt?.toDate?.().toISOString() || '',
    } as unknown as AssessmentPaper;
  });
}

export async function updatePaper(id: string, updates: Partial<AssessmentPaper>): Promise<AssessmentPaper> {
  const docRef = doc(db, 'papers', id);
  await updateDoc(docRef, { ...updates, updatedAt: Timestamp.now() });
  const updated = await getDoc(docRef);
  const data = updated.data()!;
  return { id: updated.id, ...data, createdAt: data.createdAt?.toDate?.().toISOString() || '', updatedAt: data.updatedAt?.toDate?.().toISOString() || '' } as unknown as AssessmentPaper;
}

export async function deletePaper(id: string): Promise<void> {
  await deleteDoc(doc(db, 'papers', id));
}

// ═══════════════════════════════════════════════════════════════════════
// Scheduled Tests
// ═══════════════════════════════════════════════════════════════════════

export async function scheduleTest(input: ScheduleTestInput): Promise<ScheduledTest> {
  const schedule = httpsCallable<Record<string, unknown>, { id: string; status: string }>(
    cloudFunctions,
    'scheduleAssessmentTest'
  );
  const response = await schedule({
    ...input,
    startDateTime: input.startDateTime instanceof Date ? input.startDateTime.toISOString() : input.startDateTime,
    endDateTime: input.endDateTime instanceof Date ? input.endDateTime.toISOString() : input.endDateTime,
    resultPublishDate: input.resultPublishDate instanceof Date
      ? input.resultPublishDate.toISOString()
      : input.resultPublishDate,
  });
  const scheduled = (await listScheduledTests({})).find((test) => test.id === response.data.id);
  if (!scheduled) throw new Error('The scheduled test was created but could not be reloaded.');
  return scheduled;
}

export async function listScheduledTests(
  filters: { collegeId?: string; facultyId?: string; status?: string } = {}
): Promise<ScheduledTest[]> {
  const list = httpsCallable<
    { collegeId?: string },
    { tests: ScheduledTest[] }
  >(cloudFunctions, 'listManagedAssessmentTests');
  const response = await list({ collegeId: filters.collegeId });
  return response.data.tests
    .filter((test) => !filters.facultyId || (test as unknown as { facultyId?: string }).facultyId === filters.facultyId)
    .filter((test) => !filters.status || test.status === filters.status);
}

export async function updateScheduledTest(
  _id: string,
  _updates: Partial<ScheduledTest>
): Promise<ScheduledTest> {
  throw new Error('Published schedule state is server-managed. Cancel the test and create a reviewed replacement schedule.');
}

export async function deleteScheduledTest(id: string): Promise<void> {
  const cancel = httpsCallable<{ testId: string; reason: string }, { success: boolean }>(
    cloudFunctions,
    'cancelAssessmentTest'
  );
  await cancel({ testId: id, reason: 'Cancelled from assessment administration' });
}
