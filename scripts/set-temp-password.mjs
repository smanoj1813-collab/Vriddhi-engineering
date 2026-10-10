#!/usr/bin/env node
/**
 * Issue a temporary password for one existing account (ops recovery tool).
 *
 * WHY
 * Staff accounts (including the accounts / operations office roles) are
 * created with a generated one-time password that is shown exactly once and
 * never stored anywhere — by design, it cannot be recovered afterwards. If
 * that password is lost, the only symptom is `auth/invalid-credential` at the
 * login page while `diagnoseIdentity` reports a perfectly healthy identity
 * (claims, profile document, roster all correct). This script is the fast
 * path back in: it runs with a service-account credential, so it does not
 * depend on the app, on any UI, or on a deployment.
 *
 * USAGE
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/vriddhi-serviceAccount.json
 *   npm run identity:set-temp-password -- --email person@college.edu
 *   npm run identity:set-temp-password -- --email person@college.edu --apply
 *   npm run identity:set-temp-password -- --uid MBwbZ... --apply --password 'Correct-Horse-9!'
 *
 * FLAGS
 *   --email <addr>            The account to unlock (lowercased, trimmed).
 *   --uid <uid>               Alternative to --email when the uid is known.
 *   --password <pw>           Optional explicit password (min 10 chars).
 *                             Omit to generate a 14-char one-time password
 *                             from the same alphabet the app uses.
 *   --project <id>            Firebase project id (default: vriddhi-engineering)
 *   --service-account <path>  service-account JSON (else ADC / env var)
 *   --apply                   write the change (default: read-only dry run)
 *
 * SAFETY
 *   - Read-only unless --apply is passed.
 *   - Only ever UPDATES an existing Auth account: it never creates users,
 *     never deletes anything, never changes roles, and touches no claim
 *     except adding mustChangePassword: true.
 *   - Exactly one account is affected (the --email / --uid given).
 *   - The generated password is printed once, to stdout only. It is not
 *     written to Firestore, to a file, or to any log.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
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
    'firebase-admin not found. Run this from the repo root after `npm --prefix functions install`.'
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

// Same alphabet as functions/src/identityShared.ts generateRandomPassword():
// ambiguous glyphs (I, l, O, 0, 1) are excluded because these passwords are
// read aloud, retyped on phones, and pasted into chat apps.
function generateRandomPassword(length = 14) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const nums = '23456789'
  const special = '!@#$%^&*'
  const all = upper + lower + nums + special
  const pick = (set) => set[crypto.randomInt(0, set.length)]
  const chars = [pick(upper), pick(lower), pick(nums), pick(special)]
  for (let i = chars.length; i < length; i++) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

const SERVICE_ACCOUNT = valueFlag('service-account', '"~/Downloads/vriddhi-serviceAccount.json"')
const PROJECT = valueFlag('project', 'vriddhi-engineering') || process.env.GCLOUD_PROJECT || 'vriddhi-engineering'
const EMAIL = String(args.email || '').trim().toLowerCase()
const UID = String(args.uid || '').trim()
const APPLY = Boolean(args.apply)
const EXPLICIT_PASSWORD = typeof args.password === 'string' ? args.password : undefined

if (!EMAIL && !UID) {
  console.error('Provide the account to unlock: --email person@college.edu  (or --uid <uid>)')
  process.exit(1)
}
if (EMAIL && UID) {
  console.error('Provide either --email or --uid, not both (ambiguous target).')
  process.exit(1)
}
if (EXPLICIT_PASSWORD !== undefined && EXPLICIT_PASSWORD.length < 10) {
  console.error('--password must be at least 10 characters (Firebase Auth minimum is 6; the app enforces 10).')
  process.exit(1)
}

const admin = loadAdmin()

function initApp() {
  if (SERVICE_ACCOUNT) {
    const raw = fs.readFileSync(path.resolve(SERVICE_ACCOUNT.replace(/^~(?=$|\/)/, process.env.HOME || '~')), 'utf8')
    const cred = JSON.parse(raw)
    return admin.initializeApp({ credential: admin.credential.cert(cred), projectId: cred.project_id || PROJECT })
  }
  // ADC: GOOGLE_APPLICATION_CREDENTIALS or gcloud default credentials.
  return admin.initializeApp({ projectId: PROJECT })
}

const app = initApp()
const auth = admin.auth(app)

function describeUser(u) {
  const claims = u.customClaims || {}
  console.log('')
  console.log('  Target account')
  console.log('  ─────────────────────────────────────────────')
  console.log(`  uid        : ${u.uid}`)
  console.log(`  email      : ${u.email}${u.emailVerified ? ' (verified)' : ' (NOT verified)'}`)
  console.log(`  disabled   : ${u.disabled ? 'YES — sign-in is blocked; reactivate first' : 'no'}`)
  console.log(`  role claim : ${claims.role || '(none)'}`)
  console.log(`  collegeId  : ${claims.collegeId || '(none)'}`)
  console.log(`  mustChange : ${claims.mustChangePassword === true ? 'yes' : 'no'}`)
  console.log(`  last sign-in: ${u.metadata?.lastSignInTime || 'never'}`)
  console.log('')
}

async function main() {
  const user = UID ? await auth.getUser(UID) : await auth.getUserByEmail(EMAIL)
  describeUser(user)

  if (user.disabled) {
    console.error(
      'This account is DISABLED in Firebase Auth — a new password will not help.\n' +
        'Reactivate it first (Superadmin → Admins → activate, or manageOfficeStaff reactivate).'
    )
    process.exit(1)
  }

  if (!APPLY) {
    console.log('Dry run — nothing was changed. Re-run with --apply to set the password.')
    console.log(`  would set : a ${EXPLICIT_PASSWORD ? 'supplied' : 'generated 14-char'} password`)
    console.log('  would do  : revoke all sessions, add mustChangePassword: true claim')
    return
  }

  const password = EXPLICIT_PASSWORD ?? generateRandomPassword()
  await auth.updateUser(user.uid, { password })
  // Same contract as resetUserPassword / manageOfficeStaff(resetPassword):
  // every existing session must re-authenticate with the new credential.
  await auth.revokeRefreshTokens(user.uid)
  const claims = { ...(user.customClaims || {}), mustChangePassword: true }
  await auth.setCustomUserClaims(user.uid, claims)

  console.log('✅ Password updated. All previous sessions were signed out.')
  console.log('')
  console.log('  ONE-TIME PASSWORD (shown once — copy it now):')
  console.log(`  ┌${'─'.repeat(Math.max(password.length + 4, 20))}┐`)
  console.log(`  │  ${password}  │`)
  console.log(`  └${'─'.repeat(Math.max(password.length + 4, 20))}┘`)
  console.log('')
  console.log(`  ${user.email} can now sign in at the app login page with this password.`)
  console.log('  It is not stored anywhere — if it is lost again, re-run this script.')
}

main()
  .catch((err) => {
    const code = err?.errorInfo?.code || err?.code || ''
    if (code === 'auth/user-not-found') {
      console.error(`\nNo Firebase Auth account exists for ${EMAIL || UID}.`)
      console.error('Check the spelling — or grant the role again from Superadmin → Create Admin,')
      console.error('which creates the Auth account when the email is new.')
    } else {
      console.error('\nFailed:', err?.message || err)
    }
    process.exit(1)
  })
  .finally(async () => {
    try { await app.delete() } catch { /* best effort */ }
  })
