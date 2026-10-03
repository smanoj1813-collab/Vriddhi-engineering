import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
import { createHash } from 'node:crypto'
import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

interface GradeStaff {
  uid: string
  role: string
  collegeId: string
}

interface DraftGradeInput {
  studentId: string
  semester: number
  subject: string
  code: string
  grade: string
  credits?: number
  internal?: number
  external?: number
  total?: number
  gradePoint?: number
}

interface ManagedGradeRecord extends FirebaseFirestore.DocumentData {
  id: string
  semester: number
  code: string
  createdAt: string
  updatedAt: string
  publishedAt?: string
}

/**
 * Who may touch official grade records, per stage.
 *
 * Drafts are preparation work: a Vriddhi platform employee grades inside their
 * active college and leaves drafts behind. Publishing is the approval step and
 * stays with the institution (HOD / admin / principal / superadmin), so an
 * employee can never turn their own marks into a published transcript.
 */
export type GradeStage = 'draft' | 'publish'

export const GRADE_STAGE_ROLES: Record<GradeStage, readonly string[]> = {
  draft: ['superadmin', 'admin', 'principal', 'hod', 'employee'],
  publish: ['superadmin', 'admin', 'principal', 'hod'],
}

export function gradeStageAllows(stage: GradeStage, role: unknown): boolean {
  return GRADE_STAGE_ROLES[stage].includes(String(role || '').trim().toLowerCase())
}

async function resolveGradeStaff(
  uid: string,
  token: Record<string, unknown>,
  stage: GradeStage,
): Promise<GradeStaff> {
  const userDoc = await getFirestore(admin.app(), 'default').collection('users').doc(uid).get()
  const user = userDoc.data()
  const role = String(token.role || user?.role || '')
  const collegeId = String(token.collegeId || user?.collegeId || '')
  if (
    !userDoc.exists
    || !gradeStageAllows(stage, role)
    || (role !== 'superadmin' && !collegeId)
  ) {
    throw new HttpsError(
      'permission-denied',
      stage === 'draft'
        ? 'Registrar-grade access is required'
        : 'Only the college HOD, admin, principal or a superadmin can publish official grades',
    )
  }
  return { uid, role, collegeId }
}

function optionalNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpsError('invalid-argument', `${field} must be between ${minimum} and ${maximum}`)
  }
  return parsed
}

export function validateDraftGradeRecord(value: unknown): DraftGradeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'Grade record is invalid')
  }
  const input = value as Record<string, unknown>
  const studentId = String(input.studentId || '').trim()
  const semester = Number(input.semester)
  const subject = String(input.subject || input.courseName || '').trim()
  const code = String(input.code || input.courseCode || '').trim().toUpperCase()
  const grade = String(input.grade || '').trim().toUpperCase()
  const credits = optionalNumber(input.credits, 'credits', 0, 30)
  const internal = optionalNumber(input.internal, 'internal', 0, 1000)
  const external = optionalNumber(input.external, 'external', 0, 1000)
  const total = optionalNumber(input.total, 'total', 0, 2000)
  const gradePoint = optionalNumber(input.gradePoint, 'gradePoint', 0, 10)
  if (!studentId || studentId.includes('/') || !Number.isInteger(semester) || semester < 1 || semester > 20) {
    throw new HttpsError('invalid-argument', 'Student and semester are required')
  }
  if (subject.length < 2 || subject.length > 200 || code.length < 1 || code.length > 50) {
    throw new HttpsError('invalid-argument', 'Subject and course code are required')
  }
  if (!/^[A-Z][A-Z0-9+-]{0,4}$/.test(grade)) {
    throw new HttpsError('invalid-argument', 'Grade must be a valid letter grade')
  }
  if (internal !== undefined && external !== undefined && total !== undefined) {
    const calculated = Math.round((internal + external) * 100) / 100
    if (Math.abs(calculated - total) > 0.01) {
      throw new HttpsError('invalid-argument', 'Total must equal internal plus external marks')
    }
  }
  return {
    studentId,
    semester,
    subject,
    code,
    grade,
    ...(credits === undefined ? {} : { credits }),
    ...(internal === undefined ? {} : { internal }),
    ...(external === undefined ? {} : { external }),
    ...(total === undefined ? {} : { total }),
    ...(gradePoint === undefined ? {} : { gradePoint }),
  }
}

