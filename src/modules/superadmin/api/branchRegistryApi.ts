// src/modules/superadmin/api/branchRegistryApi.ts
// Client access to the platform branch registry. Reads are one bounded query;
// writes go through the createBranch callable, which issues the ID.

import { collection, getDocs, limit, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/Firebase/config';
import {
  sortRegistry,
  toRegistryEntry,
  type BranchRegistryEntry,
} from '@/shared/utils/branchRegistry';

/** Cost rule C1: bounded read. A platform will not have more branches than this. */
export const MAX_REGISTRY_READ = 300;

export async function listBranchRegistry(): Promise<BranchRegistryEntry[]> {
  const snap = await getDocs(query(collection(db, 'branches'), limit(MAX_REGISTRY_READ)));
  const entries = snap.docs
    .map((doc) => toRegistryEntry(doc.data(), doc.id))
    .filter((entry): entry is BranchRegistryEntry => entry !== null);
  return sortRegistry(entries);
}

export async function createBranchRegistryEntry(name: string): Promise<BranchRegistryEntry> {
  const call = httpsCallable<{ name: string }, BranchRegistryEntry>(functions, 'createBranch');
  const result = await call({ name });
  return result.data;
}
