// ═══════════════════════════════════════════════════════════════════════
// api/curriculumMappingApi.ts — Curriculum Faculty Mapping & Scheduling
// ═══════════════════════════════════════════════════════════════════════

import { sameBranch } from '@/shared/utils/branchKey';
import { db } from '@/Firebase/config';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, limit, Timestamp, writeBatch,
  DocumentData, QueryDocumentSnapshot, Query,
} from "firebase/firestore";

import type { LedgerTopicRow } from '@/modules/faculty/utils/curriculumCoverage';

import type {
  CurriculumFacultyMapping,
  CreateMappingInput,
  UpdateMappingInput,
  MappingFilterOptions,
  FacultyCurriculumView,
} from '@/shared/types/curriculum';

const MAPPINGS_COLLECTION = "curriculumFacultyMappings";

// ═══════════════════════════════════════════════════════════════════════
// Deep Sanitizer (reused from curriculumApi.ts)
// ═══════════════════════════════════════════════════════════════════════
function deepSanitize<T>(obj: T): T {
  if (obj === null || obj === undefined) return null as T;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;
  // FIX: preserve Firestore Timestamp objects instead of flattening them
  // into {seconds, nanoseconds} maps (which breaks date rendering & orderBy)
  if (obj instanceof Timestamp) return obj;
  if (Array.isArray(obj)) {
    return obj.map(deepSanitize).filter(v => v !== undefined) as unknown as T;
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = deepSanitize(value);
    }
  }
  return result as T;
}

// ═══════════════════════════════════════════════════════════════════════
// Mapper
// ═══════════════════════════════════════════════════════════════════════
function docToMapping(docSnap: QueryDocumentSnapshot<DocumentData>): CurriculumFacultyMapping {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    curriculumId: data.curriculumId || "",
    collegeId: data.collegeId || "",
    courseId: data.courseId || "",
    courseCode: data.courseCode || "",
    courseName: data.courseName || "",
    facultyId: data.facultyId || "",
    facultyName: data.facultyName || "",
    facultyEmail: data.facultyEmail ?? null,
    branch: data.branch || "",
    semester: data.semester || 0,
    batch: data.batch || "",
    division: data.division ?? null,
    section: data.section ?? null,
    totalHours: data.totalHours || 0,
    credits: data.credits || 0,
    modulesCount: data.modulesCount || 0,
    assignedAt: data.assignedAt?.toDate?.().toISOString() || new Date().toISOString(),
    assignedBy: data.assignedBy || "",
    status: data.status || "active",
  } as CurriculumFacultyMapping;
}

// ═══════════════════════════════════════════════════════════════════════
// Faculty identity aliases
// ═══════════════════════════════════════════════════════════════════════

export interface FacultyIdentityAliases {
  /** Auth uid (what the signed-in session calls facultyId). */
  uid: string;
  /** faculty/{doc} document id — the id the mapping dialog used to store. */
  profileId: string | null;
  /** Lower-cased profile email, for mappings that carry facultyEmail. */
  email: string | null;
  /** Every id a mapping may legitimately use for this faculty member. */
  ids: string[];
}

const aliasCache = new Map<string, FacultyIdentityAliases>();

/**
 * The signed-in id and the id stamped on curriculumFacultyMappings diverge:
 * admins pick faculty from the `faculty` collection (document ids like
 * FAC001) while the faculty app queries with the Auth uid. Resolve the
 * profile document for the uid so a mapping written either way still matches.
 * Mirrors the roster fallback in src/shared/api/staffAttendanceApi.ts.
 */
export async function resolveFacultyAliases(uid: string): Promise<FacultyIdentityAliases> {
  const cached = aliasCache.get(uid);
  if (cached) return cached;
  const empty: FacultyIdentityAliases = { uid, profileId: null, email: null, ids: [uid] };
  if (!uid) return empty;
  try {
    const snap = await getDocs(
      query(collection(db, 'faculty'), where('uid', '==', uid), limit(1))
    );
    const docSnap = snap.docs[0];
    if (!docSnap) {
      aliasCache.set(uid, empty);
      return empty;
    }
    const data = docSnap.data() as Record<string, unknown>;
    const email = typeof data.email === 'string' && data.email.trim() ? data.email.trim().toLowerCase() : null;
    const resolved: FacultyIdentityAliases = {
      uid,
      profileId: docSnap.id,
      email,
      ids: [uid, docSnap.id, String(data.facultyId || '')].filter(Boolean),
    };
    aliasCache.set(uid, resolved);
    return resolved;
  } catch (error) {
    console.warn('[CurriculumMappingApi] faculty alias resolution failed:', error);
    return empty;
  }
}

