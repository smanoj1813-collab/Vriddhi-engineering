import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// ─────────────────────────────────────────────────────────────────────────────
// College link repair — re-attach faculty profiles to the college they belong to.
//
// WHY THIS EXISTS
// The college detail page lists faculty with `where('collegeId', '==', id)`.
// The faculty list page, however, shows whatever `collegeName` string is
// stored on the faculty document. When those two disagree the operator sees a
// faculty member labelled "Vriddhi Demo College" who is invisible on the
// Vriddhi Demo College page. That state was reachable in four ways:
//
//   1. A college was deleted (bare deleteDoc) and re-created — the new document
//      has a new auto-id, every faculty still points at the dead one.
//   2. Two colleges shared a code/name (createCollege did not enforce
//      uniqueness), and faculty were imported into the "other" one.
//   3. The staff import stamped collegeName/collegeCode from the CSV row
//      instead of from the selected college.
//   4. Access Control accepted a free-text College ID with no existence check.
//
// The callers of those paths are fixed alongside this file; this callable
// repairs the documents that already drifted. It needs the Admin SDK because a
// correct relink also rewrites the users/{uid} lookup doc, the Auth custom
// claim (which security rules trust over the profile document) and the HOD
// directory entry — none of which the client may touch.
//
// SAFETY
//   - Superadmin only.
//   - dryRun (default true) only reports what would change.
//   - Discovery is conservative: a profile is a candidate only when its current
//     collegeId no longer resolves to a college, or its stored collegeCode /
//     collegeName matches the target exactly. Explicit facultyDocIds are
//     trusted (the operator picked them), but are still validated to exist.
// ─────────────────────────────────────────────────────────────────────────────

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import { IDENTITY_API_VERSION, verifyCaller } from './identityShared'

// Resolved lazily so the pure helpers in this file can be unit-tested without
// an initialised Admin app.
const getDb = () => getFirestore(admin.app(), 'default')

export interface RelinkCandidate {
  facultyDocId: string
  facultyId: string
  name: string
  email: string
  uid: string | null
  department: string
  previousCollegeId: string
  previousCollegeName: string
  previousCollegeCode: string
  previousCollegeExists: boolean
  reason: 'orphaned-college' | 'matching-code' | 'matching-name' | 'explicit'
}

export interface RelinkResult {
  apiVersion: string
  dryRun: boolean
  collegeId: string
  collegeName: string
  collegeCode: string
  scanned: number
  candidates: RelinkCandidate[]
  relinked: number
  claimsUpdated: number
  usersDocsUpdated: number
  hodDocsMoved: number
  facultyCount: number
  errors: string[]
}

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function displayName(data: Record<string, unknown>): string {
  const full = `${String(data.firstName || '')} ${String(data.lastName || '')}`.trim()
  return full || String(data.name || '') || String(data.email || '')
}

/**
 * Pure candidate selection so it can be unit-tested without Firestore.
 * `collegeExists` answers whether a collegeId resolves to a live college.
 */
export function classifyFacultyLink(
  data: Record<string, unknown>,
  target: { id: string; name: string; code: string },
  collegeExists: (id: string) => boolean
): RelinkCandidate['reason'] | null {
  const currentId = String(data.collegeId || '')
  if (currentId === target.id) return null

  const codeMatch = !!norm(data.collegeCode) && !!target.code && norm(data.collegeCode) === norm(target.code)
  const nameMatch = !!norm(data.collegeName) && !!target.name && norm(data.collegeName) === norm(target.name)

  // Nothing on the document says it belongs to this college — never guess.
  if (!codeMatch && !nameMatch) return null

  // The stored link is dead (deleted/re-created college, or never set) but the
  // denormalised label points here: the clearest case.
  if (!currentId || !collegeExists(currentId)) return 'orphaned-college'

  // Live link to a *different* college while the label says this one — the
  // duplicate-college case. Reported so the operator decides.
  return codeMatch ? 'matching-code' : 'matching-name'
}

