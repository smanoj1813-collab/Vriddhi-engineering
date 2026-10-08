import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/notifications.ts
// ------------------------------------------------------------------
// Server-authoritative college announcements.
//
// WHY THIS MODULE EXISTS
// The notification panel used to be wired end-to-end in the browser, and it
// was wired wrong in three separate places:
//
//   1. WRITE  src/modules/faculty/pages/FacultyAnnouncements.tsx wrote to
//      `notifications` with `target`/`batchFilter` and NO recipient field.
//   2. READ-A src/modules/student/api/studentDataApi.ts fetched
//      `notifications where studentId == <me>` — a field the writer never
//      set, so the dashboard feed and sidebar badge were always empty.
//   3. READ-B src/modules/student/pages/StudentNotificationsPage.tsx fetched
//      `colleges/{collegeId}/notifications`, a subcollection nothing ever
//      wrote, so the full panel was always empty too.
//
// Two readers, one writer, three different addresses: nothing could arrive.
// Read state was also stored on the shared announcement document, so one
// student pressing "mark as read" cleared it for the entire college, and
// `readCount` was initialised to 0 and never incremented.
//
// Targeting and read state are decisions about *who* sees *what*, so they are
// made here, against the student's real Firestore profile — never from
// client-supplied identifiers. Cohort matching deliberately mirrors
// src/shared/utils/cohortMatching.ts so the roster a faculty member previews
// and the feed a student receives are computed by the same rules.
// ------------------------------------------------------------------

import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

// ─── Identity ───────────────────────────────────────────────────────────────

interface AnnouncementStaff {
  uid: string
  role: string
  collegeId: string
  name: string
}

export interface NotificationStudent {
  uid: string
  studentId: string
  collegeId: string
  branch: string
  batch: string
  division: string
  semester: number
}

const STAFF_ROLES = ['superadmin', 'admin', 'principal', 'hod', 'faculty', 'mentor']

/** Roles allowed to address the whole college rather than a cohort. */
const BROADCAST_ROLES = ['superadmin', 'admin', 'principal', 'hod']

async function resolveStaff(uid: string, token: Record<string, unknown>): Promise<AnnouncementStaff> {
  const userDoc = await getFirestore(admin.app(), 'default').collection('users').doc(uid).get()
  const user = userDoc.data()
  const role = String(token.role || user?.role || '')
  const collegeId = String(token.collegeId || user?.collegeId || '')
  if (!userDoc.exists || !STAFF_ROLES.includes(role) || (role !== 'superadmin' && !collegeId)) {
    throw new HttpsError('permission-denied', 'College staff access is required')
  }
  return { uid, role, collegeId, name: String(user?.name || '') }
}

async function resolveStudent(
  uid: string,
  token: Record<string, unknown>
): Promise<NotificationStudent> {
  const db = getFirestore(admin.app(), 'default')
  const [userDoc, students] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('students').where('userId', '==', uid).limit(2).get(),
  ])
  const userData = userDoc.data()
  if (!userDoc.exists || (token.role || userData?.role) !== 'student') {
    throw new HttpsError('permission-denied', 'A linked student account is required')
  }
  if (students.size !== 1) {
    throw new HttpsError(
      'failed-precondition',
      students.empty
        ? 'Your account is not linked to a student profile. Contact your college administrator.'
        : 'Multiple student profiles are linked to this account. Contact your college administrator.'
    )
  }
  const studentDoc = students.docs[0]
  const student = studentDoc.data()
  const collegeId = String(token.collegeId || userData?.collegeId || '')
  if (!collegeId || student.collegeId !== collegeId) {
    throw new HttpsError('failed-precondition', 'Student account tenant linkage is invalid')
  }
  return {
    uid,
    studentId: studentDoc.id,
    collegeId,
    branch: String(student.branch || student.department || ''),
    batch: String(student.batch || student.academicYear || ''),
    division: String(student.division || student.section || ''),
    semester: Number(student.semester) || 0,
  }
}

// ─── Cohort normalisation (mirrors src/shared/utils/cohortMatching.ts) ──────
//
// Importers disagree about casing, whitespace and punctuation: bulk-uploaded
// students carry "BBA" in `department` while staff type " bba " or "B.B.A";
// batches exist as numbers in one importer and strings in another; "A",
// "Div A" and "div. A" are the same division. Comparing those with `===` is a
// coin flip against real data, which is exactly how the old panel silently
// addressed nobody. These helpers are the same rules the roster preview uses.

