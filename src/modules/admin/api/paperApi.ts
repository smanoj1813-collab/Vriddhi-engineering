import { db } from '@/Firebase/config';
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
  Timestamp,
} from 'firebase/firestore';
import { getAllQuestions, linkQuestionToPaper } from './questionBankApi';
import { isSameSubject } from '@/shared/utils/curriculumMatcher';
import { generateSchemePaper } from '@/shared/utils/engineeringScheme';
import { getCollegeSchemePack } from './schemePackApi';
import { generateQuestionsWithAI, saveGeneratedQuestions } from './aiQuestionApi';
import {
  Paper,
  PaperConfig,
  PaperSection,
  PaperStatus,
  GeneratedPaperResult,
  Question,
  QuestionType,
  DifficultyLevel,
} from '../types/questionBank';

const PAPERS_COLLECTION = 'papers';

function isoNow(): string {
  return Timestamp.now().toDate().toISOString();
}

/**
 * Firestore rejects `undefined` ANYWHERE in a write payload — including
 * nested inside maps inside arrays. Paper sections embed whole question
 * objects, and AI-generated questions legitimately omit fields (a long-answer
 * question has no `correctAnswer`, a short note has no `explanation`), so
 * bank/AI/hybrid generation always produced an addDoc payload the SDK
 * refused with "Unsupported field value: undefined" before the write ever
 * reached the server. Strip undefined leaves recursively, leaving Firestore
 * sentinels (Timestamp, FieldValue, GeoPoint, DocumentReference) untouched.
 */
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefinedDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

function normalizePaper(data: any, id: string): Paper {
  const now = new Date().toISOString();
  return {
    ...(data || {}),
    id,
    createdAt: data?.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data?.createdAt || now,
    updatedAt: data?.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data?.updatedAt || now,
    status: (data?.status as PaperStatus) || 'draft',
    sections: data?.sections || [],
    linkedQuestionIds: data?.linkedQuestionIds || data?.questionIds || [],
    questionIds: data?.questionIds || data?.linkedQuestionIds || [],
    totalQuestions: data?.totalQuestions ?? (data?.questionIds || []).length,
  } as Paper;
}

// ═══════════════════════════════════════════════════════════════════════
// CRUD Operations
// ═══════════════════════════════════════════════════════════════════════

export async function fetchPapers(
  collegeId: string,
  filters?: { status?: PaperStatus; search?: string }
): Promise<{ data: Paper[]; total: number }> {
  // No where+orderBy: those need composite indexes that `deploy:all` does not
  // ship (only `deploy:indexes` does), and a missing index errors out the whole
  // list. College paper volumes are small — one plain where query plus an
  // in-memory filter/sort is index-independent and always complete.
  const papersRef = collection(db, PAPERS_COLLECTION);
  const snap = await getDocs(query(papersRef, where('collegeId', '==', collegeId)));
  let papers = snap.docs.map((d) => normalizePaper(d.data(), d.id));

  // One-stop: also include universal papers (papers_universal) created from Universal Bank selection
  try {
    const universalRef = collection(db, 'papers_universal');
    const uq: any = query(universalRef, where('createdBy.collegeId', '==', collegeId));
    const usnap = await getDocs(uq);
    const universalPapers = usnap.docs.map((d) => {
      const data: any = d.data();
      return {
        ...data,
        id: d.id,
        collegeId: data.createdBy?.collegeId || collegeId,
        createdBy: typeof data.createdBy === 'object' ? data.createdBy?.userId || data.createdBy?.userId : data.createdBy,
        createdByName: data.createdBy?.userName || data.createdByName || 'Unknown',
        questionIds: (data.questions || []).map((q: any) => q.questionId),
        linkedQuestionIds: (data.questions || []).map((q: any) => q.questionId),
        totalQuestions: data.totalQuestions ?? (data.questions || []).length,
        status: data.status || 'draft',
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
        updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data.updatedAt,
      } as unknown as Paper;
    });
    papers = [...papers, ...universalPapers].sort((a: any, b: any) => {
      const at = new Date(a.createdAt).getTime() || 0;
      const bt = new Date(b.createdAt).getTime() || 0;
      return bt - at;
    });
  } catch (e: any) {
    console.warn('[fetchPapers] universal merge skipped:', e?.message);
  }

  if (filters?.status) {
    papers = papers.filter((p) => (p as any).status === filters.status);
  }
  papers.sort((a: any, b: any) => {
    const at = new Date(a.createdAt).getTime() || 0;
    const bt = new Date(b.createdAt).getTime() || 0;
    return bt - at;
  });

  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    papers = papers.filter((p) => p.title.toLowerCase().includes(searchLower));
  }

  return { data: papers, total: papers.length };
}

