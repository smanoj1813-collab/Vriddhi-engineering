import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import {
  IDENTITY_API_VERSION,
  OFFICE_ROLES,
  generateRandomPassword,
  hasIdentityProfile,
  verifyAuthAccount,
} from './identityShared'
import { describeCollegeResolutionFailure, resolveCollegeReference } from './collegeResolve'

const db = getFirestore(admin.app(), 'default')
const ALLOWED_ROLES = ['superadmin', 'admin', 'principal', 'hod', 'mentor', 'faculty', 'student', 'parent', 'accounts', 'operations', 'employee'] as const
type Role = typeof ALLOWED_ROLES[number]

function password(): string {
  return generateRandomPassword()
}

async function callerIsSuperadmin(uid: string): Promise<boolean> {
  const user = await db.doc(`users/${uid}`).get()
  if (user.exists && String(user.data()?.role || '').toLowerCase() === 'superadmin') return true
  return (await db.doc(`superadmins/${uid}`).get()).exists
}

function clean(value: unknown, max = 160): string { return String(value ?? '').trim().slice(0, max) }

async function findByEmail(collectionName: string, email: string) {
  const snap = await db.collection(collectionName).where('email', '==', email).limit(5).get()
  return snap.docs
}

export const grantUserRole = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
    if (!(await callerIsSuperadmin(request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Only a superadmin can manage identities')
    }

    const input = request.data || {}
    const email = clean(input.email, 254).toLowerCase()
    const name = clean(input.name, 120)
    const role = clean(input.role, 30).toLowerCase() as Role
    // What the operator typed — resolved to a live document id below. Kept
    // separately so the error message can quote the original value.
    const collegeInput = clean(input.collegeId, 160) || null
    let collegeId: string | null = collegeInput
    // Optional department tag for admin/hod identities — stamped into the
    // custom claim so Firestore rules can scope their reads (empty ⇒ wide).
    const department = clean(input.department, 120) || null
    const providedPassword = clean(input.password, 128)
    if (!email || !email.includes('@') || !role || !ALLOWED_ROLES.includes(role)) {
      throw new HttpsError('invalid-argument', 'A valid email and supported role are required')
    }
    // `employee` is a Vriddhi-wide role: its colleges come from the employee
    // assignment screen (assignEmployeeColleges), not from a home college.
    if (role !== 'superadmin' && role !== 'employee' && !collegeId) {
      throw new HttpsError('invalid-argument', 'collegeId is required for this role')
    }
    if (providedPassword && providedPassword.length < 10) {
      throw new HttpsError('invalid-argument', 'Password must be at least 10 characters')
    }

    // The College ID is free text on the Access Control form. Accepting an
    // unknown id used to create a profile that no college page could ever
    // list (they all query by collegeId). Resolve it up front so the profile
    // is written with a live id plus the denormalised name/code the list
    // pages display.
    //
    // The value is resolved, not merely checked: operators know their college
    // by the *code* they chose on the Create College form (the list page shows
    // it, the CSVs key on it), while claims and rules key on the opaque
    // document id that appears nowhere but the URL. Insisting on the id here
    // produced "College … does not exist" for an operator who had typed the
    // code exactly right. See collegeResolve.ts.
    let college: { name: string; code: string } | null = null
    if (collegeInput) {
      const resolution = await resolveCollegeReference(db, collegeInput)
      if (resolution.kind !== 'resolved') {
        throw new HttpsError(
          resolution.kind === 'ambiguous' ? 'failed-precondition' : 'not-found',
          describeCollegeResolutionFailure(collegeInput, resolution)
        )
      }
      collegeId = resolution.college.id
      college = { name: resolution.college.name, code: resolution.college.code }
      if (resolution.matchedBy !== 'id') {
        logger.info('[grantUserRole] college resolved by ' + resolution.matchedBy, {
          input: collegeInput, collegeId, actorUid: request.auth.uid,
        })
      }
    }

    let authUser: admin.auth.UserRecord
    let created = false
    let generatedPassword: string | undefined
    try {
      authUser = await admin.auth().getUserByEmail(email)
    } catch (error: any) {
      if (error?.code !== 'auth/user-not-found') throw error
      if (!providedPassword && !name) {
        throw new HttpsError('not-found', 'No Auth user found. Supply a name and password to create one.')
      }
      generatedPassword = providedPassword || password()
      authUser = await admin.auth().createUser({ email, password: generatedPassword, displayName: name || email.split('@')[0] })
      created = true
    }

    const resolvedName = name || authUser.displayName || email.split('@')[0]
    const existingClaims = authUser.customClaims || {}
    const previousRole = typeof existingClaims.role === 'string' ? existingClaims.role : null
    const previousCollegeId = existingClaims.collegeId ?? null
    const roleChanged = previousRole !== role || previousCollegeId !== collegeId

    // Refuse to demote a superadmin.
    //
    // Granting a lesser role to a superadmin's own address deletes
    // superadmins/{uid} and rewrites users/{uid}.role — and callerIsSuperadmin()
    // reads exactly those two places. So the caller silently revokes the one
    // privilege that authorises this very function, with no way back through
    // the UI: every later call is rejected before it can repair anything.
    // Worse, claims are not what gates it, so a still-valid superadmin ID
    // token does not help.
    //
    // Demotion should be deliberate and auditable, so it belongs in a
    // service-account script rather than a form field.
    if (role !== 'superadmin' && (await callerIsSuperadmin(authUser.uid))) {
      if (authUser.uid === request.auth.uid) {
        throw new HttpsError(
          'failed-precondition',
          'This is your own superadmin account. Demoting it would lock you out of every ' +
            'privileged action with no way to undo it from the app. Use a service-account ' +
            'script (scripts/restore-superadmin.mjs has the inverse operation) if you intend this.'
        )
      }
      throw new HttpsError(
        'failed-precondition',
        `${email} is a superadmin. Demote them with a service-account script so the change is deliberate.`
      )
    }

    await admin.auth().setCustomUserClaims(authUser.uid, {
      ...existingClaims, role, collegeId, mustChangePassword: created || existingClaims.mustChangePassword === true,
      // Department tag for admin/hod scoping (preserved from the previous
      // claims when the caller omits it, e.g. role toggles).
      ...(department ? { department } : {}),
    })

    // Rules trust the custom claim before the profile document, so without this
    // a downgraded or moved account would keep its old privileges until the ID
    // token expired (up to an hour). Revoking refresh tokens forces the next
    // request to mint a token that carries the claims just written.
    if (roleChanged) {
      await admin.auth().revokeRefreshTokens(authUser.uid)
    }

    const now = admin.firestore.FieldValue.serverTimestamp()
    const batch: admin.firestore.WriteBatch = db.batch()
    batch.set(db.doc(`users/${authUser.uid}`), {
      uid: authUser.uid, email, name: resolvedName, role, collegeId,
      ...(department ? { department } : {}),
      status: 'active', updatedAt: now, ...(created ? { createdAt: now } : {}),
      managedBy: request.auth.uid,
    }, { merge: true })

    if (role === 'superadmin') {
      batch.set(db.doc(`superadmins/${authUser.uid}`), {
        uid: authUser.uid, email, name: resolvedName, role, status: 'active', updatedAt: now,
        ...(created ? { createdAt: now } : {}), managedBy: request.auth.uid,
      }, { merge: true })
    } else {
      batch.delete(db.doc(`superadmins/${authUser.uid}`))
    }

    const profileCollection = role === 'faculty' ? 'faculty' : ['admin', 'principal'].includes(role) ? 'admins' : role === 'hod' ? 'hods' : role === 'mentor' ? 'mentors' : null
    if (profileCollection) {
      // `findByEmail` returns document *snapshots*; WriteBatch needs a
      // reference. Using the snapshot directly made any second grant for the
      // same address — re-running an admin creation, or promoting someone who
      // already has a profile row — fail inside batch.set and take the whole
      // identity write down with it.
      const docs = await findByEmail(profileCollection, email)
      const target = docs[0]?.ref || db.doc(`${profileCollection}/${authUser.uid}`)

      // `status` and `createdAt` are not decoration: listAdmins() and
      // listFaculty() both query with orderBy('createdAt') and an optional
      // status filter, and Firestore silently omits any document that is
      // missing the ordered field. A profile written without them exists in
      // the console but is invisible in every list — which is exactly what
      // "created successfully but not showing anywhere" looks like.
      //
      // createdAt is only stamped when absent, so re-granting a role to an
      // existing account does not overwrite when they were first created.
      const existingProfile = docs[0] ? docs[0].data() : null
      batch.set(target, {
        uid: authUser.uid,
        email,
        name: resolvedName,
        role,
        collegeId,
        ...(college ? { collegeName: college.name, collegeCode: college.code } : {}),
        status: 'active',
        updatedAt: now,
        ...(existingProfile && existingProfile.createdAt ? {} : { createdAt: now }),
      }, { merge: true })
    }
    // Office roles (accounts / operations) have no profile collection of their
    // own; the college roster the principal manages lives under the college.
    if ((role === 'accounts' || role === 'operations') && collegeId) {
      batch.set(db.doc(`colleges/${collegeId}/officeStaff/${authUser.uid}`), {
        uid: authUser.uid, email, name: resolvedName, role, collegeId,
        status: 'active', updatedAt: now, managedBy: request.auth.uid,
      }, { merge: true })
    }
    if (role === 'student') {
      const docs = await findByEmail('students', email)
      for (const student of docs) batch.set(student.ref, { uid: authUser.uid, userId: authUser.uid, updatedAt: now }, { merge: true })
    }
    batch.create(db.collection('logs').doc(), {
      action: 'grantUserRole', targetUid: authUser.uid, targetEmail: email, role, collegeId,
      previousRole, previousCollegeId, revokedRefreshTokens: roleChanged,
      actorUid: request.auth.uid, createdAt: now, created,
    })
    await batch.commit()
    logger.info('[grantUserRole] identity wired', { targetUid: authUser.uid, role, actorUid: request.auth.uid })

    // Read the identity back so a grant is never reported before it is real.
    const verification = await verifyAuthAccount({ uid: authUser.uid, email, expectedRole: role })

    return {
      apiVersion: IDENTITY_API_VERSION,
      authVerified: verification.ok,
      success: true, uid: authUser.uid, email, role, collegeId, created,
      // Echo the resolved college so the form can confirm which tenant the
      // typed code/name landed on.
      collegeName: college?.name ?? null,
      collegeCode: college?.code ?? null,
      // The target must sign in again before the new claims and rules apply.
      reauthenticateRequired: roleChanged,
      temporaryPassword: created ? generatedPassword : undefined,
    }
  }
)

