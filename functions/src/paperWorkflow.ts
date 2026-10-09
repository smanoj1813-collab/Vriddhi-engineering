import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { COLLECTION_ROLE, normalizeRole, pickCollegeId } from './identityShared'
import { findSchedulingProblem } from './questionTypes'

interface PaperStaff {
  uid: string
  role: string
  collegeId: string
  name: string
}

export const PAPER_ROLES = ['superadmin', 'admin', 'principal', 'hod', 'faculty', 'mentor']
export const REVIEW_ROLES = ['superadmin', 'admin', 'principal', 'hod']
const HIGH_STAKES_EXAMS = ['Mid Semester', 'Semester End', 'Model Exam']
export const EDITABLE_STATES = ['draft', 'modification-requested', 'rejected-by-hod']
const FILE_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
])

/**
 * Staff profile collections, in the same resolution order the client and
 * syncMyIdentity use. `students` is deliberately absent: membership here
 * must prove ACADEMIC STAFF, and a students-document can never do that.
 * `superadmins` is absent too — the superadmin identity only ever comes
 * from the token claim or the canonical users document, never from a
 * client-writable profile.
 */
const PAPER_PROFILE_COLLECTIONS = ['admins', 'faculty', 'hods', 'mentors'] as const

/**
 * Legacy-account fallback for resolvePaperStaff. Accounts provisioned before
 * the users/{uid} convention have NO users document at all, which used to
 * fail every savePaper/reviewPaper call with "Academic staff access is
 * required" even when the token carried perfectly valid role+collegeId
 * claims. Mirrors findProfileDocument() in selfIdentity.ts: document-id
 * anchor first, then uid/userId fields, then the token email; the role comes
 * from COLLECTION MEMBERSHIP only — never from the document's role field —
 * and the college from any of the field spellings the client tolerates.
 */
async function resolveLegacyPaperStaff(
  uid: string,
  email: string | null,
): Promise<{ role: string; collegeId: string; name: string } | null> {
  const db = getFirestore(admin.app(), 'default')
  const anchors: Array<{ field: string; value: string }> = [
    { field: 'uid', value: uid },
    { field: 'userId', value: uid },
  ]
  if (email) anchors.push({ field: 'email', value: email })

  for (const collectionName of PAPER_PROFILE_COLLECTIONS) {
    let data: Record<string, unknown> | null = null
    try {
      const byId = await db.collection(collectionName).doc(uid).get()
      if (byId.exists) data = (byId.data() || {}) as Record<string, unknown>
    } catch (err) {
      logger.warn('[resolvePaperStaff] doc-id lookup failed', { collectionName, error: (err as Error)?.message })
    }

    if (!data) {
      for (const { field, value } of anchors) {
        try {
          const snap = await db.collection(collectionName).where(field, '==', value).limit(1).get()
          if (!snap.empty) {
            data = snap.docs[0].data()
            break
          }
        } catch (err) {
          logger.warn('[resolvePaperStaff] profile lookup failed', { collectionName, field, error: (err as Error)?.message })
        }
      }
    }

    if (data) {
      const membershipRole = COLLECTION_ROLE[collectionName]
      if (!membershipRole || !PAPER_ROLES.includes(membershipRole)) return null
      const name =
        String(data.name || data.displayName || `${(data.firstName as string) || ''} ${(data.lastName as string) || ''}`.trim())
      return { role: membershipRole, collegeId: pickCollegeId(data) || '', name }
    }
  }
  return null
}

export async function resolvePaperStaff(uid: string, token: Record<string, unknown>): Promise<PaperStaff> {
  const userDoc = await getFirestore(admin.app(), 'default').collection('users').doc(uid).get()
  const user = userDoc.data()
  let role = normalizeRole(token.role, '') || normalizeRole(user?.role, '') || String(token.role || user?.role || '')
  let collegeId = String(token.collegeId || '') || pickCollegeId(user || null) || ''
  let name = String(user?.name || user?.displayName || '')

  // Legacy accounts have no users document (or it lacks the college) — fall
  // back to the staff profile collections for the missing pieces.
  if (!userDoc.exists || !role || (role !== 'superadmin' && !collegeId)) {
    const legacy = await resolveLegacyPaperStaff(
      uid,
      typeof token.email === 'string' && token.email ? token.email.toLowerCase() : null,
    )
    if (legacy) {
      if (!role) role = legacy.role
      if (!collegeId && role !== 'superadmin') collegeId = legacy.collegeId
      if (!name) name = legacy.name
    }
  }

  if ((!userDoc.exists && !role) || !PAPER_ROLES.includes(role) || (role !== 'superadmin' && !collegeId)) {
    throw new HttpsError('permission-denied', 'Academic staff access is required')
  }
  return { uid, role, collegeId, name }
}

function boundedString(value: unknown, field: string, maximum: number, required = false): string {
  const text = String(value || '').trim()
  if ((required && !text) || text.length > maximum) {
    throw new HttpsError('invalid-argument', `${field} is invalid`)
  }
  return text
}

