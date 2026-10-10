#!/usr/bin/env node
/**
 * Restore a superadmin that was accidentally demoted.
 *
 * WHY
 * A superadmin who grants a lesser role to their OWN address (Super Admin →
 * Admins → Create College Admin, with their own email in the form) triggers a
 * silent lockout in grantUserRole:
 *
 *   1. it deletes  superadmins/{uid}
 *   2. it rewrites users/{uid}.role  to the lesser role
 *   3. it revokes refresh tokens
 *
 * callerIsSuperadmin() reads exactly those first two places. So the caller
 * removes the one privilege that authorises grantUserRole itself, and every
 * later call is rejected before it can repair anything. A still-valid
 * superadmin ID token does not help, because the gate reads Firestore, not
 * the token.
 *
 * This script is the way back. It runs with a service-account credential, so
 * it does not depend on the app, on the caller's claims, or on the caller
 * being able to sign in at all.
 *
 * USAGE
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/vriddhi-serviceAccount.json
 *   npm run identity:restore-superadmin -- --email you@example.com
 *   npm run identity:restore-superadmin -- --email you@example.com --apply
 *   npm run identity:restore-superadmin -- --email you@example.com --apply --prune-admin-doc
 *
 * FLAGS
 *   --email <addr>            REQUIRED. The account to restore.
 *   --project <id>            Firebase project id (default: vriddhi-engineering)
 *   --service-account <path>  service-account JSON (else ADC / env var)
 *   --apply                   write the repair (default: read-only dry run)
 *   --prune-admin-doc         also delete admins/{uid}, when that document was
 *                             the accidental artefact of the same mistake.
 *
 * SAFETY
 *   - Read-only unless --apply is passed.
 *   - Only ever ELEVATES to superadmin. It never lowers a role, never deletes
 *     an Auth account, and never touches anyone but the --email given.
 *   - --prune-admin-doc is the only destructive option and is off by default,
 *     so an admins/ document that legitimately predates the mistake survives.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))

function loadAdmin() {
  for (const candidate of [
    'firebase-admin',
    '../functions/node_modules/firebase-admin',
    '../node_modules/firebase-admin',
  ]) {
    try {
      return require(candidate.startsWith('.') ? path.join(here, candidate) : candidate)
    } catch {
      /* try the next location */
    }
  }
  console.error(
    'firebase-admin not found. Install it (npm i --no-save firebase-admin) or run this from the repo root.'
  )
  process.exit(1)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
      continue
    }
    out[key] = next
    i++
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

// A flag with no value parses to boolean true. Passing that into path.resolve
// or fs.readFileSync throws an opaque ERR_INVALID_ARG_TYPE stack trace, which
// is a poor answer to what is really a typo. Validate the value-bearing flags
// up front and say what they need.
function valueFlag(key, example) {
  const raw = args[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string' || !raw.trim()) {
    console.error(`--${key} needs a value.`)
    console.error(`  e.g.  --${key} ${example}`)
    process.exit(1)
  }
  return raw.trim()
}

const SERVICE_ACCOUNT = valueFlag('service-account', '"C:\\path\\to\\vriddhi-serviceAccount.json"')
const PROJECT = valueFlag('project', 'vriddhi-engineering') || process.env.GCLOUD_PROJECT || 'vriddhi-engineering'
const EMAIL = String(args.email || '').trim().toLowerCase()
const APPLY = Boolean(args.apply)
const PRUNE_ADMIN_DOC = Boolean(args['prune-admin-doc'])

if (!EMAIL || !EMAIL.includes('@')) {
  console.error('Usage: npm run identity:restore-superadmin -- --email you@example.com [--apply]')
  process.exit(1)
}

const admin = loadAdmin()
function readServiceAccount(filePath) {
  const resolved = path.resolve(filePath)
  let raw
  try {
    raw = fs.readFileSync(resolved, 'utf8')
  } catch (err) {
    console.error(`Could not read the service-account file: ${resolved}`)
    console.error(`  ${err?.code || err?.message}`)
    console.error(
      '\nDownload one from Firebase Console -> Project settings (gear) -> Service accounts' +
        '\n-> "Generate new private key", then pass its path to --service-account.'
    )
    process.exit(1)
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.error(`That service-account file is not valid JSON: ${resolved}`)
    console.error(`  ${err?.message}`)
    process.exit(1)
  }
}

