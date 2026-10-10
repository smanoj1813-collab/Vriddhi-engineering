import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/identityShared.ts
// Shared primitives for every account-provisioning callable.
//
// WHY THIS FILE EXISTS
// Before this, password generation, caller authorisation and (crucially) the
// "did the Auth account actually get created?" check were duplicated in
// studentAuth.ts, staffAuth.ts, userProvisioning.ts and roleManagement.ts.
// Duplicated provisioning logic is how an import could write the Firestore
// profile but silently skip the Auth account: the copies drifted apart and no
// layer ever verified the end state.
//
// THE HANDSHAKE
// Every provisioning/identity callable returns `apiVersion`. The web client
// compares it with its own expectation and refuses to report success when the
// deployed backend is older than the frontend it is talking to. Hosting,
// Firestore rules and Cloud Functions are deployed independently in this
// project (CI builds but never deploys), so a frontend that expects
// "create Auth + profile + users doc + claims" silently running against an
// older function is a real, repeated failure mode — it is exactly the
// "students were created in Firestore but not in Authentication" symptom.

import { HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import * as crypto from 'crypto'

/**
 * Bump this whenever the Auth/profile write contract changes, then deploy
 * functions AND hosting together. The client refuses to call an import a
 * success unless it matches.
 */
export const IDENTITY_API_VERSION = 'identity-2026.09.04-a'

/** Roles that may create or repair other accounts. */
export const STAFF_CREATOR_ROLES = ['superadmin', 'admin', 'hod', 'principal']
/** Every role the identity model knows about. */
export const PROVISIONABLE_ROLES = [
  'superadmin',
  'admin',
  'principal',
  'hod',
  'mentor',
  'faculty',
  'student',
  'parent',
  // College office roles (no academic access): the accounts team owns fees,
  // payments, payroll preparation and post-approval processing; the principal
  // owns payroll review/approval. Operations owns the library, inventory and stores.
  'accounts',
  'operations',
  // Vriddhi platform employee: academic staff assigned across colleges, not a
  // member of any one institution.
  'employee',
]

/** Office roles a principal may create for their own college. */
export const OFFICE_ROLES = ['accounts', 'operations']

/**
 * Does this account have an identity profile of any recognised kind?
 *
 * `users` and `superadmins` are the top-level anchors, but `accounts` and
 * `operations` are filed only on a college office roster — so for a correctly
 * provisioned office account both are null and the roster row IS the profile.
 *
 * Counting it here is what stops Access Control from reporting a healthy
 * office account as having no identity at all, which in turn is what invites
 * an operator to "repair" an account that needs no repair.
 */
export function hasIdentityProfile(facts: {
  usersDoc: unknown
  superadminDoc: unknown
  officeRows: readonly unknown[]
}): boolean {
  return Boolean(facts.usersDoc) || Boolean(facts.superadminDoc) || facts.officeRows.length > 0
}

// Profile collections that hold a person, in role-resolution order.
export const PROFILE_COLLECTIONS = [
  'superadmins',
  'admins',
  'hods',
  'mentors',
  'faculty',
  'students',
] as const

/** Collection name -> role implied by membership of that collection. */
export const COLLECTION_ROLE: Record<string, string> = {
  superadmins: 'superadmin',
  admins: 'admin',
  hods: 'hod',
  mentors: 'mentor',
  faculty: 'faculty',
  students: 'student',
}

/**
 * Field names generations of importers have used for the tenant id, in trust
 * order. The web client already tolerates every one of these
 * (src/modules/auth/context/auth.ts maps faculty docs via `collegeId ||
 * collegeID`, and the API middleware accepts `college_id`), so the backend
 * identity chain must read the same spellings or it declares a healthy
 * account "unrepairable" while the client happily signs it in.
 */
export const COLLEGE_ID_FIELDS = ['collegeId', 'collegeID', 'college_id'] as const

/** First non-empty college id found on a profile/users document, or null. */
export function pickCollegeId(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null
  for (const field of COLLEGE_ID_FIELDS) {
    const value = data[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_RE.test(value.trim())
}

/**
 * Cryptographically secure temporary password.
 *
 * Ambiguous glyphs (0/O, 1/l/I) are excluded because these credentials are
 * read out loud and typed by hand. The alphabet always yields a password that
 * satisfies the Firebase Auth minimum (upper, lower, digit, symbol).
 */
export function generateRandomPassword(length = 14): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const nums = '23456789'
  const special = '!@#$%^&*'
  const all = upper + lower + nums + special
  const pick = (set: string) => set[crypto.randomInt(0, set.length)]
  const chars = [pick(upper), pick(lower), pick(nums), pick(special)]
  for (let i = chars.length; i < length; i++) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function normalizeRole(value: unknown, fallback = ''): string {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return fallback
  // Kept in sync with canonicalRole() in firestore.rules: the same
  // spreadsheet spelling has to mean the same thing in the importer and in the
  // rules that authorise the resulting account, or a row is accepted with one
  // role and enforced as another.
  const canonical: Record<string, string> = {
    teacher: 'faculty',
    professor: 'faculty',
    lecturer: 'faculty',
    instructor: 'faculty',
    'teaching staff': 'faculty',
    'teaching-staff': 'faculty',
    'teaching_staff': 'faculty',
    'faculty member': 'faculty',
    'faculty-member': 'faculty',
    'assistant professor': 'faculty',
    'associate professor': 'faculty',
    'head of department': 'hod',
    'head of dept': 'hod',
    'head-of-department': 'hod',
    'head_of_department': 'hod',
    'dept head': 'hod',
    'department head': 'hod',
    depthead: 'hod',
    'vice principal': 'principal',
    'vice-principal': 'principal',
    'vice_principal': 'principal',
    administrator: 'admin',
    'admin staff': 'admin',
    'college admin': 'admin',
    'super admin': 'superadmin',
    'super-admin': 'superadmin',
    super_admin: 'superadmin',
    superuser: 'superadmin',
    superadmin: 'superadmin',
    owner: 'superadmin',
    learner: 'student',
    pupil: 'student',
    guardian: 'parent',
  }
  return canonical[raw] ?? (PROVISIONABLE_ROLES.includes(raw) ? raw : fallback)
}

/**
 * Resolve the caller's authoritative identity.
 *
 * The role comes from the ID-token custom claim when present. Accounts that
 * predate the claims work are recognised through `superadmins/{uid}` only —
 * never through an arbitrary profile document, because those documents are
 * client-writable and would let a caller mint privileges for themselves.
 */
export async function verifyCaller(
  request: { auth?: { uid: string } },
  allowedRoles: string[] = STAFF_CREATOR_ROLES
): Promise<{ uid: string; role: string; collegeId?: string; name?: string }> {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated')
  }
  const db = getFirestore(admin.app(), 'default')
  const userDoc = await db.doc(`users/${request.auth.uid}`).get()
  const userData = userDoc.data() as Record<string, unknown> | undefined
  if (!userData) {
    const superadminDoc = await db.doc(`superadmins/${request.auth.uid}`).get()
    if (!superadminDoc.exists) {
      throw new HttpsError(
        'permission-denied',
        'Caller identity could not be resolved. Ask a superadmin to run Access Control → Identity audit for this account.'
      )
    }
    return { uid: request.auth.uid, role: 'superadmin', collegeId: undefined }
  }

  const role = normalizeRole(userData.role, String(userData.role || '').toLowerCase())
  if (!allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', `Role "${role || 'unknown'}" cannot perform this operation`)
  }
  // Trimmed: this value is compared against profile collegeId fields by the
  // provisioning/identity callables, and legacy imports have stored those
  // with invisible trailing characters.
  const callerCollege = typeof userData.collegeId === 'string' ? userData.collegeId.trim() : ''
  return {
    uid: request.auth.uid,
    role,
    collegeId: callerCollege || undefined,
    name: (userData.name as string | undefined) || undefined,
  }
}

export interface AuthVerification {
  ok: boolean
  uid?: string
  email?: string | null
  role?: string | null
  collegeId?: string | null
  reason?: string
}

/**
 * Read the Auth account back and confirm it matches what we intended to write.
 *
 * This is the check that turns "students were created in Firestore but not in
 * Authentication" from an invisible state into a hard, per-row failure: a
 * provisioning row is only reported as successful when a live Auth credential
 * exists for the email, is enabled, and carries the expected role claim.
 */
export async function verifyAuthAccount(opts: {
  uid?: string
  email: string
  expectedRole?: string
  expectedCollegeId?: string | null
}): Promise<AuthVerification> {
  const auth = admin.auth()
  let record: admin.auth.UserRecord | null = null
  try {
    record = opts.uid ? await auth.getUser(opts.uid) : await auth.getUserByEmail(opts.email)
  } catch (err: any) {
    return {
      ok: false,
      reason:
        err?.code === 'auth/user-not-found'
          ? `No Firebase Auth account exists for ${opts.email}`
          : err?.message || 'Unable to read the Firebase Auth account',
    }
  }
  if (!record) return { ok: false, reason: `No Firebase Auth account exists for ${opts.email}` }
  if (record.disabled) {
    return { ok: false, uid: record.uid, reason: 'The Firebase Auth account is disabled' }
  }
  const claims = (record.customClaims || {}) as Record<string, unknown>
  const roleClaim = normalizeRole(claims.role)
  const collegeClaim = claims.collegeId ? String(claims.collegeId) : null
  if (opts.expectedRole && roleClaim !== opts.expectedRole) {
    return {
      ok: false,
      uid: record.uid,
      email: record.email,
      role: roleClaim || null,
      collegeId: collegeClaim,
      reason: `Role claim is "${roleClaim || 'missing'}" but "${opts.expectedRole}" was provisioned`,
    }
  }
  if (opts.expectedCollegeId && collegeClaim !== opts.expectedCollegeId) {
    return {
      ok: false,
      uid: record.uid,
      email: record.email,
      role: roleClaim || null,
      collegeId: collegeClaim,
      reason: `College claim is "${collegeClaim || 'missing'}" but "${opts.expectedCollegeId}" was provisioned`,
    }
  }
  return {
    ok: true,
    uid: record.uid,
    email: record.email,
    role: roleClaim || null,
    collegeId: collegeClaim,
  }
}

/** Look up an Auth user by email, returning null instead of throwing. */
export async function findAuthUserByEmail(
  email: string
): Promise<admin.auth.UserRecord | null> {
  try {
    return await admin.auth().getUserByEmail(email)
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') return null
    throw err
  }
}

/**
 * Normalise a phone into E.164 for the last 10 Indian digits. Kept identical to
 * the previous inline logic so importing behaviour does not change.
 */
export function toPhoneE164(phone: unknown): string | undefined {
  const digits = String(phone ?? '').replace(/\D/g, '').slice(-10)
  return digits.length === 10 ? `+91${digits}` : undefined
}

/** Fields that must never live on a profile document. */
// Kept in sync with noPasswordField() in firestore.rules: the callables
// delete these keys when they provision a person, and the rules refuse to write
// them in the first place. A field stripped here but allowed there (or the
// reverse) is how "we removed the plaintext passwords" quietly stops being true.
export const SECRET_PROFILE_FIELDS = [
  'password',
  'passwordHash',
  'passwordhash',
  'tempPassword',
  'temporaryPassword',
  'defaultPassword',
  'plainPassword',
  'pwd',
] as const

/**
 * Run `worker` over `items` with at most `concurrency` in flight, preserving the
 * input order in the result.
 *
 * Provisioning and repair work is dominated by per-account round trips to the
 * Identity Platform and Firestore APIs: a sweep of a few thousand profiles run
 * serially cannot finish inside a Cloud Function's 540-second ceiling, which
 * surfaces to the operator as `functions/deadline-exceeded` on a job that is
 * actually fine. Bounding the fan-out (rather than raising the timeout) keeps the
 * Auth API happy and keeps a partial pass resumable.
 */
/**
 * Order-preserving bucketing: items are grouped by `keyOf`, buckets appear in
 * first-seen order, and within a bucket input order is kept. Used by the repair
 * pass so that several profile documents describing the SAME Auth account are
 * handled by one worker instead of racing each other across the concurrency lanes.
 */
/**
 * Should this Auth account keep the role claims it carries?
 *
 * With claim-only rules, a claim IS access: whatever `role` and `collegeId` an
 * account carries is what the security rules let it read. So an account carrying a
 * college role that no profile document in the tenant vouches for is either a
 * leftover (the trust-order bug pointed a profile at the wrong account and the
 * repair followed it) or a forgery (the currently deployed rules let staff write
 * their own profile documents, and those documents used to be able to supply a
 * role). Either way it must not survive into a claim-only ruleset.
 *
 * The guards are the point of this function, so they are pure and testable rather
 * than buried in a sweep that can only be exercised against a live project:
 *  - only roles that map to a profile collection are considered, so `parent` and
 *    anything unknown are never touched;
 *  - the operator's own account is never touched, because locking a superadmin out
 *    of a tenant mid-repair is unrecoverable from inside the repair;
 *  - the caller must assert the pass covered every profile collection for every
 *    college, completely — a partial scan would make legitimate accounts look
 *    unbacked and strip working people.
 */
/**
 * Findings a duplicate profile document reports but the pass cannot settle: another
 * profile for the same email owns the account and its claims, so role and claims are
 * deliberately left to that record. Only a human merging or deleting the documents
 * clears them.
 */
export const DUPLICATE_ADVISORY_FINDINGS: readonly string[] = [
  'DUPLICATE_PROFILE',
  'MISSING_CLAIMS',
  'WRONG_CLAIMS',
]

/**
 * True when every finding on a non-primary profile is advice rather than work.
 *
 * Counting these as "needs repair" made every pass report a number no Apply could
 * ever bring to zero, and a counter that never moves is a counter people stop
 * reading — which is exactly how a real finding gets ignored later.
 */
/**
 * Should this pass refuse to replace an existing role claim with the role written on
 * the document it happens to be scanning?
 *
 * Which of several documents owns an account's identity is decided by the set of
 * collections actually scanned. A staff-only pass sees `hods/{id}` and nothing else, so
 * it cannot know the same email also has a `faculty/{id}` saying `faculty` — and the
 * answer would then depend on which scope the operator happened to select, which is how
 * a person's dashboard starts flip-flopping. Filling a *missing* claim is safe from any
 * scope, because nothing is being overwritten.
 */
export function shouldDeferRoleOverwrite(input: {
  existingClaimRole: string | null
  documentRole: string
  scansAllProfileCollections: boolean
  forceClaims: boolean
}): boolean {
  if (input.scansAllProfileCollections || input.forceClaims) return false
  if (!input.existingClaimRole) return false
  return input.existingClaimRole !== input.documentRole
}

export function isAdvisoryForDuplicate(findings: readonly string[]): boolean {
  return (
    findings.length > 0 &&
    findings.every((finding) => DUPLICATE_ADVISORY_FINDINGS.includes(finding))
  )
}

export function shouldReclaimUnsupportedClaims(options: {
  claimRole: string | null
  roleHasProfileCollection: boolean
  referencedByProfile: boolean
  isCallerAccount: boolean
  fullTenantScan: boolean
}): boolean {
  if (!options.claimRole) return false
  if (!options.roleHasProfileCollection) return false
  if (options.referencedByProfile) return false
  if (options.isCallerAccount) return false
  if (!options.fullTenantScan) return false
  return true
}

export function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): T[][] {
  const buckets = new Map<string, T[]>()
  const order: string[] = []
  for (const item of items) {
    const key = keyOf(item)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
      order.push(key)
    }
    bucket.push(item)
  }
  return order.map((key) => buckets.get(key) as T[])
}