interface PaperInput {
  title: string
  subject: string
  branch: string
  batch: string
  semester: string
  examType: string
  date: string
  duration: number
  totalMarks: number
  instructions: string
  sections: Array<{
    id: string
    name: string
    questions: Array<{
      number: number
      text: string
      type: string
      marks: number
      topic: string
      options: Array<{ id: string; text: string }>
    }>
  }>
  totalQuestions: number
  requiresApproval: boolean
  filePath?: string
  fileName?: string
  fileUrl?: string
  answerKeyPath?: string
  answerKeyName?: string
  answerKeyUrl?: string
}

const MAX_PAPER_OPTIONS = 10

/**
 * Normalises client-supplied options into the { id, text } shape the paper
 * document, the Confirm sync and the scheduler all read. Accepts plain
 * strings or { text | label } (optionally with an id). Empty/blank options
 * are dropped; the list is capped.
 *
 * IMPORTANT: previously savePaper silently DROPPED options (validatePaperInput
 * returned no options field), so every save stripped MCQ options from the
 * stored paper and the following Confirm failed with "fewer than two options"
 * — after which the paper was locked and the faculty could neither fix nor
 * resubmit it. Options must survive the round-trip.
 */
export function normalizeQuestionOptions(value: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(value)) return []
  const out: Array<{ id: string; text: string }> = []
  for (let i = 0; i < value.length && out.length < MAX_PAPER_OPTIONS; i += 1) {
    const raw = value[i]
    let text = ''
    let id = String.fromCharCode(65 + Math.min(i, 25))
    if (typeof raw === 'string') {
      text = raw.trim()
    } else if (raw && typeof raw === 'object') {
      const entry = raw as Record<string, unknown>
      text = String(entry.text ?? entry.label ?? '').trim()
      if (typeof entry.id === 'string' && entry.id.trim()) id = entry.id.trim().slice(0, 10)
    }
    if (!text) continue
    out.push({ id, text })
  }
  return out
}

export function validatePaperInput(value: unknown): PaperInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'Paper data is required')
  }
  const input = value as Record<string, unknown>
  const title = boundedString(input.title, 'title', 200, true)
  const subject = boundedString(input.subject, 'subject', 200, true)
  const branch = boundedString(input.branch, 'branch', 100)
  const batch = boundedString(input.batch, 'batch', 100)
  const semester = boundedString(input.semester, 'semester', 10)
  const examType = boundedString(input.examType, 'examType', 100, true)
  const date = boundedString(input.date, 'date', 10)
  const instructions = boundedString(input.instructions, 'instructions', 10_000)
  const duration = Number(input.duration)
  const declaredMarks = Number(input.totalMarks)
  if (semester && (!Number.isInteger(Number(semester)) || Number(semester) < 1 || Number(semester) > 20)) {
    throw new HttpsError('invalid-argument', 'semester is invalid')
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpsError('invalid-argument', 'date is invalid')
  }
  if (!Number.isFinite(duration) || duration < 0 || duration > 1440) {
    throw new HttpsError('invalid-argument', 'duration is invalid')
  }

  const sourceSections = Array.isArray(input.sections) ? input.sections : []
  if (sourceSections.length > 20) throw new HttpsError('invalid-argument', 'Too many paper sections')
  let questionCount = 0
  let calculatedMarks = 0
  const sections = sourceSections.map((rawSection, sectionIndex) => {
    if (!rawSection || typeof rawSection !== 'object' || Array.isArray(rawSection)) {
      throw new HttpsError('invalid-argument', 'Paper section is invalid')
    }
    const section = rawSection as Record<string, unknown>
    const sourceQuestions = Array.isArray(section.questions) ? section.questions : []
    const questions = sourceQuestions.map((rawQuestion, questionIndex) => {
      if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) {
        throw new HttpsError('invalid-argument', 'Paper question is invalid')
      }
      const question = rawQuestion as Record<string, unknown>
      const text = boundedString(question.text || question.questionText, 'question text', 20_000, true)
      const type = boundedString(question.type, 'question type', 50, true)
      const topic = boundedString(question.topic, 'question topic', 200)
      const marks = Number(question.marks)
      if (!Number.isFinite(marks) || marks < 0 || marks > 1000) {
        throw new HttpsError('invalid-argument', 'Question marks are invalid')
      }
      questionCount += 1
      calculatedMarks += marks
      if (questionCount > 400) throw new HttpsError('invalid-argument', 'A paper can contain at most 400 questions')
      return { number: questionIndex + 1, text, type, marks, topic, options: normalizeQuestionOptions(question.options) }
    })
    return {
      id: boundedString(section.id, 'section id', 100) || `section-${sectionIndex + 1}`,
      name: boundedString(section.name, 'section name', 200) || `Section ${sectionIndex + 1}`,
      questions,
    }
  })
  const totalMarks = questionCount > 0 ? calculatedMarks : declaredMarks
  if (!Number.isFinite(totalMarks) || totalMarks < 0 || totalMarks > 10_000) {
    throw new HttpsError('invalid-argument', 'totalMarks is invalid')
  }
  return {
    title,
    subject,
    branch,
    batch,
    semester,
    examType,
    date,
    duration,
    totalMarks,
    instructions,
    sections,
    totalQuestions: questionCount,
    requiresApproval: Boolean(input.requiresApproval) || HIGH_STAKES_EXAMS.includes(examType),
    ...(input.filePath ? { filePath: boundedString(input.filePath, 'filePath', 1000) } : {}),
    ...(input.fileName ? { fileName: boundedString(input.fileName, 'fileName', 500) } : {}),
    ...(input.fileUrl ? { fileUrl: boundedString(input.fileUrl, 'fileUrl', 3000) } : {}),
    ...(input.answerKeyPath ? { answerKeyPath: boundedString(input.answerKeyPath, 'answerKeyPath', 1000) } : {}),
    ...(input.answerKeyName ? { answerKeyName: boundedString(input.answerKeyName, 'answerKeyName', 500) } : {}),
    ...(input.answerKeyUrl ? { answerKeyUrl: boundedString(input.answerKeyUrl, 'answerKeyUrl', 3000) } : {}),
  }
}

