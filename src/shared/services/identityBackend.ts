// src/shared/services/identityBackend.ts
// Client-side contract for the identity / provisioning Cloud Functions, shared
// by the auth context (self-heal at sign-in) and the superadmin import screens.
//
// WHY THIS FILE EXISTS
// The import pages used to treat "the callable threw" and "zero rows were
// created" as a normal, quiet result. That is how a multi-day debugging session
// starts: this project's CI builds but never deploys, and Firestore rules,
// Cloud Functions and Hosting are three independent deploys — so the frontend
// can call `bulkCreateStudentAccounts` while the platform answers
// `functions/not-found`, the catch block pushes a string into an errors array,
// and the admin is left with rows in `students` and nothing in Authentication.
//
// Everything here makes that state impossible to mistake:
//   * identityBackendMismatch() — version handshake with the deployed backend;
//     a stale backend fails loudly BEFORE any data is written.
//   * describeIdentityError()   — turns raw `functions/*` codes into the exact
//     command to run.
//   * syncMyIdentity()          — re-issues a missing role claim so an account
//     that "logs in but sees nothing" can repair itself.

import { auth, functions } from '@/Firebase/config'
import { httpsCallable } from 'firebase/functions'
import { sendPasswordResetEmail } from 'firebase/auth'

/**
 * Must match IDENTITY_API_VERSION in functions/src/identityShared.ts.
 * Bump both together and deploy functions + hosting in one command.
 */
export const EXPECTED_IDENTITY_API_VERSION = 'identity-2026.09.04-a'

export const DEPLOY_COMMAND =
  'firebase deploy --only firestore:rules,functions,hosting --project vriddhi-engineering'

/** Rows the importer hands to the user; a password is shown once, never stored. */
export interface CredentialRow {
  email: string
  name?: string
  role?: string
  docId?: string
  uid?: string
  password?: string
  resetLink?: string
  status?: 'created' | 'reclaimed' | 'skipped' | 'failed'
  authVerified?: boolean
  delivery?: 'temp-password' | 'reset-link' | 'none'
  error?: string
}

export type CredentialDelivery = 'temp-password' | 'reset-email'

export interface IdentityBackendMismatch {
  kind: 'backend-mismatch'
  expected: string
  actual?: string
  message: string
}

function codeOf(err: any): string {
  return String(err?.code || err?.error?.code || '').toLowerCase()
}

/**
 * Turn a callable failure into something actionable.
 *
 * `functions/not-found` for a function that exists in the repository has exactly
 * one meaning: the deployed codebase is stale, or it lives in another
 * region/project. Saying "Cloud Function error" hides that, which is how this
 * bug survived several rounds of "fixes".
 */
export function describeIdentityError(err: any, fnName?: string): string {
  const code = codeOf(err)
  const raw = err?.message || String(err || '')
  const where = fnName ? `${fnName}: ` : ''

  if (code.includes('not-found') || code.includes('failed-precondition') || code.includes('unimplemented')) {
    return (
      `${where}this Cloud Function is not deployed in the region the app calls (asia-south1), ` +
      `so the deployed backend is older than this frontend. Deploy it with:\n\n  ${DEPLOY_COMMAND}\n\n` +
      `Raw error: ${raw}`
    )
  }
  if (code.includes('unavailable') || code.includes('internal')) {
    return (
      `${where}the Cloud Function failed before it could provision anything (${code}). ` +
      'A stale deployment or a cold-start crash looks exactly like this. Check ' +
      '`firebase functions:log --only functions` and redeploy:\n\n  ' +
      `${DEPLOY_COMMAND}\n\nRaw error: ${raw}`
    )
  }
  if (code.includes('unauthenticated') || code.includes('permission-denied')) {
    return (
      `${where}your account is not authorised to provision identities. This needs superadmin ` +
      '(or admin/HOD/principal for your own college), and the role must be present in your ID-token ' +
      'claims — sign out and back in after any role change, and deploy the current Firestore rules.'
    )
  }
  if (code.includes('resource-exhausted') || code.includes('deadline-exceeded')) {
    if (/repair/i.test(fnName || '')) {
      // A repair sweep is bounded by the function's wall clock, not by the size of
      // a file: the right response to running out of time is to narrow the scope,
      // not to give up. Telling someone to "split the file into batches" here sent
      // them looking for a CSV that does not exist in this flow.
      return (
        `${where}the sweep hit its time budget before covering every document. That is a scope result, ` +
        'not a failure: pick a single college (or a single collection), lower the per-collection limit, ' +
        'or raise the time budget, then re-run. The repair is idempotent — identities already fixed are ' +
        'recognised and skipped, so repeating it is safe.'
      )
    }
    return (
      `${where}the import ran out of time or quota part-way through. Split the file into batches of ` +
      '100 rows and re-run — accounts that already exist are detected and skipped, so re-running is safe.'
    )
  }
  return raw || 'Unknown Cloud Function error'
}

