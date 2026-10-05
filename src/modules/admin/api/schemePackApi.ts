// src/modules/admin/api/schemePackApi.ts
// Scheme-pack client API (G1): reads presets + college customs, resolves the
// college's ACTIVE pack (colleges/{id}.schemePackId), and wraps the two
// callables that guard the write path.
//
// Every exam-side consumer (result importer, hall tickets, compliance
// dashboard) should resolve the pack through getCollegeSchemePack — never
// reach for DEFAULT directly — so a college on Karnatak Dharwad gets KUD
// numbers end-to-end.

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/Firebase/config';
import {
  DEFAULT_SCHEME_PACK,
  SCHEME_PACK_PRESETS,
  type UniversitySchemePack,
} from '@/shared/types/schemePack';
import { normalizeSchemePack } from '@/shared/utils/schemeEngine';
import { filterVisibleSchemePacks } from '@/shared/utils/schemePackVisibility';
import { findSchemePackAssignment, type SchemePackContext } from '@/shared/utils/schemePackResolution';

/** A pack as the UI lists it: `origin` distinguishes built-ins from customs. */
export interface ListedSchemePack {
  pack: UniversitySchemePack;
  origin: 'preset' | 'custom';
}

function currentCollegeId(): string {
  const id = localStorage.getItem('vriddhi_college_id');
  if (!id) throw new Error('No college is linked to this account');
  return id;
}

/**
 * Presets + the college's custom packs, presets first.
 *
 * The three legacy non-engineering presets are filtered out of the listing
 * (see schemePackVisibility) — resolution below still knows them, so a
 * college already bound to one keeps its rules.
 */
export async function fetchSchemePacks(collegeId?: string): Promise<ListedSchemePack[]> {
  const cid = collegeId || currentCollegeId();
  const listed: ListedSchemePack[] = SCHEME_PACK_PRESETS.map((p) => ({ pack: p, origin: 'preset' }));
  try {
    const [customSnap, globalSnap] = await Promise.all([
      getDocs(query(collection(db, 'schemePacks'), where('collegeId', '==', cid))),
      getDocs(query(collection(db, 'schemePacks'), where('global', '==', true))),
    ]);
    for (const d of customSnap.docs) {
      if (d.data().global === true) continue;
      listed.push({ pack: normalizeSchemePack({ ...d.data(), id: d.id }) as UniversitySchemePack, origin: 'custom' });
    }
    for (const d of globalSnap.docs) {
      const pack = normalizeSchemePack({ ...d.data(), id: d.id }) as UniversitySchemePack;
      const index = listed.findIndex((item) => item.pack.code === pack.code);
      if (index >= 0) listed[index] = { pack, origin: 'preset' };
      else listed.push({ pack, origin: 'preset' });
    }
  } catch (err) {
    // Rules/index hiccups should not sink the page — in-code presets still list.
    console.warn('[schemePackApi] Firestore packs unavailable:', err);
  }
  return filterVisibleSchemePacks(listed);
}

/**
 * The pack the college actually runs on:
 *   colleges/{cid}.schemePackId
 *     → preset code? return the preset
 *     → custom doc id? read schemePacks/{id} (normalised)
 *     → unset/missing → DEFAULT_SCHEME_PACK (BCU — pre-G1 behaviour)
 * Also returns the raw binding so the page can show "assigned" chips.
 */
