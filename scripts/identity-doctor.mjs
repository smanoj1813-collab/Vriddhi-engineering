#!/usr/bin/env node
/**
 * Identity doctor — reconcile Firestore profiles with Firebase Authentication.
 *
 * WHY
 * Every "login does not work" investigation in this project has started the
 * same way: open the console, look for the email in Authentication, then in
 * users/{uid}, then in faculty/{uid} or students/{uid}, then wonder whether the
 * role claim is set. That state machine is exactly what this script walks, for
 * every account at once, from the command line — and with --apply it repairs it.
 *
 * It exists so recovery does not depend on the app being usable: if the
 * superadmin's own login is part of the problem, the Access Control screen is
 * unreachable, and this script still works.
 *
 * USAGE (PowerShell — the shell the operators of this project use)
 *   PS note: '<' and '>' are redirection there, so placeholders written as
 *   <collegeId> cannot be pasted verbatim. Replace the placeholder, keep the
 *   quotes, and run everything in ONE window: env vars are per-session here.
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\you\Downloads\vriddhi-serviceAccount.json"
 *   npm run identity:doctor -- --explain aarav.sharma@stan.edu     # one account, read-only
 *   npm run identity:doctor -- --email aarav.sharma@stan.edu       # one account, in a scan
 *   npm run identity:doctor -- --college CEG123                    # whole tenant, read-only
 *   npm run identity:doctor -- --apply --csv "$env:TEMP\issued.csv"          # repair + export
 *   npm run identity:doctor -- --apply --force-credentials --email aarav.sharma@stan.edu
 *   npm run identity:doctor -- --apply --delivery password --password 'Temp!1234567'
 *   node scripts/identity-doctor.mjs --self-test                   # no credentials needed
 *   (bash/zsh equivalent for the first line: export GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/vriddhi-serviceAccount.json)
 *
 * FLAGS
 *   --project <id>            Firebase project id (default: vriddhi-engineering)
 *   --service-account <path>  service-account JSON (else ADC / env var)
 *   --college <id>            restrict to one tenant
 *   --email <addr>            restrict to one person (repeatable)
 *   --collections <list>      students,faculty,admins,hods,mentors,superadmins
 *   --limit <n>               documents per collection (default 2000)
 *   --apply                   write the repairs (default: read-only dry run)
 *   --delivery <mode>         reset-email (default) | password
 *   --password <pw>           fixed temp password (>= 10 chars, --delivery password)
 *   --csv <path>              write issued credentials
 *   --keep-secrets            leave legacy plaintext `password` fields in place
 *                             (they are deleted by default, never printed)
 *   --force-claims            rewrite claims even when a role claim already exists
 *   --explain <email|uid>     one account, read-only: credential timeline plus every
 *                             audit-log entry that touched it (no profile scan)
 *   --reset-window-days <n>   how recent a password replacement has to be to be
 *                             reported as a provisioning takeover (default 7)
 *   --force-credentials       with --apply, send a password-reset link to accounts
 *                             flagged CREDENTIAL_RECENTLY_RESET. Deliberate: the
 *                             doctor never rotates a working person's password.
 *   --self-test               exercise the pure credential classifiers and exit
 *                             (no credentials, no network)
 *
 * WHAT A "HEALTHY" ROW DOES NOT PROVE
 * The profile/claims/tenant checks below all pass for an account whose PASSWORD was
 * replaced by a provisioning call. provisionEmployee (and legacy staff imports)
 * reuse an existing Auth account when they meet a known email, which overwrites the
 * credential and revokes refresh tokens — the person is locked out while every
 * Firestore document still looks perfect. That is why the staff branch also reads
 * the Auth record's password/timestamp metadata and the `logs` trail.
 *
 * SAFETY
 *   - Read-only unless --apply is passed.
 *   - Never deletes an Auth account, never lowers a role, never overwrites an
 *     existing role claim unless --force-claims is given.
 *   - Plaintext passwords found on profile documents are removed, never printed.
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
    'firebase-admin is not installed. Run:  npm --prefix functions install\n' +
      '(the module is resolved from functions/node_modules as well)'
  )
  process.exit(2)
}

// ── args ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { emails: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
      continue
    }
    if (key === 'email') out.emails.push(next.toLowerCase())
    else out[key] = next
    i++
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const PROJECT = args.project || process.env.GCLOUD_PROJECT || 'vriddhi-engineering'
const COLLECT = (args.collections || 'students,faculty,admins,hods,mentors,superadmins')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const LIMIT = Number(args.limit || 2000)
const APPLY = Boolean(args.apply)
const DRY = !APPLY
const DELIVERY = args.delivery === 'password' ? 'password' : 'reset-email'

/**
 * Which build of the doctor this is. Printed on every run because this script's
 * behaviour has diverged between branches: an `--explain`-capable checkout and a
 * pre-`--explain` one accept the same command line and report completely
 * different things, which is how a full profile scan gets read as a verdict.
 * If the banner below is missing from your output, you are running an OLD copy.
 */
