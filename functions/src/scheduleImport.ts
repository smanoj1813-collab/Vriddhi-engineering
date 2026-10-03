import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// ─────────────────────────────────────────────────────────────────────────────
// Bulk schedule import — validate, clash-check and (only when asked) write.
//
// WHY THIS EXISTS
// The admin's "Bulk Upload Schedules" dialog used to paste a CSV, split it on
// commas, and writeBatch the rows straight into weeklySchedules — no
// validation (a bad dayOfWeek silently became monday), no clash check (the
// whole WithClashCheck layer in scheduleApi.ts had zero callers), no dedupe
// (upload the file twice, teach two classes at once), and no link back to the
// curriculum mappings (a subject typed slightly differently is invisible to
// "My Curriculum" and topic coverage).
//
// This callable is the new single path:
//   preview  — dryRun: true (default). Parses, normalises, validates every
//              row, de-duplicates against the college's active timetable,
//              runs the SAME pure clash maths used by generateClassSessions
//              (utils/timetableConflicts.ts), and cross-references each row
//              against curriculumFacultyMappings. Returns a per-row report.
//   apply    — dryRun: false. Re-runs the exact same plan on fresh data and
//              writes only the `valid` rows, stamped importedAt/importedBy.
//
// Warnings (cohort clash, subject not in the mapped curriculum, faculty
// differs from the mapped one) never block a row — they surface in the
// preview so the admin decides. Hard clashes (faculty/room) and duplicates
// do block, because both are recoverable typos and neither is physically
// schedulable.
// ─────────────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  HARD_CLASH_KINDS,
  findClashes,
  parseTimeToMinutes,
  type ClashKind,
  type DayOfWeek,
  type ScheduleEntry,
} from './utils/timetableConflicts'
import { resolveSchedulingStaff } from './classSchedule'

// ═════════════════════════════════════════════════════════════════════════════
// CSV parsing (quote-aware)
// ═════════════════════════════════════════════════════════════════════════════

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/**
 * Minimal RFC-4180-ish parser: quoted fields, escaped quotes, CRLF. Returns
 * one object per data row keyed by the lower-cased header names. Blank lines
 * are skipped; the header row must be present.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      if (h) row[h] = (values[idx] ?? '').trim()
    })
    if (Object.values(row).some((v) => v.length > 0)) rows.push(row)
  }
  return rows
}

// ═════════════════════════════════════════════════════════════════════════════
// Normalisation
// ═════════════════════════════════════════════════════════════════════════════

export const SCHEDULE_CLASS_TYPES = ['lecture', 'lab', 'tutorial', 'seminar'] as const
export type ScheduleClassType = (typeof SCHEDULE_CLASS_TYPES)[number]

const TYPE_ALIASES: Record<string, ScheduleClassType> = {
  lecture: 'lecture',
  class: 'lecture',
  period: 'lecture',
  lab: 'lab',
  laboratory: 'lab',
  practical: 'lab',
  tutorial: 'tutorial',
  tut: 'tutorial',
  discussion: 'tutorial',
  seminar: 'seminar',
}

const DAY_ALIASES: Record<string, DayOfWeek> = {
  mon: 'monday',
  monday: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  tuesd: 'tuesday',
  tuesday: 'tuesday',
  wed: 'wednesday',
  wednes: 'wednesday',
  wednesday: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  thursday: 'thursday',
  fri: 'friday',
  friday: 'friday',
  sat: 'saturday',
  saturday: 'saturday',
  sun: 'sunday',
  sunday: 'sunday',
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function normalizeDay(value: unknown): DayOfWeek | null {
  return DAY_ALIASES[String(value ?? '').trim().toLowerCase()] ?? null
}

export function normalizeClassType(value: unknown): ScheduleClassType {
  return TYPE_ALIASES[String(value ?? '').trim().toLowerCase()] ?? 'lecture'
}

export function isValidTime(value: unknown): boolean {
  return TIME_RE.test(String(value ?? '').trim())
}

// ═════════════════════════════════════════════════════════════════════════════
// Plan (pure — unit tested, no Firestore)
// ═════════════════════════════════════════════════════════════════════════════

export interface ImportRow {
  line: number
  subject: string
  subjectCode: string
  facultyId: string
  facultyName: string
  branch: string
  batch: string
  semester: number
  division: string
  section: string
  room: string
  dayOfWeek: DayOfWeek
  startTime: string
  endTime: string
  type: ScheduleClassType
}

export interface ImportExistingSchedule {
  id: string
  subject: string
  subjectCode: string
  facultyId: string
  branch: string
  batch: string
  division: string
  section: string
  room: string
  dayOfWeek: DayOfWeek
  startTime: string
  endTime: string
  type: string
  isActive: boolean
}

export interface ImportMappingRef {
  courseCode: string
  courseName: string
  branch: string
  semester: number
  facultyId: string
  facultyName: string
}

export interface FacultyNameRef {
  uid: string
  name: string
}

export type ImportRowStatus = 'valid' | 'clash' | 'duplicate' | 'invalid'

export interface ImportRowReport {
  line: number
  subject: string
  facultyId: string
  dayOfWeek: string
  startTime: string
  endTime: string
  status: ImportRowStatus
  reasons: string[]
  warnings: string[]
}

export interface ImportPlan {
  rows: ImportRowReport[]
  /** Rows safe to write, in input order. */
  writeable: ImportRow[]
  totals: { total: number; valid: number; clash: number; duplicate: number; invalid: number }
}

