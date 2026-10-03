import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/collegeCleanup.ts
// Full college data cleanup — removes every college-scoped record so demo /
// current data can be wiped clean before a re-upload.
//
// Called from the Super Admin "Reset College Data" dialog. Replaces the old
// client-side reset that only cleared top-level students/faculty/admins and
// left behind orphaned data: users/{uid} lookup docs, Firebase Auth accounts,
// hods, curriculum, curriculumFacultyMappings, weeklySchedules,
// syllabusExtracts (college-scoped) and every colleges/{collegeId}
// subcollection listed in firestore.rules.
//
// SAFETY — Auth accounts are NOT deleted by default. Deleting a Firebase Auth
// account is irreversible and is the one action a provisioning repair must
// never take casually (a reset that deletes logins is how a college gets locked
// out). The caller must pass `deleteAuthUsers: true` explicitly; the default
// leaves Auth accounts intact (they are simply re-linked or re-created on the
// next import).

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'

const db = getFirestore(admin.app(), 'default')
const auth = admin.auth()

// Firestore write batches accept at most 500 operations per commit.
const BATCH_LIMIT = 500
// Auth deleteUsers accepts at most 1000 UIDs per call.
const AUTH_CHUNK = 1000

// Top-level collections scoped to a college via the `collegeId` field.
const COLLEGE_SCOPED_COLLECTIONS = [
  'students',
  'faculty',
  'admins',
  'hods',
  'curriculum',
  'curriculumFacultyMappings',
  'weeklySchedules',
  'syllabusExtracts',
] as const

// Subcollections documented under colleges/{collegeId} in firestore.rules.
const COLLEGE_SUBCOLLECTIONS = [
  'students',
  'config',
  'announcements',
  'schedules',
  'attendance',
  'attendanceRecords',
  'assessments',
  'scores',
  'activities',
  'milestones',
  'feeStructures',
  'feePayments',
  'faculty',
  'materials',
  'events',
  'notifications',
] as const