const NOISE_PUNCT = /[.,;:'’"·]+/g

function foldText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** "B.B.A" → "bba", "BBA " → "bba". Inner whitespace is preserved. */
function normalizeProgramName(value: unknown): string {
  return foldText(value)
    .replace(NOISE_PUNCT, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Batches: "2027" === 2027 === " 2027 ". */
function normalizeCohortToken(value: unknown): string {
  return foldText(value).replace(NOISE_PUNCT, '')
}

/** Divisions/sections: "A" === "div A" === "a ". */
function normalizeDivision(value: unknown): string {
  return foldText(value)
    .replace(/^div(ision)?[.\s]*/, '')
    .replace(/^sec(tion)?[.\s]*/, '')
    .trim()
}

// ─── Targeting ──────────────────────────────────────────────────────────────

export type AnnouncementAudience = 'all' | 'cohort' | 'specific'

export interface AnnouncementCohort {
  branches: string[]
  batches: string[]
  division: string
  semester: number
}

const NOTIFICATION_TYPES = ['info', 'warning', 'success', 'event', 'academic'] as const
type NotificationType = (typeof NOTIFICATION_TYPES)[number]

/**
 * A cohort is a set of independent filters: every non-empty dimension must
 * match (AND across dimensions), and a dimension holding several values is
 * satisfied by any of them (OR within a dimension). A completely empty cohort
 * is rejected rather than treated as a college-wide broadcast.
 */
export function announcementTargetsStudent(
  announcement: admin.firestore.DocumentData,
  student: NotificationStudent
): boolean {
  if (announcement.collegeId !== student.collegeId) return false

  const audience = String(announcement.audience || '')
  if (audience === 'all') return true

  if (audience === 'specific') {
    const ids = Array.isArray(announcement.studentIds) ? announcement.studentIds.map(String) : []
    const uids = Array.isArray(announcement.studentUids) ? announcement.studentUids.map(String) : []
    return ids.includes(student.studentId) || uids.includes(student.uid)
  }

  if (audience !== 'cohort') return false

  const cohort = announcement.cohort
  if (!cohort || typeof cohort !== 'object') return false

  const branches = Array.isArray(cohort.branches) ? cohort.branches : []
  const batches = Array.isArray(cohort.batches) ? cohort.batches : []
  const division = normalizeDivision(cohort.division)
  const semester = Number(cohort.semester) || 0

  if (branches.length === 0 && batches.length === 0 && !division && !semester) return false

  if (branches.length > 0) {
    const wanted = branches.map(normalizeProgramName).filter(Boolean)
    if (wanted.length > 0 && !wanted.includes(normalizeProgramName(student.branch))) return false
  }
  if (batches.length > 0) {
    const wanted = batches.map(normalizeCohortToken).filter(Boolean)
    if (wanted.length > 0 && !wanted.includes(normalizeCohortToken(student.batch))) return false
  }
  if (division) {
    const own = [normalizeDivision(student.division)].filter(Boolean)
    if (!own.includes(division)) return false
  }
  if (semester && student.semester && semester !== student.semester) return false

  return true
}

// ─── Serialisation ──────────────────────────────────────────────────────────

interface SerializedAnnouncement {
  id: string
  title: string
  message: string
  type: NotificationType
  category: string
  priority: string
  audience: AnnouncementAudience
  cohort: AnnouncementCohort | null
  pinned: boolean
  sentByName: string
  createdAt: string | null
  recipientCount: number
  readCount: number
  read: boolean
  // Assignment-published notifications carry the linkage fields so the bell
  // feed can render the course → module badge and a live deadline countdown
  // instead of parsing them out of the message text.
  deadline: string | null
  courseName: string
  moduleTitle: string
  assignmentId: string
}

function iso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const converted = (value as { toDate: () => Date }).toDate()
    if (converted instanceof Date) return converted.toISOString()
  }
  if (typeof value === 'string') return value
  return null
}

export function serialize(
  id: string,
  data: admin.firestore.DocumentData,
  read: boolean
): SerializedAnnouncement {
  const cohort = data.cohort && typeof data.cohort === 'object' ? data.cohort : null
  return {
    id,
    title: String(data.title || ''),
    message: String(data.message || data.body || ''),
    type: (NOTIFICATION_TYPES as readonly string[]).includes(String(data.type))
      ? (String(data.type) as NotificationType)
      : 'info',
    category: String(data.category || 'general'),
    priority: String(data.priority || 'normal'),
    audience: (['all', 'cohort', 'specific'] as string[]).includes(String(data.audience))
      ? (String(data.audience) as AnnouncementAudience)
      : 'cohort',
    cohort: cohort
      ? {
          branches: Array.isArray(cohort.branches) ? cohort.branches.map(String) : [],
          batches: Array.isArray(cohort.batches) ? cohort.batches.map(String) : [],
          division: String(cohort.division || ''),
          semester: Number(cohort.semester) || 0,
        }
      : null,
    pinned: data.pinned === true,
    sentByName: String(data.sentByName || data.sentBy || ''),
    createdAt: iso(data.createdAt),
    recipientCount: Number(data.recipientCount) || 0,
    readCount: Number(data.readCount) || 0,
    read,
    deadline: iso(data.deadline),
    courseName: String(data.courseName || ''),
    moduleTitle: String(data.moduleTitle || ''),
    assignmentId: String(data.assignmentId || ''),
  }
}

/** Newest first; pinned announcements float to the top. */
function sortAnnouncements(items: SerializedAnnouncement[]): SerializedAnnouncement[] {
  return items.sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
    return (right.createdAt || '').localeCompare(left.createdAt || '')
  })
}