export interface ImportFacultyIndex {
  /** facultyId (uid or profile id) → display name */
  byId: Map<string, string>
  /** lower-cased display name → uid */
  byName: Map<string, string>
}

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase()
}

/**
 * Duplicate key: two rows that would schedule the same class twice. The
 * subject is matched by code when both rows carry one (codes are stable
 * across re-typing), else by exact name.
 */
function duplicateKey(row: {
  subject: string
  subjectCode: string
  facultyId: string
  branch: string
  batch: string
  division: string
  section: string
  dayOfWeek: string
  startTime: string
  endTime: string
  type: string
}): string {
  const subjectPart = row.subjectCode ? `code:${norm(row.subjectCode)}` : `name:${norm(row.subject)}`
  return [
    subjectPart,
    norm(row.facultyId),
    norm(row.branch),
    norm(row.batch),
    norm(row.division),
    norm(row.section),
    row.dayOfWeek,
    row.startTime,
    row.endTime,
    row.type,
  ].join('|')
}

function describeClashes(kinds: ClashKind[]): string[] {
  const messages: string[] = []
  if (kinds.includes('faculty')) messages.push('faculty is already booked at this time')
  if (kinds.includes('room')) messages.push('room is already booked at this time')
  if (kinds.includes('cohort')) messages.push('cohort already has a class at this time')
  return messages
}

export interface PlanInput {
  /** Parsed CSV rows (header order preserved), 1-based line numbers. */
  rawRows: Array<{ line: number; fields: Record<string, string> }>
  existing: ImportExistingSchedule[]
  mappings: ImportMappingRef[]
  faculty: ImportFacultyIndex
}

/**
 * The whole import decision in one pure function: per row — validate, then
 * dedupe against existing + earlier accepted rows, then hard-clash check
 * against the same set. Warnings never change the status.
 */
