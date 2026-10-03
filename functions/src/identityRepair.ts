import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/identityRepair.ts
// Bulk identity repair for accounts that exist in Firestore but not in
// Firebase Authentication (or exist in Auth without claims / without a
// users/{uid} lookup document).
//
// WHY THIS EXISTS
// This project has had three generations of provisioning code:
//   1. client-side Identity Toolkit `signUp` (creates Auth, no claims, no users doc)
//   2. client-side Firestore-only writes (creates the profile, NO Auth account)
//   3. Admin SDK callables (Auth + claims + users doc + profile)
// Every transition left a cohort of half-provisioned accounts behind: the CSV
// was uploaded, the list page shows the student/faculty, but sign-in fails with
// "account not found" because there is no credential to sign in with. Repairing
// those one-by-one in the console does not scale, so this callable performs the
// same reconciliation a superadmin would do by hand — atomically, per row, and
// with a dry run first.
//
// WHAT IT CONSIDERS A BROKEN IDENTITY
//   MISSING_AUTH          profile doc exists, no Firebase Auth user
//   STALE_UID_LINK        profile points at a uid that no longer exists
//   MISSING_CLAIMS        Auth user exists but has no role claim (rules then
//                         deny every staff read — the classic "logged in but
//                         every page is empty / permission-denied")
//   WRONG_CLAIMS          role or college claim disagrees with the profile
//   MISSING_USERS_DOC     no users/{uid} lookup document
//   DUPLICATE_PROFILE     two profile documents describe the same email, so only
//                         the first one in collection order may decide the claims
//   STALE_CLAIMS_NO_PROFILE
//                         an Auth account carries a college role that no profile
//                         document in the tenant vouches for: claims stripped
//   UID_EMAIL_MISMATCH    the profile's own `uid` resolves to an account for a
//                         DIFFERENT email: the row is refused, never repaired
//   MISSING_PROFILE_LINK  users/{uid} does not point back at the profile id,
//                         so the client can only resolve its own profile via a
//                         query, which the rules deny for students
//   ACCOUNT_DISABLED      Auth account disabled (login impossible)
//   PLAINTEXT_SECRET      a legacy `password` field on the profile document
//
// SAFETY
//   - superadmin only;
//   - dryRun defaults to true and reports the plan without writing;
//   - never overwrites an existing role claim with a lower privilege;
//   - never deletes an Auth account;
//   - never reads or copies a legacy plaintext password — it is deleted, and a
//     new credential (or reset link) is issued instead.

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import {
  COLLECTION_ROLE,
  groupBy,
  generateRandomPassword,
  decideProfileAccount,
  isAdvisoryForDuplicate,
  shouldDeferRoleOverwrite,
  isValidEmail,
  shouldReclaimUnsupportedClaims,
  mapWithConcurrency,
  normalizeEmail,
  normalizeRole,
  secretFieldDeletes,
  verifyCaller,
  withApiVersion,
  withAuthQuotaRetry,
} from './identityShared'

interface RepairInput {
  /** Restrict the sweep to one tenant. Omitted = every college. */
  collegeId?: string
  /** Defaults to students + faculty + admins + hods + mentors + superadmins. */
  collections?: string[]
  /** Report only; no writes. Defaults to true. */
  dryRun?: boolean
  /** Max documents examined per collection. Defaults to 500. */
  limit?: number
  /** 'reset-email' (default) issues a link; 'temp-password' returns a password. */
  deliveryMode?: 'reset-email' | 'temp-password'
  continueUrl?: string
  /** Also re-issue claims for accounts whose claims already match. */
  forceClaims?: boolean
  /** Wall-clock budget for one pass, in seconds (default 420, ceiling 480). */
  budgetSeconds?: number
}

type Finding =
  | 'NO_EMAIL'
  | 'MISSING_AUTH'
  | 'STALE_UID_LINK'
  | 'MISSING_CLAIMS'
  | 'WRONG_CLAIMS'
  | 'MISSING_USERS_DOC'
  | 'DUPLICATE_PROFILE'
  | 'MISSING_PROFILE_LINK'
  | 'ACCOUNT_DISABLED'
  | 'PLAINTEXT_SECRET'
  | 'AUTH_ONLY_NO_PROFILE'
  | 'UID_EMAIL_MISMATCH'
  | 'STALE_CLAIMS_NO_PROFILE'
  | 'DEFERRED_ROLE_OVERWRITE'

interface RepairItem {
  collection: string
  docId: string
  email: string | null
  name: string | null
  role: string | null
  collegeId: string | null
  uid: string | null
  findings: Finding[]
  actions: string[]
  created?: boolean
  password?: string
  resetLink?: string
  /** Set when a credential is handed out for a reason other than "no account existed". */
  credentialReason?: string
  error?: string
}

// `officeStaff` is the college office roster (accounts / operations). It is
// scanned as a subcollection — see the special case in the scan loop — and is
// in this list so an unscoped pass covers office staff like every other role.
const DEFAULT_COLLECTIONS = [
  'students',
  'faculty',
  'admins',
  'hods',
  'mentors',
  'superadmins',
  'officeStaff',
]

/** Profile fields that can carry the Auth uid, in trust order. */
function uidFieldsFor(_collection: string): string[] {
  return ['uid', 'userId']
}

