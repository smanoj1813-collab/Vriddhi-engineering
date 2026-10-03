import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/classSchedule.ts
// ─── Slice 2 "Delivery Spine" — S2.1: session materialisation ───────────────
//
// The audit (docs/curriculum-scheduling-audit.md, finding F1) found that the
// recurring timetable in `weeklySchedules` is decorative grid data: nothing
// ever expands it into the actual class instances that attendance, coverage
// and progress need. A `classSessions` document only ever came into existence
// when a human typed one in — and because two different client writers
// (scheduleApi.createSchedule and attendanceApi.createClassSession) each
// invented their own payload, the collection already has schema drift.
//
// This module is the single server-side writer that turns the plan
// (weeklySchedules) into the actual (classSessions):
//
//   generateClassSessions({ from, to })  — expand active slots into sessions
//   cancelWeeklySchedule({ ... })        — cancel a slot's future sessions
//
// Design rules that came out of the audit:
//  * Tenancy comes from the auth custom claim (`token.collegeId`), never from
//    the `vriddhi_college_id` localStorage value the legacy client code reads
//    at src/modules/admin/api/scheduleApi.ts:47. Rules still do the real
//    college-scoping, but a callable must not take the tenant from the caller.
//  * Materialisation is idempotent. The document id is deterministic —
//    `${weeklyScheduleId}_${yyyy-mm-dd}` — so re-running the same range adds
//    zero duplicates (audit DoD #1). Existing ids are probed with getAll and
//    skipped before the batch is built, so `set` is last-write-wins rather
//    than `create`-and-abort-the-whole-batch.
//  * Every session carries `weeklyScheduleId`, so the plan→actual link is a
//    real field and not a coincidence of matching free-text strings (F6).
//  * Writes are chunked under Firestore's 500-op batch ceiling.
//
// The pure helpers (date maths, expansion, id building) are exported so they
// can be unit-tested without a Firestore emulator — see functions/test/
// classSchedule.test.ts.

import * as admin from 'firebase-admin'
import * as logger from 'firebase-functions/logger'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  conflictErrorCode,
  describeConflict,
  findSessionClashes,
  hardClashes,
  type SessionCandidate,
  type SessionConflict,
} from './utils/timetableConflicts'
import { normalizeRole, pickCollegeId } from './identityShared'

// ─── Constants ─────────────────────────────────────────────────────────────

/** Longest span one generate call may cover. ~13 weeks — one teaching term. */
export const MAX_GENERATE_RANGE_DAYS = 92

/**
 * Firestore caps a WriteBatch at 500 operations. Each session is one `set`,
 * plus one `updatedAt`-style bookkeeping write per chunk, so we stay well
 * under the ceiling.
 */
export const MAX_BATCH_OPS = 400

/**
 * A transaction counts reads *and* writes against the same 500-op ceiling, so
 * a cancel chunk is one read + one write per session plus the slot itself.
 */
export const MAX_CANCEL_DOCS_PER_TXN = 180

/** Hard ceiling on weekly slots read for one college, to bound the callable. */
export const MAX_WEEKLY_SLOTS_READ = 2000

/** Hard ceiling on academic-calendar events read for holiday suppression (P4). */
export const MAX_CALENDAR_EVENTS_READ = 200

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Roles allowed to materialise / cancel sessions for their college. */
export const SCHEDULING_ROLES = ['superadmin', 'admin', 'principal', 'hod']

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

/** `Date.getUTCDay()` is 0=Sunday..6=Saturday. */
export const DAY_OF_WEEK_INDEX: Record<DayOfWeek, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const DAY_NAMES: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