/**
 * Which Auth account a profile document actually describes.
 *
 * The email on the profile is the anchor, because it is the identifier the person
 * types at sign-in. A profile's `uid` field is a cache: it can be left over from a
 * deleted account, copied from a template row, or point at somebody else entirely.
 * Following it without checking is how a repair tool ends up writing role claims
 * onto — and resetting the password of — the wrong human being.
 *
 * Pure, so the whole decision table is testable without the Admin SDK.
 */
export interface ProfileAccountFacts {
  /** The profile document's email, normalized; null when it has none. */
  profileEmail: string | null
  /** The uid stored on the profile document (`uid`, `userId`, …), if any. */
  linkedUid: string | null
  /** Whether that stored uid still resolves to a live Auth account. */
  linkedUidExists: boolean
  /** The uid of the account found for `profileEmail`, if one exists. */
  emailUid: string | null
}

export type ProfileAccountDecision =
  /** Proceed with this account. `staleLinkedUid` says the document's own uid was wrong. */
  | { kind: 'use-account'; uid: string; source: 'email' | 'uid'; staleLinkedUid: string | null }
  /** Nothing to repair on the Auth side: no account exists for this profile at all. */
  | { kind: 'no-account'; linkedUidDead: boolean }
  /**
   * The document's uid resolves to an account, but that account belongs to a
   * DIFFERENT email, and no account exists for the profile's email. Writing claims
   * here would grant a stranger this college's access; resetting its password
   * would lock a real person out of their own account. Refuse and report.
   */
  | { kind: 'mismatch'; uidOfDocument: string; documentEmail: string | null }

