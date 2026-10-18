// Timetable approval callables.
//
//   saveTimetableDraft      operations: replace the draft slots for branch+semester
//   copyLiveToDraft         operations: start a draft from the live timetable
//   submitTimetable         operations: lock the draft and send it to the HOD
//   reviewTimetable         HOD of the branch (principal as fallback): approve or return
//   markLegacyTimetablesApproved  principal/superadmin: one-time cut-over
//
// Only an approved draft is copied to the live `weeklySchedules` collection,
// which students and faculty read. Old live slots are deactivated, not deleted.
// Client writes to these collections are denied by firestore.rules.

import * as admin from 'firebase-admin'
import { getFirestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { requireVerifiedCurriculum } from './curriculumApproval'
import {
  canTimetableAction,
  pickSlotFields,
  timetableApprovalId,
  type ApprovalActor,
  type ApprovalRecord,
} from './timetableApprovalRules'

const APPROVALS = 'timetableApprovals'
const DRAFTS = 'timetableDrafts'
const LIVE = 'weeklySchedules'
const STAFF_ROLES = ['operations', 'hod', 'principal', 'superadmin']
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const MAX_SLOTS = 200
// Low-traffic office callables. maxInstances is kept small: the project's
// per-region CPU quota rejected deploys that asked for 30 instances each.
const OPTS = { region: 'asia-south1', memory: '256MiB' as const, timeoutSeconds: 60, minInstances: 0, maxInstances: 5 }

interface Slot {
  dayOfWeek: string
  startTime: string
  endTime: string
  subject: string
  subjectCode: string
  facultyId: string
  facultyName: string
  facultyInitials: string
  room: string
  batch: string
  division: string
  section: string
  type: string
}

function db() {
  return getFirestore(admin.app(), 'default')
}

function fail(code: 'invalid-argument' | 'permission-denied' | 'failed-precondition' | 'not-found', message: string): never {
  throw new HttpsError(code, message)
}

async function staffFor(uid: string, token: Record<string, unknown>) {
  const userDoc = await db().collection('users').doc(uid).get()
  const user = userDoc.data()
  const role = String(token.role || user?.role || '')
  const claimCollege = String(token.collegeId || user?.collegeId || '')
  if (!userDoc.exists || !STAFF_ROLES.includes(role)) fail('permission-denied', 'Staff access is required')
  if (role !== 'superadmin' && !claimCollege) fail('permission-denied', 'Your account is not linked to a college')
  const actor: ApprovalActor & { collegeId: string; name: string } = {
    uid,
    role,
    department: String(token.department || user?.department || ''),
    collegeId: claimCollege,
    name: String(user?.name || ''),
  }
  return actor
}

function requireCollege(actor: { role: string; collegeId: string }, requested: unknown): string {
  const requestedId = String(requested || '').trim()
  if (actor.role === 'superadmin') {
    if (!requestedId) fail('invalid-argument', 'collegeId is required')
    return requestedId
  }
  if (requestedId && requestedId !== actor.collegeId) fail('permission-denied', 'That timetable belongs to another college')
  return actor.collegeId
}

function requireScope(raw: Record<string, unknown>) {
  const branch = String(raw.branch || '').trim().replace(/\s+/g, ' ')
  const semester = Number(raw.semester)
  if (!branch) fail('invalid-argument', 'branch is required')
  if (!Number.isInteger(semester) || semester < 1 || semester > 8) fail('invalid-argument', 'semester must be 1 to 8')
  return { branch, semester }
}

/** Matches the rules' claimDepartment() normalisation (trim + lower). */
function branchKey(branch: string): string {
  return branch.trim().toLowerCase()
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 3)
}

