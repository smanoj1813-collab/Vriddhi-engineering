// functions/src/employeeGrants.ts
//
// Server-side enforcement of platform employee grants. The grants are stored
// on platform_employees/{uid} (see employeeAccess.ts). Before this module the
// grants only hid dashboard tiles; the server accepted any employee.
//
// An employee may act in one college at a time (the active college claim). A
// grant is honoured only when:
//   • the assignment is active (not suspended), and
//   • the college the request is for is the employee's active college, and
//   • the grant is in the assignment's grants list.

import * as admin from 'firebase-admin'
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

export const EMPLOYEE_GRANTS = [
  'schedule',
  'curriculum',
  'assessments',
  'papers',
  'grading',
  'reports',
] as const

export type EmployeeGrant = (typeof EMPLOYEE_GRANTS)[number]

export interface EmployeeGrantRecord {
  status?: unknown
  grants?: unknown
  activeCollegeId?: unknown
}

/** Pure check, kept separate so it can be unit tested without Firestore. */
export function employeeGrantAllows(
  record: EmployeeGrantRecord | null,
  collegeId: string | null | undefined,
  grant: EmployeeGrant,
): boolean {
  if (!record || !collegeId) return false
  if (record.status !== 'active') return false
  if (typeof record.activeCollegeId !== 'string' || record.activeCollegeId !== collegeId) return false
  const grants = Array.isArray(record.grants) ? record.grants : []
  return grants.includes(grant)
}

/** Throws permission-denied unless the employee holds `grant` for `collegeId`. */
export async function requireEmployeeGrant(
  uid: string,
  collegeId: string | null | undefined,
  grant: EmployeeGrant,
): Promise<void> {
  const db = getFirestore(admin.app(), 'default')
  const snap = await db.collection('platform_employees').doc(uid).get()
  const record = snap.exists ? (snap.data() as EmployeeGrantRecord) : null
  if (!employeeGrantAllows(record, collegeId, grant)) {
    throw new HttpsError(
      'permission-denied',
      `Your employee account does not have the "${grant}" grant for this college.`,
    )
  }
}
