// ═══════════════════════════════════════════════════════════════════════
// src/api/materialApi.ts
// Course Materials API backed by Firestore & Storage
// Connected directly to curriculum hierarchy without hardcoding
// ═══════════════════════════════════════════════════════════════════════

import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  increment,
  Timestamp,
} from 'firebase/firestore';
import { db, storage } from '@/Firebase/config';
import {
  deleteObject,
  ref,
  type StorageReference,
} from 'firebase/storage';
import { extractCanonicalSubject, extractCanonicalTopic } from '@/shared/utils/curriculumMatcher';

export type MaterialType = 'pdf' | 'video' | 'link' | 'image' | 'document' | 'presentation';

export interface MaterialItem {
  id: string;
  title: string;
  type: MaterialType;
  subject: string;
  canonicalSubject?: string;
  topic?: string;
  canonicalTopic?: string;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  moduleId?: string;
  moduleNo?: number | string;
  moduleName?: string;
  batch?: string;
  branch?: string;
  semester?: number | string;
  size?: string;
  views: number;
  downloads: number;
  url: string;
  /** Exact Storage object path (new uploads); deleteMaterial removes the file. */
  storagePath?: string;
  facultyId?: string;
  facultyName?: string;
  uploadedBy?: string;
  uploadedAt: string;
  createdAt?: string;
  tags?: string[];
  collegeId?: string;
}

export interface CreateMaterialInput {
  title: string;
  type: MaterialType;
  url: string;
  storagePath?: string;
  subject: string;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  moduleId?: string;
  moduleNo?: number | string;
  moduleName?: string;
  topic?: string;
  batch?: string;
  branch?: string;
  semester?: number | string;
  size?: string;
  tags?: string[];
  facultyId?: string;
  facultyName?: string;
  collegeId: string;
}

/**
 * Resolves the Storage object behind a material doc. New uploads store the
 * exact `storagePath`; legacy docs only carry the download `url`, which
 * ref() parses back (it accepts gs:// and https:// URLs, throwing on
 * anything else). Returns null for external links, base64 fallbacks
 * and anything outside this college's materials folder — deletion never
 * touches objects outside the tenant prefix.
 */
function resolveMaterialObjectRef(
  collegeId: string,
  data: { storagePath?: unknown; url?: unknown } | undefined,
): StorageReference | null {
  const prefix = `colleges/${collegeId}/materials/`;
  const stored = typeof data?.storagePath === 'string' ? data.storagePath.trim() : '';
  if (stored) {
    if (!stored.startsWith(prefix)) return null;
    return ref(storage, stored);
  }
  const url = typeof data?.url === 'string' ? data.url.trim() : '';
  if (!url) return null;
  try {
    const objectRef = ref(storage, url);
    const expectedBucket = storage.app?.options?.storageBucket;
    if (expectedBucket && objectRef.bucket !== expectedBucket) return null;
    return objectRef.fullPath.startsWith(prefix) ? objectRef : null;
  } catch {
    return null;
  }
}