/**
 * Version handshake. Returns a description of the mismatch when the deployed
 * functions do not match what this frontend expects; `undefined` when they agree.
 */
export function identityBackendMismatch(data: any, fnName: string): IdentityBackendMismatch | undefined {
  const actual = data?.apiVersion
  if (actual === EXPECTED_IDENTITY_API_VERSION) return undefined
  return {
    kind: 'backend-mismatch',
    expected: EXPECTED_IDENTITY_API_VERSION,
    actual: typeof actual === 'string' ? actual : undefined,
    message: actual
      ? `${fnName}: the deployed Cloud Functions report "${actual}" but this build requires ` +
        `"${EXPECTED_IDENTITY_API_VERSION}". The provisioning contract differs between those ` +
        `versions, so redeploy before importing:\n\n  ${DEPLOY_COMMAND}`
      : `${fnName}: the deployed Cloud Function did not report an identity API version, so it predates ` +
        `the Auth-verification contract this UI depends on — Auth accounts and passwords will appear to ` +
        `be "not generated". Redeploy the functions:\n\n  ${DEPLOY_COMMAND}`,
  }
}

export interface SyncMyIdentityResult {
  updated: boolean
  role: string
  collegeId: string | null
  reauthenticateRequired: boolean
  message: string
  apiVersion: string
}

/**
 * Re-issue the caller's own custom claims from their `users/{uid}` profile.
 *
 * Called when a profile resolves but the ID token carries no role claim: under
 * claim-authoritative rules such an account can sign in and then have every
 * staff read denied — the "I logged in but everything is empty / Missing or
 * insufficient permissions" state.
 */
export async function syncMyIdentity(): Promise<SyncMyIdentityResult | null> {
  const call = httpsCallable<Record<string, never>, SyncMyIdentityResult>(functions, 'syncMyIdentity')
  try {
    const result = await call({})
    return result.data
  } catch (err: any) {
    // No profile at all is an expected outcome here; anything else is worth
    // logging because it explains an otherwise mysterious lock-out.
    const code = codeOf(err)
    if (code.includes('not-found') || code.includes('permission-denied')) return null
    console.warn('[identityBackend] syncMyIdentity failed:', describeIdentityError(err, 'syncMyIdentity'))
    return null
  }
}

/**
 * Send a Firebase password-reset email straight from the browser.
 *
 * This is the answer to "I have to open Firestore to read the faculty password":
 * you never need the password. The person sets their own, and no plaintext
 * credential is stored on any document the college can read.
 */
export async function sendPasswordResetEmailTo(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase())
}

/** Render credential rows as CSV for download. */
export function credentialsToCsv(rows: CredentialRow[]): string {
  const header = ['Name', 'Email', 'Role', 'Status', 'Password', 'Reset link', 'Document ID', 'Notes']
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const lines = rows.map((row) =>
    [
      row.name,
      row.email,
      row.role,
      row.status ?? (row.password ? 'created' : 'unknown'),
      row.password ?? '',
      row.resetLink ?? '',
      row.docId,
      row.error ?? (row.authVerified === false ? 'Auth account NOT verified' : ''),
    ]
      .map(escape)
      .join(',')
  )
  return [header.map(escape).join(','), ...lines].join('\n')
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