async function validatedStorageFile(
  path: string | undefined,
  existingPath: unknown,
  collegeId: string,
  uid: string,
  paperId: string
): Promise<{ path: string } | undefined> {
  if (!path) return undefined
  if (path === existingPath) return undefined
  const prefix = `paper-files/${collegeId}/${uid}/${paperId}/`
  if (!path.startsWith(prefix) || path.length <= prefix.length) {
    throw new HttpsError('invalid-argument', 'Paper file path is invalid')
  }
  const bucket = admin.storage().bucket()
  const file = bucket.file(path)
  let metadata
  try {
    const metadataResult = await file.getMetadata()
    metadata = metadataResult[0]
  } catch {
    throw new HttpsError('failed-precondition', 'Uploaded paper file was not found')
  }
  const contentType = String(metadata.contentType || '')
  const size = Number(metadata.size || 0)
  if (!FILE_CONTENT_TYPES.has(contentType) || size <= 0 || size > 20 * 1024 * 1024) {
    throw new HttpsError('invalid-argument', 'Paper file type or size is invalid')
  }
  return { path }
}

export function derivePaperState(action: string, paper: PaperInput, canReview: boolean) {
  if (!['draft', 'save', 'submitted', 'published'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Paper action is invalid')
  }
  if (action === 'published' && !canReview) {
    throw new HttpsError('permission-denied', 'Only an authorized reviewer may publish directly')
  }
  if (paper.requiresApproval && action === 'save') {
    throw new HttpsError('failed-precondition', 'This exam type requires approval before publication')
  }
  if (action !== 'draft' && (paper.totalMarks <= 0 || paper.duration <= 0)) {
    throw new HttpsError('failed-precondition', 'Duration and total marks must be greater than zero')
  }
  if (action === 'submitted') {
    return { status: 'draft', verificationStatus: 'submitted-for-approval', requiresApproval: true }
  }
  if (action === 'published') {
    return { status: 'published', verificationStatus: 'approved-by-hod', requiresApproval: false }
  }
  if (action === 'save') {
    return { status: 'published', verificationStatus: 'not-required', requiresApproval: false }
  }
  return { status: 'draft', verificationStatus: 'draft', requiresApproval: paper.requiresApproval }
}

export interface PaperReadinessFlags {
  printReady: boolean
  onlineReady: boolean
  bankReady: boolean
}

/**
 * Derives the three readiness flags for the two-artefact model:
 *   printReady  — the original file is attached (the print/photocopy artefact)
 *   onlineReady — at least one structured question exists (schedulable online)
 *   bankReady   — question bank documents are linked via questionIds
 */
/**
 * Walks a validated paper's sections in order and returns the FIRST question
 * the online engine cannot schedule (via the SAME findSchedulingProblem used
 * by the scheduler and Confirm), or null when the paper is schedulable.
 *
 * savePaper uses this to gate every NON-draft action: a paper that would fail
 * Confirm (e.g. an MCQ with fewer than two options) must stay editable
 * instead of being saved-and-locked and then failing the bank sync.
 */
export function firstPaperSchedulingProblem(
  sections: Array<{ questions: Array<{ text: string; type: string; marks: number; options: Array<{ id: string; text: string }> }> }>
): string | null {
  let order = 0
  for (const section of sections || []) {
    for (const question of section.questions || []) {
      order += 1
      const problem = findSchedulingProblem({
        order,
        text: question.text,
        type: question.type,
        marks: question.marks,
        options: question.options || [],
      })
      if (problem) return problem
    }
  }
  return null
}

export function paperReadiness(paper: {
  filePath?: unknown
  sections?: unknown
  questionIds?: unknown
  linkedQuestionIds?: unknown
  totalQuestions?: unknown
}): PaperReadinessFlags {
  const sectionsCount = Array.isArray(paper.sections)
    ? (paper.sections as Array<Record<string, unknown>>).reduce(
        (sum, section) => sum + (Array.isArray(section?.questions) ? section.questions.length : 0),
        0
      )
    : 0
  const bankCount = Math.max(
    Array.isArray(paper.questionIds) ? paper.questionIds.length : 0,
    Array.isArray(paper.linkedQuestionIds) ? paper.linkedQuestionIds.length : 0
  )
  const questionCount = sectionsCount > 0 ? sectionsCount : bankCount > 0 ? bankCount : Number(paper.totalQuestions) || 0
  return {
    printReady: Boolean(paper.filePath),
    onlineReady: questionCount > 0,
    bankReady: bankCount > 0,
  }
}

/**
 * Who may edit an existing paper. Submitted / published papers stay locked,
 * except for the Slice 1 case: the paper's own author may re-open a
 * file-only "Ready to use" paper (no structured questions yet) to add or
 * refine its structure — today's EDITABLE_STATES-only check blocked exactly
 * the "uploaded a PDF, now want to add questions" flow.
 */
export function canEditExistingPaper(
  paper: { verificationStatus?: unknown; status?: unknown; totalQuestions?: unknown; createdBy?: unknown } | undefined,
  staff: { role: string; uid: string }
): boolean {
  if (!paper) return false
  const verificationStatus = String(paper.verificationStatus || paper.status || 'draft')
  if (EDITABLE_STATES.includes(verificationStatus)) return true
  if (
    verificationStatus === 'not-required'
    && (Number(paper.totalQuestions) || 0) === 0
    && String(paper.createdBy || '') === staff.uid
  ) {
    return true
  }
  return false
}

export const savePaper = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 120, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolvePaperStaff(uid, request.auth?.token || {})
    const paperId = String(request.data?.paperId || '')
    const requestedCollege = String(request.data?.collegeId || '')
    const collegeId = staff.role === 'superadmin' ? requestedCollege : staff.collegeId
    const action = String(request.data?.action || '')
    if (!paperId || paperId.includes('/') || paperId.length > 200 || !collegeId) {
      throw new HttpsError('invalid-argument', 'Paper and college identifiers are required')
    }
    const paper = validatePaperInput(request.data?.paper)
    const canReview = REVIEW_ROLES.includes(staff.role)
    const state = derivePaperState(action, paper, canReview)
    const db = getFirestore(admin.app(), 'default')
    const ref = db.collection('papers').doc(paperId)
    const before = await ref.get()
    const existing = before.data()
    if (before.exists) {
      if (staff.role !== 'superadmin' && existing?.collegeId !== collegeId) {
        throw new HttpsError('permission-denied', 'Paper belongs to another college')
      }
      if (!canReview && existing?.createdBy !== uid) {
        throw new HttpsError('permission-denied', 'Staff may edit only papers they authored')
      }
      if (!canEditExistingPaper(existing, staff)) {
        throw new HttpsError(
          'failed-precondition',
          'Submitted or published papers cannot be edited. File-only papers can be re-opened by their author to add structured questions.'
        )
      }
    }
    const [uploadedPaper, uploadedKey] = await Promise.all([
      validatedStorageFile(paper.filePath, existing?.filePath, collegeId, uid, paperId),
      validatedStorageFile(paper.answerKeyPath, existing?.answerKeyPath, collegeId, uid, paperId),
    ])
    const filePath = uploadedPaper?.path || paper.filePath || existing?.filePath
    const answerKeyPath = uploadedKey?.path || paper.answerKeyPath || existing?.answerKeyPath
    if (action !== 'draft' && paper.totalQuestions === 0 && !filePath) {
      throw new HttpsError('failed-precondition', 'Add a paper file or at least one question')
    }
    // A non-draft save locks the paper out of editing (it enters the review
    // queue / becomes published). Never lock a paper that cannot be scheduled
    // — surface the exact problem now, while it is still fixable, instead of
    // letting Confirm fail after the lock.
    if (action !== 'draft' && paper.totalQuestions > 0) {
      const problem = firstPaperSchedulingProblem(paper.sections)
      if (problem) {
        throw new HttpsError('failed-precondition', problem)
      }
    }
    const preservedQuestionIds = Array.isArray(existing?.questionIds) ? existing.questionIds : []
    const preservedLinkedIds = Array.isArray(existing?.linkedQuestionIds) ? existing.linkedQuestionIds : []
    const readiness = paperReadiness({ filePath, sections: paper.sections, questionIds: preservedQuestionIds })
    const auditRef = db.collection('paperReviewAudit').doc()
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref)
      if (current.exists !== before.exists || (current.exists && current.updateTime?.isEqual(before.updateTime!) !== true)) {
        throw new HttpsError('aborted', 'Paper changed while it was being saved; reload and try again')
      }
      const createdAt = existing?.createdAt || admin.firestore.FieldValue.serverTimestamp()
      transaction.set(ref, {
        ...paper,
        ...state,
        collegeId,
        filePath: filePath || null,
        printReady: readiness.printReady,
        onlineReady: readiness.onlineReady,
        bankReady: readiness.bankReady,
        fileUrl: uploadedPaper
          ? null
          : (filePath === existing?.filePath ? existing?.fileUrl || null : null),
        fileName: uploadedPaper
          ? paper.fileName || null
          : (filePath === existing?.filePath ? existing?.fileName || null : null),
        answerKeyPath: answerKeyPath || null,
        answerKeyUrl: uploadedKey
          ? null
          : (answerKeyPath === existing?.answerKeyPath ? existing?.answerKeyUrl || null : null),
        answerKeyName: uploadedKey
          ? paper.answerKeyName || null
          : (answerKeyPath === existing?.answerKeyPath ? existing?.answerKeyName || null : null),
        questionIds: preservedQuestionIds,
        linkedQuestionIds: preservedLinkedIds,
        usageCount: Number(existing?.usageCount || 0),
        isManual: true,
        createdBy: existing?.createdBy || uid,
        createdByName: existing?.createdByName || staff.name,
        createdAt,
        updatedBy: uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(action === 'submitted' ? { submittedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
        ...(action === 'published' ? {
          reviewedBy: uid,
          reviewedByName: staff.name,
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        } : {}),
        ...(action === 'save' ? { finalisedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      })
      transaction.create(auditRef, {
        paperId,
        collegeId,
        action: before.exists ? `paper_${action}_updated` : `paper_${action}_created`,
        fromStatus: existing?.verificationStatus || null,
        toStatus: state.verificationStatus,
        performedBy: uid,
        performedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })
    return { id: paperId, status: state.status, verificationStatus: state.verificationStatus }
  }
)

export const reviewPaper = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolvePaperStaff(uid, request.auth?.token || {})
    if (!REVIEW_ROLES.includes(staff.role)) throw new HttpsError('permission-denied', 'Paper reviewer access is required')
    const paperId = String(request.data?.paperId || '')
    const action = String(request.data?.action || '')
    if (!paperId || paperId.includes('/') || !['approve', 'request_modification', 'reject'].includes(action)) {
      throw new HttpsError('invalid-argument', 'Paper review request is invalid')
    }
    const topic = boundedString(request.data?.topic, 'topic', 200)
    const questionNumbers = boundedString(request.data?.questionNumbers, 'questionNumbers', 200)
    const remarks = boundedString(request.data?.remarks, 'remarks', 2000, action !== 'approve')
    const db = getFirestore(admin.app(), 'default')
    const ref = db.collection('papers').doc(paperId)
    const auditRef = db.collection('paperReviewAudit').doc()
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref)
      const paper = current.data()
      if (!current.exists || !paper) throw new HttpsError('not-found', 'Paper not found')
      if (staff.role !== 'superadmin' && paper.collegeId !== staff.collegeId) {
        throw new HttpsError('permission-denied', 'Paper belongs to another college')
      }
      const currentStatus = String(paper.verificationStatus || paper.status || '')
      if (!['submitted-for-approval', 'pending-verification'].includes(currentStatus)) {
        throw new HttpsError('failed-precondition', 'Only submitted papers can be reviewed')
      }
      const approved = action === 'approve'
      const nextStatus = approved
        ? 'approved-by-hod'
        : action === 'reject' ? 'rejected-by-hod' : 'modification-requested'
      transaction.update(ref, {
        status: approved ? 'published' : 'draft',
        verificationStatus: nextStatus,
        reviewedBy: uid,
        reviewedByName: staff.name,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        approvalRemarks: remarks,
        requestedChanges: approved ? null : { topic, questionNumbers, remarks },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(approved ? { publishedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      })
      transaction.create(auditRef, {
        paperId,
        collegeId: paper.collegeId,
        action,
        fromStatus: currentStatus,
        toStatus: nextStatus,
        remarks,
        requestedChanges: approved ? null : { topic, questionNumbers, remarks },
        performedBy: uid,
        performedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })
    return { success: true }
  }
)

// ─── submitPaperForReview — author moves an editable paper into the queue ──
//
// The client must NEVER write `status` / `verificationStatus` directly — the
// Firestore rules lock those fields on /papers (client updates are denied
// with "Missing or insufficient permissions"). Submission is therefore a
// server-side transition, mirroring reviewPaper: author (or a reviewer) moves
// an editable paper into the approval queue, with an audit entry.
//
// Input:  { paperId: string }
// Output: { success: true }

/**
 * State gate for paper submission, extracted for unit tests. A paper may be
 * submitted only while editable (draft / returned); papers already in the
 * review queue or approved/published are locked.
 */
export function submissionReadiness(paper: {
  verificationStatus?: unknown;
  status?: unknown;
} | undefined): { currentStatus: string; submittable: boolean } {
  const currentStatus = String(paper?.verificationStatus || paper?.status || 'draft')
  return { currentStatus, submittable: EDITABLE_STATES.includes(currentStatus) }
}

export const submitPaperForReview = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolvePaperStaff(uid, request.auth?.token || {})
    const paperId = String(request.data?.paperId || '')
    if (!paperId || paperId.includes('/') || paperId.length > 200) {
      throw new HttpsError('invalid-argument', 'Paper identifier is required')
    }
    const db = getFirestore(admin.app(), 'default')
    const ref = db.collection('papers').doc(paperId)
    const auditRef = db.collection('paperReviewAudit').doc()
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref)
      const paper = current.data()
      if (!current.exists || !paper) throw new HttpsError('not-found', 'Paper not found')
      if (staff.role !== 'superadmin' && paper.collegeId !== staff.collegeId) {
        throw new HttpsError('permission-denied', 'Paper belongs to another college')
      }
      if (staff.role !== 'superadmin' && !REVIEW_ROLES.includes(staff.role) && paper.createdBy !== uid) {
        throw new HttpsError('permission-denied', 'Only the author or a reviewer can submit this paper')
      }
      const { currentStatus, submittable } = submissionReadiness(paper)
      if (!submittable) {
        throw new HttpsError(
          'failed-precondition',
          'Only draft or returned papers can be submitted for review'
        )
      }
      transaction.update(ref, {
        status: 'draft',
        verificationStatus: 'submitted-for-approval',
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      transaction.create(auditRef, {
        paperId,
        collegeId: paper.collegeId,
        action: 'submit',
        fromStatus: currentStatus,
        toStatus: 'submitted-for-approval',
        performedBy: uid,
        performedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })
    return { success: true }
  }
)

