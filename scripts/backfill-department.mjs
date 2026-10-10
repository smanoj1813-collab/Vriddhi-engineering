#!/usr/bin/env node
/**
 * Backfill the `department` tag on existing documents so department-scoped
 * reads (Firestore rules `deptScoped`, client filter `departmentScope.ts`)
 * can narrow admin/HOD (department-head) accounts.
 *
 * WHY
 * New writes stamp `department` where the app already knows it (question
 * reviews, future paper/question writes), but historical rows have no tag.
 * The scoping helpers are deliberately TOLERANT — an untagged document stays
 * visible to everyone — so this script is what turns enforcement on for
 * existing data: it resolves each row's department from the owning faculty
 * member (or the attendance session) and stamps it.
 *
 * RESOLUTION
 *   classSessions, weeklySchedules  facultyId → faculty/users/admins doc
 *   papers, questions               createdBy → users/faculty/admins doc
 *   attendanceRecords               sessionId  → classSessions/{id}.department
 *                                   (falls back to that session's facultyId)
 *
 * A document is only tagged when its `department` is currently missing or
 * empty AND a non-empty department resolves. Existing tags are never
 * overwritten. Unresolvable rows are left untagged (= visible college-wide,
 * the tolerant default) and reported so they can be fixed by hand.
 *
 * USAGE
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/vriddhi-serviceAccount.json
 *   node scripts/backfill-department.mjs                 # dry run
 *   node scripts/backfill-department.mjs --apply         # write
 *   node scripts/backfill-department.mjs --collection classSessions --apply
 *
 * FLAGS
 *   --project <id>            Firebase project id (default: vriddhi-engineering)
 *   --service-account <path>  service-account JSON (else ADC / env var)
 *   --collection <name>       limit to one collection (repeatable)
 *   --apply                   write the tags (default: read-only dry run)
 *
 * SAFETY
 *   - Read-only unless --apply is passed.
 *   - Only ever ADDS a missing `department` string; never deletes or edits
 *     any other field, never touches Auth, never overwrites existing tags.
 *   - Writes are batched (≤400 per batch, Firestore's limit is 500).
 */

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
  const out = { collection: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      if (key === 'collection') {
        console.error('--collection needs a value (e.g. --collection classSessions).')
        process.exit(1)
      }
      out[key] = true
      continue
    }
    if (key === 'collection') out.collection.push(next)
    else out[key] = next
    i++
  }
  return out
}

function valueFlag(args, key, example) {
  const raw = args[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string' || !raw.trim()) {
    console.error(`--${key} needs a value.`)
    console.error(`  e.g.  --${key} ${example}`)
    process.exit(1)
  }
  return raw.trim()
}

const args = parseArgs(process.argv.slice(2))
const SERVICE_ACCOUNT = valueFlag(args, 'service-account', '"C:\\path\\to\\vriddhi-serviceAccount.json"')
const PROJECT = valueFlag(args, 'project', 'vriddhi-engineering') || process.env.GCLOUD_PROJECT || 'vriddhi-engineering'
const APPLY = Boolean(args.apply)

const ALL_COLLECTIONS = ['classSessions', 'weeklySchedules', 'papers', 'questions', 'attendanceRecords']
const requested = args.collection.length
  ? args.collection.filter((c) => ALL_COLLECTIONS.includes(c))
  : ALL_COLLECTIONS
if (args.collection.length && requested.length === 0) {
  console.error(`--collection must be one of: ${ALL_COLLECTIONS.join(', ')}`)
  process.exit(1)
}
// Sessions must be tagged before attendanceRecords (attendance resolves via
// its session), so always process in dependency order.
const COLLECTIONS = ALL_COLLECTIONS.filter((c) => requested.includes(c))

const admin = loadAdmin()
function readServiceAccount(filePath) {
  const resolved = path.resolve(filePath)
  try {
    return JSON.parse(require('node:fs').readFileSync(resolved, 'utf8'))
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.SyntaxError) {
      console.error(`Could not read a valid service-account JSON at: ${resolved}`)
      console.error(
        '\nDownload one from Firebase Console -> Project settings -> Service accounts\n' +
          '-> "Generate new private key", then pass its path to --service-account.'
      )
      process.exit(1)
    }
    throw err
  }
}

const credential = SERVICE_ACCOUNT
  ? admin.credential.cert(readServiceAccount(SERVICE_ACCOUNT))
  : admin.credential.applicationDefault()

admin.initializeApp({ credential, projectId: PROJECT })
const db = admin.firestore()
db.settings({ ignoreUndefinedProperties: true })

const now = admin.firestore.FieldValue.serverTimestamp()

console.log(`\nDepartment backfill — project ${PROJECT}`)
console.log(`Collections: ${COLLECTIONS.join(', ')}`)
console.log(`Mode:        ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`)

// ── resolution caches ─────────────────────────────────────────────────────
/** uid/facultyId/docId → department ('' = known untagged, null = unresolved) */
const resolveCache = new Map()

function pickDept(data, collegeId) {
  const raw = data?.department
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  // Prefer a row from the same college when several candidates match.
  if (collegeId && typeof data?.collegeId === 'string' && data.collegeId !== collegeId) return null
  return null
}

async function fromDoc(ref, collegeId) {
  let snap
  try {
    snap = await ref.get()
  } catch {
    return null
  }
  if (!snap.exists) return null
  return pickDept(snap.data(), collegeId)
}

