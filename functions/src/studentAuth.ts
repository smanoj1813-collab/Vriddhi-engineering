import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/studentAuth.ts
// Student Auth Management — Bulk creation + sync utilities

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import {
  findAuthUserByEmail,
  generateRandomPassword,
  isValidEmail,
  normalizeEmail,
  toPhoneE164,
  verifyAuthAccount,
  verifyCaller,
  withApiVersion,
  withAuthQuotaRetry,
} from './identityShared'
import { buildMentorDirectory, resolveMentorAssignment } from './mentorAssignment'
import { buildAccessFields, loadActiveProduct, todayInIst, type AccessFields } from './accessProducts'

/** A throttle is transient and recoverable, so it gets a log line rather than a
 * row failure the operator has to interpret. The retry policy itself lives in
 * identityShared so every Auth write path in the product shares it. */
const noteThrottle = (message: string) => logger.warn(`[studentAuth] ${message}`)

// ═════════════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════════════

interface StudentImportRow {
  regNo: string
  name: string
  email: string
  phone?: string
  department: string
  batch: string
  division: string
  semester?: number | string
  dob?: string
  gender?: string
  address?: string
  mentorId?: string
}

interface BulkStudentPayload {
  collegeId: string
  students: StudentImportRow[]
  passwordStrategy?: 'auto' | 'default'
  defaultPassword?: string
  /**
   * 'temp-password' (default) generates a password per student and returns it
   * once to the importer. 'reset-email' sets a random password the student can
   * never learn and returns a Firebase password-reset link instead, so nobody
   * has to read or forward a plaintext credential.
   */
  deliveryMode?: 'temp-password' | 'reset-email'
  /** Absolute URL the reset link should return the student to. */
  continueUrl?: string
  /**
   * Platform-access product (accessProducts/{id}) applied to every row in this
   * batch, and the day its window starts (yyyy-mm-dd, default: today in IST).
   * The window the product buys is stamped on each student so onboarding
   * records what was sold — see ./accessProducts.
   */
  productId?: string
  accessStart?: string
}

interface StudentResult {
  regNo: string
  name: string
  email: string
  success: boolean
  uid?: string
  password?: string
  reclaimed?: boolean
  error?: string
  /** Student profile document id — clients resolve it without a query. */
  studentDocId?: string
  /** True only when the Auth account was read back and matches this row. */
  authVerified?: boolean
  /** How the credential reaches the student. */
  delivery?: 'temp-password' | 'reset-link'
  resetLink?: string
}

interface BulkResult {
  success: boolean
  total: number
  created: number
  reclaimed: number
  failed: number
  /** Rows whose Firebase Auth account was verified to exist and be usable. */
  authVerified: number
  errors: Array<{ row: number; regNo: string; message: string }>
  students: StudentResult[]
  collegeId: string
  /** Client checks this against its own expectation to detect stale deploys. */
  apiVersion: string
  warnings?: string[]
}

// ═════════════════════════════════════════════════════════════════════════════
// EXISTING STUBS (preserve your current logic here)
// ═════════════════════════════════════════════════════════════════════════════

/** @deprecated — retained only to return an explicit migration error. */
export const syncStudentsToAuth = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required')
    throw new HttpsError(
      'failed-precondition',
      'syncStudentsToAuth is retired. Use bulkCreateStudentAccounts.'
    )
  }
)

/** @deprecated — retained only to return an explicit migration error. */
export const createStudentAuth = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required')
    throw new HttpsError(
      'failed-precondition',
      'createStudentAuth is retired. Use bulkCreateStudentAccounts.'
    )
  }
)

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function normalizeSemester(val: number | string | undefined): number {
  if (val === undefined || val === null) return 1
  const parsed = typeof val === 'string' ? parseInt(val, 10) : val
  return isNaN(parsed) ? 1 : parsed
}

