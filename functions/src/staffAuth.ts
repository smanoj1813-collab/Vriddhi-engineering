import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/staffAuth.ts
// Staff (faculty / HOD / principal / admin) bulk provisioning.
//
// This is the staff counterpart of bulkCreateStudentAccounts. It exists so
// that bulk import runs through the Admin SDK instead of the client-side
// Identity Toolkit signup. The Admin SDK is the only place that can:
//
//   1. Detect an *orphaned* Firebase Auth account — one whose Firestore
//      profile was wiped by a college reset but whose Auth account survived
//      (created by an older client-side import, a half-finished import, etc).
//   2. Reclaim it safely: verify it does not belong to another college, then
//      RESET its password and custom claims and rewrite the profile docs.
//
// Without this, a re-import after "Reset College Data" either failed with
// "email already exists" (students) or silently re-used the stale account
// with an old password (faculty), so the freshly-shown temporary password
// never worked.

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import {
  findAuthUserByEmail,
  generateRandomPassword,
  isValidEmail,
  normalizeEmail,
  secretFieldDeletes,
  verifyAuthAccount,
  verifyCaller,
  withApiVersion,
  withAuthQuotaRetry,
} from './identityShared'

/** A throttle is transient and recoverable, so it gets a log line rather than a
 * row failure the operator has to interpret. The retry policy itself lives in
 * identityShared so every Auth write path in the product shares it. */
const noteThrottle = (message: string) => logger.warn(`[staffAuth] ${message}`)

// ═════════════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════════════

type StaffRole = 'faculty' | 'hod' | 'principal' | 'admin'

interface StaffImportRow {
  // Identity
  facultyId?: string
  firstName?: string
  name?: string
  lastName?: string
  email: string
  phone?: string
  gender?: string
  // Organisation
  collegeCode?: string
  collegeName?: string
  department?: string
  branches?: string[]
  designation?: string
  employmentType?: string
  /** G5: guest/P&T contract window + per-period pay (non-full-time rows). */
  guestContract?: { startDate?: string; endDate?: string | null; periodRate?: number; notes?: string } | null
  joiningDate?: string
  qualification?: string
  specialization?: string
  subjectsUG?: string[]
  subjectsPG?: string[]
  experienceYears?: number
  isHOD?: boolean
  isPrincipal?: boolean
  // Optional role override (defaults from isHOD/isPrincipal flags).
  role?: StaffRole
  profilePhotoUrl?: string
}

interface BulkStaffPayload {
  collegeId: string
  staff: StaffImportRow[]
  defaultPassword?: string
  /**
   * What to do when a profile for the email already exists in this college:
   *   'skip'  (default) leave the account untouched and report it as skipped —
   *             no credential is issued, so use `sendResetEmail` instead.
   *   'reset' reclaim it: set a new password (or mint a reset link) and re-issue
   *             claims, which is what you want when the password is lost.
   */
  onExisting?: 'skip' | 'reset'
  /** 'temp-password' returns a one-time password; 'reset-email' returns a link. */
  deliveryMode?: 'temp-password' | 'reset-email'
  continueUrl?: string
}

interface StaffResult {
  id: string
  email: string
  name: string
  role: StaffRole
  success: boolean
  uid?: string
  password?: string
  reclaimed?: boolean
  error?: string
  /** created | reclaimed | skipped | failed — the importer's copy of the truth. */
  status?: 'created' | 'reclaimed' | 'skipped' | 'failed'
  /** Faculty profile document id, stored on users/{uid} for owned-get lookups. */
  facultyDocId?: string
  /** True only when the Auth account was read back and matches this row. */
  authVerified?: boolean
  delivery?: 'temp-password' | 'reset-link' | 'none'
  resetLink?: string
  /** Plaintext password fields removed from the profile document. */
  secretsStripped?: number
}

interface BulkStaffResult {
  success: boolean
  total: number
  created: number
  reclaimed: number
  skipped: number
  failed: number
  authVerified: number
  /** Plaintext credential fields removed from profile documents. */
  secretsStripped: number
  errors: Array<{ row: number; email: string; message: string }>
  staff: StaffResult[]
  collegeId: string
  /** Client compares this with its own expectation to detect stale deploys. */
  apiVersion: string
  warnings?: string[]
}

const STAFF_PROFILE_COLLECTION = 'faculty'
// Roles that may land in the staff profile collection.
const ALLOWED_STAFF_ROLES: StaffRole[] = ['faculty', 'hod', 'principal', 'admin']