const credential = SERVICE_ACCOUNT
  ? admin.credential.cert(readServiceAccount(SERVICE_ACCOUNT))
  : admin.credential.applicationDefault()

admin.initializeApp({ credential, projectId: PROJECT })

const db = admin.firestore()
const auth = admin.auth()
db.settings({ ignoreUndefinedProperties: true })

const now = admin.firestore.FieldValue.serverTimestamp()

console.log(`\nRestore superadmin — project ${PROJECT}`)
console.log(`Target: ${EMAIL}`)
console.log(`Mode:   ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`)

// ── 1. resolve the account ─────────────────────────────────────────────
let user
try {
  user = await auth.getUserByEmail(EMAIL)
} catch (err) {
  console.error(`No Firebase Auth account for ${EMAIL} (${err?.code || err?.message}).`)
  console.error('If the account was deleted, this script cannot help — recreate it first.')
  process.exit(1)
}

const uid = user.uid
console.log(`Found Auth account: uid=${uid}`)
console.log(`  current claims: role=${user.customClaims?.role ?? '(none)'} collegeId=${user.customClaims?.collegeId ?? '(none)'}`)

// ── 2. inspect current state ───────────────────────────────────────────
const refs = {
  users: db.doc(`users/${uid}`),
  superadmins: db.doc(`superadmins/${uid}`),
  admins: db.doc(`admins/${uid}`),
}
const snaps = {
  users: await refs.users.get(),
  superadmins: await refs.superadmins.get(),
  admins: await refs.admins.get(),
}

for (const [name, snap] of Object.entries(snaps)) {
  const role = snap.exists ? String(snap.data()?.role ?? '(no role field)') : 'MISSING'
  console.log(`  ${name}/${uid}: ${snap.exists ? 'exists' : 'missing'} — role=${role}`)
}

const alreadySuperadmin =
  snaps.superadmins.exists && String(snaps.users.data()?.role ?? '').toLowerCase() === 'superadmin'

if (alreadySuperadmin && String(user.customClaims?.role ?? '').toLowerCase() === 'superadmin') {
  console.log('\nNothing to do: this account is already a superadmin everywhere.')
  process.exit(0)
}

// ── 3. repair ─────────────────────────────────────────────────────────
console.log('\nPlanned writes:')
console.log('  claims        → role=superadmin, collegeId=null')
console.log('  users/        → role=superadmin, collegeId=null, status=active')
console.log(`  superadmins/  → created${snaps.superadmins.exists ? ' (already exists, merge)' : ''}`)
if (PRUNE_ADMIN_DOC) {
  console.log(`  admins/       → DELETE${snaps.admins.exists ? '' : ' (not present, no-op)'}`)
} else if (snaps.admins.exists) {
  console.log('  admins/       → left alone (pass --prune-admin-doc to delete it)')
}
console.log('  refresh tokens → revoked, so the new claims take effect on next sign-in')

if (!APPLY) {
  console.log('\nDry run complete. Re-run with --apply to write these changes.')
  process.exit(0)
}

// Claims first: this is what gates the callables.
await auth.setCustomUserClaims(uid, {
  ...(user.customClaims || {}),
  role: 'superadmin',
  collegeId: null,
})

const batch = db.batch()

batch.set(
  refs.users,
  {
    uid,
    email: EMAIL,
    role: 'superadmin',
    collegeId: null,
    status: 'active',
    updatedAt: now,
    ...(snaps.users.exists ? {} : { createdAt: now }),
  },
  { merge: true }
)

batch.set(
  refs.superadmins,
  {
    uid,
    email: EMAIL,
    role: 'superadmin',
    status: 'active',
    updatedAt: now,
    ...(snaps.superadmins.exists ? {} : { createdAt: now }),
  },
  { merge: true }
)

if (PRUNE_ADMIN_DOC && snaps.admins.exists) {
  batch.delete(refs.admins)
}

await batch.commit()

// Force the next request to mint a token carrying the restored claims.
await auth.revokeRefreshTokens(uid)

console.log('\nDone.')
console.log(`  ${EMAIL} is a superadmin again.`)
console.log('  IMPORTANT: sign out and sign back in — existing sessions keep the old claims until they refresh.')
if (!PRUNE_ADMIN_DOC && snaps.admins.exists) {
  console.log(`  Note: admins/${uid} still exists and was left in place. Delete it from the console if it was an artefact.`)
}
process.exit(0)