export const SESSION_STATUSES = ['scheduled', 'ongoing', 'completed', 'cancelled'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

// ─── Pure helpers ──────────────────────────────────────────────────────────

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const parsed = new Date(Date.UTC(year, month - 1, day))
  // Rejects overflow such as 2026-02-31, which Date silently rolls forward.
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

function assertDateKey(value: unknown, field: string): string {
  if (!isValidDateKey(value)) {
    throw new Error(`${field} must be a yyyy-mm-dd date (received: ${String(value)})`)
  }
  return value
}

/** UTC midnight for a date key. All date maths here is UTC so the callable
 *  produces the same answer regardless of where the function instance runs. */
export function parseDateKey(key: string): Date {
  const [year, month, day] = assertDateKey(key, 'date').split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function toDateKey(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Today's date key. Exists as a helper so tests can pin "today". */
export function todayKey(now: Date = new Date()): string {
  return toDateKey(now)
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key)
  date.setUTCDate(date.getUTCDate() + days)
  return toDateKey(date)
}

export function weekdayOf(key: string): DayOfWeek {
  return DAY_NAMES[parseDateKey(key).getUTCDay()]
}

/** Inclusive count of days between two date keys. */
export function daysBetween(from: string, to: string): number {
  const start = parseDateKey(from).getTime()
  const end = parseDateKey(to).getTime()
  return Math.round((end - start) / 86_400_000)
}

export function normalizeDayOfWeek(value: unknown): DayOfWeek | null {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase() as DayOfWeek
  return key in DAY_OF_WEEK_INDEX ? key : null
}

/** Free-text day strings also show up as "Mon", "MONDAY", 1..7 etc. */
export function coerceDayOfWeek(value: unknown): DayOfWeek | null {
  const direct = normalizeDayOfWeek(value)
  if (direct) return direct
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    // Guard on length: every string startsWith(''), so an empty day would
    // otherwise match "sunday" first.
    const byPrefix = text.length > 0 ? DAY_NAMES.find((name) => name.startsWith(text.slice(0, 3))) : undefined
    if (byPrefix) return byPrefix
    // A single digit 0..6 is also accepted (0 = Sunday). Only an explicitly
    // numeric *string* takes this path: Number(null) is 0, and silently
    // reading a missing dayOfWeek as "every Sunday" would be a nasty surprise.
    if (/^[0-6]$/.test(text)) return DAY_NAMES[Number(text)]
    return null
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6) {
    return DAY_NAMES[value]
  }
  return null
}

/**
 * Every `yyyy-mm-dd` date key in [from, to], inclusive and ascending.
 * Enforces the 92-day guard (one teaching term) so a typo cannot ask the
 * function to fan out across years.
 */
export function dateKeysInRange(from: string, to: string): string[] {
  const start = assertDateKey(from, 'from')
  const end = assertDateKey(to, 'to')
  const span = daysBetween(start, end)
  if (span < 0) throw new Error('from must be on or before to')
  if (span + 1 > MAX_GENERATE_RANGE_DAYS) {
    throw new Error(`Range spans ${span + 1} days; the maximum is ${MAX_GENERATE_RANGE_DAYS}`)
  }
  const keys: string[] = []
  for (let offset = 0; offset <= span; offset += 1) keys.push(addDays(start, offset))
  return keys
}

/**
 * The date keys in [from, to] that fall on `dayOfWeek`.
 *
 * Unknown / junk day values yield an empty list rather than throwing: the
 * `dayOfWeek` comes from a free-form Firestore field and one malformed slot
 * must not abort materialisation for the whole college.
 */
export function expandWeeklyRange(from: string, to: string, dayOfWeek: unknown): string[] {
  if (!isValidDateKey(from) || !isValidDateKey(to)) {
    throw new Error('expandWeeklyRange requires yyyy-mm-dd from/to bounds')
  }
  const day = coerceDayOfWeek(dayOfWeek)
  if (!day) return []
  return dateKeysInRange(from, to).filter((key) => weekdayOf(key) === day)
}

/**
 * Deterministic document id for one occurrence of one recurring slot.
 * This is what makes materialisation idempotent: the same slot on the same
 * date always names the same document, so a second run is a no-op.
 */
export function slotDateKey(weeklyScheduleId: string, date: string): string {
  const slot = String(weeklyScheduleId || '').trim()
  if (!slot) throw new Error('weeklyScheduleId is required to build a session id')
  if (slot.includes('/')) throw new Error('weeklyScheduleId may not contain "/"')
  return `${slot}_${assertDateKey(date, 'date')}`
}

/** "09:00" → 540. Returns null for anything unparseable. */
export function minutesOfDay(text: unknown): number | null {
  if (typeof text !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Scheduled contact minutes for a slot, or null if the times are unusable. */
export function durationMinutes(startTime: unknown, endTime: unknown): number | null {
  const start = minutesOfDay(startTime)
  const end = minutesOfDay(endTime)
  if (start === null || end === null || end <= start) return null
  return end - start
}

// ─── Session document shape ─────────────────────────────────────────────────

export interface WeeklySlot {
  id: string
  collegeId?: unknown
  subject?: unknown
  subjectCode?: unknown
  facultyId?: unknown
  facultyName?: unknown
  facultyInitials?: unknown
  branch?: unknown
  batch?: unknown
  semester?: unknown
  division?: unknown
  section?: unknown
  room?: unknown
  dayOfWeek?: unknown
  startTime?: unknown
  endTime?: unknown
  type?: unknown
  isActive?: unknown
  // P1 (Auto-Scheduler v2): applicability window. `yyyy-mm-dd` keys — the
  // timetable this slot belongs to is live from effectiveFrom through
  // effectiveTo. LEGACY DOCS WITHOUT THESE FIELDS ARE ALWAYS ACTIVE
  // (byte-identical back-compat; no migration). Typed `unknown` like every
  // untrusted Firestore field here — `slotDateWindow` validates on read.
  effectiveFrom?: unknown
  effectiveTo?: unknown
  // P2 (Auto-Scheduler v2): ordered module ids copied from the curriculum
  // course at auto-schedule time, so the session-topics UI can auto-suggest
  // "next module" per session (full auto-advancing topic assignment = v3).
  moduleQueue?: unknown
  // Optional "Attach an assignment" config written by the admin's weekly
  // form: { title, maxScore, deadline }. `generateClassSessions` materialises
  // exactly one draft assignment per configured slot (see below).
  assignment?: unknown
  /** Set once the slot's assignment has been materialised — the doc id. */
  assignmentId?: unknown
}

function text(value: unknown, fallback = ''): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || fallback
}

function toSemester(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

/**
 * The canonical session document (audit S2.2). Every field the two legacy
 * client writers produced survives here, so existing readers keep working:
 *  * `date` is the normalised `yyyy-mm-dd` string (scheduleApi wrote ISO
 *    datetimes, attendanceApi wrote whatever the caller passed).
 *  * `topicsCovered` stays as the free-text display list the UI reads at
 *    scheduleApi.ts:84 (`d.topicsCovered || d.topicsPlanned`); S2.3 adds the
 *    real `topicIds` references alongside it.
 *  * `createdAt`/`updatedAt` are ISO strings, matching the shape the majority
 *    of client writers already use (attendanceApi's Timestamp is the outlier,
 *    and S2.2 folds that path into this one).
 */
export function buildSessionDoc(
  slot: WeeklySlot,
  date: string,
  now: Date = new Date(),
  assignmentId?: string
): admin.firestore.DocumentData {
  const day = coerceDayOfWeek(slot.dayOfWeek)
  const start = text(slot.startTime)
  const end = text(slot.endTime)
  const stamp = now.toISOString()
  return {
    collegeId: text(slot.collegeId),
    weeklyScheduleId: slot.id,
    date: assertDateKey(date, 'date'),
    dayOfWeek: day || weekdayOf(date),
    startTime: start,
    endTime: end,
    durationMinutes: durationMinutes(start, end) ?? 60,
    subject: text(slot.subject),
    subjectCode: text(slot.subjectCode),
    facultyId: text(slot.facultyId),
    facultyName: text(slot.facultyName),
    facultyInitials: text(slot.facultyInitials),
    branch: text(slot.branch),
    batch: text(slot.batch),
    semester: toSemester(slot.semester),
    division: text(slot.division),
    section: text(slot.section),
    room: text(slot.room),
    type: text(slot.type, 'lecture'),
    status: 'scheduled' as SessionStatus,
    // S2.3 fills these from the topic picker; the free-text list below stays
    // as the legacy display fallback.
    topicIds: [],
    topicsCovered: [],
    attendanceCount: 0,
    presentCount: 0,
    source: 'weekly-schedule',
    // Set when the slot carries an attached assignment (admin "Attach an
    // assignment" toggle), so a session can be traced to its work item.
    ...(assignmentId ? { assignmentId } : {}),
    createdAt: stamp,
    updatedAt: stamp,
  }
}

// ─── Optional weekly slot → assignment linkage ──────────────────────────────
//
// The admin's weekly form can attach an assignment config (title, max score,
// deadline) to a slot. `generateClassSessions` then materialises exactly ONE
// draft assignment per configured slot under a deterministic id, links it
// back through `scheduleId`, and records `assignmentId` on the slot so reruns
// (and the timetable UI) can trace it. The draft is left for the slot's
// faculty to review and publish — publishing is what fans out the student
// bell notification with the deadline and course context.

/** Deterministic assignment doc id for a slot's attached assignment. */
export function scheduleAssignmentDocId(weeklyScheduleId: string): string {
  const id = String(weeklyScheduleId || '').trim()
  if (!id) throw new Error('weeklyScheduleId is required to build an assignment id')
  if (id.includes('/')) throw new Error('weeklyScheduleId may not contain "/"')
  return `sched-assign-${id}`
}

export interface SlotAssignmentConfig {
  title: string
  maxScore: number
  deadline: Date
}

/** Accepts Timestamps, Date objects, ISO strings and yyyy-mm-dd keys. */
export function parseSlotDeadline(value: unknown): Date | null {
  if (value instanceof admin.firestore.Timestamp) return value.toDate()
  if (value instanceof Date) return value
  const raw = String(value ?? '').trim()
  if (!raw) return null
  // A bare date means "end of that day" in the college timezone, matching
  // how assignment deadlines are interpreted for students (studentPortal).
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59+05:30` : raw
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Reads and validates the optional `assignment` config on a weekly slot.
 * Returns null when the slot has no usable config — one malformed admin edit
 * must never abort materialisation for the whole college.
 */
export function parseSlotAssignmentConfig(slot: WeeklySlot): SlotAssignmentConfig | null {
  const raw = (slot as unknown as Record<string, unknown>).assignment
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const config = raw as Record<string, unknown>
  const title = String(config.title ?? '').trim()
  if (title.length < 3 || title.length > 200) return null
  const maxScore = Number(config.maxScore)
  if (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 10_000) return null
  const deadline = parseSlotDeadline(config.deadline)
  if (!deadline) return null
  return { title, maxScore, deadline }
}

/**
 * The canonical draft assignment for a configured slot. Cohort targeting
 * comes from the slot's own branch/batch/division/semester, so the work item
 * reaches exactly the students the class is timetabled for.
 */
export function buildScheduleAssignmentDoc(
  slot: WeeklySlot,
  config: SlotAssignmentConfig,
  facultyUid: string,
  now: Date = new Date()
): admin.firestore.DocumentData {
  const branch = text(slot.branch)
  const batch = text(slot.batch)
  const division = text(slot.division)
  const semester = toSemester(slot.semester)
  const cohort: Record<string, unknown> = {
    ...(branch ? { branch } : {}),
    ...(batch ? { batch } : {}),
    ...(division ? { division } : {}),
    ...(semester ? { semester } : {}),
  }
  const stamp = now.toISOString()
  return {
    title: config.title,
    description:
      `Auto-created from the weekly class schedule: ${text(slot.subject) || 'class'} on ` +
      `${text(slot.dayOfWeek)} ${text(slot.startTime)}–${text(slot.endTime)}` +
      `${text(slot.room) ? ` (room ${text(slot.room)})` : ''}. ` +
      `Review and publish it to notify the students with the deadline.`,
    subject: text(slot.subject),
    subjectCode: text(slot.subjectCode),
    maxScore: config.maxScore,
    type: 'assignment',
    targetType: 'cohort',
    cohort,
    deadline: admin.firestore.Timestamp.fromDate(config.deadline),
    allowResubmission: false,
    scheduleId: slot.id,
    collegeId: text(slot.collegeId),
    facultyUid,
    facultyName: text(slot.facultyName),
    status: 'draft',
    source: 'weekly-schedule',
    submissionCount: 0,
    createdAt: stamp,
    updatedAt: stamp,
  }
}

/**
 * Assignments are keyed by the faculty's Auth UID (`facultyUid`), while
 * weekly slots usually store the faculty PROFILE document id (see
 * fetchFacultyWeeklySchedule's fallback). Resolve the uid through the
 * profile when possible; fall back to whatever the slot stores.
 */
async function resolveSlotFacultyAuthUid(slot: WeeklySlot): Promise<string> {
  const profileId = text(slot.facultyId)
  if (!profileId) return ''
  try {
    const doc = await getFirestore(admin.app(), 'default').collection('faculty').doc(profileId).get()
    const uid = String(doc.data()?.uid || '').trim()
    if (uid) return uid
  } catch (error) {
    logger.warn('[classSchedule] Could not resolve faculty uid for assignment linkage', {
      facultyId: profileId,
      error,
    })
  }
  return profileId
}

// ─── S2.2: canonical session identity ───────────────────────────────────────
//
// Finding F2: two client writers produced two different `classSessions`
// payloads — scheduleApi.createSchedule wrote an ISO datetime `date` plus
// `topicsCovered` and counters, attendanceApi.createClassSession wrote a
// Timestamp-bearing `ClassSession`, and attendance for a *recurring* slot was
// keyed on the weeklySchedules id, so no classSessions document existed at all
// for the class being marked. Three shapes, one collection.
//
// The fix is an identity rule both writers can agree on:
//
//   * A session generated from a recurring slot is named
//     `${weeklyScheduleId}_${yyyy-mm-dd}` — already the case since S2.1.
//   * A session with no recurring parent is named deterministically from what
//     defines it (faculty + date + start time + subject + cohort), so the same
//     ad-hoc class marked twice still resolves to one document.
//
// `ensureClassSession` is then the single writer: it gets-or-creates under that
// id, so attendance marks the session that exists instead of creating a
// parallel one (audit DoD #3).

/** Roles that may only ensure sessions for themselves. */
export const SELF_SERVICE_ROLES = ['faculty', 'mentor']

/** Everything that is allowed to call ensureClassSession. */
export const SESSION_WRITE_ROLES = [...SCHEDULING_ROLES, ...SELF_SERVICE_ROLES]

/** Reduce free text to a document-id-safe slug. */
export function slugify(value: unknown, maximum = 40): string {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maximum)
  return slug
}

/**
 * FNV-1a — small, deterministic, dependency-free. Only used to keep ad-hoc
 * session ids unique when two classes share every visible field; it is not
 * security-sensitive.
 */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export interface AdhocSessionParts {
  facultyId: unknown
  date: unknown
  startTime: unknown
  subject: unknown
  subjectCode: unknown
  branch: unknown
  batch: unknown
  division: unknown
}

/**
 * Deterministic id for a session with no recurring parent.
 *
 * Visible fields make the id readable in the console; the hash of the same
 * fields keeps it unique. Two different ad-hoc classes therefore never collide,
 * and the same class marked twice always resolves to one document.
 */
export function adhocSessionId(parts: AdhocSessionParts): string {
  const faculty = slugify(parts.facultyId)
  if (!faculty) throw new Error('facultyId is required to build an ad-hoc session id')
  const date = assertDateKey(parts.date, 'date')
  const start = slugify(parts.startTime, 10) || 'na'
  const subject = slugify(parts.subjectCode || parts.subject, 20) || 'class'
  const signature = [
    faculty,
    date,
    start,
    subject,
    slugify(parts.branch, 12),
    slugify(parts.batch, 12),
    slugify(parts.division, 12),
  ].join('|')
  return `adhoc_${faculty}_${date}_${start}_${subject}_${shortHash(signature)}`
}

/**
 * The id a session *should* have, which is how "is there already a session for
 * this day and slot?" gets answered without a query.
 */
export function ensureSessionId(parts: AdhocSessionParts & { weeklyScheduleId?: unknown }): string {
  const weekly = String(parts.weeklyScheduleId ?? '').trim()
  if (weekly) return slotDateKey(weekly, String(parts.date))
  return adhocSessionId(parts)
}

/**
 * Older rows store `date` in three different shapes — a `yyyy-mm-dd` string
 * (scheduleApi), an ISO datetime (some bulk imports) and a Firestore Timestamp
 * (attendanceApi's session writer). Everything downstream sorts and filters on
 * the string form, so normalise once, here.
 *
 * Returns '' when nothing usable is present rather than guessing a date.
 */
export function normalizeSessionDate(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    // Already the canonical form, or an ISO datetime whose date part is it.
    const head = trimmed.slice(0, 10)
    return isValidDateKey(head) ? head : ''
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toDateKey(value)
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof candidate.toDate === 'function') {
      const date = candidate.toDate()
      return date instanceof Date && !Number.isNaN(date.getTime()) ? toDateKey(date) : ''
    }
    const seconds = Number(candidate.seconds ?? candidate._seconds)
    if (Number.isFinite(seconds) && seconds > 0) return toDateKey(new Date(seconds * 1000))
  }
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return toDateKey(new Date(numeric))
  return ''
}

/**
 * Normalised join key for the free-text subject strings that tie this domain
 * together (audit F6). Not a migration — S2.2 just stamps it on new writes so
 * later slices have something stable to group by.
 */
export function subjectKey(subject?: unknown, subjectCode?: unknown): string {
  const code = slugify(subjectCode, 30)
  if (code) return code
  return slugify(subject, 30)
}

// ─── Staff resolution ───────────────────────────────────────────────────────

interface SchedulingStaff {
  uid: string
  role: string
  collegeId: string
  name: string
  /**
   * Every id this person is known by — the auth uid, the `faculty`/`hods`/
   * `mentors` profile document id, and the `facultyId` field on that profile.
   *
   * WHY THIS EXISTS: the timetable, the curriculum mappings and therefore every
   * class session they generate key a teacher by their FACULTY PROFILE DOCUMENT
   * ID, while ownership and the auth claim are the Firebase Auth UID. Those two
   * are different strings for most teachers (see the alias resolution in
   * src/modules/admin/api/curriculumMappingApi.ts:resolveFacultyAliases and the
   * two-step lookup in scheduleApi.fetchFacultyWeeklySchedule, both of which
   * exist precisely because they disagree). Comparing the two with `===` refused
   * a teacher their own class: ensureClassSession answered "You can only manage
   * your own class sessions" and completeClassSession answered "You can only
   * complete your own class sessions" for a class they were teaching — and the
   * client rendered both as "Only college administrators can…".
   */
  ids: string[]
}

/**
 * Staff profile collections, in the same resolution order the client uses
 * (src/modules/auth/context/auth.ts). `students` is deliberately absent:
 * membership here must prove TEACHING staff. `superadmins` is absent too — the
 * superadmin identity comes from the claim or the canonical users document,
 * never from a client-writable profile.
 */
const STAFF_PROFILE_COLLECTIONS = ['faculty', 'hods', 'mentors'] as const

/** Role implied by membership of a staff profile collection. */
const STAFF_PROFILE_ROLE: Record<string, string> = {
  faculty: 'faculty',
  hods: 'hod',
  mentors: 'mentor',
}

/** What a legacy (pre-`users/{uid}`) staff profile contributes to an identity. */
export interface LegacyStaffProfile {
  role: string
  collegeId: string
  name: string
  email: string
  /** Profile document id + its `facultyId` field, besides the caller's uid. */
  ids: string[]
}

function cleanText(value: unknown, maximum = 200): string {
  return String(value ?? '').trim().slice(0, maximum)
}

/**
 * Fold the id spellings a person may be filed under into one list, always
 * starting with the auth uid. Order is stable and duplicates are dropped, so
 * the result can be compared with `.includes()` and asserted in tests.
 */
export function mergeIdentityIds(...groups: Array<unknown>): string[] {
  const out: string[] = []
  for (const group of groups) {
    for (const raw of Array.isArray(group) ? group : [group]) {
      const value = cleanText(raw)
      if (value && !out.includes(value)) out.push(value)
    }
  }
  return out
}

/**
 * Pure part of the identity chain: given the token claims, the `users/{uid}`
 * document (when there is one) and an optional legacy staff profile, decide the
 * caller's role, college and name.
 *
 * The role is normalised (`normalizeRole`) rather than string-compared, because
 * a claim or a users document that says "Teacher", "Head of Department" or
 * "HOD " describes exactly the same person as "faculty"/"hod" and used to fail
 * every role check in this module. The college reads every spelling the client
 * tolerates (`collegeId` / `collegeID` / `college_id`) for the same reason.
 */
export function staffIdentityFromDocs(input: {
  uid: string
  token: Record<string, unknown>
  user?: Record<string, unknown> | null
  profile?: LegacyStaffProfile | null
}): { role: string; collegeId: string; name: string } {
  const user = input.user || {}
  const profile = input.profile || null
  const role =
    normalizeRole(input.token.role) ||
    normalizeRole(user.role) ||
    normalizeRole(profile?.role) ||
    ''
  const collegeId =
    cleanText(input.token.collegeId) ||
    pickCollegeId(user) ||
    profile?.collegeId ||
    ''
  const name =
    cleanText(user.name || user.displayName) ||
    `${cleanText(user.firstName)} ${cleanText(user.lastName)}`.trim() ||
    profile?.name ||
    ''
  return { role, collegeId, name }
}

/**
 * Whether the staff profile collections still have to be consulted for this
 * caller: a missing `users/{uid}` document, a role that is not on the token or
 * the document, or no college on either. Split out so the decision is testable
 * without Firestore — the resolvers use exactly this predicate.
 */
export function needsStaffProfileLookup(input: {
  token: Record<string, unknown>
  userExists: boolean
}): boolean {
  if (!input.userExists) return true
  const { role, collegeId } = staffIdentityFromDocs({ uid: '', token: input.token })
  return !role || (role !== 'superadmin' && !collegeId)
}

/**
 * Legacy-account fallback: find the staff profile that describes this uid, so
 * an account provisioned before the `users/{uid}` convention is still
 * recognised. Mirrors resolveLegacyPaperStaff in paperWorkflow.ts: anchor on the
 * document id first, then the `uid`/`userId` fields, then the token email; the
 * role comes from COLLECTION MEMBERSHIP only (a client-writable `role` field
 * must never be able to grant itself a privilege).
 */
async function resolveLegacyStaffProfile(uid: string, email: string): Promise<LegacyStaffProfile | null> {
  const db = getFirestore(admin.app(), 'default')
  const anchors: Array<{ field: string; value: string }> = [
    { field: 'uid', value: uid },
    { field: 'userId', value: uid },
  ]
  if (email) anchors.push({ field: 'email', value: email.toLowerCase() })

  for (const collectionName of STAFF_PROFILE_COLLECTIONS) {
    let data: Record<string, unknown> | null = null
    let docId = ''
    try {
      const byId = await db.collection(collectionName).doc(uid).get()
      if (byId.exists) {
        data = (byId.data() || {}) as Record<string, unknown>
        docId = byId.id
      }
    } catch (err) {
      logger.warn('[classSchedule] staff profile doc-id lookup failed', {
        collection: collectionName,
        error: (err as Error)?.message,
      })
    }

    if (!data) {
      for (const { field, value } of anchors) {
        try {
          const snap = await db.collection(collectionName).where(field, '==', value).limit(1).get()
          if (!snap.empty) {
            data = snap.docs[0].data() as Record<string, unknown>
            docId = snap.docs[0].id
            break
          }
        } catch (err) {
          logger.warn('[classSchedule] staff profile lookup failed', {
            collection: collectionName,
            field,
            error: (err as Error)?.message,
          })
        }
      }
    }

    if (data) {
      return {
        role: STAFF_PROFILE_ROLE[collectionName] || '',
        collegeId: pickCollegeId(data) || '',
        name: cleanText(
          data.name || data.displayName || `${cleanText(data.firstName)} ${cleanText(data.lastName)}`.trim()
        ),
        email: cleanText(data.email).toLowerCase(),
        ids: mergeIdentityIds(uid, docId, data.facultyId, data.userId),
      }
    }
  }
  return null
}

/**
 * Every id the caller may be referenced by in a class session, a weekly slot or
 * a curriculum mapping. The auth uid is always first; the profile ids are
 * added lazily by the resolvers below only when a raw comparison fails, so the
 * common (already-matching) case costs nothing.
 */
async function loadFacultyAliases(uid: string): Promise<string[]> {
  const ids = mergeIdentityIds(uid)
  const db = getFirestore(admin.app(), 'default')
  await Promise.all(
    STAFF_PROFILE_COLLECTIONS.map(async (collectionName) => {
      try {
        const byId = await db.collection(collectionName).doc(uid).get()
        if (byId.exists) {
          const data = (byId.data() || {}) as Record<string, unknown>
          ids.push(...mergeIdentityIds(byId.id, data.facultyId, data.userId).filter((id) => id !== uid))
          return
        }
        const snap = await db.collection(collectionName).where('uid', '==', uid).limit(1).get()
        if (!snap.empty) {
          const data = snap.docs[0].data() as Record<string, unknown>
          ids.push(...mergeIdentityIds(snap.docs[0].id, data.facultyId).filter((id) => id !== uid))
        }
      } catch (err) {
        logger.warn('[classSchedule] faculty alias lookup failed', {
          collection: collectionName,
          error: (err as Error)?.message,
        })
      }
    })
  )
  return mergeIdentityIds(uid, ids)
}

/** True when `facultyId` is one of the ids the caller is known by. */
export function callerOwnsFacultyId(staff: { uid: string; ids: string[] }, facultyId: unknown): boolean {
  const target = cleanText(facultyId)
  if (!target) return false
  return target === staff.uid || staff.ids.includes(target)
}

/**
 * The college a class session belongs to, or '' when nothing on it says.
 *
 * `collegeId` is stamped on every session written by this module and by
 * facultyApi.saveAttendance, but documents created by the pre-S2.2 browser
 * writers do not carry it, and a strict `session.collegeId !== staff.collegeId`
 * check refused those forever. The recurring parent is authoritative about
 * tenancy, so it is consulted before giving up.
 */
async function resolveSessionCollege(
  session: Record<string, unknown>,
  callerCollegeId: string
): Promise<string> {
  const own = pickCollegeId(session)
  if (own) return own
  const weeklyScheduleId = cleanText(session.weeklyScheduleId)
  if (!weeklyScheduleId) return ''
  try {
    const slotSnap = await getFirestore(admin.app(), 'default').collection('weeklySchedules').doc(weeklyScheduleId).get()
    return pickCollegeId(slotSnap.data() || null) || ''
  } catch (err) {
    logger.warn('[classSchedule] parent slot college lookup failed', {
      weeklyScheduleId,
      collegeId: callerCollegeId,
      error: (err as Error)?.message,
    })
    return ''
  }
}

/**
 * Same check as `callerOwnsFacultyId`, but resolves the profile aliases on
 * first miss — the raw comparison is the fast path, the extra reads only
 * happen for a teacher whose timetable is keyed on their profile id.
 */
async function callerOwnsFaculty(
  staff: SchedulingStaff,
  facultyId: unknown,
  cache?: { loaded: boolean; ids: string[] }
): Promise<boolean> {
  if (callerOwnsFacultyId(staff, facultyId)) return true
  if (cache && cache.loaded) return callerOwnsFacultyId({ uid: staff.uid, ids: cache.ids }, facultyId)
  const ids = await loadFacultyAliases(staff.uid)
  if (cache) {
    cache.ids = ids
    cache.loaded = true
  }
  staff.ids = mergeIdentityIds(staff.ids, ids)
  return callerOwnsFacultyId(staff, facultyId)
}

/**
 * One identity chain for every callable in this module. `allowedRoles` is the
 * only thing that differs between the scheduling-only pair and the
 * session-writer pair, so the two cannot drift apart again.
 */
async function resolveStaff(
  uid: string,
  token: Record<string, unknown>,
  allowedRoles: string[],
  deniedMessage: string
): Promise<SchedulingStaff> {
  const db = getFirestore(admin.app(), 'default')
  const userSnap = await db.collection('users').doc(uid).get()
  const user = (userSnap.exists ? userSnap.data() : null) as Record<string, unknown> | null

  let profile: LegacyStaffProfile | null = null
  if (needsStaffProfileLookup({ token, userExists: userSnap.exists })) {
    profile = await resolveLegacyStaffProfile(uid, cleanText(token.email).toLowerCase())
  }

  const { role, collegeId, name } = staffIdentityFromDocs({ uid, token, user, profile })
  if (!role || !allowedRoles.includes(role) || (role !== 'superadmin' && !collegeId)) {
    logger.warn('[classSchedule] identity refused', {
      uid,
      role: role || 'none',
      hasCollege: Boolean(collegeId),
      hasUserDoc: userSnap.exists,
      usedProfile: Boolean(profile),
      allowedRoles,
    })
    throw new HttpsError('permission-denied', deniedMessage)
  }

  return {
    uid,
    role,
    collegeId,
    name,
    ids: mergeIdentityIds(uid, profile?.ids),
  }
}

/**
 * Scheduling administration (generate / cancel). The role comes from the auth
 * claim with the users document as fallback and the college is resolved
 * server-side; a superadmin may target a college explicitly, everybody else is
 * pinned to the college on their own claim.
 */
export async function resolveSchedulingStaff(
  uid: string,
  token: Record<string, unknown>
): Promise<SchedulingStaff> {
  return resolveStaff(uid, token, SCHEDULING_ROLES, 'Scheduling administration access is required')
}

/**
 * Same check as resolveSchedulingStaff, but also lets faculty and mentors
 * through — they are the ones standing in front of a class. A self-service
 * caller is pinned to their own identity by ensureClassSession and
 * completeClassSession, so a faculty member can materialise and complete their
 * own lesson but not somebody else's.
 */
export async function resolveSessionWriter(
  uid: string,
  token: Record<string, unknown>
): Promise<SchedulingStaff> {
  const staff = await resolveStaff(uid, token, SESSION_WRITE_ROLES, 'Teaching staff access is required')
  // Even a superadmin needs a college to file a session under; unlike the
  // admin-only callables there is nothing meaningful to do without one.
  if (!staff.collegeId) {
    throw new HttpsError('permission-denied', 'No college is associated with this account')
  }
  return staff
}

/**
 * The `facultyId` values a class session's teacher may have ledger rows under.
 *
 * A session carries the timetable's faculty id (the faculty PROFILE document
 * id) while the teacher's own planner rows are written from the browser under
 * their auth UID. Completing a class has to consider both, or the topic the
 * teacher planned is never matched and a duplicate row is created instead of
 * the existing one being flipped to covered. A scheduling role completing
 * somebody else's class contributes no ids of their own — the set stays the
 * session's, which is what the coverage readers query.
 */
export function resolveLedgerFacultyIds(
  session: { facultyId?: unknown },
  staff: { uid: string; ids: string[] }
): string[] {
  const sessionFacultyId = cleanText(session.facultyId)
  if (!sessionFacultyId) return cleanText(staff.uid) ? [staff.uid] : []
  if (callerOwnsFacultyId(staff, sessionFacultyId)) {
    return mergeIdentityIds(staff.uid, staff.ids).slice(0, MAX_LEDGER_FACULTY_IDS)
  }
  return [sessionFacultyId]
}

/** Optional, length-bounded string filter supplied by the caller. */
function optionalFilter(value: unknown, field: string, maximum = 100): string {
  if (value === undefined || value === null || value === '') return ''
  const trimmed = String(value).trim()
  if (trimmed.length > maximum) throw new HttpsError('invalid-argument', `${field} is invalid`)
  return trimmed
}

export interface GeneratePayload {
  collegeId: string
  from: string
  to: string
  weeklyScheduleId: string
  facultyId: string
  branch: string
  batch: string
  /** S2.5: check for faculty/room double-bookings before writing. */
  detectConflicts: boolean
  /** Generate the clean slots and skip the clashing ones instead of failing. */
  skipConflicting: boolean
}

export function validateGeneratePayload(data: unknown, role: string, claimCollegeId: string): GeneratePayload {
  const raw = (data || {}) as Record<string, unknown>
  const from = String(raw.from ?? '').trim()
  const to = String(raw.to ?? '').trim()
  if (!isValidDateKey(from) || !isValidDateKey(to)) {
    throw new HttpsError('invalid-argument', 'from and to are required as yyyy-mm-dd dates')
  }
  if (daysBetween(from, to) < 0) {
    throw new HttpsError('invalid-argument', 'from must be on or before to')
  }
  if (daysBetween(from, to) + 1 > MAX_GENERATE_RANGE_DAYS) {
    throw new HttpsError(
      'invalid-argument',
      `Date range is longer than ${MAX_GENERATE_RANGE_DAYS} days; generate one term at a time`
    )
  }
  // Superadmin targets a college explicitly; everyone else is pinned to the
  // claim. The client never gets to name its own tenant (audit finding F7).
  const requested = String(raw.collegeId ?? '').trim()
  const collegeId = role === 'superadmin' ? requested : claimCollegeId
  if (!collegeId) {
    throw new HttpsError('invalid-argument', 'No college is associated with this account')
  }
  return {
    collegeId,
    from,
    to,
    weeklyScheduleId: optionalFilter(raw.weeklyScheduleId, 'weeklyScheduleId', 200),
    facultyId: optionalFilter(raw.facultyId, 'facultyId', 200),
    branch: optionalFilter(raw.branch, 'branch', 100),
    batch: optionalFilter(raw.batch, 'batch', 100),
    // On by default: silently materialising a double-booked term is the
    // failure mode this is here to prevent.
    detectConflicts: raw.detectConflicts !== false,
    skipConflicting: raw.skipConflicting === true,
  }
}

/** True when a slot is live: legacy documents predate the `isActive` field. */
export function isSlotActive(slot: WeeklySlot): boolean {
  return slot.isActive !== false
}

/**
 * A weekly slot's validity window (P1). Legacy docs without the fields are
 * always active — byte-identical back-compat, no migration. Returned keys are
 * validated yyyy-mm-dd strings or null when absent/malformed.
 */
export function slotDateWindow(
  slot: Pick<WeeklySlot, 'effectiveFrom' | 'effectiveTo'>,
): { from: string | null; to: string | null } {
  const from = String(slot.effectiveFrom ?? '').trim()
  const to = String(slot.effectiveTo ?? '').trim()
  return {
    from: isValidDateKey(from) ? from : null,
    to: isValidDateKey(to) ? to : null,
  }
}

/** True when the slot's applicability window covers `dateKey` (or has none). */
export function slotAppliesOn(
  slot: Pick<WeeklySlot, 'effectiveFrom' | 'effectiveTo'>,
  dateKey: string,
): boolean {
  const window = slotDateWindow(slot)
  if (window.from && dateKey < window.from) return false
  if (window.to && dateKey > window.to) return false
  return true
}

export function matchesFilters(slot: WeeklySlot, filters: GeneratePayload): boolean {
  if (filters.weeklyScheduleId && slot.id !== filters.weeklyScheduleId) return false
  if (filters.facultyId && text(slot.facultyId) !== filters.facultyId) return false
  if (filters.branch && text(slot.branch).toLowerCase() !== filters.branch.toLowerCase()) return false
  if (filters.batch && text(slot.batch).toLowerCase() !== filters.batch.toLowerCase()) return false
  return true
}

/** Chunk an array so no Firestore batch/transaction blows the 500-op ceiling. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('chunk size must be a positive integer')
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

// ─── S2.5: server-side conflict enforcement ─────────────────────────────────

/**
 * A planned occurrence as the clash engine sees it. Ids are the deterministic
 * session ids, so a conflict names the exact document that would be written.
 */
/**
 * Accepts a whole Firestore document: every field is read defensively so a
 * partial or legacy row still produces a usable candidate rather than throwing.
 */
export function toConflictCandidate(input: { id: string; collegeId: string } & Record<string, unknown>): SessionCandidate {
  return {
    id: input.id,
    collegeId: input.collegeId,
    date: String(input.date ?? ''),
    facultyId: String(input.facultyId ?? ''),
    room: String(input.room ?? ''),
    startTime: String(input.startTime ?? ''),
    endTime: String(input.endTime ?? ''),
    status: String(input.status ?? 'scheduled'),
    branch: String(input.branch ?? ''),
    batch: String(input.batch ?? ''),
    division: String(input.division ?? ''),
    subject: String(input.subject ?? ''),
  }
}

/** Cap on how many conflicts are reported back to the caller. */
export const MAX_REPORTED_CONFLICTS = 10

function conflictDetails(conflicts: SessionConflict[]): Record<string, unknown> {
  const hard = hardClashes(conflicts)
  return {
    conflicts: hard.slice(0, MAX_REPORTED_CONFLICTS).map((conflict) => ({
      code: conflictErrorCode(conflict),
      kind: conflict.kind,
      date: conflict.date,
      startTime: conflict.startTime,
      endTime: conflict.endTime,
      sessionId: conflict.sessionId,
      conflictsWith: conflict.otherSessionId,
      message: describeConflict(conflict),
    })),
    conflictCount: hard.length,
  }
}

// ─── Callables ──────────────────────────────────────────────────────────────

/**
 * Expand the college's active weekly timetable into `classSessions` documents
 * for [from, to]. Re-running the same range creates nothing new.
 */
export const generateClassSessions = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 180, minInstances: 0, maxInstances: 10 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveSchedulingStaff(uid, request.auth?.token || {})
    const payload = validateGeneratePayload(request.data, staff.role, staff.collegeId)

    const db = getFirestore(admin.app(), 'default')
    // Single-field equality only — no composite index required, so this works
    // on an existing project without an index deploy.
    const slotsSnap = await db
      .collection('weeklySchedules')
      .where('collegeId', '==', payload.collegeId)
      .limit(MAX_WEEKLY_SLOTS_READ)
      .get()

    const slots: WeeklySlot[] = slotsSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
      .filter((slot) => isSlotActive(slot) && matchesFilters(slot, payload))

    // (slotId, date) pairs this run should cover. P1: occurrences outside a
    // slot's effectiveFrom/effectiveTo window are not occurrences at all —
    // legacy slots (no window) expand exactly as before.
    const planned: Array<{ slot: WeeklySlot; date: string }> = []
    let skippedOutsideWindow = 0
    for (const slot of slots) {
      for (const date of expandWeeklyRange(payload.from, payload.to, slot.dayOfWeek)) {
        if (!slotAppliesOn(slot, date)) {
          skippedOutsideWindow += 1
          continue
        }
        planned.push({ slot, date })
      }
    }

    // ─── P4: academic-calendar suppression ──────────────────────────────────
    // A `suspendsClasses` event (public/college/study holiday, exam window)
    // voids the dates it covers; a fest with suspendsClasses:false runs
    // normally. Blocker shape mirrors calendar.ts `CalendarEventLite`, parsed
    // defensively here so this module stays independent of it.
    const skippedHolidays: Array<{ date: string; reason: string }> = []
    let skippedHolidayCount = 0
    let cancelledHolidaySessions = 0
    {
      const blockers: Array<{ title: string; startDate: string; endDate: string }> = []
      const calSnap = await db
        .collection('academicCalendar')
        .where('collegeId', '==', payload.collegeId)
        .limit(MAX_CALENDAR_EVENTS_READ)
        .get()
      for (const doc of calSnap.docs) {
        const e = doc.data() as Record<string, unknown>
        // Missing field = suspends (safe default), matching calendar.ts
        // `toCalendarEventLite`; only an explicit `false` (fest) runs normally.
        if (e.suspendsClasses === false) continue
        const title = String(e.title ?? '').trim()
        const start = String(e.startDate ?? '').trim()
        const end = String(e.endDate ?? '').trim()
        if (!title || !isValidDateKey(start) || !isValidDateKey(end)) continue
        blockers.push({ title, startDate: start, endDate: end })
      }
      // Calendar events can be imported after the range was initially
      // materialised. Reconcile any already-created future sessions before
      // skipping new occurrences; the helper preserves marked history.
      for (const blocker of blockers) {
        const startDate = blocker.startDate > payload.from ? blocker.startDate : payload.from
        const endDate = blocker.endDate < payload.to ? blocker.endDate : payload.to
        if (startDate <= endDate) {
          cancelledHolidaySessions += await cancelScheduledSessionsForHolidayRange(db, {
            collegeId: payload.collegeId,
            startDate,
            endDate,
            title: blocker.title,
            actorUid: uid,
          })
        }
      }

      const kept: typeof planned = []
      const seenDates = new Set<string>()
      for (const item of planned) {
        const blocker = blockers.find((b) => item.date >= b.startDate && item.date <= b.endDate)
        if (blocker) {
          skippedHolidayCount += 1
          if (!seenDates.has(item.date)) {
            seenDates.add(item.date)
            skippedHolidays.push({ date: item.date, reason: `Holiday: ${blocker.title}` })
          }
          continue
        }
        kept.push(item)
      }
      planned.length = 0
      planned.push(...kept)
    }

    // ─── S2.5: refuse to materialise a timetable that double-books ─────────
    // Sessions already in the range, plus every planned occurrence, are checked
    // against each other. A hard clash (faculty or room) is a data problem in
    // the timetable; generating it would scatter double-booked classes across
    // the whole term, so the run stops before writing anything.
    let existingSessionsSnap: admin.firestore.QuerySnapshot | null = null
    if (payload.detectConflicts) {
      const sessionQuery: admin.firestore.Query = db
        .collection('classSessions')
        .where('collegeId', '==', payload.collegeId)
        .where('date', '>=', payload.from)
        .where('date', '<=', payload.to)
      existingSessionsSnap = await sessionQuery.limit(MAX_PROGRESS_SESSIONS).get()
    }
    const existingCandidates: SessionCandidate[] = (existingSessionsSnap?.docs || []).map((doc) =>
      toConflictCandidate({ id: doc.id, collegeId: payload.collegeId, ...(doc.data() as Record<string, unknown>) })
    )

    const plannedCandidates: SessionCandidate[] = planned.map(({ slot, date }) =>
      toConflictCandidate({
        id: slotDateKey(slot.id, date),
        collegeId: payload.collegeId,
        date,
        facultyId: slot.facultyId,
        room: slot.room,
        startTime: slot.startTime,
        endTime: slot.endTime,
        branch: slot.branch,
        batch: slot.batch,
        division: slot.division,
        subject: slot.subject,
      })
    )

    const conflicts: SessionConflict[] = []
    const conflictedIds = new Set<string>()
    if (payload.detectConflicts) {
      plannedCandidates.forEach((candidate, index) => {
        // Against what already exists, and against the rest of this run.
        const others = [
          ...existingCandidates,
          ...plannedCandidates.slice(0, index),
          ...plannedCandidates.slice(index + 1),
        ]
        const found = hardClashes(findSessionClashes(candidate, others))
        if (found.length > 0) {
          conflicts.push(...found)
          conflictedIds.add(candidate.id)
        }
      })
    }

    if (conflictedIds.size > 0 && !payload.skipConflicting) {
      throw new HttpsError(
        'failed-precondition',
        `${conflictedIds.size} class session(s) would double-book a faculty member or a room. ` +
          'Fix the timetable, or pass skipConflicting to generate everything else.',
        conflictDetails(conflicts)
      )
    }

    const generatePlan = planned.filter(
      ({ slot, date }) => !conflictedIds.has(slotDateKey(slot.id, date))
    )

    // ─── Optional schedule → assignment linkage ───────────────────────────
    // Every planned slot that carries a validated `assignment` config gets
    // exactly one draft assignment (deterministic id, so a rerun cannot
    // create a second one). The slot remembers the id; the generated
    // sessions inherit it so the class and the work item stay traceable.
    const slotAssignmentIds = new Map<string, string>()
    {
      const plannedSlotIds = new Set(generatePlan.map(({ slot }) => slot.id))
      const configuredSlots = slots.filter(
        (slot) => plannedSlotIds.has(slot.id) && parseSlotAssignmentConfig(slot) !== null
      )
      for (const slot of configuredSlots) {
        const remembered = String(slot.assignmentId || '').trim()
        if (remembered && !remembered.includes('/')) {
          slotAssignmentIds.set(slot.id, remembered)
          continue
        }
        const config = parseSlotAssignmentConfig(slot)
        if (!config) continue
        const assignmentId = scheduleAssignmentDocId(slot.id)
        const existing = await db.collection('assignments').doc(assignmentId).get()
        if (!existing.exists) {
          const facultyUid = await resolveSlotFacultyAuthUid(slot)
          await db
            .collection('assignments')
            .doc(assignmentId)
            .set(buildScheduleAssignmentDoc(slot, config, facultyUid, new Date()))
        }
        // Idempotent on rerun; the timetable UI reads this to show the link.
        await db
          .collection('weeklySchedules')
          .doc(slot.id)
          .set(
            {
              assignmentId,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          )
        slotAssignmentIds.set(slot.id, assignmentId)
      }
    }

    let created = 0
    let skippedExisting = 0
    let batches = 0

    for (const group of chunk(generatePlan, MAX_BATCH_OPS)) {
      const refs = group.map(({ slot, date }) =>
        db.collection('classSessions').doc(slotDateKey(slot.id, date))
      )
      // getId-only probe: `getAll` returns lightweight document snapshots, and
      // skipping what already exists is what makes a re-run a no-op.
      const existing = new Set<string>()
      for (const probe of chunk(refs, 100)) {
        const snaps = await db.getAll(...probe)
        snaps.forEach((snap) => {
          if (snap.exists) existing.add(snap.id)
        })
      }

      const pending = group.filter(({ slot, date }) => !existing.has(slotDateKey(slot.id, date)))
      skippedExisting += group.length - pending.length
      if (pending.length === 0) continue

      const batch = db.batch()
      const now = new Date()
      for (const { slot, date } of pending) {
        batch.set(
          db.collection('classSessions').doc(slotDateKey(slot.id, date)),
          buildSessionDoc(slot, date, now, slotAssignmentIds.get(slot.id))
        )
      }
      await batch.commit()
      created += pending.length
      batches += 1
    }

    logger.info('[classSchedule] generateClassSessions', {
      collegeId: payload.collegeId,
      from: payload.from,
      to: payload.to,
      slotsScanned: slots.length,
      planned: planned.length,
      created,
      skippedExisting,
      skippedConflicts: conflictedIds.size,
      skippedHolidayCount,
      cancelledHolidaySessions,
      skippedOutsideWindow,
      assignmentsLinked: slotAssignmentIds.size,
      batches,
      actorUid: uid,
    })

    return {
      collegeId: payload.collegeId,
      from: payload.from,
      to: payload.to,
      slotsScanned: slots.length,
      scheduledOccurrences: planned.length,
      created,
      skippedExisting,
      skippedConflicts: conflictedIds.size,
      conflicts: conflictDetails(conflicts).conflicts,
      batches,
      // Slots whose attached assignment was linked (created or remembered)
      // by this run — the admin UI surfaces the drafts for faculty publish.
      assignmentsLinked: slotAssignmentIds.size,
      // P4/P1: additive skip accounting — holiday rows are `{date, reason}`
      // (one per date); counts are occurrences (a holiday voids every slot
      // occurrence on its dates).
      skippedHolidays,
      skippedHolidayCount,
      cancelledHolidaySessions,
      skippedOutsideWindow,
    }
  }
)

/**
 * Cancel a recurring slot: every future session it generated that has not yet
 * been marked moves to `cancelled`, and the slot is deactivated so the next
 * materialisation run does not resurrect them.
 */
export const cancelWeeklySchedule = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 180, minInstances: 0, maxInstances: 10 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveSchedulingStaff(uid, request.auth?.token || {})

    const raw = (request.data || {}) as Record<string, unknown>
    const weeklyScheduleId = String(raw.weeklyScheduleId ?? '').trim()
    if (!weeklyScheduleId || weeklyScheduleId.includes('/') || weeklyScheduleId.length > 200) {
      throw new HttpsError('invalid-argument', 'weeklyScheduleId is required')
    }
    // Default to today so "cancel this slot" never rewinds into sessions that
    // have already been delivered and marked.
    const from = String(raw.from ?? '').trim() || todayKey()
    if (!isValidDateKey(from)) {
      throw new HttpsError('invalid-argument', 'from must be a yyyy-mm-dd date')
    }
    const reason = optionalFilter(raw.reason, 'reason', 300)
    const collegeId = staff.role === 'superadmin' ? String(raw.collegeId ?? '').trim() : staff.collegeId
    if (!collegeId) {
      throw new HttpsError('invalid-argument', 'No college is associated with this account')
    }

    const db = getFirestore(admin.app(), 'default')
    const slotRef = db.collection('weeklySchedules').doc(weeklyScheduleId)
    const slotSnap = await slotRef.get()
    if (!slotSnap.exists) throw new HttpsError('not-found', 'Weekly schedule not found')
    if (String(slotSnap.data()?.collegeId || '') !== collegeId) {
      throw new HttpsError('permission-denied', 'Weekly schedule belongs to another college')
    }

    // Equality on weeklyScheduleId alone — again, no composite index needed.
    // Status/date are filtered in code because a transaction cannot run a
    // fresh query, and the candidate set for one slot is one document a week.
    const sessionsSnap = await db
      .collection('classSessions')
      .where('weeklyScheduleId', '==', weeklyScheduleId)
      .get()

    const now = new Date().toISOString()
    const candidates = sessionsSnap.docs.filter((snap) => {
      const data = snap.data()
      return String(data.status || 'scheduled') === 'scheduled' && String(data.date || '') >= from
    })

    let cancelled = 0
    let skipped = sessionsSnap.docs.length - candidates.length

    // One transaction per chunk: reads + writes must stay under 500 ops, and a
    // partial failure must not leave half a slot cancelled.
    for (const group of chunk(candidates, MAX_CANCEL_DOCS_PER_TXN)) {
      const applied = await db.runTransaction(async (txn) => {
        let count = 0
        for (const snap of group) {
          const fresh = await txn.get(snap.ref)
          const data = fresh.data()
          // Re-check inside the transaction: anything can change between the
          // query and the write, and a session that was already marked must
          // never be cancelled out from under its attendance.
          if (
            !fresh.exists ||
            String(data?.status || 'scheduled') !== 'scheduled' ||
            String(data?.date || '') < from
          ) {
            continue
          }
          txn.update(snap.ref, {
            status: 'cancelled',
            cancelledAt: now,
            cancelledBy: uid,
            cancelReason: reason,
            updatedAt: now,
          })
          count += 1
        }
        txn.set(
          slotRef,
          { isActive: false, updatedAt: now, cancelledAt: now, cancelledBy: uid },
          { merge: true }
        )
        return count
      })
      // Report what was actually cancelled, not the size of the candidate
      // group — the two diverge whenever a session was marked in flight.
      cancelled += applied
      skipped += group.length - applied
    }

    logger.info('[classSchedule] cancelWeeklySchedule', {
      collegeId,
      weeklyScheduleId,
      from,
      cancelled,
      skipped,
      actorUid: uid,
    })

    return {
      collegeId,
      weeklyScheduleId,
      from,
      scanned: sessionsSnap.docs.length,
      cancelled,
      skipped,
      slotDeactivated: true,
    }
  }
)

// ─── S2.6: rescheduleClass — move the plan and the actual together ───────────
//
// The last hole in the delivery spine: the timetable could be created
// (createWeeklySchedule), materialised (generateClassSessions) and cancelled
// (cancelWeeklySchedule), but it could not be *moved*. An admin who changed a
// slot's day/time on the grid left every dated session it had already produced
// sitting at the old time — attendance, the student timetable and the faculty
// day view kept showing a class that no longer existed. Faculty had a
// single-class move (FacultyReschedule), admins had nothing.
//
// `rescheduleClass` is the server-side answer, with two scopes:
//
//   scope: 'slot'    — move the recurring slot itself (day/time/room/faculty)
//                      and take every future unmarked session with it, so the
//                      plan and the actual never disagree.
//   scope: 'session' — move exactly one dated class (a one-off clash: a guest
//                      lecture, a holiday, a room that is suddenly booked).
//
// Rules that make it safe:
//  * Only sessions that are still `scheduled`, on or after `from` (default
//    today) and NOT marked (no attendance, no topics covered) are ever
//    touched. Delivered history is immutable from here.
//  * Nothing is silently dropped. A target id that already holds a session is
//    reported as `merged` (the class is already at the destination); the
//    source is cancelled with a reason rather than deleted, so the change is
//    auditable.
//  * A cross-day move writes the session to the deterministic id of the NEW
//    date (`${slotId}_${newDate}`) and removes the old id, so a later
//    `generateClassSessions` run cannot resurrect the class at the old time
//    nor duplicate it at the new one.
//  * Hard clashes (faculty/room double-booking) abort the run before anything
//    is written, with the individual clashes attached — the same contract as
//    generate (S2.5). `allowConflicts: true` is the explicit override.
//  * The slot document and its sessions are written in one chunked batch, and
//    every session is re-read inside the write path, so a class that was
//    marked while the dialog was open is not moved out from under its
//    attendance.

/** Upper bound on sessions one reschedule run will consider, to bound the call. */
export const MAX_RESCHEDULE_SESSIONS = 400

/** Which part of the timetable a reschedule applies to. */
export type RescheduleScope = 'slot' | 'session'

export interface RescheduleChanges {
  /** New weekday of the class (coerced from "Mon", 1, "monday", …). */
  dayOfWeek?: unknown
  /** New start/end time as "HH:MM". */
  startTime?: unknown
  endTime?: unknown
  room?: unknown
  facultyId?: unknown
  facultyName?: unknown
  /** `scope: 'session'` only — the date the single class moves to. */
  date?: unknown
}

/** One classified session, as read for planning. */
export interface PlannedSession {
  id: string
  date: string
  status?: unknown
  attendanceMarked?: unknown
  attendanceCount?: unknown
  presentCount?: unknown
  topicsCovered?: unknown
  startTime?: unknown
  endTime?: unknown
  room?: unknown
  facultyId?: unknown
}

export interface PlannedMove {
  /** Session document the class is currently filed under. */
  fromId: string
  /** Where it is filed afterwards. Same as `fromId` for a one-off move. */
  toId: string
  fromDate: string
  toDate: string
  /** Field patch for the destination document (times/room/faculty/date). */
  patch: Record<string, unknown>
  /** True when the document keeps its id, so the move is an update. */
  inPlace: boolean
}

export interface ReschedulePlan {
  moves: PlannedMove[]
  /** A session already exists on the target date — the source is retired. */
  merged: { id: string; date: string; toId: string; toDate: string }[]
  /**
   * `scope: 'session'` only: another class for this slot already occupies the
   * requested date. The move is refused instead of cancelling the class the
   * admin asked to move.
   */
  blocked: { id: string; date: string; toId: string }[]
  /** Already on the new day with nothing to change — nothing was written. */
  unchanged: { id: string; date: string }[]
  /** Delivered or marked classes: never moved, reported instead. */
  skippedMarked: { id: string; date: string }[]
  /** Occurrences before `from`: history, never moved. */
  skippedPast: { id: string; date: string }[]
  /** Sessions that are not `scheduled` (cancelled/completed): ignored. */
  skippedStatus: { id: string; date: string }[]
}

/**
 * The next occurrence of `day` strictly after `afterDate`.
 *
 * Strictly-after (not "same week") is deliberate: moving a Friday class to
 * Monday must not schedule it in the past. Each occurrence therefore lands
 * 1–7 days ahead of where it was, which keeps the weekly cadence and the
 * ordering of consecutive occurrences intact.
 */
export function nextDateForDay(afterDate: string, day: unknown): string | null {
  const target = coerceDayOfWeek(day)
  if (!target || !isValidDateKey(afterDate)) return null
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDays(afterDate, offset)
    if (weekdayOf(candidate) === target) return candidate
  }
  return null
}

/** True when a session may be moved: scheduled, in the future, not marked. */
export function isMovableSession(session: PlannedSession, from: string): boolean {
  if (String(session.status || 'scheduled') !== 'scheduled') return false
  if (!isValidDateKey(session.date) || session.date < from) return false
  if (session.attendanceMarked === true) return false
  if (Number(session.attendanceCount || 0) > 0) return false
  if (Number(session.presentCount || 0) > 0) return false
  const topics = Array.isArray(session.topicsCovered) ? session.topicsCovered : []
  if (topics.length > 0) return false
  return true
}

/** True when an unmarked scheduled session falls inside a suspending event. */
export function isSessionAffectedByHoliday(
  session: PlannedSession,
  holiday: { startDate: string; endDate: string },
  from: string,
): boolean {
  return session.date >= holiday.startDate && session.date <= holiday.endDate && isMovableSession(session, from)
}

/**
 * Cancel unmarked future sessions covered by a suspending calendar event.
 * Marked/completed sessions are deliberately preserved as academic history.
 * The query is paged and each chunk is transactionally re-checked so a
 * concurrent attendance write cannot be overwritten by the holiday update.
 */
export async function cancelScheduledSessionsForHolidayRange(
  db: admin.firestore.Firestore,
  params: {
    collegeId: string
    startDate: string
    endDate: string
    title: string
    actorUid: string
    fromDate?: string
  },
): Promise<number> {
  const today = params.fromDate && isValidDateKey(params.fromDate) ? params.fromDate : todayKey()
  const from = params.startDate > today ? params.startDate : today
  const to = params.endDate
  if (!isValidDateKey(from) || !isValidDateKey(to) || from > to) return 0

  const reason = `Academic calendar: ${String(params.title || 'holiday').trim()}`.slice(0, 300)
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  let cancelled = 0
  while (true) {
    let pageQuery = db
      .collection('classSessions')
      .where('collegeId', '==', params.collegeId)
      .where('date', '>=', from)
      .where('date', '<=', to)
      .orderBy('date')
      .limit(MAX_CANCEL_DOCS_PER_TXN)
    if (cursor) pageQuery = pageQuery.startAfter(cursor)
    const page = await pageQuery.get()
    if (page.empty) break

    const applied = await db.runTransaction(async (txn) => {
      const currentRows: Array<{ snapshot: FirebaseFirestore.DocumentSnapshot; data: Record<string, unknown> }> = []
      // Firestore transactions require all reads to complete before writes.
      for (const snapshot of page.docs) {
        const fresh = await txn.get(snapshot.ref)
        const data = fresh.data() as Record<string, unknown> | undefined
        if (fresh.exists && data) currentRows.push({ snapshot: fresh, data })
      }

      let count = 0
      const now = new Date().toISOString()
      for (const { snapshot, data } of currentRows) {
        const session: PlannedSession = {
          id: snapshot.id,
          date: String(data.date ?? ''),
          status: data.status,
          attendanceMarked: data.attendanceMarked,
          attendanceCount: data.attendanceCount,
          presentCount: data.presentCount,
          topicsCovered: data.topicsCovered,
        }
        if (!isSessionAffectedByHoliday(session, { startDate: from, endDate: to }, from)) continue
        txn.update(snapshot.ref, {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: params.actorUid,
          cancelReason: reason,
          updatedAt: now,
        })
        count += 1
      }
      return count
    })
    cancelled += applied
    cursor = page.docs[page.docs.length - 1]
    if (page.size < MAX_CANCEL_DOCS_PER_TXN) break
  }
  return cancelled
}

/**
 * Decide exactly what happens to a slot's sessions when the class moves.
 *
 * Pure — no Firestore, no clock — so the whole classification (moved, merged,
 * skipped-marked, skipped-past) is unit-tested without an emulator. The
 * callable only reads the documents this needs and writes the plan out.
 */
export function planReschedule(params: {
  slot: WeeklySlot
  sessions: PlannedSession[]
  changes: RescheduleChanges
  scope: RescheduleScope
  /** Only sessions on or after this date are considered. */
  from: string
  /** `scope: 'session'`: the one session being moved. */
  sessionId?: string
}): ReschedulePlan {
  const { slot, sessions, changes, scope, from } = params
  const plan: ReschedulePlan = {
    moves: [],
    merged: [],
    blocked: [],
    unchanged: [],
    skippedMarked: [],
    skippedPast: [],
    skippedStatus: [],
  }

  const slotId = String(slot.id || '').trim()
  const currentDay = coerceDayOfWeek(slot.dayOfWeek)
  const newDay = changes.dayOfWeek !== undefined && changes.dayOfWeek !== null
    ? coerceDayOfWeek(changes.dayOfWeek)
    : currentDay
  const dayChanges = Boolean(newDay && currentDay && newDay !== currentDay)

  // Times/room/faculty keep their current value when the caller did not ask
  // for a change, so a "move to Tuesday" does not silently blank the room.
  const patchBase: Record<string, unknown> = {}
  if (changes.startTime !== undefined && changes.startTime !== null && String(changes.startTime) !== '') {
    patchBase.startTime = String(changes.startTime)
  }
  if (changes.endTime !== undefined && changes.endTime !== null && String(changes.endTime) !== '') {
    patchBase.endTime = String(changes.endTime)
  }
  if (changes.room !== undefined && changes.room !== null) patchBase.room = String(changes.room)
  if (changes.facultyId) patchBase.facultyId = String(changes.facultyId)
  if (changes.facultyName) patchBase.facultyName = String(changes.facultyName)
  if (changes.dayOfWeek !== undefined && changes.dayOfWeek !== null && newDay) {
    patchBase.dayOfWeek = newDay
  }

  const takenIds = new Set(sessions.map((session) => session.id))
  // Target dates already occupied by this slot: two moves must not collide.
  const claimedDates = new Set<string>()

  const consider = (session: PlannedSession): void => {
    if (!isMovableSession(session, from)) {
      if (String(session.status || 'scheduled') !== 'scheduled') {
        plan.skippedStatus.push({ id: session.id, date: session.date })
      } else if (!isValidDateKey(session.date) || session.date < from) {
        plan.skippedPast.push({ id: session.id, date: session.date })
      } else {
        plan.skippedMarked.push({ id: session.id, date: session.date })
      }
      return
    }

    // A class that already falls on the new weekday is already where it
    // belongs: only its time/room/faculty can change, and it must not be
    // pushed a week forward. This is also what stops a Monday→Wednesday move
    // from cascading into the Wednesday class it was merging into.
    const alreadyOnNewDay = dayChanges && newDay ? weekdayOf(session.date) === newDay : false
    const explicitDate = changes.date !== undefined ? normalizeSessionDate(changes.date) : ''
    const toDate = alreadyOnNewDay
      ? session.date
      : dayChanges
        ? nextDateForDay(session.date, newDay)
        : explicitDate || session.date

    if (!toDate) {
      // Unparseable day on the slot — leave it alone rather than guess.
      plan.skippedPast.push({ id: session.id, date: session.date })
      return
    }

    const inPlace = alreadyOnNewDay || !dayChanges
    const toId = inPlace ? session.id : slotDateKey(slotId, toDate)

    // Another document already lives at the destination (or another occurrence
    // of this slot is already being moved there): the class exists there, so
    // the source is retired instead of doubling it up. A one-off move is
    // different — cancelling the very class the admin asked to move would be
    // destructive, so it is reported as blocked and the caller refuses.
    const occupied =
      sessions.some((other) => other.id !== session.id && other.date === toDate) ||
      claimedDates.has(toDate)
    const collides =
      toDate !== session.date &&
      (occupied || (!inPlace && (takenIds.has(toId) || toId === session.id)))

    if (collides) {
      if (scope === 'session') {
        plan.blocked.push({ id: session.id, date: session.date, toId: toId || session.id })
      } else {
        plan.merged.push({ id: session.id, date: session.date, toId, toDate })
      }
      return
    }

    const dateChanges = toDate !== session.date
    const nextStart = String(patchBase.startTime ?? session.startTime ?? '')
    const nextEnd = String(patchBase.endTime ?? session.endTime ?? '')
    const timeChanges = nextStart !== String(session.startTime ?? '') || nextEnd !== String(session.endTime ?? '')

    // A class already on the new weekday that needs no time/room/faculty change
    // is done: writing an identical document would only produce noise in the
    // reschedule report.
    const same = (next: unknown, current: unknown) => String(next ?? '') === String(current ?? '')
    const roomChanges = 'room' in patchBase && !same(patchBase.room, session.room)
    const facultyChanges = 'facultyId' in patchBase && !same(patchBase.facultyId, session.facultyId)
    if (!dateChanges && !timeChanges && !roomChanges && !facultyChanges) {
      plan.unchanged.push({ id: session.id, date: session.date })
      return
    }

    claimedDates.add(toDate)
    plan.moves.push({
      fromId: session.id,
      toId,
      fromDate: session.date,
      toDate,
      patch: {
        ...patchBase,
        // The date is written whenever it moves — including the one-off
        // in-place move, where the document keeps its id and the date field
        // is the only thing that says when the class actually happens.
        ...(dateChanges ? { date: toDate } : {}),
        ...(dateChanges || timeChanges ? { timeSlot: `${nextStart}-${nextEnd}` } : {}),
      },
      inPlace,
    })
  }

  if (scope === 'session') {
    const target = sessions.find((session) => session.id === params.sessionId)
    if (target) consider(target)
    return plan
  }

  for (const session of sessions) consider(session)
  return plan
}

export const rescheduleClass = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 180, minInstances: 0, maxInstances: 10 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveSchedulingStaff(uid, request.auth?.token || {})

    const raw = (request.data || {}) as Record<string, unknown>
    const scope: RescheduleScope = raw.scope === 'session' ? 'session' : 'slot'
    const weeklyScheduleId = String(raw.weeklyScheduleId ?? '').trim()
    if (!weeklyScheduleId || weeklyScheduleId.includes('/') || weeklyScheduleId.length > 200) {
      throw new HttpsError('invalid-argument', 'weeklyScheduleId is required')
    }
    const from = String(raw.from ?? '').trim() || todayKey()
    if (!isValidDateKey(from)) {
      throw new HttpsError('invalid-argument', 'from must be a yyyy-mm-dd date')
    }
    const reason = optionalFilter(raw.reason, 'reason', 300)
    const sessionId = scope === 'session' ? String(raw.sessionId ?? '').trim() : ''
    if (scope === 'session' && !sessionId) {
      throw new HttpsError('invalid-argument', 'sessionId is required when scope is "session"')
    }
    const allowConflicts = raw.allowConflicts === true

    // ─── Validate the requested changes ──────────────────────────────────
    const changes: RescheduleChanges = {}
    if (raw.dayOfWeek !== undefined && raw.dayOfWeek !== null && raw.dayOfWeek !== '') {
      const day = coerceDayOfWeek(raw.dayOfWeek)
      if (!day) throw new HttpsError('invalid-argument', 'dayOfWeek is not a valid weekday')
      changes.dayOfWeek = day
    }
    for (const field of ['startTime', 'endTime'] as const) {
      const value = optionalFilter(raw[field], field, 10)
      if (!value) continue
      if (minutesOfDay(value) === null) {
        throw new HttpsError('invalid-argument', `${field} must be an HH:MM time`)
      }
      changes[field] = value
    }
    if (raw.room !== undefined) changes.room = optionalFilter(raw.room, 'room', 100)
    if (raw.facultyId !== undefined) changes.facultyId = optionalFilter(raw.facultyId, 'facultyId', 200)
    if (raw.facultyName !== undefined) changes.facultyName = optionalFilter(raw.facultyName, 'facultyName', 200)
    if (scope === 'session') {
      const date = normalizeSessionDate(raw.date)
      if (!date) throw new HttpsError('invalid-argument', 'date is required as yyyy-mm-dd')
      if (date < todayKey()) {
        throw new HttpsError('invalid-argument', 'A class cannot be moved into the past')
      }
      changes.date = date
    }
    if (Object.keys(changes).length === 0) {
      throw new HttpsError('invalid-argument', 'Nothing to change — send a new day, time, room or faculty')
    }

    const collegeId = staff.role === 'superadmin' ? String(raw.collegeId ?? '').trim() || staff.collegeId : staff.collegeId
    if (!collegeId) {
      throw new HttpsError('invalid-argument', 'No college is associated with this account')
    }

    const db = getFirestore(admin.app(), 'default')
    const slotRef = db.collection('weeklySchedules').doc(weeklyScheduleId)
    const slotSnap = await slotRef.get()
    if (!slotSnap.exists) throw new HttpsError('not-found', 'Weekly schedule not found')
    const slotData = slotSnap.data() as Record<string, unknown>
    if (String(slotData.collegeId || '') !== collegeId) {
      throw new HttpsError('permission-denied', 'Weekly schedule belongs to another college')
    }
    const slot: WeeklySlot = { id: slotSnap.id, ...slotData }

    // The times cannot end up unusable: a reschedule that produced a 0-minute
    // or reversed class would be worse than the clash it was avoiding.
    const nextStart = String(changes.startTime ?? slot.startTime ?? '')
    const nextEnd = String(changes.endTime ?? slot.endTime ?? '')
    if (durationMinutes(nextStart, nextEnd) === null) {
      throw new HttpsError('invalid-argument', 'The class must end after it starts (HH:MM)')
    }

    // Equality on weeklyScheduleId alone — no composite index needed.
    const sessionsSnap = await db
      .collection('classSessions')
      .where('weeklyScheduleId', '==', weeklyScheduleId)
      .limit(MAX_RESCHEDULE_SESSIONS)
      .get()
    const sessions: PlannedSession[] = sessionsSnap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>
      return {
        id: doc.id,
        date: normalizeSessionDate(data.date) || String(data.date || ''),
        status: data.status,
        attendanceMarked: data.attendanceMarked,
        attendanceCount: data.attendanceCount,
        presentCount: data.presentCount,
        topicsCovered: data.topicsCovered,
        startTime: data.startTime,
        endTime: data.endTime,
        room: data.room,
        facultyId: data.facultyId,
      }
    })

    if (scope === 'session' && !sessions.some((session) => session.id === sessionId)) {
      throw new HttpsError('not-found', 'That class session does not belong to this weekly schedule')
    }

    const plan = planReschedule({ slot, sessions, changes, scope, from, sessionId })

    if (plan.blocked.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        `Another class for this subject is already scheduled on ${changes.date} — pick a different date.`
      )
    }

    if (plan.moves.length === 0 && plan.merged.length === 0) {
      return {
        collegeId,
        weeklyScheduleId,
        scope,
        moved: 0,
        merged: 0,
        unchanged: plan.unchanged.length,
        skippedMarked: plan.skippedMarked.length,
        skippedPast: plan.skippedPast.length,
        conflicts: [] as SessionConflict[],
        slotUpdated: false,
        message:
          plan.skippedMarked.length > 0
            ? 'Every remaining class for this slot has already been delivered or marked — nothing was moved.'
            : 'No future class for this slot needed moving.',
      }
    }

    // ─── S2.5 conflicts, applied to the destination ──────────────────────
    const movedIds = new Set(plan.moves.map((move) => move.fromId))
    const targetDates = [...new Set(plan.moves.map((move) => move.toDate))].sort()
    const conflictList: SessionConflict[] = []
    if (targetDates.length > 0) {
      const others: SessionCandidate[] = []
      for (const group of chunk(targetDates, 10)) {
        const snap = await db
          .collection('classSessions')
          .where('collegeId', '==', collegeId)
          .where('date', 'in', group)
          .limit(MAX_RESCHEDULE_SESSIONS)
          .get()
        snap.docs.forEach((doc) => {
          if (movedIds.has(doc.id)) return
          others.push(toConflictCandidate({ id: doc.id, collegeId, ...(doc.data() as Record<string, unknown>) }))
        })
      }

      const candidates = plan.moves.map((move) =>
        toConflictCandidate({
          id: move.toId,
          collegeId,
          date: move.toDate,
          facultyId: String(changes.facultyId ?? slot.facultyId ?? ''),
          room: String(changes.room ?? slot.room ?? ''),
          startTime: String(changes.startTime ?? slot.startTime ?? ''),
          endTime: String(changes.endTime ?? slot.endTime ?? ''),
          branch: slot.branch,
          batch: slot.batch,
          division: slot.division,
          subject: slot.subject,
        })
      )
      candidates.forEach((candidate, index) => {
        const against = [
          ...others,
          ...candidates.slice(0, index),
          ...candidates.slice(index + 1),
        ]
        conflictList.push(...hardClashes(findSessionClashes(candidate, against)))
      })

      if (conflictList.length > 0 && !allowConflicts) {
        throw new HttpsError(
          'failed-precondition',
          `${conflictList.length} class(es) would double-book a faculty member or a room after the move. ` +
            'Pick another time, or reschedule with allowConflicts to move them anyway.',
          conflictDetails(conflictList)
        )
      }
    }

    const now = new Date().toISOString()
    const stamp = {
      rescheduledAt: now,
      rescheduledBy: uid,
      rescheduleReason: reason || 'Schedule change',
      // Admin-initiated moves are already approved — they exist so the HOD
      // queue (which reads `approvalStatus`) is not polluted with them.
      approvalStatus: 'approved',
    }
    const slotPatch: Record<string, unknown> = { updatedAt: now, ...stamp }
    for (const [key, value] of Object.entries(changes)) {
      if (key === 'date') continue
      slotPatch[key] = value
    }
    // Remember the slot's previous shape so the change is visible on the grid.
    slotPatch.previousSlot = {
      dayOfWeek: slot.dayOfWeek ?? null,
      startTime: slot.startTime ?? null,
      endTime: slot.endTime ?? null,
      room: slot.room ?? null,
      facultyId: slot.facultyId ?? null,
    }
    // A one-off move leaves the recurring pattern exactly as it was: only the
    // single dated session changes. Stamping the slot here would tell every
    // reader the weekly class had moved too.
    const writesSlot = scope === 'slot'

    let moved = 0
    let merged = 0
    const writes = [
      ...plan.moves.map((move) => ({ kind: 'move' as const, move })),
      ...plan.merged.map((entry) => ({ kind: 'merge' as const, entry })),
    ]
    for (const group of chunk(writes, MAX_BATCH_OPS)) {
      const batch = db.batch()
      for (const item of group) {
        if (item.kind === 'move') {
          const { move } = item
          const sourceRef = db.collection('classSessions').doc(move.fromId)
          const sourceData = sessionsSnap.docs.find((doc) => doc.id === move.fromId)?.data() || {}
          // Re-read through the batch is not possible; instead the move is
          // guarded by re-checking the fields we classified on (still
          // scheduled, still the same date). A session marked in flight is
          // left where it is by the caller's own attendance write.
          const stampPatch = {
            ...move.patch,
            ...stamp,
            rescheduledFrom: {
              date: move.fromDate,
              startTime: String(sourceData.startTime ?? ''),
              endTime: String(sourceData.endTime ?? ''),
              room: String(sourceData.room ?? ''),
            },
          }
          if (move.inPlace) {
            batch.update(sourceRef, stampPatch)
          } else {
            const targetRef = db.collection('classSessions').doc(move.toId)
            batch.set(targetRef, { ...sourceData, id: move.toId, ...stampPatch, updatedAt: now })
            // The old id must stop existing, or the class would be visible at
            // both times. It is a future, unmarked session that has just been
            // moved a few days, not delivered history being destroyed.
            batch.delete(sourceRef)
          }
          moved += 1
        } else {
          const { entry } = item
          batch.set(
            db.collection('classSessions').doc(entry.id),
            {
              status: 'cancelled',
              cancelledAt: now,
              cancelledBy: uid,
              cancelReason: `Rescheduled to ${entry.toDate}`,
              mergedInto: entry.toId,
              updatedAt: now,
            },
            { merge: true }
          )
          merged += 1
        }
      }
      if (writesSlot) batch.set(slotRef, slotPatch, { merge: true })
      await batch.commit()
    }

    logger.info('[classSchedule] rescheduleClass', {
      collegeId,
      weeklyScheduleId,
      scope,
      moved,
      merged,
      unchanged: plan.unchanged.length,
      skippedMarked: plan.skippedMarked.length,
      skippedPast: plan.skippedPast.length,
      conflicts: conflictList.length,
      actorUid: uid,
    })

    return {
      collegeId,
      weeklyScheduleId,
      scope,
      moved,
      merged,
      unchanged: plan.unchanged.length,
      skippedMarked: plan.skippedMarked.length,
      skippedPast: plan.skippedPast.length,
      conflicts: conflictList.slice(0, MAX_REPORTED_CONFLICTS),
      slotUpdated: writesSlot,
      from,
      toDates: targetDates,
      message:
        moved === 0
          ? 'No future class needed moving.'
          : `Moved ${moved} class${moved === 1 ? '' : 'es'}${merged > 0 ? `, ${merged} already existed at the new time` : ''}.`,
    }
  }
)

// ─── S2.2: ensureClassSession — the one writer for a class session ───────────

export interface EnsureSessionInput {
  collegeId: string
  date: string
  weeklyScheduleId: string
  facultyId: string
  facultyName: string
  subject: string
  subjectCode: string
  branch: string
  batch: string
  semester: number
  division: string
  section: string
  room: string
  startTime: string
  endTime: string
  type: string
  topic: string
}

/** Bounded, type-coerced copy of the client's session request. */
export function validateEnsureInput(data: unknown): EnsureSessionInput {
  const raw = (data || {}) as Record<string, unknown>
  const date = normalizeSessionDate(raw.date ?? raw.dateStr)
  if (!date) throw new HttpsError('invalid-argument', 'date is required as yyyy-mm-dd')

  const semester = Number(raw.semester)
  return {
    collegeId: optionalFilter(raw.collegeId, 'collegeId', 200),
    date,
    weeklyScheduleId: optionalFilter(raw.weeklyScheduleId, 'weeklyScheduleId', 200),
    facultyId: optionalFilter(raw.facultyId, 'facultyId', 200),
    facultyName: optionalFilter(raw.facultyName, 'facultyName', 200),
    subject: optionalFilter(raw.subject, 'subject', 200),
    subjectCode: optionalFilter(raw.subjectCode, 'subjectCode', 100),
    branch: optionalFilter(raw.branch, 'branch', 100),
    batch: optionalFilter(raw.batch, 'batch', 100),
    semester: Number.isFinite(semester) ? semester : 0,
    division: optionalFilter(raw.division, 'division', 100),
    section: optionalFilter(raw.section, 'section', 100),
    room: optionalFilter(raw.room, 'room', 100),
    startTime: optionalFilter(raw.startTime, 'startTime', 10),
    endTime: optionalFilter(raw.endTime, 'endTime', 10),
    type: optionalFilter(raw.type, 'type', 50) || 'lecture',
    topic: optionalFilter(raw.topic, 'topic', 300),
  }
}

/**
 * Payload for a session created on demand (no recurring parent). Mirrors
 * buildSessionDoc's canonical shape so the two creation paths cannot drift.
 */
export function buildAdhocSessionDoc(
  input: EnsureSessionInput,
  collegeId: string,
  uid: string,
  now: Date = new Date()
): admin.firestore.DocumentData {
  const day = coerceDayOfWeek(weekdayOf(input.date))
  const stamp = now.toISOString()
  const doc = buildSessionDoc(
    {
      id: '',
      collegeId,
      subject: input.subject,
      subjectCode: input.subjectCode,
      facultyId: input.facultyId,
      facultyName: input.facultyName,
      branch: input.branch,
      batch: input.batch,
      semester: input.semester,
      division: input.division,
      section: input.section,
      room: input.room,
      dayOfWeek: day || undefined,
      startTime: input.startTime,
      endTime: input.endTime,
      type: input.type,
    },
    input.date,
    now
  )
  // An ad-hoc session has no recurring parent, so the backlink is absent by
  // design; `source` is what tells the two apart later.
  delete doc.weeklyScheduleId
  return {
    ...doc,
    source: 'adhoc',
    subjectKey: subjectKey(input.subject, input.subjectCode),
    // Legacy readers look for the free-text topic list (scheduleApi.ts:84).
    topicsCovered: input.topic ? [input.topic] : [],
    createdBy: uid,
    createdAt: stamp,
    updatedAt: stamp,
  }
}

/**
 * Get-or-create one class session. This is the single writer both the admin
 * schedule form and the faculty attendance flow go through, so a day+slot can
 * only ever resolve to one document (audit DoD #3).
 *
 * - `weeklyScheduleId` given: the id is `${weeklyScheduleId}_${date}` and the
 *   server builds the payload from the stored slot, so a client cannot invent
 *   a subject or room for somebody else's recurring class.
 * - Otherwise: the id is derived from faculty + date + start time + subject +
 *   cohort, so the same ad-hoc class always resolves to the same document.
 *
 * Returns the session either way, with `created` telling the caller whether
 * this call created it. An existing session is never overwritten.
 */
export const ensureClassSession = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveSessionWriter(uid, request.auth?.token || {})
    const input = validateEnsureInput(request.data)

    const privileged = SCHEDULING_ROLES.includes(staff.role)
    // Self-service callers may only touch their own classes. "Own" means any
    // id this person is filed under — their auth uid or their faculty profile
    // id, which is what the timetable, the curriculum mappings and therefore
    // the client's session list actually carry.
    const requestedFacultyId = cleanText(input.facultyId)
    // An omitted facultyId means "mine" — it used to default to the caller's
    // uid, and the faculty Topics/attendance paths rely on that.
    const ownsRequested =
      privileged || !requestedFacultyId ? true : await callerOwnsFaculty(staff, requestedFacultyId)
    if (!ownsRequested) {
      throw new HttpsError('permission-denied', 'You can only manage your own class sessions')
    }
    // Keep the id the caller was given: every other reader (timetable, session
    // list, progress) queries by that value, so normalising it to the uid here
    // would make the session it just created invisible to them.
    const facultyId = requestedFacultyId || staff.uid
    if (!facultyId) throw new HttpsError('invalid-argument', 'facultyId is required')

    const db = getFirestore(admin.app(), 'default')

    // A recurring slot is authoritative about what the class actually is.
    let slot: WeeklySlot | null = null
    if (input.weeklyScheduleId) {
      const slotSnap = await db.collection('weeklySchedules').doc(input.weeklyScheduleId).get()
      if (!slotSnap.exists) throw new HttpsError('not-found', 'Weekly schedule not found')
      if (String(slotSnap.data()?.collegeId || '') !== staff.collegeId) {
        throw new HttpsError('permission-denied', 'Weekly schedule belongs to another college')
      }
      slot = { id: slotSnap.id, ...(slotSnap.data() as Record<string, unknown>) }
    }

    // One shape either way; ensureSessionId prefers weeklyScheduleId when the
    // slot supplies one and falls back to the ad-hoc hash when it does not.
    const target: AdhocSessionParts & { weeklyScheduleId?: unknown } = {
      weeklyScheduleId: slot ? slot.id : '',
      facultyId: slot ? slot.facultyId : facultyId,
      date: input.date,
      startTime: slot ? slot.startTime : input.startTime,
      subject: slot ? slot.subject : input.subject,
      subjectCode: slot ? slot.subjectCode : input.subjectCode,
      branch: slot ? slot.branch : input.branch,
      batch: slot ? slot.batch : input.batch,
      division: slot ? slot.division : input.division,
    }
    const sessionId = ensureSessionId(target)
    const ref = db.collection('classSessions').doc(sessionId)

    // ─── S2.5: an ad-hoc session must not double-book anyone either ────────
    // Attendance marking arrives here for sessions that already exist, and
    // those are returned untouched below, so this only ever gates a genuinely
    // new class.
    const allowConflicts = (request.data as Record<string, unknown> | undefined)?.allowConflicts === true
    if (!allowConflicts) {
      const sameDaySnap = await db
        .collection('classSessions')
        .where('collegeId', '==', staff.collegeId)
        .where('date', '==', input.date)
        .limit(MAX_PROGRESS_SESSIONS)
        .get()
      const others: SessionCandidate[] = sameDaySnap.docs
        .filter((doc) => doc.id !== sessionId)
        .map((doc) =>
          toConflictCandidate({
            id: doc.id,
            collegeId: staff.collegeId,
            ...(doc.data() as Record<string, unknown>),
          })
        )
      const candidate = slot
        ? toConflictCandidate({
            id: sessionId,
            collegeId: staff.collegeId,
            date: input.date,
            facultyId: slot.facultyId,
            room: slot.room,
            startTime: slot.startTime,
            endTime: slot.endTime,
            branch: slot.branch,
            batch: slot.batch,
            division: slot.division,
            subject: slot.subject,
          })
        : toConflictCandidate({
            id: sessionId,
            collegeId: staff.collegeId,
            date: input.date,
            facultyId,
            room: input.room,
            startTime: input.startTime,
            endTime: input.endTime,
            branch: input.branch,
            batch: input.batch,
            division: input.division,
            subject: input.subject,
          })
      const blocking = hardClashes(findSessionClashes(candidate, others))
      if (blocking.length > 0) {
        throw new HttpsError(
          'failed-precondition',
          blocking[0] ? describeConflict(blocking[0]) : 'This class would double-book a faculty member or a room.',
          conflictDetails(blocking)
        )
      }
    }

    const result = await db.runTransaction(async (txn) => {
      const existing = await txn.get(ref)
      if (existing.exists) {
        // Already there — this is the normal case once a term is generated.
        // Deliberately not overwritten: the stored session is the record.
        return { id: sessionId, created: false, data: existing.data() || {} }
      }
      const now = new Date()
      const payload = slot
        ? {
            ...buildSessionDoc(slot, input.date, now, slot.assignmentId ? String(slot.assignmentId) : undefined),
            subjectKey: subjectKey(slot.subject, slot.subjectCode),
            topicsCovered: input.topic ? [input.topic] : [],
            createdBy: uid,
          }
        : buildAdhocSessionDoc({ ...input, facultyId }, staff.collegeId, uid, now)
      txn.set(ref, payload)
      return { id: sessionId, created: true, data: payload }
    })

    logger.info('[classSchedule] ensureClassSession', {
      collegeId: staff.collegeId,
      sessionId,
      created: result.created,
      weeklyScheduleId: input.weeklyScheduleId || null,
      actorUid: uid,
    })

    return {
      id: result.id,
      created: result.created,
      date: input.date,
      weeklyScheduleId: input.weeklyScheduleId || '',
      status: String(result.data.status || 'scheduled'),
      attendanceMarked: Boolean(result.data.attendanceMarked),
    }
  }
)

// ─── S2.3: topic attachment + the coverage ledger ──────────────────────────
//
// Finding F3: `topicsCovered` on a session is free text. Nothing links a
// delivered class to a topic record, so completing a lecture cannot update the
// faculty topic ledger and coverage per course/semester cannot be computed.
// The curriculum mapping stores totalHours/credits/modulesCount snapshots that
// nothing ever compares against actuals.
//
// `completeClassSession` closes that loop in ONE transaction: it writes the
// session's `topicIds` and flips the faculty's ledger rows for those topics, so
// a completed lecture and the ledger can never disagree.

/** Upper bound on topics attached to one session, to bound the transaction. */
export const MAX_TOPICS_PER_SESSION = 50

/**
 * Upper bound on the `facultyId` values one completion reads a teacher ledger
 * for. The real set is 2–3; the cap only exists so a profile with a pile of
 * stale alias fields cannot fan the callable out.
 */
export const MAX_LEDGER_FACULTY_IDS = 6

/**
 * Statuses that mean "this topic has been taught". Both spellings are in the
 * data: `FacultyTopic` (facultyApi) declares 'covered', while the faculty
 * ledger UI (src/modules/faculty/pages/FacultyTopics.tsx) counts 'completed'.
 */
export const COVERED_STATUSES = ['covered', 'completed']

/** The status completeClassSession writes on the faculty ledger. */
export const LEDGER_COVERED_STATUS = 'completed'

export function isTopicCovered(status: unknown): boolean {
  return COVERED_STATUSES.includes(String(status || '').trim().toLowerCase())
}

/**
 * Additive-only status transition. A topic already marked covered is never
 * walked back to pending — the standing constraint on `facultyTopics` is
 * additive writes only, and silently un-teaching a topic would corrupt the
 * coverage numbers S2.4 computes from this ledger.
 */
export function nextTopicStatus(current: unknown, target: string): string {
  return isTopicCovered(current) ? String(current) : target
}

/** Loose key for matching a topic across `topics/*` and `facultyTopics`. */
export function normalizeTopicKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Order-preserving union of two string lists, de-duplicated on the normalised
 * key and capped. Used for `topicIds` and `topicsCovered`, both of which
 * accumulate across re-completions rather than being replaced.
 */
export function mergeUnique(existing: unknown, incoming: unknown, cap = MAX_TOPICS_PER_SESSION): string[] {
  const toList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : []
  const merged: string[] = []
  const seen = new Set<string>()
  for (const item of [...toList(existing), ...toList(incoming)]) {
    const key = normalizeTopicKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(item)
    if (merged.length >= cap) break
  }
  return merged
}

/** One attached topic: an optional id plus the display title. */
export interface CompletionTopicPair {
  topicId: string
  title: string
}

export interface CompleteSessionInput {
  sessionId: string
  topicIds: string[]
  topicTitles: string[]
  /**
   * Preferred payload: id+title pairs straight from the picker. Curriculum
   * topics selected from an ASSIGNED curriculum document carry a composite
   * id (`curriculumId__module__topicKey`), which cannot be resolved against
   * the `topics/*` bank — so the title must ride along with the id. Older
   * clients that send only topicIds/topicTitles keep working.
   */
  topics: CompletionTopicPair[]
  notes: string
}

export function validateCompleteInput(data: unknown): CompleteSessionInput {
  const raw = (data || {}) as Record<string, unknown>
  const sessionId = String(raw.sessionId ?? '').trim()
  if (!sessionId || sessionId.includes('/') || sessionId.length > 200) {
    throw new HttpsError('invalid-argument', 'sessionId is required')
  }
  const collect = (value: unknown, field: string): string[] => {
    if (value === undefined || value === null || value === '') return []
    if (!Array.isArray(value)) throw new HttpsError('invalid-argument', `${field} must be a list`)
    if (value.length > MAX_TOPICS_PER_SESSION) {
      throw new HttpsError(
        'invalid-argument',
        `At most ${MAX_TOPICS_PER_SESSION} topics can be attached to one session`
      )
    }
    return value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, MAX_TOPICS_PER_SESSION)
  }
  const collectTopics = (value: unknown): CompletionTopicPair[] => {
    if (value === undefined || value === null || value === '') return []
    if (!Array.isArray(value)) throw new HttpsError('invalid-argument', 'topics must be a list')
    if (value.length > MAX_TOPICS_PER_SESSION) {
      throw new HttpsError(
        'invalid-argument',
        `At most ${MAX_TOPICS_PER_SESSION} topics can be attached to one session`
      )
    }
    return value
      .map((item) => {
        const record = (item || {}) as Record<string, unknown>
        return {
          topicId: String(record.topicId ?? '').trim().slice(0, 300),
          title: String(record.title ?? '').trim().slice(0, 300),
        }
      })
      .filter((pair) => pair.topicId || pair.title)
      .slice(0, MAX_TOPICS_PER_SESSION)
  }
  return {
    sessionId,
    topicIds: collect(raw.topicIds, 'topicIds'),
    // The handoff keeps free text as the display fallback, so a faculty member
    // can always type "Integration by parts" even with no curriculum topic.
    topicTitles: collect(raw.topicTitles, 'topicTitles'),
    topics: collectTopics(raw.topics),
    notes: optionalFilter(raw.notes, 'notes', 2000),
  }
}

/**
 * Collapse the three ways a client can express "topics taught in this class"
 * into one ordered, de-duplicated list:
 *
 *   1. `pairs`       — id+title pairs from the current picker. Curriculum rows
 *                      win here because only they know the composite id.
 *   2. `resolvedIds` — topicIds the handler resolved against `topics/*`
 *                      (legacy clients, or pairs sent with an empty title).
 *   3. `legacyTitles`— free-text titles (the typed fallback).
 *
 * Deduplication is on the normalized title, so the same topic arriving twice
 * (e.g. as a bank id AND its title) is attached — and ledger-matched — once.
 * Entries whose title resolves to nothing are dropped: an id alone cannot be
 * counted as coverage.
 */
export function mergeCompletionTopics(
  pairs: CompletionTopicPair[],
  resolvedIds: CompletionTopicPair[],
  legacyTitles: string[]
): CompletionTopicPair[] {
  const out: CompletionTopicPair[] = []
  const seen = new Set<string>()
  const push = (topicId: string, title: unknown) => {
    const clean = String(title ?? '').trim()
    if (!clean) return
    const key = normalizeTopicKey(clean)
    if (key && seen.has(key)) return
    if (key) seen.add(key)
    out.push({ topicId: String(topicId ?? '').trim(), title: clean })
  }
  for (const pair of pairs) push(pair.topicId, pair.title)
  for (const pair of resolvedIds) push(pair.topicId, pair.title)
  for (const title of legacyTitles) push('', title)
  return out.slice(0, MAX_TOPICS_PER_SESSION)
}

/**
 * Which ledger row a completed topic belongs to, or null when there is none
 * yet and one has to be created. Matches on `topicId` first (the real link),
 * then on the topic title, so rows created before `topicIds` existed still
 * line up.
 */
export function matchLedgerRow(
  rows: Array<{ id: string; data: admin.firestore.DocumentData }>,
  candidate: { topicId: string; title: string }
): { id: string; data: admin.firestore.DocumentData } | null {
  const titleKey = normalizeTopicKey(candidate.title)
  return (
    rows.find((row) => String(row.data.topicId || '') === candidate.topicId) ||
    (titleKey ? rows.find((row) => normalizeTopicKey(row.data.title) === titleKey) : undefined) ||
    null
  )
}

/** The ledger row created when a covered topic has no row yet. */
export function buildLedgerRow(
  topic: { topicId: string; title: string },
  session: admin.firestore.DocumentData,
  sessionId: string,
  collegeId: string,
  now: Date = new Date()
): admin.firestore.DocumentData {
  // Shaped like the rows src/hooks/useTopics.ts writes, so the existing faculty
  // Topics page renders it without changes.
  return {
    title: topic.title,
    description: '',
    course: String(session.branch || ''),
    batch: String(session.batch || ''),
    division: String(session.division || ''),
    plannedDate: '',
    duration: Number(session.durationMinutes || 0) || 0,
    status: LEDGER_COVERED_STATUS,
    resources: [],
    notes: '',
    subject: String(session.subject || ''),
    subjectCode: String(session.subjectCode || ''),
    semester: Number(session.semester || 0) || 0,
    facultyId: String(session.facultyId || ''),
    collegeId,
    // Traceability back to the class that covered it — this is the edge the
    // audit says does not exist yet.
    topicId: topic.topicId,
    sessionId,
    dateCovered: String(session.date || ''),
    coveredAt: now.toISOString(),
    source: 'class-session',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

/**
 * Mark a session complete and flip the faculty topic ledger for the topics it
 * covered — atomically, so a completed lecture and the ledger cannot disagree.
 *
 * Same shape as confirmPaperStructure: read everything, then one transaction.
 * Ledger writes are additive-only: an existing row is moved forward to covered
 * and never back, and a missing row is created rather than the update being
 * dropped.
 */
export const completeClassSession = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 120, minInstances: 0, maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveSessionWriter(uid, request.auth?.token || {})
    const input = validateCompleteInput(request.data)

    const db = getFirestore(admin.app(), 'default')
    const sessionRef = db.collection('classSessions').doc(input.sessionId)

    const sessionSnap = await sessionRef.get()
    if (!sessionSnap.exists) throw new HttpsError('not-found', 'Class session not found')
    const session = sessionSnap.data() || {}
    const privileged = SCHEDULING_ROLES.includes(staff.role)
    // Ownership is alias-aware: a session generated from the timetable carries
    // the faculty PROFILE id of its teacher, not their auth uid, so a raw
    // `===` refused a teacher completing the class they had just taught.
    // Scheduling roles manage the whole college, so they skip the lookup.
    if (!privileged && !(await callerOwnsFaculty(staff, session.facultyId))) {
      throw new HttpsError('permission-denied', 'You can only complete your own class sessions')
    }
    // Tenancy: a session written before collegeId was stamped still has to be
    // completable by the college that owns its timetable, so fall back to the
    // parent slot and only refuse when a college is actually known and is not
    // the caller's.
    const sessionCollege = await resolveSessionCollege(session, staff.collegeId)
    if (sessionCollege && sessionCollege !== staff.collegeId) {
      throw new HttpsError('permission-denied', 'This session belongs to another college')
    }
    // A cancelled session is a class that did not happen; completing it would
    // credit topics that were never taught.
    if (String(session.status || 'scheduled') === 'cancelled') {
      throw new HttpsError('failed-precondition', 'A cancelled session cannot be completed')
    }

    // Resolve every requested topic to {topicId, title}. `topics/*` names the
    // field `name`; the ledger and sessions call the same thing `title`.
    // Pairs from the current client carry their own title, so a curriculum
    // topic with a composite id (not a bank doc) resolves without a lookup;
    // bare ids — legacy clients, or a pair sent without a title — still fall
    // back to the bank read. Unresolvable ids are dropped by the merge below.
    const pairIds = new Set(input.topics.map((pair) => pair.topicId).filter(Boolean))
    const needsLookup = [
      ...new Set([
        ...input.topics.filter((pair) => !pair.title && pair.topicId).map((pair) => pair.topicId),
        ...input.topicIds.filter((id) => !pairIds.has(id)),
      ]),
    ].slice(0, MAX_TOPICS_PER_SESSION)
    const titleById = new Map<string, string>()
    for (const topicId of needsLookup) {
      const topicSnap = await db.collection('topics').doc(topicId).get()
      const data = topicSnap.data()
      const title = String(data?.name || data?.title || '').trim()
      if (topicSnap.exists && title) titleById.set(topicId, title)
    }
    const topics = mergeCompletionTopics(
      input.topics.map((pair) => ({
        topicId: pair.topicId,
        title: pair.title || titleById.get(pair.topicId) || '',
      })),
      input.topicIds
        .filter((id) => titleById.has(id))
        .map((id) => ({ topicId: id, title: String(titleById.get(id)) })),
      input.topicTitles
    )

    // Candidate ledger rows are found before the transaction (Firestore
    // transactions cannot run a fresh query), then re-read inside it.
    //
    // The set is read across EVERY id the teacher is filed under, not just the
    // one on the session: a teacher's own planner rows (Faculty Topics page,
    // written from the browser) are keyed by their auth uid, while the session
    // carries their faculty profile id. Querying only the session's id meant a
    // topic they had already planned was never found, so completing a class
    // CREATED a second row instead of flipping the one they planned against —
    // and the copy the Topics page reads (uid-keyed) kept showing it pending.
    const ledgerFacultyIds = resolveLedgerFacultyIds(session, staff)
    const ledgerSnaps = await Promise.all(
      ledgerFacultyIds.map((facultyId) =>
        db.collection('facultyTopics').where('facultyId', '==', facultyId).limit(300).get()
      )
    )
    const ledgerRows = ledgerSnaps.flatMap((snap) => snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })))

    const now = new Date()
    const stamp = now.toISOString()

    const summary = await db.runTransaction(async (txn) => {
      // Re-read inside the transaction so the union is computed against what is
      // actually stored, not a snapshot from before.
      const freshSession = await txn.get(sessionRef)
      const current = freshSession.data() || {}
      const topicIds = mergeUnique(current.topicIds, topics.map((topic) => topic.topicId))
      const topicsCovered = mergeUnique(
        current.topicsCovered,
        topics.map((topic) => topic.title)
      )

      txn.update(sessionRef, {
        status: 'completed',
        topicIds,
        topicsCovered,
        completedAt: stamp,
        completedBy: uid,
        ...(input.notes ? { notes: input.notes } : {}),
        updatedAt: stamp,
      })

      let rowsUpdated = 0
      let rowsCreated = 0
      let alreadyCovered = 0

      for (const topic of topics) {
        const match = matchLedgerRow(ledgerRows, topic)
        if (match) {
          const rowRef = db.collection('facultyTopics').doc(match.id)
          const freshRow = await txn.get(rowRef)
          const rowData = freshRow.exists ? freshRow.data() || {} : match.data
          if (isTopicCovered(rowData.status)) {
            alreadyCovered += 1
            continue
          }
          txn.update(rowRef, {
            status: nextTopicStatus(rowData.status, LEDGER_COVERED_STATUS),
            dateCovered: String(current.date || session.date || ''),
            coveredAt: stamp,
            sessionId: input.sessionId,
            updatedAt: stamp,
          })
          rowsUpdated += 1
        } else {
          const rowRef = db.collection('facultyTopics').doc()
          txn.set(rowRef, buildLedgerRow(topic, session, input.sessionId, staff.collegeId, now))
          rowsCreated += 1
        }
      }

      return { topicIds, topicsCovered, rowsUpdated, rowsCreated, alreadyCovered }
    })

    logger.info('[classSchedule] completeClassSession', {
      collegeId: staff.collegeId,
      sessionId: input.sessionId,
      topics: topics.length,
      rowsCreated: summary.rowsCreated,
      rowsUpdated: summary.rowsUpdated,
      alreadyCovered: summary.alreadyCovered,
      actorUid: uid,
    })

    return {
      id: input.sessionId,
      status: 'completed',
      topicIds: summary.topicIds,
      topicsCovered: summary.topicsCovered,
      topicsAttached: topics.length,
      ledgerRowsCreated: summary.rowsCreated,
      ledgerRowsUpdated: summary.rowsUpdated,
      alreadyCovered: summary.alreadyCovered,
    }
  }
)

