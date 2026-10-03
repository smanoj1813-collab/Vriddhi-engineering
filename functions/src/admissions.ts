import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/admissions.ts
// ------------------------------------------------------------------
// Admission Center — the funnel that exists before a student record does.
//
// WHY THIS MODULE EXISTS
// A student only ever came into being through `bulkCreateStudentAccounts`
// (CSV upload) or `provisionUser`. Everything before that — the walk-in
// enquiry, the application, the entrance score, the offer, the fee — lived in
// a register on someone's desk. There was no applicant, enquiry or admission
// concept anywhere in the codebase.
//
// This closes the front of the funnel and hands off to the existing, proven
// provisioning path by exporting the admitted applicants as the
// `STUDENT_TEMPLATE` CSV the college already uploads. It deliberately does not
// create student documents or auth accounts itself: one path into `students`
// is safer than two.
//
// Staff-entered only. There is no public applicant surface, so no unauthenticated
// write path and no new auth role.
// ------------------------------------------------------------------

import * as admin from 'firebase-admin'
import * as crypto from 'crypto'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

// ─── Stages ─────────────────────────────────────────────────────────────────

export const ADMISSION_STAGES = [
  'enquiry',
  'application',
  'screening',
  'offer',
  'fee',
  'enrolled',
] as const

export type AdmissionStage = (typeof ADMISSION_STAGES)[number]

/** Terminal outcomes. Not part of the forward pipeline. */
export const ADMISSION_OUTCOMES = ['rejected', 'withdrawn'] as const
export type AdmissionOutcome = (typeof ADMISSION_OUTCOMES)[number]

export type AdmissionStatus = AdmissionStage | AdmissionOutcome

/**
 * Legal moves. Enforced server-side so the funnel cannot be skipped — an
 * applicant must not be able to reach `enrolled` without an offer and a fee,
 * because that is what the CSV export trusts.
 */
const TRANSITIONS: Record<AdmissionStatus, AdmissionStatus[]> = {
  enquiry: ['application', 'rejected', 'withdrawn'],
  application: ['screening', 'rejected', 'withdrawn'],
  screening: ['offer', 'rejected', 'withdrawn'],
  offer: ['fee', 'rejected', 'withdrawn'],
  fee: ['enrolled', 'withdrawn'],
  enrolled: [],
  // Re-opening is deliberate: a rejected applicant who reapplies next cycle is
  // a real case, and deleting the record would lose the audit trail.
  rejected: ['application'],
  withdrawn: ['enquiry'],
}

export function canTransition(from: AdmissionStatus, to: AdmissionStatus): boolean {
  return (TRANSITIONS[from] || []).includes(to)
}

export function allowedTransitions(from: AdmissionStatus): AdmissionStatus[] {
  return TRANSITIONS[from] || []
}

// ─── Merit ──────────────────────────────────────────────────────────────────

export interface MeritWeights {
  qualifying: number
  entrance: number
  interview: number
}

/**
 * Default weighting, applied only until the college sets its own in
 * `colleges/{id}/config/admission`. This is policy, not student data: it is
 * shown in the UI and editable, and no applicant's merit is derived from a
 * weight they cannot see.
 */
export const DEFAULT_MERIT_WEIGHTS: MeritWeights = {
  qualifying: 50,
  entrance: 40,
  interview: 10,
}

export interface MeritInput {
  /** Qualifying exam percentage, 0–100. */
  qualifyingPercentage: number | null
  /** Entrance score and its maximum, so different exams stay comparable. */
  entranceScore: number | null
  entranceMaxScore: number | null
  /** Interview rating, 0–10. */
  interviewRating: number | null
}

export interface MeritResult {
  /** 0–100, or null when nothing has been recorded yet. */
  score: number | null
  /** Which components actually contributed. */
  components: Array<{ key: string; label: string; normalized: number; weight: number }>
  /** Components the weights ask for but that were never recorded. */
  missing: string[]
}

/**
 * Weighted merit over the components that were actually recorded.
 *
 * A component that was never recorded is EXCLUDED and the remaining weights
 * are re-normalised. Treating a missing entrance exam as zero would silently
 * rank an applicant last for paperwork nobody filed, and that number would
 * then drive the offer — so absence is reported, never scored.
 */
export function computeMeritScore(input: MeritInput, weights: MeritWeights): MeritResult {
  const candidates: Array<{ key: string; label: string; normalized: number | null; weight: number }> = [
    {
      key: 'qualifying',
      label: 'Qualifying exam',
      normalized:
        input.qualifyingPercentage !== null && input.qualifyingPercentage >= 0
          ? Math.min(100, input.qualifyingPercentage)
          : null,
      weight: weights.qualifying,
    },
    {
      key: 'entrance',
      label: 'Entrance exam',
      normalized:
        input.entranceScore !== null &&
        input.entranceMaxScore !== null &&
        input.entranceMaxScore > 0 &&
        input.entranceScore >= 0
          ? Math.min(100, (input.entranceScore / input.entranceMaxScore) * 100)
          : null,
      weight: weights.entrance,
    },
    {
      key: 'interview',
      label: 'Interview',
      normalized:
        input.interviewRating !== null && input.interviewRating >= 0
          ? Math.min(100, input.interviewRating * 10)
          : null,
      weight: weights.interview,
    },
  ]

  const present = candidates.filter((c) => c.normalized !== null && c.weight > 0)
  const missing = candidates
    .filter((c) => c.normalized === null && c.weight > 0)
    .map((c) => c.label)

  if (present.length === 0) return { score: null, components: [], missing }

  const totalWeight = present.reduce((sum, c) => sum + c.weight, 0)
  if (totalWeight <= 0) return { score: null, components: [], missing }

  const score = present.reduce((sum, c) => sum + (c.normalized as number) * c.weight, 0) / totalWeight

  return {
    score: Math.round(score * 100) / 100,
    components: present.map((c) => ({
      key: c.key,
      label: c.label,
      normalized: Math.round((c.normalized as number) * 100) / 100,
      weight: Math.round((c.weight / totalWeight) * 1000) / 10,
    })),
    missing,
  }
}