export function planScheduleImport(input: PlanInput): ImportPlan {
  const existingKeys = new Map<string, string>() // duplicateKey → existing subject label
  for (const s of input.existing) {
    if (!s.isActive) continue
    existingKeys.set(duplicateKey(s), s.subject || s.subjectCode || 'existing class')
  }

  const existingEntries: ScheduleEntry[] = input.existing
    .filter((s) => s.isActive)
    .map((s) => ({
      id: s.id,
      collegeId: 'college', // compared against the same constant on every row
      facultyId: s.facultyId,
      branch: s.branch,
      batch: s.batch,
      division: s.division,
      room: s.room,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      isActive: s.isActive,
    }))

  const batchKeys = new Set<string>()
  const accepted: ScheduleEntry[] = []
  const rows: ImportRowReport[] = []
  const writeable: ImportRow[] = []

  for (const { line, fields } of input.rawRows) {
    const subject = String(fields.subject ?? '').trim()
    const subjectCode = String(fields.subjectCode ?? '').trim()
    const facultyId = String(fields.facultyId ?? '').trim()
    const branch = String(fields.branch ?? '').trim()
    const batch = String(fields.batch ?? '').trim()
    const division = String(fields.division ?? '').trim()
    const section = String(fields.section ?? '').trim()
    const room = String(fields.room ?? '').trim()
    const dayRaw = String(fields.dayOfWeek ?? '').trim()
    const startTime = String(fields.startTime ?? '').trim()
    const endTime = String(fields.endTime ?? '').trim()
    const semesterRaw = String(fields.semester ?? '').trim()

    const report: ImportRowReport = {
      line,
      subject: subject || subjectCode || '(no subject)',
      facultyId,
      dayOfWeek: dayRaw,
      startTime,
      endTime,
      status: 'valid',
      reasons: [],
      warnings: [],
    }

    // ── 1. validation ──────────────────────────────────────────────────────
    const errors: string[] = []
    if (!subject) errors.push('subject is required')
    if (!facultyId) errors.push('facultyId is required')
    const day = normalizeDay(dayRaw)
    if (!day) errors.push(`dayOfWeek "${dayRaw}" is not a day of the week`)
    if (!isValidTime(startTime)) errors.push(`startTime "${startTime}" must be HH:mm (24h)`)
    if (!isValidTime(endTime)) errors.push(`endTime "${endTime}" must be HH:mm (24h)`)
    if (isValidTime(startTime) && isValidTime(endTime) && parseTimeToMinutes(endTime) <= parseTimeToMinutes(startTime)) {
      errors.push('endTime must be after startTime')
    }
    const semester = Number(semesterRaw)
    if (!Number.isInteger(semester) || semester < 1 || semester > 10) {
      errors.push(`semester "${semesterRaw}" must be a whole number between 1 and 10`)
    }
    if (errors.length > 0) {
      report.status = 'invalid'
      report.reasons = errors
      rows.push(report)
      continue
    }

    const row: ImportRow = {
      line,
      subject,
      subjectCode,
      facultyId,
      facultyName: String(fields.facultyName ?? '').trim(),
      branch,
      batch,
      semester,
      division,
      section,
      room,
      dayOfWeek: day!,
      startTime,
      endTime,
      type: normalizeClassType(fields.type),
    }

    // ── 2. faculty identity ────────────────────────────────────────────────
    const resolvedName =
      input.faculty.byId.get(facultyId.toLowerCase()) ??
      input.faculty.byId.get(facultyId) ??
      ''
    if (!resolvedName) {
      report.warnings.push(`facultyId "${facultyId}" not found in the college faculty list`)
    } else if (row.facultyName && norm(row.facultyName) !== norm(resolvedName)) {
      report.warnings.push(`faculty name in file ("${row.facultyName}") differs from profile ("${resolvedName}")`)
    }

    // ── 3. curriculum mapping cross-reference (warning only) ──────────────
    const mapped = input.mappings.find((m) => {
      const codeMatch = subjectCode && m.courseCode && norm(subjectCode) === norm(m.courseCode)
      const nameMatch = subject && m.courseName && norm(subject) === norm(m.courseName)
      const branchOk = !branch || !m.branch || norm(branch) === norm(m.branch)
      const semOk = !semester || !m.semester || semester === m.semester
      return (codeMatch || nameMatch) && branchOk && semOk
    })
    if (!mapped) {
      report.warnings.push('subject is not in the college’s assigned curriculum mappings')
    } else if (mapped.facultyId && mapped.facultyId.toLowerCase() !== facultyId.toLowerCase()) {
      report.warnings.push(`mapped faculty is ${mapped.facultyName || mapped.facultyId} — this row books a different person`)
    }

    // ── 4. duplicate (existing or earlier row in this file) ───────────────
    const key = duplicateKey(row)
    const clashEntry: ScheduleEntry = {
      id: `import-${line}`,
      collegeId: 'college',
      facultyId,
      branch,
      batch,
      division,
      room,
      dayOfWeek: day!,
      startTime,
      endTime,
      isActive: true,
    }

    const duplicateOf = existingKeys.get(key)
    if (duplicateOf) {
      report.status = 'duplicate'
      report.reasons.push(`already scheduled: "${duplicateOf}"`)
      rows.push(report)
      continue
    }
    if (batchKeys.has(key)) {
      report.status = 'duplicate'
      report.reasons.push('duplicate of an earlier row in this file')
      rows.push(report)
      continue
    }

    // ── 5. hard clashes (faculty/room); cohort is a warning ───────────────
    const kinds = [
      ...findClashes(clashEntry, existingEntries),
      ...findClashes(clashEntry, accepted),
    ]
    const hard = kinds.filter((k) => HARD_CLASH_KINDS.includes(k))
    const cohort = kinds.includes('cohort')
    if (hard.length > 0) {
      report.status = 'clash'
      report.reasons = describeClashes(hard)
      rows.push(report)
      continue
    }
    if (cohort) report.warnings.push('cohort already has a class at this time')

    batchKeys.add(key)
    accepted.push(clashEntry)
    writeable.push(row)
    rows.push(report)
  }

  const totals = {
    total: rows.length,
    valid: writeable.length,
    clash: rows.filter((r) => r.status === 'clash').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
  }

  return { rows, writeable, totals }
}