/** How the profile id is published on users/{uid} for owned-get resolution. */
function profileLinkFieldFor(collection: string): string | null {
  if (collection === 'students') return 'studentDocId'
  if (collection === 'faculty') return 'facultyDocId'
  if (collection === 'admins') return 'adminDocId'
  if (collection === 'hods') return 'hodDocId'
  if (collection === 'mentors') return 'mentorDocId'
  return null
}

export const auditAndRepairIdentities = onCall(
  {
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 540,
    maxInstances: 1,
  },
  async (request) => {
    const startedAt = Date.now()
    const input = (request.data || {}) as RepairInput
    const dryRun = input.dryRun !== false
    const limit = Math.min(Math.max(Number(input.limit) || 500, 1), 5000)
    const deliveryMode = input.deliveryMode === 'temp-password' ? 'temp-password' : 'reset-email'
    // A pass that cannot see every profile collection cannot know which document owns
    // an email's identity, so it must not trade one role claim for another.
    const scansAllProfileCollections =
      (input.collections?.length ? input.collections : DEFAULT_COLLECTIONS).length ===
      DEFAULT_COLLECTIONS.length
    const collections = (input.collections?.length ? input.collections : DEFAULT_COLLECTIONS)
      .map((c) => String(c).trim())
      .filter((c) => COLLECTION_ROLE[c])
    if (!collections.length) {
      throw new HttpsError('invalid-argument', 'No supported collection names supplied')
    }

    // Wall-clock budget for ONE pass. The function ceiling is 540 s; stopping at
    // 420 s by default leaves room to write the audit log and return a report, so
    // a large sweep answers with "partial, re-run scoped to X" instead of dying
    // as an opaque deadline error.

    // 24 measured badly: it cleared ~230 rows in 25s and then the Auth API began
    // rejecting claim writes with "Exceeded quota for updating account
    // information". Throttling costs a re-run; a half-repaired cohort costs a
    // support conversation, so the sweep trades throughput for staying under it.
    const CONCURRENCY = 8
    const BUDGET_MS = Math.min(
      480_000,
      Math.max(30_000, Number(input.budgetSeconds) > 0 ? Number(input.budgetSeconds) * 1000 : 420_000)
    )
    const softDeadline = startedAt + BUDGET_MS
    let partial = false
    let stoppedAfter: string | null = null

    const caller = await verifyCaller(request, ['superadmin'])
    const db = getFirestore(admin.app(), 'default')
    const auth = admin.auth()

    const noteThrottle = (message: string) => logger.warn(`[identityRepair] ${message}`)
    const items: RepairItem[] = []
    const counts: Record<string, number> = {}
    let scanned = 0
    let broken = 0
    let repaired = 0
    let authCreated = 0
    let claimsIssued = 0
    let usersDocsCreated = 0
    // The link field, not the document: on this tenant almost every row already had a
    // `users/{uid}` document, so `usersDocsCreated` stayed at 0 while 388 lookup
    // links were being written. Reporting only the creation made a successful pass
    // look like it had done nothing.
    let usersDocsLinked = 0
    // The same number, counted on a dry run: "would write N links" is the figure the
    // operator is actually approving, and a chip that reads 0 on a pass that plans
    // 384 writes is how you talk yourself into thinking nothing was needed.
    let deferredRoleOverwrites = 0
    let linksPlanned = 0
    let secretsStripped = 0
    // Rows where a legacy plaintext credential was destroyed and a usable one
    // had to be handed out in the same breath.
    let secretsResetIssued = 0
    // Set when a row in this pass is the signed-in operator's own identity document.
    // Applying it revokes their refresh tokens, so they must be told before they
    // press the button, not after they are mysteriously logged out mid-audit.
    let operatorAffected = false
    // Rows whose profile email and stored uid describe different people.
    let uidEmailMismatches = 0
    // Accounts whose college role claims were (or would be) revoked for want of a
    // profile document. This is the cleanup for the trust-order bug: the repair
    // once wrote claims onto whichever account a profile's stale `uid` named.
    let claimsStripped = 0
    const strippedAccounts: Array<{ uid: string; email: string | null; role: string | null }> = []
    const errors: string[] = []
    // Credentials minted during this run, returned once to the caller only.
    const credentials: Array<{
      email: string
      password?: string
      resetLink?: string
      reason?: string
    }> = []

    const bump = (finding: Finding) => {
      counts[finding] = (counts[finding] || 0) + 1
    }

    // One pass per profile document, but many documents in flight. The work per
    // row is a handful of round trips to the Identity Platform and Firestore, so
    // a serial sweep of a few thousand profiles cannot finish inside the 540 s
    // function ceiling — the operator sees `deadline-exceeded` on a job that is
    // actually healthy, which is a terrible experience for a repair tool.
    // Result order is preserved (mapWithConcurrency indexes), so a dry-run
    // report is stable between runs and can be diffed.
    const processProfileDocument = async (
      collection: string,
      defaultRole: string,
      docSnap: admin.firestore.QueryDocumentSnapshot,
      opts: { ownsIdentity: boolean }
    ): Promise<void> => {
      if (Date.now() > softDeadline) {
        // Cooperative stop: the fetch phase above cannot know how long the write
        // phase will take, so every unit checks the budget as it starts.
        partial = true
        stoppedAfter = `${collection}/${docSnap.id}`
        return
      }
      scanned++
      const data = docSnap.data() as Record<string, unknown>
      const email = normalizeEmail(data.email) || null
      const name =
        (typeof data.name === 'string' && data.name.trim()) ||
        [data.firstName, data.lastName].filter(Boolean).join(' ').trim() ||
        null
      const role = normalizeRole(data.role, defaultRole) || defaultRole
      const collegeId =
        (typeof data.collegeId === 'string' && data.collegeId) ||
        (typeof data.collegeID === 'string' && data.collegeID) ||
        (typeof data.college === 'string' && data.college) ||
        null
      const linkField = uidFieldsFor(collection).find((field) =>
        typeof data[field] === 'string' && (data[field] as string).length > 0
      )
      const linkedUid = linkField ? String(data[linkField]) : null

      const findings: Finding[] = []
      const actions: string[] = []
      let deferRoleOverwrite = false
      // Findings are counted, not just listed, so the report can say "STALE_UID_LINK
      // × 3". A finding can be reached from two branches (a uid link that no longer
      // resolves *and* a mismatch with the account found by email), so registration is
      // idempotent — otherwise a single row inflates the count the operator triages by.
      const addFinding = (finding: Finding) => {
        if (findings.includes(finding)) return
        findings.push(finding)
        bump(finding)
      }
      let authUser: admin.auth.UserRecord | null = null

      if (!email || !isValidEmail(email)) {
        addFinding('NO_EMAIL')
        items.push({
          collection,
          docId: docSnap.id,
          email,
          name,
          role,
          collegeId,
          uid: linkedUid,
          findings,
          actions,
          error: 'Profile has no usable email address — cannot create a credential',
        })
        broken++
        return
      }

      // Resolve WHICH Auth account this document describes. The profile's email is
      // the anchor, because it is what the person types at sign-in; a `uid` field is
      // a cache that can be stale or point at somebody else entirely. The previous
      // order here — "trust the linked uid first" — is exactly what let a password
      // reset aimed at one faculty member land on another human being's account.
      let emailUser: admin.auth.UserRecord | null = null
      let uidUser: admin.auth.UserRecord | null = null
      try {
        try {
          emailUser = await auth.getUserByEmail(email)
        } catch (err: any) {
          if (err?.code !== 'auth/user-not-found') throw err
        }
        if (linkedUid) {
          try {
            uidUser = await auth.getUser(linkedUid)
          } catch (err: any) {
            if (err?.code !== 'auth/user-not-found') throw err
          }
        }
      } catch (err: any) {
        errors.push(`${collection}/${docSnap.id}: auth lookup failed — ${err?.message || err}`)
        return
      }

      if (linkedUid) profileVouchedUids.add(linkedUid)
      if (docSnap.id && (docSnap.id.length === 28 || docSnap.id.length === 20)) {
        // uid-shaped document ids (superadmins/{uid}, faculty/{uid}) vouch for that uid
        profileVouchedUids.add(docSnap.id)
      }

      const decision = decideProfileAccount({
        profileEmail: email,
        linkedUid,
        linkedUidExists: !!uidUser,
        emailUid: emailUser?.uid || null,
      })
      const refusedMismatch = decision.kind === 'mismatch'
      if (decision.kind === 'use-account') {
        authUser = emailUser || uidUser
        if (decision.staleLinkedUid) addFinding('STALE_UID_LINK')
      } else if (refusedMismatch) {
        uidEmailMismatches++
      }

      if (!opts.ownsIdentity) addFinding('DUPLICATE_PROFILE')
      const affectsOperator = authUser?.uid === caller.uid || (!!linkedUid && linkedUid === caller.uid)
      if (affectsOperator) operatorAffected = true

      if (refusedMismatch) {
        // No Auth-side findings at all for a refused row: which account is right is a
        // human decision, and guessing with role claims is how access gets invented.
        addFinding('UID_EMAIL_MISMATCH')
      } else if (!authUser) {
        addFinding('MISSING_AUTH')
        if (linkedUid) addFinding('STALE_UID_LINK')
      } else {
        if (authUser.disabled) addFinding('ACCOUNT_DISABLED')
        const claims = (authUser.customClaims || {}) as Record<string, unknown>
        const claimRole = normalizeRole(claims.role)
        const claimCollege = claims.collegeId ? String(claims.collegeId) : null
        if (!claimRole) addFinding('MISSING_CLAIMS')
        else if (claimRole !== role || (collegeId && claimCollege !== collegeId)) {
          deferRoleOverwrite = shouldDeferRoleOverwrite({
            existingClaimRole: claimRole,
            documentRole: role,
            scansAllProfileCollections,
            forceClaims: Boolean(input.forceClaims),
          })
          if (deferRoleOverwrite) {
            deferredRoleOverwrites++
            addFinding('DEFERRED_ROLE_OVERWRITE')
          } else {
            addFinding('WRONG_CLAIMS')
          }
        }
        if (linkedUid && authUser.uid !== linkedUid) addFinding('STALE_UID_LINK')
      }

      if (authUser) profileVouchedUids.add(authUser.uid)
      const usersRef = authUser ? db.doc(`users/${authUser.uid}`) : null
      const usersSnap = usersRef ? await usersRef.get() : null
      if (authUser && !usersSnap?.exists) addFinding('MISSING_USERS_DOC')
      const profileLinkField = profileLinkFieldFor(collection)
      if (
        authUser &&
        usersSnap?.exists &&
        profileLinkField &&
        (usersSnap.data() || {})[profileLinkField] !== docSnap.id
      ) {
        addFinding('MISSING_PROFILE_LINK')
      }
      const secretDeletes = secretFieldDeletes(data)
      if (Object.keys(secretDeletes).length) addFinding('PLAINTEXT_SECRET')

      if (!findings.length && !input.forceClaims) return
      // A document that does not own its account's identity is linked and disarmed,
      // never re-claimed. If everything left on it is advice, it is not a repair owed.
      const advisoryOnly = !opts.ownsIdentity && isAdvisoryForDuplicate(findings)
      if (!advisoryOnly) broken++

      const item: RepairItem = {
        collection,
        docId: docSnap.id,
        email,
        name,
        role,
        collegeId,
        uid: authUser?.uid || linkedUid,
        findings,
        actions,
      }

      if (advisoryOnly) {
        actions.push(
          'nothing to apply — another profile for this email owns the account and its role claims, ' +
          'and this document is already linked to it. Merge these documents or delete this one.'
        )
        items.push(item)
        return
      }

      if (refusedMismatch) {
        actions.push(
          `refused: this document says ${email}, but its ${linkField || 'uid'} resolves to ` +
          `${uidUser?.email || 'a different account'} (${decision.kind === 'mismatch' ? decision.uidOfDocument : ''}). ` +
          'No claims, lookup documents or credentials were touched — set this profile\'s uid right, or ' +
          'grant the role from Access Control, then re-run this pass.'
        )
        if (!dryRun && Object.keys(secretDeletes).length) {
          // The one exception: destroying a plaintext secret on THIS document is
          // safe regardless of which account it points at, and leaving it in place
          // because a link looks wrong would be the worse trade.
          await db.collection(collection).doc(docSnap.id).update({
            ...secretDeletes,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            repairedBy: caller.uid,
          })
          secretsStripped += Object.keys(secretDeletes).length
          actions.push('deleted plaintext field(s) on this document only')
          repaired++
        }
        items.push(item)
        return
      }

      if (affectsOperator) {
        actions.push(
          'this is your OWN account — applying revokes its tokens, so you will be ' +
          'signed out on your next request; expect that and sign back in before you ' +
          'judge whether anything broke'
        )
      }
      if (!opts.ownsIdentity) {
        actions.push(
          'duplicate identity record: another profile for this email owns the Auth ' +
          'account and the role claims, so this document is only linked and disarmed. ' +
          'Merge them deliberately afterwards.'
        )
      }

      if (dryRun) {
        // Describe what applying would do, so the operator can approve it.
        if (findings.includes('MISSING_AUTH')) {
          actions.push(
            deliveryMode === 'reset-email'
              ? `create Auth account + return password-reset link for ${email}`
              : `create Auth account with a generated password for ${email}`
          )
        }
        if (findings.includes('STALE_UID_LINK')) actions.push(`re-point ${linkField} to ${email}'s uid`)
        if (findings.includes('ACCOUNT_DISABLED')) actions.push('re-enable the Auth account')
        if (findings.includes('DEFERRED_ROLE_OVERWRITE')) {
          actions.push(
            `role claim left as '${normalizeRole(
              ((authUser?.customClaims || {}) as Record<string, unknown>).role
            )}' — this scope cannot see every profile collection, so it will not overwrite a role from a partial view`
          )
        }
        if (findings.includes('MISSING_CLAIMS') || findings.includes('WRONG_CLAIMS'))
          actions.push(
            `set claims { role: ${role}, collegeId: ${collection === 'superadmins' ? 'null (superadmin is global)' : collegeId || 'null'} } + revoke refresh tokens`
          )
        if (findings.includes('MISSING_USERS_DOC')) actions.push(`create users/{uid} lookup document`)
        if (findings.includes('MISSING_PROFILE_LINK')) {
          actions.push(`write users/{uid}.${profileLinkField} = ${docSnap.id}`)
          if (profileLinkField) linksPlanned++
        }
        if (findings.includes('PLAINTEXT_SECRET')) {
          const names = Object.keys(secretDeletes).join(', ')
          actions.push(
            authUser
              ? `delete plaintext field(s): ${names} — that field was the only copy of this ` +
                `person's credential, so also ${
                  deliveryMode === 'temp-password'
                    ? 'set and return a new password'
                    : 'issue a password-reset link'
                }`
              : `delete plaintext field(s): ${names} (no Auth account exists, so a new credential is returned)`
          )
        }
        items.push(item)
        return
      }

      try {
        // ── 1. Auth account ────────────────────────────────────────────
        const accountPreexisted = !!authUser
        if (!authUser && !opts.ownsIdentity) {
          // A second document for an email that has no account: creating an account
          // here would produce two logins for one person. Disarm the document and
          // leave identity to the primary record, which is reported as such.
          if (Object.keys(secretDeletes).length) {
            await db.collection(collection).doc(docSnap.id).update({
              ...secretDeletes,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              repairedBy: caller.uid,
            })
            secretsStripped += Object.keys(secretDeletes).length
            actions.push('deleted plaintext field(s); Auth left to the primary profile')
            item.actions = actions
            repaired++
          }
          items.push(item)
          return
        }
        if (!authUser) {
          const password = generateRandomPassword()
          authUser = await auth.createUser({
            email,
            password,
            displayName: name || email.split('@')[0],
          })
          actions.push('created Firebase Auth account')
          authCreated++
          item.uid = authUser.uid
          item.created = true
          if (deliveryMode === 'temp-password') {
            item.password = password
            credentials.push({ email, password })
          } else {
            // An unknowable password + a reset link: the student/faculty sets
            // their own credential and nobody in the college has to know it.
            try {
              item.resetLink = await auth.generatePasswordResetLink(
                email,
                input.continueUrl ? { url: input.continueUrl } : undefined
              )
              credentials.push({ email, resetLink: item.resetLink })
              actions.push('generated password-reset link')
            } catch (linkErr: any) {
              errors.push(
                `${collection}/${docSnap.id}: account created but reset link failed — ${linkErr?.message || linkErr}`
              )
            }
          }
        } else if (authUser.disabled) {
          await auth.updateUser(authUser.uid, { disabled: false })
          actions.push('re-enabled the Auth account')
        }

        // ── 2. Claims ──────────────────────────────────────────────────
        const existingClaims = (authUser.customClaims || {}) as Record<string, unknown>
        const claimRole = normalizeRole(existingClaims.role)
        const claimCollege = existingClaims.collegeId ? String(existingClaims.collegeId) : null
        // A superadmin's authority is not scoped to a college, so a stale or deleted
        // `collegeId` sitting on a superadmin document must not be laundered into the
        // claims of the account that governs every college.
        const effectiveCollegeId = collection === 'superadmins' ? null : collegeId || null
        const claimsWrong =
          !claimRole || claimRole !== role || (!!effectiveCollegeId && claimCollege !== effectiveCollegeId)
        if ((claimsWrong || input.forceClaims) && opts.ownsIdentity && !deferRoleOverwrite) {
          // Bound before the closures below: `authUser` is a reassigned `let`, so
          // TypeScript cannot carry the null-check inside a retry callback.
          const targetUid = authUser.uid
          await withAuthQuotaRetry(
            `${collection}/${docSnap.id}: claims`,
            () =>
              auth.setCustomUserClaims(targetUid, {
                ...existingClaims,
                role,
                collegeId: effectiveCollegeId,
              }),
            { note: noteThrottle }
          )
          // Force the next sign-in to mint a token carrying the new claims;
          // an hour-old token would otherwise keep the old (absent) role.
          await withAuthQuotaRetry(`${collection}/${docSnap.id}: token revocation`,
            () => auth.revokeRefreshTokens(targetUid), { note: noteThrottle })
          claimsIssued++
          actions.push(`claims set to { role: ${role}, collegeId: ${effectiveCollegeId || null} }`)
        } else if (claimsWrong || input.forceClaims) {
          actions.push('claims not touched here — the primary profile for this email owns them')
        }

        // ── 3. Firestore documents ─────────────────────────────────────
        const batch = db.batch()
        const now = admin.firestore.FieldValue.serverTimestamp()

        // Re-link the profile to the real uid (both spellings for students,
        // because older code reads `uid` and the portal reads `userId`).
        const profilePatch: Record<string, unknown> = {
          uid: authUser!.uid,
          ...(email ? { email } : {}),
          ...secretDeletes,
          updatedAt: now,
        }
        if (collection === 'students') profilePatch.userId = authUser!.uid
        batch.set(db.collection(collection).doc(docSnap.id), profilePatch, { merge: true })
        if (Object.keys(secretDeletes).length) {
          secretsStripped += Object.keys(secretDeletes).length
          actions.push(`deleted plaintext field(s): ${Object.keys(secretDeletes).join(', ')}`)
        }

        if (!opts.ownsIdentity && profileLinkField) {
          // Only point the lookup document at this profile; writing role, name or
          // collegeId from a duplicate would overwrite what the primary record decided.
          batch.set(
            db.collection('users').doc(authUser.uid),
            {
              [profileLinkField]: docSnap.id,
              // Role and claims belong to the primary profile, but a pointer with no
              // tenant on it is a dead end for any client that reads the college from
              // `users/{uid}`. Fill it only when the document has nothing to say, so
              // this can never contradict what the primary record decided.
              ...(usersSnap?.data()?.collegeId ? {} : { collegeId: collegeId || null }),
              updatedAt: now,
              repairedBy: caller.uid,
            },
            { merge: true }
          )
          actions.push(`users/{uid}.${profileLinkField} pointed here (role left to the primary profile)`)
          usersDocsLinked++
        } else {
        batch.set(
          db.collection('users').doc(authUser.uid),
          {
            uid: authUser.uid,
            id: authUser.uid,
            email,
            name: name || email.split('@')[0],
            role,
            collegeId: collegeId || null,
            status: (data.status as string) || 'active',
            ...(profileLinkField ? { [profileLinkField]: docSnap.id } : {}),
            updatedAt: now,
            repairedBy: caller.uid,
          },
          { merge: true }
        )
          if (!usersSnap?.exists) usersDocsCreated++
          actions.push(
            profileLinkField
              ? `users/{uid}.${profileLinkField} = ${docSnap.id} written`
              : 'users/{uid} lookup document verified'
          )
          if (profileLinkField) usersDocsLinked++
        }

        await batch.commit()
        repaired++
        item.actions = actions
        item.uid = authUser.uid

        // ── 4. Replace the credential we just destroyed ────────────────
        // PLAINTEXT_SECRET means the profile document itself held the password —
        // which is how this college has been reading faculty logins out of the
        // Firestore console. Deleting it is correct and non-negotiable, but if the
        // account already existed then that field was the ONLY copy of the secret
        // anyone could type. Stripping it without handing something back turns a
        // security fix into a lockout, so the same pass that disarms the document
        // also mints a usable credential for it.
        if (Object.keys(secretDeletes).length && accountPreexisted && email && opts.ownsIdentity) {
          const names = Object.keys(secretDeletes).join(', ')
          const reason =
            `their profile carried a plaintext password (${names}); it has been deleted, so ` +
            'this is the only credential they can now use'
          try {
            if (deliveryMode === 'temp-password') {
              const password = generateRandomPassword()
              await auth.updateUser(authUser.uid, { password })
              item.password = password
              credentials.push({ email, password, reason })
              actions.push('set a new generated password (the plaintext one was deleted)')
            } else {
              item.resetLink = await auth.generatePasswordResetLink(
                email,
                input.continueUrl ? { url: input.continueUrl } : undefined
              )
              credentials.push({ email, resetLink: item.resetLink, reason })
              actions.push('issued a password-reset link (the plaintext one was deleted)')
            }
            item.credentialReason = reason
            secretsResetIssued++
          } catch (credErr: any) {
            errors.push(
              `${collection}/${docSnap.id}: plaintext field deleted but no replacement ` +
                `credential could be issued — ${credErr?.message || credErr}. Use "send reset link" ` +
                'from this screen before contacting them.'
            )
          }
        }
      } catch (err: any) {
        item.error = err?.message || String(err)
        errors.push(`${collection}/${docSnap.id}: ${item.error}`)
        logger.error('[identityRepair] row failed', { collection, docId: docSnap.id, err })
      }
      items.push(item)
    }

    // Every uid this pass saw a profile document vouch for — from the document's
    // own `uid`/`userId` field, from the account resolved for it, or from the
    // document id when the collection is keyed by uid. An Auth account outside this
    // set is carrying claims that nothing in the tenant backs.
    const profileVouchedUids = new Set<string>()
    // A scan truncated by `limit` would make real accounts look unbacked, so the
    // reclaim step is disabled for the whole pass as soon as any collection is cut.
    let scanTruncated = false

    const units: Array<{
      collection: string
      defaultRole: string
      doc: admin.firestore.QueryDocumentSnapshot
    }> = []
    for (const collection of collections) {
      let defaultRole: string
      let snapshot: admin.firestore.QuerySnapshot
      try {
        if (collection === 'officeStaff') {
          // The office roster is a SUBCOLLECTION of each college, not a
          // top-level collection, so the generic scan below can never reach
          // it. That is why the accounts and operations teams were invisible
          // to this pass: a college full of office staff scanned as if it had
          // none. Scoped to one college it is a single get; across all
          // colleges it is a collectionGroup, which is why the UI tells you
          // to scope a pass to one college.
          defaultRole = ''
          snapshot = input.collegeId
            ? await db.collection(`colleges/${input.collegeId}/officeStaff`).limit(limit).get()
            : await db.collectionGroup('officeStaff').limit(limit).get()
        } else {
          defaultRole = COLLECTION_ROLE[collection]
          let query: admin.firestore.Query = db.collection(collection).limit(limit)
          if (input.collegeId && collection !== 'superadmins') {
            query = db.collection(collection).where('collegeId', '==', input.collegeId).limit(limit)
          }
          snapshot = await query.get()
        }
      } catch (err: any) {
        errors.push(`${collection}: scan failed — ${err?.message || err}`)
        continue
      }

      if (Date.now() > softDeadline) {
        // Stop at a collection boundary and say so: a truncated-but-reported
        // pass is resumable, a killed one is not.
        partial = true
        stoppedAfter = collection
        break
      }
      if (snapshot.docs.length >= limit) scanTruncated = true
      for (const doc of snapshot.docs) {
        // The roster's own `role` field is the role: the path holds both
        // office roles, so membership cannot say which. It is written only by
        // a superadmin, and the per-unit role is still bounded by
        // PROVISIONABLE_ROLES before any claim is issued.
        const unitRole =
          collection === 'officeStaff'
            ? normalizeRole((doc.data() as Record<string, unknown>).role) || defaultRole
            : defaultRole
        units.push({ collection, defaultRole: unitRole, doc })
      }
    }

    // One Auth account can be described by more than one profile document — this
    // tenant has a person who is both `faculty/FAC001` and
    // `hods/<college>_Multi-Department`. Two lanes writing the same users/{uid}
    // role and the same custom claims race each other, and whoever wins depends on
    // arrival order, which is not a decision anyone would defend in a review. So
    // documents that share an identity are handled by ONE worker, in collection
    // order: the first owns the identity (claims, account creation, credentials)
    // and the rest are linked, disarmed and reported as DUPLICATE_PROFILE to be
    // merged by a human.
    const groups = groupBy(units, (unit) => {
      const emailKey = normalizeEmail((unit.doc.data() as Record<string, unknown>).email)
      return emailKey || `${unit.collection}/${unit.doc.id}`
    })
    await mapWithConcurrency(groups, CONCURRENCY, async (group) => {
      if (group.length > 1) {
        // Several profile documents, one person. Where a collection is keyed by uid
        // (superadmins/{uid}), the document whose ID is the account's uid is the one
        // the app reads directly, so it — not whichever row Firestore happened to
        // return first — must own the identity and the lookup pointer.
        const emailKey = normalizeEmail((group[0].doc.data() as Record<string, unknown>).email)
        if (emailKey) {
          try {
            const account = await auth.getUserByEmail(emailKey)
            group.sort((a, b) => (b.doc.id === account.uid ? 1 : 0) - (a.doc.id === account.uid ? 1 : 0))
          } catch {
            // No account for the email: nothing to prefer, keep collection order.
          }
        }
      }
      for (let index = 0; index < group.length; index++) {
        const unit = group[index]
        await processProfileDocument(unit.collection, unit.defaultRole, unit.doc, {
          ownsIdentity: index === 0,
        })
      }
    })


    // Reverse direction: an account that CAN sign in but has no documents.
    // These are the "orphaned Auth user" rows left by an import whose Firestore
    // write was denied — Authentication has the account, so signIn succeeds, and
    // then the app reports "account not found" because role resolution finds no
    // users/{uid} and no profile document. Report them, and rebuild the lookup
    // document from the claims when applying.
    let authOnlyCount = 0
    let reverseSweepNote: string | null = null
    // Accounts that can sign in but own no profile document. These are the most
    // interesting rows in the whole system — they are what an import looks like
    // when the Auth half succeeded and the Firestore half was denied — so they get
    // their own report field instead of competing for space in `items`, where a
    // large college would push them past the response cap and out of sight.
    const orphans: Array<{
      uid: string
      email: string | null
      name: string | null
      role: string | null
      collegeId: string | null
      action: string
      resolved: boolean
    }> = []
    if (input.collegeId) {
      reverseSweepNote = 'skipped: the Auth directory is not tenant-partitioned, so it is only swept in an all-college pass'
    } else if (partial) {
      // Reading the whole Auth directory after a truncated profile sweep would
      // guarantee a second timeout. Say so instead of silently half-finishing.
      reverseSweepNote = 'skipped: the profile sweep had already used the time budget'
    } else {
      try {
        let pageToken: string | undefined
        let examined = 0
        do {
          const page = await auth.listUsers(500, pageToken)
          examined += page.users.length
          // Two batched reads per page of 500 accounts instead of a thousand
          // sequential ones: this reverse sweep was the second half of the
          // request that used up the function deadline.
          const usersSnaps = page.users.length
            ? await db.getAll(...page.users.map((record) => db.doc(`users/${record.uid}`)))
            : []
          const hasUsersDoc = new Set<string>()
          usersSnaps.forEach((snap) => {
            if (snap.exists) hasUsersDoc.add(snap.ref.id)
          })
          const profileUidsByCollection: Record<string, string[]> = {}
          page.users.forEach((record, index) => {
            if (usersSnaps[index].exists) return
            const claims = (record.customClaims || {}) as Record<string, unknown>
            const role = normalizeRole(claims.role)
            const profileCollection = COLLECTION_ROLE[role] ? role : null
            if (!profileCollection) return
            ;(profileUidsByCollection[profileCollection] ||= []).push(record.uid)
          })
          const hasProfileDoc = new Set<string>()
          for (const [collectionName, uids] of Object.entries(profileUidsByCollection)) {
            const snaps = await db.getAll(...uids.map((uid) => db.doc(`${collectionName}/${uid}`)))
            snaps.forEach((snap) => {
              if (snap.exists) hasProfileDoc.add(snap.ref.id)
            })
          }

          for (const record of page.users) {
            const claimRoleForCheck = normalizeRole(((record.customClaims || {}) as Record<string, unknown>).role)
            const reclaim = shouldReclaimUnsupportedClaims({
              claimRole: claimRoleForCheck,
              roleHasProfileCollection: Boolean(claimRoleForCheck && COLLECTION_ROLE[claimRoleForCheck]),
              referencedByProfile: profileVouchedUids.has(record.uid),
              isCallerAccount: record.uid === caller.uid,
              fullTenantScan:
                !input.collegeId &&
                collections.length === DEFAULT_COLLECTIONS.length &&
                !partial &&
                !scanTruncated,
            })
            if (reclaim) {
              bump('STALE_CLAIMS_NO_PROFILE')
              claimsStripped++
              if (dryRun) {
                const reverseActions = [
                  `would strip role/collegeId claims from ${record.email || record.uid}: ` +
                  `${claimRoleForCheck} claims with no profile document in this tenant behind them`,
                ]
                items.push({
                  collection: '(auth)',
                  docId: record.uid,
                  email: record.email || null,
                  name: record.displayName || null,
                  role: claimRoleForCheck,
                  collegeId: String(((record.customClaims || {}) as Record<string, unknown>).collegeId || '') || null,
                  uid: record.uid,
                  findings: ['STALE_CLAIMS_NO_PROFILE'],
                  actions: reverseActions,
                })
                continue
              }
              try {
                const rest = { ...((record.customClaims || {}) as Record<string, unknown>) }
                delete rest.role
                delete rest.collegeId
                await withAuthQuotaRetry(
                  `claims reclaim ${record.uid}`,
                  async () => {
                    await auth.setCustomUserClaims(record.uid, rest)
                    await auth.revokeRefreshTokens(record.uid)
                  },
                  { note: noteThrottle }
                )
                strippedAccounts.push({
                  uid: record.uid,
                  email: record.email || null,
                  role: claimRoleForCheck,
                })
                logger.info('[identityRepair] revoked unsupported role claims', {
                  uid: record.uid,
                  previousRole: claimRoleForCheck,
                })
              } catch (err: any) {
                errors.push(`${record.uid}: claims not stripped — ${err?.message || err}`)
              }
              continue
            }
            if (hasUsersDoc.has(record.uid) || hasProfileDoc.has(record.uid)) continue
            const claims = (record.customClaims || {}) as Record<string, unknown>
            const claimRole = normalizeRole(claims.role)
            const claimCollege = claims.collegeId ? String(claims.collegeId) : null
            authOnlyCount++
            bump('AUTH_ONLY_NO_PROFILE')
            orphans.push({
              uid: record.uid,
              email: record.email ?? null,
              name: record.displayName ?? null,
              role: claimRole || null,
              collegeId: claimCollege,
              action: claimRole
                ? dryRun
                  ? `a users/{uid} document will be rebuilt from its claims (${claimRole}${claimCollege ? `, college ${claimCollege}` : ''})`
                  : 'rebuilt users/{uid} from the verified custom claims'
                : 'grant it a role from Access Control, then re-run this pass to link it',
              resolved: !dryRun && !!claimRole,
            })
            if (dryRun || !claimRole) continue
            await db
              .collection('users')
              .doc(record.uid)
              .set(
                {
                  uid: record.uid,
                  id: record.uid,
                  email: record.email,
                  name: record.displayName || (record.email || record.uid).split('@')[0],
                  role: claimRole,
                  collegeId: claimCollege,
                  status: 'active',
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                  repairedBy: caller.uid,
                },
                { merge: true }
              )
            usersDocsCreated++
            repaired++
            if (Date.now() > softDeadline) {
              partial = true
              break
            }
          }
          pageToken = page.pageToken
        } while (pageToken && examined < 5000 && !partial && Date.now() < softDeadline)
      } catch (err: any) {
        errors.push(`auth-side sweep skipped: ${err?.message || err}`)
      }
    }

    try {
      await db.collection('logs').add({
        action: 'IDENTITY_REPAIR',
        dryRun,
        collegeId: input.collegeId || null,
        collections,
        scanned,
        broken,
        repaired,
        authCreated,
        claimsIssued,
        usersDocsCreated,
        usersDocsLinked,
        secretsStripped,
        partial,
        stoppedAfter,
        performedBy: caller.uid,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        elapsedMs: Date.now() - startedAt,
      })
    } catch (logError) {
      logger.error('[identityRepair] audit log failed', logError)
    }

    return withApiVersion({
      success: errors.length === 0,
      dryRun,
      scanned,
      broken,
      repaired,
      authCreated,
      claimsIssued,
      usersDocsCreated,
      usersDocsLinked,
      linksPlanned,
      deferredRoleOverwrites,
      secretsStripped,
      secretsResetIssued,
      operatorAffected,
      uidEmailMismatches,
      claimsStripped,
      claimsStrippedOnScanTruncated: scanTruncated,
      strippedAccounts: strippedAccounts.slice(0, 50),
      strippedAccountsTotal: strippedAccounts.length,
      orphanAccounts: orphans.slice(0, 50),
      orphanAccountsTotal: orphans.length,
      authOnlyCount,
      reverseSweepNote,
      partial,
      stoppedAfter,
      elapsedMs: Date.now() - startedAt,
      budgetMs: BUDGET_MS,
      counts,
      errors,
      // Keep the response bounded; large colleges get a summary plus the first
      // `items` rows and are asked to re-run per collection.
      items: items.slice(0, 300),
      itemsTruncated: items.length > 300,
      // Only present when this run actually minted credentials, and only ever
      // visible to the superadmin who pressed the button.
      credentials: deliveryMode === 'temp-password' ? credentials : credentials.map((c) => ({ email: c.email, resetLink: c.resetLink })),
      message: dryRun
        ? `Dry run: ${broken} identity/identities need repair` +
          (uidEmailMismatches
            ? ` — ${uidEmailMismatches} row(s) REFUSED because their profile email and stored uid describe different people`
            : '') +
          (counts.DUPLICATE_PROFILE
            ? ` — including ${counts.DUPLICATE_PROFILE} duplicate profile document(s) sharing an email with another profile`
            : '') +
          (partial
            ? ` — PARTIAL PASS: the ${Math.round(BUDGET_MS / 1000)}s budget ran out${stoppedAfter ? ` after ${stoppedAfter}` : ''}. Re-run scoped to one college, with fewer collections, or with a larger budgetSeconds; already-repaired rows are detected and skipped, so repeating is safe.`
            : `. Re-run with dryRun=false to apply.`)
        : `Repaired ${repaired} of ${broken} affected identities` +
          (uidEmailMismatches
            ? `. ${uidEmailMismatches} row(s) were REFUSED (profile email and stored uid disagree) and need a human`
            : '') +
          (counts.DUPLICATE_PROFILE
            ? `. ${counts.DUPLICATE_PROFILE} profile document(s) share an email with another profile — only the first decided the claims; review those people and merge the documents`
            : '') +
          (secretsResetIssued
            ? `, and issued ${secretsResetIssued} replacement credential(s) for accounts whose plaintext password was deleted — hand those out before the person tries to sign in`
            : '') +
          (partial
            ? ` — the time budget ran out, so re-run until "needs repair" is 0. Rows already fixed are detected and skipped.`
            : `. Affected users must sign out and sign in again to receive their new claims.`),
    })
  }
)
