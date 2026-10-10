import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// Server-side account provisioning. Clients must not assign roles.
//
// Ops-only callable (audit P2-8): as of 2026-10-10 no in-repo code calls
// provisionUser — no httpsCallable driver, no script. It exists for
// console-driven provisioning by privileged staff. Do NOT wire a client UI
// to it without product review; every success is audit-logged below with
// the actor, the target account and the tenant.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import {
  generateRandomPassword,
  verifyAuthAccount,
  withApiVersion,
} from './identityShared'

const STAFF_CREATOR_ROLES = ['superadmin', 'admin', 'hod']
const PRIVILEGED_ROLES = ['superadmin', 'admin', 'principal', 'hod']
const ALLOWED_ROLES = [
  'superadmin',
  'admin',
  'principal',
  'hod',
  'faculty',
  'mentor',
  'student',
  'parent',
  'accounts',
  'operations',
]

const generatePassword = generateRandomPassword

export const provisionUser = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required')
    }

    let callerDoc = await getFirestore(admin.app(), 'default').doc(`users/${request.auth.uid}`).get()
    let callerIsLegacySuperadmin = false
    if (!callerDoc.exists) {
      // Legacy superadmins may only have a superadmins/{uid} profile doc
      // (no users/{uid} doc and no custom claims). Accept it as proof of
      // identity, otherwise they cannot provision anyone.
      callerDoc = await getFirestore(admin.app(), 'default').doc(`superadmins/${request.auth.uid}`).get()
      callerIsLegacySuperadmin = callerDoc.exists
    }
    const caller = callerDoc.data()
    if (!caller) {
      throw new HttpsError('permission-denied', 'Caller profile not found')
    }
    const callerRole = callerIsLegacySuperadmin
      ? 'superadmin'
      : String(caller.role || '').toLowerCase()
    if (!STAFF_CREATOR_ROLES.includes(callerRole)) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to provision users')
    }

    const { email, name, role, password: providedPassword, collegeId: rawCollegeId } = request.data || {}
    // Trimmed before it lands on the users/profile document AND the claim:
    // the security rules compare collegeId strictly, so a pasted id with a
    // trailing space would permanently refuse this account's tenant writes —
    // and no staleness check would ever notice, because the client resolves
    // and compares trimmed values.
    const collegeId = rawCollegeId == null ? rawCollegeId : String(rawCollegeId).trim()
    if (!email || !name || !role) {
      throw new HttpsError('invalid-argument', 'email, name, and role are required')
    }
    const targetRole = String(role).toLowerCase()
    if (!ALLOWED_ROLES.includes(targetRole)) {
      throw new HttpsError('invalid-argument', 'Invalid role')
    }
    if (targetRole === 'superadmin' && callerRole !== 'superadmin') {
      throw new HttpsError('permission-denied', 'Only a superadmin may create superadmins')
    }
    if (PRIVILEGED_ROLES.includes(targetRole) && callerRole !== 'superadmin' && targetRole !== 'hod') {
      throw new HttpsError('permission-denied', 'Only a superadmin may create administrators')
    }
    if (targetRole === 'hod' && !['superadmin', 'admin'].includes(callerRole)) {
      throw new HttpsError('permission-denied', 'Only admin or superadmin may create HODs')
    }

    const tenantCollegeId =
      callerRole === 'superadmin' ? collegeId || caller.collegeId : caller.collegeId
    if (!tenantCollegeId && targetRole !== 'superadmin') {
      throw new HttpsError('invalid-argument', 'collegeId is required')
    }
    if (callerRole !== 'superadmin' && collegeId && collegeId !== caller.collegeId) {
      throw new HttpsError('permission-denied', 'Cannot provision users for another college')
    }

    const password = providedPassword && String(providedPassword).length >= 10
      ? String(providedPassword)
      : generatePassword()

    const userRecord = await admin.auth().createUser({
      email: String(email).trim().toLowerCase(),
      password,
      displayName: String(name).trim(),
    })

    // Never report a credential that does not work: read the account back.
    const verification = await verifyAuthAccount({
      uid: userRecord.uid,
      email: String(email).trim().toLowerCase(),
      expectedRole: targetRole,
    })
    if (!verification.ok) {
      throw new HttpsError(
        'internal',
        `Auth account could not be verified: ${verification.reason || 'unknown reason'}`
      )
    }

    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: targetRole,
      collegeId: tenantCollegeId || null,
      mustChangePassword: true,
    })

    const now = admin.firestore.FieldValue.serverTimestamp()
    await getFirestore(admin.app(), 'default').collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: String(email).trim().toLowerCase(),
      name: String(name).trim(),
      role: targetRole,
      collegeId: tenantCollegeId || null,
      createdBy: request.auth.uid,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      mustChangePassword: true,
    })

    logger.info('[provisionUser] created', {
      uid: userRecord.uid,
      email: String(email).trim().toLowerCase(),
      role: targetRole,
      collegeId: tenantCollegeId || null,
      by: request.auth.uid,
      byRole: callerRole,
    })

    return withApiVersion({
      success: true,
      uid: userRecord.uid,
      email: String(email).trim().toLowerCase(),
      temporaryPassword: password,
      authVerified: true,
      reauthenticateRequired: true,
    })
  }
)
