import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { verifyCaller } from './identityShared'

const MAX_BRANCHES = 20

function normalizeBranches(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'branches must be an array')
  }
  const branches = Array.from(
    new Set(value.map((item) => String(item || '').trim()).filter(Boolean))
  )
  if (branches.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one branch is required')
  }
  if (branches.length > MAX_BRANCHES) {
    throw new HttpsError('invalid-argument', `A faculty member can have at most ${MAX_BRANCHES} branches`)
  }
  if (branches.some((branch) => branch.length > 100)) {
    throw new HttpsError('invalid-argument', 'Each branch must be 100 characters or fewer')
  }
  return branches
}

/**
 * Preserve existing HOD document ids for ordinary branch names while safely
 * escaping a slash (Firestore otherwise interprets it as another path segment).
 */
function hodBranchKey(branch: string): string {
  return branch.replace(/%/g, '%25').replace(/\//g, '%2F')
}

/**
 * Changes all branch/program assignments for one faculty member.
 *
 * The faculty profile is not the only representation: authentication resolves
 * users/{uid} first and HOD discovery has one hods document per branch. Updating
 * only faculty/{id} makes the edit appear saved to a superadmin while the faculty
 * member still signs in under the old department. This callable keeps those
 * representations in one Admin SDK batch.
 */
export const updateFacultyBranches = onCall(
  {
    region: 'asia-south1',
    memory: '256MiB',
    timeoutSeconds: 60,
    maxInstances: 10,
  },
  async (request): Promise<{
    success: true
    facultyId: string
    branches: string[]
    department: string
  }> => {
    await verifyCaller(request, ['superadmin'])

    const facultyId = String(request.data?.facultyId || '').trim()
    if (!facultyId) throw new HttpsError('invalid-argument', 'facultyId is required')
    const branches = normalizeBranches(request.data?.branches)

    const db = getFirestore(admin.app(), 'default')
    const facultyRef = db.collection('faculty').doc(facultyId)
    const facultySnap = await facultyRef.get()
    if (!facultySnap.exists) throw new HttpsError('not-found', 'Faculty profile not found')

    const faculty = facultySnap.data() || {}
    const collegeId = String(faculty.collegeId || '').trim()
    if (!collegeId) {
      throw new HttpsError('failed-precondition', 'Faculty must be linked to a college before branches can be changed')
    }

    const oldBranches = Array.from(
      new Set(
        (Array.isArray(faculty.branches) && faculty.branches.length ? faculty.branches : [faculty.department])
          .map((item: unknown) => String(item || '').trim())
          .filter(Boolean)
      )
    )
    const isHOD = faculty.isHOD === true
    const uid = String(faculty.uid || '').trim()
    const oldHodRefs = oldBranches.map((branch) =>
      db.collection('hods').doc(`${collegeId}_${hodBranchKey(branch)}`)
    )
    const oldHodSnapshots = oldHodRefs.length ? await db.getAll(...oldHodRefs) : []
    const now = admin.firestore.FieldValue.serverTimestamp()
    const batch = db.batch()

    batch.update(facultyRef, {
      branches,
      department: branches[0],
      updatedAt: now,
    })

    if (uid) {
      batch.set(
        db.collection('users').doc(uid),
        { branches, department: branches[0], updatedAt: now },
        { merge: true }
      )
    }

    // Remove only directory rows still owned by this faculty member. Another
    // HOD may have replaced them since the profile was last edited.
    for (const oldHod of oldHodSnapshots) {
      if (oldHod.exists && String(oldHod.data()?.facultyId || '') === facultyId) {
        batch.delete(oldHod.ref)
      }
    }
    if (isHOD) {
      for (const branch of branches) {
        batch.set(
          db.collection('hods').doc(`${collegeId}_${hodBranchKey(branch)}`),
          {
            facultyId,
            ...(uid ? { uid } : {}),
            collegeId,
            department: branch,
            branches,
            name: String(faculty.name || `${faculty.firstName || ''} ${faculty.lastName || ''}`).trim(),
            email: String(faculty.email || '').trim().toLowerCase(),
            role: 'hod',
            assignedAt: now,
            updatedAt: now,
          },
          { merge: true }
        )
      }
    }

    await batch.commit()
    return { success: true, facultyId, branches, department: branches[0] }
  }
)
