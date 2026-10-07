import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// ─────────────────────────────────────────────────────────────────────────────
// Auto slot scheduler (G4)
//
// WHY THIS EXISTS
// mapping() → who teaches what; the timetable is still a hand-drawn grid of
// days × periods — the single most error-prone Excel in a Karnataka degree
// college (clashes fixed by phone, lab spans double-booked, guest faculty
// over-stuffed, and no visibility of "how many hours a day does this batch
// actually get?").
//
// THE ALGORITHM (deterministic, preview-before-write)
//   1. DEMAND   — every ACTIVE course mapping is planned by teaching group.
//                 An explicit comma-separated division list ("A,B") is one
//                 merged class; a legacy unscoped row expands from enrolled
//                 roster groups. Demand is hoursPerWeek per group.
//   2. GRID     — days × periodsPerDay slots materialised from startTime &
//                 periodMinutes with one configurable break. Slot times are
//                 computed here and echoed back so the preview and the written
//                 docs can never disagree.
//   3. PLACE    — courses in demand order (heaviest first, then code for a
//                 stable tiebreak). Faculty-day preference can compact class
//                 meetings toward a soft daily target or balance student days;
//                 disjoint groups may share periods, overlapping scopes cannot.
//                 Faculty daily/weekly caps, room availability and lab spans
//                 remain hard constraints.
//   4. TRUST    — the result carries college-wide slot utilization, per-division
//                 daily density (target 4–5 classes/day), and explicit faculty
//                 demand arithmetic with merge suggestions when projected load
//                 exceeds capacity.
//   5. WRITE    — dryRun (default) only returns the plan. dryRun:false writes
//                 each placement as an ordinary weeklySchedules doc (same
//                 shape as bulk import), stamped autoScheduled for audit.
// ─────────────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { resolveSchedulingStaff, isValidDateKey, daysBetween, MAX_GENERATE_RANGE_DAYS } from './classSchedule'
import { hoursPerWeek, DEFAULT_SEMESTER_WEEKS, DEFAULT_CAPACITY_WEEKLY_HOURS } from './autoCurriculumMapping'
import { normalizeDay, isValidTime } from './scheduleImport'
import { buildCalendarView, toCalendarEventLite, MAX_CALENDAR_READ, type CalendarView, type CalendarEventLite } from './calendar'
import { batchFieldsIntersect, batchKeyTokens, cohortLetters, divisionScopesOverlap, cohortScopesOverlap } from './cohortBatch'
import type { DayOfWeek } from './classSchedule'

// ═════════════════════════════════════════════════════════════════════════════
// Pure core
// ═════════════════════════════════════════════════════════════════════════════

export interface ScheduleGrid {
  days: DayOfWeek[]
  periodsPerDay: number
  startTime: string
  periodMinutes: number
  /** Break inserted after this 1-based period index (0 = no break). */
  breakAfterPeriod: number
  breakMinutes: number
  labSpan: number
}

/** P3 — how placements choose among legal slots (constraints stay sacred). */
export type PlacementStrategy = 'uniform' | 'spread' | 'random'
/** P3 — room choice among the rooms free for a span. */
export type RoomStrategy = 'leastLoaded' | 'random'
/** How strongly the planner packs each faculty member's classes into fewer days. */
export type FacultyDayPreference = 'balanced' | 'compact'
/** Respect comma-joined merged mappings, or split them into one group per cohort. */
export type TeachingGroupMode = 'mapping' | 'separate'
export const PLACEMENT_STRATEGIES: PlacementStrategy[] = ['uniform', 'spread', 'random']
export const ROOM_STRATEGIES: RoomStrategy[] = ['leastLoaded', 'random']
export const FACULTY_DAY_PREFERENCES: FacultyDayPreference[] = ['balanced', 'compact']
export const TEACHING_GROUP_MODES: TeachingGroupMode[] = ['mapping', 'separate']

/** P2 — per-course steering for one apply run. */
export interface CourseOverride {
  /** Legacy whole-mapping override; applied to all expanded teaching groups. */
  mappingId?: string
  /** Preferred group-specific key: `${mappingId}|${scopeIdentity}`. */
  demandKey?: string
  /** Overrides hoursPerWeek() for this course. 0 (or include:false) excludes. */
  weeklyPeriods?: number | null
  include?: boolean
}

export interface PlannedSlot {
  day: DayOfWeek
  periodIndex: number // 1-based within the day
  startTime: string
  endTime: string
}

/** A mapped course that needs periods placed. */
export interface AutoScheduleCourse {
  mappingId: string
  courseId: string
  courseCode: string
  courseName: string
  facultyId: string
  facultyName: string
  totalHours: number
  credits: number
  branch: string
  semester: number
  batch: string
  division: string
  section: string
}

/** Already-committed occupancy from the college's live weeklySchedules. */
export interface CohortBusyScope {
  branch?: unknown
  batch?: unknown
  division?: unknown
  section?: unknown
  /** `${day}|${hh:mm}` values already occupied by this scope. */
  busy: Set<string>
}

export interface FacultyIdentityRecord {
  id?: unknown
  uid?: unknown
  authUid?: unknown
  facultyId?: unknown
  userId?: unknown
  email?: unknown
}

/** Build a case-insensitive alias map that canonicalizes timetable faculty IDs to Auth UIDs. */
export function buildFacultyIdentityMap(records: readonly FacultyIdentityRecord[]): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const record of records) {
    const canonical = [record.uid, record.authUid, record.id, record.facultyId]
      .map((value) => String(value ?? '').trim())
      .find(Boolean) ?? ''
    if (!canonical) continue
    const values = [record.id, record.uid, record.authUid, record.facultyId, record.userId, record.email]
    for (const value of values) {
      const key = String(value ?? '').trim().toLowerCase()
      if (key) aliases.set(key, canonical)
    }
  }
  return aliases
}

export function canonicalFacultyId(value: unknown, aliases: ReadonlyMap<string, string>): string {
  const raw = String(value ?? '').trim()
  return aliases.get(raw.toLowerCase()) ?? raw
}

export interface Occupancy {
  /** `${facultyId}|${day}|${hh:mm}`; legacy unscoped `${day}|${hh:mm}` keys block everyone. */
  facultyBusy: Set<string>
  /** Legacy global cohort blocks; new callers should use cohortBusyScopes. */
  cohortBusy: Set<string>
  /** Scoped busy keys let disjoint teaching groups use the same room-time grid. */
  cohortBusyScopes?: CohortBusyScope[]
  /** `${facultyId}|${day}` → already occupied timetable periods. */
  facultyDaily?: Map<string, number>
  /** `${facultyId}|${day}` → existing class meetings (a multi-period lab is one meeting). */
  facultyDailyMeetings?: Map<string, number>
  /** `${day}|${hh:mm}|${room}` already booked. */
  roomBusy: Set<string>
  /** facultyId → weekly periods already committed. */
  facultyWeekly: Map<string, number>
}

export interface AutoScheduleInput {
  courses: AutoScheduleCourse[]
  grid: ScheduleGrid
  rooms: string[]
  occupancy: Occupancy
  semesterWeeks: number
  maxPeriodsPerDayPerFaculty: number
  /** Soft target: prefer this many distinct class meetings on an active faculty day. */
  targetFacultyClassesPerDay?: number
  /** 'compact' fills an active faculty day toward the target before opening another. */
  facultyDayPreference?: FacultyDayPreference
  /** Hard weekly cap; defaults to the regular-faculty 24-period norm. */
  maxWeeklyPeriodsPerFaculty?: number
  /** P3 — default 'uniform' = earliest legal period, deterministic. */
  strategy?: PlacementStrategy
  /** P3 — deterministic RNG seed ('random' mode + roomStrategy:'random'). */
  randomSeed?: string
  /** P3 — default 'leastLoaded'. */
  roomStrategy?: RoomStrategy
  /** P2 — include/weeklyPeriods steering, preferably keyed by demandKey. */
  courseOverrides?: CourseOverride[]
}

export type PlacementType = 'lecture' | 'lab'

export interface SchedulePlacement {
  mappingId: string
  demandKey: string
  /** Shared by period rows that belong to the same teaching meeting (e.g. a lab span). */
  meetingKey: string
  courseId: string
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
  type: PlacementType
  periodIndex: number
  span: number
  flags: string[]
}

export interface UnplacedCourse {
  mappingId: string
  courseId: string
  subject: string
  division: string
  section: string
  periodsRequested: number
  periodsPlaced: number
  reason: string
}

/**
 * P2 — one row per candidate course, included or not. The dialog's
 * per-course override table is prefilled from this (the preview's demand
 * list), so the operator sees exactly what the server derived and why.
 */
export interface DemandRow {
  mappingId: string
  /** Stable display key when a legacy whole-batch mapping expands into groups. */
  demandKey: string
  courseId: string
  courseCode: string
  courseName: string
  facultyName: string
  division: string
  section: string
  /** Effective weekly demand after overrides (0 when excluded/zero-hours). */
  periodsRequested: number
  included: boolean
  /** 'derived' = hoursPerWeek(), 'override' = operator set weeklyPeriods. */
  source: 'derived' | 'override' | 'excluded' | 'zero-hours'
  reason?: string
}