export function deterministicGradeRecordId(collegeId: string, studentId: string, semester: number, code: string): string {
  return createHash('sha256')
    .update(`${collegeId}\u0000${studentId}\u0000${semester}\u0000${code}`)
    .digest('hex')
}

function iso(value: unknown): string {
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString()
  return ''
}

function recordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && !id.includes('/'))
  return [...new Set(ids)].slice(0, 200)
}

export const listManagedGradeRecords = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 30 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveGradeStaff(uid, request.auth?.token || {}, 'draft')
    const collegeId = staff.role === 'superadmin' ? String(request.data?.collegeId || '') : staff.collegeId
    const status = String(request.data?.status || '')
    if (!collegeId || (status && !['draft', 'published'].includes(status))) {
      throw new HttpsError('invalid-argument', 'College or status is invalid')
    }
    let query: FirebaseFirestore.Query = getFirestore(admin.app(), 'default').collection('gradeRecords')
      .where('collegeId', '==', collegeId)
    if (status) query = query.where('status', '==', status)
    const snapshot = await query.limit(500).get()
    const records: ManagedGradeRecord[] = snapshot.docs.map((record) => {
      const data = record.data()
      return {
        ...data,
        id: record.id,
        semester: Number(data.semester),
        code: String(data.code || ''),
        createdAt: iso(data.createdAt),
        updatedAt: iso(data.updatedAt),
        publishedAt: iso(data.publishedAt) || undefined,
      }
    }).sort((left, right) => {
      const semesterDifference = Number(right.semester) - Number(left.semester)
      return semesterDifference || String(left.code).localeCompare(String(right.code))
    })
    return { records }
  }
)

export const saveDraftGradeRecords = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 120, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveGradeStaff(uid, request.auth?.token || {}, 'draft')
    const collegeId = staff.role === 'superadmin' ? String(request.data?.collegeId || '') : staff.collegeId
    const values: unknown[] = Array.isArray(request.data?.records) ? request.data.records : []
    if (!collegeId || values.length < 1 || values.length > 200) {
      throw new HttpsError('invalid-argument', 'Provide between 1 and 200 grade records')
    }
    const records = values.map(validateDraftGradeRecord)
    const duplicateIds = new Set<string>()
    records.forEach((record) => {
      const id = deterministicGradeRecordId(collegeId, record.studentId, record.semester, record.code)
      if (duplicateIds.has(id)) throw new HttpsError('invalid-argument', 'Duplicate student/course grade in request')
      duplicateIds.add(id)
    })
    const db = getFirestore(admin.app(), 'default')
    const studentIds = [...new Set(records.map((record) => record.studentId))]
    const studentRefs = studentIds.map((id) => db.collection('students').doc(id))
    const refs = records.map((record) => db.collection('gradeRecords').doc(
      deterministicGradeRecordId(collegeId, record.studentId, record.semester, record.code)
    ))
    const auditRefs = records.map(() => db.collection('gradeRecordAudit').doc())
    await db.runTransaction(async (transaction) => {
      const students = await transaction.getAll(...studentRefs)
      const existing = await transaction.getAll(...refs)
      const studentNames = new Map<string, { name: string; regNo: string }>()
      students.forEach((student) => {
        const data = student.data()
        if (!student.exists || data?.collegeId !== collegeId) {
          throw new HttpsError('invalid-argument', 'One or more students are invalid')
        }
        studentNames.set(student.id, {
          name: String(data?.name || ''),
          regNo: String(data?.regNo || data?.registrationNumber || ''),
        })
      })
      if (existing.some((record) => record.exists && record.data()?.status === 'published')) {
        throw new HttpsError('failed-precondition', 'Published records cannot be overwritten; create an authorized correction')
      }
      records.forEach((record, index) => {
        const student = studentNames.get(record.studentId)!
        transaction.set(refs[index], {
          ...record,
          collegeId,
          studentName: student.name,
          studentRegNo: student.regNo,
          status: 'draft',
          createdBy: existing[index].exists ? existing[index].data()?.createdBy || uid : uid,
          createdAt: existing[index].exists
            ? existing[index].data()?.createdAt || admin.firestore.FieldValue.serverTimestamp()
            : admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: uid,
        })
        transaction.create(auditRefs[index], {
          gradeRecordId: refs[index].id,
          collegeId,
          studentId: record.studentId,
          semester: record.semester,
          code: record.code,
          action: existing[index].exists ? 'draft_updated' : 'draft_created',
          snapshot: record,
          performedBy: uid,
          performedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      })
    })
    return { saved: records.length, ids: refs.map((ref) => ref.id) }
  }
)