// ─── Write: staff ───────────────────────────────────────────────────────────

function stringifyList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean))].slice(0, cap)
}

export const sendAnnouncement = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const input = (request.data || {}) as Record<string, unknown>

    const title = String(input.title || '').trim().slice(0, 160)
    const message = String(input.message || '').trim().slice(0, 4000)
    if (!title) throw new HttpsError('invalid-argument', 'A title is required')
    if (!message) throw new HttpsError('invalid-argument', 'A message is required')

    const requestedCollege = String(input.collegeId || '')
    const collegeId = staff.role === 'superadmin' ? requestedCollege : staff.collegeId
    if (!collegeId) throw new HttpsError('invalid-argument', 'collegeId is required')

    const type = (NOTIFICATION_TYPES as readonly string[]).includes(String(input.type))
      ? (String(input.type) as NotificationType)
      : 'info'
    const priority = ['low', 'normal', 'high', 'urgent'].includes(String(input.priority))
      ? String(input.priority)
      : 'normal'
    const category = String(input.category || 'general').slice(0, 40)

    const audience = (['all', 'cohort', 'specific'] as string[]).includes(String(input.audience))
      ? (String(input.audience) as AnnouncementAudience)
      : 'cohort'

    let cohort: AnnouncementCohort | null = null
    let studentIds: string[] = []

    if (audience === 'all') {
      // A college-wide broadcast is the widest possible blast, so it is gated
      // to leadership roles. Faculty address their own cohorts instead.
      if (!BROADCAST_ROLES.includes(staff.role)) {
        throw new HttpsError(
          'permission-denied',
          'Only college leadership can broadcast to every student. Choose a batch or branch instead.'
        )
      }
    } else if (audience === 'cohort') {
      const source = (input.cohort && typeof input.cohort === 'object' && !Array.isArray(input.cohort)
        ? input.cohort
        : {}) as Record<string, unknown>
      cohort = {
        branches: stringifyList(source.branches ?? source.branch, 40),
        batches: stringifyList(source.batches ?? source.batch, 40),
        division: String(source.division || source.section || '').trim().slice(0, 100),
        semester: Math.max(0, Math.min(20, Number(source.semester) || 0)),
      }
      const selected =
        cohort.branches.length > 0 ||
        cohort.batches.length > 0 ||
        Boolean(cohort.division) ||
        cohort.semester > 0
      if (!selected) {
        throw new HttpsError(
          'invalid-argument',
          'Choose at least one batch or branch. An empty cohort is not a college-wide broadcast.'
        )
      }
    } else {
      studentIds = stringifyList(input.studentIds, 500)
      if (studentIds.length === 0) {
        throw new HttpsError('invalid-argument', 'Choose at least one student')
      }
    }

    // Count the real recipients from the roster rather than trusting a
    // client-supplied estimate. The old UI guessed with
    // `Math.round(studentCount * 0.2)` for targeted sends, so "Sent to 40"
    // could describe an audience of 7.
    const db = getFirestore(admin.app(), 'default')
    const roster = await db
      .collection('students')
      .where('collegeId', '==', collegeId)
      .limit(2000)
      .get()

    let recipientCount = 0
    if (audience === 'all') {
      recipientCount = roster.size
    } else if (audience === 'specific') {
      const wanted = new Set(studentIds)
      recipientCount = roster.docs.filter((doc) => wanted.has(doc.id)).length
      if (recipientCount === 0) {
        throw new HttpsError('invalid-argument', 'None of the selected students belong to this college')
      }
    } else {
      recipientCount = roster.docs.filter((doc) =>
        announcementTargetsStudent(
          { collegeId, audience, cohort, studentIds: [] },
          {
            uid: '',
            studentId: doc.id,
            collegeId,
            branch: String(doc.data().branch || doc.data().department || ''),
            batch: String(doc.data().batch || doc.data().academicYear || ''),
            division: String(doc.data().division || doc.data().section || ''),
            semester: Number(doc.data().semester) || 0,
          }
        )
      ).length
    }

    if (recipientCount === 0) {
      throw new HttpsError(
        'failed-precondition',
        'No students match this batch and branch. Nothing would be delivered.'
      )
    }

    const ref = db.collection('notifications').doc()
    await ref.create({
      collegeId,
      title,
      message,
      type,
      category,
      priority,
      audience,
      ...(cohort ? { cohort } : {}),
      ...(studentIds.length > 0 ? { studentIds } : {}),
      pinned: false,
      sentBy: staff.name,
      sentByName: staff.name,
      createdBy: uid,
      recipientCount,
      readCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    return { id: ref.id, recipientCount }
  }
)