// ─── S2.4: real curriculum coverage ────────────────────────────────────────
//
// Finding F4: the "Coverage/Journey" analytics are fake in this area.
// src/modules/admin/hooks/useJourney.ts reads `faculty.topicsCovered` — a
// static number typed into the faculty document — hardcodes `classesThisWeek:
// 0` and defaults `avgAttendance` to 85. Admins see a gauge computed from
// nothing.
//
// `getCurriculumProgress` computes all of it from the data the previous
// sub-slices made trustworthy: the faculty topic ledger (S2.3), the
// materialised sessions (S2.1/S2.2) and the curriculum mapping's planned
// hours.

/** How many faculties one progress call will analyse. Bounds the fan-out. */
export const MAX_PROGRESS_FACULTIES = 40

/** Sessions / topics / mappings read per call, to bound the callable. */
export const MAX_PROGRESS_SESSIONS = 2000
export const MAX_PROGRESS_MAPPINGS = 500
export const MAX_PROGRESS_TOPICS = 300
export const MAX_PROGRESS_CURRICULUM_DOCS = 10

/**
 * The planned topics for a faculty member, flattened out of the ASSIGNED
 * curriculum documents referenced by their active mappings — the same source
 * src/modules/faculty/api/sessionTopicsApi.ts uses for the picker. Course
 * matching mirrors the picker: id first, then code, then name, so a mapping
 * created before the id work still resolves.
 */
