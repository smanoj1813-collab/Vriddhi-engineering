import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// Callables for Vriddhi platform employees.
//
// Model: `platform_employees/{uid}` holds the assignment (colleges + grants).
// The ID-token claims hold only `role: 'employee'` and the ACTIVE `collegeId`,
// because Firestore rules and the Express middleware already scope every
// college read/write by that claim. Switching college therefore re-mints the
// claim (and revokes refresh tokens) instead of widening the claim to a list.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import * as admin from 'firebase-admin'
import { describeCollegeResolutionFailure, resolveCollegeReference } from './collegeResolve'
import {
  EMPLOYEE_ROLE,
  PLATFORM_EMPLOYEES_COLLECTION,
  employeeAssignmentView,
  employeeClaims,
  nextActiveCollegeId,
  normaliseCollegeIds,
  normaliseEmployeeStatus,
  normaliseGrants,
  type EmployeeCollegeRef,
  type PlatformEmployeeRecord,
} from './employeeAccessCore'

const db = getFirestore(admin.app(), 'default')
const REGION = { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 60 } as const

/**
 * How long one faculty-mode delegation runs before it must be renewed by
 * another switch. Switching is what mints the college claim, so an expired
 * link simply cannot be used to obtain one: the delegation is time-limited by
 * construction, and a superadmin can end it early by suspending the employee.
 */
const DELEGATION_DAYS = 90

function clean(value: unknown, max = 200): string {
  return String(value ?? '').trim().slice(0, max)
}

async function callerIsSuperadmin(uid: string): Promise<boolean> {
  const user = await db.doc(`users/${uid}`).get()
  if (user.exists && String(user.data()?.role || '').toLowerCase() === 'superadmin') return true
  return (await db.doc(`superadmins/${uid}`).get()).exists
}

async function callerRole(uid: string): Promise<string> {
  const doc = await db.doc(`users/${uid}`).get()
  return String(doc.data()?.role || '').toLowerCase()
}

async function loadEmployee(uid: string): Promise<PlatformEmployeeRecord | null> {
  const doc = await db.collection(PLATFORM_EMPLOYEES_COLLECTION).doc(uid).get()
  return doc.exists ? ({ ...(doc.data() as PlatformEmployeeRecord), uid }) : null
}

async function resolveColleges(inputs: string[]): Promise<EmployeeCollegeRef[]> {
  const resolved: EmployeeCollegeRef[] = []
  const failures: string[] = []
  for (const input of inputs) {
    const result = await resolveCollegeReference(db, input)
    if (result.kind === 'resolved') {
      resolved.push({ id: result.college.id, name: result.college.name, code: result.college.code })
    } else {
      failures.push(describeCollegeResolutionFailure(input, result))
    }
  }
  if (failures.length > 0) {
    throw new HttpsError('not-found', `Some colleges could not be resolved: ${failures.join(' ')}`)
  }
  return resolved
}