// ─── reopenPaperForEditing — move a locked paper back to draft ─────────────
//
// Once a paper is submitted / self-published / reviewer-approved it is locked
// from savePaper (canEditExistingPaper). If the author then finds a fixable
// defect (the classic case: an MCQ that lost its options), the only way back
// is to re-open it as a draft. This is server-authoritative, with an audit
// entry, and is the recovery path the editor's "Re-open for editing" button
// calls. A reviewer may also re-open a reviewer-approved paper.

const AUTHOR_REOPEN_STATES = ['submitted-for-approval', 'pending-verification', 'not-required']
const REVIEWER_REOPEN_STATES = [...AUTHOR_REOPEN_STATES, 'approved-by-hod']

/** Gate for reopenPaperForEditing, extracted for unit tests. */
export function reopenReadiness(
  paper: { verificationStatus?: unknown; status?: unknown } | undefined,
  staff: { role: string },
  uid: string,
  createdBy: unknown
): { currentStatus: string; allowed: boolean } {
  const currentStatus = String(paper?.verificationStatus || paper?.status || 'draft')
  const isReviewer = REVIEW_ROLES.includes(staff.role) || staff.role === 'superadmin'
  const isAuthor = String(createdBy || '') === uid
  const allowedStates = isReviewer ? REVIEWER_REOPEN_STATES : AUTHOR_REOPEN_STATES
  const allowed = allowedStates.includes(currentStatus) && (isReviewer || isAuthor)
  return { currentStatus, allowed }
}