export const publishGradeRecords = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveGradeStaff(uid, request.auth?.token || {}, 'publish')
    const ids = recordIds(request.data?.ids)
    if (ids.length < 1) throw new HttpsError('invalid-argument', 'Choose at least one draft record')
    const db = getFirestore(admin.app(), 'default')
    const refs = ids.map((id) => db.collection('gradeRecords').doc(id))
    const auditRefs = ids.map(() => db.collection('gradeRecordAudit').doc())
    await db.runTransaction(async (transaction) => {
      const docs = await transaction.getAll(...refs)
      docs.forEach((record) => {
        const data = record.data()
        if (!record.exists || !data || data.status !== 'draft') {
          throw new HttpsError('failed-precondition', 'Every selected record must be an existing draft')
        }
        if (staff.role !== 'superadmin' && data.collegeId !== staff.collegeId) {
          throw new HttpsError('permission-denied', 'A selected record belongs to another college')
        }
      })
      refs.forEach((ref, index) => {
        const data = docs[index].data()!
        transaction.update(ref, {
          status: 'published',
          publishedAt: admin.firestore.FieldValue.serverTimestamp(),
          publishedBy: uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        transaction.create(auditRefs[index], {
          gradeRecordId: ref.id,
          collegeId: data.collegeId,
          studentId: data.studentId,
          semester: data.semester,
          code: data.code,
          action: 'published',
          performedBy: uid,
          performedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      })
    })
    return { published: ids.length }
  }
)

export const deleteDraftGradeRecords = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveGradeStaff(uid, request.auth?.token || {}, 'publish')
    const ids = recordIds(request.data?.ids)
    if (ids.length < 1) throw new HttpsError('invalid-argument', 'Choose at least one draft record')
    const db = getFirestore(admin.app(), 'default')
    const refs = ids.map((id) => db.collection('gradeRecords').doc(id))
    const auditRefs = ids.map(() => db.collection('gradeRecordAudit').doc())
    await db.runTransaction(async (transaction) => {
      const docs = await transaction.getAll(...refs)
      docs.forEach((record) => {
        const data = record.data()
        if (!record.exists || !data || data.status !== 'draft') {
          throw new HttpsError('failed-precondition', 'Only draft records can be deleted')
        }
        if (staff.role !== 'superadmin' && data.collegeId !== staff.collegeId) {
          throw new HttpsError('permission-denied', 'A selected record belongs to another college')
        }
      })
      refs.forEach((ref, index) => {
        const data = docs[index].data()!
        transaction.delete(ref)
        transaction.create(auditRefs[index], {
          gradeRecordId: ref.id,
          collegeId: data.collegeId,
          studentId: data.studentId,
          semester: data.semester,
          code: data.code,
          action: 'draft_deleted',
          deletedSnapshot: data,
          performedBy: uid,
          performedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      })
    })
    return { deleted: ids.length }
  }
)