export function decideProfileAccount(facts: ProfileAccountFacts): ProfileAccountDecision {
  const linked = facts.linkedUidExists ? facts.linkedUid : null

  if (facts.emailUid) {
    // The sign-in identifier resolves, so it decides. A linked uid pointing at
    // another account is reported as stale and re-pointed, never followed.
    return {
      kind: 'use-account',
      uid: facts.emailUid,
      source: 'email',
      staleLinkedUid: facts.linkedUid && facts.linkedUid !== facts.emailUid ? facts.linkedUid : null,
    }
  }

  if (facts.profileEmail) {
    // No account for the profile's email. If the document's uid still resolves, it
    // belongs to somebody else — that is a mismatch, not a login to reclaim.
    if (linked) {
      return { kind: 'mismatch', uidOfDocument: linked, documentEmail: facts.profileEmail }
    }
    return { kind: 'no-account', linkedUidDead: Boolean(facts.linkedUid) }
  }

  // A profile with no email has nothing but its uid to go on.
  if (linked) return { kind: 'use-account', uid: linked, source: 'uid', staleLinkedUid: null }
  return { kind: 'no-account', linkedUidDead: false }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const laneCount = Math.max(1, Math.min(concurrency, items.length || 1))
  const lanes = Array.from({ length: laneCount }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(lanes)
  return results
}

/**
 * Remove plaintext credentials that older importers used to persist on profile
 * documents. Profile docs are readable by other staff in the same college, so
 * a stored password is a credential leak — and it is also the reason the
 * workflow "open Firestore and read the password" never went away.
 */
// ─── Auth API throttling ───────────────────────────────────────────────────
// Identity Platform rate-limits writes to a single account type hard enough
// that a bulk pass trips it: repairing 380 students at 24-way concurrency got
// through ~230 claim writes and then started failing with
// "Exceeded quota for updating account information" (the Admin SDK reports that
// server-side throttle as auth/unknown, not as a distinct code). Nothing in the
// product retried it, so each throttled row stayed broken and the operator had
// to run the pass again and hope. Throttling is transient and idempotent here,
// so back off and try again instead of reporting a failure the operator has to
// interpret.
const QUOTA_MESSAGE =
  /exceeded quota|rate.?limit|too many requests|retry.?(later|again)|resource.?(exhausted|limit)/i
const QUOTA_CODE = /(quota|too-many-requests|resource-exhausted)/i

/** True when an Admin SDK error means "you are writing too fast", not "wrong". */
export function isAuthQuotaThrottle(error: unknown): boolean {
  const e = error as {
    code?: unknown
    message?: unknown
    errorInfo?: { code?: unknown; message?: unknown }
  } | null
  const code = String(e?.errorInfo?.code ?? e?.code ?? '')
  const message = String(e?.errorInfo?.message ?? e?.message ?? '')
  return QUOTA_CODE.test(code) || QUOTA_MESSAGE.test(message)
}

/**
 * Run an Auth write, retrying only quota-shaped failures with jittered
 * exponential backoff. `note` exists so callers can log through their own
 * logger — this module is unit-tested without firebase-functions loaded.
 */
export async function withAuthQuotaRetry<T>(
  label: string,
  action: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; note?: (message: string) => void } = {}
): Promise<T> {
  const attempts = Math.max(1, Math.floor(opts.attempts ?? 4))
  const base = Math.max(0, opts.baseDelayMs ?? 400)
  for (let attempt = 1; ; attempt++) {
    try {
      return await action()
    } catch (err) {
      if (attempt >= attempts || !isAuthQuotaThrottle(err)) throw err
      const backoffMs = base * 2 ** (attempt - 1) + Math.floor(Math.random() * (base / 2))
      opts.note?.(
        `${label}: Auth API throttled this project (attempt ${attempt} of ${attempts}), waiting ${backoffMs}ms`
      )
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
}

export function secretFieldDeletes(
  data: Record<string, unknown> | undefined
): Record<string, admin.firestore.FieldValue> {
  const deletes: Record<string, admin.firestore.FieldValue> = {}
  if (!data) return deletes
  for (const field of SECRET_PROFILE_FIELDS) {
    if (field in data) deletes[field] = admin.firestore.FieldValue.delete()
  }
  return deletes
}

/** Shape every identity callable returns so the client can detect drift. */
export function withApiVersion<T extends object>(payload: T): T & { apiVersion: string } {
  return { ...payload, apiVersion: IDENTITY_API_VERSION }
}

/**
 * Pure helper — unit tested (test/accountManagement.test.ts). Returns a copy
 * of the claims with `mustChangePassword` removed, preserving every other
 * claim exactly. Used by clearMyMustChangePassword after a user rotates their
 * one-time password from the client.
 */
export function stripMustChangePassword(
  claims: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(claims || {}) }
  delete next.mustChangePassword
  return next
}