// ── assignEmployeeColleges (Superadmin) ─────────────────────────────────────
// Creates or updates the employee assignment and re-mints the claims. The
// account itself is created first through Access Control → grant role
// "Vriddhi Employee"; this callable only owns the assignment.
export const assignEmployeeColleges = onCall(REGION, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  if (!(await callerIsSuperadmin(request.auth.uid))) {
    throw new HttpsError('permission-denied', 'Only a superadmin can assign platform employees')
  }

  const input = (request.data || {}) as Record<string, unknown>
  const email = clean(input.email, 254).toLowerCase()
  const uidInput = clean(input.uid, 128)
  const name = clean(input.name, 120)
  const collegeIds = normaliseCollegeIds(input.collegeIds ?? input.colleges)
  const grants = normaliseGrants(input.grants)
  const status = normaliseEmployeeStatus(input.status)

  if (!uidInput && !email) {
    throw new HttpsError('invalid-argument', 'Either uid or email is required')
  }

  let authUser: admin.auth.UserRecord
  try {
    authUser = uidInput ? await admin.auth().getUser(uidInput) : await admin.auth().getUserByEmail(email)
  } catch {
    throw new HttpsError(
      'not-found',
      'No account found. Create the identity in Access Control with the Vriddhi Employee role first.',
    )
  }

  // A superadmin already has platform-wide authority; an employee assignment
  // would only muddy which role the token carries.
  if (await callerIsSuperadmin(authUser.uid)) {
    throw new HttpsError('failed-precondition', `${authUser.email || authUser.uid} is a superadmin.`)
  }
  if (collegeIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Assign at least one college.')
  }

  const colleges = await resolveColleges(collegeIds)
  const existing = await loadEmployee(authUser.uid)
  const assignedCollegeIds = colleges.map((college) => college.id)
  const activeCollegeId = nextActiveCollegeId(assignedCollegeIds, existing?.activeCollegeId)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const record: Omit<PlatformEmployeeRecord, 'uid'> = {
    email: authUser.email || email,
    name: name || existing?.name || authUser.displayName || (authUser.email || '').split('@')[0],
    status,
    assignedCollegeIds,
    assignedColleges: colleges,
    grants,
    activeCollegeId,
    updatedAt: now,
    updatedBy: request.auth.uid,
    ...(existing?.createdAt ? { createdAt: existing.createdAt } : { createdAt: now }),
    createdBy: existing?.createdBy || request.auth.uid,
  }

  const claims = employeeClaims(record, authUser.customClaims || {})
  await admin.auth().setCustomUserClaims(authUser.uid, claims)
  // The token in the employee's browser carries the old assignment until it is
  // refreshed; revoking forces a mint that carries the new one.
  await admin.auth().revokeRefreshTokens(authUser.uid)

  await db.collection(PLATFORM_EMPLOYEES_COLLECTION).doc(authUser.uid).set(record, { merge: true })
  // The self-heal (syncMyIdentity) rebuilds claims from users/{uid}, so the
  // document must carry the SAME college the claim does — otherwise a repair
  // pass would either clear the active college or resurrect a suspended one.
  await db.doc(`users/${authUser.uid}`).set(
    {
      uid: authUser.uid,
      email: record.email,
      name: record.name,
      role: EMPLOYEE_ROLE,
      collegeId: activeCollegeId,
      employeeStatus: status,
      updatedAt: now,
    },
    { merge: true },
  )

  await db.collection('logs').doc().set({
    action: 'assignEmployeeColleges',
    targetUid: authUser.uid,
    targetEmail: record.email,
    collegeIds: assignedCollegeIds,
    grants,
    status,
    actorUid: request.auth.uid,
    createdAt: now,
  })

  logger.info('[employeeAccess] assignment saved', {
    uid: authUser.uid, colleges: assignedCollegeIds.length, actorUid: request.auth.uid,
  })
  return {
    success: true,
    employee: employeeAssignmentView({ ...record, uid: authUser.uid }),
    requiresTokenRefresh: true,
  }
})

// ── setEmployeeActiveCollege (Employee) ─────────────────────────────────────
// The employee picks which assigned college they are working in. This is the
// ONLY way the collegeId claim moves, so every downstream rule stays simple.
export const setEmployeeActiveCollege = onCall(REGION, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const uid = request.auth.uid
  const employee = await loadEmployee(uid)
  const isSuperadmin = await callerIsSuperadmin(uid)
  if (!employee && !isSuperadmin) {
    throw new HttpsError('permission-denied', 'This account has no Vriddhi employee assignment.')
  }
  if (employee && employee.status === 'suspended') {
    throw new HttpsError('permission-denied', 'This employee assignment is suspended.')
  }

  const collegeInput = clean((request.data || {}).collegeId, 160)
  if (!collegeInput) throw new HttpsError('invalid-argument', 'collegeId is required')

  const resolution = await resolveCollegeReference(db, collegeInput)
  if (resolution.kind !== 'resolved') {
    throw new HttpsError('not-found', describeCollegeResolutionFailure(collegeInput, resolution))
  }
  const collegeId = resolution.college.id
  if (employee && !employee.assignedCollegeIds.includes(collegeId)) {
    throw new HttpsError('permission-denied', 'That college is not assigned to this employee.')
  }

  const authRecord = await admin.auth().getUser(uid)
  const existingClaims = authRecord.customClaims || {}
  await admin.auth().setCustomUserClaims(uid, {
    ...existingClaims,
    role: EMPLOYEE_ROLE,
    collegeId,
    employeeStatus: 'active',
  })
  // Deliberately NO revokeRefreshTokens() here. This is the employee's own
  // switch between colleges they are already assigned, and the client
  // immediately force-refreshes (getIdToken(true)) — which re-mints the token
  // with the new collegeId claim. Revoking instead would invalidate the very
  // refresh token that refresh needs and sign them out mid-switch.
  const now = admin.firestore.FieldValue.serverTimestamp()
  await db.doc(`users/${uid}`).set({ collegeId, employeeStatus: 'active', updatedAt: now }, { merge: true })
  if (employee) {
    await db.collection(PLATFORM_EMPLOYEES_COLLECTION).doc(uid).set(
      { activeCollegeId: collegeId, updatedAt: now },
      { merge: true },
    )
  }

  // Faculty-mode link for this college. The employee acts with their OWN
  // account (no password sharing, no silent impersonation); this row is the
  // explicit, auditable delegation that makes them visible to the college as
  // platform staff and gives the uid-keyed faculty pages a home. A real
  // faculty profile that happens to share the uid is never rewritten.
  const facultyRef = db.doc(`faculty/${uid}`)
  const facultySnap = await facultyRef.get()
  const existingFaculty = (facultySnap.data() || {}) as Record<string, unknown>
  const linkIsOurs = !facultySnap.exists || existingFaculty.isPlatformEmployee === true
  if (linkIsOurs) {
    await facultyRef.set(
      {
        uid,
        email: employee?.email || authRecord.email || existingFaculty.email || '',
        name: employee?.name || existingFaculty.name || authRecord.displayName || '',
        collegeId,
        collegeName: resolution.college.name,
        collegeCode: resolution.college.code,
        ...(existingFaculty.department ? { department: existingFaculty.department } : {}),
        isPlatformEmployee: true,
        status: 'active',
        delegationExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + DELEGATION_DAYS * 24 * 60 * 60 * 1000),
        delegatedBy: employee?.createdBy || request.auth.uid,
        confirmedBy: uid,
        updatedAt: now,
      },
      { merge: true },
    )
  }

  await db.collection('logs').doc().set({
    action: 'setEmployeeActiveCollege',
    actorUid: uid,
    collegeId,
    previousCollegeId: existingClaims.collegeId ? String(existingClaims.collegeId) : null,
    createdAt: now,
  })

  logger.info('[employeeAccess] active college switched', { uid, collegeId })
  return {
    success: true,
    collegeId,
    collegeName: resolution.college.name,
    collegeCode: resolution.college.code,
    requiresTokenRefresh: true,
  }
})

