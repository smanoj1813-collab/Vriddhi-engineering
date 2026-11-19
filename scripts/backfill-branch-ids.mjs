#!/usr/bin/env node
/**
 * Adds the platform branch ID to existing students and faculty, next to the
 * name they already store. Nothing else is changed.
 *
 *   students  branch (or department)  -> branchId      (one ID)
 *   faculty   branches (or department) -> branchIds    (sorted unique IDs)
 *
 * WHY
 * New imports and edits already store `branchId` / `branchIds` (see
 * functions/src/branchIds.ts). This script gives the same field to records
 * written before the registry existed, so filters can match on the ID.
 *
 * RULES
 *   - A record that already has the ID field is skipped, never overwritten.
 *   - A faculty record with ANY branch that matches no registry entry is not
 *     tagged at all, so no faculty member gets a partial ID list. It is listed
 *     in the report instead.
 *   - Names are matched with the same rule the filters use (branchKey):
 *     "B.E (CSE)", "B.Tech (CSE)" and "CSE" all resolve to the CSE entry.
 *   - Only ever ADDS the ID field (plus updatedAt). Never deletes or edits names.
 *
 * USAGE
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/vriddhi-serviceAccount.json
 *   node scripts/backfill-branch-ids.mjs                 # dry run (default)
 *   node scripts/backfill-branch-ids.mjs --apply         # write
 *
 * FLAGS
 *   --project <id>            Firebase project id (default: vriddhi-engineering)
 *   --service-account <path>  service-account JSON (else ADC)
 *   --collection <name>       students | faculty (repeatable; default both)
 *   --apply                   write the IDs (default: read-only dry run)
 *
 * COST
 *   One pass over each collection, 300 documents per page, plus one bounded
 *   read of the branch registry. Run it once, by hand.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))

function loadAdmin() {
  for (const candidate of ['firebase-admin', '../functions/node_modules/firebase-admin', '../node_modules/firebase-admin']) {
    try {
      return require(candidate.startsWith('.') ? path.join(here, candidate) : candidate)
    } catch {
      /* try the next location */
    }
  }
  console.error('firebase-admin not found. Run `npm ci` in functions/ or the repo root first.')
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
      out[key] = true
      continue
    }
    if (key === 'collection') out.collection.push(next)
    else out[key] = next
    i++
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const APPLY = Boolean(args.apply)
const PROJECT = (typeof args.project === 'string' && args.project.trim()) || process.env.GCLOUD_PROJECT || 'vriddhi-engineering'
const ALL = ['students', 'faculty']
const COLLECTIONS = args.collection.length ? ALL.filter((c) => args.collection.includes(c)) : ALL
if (args.collection.length && COLLECTIONS.length === 0) {
  console.error(`--collection must be one of: ${ALL.join(', ')}`)
  process.exit(1)
}

const admin = loadAdmin()
const credential =
  typeof args['service-account'] === 'string'
    ? admin.credential.cert(JSON.parse(fs.readFileSync(path.resolve(args['service-account']), 'utf8')))
    : admin.credential.applicationDefault()
admin.initializeApp({ credential, projectId: PROJECT })
const db = admin.firestore()
db.settings({ ignoreUndefinedProperties: true })

// Mirror of src/shared/utils/branchKey.ts. Keep the two in step.
const WRAPPED_BRANCH = /^(B\.?\s*E|B\.?\s*Tech)\s*\((.+)\)$/i
function branchKey(value) {
  let s = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return ''
  const wrapped = s.match(WRAPPED_BRANCH)
  if (wrapped) s = wrapped[2]
  return s.toUpperCase().replace(/\bAND\b/g, ' ').replace(/&/g, ' ').replace(/[^A-Z0-9]/g, '')
}

function resolveToken(token, registry) {
  const trimmed = String(token ?? '').trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed)
    return registry.find((e) => e.branchId === id) ?? null
  }
  const key = branchKey(trimmed)
  if (!key) return null
  return registry.find((e) => branchKey(e.name) === key) ?? null
}