export const reopenPaperForEditing = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolvePaperStaff(uid, request.auth?.token || {})
    const paperId = String(request.data?.paperId || '')
    if (!paperId || paperId.includes('/') || paperId.length > 200) {
      throw new HttpsError('invalid-argument', 'Paper identifier is required')
    }
    const db = getFirestore(admin.app(), 'default')
    const ref = db.collection('papers').doc(paperId)
    const auditRef = db.collection('paperReviewAudit').doc()
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref)
      const paper = current.data()
      if (!current.exists || !paper) throw new HttpsError('not-found', 'Paper not found')
      if (staff.role !== 'superadmin' && paper.collegeId !== staff.collegeId) {
        throw new HttpsError('permission-denied', 'Paper belongs to another college')
      }
      const { currentStatus, allowed } = reopenReadiness(paper, staff, uid, paper.createdBy)
      if (!allowed) {
        throw new HttpsError(
          'failed-precondition',
          'This paper cannot be re-opened in its current state'
        )
      }
      transaction.update(ref, {
        status: 'draft',
        verificationStatus: 'draft',
        publishedAt: null,
        submittedAt: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      transaction.create(auditRef, {
        paperId,
        collegeId: paper.collegeId,
        action: 'reopen',
        fromStatus: currentStatus,
        toStatus: 'draft',
        performedBy: uid,
        performedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    })
    return { success: true }
  }
)

