// src/modules/auth/permissions.ts
// ------------------------------------------------------------------
// Role → permission matrix for client-side identity & access checks.
//
// Deny-by-default: an unknown or unmapped permission is never granted.
//
// IMPORTANT: this is a UX/authorisation *hint*, not a security boundary.
// Firestore rules and Cloud Functions remain the only trusted enforcement
// points (current-firestore.rules mirrors this matrix: isFinance / isOps and
// the payroll accounts/approver role checks). Use it to gate routes and controls.
//
// Office roles
//   accounts   — fees, payments, receipts, challans, finance settings, guest
//                billing, vendor bills, library fines, finance reports and
//                payroll preparation / processing.
//   operations — library, inventory, stores, purchase orders, vendors,
//                library fines, no-dues.
// HODs / department admins hold NO finance access; payroll approval remains
// with the principal while accounts owns preparation and payment processing.
// ------------------------------------------------------------------
import type { UserRole } from './context/auth';

/**
 * Known permission identifiers and the roles that may hold each one.
 * `superadmin` is intentionally omitted and handled as a global bypass.
 */
export const PERMISSION_MATRIX: Readonly<Record<string, readonly UserRole[]>> = {
  // ── Student portal ─────────────────────────────────────────────
  'student.access': ['student', 'parent'],
  'student.assessments': ['student'],
  'student.assignments': ['student'],
  'student.grades': ['student', 'parent'],

  // ── Faculty / academic operations ─────────────────────────────
  'faculty.access': ['faculty', 'mentor', 'hod', 'principal', 'admin', 'employee'],
  'faculty.attendance': ['faculty', 'mentor', 'hod', 'principal', 'admin', 'employee'],
  'faculty.schedule': ['faculty', 'hod', 'principal', 'admin', 'employee'],
  'faculty.assessments': ['faculty', 'hod', 'principal', 'admin', 'employee'],

  // ── Assessment authoring (Create Test) ────────────────────────
  // Decision D2 (docs/ASSESSMENT_CREATE_TEST_FLOW.md §0): the people who set
  // and schedule tests are faculty, HODs, college admins and Vriddhi
  // employees. The principal stays oversight-only — reports and branch-wise
  // conduction, never the authoring desk — and mentors are pastoral.
  // Plug back for principal = add 'principal' here and the nav line in
  // Layout.tsx (principalNav).
  'assessment.authorTests': ['faculty', 'hod', 'admin', 'employee'],

  // ── Content authoring ─────────────────────────────────────────
  'question.manage': ['faculty', 'hod', 'principal', 'admin', 'employee'],
  'paper.manage': ['faculty', 'hod', 'principal', 'admin', 'employee'],

  // ── Academic administration (department heads + principal) ────
  'academic.admin': ['admin', 'hod', 'principal'],
  'grade.manage': ['hod', 'principal', 'admin', 'employee'],
  'college.manage': ['admin'],
  'users.manage': ['admin'],

  // ── University examination (VTU / Karnataka university compliance) ──
  // Principal is deliberately absent from `.manage`: university-exam
  // compliance (hall tickets, room allotment, exam-fee drives, result
  // importers) is an institution-office job run by the admin/exam branch.
  // The principal keeps a read-only lane via `universityExam.view` so
  // reporting stays available without write access.
  'universityExam.manage': ['admin', 'hod'],
  'universityExam.publish': ['admin'],
  'universityExam.view': ['admin', 'hod', 'principal'],

  // ── Engineering evaluation (B.E. / B.Tech) ───────────────────────────
  'obe.attainment': ['hod', 'principal', 'admin', 'employee'],
  'engineering.schemePacks': ['admin', 'hod'],

  // ── Finance (accounts team) ───────────────────────────────────
  'accounts.desk': ['accounts', 'principal'],
  'fees.manage': ['accounts', 'principal'],
  'finance.settings': ['accounts', 'principal'],
  'finance.reports': ['accounts', 'principal'],
  'guestBilling.manage': ['accounts', 'principal'],
  'vendorBills.manage': ['accounts', 'principal'],
  'fines.waive': ['accounts', 'principal'],
  // Segregated payroll workflow: accounts prepares/processes; principal reviews.
  'payroll.view': ['principal', 'accounts'],
  'payroll.manage': ['accounts'],
  'payroll.approve': ['principal'],

  // ── Operations (library, inventory, stores) ───────────────────
  'operations.desk': ['operations', 'principal'],
  'library.manage': ['operations', 'principal'],
  'inventory.manage': ['operations', 'principal'],
  'procurement.order': ['operations', 'principal'],
  // Departments raise purchase requests; approval follows the college chain.
  'procurement.request': ['operations', 'principal', 'hod', 'admin', 'accounts'],
  'procurement.approve': ['principal', 'hod', 'admin', 'accounts'],

  // ── Shared office surfaces ────────────────────────────────────
  'library.fines': ['accounts', 'operations', 'principal'],
  'vendors.manage': ['accounts', 'operations', 'principal'],
  'noDues.manage': ['accounts', 'operations', 'principal'],

  // ── Principal-only governance ─────────────────────────────────
  'access.settings': ['principal'],
  // Assignment reporting left the HOD portal (HOD round): departments read
  // Analytics + Journey; assignment-level reporting stays an institution
  // lane. Add 'admin'/'hod' back here to plug it in again.
  'analytics.assignments': ['principal'],
};