// ─── CSV hand-off ───────────────────────────────────────────────────────────

/**
 * Column order of `STUDENT_TEMPLATE` in
 * src/modules/admin/services/onboardingService.ts. Kept in step with it so the
 * exported file drops straight into the existing bulk upload.
 */
export const STUDENT_CSV_COLUMNS = [
  'regNo',
  'name',
  'email',
  'phone',
  'dateOfBirth',
  'gender',
  'bloodGroup',
  'course',
  'department',
  'batch',
  'semester',
  'division',
  'mentorId',
] as const

export interface ApplicantLike {
  applicationNo?: string
  applicantName?: string
  email?: string
  phone?: string
  dateOfBirth?: string
  gender?: string
  bloodGroup?: string
  program?: string
  department?: string
  batch?: string
  division?: string
  mentorId?: string
  regNo?: string
}

export interface StudentCsvRowResult {
  row: Record<(typeof STUDENT_CSV_COLUMNS)[number], string> | null
  /** Why the row could not be produced. Empty when it could. */
  blocked: string[]
}

/**
 * Maps one admitted applicant onto the student CSV columns.
 *
 * Returns the blocking reasons instead of a row with invented values: a
 * missing registration number or division is the admissions office's decision,
 * and guessing one would create a student record that has to be found and
 * fixed later.
 */
export function toStudentCsvRow(applicant: ApplicantLike): StudentCsvRowResult {
  const blocked: string[] = []
  const label = applicant.applicationNo || applicant.applicantName || 'applicant'

  if (!applicant.regNo || !applicant.regNo.trim()) blocked.push(`${label}: no registration number assigned`)
  if (!applicant.applicantName || !applicant.applicantName.trim()) blocked.push(`${label}: no applicant name`)
  if (!applicant.email || !applicant.email.trim()) blocked.push(`${label}: no email`)
  if (!applicant.phone || !applicant.phone.trim()) blocked.push(`${label}: no phone`)
  if (!applicant.program || !applicant.program.trim()) blocked.push(`${label}: no program selected`)
  if (!applicant.batch || !applicant.batch.trim()) blocked.push(`${label}: no batch selected`)
  if (!applicant.division || !applicant.division.trim()) blocked.push(`${label}: no division assigned`)

  if (blocked.length > 0) return { row: null, blocked }

  return {
    row: {
      regNo: applicant.regNo!.trim(),
      name: applicant.applicantName!.trim(),
      email: applicant.email!.trim(),
      phone: applicant.phone!.trim(),
      dateOfBirth: applicant.dateOfBirth || '',
      gender: (applicant.gender || '').toLowerCase(),
      bloodGroup: applicant.bloodGroup || '',
      course: applicant.program!.trim(),
      department: applicant.department || '',
      batch: applicant.batch!.trim(),
      // A fresh admission always starts in semester 1.
      semester: '1',
      division: applicant.division!.trim(),
      mentorId: applicant.mentorId || '',
    },
    blocked: [],
  }
}

/** RFC 4180 escaping — values here routinely contain commas and quotes. */
export function toCsv(rows: Array<Record<string, string>>): string {
  const escape = (value: string) => {
    const text = String(value ?? '')
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const header = STUDENT_CSV_COLUMNS.join(',')
  const body = rows.map((row) => STUDENT_CSV_COLUMNS.map((column) => escape(row[column] ?? '')).join(','))
  return [header, ...body].join('\n')
}

// ─── Identity ───────────────────────────────────────────────────────────────

interface AdmissionStaff {
  uid: string
  role: string
  collegeId: string
  name: string
}

const STAFF_ROLES = ['superadmin', 'admin', 'principal', 'hod']

async function resolveStaff(uid: string, token: Record<string, unknown>): Promise<AdmissionStaff> {
  const userDoc = await getFirestore(admin.app(), 'default').collection('users').doc(uid).get()
  const user = userDoc.data()
  const role = String(token.role || user?.role || '')
  const collegeId = String(token.collegeId || user?.collegeId || '')
  if (!userDoc.exists || !STAFF_ROLES.includes(role) || (role !== 'superadmin' && !collegeId)) {
    throw new HttpsError('permission-denied', 'College administration access is required')
  }
  return { uid, role, collegeId, name: String(user?.name || '') }
}

async function resolveCollegeId(staff: AdmissionStaff, requested: unknown): Promise<string> {
  const collegeId = staff.role === 'superadmin' ? String(requested || '') : staff.collegeId
  if (!collegeId) throw new HttpsError('invalid-argument', 'collegeId is required')
  return collegeId
}

function iso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const converted = (value as { toDate: () => Date }).toDate()
    if (converted instanceof Date) return converted.toISOString()
  }
  if (typeof value === 'string') return value
  return null
}