export function plannedTopicsFromCurriculum(
  mappings: Array<Record<string, unknown>>,
  curriculumDocs: Array<{ id: string; data: admin.firestore.DocumentData }>
): Array<{ title: string; moduleNo: string; moduleName: string; hours: number }> {
  const docById = new Map(curriculumDocs.map((entry) => [entry.id, entry.data]))
  const out: Array<{ title: string; moduleNo: string; moduleName: string; hours: number }> = []
  const seen = new Set<string>()
  for (const mapping of mappings) {
    const curriculum = docById.get(String(mapping.curriculumId || ''))
    if (!curriculum) continue
    const courses: any[] = Array.isArray(curriculum.courses) ? curriculum.courses : []
    const course =
      (String(mapping.courseId || '') && courses.find((c) => String(c?.id || '') === String(mapping.courseId))) ||
      (String(mapping.courseCode || '') && courses.find((c) => String(c?.code || '') === String(mapping.courseCode))) ||
      (String(mapping.courseName || '') && courses.find((c) => String(c?.name || '') === String(mapping.courseName)))
    if (!course) continue
    const modules: any[] = Array.isArray(course.modules) ? course.modules : []
    for (const mod of modules) {
      const topics: unknown[] = Array.isArray(mod?.topics) ? mod.topics : []
      for (const raw of topics) {
        const title = String(raw ?? '').trim()
        if (!title) continue
        const key = normalizeTopicKey(title)
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push({
          title,
          moduleNo: String(mod?.moduleNo ?? ''),
          moduleName: String(mod?.moduleName || mod?.title || ''),
          hours: Number(mod?.hours) || 0,
        })
      }
    }
  }
  return out
}