async function loadRegistry() {
  const snap = await db.collection('branches').limit(300).get()
  const entries = snap.docs
    .map((d) => ({ branchId: Number(d.data().branchId ?? d.id), name: String(d.data().name || '').trim() }))
    .filter((e) => Number.isSafeInteger(e.branchId) && e.branchId >= 1 && e.name)
  return entries
}

function planFor(collection, data, registry) {
  if (collection === 'students') {
    if (typeof data.branchId === 'number') return { skip: 'has-id' }
    const raw = String(data.branch || data.department || '').trim()
    if (!raw) return { skip: 'no-branch' }
    const hit = resolveToken(raw, registry)
    if (!hit) return { unmatched: [raw] }
    return { update: { branchId: hit.branchId } }
  }
  // faculty
  if (Array.isArray(data.branchIds) && data.branchIds.length > 0) return { skip: 'has-id' }
  const names = (Array.isArray(data.branches) && data.branches.length ? data.branches : [data.department])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  if (names.length === 0) return { skip: 'no-branch' }
  const ids = new Set()
  const unmatched = []
  for (const name of names) {
    const hit = resolveToken(name, registry)
    if (hit) ids.add(hit.branchId)
    else unmatched.push(name)
  }
  if (unmatched.length > 0) return { unmatched }
  return { update: { branchIds: [...ids].sort((a, b) => a - b) } }
}

async function scan(collection, registry) {
  const stats = { scanned: 0, skipped: {}, toTag: 0, unmatched: new Map(), updates: [] }
  let last = null
  for (;;) {
    let q = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(300)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    if (snap.empty) break
    for (const doc of snap.docs) {
      stats.scanned += 1
      const plan = planFor(collection, doc.data(), registry)
      if (plan.skip) {
        stats.skipped[plan.skip] = (stats.skipped[plan.skip] || 0) + 1
      } else if (plan.unmatched) {
        for (const name of plan.unmatched) stats.unmatched.set(name, (stats.unmatched.get(name) || 0) + 1)
      } else {
        stats.toTag += 1
        stats.updates.push({ ref: doc.ref, update: plan.update })
      }
    }
    last = snap.docs[snap.docs.length - 1]
    if (snap.size < 300) break
  }
  return stats
}

async function writeUpdates(updates) {
  const now = admin.firestore.FieldValue.serverTimestamp()
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch()
    for (const { ref, update } of updates.slice(i, i + 400)) batch.update(ref, { ...update, updatedAt: now })
    await batch.commit()
  }
}

console.log(`\nBranch ID backfill — project ${PROJECT}`)
console.log(`Collections: ${COLLECTIONS.join(', ')}`)
console.log(`Mode:        ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`)

const registry = await loadRegistry()
if (registry.length === 0) {
  console.error('The branch registry is empty. Create the branches on the Branches page first.')
  process.exit(1)
}
console.log(`Registry: ${registry.length} branch(es)\n`)

for (const collection of COLLECTIONS) {
  const stats = await scan(collection, registry)
  console.log(`${collection}`)
  console.log(`  scanned:          ${stats.scanned}`)
  console.log(`  to tag:           ${stats.toTag}`)
  console.log(`  skipped:          ${JSON.stringify(stats.skipped)}`)
  if (stats.unmatched.size > 0) {
    console.log(`  NOT tagged (no registry match) — fix these names or add the branch, then rerun:`)
    for (const [name, count] of [...stats.unmatched.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    "${name}"  × ${count}`)
    }
  }
  if (APPLY && stats.updates.length > 0) {
    await writeUpdates(stats.updates)
    console.log(`  written:          ${stats.updates.length}`)
  }
  console.log('')
}

if (!APPLY) console.log('Dry run only. Rerun with --apply to write.')