function cleanSlots(raw: unknown): Slot[] {
  if (!Array.isArray(raw)) fail('invalid-argument', 'slots must be a list')
  if (raw.length > MAX_SLOTS) fail('invalid-argument', `A timetable can hold at most ${MAX_SLOTS} slots`)
  return raw.map((item, i) => {
    const s = (item ?? {}) as Record<string, unknown>
    const str = (k: string) => String(s[k] ?? '').trim()
    const dayOfWeek = str('dayOfWeek').toLowerCase()
    const startTime = str('startTime')
    const endTime = str('endTime')
    const where = `Row ${i + 1}`
    if (!DAYS.includes(dayOfWeek)) fail('invalid-argument', `${where}: choose a valid day`)
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) fail('invalid-argument', `${where}: times must be HH:MM`)
    if (startTime >= endTime) fail('invalid-argument', `${where}: end time must be after start time`)
    const subject = str('subject')
    const facultyName = str('facultyName')
    if (!subject) fail('invalid-argument', `${where}: subject is required`)
    if (!facultyName) fail('invalid-argument', `${where}: faculty is required`)
    return {
      dayOfWeek,
      startTime,
      endTime,
      subject,
      subjectCode: str('subjectCode'),
      facultyId: str('facultyId'),
      facultyName,
      facultyInitials: initials(facultyName),
      room: str('room'),
      batch: str('batch'),
      division: str('division'),
      section: str('section'),
      type: str('type') || 'lecture',
    }
  })
}

async function loadRecord(id: string): Promise<ApprovalRecord | null> {
  const snap = await db().collection(APPROVALS).doc(id).get()
  return snap.exists ? (snap.data() as ApprovalRecord) : null
}

/** Commit writes in chunks under Firestore's 500-operation batch limit. */
async function commitChunks(ops: Array<(b: WriteBatch) => void>) {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = db().batch()
    ops.slice(i, i + 450).forEach(op => op(batch))
    await batch.commit()
  }
}

async function draftQuery(approvalId: string) {
  return db().collection(DRAFTS).where('approvalId', '==', approvalId).get()
}

async function liveQuery(collegeId: string, branch: string, semester: number) {
  const snap = await db().collection(LIVE)
    .where('collegeId', '==', collegeId)
    .where('branch', '==', branch)
    .where('semester', '==', semester)
    .get()
  return snap.docs.filter(d => d.data().isActive !== false)
}

// ─── Operations: drafts ────────────────────────────────────────────────────

