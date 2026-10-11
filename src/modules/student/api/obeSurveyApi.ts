// src/modules/student/api/obeSurveyApi.ts
// Student side of the indirect-assessment survey slice: the course-exit and
// program-exit rounds a learner can see, their own answers, and the one write
// they are allowed to make.
//
// The rules pin that write to `obeSurveyResponses/{surveyId}__{uid}` and to an
// OPEN round, so this module only has to be honest about the payload — it can
// never widen its own access.

import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '@/Firebase/config';
import { surveysForStudent } from '@/shared/utils/obeSurvey';
import type { ObeSurveyDoc, ObeSurveyResponseDoc } from '@/shared/types/obeSurvey';

function normalizeSurvey(id: string, data: Record<string, unknown>): ObeSurveyDoc {
  return { ...data, id } as ObeSurveyDoc;
}

/**
 * Open rounds this student may answer.
 *
 * One equality filter (collegeId) + client-side filtering, because a second
 * filter would want a composite index — the read rule is college-scoped and
 * carries no status condition, so the whole (small) set is readable and
 * `surveysForStudent` decides what is answerable.
 */
export async function fetchStudentSurveys(
  collegeId: string,
  profile: { program?: unknown; branch?: unknown } | null | undefined,
): Promise<ObeSurveyDoc[]> {
  const snap = await getDocs(query(collection(db, 'obeSurveys'), where('collegeId', '==', collegeId)));
  const surveys = snap.docs.map((d) => normalizeSurvey(d.id, d.data()));
  // The student profile document spells programme/branch in more than one way
  // across imports, so accept `unknown` and coerce here rather than making
  // every caller cast. A blank value keeps a tagged round visible instead of
  // hiding it, which is the safe direction: hiding is what loses evidence.
  const identity = {
    program: typeof profile?.program === 'string' ? profile.program : undefined,
    branch: typeof profile?.branch === 'string' ? profile.branch : undefined,
  };
  return surveysForStudent(surveys, identity, 'open');
}

/** Every round this student has already answered (own rows only, per rules). */
export async function fetchMySurveyResponses(uid: string): Promise<ObeSurveyResponseDoc[]> {
  const snap = await getDocs(query(collection(db, 'obeSurveyResponses'), where('uid', '==', uid)));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as ObeSurveyResponseDoc);
}

export interface SubmitSurveyPayload {
  surveyId: string;
  collegeId: string;
  uid: string;
  name?: string;
  scores: Record<string, number>;
  scaleMax: number;
}

/**
 * Files the caller's answers under the id the rules expect. The rules reject
 * anything else — a different uid, a different college, an empty answer set, or
 * a round that is closed or does not exist.
 */
export async function submitSurveyResponse(payload: SubmitSurveyPayload): Promise<void> {
  const id = `${payload.surveyId}__${payload.uid}`;
  const now = Date.now();
  await setDoc(doc(db, 'obeSurveyResponses', id), {
    id,
    surveyId: payload.surveyId,
    collegeId: payload.collegeId,
    uid: payload.uid,
    ...(payload.name ? { name: payload.name } : {}),
    role: 'student',
    scores: payload.scores,
    scaleMax: payload.scaleMax,
    submittedAtMs: now,
    updatedAtMs: now,
  });
}