export const listCollegeAnnouncements = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const requestedCollege = String((request.data as Record<string, unknown>)?.collegeId || '')
    const collegeId = staff.role === 'superadmin' ? requestedCollege : staff.collegeId
    if (!collegeId) throw new HttpsError('invalid-argument', 'collegeId is required')

    const snap = await getFirestore(admin.app(), 'default')
      .collection('notifications')
      .where('collegeId', '==', collegeId)
      .limit(200)
      .get()

    return {
      announcements: sortAnnouncements(snap.docs.map((doc) => serialize(doc.id, doc.data(), false))),
    }
  }
)

export const deleteAnnouncement = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const announcementId = String((request.data as Record<string, unknown>)?.announcementId || '')
    if (!announcementId || announcementId.includes('/')) {
      throw new HttpsError('invalid-argument', 'A valid announcementId is required')
    }
    const ref = getFirestore(admin.app(), 'default').collection('notifications').doc(announcementId)
    const doc = await ref.get()
    if (!doc.exists) throw new HttpsError('not-found', 'Announcement not found')
    if (staff.role !== 'superadmin' && doc.data()?.collegeId !== staff.collegeId) {
      throw new HttpsError('permission-denied', 'This announcement belongs to another college')
    }
    await ref.delete()
    return { deleted: true }
  }
)

export const setAnnouncementPinned = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveStaff(uid, request.auth?.token || {})
    const input = (request.data || {}) as Record<string, unknown>
    const announcementId = String(input.announcementId || '')
    if (!announcementId || announcementId.includes('/')) {
      throw new HttpsError('invalid-argument', 'A valid announcementId is required')
    }
    const ref = getFirestore(admin.app(), 'default').collection('notifications').doc(announcementId)
    const doc = await ref.get()
    if (!doc.exists) throw new HttpsError('not-found', 'Announcement not found')
    if (staff.role !== 'superadmin' && doc.data()?.collegeId !== staff.collegeId) {
      throw new HttpsError('permission-denied', 'This announcement belongs to another college')
    }
    const pinned = input.pinned === true
    await ref.update({ pinned })
    return { pinned }
  }
)