/**
 * The cohort fields a student row MUST carry, checked per row.
 *
 * WHY: name + email alone produced perfectly importable students that matched
 * no class — no batch, no division, no department (which is the profile's
 * `branch`), and a semester that silently defaulted to 1. The student then saw
 * "no curriculum assigned" (or "mapped to a different class") and every roster
 * looked empty, with nothing in the import result to explain it. A row that
 * cannot be placed in a class is rejected with the reason, and the operator
 * fixes the file instead of the database.
 *
 * Returns the human-readable reason, or null when the row is complete.
 * Pure: exported for unit tests.
 */
export function validateStudentCohortRow(row: {
  department?: unknown
  batch?: unknown
  division?: unknown
  semester?: unknown
}): string | null {
  if (!String(row.department ?? '').trim()) return 'Missing department/branch'
  if (!String(row.batch ?? '').trim()) return 'Missing batch (admission year, e.g. 2027)'
  if (!String(row.division ?? '').trim()) return 'Missing division'
  const rawSemester = String(row.semester ?? '').trim()
  if (!rawSemester) return 'Missing semester (1-12)'
  const semester = Number(rawSemester)
  if (!Number.isInteger(semester) || semester < 1 || semester > 12) {
    return `Invalid semester "${rawSemester}" (1-12)`
  }
  return null
}

