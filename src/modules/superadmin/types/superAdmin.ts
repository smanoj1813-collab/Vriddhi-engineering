// src/types/superAdmin.ts
// Centralized types for Super Admin module

import { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import type { BatchProgress } from "../../../shared/utils/batchedImport";

// ═══════════════════════════════════════════════════════════════════════
// UNIVERSITY CLASSIFICATION (shared with types/university.ts)
// ═══════════════════════════════════════════════════════════════════════

export type UniversityManagementType = "Government" | "Government Aided" | "Private";
export type AutonomyStatus = "Autonomous" | "Non-Autonomous";
export type CourseCode = string;
export type VriddhiStatus = "not_onboarded" | "onboarding" | "active" | "suspended";

// ═══════════════════════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════════════════════
export interface PaginatedResult<T> {
  items: T[];
  data: T[]; // alias for items, backward compatibility
  total: number;
  hasMore: boolean;
  lastDoc?: QueryDocumentSnapshot<DocumentData>;
}

// ═══════════════════════════════════════════════════════════════════════
// COLLEGE TYPES
// ═══════════════════════════════════════════════════════════════════════
export type CollegeStatus = "active" | "inactive" | "suspended" | "trial";
export type PlanType = "basic" | "standard" | "premium" | "enterprise" | "pro";
export type BillingCycle = "monthly" | "quarterly" | "yearly";

export interface College {
  id: string;
  name: string;
  code: string;
  shortName?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  location?: string;
  phone?: string;
  email?: string;
  website?: string;
  status: CollegeStatus;
  plan: PlanType;
  billingCycle: BillingCycle;
  createdAt: string;
  updatedAt: string;
  studentCount: number;
  facultyCount: number;
  adminCount: number;
  currentStudents?: number;
  currentFaculty?: number;
  courses?: number;
  subscriptionEnd?: string;
  logo?: string;

  // ═══ NEW: University Classification Fields ═══
  /** Firestore ID of the affiliated university */
  universityId?: string;
  /** Name of the affiliated university */
  universityName?: string;
  /** University short code (e.g., "BCU", "BU") */
  universityCode?: string;
  /** Government / Government Aided / Private */
  managementType?: UniversityManagementType;
  /** Autonomous / Non-Autonomous */
  autonomyStatus?: AutonomyStatus;
  /** Karnataka district where the college is located */
  district?: string;
  /** Courses this specific college offers (subset of university courses) */
  offeredCourses?: CourseCode[];
  /** Vriddhi onboarding status */
  vriddhiStatus?: VriddhiStatus;
  /** When the college was onboarded to Vriddhi */
  vriddhiOnboardingDate?: string;
}

export interface CreateCollegeInput {
  name: string;
  code: string;
  shortName?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  location?: string;
  phone?: string;
  email?: string;
  website?: string;
  plan?: PlanType;
  billingCycle?: BillingCycle;
  currentStudents?: number;
  currentFaculty?: number;
  courses?: number;
  subscriptionEnd?: string;
  pincode?: string;
  principalName?: string;
  principalEmail?: string;
  principalPhone?: string;
  establishedYear?: string;
  affiliation?: string;
  accreditation?: string;
  description?: string;

  // ═══ NEW ═══
  universityId?: string;
  universityName?: string;
  managementType?: UniversityManagementType;
  autonomyStatus?: AutonomyStatus;
  district?: string;
  offeredCourses?: CourseCode[];
}

export interface ListCollegesOptions {
  status?: CollegeStatus | "all";
  search?: string;
  limit?: number;
  pageSize?: number;
  lastDoc?: QueryDocumentSnapshot<DocumentData>;
}

// ═══════════════════════════════════════════════════════════════════════
// ADMIN TYPES
// ═══════════════════════════════════════════════════════════════════════
export type AdminRole = "superadmin" | "admin" | "hod" | "mentor" | "accounts" | "operations";
/** College office teams — created by the superadmin; no profile collection of their own. */
export const OFFICE_ADMIN_ROLES: readonly AdminRole[] = ["accounts", "operations"];
export type AdminStatus = "active" | "inactive";

export interface Admin {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  collegeId: string;
  collegeName?: string;
  collegeCode?: string;
  status: AdminStatus;
  createdAt: string;
  lastLogin?: string;
  phone?: string;
  department?: string;
}

export interface CreateAdminInput {
  name: string;
  email: string;
  role: AdminRole;
  collegeId: string;
  phone?: string;
  department?: string;
  password?: string;
}

export interface ListAdminsOptions {
  collegeId?: string;
  status?: AdminStatus | "all";
  role?: AdminRole;
  search?: string;
  limit?: number;
  pageSize?: number;
  lastDoc?: QueryDocumentSnapshot<DocumentData>;
}

// ═══════════════════════════════════════════════════════════════════════
// STUDENT TYPES
// ═══════════════════════════════════════════════════════════════════════
export type StudentStatus = "active" | "inactive";

export interface Student {
  id: string;
  name: string;
  email: string;
  regNo: string;
  collegeId: string;
  collegeName?: string;
  batch: string;
  division: string;
  /**
   * Section letter when the college records division AND section separately.
   * Legacy rows may carry only one of the two — the attendance cohort matcher
   * treats the pair as interchangeable letters (see cohortMatching.ts).
   */
  section?: string;
  mentor?: string;
  /** Canonical academic program. Legacy rows may only have `department`. */
  branch?: string;
  /** Backwards-compatible alias for branch used by older imports and screens. */
  department?: string;
  status: StudentStatus;
  createdAt: string;
  updatedAt?: string;
  phone?: string;
  avatar?: string;
  uid?: string;
  // ── Platform access (see AccessProduct) ──
  accessProductId?: string;
  accessProductName?: string;
  accessDurationMonths?: number;
  accessPrice?: number;
  accessCurrency?: string;
  /** First day of access, yyyy-mm-dd. */
  accessStart?: string;
  /** LAST day of access, inclusive, yyyy-mm-dd. Status is derived from this. */
  accessEnd?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// PLATFORM-ACCESS PRODUCTS (duration + price, sold per student)
// ═══════════════════════════════════════════════════════════════════════

/**
 * A sellable unit of platform access: a name, a duration in MONTHS (12, 24,
 * 36 = 1/2/3 years) and a price per student. Assigning one to a student writes
 * the window it buys (accessStart → accessEnd) onto the student record, which
 * is what the onboarding import, the student list and the MIS all read.
 */
export interface AccessProduct {
  id: string;
  name: string;
  /** Short code shown in tables (auto-derived when left blank). */
  code: string;
  durationMonths: number;
  /** Price per student, in `currency`. */
  price: number;
  currency: string;
  description?: string;
  /** Archived products stay readable but cannot be assigned. */
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccessProductInput {
  name: string;
  code?: string;
  durationMonths: number;
  price: number;
  currency?: string;
  description?: string;
  active?: boolean;
}

export interface AccessMisProductRow {
  productId: string;
  productName: string;
  durationMonths: number;
  price: number;
  students: number;
  active: number;
  expiring: number;
  expired: number;
  /** price × (active + expiring) — the access still running. */
  activeValue: number;
  /** price × expired — lapsed access, the renewal pipeline. */
  expiredValue: number;
}

export interface AccessMisResponse {
  generatedAt: string;
  /** The day the buckets were computed for (IST). */
  today: string;
  totals: {
    students: number;
    withProduct: number;
    active: number;
    expiring: number;
    expired: number;
    unassigned: number;
    activeValue: number;
    expiredValue: number;
  };
  byProduct: AccessMisProductRow[];
  byCollege: Array<{
    collegeId: string;
    students: number;
    active: number;
    expiring: number;
    expired: number;
    unassigned: number;
  }>;
  expiringSoon: Array<{
    studentId: string;
    name: string;
    regNo: string;
    collegeId: string;
    productName: string;
    end: string;
    daysLeft: number | null;
  }>;
}

export interface BulkAccessUpdateInput {
  studentIds: string[];
  productId?: string;
  /** yyyy-mm-dd; defaults to today. Ignored when clearAccess is true. */
  startDate?: string;
  /** Remove the access fields entirely (product was sold outside the system). */
  clearAccess?: boolean;
}

export interface BulkAccessUpdateResult {
  updated: number;
  missingIds: string[];
  productName: string;
  accessStart: string;
  accessEnd: string;
  cleared: number;
}

export interface ListStudentsOptions {
  collegeId?: string;
  batch?: string;
  division?: string;
  /** Section letter (matches `division` or `section`, see StudentListFilters). */
  section?: string;
  branch?: string;
  status?: StudentStatus | "all";
  search?: string;
  limit?: number;
  pageSize?: number;
  lastDoc?: QueryDocumentSnapshot<DocumentData>;
}

export interface UpdateStudentInput {
  name?: string;
  email?: string;
  regNo?: string;
  batch?: string;
  division?: string;
  /** Section letter — part of the attendance cohort match, like `division`. */
  section?: string;
  mentor?: string;
  /** Updating this field also keeps the legacy `department` alias in sync. */
  branch?: string;
  department?: string;
  status?: StudentStatus;
  phone?: string;
}

export interface BulkStudentAcademicUpdateInput {
  studentIds: string[];
  /** Omit a value to leave that field unchanged for every selected student. */
  batch?: string;
  branch?: string;
  /** Semester number, 1–12. Omit to leave the semester untouched. */
  semester?: number;
}

export interface BulkStudentAcademicUpdateResult {
  requested: number;
  updated: number;
  missingIds: string[];
}

// ═══════════════════════════════════════════════════════════════════════
// IMPORT TYPES
// ═══════════════════════════════════════════════════════════════════════
export interface ImportUserEntry {
  name: string;
  email: string;
  regNo?: string;
  role: "student" | "faculty";
  batch?: string;
  division?: string;
  phone?: string;
  mentor?: string;
  department?: string;
  semester?: number;
  dob?: string;
  gender?: string;
  address?: string;
}

export interface ImportUsersInput {
  collegeId: string;
  users: ImportUserEntry[];
  /**
   * 'temp-password' (default) returns a one-time password per row for the
   * importer to hand out. 'reset-email' mints a Firebase password-reset link
   * instead, so no plaintext credential is ever shown or shared.
   */
  deliveryMode?: 'temp-password' | 'reset-email';
  /** Staff rows whose account already exists: leave them or rotate credentials. */
  onExisting?: 'skip' | 'reset';
  /**
   * Platform-access product applied to every imported student, and the day its
   * window starts (yyyy-mm-dd, default: today). See AccessProduct.
   */
  productId?: string;
  accessStart?: string;
  /**
   * Called as each batch is dispatched. Rows go up in batches because one
   * request cannot be held open for the minutes a large upload takes — see
   * `src/shared/utils/batchedImport.ts`.
   */
  onProgress?: (progress: BatchProgress) => void;
}

export interface ImportResult {
  /** Rows that received a new credential (excludes `skipped`). */
  success: number;
  successful?: number;
  /** Rows left untouched because a working account already existed. */
  skipped?: number;
  failed: number;
  errors: string[];
  /** Non-fatal but important: stale backend, unverified Auth, reclaimed passwords. */
  warnings?: string[];
  /** Rows the backend confirmed exist in Firebase Authentication. */
  authVerified?: number;
  imported: Array<{
    id: string;
    email: string;
    password?: string;
    /** Password-reset URL when deliveryMode is 'reset-email'. */
    resetLink?: string;
    name?: string;
    role?: string;
    uid?: string;
    /** Profile document id (students/{id} or faculty/{id}). */
    docId?: string;
    status?: 'created' | 'reclaimed' | 'skipped' | 'failed';
    /** False when the Auth account could not be read back after provisioning. */
    authVerified?: boolean;
    delivery?: 'temp-password' | 'reset-link' | 'none';
    error?: string;
  }>;
  failedStudents?: Array<{ name: string; email: string; regNo: string; reason: string }>;
  /**
   * Structured failures from any importer, not just the student one.
   * `failedStudents` is student-specific and predates this; these are the
   * generic rows the export buttons read, so faculty imports can hand back
   * something a spreadsheet can open instead of only a list of strings.
   */
  failedRows?: Array<{ name?: string; email?: string; regNo?: string; reason: string }>;
}

// ═══════════════════════════════════════════════════════════════════════
// FACULTY IMPORT TYPES
// ═══════════════════════════════════════════════════════════════════════
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'ADJUNCT' | 'VISITING';

/**
 * G5: guest/P&T faculty contract window + per-period pay. Only meaningful
 * when employmentType is not FULL_TIME — the auto-mapper reads the date
 * window (expired guests are not offered for new mappings) and the billing
 * report multiplies scheduled periods by periodRate.
 */
export interface GuestContract {
  startDate?: string;
  endDate?: string | null;
  periodRate?: number;
  notes?: string;
}

export interface FacultyImportEntry {
  facultyId?: string;
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  gender?: string;
  collegeName?: string;
  collegeCode?: string;
  /** Primary branch retained for backwards compatibility. */
  department?: string;
  /** Every branch/program this faculty member may teach. */
  branches?: string[];
  designation?: string;
  employmentType?: EmploymentType;
  joiningDate?: string;
  qualification?: string;
  specialization?: string;
  subjectsUG?: string[];
  subjectsPG?: string[];
  experienceYears?: number;
  guestContract?: GuestContract;
  isHOD?: boolean;
}

export interface FacultyImportPayload {
  collegeId: string;
  faculty: FacultyImportEntry[];
  deliveryMode?: 'temp-password' | 'reset-email';
  /** 'skip' leaves existing accounts alone; 'reset' rotates their password. */
  onExisting?: 'skip' | 'reset';
  /**
   * Called as each batch is dispatched. Rows go up in batches because one
   * request cannot be held open for the minutes a large upload takes — see
   * `src/shared/utils/batchedImport.ts`.
   */
  onProgress?: (progress: BatchProgress) => void;
}

export interface CreateFacultyInput {
  collegeId: string;
  facultyId: string;
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  gender?: string;
  branches: string[];
  designation?: string;
  employmentType?: EmploymentType;
  joiningDate?: string;
  qualification?: string;
  specialization?: string;
  experienceYears?: number;
  isHOD?: boolean;
  deliveryMode?: 'temp-password' | 'reset-email';
  /** G5: guest contract window + per-period rate (non-full-time only). */
  guestContract?: GuestContract;
}

export interface CreateFacultyResult {
  facultyId: string;
  uid?: string;
  email: string;
  name: string;
  temporaryPassword?: string;
  resetLink?: string;
  delivery?: 'temp-password' | 'reset-link' | 'none';
}

// ═══════════════════════════════════════════════════════════════════════
// FACULTY TYPES
// ═══════════════════════════════════════════════════════════════════════
export interface Faculty {
  id: string;
  facultyId: string;
  name: string;           // ← computed from firstName + lastName
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: string;
  collegeId: string;
  collegeName: string;
  collegeCode: string;
  /** Primary branch used by legacy single-department features (and HOD scope). */
  department: string;
  /** All branches/programs assigned to this faculty member. */
  branches: string[];
  designation: string;
  employmentType: EmploymentType;
  joiningDate: string;
  qualification: string;
  specialization: string;
  /** G5: guest contract window + per-period rate (non-full-time only). */
  guestContract?: GuestContract;
  subjectsUG: string[];
  subjectsPG: string[];
  experienceYears: number;
  isHOD: boolean;
  role: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  password?: string;
  lastLogin?: string;
}

export interface ListFacultyOptions {
  collegeId?: string;
  department?: string;
  status?: 'active' | 'inactive' | 'all';
  search?: string;
  limit?: number;
  pageSize?: number;
  lastDoc?: QueryDocumentSnapshot<DocumentData>;
}

export interface UpdateFacultyInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  gender?: string;
  /** First branch is mirrored to `department` for legacy consumers. */
  branches?: string[];
  department?: string;
  designation?: string;
  employmentType?: EmploymentType;
  joiningDate?: string;
  qualification?: string;
  specialization?: string;
  subjectsUG?: string[];
  subjectsPG?: string[];
  experienceYears?: number;
  guestContract?: GuestContract;
  isHOD?: boolean;
  status?: 'active' | 'inactive';
}

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD TYPES
// ═══════════════════════════════════════════════════════════════════════
export interface DashboardStats {
  totalColleges: number;
  totalStudents: number;
  totalFaculty: number;
  totalAdmins: number;
  activeColleges: number;
  suspendedColleges: number;
  newCollegesThisMonth: number;
  revenueThisMonth: number;
  activeAssessments?: number;
  recentImports?: number;
  planDistribution?: Record<string, number>;
}

export interface RecentActivity {
  id: string;
  type: "college_created" | "admin_created" | "student_imported" | "plan_changed" | "login";
  description: string;
  userName: string;
  user?: string;
  action?: string;
  target?: string;
  status?: string;
  timestamp: string;
  collegeName?: string;
}

export interface TopCollege {
  id: string;
  name: string;
  code: string;
  studentCount: number;
  facultyCount: number;
  students?: number;
  faculty?: number;
  avgAttendance: number;
  passRate: number;
  score: number;
  status?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// COMPARISON TYPES
// ═══════════════════════════════════════════════════════════════════════
export type ComparisonMetric = "attendance" | "score" | "passRate" | "feeCollection" | "libraryUsage" | "placement" | "mentorRatio" | "research";
export type TimeRange = "7d" | "30d" | "90d" | "1y";

export interface ComparisonFilter {
  metric: ComparisonMetric;
  timeRange: TimeRange;
}

export interface CollegeMetric {
  collegeId: string;
  collegeName: string;
  collegeCode: string;
  students: number;
  faculty: number;
  avgAttendance: number;
  avgScore: number;
  passRate: number;
  feeCollectionRate: number;
  libraryUsage: number;
  placementRate: number;
  mentorRatio: number;
  researchPapers: number;
  trendAttendance: number;
  trendScore: number;
  trendPassRate: number;
  percentileAttendance: number;
  percentileScore: number;
  percentilePassRate: number;
}

export interface ComparisonResult {
  colleges: CollegeMetric[];
  average: number;
  median: number;
  stdDev: number;
  best: CollegeMetric;
  worst: CollegeMetric;
}

export interface BenchmarkData {
  metric: string;
  collegeValue: number;
  averageValue: number;
  topValue: number;
  percentile: number;
}

// ═══════════════════════════════════════════════════════════════════════
// SUBSCRIPTION TYPES
// ═══════════════════════════════════════════════════════════════════════
export interface SubscriptionPlan {
  id: string;
  name: string;
  type: PlanType;
  price: number;
  billingCycle: BillingCycle;
  maxStudents: number;
  maxFaculty: number;
  maxStorageGB: number;
  maxAssessments: number;
  features: string[];
  isPopular?: boolean;
}

export interface PlanFeature {
  text: string;
  included: boolean;
}

export type SubscriptionStatus = "active" | "suspended" | "trialing" | "past_due" | "canceled";

export interface CollegeSubscription {
  id: string;
  collegeId: string;
  collegeName: string;
  collegeCode: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  autoRenew: boolean;
  nextBillingDate: string;
  trialEndsAt?: string;
  usage: {
    students: { used: number; limit: number };
    studentsUsed?: number;
    faculty: { used: number; limit: number };
    facultyUsed?: number;
    storage: { used: number; limit: number };
    storageUsedGB?: number;
    assessments: { used: number; limit: number };
  };
  createdAt: string;
  updatedAt: string;
}

export type PaymentStatus = "paid" | "pending" | "overdue" | "failed" | "refunded";

export interface PaymentRecord {
  id: string;
  collegeId: string;
  collegeName: string;
  invoiceNumber: string;
  amount: number;
  status: PaymentStatus;
  method: string;
  description: string;
  periodStart: string;
  periodEnd: string;
  paidAt?: string;
  createdAt: string;
}

export interface PaymentHistory {
  id: string;
  collegeId: string;
  collegeName: string;
  invoiceNumber: string;
  amount: number;
  status: PaymentStatus;
  method: string;
  description: string;
  periodStart: string;
  periodEnd: string;
  paidAt?: string;
  createdAt: string;
}

export interface RenewalAlert {
  id: string;
  collegeId: string;
  collegeName: string;
  planName: string;
  daysUntilExpiry: number;
  currentPlan: PlanType;
  amount: number;
  status: "info" | "warning" | "urgent";
  autoRenewEnabled: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// SYSTEM HEALTH TYPES
// ═══════════════════════════════════════════════════════════════════════
export type HealthStatus = "healthy" | "degraded" | "critical" | "maintenance";

export interface ServiceHealth {
  name: string;
  status: "operational" | "degraded" | "down";
  uptime: number;
  responseTime: number;
  errorRate: number;
  requestsPerMinute: number;
  incidents24h: number;
  lastChecked: string;
}

export interface SlowQuery {
  id: string;
  query: string;
  endpoint: string;
  duration: number;
  severity: "critical" | "high" | "medium" | "low";
  timestamp: string;
}

export interface ErrorLog {
  id: string;
  message: string;
  endpoint: string;
  method: string;
  statusCode: number;
  count: number;
  firstSeen: string;
  lastSeen: string;
  stack?: string;
  resolved: boolean;
}

export interface HealthAlert {
  id: string;
  message: string;
  severity: "critical" | "warning" | "info";
  service?: string;
  timestamp: string;
  acknowledged: boolean;
}

export interface SystemHealthStatus {
  overallStatus: HealthStatus;
  uptime: number;
  uptime24h: number;
  errorRate24h: number;
  avgResponseTime: number;
  totalRequests24h: number;
  services: ServiceHealth[];
  slowQueries: SlowQuery[];
  recentErrors: ErrorLog[];
  alerts: HealthAlert[];
}

export interface PerformanceMetric {
  timestamp: string;
  responseTime: number;
  requestsPerMinute: number;
  errorRate: number;
  cpuUsage: number;
  memoryUsage: number;
}

export interface SystemConfig {
  id: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  allowCollegeOnboarding: boolean;
  defaultAcademicYear: string;
  feePolicy: {
    currency: string;
    defaultLateFeePerDay: number;
    gracePeriodDays: number;
    enabledPaymentModes: string[];
  };
  updatedAt?: string;
  updatedBy?: string;
}

export interface SystemAuditLog {
  id: string;
  action: string;
  area: string;
  summary: string;
  actorName: string;
  actorUid?: string;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
// API ERROR
// ═══════════════════════════════════════════════════════════════════════
export class SuperAdminApiError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = "SuperAdminApiError";
  }
}