// ─── Read: student ──────────────────────────────────────────────────────────

const MAX_FEED = 100

async function loadAddressedAnnouncements(
  student: NotificationStudent
): Promise<Array<{ id: string; data: admin.firestore.DocumentData }>> {
  const snap = await getFirestore(admin.app(), 'default')
    .collection('notifications')
    .where('collegeId', '==', student.collegeId)
    .limit(200)
    .get()
  return snap.docs
    .filter((doc) => announcementTargetsStudent(doc.data(), student))
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .slice(0, MAX_FEED)
}

export const getMyNotifications = onCall(
  // Quota pilot (docs/QUOTA_COMPATIBLE_DEPLOYMENT_PLAN.md): 30 → 10. This is
  // the single-function pilot approved to bring one active, non-admission
  // function under the 20,000 milliCPU Cloud Run cap before touching more.
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 10 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const student = await resolveStudent(uid, request.auth?.token || {})
    const addressed = await loadAddressedAnnouncements(student)
    if (addressed.length === 0) return { notifications: [], unreadCount: 0 }

    // Read state lives in a per-recipient subcollection, so marking one read
    // cannot clear it for anyone else. One batched read for the whole feed.
    const db = getFirestore(admin.app(), 'default')
    const readSnapshots = await db.getAll(
      ...addressed.map((item) => db.collection('notifications').doc(item.id).collection('reads').doc(uid))
    )
    const readIds = new Set(
      readSnapshots.filter((doc) => doc.exists).map((doc) => {
        const path = doc.ref.path
        return path.split('/')[1]
      })
    )

    const notifications = sortAnnouncements(
      addressed.map((item) => serialize(item.id, item.data, readIds.has(item.id)))
    )
    return {
      notifications,
      unreadCount: notifications.filter((item) => !item.read).length,
    }
  }
)

export const markMyNotificationRead = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const student = await resolveStudent(uid, request.auth?.token || {})
    const announcementId = String((request.data as Record<string, unknown>)?.announcementId || '')
    if (!announcementId || announcementId.includes('/')) {
      throw new HttpsError('invalid-argument', 'A valid announcementId is required')
    }

    const db = getFirestore(admin.app(), 'default')
    const announcementRef = db.collection('notifications').doc(announcementId)
    const readRef = announcementRef.collection('reads').doc(uid)

    // Only flip the counter when this recipient has not already been counted,
    // otherwise repeat clicks inflate `readCount` past `recipientCount`.
    await db.runTransaction(async (transaction) => {
      const [announcement, existing] = await Promise.all([
        transaction.get(announcementRef),
        transaction.get(readRef),
      ])
      if (!announcement.exists) throw new HttpsError('not-found', 'Announcement not found')
      if (!announcementTargetsStudent(announcement.data() as admin.firestore.DocumentData, student)) {
        throw new HttpsError('permission-denied', 'This announcement was not addressed to you')
      }
      if (existing.exists) return
      transaction.create(readRef, {
        uid,
        studentId: student.studentId,
        readAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      transaction.update(announcementRef, {
        readCount: admin.firestore.FieldValue.increment(1),
      })
    })

    return { read: true }
  }
)

export const markAllMyNotificationsRead = onCall(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const student = await resolveStudent(uid, request.auth?.token || {})
    const addressed = await loadAddressedAnnouncements(student)
    if (addressed.length === 0) return { marked: 0 }

    const db = getFirestore(admin.app(), 'default')
    const readSnapshots = await db.getAll(
      ...addressed.map((item) => db.collection('notifications').doc(item.id).collection('reads').doc(uid))
    )

    let marked = 0
    const batch = db.batch()
    readSnapshots.forEach((doc, index) => {
      if (doc.exists) return
      const announcementRef = db.collection('notifications').doc(addressed[index].id)
      batch.create(announcementRef.collection('reads').doc(uid), {
        uid,
        studentId: student.studentId,
        readAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      batch.update(announcementRef, {
        readCount: admin.firestore.FieldValue.increment(1),
      })
      marked += 1
    })
    // Firestore batches are capped at 500 writes; the feed is capped at 100
    // announcements × 2 writes, so a single batch always fits.
    await batch.commit()
    return { marked }
  }
)