export const materialApi = {
  /**
   * Fetch all materials for a college with optional subject/course filtering
   */
  async getCollegeMaterials(collegeId: string, limitCount = 300): Promise<MaterialItem[]> {
    if (!collegeId) return [];
    try {
      const q = query(
        collection(db, 'colleges', collegeId, 'materials'),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          title: data.title || '',
          type: (data.type as MaterialType) || 'pdf',
          subject: data.subject || data.courseName || '',
          canonicalSubject: data.canonicalSubject || extractCanonicalSubject(data.subject || data.courseName || ''),
          topic: data.topic || data.moduleName || 'General',
          canonicalTopic: data.canonicalTopic || extractCanonicalTopic(data.topic || data.moduleName || ''),
          courseId: data.courseId,
          courseCode: data.courseCode,
          courseName: data.courseName,
          moduleId: data.moduleId,
          moduleNo: data.moduleNo,
          moduleName: data.moduleName,
          batch: data.batch || '',
          branch: data.branch || '',
          semester: data.semester,
          size: data.size,
          views: data.views || 0,
          downloads: data.downloads || 0,
          url: data.url || '#',
          facultyId: data.facultyId,
          facultyName: data.facultyName || data.uploadedBy || 'Faculty',
          uploadedBy: data.facultyName || data.uploadedBy || 'Faculty',
          uploadedAt: data.uploadedAt || data.createdAt || new Date().toISOString(),
          createdAt: data.createdAt,
          tags: Array.isArray(data.tags) ? data.tags : [],
          collegeId,
        };
      });
    } catch (err) {
      console.warn('[materialApi.getCollegeMaterials] Falling back to un-ordered query:', err);
      // In case createdAt index is not present yet
      const fallbackSnap = await getDocs(collection(db, 'colleges', collegeId, 'materials'));
      return fallbackSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          title: data.title || '',
          type: (data.type as MaterialType) || 'pdf',
          subject: data.subject || data.courseName || '',
          canonicalSubject: data.canonicalSubject || extractCanonicalSubject(data.subject || data.courseName || ''),
          topic: data.topic || data.moduleName || 'General',
          canonicalTopic: data.canonicalTopic || extractCanonicalTopic(data.topic || data.moduleName || ''),
          courseId: data.courseId,
          courseCode: data.courseCode,
          courseName: data.courseName,
          moduleId: data.moduleId,
          moduleNo: data.moduleNo,
          moduleName: data.moduleName,
          batch: data.batch || '',
          branch: data.branch || '',
          semester: data.semester,
          size: data.size,
          views: data.views || 0,
          downloads: data.downloads || 0,
          url: data.url || '#',
          facultyId: data.facultyId,
          facultyName: data.facultyName || data.uploadedBy || 'Faculty',
          uploadedBy: data.facultyName || data.uploadedBy || 'Faculty',
          uploadedAt: data.uploadedAt || data.createdAt || new Date().toISOString(),
          createdAt: data.createdAt,
          tags: Array.isArray(data.tags) ? data.tags : [],
          collegeId,
        };
      });
    }
  },

  /**
   * Upload or add a material record linked to curriculum
   */
  async addMaterial(input: CreateMaterialInput): Promise<MaterialItem> {
    const { collegeId, ...rest } = input;
    if (!collegeId) throw new Error('collegeId is required to upload material');

    const now = new Date().toISOString();
    const canonicalSubject = extractCanonicalSubject(rest.courseName || rest.subject);
    const canonicalTopic = extractCanonicalTopic(rest.topic || rest.moduleName || '');

    const docData = {
      ...rest,
      canonicalSubject,
      canonicalTopic,
      views: 0,
      downloads: 0,
      createdAt: now,
      uploadedAt: now,
      updatedAt: now,
    };

    const docRef = await addDoc(collection(db, 'colleges', collegeId, 'materials'), docData);

    return {
      id: docRef.id,
      ...docData,
      collegeId,
      uploadedBy: rest.facultyName || 'Faculty',
    };
  },

  /**
   * Delete a material
   */
  async deleteMaterial(collegeId: string, materialId: string): Promise<void> {
    if (!collegeId || !materialId) return;
    const docRef = doc(db, 'colleges', collegeId, 'materials', materialId);
    // Remove the Storage object too: deleting only the Firestore doc orphans
    // the file (up to 50 MB) with no reference left to find it. Best-effort —
    // a missing/failed object must never block removing the library entry the
    // user explicitly deleted.
    try {
      const snap = await getDoc(docRef);
      const objectRef = resolveMaterialObjectRef(collegeId, snap.data());
      if (objectRef) await deleteObject(objectRef);
    } catch (err) {
      console.warn('[materialApi] Storage object could not be removed; deleting the library entry anyway:', err);
    }
    await deleteDoc(docRef);
  },

  /**
   * Track view count
   */
  async trackView(collegeId: string, materialId: string): Promise<void> {
    if (!collegeId || !materialId) return;
    try {
      const docRef = doc(db, 'colleges', collegeId, 'materials', materialId);
      await updateDoc(docRef, { views: increment(1) });
    } catch {}
  },

  /**
   * Track download count
   */
  async trackDownload(collegeId: string, materialId: string): Promise<void> {
    if (!collegeId || !materialId) return;
    try {
      const docRef = doc(db, 'colleges', collegeId, 'materials', materialId);
      await updateDoc(docRef, { downloads: increment(1) });
    } catch {}
  },
};