// ── getMyEmployeeAccess ─────────────────────────────────────────────────────
export const getMyEmployeeAccess = onCall(REGION, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const requestedUid = clean((request.data || {}).uid, 128)
  const isSuperadmin = await callerIsSuperadmin(request.auth.uid)
  const uid = requestedUid && isSuperadmin ? requestedUid : request.auth.uid

  const employee = await loadEmployee(uid)
  if (!employee) {
    if (isSuperadmin) return { success: true, employee: null, superadmin: true }
    throw new HttpsError('not-found', 'No Vriddhi employee assignment exists for this account.')
  }
  return { success: true, employee: employeeAssignmentView(employee), superadmin: isSuperadmin }
})

// ── listPlatformEmployees (Superadmin) ──────────────────────────────────────
export const listPlatformEmployees = onCall(REGION, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  if (!(await callerIsSuperadmin(request.auth.uid))) {
    throw new HttpsError('permission-denied', 'Only a superadmin can list platform employees')
  }
  const snap = await db.collection(PLATFORM_EMPLOYEES_COLLECTION).get()
  const employees = snap.docs
    .map((doc) => employeeAssignmentView({ ...(doc.data() as PlatformEmployeeRecord), uid: doc.id }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { success: true, count: employees.length, employees }
})

// ── suspendPlatformEmployee (Superadmin) ────────────────────────────────────
// A suspension must actually remove authority, not just change a list label.
export const suspendPlatformEmployee = onCall(REGION, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  if (!(await callerIsSuperadmin(request.auth.uid))) {
    throw new HttpsError('permission-denied', 'Only a superadmin can suspend platform employees')
  }
  const uid = clean((request.data || {}).uid, 128)
  if (!uid) throw new HttpsError('invalid-argument', 'uid is required')
  const employee = await loadEmployee(uid)
  if (!employee) throw new HttpsError('not-found', 'No employee assignment exists for that account.')

  const suspend = (request.data || {}).suspend !== false
  const record = { ...employee, status: suspend ? ('suspended' as const) : ('active' as const) }
  const authUser = await admin.auth().getUser(uid)
  await admin.auth().setCustomUserClaims(uid, employeeClaims(record, authUser.customClaims || {}))
  await admin.auth().revokeRefreshTokens(uid)
  const now = admin.firestore.FieldValue.serverTimestamp()
  await db.collection(PLATFORM_EMPLOYEES_COLLECTION).doc(uid).set(
    { status: record.status, updatedAt: now, updatedBy: request.auth.uid },
    { merge: true },
  )
  // Mirror the suspension onto users/{uid}: claims are rebuilt from there by
  // syncMyIdentity, and a users document still carrying the old collegeId
  // would resurrect the suspended assignment on the next self-heal.
  await db.doc(`users/${uid}`).set(
    { collegeId: suspend ? null : record.activeCollegeId, employeeStatus: record.status, updatedAt: now },
    { merge: true },
  )
  await db.collection('logs').doc().set({
    action: 'suspendPlatformEmployee',
    targetUid: uid,
    status: record.status,
    actorUid: request.auth.uid,
    createdAt: now,
  })

  logger.info('[employeeAccess] status changed', { uid, status: record.status, actorUid: request.auth.uid, role: await callerRole(uid) })
  return { success: true, status: record.status, requiresTokenRefresh: true }
})