const DOCTOR_REVISION = 'credential-forensics-2026.09.15-a'

const KNOWN_FLAGS = [
  'project', 'service-account', 'college', 'collections', 'limit', 'apply', 'delivery',
  'password', 'csv', 'keep-secrets', 'force-claims', 'explain', 'reset-window-days',
  'force-credentials', 'self-test',
]
// A silently ignored flag is worse than a typo: `--expain` used to mean "scan
// every collection in the tenant", and `--email` with a mistyped value means
// "report nothing". Refuse instead.
const unknownFlags = Object.keys(args).filter((k) => k !== 'emails' && !KNOWN_FLAGS.includes(k))
if (unknownFlags.length) {
  console.error(
    `\nUnknown flag(s): ${unknownFlags.map((k) => `--${k}`).join(', ')}\n` +
      `Known flags: ${KNOWN_FLAGS.map((k) => `--${k}`).join(', ')}\n` +
      `Nothing is silently ignored by this script: a mistyped flag stops the run.\n`
  )
  process.exit(2)
}
// PowerShell reserves `<`, so `<email>` in a docstring is unusable verbatim; and
// a valueless --explain used to be read as the literal string "true" and reported
// "no Auth account for true". Fail with the shape of the command instead.
if (args.explain === true) {
  console.error(
    `\n--explain needs an address or uid, e.g.\n` +
      `  npm run identity:doctor -- --explain principal@stan.edu\n` +
      `  npm run identity:doctor -- --explain "UID-from-auth-console"\n` +
      `PowerShell note: do not wrap the value in < > — '<' is redirection there.\n`
  )
  process.exit(2)
}
console.log(`identity-doctor ${DOCTOR_REVISION}`)
const COLLECTION_ROLE = {
  students: 'student',
  faculty: 'faculty',
  admins: 'admin',
  hods: 'hod',
  mentors: 'mentor',
  superadmins: 'superadmin',
  principal: 'principal',
}
const SECRET_FIELDS = ['password', 'passwordHash', 'tempPassword', 'temporaryPassword', 'pwd']

// Only staff rows get the credential-forensics checks below. Bulk student
// imports legitimately hand out temporary passwords every day, so flagging
// `mustChangePassword` there would bury the signal this exists to find.
const STAFF_COLLECTIONS = ['faculty', 'admins', 'hods', 'mentors', 'superadmins']
/** Operations that replace the credential of an ALREADY-EXISTING account. */
const CREDENTIAL_TAKEOVER_ACTIONS = [
  'employee.provision', 'employee.reprovision', 'grantUserRole',
  'RESET_USER_PASSWORD', 'BULK_STAFF_IMPORT', 'IDENTITY_REPAIR', 'employee.status',
]
const RESET_WINDOW_DAYS = Number(args['reset-window-days'] || 7)

// The classifiers below are pure, so they are testable without a service
// account — and this repo's sandbox has no credentials, which is exactly
// when a login-incident tool needs to be verifiable.
if (args['self-test']) process.exit(runSelfTest() ? 0 : 1)


