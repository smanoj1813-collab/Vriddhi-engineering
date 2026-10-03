import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/officeStaff.ts
//
// College office staff — the ACCOUNTS team (fees, payments, vendor bills,
// payroll preparation and post-approval processing) and the OPERATIONS team
// (library, inventory, stores, procurement). The principal reviews and approves payroll.
//
// SUPERADMIN ONLY. Accounts are created from the superadmin's Create Admin
// form (grantUserRole with role accounts / operations, which also writes the
// roster row colleges/{cid}/officeStaff/{uid}). This callable manages them
// afterwards from the superadmin Admins list:
//
//   manageOfficeStaff({ action: 'deactivate' | 'reactivate', uid })
//       → disables / re-enables sign-in and flags users/{uid} + the roster.
//   manageOfficeStaff({ action: 'resetPassword', uid })
//       → issues a new temporary password.
//
// Authorisation comes from the caller's verified claim or the superadmin
// identity documents — never from anything the client sends.

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { OFFICE_ROLES, generateRandomPassword } from './identityShared'

type Action = 'deactivate' | 'reactivate' | 'resetPassword'

/** Pure authorisation decision — unit tested. Only a superadmin may manage office staff. */
export function decideOfficeStaffAccess(input: {
  callerRole: string
  targetCollegeId: string | null
}): { ok: true; collegeId: string } | { ok: false; reason: string } {
  if (String(input.callerRole || '').toLowerCase() !== 'superadmin') {
    return { ok: false, reason: 'Only a superadmin can manage accounts and operations staff.' }
  }
  if (!input.targetCollegeId) return { ok: false, reason: 'This account is not linked to a college.' }
  return { ok: true, collegeId: input.targetCollegeId }
}

const clean = (v: unknown, max = 160) => String(v ?? '').trim().slice(0, max)

async function isSuperadmin(db: admin.firestore.Firestore, uid: string, tokenRole: string): Promise<boolean> {
  if (tokenRole === 'superadmin') return true
  const user = await db.doc(`users/${uid}`).get()
  if (user.exists && String(user.data()?.role || '').toLowerCase() === 'superadmin') return true
  return (await db.doc(`superadmins/${uid}`).get()).exists
}

export const manageOfficeStaff = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
    const db = getFirestore(admin.app(), 'default')
    const tokenRole = String((request.auth.token as Record<string, unknown>).role || '').toLowerCase()
    const callerRole = (await isSuperadmin(db, request.auth.uid, tokenRole)) ? 'superadmin' : tokenRole

    const data = (request.data || {}) as Record<string, unknown>
    const action = clean(data.action, 20) as Action

    if (action === 'deactivate' || action === 'reactivate' || action === 'resetPassword') {
      const uid = clean(data.uid, 128)
      if (!uid) throw new HttpsError('invalid-argument', 'uid is required')
      const target = await admin.auth().getUser(uid).catch(() => null)
      if (!target) throw new HttpsError('not-found', 'Account not found')
      const targetRole = String(target.customClaims?.role || '').toLowerCase()
      const targetCollege = target.customClaims?.collegeId ? String(target.customClaims.collegeId) : null
      if (!OFFICE_ROLES.includes(targetRole)) throw new HttpsError('failed-precondition', 'Not an office staff account.')
      const decision = decideOfficeStaffAccess({ callerRole, targetCollegeId: targetCollege })
      if (!decision.ok) throw new HttpsError('permission-denied', decision.reason)

      const now = admin.firestore.FieldValue.serverTimestamp()
      const rosterRef = db.doc(`colleges/${decision.collegeId}/officeStaff/${uid}`)
      if (action === 'resetPassword') {
        const password = generateRandomPassword()
        await admin.auth().updateUser(uid, { password })
        // Force every signed-in session to re-authenticate with the new
        // credential — same contract as resetUserPassword. Without this, a
        // device that still holds a refresh token keeps a live session after
        // the password it no longer knows was rotated.
        await admin.auth().revokeRefreshTokens(uid)
        await admin.auth().setCustomUserClaims(uid, { ...(target.customClaims || {}), mustChangePassword: true })
        await rosterRef.set({ updatedAt: now, passwordResetAt: now }, { merge: true })
        return { ok: true, uid, temporaryPassword: password }
      }
      const disabled = action === 'deactivate'
      await admin.auth().updateUser(uid, { disabled })
      if (disabled) await admin.auth().revokeRefreshTokens(uid)
      const status = disabled ? 'inactive' : 'active'
      await Promise.all([
        rosterRef.set({ status, updatedAt: now }, { merge: true }),
        db.doc(`users/${uid}`).set({ status, updatedAt: now }, { merge: true }),
      ])
      return { ok: true, uid, status }
    }

    throw new HttpsError('invalid-argument', 'Unknown action')
  },
)