export interface ModuleProgress {
  moduleNo: string
  moduleName: string
  /** Planned teaching hours for the module (0 when the syllabus did not say). */
  hours: number
  /**
   * Whole 50-minute classes the module's hours translate to (ceiling). The
   * answer to "there are more topics than fit in one class": each module is
   * planned as this many periods, and topics are ticked off across them.
   */
  classesNeeded: number
  total: number
  covered: number
  pct: number
}

export interface FacultyProgress {
  facultyId: string
  facultyName: string
  courses: Array<{
    curriculumId: string
    courseName: string
    courseCode: string
    branch: string
    batch: string
    semester: number
    totalHours: number
    credits: number
    modulesCount: number
  }>
  hoursPlanned: number
  hoursDelivered: number
  hoursPct: number
  /** Whole classes (periodMinutes long) the planned hours translate to. */
  classesNeeded: number
  topics: { total: number; covered: number; pending: number; pct: number }
  modules: ModuleProgress[]
  sessions: { total: number; completed: number; scheduled: number; cancelled: number }
  pace: { slotsPerWeek: number; weeksElapsed: number; expected: number; completed: number; pct: number }
  attendance: { present: number; marked: number; pct: number }
}

// ─── Pure maths (unit-tested) ──────────────────────────────────────────────

/**
 * One teaching period is 50 minutes (the auto-schedule grid default — see
 * DEFAULT_GRID.periodMinutes in autoSchedule.ts). Syllabi plan in 60-minute
 * "hours", so planned hours translate to MORE periods than hours:
 * 8 module hours = 480 minutes = 9.6 → 10 classes of 50 minutes. This is the
 * number behind "not every topic fits in one class".
 */