export const relinkFacultyToCollege = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 300 },
  async (request): Promise<RelinkResult> => {
    const caller = await verifyCaller(request, ['superadmin'])
    const db = getDb()

    const { collegeId, facultyDocIds, dryRun = true } = (request.data || {}) as {
      collegeId?: string
      facultyDocIds?: string[]
      dryRun?: boolean
    }
    if (!collegeId || typeof collegeId !== 'string') {
      throw new HttpsError('invalid-argument', 'collegeId is required')
    }
    if (facultyDocIds !== undefined && !Array.isArray(facultyDocIds)) {
      throw new HttpsError('invalid-argument', 'facultyDocIds must be an array when provided')
    }
    if (facultyDocIds && facultyDocIds.length > 500) {
      throw new HttpsError('invalid-argument', 'At most 500 faculty per relink call')
    }

    const collegeRef = db.collection('colleges').doc(collegeId)
    const collegeSnap = await collegeRef.get()
    if (!collegeSnap.exists) {
      throw new HttpsError('not-found', `College ${collegeId} not found`)
    }
    const college = collegeSnap.data() as { name?: string; code?: string }
    const target = { id: collegeId, name: String(college.name || ''), code: String(college.code || '') }

    // Every college id, so "does this collegeId still exist?" is a set lookup.
    const collegesSnap = await db.collection('colleges').select('name', 'code').get()
    const collegeById = new Map<string, { name: string; code: string }>()
    collegesSnap.docs.forEach((d) => {
      const c = d.data() as { name?: string; code?: string }
      collegeById.set(d.id, { name: String(c.name || ''), code: String(c.code || '') })
    })
    const collegeExists = (id: string) => collegeById.has(id)

    // ── Candidate discovery ──────────────────────────────────────────────
    const candidates: RelinkCandidate[] = []
    const seen = new Set<string>()
    let scanned = 0

    const consider = (
      snap: admin.firestore.DocumentSnapshot,
      explicit: boolean
    ) => {
      if (!snap.exists || seen.has(snap.id)) return
      const data = snap.data() as Record<string, unknown>
      scanned++
      const reason = explicit ? 'explicit' : classifyFacultyLink(data, target, collegeExists)
      if (!reason) return
      if (String(data.collegeId || '') === collegeId) return
      seen.add(snap.id)
      const prevId = String(data.collegeId || '')
      candidates.push({
        facultyDocId: snap.id,
        facultyId: String(data.facultyId || snap.id),
        name: displayName(data),
        email: String(data.email || ''),
        uid: data.uid ? String(data.uid) : null,
        department: String(data.department || ''),
        previousCollegeId: prevId,
        previousCollegeName: String(data.collegeName || collegeById.get(prevId)?.name || ''),
        previousCollegeCode: String(data.collegeCode || collegeById.get(prevId)?.code || ''),
        previousCollegeExists: !!prevId && collegeExists(prevId),
        reason,
      })
    }

    if (facultyDocIds && facultyDocIds.length) {
      const refs = facultyDocIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => db.collection('faculty').doc(id.trim()))
      if (refs.length) {
        const snaps = await db.getAll(...refs)
        snaps.forEach((s) => consider(s, true))
      }
    } else {
      // One pass over the collection. Faculty are small per tenant and this
      // is an operator-triggered repair, so a scan is simpler and more
      // complete than exact-match queries (which miss casing/whitespace drift).
      const all = await db.collection('faculty').get()
      all.docs.forEach((d) => consider(d, false))
    }

    const base = {
      apiVersion: IDENTITY_API_VERSION,
      dryRun: !!dryRun,
      collegeId,
      collegeName: target.name,
      collegeCode: target.code,
      scanned,
      candidates,
    }

    if (dryRun || candidates.length === 0) {
      return {
        ...base,
        relinked: 0,
        claimsUpdated: 0,
        usersDocsUpdated: 0,
        hodDocsMoved: 0,
        facultyCount: (await db.collection('faculty').where('collegeId', '==', collegeId).count().get()).data().count,
        errors: [],
      }
    }

    // ── Apply ────────────────────────────────────────────────────────────
    const errors: string[] = []
    let relinked = 0
    let claimsUpdated = 0
    let usersDocsUpdated = 0
    let hodDocsMoved = 0
    const touchedPreviousColleges = new Set<string>()
    const now = admin.firestore.FieldValue.serverTimestamp()

    for (const c of candidates) {
      try {
        const facultyRef = db.collection('faculty').doc(c.facultyDocId)
        const snap = await facultyRef.get()
        if (!snap.exists) throw new Error('profile disappeared during relink')
        const data = snap.data() as Record<string, unknown>

        const batch = db.batch()
        batch.set(
          facultyRef,
          {
            collegeId,
            collegeName: target.name,
            collegeCode: target.code,
            updatedAt: now,
            relinkedFrom: c.previousCollegeId || null,
            relinkedAt: now,
            relinkedBy: caller.uid,
          },
          { merge: true }
        )

        // users/{uid} — resolve by uid, else by email.
        let uid = c.uid
        if (!uid && c.email) {
          try {
            uid = (await admin.auth().getUserByEmail(c.email)).uid
          } catch {
            uid = null
          }
        }
        if (uid) {
          batch.set(
            db.collection('users').doc(uid),
            { collegeId, collegeCode: target.code, facultyDocId: c.facultyDocId, updatedAt: now },
            { merge: true }
          )
          usersDocsUpdated++
        }

        // HOD directory: move `${oldCollege}_${dept}` → `${newCollege}_${dept}`.
        const role = String(data.role || 'faculty').toLowerCase()
        const isHod = role === 'hod' || data.isHOD === true
        if (isHod && c.department) {
          const newHodRef = db.collection('hods').doc(`${collegeId}_${c.department}`)
          batch.set(
            newHodRef,
            {
              facultyId: c.facultyId,
              uid: uid || null,
              collegeId,
              department: c.department,
              name: c.name,
              email: c.email,
              role: 'hod',
              assignedAt: now,
            },
            { merge: true }
          )
          if (c.previousCollegeId) {
            const oldHodRef = db.collection('hods').doc(`${c.previousCollegeId}_${c.department}`)
            const oldHod = await oldHodRef.get()
            if (oldHod.exists && String(oldHod.data()?.facultyId || '') === c.facultyId) {
              batch.delete(oldHodRef)
            }
          }
          hodDocsMoved++
        }

        await batch.commit()

        // Custom claim last: rules trust the claim before the document, so a
        // stale claim would keep the account scoped to the old college for up
        // to an hour. Revoking refresh tokens forces a fresh token.
        if (uid) {
          try {
            const user = await admin.auth().getUser(uid)
            const claims = user.customClaims || {}
            // Keep the department claim in step with the link (HOD relinks
            // carry the college's department) so rules scoping stays correct.
            const nextDepartment =
              typeof c.department === 'string' && c.department.trim()
                ? c.department.trim()
                : typeof claims.department === 'string'
                  ? claims.department
                  : null
            const departmentChanged = nextDepartment !== null && claims.department !== nextDepartment
            if (claims.collegeId !== collegeId || departmentChanged) {
              await admin.auth().setCustomUserClaims(uid, {
                ...claims,
                collegeId,
                ...(nextDepartment !== null ? { department: nextDepartment } : {}),
              })
              await admin.auth().revokeRefreshTokens(uid)
              claimsUpdated++
            }
          } catch (err: any) {
            errors.push(`${c.email || c.facultyDocId}: claim update failed — ${err?.message || err}`)
          }
        }

        if (c.previousCollegeId && c.previousCollegeExists) touchedPreviousColleges.add(c.previousCollegeId)
        relinked++
      } catch (err: any) {
        errors.push(`${c.email || c.facultyDocId}: ${err?.message || err}`)
        logger.error('[CollegeLinks] relink failed', { facultyDocId: c.facultyDocId, error: err?.message || err })
      }
    }

    // ── Recompute counters from truth rather than incrementing ───────────
    const recount = async (id: string) => {
      const n = (await db.collection('faculty').where('collegeId', '==', id).count().get()).data().count
      await db.collection('colleges').doc(id).set({ facultyCount: n, currentFaculty: n, updatedAt: now }, { merge: true })
      return n
    }
    const facultyCount = await recount(collegeId)
    for (const prev of touchedPreviousColleges) {
      try {
        await recount(prev)
      } catch (err: any) {
        errors.push(`recount ${prev}: ${err?.message || err}`)
      }
    }

    try {
      await db.collection('logs').add({
        action: 'RELINK_FACULTY_TO_COLLEGE',
        collegeId,
        performedBy: caller.uid,
        performedByName: caller.name || null,
        relinked,
        claimsUpdated,
        usersDocsUpdated,
        hodDocsMoved,
        candidates: candidates.map((c) => ({
          facultyDocId: c.facultyDocId,
          email: c.email,
          from: c.previousCollegeId,
          reason: c.reason,
        })),
        errors,
        createdAt: now,
      })
    } catch (err: any) {
      logger.warn('[CollegeLinks] audit log failed', err)
    }

    logger.info('[CollegeLinks] relink complete', { collegeId, relinked, claimsUpdated, errors: errors.length, by: caller.uid })

    return { ...base, relinked, claimsUpdated, usersDocsUpdated, hodDocsMoved, facultyCount, errors }
  }
)