interface ResetResult {
  success: boolean
  collegeId: string
  totalDeleted: number
  authUsersDeleted: number
  deleted: Record<string, number>
  errors: string[]
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

async function deleteRefs(refs: admin.firestore.DocumentReference[]): Promise<number> {
  let deleted = 0
  for (const group of chunk(refs, BATCH_LIMIT)) {
    const batch = db.batch()
    for (const ref of group) batch.delete(ref)
    await batch.commit()
    deleted += group.length
  }
  return deleted
}

async function callerIsSuperadmin(uid: string): Promise<boolean> {
  const user = await db.doc(`users/${uid}`).get()
  if (user.exists && String(user.data()?.role || '').toLowerCase() === 'superadmin') return true
  return (await db.doc(`superadmins/${uid}`).get()).exists
}

export const resetCollegeData = onCall(
  {
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 540,
    minInstances: 0,
    maxInstances: 5,
  },
  async (request): Promise<ResetResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
    if (!(await callerIsSuperadmin(request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Only a superadmin can reset a college')
    }

    const { collegeId, deleteAuthUsers = false } = (request.data || {}) as {
      collegeId?: string
      deleteAuthUsers?: boolean
    }
    if (!collegeId || typeof collegeId !== 'string') {
      throw new HttpsError('invalid-argument', 'collegeId is required')
    }

    // Auth deletion is opt-in: the caller must pass deleteAuthUsers: true
    // explicitly. The default (false) never takes the one irreversible action
    // this tool performs — deleting Firebase Auth accounts.

    const errors: string[] = []
    const deleted: Record<string, number> = {}
    const uids = new Set<string>()
    let totalDeleted = 0

    const collegeRef = db.collection('colleges').doc(collegeId)
    const collegeSnap = await collegeRef.get()
    if (!collegeSnap.exists) {
      logger.warn(`[CollegeCleanup] College ${collegeId} not found — cleaning orphaned data anyway`)
    }

    // 1. Top-level college-scoped collections. UIDs found on these docs are
    //    collected so their Auth accounts + users/{uid} lookup docs can be
    //    removed too (step 2 and step 4).
    for (const name of COLLEGE_SCOPED_COLLECTIONS) {
      try {
        const snap = await db.collection(name).where('collegeId', '==', collegeId).get()
        const refs: admin.firestore.DocumentReference[] = []
        for (const doc of snap.docs) {
          refs.push(doc.ref)
          const data = doc.data()
          const uid = data.uid || data.userId
          if (typeof uid === 'string' && uid) uids.add(uid)
        }
        const n = await deleteRefs(refs)
        deleted[name] = n
        totalDeleted += n
      } catch (err: any) {
        errors.push(`${name}: ${err?.message || err}`)
        logger.error(`[CollegeCleanup] Failed to clean ${name}`, err)
      }
    }

    // 2. users/{uid} lookup docs for this college (keyed by uid).
    try {
      const snap = await db.collection('users').where('collegeId', '==', collegeId).get()
      const refs: admin.firestore.DocumentReference[] = []
      for (const doc of snap.docs) {
        uids.add(doc.id)
        refs.push(doc.ref)
      }
      const n = await deleteRefs(refs)
      deleted['users'] = n
      totalDeleted += n
    } catch (err: any) {
      errors.push(`users: ${err?.message || err}`)
      logger.error('[CollegeCleanup] Failed to clean users', err)
    }

    // 3. colleges/{collegeId} subcollections.
    for (const name of COLLEGE_SUBCOLLECTIONS) {
      try {
        const snap = await collegeRef.collection(name).get()
        const n = await deleteRefs(snap.docs.map((d) => d.ref))
        if (n > 0) {
          deleted[`colleges/${name}`] = n
          totalDeleted += n
        }
      } catch (err: any) {
        errors.push(`colleges/${name}: ${err?.message || err}`)
        logger.error(`[CollegeCleanup] Failed to clean colleges/${name}`, err)
      }
    }

    // 4. Firebase Auth accounts (default on — the re-upload recreates them).
    //
    //    Two independent sources are merged so an account can't survive a
    //    reset simply because its profile doc was missing:
    //      (a) UIDs read off the Firestore docs above (steps 1-2); and
    //      (b) every Auth account whose custom claims carry this collegeId —
    //          this catches accounts provisioned server-side even when their
    //          users/{uid} lookup doc never existed.
    //    listUsers walks the whole tenant, so it only runs when Auth deletion
    //    is enabled; accounts are deleted ONLY when their claim collegeId
    //    matches the reset college exactly (superadmins carry no collegeId).
    if (deleteAuthUsers) {
      try {
        let pageToken: string | undefined
        do {
          const page = await auth.listUsers(1000, pageToken)
          for (const record of page.users) {
            const claims = (record.customClaims || {}) as Record<string, unknown>
            if (claims.collegeId && String(claims.collegeId) === collegeId) {
              uids.add(record.uid)
            }
          }
          pageToken = page.pageToken
        } while (pageToken)
      } catch (err: any) {
        errors.push(`auth claim scan: ${err?.message || err}`)
        logger.error('[CollegeCleanup] Failed to scan Auth users by claim', err)
      }
    }

    let authUsersDeleted = 0
    if (deleteAuthUsers && uids.size > 0) {
      const uidList = Array.from(uids)
      for (const group of chunk(uidList, AUTH_CHUNK)) {
        try {
          const res = await auth.deleteUsers(group)
          authUsersDeleted += res.successCount
          for (const e of res.errors) {
            const label = typeof e.index === 'number' ? `uid ${group[e.index]}` : 'unknown uid'
            errors.push(`auth (${label}): ${e.error?.message || 'unknown error'}`)
          }
        } catch (err: any) {
          errors.push(`auth: ${err?.message || err}`)
          logger.error('[CollegeCleanup] Failed to delete auth users', err)
        }
      }
    }

    // 5. Reset college aggregate counters (the college doc itself stays).
    if (collegeSnap.exists) {
      try {
        await collegeRef.update({
          studentCount: 0,
          facultyCount: 0,
          adminCount: 0,
          currentStudents: 0,
          currentFaculty: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      } catch (err: any) {
        errors.push(`college counters: ${err?.message || err}`)
      }
    }

    // 6. Audit log.
    try {
      await db.collection('logs').add({
        action: 'RESET_COLLEGE_DATA',
        collegeId,
        performedBy: request.auth.uid,
        totalDeleted,
        authUsersDeleted,
        deleted,
        errors,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      })
    } catch (logError) {
      logger.error('[CollegeCleanup] Failed to write audit log', logError)
    }

    logger.info('[CollegeCleanup] Reset complete', {
      collegeId,
      totalDeleted,
      authUsersDeleted,
      errors,
    })

    return {
      success: errors.length === 0,
      collegeId,
      totalDeleted,
      authUsersDeleted,
      deleted,
      errors,
    }
  }
)