export const saveTimetableDraft = onCall(OPTS, async (request) => {
  const uid = request.auth?.uid
  if (!uid) fail('permission-denied', 'Authentication is required')
  const actor = await staffFor(uid, request.auth?.token || {})
  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = requireCollege(actor, raw.collegeId)
  const { branch, semester } = requireScope(raw)
  const slots = cleanSlots(raw.slots)

  const id = timetableApprovalId(collegeId, branch, semester)
  const record = await loadRecord(id)
  const decision = canTimetableAction(record, 'edit', actor)
  if (!decision.ok) fail('failed-precondition', decision.reason)
  await requireVerifiedCurriculum(collegeId, branch, semester)

  const old = await draftQuery(id)
  const now = new Date().toISOString()
  const ops: Array<(b: WriteBatch) => void> = old.docs.map(d => (b: WriteBatch) => b.delete(d.ref))
  for (const slot of slots) {
    const ref = db().collection(DRAFTS).doc()
    ops.push((b: WriteBatch) => b.set(ref, {
      ...slot, collegeId, branch, branchKey: branchKey(branch), semester, approvalId: id, isActive: true, createdAt: now, updatedAt: now,
    }))
  }
  await commitChunks(ops)

  const next: ApprovalRecord = {
    collegeId, branch, semester,
    status: 'draft',
    version: record?.version ?? 0,
    ...(record?.submittedBy ? { submittedBy: record.submittedBy } : {}),
  }
  await db().collection(APPROVALS).doc(id).set({
    branchKey: branchKey(branch), ...next, draftCount: slots.length, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  return { ok: true, approvalId: id, draftCount: slots.length }
})

export const copyLiveToDraft = onCall(OPTS, async (request) => {
  const uid = request.auth?.uid
  if (!uid) fail('permission-denied', 'Authentication is required')
  const actor = await staffFor(uid, request.auth?.token || {})
  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = requireCollege(actor, raw.collegeId)
  const { branch, semester } = requireScope(raw)

  const id = timetableApprovalId(collegeId, branch, semester)
  const record = await loadRecord(id)
  const decision = canTimetableAction(record, 'edit', actor)
  if (!decision.ok) fail('failed-precondition', decision.reason)
  await requireVerifiedCurriculum(collegeId, branch, semester)

  const live = await liveQuery(collegeId, branch, semester)
  if (live.length === 0) fail('not-found', 'There is no live timetable for this branch and semester to copy')
  const old = await draftQuery(id)
  const now = new Date().toISOString()
  const ops: Array<(b: WriteBatch) => void> = old.docs.map(d => (b: WriteBatch) => b.delete(d.ref))
  for (const doc of live) {
    const d = doc.data()
    const ref = db().collection(DRAFTS).doc()
    ops.push((b: WriteBatch) => b.set(ref, {
      ...pickSlotFields(d),
      facultyInitials: d.facultyInitials || initials(String(d.facultyName || '')),
      collegeId, branch, branchKey: branchKey(branch), semester, approvalId: id, isActive: true, createdAt: now, updatedAt: now,
    }))
  }
  await commitChunks(ops)
  await db().collection(APPROVALS).doc(id).set({
    branchKey: branchKey(branch),
    collegeId, branch, semester,
    status: 'draft',
    version: record?.version ?? 0,
    ...(record?.submittedBy ? { submittedBy: record.submittedBy } : {}),
    draftCount: live.length,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  return { ok: true, approvalId: id, draftCount: live.length }
})

export const submitTimetable = onCall(OPTS, async (request) => {
  const uid = request.auth?.uid
  if (!uid) fail('permission-denied', 'Authentication is required')
  const actor = await staffFor(uid, request.auth?.token || {})
  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = requireCollege(actor, raw.collegeId)
  const { branch, semester } = requireScope(raw)

  const id = timetableApprovalId(collegeId, branch, semester)
  const record = await loadRecord(id)
  const decision = canTimetableAction(record, 'submit', actor)
  if (!decision.ok) fail('failed-precondition', decision.reason)
  await requireVerifiedCurriculum(collegeId, branch, semester)

  const drafts = await draftQuery(id)
  if (drafts.empty) fail('failed-precondition', 'Add at least one class before submitting')
  const at = new Date().toISOString()
  await db().collection(APPROVALS).doc(id).set({
    branchKey: branchKey(branch),
    collegeId, branch, semester,
    status: 'submitted',
    version: (record?.version ?? 0) + 1,
    submittedBy: uid,
    submittedAt: at,
    draftCount: drafts.size,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { ok: true, approvalId: id, version: (record?.version ?? 0) + 1 }
})

// ─── Operations: single-slot edits (used by the Class Schedule Manager) ────

/** Faculty name and initials come from the faculty record, never from the client. */
async function resolveFaculty(facultyId: string): Promise<{ name: string; initials: string }> {
  const snap = await db().collection('faculty').doc(facultyId).get()
  if (!snap.exists) fail('invalid-argument', 'Choose a faculty member who exists in this college')
  const f = snap.data() as Record<string, unknown>
  const name = String(f.name || `${f.firstName || ''} ${f.lastName || ''}`).trim() || facultyId
  return { name, initials: initials(name) }
}

function cleanSingleSlot(raw: unknown): Slot & {
  facultyId: string
  branch: string
  semester: number
  effectiveFrom?: string
  effectiveTo?: string
  assignment?: Record<string, unknown> | null
} {
  const s = (raw ?? {}) as Record<string, unknown>
  const str = (k: string) => String(s[k] ?? '').trim()
  const dayOfWeek = str('dayOfWeek').toLowerCase()
  const startTime = str('startTime')
  const endTime = str('endTime')
  const semester = Number(s.semester)
  if (!DAYS.includes(dayOfWeek)) fail('invalid-argument', 'Choose a valid day')
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) fail('invalid-argument', 'Times must be HH:MM')
  if (startTime >= endTime) fail('invalid-argument', 'End time must be after start time')
  if (!str('subject')) fail('invalid-argument', 'Subject is required')
  if (!str('facultyId')) fail('invalid-argument', 'Faculty is required')
  if (!str('branch')) fail('invalid-argument', 'Branch is required')
  if (!Number.isInteger(semester) || semester < 1 || semester > 8) fail('invalid-argument', 'Semester must be 1 to 8')
  const assignment = s.assignment && typeof s.assignment === 'object'
    ? {
        title: String((s.assignment as Record<string, unknown>).title ?? '').slice(0, 200),
        maxScore: Number((s.assignment as Record<string, unknown>).maxScore) || 0,
        deadline: String((s.assignment as Record<string, unknown>).deadline ?? '').slice(0, 40),
      }
    : s.assignment === null ? null : undefined
  return {
    dayOfWeek, startTime, endTime,
    subject: str('subject'),
    subjectCode: str('subjectCode'),
    facultyId: str('facultyId'),
    facultyName: '',
    facultyInitials: '',
    room: str('room'),
    batch: str('batch'),
    division: str('division'),
    section: str('section'),
    type: str('type') || 'lecture',
    branch: str('branch'),
    semester,
    ...(str('effectiveFrom') ? { effectiveFrom: str('effectiveFrom') } : {}),
    ...(str('effectiveTo') ? { effectiveTo: str('effectiveTo') } : {}),
    ...(assignment !== undefined ? { assignment } : {}),
  }
}

async function touchRecord(collegeId: string, branch: string, semester: number, record: ApprovalRecord | null) {
  await db().collection(APPROVALS).doc(timetableApprovalId(collegeId, branch, semester)).set({
    branchKey: branchKey(branch),
    collegeId, branch, semester,
    status: 'draft',
    version: record?.version ?? 0,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
}

/**
 * Replace the draft for one branch and semester with an auto-generated run.
 * Operations only: the same edit rule and curriculum-verification gate as a
 * manual draft save. Full placement documents are kept, not the cleaned slot
 * shape, so approval keeps effective dates and module queues.
 */
export async function replaceDraftFromAutoSchedule(
  actor: ApprovalActor & { collegeId: string; name: string },
  collegeId: string,
  branch: string,
  semester: number,
  docs: Array<Record<string, unknown>>,
): Promise<{ approvalId: string; draftCount: number }> {
  const id = timetableApprovalId(collegeId, branch, semester)
  const record = await loadRecord(id)
  const decision = canTimetableAction(record, 'edit', actor)
  if (!decision.ok) fail('failed-precondition', decision.reason)
  await requireVerifiedCurriculum(collegeId, branch, semester)

  const old = await draftQuery(id)
  const now = new Date().toISOString()
  const ops: Array<(b: WriteBatch) => void> = old.docs.map(d => (b: WriteBatch) => b.delete(d.ref))
  for (const doc of docs) {
    const ref = db().collection(DRAFTS).doc()
    ops.push((b: WriteBatch) => b.set(ref, {
      ...doc, collegeId, branch, branchKey: branchKey(branch), semester, approvalId: id, isActive: true, createdAt: now, updatedAt: now,
    }))
  }
  await commitChunks(ops)

  await db().collection(APPROVALS).doc(id).set({
    branchKey: branchKey(branch),
    collegeId, branch, semester,
    status: 'draft',
    version: record?.version ?? 0,
    ...(record?.submittedBy ? { submittedBy: record.submittedBy } : {}),
    draftCount: docs.length,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  return { approvalId: id, draftCount: docs.length }
}

export const upsertDraftSlot = onCall(OPTS, async (request) => {
  const uid = request.auth?.uid
  if (!uid) fail('permission-denied', 'Authentication is required')
  const actor = await staffFor(uid, request.auth?.token || {})
  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = requireCollege(actor, raw.collegeId)
  const clean = cleanSingleSlot(raw.slot)
  const id = timetableApprovalId(collegeId, clean.branch, clean.semester)
  const record = await loadRecord(id)
  const decision = canTimetableAction(record, 'edit', actor)
  if (!decision.ok) fail('failed-precondition', decision.reason)
  await requireVerifiedCurriculum(collegeId, clean.branch, clean.semester)

  const faculty = await resolveFaculty(clean.facultyId)
  const slotId = String(raw.slotId || '').trim()
  const ref = slotId ? db().collection(DRAFTS).doc(slotId) : db().collection(DRAFTS).doc()
  const now = new Date().toISOString()
  if (slotId) {
    const existing = await ref.get()
    if (!existing.exists || existing.data()?.collegeId !== collegeId) fail('not-found', 'That class is not in this college\'s draft')
    if (existing.data()?.approvalId !== id) {
      fail('failed-precondition', 'A class cannot move to another branch or semester. Delete it and add it there.')
    }
  }
  const fields: Record<string, unknown> = {
    ...pickSlotFields({ ...clean, facultyName: faculty.name, facultyInitials: faculty.initials }),
    collegeId, approvalId: id, branchKey: branchKey(clean.branch), isActive: true, updatedAt: now,
  }
  // An attachment the request does not mention is left alone (merge keeps it).
  await ref.set(slotId ? fields : { ...fields, createdAt: now }, { merge: true })
  await touchRecord(collegeId, clean.branch, clean.semester, record)
  return { ok: true, id: ref.id, approvalId: id }
})

export const deleteDraftSlot = onCall(OPTS, async (request) => {
  const uid = request.auth?.uid
  if (!uid) fail('permission-denied', 'Authentication is required')
  const actor = await staffFor(uid, request.auth?.token || {})
  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = requireCollege(actor, raw.collegeId)
  const slotId = String(raw.slotId || '').trim()
  if (!slotId) fail('invalid-argument', 'slotId is required')
  const ref = db().collection(DRAFTS).doc(slotId)
  const snap = await ref.get()
  if (!snap.exists || snap.data()?.collegeId !== collegeId) fail('not-found', 'That class is not in this college\'s draft')
  const d = snap.data() as Record<string, unknown>
  const id = String(d.approvalId)
  const record = await loadRecord(id)
  const decision = canTimetableAction(record, 'edit', actor)
  if (!decision.ok) fail('failed-precondition', decision.reason)
  await requireVerifiedCurriculum(collegeId, String(d.branch), Number(d.semester))
  await ref.delete()
  await touchRecord(collegeId, String(d.branch), Number(d.semester), record)
  return { ok: true }
})

// ─── HOD / principal: review ───────────────────────────────────────────────

export const reviewTimetable = onCall(OPTS, async (request) => {
  const uid = request.auth?.uid
  if (!uid) fail('permission-denied', 'Authentication is required')
  const actor = await staffFor(uid, request.auth?.token || {})
  const raw = (request.data || {}) as Record<string, unknown>
  const collegeId = requireCollege(actor, raw.collegeId)
  const { branch, semester } = requireScope(raw)
  const decisionKind = String(raw.decision || '')
  if (decisionKind !== 'approve' && decisionKind !== 'return') fail('invalid-argument', 'decision must be approve or return')
  const action = decisionKind as 'approve' | 'return'
  const note = String(raw.note || '').trim().slice(0, 500)
  const fallbackReason = String(raw.fallbackReason || '').trim().slice(0, 300)
  if (action === 'return' && note.length < 3) fail('invalid-argument', 'Give a reason when returning a timetable')

  const id = timetableApprovalId(collegeId, branch, semester)
  const record = await loadRecord(id)
  const check = canTimetableAction(record, action, actor, { fallbackReason })
  if (!check.ok) fail('failed-precondition', check.reason)
  const version = record!.version
  const isFallback = actor.role === 'principal' || actor.role === 'superadmin'
  const reviewFields = {
    reviewedBy: uid,
    reviewedAt: new Date().toISOString(),
    ...(note ? { reviewNote: note } : {}),
    ...(isFallback && fallbackReason ? { fallbackReason } : {}),
  }

  if (action === 'return') {
    await db().collection(APPROVALS).doc(id).set({
    branchKey: branchKey(branch),
      ...record, status: 'returned', ...reviewFields,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    return { ok: true, status: 'returned' }
  }

  // Approve: write the new live slots first (ids are deterministic, so a retry
  // is safe), then deactivate the older live slots, then mark the record approved.
  const drafts = await draftQuery(id)
  if (drafts.empty) fail('failed-precondition', 'The draft has no classes to approve')
  const prefix = `${id}__v${version}__`
  const now = new Date().toISOString()
  const ops: Array<(b: WriteBatch) => void> = []
  drafts.docs.forEach((d, i) => {
    const s = d.data() as DocumentData
    const ref = db().collection(LIVE).doc(`${prefix}${i}`)
    ops.push((b: WriteBatch) => b.set(ref, {
      ...pickSlotFields(s),
      collegeId, branch, semester, type: s.type || 'lecture', isActive: true,
      approvalId: id, approvalVersion: version,
      createdAt: now, updatedAt: now,
    }))
  })
  await commitChunks(ops)

  const live = await liveQuery(collegeId, branch, semester)
  const retire = live.filter(d => !d.id.startsWith(prefix))
  await commitChunks(retire.map(d => (b: WriteBatch) => b.update(d.ref, { isActive: false, supersededBy: id, updatedAt: now })))

  await db().collection(APPROVALS).doc(id).set({
    branchKey: branchKey(branch),
    ...record, status: 'approved', ...reviewFields,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { ok: true, status: 'approved', liveCount: drafts.size, retired: retire.length }
})

// ─── Principal / superadmin: one-time legacy cut-over ─────────────────────

export const markLegacyTimetablesApproved = onCall(OPTS, async (request) => {
  const uid = request.auth?.uid
  if (!uid) fail('permission-denied', 'Authentication is required')
  const actor = await staffFor(uid, request.auth?.token || {})
  if (actor.role !== 'principal' && actor.role !== 'superadmin') fail('permission-denied', 'Only the principal can run this cut-over')
  const collegeId = requireCollege(actor, (request.data as Record<string, unknown> | undefined)?.collegeId)

  const snap = await db().collection(LIVE).where('collegeId', '==', collegeId).get()
  const groups = new Map<string, { branch: string; semester: number }>()
  for (const doc of snap.docs) {
    const d = doc.data()
    if (d.isActive === false) continue
    const branch = String(d.branch || '').trim()
    const semester = Number(d.semester)
    if (!branch || !Number.isInteger(semester)) continue
    groups.set(timetableApprovalId(collegeId, branch, semester), { branch, semester })
  }

  const at = new Date().toISOString()
  let marked = 0
  let skipped = 0
  const ops: Array<(b: WriteBatch) => void> = []
  for (const [id, g] of groups) {
    const existing = await loadRecord(id)
    if (existing) { skipped++; continue }
    marked++
    const ref = db().collection(APPROVALS).doc(id)
    ops.push((b: WriteBatch) => b.set(ref, {
      collegeId, branch: g.branch, branchKey: branchKey(g.branch), semester: g.semester,
      status: 'approved', version: 1, legacyCutover: true, reviewedBy: uid, reviewedAt: at,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }))
  }
  await commitChunks(ops)
  return { ok: true, marked, skipped }
})