function text(value: unknown, max = 200): string {
  return String(value ?? '').trim().slice(0, max)
}

function optionalNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.min(max, Math.max(min, parsed))
}

export async function loadWeights(collegeId: string): Promise<MeritWeights> {
  const doc = await getFirestore(admin.app(), 'default').collection('colleges').doc(collegeId).collection('config').doc('admission').get()
  const data = doc.data()
  if (!data) return { ...DEFAULT_MERIT_WEIGHTS }
  const weights = {
    qualifying: optionalNumber(data.qualifyingWeight, 0, 100) ?? DEFAULT_MERIT_WEIGHTS.qualifying,
    entrance: optionalNumber(data.entranceWeight, 0, 100) ?? DEFAULT_MERIT_WEIGHTS.entrance,
    interview: optionalNumber(data.interviewWeight, 0, 100) ?? DEFAULT_MERIT_WEIGHTS.interview,
  }
  if (weights.qualifying + weights.entrance + weights.interview <= 0) return { ...DEFAULT_MERIT_WEIGHTS }
  return weights
}

const STATUSES: string[] = [...ADMISSION_STAGES, ...ADMISSION_OUTCOMES]

// ─── Serialisation ──────────────────────────────────────────────────────────

function serialize(id: string, data: admin.firestore.DocumentData) {
  const meritInput: MeritInput = {
    qualifyingPercentage: optionalNumber(data.qualifyingPercentage, 0, 100),
    entranceScore: optionalNumber(data.entranceScore, 0, 100000),
    entranceMaxScore: optionalNumber(data.entranceMaxScore, 0, 100000),
    interviewRating: optionalNumber(data.interviewRating, 0, 10),
  }
  const weights = (data.meritWeights && typeof data.meritWeights === 'object'
    ? data.meritWeights
    : DEFAULT_MERIT_WEIGHTS) as MeritWeights

  return {
    id,
    applicationNo: String(data.applicationNo || ''),
    status: STATUSES.includes(String(data.status)) ? (String(data.status) as AdmissionStatus) : 'enquiry',
    applicantName: String(data.applicantName || ''),
    email: String(data.email || ''),
    phone: String(data.phone || ''),
    dateOfBirth: String(data.dateOfBirth || ''),
    gender: String(data.gender || ''),
    bloodGroup: String(data.bloodGroup || ''),
    guardianName: String(data.guardianName || ''),
    guardianPhone: String(data.guardianPhone || ''),
    city: String(data.city || ''),
    program: String(data.program || ''),
    department: String(data.department || ''),
    batch: String(data.batch || ''),
    division: String(data.division || ''),
    regNo: String(data.regNo || ''),
    mentorId: String(data.mentorId || ''),
    previousSchool: String(data.previousSchool || ''),
    previousQualification: String(data.previousQualification || ''),
    yearOfPassing: String(data.yearOfPassing || ''),
    source: String(data.source || ''),
    assignedTo: String(data.assignedTo || ''),
    assignedToName: String(data.assignedToName || ''),
    entranceExamType: String(data.entranceExamType || ''),
    entranceRegistrationNo: String(data.entranceRegistrationNo || ''),
    interviewNotes: String(data.interviewNotes || ''),
    merit: computeMeritScore(meritInput, weights),
    meritWeights: weights,
    feeAmount: optionalNumber(data.feeAmount, 0, 10000000) ?? 0,
    feePaid: optionalNumber(data.feePaid, 0, 10000000) ?? 0,
    offerIssuedAt: iso(data.offerIssuedAt),
    enrolledStudentId: String(data.enrolledStudentId || ''),
    notes: Array.isArray(data.notes)
      ? data.notes.slice(0, 50).map((note) => {
          const entry = (note || {}) as Record<string, unknown>
          return { at: iso(entry.at), by: String(entry.by || ''), text: String(entry.text || '') }
        })
      : [],
    stageHistory: Array.isArray(data.stageHistory)
      ? data.stageHistory.slice(0, 50).map((entry) => {
          const stage = (entry || {}) as Record<string, unknown>
          return { stage: String(stage.stage || ''), at: iso(stage.at), by: String(stage.by || '') }
        })
      : [],
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
    createdByName: String(data.createdByName || ''),
  }
}

export type SerializedApplication = ReturnType<typeof serialize>

// ─── Callables ──────────────────────────────────────────────────────────────

export async function nextApplicationNo(db: admin.firestore.Firestore, collegeId: string, year: number): Promise<string> {
  const snap = await db
    .collection('admissionApplications')
    .where('collegeId', '==', collegeId)
    .where('cycleYear', '==', year)
    .limit(1000)
    .get()
  const used = snap.docs
    .map((doc) => Number(String(doc.data().applicationNo || '').split('-').pop()))
    .filter((value) => Number.isFinite(value))
  const next = (used.length > 0 ? Math.max(...used) : 0) + 1
  return `ADM-${year}-${String(next).padStart(4, '0')}`
}

