// src/modules/admin/api/obeSurveyApi.ts
// Staff side of the indirect-assessment survey slice. Rounds are read straight
// from Firestore (college-scoped, staff-readable) and written only through the
// `saveObeSurvey` callable; the folded numbers come from
// `previewObeSurveyScores`, so the aggregate a run is computed from is the same
// one the SAR view shows — never a browser-side average.

import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/Firebase/config';
import type {
  ObeSurveyAggregate,
  ObeSurveyAudience,
  ObeSurveyDoc,
  ObeSurveyStatus,
} from '@/shared/types/obeSurvey';

function currentCollegeId(): string {
  const id = localStorage.getItem('vriddhi_college_id');
  if (!id) throw new Error('No college is linked to this account');
  return id;
}

function normalizeSurvey(id: string, data: Record<string, unknown>): ObeSurveyDoc {
  return { ...data, id } as ObeSurveyDoc;
}

/**
 * Rounds of one mapping, newest first.
 *
 * Single equality filter on purpose: a second field would want a composite
 * index, and indexes ship in a separate deploy step (the reason OBE broke in
 * production once already). Sorting happens here.
 */
export async function fetchObeSurveysForMapping(mappingId: string): Promise<ObeSurveyDoc[]> {
  const snap = await getDocs(query(collection(db, 'obeSurveys'), where('mappingId', '==', mappingId)));
  const surveys = snap.docs.map((d) => normalizeSurvey(d.id, d.data()));
  return surveys.sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt));
}

function millisOf(value: unknown): number {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

/** One round by id (the run dialog needs the CO list it was opened with). */
export async function fetchObeSurvey(surveyId: string): Promise<ObeSurveyDoc> {
  const snap = await getDoc(doc(db, 'obeSurveys', surveyId));
  if (!snap.exists()) throw new Error('Survey not found');
  return normalizeSurvey(snap.id, snap.data());
}

export interface OpenObeSurveyPayload {
  mappingId: string;
  audience: ObeSurveyAudience;
  scaleMax?: number;
  prompt?: string;
}

/** Opens a round for a published mapping. The server copies the CO list. */
export async function openObeSurvey(
  payload: OpenObeSurveyPayload,
): Promise<{ id: string; status: ObeSurveyStatus; created: boolean }> {
  const callable = httpsCallable<Record<string, unknown>, { id: string; status: ObeSurveyStatus; created: boolean }>(
    functions,
    'saveObeSurvey',
  );
  const result = await callable({ ...payload });
  return result.data;
}

/** Closes (or reopens) a round — the same callable, one field different. */
export async function setObeSurveyStatus(
  surveyId: string,
  status: ObeSurveyStatus,
): Promise<{ id: string; status: ObeSurveyStatus }> {
  const callable = httpsCallable<Record<string, unknown>, { id: string; status: ObeSurveyStatus }>(
    functions,
    'saveObeSurvey',
  );
  const result = await callable({ surveyId, status });
  return result.data;
}

/** Folds the stored answers: per-CO means, coverage, and the rows a run uses. */
export async function fetchObeSurveyAggregate(surveyId: string): Promise<ObeSurveyAggregate> {
  const callable = httpsCallable<{ surveyId: string }, ObeSurveyAggregate>(functions, 'previewObeSurveyScores');
  const result = await callable({ surveyId });
  return result.data;
}

/** The staff-facing list query for a college (used by any college-wide view). */
export async function fetchObeSurveysForCollege(collegeId?: string): Promise<ObeSurveyDoc[]> {
  const cid = collegeId || currentCollegeId();
  const snap = await getDocs(query(collection(db, 'obeSurveys'), where('collegeId', '==', cid), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => normalizeSurvey(d.id, d.data()));
}
