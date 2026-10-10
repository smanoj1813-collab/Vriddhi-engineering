import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/platformStats.ts
//
// Item 2.4 of docs/HANDOFF_OPTIMISATION_2026-09-25.md.
//
// Why: the superadmin dashboard used to answer "how many students do we have?"
// by downloading the whole collection and counting rows in the browser — that
// is where the ≈81,000 reads/day/tab in the costing sheet came from. Aggregation
// queries (`count()`) answer the same question in one read, and a 15-minute
// scheduled refresh puts the answer in a single document so the console reads
// ONE doc per view instead of four whole collections.
//
// Contract with the client (`getDashboardStats` in
// src/modules/superadmin/api/superAdminApi.ts):
//   * `platform/stats` is the first source;
//   * if it is missing (first deploy, before the first tick) or older than
//     `PLATFORM_STATS_MAX_AGE_MS`, the client falls back to its own counting —
//     so this function can be deployed, paused or deleted without breaking the
//     console (the "old path stays as fallback" rule).
//
// The document is server-only for writes and superadmin-only for reads
// (firestore.rules, `platform/{doc}`).

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions'
import * as admin from 'firebase-admin'

import { AI_CACHE_STATS_DOC_PATH } from './ai/contentEngine'

export const PLATFORM_STATS_COLLECTION = 'platform'
export const PLATFORM_STATS_DOC = 'stats'
/** Client-side freshness window: older than this and the fallback path is used. */
export const PLATFORM_STATS_MAX_AGE_MS = 60 * 60 * 1000
/** How many colleges the "top colleges" strip shows. */
export const TOP_COLLEGES_LIMIT = 5

export interface PlatformTopCollege {
  id: string
  name: string
  code: string
  studentCount: number
  facultyCount: number
  status: string
}

export interface PlatformStats {
  totalColleges: number
  activeColleges: number
  suspendedColleges: number
  totalStudents: number
  totalFaculty: number
  totalAdmins: number
  topColleges: PlatformTopCollege[]
  updatedAt: string
  source: 'scheduled'
  /**
   * AI content-cache counters (item 4.1), copied from platform/aiCacheStats.
   * `hits` are generations that never happened — the number that justifies the
   * cache — and `tokensServedFromCache` is the output tokens not billed.
   */
  aiCache?: { hits: number; misses: number; tokensServedFromCache: number } | null
}

/** Pure mapping of a colleges-collection row into the dashboard's top-college strip. */
export function toTopCollege(row: {
  id: string
  name?: unknown
  code?: unknown
  studentCount?: unknown
  facultyCount?: unknown
  status?: unknown
}): PlatformTopCollege {
  const num = (value: unknown): number => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  }
  return {
    id: row.id,
    name: String(row.name || row.code || row.id),
    code: String(row.code || ''),
    studentCount: num(row.studentCount),
    facultyCount: num(row.facultyCount),
    status: String(row.status || 'active'),
  }
}

/** Sorts by student count (desc) then name, and caps the strip. Pure, unit-tested. */
export function rankTopColleges(rows: PlatformTopCollege[], limit = TOP_COLLEGES_LIMIT): PlatformTopCollege[] {
  return [...rows]
    .sort((a, b) =>
      b.studentCount - a.studentCount ||
      b.facultyCount - a.facultyCount ||
      a.name.localeCompare(b.name),
    )
    .slice(0, limit)
}

async function countQuery(query: admin.firestore.Query): Promise<number> {
  const snapshot = await query.count().get()
  return snapshot.data().count
}

async function collectPlatformStats(): Promise<PlatformStats> {
  const db = getFirestore(admin.app(), 'default')

  const [totalColleges, activeColleges, suspendedColleges, totalStudents, totalFaculty, totalAdmins] =
    await Promise.all([
      countQuery(db.collection('colleges')),
      countQuery(db.collection('colleges').where('status', '==', 'active')),
      countQuery(db.collection('colleges').where('status', '==', 'suspended')),
      countQuery(db.collection('students')),
      countQuery(db.collection('faculty')),
      countQuery(db.collection('admins')),
    ])

  // Top colleges: prefer the denormalised counter, fall back to all rows when the
  // collection is small enough that ordering by a missing field would be wrong.
  let topColleges: PlatformTopCollege[] = []
  try {
    const ordered = await db
      .collection('colleges')
      .orderBy('studentCount', 'desc')
      .limit(TOP_COLLEGES_LIMIT * 2)
      .get()
    topColleges = rankTopColleges(ordered.docs.map((doc) => toTopCollege({ id: doc.id, ...doc.data() })))
  } catch (err) {
    logger.warn('[PlatformStats] ordered top-colleges query failed, scanning instead', err)
    const all = await db.collection('colleges').limit(200).get()
    topColleges = rankTopColleges(all.docs.map((doc) => toTopCollege({ id: doc.id, ...doc.data() })))
  }

  // Best-effort: a missing/failed counter read must not stop the dashboard.
  let aiCache: PlatformStats['aiCache'] = null
  try {
    const cacheSnap = await db.doc(AI_CACHE_STATS_DOC_PATH).get()
    if (cacheSnap.exists) {
      const data = cacheSnap.data() || {}
      aiCache = {
        hits: Number(data.hits) || 0,
        misses: Number(data.misses) || 0,
        tokensServedFromCache: Number(data.tokensServedFromCache) || 0,
      }
    }
  } catch (err) {
    console.warn('[PlatformStats] AI cache counters unavailable:', (err as Error)?.message)
  }

  return {
    totalColleges,
    activeColleges,
    suspendedColleges,
    totalStudents,
    totalFaculty,
    totalAdmins,
    topColleges,
    aiCache,
    updatedAt: new Date().toISOString(),
    source: 'scheduled',
  }
}

export const refreshPlatformStats = onSchedule(
  {
    region: 'asia-south1',
    schedule: 'every 15 minutes',
    timeZone: 'Asia/Kolkata',
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
  },
  async () => {
    try {
      const stats = await collectPlatformStats()
      await getFirestore(admin.app(), 'default').collection(PLATFORM_STATS_COLLECTION).doc(PLATFORM_STATS_DOC).set(stats)
      logger.info('[PlatformStats] refreshed', {
        colleges: stats.totalColleges,
        students: stats.totalStudents,
        faculty: stats.totalFaculty,
      })
    } catch (err) {
      // A failed tick must not clobber the last good document: the client keeps
      // reading the previous (slightly stale) numbers instead of seeing zeros.
      logger.error('[PlatformStats] refresh failed — keeping the previous snapshot', err)
      throw err
    }
  },
)
