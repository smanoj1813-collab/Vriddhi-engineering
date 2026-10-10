// src/modules/admin/api/obeApi.ts
// OBE attainment client API (Slice 2): reads mappings + runs straight from
// Firestore (college-scoped, staff-only), wraps the three callables that guard
// the write path. Same single-door pattern as schemePackApi: the browser can
// never write a mapping or a run directly — rules deny it, callables own it.

import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/Firebase/config';
import type {
  ObeCourseOutcome,
  ObeMappingDoc,
  ObeMappingMatrix,
  ObeRunDoc,
} from '@/shared/types/obe';

function currentCollegeId(): string {
  const id = localStorage.getItem('vriddhi_college_id');
  if (!id) throw new Error('No college is linked to this account');
  return id;
}

function normalizeMapping(id: string, data: Record<string, unknown>): ObeMappingDoc {
  return { ...data, id } as ObeMappingDoc;
}

function normalizeRun(id: string, data: Record<string, unknown>): ObeRunDoc {
  return { ...data, id } as ObeRunDoc;
}

/**
 * Turns a Firestore list failure into the actual fix. "Check your connection"
 * sent the principal chasing wifi when the real cause was a missing composite
 * index (failed-precondition) — the two production causes get their remedy.
 */
export function describeObeListError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  if (code === 'failed-precondition') {
    return 'The database index for this list is missing — an admin must run "npm run deploy:indexes", then try again in a few minutes.';
  }
  if (code === 'permission-denied') {
    return 'This sign-in lacks the staff role or college link for the data — sign out and back in, or ask a superadmin to repair the identity.';
  }
  return 'Check your connection, then try again.';
}

/** All mappings of the college, most recently updated first. */
export async function fetchObeMappings(collegeId?: string): Promise<ObeMappingDoc[]> {
  const cid = collegeId || currentCollegeId();
  const snap = await getDocs(
    query(collection(db, 'obeMappings'), where('collegeId', '==', cid), orderBy('updatedAt', 'desc')),
  );
  return snap.docs.map((d) => normalizeMapping(d.id, d.data()));
}

/** One mapping by id (throws when missing — the editor treats that as 404). */
export async function fetchObeMapping(mappingId: string): Promise<ObeMappingDoc> {
  const snap = await getDoc(doc(db, 'obeMappings', mappingId));
  if (!snap.exists()) throw new Error('Mapping not found');
  return normalizeMapping(snap.id, snap.data());
}

/** Computed runs for a mapping, newest first. Runs are immutable evidence. */
export async function fetchObeRuns(mappingId: string): Promise<ObeRunDoc[]> {
  const snap = await getDocs(
    query(collection(db, 'obeRuns'), where('mappingId', '==', mappingId), orderBy('createdAt', 'desc')),
  );
  return snap.docs.map((d) => normalizeRun(d.id, d.data()));
}

export interface SaveObeMappingPayload {
  framework: string;
  courseCode: string;
  courseTitle?: string;
  academicYear: string;
  term?: string;
  programId?: string;
  branch?: string;
  facultyId?: string;
  credits?: number;
  cos: ObeCourseOutcome[];
  mapping: ObeMappingMatrix;
  targets?: Record<string, number>;
  coTargets?: Record<string, number>;
}

/** Creates or updates a DRAFT mapping. Published mappings reject edits. */
export async function saveObeMapping(payload: SaveObeMappingPayload): Promise<{ id: string; status: string; updated: boolean }> {
  const callable = httpsCallable<Record<string, unknown>, { id: string; status: string; updated: boolean }>(
    functions,
    'saveObeMapping',
  );
  const result = await callable({ mapping: payload });
  return result.data;
}

/** Locks a draft into published evidence (freezes the college pack rules). */
export async function publishObeMapping(mappingId: string): Promise<{ id: string; status: string }> {
  const callable = httpsCallable<Record<string, unknown>, { id: string; status: string }>(
    functions,
    'publishObeMapping',
  );
  const result = await callable({ mappingId });
  return result.data;
}

export interface ComputeObeAttainmentPayload {
  mappingId: string;
  label?: string;
  tools?: string[];
  studentScores: { studentId: string; coScores: Record<string, { obtained: number; max: number }> }[];
  surveys?: { co: string; score: number; maxScore: number }[];
}

/** Retires a draft (published evidence is never archived). */
export async function archiveObeMapping(mappingId: string): Promise<{ id: string; status: string }> {
  const callable = httpsCallable<Record<string, unknown>, { id: string; status: string }>(
    functions,
    'archiveObeMapping',
  );
  const result = await callable({ mappingId });
  return result.data;
}

/** Runs the trusted 80/20 compute and stores an immutable run. */
export async function computeObeAttainment(payload: ComputeObeAttainmentPayload): Promise<{
  runId: string;
  studentCount: number;
  coResults: ObeRunDoc['coResults'];
  outcomes: Record<string, number>;
  gaps: ObeRunDoc['gaps'];
}> {
  const callable = httpsCallable<
    Record<string, unknown>,
    {
      runId: string;
      studentCount: number;
      coResults: ObeRunDoc['coResults'];
      outcomes: Record<string, number>;
      gaps: ObeRunDoc['gaps'];
    }
  >(functions, 'computeObeAttainment');
  const result = await callable({ ...(payload as unknown as Record<string, unknown>) });
  return result.data;
}

/** One graded test folded into a run preview (mirrors the server fold). */
export interface ObeTestImportPreview {
  studentScores: { studentId: string; coScores: Record<string, { obtained: number; max: number }> }[];
  tools: string[];
  tests: {
    testId: string;
    title: string;
    questions: number;
    taggedQuestions: number;
    attempts: number;
    attemptsUsed: number;
  }[];
  skipped: { testId: string; questionId: string; reason: string }[];
  skippedTruncated: boolean;
  students: number;
  attemptsTruncated: boolean;
}

/**
 * Folds graded attempts from the given tests into per-student CO scores.
 * Read-only preview — feed `studentScores` + `tools` into computeObeAttainment
 * to mint the run. CO tags resolve from bank `learningOutcomes` lines.
 */
export async function previewObeScoresFromTests(
  mappingId: string,
  testIds: string[],
): Promise<ObeTestImportPreview> {
  const callable = httpsCallable<{ mappingId: string; testIds: string[] }, ObeTestImportPreview>(
    functions,
    'previewObeScoresFromTests',
  );
  const result = await callable({ mappingId, testIds });
  return result.data;
}

/** A scheduled test that can feed an attainment run (course match is client-side). */
export interface ObeCandidateTest {
  id: string;
  title: string;
  subject: string;
  subjectName: string;
  program: string;
  branch: string;
  createdAtMs: number;
}

/** All scheduled tests of the college, newest first (no composite index needed). */
export async function fetchObeCandidateTests(collegeId?: string): Promise<ObeCandidateTest[]> {
  const cid = collegeId || currentCollegeId();
  const snap = await getDocs(query(collection(db, 'scheduledTests'), where('collegeId', '==', cid)));
  const tests = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
    return {
      id: d.id,
      title: String(data.title ?? ''),
      subject: String(data.subject ?? ''),
      subjectName: String(data.subjectName ?? ''),
      program: String(data.program ?? ''),
      branch: String(data.branch ?? ''),
      createdAtMs: typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : 0,
    };
  });
  tests.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return tests;
}
