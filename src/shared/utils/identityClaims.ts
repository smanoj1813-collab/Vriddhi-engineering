// src/shared/utils/identityClaims.ts
//
// Detects when the caller's ID token is out of sync with the identity the
// app resolved from Firestore, and classifies Firestore permission errors so
// the UI can say *what to do* instead of echoing "Missing or insufficient
// permissions".
//
// WHY BOTH ROLE AND COLLEGE MUST BE COMPARED
// firestore.rules take the role AND the collegeId tenant from the
// ID-token custom claims only. A token can therefore be stale in two ways:
//   * the role claim is missing or different (the classic "logged in but
//     every page is empty" state), or
//   * the collegeId claim is missing or different while the role claim is
//     correct. That one was invisible: resolveIdentity only compared roles,
//     so the self-heal never ran, the UI happily displayed the profile's
//     college, and every WRITE the faculty made (staff attendance included)
//     was denied by the tenant check while reads of their own rows still
//     worked — the most confusing subset of "login is broken".
//
// The server-side mirror of this decision lives in
// functions/src/selfIdentity.ts (resolveIdentityTarget). Keep the two in
// sync: the client must flag exactly the tokens that syncMyIdentity would
// re-issue, or the self-heal either never fires or loops.

/**
 * Role spellings that must mean the same thing as the canonical roles.
 * Kept in sync with normalizeRole() in firestore.rules and in
 * functions/src/identityShared.ts: a token minted with an aliased spelling
 * must be recognised as the role it is.
 */
const ROLE_ALIASES: Record<string, string> = {
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
  owner: 'superadmin',
  learner: 'student',
  pupil: 'student',
  guardian: 'parent',
  accountant: 'accounts',
  account: 'accounts',
  finance: 'accounts',
  librarian: 'operations',
  operation: 'operations',
}

const CANONICAL_ROLES = ['superadmin', 'admin', 'principal', 'hod', 'mentor', 'faculty', 'student', 'parent', 'accounts', 'operations']

/** trim + case-fold + canonical aliases → '' when nothing recognised. */
export function canonicalizeRole(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  const aliased = ROLE_ALIASES[raw]
  if (aliased) return aliased
  return CANONICAL_ROLES.includes(raw) ? raw : ''
}

/** A snapshot of the ID-token custom claims the decision depends on. */
export interface ClaimSnapshot {
  role?: unknown
  collegeId?: unknown
}

/**
 * The identity the app resolved for the signed-in account, exactly as
 * resolveIdentity() reports it: `role` is already normalised (null only in
 * the degenerate case where resolution produced no role at all — nothing to
 * compare against, so no staleness), `collegeId` is the PROFILE/`users`
 * document value (which may be null for accounts whose documents simply do
 * not carry a college).
 */
export interface ResolvedIdentity {
  role: string | null
  collegeId?: string | null
}

export interface ClaimStaleness {
  /** Role OR college claim disagrees with the resolved identity. */
  stale: boolean
  roleStale: boolean
  collegeStale: boolean
  claimedRole: string | null
  claimedCollegeId: string | null
  expectedRole: string | null
  expectedCollegeId: string | null
}

/**
 * Decide whether the ID token must be re-issued via syncMyIdentity.
 *
 * Mirrors resolveIdentityTarget() in functions/src/selfIdentity.ts:
 *   * the superadmin role is cross-college — its college target is null, so a
 *     stray college claim is itself staleness (the sync strips it);
 *   * every tenant role targets the profile college, and when the profile
 *     carries no college the token's existing claim is the target — which is
 *     what "missing everywhere" must look like when it is NOT broken, so an
 *     account with no college anywhere does not loop the self-heal.
 */
export function detectClaimStaleness(
  claims: ClaimSnapshot,
  resolved: ResolvedIdentity,
): ClaimStaleness {
  const claimedRole = canonicalizeRole(claims.role) || null
  // The collegeId claim is compared RAW, unlike role. The security rules do
  // `data.collegeId == request.auth.token.collegeId` with NO normalisation,
  // so a claim that only matches the profile after trimming is exactly the
  // stale state that must be re-issued. Trimming here was the production
  // failure: a college id carrying an invisible trailing character read as
  // "current" to this check (both sides trimmed) while every tenant-scoped
  // write was refused by the rules (strict comparison) — and no self-heal
  // ever fired. Role is different: the rules canonicalise spellings, so the
  // claim is canonicalised the same way.
  const claimedCollegeId =
    claims.collegeId != null && String(claims.collegeId).trim() !== ''
      ? String(claims.collegeId)
      : null

  const expectedRole = canonicalizeRole(resolved.role) || resolved.role || null
  const expectedCollegeId =
    expectedRole === 'superadmin'
      ? null
      : (resolved.collegeId ? String(resolved.collegeId) : '') || claimedCollegeId

  const roleStale = claimedRole !== expectedRole
  const collegeStale = claimedCollegeId !== expectedCollegeId

  return {
    stale: roleStale || collegeStale,
    roleStale,
    collegeStale,
    claimedRole,
    claimedCollegeId,
    expectedRole,
    expectedCollegeId,
  }
}

/** True for a Firebase permission denial (rules or Auth). */
export function isPermissionDeniedError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code ?? '').toLowerCase()
  const message = String((err as { message?: unknown })?.message ?? err ?? '')
  return (
    code.includes('permission-denied') ||
    code.includes('insufficient-permissions') ||
    /missing or insufficient permissions/i.test(message)
  )
}

/**
 * Actionable copy for a permission denial on an account whose claims may be
 * stale. The raw "Missing or insufficient permissions" tells the user nothing
 * they can do; this one does.
 */
export function staleClaimMessage(operation: string): string {
  return (
    `Security rules refused this ${operation}. This usually means your sign-in token is ` +
    `missing the role/college your account was issued, so the app cannot prove who you are. ` +
    `Sign out and sign back in to refresh it; if it still fails, ask a superadmin to run ` +
    `Access Control → Identity Repair for your account.`
  )
}

/**
 * Actionable copy for the case where the sign-in token ALREADY carries the
 * role and college the account's profile declares, yet the rules still
 * refused the operation. The token is provably not the problem — which means
 * the deployed Firestore rules or Cloud Functions predate the code in this
 * repository (e.g. the rules lack the write grant this operation needs).
 * Telling this user to "sign out and back in" or to run Identity Repair
 * changes nothing; the deployment does.
 */
export function staleDeployMessage(operation: string): string {
  return (
    `Security rules refused this ${operation}, but your sign-in token already carries the ` +
    `role and college your account was issued — so the refusal is not a token problem. ` +
    `The deployed security rules or backend functions are older than this app. ` +
    `Ask the platform admin to run "npm run deploy:all" (deploys rules, functions, storage ` +
    `and hosting together) from this repository, then retry. A normal sign-out/sign-in ` +
    `will not fix this one.`
  )
}