// ── admin init ─────────────────────────────────────────────────────────
const admin = loadAdmin()
// The raw failure is a 12-frame stack trace out of firebase-admin ending in
// ENOENT, which reads like a broken script rather than "you have not told me
// where the key is". Say what to do, and say which path was tried — the usual
// mistakes are leaving the documentation's placeholder in place, or setting the
// variable in a different PowerShell window than the one running the script.
function buildCredential() {
  try {
    return args['service-account']
      ? admin.credential.cert(fs.readFileSync(path.resolve(args['service-account']), 'utf8'))
      : admin.credential.applicationDefault()
  } catch (err) {
    const tried = args['service-account'] || process.env.GOOGLE_APPLICATION_CREDENTIALS || '(nothing set)'
    console.error(
      `\nCould not load service-account credentials. Tried: ${tried}\n` +
        `  • point it at the REAL downloaded file, e.g.\n` +
        `      $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\Users\\you\\Downloads\\vriddhi-engineering-firebase-admin-sdk.json"\n` +
        `    or pass --service-account "C:\\path\\to\\key.json" (that flag wins)\n` +
        `  • PowerShell env vars live per-window: set them in the SAME session that runs the script\n` +
        `  • the key must be a service account with Editor/Cloud Datastore access, downloaded intact\n` +
        `  raw: ${String(err?.message || err).split('\n')[0]}\n`
    )
    process.exit(2)
  }
}
const credential = buildCredential()
admin.initializeApp({ credential, projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` })

const db = admin.firestore()
const auth = admin.auth()
db.settings({ ignoreUndefinedProperties: true })

function randomPassword(length = 14) {
  const { randomInt } = require('node:crypto')
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const nums = '23456789'
  const special = '!@#$%^&*'
  const all = upper + lower + nums + special
  const pick = (set) => set[randomInt(0, set.length)]
  const chars = [pick(upper), pick(lower), pick(nums), pick(special)]
  for (let i = chars.length; i < length; i++) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

const canonicalRole = (raw) => {
  const value = String(raw || '').trim().toLowerCase()
  if (/teach|lecturer|professor|instructor/.test(value)) return 'faculty'
  if (/head of (the )?department|dept ?head/.test(value)) return 'hod'
  if (/vice.?principal/.test(value)) return 'principal'
  if (/administrator|^admin$|college admin/.test(value)) return 'admin'
  if (/super.?admin|owner|superuser/.test(value)) return 'superadmin'
  if (/learner|pupil/.test(value)) return 'student'
  if (/guardian/.test(value)) return 'parent'
  return value
}

// ── credential forensics (pure) ────────────────────────────────────────
/** Firestore Timestamp | Date | ISO string | null → ms, or null when absent. */
function toMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const d = value.toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null
  }
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** Whole-ish days between `value` and `nowMs`; null when the timestamp is absent. */
function daysSince(value, nowMs = Date.now()) {
  const ms = toMillis(value)
  if (ms === null) return null
  return (nowMs - ms) / 86400000
}

/**
 * Is a *known* account's lockout explained by a machine having re-issued its
 * credential rather than by the person? Runs on a plain object so it can be
 * unit-tested with fixtures, and never mutates anything.
 *
 * Why the combination, not either signal alone:
 *  - `passwordUpdatedRecently` on its own is normal — people do change their
 *    password, and the app's forced change-password flow sets it too.
 *  - `mustChangePassword` on its own is the intended state of a fresh account.
 *  - Together with `tokensValidAfterTime` (a refresh-token revocation, which
 *    only server code can do) on an account that has a complete profile and
 *    claims, it is the fingerprint of provisionEmployee/bulkProvisionStaff
 *    reclaiming an existing login. The person then cannot sign in with the
 *    password they know, while every Firestore document still validates.
 */
function inspectCredential({ authUser, windowDays = 7, nowMs = Date.now() }) {
  const problems = []
  const claims = (authUser && authUser.customClaims) || {}
  const mustChange = claims.mustChangePassword === true
  const passwordAge = daysSince(
    (authUser.metadata && (authUser.metadata.lastPasswordUpdate || authUser.metadata.passwordUpdatedAt)) ||
      authUser.passwordUpdatedAt,
    nowMs
  )
  const tokensRevoked = Boolean(authUser.tokensValidAfterTime)
  const recentlyReplaced = passwordAge !== null && passwordAge <= windowDays

  if (recentlyReplaced && tokensRevoked) {
    problems.push(
      `CREDENTIAL_RECENTLY_RESET (password replaced ${passwordAge.toFixed(1)} day(s) ago and refresh ` +
        `tokens revoked — only server code can do that. A provisioning call, not this person: ` +
        `the password they know no longer works)`
    )
  }
  if (mustChange) {
    problems.push(
      'MUST_CHANGE_PASSWORD_STUCK (claims.mustChangePassword=true — if the temporary password was ' +
        'lost, the account cannot reach the change-password step; send a reset link with --force-credentials)'
    )
  }
  return {
    problems,
    mustChange,
    passwordAgeDays: passwordAge,
    tokensRevoked,
    recentlyReplaced,
    // A takeover victim still has a valid email and profile, so the ONLY way
    // back for them is a credential the operator issues deliberately.
    remedy: recentlyReplaced || mustChange ? 'password-reset-link' : null,
  }
}

/** One audit-log row → a stable `date  action  by` line for the timeline. */
function formatAuditEntry(row) {
  const at = toMillis(row.createdAt ?? row.timestamp)
  const when = at === null ? '(no timestamp)' : new Date(at).toISOString().slice(0, 16).replace('T', ' ')
  const actor = row.actorName || row.performedByName || row.actorUid || row.performedBy || 'unknown actor'
  const flagged = CREDENTIAL_TAKEOVER_ACTIONS.includes(String(row.action)) ? '  ⟵ can replace a password' : ''
  return `${when}  ${String(row.action || '(unnamed action)').padEnd(24)} by ${actor}${flagged}`
}

function runSelfTest() {
  const DAY = 86400000
  const now = Date.UTC(2026, 8, 14, 12, 0, 0)
  const iso = (msAgo) => new Date(now - msAgo).toISOString()
  const checks = []
  const expect = (name, got, want) => checks.push([name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`])

  // 1. The takeover signature: recent password + revoked tokens + stuck flag.
  const victim = inspectCredential({
    authUser: {
      customClaims: { role: 'principal', collegeId: 'c1', mustChangePassword: true },
      metadata: { lastPasswordUpdate: iso(2 * DAY) },
      tokensValidAfterTime: iso(2 * DAY),
    },
    windowDays: 7,
    nowMs: now,
  })
  expect('takeover: both signals reported', victim.problems.length, 2)
  expect('takeover: remedy offered', victim.remedy, 'password-reset-link')

  // 2. A healthy long-lived account must NOT be flagged, or the doctor cries
  //    wolf on every college that rotates passwords each term.
  const healthy = inspectCredential({
    authUser: {
      customClaims: { role: 'faculty', collegeId: 'c1' },
      metadata: { lastPasswordUpdate: iso(400 * DAY) },
      tokensValidAfterTime: null,
    },
    windowDays: 7,
    nowMs: now,
  })
  expect('healthy: no problems', healthy.problems, [])
  expect('healthy: no remedy', healthy.remedy, null)

  // 3. Fresh hire with a temp password: one finding, not a takeover claim.
  const fresh = inspectCredential({
    authUser: {
      customClaims: { role: 'faculty', mustChangePassword: true },
      metadata: { lastPasswordUpdate: iso(1 * DAY) },
      tokensValidAfterTime: iso(1 * DAY),
    },
    windowDays: 7,
    nowMs: now,
  })
  expect('fresh hire: still reports both (operator decides)', fresh.problems.length, 2)

  // 4. Missing metadata must degrade to "no finding", never throw.
  const bare = inspectCredential({ authUser: { customClaims: {} }, windowDays: 7, nowMs: now })
  expect('bare record: no problems', bare.problems, [])
  expect('bare record: age unknown', bare.passwordAgeDays, null)

  // 5. Firestore Timestamps (the shape the script actually receives) parse.
  const ts = { toDate: () => new Date(now - 3 * DAY) }
  expect('timestamp age', daysSince(ts, now).toFixed(0), '3')
  expect('timestamp millis', toMillis(ts), now - 3 * DAY)

  // 6. The audit line marks credential actions and survives a missing timestamp.
  const line = formatAuditEntry({ action: 'employee.reprovision', createdAt: ts, actorName: 'Ops' })
  expect('audit line flags credential action', line.includes('can replace a password'), true)
  expect('audit line without timestamp', formatAuditEntry({ action: 'read' }).includes('(no timestamp)'), true)

  let failed = 0
  for (const [name, ok, detail] of checks) {
    if (ok) console.log(`  ✓ ${name}`)
    else {
      failed++
      console.error(`  ✗ ${name} — ${detail}`)
    }
  }
  console.log(`\nidentity-doctor self-test: ${checks.length - failed}/${checks.length} passed`)
  return failed === 0
}