async function fromQuery(q, collegeId) {
  let snap
  try {
    snap = await q.get()
  } catch {
    return null
  }
  const same = snap.docs.map((d) => d.data()).find((d) => collegeId && d?.collegeId === collegeId)
  if (same) return pickDept(same, collegeId) ?? null
  for (const d of snap.docs) {
    const dept = pickDept(d.data())
    if (dept) return dept
  }
  return null
}

async function resolveStaffDepartment(id, collegeId) {
  if (!id) return null
  const key = `${id}::${collegeId || ''}`
  if (resolveCache.has(key)) return resolveCache.get(key)

  let dept = null
  // Fast paths: doc-id conventions used across the app.
  for (const col of ['faculty', 'users', 'admins']) {
    dept = await fromDoc(db.doc(`${col}/${id}`), collegeId)
    if (dept) break
  }
  // Slow paths: uid-keyed lookups where the doc id is a FAC-number etc.
  if (!dept) {
    for (const col of ['faculty', 'users', 'admins']) {
      dept = await fromQuery(
        db.collection(col).where('uid', '==', id).limit(5),
        collegeId
      )
      if (dept) break
    }
  }
  if (!dept) {
    // Some legacy classSession rows store a facultyId that only exists as a
    // facultyId field (FAC…) rather than a uid.
    dept = await fromQuery(
      db.collection('faculty').where('facultyId', '==', id).limit(5),
      collegeId
    )
  }

  resolveCache.set(key, dept)
  return dept
}

async function resolveForDoc(collection, data) {
  if (collection === 'attendanceRecords') {
    const sessionId = data.sessionId
    if (!sessionId) return null
    let dept = null
    try {
      const sessionSnap = await db.doc(`classSessions/${sessionId}`).get()
      if (sessionSnap.exists) {
        const s = sessionSnap.data()
        const tagged = typeof s.department === 'string' && s.department.trim()
        if (tagged) return s.department.trim()
        dept = await resolveStaffDepartment(s.facultyId, s.collegeId)
      }
    } catch {
      /* fall through */
    }
    return dept
  }
  if (collection === 'classSessions' || collection === 'weeklySchedules') {
    return resolveStaffDepartment(data.facultyId, data.collegeId)
  }
  // papers / questions — createdBy is the author's auth uid.
  return resolveStaffDepartment(data.createdBy, data.collegeId)
}

// ── scan + plan ───────────────────────────────────────────────────────────
const summary = {}
const pendingBatches = []

for (const collection of COLLECTIONS) {
  const stats = { scanned: 0, alreadyTagged: 0, toTag: 0, unresolved: 0, samples: [] }
  summary[collection] = stats

  let after
  for (;;) {
    let q = db.collection(collection).orderBy('__name__').limit(400)
    if (after) q = q.startAfter(after)
    const snap = await q.get()
    if (snap.empty) break
    after = snap.docs[snap.docs.length - 1]

    const batch = db.batch()
    let batchWrites = 0

    for (const docSnap of snap.docs) {
      stats.scanned++
      const data = docSnap.data()
      const existing = data.department
      if (typeof existing === 'string' && existing.trim()) {
        stats.alreadyTagged++
        continue
      }

      const dept = await resolveForDoc(collection, data)
      if (!dept) {
        stats.unresolved++
        continue
      }

      stats.toTag++
      if (stats.samples.length < 5) stats.samples.push(`${docSnap.id} → ${dept}`)
      if (APPLY) {
        batch.update(docSnap.ref, {
          department: dept,
          departmentBackfilledAt: now,
        })
        batchWrites++
      }
    }

    if (APPLY && batchWrites > 0) pendingBatches.push(batch)
    if (snap.docs.length < 400) break
  }
}

// ── report ────────────────────────────────────────────────────────────────
console.log('Collection               scanned  tagged→  already  unresolved')
for (const [name, s] of Object.entries(summary)) {
  console.log(
    `${name.padEnd(24)} ${String(s.scanned).padStart(7)} ${String(s.toTag).padStart(8)} ` +
      `${String(s.alreadyTagged).padStart(8)} ${String(s.unresolved).padStart(11)}`
  )
  for (const line of s.samples) console.log(`    e.g. ${line}`)
}

const totalToTag = Object.values(summary).reduce((n, s) => n + s.toTag, 0)
const totalUnresolved = Object.values(summary).reduce((n, s) => n + s.unresolved, 0)

if (!APPLY) {
  console.log(`\nDry run complete — ${totalToTag} document(s) would be tagged.`)
  if (totalUnresolved) {
    console.log(
      `${totalUnresolved} document(s) had no resolvable department; they stay untagged ` +
        '(visible college-wide, the tolerant default).'
    )
  }
  console.log('Re-run with --apply to write these tags.')
  process.exit(0)
}

// Commit in ≤400-write batches (Firestore caps a batch at 500).
let written = 0
for (let i = 0; i < pendingBatches.length; i += 1) {
  await pendingBatches[i].commit()
  written++
}
console.log(`\nDone — committed ${written} batch(es), ${totalToTag} document(s) tagged.`)
console.log('  Existing department tags were never overwritten.')
if (totalUnresolved) {
  console.log(`  ${totalUnresolved} document(s) remain untagged (no resolvable department).`)
}
process.exit(0)
