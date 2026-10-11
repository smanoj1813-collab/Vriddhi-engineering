// functions/src/codingJudgeQueue.ts
//
// The hand-off between "a student submitted a test" and "the sandbox has scored
// their code". Written inside the submission transaction (studentAssessments.ts)
// so an attempt can never exist whose code will never be run, and consumed by
// the trigger in codingJudge.ts.
//
// Collection: codingJudgeJobs/{testId}__{studentId}
//   Everything on the document is an identifier. The hidden test cases are NOT
//   copied here — the worker loads them from the question documents, so there is
//   exactly one place a test case lives and no chance of a stale duplicate being
//   scored after a faculty member edits the question.
//
// Rules: `codingJudgeJobs` is server-only (no client read or write), like the
// other internal queues in firestore.rules.

import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import admin from 'firebase-admin';

if (!getApps().length) initializeApp();

export const CODING_JUDGE_JOBS_COLLECTION = 'codingJudgeJobs';

export interface CodingJudgeJobInput {
  testId: string;
  studentId: string;
  collegeId: string;
  attemptId: string;
}

export type CodingJudgeJobStatus = 'queued' | 'running' | 'done' | 'failed';

/** One job per attempt. Deterministic, so a duplicated submit cannot double-run. */
export function codingJudgeJobId(testId: string, studentId: string): string {
  return `${testId}__${studentId}`;
}

/**
 * The document written at submission time. Field names are deliberately flat
 * and boring: this doc is read by the worker and by whoever is debugging a
 * stuck paper at 11pm.
 */
export function buildCodingJudgeJob(input: CodingJudgeJobInput): Record<string, unknown> {
  return {
    testId: input.testId,
    studentId: input.studentId,
    collegeId: input.collegeId,
    attemptId: input.attemptId,
    status: 'queued' satisfies CodingJudgeJobStatus,
    queuedAt: admin.firestore.FieldValue.serverTimestamp(),
    attempts: 0,
  };
}

/**
 * Re-arms a job whose worker died mid-run (no lease refresh for `staleMs`).
 * Not part of the submission path — that writes its job inside the submit
 * transaction — but the recovery lever if a worker is ever killed mid-run.
 */
export async function requeueStaleCodingJudge(jobId: string, staleMs = 10 * 60 * 1000): Promise<boolean> {
  const db = getFirestore(admin.app(), 'default');
  const ref = db.collection(CODING_JUDGE_JOBS_COLLECTION).doc(jobId);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || !data) return false;
  const startedAt = typeof data.startedAt?.toMillis === 'function' ? data.startedAt.toMillis() : 0;
  if (String(data.status) !== 'running' || Date.now() - startedAt < staleMs) return false;
  const input: CodingJudgeJobInput = {
    testId: String(data.testId || ''),
    studentId: String(data.studentId || ''),
    collegeId: String(data.collegeId || ''),
    attemptId: String(data.attemptId || ''),
  };
  if (!input.testId || !input.studentId || !input.attemptId) return false;
  // Delete then re-create: a newly created document is a new event, which is
  // what makes the create trigger fire again. An update would leave the job
  // looking queued with nobody listening for it.
  await ref.delete();
  await ref.set(buildCodingJudgeJob(input));
  return true;
}