function normalizeFacultyBranches(row: StaffImportRow): string[] {
  const raw = Array.isArray(row.branches) && row.branches.length ? row.branches : [row.department]
  return Array.from(
    new Set(raw.map((branch) => String(branch || '').trim()).filter(Boolean))
  )
}

function hodBranchKey(branch: string): string {
  return branch.replace(/%/g, '%25').replace(/\//g, '%2F')
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Make sure an Auth account exists for `email` and that it belongs to the
 * importing college (or is orphaned — no college linkage at all). An account
 * already bound to a *different* college is never hijacked.
 *
 * Returns the uid and whether a pre-existing account was reclaimed. The
 * returned password is the credential the importer should hand out: for a
 * newly created or reclaimed account it is the freshly-set password.
 */
async function ensureCollegeAuthUser(opts: {
  email: string
  name: string
  password: string
  collegeId: string
  role: StaffRole
  /** Department tag stamped into the custom claim so Firestore rules can
   *  scope admin/hod reads (empty ⇒ college-wide, matching the tolerant
   *  frontend scoping in shared/utils/departmentScope). */
  department?: string | null
}): Promise<{ uid: string; reclaimed: boolean }> {
  const { email, name, password, collegeId, role } = opts
  const department = String(opts.department ?? '').trim()
  const existing = await findAuthUserByEmail(email)

  if (existing) {
    const claims = (existing.customClaims || {}) as Record<string, unknown>
    const linkedCollege = claims.collegeId ? String(claims.collegeId) : ''
    if (linkedCollege && linkedCollege !== collegeId) {
      throw new HttpsError(
        'failed-precondition',
        `Email ${email} already belongs to another college and cannot be reused`
      )
    }
    // Same college, or an orphaned account (no college claim). Reset the
    // password so the credential we return actually works, and refresh claims.
    await Promise.all([
      withAuthQuotaRetry(
        `reclaim ${email}`,
        () =>
          admin.auth().updateUser(existing.uid, { email, password, displayName: name, disabled: false }),
        { note: noteThrottle }
      ),
      withAuthQuotaRetry(
        `claims ${email}`,
        () => admin.auth().setCustomUserClaims(existing.uid, {
          role,
          collegeId,
          ...(department ? { department } : {}),
        }),
        { note: noteThrottle }
      ),
    ])
    return { uid: existing.uid, reclaimed: true }
  }

  const created = await withAuthQuotaRetry(
    `create ${email}`,
    () => admin.auth().createUser({ email, password, displayName: name }),
    { note: noteThrottle }
  )
  await withAuthQuotaRetry(
    `claims ${email}`,
    () => admin.auth().setCustomUserClaims(created.uid, {
      role,
      collegeId,
      ...(department ? { department } : {}),
    }),
    { note: noteThrottle }
  )
  return { uid: created.uid, reclaimed: false }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN: bulkProvisionStaff
// ═════════════════════════════════════════════════════════════════════════════

export const bulkProvisionStaff = onCall(
  {
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 540,
    minInstances: 0,
    maxInstances: 5,
  },
  async (request): Promise<BulkStaffResult> => {
    const startTime = Date.now()
    const {
      collegeId,
      staff,
      defaultPassword,
      onExisting = 'skip',
      deliveryMode = 'temp-password',
      continueUrl,
    } = (request.data || {}) as BulkStaffPayload
    if (!['skip', 'reset'].includes(onExisting)) {
      throw new HttpsError("invalid-argument", `onExisting must be 'skip' or 'reset'`)
    }
    if (!['temp-password', 'reset-email'].includes(deliveryMode)) {
      throw new HttpsError("invalid-argument", `deliveryMode must be 'temp-password' or 'reset-email'`)
    }

    // ── Validate payload ──
    if (!collegeId || typeof collegeId !== 'string') {
      throw new HttpsError('invalid-argument', 'collegeId is required')
    }
    if (!Array.isArray(staff) || staff.length === 0) {
      throw new HttpsError('invalid-argument', 'At least one staff row is required')
    }
    if (staff.length > 500) {
      throw new HttpsError('invalid-argument', 'At most 500 staff rows per import')
    }
    if (defaultPassword && String(defaultPassword).length < 10) {
      throw new HttpsError('invalid-argument', 'A default password must be at least 10 characters')
    }

    // ── Verify caller ──
    // Provisioning staff identities (faculty, HOD, principal, admin) is
    // superadmin-only. It previously used verifyCaller's default
    // STAFF_CREATOR_ROLES and only required that a non-superadmin target their
    // own college, so a college admin could create privileged accounts in
    // their own tenant. The narrow role list must be passed explicitly.
    const caller = await verifyCaller(request, ['superadmin'])

    // ── Load college data ──
    const collegeRef = getFirestore(admin.app(), 'default').collection('colleges').doc(collegeId)
    const collegeSnap = await collegeRef.get()
    if (!collegeSnap.exists) {
      throw new HttpsError('not-found', `College ${collegeId} not found`)
    }
    const college = collegeSnap.data() as { code?: string; name?: string }

    const results: StaffResult[] = []
    const errors: Array<{ row: number; email: string; message: string }> = []
    let createdCount = 0
    let reclaimedCount = 0
    let skippedCount = 0
    let failedCount = 0
    let authVerifiedCount = 0
    let secretsStrippedTotal = 0
    const warnings: string[] = []

    // Track emails/ids we have already written in THIS batch so duplicate rows
    // inside the same CSV don't collide with one another.
    const seenEmails = new Set<string>()
    const seenFacultyIds = new Set<string>()

    for (let i = 0; i < staff.length; i++) {
      const row = staff[i]
      const rowNum = i + 1

      const email = normalizeEmail(row.email)
      const firstName = String(row.firstName || row.name || '').trim()
      const lastName = String(row.lastName || '').trim()
      const name = `${firstName} ${lastName}`.trim() || email.split('@')[0]

      const fail = (message: string) => {
        failedCount++
        errors.push({ row: rowNum, email, message })
        results.push({
          id: '',
          email,
          name,
          role: 'faculty',
          success: false,
          status: 'failed',
          error: message,
        })
      }

      // ── Per-row validation: name + email are the only hard requirements.
      if (!firstName) {
        fail('Missing name')
        continue
      }
      if (!isValidEmail(email)) {
        fail('Invalid email address')
        continue
      }

      const role: StaffRole = ALLOWED_STAFF_ROLES.includes(row.role as StaffRole)
        ? (row.role as StaffRole)
        : row.isPrincipal
          ? 'principal'
          : row.isHOD
            ? 'hod'
            : 'faculty'

      const branches = normalizeFacultyBranches(row)
      const department = branches[0] || ''
      const facultyId = String(row.facultyId || `FAC${Date.now()}${i}`).trim()
      const password = defaultPassword ? String(defaultPassword) : generateRandomPassword()

      if (facultyId.includes('/')) {
        fail('Faculty ID cannot contain /')
        continue
      }
      if (branches.length > 20 || branches.some((branch) => branch.length > 100)) {
        fail('Use at most 20 branches, each 100 characters or fewer')
        continue
      }
      if (seenEmails.has(email)) {
        fail('Duplicate email in the uploaded file')
        continue
      }
      if (seenFacultyIds.has(facultyId)) {
        fail('Duplicate faculty ID in the uploaded file')
        continue
      }

      let profilePreexistedInCollege = false
      try {
        // A faculty ID is the profile document key. Never allow a new email to
        // overwrite somebody else's profile merely because the operator typed
        // an existing ID in the single-create form or CSV.
        const idProfile = await getFirestore(admin.app(), 'default')
          .collection(STAFF_PROFILE_COLLECTION)
          .doc(facultyId)
          .get()
        if (idProfile.exists) {
          const idData = idProfile.data() || {}
          const idEmail = normalizeEmail(idData.email)
          const idCollege = String(idData.collegeId || '')
          if (idEmail !== email || (idCollege && idCollege !== collegeId)) {
            fail(`Faculty ID ${facultyId} is already assigned to another profile`)
            continue
          }
        }

        // ── Existing profile for this email? Decide per `onExisting`.
        //    'skip'  → report the row as SKIPPED (not failed): the account
        //              already works, we simply cannot hand out its password.
        //              The importer gets a "send reset link" action instead.
        //    'reset' → reclaim: new credential + claims re-issued.
        const existingProfile = await getFirestore(admin.app(), 'default')
          .collection(STAFF_PROFILE_COLLECTION)
          .where('email', '==', email)
          .limit(1)
          .get()
        let existingProfileDoc: admin.firestore.QueryDocumentSnapshot | null = null
        if (!existingProfile.empty) {
          const candidate = existingProfile.docs[0]
          if (String(candidate.data().collegeId || '') === collegeId) {
            existingProfileDoc = candidate
            profilePreexistedInCollege = true
            if (onExisting === 'skip') {
              skippedCount++
              seenEmails.add(email)
              seenFacultyIds.add(candidate.id)
              results.push({
                id: candidate.id,
                email,
                name,
                role,
                success: true,
                status: 'skipped',
                uid: (candidate.data().uid as string) || undefined,
                facultyDocId: candidate.id,
                password: undefined,
                delivery: 'none',
                error: undefined,
              })
              continue
            }
          }
        }

        // ── Create or reclaim the Auth account.
        const { uid, reclaimed } = await ensureCollegeAuthUser({
          email,
          name,
          password,
          collegeId,
          role,
          department,
        })

        // ── Prove the identity exists before touching Firestore. A row is only
        //    reported as provisioned when a live, enabled Auth account carries
        //    this role and college. That closes the "profile written, account
        //    missing" hole for good.
        const verification = await verifyAuthAccount({
          uid,
          email,
          expectedRole: role,
          expectedCollegeId: collegeId,
        })
        if (!verification.ok) {
          throw new Error(
            `Firebase Auth account not usable: ${verification.reason || 'verification failed'}`
          )
        }
        let resetLink: string | undefined
        if (deliveryMode === 'reset-email') {
          try {
            resetLink = await admin
              .auth()
              .generatePasswordResetLink(email, continueUrl ? { url: continueUrl } : undefined)
          } catch (linkErr: any) {
            logger.error('[StaffAuth] password reset link failed', {
              email,
              error: linkErr?.message || linkErr,
            })
            warnings.push(`${email}: account is ready but the reset link could not be generated`)
          }
        }

        const now = admin.firestore.FieldValue.serverTimestamp()

        const profileData = {
          id: facultyId,
          facultyId,
          firstName,
          lastName,
          name,
          email,
          phone: String(row.phone || '').trim(),
          gender: String(row.gender || '').trim(),
          // The selected college is authoritative for every tenancy field.
          // These used to prefer the CSV row's collegeName/collegeCode, which
          // is how a profile ended up labelled with one college while its
          // collegeId (the field every college page queries) pointed at
          // another — visible in the global faculty list, missing from the
          // college it claimed to belong to.
          collegeId,
          collegeName: String(college.name || '').trim(),
          collegeCode: String(college.code || '').trim(),
          department,
          branches,
          designation: String(row.designation || (role === 'principal' ? 'Principal' : 'Assistant Professor')),
          employmentType: String(row.employmentType || 'FULL_TIME'),
          // G5: guest contract survives provisioning so the auto-mapper can
          // see expired engagements and billing can cost scheduled periods.
          ...(row.guestContract
            ? {
                guestContract: {
                  ...(row.guestContract.startDate ? { startDate: String(row.guestContract.startDate) } : {}),
                  ...(row.guestContract.endDate == null
                    ? { endDate: null }
                    : { endDate: String(row.guestContract.endDate) }),
                  periodRate: Number(row.guestContract.periodRate || 0),
                  ...(row.guestContract.notes ? { notes: String(row.guestContract.notes).slice(0, 500) } : {}),
                },
              }
            : {}),
          joiningDate: String(row.joiningDate || ''),
          qualification: String(row.qualification || ''),
          specialization: String(row.specialization || ''),
          subjectsUG: Array.isArray(row.subjectsUG) ? row.subjectsUG : [],
          subjectsPG: Array.isArray(row.subjectsPG) ? row.subjectsPG : [],
          experienceYears: Number(row.experienceYears || 0),
          isHOD: role === 'hod' || !!row.isHOD,
          isPrincipal: role === 'principal' || !!row.isPrincipal,
          profilePhotoUrl: String(row.profilePhotoUrl || ''),
          role,
          status: 'active',
          uid,
          createdAt: now,
          updatedAt: now,
        }

        const db = getFirestore(admin.app(), 'default')
        const batch = db.batch()

        // Legacy imports stored the plaintext password on the profile document.
        // Staff can read this collection, so those fields are removed here —
        // this is what finally deletes the "read the password in Firestore"
        // workflow instead of reproducing it.
        const stripFields = existingProfileDoc
          ? secretFieldDeletes(existingProfileDoc.data() as Record<string, unknown>)
          : {}
        if (Object.keys(stripFields).length) secretsStrippedTotal += Object.keys(stripFields).length

        // Profile doc keyed by the stable facultyId (matches client import).
        batch.set(
          db.collection(STAFF_PROFILE_COLLECTION).doc(facultyId),
          { ...profileData, ...stripFields },
          { merge: true }
        )

        // Role-resolution lookup doc keyed by the Auth uid. `facultyDocId` lets
        // the app resolve the profile with an owned `get` instead of a query —
        // rules cannot authorise a LIST for a non-staff-privileged account, and
        // queries on `faculty` were the second permission-denied source after
        // login for staff without a users/{uid} document.
        batch.set(
          db.collection('users').doc(uid),
          {
            uid,
            id: uid,
            email,
            name,
            role,
            collegeId,
            collegeCode: String(college.code || '').trim(),
            department,
            branches,
            phone: String(row.phone || '').trim(),
            avatar: String(row.profilePhotoUrl || ''),
            facultyDocId: facultyId,
            status: 'active',
            updatedAt: now,
          },
          { merge: true }
        )

        // One HOD directory row per assigned branch. `department` remains the
        // primary branch for older HOD screens, while `branches` represents the
        // complete assignment.
        if (role === 'hod') {
          for (const branch of branches) {
            batch.set(
              db.collection('hods').doc(`${collegeId}_${hodBranchKey(branch)}`),
              {
                facultyId,
                uid,
                collegeId,
                department: branch,
                branches,
                name,
                email,
                role: 'hod',
                assignedAt: now,
              },
              { merge: true }
            )
          }
        }

        // The college counter only moves for a genuinely new profile, otherwise
        // every re-import of the same file inflated facultyCount.
        batch.update(collegeRef, {
          updatedAt: now,
          ...(profilePreexistedInCollege
            ? {}
            : { facultyCount: admin.firestore.FieldValue.increment(1) }),
        })

        await batch.commit()

        seenEmails.add(email)
        seenFacultyIds.add(facultyId)
        authVerifiedCount++

        if (reclaimed) reclaimedCount++
        else createdCount++

        results.push({
          id: facultyId,
          email,
          name,
          role,
          success: true,
          status: reclaimed ? 'reclaimed' : 'created',
          uid,
          // Never hand out a password in reset-link mode.
          password: deliveryMode === 'reset-email' ? undefined : password,
          reclaimed,
          facultyDocId: facultyId,
          authVerified: true,
          delivery: deliveryMode === 'reset-email' ? 'reset-link' : 'temp-password',
          resetLink,
          secretsStripped: Object.keys(stripFields).length || undefined,
        })

        logger.info('[StaffAuth] provisioned staff', {
          facultyId,
          uid,
          email,
          role,
          reclaimed,
          collegeId,
          by: caller.uid,
        })
      } catch (err: any) {
        const message = err?.message || 'Unknown error'
        fail(message)
        logger.error(`[StaffAuth] Failed to provision ${email}:`, err)
      }
    }

    // ── Audit log ──
    try {
      await getFirestore(admin.app(), 'default').collection('logs').add({
        action: 'BULK_STAFF_IMPORT',
        collegeId,
        performedBy: caller.uid,
        performedByName: caller.name,
        total: staff.length,
        created: createdCount,
        reclaimed: reclaimedCount,
        failed: failedCount,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        elapsedMs: Date.now() - startTime,
      })
    } catch (logError) {
      logger.error('[StaffAuth] Failed to write import audit log', logError)
    }

    if (skippedCount > 0) {
      warnings.push(
        `${skippedCount} account(s) already existed and were left untouched. Their passwords were NOT changed — use "Send reset link" for those rows, or re-import with "Reset existing passwords" enabled.`
      )
    }
    if (authVerifiedCount < createdCount + reclaimedCount) {
      warnings.push(
        `${createdCount + reclaimedCount - authVerifiedCount} row(s) could not be verified against Firebase Authentication.`
      )
    }

    return withApiVersion({
      success: failedCount === 0 && authVerifiedCount === createdCount + reclaimedCount,
      total: staff.length,
      created: createdCount,
      reclaimed: reclaimedCount,
      skipped: skippedCount,
      failed: failedCount,
      authVerified: authVerifiedCount,
      errors,
      staff: results,
      collegeId,
      secretsStripped: secretsStrippedTotal,
      warnings,
    }) as BulkStaffResult
  }
)
