// Vriddhi platform employees: academic staff who are NOT attached to one
// institution. An employee is assigned a set of colleges and works in one
// "active" college at a time; the active college is minted into the
// collegeId claim so every existing college-scoped rule keeps working
// unchanged. Pure helpers live here so the rules can be unit tested without
// an emulator.

export const EMPLOYEE_ROLE = 'employee'
export const PLATFORM_EMPLOYEES_COLLECTION = 'platform_employees'

/** Academic capabilities an employee may hold. No finance/HR/office grants. */
export const EMPLOYEE_GRANTS = [
  'schedule',
  'curriculum',
  'assessments',
  'papers',
  'grading',
  'reports',
] as const
export type EmployeeGrant = (typeof EMPLOYEE_GRANTS)[number]

export type EmployeeStatus = 'active' | 'suspended'

export interface EmployeeCollegeRef {
  id: string
  name: string
  code: string
}

export interface PlatformEmployeeRecord {
  uid: string
  email: string
  name: string
  status: EmployeeStatus
  assignedCollegeIds: string[]
  assignedColleges: EmployeeCollegeRef[]
  grants: EmployeeGrant[]
  activeCollegeId: string | null
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  updatedBy?: string
}

/** Trim, de-duplicate and cap an operator-supplied college id list. */
export function normaliseCollegeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (!id) continue
    seen.add(id)
    if (seen.size >= 200) break
  }
  return [...seen]
}

/** Unknown grants are dropped; an empty selection falls back to every grant. */
export function normaliseGrants(values: unknown): EmployeeGrant[] {
  if (!Array.isArray(values) || values.length === 0) return [...EMPLOYEE_GRANTS]
  const seen = new Set<EmployeeGrant>()
  for (const value of values) {
    const grant = String(value ?? '').trim().toLowerCase()
    if ((EMPLOYEE_GRANTS as readonly string[]).includes(grant)) seen.add(grant as EmployeeGrant)
  }
  return seen.size > 0 ? [...seen] : [...EMPLOYEE_GRANTS]
}

export function normaliseEmployeeStatus(value: unknown): EmployeeStatus {
  return String(value ?? '').trim().toLowerCase() === 'suspended' ? 'suspended' : 'active'
}

/**
 * Which college should be active after an assignment change? Keep the current
 * one while it is still assigned; otherwise fall back to the first assignment.
 */
export function nextActiveCollegeId(assignedCollegeIds: string[], current?: string | null): string | null {
  const currentId = typeof current === 'string' ? current.trim() : ''
  if (currentId && assignedCollegeIds.includes(currentId)) return currentId
  return assignedCollegeIds[0] ?? null
}

/** Claims for an employee. Non-identity claims (e.g. mustChangePassword) stay. */
export function employeeClaims(
  record: Pick<PlatformEmployeeRecord, 'status' | 'activeCollegeId'> & { grants?: readonly string[] },
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const suspended = record.status === 'suspended'
  return {
    ...existing,
    // The role stays `employee` so the account still resolves and can show an
    // explanatory screen; `employeeStatus` is what strips the grants (rules
    // check it) and `collegeId: null` removes every tenant scope.
    role: EMPLOYEE_ROLE,
    collegeId: suspended ? null : record.activeCollegeId || null,
    employeeStatus: suspended ? 'suspended' : 'active',
    // Grants travel on the token so Firestore rules can check them without a
    // read. A suspended employee carries none.
    grants: suspended ? [] : [...(record.grants ?? [])],
  }
}

/** List-view projection; never leaks claims or internal audit fields. */
export function employeeAssignmentView(record: PlatformEmployeeRecord) {
  return {
    uid: record.uid,
    email: record.email,
    name: record.name,
    status: record.status,
    grants: record.grants,
    activeCollegeId: record.activeCollegeId,
    colleges: record.assignedColleges,
    collegeIds: record.assignedCollegeIds,
  }
}

/** Does this employee hold the grant an academic screen requires? */
export function employeeHasGrant(record: Pick<PlatformEmployeeRecord, 'grants'>, grant: EmployeeGrant): boolean {
  return record.grants.includes(grant)
}
