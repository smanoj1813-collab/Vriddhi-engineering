// functions/src/branchIds.ts
// ─── Resolving typed branch values to registry IDs (server side) ─────────────
//
// A branch cell may hold a registry ID ("1") or a name ("CSE", "B.E (CSE)").
// An ID resolves to its registry name. A name resolves by the same branchKey
// rule the filters use, and the name the admin typed is kept, so existing
// stored names do not change. Anything that matches nothing is reported, not
// stored, so a branch can't be saved without an ID.
//
// Cost: one bounded read of the registry (<= 300 documents) per call. These
// run from admin-triggered callables only, never on a schedule.

import type { Firestore } from 'firebase-admin/firestore'
import { branchKey } from './branchKey'

export const MAX_REGISTRY_READ = 300

export interface RegistryBranch {
  branchId: number
  name: string
}

export interface ResolvedBranch {
  /** The branch ID to store. */
  branchId: number
  /** The name to store: the registry name for an ID, the typed name for a name. */
  name: string
}

export function toRegistryBranch(data: Record<string, unknown> | undefined, docId?: string): RegistryBranch | null {
  const id = Number(data?.branchId ?? docId)
  const name = String(data?.name ?? '').trim()
  if (!Number.isSafeInteger(id) || id < 1 || !name) return null
  return { branchId: id, name }
}

export async function loadBranchRegistry(db: Firestore): Promise<RegistryBranch[]> {
  const snap = await db.collection('branches').limit(MAX_REGISTRY_READ).get()
  return snap.docs
    .map((doc) => toRegistryBranch(doc.data(), doc.id))
    .filter((entry): entry is RegistryBranch => entry !== null)
}

/** Resolves one token, or returns null when it matches nothing. */
export function resolveBranchToken(token: string, registry: readonly RegistryBranch[]): ResolvedBranch | null {
  const trimmed = String(token ?? '').trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed)
    const hit = registry.find((entry) => entry.branchId === id)
    return hit ? { branchId: hit.branchId, name: hit.name } : null
  }
  const key = branchKey(trimmed)
  if (!key) return null
  const hit = registry.find((entry) => branchKey(entry.name) === key)
  return hit ? { branchId: hit.branchId, name: trimmed } : null
}

/**
 * Resolves many tokens. Duplicates of one branch keep the first spelling, so
 * "CSE" and "B.E (CSE)" in the same list store one branch.
 */
export function resolveBranchTokens(
  tokens: readonly string[],
  registry: readonly RegistryBranch[],
): { resolved: ResolvedBranch[]; unmatched: string[] } {
  const resolved: ResolvedBranch[] = []
  const unmatched: string[] = []
  const seen = new Set<number>()
  for (const token of tokens) {
    const hit = resolveBranchToken(token, registry)
    if (!hit) {
      const trimmed = String(token ?? '').trim()
      if (trimmed) unmatched.push(trimmed)
      continue
    }
    if (seen.has(hit.branchId)) continue
    seen.add(hit.branchId)
    resolved.push(hit)
  }
  return { resolved, unmatched }
}

export function unknownBranchMessage(unmatched: readonly string[]): string {
  const many = unmatched.length > 1
  return `Unknown branch${many ? 'es' : ''}: ${unmatched.join(', ')}. ` +
    `Add ${many ? 'them' : 'it'} on the Branches page first, or enter the branch ID.`
}