export async function getPaperById(paperId: string): Promise<Paper | null> {
  const docRef = doc(db, PAPERS_COLLECTION, paperId);
  const snap = await getDoc(docRef);
  if (snap.exists()) return normalizePaper(snap.data(), snap.id);
  try {
    const uniRef = doc(db, 'papers_universal', paperId);
    const uniSnap = await getDoc(uniRef);
    if (uniSnap.exists()) {
      const d: any = uniSnap.data();
      return {
        ...d,
        id: uniSnap.id,
        collegeId: d.createdBy?.collegeId || d.collegeId || '',
        createdBy: d.createdBy?.userId || d.createdBy || '',
        createdByName: d.createdBy?.userName || d.createdByName || 'Unknown',
        questionIds: (d.questions || []).map((q: any) => q.questionId),
        linkedQuestionIds: (d.questions || []).map((q: any) => q.questionId),
        totalQuestions: d.totalQuestions ?? (d.questions || []).length,
        status: d.status || 'draft',
        createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : d.createdAt,
        updatedAt: d.updatedAt instanceof Timestamp ? d.updatedAt.toDate().toISOString() : d.updatedAt,
      } as unknown as Paper;
    }
  } catch {}
  return null;
}

export async function createPaper(
  collegeId: string,
  config: PaperConfig,
  questionIds: string[],
  userId: string,
  userName: string,
  isManual: boolean = false,
  sections: PaperSection[] = []
): Promise<Paper> {
  const now = isoNow();
  const paperData = stripUndefinedDeep({
    ...config,
    sections: sections || [],
    questionIds: questionIds || [],
    linkedQuestionIds: questionIds || [],
    status: 'draft' as PaperStatus,
    // The papers CREATE rule pins a draft/draft initial state
    // (request.resource.data.verificationStatus == 'draft'). A document
    // written without this field is refused outright — which is exactly the
    // "Missing or insufficient permissions" every generator hit on save.
    verificationStatus: 'draft',
    requiresApproval: false,
    collegeId,
    createdBy: userId,
    createdByName: userName,
    totalQuestions: (questionIds || []).length,
    usageCount: 0,
    examType: config.examType || 'midterm',
    batch: config.batch || '',
    branch: config.branch || '',
    date: config.date || new Date().toISOString().split('T')[0],
    isManual,
    createdAt: now,
    updatedAt: now,
  });
  const docRef = await addDoc(collection(db, PAPERS_COLLECTION), paperData);
  return { id: docRef.id, ...paperData } as Paper;
}

export async function updatePaper(paperId: string, updates: Partial<Paper>): Promise<Paper> {
  const docRef = doc(db, PAPERS_COLLECTION, paperId);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: isoNow(),
  });
  const updated = await getDoc(docRef);
  return normalizePaper(updated.data(), updated.id);
}

export async function deletePaper(paperId: string): Promise<void> {
  await deleteDoc(doc(db, PAPERS_COLLECTION, paperId));
}

export async function duplicatePaper(
  paperId: string,
  collegeId: string,
  userId: string,
  userName: string,
  newTitle?: string
): Promise<Paper> {
  const original = await getPaperById(paperId);
  if (!original) throw new Error('Paper not found');

  const { id, createdAt, updatedAt, status, usageCount, verificationStatus, ...rest } = original as any;
  const copyData = stripUndefinedDeep({
    ...rest,
    title: newTitle || `${original.title} (Copy)`,
    status: 'draft' as PaperStatus,
    // A duplicate starts life as a fresh draft; inheriting the source paper's
    // verification state would fail the create rule (and be untrue).
    verificationStatus: 'draft',
    collegeId,
    createdBy: userId,
    createdByName: userName,
    linkedQuestionIds: [...(original.linkedQuestionIds || original.questionIds || [])],
    questionIds: [...(original.questionIds || original.linkedQuestionIds || [])],
    totalQuestions: original.totalQuestions || (original.questionIds || []).length,
    usageCount: 0,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  });
  const docRef = await addDoc(collection(db, PAPERS_COLLECTION), copyData);
  return { id: docRef.id, ...copyData } as Paper;
}