/** All permission identifiers known to the matrix. */
export const KNOWN_PERMISSIONS = Object.keys(PERMISSION_MATRIX) as readonly string[];

/** Roles that belong to the college office (no academic surface). */
export const OFFICE_ROLES: readonly UserRole[] = ['accounts', 'operations'];

/** Roles that may use the academic admin surface (/admin/* academic pages). */
export const ACADEMIC_ADMIN_ROLES: readonly UserRole[] = ['admin', 'hod', 'principal', 'superadmin', 'employee'];

/**
 * /admin pages that stay OUT of the employee workspace even though they sit on
 * the academic side of the default rule. Employees work the academic
 * programme only (admissions, college settings/onboarding, university-exam
 * compliance and importers are institution jobs). Listed by longest prefix.
 */
export const EMPLOYEE_EXCLUDED_ADMIN_PATHS: readonly string[] = [
  '/admin/admissions',
  '/admin/settings',
  '/admin/onboarding',
  '/admin/exam-management',
  '/admin/uucms-integration',
  '/admin/bcu-compliance',
  '/admin/scheme-packs',
  '/admin/result-importer',
  '/admin/ai-agent',
];

function isEmployeeExcluded(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/admin';
  return EMPLOYEE_EXCLUDED_ADMIN_PATHS.some((base) => matchesPath(path, base));
}

/**
 * Legacy per-college access document. `payrollRoles` is retained so older
 * documents remain readable, but payroll is now a fixed accounts/principal
 * workflow and this field no longer grants or removes access.
 */
export interface AccessSettings {
  payrollRoles: UserRole[];
}

export const DEFAULT_ACCESS_SETTINGS: AccessSettings = { payrollRoles: ['accounts'] };

/** Legacy normalizer allowlist; no longer used to gate payroll access. */
export const PAYROLL_GRANTABLE_ROLES: readonly UserRole[] = ['accounts'];

/**
 * Deny-by-default role check for a single permission.
 *
 * - no role → `false`;
 * - `superadmin` → `true` (global bypass);
 * - payroll permissions are role-defined (accounts manage; principal approves);
 * - unknown permission → `false`.
 */
export function roleHasPermission(
  role: UserRole | null | undefined,
  permission: string,
  access: AccessSettings = DEFAULT_ACCESS_SETTINGS,
): boolean {
  if (!role) return false;
  if (role === 'superadmin') return true;
  const allowed = PERMISSION_MATRIX[permission];
  return Array.isArray(allowed) && (allowed as readonly string[]).includes(role);
}