export async function getCollegeSchemePack(
  collegeId?: string,
  context: SchemePackContext = {},
): Promise<{
  pack: UniversitySchemePack;
  schemePackId: string | null;
  origin: 'preset' | 'custom';
  resolution: 'cohort' | 'programme' | 'college' | 'platform';
}> {
  const cid = collegeId || currentCollegeId();
  let collegeData: Record<string, unknown> = {};
  try {
    const collegeSnap = await getDoc(doc(db, 'colleges', cid));
    collegeData = (collegeSnap.data() || {}) as Record<string, unknown>;
  } catch (err) {
    console.warn('[schemePackApi] college doc unavailable:', err);
  }

  const scoped = findSchemePackAssignment(
    Array.isArray(collegeData.schemePackAssignments)
      ? collegeData.schemePackAssignments as Array<{ schemePackId: string; programId: string; branchId?: string; admissionBatch?: string; updatedAt?: unknown }>
      : [],
    context,
  );
  const collegeDefaultId = typeof collegeData.schemePackId === 'string' && collegeData.schemePackId.trim()
    ? collegeData.schemePackId.trim()
    : null;
  const schemePackId = scoped?.schemePackId || collegeDefaultId;
  const resolution = scoped
    ? (scoped.branchId && scoped.admissionBatch ? 'cohort' : 'programme')
    : collegeDefaultId ? 'college' : 'platform';

  if (!schemePackId) {
    return { pack: DEFAULT_SCHEME_PACK, schemePackId: null, origin: 'preset', resolution };
  }

  const preset = SCHEME_PACK_PRESETS.find((p) => p.code === schemePackId || p.id === schemePackId);
  if (preset) {
    // A global Firestore row is authoritative after the seed; local presets
    // remain an offline-safe fallback for older deployments.
    try {
      const snap = await getDoc(doc(db, 'schemePacks', schemePackId));
      const data = snap.data() as Record<string, unknown> | undefined;
      if (snap.exists() && data && (data.global === true || data.scope === 'platform')) {
        return {
          pack: normalizeSchemePack({ ...data, id: schemePackId }) as UniversitySchemePack,
          schemePackId,
          origin: 'preset',
          resolution,
        };
      }
    } catch (err) {
      console.warn('[schemePackApi] global preset unavailable; using built-in:', err);
    }
    return { pack: preset, schemePackId, origin: 'preset', resolution };
  }

  try {
    const snap = await getDoc(doc(db, 'schemePacks', schemePackId));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      if (String(data.collegeId ?? '') === cid && data.global !== true) {
        return {
          pack: normalizeSchemePack({ ...data, id: schemePackId }) as UniversitySchemePack,
          schemePackId,
          origin: 'custom',
          resolution,
        };
      }
    }
  } catch (err) {
    console.warn('[schemePackApi] assigned pack unreadable:', err);
  }
  // Dangling or cross-college binding — fail safe to the platform default.
  return { pack: DEFAULT_SCHEME_PACK, schemePackId: null, origin: 'preset', resolution: 'platform' };
}

export interface ListedSchemePackAssignment {
  schemePackId: string;
  programId: string;
  branchId?: string;
  admissionBatch?: string;
}

export async function fetchSchemePackAssignments(collegeId?: string): Promise<ListedSchemePackAssignment[]> {
  const cid = collegeId || currentCollegeId();
  const snap = await getDoc(doc(db, 'colleges', cid));
  const rows = snap.data()?.schemePackAssignments;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => ({
      schemePackId: String(row.schemePackId || ''),
      programId: String(row.programId || ''),
      ...(row.branchId ? { branchId: String(row.branchId) } : {}),
      ...(row.admissionBatch ? { admissionBatch: String(row.admissionBatch) } : {}),
    }))
    .filter((row) => row.programId && row.schemePackId);
}

export interface SaveSchemePackResult {
  id: string;
  code: string;
  name: string;
  updated: boolean;
  global?: boolean;
}

export async function saveSchemePack(
  pack: Record<string, unknown>,
  options: { global?: boolean; collegeId?: string } = {},
): Promise<SaveSchemePackResult> {
  const fn = httpsCallable<{
    pack: Record<string, unknown>;
    global?: boolean;
    collegeId?: string;
  }, SaveSchemePackResult>(functions, 'saveSchemePack');
  const res = await fn({ pack, ...options });
  return res.data;
}

export interface SchemePackAssignmentScope {
  programId: string;
  branchId?: string;
  admissionBatch?: string;
}

export interface AssignSchemePackResult {
  collegeId: string;
  schemePackId: string | null;
  resolvedName: string;
  scope?: SchemePackAssignmentScope | null;
}

export async function assignCollegeSchemePack(
  schemePackId: string | null,
  scope?: SchemePackAssignmentScope,
): Promise<AssignSchemePackResult> {
  const fn = httpsCallable<{
    schemePackId: string;
    scope?: SchemePackAssignmentScope;
  }, AssignSchemePackResult>(functions, 'assignCollegeSchemePack');
  const res = await fn({ schemePackId: schemePackId ?? '', ...(scope ? { scope } : {}) });
  return res.data;
}

/** Conveniences for exam-side consumers that just want numbers. */
export type { UniversitySchemePack };