export const DEFAULT_PERIOD_MINUTES = 50

/**
 * How many whole classes a planned-hours figure needs at the college's period
 * length. Rounds UP — a module needing 9.6 periods occupies 10 diary slots.
 * The epsilon keeps exact boundaries exact in binary floating point (e.g.
 * 25/6 hours = 5.0 classes, not 6, even though (25/6)*60/50 lands a hair
 * above 5).
 */
export function classesNeededForHours(
  hours: number,
  periodMinutes: number = DEFAULT_PERIOD_MINUTES
): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0
  if (!Number.isFinite(periodMinutes) || periodMinutes <= 0) return 0
  return Math.ceil((hours * 60) / periodMinutes - 1e-9)
}

/** Percentage that answers 0 instead of NaN/Infinity when nothing is planned. */
export function percent(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

/** Contact minutes → hours, to one decimal. */
export function hoursFromMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.round((minutes / 60) * 10) / 10
}

/**
 * Whole weeks covered by an inclusive date range.
 *
 * A semester is counted in teaching weeks, so a partial week still counts as a
 * week of teaching — hence ceiling rather than flooring.
 */
export function weeksBetween(from: string, to: string): number {
  const start = parseDateKey(from).getTime()
  const end = parseDateKey(to).getTime()
  if (end < start) return 0
  return Math.ceil((end - start) / 604_800_000 + 1e-9) || 0
}

