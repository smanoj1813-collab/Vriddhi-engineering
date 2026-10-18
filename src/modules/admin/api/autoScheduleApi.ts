// src/modules/admin/api/autoScheduleApi.ts
// Client wrapper for the G4 slot auto-scheduler (Auto-Scheduler v2 contract).
// Preview (dryRun) is the default — the dialog renders the plan; only an
// explicit Apply writes weeklySchedules docs server-side.
//
// Additions: dateRange (slot applicability window), placement and room
// strategies, group-specific demand overrides, faculty-day packing preferences,
// and calendar/daily-load diagnostics in the preview.

import { httpsCallable } from 'firebase/functions';
import { functions } from '@/Firebase/config';
import type { DayOfWeek } from '../types/schedule';
import type { CalendarEventType } from '@/shared/types/calendarEvent';

export type PlacementStrategy = 'uniform' | 'spread' | 'random';
export type RoomStrategy = 'leastLoaded' | 'random';
export type FacultyDayPreference = 'balanced' | 'compact';
export type TeachingGroupMode = 'mapping' | 'separate';

export interface AutoScheduleGridInput {
  days?: DayOfWeek[];
  periodsPerDay?: number;
  startTime?: string;
  periodMinutes?: number;
  breakAfterPeriod?: number;
  breakMinutes?: number;
  labSpan?: number;
}

export interface CourseOverrideInput {
  /** Legacy override applied to every group expanded from this mapping. */
  mappingId?: string;
  /** Preferred key for editing a single mapping + division/section demand. */
  demandKey?: string;
  /** Overrides the hoursPerWeek derivation. 0 (or include:false) excludes. */
  weeklyPeriods?: number | null;
  include?: boolean;
}

export interface AutoScheduleRequest {
  curriculumId: string;
  batch: string;
  division?: string;
  section?: string;
  grid: AutoScheduleGridInput;
  rooms: string[];
  semesterWeeks?: number;
  /** Hard period cap, distinct from the soft class-meeting target. */
  maxPeriodsPerDayPerFaculty?: number;
  targetFacultyClassesPerDay?: number;
  facultyDayPreference?: FacultyDayPreference;
  teachingGroupMode?: TeachingGroupMode;
  maxWeeklyPeriodsPerFaculty?: number;
  dryRun?: boolean;
  /** P1 — one applicability window per apply run (written to every doc). */
  dateRange?: { from: string; to?: string };
  /** P3 — default 'uniform' (pre-v2 behaviour). */
  strategy?: PlacementStrategy;
  /** P3 — deterministic seed: same seed + inputs = same grid. */
  randomSeed?: string;
  /** P3 — default 'leastLoaded'. */
  roomStrategy?: RoomStrategy;
  /** P2 — per-course include / weekly-period steering. */
  courseOverrides?: CourseOverrideInput[];
}

export interface AutoSchedulePlacement {
  mappingId: string;
  demandKey: string;
  meetingKey: string;
  courseId: string;
  subject: string;
  subjectCode: string;
  facultyId: string;
  facultyName: string;
  branch: string;
  batch: string;
  semester: number;
  division: string;
  section: string;
  room: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  type: 'lecture' | 'lab';
  periodIndex: number;
  span: number;
  flags: string[];
}

export interface AutoScheduleDemandRow {
  mappingId: string;
  demandKey: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  facultyName: string;
  division: string;
  section: string;
  periodsRequested: number;
  included: boolean;
  source: 'derived' | 'override' | 'excluded' | 'zero-hours';
  reason?: string;
}

export interface AutoScheduleCalendarView {
  events: {
    id: string;
    title: string;
    type: CalendarEventType;
    startDate: string;
    endDate: string;
    suspendsClasses: boolean;
  }[];
  blockedWeekdays: { day: DayOfWeek; titles: string[] }[];
  blockedDates: {
    date: string;
    title: string;
    type: CalendarEventType;
    suspendsClasses: boolean;
  }[];
  teachingDays?: number;
  blockedDays?: number;
  blockedBreakdown: Record<string, number>;
}

export interface AutoSchedulePlan {
  grid: {
    days: DayOfWeek[];
    periodsPerDay: number;
    startTime: string;
    periodMinutes: number;
    breakAfterPeriod: number;
    breakMinutes: number;
    labSpan: number;
  };
  rooms: string[];
  placements: AutoSchedulePlacement[];
  unplaced: {
    mappingId: string;
    courseId: string;
    subject: string;
    division: string;
    section: string;
    periodsRequested: number;
    periodsPlaced: number;
    reason: string;
  }[];
  facultyDailyLoad: {
    facultyId: string;
    facultyName: string;
    day: DayOfWeek;
    classes: number;
    periods: number;
    targetClasses: number;
    targetMet: boolean;
  }[];
  facultyLoad: {
    facultyId: string;
    facultyName: string;
    existingWeekly: number;
    requestedWeekly: number;
    projectedWeekly: number;
    placedWeekly: number;
    totalWeekly: number;
    capacity: number;
    overloaded: boolean;
    demandExceeded: boolean;
    demandBreakdown: {
      courseId: string;
      subject: string;
      groups: string[];
      groupsServed: number;
      periodsPerGroup: number;
      periodsRequested: number;
    }[];
    mergeSuggestions: string[];
  }[];
  dailyCoverage: {
    day: DayOfWeek;
    periods: number;
    hours: number;
    utilization: number;
    subjects: string[];
  }[];
  cohortDailyCoverage: {
    division: string;
    day: DayOfWeek;
    classes: number;
    targetMin: number;
    targetMax: number;
    onTarget: boolean;
  }[];
  /** P2 — the preview's demand list (drives the override table). */
  demand: AutoScheduleDemandRow[];
  /** P4 — calendar view (blocked weekdays + teachingDays vs blockedDays). */
  calendar?: AutoScheduleCalendarView;
  /** P3 — echo of the effective seed when a seeded RNG shaped this plan. */
  randomSeed?: string;
  summary: {
    courses: number;
    placements: number;
    periodsRequested: number;
    periodsPlaced: number;
    unplacedCourses: number;
    overloadedFaculty: number;
    divisionsInTarget?: number;
    coursesIncluded?: number;
    teachingDays?: number;
    blockedDays?: number;
    blockedBreakdown?: Record<string, number>;
  };
}

export interface AutoScheduleResponse {
  dryRun: boolean;
  plan: AutoSchedulePlan;
  created?: number;
  /** Operations runs are saved as a draft for HOD approval, not written live. */
  draft?: boolean;
  approvalId?: string;
  /** Non-fatal operator hints (e.g. a dateRange wider than one generate run). */
  warnings?: string[];
  /** Effective RNG seed when strategy/room pick is random. */
  randomSeed?: string;
}

export async function autoGenerateWeeklySchedule(
  input: AutoScheduleRequest,
): Promise<AutoScheduleResponse> {
  const fn = httpsCallable<AutoScheduleRequest, AutoScheduleResponse>(functions, 'autoGenerateWeeklySchedule');
  const res = await fn(input);
  return res.data;
}