export const diagnoseIdentity = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
    if (!(await callerIsSuperadmin(request.auth.uid))) throw new HttpsError('permission-denied', 'Only a superadmin can audit identities')
    const email = clean(request.data?.email, 254).toLowerCase()
    if (!email) throw new HttpsError('invalid-argument', 'email is required')
    let authUser: admin.auth.UserRecord | null = null
    try { authUser = await admin.auth().getUserByEmail(email) } catch (e: any) { if (e?.code !== 'auth/user-not-found') throw e }
    const uid = authUser?.uid
    const result: Record<string, unknown> = {
      apiVersion: IDENTITY_API_VERSION,
      email,
      uid: uid || null,
      claims: authUser?.customClaims || {},
      // The rules read the role claim only, so a diagnosis without it is a
      // warning even when every profile document looks perfect.
      claimBacked: Boolean(authUser?.customClaims?.role),
    }
    const issues: string[] = []
    if (!uid) issues.push('No Firebase Auth account exists')
    if (uid) {
      for (const collectionName of ['users', 'superadmins', 'faculty', 'admins', 'hods', 'mentors', 'students']) {
        const snap = await db.doc(`${collectionName}/${uid}`).get()
        result[collectionName] = snap.exists ? { id: snap.id, ...snap.data() } : null
      }
      // NOTE: the "no identity profile document" check is deliberately NOT made
      // here. At this point the office roster has not been consulted yet, and
      // `accounts`/`operations` are filed only at
      // `colleges/{collegeId}/officeStaff/{uid}` — so for a correctly
      // provisioned office account both `result.users` and
      // `result.superadmins` are null. Reporting that as a missing profile is
      // a false positive: it reads as a broken identity and invites an operator
      // to "repair" an account that is perfectly healthy. The check runs below,
      // once the roster rows are known.

      // The college office roster. `accounts` and `operations` are the only
      // roles with no top-level profile collection — they are filed at
      // `colleges/{collegeId}/officeStaff/{uid}` and nowhere else. Without
      // this lookup the audit reported every office account as having no
      // profile at all, which is both false and the reason an office account
      // could not be diagnosed here. The college is taken from the users
      // document first and the claim second, because a drifted pair is
      // exactly the case this report exists to surface.
      const claimRole = String(authUser?.customClaims?.role || '').toLowerCase()
      const claimRoleCollege =
        typeof authUser?.customClaims?.collegeId === 'string'
          ? String(authUser.customClaims.collegeId)
          : null
      const officeColleges = [
        ...new Set(
          [
            (result.users as Record<string, unknown> | null)?.collegeId,
            authUser?.customClaims?.collegeId,
          ]
            .map((v) => (typeof v === 'string' ? v.trim() : ''))
            .filter(Boolean)
        ),
      ] as string[]
      const officeRows: Array<Record<string, unknown>> = []
      for (const cid of officeColleges) {
        const snap = await db.doc(`colleges/${cid}/officeStaff/${uid}`).get()
        if (snap.exists) officeRows.push({ collegeId: cid, ...(snap.data() as Record<string, unknown>) })
      }
      result.officeStaff = officeRows
      // An office-only account has no top-level profile document by design —
      // its roster row IS its identity. Only call the account unprovisioned
      // when it has neither a users/superadmins document nor a roster row.
      if (!hasIdentityProfile({ usersDoc: result.users, superadminDoc: result.superadmins, officeRows }))
        issues.push('No identity profile document exists')
      if (OFFICE_ROLES.includes(claimRole) && officeRows.length === 0) {
        issues.push(
          `This is an "${claimRole}" account but it has no row in any college's officeStaff roster, so it cannot be listed, deactivated or re-granted from Access Control. Re-grant the role from here to recreate the roster row.`
        )
      }
      for (const row of officeRows) {
        const rowRole = String(row.role || '').toLowerCase()
        if (claimRole && rowRole && rowRole !== claimRole) {
          issues.push(
            `The office roster row says role "${rowRole}" but the Auth role claim says "${claimRole}". The rules read the claim, so the roster and the token disagree about what this account is.`
          )
        }
        if (officeColleges.length > 1 && row.collegeId !== claimRoleCollege) {
          issues.push(
            `The office roster row sits under college ${row.collegeId} but the collegeId claim is ${claimRoleCollege}. Tenant-scoped rules will refuse this account's reads.`
          )
        }
      }
      const studentDocs = await findByEmail('students', email)
      result.studentEmailMatches = studentDocs.map(d => ({ id: d.id, ...d.data() }))
      if (studentDocs.length && !studentDocs.some(d => d.data().userId === uid || d.data().uid === uid)) issues.push('Student profile exists but is not linked to this Auth uid')
      if (!authUser?.customClaims?.role) {
        issues.push(
          'Auth custom claims do not contain role — sign-in will work but every rule-guarded read is denied. Run Access Control → Identity repair, then sign out and back in.'
        )
      }
      // Hidden-character drift (the 2026-09 "My Attendance" production
      // denial): the web client normalises collegeId with trim() — for
      // display, payloads and the staleness check — but the security rules
      // compare the claim against the document's collegeId STRICTLY. A value
      // that only matches after trimming therefore reads as healthy to every
      // self-heal while every tenant-scoped write is refused. Surface it.
      const rawClaimCollege =
        typeof authUser?.customClaims?.collegeId === 'string'
          ? authUser.customClaims.collegeId
          : null
      const usersData = (result.users as Record<string, unknown> | null) || null
      const rawUsersCollege =
        usersData && typeof (usersData.collegeId ?? usersData.collegeID ?? usersData.college_id) === 'string'
          ? String(usersData.collegeId ?? usersData.collegeID ?? usersData.college_id)
          : null
      for (const [label, value] of [
        ['The Auth collegeId claim', rawClaimCollege],
        ['The users document collegeId', rawUsersCollege],
      ] as Array<[string, string | null]>) {
        if (value !== null && value !== value.trim()) {
          issues.push(
            `${label} contains invisible leading/trailing characters. The security rules compare collegeId strictly, so this account's tenant writes (attendance included) are refused. Run Access Control → Identity repair to reissue the claim trimmed, then the user signs out and back in.`
          )
        }
      }
      if (
        rawClaimCollege !== null &&
        rawUsersCollege !== null &&
        rawClaimCollege !== rawUsersCollege &&
        rawClaimCollege.trim() === rawUsersCollege.trim()
      ) {
        issues.push(
          "The collegeId claim and the users document agree only after trimming — the security rules compare strictly, so this account's tenant writes are refused. Run Identity repair, then the user signs out and back in."
        )
      }
      // A claim that is not a live college document id. Before grantUserRole
      // resolved the College box, an operator could stamp the college *code*
      // (or a typo) into the claim; every college-scoped list then shows the
      // account nowhere and every tenant rule treats it as belonging to no
      // college. Name the likely college so the fix is one re-grant away.
      if (rawClaimCollege && rawClaimCollege.trim()) {
        const claimed = rawClaimCollege.trim()
        const live = await db.doc(`colleges/${claimed}`).get()
        if (!live.exists) {
          const guess = await resolveCollegeReference(db, claimed)
          issues.push(
            `The collegeId claim "${claimed}" is not a college document id, so college pages cannot list this account and tenant-scoped rules refuse its reads and writes.` +
              (guess.kind === 'resolved'
                ? ` It matches the ${guess.matchedBy} of "${guess.college.name}" (id ${guess.college.id}) — re-grant the role from Access Control with that college selected, then the user signs out and back in.`
                : ' Re-grant the role from Access Control with the correct college selected, then the user signs out and back in.')
          )
        }
      }
      // Probe the attendance rows this account tries to write. With a
      // provably-correct token the ONE remaining refusal path in the rules
      // is a legacy document already sitting at the deterministic id
      // {collegeId}__{uid}__{date} with a conflicting facultyId/collegeId —
      // the self-mark then becomes a refused update. Surface it here so the
      // diagnosis does not depend on the Firestore console. Dates are computed
      // in Asia/Kolkata to match the client's local date key.
      const usersCollege =
        usersData && typeof usersData.collegeId === 'string' ? usersData.collegeId.trim() : ''
      const probes: Array<{ date: string; exists: boolean; data: Record<string, unknown> | null }> = []
      if (usersCollege) {
        const istDayKey = (offset: number) =>
          new Date(Date.now() - offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
        for (const offset of [0, 1, 2]) {
          const dateKey = istDayKey(offset)
          const snap = await db.doc(`staffAttendance/${usersCollege}__${uid}__${dateKey}`).get()
          probes.push({
            date: dateKey,
            exists: snap.exists,
            data: snap.exists ? ((snap.data() as Record<string, unknown>) || null) : null,
          })
        }
      }
      result.attendanceProbes = probes
      const conflicting = probes.filter(
        (p) =>
          p.exists &&
          p.data !== null &&
          (String(p.data.facultyId ?? '') !== uid ||
            (typeof p.data.collegeId === 'string' && p.data.collegeId !== usersCollege)),
      )
      if (conflicting.length) {
        issues.push(
          `A legacy attendance document at the account's deterministic id (${conflicting
            .map((p) => p.date)
            .join(', ')}) carries a facultyId/collegeId that does not match this account — the security rules pin ownership, so the self-mark is refused as an update. Delete that document (superadmin may) so the next save creates a clean row, or correct its facultyId/collegeId fields.`
        )
      }
    }
    result.issues = issues
    return result
  }
)