export interface ScheduleFacultyDemand {
  courseId: string
  subject: string
  groups: string[]
  groupsServed: number
  periodsPerGroup: number
  periodsRequested: number
}

export interface ScheduleFacultyLoad {
  facultyId: string
  facultyName: string
  existingWeekly: number
  requestedWeekly: number
  projectedWeekly: number
  placedWeekly: number
  totalWeekly: number
  capacity: number
  overloaded: boolean
  demandExceeded: boolean
  demandBreakdown: ScheduleFacultyDemand[]
  mergeSuggestions: string[]
}

export interface CohortDailyCoverage {
  division: string
  day: DayOfWeek
  classes: number
  targetMin: number
  targetMax: number
  onTarget: boolean
}

export const TARGET_FACULTY_CLASSES_PER_DAY = 3
export const TARGET_CLASSES_PER_DAY_MIN = 4
export const TARGET_CLASSES_PER_DAY_MAX = 5

export interface FacultyDailyLoad {
  facultyId: string
  facultyName: string
  day: DayOfWeek
  /** Distinct meetings, so a contiguous multi-period lab counts once. */
  classes: number
  /** Occupied grid periods, including a multi-period lab span. */
  periods: number
  targetClasses: number
  targetMet: boolean
}

export interface DailyCoverage {
  day: DayOfWeek
  periods: number
  /** periods × periodMinutes, in hours (1 decimal) */
  hours: number
  utilization: number // periods / periodsPerDay, 0..1
  subjects: string[]
}