// ── diagnosis ──────────────────────────────────────────────────────────
async function inspectDoc(collectionName, snap) {
  const data = snap.data() || {}
  const email = String(data.email || '').trim().toLowerCase() || null
  const name =
    (typeof data.name === 'string' && data.name.trim()) ||
    [data.firstName, data.lastName].filter(Boolean).join(' ').trim() ||
    (email ? email.split('@')[0] : snap.id)
  const role = canonicalRole(data.role) || COLLECTION_ROLE[collectionName] || null
  const collegeId = data.collegeId || data.collegeID || data.college || null
  const linkedUid = typeof data.uid === 'string' ? data.uid : typeof data.userId === 'string' ? data.userId : null

  const problems = []
  let authUser = null
  let credentialState = null
  if (linkedUid) {
    try {
      authUser = await auth.getUser(linkedUid)
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw err
      problems.push(`STALE_UID_LINK (uid ${linkedUid} does not exist in Auth)`)
    }
  }
  if (!authUser && email) {
    try {
      authUser = await auth.getUserByEmail(email)
      problems.push('PROFILE_NOT_LINKED (Auth account exists but the profile has no uid/userId)')
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw err
      problems.push('MISSING_AUTH_ACCOUNT (this person cannot sign in: no credential exists)')
    }
  }

  let usersDoc = null
  if (authUser) {
    usersDoc = (await db.doc(`users/${authUser.uid}`).get()).data() || null
    if (!usersDoc) problems.push('MISSING_USERS_DOC (role resolution depends on profile fallbacks)')
    const claims = authUser.customClaims || {}
    const claimRole = canonicalRole(claims.role)
    if (!claimRole) problems.push('MISSING_CLAIMS (signs in, then every rule-guarded read is denied)')
    else if (role && claimRole !== role) problems.push(`WRONG_CLAIM (token says "${claimRole}", profile says "${role}")`)
    if (role !== 'superadmin' && collegeId && claims.collegeId && claims.collegeId !== collegeId) {
      problems.push(`WRONG_COLLEGE_CLAIM (token "${claims.collegeId}", profile "${collegeId}")`)
    }
    if (authUser.disabled) problems.push('ACCOUNT_DISABLED')

    // Staff only — see STAFF_COLLECTIONS. A profile that validates perfectly
    // and a person who cannot sign in are not contradictions: this is the
    // check that tells the two cases apart.
    if (STAFF_COLLECTIONS.includes(collectionName)) {
      credentialState = inspectCredential({ authUser, windowDays: RESET_WINDOW_DAYS })
      problems.push(...credentialState.problems)
    }
    if (collectionName === 'students' && usersDoc?.studentDocId !== snap.id) {
      problems.push('MISSING_STUDENT_DOC_LINK (users/{uid}.studentDocId is not set)')
    }
  }

  const secrets = SECRET_FIELDS.filter((field) => field in data)
  if (secrets.length) problems.push(`PLAINTEXT_PASSWORD_ON_PROFILE (${secrets.join(', ')}) — remove it`)

  return { collectionName, id: snap.id, email, name, role, collegeId, linkedUid, authUser, usersDoc, problems, secrets, credentialState }
}