export const saveAdmissionApplication = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 30 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const input = (request.data || {}) as Record<string, unknown>
    const db = getFirestore(admin.app(), 'default')
    const collegeId = await resolveCollegeId(staff, input.collegeId)

    const applicantName = text(input.applicantName)
    if (!applicantName) throw new HttpsError('invalid-argument', 'Applicant name is required')

    const payload: admin.firestore.DocumentData = {
      applicantName,
      email: text(input.email, 160).toLowerCase(),
      phone: text(input.phone, 32),
      dateOfBirth: text(input.dateOfBirth, 32),
      gender: text(input.gender, 32),
      bloodGroup: text(input.bloodGroup, 16),
      guardianName: text(input.guardianName),
      guardianPhone: text(input.guardianPhone, 32),
      city: text(input.city),
      program: text(input.program, 80),
      department: text(input.department, 80),
      batch: text(input.batch, 32),
      division: text(input.division, 32),
      regNo: text(input.regNo, 64),
      mentorId: text(input.mentorId, 64),
      previousSchool: text(input.previousSchool),
      previousQualification: text(input.previousQualification, 120),
      yearOfPassing: text(input.yearOfPassing, 16),
      source: text(input.source, 60),
      assignedTo: text(input.assignedTo, 64),
      assignedToName: text(input.assignedToName),
      entranceExamType: text(input.entranceExamType, 60),
      entranceRegistrationNo: text(input.entranceRegistrationNo, 64),
      interviewNotes: text(input.interviewNotes, 2000),
      qualifyingPercentage: optionalNumber(input.qualifyingPercentage, 0, 100),
      entranceScore: optionalNumber(input.entranceScore, 0, 100000),
      entranceMaxScore: optionalNumber(input.entranceMaxScore, 0, 100000),
      interviewRating: optionalNumber(input.interviewRating, 0, 10),
      feeAmount: optionalNumber(input.feeAmount, 0, 10000000),
      feePaid: optionalNumber(input.feePaid, 0, 10000000),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    const applicationId = text(input.applicationId, 200)
    if (applicationId && !applicationId.includes('/')) {
      const ref = db.collection('admissionApplications').doc(applicationId)
      const existing = await ref.get()
      if (!existing.exists) throw new HttpsError('not-found', 'Application not found')
      if (staff.role !== 'superadmin' && existing.data()?.collegeId !== collegeId) {
        throw new HttpsError('permission-denied', 'This application belongs to another college')
      }
      await ref.update(payload)

      const note = text(input.note, 1000)
      if (note) {
        await ref.update({
          notes: admin.firestore.FieldValue.arrayUnion({
            at: admin.firestore.FieldValue.serverTimestamp(),
            by: staff.name,
            text: note,
          }),
        })
      }
      const updated = await ref.get()
      return { application: serialize(ref.id, updated.data() as admin.firestore.DocumentData) }
    }

    const cycleYear = new Date().getFullYear()
    const applicationNo = await nextApplicationNo(db, collegeId, cycleYear)
    const weights = await loadWeights(collegeId)
    const ref = db.collection('admissionApplications').doc()
    await ref.create({
      ...payload,
      collegeId,
      cycleYear,
      applicationNo,
      status: 'enquiry' as AdmissionStatus,
      meritWeights: weights,
      feeAmount: payload.feeAmount ?? 0,
      feePaid: 0,
      notes: [],
      stageHistory: [
        { stage: 'enquiry', at: admin.firestore.FieldValue.serverTimestamp(), by: staff.name },
      ],
      createdBy: uid,
      createdByName: staff.name,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    const created = await ref.get()
    return { application: serialize(ref.id, created.data() as admin.firestore.DocumentData) }
  }
)

export const transitionAdmissionStage = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 30 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const input = (request.data || {}) as Record<string, unknown>
    const db = getFirestore(admin.app(), 'default')
    const collegeId = await resolveCollegeId(staff, input.collegeId)

    const applicationId = text(input.applicationId, 200)
    const to = text(input.to, 32) as AdmissionStatus
    if (!applicationId || applicationId.includes('/')) {
      throw new HttpsError('invalid-argument', 'A valid applicationId is required')
    }
    if (!STATUSES.includes(to)) throw new HttpsError('invalid-argument', 'Unknown stage')

    const ref = db.collection('admissionApplications').doc(applicationId)
    const doc = await ref.get()
    if (!doc.exists) throw new HttpsError('not-found', 'Application not found')
    const data = doc.data() as admin.firestore.DocumentData
    if (staff.role !== 'superadmin' && data.collegeId !== collegeId) {
      throw new HttpsError('permission-denied', 'This application belongs to another college')
    }

    const from = String(data.status || 'enquiry') as AdmissionStatus
    if (!canTransition(from, to)) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot move from "${from}" to "${to}". Allowed: ${allowedTransitions(from).join(', ') || 'none'}.`
      )
    }

    // An offer is the point where the college commits a seat, so the fields the
    // CSV hand-off depends on must exist by then rather than at export time.
    if (to === 'offer') {
      const missing: string[] = []
      if (!text(data.program)) missing.push('program')
      if (!text(data.batch)) missing.push('batch')
      if (!text(data.regNo)) missing.push('registration number')
      if (missing.length > 0) {
        throw new HttpsError('failed-precondition', `Complete before issuing an offer: ${missing.join(', ')}`)
      }
    }

    const update: admin.firestore.DocumentData = {
      status: to,
      stageHistory: admin.firestore.FieldValue.arrayUnion({
        stage: to,
        at: admin.firestore.FieldValue.serverTimestamp(),
        by: staff.name,
      }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }
    if (to === 'offer') update.offerIssuedAt = admin.firestore.FieldValue.serverTimestamp()
    const reason = text(input.reason, 500)
    if (reason) {
      update.notes = admin.firestore.FieldValue.arrayUnion({
        at: admin.firestore.FieldValue.serverTimestamp(),
        by: staff.name,
        text: `${from} → ${to}: ${reason}`,
      })
    }

    await ref.update(update)
    const updated = await ref.get()
    return { application: serialize(ref.id, updated.data() as admin.firestore.DocumentData) }
  }
)

export const listAdmissionApplications = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 30 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const input = (request.data || {}) as Record<string, unknown>
    const collegeId = await resolveCollegeId(staff, input.collegeId)

    const snap = await admin
      .firestore()
      .collection('admissionApplications')
      .where('collegeId', '==', collegeId)
      .limit(1000)
      .get()

    const applications = snap.docs
      .map((doc) => serialize(doc.id, doc.data()))
      .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''))

    // Funnel counts come from the same read as the list, so the board and the
    // table can never disagree about how many applicants are in a stage.
    const counts: Record<string, number> = {}
    for (const status of STATUSES) counts[status] = 0
    applications.forEach((application) => {
      counts[application.status] = (counts[application.status] || 0) + 1
    })

    const reachedOffer = applications.filter((application) =>
      application.stageHistory.some((entry) => entry.stage === 'offer')
    ).length

    return {
      applications,
      counts,
      totals: {
        total: applications.length,
        inPipeline: STATUSES.filter((s) => !ADMISSION_OUTCOMES.includes(s as AdmissionOutcome))
          .reduce((sum, status) => sum + (counts[status] || 0), 0),
        reachedOffer,
        enrolled: counts.enrolled || 0,
        conversionRate: reachedOffer > 0 ? Math.round(((counts.enrolled || 0) / reachedOffer) * 1000) / 10 : 0,
      },
    }
  }
)

export const deleteAdmissionApplication = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 30 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const input = (request.data || {}) as Record<string, unknown>
    const collegeId = await resolveCollegeId(staff, input.collegeId)

    const applicationId = text(input.applicationId, 200)
    if (!applicationId || applicationId.includes('/')) {
      throw new HttpsError('invalid-argument', 'A valid applicationId is required')
    }
    const ref = getFirestore(admin.app(), 'default').collection('admissionApplications').doc(applicationId)
    const doc = await ref.get()
    if (!doc.exists) throw new HttpsError('not-found', 'Application not found')
    if (staff.role !== 'superadmin' && doc.data()?.collegeId !== collegeId) {
      throw new HttpsError('permission-denied', 'This application belongs to another college')
    }
    // An enrolled applicant already became a student record; deleting the
    // application would orphan the audit trail behind it.
    if (String(doc.data()?.status) === 'enrolled') {
      throw new HttpsError('failed-precondition', 'An enrolled application cannot be deleted')
    }
    await ref.delete()
    return { deleted: true }
  }
)

export const exportAdmittedApplicants = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 30 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const input = (request.data || {}) as Record<string, unknown>
    const collegeId = await resolveCollegeId(staff, input.collegeId)

    const wantedStatus = text(input.status, 32) || 'fee'
    if (!STATUSES.includes(wantedStatus)) {
      throw new HttpsError('invalid-argument', 'Unknown status filter')
    }

    const snap = await admin
      .firestore()
      .collection('admissionApplications')
      .where('collegeId', '==', collegeId)
      .where('status', '==', wantedStatus)
      .limit(500)
      .get()

    const rows: Array<Record<string, string>> = []
    const blocked: string[] = []
    const exportedIds: string[] = []

    snap.docs.forEach((doc) => {
      const application = serialize(doc.id, doc.data())
      const result = toStudentCsvRow(application)
      if (result.row) {
        rows.push(result.row)
        exportedIds.push(doc.id)
      } else {
        blocked.push(...result.blocked)
      }
    })

    return {
      csv: toCsv(rows),
      rowCount: rows.length,
      blocked,
      exportedIds,
      columns: [...STUDENT_CSV_COLUMNS],
    }
  }
)

export const markAdmissionExported = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 30 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const input = (request.data || {}) as Record<string, unknown>
    const collegeId = await resolveCollegeId(staff, input.collegeId)

    const ids = Array.isArray(input.applicationIds)
      ? [...new Set(input.applicationIds.map((value) => text(value, 200)).filter(Boolean))].slice(0, 500)
      : []
    if (ids.length === 0) throw new HttpsError('invalid-argument', 'No applications selected')

    const db = getFirestore(admin.app(), 'default')
    const refs = ids.map((id) => db.collection('admissionApplications').doc(id))
    const docs = await db.getAll(...refs)

    const batch = db.batch()
    let marked = 0
    docs.forEach((doc) => {
      if (!doc.exists) return
      if (staff.role !== 'superadmin' && doc.data()?.collegeId !== collegeId) return
      batch.update(doc.ref, {
        exportedAt: admin.firestore.FieldValue.serverTimestamp(),
        exportedBy: staff.name,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      marked += 1
    })
    await batch.commit()
    return { marked }
  }
)

// ─── Form intake ────────────────────────────────────────────────────────────
//
// Colleges collect enquiries with their own Google Form and an Apps Script
// trigger that POSTs each submission here. There is no OAuth and no Google
// Cloud project to provision: the college pastes a script we generate, and the
// only shared secret is a per-college token.
//
// The token is stored HASHED. The plaintext is returned exactly once, when it
// is generated, so a database read cannot recover a live token — and rotating
// invalidates the old one outright.

/** Vriddhi fields a form answer can be mapped onto. */
export const MAPPABLE_FIELDS = [
  'applicantName',
  'email',
  'phone',
  'dateOfBirth',
  'gender',
  'guardianName',
  'guardianPhone',
  'city',
  'program',
  'batch',
  'previousSchool',
  'previousQualification',
  'yearOfPassing',
  'qualifyingPercentage',
  'entranceExamType',
  'entranceRegistrationNo',
  'entranceScore',
  'entranceMaxScore',
] as const

export type MappableField = (typeof MAPPABLE_FIELDS)[number]

/** Vriddhi field -> the exact Google Form question title. */
export type FieldMapping = Partial<Record<MappableField, string>>

export interface IntakeDefaults {
  program: string
  batch: string
  source: string
  department: string
}

export const DEFAULT_INTAKE_DEFAULTS: IntakeDefaults = {
  program: '',
  batch: '',
  source: 'Google Form',
  department: '',
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function generateIngestToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

/**
 * Maps raw form answers onto applicant fields using the college's mapping.
 *
 * Question titles are matched case- and whitespace-insensitively, because a
 * college editing "Full  Name" to "Full Name" must not silently start dropping
 * every applicant's name. Answers for questions the college never mapped are
 * ignored rather than guessed at.
 */
export function mapFormAnswers(
  answers: Record<string, unknown>,
  mapping: FieldMapping,
  defaults: IntakeDefaults
): { applicant: Record<string, unknown>; unmappedQuestions: string[] } {
  const normalized = new Map<string, unknown>()
  // Kept alongside so `unmappedQuestions` can quote the question exactly as the
  // college typed it — that is the only form the staff can search their form for.
  const originalTitles = new Map<string, string>()
  Object.entries(answers || {}).forEach(([question, value]) => {
    const key = question.trim().toLowerCase().replace(/\s+/g, ' ')
    normalized.set(key, value)
    if (!originalTitles.has(key)) originalTitles.set(key, question.trim())
  })

  const applicant: Record<string, unknown> = {}
  const mappedTitles = new Set<string>()

  for (const field of MAPPABLE_FIELDS) {
    const title = (mapping as Record<string, unknown>)[field]
    if (typeof title !== 'string' || !title.trim()) continue
    const key = title.trim().toLowerCase().replace(/\s+/g, ' ')
    mappedTitles.add(key)
    if (!normalized.has(key)) continue
    const raw = normalized.get(key)
    const value = Array.isArray(raw) ? raw.join(', ') : raw
    if (value === null || value === undefined || String(value).trim() === '') continue
    applicant[field] = String(value).trim()
  }

  const unmappedQuestions = [...normalized.keys()]
    .filter((key) => !mappedTitles.has(key))
    .map((key) => originalTitles.get(key) || key)

  // Defaults fill what the form does not ask, so a college running one form for
  // a single program does not have to ask the same question of everyone.
  if (!applicant.program && defaults.program) applicant.program = defaults.program
  if (!applicant.batch && defaults.batch) applicant.batch = defaults.batch
  if (!applicant.department && defaults.department) applicant.department = defaults.department
  applicant.source = defaults.source || 'Google Form'

  return { applicant, unmappedQuestions }
}

/** Google Form answers arrive as strings; these three need numbers. */
export function coerceApplicantNumbers(applicant: Record<string, unknown>): Record<string, unknown> {
  const numeric = ['qualifyingPercentage', 'entranceScore', 'entranceMaxScore'] as const
  const out = { ...applicant }
  for (const key of numeric) {
    const raw = out[key]
    if (raw === undefined || raw === null || raw === '') continue
    // Take the first number in the string, so "85%" and "85" both mean 85.
    // "142 / 180" is a score with its maximum attached; stripping separators
    // would fuse the two into 142180, so only the leading number is read.
    const match = String(raw).match(/[0-9]*\.?[0-9]+/)
    // Free text like "awaiting results" has no number at all. Treat that as
    // unrecorded, not as a score of zero — a zero here would drag the merit
    // score down and read as a real result to the admissions office.
    const parsed = match ? Number(match[0]) : Number.NaN
    out[key] = Number.isFinite(parsed) ? parsed : null
  }
  return out
}

/**
 * The Apps Script the college pastes into their form. Generated rather than
 * documented, so the endpoint and token can never drift from what is deployed.
 */
export function buildAppsScriptSnippet(endpointUrl: string, token: string): string {
  // Both values are interpolated into single-quoted JS string literals.
  const quote = (value: string) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  return `// Vriddhi Admission Center — paste into your Google Form's Apps Script editor,
// then add a trigger: function onFormSubmit, event source "From form",
// event type "On form submit".
var ENDPOINT_URL = ${quote(endpointUrl)};
var INGEST_TOKEN = ${quote(token)};

function onFormSubmit(e) {
  var payload = {
    token: INGEST_TOKEN,
    responseId: e.response.getId(),
    submittedAt: e.response.getTimestamp().toISOString(),
    answers: {}
  };
  e.response.getItemResponses().forEach(function (item) {
    var answer = item.getResponse();
    payload.answers[item.getItem().getTitle()] =
      Array.isArray(answer) ? answer : String(answer);
  });

  UrlFetchApp.fetch(ENDPOINT_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}
`
}

/** Deterministic document id so a re-delivered submission cannot duplicate. */
export function intakeDocumentId(collegeId: string, responseId: string): string {
  return crypto
    .createHash('sha256')
    .update(`${collegeId}\u0000${responseId}`)
    .digest('hex')
    .slice(0, 40)
}

// ─── Admission config (merit weights + form intake) ─────────────────────────

/**
 * Where the intake endpoint lives. Mirrors `DEFAULT_API_BASE_URL` in
 * src/shared/api/apiBase.ts so the generated Apps Script posts to the same
 * function the rest of the app talks to; `API_BASE_URL` overrides it for
 * staging deployments.
 */
const DEFAULT_API_BASE = 'https://asia-south1-vriddhi-academic.cloudfunctions.net/api'

function intakeEndpoint(): string {
  const base = String(process.env.API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '')
  return `${base}/admissions/ingest`
}

async function loadAdmissionConfig(collegeId: string): Promise<admin.firestore.DocumentData> {
  const doc = await admin
    .firestore()
    .collection('colleges')
    .doc(collegeId)
    .collection('config')
    .doc('admission')
    .get()
  return doc.data() || {}
}

function serializeMapping(value: unknown): FieldMapping {
  if (!value || typeof value !== 'object') return {}
  const out: FieldMapping = {}
  Object.entries(value as Record<string, unknown>).forEach(([field, title]) => {
    if (!(MAPPABLE_FIELDS as readonly string[]).includes(field)) return
    if (typeof title !== 'string' || !title.trim()) return
    ;(out as Record<string, string>)[field] = title.trim()
  })
  return out
}

function serializeDefaults(value: unknown): IntakeDefaults {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    program: String(source.program || DEFAULT_INTAKE_DEFAULTS.program).slice(0, 80),
    batch: String(source.batch || DEFAULT_INTAKE_DEFAULTS.batch).slice(0, 32),
    source: String(source.source || DEFAULT_INTAKE_DEFAULTS.source).slice(0, 60),
    department: String(source.department || DEFAULT_INTAKE_DEFAULTS.department).slice(0, 80),
  }
}

export const getAdmissionConfig = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 30 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const collegeId = await resolveCollegeId(staff, (request.data as Record<string, unknown>)?.collegeId)
    const config = await loadAdmissionConfig(collegeId)

    return {
      weights: {
        qualifying: optionalNumber(config.qualifyingWeight, 0, 100) ?? DEFAULT_MERIT_WEIGHTS.qualifying,
        entrance: optionalNumber(config.entranceWeight, 0, 100) ?? DEFAULT_MERIT_WEIGHTS.entrance,
        interview: optionalNumber(config.interviewWeight, 0, 100) ?? DEFAULT_MERIT_WEIGHTS.interview,
      },
      weightsCustomised: Boolean(config.qualifyingWeight ?? config.entranceWeight ?? config.interviewWeight),
      intake: {
        enabled: config.intakeEnabled === true,
        hasToken: Boolean(config.activeTokenHash),
        fieldMapping: serializeMapping(config.fieldMapping),
        defaults: serializeDefaults(config.intakeDefaults),
        endpoint: intakeEndpoint(),
        mappableFields: [...MAPPABLE_FIELDS],
        lastSubmissionAt: iso(config.lastSubmissionAt),
        submissionCount: Number(config.submissionCount) || 0,
        rejectedCount: Number(config.rejectedCount) || 0,
      },
    }
  }
)

export const saveAdmissionConfig = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 30 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const input = (request.data || {}) as Record<string, unknown>
    const collegeId = await resolveCollegeId(staff, input.collegeId)

    const update: admin.firestore.DocumentData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: staff.name,
    }

    if (input.weights !== undefined) {
      const weights = (input.weights && typeof input.weights === 'object' ? input.weights : {}) as Record<
        string,
        unknown
      >
      const qualifying = optionalNumber(weights.qualifying, 0, 100)
      const entrance = optionalNumber(weights.entrance, 0, 100)
      const interview = optionalNumber(weights.interview, 0, 100)
      if (qualifying === null || entrance === null || interview === null) {
        throw new HttpsError('invalid-argument', 'Weights must be numbers between 0 and 100')
      }
      const total = qualifying + entrance + interview
      if (total <= 0) {
        throw new HttpsError('invalid-argument', 'At least one weight must be greater than zero')
      }
      if (Math.abs(total - 100) > 0.01) {
        throw new HttpsError(
          'invalid-argument',
          `Weights must add up to 100 (currently ${Math.round(total * 100) / 100})`
        )
      }
      update.qualifyingWeight = qualifying
      update.entranceWeight = entrance
      update.interviewWeight = interview
    }

    if (input.fieldMapping !== undefined) update.fieldMapping = serializeMapping(input.fieldMapping)
    if (input.intakeDefaults !== undefined) update.intakeDefaults = serializeDefaults(input.intakeDefaults)
    if (input.intakeEnabled !== undefined) update.intakeEnabled = input.intakeEnabled === true

    const ref = admin
      .firestore()
      .collection('colleges')
      .doc(collegeId)
      .collection('config')
      .doc('admission')
    await ref.set(update, { merge: true })

    // Changing the weights changes every merit score, so existing applications
    // carry the weights they were scored under. Re-stamp them so the score
    // shown for an applicant is always computed from the current policy.
    if (update.qualifyingWeight !== undefined) {
      const snap = await admin
        .firestore()
        .collection('admissionApplications')
        .where('collegeId', '==', collegeId)
        .limit(1000)
        .get()
      const batch = getFirestore(admin.app(), 'default').batch()
      snap.docs.forEach((doc) => {
        batch.update(doc.ref, {
          meritWeights: {
            qualifying: update.qualifyingWeight,
            entrance: update.entranceWeight,
            interview: update.interviewWeight,
          },
        })
      })
      await batch.commit()
    }

    return { saved: true }
  }
)

export const rotateAdmissionIngestToken = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 30 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const input = (request.data || {}) as Record<string, unknown>
    const collegeId = await resolveCollegeId(staff, input.collegeId)

    const db = getFirestore(admin.app(), 'default')
    const config = await loadAdmissionConfig(collegeId)

    // Revoke the previous token so a leaked one stops working immediately.
    const previousHash = String(config.activeTokenHash || '')
    if (previousHash) {
      await db.collection('admissionIngestTokens').doc(previousHash).delete().catch(() => undefined)
    }

    const token = generateIngestToken()
    const tokenHash = hashToken(token)
    await db.collection('admissionIngestTokens').doc(tokenHash).set({
      collegeId,
      createdBy: uid,
      createdByName: staff.name,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      revoked: false,
    })

    const ref = db.collection('colleges').doc(collegeId).collection('config').doc('admission')
    await ref.set(
      {
        activeTokenHash: tokenHash,
        intakeEnabled: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: staff.name,
      },
      { merge: true }
    )

    // The plaintext is returned once and never stored, so it cannot be read
    // back later — copy it into the Apps Script now or rotate again.
    return {
      token,
      endpoint: intakeEndpoint(),
      script: buildAppsScriptSnippet(intakeEndpoint(), token),
    }
  }
)

export const disableAdmissionIntake = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 30 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const collegeId = await resolveCollegeId(staff, (request.data as Record<string, unknown>)?.collegeId)

    const db = getFirestore(admin.app(), 'default')
    const config = await loadAdmissionConfig(collegeId)
    const previousHash = String(config.activeTokenHash || '')
    if (previousHash) {
      await db.collection('admissionIngestTokens').doc(previousHash).delete().catch(() => undefined)
    }
    await db
      .collection('colleges')
      .doc(collegeId)
      .collection('config')
      .doc('admission')
      .set(
        {
          activeTokenHash: admin.firestore.FieldValue.delete(),
          intakeEnabled: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: staff.name,
        },
        { merge: true }
      )
    return { disabled: true }
  }
)

// ─── Intake document construction ───────────────────────────────────────────

/**
 * Builds the Firestore document for an application arriving from a form.
 *
 * Exported so the Express intake route and the callable-backed create path
 * cannot drift apart on which fields exist — `serialize()` reads a fixed set,
 * and a field written under a different name here would silently render as
 * blank in the Admission Center.
 */
export function buildIntakeApplication(
  applicant: Record<string, unknown>,
  context: { collegeId: string; applicationNo: string; cycleYear: number; weights: MeritWeights; source: string }
): admin.firestore.DocumentData {
  const now = admin.firestore.FieldValue.serverTimestamp()
  return {
    collegeId: context.collegeId,
    applicationNo: context.applicationNo,
    cycleYear: context.cycleYear,
    status: 'enquiry' as AdmissionStatus,
    applicantName: text(applicant.applicantName),
    email: text(applicant.email, 160).toLowerCase(),
    phone: text(applicant.phone, 32),
    dateOfBirth: text(applicant.dateOfBirth, 32),
    gender: text(applicant.gender, 32),
    bloodGroup: '',
    guardianName: text(applicant.guardianName),
    guardianPhone: text(applicant.guardianPhone, 32),
    city: text(applicant.city),
    program: text(applicant.program, 80),
    department: text(applicant.department, 80),
    batch: text(applicant.batch, 32),
    division: '',
    regNo: '',
    mentorId: '',
    previousSchool: text(applicant.previousSchool),
    previousQualification: text(applicant.previousQualification, 120),
    yearOfPassing: text(applicant.yearOfPassing, 16),
    source: context.source,
    assignedTo: '',
    assignedToName: '',
    entranceExamType: text(applicant.entranceExamType, 60),
    entranceRegistrationNo: text(applicant.entranceRegistrationNo, 64),
    interviewNotes: '',
    qualifyingPercentage: optionalNumber(applicant.qualifyingPercentage, 0, 100),
    entranceScore: optionalNumber(applicant.entranceScore, 0, 100000),
    entranceMaxScore: optionalNumber(applicant.entranceMaxScore, 0, 100000),
    interviewRating: null,
    meritWeights: context.weights,
    feeAmount: 0,
    feePaid: 0,
    notes: [
      { at: new Date().toISOString(), by: 'Google Form intake', text: 'Created from a form submission' },
    ],
    stageHistory: [{ stage: 'enquiry', at: new Date().toISOString(), by: 'Google Form intake' }],
    createdBy: 'form-intake',
    createdByName: 'Google Form intake',
    createdAt: now,
    updatedAt: now,
  }
}