export interface AutoSchedulePlan {
  grid: ScheduleGrid
  rooms: string[]
  placements: SchedulePlacement[]
  unplaced: UnplacedCourse[]
  facultyLoad: ScheduleFacultyLoad[]
  /** Faculty meeting + period counts per active day, including existing slots. */
  facultyDailyLoad: FacultyDailyLoad[]
  dailyCoverage: DailyCoverage[]
  /** Per-division periods/classes per day; merged placements count for every member division. */
  cohortDailyCoverage: CohortDailyCoverage[]
  /** P2 — every candidate course with its effective demand + include state. */
  demand: DemandRow[]
  /** P4 — calendar view for the preview (blocked weekdays + day counts). */
  calendar?: CalendarView
  /** P3 — echo of the effective seed when a seeded RNG shaped this plan. */
  randomSeed?: string
  summary: {
    courses: number
    placements: number
    periodsRequested: number
    periodsPlaced: number
    unplacedCourses: number
    overloadedFaculty: number
    /** Divisions for which all scheduled days are at the 4–5 period target. */
    divisionsInTarget?: number
    /** P2 — courses the run actually asked to place (after overrides). */
    coursesIncluded?: number
    /** P4 — grid-day occurrences in dateRange, minus suspended ones. */
    teachingDays?: number
    blockedDays?: number
    blockedBreakdown?: Record<string, number>
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Deterministic RNG (P3) — mulberry32 over a seed string
// ═════════════════════════════════════════════════════════════════════════════

/** xmur3 string hash → uint32 seed for mulberry32. */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}

/**
 * mulberry32 PRNG seeded from a string. Same seed + same inputs = same grid,
 * so preview == apply and a run is reproducible/auditable weeks later.
 */
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates shuffle driven by the seeded RNG (pure: returns a copy). */
export function shuffleWith<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

const pad2 = (n: number) => String(n).padStart(2, '0')
function minutesToHhMm(total: number): string {
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
}

/** Materialise the day's slots from the grid config (break included). */
export function buildSlots(grid: ScheduleGrid): PlannedSlot[] {
  const [h, m] = grid.startTime.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return []
  const slots: PlannedSlot[] = []
  for (const day of grid.days) {
    let cursor = h * 60 + m
    for (let p = 1; p <= grid.periodsPerDay; p++) {
      const end = cursor + grid.periodMinutes
      slots.push({
        day,
        periodIndex: p,
        startTime: minutesToHhMm(cursor),
        endTime: minutesToHhMm(end),
      })
      cursor = end
      if (grid.breakAfterPeriod === p) cursor += grid.breakMinutes
    }
  }
  return slots
}

const LAB_NAME_RE = /\b(lab|laboratory|practical|practicum)\b/i

const busyKey = (day: DayOfWeek, startTime: string) => `${day}|${startTime}`
const facultyBusyKey = (facultyId: string, slotKey: string) => `${facultyId}|${slotKey}`
const facultySlotIsBusy = (busy: Set<string>, facultyId: string, slotKey: string) =>
  busy.has(facultyBusyKey(facultyId, slotKey)) || busy.has(slotKey)

// ─── Multi-batch matching (in-flight fix, commit 8bfdac0) ───────────────────
// Mappings store batch as a comma-joined multi-intake string ("2027, 2028");
// operators type "2027,2028". Strict equality dropped every row and the
// dialog misreported "run Auto Map first". Both sides are tokenised on
// [,/;\s]+ and match when ANY requested token appears in the mapping's batch
// list. Empty-batch semantics are unchanged (both empty = match, one empty =
// mismatch — the callable always requires a non-empty batch anyway).

/** Unplaced reason for a 0h mapping the operator has not overridden yet. */
export const ZERO_HOURS_REASON = 'course has 0 contact hours — set weeklyPeriods'

/** Fallback RNG seed when a 'random' run arrives without one (P3). */
export const DEFAULT_RANDOM_SEED = 'vriddhi-auto-v2'

/** Split a batch field into comparable intake tokens. */
export function batchTokens(value: unknown): string[] {
  return String(value ?? '')
    .split(/[,/;\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * True when the requested batch (single value or multi-intake string)
 * intersects the mapping's batch list. Empty-batch semantics unchanged.
 */
export function batchListMatches(requested: unknown, mappingBatch: unknown): boolean {
  // Every token is compared as a BATCH KEY (./cohortBatch): a range counts as
  // the class of its END year, so a mapping written "2026-2027" is demand for
  // a run whose batch is "2027" — the same rule the student page reads with.
  // Before this, that mapping was invisible here and the run failed with
  // "No active faculty mappings ... run Auto Map first" about demand that
  // existed.
  return batchFieldsIntersect(requested, mappingBatch)
}

/**
 * Does an ACTIVE mapping serve the cohort an auto-schedule run targets?
 *
 * `batch` may be a multi-intake list on either side ("2027, 2028"), compared
 * keyed. Division/section are LETTER SETS (shared ./cohortBatch rule): a
 * mapping that covers "A,B,C,D" is demand for a run of division A, and a
 * mapping with no division recorded is a whole-batch class. A run that names
 * no division schedules only whole-batch mappings — it must not silently
 * expand a division-specific mapping into a class for students who are not
 * its cohort.
 */
export function mappingServesCohort(
  mapping: Record<string, unknown>,
  target: { batch?: unknown; division?: unknown; section?: unknown },
): boolean {
  if (!batchListMatches(target.batch, mapping.batch)) return false
  const targetHasDivision = cohortLetters(target.division).length + cohortLetters(target.section).length > 0
  const mappingHasDivision = cohortLetters(mapping.division).length + cohortLetters(mapping.section).length > 0
  if (!targetHasDivision) return !mappingHasDivision
  if (!mappingHasDivision) return true
  return divisionScopesOverlap(mapping, target)
}

export interface TeachingGroupScope {
  division: string
  section: string
}

function hasGroupLetters(scope: { division?: unknown; section?: unknown }): boolean {
  return cohortLetters(scope.division).length + cohortLetters(scope.section).length > 0
}

function teachingGroupKey(scope: { division?: unknown; section?: unknown }): string {
  return [...new Set([...cohortLetters(scope.division), ...cohortLetters(scope.section)])].sort().join('+')
}

/**
 * Resolve the actual teaching group(s) represented by one mapping row.
 * Explicit A,B is one merged class. A legacy unscoped mapping is expanded
 * into the enrolled division groups so an all-groups run books one meeting
 * per group instead of silently treating every student as a single cohort.
 */
export function resolveMappingTeachingGroups(
  mapping: { division?: unknown; section?: unknown },
  rosterGroups: readonly TeachingGroupScope[],
  filter: { division?: unknown; section?: unknown } = {},
  mode: TeachingGroupMode = 'mapping',
): TeachingGroupScope[] {
  const hasFilter = hasGroupLetters(filter)
  if (hasGroupLetters(mapping)) {
    const mappingGroups = mode === 'separate'
      ? (() => {
          const divisions = cohortLetters(mapping.division)
          const sections = cohortLetters(mapping.section)
          const divisionValues = divisions.length > 0 ? divisions : ['']
          const sectionValues = sections.length > 0 ? sections : ['']
          return divisionValues.flatMap((division) => sectionValues.map((section) => ({
            division: division ? division.toUpperCase() : '',
            section: section ? section.toUpperCase() : '',
          })))
        })()
      : [{ division: String(mapping.division ?? ''), section: String(mapping.section ?? '') }]
    return mappingGroups.filter((group) => !hasFilter || divisionScopesOverlap(group, filter))
  }

  const matchingGroups = rosterGroups.filter((group) => !hasFilter || divisionScopesOverlap(group, filter))
  const unique = new Map<string, TeachingGroupScope>()
  for (const group of matchingGroups) {
    const key = teachingGroupKey(group) || '__whole_batch__'
    if (!unique.has(key)) unique.set(key, { division: String(group.division ?? ''), section: String(group.section ?? '') })
  }
  if (unique.size > 0) return [...unique.values()]

  if (hasFilter) {
    const selected = [...new Set([...cohortLetters(filter.division), ...cohortLetters(filter.section)])]
    return selected.length > 0
      ? selected.map((letter) => ({ division: letter.toUpperCase(), section: '' }))
      : [{ division: String(filter.division ?? ''), section: String(filter.section ?? '') }]
  }
  return [{ division: '', section: '' }]
}

/**
 * Place one course's periods into the grid. Mutates the local occupancy so
 * subsequent courses see this course's footprint (intra-run clash safety,
 * exactly like the import planner).
 */
function branchIdentity(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[.,;:'’"·]+/g, '').replace(/\s+/g, ' ').trim()
}

function scopeIdentity(scope: { branch?: unknown; batch?: unknown; division?: unknown; section?: unknown }): string {
  const branch = branchIdentity(scope.branch)
  const batch = batchKeyTokens(scope.batch).sort().join(',')
  const group = teachingGroupKey(scope) || '__whole_batch__'
  return `${branch}|${batch}|${group}`
}

function cohortDayKeys(scope: { branch?: unknown; batch?: unknown; division?: unknown; section?: unknown }): string[] {
  const branch = branchIdentity(scope.branch)
  const batch = batchKeyTokens(scope.batch).sort().join(',')
  const prefix = `${branch}|${batch}`
  const letters = [...new Set([...cohortLetters(scope.division), ...cohortLetters(scope.section)])]
  return letters.length > 0 ? letters.map((letter) => `${prefix}|${letter}`) : [`${prefix}|__all__`]
}

function cohortLabels(scope: { division?: unknown; section?: unknown }): string[] {
  const letters = [...new Set([...cohortLetters(scope.division), ...cohortLetters(scope.section)])]
  return letters.length > 0 ? letters.map((letter) => letter.toUpperCase()) : ['All']
}

function roomHallRank(room: string): number {
  return /auditorium|multipurpose|convention|main hall|lecture hall|large hall|\bhall\b/i.test(room) ? 0 : 1
}

function buildFacultyDemandBreakdown(
  demand: Array<{ course: AutoScheduleCourse; periods: number }>,
): Map<string, ScheduleFacultyDemand[]> {
  const aggregate = new Map<string, Map<string, { courseId: string; subject: string; periods: number; groups: Map<string, string> }>>()
  for (const entry of demand) {
    const { course, periods } = entry
    const facultyRows = aggregate.get(course.facultyId) ?? new Map()
    const lineKey = `${course.courseId}|${course.courseName}|${periods}`
    const line = facultyRows.get(lineKey) ?? {
      courseId: course.courseId,
      subject: course.courseName,
      periods,
      groups: new Map<string, string>(),
    }
    line.groups.set(scopeIdentity(course), cohortLabels(course).join('+'))
    facultyRows.set(lineKey, line)
    aggregate.set(course.facultyId, facultyRows)
  }
  const result = new Map<string, ScheduleFacultyDemand[]>()
  for (const [facultyId, rows] of aggregate) {
    result.set(
      facultyId,
      [...rows.values()].map((line) => {
        const groups = [...line.groups.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        return {
          courseId: line.courseId,
          subject: line.subject,
          groups,
          groupsServed: groups.length,
          periodsPerGroup: line.periods,
          periodsRequested: line.periods * groups.length,
        }
      }),
    )
  }
  return result
}

function mergeSuggestionsForDemand(
  rows: ScheduleFacultyDemand[],
  existing: number,
  capacity: number,
): string[] {
  let excess = Math.max(0, existing + rows.reduce((sum, row) => sum + row.periodsRequested, 0) - capacity)
  if (excess <= 0) return []
  const suggestions: string[] = []
  const candidates = [...rows]
    .filter((row) => row.groupsServed > 1 && row.periodsPerGroup > 0)
    .sort((a, b) => b.periodsPerGroup - a.periodsPerGroup || a.subject.localeCompare(b.subject))
  for (const row of candidates) {
    if (excess <= 0) break
    const groupsToMerge = Math.min(row.groupsServed, Math.ceil(excess / row.periodsPerGroup) + 1)
    const saved = (groupsToMerge - 1) * row.periodsPerGroup
    if (saved <= 0) continue
    const groupNames = row.groups.slice(0, groupsToMerge)
    suggestions.push(
      `Merge ${groupNames.join(' + ')} for ${row.subject} into one class (saves ${saved} periods/week)`,
    )
    excess -= saved
  }
  if (excess > 0) {
    suggestions.push(`Reassign at least ${excess} more weekly period${excess === 1 ? '' : 's'}; merging the same-subject groups is not enough to fit capacity.`)
  }
  return suggestions
}

/**
 * Place each subject × teaching-group demand into the grid. Disjoint groups
 * may share a time, while a merged A,B placement occupies both divisions.
 * Compact mode fills active faculty days toward the soft meeting target (and
 * permits one extra meeting when it fits) before opening another day; balanced
 * mode prioritises cohort-day density. Period load remains separate so a
 * multi-period lab counts as one meeting but every occupied period stays hard.
 */
export function planAutoSchedule(input: AutoScheduleInput): AutoSchedulePlan {
  const rooms = input.rooms.length > 0 ? input.rooms : ['Room 1']
  const slots = buildSlots(input.grid)
  if (slots.length === 0) {
    throw new HttpsError('invalid-argument', 'Grid produced no slots — check startTime and periodsPerDay')
  }

  const facultyBusy = new Set(input.occupancy.facultyBusy)
  const cohortBusy = new Set(input.occupancy.cohortBusy)
  const cohortBusyScopes = (input.occupancy.cohortBusyScopes ?? []).map((scope) => ({
    ...scope,
    busy: new Set(scope.busy),
  }))
  const roomBusy = new Set(input.occupancy.roomBusy)
  const facultyWeekly = new Map(input.occupancy.facultyWeekly)
  const facultyDaily = new Map(input.occupancy.facultyDaily ?? [])
  const facultyDailyMeetings = new Map(input.occupancy.facultyDailyMeetings ?? [])
  const facultyDayPreference: FacultyDayPreference = input.facultyDayPreference ?? 'compact'
  const targetFacultyClassesPerDay = Math.max(1, Math.floor(input.targetFacultyClassesPerDay ?? TARGET_FACULTY_CLASSES_PER_DAY))
  const weeklyCapacity = Math.max(1, Math.floor(input.maxWeeklyPeriodsPerFaculty ?? DEFAULT_CAPACITY_WEEKLY_HOURS))
  const dailyCapacity = Math.max(1, input.maxPeriodsPerDayPerFaculty)

  const strategy: PlacementStrategy = input.strategy ?? 'uniform'
  const roomStrategy: RoomStrategy = input.roomStrategy ?? 'leastLoaded'
  const usesRng = strategy === 'random' || roomStrategy === 'random'
  const effectiveSeed = String(input.randomSeed ?? '').trim() || DEFAULT_RANDOM_SEED
  const rng = seededRandom(effectiveSeed)

  const placements: SchedulePlacement[] = []
  const unplaced: UnplacedCourse[] = []
  const courseDayCount = new Map<string, number>()
  const cohortPeriodCount = new Map<string, number>()
  const cohortMeetingCount = new Map<string, number>()

  const overridesByMapping = new Map<string, CourseOverride>()
  const overridesByDemand = new Map<string, CourseOverride>()
  for (const override of input.courseOverrides ?? []) {
    if (override && typeof override.mappingId === 'string' && override.mappingId) {
      overridesByMapping.set(override.mappingId, override)
    }
    if (override && typeof override.demandKey === 'string' && override.demandKey) {
      overridesByDemand.set(override.demandKey, override)
    }
  }

  const demandRows: DemandRow[] = []
  const placeable: { course: AutoScheduleCourse; periods: number }[] = []
  for (const course of input.courses) {
    const demandKey = `${course.mappingId}|${scopeIdentity(course)}`
    const override = overridesByDemand.get(demandKey) ?? overridesByMapping.get(course.mappingId)
    const overridePeriods =
      override && typeof override.weeklyPeriods === 'number' && Number.isFinite(override.weeklyPeriods)
        ? Math.max(0, Math.floor(override.weeklyPeriods))
        : null
    const include = override?.include !== false && overridePeriods !== 0
    const rowBase = {
      mappingId: course.mappingId,
      demandKey,
      courseId: course.courseId,
      courseCode: course.courseCode,
      courseName: course.courseName,
      facultyName: course.facultyName,
      division: course.division,
      section: course.section,
    }
    if (!include) {
      demandRows.push({
        ...rowBase,
        periodsRequested: 0,
        included: false,
        source: 'excluded',
        reason: 'Excluded for this run (course override)',
      })
      continue
    }
    if (overridePeriods !== null) {
      demandRows.push({ ...rowBase, periodsRequested: overridePeriods, included: true, source: 'override' })
      if (overridePeriods > 0) placeable.push({ course, periods: overridePeriods })
      continue
    }
    if (!(course.totalHours > 0)) {
      demandRows.push({
        ...rowBase,
        periodsRequested: 0,
        included: false,
        source: 'zero-hours',
        reason: ZERO_HOURS_REASON,
      })
      unplaced.push({
        mappingId: course.mappingId,
        courseId: course.courseId,
        subject: course.courseName,
        division: course.division,
        section: course.section,
        periodsRequested: 0,
        periodsPlaced: 0,
        reason: ZERO_HOURS_REASON,
      })
      continue
    }
    const periods = hoursPerWeek({ totalHours: course.totalHours, credits: course.credits }, input.semesterWeeks)
    demandRows.push({ ...rowBase, periodsRequested: periods, included: true, source: 'derived' })
    placeable.push({ course, periods })
  }

  const demand = [...placeable].sort(
    (a, b) => b.periods - a.periods || a.course.courseCode.localeCompare(b.course.courseCode) || scopeIdentity(a.course).localeCompare(scopeIdentity(b.course)),
  )
  const facultyDemand = buildFacultyDemandBreakdown(demand)

  const ensureBusyScope = (scope: { branch?: unknown; batch?: unknown; division?: unknown; section?: unknown }): CohortBusyScope => {
    const key = scopeIdentity(scope)
    const existing = cohortBusyScopes.find((row) => scopeIdentity(row) === key)
    if (existing) return existing
    const created: CohortBusyScope = { ...scope, busy: new Set<string>() }
    cohortBusyScopes.push(created)
    return created
  }

  for (let courseRank = 0; courseRank < demand.length; courseRank++) {
    const { course, periods } = demand[courseRank]
    const courseScope = {
      branch: course.branch,
      batch: course.batch,
      division: course.division,
      section: course.section,
    }
    const groupKey = `${course.courseId}|${scopeIdentity(courseScope)}`
    const courseDayKey = (day: DayOfWeek) => `${groupKey}|${day}`
    const cohortKeys = cohortDayKeys(courseScope)
    const cohortDayLoad = (day: DayOfWeek) => Math.max(0, ...cohortKeys.map((key) => cohortMeetingCount.get(`${key}|${day}`) ?? 0))
    const cohortPeriodLoad = (day: DayOfWeek) => Math.max(0, ...cohortKeys.map((key) => cohortPeriodCount.get(`${key}|${day}`) ?? 0))

    const isLab = LAB_NAME_RE.test(course.courseName)
    const span = isLab ? Math.max(1, Math.min(input.grid.labSpan, periods)) : 1
    const spansNeeded = isLab ? Math.ceil(periods / span) : periods
    let placed = 0

    const byDay = new Map<DayOfWeek, PlannedSlot[]>()
    for (const slot of slots) {
      const rows = byDay.get(slot.day) ?? []
      rows.push(slot)
      byDay.set(slot.day, rows)
    }

    spanLoop: for (let spanRank = 0; spanRank < spansNeeded; spanRank++) {
      const thisSpan = isLab && periods - placed < span ? Math.max(1, periods - placed) : span
      const currentCourseDayCount = (day: DayOfWeek) => courseDayCount.get(courseDayKey(day)) ?? 0
      const facultyDayKey = (day: DayOfWeek) => `${course.facultyId}|${day}`
      const facultyDayClasses = (day: DayOfWeek) => facultyDailyMeetings.get(facultyDayKey(day)) ?? 0
      const targetGap = (day: DayOfWeek) => targetFacultyClassesPerDay - Math.min(facultyDayClasses(day), targetFacultyClassesPerDay)
      const compactDayScore = (day: DayOfWeek) => {
        const classes = facultyDayClasses(day)
        if (classes === 0) return targetFacultyClassesPerDay + 1
        if (classes <= targetFacultyClassesPerDay) return classes
        return targetFacultyClassesPerDay + 2 + (classes - targetFacultyClassesPerDay - 1)
      }
      const dayPreferenceScore = (day: DayOfWeek) => {
        const cohortScore = cohortDayLoad(day) * 1_000_000 + cohortPeriodLoad(day) * 1_000 + currentCourseDayCount(day)
        const facultyScore = compactDayScore(day) * 1_000_000 + cohortDayLoad(day) * 1_000 + cohortPeriodLoad(day) * 10 + currentCourseDayCount(day)
        return facultyDayPreference === 'compact' ? facultyScore : cohortScore * 1_000 + targetGap(day)
      }
      const compareDays = (a: DayOfWeek, b: DayOfWeek, tieBreak = 0) =>
        dayPreferenceScore(a) - dayPreferenceScore(b) || tieBreak
      let daysOrdered = [...byDay.keys()].sort((a, b) =>
        compareDays(a, b, input.grid.days.indexOf(a) - input.grid.days.indexOf(b)),
      )

      if (strategy === 'spread') {
        const n = Math.max(1, input.grid.days.length)
        const rankOffset = courseRank % n
        const rotatedIndex = (day: DayOfWeek) => (((input.grid.days.indexOf(day) - rankOffset) % n) + n) % n
        daysOrdered = [...byDay.keys()].sort((a, b) => compareDays(a, b, rotatedIndex(a) - rotatedIndex(b)))
      } else if (strategy === 'random') {
        const buckets = new Map<number, DayOfWeek[]>()
        for (const day of daysOrdered) {
          const score = dayPreferenceScore(day)
          const bucket = buckets.get(score) ?? []
          bucket.push(day)
          buckets.set(score, bucket)
        }
        daysOrdered = [...buckets.keys()].sort((a, b) => a - b).flatMap((value) => shuffleWith(buckets.get(value) ?? [], rng))
      }

      const candidates: PlannedSlot[][] = []
      for (const day of daysOrdered) {
        const daySlots = [...(byDay.get(day) ?? [])].sort((a, b) => a.periodIndex - b.periodIndex)
        let starts: number[] = []
        for (let index = 0; index + thisSpan <= daySlots.length; index++) starts.push(index)
        if (strategy === 'spread' && starts.length > 1) {
          const pendulum: number[] = []
          let low = 0
          let high = starts.length - 1
          let takeEarly = courseRank % 2 === 0
          while (low <= high) {
            if (takeEarly) pendulum.push(low++)
            else pendulum.push(high--)
            takeEarly = !takeEarly
          }
          starts = pendulum
        }
        for (const index of starts) candidates.push(daySlots.slice(index, index + thisSpan))
      }
      if (strategy === 'random') {
        // Randomise only candidates within the configured faculty/cohort score tier.
        const score = (candidate: PlannedSlot[]) => dayPreferenceScore(candidate[0].day)
        const buckets = new Map<number, PlannedSlot[][]>()
        for (const candidate of candidates) {
          const bucket = buckets.get(score(candidate)) ?? []
          bucket.push(candidate)
          buckets.set(score(candidate), bucket)
        }
        candidates.splice(0, candidates.length, ...[...buckets.keys()].sort((a, b) => a - b).flatMap((value) => shuffleWith(buckets.get(value) ?? [], rng)))
      }

      let chose: PlannedSlot[] | null = null
      let choseRoom = ''
      let blockedByWeeklyCapacity = false
      for (const candidate of candidates) {
        const day = candidate[0].day
        if (currentCourseDayCount(day) > 0 && input.grid.days.length > 1) continue
        const keys = candidate.map((slot) => busyKey(day, slot.startTime))
        const cohortBlocked = keys.some((key) =>
          cohortBusy.has(key) || cohortBusyScopes.some((scope) => cohortScopesOverlap(scope, courseScope) && scope.busy.has(key)),
        )
        if (cohortBlocked || keys.some((key) => facultySlotIsBusy(facultyBusy, course.facultyId, key))) continue
        const dailyKey = `${course.facultyId}|${day}`
        if ((facultyDaily.get(dailyKey) ?? 0) + thisSpan > dailyCapacity) continue
        if ((facultyWeekly.get(course.facultyId) ?? 0) + thisSpan > weeklyCapacity) {
          blockedByWeeklyCapacity = true
          continue
        }

        const freeRooms = rooms.filter((room) => !keys.some((key) => roomBusy.has(`${key}|${room}`)))
        if (freeRooms.length === 0) continue
        const isMerged = cohortLabels(courseScope).length > 1
        let pick = ''
        if (roomStrategy === 'random') {
          const bestRank = isMerged ? Math.min(...freeRooms.map(roomHallRank)) : undefined
          const options = isMerged ? freeRooms.filter((room) => roomHallRank(room) === bestRank) : freeRooms
          pick = options[Math.floor(rng() * options.length)]
        } else {
          const preferredRooms = isMerged
            ? freeRooms.filter((room) => roomHallRank(room) === Math.min(...freeRooms.map(roomHallRank)))
            : freeRooms
          let leastLoad = Number.MAX_SAFE_INTEGER
          for (const room of preferredRooms) {
            const currentLoad = [...roomBusy].filter((key) => key.endsWith(`|${room}`)).length
            if (currentLoad < leastLoad) {
              pick = room
              leastLoad = currentLoad
            }
          }
        }
        if (!pick) continue
        chose = candidate
        choseRoom = pick
        break
      }

      if (!chose) {
        unplaced.push({
          mappingId: course.mappingId,
          courseId: course.courseId,
          subject: course.courseName,
          division: course.division,
          section: course.section,
          periodsRequested: periods,
          periodsPlaced: placed,
          reason: blockedByWeeklyCapacity
            ? `Faculty weekly capacity reached (${facultyWeekly.get(course.facultyId) ?? 0}/${weeklyCapacity}); merge matching division groups or reassign this course`
            : 'No free slot satisfies cohort + faculty availability, faculty daily cap and room availability',
        })
        break spanLoop
      }

      const day = chose[0].day
      const demandKey = `${course.mappingId}|${scopeIdentity(course)}`
      const meetingKey = `${demandKey}|${day}|${chose[0].startTime}`
      const weeklyAfter = (facultyWeekly.get(course.facultyId) ?? 0) + thisSpan
      const flags: string[] = []
      if (weeklyAfter > weeklyCapacity) flags.push('faculty-overloaded')
      if (isLab && thisSpan < span) flags.push('lab-span-clipped')
      if (input.rooms.length === 0) flags.push('room-auto')
      const busyScope = ensureBusyScope(courseScope)

      for (const slot of chose) {
        placements.push({
          mappingId: course.mappingId,
          demandKey,
          meetingKey,
          courseId: course.courseId,
          subject: course.courseName,
          subjectCode: course.courseCode,
          facultyId: course.facultyId,
          facultyName: course.facultyName,
          branch: course.branch,
          batch: course.batch,
          semester: course.semester,
          division: course.division,
          section: course.section,
          room: choseRoom,
          dayOfWeek: day,
          startTime: slot.startTime,
          endTime: slot.endTime,
          type: isLab ? 'lab' : 'lecture',
          periodIndex: slot.periodIndex,
          span: chose.length,
          flags,
        })
        const key = busyKey(day, slot.startTime)
        busyScope.busy.add(key)
        facultyBusy.add(facultyBusyKey(course.facultyId, key))
        roomBusy.add(`${key}|${choseRoom}`)
      }
      facultyDaily.set(`${course.facultyId}|${day}`, (facultyDaily.get(`${course.facultyId}|${day}`) ?? 0) + chose.length)
      facultyDailyMeetings.set(`${course.facultyId}|${day}`, (facultyDailyMeetings.get(`${course.facultyId}|${day}`) ?? 0) + 1)
      facultyWeekly.set(course.facultyId, (facultyWeekly.get(course.facultyId) ?? 0) + chose.length)
      courseDayCount.set(courseDayKey(day), (courseDayCount.get(courseDayKey(day)) ?? 0) + chose.length)
      for (const key of cohortKeys) {
        const cohortDayKey = `${key}|${day}`
        cohortPeriodCount.set(cohortDayKey, (cohortPeriodCount.get(cohortDayKey) ?? 0) + chose.length)
        cohortMeetingCount.set(cohortDayKey, (cohortMeetingCount.get(cohortDayKey) ?? 0) + 1)
      }
      placed += chose.length
    }
  }

  const demandRowsByFaculty = facultyDemand
  const facultyIds = new Set<string>([
    ...facultyWeekly.keys(),
    ...input.courses.map((course) => course.facultyId).filter(Boolean),
  ])
  const facultyLoad: ScheduleFacultyLoad[] = [...facultyIds]
    .map((facultyId) => {
      const courseSpots = input.courses.filter((course) => course.facultyId === facultyId)
      const existing = Math.max(0, input.occupancy.facultyWeekly.get(facultyId) ?? 0)
      const total = Math.max(0, facultyWeekly.get(facultyId) ?? existing)
      const placedByRun = placements.filter((placement) => placement.facultyId === facultyId).length
      const demandBreakdown = demandRowsByFaculty.get(facultyId) ?? []
      const requested = demandBreakdown.reduce((sum, row) => sum + row.periodsRequested, 0)
      const projected = existing + requested
      return {
        facultyId,
        facultyName: courseSpots[0]?.facultyName || facultyId,
        existingWeekly: existing,
        requestedWeekly: requested,
        projectedWeekly: projected,
        placedWeekly: placedByRun,
        totalWeekly: total,
        capacity: weeklyCapacity,
        overloaded: total > weeklyCapacity,
        demandExceeded: projected > weeklyCapacity,
        demandBreakdown,
        mergeSuggestions: mergeSuggestionsForDemand(demandBreakdown, existing, weeklyCapacity),
      }
    })
    .sort((a, b) => b.projectedWeekly - a.projectedWeekly || a.facultyName.localeCompare(b.facultyName))

  const facultyNameById = new Map<string, string>()
  for (const course of input.courses) {
    if (!facultyNameById.has(course.facultyId) && course.facultyName) facultyNameById.set(course.facultyId, course.facultyName)
  }
  const facultyIdsForDaily = new Set<string>([
    ...input.courses.map((course) => course.facultyId).filter(Boolean),
    ...[...facultyDailyMeetings.keys(), ...facultyDaily.keys()].map((key) => key.split('|')[0]).filter(Boolean),
  ])
  const facultyDailyLoad: FacultyDailyLoad[] = [...facultyIdsForDaily]
    .flatMap((facultyId) => input.grid.days.map((day) => {
      const key = `${facultyId}|${day}`
      const classes = facultyDailyMeetings.get(key) ?? 0
      const periods = facultyDaily.get(key) ?? 0
      return classes > 0 || periods > 0
        ? {
            facultyId,
            facultyName: facultyNameById.get(facultyId) || facultyId,
            day,
            classes,
            periods,
            targetClasses: targetFacultyClassesPerDay,
            targetMet: classes >= targetFacultyClassesPerDay,
          }
        : null
    }))
    .filter((row): row is FacultyDailyLoad => row !== null)
    .sort((a, b) => a.facultyName.localeCompare(b.facultyName) || input.grid.days.indexOf(a.day) - input.grid.days.indexOf(b.day))

  const dailyCoverage: DailyCoverage[] = input.grid.days.map((day) => {
    const dayPlacements = placements.filter((placement) => placement.dayOfWeek === day)
    const occupiedPeriods = new Set(dayPlacements.map((placement) => placement.periodIndex)).size
    return {
      day,
      // Parallel groups share a timetable period; count occupied grid slots,
      // not every placement row, so utilization remains within 0–100%.
      periods: occupiedPeriods,
      hours: Math.round(((occupiedPeriods * input.grid.periodMinutes) / 60) * 10) / 10,
      utilization: Math.round((occupiedPeriods / Math.max(1, input.grid.periodsPerDay)) * 100) / 100,
      subjects: dayPlacements.map((placement) => placement.subjectCode || placement.subject),
    }
  })

  const cohortLabelsByKey = new Map<string, string>()
  const cohortScopesForReport = demand.map(({ course }) => ({
    branch: course.branch,
    batch: course.batch,
    division: course.division,
    section: course.section,
  }))
  for (const scope of cohortScopesForReport) {
    const prefix = `${branchIdentity(scope.branch)}|${batchKeyTokens(scope.batch).sort().join(',')}`
    for (const label of cohortLabels(scope)) cohortLabelsByKey.set(`${prefix}|${label.toLowerCase()}`, label)
  }
  const cohortDailyCoverage: CohortDailyCoverage[] = []
  for (const [cohortKey, division] of cohortLabelsByKey) {
    const [prefix] = cohortKey.split(`|${division.toLowerCase()}`)
    const cohortCounterKey = division === 'All' ? `${prefix}|__all__` : `${prefix}|${division.toLowerCase()}`
    for (const day of input.grid.days) {
      const classes = cohortMeetingCount.get(`${cohortCounterKey}|${day}`) ?? 0
      cohortDailyCoverage.push({
        division,
        day,
        classes,
        targetMin: TARGET_CLASSES_PER_DAY_MIN,
        targetMax: TARGET_CLASSES_PER_DAY_MAX,
        onTarget: classes >= TARGET_CLASSES_PER_DAY_MIN && classes <= TARGET_CLASSES_PER_DAY_MAX,
      })
    }
  }
  cohortDailyCoverage.sort((a, b) => a.division.localeCompare(b.division, undefined, { numeric: true }) || input.grid.days.indexOf(a.day) - input.grid.days.indexOf(b.day))
  const divisionsInTarget = new Set(cohortDailyCoverage.map((coverage) => coverage.division)).size === 0
    ? 0
    : [...new Set(cohortDailyCoverage.map((coverage) => coverage.division))].filter((division) =>
        cohortDailyCoverage.filter((coverage) => coverage.division === division).every((coverage) => coverage.onTarget),
      ).length

  const periodsRequested = demand.reduce((sum, entry) => sum + entry.periods, 0)
  return {
    grid: input.grid,
    rooms,
    placements,
    unplaced,
    facultyLoad,
    facultyDailyLoad,
    dailyCoverage,
    cohortDailyCoverage,
    demand: demandRows,
    summary: {
      courses: input.courses.length,
      placements: placements.length,
      periodsRequested,
      periodsPlaced: placements.length,
      unplacedCourses: unplaced.length,
      overloadedFaculty: facultyLoad.filter((faculty) => faculty.demandExceeded || faculty.overloaded).length,
      divisionsInTarget,
      coursesIncluded: placeable.length,
    },
    ...(usesRng ? { randomSeed: effectiveSeed } : {}),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Payload validation (pure — throws HttpsError)
// ═════════════════════════════════════════════════════════════════════════════

export interface AutoSchedulePayload {
  curriculumId: string
  batch: string
  division: string
  section: string
  grid: ScheduleGrid
  rooms: string[]
  semesterWeeks: number
  maxPeriodsPerDayPerFaculty: number
  targetFacultyClassesPerDay: number
  facultyDayPreference: FacultyDayPreference
  teachingGroupMode: TeachingGroupMode
  maxWeeklyPeriodsPerFaculty: number
  dryRun: boolean
  collegeId: string
  /** P1 — one applicability window per apply run, written through to docs. */
  dateRange?: { from: string; to?: string }
  /** P3 — default 'uniform' (pre-v2 behaviour). */
  strategy: PlacementStrategy
  /** P3 — deterministic seed for 'random' placement / random room pick. */
  randomSeed?: string
  /** P3 — default 'leastLoaded'. */
  roomStrategy: RoomStrategy
  /** P2 — per-course include / weekly-period steering. */
  courseOverrides: CourseOverride[]
  /** Non-fatal operator hints (e.g. a dateRange wider than one generate run). */
  warnings: string[]
}

function boundedInt(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpsError('invalid-argument', `${field} must be between ${min} and ${max}`)
  }
  return Math.floor(n)
}

export const DEFAULT_GRID: ScheduleGrid = {
  days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  periodsPerDay: 5,
  startTime: '08:00',
  periodMinutes: 50,
  breakAfterPeriod: 3,
  breakMinutes: 15,
  labSpan: 2,
}

export function validateAutoSchedulePayload(
  data: unknown,
  role: string,
  claimCollegeId: string,
): AutoSchedulePayload {
  const raw = (data || {}) as Record<string, unknown>
  const curriculumId = String(raw.curriculumId ?? '').trim()
  if (!curriculumId || curriculumId.length > 100) {
    throw new HttpsError('invalid-argument', 'curriculumId is required')
  }
  const batch = String(raw.batch ?? '').trim()
  if (!batch || batch.length > 50) throw new HttpsError('invalid-argument', 'batch is required (e.g. 2026)')

  const gridRaw = (raw.grid || {}) as Record<string, unknown>
  const daysRaw = Array.isArray(gridRaw.days) ? gridRaw.days : DEFAULT_GRID.days
  const days = daysRaw
    .map((d) => normalizeDay(d))
    .filter((d): d is DayOfWeek => d !== null)
    .slice(0, 7)
  if (days.length === 0) throw new HttpsError('invalid-argument', 'grid.days must name at least one weekday')
  const startTime = String(gridRaw.startTime ?? DEFAULT_GRID.startTime).trim()
  if (!isValidTime(startTime)) throw new HttpsError('invalid-argument', 'grid.startTime must be HH:mm')

  const collegeId = role === 'superadmin' ? String(raw.collegeId ?? '').trim() : claimCollegeId
  if (!collegeId) throw new HttpsError('invalid-argument', 'No college is associated with this account')

  // P1 — applicability window (one per apply run). Dates must be real; the
  // range may exceed one generate run (whole semester is the usual intent) —
  // that is warned, not rejected, because the expansion callable chunks at 92.
  const warnings: string[] = []
  let dateRange: { from: string; to?: string } | undefined
  if (raw.dateRange !== undefined && raw.dateRange !== null) {
    const rangeRaw = (raw.dateRange || {}) as Record<string, unknown>
    const from = String(rangeRaw.from ?? '').trim()
    const to = String(rangeRaw.to ?? '').trim()
    if (!isValidDateKey(from)) {
      throw new HttpsError('invalid-argument', 'dateRange.from must be a yyyy-mm-dd date')
    }
    if (to && !isValidDateKey(to)) {
      throw new HttpsError('invalid-argument', 'dateRange.to must be a yyyy-mm-dd date')
    }
    if (to && daysBetween(from, to) < 0) {
      throw new HttpsError('invalid-argument', 'dateRange.from must be on or before dateRange.to')
    }
    if (to && daysBetween(from, to) + 1 > MAX_GENERATE_RANGE_DAYS) {
      warnings.push(
        `dateRange covers ${daysBetween(from, to) + 1} days — generateClassSessions expands at most ` +
          `${MAX_GENERATE_RANGE_DAYS} days per run; generate the term in chunks`,
      )
    }
    dateRange = to ? { from, to } : { from }
  }

  // P3 — placement strategy + seeded RNG + room pick.
  const strategyRaw = String(raw.strategy ?? 'uniform').trim() || 'uniform'
  if (!PLACEMENT_STRATEGIES.includes(strategyRaw as PlacementStrategy)) {
    throw new HttpsError('invalid-argument', `strategy must be one of: ${PLACEMENT_STRATEGIES.join(', ')}`)
  }
  const roomStrategyRaw = String(raw.roomStrategy ?? 'leastLoaded').trim() || 'leastLoaded'
  if (!ROOM_STRATEGIES.includes(roomStrategyRaw as RoomStrategy)) {
    throw new HttpsError('invalid-argument', `roomStrategy must be one of: ${ROOM_STRATEGIES.join(', ')}`)
  }
  const randomSeed = String(raw.randomSeed ?? '').trim().slice(0, 64)

  const facultyDayPreferenceRaw = String(raw.facultyDayPreference ?? 'compact').trim() || 'compact'
  if (!FACULTY_DAY_PREFERENCES.includes(facultyDayPreferenceRaw as FacultyDayPreference)) {
    throw new HttpsError('invalid-argument', `facultyDayPreference must be one of: ${FACULTY_DAY_PREFERENCES.join(', ')}`)
  }
  const teachingGroupModeRaw = String(raw.teachingGroupMode ?? 'mapping').trim() || 'mapping'
  if (!TEACHING_GROUP_MODES.includes(teachingGroupModeRaw as TeachingGroupMode)) {
    throw new HttpsError('invalid-argument', `teachingGroupMode must be one of: ${TEACHING_GROUP_MODES.join(', ')}`)
  }

  // P2 — per-course / teaching-group inclusion & weekly-load overrides.
  const courseOverrides: CourseOverride[] = []
  if (raw.courseOverrides !== undefined && raw.courseOverrides !== null) {
    if (!Array.isArray(raw.courseOverrides)) {
      throw new HttpsError('invalid-argument', 'courseOverrides must be an array')
    }
    if (raw.courseOverrides.length > MAX_COURSE_GROUPS) {
      throw new HttpsError('invalid-argument', `courseOverrides allows at most ${MAX_COURSE_GROUPS} rows`)
    }
    for (const [i, entry] of raw.courseOverrides.entries()) {
      const row = (entry || {}) as Record<string, unknown>
      const mappingId = String(row.mappingId ?? '').trim()
      const demandKey = String(row.demandKey ?? '').trim()
      if ((!mappingId && !demandKey) || mappingId.length > 120 || demandKey.length > 500) {
        throw new HttpsError('invalid-argument', `courseOverrides[${i}] needs a valid mappingId or demandKey`)
      }
      const override: CourseOverride = {
        ...(mappingId ? { mappingId } : {}),
        ...(demandKey ? { demandKey } : {}),
      }
      if (row.weeklyPeriods !== undefined && row.weeklyPeriods !== null) {
        const periods = Number(row.weeklyPeriods)
        if (!Number.isFinite(periods) || periods < 0 || periods > 40) {
          throw new HttpsError(
            'invalid-argument',
            `courseOverrides[${i}].weeklyPeriods must be a number between 0 and 40 (or null)`,
          )
        }
        override.weeklyPeriods = Math.floor(periods)
      }
      if (row.include !== undefined && row.include !== null) {
        if (typeof row.include !== 'boolean') {
          throw new HttpsError('invalid-argument', `courseOverrides[${i}].include must be a boolean`)
        }
        override.include = row.include
      }
      courseOverrides.push(override)
    }
  }

  const maxPeriodsPerDayPerFaculty = boundedInt(
    raw.maxPeriodsPerDayPerFaculty,
    'maxPeriodsPerDayPerFaculty',
    4,
    1,
    10,
  )
  const targetFacultyClassesPerDay = boundedInt(
    raw.targetFacultyClassesPerDay,
    'targetFacultyClassesPerDay',
    Math.min(TARGET_FACULTY_CLASSES_PER_DAY, maxPeriodsPerDayPerFaculty),
    1,
    10,
  )
  if (targetFacultyClassesPerDay > maxPeriodsPerDayPerFaculty) {
    throw new HttpsError(
      'invalid-argument',
      'targetFacultyClassesPerDay cannot exceed maxPeriodsPerDayPerFaculty',
    )
  }

  return {
    curriculumId,
    batch,
    division: String(raw.division ?? '').trim().slice(0, 50),
    section: String(raw.section ?? '').trim().slice(0, 50),
    grid: {
      days,
      periodsPerDay: boundedInt(gridRaw.periodsPerDay, 'grid.periodsPerDay', DEFAULT_GRID.periodsPerDay, 1, 10),
      startTime,
      periodMinutes: boundedInt(gridRaw.periodMinutes, 'grid.periodMinutes', DEFAULT_GRID.periodMinutes, 20, 120),
      breakAfterPeriod: boundedInt(gridRaw.breakAfterPeriod, 'grid.breakAfterPeriod', DEFAULT_GRID.breakAfterPeriod, 0, 10),
      breakMinutes: boundedInt(gridRaw.breakMinutes, 'grid.breakMinutes', DEFAULT_GRID.breakMinutes, 0, 60),
      labSpan: boundedInt(gridRaw.labSpan, 'grid.labSpan', DEFAULT_GRID.labSpan, 1, 4),
    },
    rooms: Array.isArray(raw.rooms)
      ? raw.rooms.map((r) => String(r ?? '').trim()).filter(Boolean).slice(0, 30)
      : [],
    semesterWeeks: boundedInt(raw.semesterWeeks, 'semesterWeeks', DEFAULT_SEMESTER_WEEKS, 4, 30),
    maxPeriodsPerDayPerFaculty,
    targetFacultyClassesPerDay,
    facultyDayPreference: facultyDayPreferenceRaw as FacultyDayPreference,
    teachingGroupMode: teachingGroupModeRaw as TeachingGroupMode,
    maxWeeklyPeriodsPerFaculty: boundedInt(raw.maxWeeklyPeriodsPerFaculty, 'maxWeeklyPeriodsPerFaculty', DEFAULT_CAPACITY_WEEKLY_HOURS, 1, 60),
    dryRun: raw.dryRun !== false, // default TRUE — nothing writes without intent
    collegeId,
    ...(dateRange ? { dateRange } : {}),
    strategy: strategyRaw as PlacementStrategy,
    ...(randomSeed ? { randomSeed } : {}),
    roomStrategy: roomStrategyRaw as RoomStrategy,
    courseOverrides,
    warnings,
  }
}

/** Student division scopes for expanding legacy all-division mappings. */
export function teachingGroupsFromStudents(
  rows: Array<Record<string, unknown>>,
  target: { branch: string; batch: string; semester: number },
): TeachingGroupScope[] {
  const groups = new Map<string, TeachingGroupScope>()
  for (const row of rows) {
    const batch = String(row.batch ?? '')
    if (!batchListMatches(target.batch, batch)) continue
    const studentSemester = Number(row.semester ?? 0) || 0
    if (studentSemester > 0 && target.semester > 0 && studentSemester !== target.semester) continue
    const branch = String(row.branch ?? row.department ?? '')
    if (!cohortScopesOverlap({ branch: target.branch, batch: target.batch }, { branch, batch })) continue
    const group = {
      division: String(row.division ?? ''),
      section: String(row.section ?? ''),
    }
    const key = teachingGroupKey(group) || '__whole_batch__'
    if (!groups.has(key)) groups.set(key, group)
  }
  return [...groups.values()]
}

function minutesOfScheduleTime(value: unknown): number | null {
  const time = String(value ?? '').trim()
  if (!isValidTime(time)) return null
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function scheduleBusyPeriodKeys(
  schedule: Record<string, unknown>,
  day: DayOfWeek,
  gridSlots: PlannedSlot[],
  periodMinutes: number,
): { keys: string[]; periodCount: number } {
  const start = minutesOfScheduleTime(schedule.startTime)
  const end = minutesOfScheduleTime(schedule.endTime)
  if (start === null || end === null || end <= start) {
    const exact = String(schedule.startTime ?? '').trim()
    return { keys: isValidTime(exact) ? [busyKey(day, exact)] : [], periodCount: 1 }
  }
  const overlapping = gridSlots.filter((slot) => {
    if (slot.day !== day) return false
    const slotStart = minutesOfScheduleTime(slot.startTime)
    const slotEnd = minutesOfScheduleTime(slot.endTime)
    return slotStart !== null && slotEnd !== null && slotStart < end && start < slotEnd
  })
  const keys = overlapping.map((slot) => busyKey(day, slot.startTime))
  const periodCount = Math.max(1, Math.ceil((end - start) / Math.max(1, periodMinutes)))
  return { keys, periodCount }
}

// ═════════════════════════════════════════════════════════════════════════════
// Callable
// ═════════════════════════════════════════════════════════════════════════════

const MAX_COURSES = 60
const MAX_COURSE_GROUPS = 300
const MAX_FACULTY_READ = 500
const MAX_MAPPING_READ = 400
const MAX_STUDENT_GROUP_READ = 5000
const MAX_SCHEDULES_READ = 2000

export function assertTimetableOccupancyComplete(count: number, limit = MAX_SCHEDULES_READ): void {
  if (count >= limit) {
    throw new HttpsError(
      'failed-precondition',
      `Timetable occupancy discovery reached its ${limit}-schedule safety cap; auto-scheduling cannot guarantee clash-free placement`,
    )
  }
}

export const autoGenerateWeeklySchedule = onCall(
  { region: 'asia-south1', memory: '512MiB', timeoutSeconds: 90 },
  async (request) => {
    try {
      return await runAutoGenerateWeeklySchedule(request)
    } catch (err) {
      if (err instanceof HttpsError) throw err
      // A bare Error reaches the browser as the opaque "internal" code; log the
      // real cause and hand the operator a readable message instead.
      const message = err instanceof Error ? err.message : String(err)
      console.error('[autoGenerateWeeklySchedule] unexpected failure', err)
      throw new HttpsError('failed-precondition', `Auto-schedule could not complete: ${message}`)
    }
  },
)

async function runAutoGenerateWeeklySchedule(
  request: { auth?: { uid?: string; token?: Record<string, unknown> } | null; data: unknown },
) {
  {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required')
    const staff = await resolveSchedulingStaff(uid, request.auth?.token || {})
    const payload = validateAutoSchedulePayload(request.data, staff.role, staff.collegeId)

    const db = getFirestore(admin.app(), 'default')

    // 1. Curriculum (branch/semester authority + tenancy check)
    const curSnap = await db.collection('curriculum').doc(payload.curriculumId).get()
    if (!curSnap.exists) throw new HttpsError('not-found', 'Curriculum not found')
    const curriculum = curSnap.data() as Record<string, unknown>
    if (String(curriculum.collegeId ?? '') !== payload.collegeId) {
      throw new HttpsError('permission-denied', 'This curriculum belongs to another college')
    }
    const branch = String(curriculum.branch ?? '').trim()
    const semester = Number(curriculum.semester ?? 0) || 0

    // 2. Active course ↔ faculty mappings for this cohort. The stored
    // division letter list is the teaching group: explicit A,B stays one
    // placement. Legacy mappings with no division are expanded to the distinct
    // enrolled division groups for an all-groups run.
    const mappingsSnap = await db
      .collection('curriculumFacultyMappings')
      .where('collegeId', '==', payload.collegeId)
      .where('curriculumId', '==', payload.curriculumId)
      .limit(MAX_MAPPING_READ)
      .get()
    if (mappingsSnap.size === MAX_MAPPING_READ) {
      throw new HttpsError('failed-precondition', `Mapping discovery reached its ${MAX_MAPPING_READ}-record safety cap; narrow the curriculum scope`)
    }
    const facultySnap = await db
      .collection('faculty')
      .where('collegeId', '==', payload.collegeId)
      .limit(MAX_FACULTY_READ)
      .get()
    if (facultySnap.size === MAX_FACULTY_READ) {
      throw new HttpsError('failed-precondition', `Faculty identity discovery reached its ${MAX_FACULTY_READ}-record safety cap; auto-scheduling cannot safely reconcile faculty IDs`)
    }
    const facultyAliases = buildFacultyIdentityMap(
      facultySnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) })),
    )
    type MappingRow = Record<string, unknown> & { id: string; division?: unknown; section?: unknown }
    const requestedScope = { division: payload.division, section: payload.section }
    const mappings = mappingsSnap.docs
      .map((doc): MappingRow => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
      .filter((mapping) => {
        if (String(mapping.status ?? 'active') === 'removed' || String(mapping.status) === 'inactive') return false
        if (!batchListMatches(payload.batch, mapping.batch)) return false
        if (hasGroupLetters(requestedScope) && !divisionScopesOverlap(mapping, requestedScope)) return false
        return Boolean(String(mapping.facultyId ?? '').trim())
      })
    if (mappings.length > MAX_COURSES) {
      throw new HttpsError('failed-precondition', `This run has ${mappings.length} active mappings; narrow it to at most ${MAX_COURSES} courses`)
    }

    let rosterGroups: TeachingGroupScope[] = []
    const needsRosterExpansion = mappings.some((mapping) => !hasGroupLetters(mapping))
    if (needsRosterExpansion) {
      const studentsSnap = await db.collection('students').where('collegeId', '==', payload.collegeId).limit(MAX_STUDENT_GROUP_READ).get()
      if (studentsSnap.size === MAX_STUDENT_GROUP_READ) {
        throw new HttpsError('failed-precondition', `Teaching-group discovery reached its ${MAX_STUDENT_GROUP_READ}-student safety cap; auto-scheduling cannot safely expand legacy mappings`)
      }
      const studentRows = studentsSnap.docs.map((doc) => doc.data() as Record<string, unknown>)
      rosterGroups = teachingGroupsFromStudents(studentRows, { branch, batch: payload.batch, semester })
      if (rosterGroups.length === 0 && !hasGroupLetters(requestedScope)) {
        throw new HttpsError('failed-precondition', 'Legacy all-division mappings need student division/section data to expand into teaching groups; add the roster scopes or explicitly choose a division')
      }
    }

    const courses: AutoScheduleCourse[] = []
    for (const mapping of mappings) {
      const groups = resolveMappingTeachingGroups(
        { division: mapping.division, section: mapping.section },
        rosterGroups,
        requestedScope,
        payload.teachingGroupMode,
      )
      for (const group of groups) {
        courses.push({
          mappingId: String(mapping.id),
          courseId: String(mapping.courseId ?? ''),
          courseCode: String(mapping.courseCode ?? ''),
          courseName: String(mapping.courseName ?? ''),
          facultyId: canonicalFacultyId(mapping.facultyId, facultyAliases),
          facultyName: String(mapping.facultyName ?? mapping.facultyId ?? ''),
          totalHours: Number(mapping.totalHours ?? 0) || 0,
          credits: Number(mapping.credits ?? 0) || 0,
          branch: String(mapping.branch ?? branch),
          semester: Number(mapping.semester ?? semester) || semester,
          batch: payload.batch,
          division: group.division,
          section: group.section,
        })
        if (courses.length > MAX_COURSE_GROUPS) {
          throw new HttpsError('failed-precondition', `This run expands to more than ${MAX_COURSE_GROUPS} teaching groups; reduce the cohort scope`)
        }
      }
    }
    if (courses.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        'No active faculty mappings for this curriculum/batch/division/section — run Auto Map first',
      )
    }

    // 3. Occupancy from the college's live timetable
    const schedulesSnap = await db
      .collection('weeklySchedules')
      .where('collegeId', '==', payload.collegeId)
      .limit(MAX_SCHEDULES_READ)
      .get()
    assertTimetableOccupancyComplete(schedulesSnap.size)
    const gridSlots = buildSlots(payload.grid)
    const occupancy: Occupancy = {
      facultyBusy: new Set(),
      cohortBusy: new Set(),
      cohortBusyScopes: [],
      facultyDaily: new Map(),
      facultyDailyMeetings: new Map(),
      roomBusy: new Set(),
      facultyWeekly: new Map(),
    }

    const existingFacultyMeetings = new Set<string>()
    for (const document of schedulesSnap.docs) {
      const schedule = document.data() as Record<string, unknown>
      if (schedule.isActive === false) continue
      const day = normalizeDay(schedule.dayOfWeek)
      if (!day) continue
      const { keys, periodCount } = scheduleBusyPeriodKeys(schedule, day, gridSlots, payload.grid.periodMinutes)
      const facultyId = canonicalFacultyId(schedule.facultyId, facultyAliases)
      if (facultyId) {
        for (const key of keys) occupancy.facultyBusy.add(facultyBusyKey(facultyId, key))
        occupancy.facultyWeekly.set(facultyId, (occupancy.facultyWeekly.get(facultyId) ?? 0) + periodCount)
        const dailyKey = `${facultyId}|${day}`
        occupancy.facultyDaily!.set(dailyKey, (occupancy.facultyDaily!.get(dailyKey) ?? 0) + periodCount)
        const meetingKey = String(schedule.meetingKey ?? '').trim()
        const meetingIdentity = meetingKey ? `${facultyId}|${day}|${meetingKey}` : `${facultyId}|${day}|${document.id}`
        if (!existingFacultyMeetings.has(meetingIdentity)) {
          existingFacultyMeetings.add(meetingIdentity)
          occupancy.facultyDailyMeetings!.set(dailyKey, (occupancy.facultyDailyMeetings!.get(dailyKey) ?? 0) + 1)
        }
      }
      const room = String(schedule.room ?? '').trim()
      if (room) for (const key of keys) occupancy.roomBusy.add(`${key}|${room}`)
      occupancy.cohortBusyScopes!.push({
        branch: schedule.branch,
        batch: schedule.batch,
        division: schedule.division,
        section: schedule.section,
        busy: new Set(keys),
      })
    }

    const plan = planAutoSchedule({
      courses,
      grid: payload.grid,
      rooms: payload.rooms,
      occupancy,
      semesterWeeks: payload.semesterWeeks,
      maxPeriodsPerDayPerFaculty: payload.maxPeriodsPerDayPerFaculty,
      targetFacultyClassesPerDay: payload.targetFacultyClassesPerDay,
      facultyDayPreference: payload.facultyDayPreference,
      maxWeeklyPeriodsPerFaculty: payload.maxWeeklyPeriodsPerFaculty,
      strategy: payload.strategy,
      ...(payload.randomSeed ? { randomSeed: payload.randomSeed } : {}),
      roomStrategy: payload.roomStrategy,
      courseOverrides: payload.courseOverrides,
    })

    // P4 — the college's academic calendar (bounded read). Weekly patterns
    // aren't day-skippable (a Mon holiday only voids specific Mondays), so
    // placement is untouched; the preview marks blocked weekdays and — with a
    // dateRange — reports teachingDays vs blockedDays. Generated sessions get
    // suppressed on these dates by `generateClassSessions`.
    const calSnap = await db
      .collection('academicCalendar')
      .where('collegeId', '==', payload.collegeId)
      .limit(MAX_CALENDAR_READ)
      .get()
    const calendarEvents = calSnap.docs
      .map((d) => toCalendarEventLite(d.id, d.data() as Record<string, unknown>))
      .filter((e): e is CalendarEventLite => e !== null)
    const calendar = buildCalendarView(calendarEvents, payload.grid.days, payload.dateRange)
    plan.calendar = calendar
    plan.summary.teachingDays = calendar.teachingDays
    plan.summary.blockedDays = calendar.blockedDays
    plan.summary.blockedBreakdown = calendar.blockedBreakdown

    // P2 — topic seeding (v2 scope: ordered module ids on the created slot
    // docs, so the session-topics UI can auto-suggest "next module"; full
    // auto-advancing topic assignment is v3).
    const moduleQueueByCourse = new Map<string, string[]>()
    if (payload.dateRange) {
      const curriculumCourses = Array.isArray(curriculum.courses) ? (curriculum.courses as unknown[]) : []
      for (const c of courses) {
        const course = curriculumCourses.find((raw) => {
          const row = (raw || {}) as Record<string, unknown>
          return (
            String(row.id ?? '') === c.courseId ||
            (c.courseCode && String(row.code ?? '').toLowerCase() === c.courseCode.toLowerCase()) ||
            (c.courseName && String(row.name ?? '').toLowerCase() === c.courseName.toLowerCase())
          )
        })
        const modules = Array.isArray((course as Record<string, unknown> | undefined)?.modules)
          ? ((course as Record<string, unknown>).modules as unknown[])
          : []
        const queue = modules
          .map((m, i) => String(((m || {}) as Record<string, unknown>).id ?? ((m || {}) as Record<string, unknown>).moduleNo ?? i + 1))
          .filter(Boolean)
        if (queue.length > 0) moduleQueueByCourse.set(c.mappingId, queue)
      }
    }

    const responseWarnings = [...payload.warnings]
    // Truthful diagnostics (acceptance): a window the calendar has exhausted
    // must say so — not leave the operator hunting for a phantom free slot.
    if (payload.dateRange && calendar.teachingDays !== undefined && calendar.teachingDays === 0) {
      responseWarnings.push(
        'The selected date range has no teaching days — every working day in it is blocked by the academic calendar',
      )
    }
    if (payload.dryRun) {
      return { dryRun: true, plan, warnings: responseWarnings, ...(plan.randomSeed ? { randomSeed: plan.randomSeed } : {}) }
    }
    if (plan.placements.length === 0) {
      return { dryRun: false, plan, created: 0, warnings: responseWarnings }
    }

    const now = Timestamp.now()
    const writeBatch = db.batch()
    for (const p of plan.placements) {
      const initials = p.facultyName
        .split(' ')
        .filter(Boolean)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
      writeBatch.set(db.collection('weeklySchedules').doc(), {
        collegeId: payload.collegeId,
        subject: p.subject,
        subjectCode: p.subjectCode,
        facultyId: p.facultyId,
        facultyName: p.facultyName,
        facultyInitials: initials,
        branch: p.branch,
        batch: p.batch,
        semester: p.semester,
        division: p.division,
        section: p.section,
        room: p.room,
        dayOfWeek: p.dayOfWeek,
        startTime: p.startTime,
        endTime: p.endTime,
        type: p.type,
        isActive: true,
        autoScheduled: true,
        mappingId: p.mappingId,
        demandKey: p.demandKey,
        meetingKey: p.meetingKey,
        // P1 — write-through applicability window (legacy docs keep no window
        // and stay perpetual; these slots die with their term).
        ...(payload.dateRange?.from ? { effectiveFrom: payload.dateRange.from } : {}),
        ...(payload.dateRange?.to ? { effectiveTo: payload.dateRange.to } : {}),
        // P2 — ordered module ids for the session-topics "next module" hint.
        ...(moduleQueueByCourse.get(p.mappingId) ? { moduleQueue: moduleQueueByCourse.get(p.mappingId) } : {}),
        importedAt: now,
        importedBy: `${staff.name || staff.uid} (auto-scheduler)`,
        createdAt: now.toDate().toISOString(),
        updatedAt: now.toDate().toISOString(),
      })
    }
    await writeBatch.commit()
    return {
      dryRun: false,
      plan,
      created: plan.placements.length,
      warnings: responseWarnings,
      ...(plan.randomSeed ? { randomSeed: plan.randomSeed } : {}),
    }
  }
}
