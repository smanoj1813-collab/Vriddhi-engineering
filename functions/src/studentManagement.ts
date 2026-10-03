import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { verifyCaller } from './identityShared'

const MAX_STUDENTS = 500
const WRITE_CHUNK_SIZE = 150 // profile + user + college mirror = at most 450 writes

interface BulkAcademicInput {
  studentIds?: unknown
  batch?: unknown
  branch?: unknown
  semester?: unknown
}

interface BulkAcademicResult {
  requested: number
  updated: number
  missingIds: string[]
}

/** Semester is a small whole number; anything else is a client bug, not data. */
function optionalSemester(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const semester = Number(value)
  if (!Number.isInteger(semester) || semester < 1 || semester > 12) {
    throw new HttpsError('invalid-argument', 'Semester must be a whole number between 1 and 12')
  }
  return semester
}

function optionalField(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined
  const normalized = String(value).trim()
  if (!normalized) throw new HttpsError('invalid-argument', `${name} cannot be empty`)
  if (normalized.length > 100) {
    throw new HttpsError('invalid-argument', `${name} must be 100 characters or fewer`)
  }
  return normalized
}

/**
 * Bulk change a student cohort's batch, branch and/or semester while keeping
 * the canonical student profile, the auth lookup document, and the per-college
 * mirror consistent. An omitted field is left untouched for every student.
 */
export const bulkUpdateStudentAcademicFields = onCall(
  {
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 10,
  },
  async (request): Promise<BulkAcademicResult> => {
    await verifyCaller(request, ['superadmin'])

    const input = (request.data || {}) as BulkAcademicInput
    if (!Array.isArray(input.studentIds)) {
      throw new HttpsError('invalid-argument', 'studentIds must be an array')
    }
    const studentIds = Array.from(
      new Set(input.studentIds.map((id) => String(id || '').trim()).filter(Boolean))
    )
    if (studentIds.length === 0) {
      throw new HttpsError('invalid-argument', 'Select at least one student')
    }
    if (studentIds.length > MAX_STUDENTS) {
      throw new HttpsError('invalid-argument', `Update at most ${MAX_STUDENTS} students at a time`)
    }

    const nextBatch = optionalField(input.batch, 'Batch')
    const nextBranch = optionalField(input.branch, 'Branch')
    const nextSemester = optionalSemester(input.semester)
    if (nextBatch === undefined && nextBranch === undefined && nextSemester === undefined) {
      throw new HttpsError('invalid-argument', 'Choose a batch, branch and/or semester to update')
    }

    const db = getFirestore(admin.app(), 'default')
    const refs = studentIds.map((id) => db.collection('students').doc(id))
    const snapshots = await db.getAll(...refs)
    const existing = snapshots.filter((snapshot) => snapshot.exists)
    const missingIds = snapshots.filter((snapshot) => !snapshot.exists).map((snapshot) => snapshot.id)
    const now = admin.firestore.FieldValue.serverTimestamp()

    for (let offset = 0; offset < existing.length; offset += WRITE_CHUNK_SIZE) {
      const chunk = existing.slice(offset, offset + WRITE_CHUNK_SIZE)
      const write = db.batch()

      for (const snapshot of chunk) {
        const student = snapshot.data() || {}
        const academicUpdates: Record<string, unknown> = { updatedAt: now }
        if (nextBatch !== undefined) academicUpdates.batch = nextBatch
        if (nextSemester !== undefined) academicUpdates.semester = nextSemester
        if (nextBranch !== undefined) {
          // `branch` is canonical; `department` keeps legacy roster and report
          // queries working until all old consumers have migrated.
          academicUpdates.branch = nextBranch
          academicUpdates.department = nextBranch
        }
        write.update(snapshot.ref, academicUpdates)

        const uid = String(student.userId || student.uid || '').trim()
        if (uid) {
          write.set(db.collection('users').doc(uid), academicUpdates, { merge: true })
        }

        const collegeId = String(student.collegeId || '').trim()
        if (collegeId) {
          const mirrorId = String(student.regNo || snapshot.id).trim()
          write.set(
            db.collection('colleges').doc(collegeId).collection('students').doc(mirrorId),
            academicUpdates,
            { merge: true }
          )
        }
      }

      await write.commit()
    }

    return {
      requested: studentIds.length,
      updated: existing.length,
      missingIds,
    }
  }
)