// ─── deletePaper — safe removal of a paper and what its Confirm owned ──────

/** States in which a paper is inside the approval queue and must not vanish. */
export const UNDER_REVIEW_STATES = ['submitted-for-approval', 'pending-verification']

export interface PaperDeleteDecision {
  ok: boolean
  reason?: 'under-review' | 'reviewer-only' | 'forbidden'
}

/**
 * Who may delete a paper and when (the college match and the active-test link
 * are checked by the callable itself):
 *   • never while the paper is under review — reviewers must return/reject it first;
 *   • `approved-by-hod` / `published` papers are reviewer-only;
 *   • everything else: the paper's author or a reviewer.
 */
export function canDeletePaper(
  paper: { verificationStatus?: unknown; status?: unknown; createdBy?: unknown },
  staff: { role: string; uid: string }
): PaperDeleteDecision {
  const verificationStatus = String(paper.verificationStatus || paper.status || 'draft')
  const isReviewer = REVIEW_ROLES.includes(staff.role)
  const isAuthor = String(paper.createdBy || '') === staff.uid
  if (UNDER_REVIEW_STATES.includes(verificationStatus)) return { ok: false, reason: 'under-review' }
  if (verificationStatus === 'approved-by-hod' || verificationStatus === 'published' || String(paper.status || '') === 'published') {
    return isReviewer ? { ok: true } : { ok: false, reason: 'reviewer-only' }
  }
  if (!isReviewer && !isAuthor) return { ok: false, reason: 'forbidden' }
  return { ok: true }
}