/**
 * /admin/* pages that need a specific permission. Anything under /admin not
 * listed here is an ACADEMIC page (department heads + principal only).
 * `null` = any signed-in /admin user (install app etc.).
 */
export const ADMIN_ROUTE_PERMISSIONS: ReadonlyArray<{ path: string; permission: string | null }> = [
  // Finance
  { path: '/admin/accounts', permission: 'accounts.desk' },
  { path: '/admin/fee-management', permission: 'fees.manage' },
  { path: '/admin/challans', permission: 'fees.manage' },
  { path: '/admin/finance-settings', permission: 'finance.settings' },
  { path: '/admin/finance-reports', permission: 'finance.reports' },
  { path: '/admin/guest-faculty-billing', permission: 'guestBilling.manage' },
  { path: '/admin/payroll', permission: 'payroll.view' },
  { path: '/admin/vendor-bills', permission: 'vendorBills.manage' },
  // Operations
  { path: '/admin/operations', permission: 'operations.desk' },
  { path: '/admin/library', permission: 'library.manage' },
  { path: '/admin/inventory', permission: 'inventory.manage' },
  { path: '/admin/purchase-orders', permission: 'procurement.order' },
  // Shared
  { path: '/admin/library-fines', permission: 'library.fines' },
  { path: '/admin/purchase-requests', permission: 'procurement.request' },
  { path: '/admin/vendors', permission: 'vendors.manage' },
  { path: '/admin/no-dues', permission: 'noDues.manage' },
  // University Examination — admin/exam branch only; the principal keeps
  // read-only reporting via 'universityExam.view' but no longer owns the page.
  { path: '/admin/exam-management', permission: 'universityExam.manage' },
  // The rest of the University Exams group left the principal's sidebar for
  // the same reason; direct URLs bounce the principal too (HOD/admin keep in).
  { path: '/admin/uucms-integration', permission: 'universityExam.manage' },
  { path: '/admin/bcu-compliance', permission: 'universityExam.manage' },
  { path: '/admin/result-importer', permission: 'universityExam.manage' },
  { path: '/admin/scheme-packs', permission: 'engineering.schemePacks' },
  // Insights — Assignment Analytics is out of the HOD sidebar, so deep links
  // bounce the department too (principal + superadmin keep it).
  { path: '/admin/assignment-analytics', permission: 'analytics.assignments' },
  // Create Test — authoring desk, not an oversight surface (see D2). Matches
  // /admin/create-test, /admin/create-test/:id and /admin/my-tests.
  { path: '/admin/create-test', permission: 'assessment.authorTests' },
  { path: '/admin/my-tests', permission: 'assessment.authorTests' },
  // Principal
  // Everyone in the shell
  { path: '/admin/install-app', permission: null },
  { path: '/admin/pwa-install', permission: null },
];

function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * May `role` open `pathname` (an /admin/* route)? Pure — unit tested.
 * Longest matching entry wins so '/admin/library-fines' is not mistaken for
 * '/admin/library'.
 */
export function canAccessAdminPath(
  role: UserRole | null | undefined,
  pathname: string,
  access: AccessSettings = DEFAULT_ACCESS_SETTINGS,
): boolean {
  if (!role) return false;
  if (role === 'superadmin') return true;
  const path = pathname.replace(/\/+$/, '') || '/admin';
  const entry = ADMIN_ROUTE_PERMISSIONS
    .filter(e => matchesPath(path, e.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (entry) {
    if (entry.permission === null) return true;
    return roleHasPermission(role, entry.permission, access);
  }
  // Unlisted /admin page ⇒ academic surface. Employees are additionally kept
  // away from the institution-only pages listed above.
  if (role === 'employee') return !isEmployeeExcluded(path);
  return (ACADEMIC_ADMIN_ROLES as readonly string[]).includes(role);
}