// ═════════════════════════════════════════════════════════════════════════════
// Payload + data assembly
// ═════════════════════════════════════════════════════════════════════════════

const MAX_ROWS = 500
const MAX_FIELD_LENGTH = 300
const MAX_SCHEDULES_READ = 1000
const MAX_MAPPINGS_READ = 1000
const MAX_FACULTY_READ = 500

export interface ScheduleImportPayload {
  collegeId: string
  dryRun: boolean
  rawRows: Array<{ line: number; fields: Record<string, string> }>
}

export function validateScheduleImportPayload(
  data: unknown,
  role: string,
  claimCollegeId: string,
): ScheduleImportPayload {
  const raw = (data || {}) as Record<string, unknown>
  const collegeId = role === 'superadmin' ? String(raw.collegeId ?? '').trim() : claimCollegeId
  if (!collegeId) {
    throw new HttpsError('invalid-argument', 'No college is associated with this account')
  }

  let rawRows: Array<{ line: number; fields: Record<string, string> }>
  if (Array.isArray(raw.rows)) {
    if (raw.rows.length > MAX_ROWS) {
      throw new HttpsError('invalid-argument', `At most ${MAX_ROWS} rows per import`)
    }
    rawRows = raw.rows.map((entry, i) => {
      if (!entry || typeof entry !== 'object') {
        throw new HttpsError('invalid-argument', `Row ${i + 2} is not an object`)
      }
      const fields: Record<string, string> = {}
      for (const [k, v] of Object.entries(entry as Record<string, unknown>)) {
        const s = String(v ?? '').trim()
        if (s.length > MAX_FIELD_LENGTH) {
          throw new HttpsError('invalid-argument', `Row ${i + 2}, field "${k}" is too long`)
        }
        fields[k.toLowerCase()] = s
      }
      return { line: i + 2, fields }
    })
  } else {
    const csv = String(raw.csv ?? '')
    if (!csv.trim()) {
      throw new HttpsError('invalid-argument', 'Provide a CSV (csv) or structured rows (rows)')
    }
    if (csv.length > 400_000) {
      throw new HttpsError('invalid-argument', 'CSV is too large (max 400 KB)')
    }
    const parsed = parseCsv(csv)
    if (parsed.length > MAX_ROWS) {
      throw new HttpsError('invalid-argument', `At most ${MAX_ROWS} rows per import`)
    }
    // line = position in the file: 1 header + 1-based data index, counting
    // blank lines parseCsv skipped is fine for reporting purposes.
    rawRows = parsed.map((fields, i) => ({ line: i + 2, fields }))
  }

  return {
    collegeId,
    dryRun: raw.dryRun !== false,
    rawRows,
  }
}

function toExistingSchedule(snap: admin.firestore.QueryDocumentSnapshot): ImportExistingSchedule {
  const d = snap.data() as Record<string, unknown>
  return {
    id: snap.id,
    subject: String(d.subject ?? ''),
    subjectCode: String(d.subjectCode ?? ''),
    facultyId: String(d.facultyId ?? ''),
    branch: String(d.branch ?? ''),
    batch: String(d.batch ?? ''),
    division: String(d.division ?? ''),
    section: String(d.section ?? ''),
    room: String(d.room ?? ''),
    dayOfWeek: String(d.dayOfWeek ?? '') as DayOfWeek,
    startTime: String(d.startTime ?? ''),
    endTime: String(d.endTime ?? ''),
    type: String(d.type ?? 'lecture'),
    isActive: d.isActive !== false,
  }
}