/**
 * A paper stays linked to every test that has not been cancelled (scheduled,
 * published, ongoing or completed) — the test keeps its own copy of the
 * questions, but the paper record is the audit anchor for those results.
 */
export function hasActiveScheduledTest(tests: Array<{ status?: unknown } | null | undefined>): boolean {
  return tests.some((test) => Boolean(test) && String((test as { status?: unknown }).status ?? '') !== 'cancelled')
}

const DELETE_REJECTIONS: Record<NonNullable<PaperDeleteDecision['reason']>, { code: 'failed-precondition' | 'permission-denied'; message: string }> = {
  'under-review': {
    code: 'failed-precondition',
    message: 'This paper is under review and cannot be deleted. Ask the reviewer to return it (modification requested) or reject it first.',
  },
  'reviewer-only': {
    code: 'permission-denied',
    message: 'Approved or published papers can only be deleted by a reviewer (HOD, principal, admin or superadmin).',
  },
  forbidden: {
    code: 'permission-denied',
    message: 'Staff may delete only papers they authored.',
  },
}

export const deletePaper = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 120, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolvePaperStaff(uid, request.auth?.token || {})
    const paperId = String(request.data?.paperId || '')
    const requestedCollege = String(request.data?.collegeId || '')
    const collegeId = staff.role === 'superadmin' ? requestedCollege : staff.collegeId
    if (!paperId || paperId.includes('/') || paperId.length > 200 || !collegeId) {
      throw new HttpsError('invalid-argument', 'Paper and college identifiers are required')
    }

    const db = getFirestore(admin.app(), 'default')
    const ref = db.collection('papers').doc(paperId)
    const before = await ref.get()
    const paper = before.data()
    if (!before.exists || !paper) throw new HttpsError('not-found', 'Paper not found')
    if (staff.role !== 'superadmin' && paper.collegeId !== collegeId) {
      throw new HttpsError('permission-denied', 'Paper belongs to another college')
    }

    const decision = canDeletePaper(paper, staff)
    if (!decision.ok && decision.reason) {
      const rejection = DELETE_REJECTIONS[decision.reason]
      throw new HttpsError(rejection.code, rejection.message)
    }

    // Never delete a paper that a live test still references. Single-field
    // query, cancelled tests filtered in memory — no composite index needed.
    const linked = await db.collection('scheduledTests')
      .where('paperId', '==', paperId)
      .limit(100)
      .get()
    const activeTest = linked.docs.find((doc) => String(doc.data().status ?? '') !== 'cancelled')
    if (activeTest) {
      const title = String(activeTest.data().title || 'a scheduled test')
      throw new HttpsError(
        'failed-precondition',
        `This paper is linked to the scheduled test "${title}". Cancel that test before deleting the paper.`
      )
    }

    // Bank cleanup follows the Confirm's ownership model: documents this paper
    // created are deleted (source tag + paperId), shared bank documents are
    // only unlinked.
    const previousIds = [...new Set(
      (Array.isArray(paper.questionIds) ? paper.questionIds : [])
        .concat(Array.isArray(paper.linkedQuestionIds) ? paper.linkedQuestionIds : [])
        .map((id: unknown) => String(id))
        .filter(Boolean)
    )]
    const owned: string[] = []
    const shared: string[] = []
    for (let i = 0; i < previousIds.length; i += 100) {
      const chunk = previousIds.slice(i, i + 100)
      if (chunk.length === 0) break
      const docs = await db.getAll(...chunk.map((id) => db.collection('questions').doc(id)))
      docs.forEach((docSnap) => {
        const data = docSnap.data()
        if (!data) return
        if (data.source === 'paper-confirm' && String(data.paperId || '') === paperId) owned.push(docSnap.id)
        else shared.push(docSnap.id)
      })
    }

    const verificationStatus = String(paper.verificationStatus || paper.status || 'draft')
    const auditRef = db.collection('paperReviewAudit').doc()
    const auditData = {
      paperId,
      collegeId: String(paper.collegeId || collegeId),
      action: 'paper_deleted',
      fromStatus: verificationStatus,
      toStatus: 'deleted',
      removedQuestions: owned.length,
      unlinkedQuestions: shared.length,
      performedBy: uid,
      performedAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    const unlinkShared = (writer: { update: (target: FirebaseFirestore.DocumentReference, data: admin.firestore.DocumentData) => void }) => {
      shared.forEach((id) => {
        writer.update(db.collection('questions').doc(id), {
          linkedPaperIds: admin.firestore.FieldValue.arrayRemove(paperId),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      })
    }

    const operationCount = owned.length + shared.length + 2
    if (operationCount <= 480) {
      // Typical paper: unlinks, owned deletes, audit and the paper deletion
      // are ONE transaction with the same optimistic-concurrency guard the
      // Confirm uses — nothing can half-delete a paper.
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref)
        if (!current.exists || current.updateTime?.isEqual(before.updateTime!) !== true) {
          throw new HttpsError('aborted', 'Paper changed while it was being deleted; reload and try again')
        }
        unlinkShared(transaction)
        owned.forEach((id) => transaction.delete(db.collection('questions').doc(id)))
        transaction.create(auditRef, auditData)
        transaction.delete(ref)
      })
    } else {
      // Very large paper: unlinks run first (idempotent), the guarded
      // transaction then commits audit + paper deletion; owned-question
      // cleanup is delayed afterwards — the same ordering guarantee as the
      // Confirm path, so an aborted transaction can never delete docs the
      // paper still points at.
      for (let i = 0; i < shared.length; i += 450) {
        const batch = db.batch()
        shared.slice(i, i + 450).forEach((id) => {
          batch.update(db.collection('questions').doc(id), {
            linkedPaperIds: admin.firestore.FieldValue.arrayRemove(paperId),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        })
        await batch.commit()
      }
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref)
        if (!current.exists || current.updateTime?.isEqual(before.updateTime!) !== true) {
          throw new HttpsError('aborted', 'Paper changed while it was being deleted; reload and try again')
        }
        transaction.create(auditRef, auditData)
        transaction.delete(ref)
      })
      const cleanup = db.batch()
      owned.forEach((id) => cleanup.delete(db.collection('questions').doc(id)))
      await cleanup.commit().catch((err) => {
        logger.warn('[PaperWorkflow] Deferred cleanup of paper-owned question docs failed', err)
      })
    }

    // Storage is best-effort: the DB state is authoritative once committed.
    const storedPaths = [paper.filePath, paper.answerKeyPath]
      .map((value) => String(value || ''))
      .filter(Boolean)
    await Promise.all(
      storedPaths.map(async (path) => {
        try {
          await admin.storage().bucket().file(path).delete({ ignoreNotFound: true })
        } catch (err) {
          logger.warn('[PaperWorkflow] Paper storage file could not be removed', { paperId, path, err })
        }
      })
    )

    logger.info('[PaperWorkflow] Paper deleted', {
      paperId,
      collegeId,
      performedBy: uid,
      removedQuestions: owned.length,
      unlinkedQuestions: shared.length,
    })
    return { status: 'deleted', paperId, removedQuestions: owned.length, unlinkedQuestions: shared.length }
  }
)