/**
 * How many classes the timetable promised by now. `slotsPerWeek` comes from the
 * live weekly schedule, so the denominator is the college's own plan rather
 * than an assumed number.
 */
export function expectedSessions(slotsPerWeek: number, weeksElapsed: number): number {
  if (!Number.isFinite(slotsPerWeek) || !Number.isFinite(weeksElapsed)) return 0
  if (slotsPerWeek <= 0 || weeksElapsed <= 0) return 0
  return Math.round(slotsPerWeek * weeksElapsed)
}

export function pacePercent(completed: number, expected: number): number {
  return percent(completed, expected)
}

/**
 * Per-module rollup. Rows with no module number are grouped under a single
 * "Unassigned" bucket rather than dropped, so the totals still add up.
 * `hours` is the module's planned teaching time (rows of one module repeat the
 * figure, so the MAX is kept), and `classesNeeded` converts it to 50-minute
 * periods — the planning answer to "how many classes does this module need".
 */
export function moduleRollup(
  entries: Array<{ moduleNo?: unknown; moduleName?: unknown; covered: boolean; hours?: unknown }>
): ModuleProgress[] {
  const buckets = new Map<string, ModuleProgress>()
  entries.forEach((entry) => {
    const moduleNo = String(entry.moduleNo ?? '').trim()
    const key = moduleNo || '—'
    const bucket =
      buckets.get(key) ||
      ({
        moduleNo,
        moduleName: String(entry.moduleName ?? '').trim() || (moduleNo ? `Module ${moduleNo}` : 'Unassigned'),
        hours: 0,
        classesNeeded: 0,
        total: 0,
        covered: 0,
        pct: 0,
      } as ModuleProgress)
    bucket.total += 1
    if (entry.covered) bucket.covered += 1
    bucket.hours = Math.max(bucket.hours, Number(entry.hours) || 0)
    buckets.set(key, bucket)
  })
  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      classesNeeded: classesNeededForHours(bucket.hours),
      pct: percent(bucket.covered, bucket.total),
    }))
    .sort((a, b) => a.moduleNo.localeCompare(b.moduleNo, 'en', { numeric: true }))
}