async function getCollegeData(collegeId: string) {
  const collegeDoc = await getFirestore(admin.app(), 'default').doc(`colleges/${collegeId}`).get()
  if (!collegeDoc.exists) {
    throw new HttpsError('not-found', `College ${collegeId} not found`)
  }
  return collegeDoc.data() as {
    code: string
    name: string
    studentCount: number
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN: bulkCreateStudentAccounts
// ═════════════════════════════════════════════════════════════════════════════

export const bulkCreateStudentAccounts = onCall(
  {
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 540,
    minInstances: 0,
    maxInstances: 5,
  },
  async (request): Promise<BulkResult> => {
    const startTime = Date.now()
    const {
      collegeId,
      students,
      passwordStrategy = 'auto',
      defaultPassword,
      deliveryMode = 'temp-password',
      continueUrl,
      productId,
      accessStart,
    } = (request.data || {}) as BulkStudentPayload
    if (!['temp-password', 'reset-email'].includes(deliveryMode)) {
      throw new HttpsError('invalid-argument', "deliveryMode must be 'temp-password' or 'reset-email'")
    }

    // ── Validate input ──
    if (!collegeId || typeof collegeId !== 'string') {
      throw new HttpsError('invalid-argument', 'collegeId is required')
    }
    if (!Array.isArray(students) || students.length === 0) {
      throw new HttpsError('invalid-argument', 'students array is required and must not be empty')
    }
    if (students.length > 500) {
      throw new HttpsError('invalid-argument', 'Maximum 500 students per batch')
    }
    if (!['auto', 'default'].includes(passwordStrategy)) {
      throw new HttpsError('invalid-argument', 'Unsupported password strategy')
    }
    if (passwordStrategy === 'default' && (!defaultPassword || defaultPassword.length < 12)) {
      throw new HttpsError(
        'invalid-argument',
        'A default password of at least 12 characters is required'
      )
    }
    // Per-row validation runs inside the processing loop below, so a single bad
    // row reports a per-row failure instead of aborting the whole batch (which
    // is what previously turned one empty cell into "Successful: 0").

    // ── Verify caller ──
    // Creating student identities is superadmin-only. It previously fell back
    // to verifyCaller's default STAFF_CREATOR_ROLES and then only checked that
    // a non-superadmin targeted their own college — which let a college admin
    // provision students, faculty, HODs and principals into their own tenant.
    // The narrow role list must be passed explicitly.
    const caller = await verifyCaller(request, ['superadmin'])

    // ── Load college data and mentor aliases ──
    const college = await getCollegeData(collegeId)
    const db = getFirestore(admin.app(), 'default')
    const auth = admin.auth()

    // ── Platform-access product (optional) ──
    // Resolved BEFORE the first Auth account is created: a bad product id must
    // fail the request, not leave 200 students provisioned with no window (and
    // no chance to re-run — the second attempt would hit duplicate emails).
    let accessFields: AccessFields | null = null
    if (String(productId || '').trim()) {
      const product = await loadActiveProduct(db, productId)
      if (!product) {
        throw new HttpsError(
          'failed-precondition',
          'The selected platform-access product does not exist or has been archived'
        )
      }
      const startDate = String(accessStart || '').trim() || todayInIst()
      accessFields = buildAccessFields(product, startDate)
      if (!accessFields) {
        throw new HttpsError(
          'invalid-argument',
          `Access start date "${startDate}" is not a yyyy-mm-dd date`
        )
      }
    }

    // Faculty profiles use a stable code as their document id but faculty-owned
    // records use the Auth uid. Resolve the CSV's Mentor value (FAC001, uid,
    // email, or an unambiguous name) before writing any student representation.
    // This snapshot is loaded once per callable batch rather than once per row.
    const facultySnap = await db.collection('faculty').where('collegeId', '==', collegeId).get()
    const mentorDirectory = buildMentorDirectory(
      facultySnap.docs.map((profile) => ({ docId: profile.id, data: profile.data() }))
    )

    // ── Pre-check duplicates ──
    // Firestore `in` filters accept at most 30 values. Chunk the checks so the
    // callable's documented 500-row limit actually works. Registration
    // numbers are college-scoped; Auth/email ownership is global.
    const emails = students.map((s) => String(s.email || '').trim().toLowerCase())
    const regNos = students.map((s) => String(s.regNo || '').trim())
    const chunks = <T>(values: T[], size = 30): T[][] => {
      const result: T[][] = []
      for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size))
      return result
    }

    const [existingEmailSnaps, existingRegNoSnaps, existingUserSnaps] = await Promise.all([
      Promise.all(
        chunks(emails).map((values) =>
          db.collection('students').where('email', 'in', values).limit(500).get()
        )
      ),
      Promise.all(
        chunks(regNos).map((values) =>
          db
            .collection('students')
            .where('collegeId', '==', collegeId)
            .where('regNo', 'in', values)
            .limit(500)
            .get()
        )
      ),
      Promise.all(
        chunks(emails).map((values) =>
          db.collection('users').where('email', 'in', values).limit(500).get()
        )
      ),
    ])

    const existingEmails = new Set(
      existingEmailSnaps.flatMap((snap) =>
        snap.docs.map((d) => String(d.data().email || '').toLowerCase()).filter(Boolean)
      )
    )
    const existingRegNos = new Set(
      existingRegNoSnaps.flatMap((snap) =>
        snap.docs.map((d) => String(d.data().regNo || '')).filter(Boolean)
      )
    )
    const existingUserEmails = new Set(
      existingUserSnaps.flatMap((snap) =>
        snap.docs.map((d) => String(d.data().email || '').toLowerCase()).filter(Boolean)
      )
    )

    const results: StudentResult[] = []
    const errors: Array<{ row: number; regNo: string; message: string }> = []
    let createdCount = 0
    let reclaimedCount = 0
    let failedCount = 0
    let authVerifiedCount = 0
    const warnings: string[] = []

    // ── Process each student sequentially (auth creation is not batchable) ──
    for (let i = 0; i < students.length; i++) {
      const row = students[i]
      const rowNum = i + 1
      const email = normalizeEmail(row.email)
      const regNo = String(row.regNo || '').trim()

      // ── Per-row validation ──
      //    Name + email make the ACCOUNT; department, batch, division and
      //    semester make the STUDENT placeable in a class. The old contract
      //    accepted a row with none of the cohort fields and defaulted the
      //    semester to 1, which is how a college ended up with 343 students
      //    that every roster and every curriculum mapping missed.
      const name = String(row.name || '').trim()
      if (!name) {
        failedCount++
        errors.push({ row: rowNum, regNo, message: 'Missing name' })
        results.push({ regNo, name: '', email, success: false, error: 'Missing name' })
        continue
      }
      if (!isValidEmail(email)) {
        failedCount++
        errors.push({ row: rowNum, regNo, message: 'Invalid email address' })
        results.push({ regNo, name, email, success: false, error: 'Invalid email address' })
        continue
      }
      const cohortError = validateStudentCohortRow(row)
      if (cohortError) {
        failedCount++
        errors.push({ row: rowNum, regNo, message: cohortError })
        results.push({ regNo, name, email, success: false, error: cohortError })
        continue
      }
      const semester = normalizeSemester(row.semester)
      if (semester < 1 || semester > 12) {
        failedCount++
        errors.push({ row: rowNum, regNo, message: 'Invalid semester' })
        results.push({ regNo, name, email, success: false, error: 'Invalid semester' })
        continue
      }

      // Skip duplicates
      if (existingEmails.has(email)) {
        failedCount++
        errors.push({ row: rowNum, regNo, message: `Email ${email} already exists in students` })
        results.push({ regNo, name: row.name, email, success: false, error: 'Email already exists' })
        continue
      }
      if (existingRegNos.has(regNo)) {
        failedCount++
        errors.push({ row: rowNum, regNo, message: `RegNo ${regNo} already exists` })
        results.push({ regNo, name: row.name, email, success: false, error: 'RegNo already exists' })
        continue
      }
      // Only a UID created by this iteration is eligible for rollback. Looking
      // up by email in a catch block can delete a pre-existing Auth-only user.
      let createdAuthUid: string | null = null
      // Set when the row reuses a pre-existing Auth account (orphaned after a
      // college reset). Such accounts must never be rolled back/deleted.
      let reclaimedAuthUid: string | null = null

      try {
        // Password/credential handling.
        //   temp-password: the importer receives a one-time password to hand out.
        //   reset-email:   the account gets an unknowable random password and the
        //                  importer receives a Firebase password-reset link, so no
        //                  plaintext credential ever passes through an admin's
        //                  hands (the answer to "I have to read the password out of
        //                  Firestore" — that field should not exist at all).
        const password =
          passwordStrategy === 'default'
            ? (defaultPassword as string)
            : generateRandomPassword()
        const phoneNumber = toPhoneE164(row.phone)

        // 1. Create the Firebase Auth user — or RECLAIM an orphaned one.
        //    After a college reset the Auth account can outlive its Firestore
        //    profile (created by an older client-side import). Re-using the
        //    email would otherwise throw email-already-exists and block the
        //    whole re-import. We claim the orphan, reset its password so the
        //    credential we return works, and re-issue its claims.
        let userRecord: admin.auth.UserRecord
        if (existingUserEmails.has(email)) {
          const existing = await findAuthUserByEmail(email)
          if (!existing) {
            // Defensive: set membership drifted. Fall through to creation.
            userRecord = await withAuthQuotaRetry(
              `create ${email}`,
              () =>
                auth.createUser({
                  email,
                  password,
                  displayName: name,
                  phoneNumber,
                  disabled: false,
                }),
              { note: noteThrottle }
            )
            createdAuthUid = userRecord.uid
          } else {
            const claims = (existing.customClaims || {}) as Record<string, unknown>
            const linkedCollege = claims.collegeId ? String(claims.collegeId) : ''
            if (linkedCollege && linkedCollege !== collegeId) {
              throw new Error(
                `Email ${email} already belongs to another college and cannot be reused`
              )
            }
            await withAuthQuotaRetry(
              `reclaim ${email}`,
              () =>
                auth.updateUser(existing.uid, {
                  email,
                  password,
                  displayName: name,
                  phoneNumber,
                  disabled: false,
                }),
              { note: noteThrottle }
            )
            userRecord = existing
            reclaimedAuthUid = existing.uid
          }
        } else {
          userRecord = await withAuthQuotaRetry(
            `create ${email}`,
            () =>
              auth.createUser({
                email,
                password,
                displayName: name,
                phoneNumber,
                disabled: false,
              }),
            { note: noteThrottle }
          )
          createdAuthUid = userRecord.uid
        }

        // Student role/college claims drive rule checks and let the cleanup
        // callable delete Auth accounts even when profile docs are missing.
        // Firestore rules take the role from the token claim ONLY, so a missing
        // claim means an account that can sign in but read nothing.
        await withAuthQuotaRetry(
          `claims ${email}`,
          () => auth.setCustomUserClaims(userRecord.uid, { role: 'student', collegeId }),
          { note: noteThrottle }
        )

        // 1b. Prove the identity actually exists before we touch Firestore.
        //     Without this step a failed/omitted Auth write still produced a
        //     student document, which is precisely the "created in Firestore but
        //     not in Authentication" state the project kept hitting.
        const verification = await verifyAuthAccount({
          uid: userRecord.uid,
          email,
          expectedRole: 'student',
          expectedCollegeId: collegeId,
        })
        if (!verification.ok) {
          throw new Error(
            `Firebase Auth account not usable: ${verification.reason || 'verification failed'}`
          )
        }

        // 1c. Optional credential delivery through the reset-link flow.
        let resetLink: string | undefined
        if (deliveryMode === 'reset-email') {
          try {
            resetLink = await auth.generatePasswordResetLink(
              email,
              continueUrl ? { url: continueUrl } : undefined
            )
          } catch (linkErr: any) {
            // The account is valid; only the link could not be minted (for
            // example an unverified continueUrl domain). Report it as a warning
            // on the row rather than discarding a working account.
            logger.error('[StudentAuth] password reset link failed', {
              email,
              error: linkErr?.message || linkErr,
            })
          }
        }

        // 2. Prepare the canonical student doc in /students. Keep both the Auth
        // uid and stable faculty code: new pages query the uid, while old data
        // and timetable/admin screens still display or reference FAC001.
        const rawMentor = String(row.mentorId || '').trim()
        const resolvedMentor = resolveMentorAssignment(mentorDirectory, rawMentor)
        if (rawMentor && !resolvedMentor) {
          const warning = `Mentor "${rawMentor}" did not match a unique faculty profile; assignment was preserved for later repair`
          if (!warnings.includes(warning)) warnings.push(warning)
        }
        const studentRef = db.collection('students').doc()
        const studentData = {
          id: studentRef.id,
          regNo,
          name,
          email,
          phone: row.phone || '',
          collegeId,
          collegeCode: college.code,
          department: String(row.department || '').trim(),
          batch: String(row.batch || '').trim(),
          division: String(row.division || '').trim(),
          semester: normalizeSemester(row.semester),
          mentorId: resolvedMentor?.mentorId || rawMentor,
          mentorFacultyId: resolvedMentor?.mentorFacultyId || rawMentor,
          mentor: resolvedMentor?.mentor || rawMentor,
          dob: row.dob || '',
          gender: row.gender || '',
          address: row.address || '',
          userId: userRecord.uid,
          avatar: '',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'active',
          importedBy: caller.uid,
          importedAt: admin.firestore.FieldValue.serverTimestamp(),
          // Platform access bought for this student (blank when the batch was
          // imported without a product — the MIS reports those as unassigned).
          ...(accessFields || {}),
        }

        // 3. Prepare the user doc in /users (for auth context resolution).
        //    `studentDocId` is the important part: a student may only read their
        //    OWN student profile under the rules, and rules cannot authorise a
        //    query (LIST) for a student. Storing the document id on the caller's
        //    own users/{uid} document lets the client resolve the profile with
        //    two owned `get` reads — no query, no composite index, no
        //    "Missing or insufficient permissions" on the student dashboard.
        const userRef = db.collection('users').doc(userRecord.uid)
        const userData = {
          uid: userRecord.uid,
          id: userRecord.uid,
          name,
          email,
          phone: row.phone || '',
          role: 'student',
          collegeId,
          collegeCode: college.code,
          department: String(row.department || '').trim(),
          batch: String(row.batch || '').trim(),
          division: String(row.division || '').trim(),
          regNo,
          studentDocId: studentRef.id,
          avatar: '',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'active',
          ...(accessFields || {}),
        }

        // 4. Write all Firestore representations atomically. If this commit
        // fails, no orphan student/user/index document is left behind and the
        // Auth user can be safely rolled back below.
        const collegeStudentRef = db
          .collection('colleges')
          .doc(collegeId)
          .collection('students')
          .doc(regNo || studentRef.id)
        const batch = db.batch()
        batch.create(studentRef, studentData)
        batch.set(userRef, userData, { merge: true })
        // The per-college mirror is merged rather than created: a re-import
        // after a partial failure must not abort the row, and legacy mirror
        // documents written by older importers carried a plaintext `password`
        // field, which is stripped here for good.
        batch.set(collegeStudentRef, { ...studentData, studentDocId: studentRef.id }, { merge: true })
        batch.update(db.collection('colleges').doc(collegeId), {
          studentCount: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        await batch.commit()

        // Track success
        authVerifiedCount++
        existingEmails.add(email)
        existingRegNos.add(regNo)
        existingUserEmails.add(email)
        if (reclaimedAuthUid) reclaimedCount++
        else createdCount++

        results.push({
          regNo,
          name,
          email,
          success: true,
          uid: userRecord.uid,
          // In reset-link mode the importer must not be handed a password.
          password: deliveryMode === 'reset-email' ? undefined : password,
          reclaimed: !!reclaimedAuthUid,
          studentDocId: studentRef.id,
          authVerified: true,
          delivery: deliveryMode === 'reset-email' ? 'reset-link' : 'temp-password',
          resetLink,
        })

        logger.info(`[StudentAuth] ${reclaimedAuthUid ? 'Reclaimed' : 'Created'} student`, {
          regNo,
          uid: userRecord.uid,
          collegeId,
          reclaimed: !!reclaimedAuthUid,
          by: caller.uid,
        })
      } catch (err: any) {
        failedCount++
        const message = err.message || 'Unknown error'
        errors.push({ row: rowNum, regNo, message })
        results.push({ regNo, name, email, success: false, error: message })
        logger.error(`[StudentAuth] Failed to create student ${regNo}:`, err)

        // Roll back only the Auth UID created by this loop iteration. A
        // reclaimed account pre-existed and is never deleted; a createUser
        // failure (for example email-already-exists) also leaves this null.
        if (createdAuthUid) {
          try {
            await auth.deleteUser(createdAuthUid)
            logger.info(`[StudentAuth] Rolled back auth user`, {
              uid: createdAuthUid,
              email,
            })
          } catch (rollbackError) {
            logger.error(`[StudentAuth] Failed to roll back auth user`, {
              uid: createdAuthUid,
              email,
              rollbackError,
            })
          }
        }
      }
    }

    // ── Log action ──
    // Do not report the completed import as failed solely because the
    // diagnostic log could not be written.
    try {
      await db.collection('logs').add({
        action: 'BULK_STUDENT_IMPORT',
        collegeId,
        performedBy: caller.uid,
        performedByName: caller.name,
        total: students.length,
        created: createdCount,
        reclaimed: reclaimedCount,
        failed: failedCount,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        elapsedMs: Date.now() - startTime,
      })
    } catch (logError) {
      logger.error('[StudentAuth] Failed to write import audit log', {
        collegeId,
        performedBy: caller.uid,
        created: createdCount,
        reclaimed: reclaimedCount,
        failed: failedCount,
        logError,
      })
    }

    if (authVerifiedCount < createdCount + reclaimedCount) {
      warnings.push(
        `${createdCount + reclaimedCount - authVerifiedCount} row(s) were not verified against Firebase Authentication.`
      )
    }

    return withApiVersion({
      success: failedCount === 0 && authVerifiedCount === createdCount + reclaimedCount,
      total: students.length,
      created: createdCount,
      reclaimed: reclaimedCount,
      failed: failedCount,
      authVerified: authVerifiedCount,
      errors,
      students: results,
      collegeId,
      warnings,
    }) as BulkResult
  }
)