async function main() {
  if (args.explain) return explain(String(args.explain))
  const issued = []
  const rows = []
  const seenEmails = new Set()
  const credentialFlagged = []
  const summary = { scanned: 0, healthy: 0, broken: 0, created: 0, claims: 0, usersDocs: 0, links: 0, stripped: 0, credentials: 0 }
  const byProblem = new Map()

  for (const collection of COLLECT) {
    let query = db.collection(collection).limit(LIMIT)
    if (args.college && collection !== 'superadmins') {
      query = db.collection(collection).where('collegeId', '==', args.college).limit(LIMIT)
    }
    let snapshot
    try {
      snapshot = await query.get()
    } catch (err) {
      console.error(`\n! ${collection}: scan failed — ${err.message}`)
      console.error('  Does the collection have the collegeId composite index? (firebase deploy --only firestore:indexes)')
      continue
    }
    console.log(`\n── ${collection}: ${snapshot.size} profile document(s)`)

    for (const snap of snapshot.docs) {
      const info = await inspectDoc(collection, snap)
      if (args.emails.length && (!info.email || !args.emails.includes(info.email))) continue
      if (info.email) seenEmails.add(info.email)
      summary.scanned++
      if (info.problems.some((p) => p.startsWith('CREDENTIAL_RECENTLY_RESET'))) credentialFlagged.push(info)
      if (!info.problems.length) {
        summary.healthy++
        continue
      }
      summary.broken++
      info.problems.forEach((p) => byProblem.set(p.split(' ')[0], (byProblem.get(p.split(' ')[0]) || 0) + 1))
      rows.push(info)
      console.log(
        `  ✗ ${snap.id}  ${info.email || '(no email)'}  ${info.role || '?'}` +
          `\n      ${info.problems.join('\n      ')}`
      )
      if (!DRY) await repair(info, summary, issued)
    }
  }

  // An email passed with --email that matches NO profile document used to fall
  // out of this script silently: the scan walks profiles, so a person whose
  // profile row is missing or was written to the wrong collection produced
  // empty output — which reads as "nothing wrong with this account" to an
  // operator mid-incident. Resolve those directly against Auth instead.
  for (const email of args.emails) {
    if (seenEmails.has(email)) continue
    let record = null
    try {
      record = await auth.getUserByEmail(email)
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw err
    }
    if (!record) {
      console.log(`\n── ${email}: no profile document AND no Auth account — this person cannot sign in at all`)
      continue
    }
    const state = inspectCredential({ authUser: record, windowDays: RESET_WINDOW_DAYS })
    const usersDoc = (await db.doc(`users/${record.uid}`).get()).data() || null
    console.log(`\n── ${email}: no profile document in ${COLLECT.join(',')}, but an Auth account exists (uid ${record.uid})`)
    console.log(`      users/{uid}: ${usersDoc ? `present, role=${canonicalRole(usersDoc.role) || '?'}, collegeId=${usersDoc.collegeId || '(none)'}` : 'MISSING'}`)
    console.log(`      claims: ${JSON.stringify(record.customClaims || {})}`)
    if (record.disabled) console.log('      ✗ ACCOUNT_DISABLED')
    state.problems.forEach((p) => console.log(`      ✗ ${p}`))
    console.log('      → the login flow resolves a role from claims + users/{uid}; with no profile in a')
    console.log('        scanned collection the role may still resolve, so re-run with --collections to')
    console.log('        include the collection this person was actually written to.')
    rows.push({ collectionName: '(auth)', id: record.uid, email, name: record.displayName || null, role: null, credentialState: state, problems: state.problems })
    // Only count it as a takeover when the credential itself is the finding —
    // an unbacked account with a stable password is a different problem
    // (missing profile), and listing it here would point the operator at the
    // wrong remedy.
    if (state.recentlyReplaced || state.mustChange) {
      credentialFlagged.push({ collectionName: '(auth)', id: record.uid, email, name: record.displayName || null, role: null, collegeId: usersDoc?.collegeId || null, authUser: record, credentialState: state })
    }
  }

  console.log('\n════════ Summary ════════')
  console.log(`project        ${PROJECT}`)
  console.log(`college        ${args.college || '(all)'}`)
  console.log(`mode           ${DRY ? 'DRY RUN (nothing written) — pass --apply to repair' : 'APPLY'}`)
  console.log(`scanned        ${summary.scanned}   healthy ${summary.healthy}   needing repair ${summary.broken}`)
  for (const [problem, count] of [...byProblem.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${problem}`)
  }
  // Called out separately because the remedy is the *opposite* of the default
  // repair: claims and profiles are already correct here, so rewriting them is
  // how an operator turns a password problem into a permissions problem.
  if (credentialFlagged.length) {
    console.log(`\n${credentialFlagged.length} staff account(s) look credential-taken-over rather than misconfigured:`)
    for (const info of credentialFlagged) console.log(`  • ${info.email || info.id}`)
    console.log('  Their profiles and claims validate — do not force-rewrite them. Issue a credential:')
    console.log('    npm run identity:doctor -- --apply --force-credentials --email <email>')
  }
  if (!DRY) {
    console.log(`\nrepaired: auth accounts created ${summary.created}, claims issued ${summary.claims}, ` +
      `users docs ${summary.usersDocs}, profile links ${summary.links}, password fields stripped ${summary.stripped}`)
  }
  if (rows.length && DRY) {
    console.log('\nNext step: re-run with --apply. Accounts that had no credential get a password-reset link,')
    console.log('so no shared secret has to be stored or forwarded. Users must sign out and back in for claims.')
  }
  // Deliberate, and only ever in the direction of *giving access back*: this
  // path never sets a password the operator then has to forward, it sends a
  // reset link, and it requires --apply as well as the flag.
  if (APPLY && args['force-credentials'] && credentialFlagged.length) {
    console.log(`\nIssuing password-reset links for ${credentialFlagged.length} credential-taken-over account(s):`)
    for (const info of credentialFlagged) {
      if (!info.email) {
        console.log(`  – ${info.id}: no email on file — a link cannot be sent`)
        continue
      }
      try {
        const resetLink = await auth.generatePasswordResetLink(info.email)
        summary.credentials++
        issued.push({ name: info.name, email: info.email, role: info.role, collegeId: info.collegeId, action: 'credential-reset-link', resetLink })
        console.log(`  ✓ ${info.email}\n      ${resetLink}`)
      } catch (err) {
        console.log(`  ✗ ${info.email}: ${err?.message || err}`)
      }
    }
  }
  if (issued.length) {
    console.log(`\nIssued credentials (${issued.length}):`)
    issued.forEach((row) => console.log(`  ${row.email}  ${row.password || row.resetLink}`))
  }
  if (args.csv) {
    const header = 'name,email,role,collegeId,action,password,resetLink'
    const lines = issued.map((row) =>
      [row.name, row.email, row.role, row.collegeId, row.action, row.password || '', row.resetLink || '']
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    )
    fs.writeFileSync(path.resolve(args.csv), [header, ...lines].join('\n'))
    console.log(`\nWrote ${lines.length} row(s) to ${args.csv} — delete this file once it has been handed over.`)
  }
}

/**
 * One-account forensic timeline, read-only.
 *
 * The scan mode answers "which rows are inconsistent". An incident like
 * "principal and faculty stopped signing in" needs the other question: *what
 * happened to this account, and when* — because the two competing hypotheses
 * (claims stripped vs. password replaced) look identical in Firestore and
 * differ completely in remedy. This walks Auth metadata, every profile
 * collection, the employee directory and the audit trail for one person, and
 * says which failure mode the evidence supports.
 */
async function explain(target) {
  const isEmail = target.includes('@')
  const email = isEmail ? target.toLowerCase() : null
  console.log(`\n════════ identity-doctor explain: ${target} ════════`)
  console.log(`project ${PROJECT} — read-only (explain never writes)\n`)

  let record = null
  try {
    record = isEmail ? await auth.getUserByEmail(email) : await auth.getUser(target)
  } catch (err) {
    if (err?.code !== 'auth/user-not-found' && err?.code !== 'auth/invalid-uid') {
      console.log(`  ! Auth lookup failed: ${err?.message || err}`)
    }
  }
  if (!record) {
    console.log(`  ✗ No Firebase Auth account for ${target}.`)
    console.log('    Sign-in cannot succeed regardless of Firestore state — provision them')
    console.log('    (Access Control → grant/create, or identity:doctor --email … --apply).')
    return
  }

  const claims = record.customClaims || {}
  const uid = record.uid
  const state = inspectCredential({ authUser: record, windowDays: RESET_WINDOW_DAYS })
  const passwordSetAt = toMillis(record.metadata?.lastPasswordUpdate || record.metadata?.passwordUpdatedAt || record.passwordUpdatedAt)
  const tokensAfter = toMillis(record.tokensValidAfterTime)
  console.log(`  uid           ${uid}`)
  console.log(`  email         ${record.email}${record.emailVerified ? '' : '  (unverified)'}`)
  console.log(`  displayName   ${record.displayName || '(none)'}`)
  console.log(`  disabled      ${record.disabled ? 'TRUE — sign-in is refused outright' : 'no'}`)
  console.log(`  claims        ${JSON.stringify(claims)}`)
  console.log(`  password set  ${passwordSetAt === null ? '(unknown)' : new Date(passwordSetAt).toISOString()}`)
  console.log(`  tokens after  ${tokensAfter === null ? '(never revoked)' : new Date(tokensAfter).toISOString()}` +
    `  ← a revocation forces every live session to re-mint its ID token`)
  state.problems.forEach((p) => console.log(`  ✗ ${p}`))

  const usersSnap = await db.doc(`users/${uid}`).get()
  const users = usersSnap.data() || null
  console.log(`\n  users/{uid}: ${users
    ? `role=${canonicalRole(users.role) || '(none)'}, collegeId=${users.collegeId || '(none)'}, status=${users.status || '(none)'}`
    : 'MISSING — identity resolution falls back to profile lookups'}`)

  console.log('\n  profile documents:')
  const profileHits = []
  for (const collection of [...STAFF_COLLECTIONS, 'students']) {
    try {
      const snap = await db.collection(collection).where('email', '==', record.email).limit(5).get()
      for (const doc of snap.docs) {
        const d = doc.data() || {}
        profileHits.push({
          collection, id: doc.id, role: canonicalRole(d.role), collegeId: d.collegeId || null,
          status: d.status || null, uid: d.uid || d.userId || null, createdAt: toMillis(d.createdAt),
        })
      }
    } catch (err) {
      console.log(`    ! ${collection}: ${err.message}`)
    }
  }
  if (!profileHits.length) console.log('    (none in faculty/admins/hods/mentors/superadmins/students)')
  for (const p of profileHits) {
    const uidLabel = p.uid === uid ? 'this account' : `${p.uid || '(missing)'}${p.uid ? ' ≠ this account' : ''}`
    const createdLabel = p.createdAt ? '' : '  ⚠ no createdAt → invisible to orderBy("createdAt") list queries'
    console.log(`    ${p.collection}/${p.id}  role=${p.role || '?'}  collegeId=${p.collegeId || '(none)'}` +
      `  status=${p.status || '(none)'}  uid=${uidLabel}${createdLabel}`)
  }

  // The employee directory exists only once the portal is deployed, so a
  // missing collection must never be reported as a fault.
  try {
    const empSnap = await db.collection('employees').where('email', '==', record.email).limit(5).get()
    if (!empSnap.empty) {
      console.log('\n  employee directory rows:')
      for (const doc of empSnap.docs) {
        const d = doc.data() || {}
        const sameUid = String(d.uid || '') === uid
        console.log(`    employees/${doc.id}  role=${canonicalRole(d.role) || '?'}  collegeId=${d.collegeId || '(none)'}` +
          `  status=${d.status || '(none)'}  uid=${sameUid ? 'this account' : `${d.uid || '(missing)'} ≠ this account ⚠`}` +
          `${d.mustChangePassword ? '  (temp password outstanding)' : ''}`)
      }
    }
  } catch {
    /* employees collection not in use on this project yet */
  }

  console.log('\n  audit trail (most recent first):')
  const seen = new Set()
  const entries = []
  for (const field of ['targetEmail', 'targetUid']) {
    const value = field === 'targetEmail' ? record.email : uid
    if (!value) continue
    try {
      const snap = await db.collection('logs').where(field, '==', value).limit(60).get()
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue
        seen.add(doc.id)
        entries.push({ id: doc.id, ...doc.data() })
      }
    } catch {
      /* no index for this shape; the other field may still cover it */
    }
  }
  entries.sort((a, b) => (toMillis(b.createdAt ?? b.timestamp) ?? 0) - (toMillis(a.createdAt ?? a.timestamp) ?? 0))
  if (!entries.length) {
    console.log('    (no per-account audit entries — bulk imports write one aggregate row per college,')
    console.log('     so a BULK_STAFF_IMPORT takeover will not name the person here)')
  }
  for (const row of entries.slice(0, 12)) console.log(`    ${formatAuditEntry(row)}`)

  const collegeId = users?.collegeId || claims.collegeId || profileHits[0]?.collegeId || null
  if (collegeId) {
    try {
      const snap = await db.collection('logs').where('collegeId', '==', collegeId).limit(120).get()
      const aggregate = snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((row) => !row.targetEmail && !row.targetUid && CREDENTIAL_TAKEOVER_ACTIONS.includes(String(row.action)))
        .sort((a, b) => (toMillis(b.createdAt ?? b.timestamp) ?? 0) - (toMillis(a.createdAt ?? a.timestamp) ?? 0))
        .slice(0, 6)
      if (aggregate.length) {
        console.log(`\n  college-wide operations that can replace a credential (${collegeId}):`)
        for (const row of aggregate) console.log(`    ${formatAuditEntry(row)}`)
      }
    } catch {
      /* aggregate sweep is best-effort context, never a verdict */
    }
  }

  console.log('\n  verdict:')
  if (record.disabled) {
    console.log('    • Account disabled → sign-in is refused outright. Re-enable via identity:doctor --apply')
    console.log('      (or set the directory status back to active).')
  } else if (state.recentlyReplaced) {
    console.log('    • Credential replaced recently: claims and profile are NOT the problem here. Forcing a')
    console.log('      claim rewrite would turn a password problem into a permissions problem.')
    console.log(`    • Remedy: npm run identity:doctor -- --apply --force-credentials --email ${record.email}`)
  } else if (!canonicalRole(claims.role)) {
    console.log('    • No role claim → signs in, then every rule-guarded read is denied ("login did nothing").')
    console.log('      Remedy: identity:doctor --apply issues claims; the person must sign out and back in.')
  } else if (!profileHits.length) {
    console.log('    • Claims but no profile document → role resolves from users/{uid} only; list pages stay empty.')
  } else if (profileHits.some((p) => p.collegeId && p.collegeId !== claims.collegeId)) {
    console.log('    • Profile collegeId disagrees with the claim → reads work, every write is denied.')
  } else {
    console.log('    • No inconsistency found for this account. If sign-in still fails, the credential or the')
    console.log('      deployed client is at fault — check IDENTITY_API_VERSION parity between hosting and functions.')
  }
}

async function repair(info, summary, issued) {
  const now = admin.firestore.FieldValue.serverTimestamp()
  let uid = info.authUser?.uid || null
  const profileRef = db.collection(info.collectionName).doc(info.id)

  // 1. the credential
  if (!info.authUser && info.email) {
    const password = DELIVERY === 'password' ? String(args.password || randomPassword()) : randomPassword()
    try {
      const created = await auth.createUser({ email: info.email, password, displayName: info.name })
      uid = created.uid
      summary.created++
      let resetLink = null
      if (DELIVERY !== 'password') {
        resetLink = await auth.generatePasswordResetLink(info.email).catch(() => null)
      }
      issued.push({
        name: info.name,
        email: info.email,
        role: info.role,
        collegeId: info.collegeId,
        action: 'created-auth-account',
        password: DELIVERY === 'password' ? password : undefined,
        resetLink,
      })
      info.problems = info.problems.filter((p) => !p.startsWith('MISSING_AUTH_ACCOUNT'))
    } catch (err) {
      console.error(`      ! could not create Auth account for ${info.email}: ${err.message}`)
      return
    }
  } else if (info.authUser?.disabled) {
    await auth.updateUser(info.authUser.uid, { disabled: false })
    console.log(`      → re-enabled the disabled Auth account`)
  }

  if (!uid) {
    console.log('      ! no email/uid to act on — fix the document by hand')
    return
  }

  // 2. claims
  const record = await auth.getUser(uid)
  const claims = record.customClaims || {}
  const claimRole = canonicalRole(claims.role)
  if (!claimRole || args['force-claims']) {
    await auth.setCustomUserClaims(uid, { ...claims, role: info.role, collegeId: info.collegeId || null })
    await auth.revokeRefreshTokens(uid)
    summary.claims++
    console.log(`      → claims { role: ${info.role}, collegeId: ${info.collegeId || null} }`)
  }

  // 3. users/{uid} lookup document
  const usersRef = db.collection('users').doc(uid)
  const usersSnap = await usersRef.get()
  if (!usersSnap.exists) {
    await usersRef.set(
      {
        uid,
        id: uid,
        email: info.email,
        name: info.name,
        role: info.role,
        collegeId: info.collegeId || null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        repairedBy: 'identity-doctor',
      },
      { merge: true }
    )
    summary.usersDocs++
  }

  // 4. profile ↔ auth links (and the studentDocId the portal needs)
  const patch = { updatedAt: now }
  if (info.linkedUid !== uid) {
    patch.uid = uid
    if (info.collectionName === 'students') patch.userId = uid
    summary.links++
  }
  if (info.collectionName === 'students' && usersSnap.data()?.studentDocId !== info.id) {
    await usersRef.set({ studentDocId: info.id }, { merge: true })
  }
  if (info.collectionName === 'faculty' && usersSnap.data()?.facultyDocId !== info.id) {
    await usersRef.set({ facultyDocId: info.id }, { merge: true })
  }
  await profileRef.set(patch, { merge: true })

  // 5. plaintext credentials must not live on a readable profile. Stripping is
  //    the default because those fields are the reason the "read the password in
  //    Firestore" workflow exists; pass --keep-secrets only to inspect them.
  if (info.secrets.length && !args['keep-secrets']) {
    const deletes = {}
    for (const field of info.secrets) deletes[field] = admin.firestore.FieldValue.delete()
    await profileRef.set(deletes, { merge: true })
    summary.stripped += info.secrets.length
    console.log(`      → deleted ${info.secrets.join(', ')} from the profile document`)
  }
}

main().catch((err) => {
  console.error('\nidentity-doctor failed:', err?.message || err)
  process.exit(1)
})