function toMappingRef(snap: admin.firestore.QueryDocumentSnapshot): ImportMappingRef {
  const d = snap.data() as Record<string, unknown>
  return {
    courseCode: String(d.courseCode ?? ''),
    courseName: String(d.courseName ?? ''),
    branch: String(d.branch ?? ''),
    semester: Number(d.semester ?? 0) || 0,
    facultyId: String(d.facultyId ?? ''),
    facultyName: String(d.facultyName ?? ''),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Callable
// ═════════════════════════════════════════════════════════════════════════════

const IMPORT_REGION = { region: 'asia-south1' as const }

/**
 * Bulk-import weekly schedule rows. dryRun (default) returns the per-row
 * report without writing; dryRun: false writes only the valid rows.
 */
export const bulkImportWeeklySchedules = onCall(
  { ...IMPORT_REGION, memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveSchedulingStaff(uid, request.auth?.token || {})
    const payload = validateScheduleImportPayload(request.data, staff.role, staff.collegeId)

    const db = getFirestore(admin.app(), 'default')
    const [schedulesSnap, facultySnap, mappingsSnap] = await Promise.all([
      db
        .collection('weeklySchedules')
        .where('collegeId', '==', payload.collegeId)
        .limit(MAX_SCHEDULES_READ)
        .get(),
      db.collection('faculty').where('collegeId', '==', payload.collegeId).limit(MAX_FACULTY_READ).get(),
      db
        .collection('curriculumFacultyMappings')
        .where('collegeId', '==', payload.collegeId)
        .limit(MAX_MAPPINGS_READ)
        .get(),
    ])

    const existing = schedulesSnap.docs.map(toExistingSchedule)

    const byId = new Map<string, string>()
    const byName = new Map<string, string>()
    for (const snap of facultySnap.docs) {
      const d = snap.data() as Record<string, unknown>
      if (String(d.status ?? 'active') === 'inactive') continue
      const name =
        String(d.name ?? '').trim() ||
        `${String(d.firstName ?? '').trim()} ${String(d.lastName ?? '').trim()}`.trim()
      if (!name) continue
      for (const id of [snap.id, String(d.uid ?? ''), String(d.facultyId ?? '')]) {
        if (id) {
          byId.set(id.toLowerCase(), name)
          byId.set(id, name)
        }
      }
      byName.set(name.toLowerCase(), String(d.uid ?? snap.id))
    }

    const mappings = mappingsSnap.docs
      .filter((d) => String(d.data().status ?? 'active') !== 'removed' && String(d.data().status ?? 'active') !== 'inactive')
      .map(toMappingRef)

    const plan = planScheduleImport({
      rawRows: payload.rawRows,
      existing,
      mappings,
      faculty: { byId, byName },
    })

    if (payload.dryRun) {
      return { dryRun: true, plan }
    }

    if (plan.writeable.length === 0) {
      return { dryRun: false, plan, created: 0, createdRows: [] }
    }

    const now = Timestamp.now()
    const writeBatch = db.batch()
    const createdRows: Array<{ line: number; subject: string; facultyId: string }> = []
    for (const row of plan.writeable) {
      const facultyName = byId.get(row.facultyId.toLowerCase()) ?? row.facultyName ?? row.facultyId
      const initials = facultyName
        .split(' ')
        .filter(Boolean)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
      writeBatch.set(db.collection('weeklySchedules').doc(), {
        collegeId: payload.collegeId,
        subject: row.subject,
        subjectCode: row.subjectCode,
        facultyId: row.facultyId,
        facultyName,
        facultyInitials: initials,
        branch: row.branch,
        batch: row.batch,
        semester: row.semester,
        division: row.division,
        section: row.section,
        room: row.room,
        dayOfWeek: row.dayOfWeek,
        startTime: row.startTime,
        endTime: row.endTime,
        type: row.type,
        isActive: true,
        importedAt: now,
        importedBy: staff.name || staff.uid,
        createdAt: now.toDate().toISOString(),
        updatedAt: now.toDate().toISOString(),
      })
      createdRows.push({ line: row.line, subject: row.subject, facultyId: row.facultyId })
    }
    await writeBatch.commit()

    return { dryRun: false, plan, created: createdRows.length, createdRows }
  },
)
