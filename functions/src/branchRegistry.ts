// functions/src/branchRegistry.ts
// ─── Platform-wide branch registry ──────────────────────────────────────────
//
// Super admin creates each branch once (e.g. "B.Tech CSE" = 1, "B.E CSE" = 2).
// The ID is issued here, inside a transaction, so two admins creating branches
// at the same moment can never receive the same number. Clients cannot write
// `branches` or the counter (firestore.rules), so every ID comes from this
// callable.
//
// Cost: one read of the counter plus one duplicate check, both bounded
// (C1: `.limit(1)`, C2: server-side `where`). Callers read the list with a
// bounded query on the client.

import * as admin from 'firebase-admin'
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { branchKey } from './branchKey'

export const BRANCHES_COLLECTION = 'branches'
export const BRANCH_COUNTER_DOC = 'branchCounters/global'
export const MAX_BRANCH_NAME_CHARS = 120

/** Trims, collapses spaces and caps the length. Keeps the spelling the admin typed. */
export function normaliseBranchName(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_BRANCH_NAME_CHARS)
}

/** The next ID after the last one issued. A missing or corrupt counter starts at 1. */
export function nextBranchId(lastIssued: unknown): number {
  const n = Number(lastIssued)
  return Number.isSafeInteger(n) && n >= 0 ? n + 1 : 1
}

async function callerIsSuperadmin(uid: string): Promise<boolean> {
  const db = getFirestore(admin.app(), 'default')
  const user = await db.doc(`users/${uid}`).get()
  if (user.exists && String(user.data()?.role || '').toLowerCase() === 'superadmin') return true
  return (await db.doc(`superadmins/${uid}`).get()).exists
}

export const createBranch = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 10 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required')
    const uid = request.auth.uid
    if (!(await callerIsSuperadmin(uid))) {
      throw new HttpsError('permission-denied', 'Only a superadmin can create branches')
    }

    const name = normaliseBranchName((request.data as Record<string, unknown> | undefined)?.name)
    if (!name) throw new HttpsError('invalid-argument', 'Branch name is required')
    const key = branchKey(name)
    if (!key) throw new HttpsError('invalid-argument', 'Branch name must include letters or numbers')

    const db = getFirestore(admin.app(), 'default')
    const branches = db.collection(BRANCHES_COLLECTION)

    return db.runTransaction(async (tx) => {
      // Duplicate check inside the transaction, so a race cannot add the same branch twice.
      const duplicate = await tx.get(branches.where('nameKey', '==', key).limit(1))
      if (!duplicate.empty) {
        const existing = duplicate.docs[0].data()
        throw new HttpsError(
          'already-exists',
          `Branch "${existing.name}" already exists as ID ${existing.branchId}. Use that ID.`,
        )
      }

      const counterRef = db.doc(BRANCH_COUNTER_DOC)
      const counter = await tx.get(counterRef)
      const branchId = nextBranchId(counter.data()?.last)

      tx.set(counterRef, { last: branchId }, { merge: true })
      tx.set(branches.doc(String(branchId)), {
        branchId,
        name,
        nameKey: key,
        createdBy: uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      return { branchId, name }
    })
  },
)
