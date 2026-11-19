// src/shared/utils/branchRegistry.ts
// ─── Platform branch registry: lookups ───────────────────────────────────────
//
// Pure helpers over the `branches` registry (created by the createBranch
// callable). A name typed in a form or an import resolves to the registry entry
// with the same branchKey, so "B.E (CSE)", "B.Tech (CSE)" and "CSE" all resolve
// to ID 1 when ID 1 is "B.Tech CSE". Blank and unknown names are reported, not
// guessed.

import { branchKey } from './branchKey';

export interface BranchRegistryEntry {
  branchId: number;
  name: string;
}

/** Reads a registry document. Returns null for anything that is not a valid entry. */
export function toRegistryEntry(data: Record<string, unknown> | undefined | null, docId?: string): BranchRegistryEntry | null {
  const id = Number(data?.branchId ?? docId);
  const name = String(data?.name ?? '').trim();
  if (!Number.isSafeInteger(id) || id < 1 || !name) return null;
  return { branchId: id, name };
}

/** Sorts by ID, so the list reads 1, 2, 3 whatever order the data arrives in. */
export function sortRegistry(entries: readonly BranchRegistryEntry[]): BranchRegistryEntry[] {
  return [...entries].sort((a, b) => a.branchId - b.branchId);
}

/** The registry entry a branch name refers to, or null. Blank never matches. */
export function findRegistryBranch(value: string | null | undefined, registry: readonly BranchRegistryEntry[]): BranchRegistryEntry | null {
  const key = branchKey(value);
  if (!key) return null;
  return registry.find((entry) => branchKey(entry.name) === key) ?? null;
}

/**
 * Resolves typed branch names to IDs. Names that match nothing are returned in
 * `unmatched` so the form can ask the admin to create them, instead of storing
 * a branch with no ID.
 */
export function registryIdsFor(
  values: readonly string[],
  registry: readonly BranchRegistryEntry[],
): { ids: number[]; unmatched: string[] } {
  const ids = new Set<number>();
  const unmatched: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) continue;
    const hit = findRegistryBranch(trimmed, registry);
    if (hit) ids.add(hit.branchId);
    else unmatched.push(trimmed);
  }
  return { ids: [...ids].sort((a, b) => a - b), unmatched };
}

/** Display label for a stored branch ID, falling back to the ID itself. */
export function branchLabel(branchId: number, registry: readonly BranchRegistryEntry[]): string {
  return registry.find((entry) => entry.branchId === branchId)?.name ?? `Branch ${branchId}`;
}