/** Totals across faculties. Courses and modules are concatenated, not summed. */
export function sumProgress(list: FacultyProgress[]): FacultyProgress {
  const empty: FacultyProgress = {
    facultyId: '',
    facultyName: 'All faculty',
    courses: [],
    hoursPlanned: 0,
    hoursDelivered: 0,
    hoursPct: 0,
    classesNeeded: 0,
    topics: { total: 0, covered: 0, pending: 0, pct: 0 },
    modules: [],
    sessions: { total: 0, completed: 0, scheduled: 0, cancelled: 0 },
    pace: { slotsPerWeek: 0, weeksElapsed: 0, expected: 0, completed: 0, pct: 0 },
    attendance: { present: 0, marked: 0, pct: 0 },
  }
  const totals = list.reduce<FacultyProgress>((acc, item) => {
    const next: FacultyProgress = {
      ...acc,
      courses: [...acc.courses, ...item.courses],
      hoursPlanned: acc.hoursPlanned + item.hoursPlanned,
      hoursDelivered: Math.round((acc.hoursDelivered + item.hoursDelivered) * 10) / 10,
      topics: {
        total: acc.topics.total + item.topics.total,
        covered: acc.topics.covered + item.topics.covered,
        pending: acc.topics.pending + item.topics.pending,
        pct: 0,
      },
      modules: [...acc.modules, ...item.modules],
      sessions: {
        total: acc.sessions.total + item.sessions.total,
        completed: acc.sessions.completed + item.sessions.completed,
        scheduled: acc.sessions.scheduled + item.sessions.scheduled,
        cancelled: acc.sessions.cancelled + item.sessions.cancelled,
      },
      pace: {
        slotsPerWeek: acc.pace.slotsPerWeek + item.pace.slotsPerWeek,
        weeksElapsed: Math.max(acc.pace.weeksElapsed, item.pace.weeksElapsed),
        expected: acc.pace.expected + item.pace.expected,
        completed: acc.pace.completed + item.pace.completed,
        pct: 0,
      },
      attendance: {
        present: acc.attendance.present + item.attendance.present,
        marked: acc.attendance.marked + item.attendance.marked,
        pct: 0,
      },
    }
    return next
  }, empty)
  return {
    ...totals,
    hoursPct: percent(totals.hoursDelivered, totals.hoursPlanned),
    // Recomputed from the summed hours rather than summed per-faculty ceilings.
    classesNeeded: classesNeededForHours(totals.hoursPlanned),
    topics: { ...totals.topics, pct: percent(totals.topics.covered, totals.topics.total) },
    pace: { ...totals.pace, pct: percent(totals.pace.completed, totals.pace.expected) },
    attendance: { ...totals.attendance, pct: percent(totals.attendance.present, totals.attendance.marked) },
  }
}

/** Later of two date keys, used to clamp "elapsed" to the end of term. */
export function laterDateKey(a: string, b: string): string {
  if (!isValidDateKey(a)) return b
  if (!isValidDateKey(b)) return a
  return a >= b ? a : b
}

/** Earlier of two date keys. */
export function earlierDateKey(a: string, b: string): string {
  if (!isValidDateKey(a)) return b
  if (!isValidDateKey(b)) return a
  return a <= b ? a : b
}

// ─── Callable ──────────────────────────────────────────────────────────────

interface ProgressTopicRow {
  title: string
  moduleNo: string
  moduleName: string
  covered: boolean
  /** Planned hours of the owning module (0 for legacy/ledger-only rows). */
  hours?: number
}

/**
 * Merge the faculty ledger (`facultyTopics`) with the curriculum bank
 * (`topics/*`) into one coverage list.
 *
 * The two stores have no join, so the key is the normalised title. A topic is
 * covered if *either* side says so: the ledger carries the status the faculty
 * planner writes, and a session completion (S2.3) covers a topic by title even
 * when no ledger row existed.
 */
export function mergeTopicCoverage(
  ledger: ProgressTopicRow[],
  coveredTitles: Set<string>
): ProgressTopicRow[] {
  const merged = new Map<string, ProgressTopicRow>()
  const add = (row: ProgressTopicRow) => {
    const key = normalizeTopicKey(row.title)
    if (!key) return
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...row, covered: row.covered || coveredTitles.has(key) })
      return
    }
    merged.set(key, {
      ...existing,
      moduleNo: existing.moduleNo || row.moduleNo,
      moduleName: existing.moduleName || row.moduleName,
      hours: Math.max(Number(existing.hours) || 0, Number(row.hours) || 0),
      covered: existing.covered || row.covered || coveredTitles.has(key),
    })
  }
  ledger.forEach(add)
  return [...merged.values()]
}

export interface ProgressInput {
  collegeId: string
  facultyId: string
  batch: string
  branch: string
  semester: string
  curriculumId: string
  from: string
  to: string
}

export function validateProgressInput(
  data: unknown,
  role: string,
  claimCollegeId: string
): ProgressInput {
  const raw = (data || {}) as Record<string, unknown>
  const collegeId = role === 'superadmin' ? String(raw.collegeId ?? '').trim() : claimCollegeId
  if (!collegeId) {
    throw new HttpsError('invalid-argument', 'No college is associated with this account')
  }
  const from = String(raw.from ?? '').trim()
  const to = String(raw.to ?? '').trim()
  if (from && !isValidDateKey(from)) throw new HttpsError('invalid-argument', 'from must be yyyy-mm-dd')
  if (to && !isValidDateKey(to)) throw new HttpsError('invalid-argument', 'to must be yyyy-mm-dd')
  if (from && to && from > to) {
    throw new HttpsError('invalid-argument', 'from must be on or before to')
  }
  return {
    collegeId,
    facultyId: optionalFilter(raw.facultyId, 'facultyId', 200),
    batch: optionalFilter(raw.batch, 'batch', 100),
    branch: optionalFilter(raw.branch, 'branch', 100),
    semester: optionalFilter(raw.semester, 'semester', 10),
    curriculumId: optionalFilter(raw.curriculumId, 'curriculumId', 200),
    from,
    to,
  }
}

function matchesProgressFilter(value: unknown, wanted: string): boolean {
  if (!wanted) return true
  return String(value ?? '').trim().toLowerCase() === wanted.toLowerCase()
}

/**
 * Coverage and pace for a college, a single faculty member, or one cohort.
 *
 * Everything here is computed — topics from the faculty ledger plus the
 * curriculum bank, delivered hours from completed session durations, and pace
 * against the number of classes the college's own timetable promised by now.
 */
export const getCurriculumProgress = onCall(
  { region: 'asia-south1', memory: '1GiB', timeoutSeconds: 120, minInstances: 0, maxInstances: 10 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveSessionWriter(uid, request.auth?.token || {})
    const input = validateProgressInput(request.data, staff.role, staff.collegeId)

    // Faculty may only read their own progress; scheduling roles may read the
    // whole college. A self-service caller is matched by ANY of the ids they
    // are filed under, because the mappings and the sessions below are keyed on
    // the faculty profile id while the caller arrives as an auth uid.
    const privileged = SCHEDULING_ROLES.includes(staff.role)
    const selfIds = privileged ? [] : mergeIdentityIds(staff.uid, await loadFacultyAliases(staff.uid))
    const matchesFaculty = (facultyId: unknown): boolean => {
      if (privileged) {
        return !input.facultyId || cleanText(facultyId) === cleanText(input.facultyId)
      }
      return callerOwnsFacultyId({ uid: staff.uid, ids: selfIds }, facultyId)
    }
    const facultyFilter = privileged ? cleanText(input.facultyId) : ''
    // Per-row join: a session/slot and a mapping are joined on the faculty id
    // they each carry, and those two can be the same person's two spellings
    // (timetable rows keyed by profile id, ad-hoc rows keyed by auth uid). A
    // self-service caller is that person, so their own rows join either way;
    // for a scheduling role the raw comparison is kept, because "no filter"
    // must never mean "everybody's".
    const isSameFaculty = (rowFacultyId: unknown, subjectFacultyId: unknown): boolean => {
      const row = cleanText(rowFacultyId)
      const subject = cleanText(subjectFacultyId)
      if (row && row === subject) return true
      return !privileged && callerOwnsFacultyId({ uid: staff.uid, ids: selfIds }, subject)
    }

    const db = getFirestore(admin.app(), 'default')

    // ─── Plan: what was assigned, and what the timetable promises ──────────
    const mappingsSnap = await db
      .collection('curriculumFacultyMappings')
      .where('collegeId', '==', input.collegeId)
      .limit(MAX_PROGRESS_MAPPINGS)
      .get()

    const mappings = mappingsSnap.docs
      .map((doc): Record<string, unknown> & { id: string } => ({
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
      }))
      .filter((mapping) => {
        if (!matchesFaculty(mapping.facultyId)) return false
        if (input.curriculumId && String(mapping.curriculumId || '') !== input.curriculumId) return false
        if (!matchesProgressFilter(mapping.batch, input.batch)) return false
        if (!matchesProgressFilter(mapping.branch, input.branch)) return false
        if (input.semester && String(mapping.semester ?? '') !== input.semester) return false
        return true
      })

    const facultyIds = [...new Set(mappings.map((m) => String(m.facultyId || '')).filter(Boolean))].slice(
      0,
      MAX_PROGRESS_FACULTIES
    )

    // Sessions: collegeId+date is an existing composite index, so an explicit
    // range is cheap. Without one, fall back to the newest sessions.
    let sessionQuery: admin.firestore.Query = db
      .collection('classSessions')
      .where('collegeId', '==', input.collegeId)
    if (input.from) sessionQuery = sessionQuery.where('date', '>=', input.from)
    if (input.to) sessionQuery = sessionQuery.where('date', '<=', input.to)
    const sessionsSnap = await sessionQuery.limit(MAX_PROGRESS_SESSIONS).get()
    const sessions: Array<Record<string, unknown>> = sessionsSnap.docs.map((doc) => doc.data())

    const weeklySnap = await db
      .collection('weeklySchedules')
      .where('collegeId', '==', input.collegeId)
      .limit(MAX_PROGRESS_MAPPINGS)
      .get()
    const weeklySlots = weeklySnap.docs
      .map((doc): Record<string, unknown> & { id: string } => ({
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
      }))
      .filter((slot) => isSlotActive(slot as WeeklySlot))

    // ─── Per faculty ──────────────────────────────────────────────────────
    const perFaculty: FacultyProgress[] = []

    for (const facultyId of facultyIds) {
      const facultyMappings = mappings.filter((m) => String(m.facultyId || '') === facultyId)
      const facultySessions = sessions.filter((s) => isSameFaculty(s.facultyId, facultyId))

      // The faculty's own planner ledger. The curriculum PLAN is fetched
      // below from the assigned documents — the old second input here was a
      // query on the shared `topics` bank by facultyId, and since bank rows
      // carry no facultyId it returned nothing for every faculty member
      // (progress rendered 0 planned topics unless they hand-created rows).
      const ledgerSnap = await db
        .collection('facultyTopics')
        .where('facultyId', '==', facultyId)
        .limit(MAX_PROGRESS_TOPICS)
        .get()

      const curriculumIds = [
        ...new Set(
          facultyMappings.map((m) => String(m.curriculumId || '')).filter(Boolean)
        ),
      ].slice(0, MAX_PROGRESS_CURRICULUM_DOCS)
      const curriculumSnaps = curriculumIds.length
        ? await db.getAll(...curriculumIds.map((id) => db.collection('curriculum').doc(id)))
        : []
      const curriculumDocs = curriculumSnaps
        .filter((snap): snap is admin.firestore.DocumentSnapshot => Boolean(snap && snap.exists))
        .map((snap) => ({ id: snap.id, data: snap.data() || {} }))

      // Titles the faculty has actually taught, from completed sessions.
      const coveredTitles = new Set<string>()
      facultySessions
        .filter((s) => String(s.status || '') === 'completed')
        .forEach((s) => {
          const ids = Array.isArray(s.topicIds) ? s.topicIds : []
          const titles = Array.isArray(s.topicsCovered) ? s.topicsCovered : []
          titles.forEach((title) => {
            const key = normalizeTopicKey(title)
            if (key) coveredTitles.add(key)
          })
          void ids
        })

      // Curriculum rows lead so they contribute module numbers/names; a title
      // that ALSO has a ledger row keeps its covered flag through the merge
      // (mergeTopicCoverage ORs coverage across every row with that key).
      const rows: ProgressTopicRow[] = [
        ...plannedTopicsFromCurriculum(facultyMappings, curriculumDocs).map((row) => ({
          ...row,
          covered: false,
        })),
        ...ledgerSnap.docs.map((doc) => {
          const data = doc.data()
          return {
            title: String(data.title || data.name || ''),
            moduleNo: String(data.moduleNo || ''),
            moduleName: String(data.moduleName || data.unit || ''),
            covered: isTopicCovered(data.status),
          }
        }),
      ]
      const topics = mergeTopicCoverage(rows, coveredTitles)
      const topicsCovered = topics.filter((topic) => topic.covered).length

      // Delivered hours come from completed sessions only — a scheduled class
      // is a promise, not delivery.
      const completed = facultySessions.filter((s) => String(s.status || '') === 'completed')
      const deliveredMinutes = completed.reduce(
        (sum, s) => sum + (Number(s.durationMinutes) > 0 ? Number(s.durationMinutes) : 60),
        0
      )

      const slotsPerWeek = weeklySlots.filter(
        (slot) => isSameFaculty(slot.facultyId, facultyId)
      ).length

      // Term window: what the caller asked for, else what actually happened.
      const sessionDates = facultySessions
        .map((s) => normalizeSessionDate(s.date))
        .filter((date): date is string => Boolean(date))
        .sort()
      const today = todayKey()
      const termStart = input.from || sessionDates[0] || today
      const termEnd = earlierDateKey(input.to || sessionDates[sessionDates.length - 1] || today, today)
      const weeksElapsed =
        termEnd && termStart && termEnd >= termStart ? weeksBetween(termStart, termEnd) : 0
      const expected = expectedSessions(slotsPerWeek, weeksElapsed)

      const attendanceMarked = facultySessions.reduce(
        (sum, s) => sum + (Number(s.attendanceCount) || 0),
        0
      )
      const attendancePresent = facultySessions.reduce(
        (sum, s) => sum + (Number(s.presentCount) || 0),
        0
      )

      const hoursPlanned = facultyMappings.reduce((sum, m) => sum + (Number(m.totalHours) || 0), 0)

      perFaculty.push({
        facultyId,
        facultyName: String(facultyMappings[0]?.facultyName || ''),
        courses: facultyMappings.map((m) => ({
          curriculumId: String(m.curriculumId || ''),
          courseName: String(m.courseName || ''),
          courseCode: String(m.courseCode || ''),
          branch: String(m.branch || ''),
          batch: String(m.batch || ''),
          semester: Number(m.semester) || 0,
          totalHours: Number(m.totalHours) || 0,
          credits: Number(m.credits) || 0,
          modulesCount: Number(m.modulesCount) || 0,
        })),
        hoursPlanned,
        hoursDelivered: hoursFromMinutes(deliveredMinutes),
        hoursPct: percent(hoursFromMinutes(deliveredMinutes), hoursPlanned),
        classesNeeded: classesNeededForHours(hoursPlanned),
        topics: {
          total: topics.length,
          covered: topicsCovered,
          pending: topics.length - topicsCovered,
          pct: percent(topicsCovered, topics.length),
        },
        modules: moduleRollup(topics),
        sessions: {
          total: facultySessions.length,
          completed: completed.length,
          scheduled: facultySessions.filter((s) => String(s.status || 'scheduled') === 'scheduled').length,
          cancelled: facultySessions.filter((s) => String(s.status || '') === 'cancelled').length,
        },
        pace: {
          slotsPerWeek,
          weeksElapsed,
          expected,
          completed: completed.length,
          pct: percent(completed.length, expected),
        },
        attendance: {
          present: attendancePresent,
          marked: attendanceMarked,
          pct: percent(attendancePresent, attendanceMarked),
        },
      })
    }

    const totals = sumProgress(perFaculty)

    logger.info('[classSchedule] getCurriculumProgress', {
      collegeId: input.collegeId,
      facultyFilter: facultyFilter || null,
      faculties: perFaculty.length,
      sessions: sessions.length,
      actorUid: uid,
    })

    return {
      collegeId: input.collegeId,
      from: input.from,
      to: input.to,
      generatedAt: new Date().toISOString(),
      facultyCount: perFaculty.length,
      faculty: perFaculty,
      totals,
    }
  }
)
