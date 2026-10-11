// functions/src/obeSurvey.ts
// Trusted write door for indirect-attainment surveys (Slice 5).
//
//   saveObeSurvey          — opens a round for a PUBLISHED mapping (the CO list
//                            is copied from it, so a respondent can never
//                            answer a CO the mapping does not define), or
//                            closes/reopens an existing one. Client writes to
//                            obeSurveys are denied by rules.
//   previewObeSurveyScores — folds the stored responses onto the 0–3 scale for
//                            the run dialog (and for a SAR table's prose).
//
// Students write their own obeSurveyResponses row directly; security rules pin
// the document id to {surveyId}__{uid} and the uid/college fields to the token.
// The pure validation and folding live in obeSurveyCore.ts.

import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();

import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { resolveSessionWriter } from './classSchedule'
import { validateObeMappingDoc } from './obe'
import {
  MAX_SURVEY_RESPONSES,
  buildSurveyCos,
  foldSurveyResponses,
  validateObeSurveyRequest,
} from './obeSurveyCore'

const REGION = { region: 'asia-south1' as const }

// ═════════════════════════════════════════════════════════════════════════════
// Callables
// ═════════════════════════════════════════════════════════════════════════════

function obeDb() {
  return getFirestore(admin.app(), 'default')
}

interface StoredSurvey {
  collegeId: string
  mappingId: string
  cos: Array<{ code: string }>
  scaleMax: number
  status: string
  audience?: string
}

/**
 * Opens a round for a published mapping, or closes/reopens an existing one.
 *
 * Deliberately NOT a create-only endpoint: closing a round is the same
 * operation with a different status, and keeping both behind one callable
 * keeps the "one open round per mapping + audience" invariant in one place.
 */
export const saveObeSurvey = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSessionWriter(uid, request.auth?.token || {})
  const raw = (request.data || {}) as Record<string, unknown>
  const db = obeDb()

  const surveyId = String(raw.surveyId ?? '').trim()

  // ── Close / reopen an existing round ──────────────────────────────────────
  if (surveyId) {
    const ref = db.collection('obeSurveys').doc(surveyId)
    const snap = await ref.get()
    if (!snap.exists) throw new HttpsError('not-found', 'Survey not found')
    const data = snap.data() || {}
    const collegeId = String(data.collegeId ?? '')
    if (staff.role !== 'superadmin' && collegeId !== staff.collegeId) {
      throw new HttpsError('permission-denied', 'This survey belongs to another college')
    }
    const status = String(raw.status ?? '').trim().toLowerCase()
    if (status !== 'open' && status !== 'closed') {
      throw new HttpsError('invalid-argument', 'status must be open or closed')
    }
    const now = admin.firestore.FieldValue.serverTimestamp()
    await ref.set(
      {
        status,
        updatedAt: now,
        updatedBy: staff.name || uid,
        ...(status === 'closed'
          ? { closedAt: now, closedBy: staff.name || uid }
          : { closedAt: admin.firestore.FieldValue.delete(), closedBy: admin.firestore.FieldValue.delete() }),
      },
      { merge: true },
    )
    return { id: surveyId, status, created: false }
  }

  // ── Open a new round from a published mapping ─────────────────────────────
  const mappingId = String(raw.mappingId ?? '').trim()
  if (!mappingId) throw new HttpsError('invalid-argument', 'mappingId is required')
  const mappingSnap = await db.collection('obeMappings').doc(mappingId).get()
  if (!mappingSnap.exists) throw new HttpsError('not-found', 'Mapping not found')
  const mappingData = mappingSnap.data() || {}
  const collegeId = String(mappingData.collegeId ?? '')
  if (staff.role !== 'superadmin' && collegeId !== staff.collegeId) {
    throw new HttpsError('permission-denied', 'This mapping belongs to another college')
  }
  if (mappingData.status !== 'published') {
    throw new HttpsError(
      'failed-precondition',
      'Publish the mapping before surveying it — the CO list is copied from the published version',
    )
  }
  // Re-validate the stored mapping, exactly like computeObeAttainment does:
  // the COs a respondent rates come from the same validated document the run
  // will later be computed against.
  const mapping = validateObeMappingDoc(mappingData)
  const cos = buildSurveyCos(mapping.cos)
  const validated = validateObeSurveyRequest(raw)

  // One open round per mapping + audience. A single equality filter keeps this
  // off the composite-index treadmill (`obeSurveys` is read by mappingId and
  // collegeId only), and the audience/status test happens here.
  const siblings = await db.collection('obeSurveys').where('mappingId', '==', mappingId).get()
  const alreadyOpen = siblings.docs.find((doc) => {
    const data = doc.data() || {}
    return String(data.audience ?? '') === validated.audience && String(data.status ?? '') === 'open'
  })
  if (alreadyOpen) {
    throw new HttpsError(
      'already-exists',
      'An open round already exists for this mapping and audience — close it before opening another',
    )
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const ref = db.collection('obeSurveys').doc()
  await ref.set({
    id: ref.id,
    collegeId,
    mappingId,
    courseCode: String(mapping.courseCode ?? ''),
    ...(mapping.courseTitle ? { courseTitle: mapping.courseTitle } : {}),
    ...(mapping.programId ? { programId: mapping.programId } : {}),
    ...(mapping.branch ? { branch: mapping.branch } : {}),
    academicYear: String(mapping.academicYear ?? ''),
    ...(mapping.term ? { term: mapping.term } : {}),
    audience: validated.audience,
    scaleMax: validated.scaleMax,
    ...(validated.prompt ? { prompt: validated.prompt } : {}),
    cos,
    status: 'open',
    createdAt: now,
    createdBy: staff.name || uid,
    updatedAt: now,
    updatedBy: staff.name || uid,
  })
  return { id: ref.id, status: 'open', created: true }
})

/** Folds a round's stored responses — the numbers a run can be computed from. */
export const previewObeSurveyScores = onCall(REGION, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
  const staff = await resolveSessionWriter(uid, request.auth?.token || {})
  const surveyId = String((request.data || {}).surveyId ?? '').trim()
  if (!surveyId) throw new HttpsError('invalid-argument', 'surveyId is required')

  const db = obeDb()
  const surveySnap = await db.collection('obeSurveys').doc(surveyId).get()
  if (!surveySnap.exists) throw new HttpsError('not-found', 'Survey not found')
  const survey = surveySnap.data() as StoredSurvey
  if (staff.role !== 'superadmin' && String(survey.collegeId ?? '') !== staff.collegeId) {
    throw new HttpsError('permission-denied', 'This survey belongs to another college')
  }
  const cos = Array.isArray(survey.cos) ? survey.cos.map((co) => String(co?.code ?? '')) : []
  const scaleMax = Number(survey.scaleMax) || 5

  const responseSnaps = await db
    .collection('obeSurveyResponses')
    .where('surveyId', '==', surveyId)
    .limit(MAX_SURVEY_RESPONSES + 1)
    .get()
  const truncated = responseSnaps.size > MAX_SURVEY_RESPONSES
  const fold = foldSurveyResponses({
    responses: responseSnaps.docs.slice(0, MAX_SURVEY_RESPONSES).map((doc) => {
      const data = doc.data() || {}
      return { uid: String(data.uid ?? ''), scores: data.scores as Record<string, unknown> }
    }),
    coCodes: cos,
    scaleMax,
  })

  return {
    surveyId,
    audience: String(survey.audience ?? ''),
    status: String(survey.status ?? ''),
    scaleMax,
    truncated,
    ...fold,
  }
})