export const getPaperFileDownload = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolvePaperStaff(uid, request.auth?.token || {})
    const paperId = String(request.data?.paperId || '')
    const kind = String(request.data?.kind || 'paper')
    if (!paperId || paperId.includes('/') || !['paper', 'answer-key'].includes(kind)) {
      throw new HttpsError('invalid-argument', 'Paper download request is invalid')
    }
    const snapshot = await getFirestore(admin.app(), 'default').collection('papers').doc(paperId).get()
    const paper = snapshot.data()
    if (!snapshot.exists || !paper) throw new HttpsError('not-found', 'Paper not found')
    if (staff.role !== 'superadmin' && paper.collegeId !== staff.collegeId) {
      throw new HttpsError('permission-denied', 'Paper belongs to another college')
    }
    const path = String(kind === 'answer-key' ? paper.answerKeyPath || '' : paper.filePath || '')
    if (!path) throw new HttpsError('not-found', 'The requested paper file is not attached')
    const file = admin.storage().bucket().file(path)
    const [exists] = await file.exists()
    if (!exists) throw new HttpsError('not-found', 'The requested paper file is unavailable')
    const expiresAt = Date.now() + 5 * 60 * 1000
    const [url] = await file.getSignedUrl({ action: 'read', expires: expiresAt })
    return {
      url,
      fileName: String(kind === 'answer-key' ? paper.answerKeyName || 'answer-key' : paper.fileName || 'paper'),
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }
)