export async function getPaperQuestions(paperId: string): Promise<Question[]> {
  const paper = await getPaperById(paperId);
  if (!paper) return [];
  const ids = paper.questionIds || paper.linkedQuestionIds || [];
  const result: Question[] = [];
  for (const qid of ids) {
    const snap = await getDoc(doc(db, 'questions', qid));
    if (snap.exists()) {
      result.push({ ...snap.data(), id: snap.id } as Question);
      continue;
    }
    try {
      const uniSnap = await getDoc(doc(db, 'questionBank_content', qid));
      if (uniSnap.exists()) {
        const d: any = uniSnap.data();
        result.push({
          id: uniSnap.id,
          text: d.questionText || d.text || '',
          subject: d.subjectId || d.subject || '',
          topic: d.topicId || d.topic || '',
          type: d.questionType || d.type || 'mcq',
          difficulty: d.difficulty || 'medium',
          marks: d.marks ?? 1,
          tags: d.tags || [],
          status: d.status === 'approved' ? 'active' : d.status || 'active',
          createdBy: d.createdBy?.userId || d.createdBy || '',
          createdByName: d.createdBy?.userName || d.createdByName || 'Unknown',
        } as unknown as Question);
        continue;
      }
      const metaSnap = await getDoc(doc(db, 'questionBank_meta', qid));
      if (metaSnap.exists()) {
        const d: any = metaSnap.data();
        result.push({
          id: metaSnap.id,
          text: d.previewText || d.text || '',
          subject: d.subjectId || '',
          topic: d.topicId || '',
          type: d.questionType || 'mcq',
          difficulty: d.difficulty || 'medium',
          marks: d.marks ?? 1,
          tags: d.tags || [],
          status: 'active',
          createdBy: d.createdBy?.userId || '',
          createdByName: d.createdBy?.userName || 'Unknown',
        } as unknown as Question);
      }
    } catch {}
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Paper Generation
// ═══════════════════════════════════════════════════════════════════════

function matchesType(q: Question, questionType: QuestionType | 'any'): boolean {
  if (questionType === 'any') return true;
  return q.type === questionType;
}

function matchesDifficulty(q: Question, difficulty: DifficultyLevel | 'mixed' | undefined): boolean {
  if (!difficulty || difficulty === 'mixed') return true;
  return q.difficulty === difficulty;
}

function matchesDifficultyMix(q: Question, mix?: { easy: number; medium: number; hard: number }): boolean {
  if (!mix) return true;
  const total = (mix.easy || 0) + (mix.medium || 0) + (mix.hard || 0);
  if (total === 0) return true;
  return true; // mix is enforced by bucket selection below, not pre-filtering
}

function pickWithDifficultyMix(
  candidates: Question[],
  numQuestions: number,
  mix?: { easy: number; medium: number; hard: number }
): Question[] {
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  if (!mix || !mix.easy && !mix.medium && !mix.hard) {
    return shuffled.slice(0, numQuestions);
  }

  const buckets: Record<DifficultyLevel, Question[]> = {
    easy: shuffled.filter((q) => q.difficulty === 'easy'),
    medium: shuffled.filter((q) => q.difficulty === 'medium'),
    hard: shuffled.filter((q) => q.difficulty === 'hard'),
  };

  const picked: Question[] = [];
  const used = new Set<string>();

  const take = (level: DifficultyLevel, count: number) => {
    let taken = 0;
    for (const q of buckets[level]) {
      if (taken >= count) break;
      if (!used.has(q.id)) {
        used.add(q.id);
        picked.push(q);
        taken++;
      }
    }
  };

  take('easy', mix.easy || 0);
  take('medium', mix.medium || 0);
  take('hard', mix.hard || 0);

  // Backfill from remaining pool if a bucket is short.
  for (const q of shuffled) {
    if (picked.length >= numQuestions) break;
    if (!used.has(q.id)) {
      used.add(q.id);
      picked.push(q);
    }
  }

  return picked;
}

export interface ExtendedPaperConfig extends PaperConfig {
  sections?: PaperSection[];
  mode?: 'bank' | 'ai' | 'hybrid';
  numSets?: number;
  language?: string;
  courseCode?: string;
  /**
   * Syllabus coverage. When set, only bank questions whose topic/chapter/tags
   * match one of `topicFilters`, or whose unit/module matches one of
   * `unitFilters`, are eligible. `customTopic` steers AI generation.
   */
  topicFilters?: string[];
  unitFilters?: string[];
  customTopic?: string;
  /** Build the paper from the resolved pack's published module/section pattern. */
  useSchemeTemplate?: boolean;
}

const normCoverage = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/^(unit|module)\s*[-:]?\s*/i, '');

function matchesCoverage(q: Question, topics: string[], units: string[]): boolean {
  if (topics.length === 0 && units.length === 0) return true;
  const anyQ = q as any;
  if (topics.length > 0) {
    const qTopics = [anyQ.topic, anyQ.chapter, ...(Array.isArray(anyQ.tags) ? anyQ.tags : [])]
      .map((t) => String(t ?? '').trim().toLowerCase())
      .filter(Boolean);
    const hit = topics.some((t) => {
      const needle = t.trim().toLowerCase();
      return qTopics.some((qt) => qt === needle || qt.includes(needle) || needle.includes(qt));
    });
    if (hit) return true;
  }
  if (units.length > 0) {
    const qUnits = [anyQ.unit, anyQ.module, anyQ.moduleNo].map(normCoverage).filter(Boolean);
    if (units.some((u) => qUnits.includes(normCoverage(u)))) return true;
  }
  return false;
}

export async function generatePaper(
  collegeId: string,
  config: ExtendedPaperConfig,
  userId: string,
  userName: string
): Promise<GeneratedPaperResult & { paper: Paper; sets?: Paper[] }> {
  const resolved = await getCollegeSchemePack(collegeId, {
    programId: config.program,
    branchId: config.branch,
    admissionBatch: config.batch,
  });
  const pack = resolved.pack;
  const template = pack.engineering?.paperTemplate;
  config.schemePackId = resolved.schemePackId || pack.id;
  config.schemePackCode = pack.code;
  config.schemePackResolution = resolved.resolution;
  config.schemeTemplateCode = template?.code;
  if (config.useSchemeTemplate && !template) {
    throw new Error(`The resolved scheme pack (${pack.code}) has no question-paper template.`);
  }
  if (config.useSchemeTemplate && template) {
    config.totalMarks = template.rawTotal;
    config.duration = template.durationMinutes;
    config.numSets = 1;
  }

  const useSchemeTemplate = config.useSchemeTemplate === true && Boolean(template);
  const sections = useSchemeTemplate ? [] : config.sections || [];
  const mode = useSchemeTemplate ? 'bank' : config.mode || 'bank';
  const allQuestions = await getAllQuestions(collegeId, 500);
  const warnings: string[] = [];

  const subjectFilter = config.subject?.trim();
  const filtered = allQuestions.filter((q) => {
    if (!subjectFilter) return true;
    return (
      q.subject === subjectFilter ||
      q.courseName === subjectFilter ||
      q.courseCode === subjectFilter ||
      isSameSubject(q.subject || q.courseName || '', subjectFilter)
    );
  }).filter((q) => matchesCoverage(q, config.topicFilters || [], config.unitFilters || []));

  const coverageTopicLabel =
    config.customTopic?.trim() ||
    (config.topicFilters && config.topicFilters.length > 0 ? config.topicFilters.join(', ') : '') ||
    (config.unitFilters && config.unitFilters.length > 0 ? `Units ${config.unitFilters.join(', ')}` : '');

  const schemeDraft = useSchemeTemplate && template
    ? generateSchemePaper(filtered.map((question) => {
        const raw = question as Question & { co?: string; courseOutcome?: string };
        const moduleFromUnit = Number(String(raw.unit || raw.moduleName || '').match(/(?:module|unit)?\s*(\d+)/i)?.[1]);
        return {
          id: question.id,
          marks: Number(question.marks) || 0,
          module: Number(question.moduleNo) || moduleFromUnit || undefined,
          co: raw.learningOutcomes?.find((outcome) => /^CO\d+$/i.test(outcome.trim()))
            || raw.learningOutcomes?.[0]
            || raw.co
            || raw.courseOutcome,
          bloomLevel: question.bloomLevel,
          difficulty: question.difficulty,
        };
      }), pack)
    : null;
  const questionById = new Map(filtered.map((question) => [question.id, question]));
  const schemeGeneratedSections = schemeDraft && template
    ? schemeDraft.paper.sections.map((section, index) => {
        const isModulePattern = Boolean(template.modules);
        const templateSection = template.sections?.[index];
        const requested = isModulePattern
          ? template.questionsPerModule ?? section.questions.length
          : templateSection?.questions ?? section.questions.length;
        const toAttempt = section.toAttempt ?? requested;
        const marksEach = section.marksEach ?? template.marksPerFullQuestion ?? templateSection?.marksEach ?? 1;
        const questions = section.questions
          .map((question) => questionById.get(question.id))
          .filter((question): question is Question => Boolean(question));
        const title = section.label;
        return {
          id: section.code,
          name: title,
          title,
          description: `Answer ${Math.min(toAttempt, requested)} of ${requested} questions · ${marksEach} marks each`,
          questionType: 'any' as const,
          numQuestions: requested,
          marksPerQuestion: marksEach,
          compulsory: toAttempt >= requested,
          toAttempt,
          ...(isModulePattern ? { moduleNo: index + 1, unitFilter: String(index + 1) } : {}),
          questions,
          matched: questions.length,
          requested,
        };
      })
    : null;
  if (schemeDraft) {
    for (const check of schemeDraft.checks) {
      if (check.status !== 'pass') warnings.push(`${pack.code} ${check.status.toUpperCase()}: ${check.message}`);
    }
    schemeGeneratedSections?.forEach((section) => {
      if (section.matched < section.requested) {
        warnings.push(`${section.title}: ${section.matched} of ${section.requested} tagged bank questions matched the scheme template.`);
      }
    });
  }

  const generateSingleSetSections = async (setLabel?: string) => {
    const generatedSections: any[] = [];

    for (const sec of sections) {
      let pool = filtered.filter((q) =>
        matchesType(q, sec.questionType) &&
        matchesDifficulty(q, sec.difficulty) &&
        matchesDifficultyMix(q, sec.difficultyMix)
      );

      if (sec.topicFilter) pool = pool.filter((q) => (q.topic || q.chapter) === sec.topicFilter);
      if (sec.unitFilter) pool = pool.filter((q) => q.unit === sec.unitFilter);

      let questions = mode === 'ai' ? [] : pickWithDifficultyMix(pool, sec.numQuestions, sec.difficultyMix);

      // If AI mode or bank pool is short on questions, trigger AI generation on the fly
      if (mode === 'ai' || (questions.length < sec.numQuestions && mode === 'hybrid')) {
        const neededAI = mode === 'ai' ? sec.numQuestions : (sec.numQuestions - questions.length);
        try {
          const aiRes = await generateQuestionsWithAI({
            subject: config.subject,
            topic: sec.topicFilter || coverageTopicLabel || 'General Syllabus',
            questionType: sec.questionType === 'any' ? 'mcq' : sec.questionType,
            difficulty: sec.difficulty === 'mixed' || !sec.difficulty ? 'medium' : sec.difficulty,
            count: neededAI,
            marks: sec.marksPerQuestion,
            language: config.language || 'en',
          });

          if (aiRes.questions && aiRes.questions.length > 0) {
            // Save to question bank for future reuse
            await saveGeneratedQuestions({
              questions: aiRes.questions,
              collegeId,
              createdBy: userId,
              createdByName: userName,
              batch: config.batch,
              branch: config.branch,
            });

            const mappedAIQuestions: Question[] = aiRes.questions.map((q) => ({
              id: q.id,
              text: q.text,
              type: q.type,
              difficulty: q.difficulty,
              subject: q.subject,
              topic: q.topic || '',
              marks: q.marks,
              options: q.options?.map((o: any) => (typeof o === 'string' ? o : o.text)) || [],
              correctAnswer: q.correctAnswer,
              explanation: q.explanation,
              status: 'active',
              createdBy: userId,
              createdByName: userName,
              collegeId,
              tags: q.tags || [],
            } as unknown as Question));

            if (mode === 'ai') {
              questions = mappedAIQuestions.slice(0, sec.numQuestions);
            } else {
              questions = [...questions, ...mappedAIQuestions].slice(0, sec.numQuestions);
            }
          }
        } catch (aiErr: any) {
          warnings.push(`AI question generation warning: ${aiErr?.message || 'Failed to auto-generate questions'}`);
        }
      }

      if (questions.length < (sec.numQuestions || 0)) {
        const sectionLabel = (sec as any).title || (sec as any).name || 'Section';
        const typeNote = (sec as any).questionType && (sec as any).questionType !== 'any' ? ` ${(sec as any).questionType}` : '';
        warnings.push(
          mode === 'bank'
            ? `${sectionLabel}: only ${questions.length} of ${sec.numQuestions} requested${typeNote} questions matched "${config.subject || 'the selected subject'}" in the question bank — add more bank questions or switch to Hybrid mode.`
            : `${sectionLabel}: filled ${questions.length} of ${sec.numQuestions} requested questions.`
        );
      }

      generatedSections.push({
        ...sec,
        questions,
        matched: questions.length,
        requested: sec.numQuestions,
      });
    }

    return generatedSections;
  };

  const generatedSections = schemeGeneratedSections || await generateSingleSetSections();

  const totalMatched = generatedSections.reduce((sum, s) => sum + s.matched, 0);
  const totalSectionMarks = generatedSections.reduce((sum, s) => sum + (s.toAttempt ?? s.numQuestions) * s.marksPerQuestion, 0);
  if (totalSectionMarks !== config.totalMarks) {
    warnings.push(`Section totals (${totalSectionMarks}) do not match configured total marks (${config.totalMarks}).`);
  }

  const generatedQuestionIds = generatedSections.flatMap((s) => s.questions.map((q: any) => q.id));
  const mainPaper = await createPaper(
    collegeId,
    config,
    generatedQuestionIds,
    userId,
    userName,
    false,
    generatedSections
  );

  const numSets = Math.min(Math.max(config.numSets || 1, 1), 3);
  const sets: Paper[] = [mainPaper];

  if (numSets > 1) {
    const setLabels = ['A', 'B', 'C'];
    // Update mainPaper title with Set A
    await updatePaper(mainPaper.id, { title: `${config.title} - Set A` });
    mainPaper.title = `${config.title} - Set A`;

    for (let i = 1; i < numSets; i++) {
      const setLabel = setLabels[i];
      const setSections = await generateSingleSetSections(setLabel);
      const setQIds = setSections.flatMap((s) => s.questions.map((q: any) => q.id));
      const setPaper = await createPaper(
        collegeId,
        {
          ...config,
          title: `${config.title} - Set ${setLabel}`,
        },
        setQIds,
        userId,
        userName,
        false,
        setSections
      );
      sets.push(setPaper);
    }
  }

  // Best-effort linkage to question documents
  try {
    for (const qid of generatedQuestionIds) {
      await linkQuestionToPaper(qid, mainPaper.id);
    }
  } catch {}

  return {
    success: true,
    id: mainPaper.id,
    title: mainPaper.title,
    subject: config.subject,
    totalMarks: config.totalMarks,
    duration: config.duration,
    totalQuestions: totalMatched,
    sections: generatedSections,
    warnings,
    generatedAt: new Date().toISOString(),
    paper: mainPaper as any,
    sets,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Status Management
// ═══════════════════════════════════════════════════════════════════════

export async function publishPaper(paperId: string): Promise<Paper> {
  return updatePaper(paperId, { status: 'published' });
}

export async function archivePaper(paperId: string): Promise<Paper> {
  return updatePaper(paperId, { status: 'archived' });
}

export async function setPaperStatus(paperId: string, status: PaperStatus): Promise<Paper> {
  return updatePaper(paperId, { status });
}