/** True when a mapping belongs to the faculty described by the aliases. */
function mappingBelongsToFaculty(
  mapping: CurriculumFacultyMapping,
  aliases: FacultyIdentityAliases | null,
): boolean {
  if (!aliases) return true;
  if (aliases.ids.includes(mapping.facultyId)) return true;
  if (aliases.email && mapping.facultyEmail && mapping.facultyEmail.trim().toLowerCase() === aliases.email) {
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// CRUD Operations
// ═══════════════════════════════════════════════════════════════════════

export async function createMapping(input: CreateMappingInput): Promise<CurriculumFacultyMapping> {
  const now = Timestamp.now();
  const data = deepSanitize({
    ...input,
    status: 'active',
    assignedAt: now,
  });
  const docRef = await addDoc(collection(db, MAPPINGS_COLLECTION), data);
  return { id: docRef.id, ...data, assignedAt: now.toDate().toISOString() } as CurriculumFacultyMapping;
}

export async function getMappingById(mappingId: string): Promise<CurriculumFacultyMapping | null> {
  try {
    const docRef = doc(db, MAPPINGS_COLLECTION, mappingId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return docToMapping(docSnap as QueryDocumentSnapshot<DocumentData>);
  } catch (error) {
    console.error("Error fetching mapping:", error);
    return null;
  }
}

export async function listMappings(options: MappingFilterOptions = {}): Promise<CurriculumFacultyMapping[]> {
  try {
    // FIX: Build the query with a single equality filter, then apply the rest
    // client-side. Chaining many where() clauses required composite indexes
    // for every combination and silently returned empty lists when missing.
    let q: Query<DocumentData>;
    if (options.collegeId) {
      q = query(collection(db, MAPPINGS_COLLECTION), where("collegeId", "==", options.collegeId));
    } else if (options.facultyId) {
      q = query(collection(db, MAPPINGS_COLLECTION), where("facultyId", "==", options.facultyId));
    } else {
      q = query(collection(db, MAPPINGS_COLLECTION));
    }

    const snapshot = await getDocs(q);
    let items = snapshot.docs.map(docToMapping);

    // Client-side filtering (no composite indexes required)
    if (options.collegeId) items = items.filter((m) => m.collegeId === options.collegeId);
    if (options.facultyId && !options.facultyAliases) items = items.filter((m) => m.facultyId === options.facultyId);
    if (options.facultyAliases) {
      const aliases: FacultyIdentityAliases = {
        uid: options.facultyId || options.facultyAliases[0] || '',
        profileId: null,
        email: options.facultyEmail ? options.facultyEmail.trim().toLowerCase() : null,
        ids: options.facultyAliases,
      };
      items = items.filter((m) => mappingBelongsToFaculty(m, aliases));
    }
    if (options.curriculumId) items = items.filter((m) => m.curriculumId === options.curriculumId);
    if (options.branch) items = items.filter((m) => sameBranch(m.branch, options.branch));
    if (options.semester) items = items.filter((m) => m.semester === options.semester);
    if (options.batch) items = items.filter((m) => m.batch === options.batch);
    if (options.status && options.status !== 'all') items = items.filter((m) => m.status === options.status);

    // Sort newest first
    items = items.sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime());

    return items;
  } catch (error) {
    console.error("Error fetching mappings:", error);
    return [];
  }
}

export async function updateMapping(mappingId: string, updates: UpdateMappingInput): Promise<CurriculumFacultyMapping> {
  try {
    const docRef = doc(db, MAPPINGS_COLLECTION, mappingId);
    await updateDoc(docRef, deepSanitize({ ...updates, updatedAt: Timestamp.now() }));
    const updated = await getDoc(docRef);
    if (!updated.exists()) throw new Error("Mapping not found after update");
    return docToMapping(updated as QueryDocumentSnapshot<DocumentData>);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Failed to update mapping");
  }
}

export async function deleteMapping(mappingId: string): Promise<void> {
  try {
    await updateDoc(doc(db, MAPPINGS_COLLECTION, mappingId), deepSanitize({
      status: 'removed',
      updatedAt: Timestamp.now(),
    }));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Failed to delete mapping");
  }
}

export async function bulkCreateMappings(inputs: CreateMappingInput[]): Promise<CurriculumFacultyMapping[]> {
  const batch = writeBatch(db);
  const mappingsRef = collection(db, MAPPINGS_COLLECTION);
  const now = Timestamp.now();
  const results: CurriculumFacultyMapping[] = [];

  for (const input of inputs) {
    const docRef = doc(mappingsRef);
    const data = deepSanitize({ ...input, status: 'active', assignedAt: now });
    batch.set(docRef, data);
    results.push({ id: docRef.id, ...data, assignedAt: now.toDate().toISOString() } as CurriculumFacultyMapping);
  }

  await batch.commit();
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// Faculty Curriculum View
// ═══════════════════════════════════════════════════════════════════════

export async function getFacultyCurriculum(facultyId: string, collegeId?: string): Promise<FacultyCurriculumView[]> {
  try {
    // Match mappings written with the Auth uid OR the faculty profile document
    // id (the mapping dialog's historical key) OR the profile email. Without
    // this, every mapping created before the uid work was invisible to the
    // faculty it belonged to and "My Curriculum" rendered empty.
    const aliases = await resolveFacultyAliases(facultyId);
    const mappings = await listMappings({
      facultyId,
      facultyAliases: aliases.ids,
      facultyEmail: aliases.email || undefined,
      collegeId,
      status: 'active',
    });
    const views: FacultyCurriculumView[] = [];

    for (const mapping of mappings) {
      // Fetch curriculum to get modules
      const curriculumRef = doc(db, "curriculum", mapping.curriculumId);
      const curriculumSnap = await getDoc(curriculumRef);
      let modules: any[] = [];
      let curriculumTitle = mapping.courseName;

      if (curriculumSnap.exists()) {
        const curriculumData = curriculumSnap.data();
        curriculumTitle = curriculumData.title || curriculumTitle;
        const course = (curriculumData.courses || []).find((c: any) => c.id === mapping.courseId);
        if (course) {
          modules = course.modules || [];
        }
      }

      views.push({
        mappingId: mapping.id,
        curriculumId: mapping.curriculumId,
        curriculumTitle,
        courseId: mapping.courseId,
        courseCode: mapping.courseCode,
        courseName: mapping.courseName,
        branch: mapping.branch,
        semester: mapping.semester,
        batch: mapping.batch,
        division: mapping.division,
        section: mapping.section,
        totalHours: mapping.totalHours,
        credits: mapping.credits,
        modules,
        assignedAt: mapping.assignedAt,
      });
    }

    return views;
  } catch (error) {
    console.error("Error fetching faculty curriculum:", error);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════════════════════════════════

export async function getMappingStats(collegeId: string): Promise<{
  totalMappings: number;
  activeMappings: number;
  facultyCount: number;
  courseCount: number;
  byBranch: Record<string, number>;
  bySemester: Record<string, number>;
}> {
  try {
    const mappings = await listMappings({ collegeId });
    const active = mappings.filter(m => m.status === 'active');
    const facultyIds = new Set(active.map(m => m.facultyId));
    const courseIds = new Set(active.map(m => m.courseId));

    const byBranch: Record<string, number> = {};
    const bySemester: Record<string, number> = {};

    for (const m of active) {
      byBranch[m.branch] = (byBranch[m.branch] || 0) + 1;
      bySemester[String(m.semester)] = (bySemester[String(m.semester)] || 0) + 1;
    }

    return {
      totalMappings: mappings.length,
      activeMappings: active.length,
      facultyCount: facultyIds.size,
      courseCount: courseIds.size,
      byBranch,
      bySemester,
    };
  } catch (error) {
    console.error("Error fetching mapping stats:", error);
    return { totalMappings: 0, activeMappings: 0, facultyCount: 0, courseCount: 0, byBranch: {}, bySemester: {} };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Coverage ledger (facultyTopics)
// ═══════════════════════════════════════════════════════════════════════

const LEDGER_COLLECTION = "facultyTopics";
const LEDGER_LIMIT = 400;

/**
 * The signed-in teacher's own coverage rows: what they have marked covered,
 * and what they have planned but not yet taught.
 *
 * Two id spellings exist for the same person — the Auth uid (what the Topics
 * page stamps) and the `faculty/{doc}` profile id (what a class session
 * carries). `completeClassSession` writes rows under EITHER, depending on
 * whether the topic was pre-planned, so a uid-only query silently drops half
 * the history and the curriculum page would report topics as untouched that
 * the teacher closed a class on. Both spellings are read, exactly as the
 * server's own ledger read does.
 *
 * Returns [] rather than throwing when the read is denied: the modules
 * themselves are the primary content of the page, and a missing progress badge
 * must not replace them with an error screen.
 */
export async function fetchFacultyTopicLedger(facultyId: string): Promise<LedgerTopicRow[]> {
  const aliases = await resolveFacultyAliases(facultyId);
  const ids = Array.from(new Set([facultyId, ...aliases.ids].filter(Boolean)));
  const snapshots = await Promise.all(
    ids.map((id) =>
      getDocs(query(collection(db, LEDGER_COLLECTION), where("facultyId", "==", id), limit(LEDGER_LIMIT)))
        .then((snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as LedgerTopicRow)))
        .catch((error) => {
          console.warn(`[CurriculumMappingApi] ledger read failed for ${id}:`, error);
          return [] as LedgerTopicRow[];
        })
    )
  );
  const seen = new Set<string>();
  const out: LedgerTopicRow[] = [];
  for (const row of snapshots.flat()) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
