// src/modules/employee/employeeNavGrants.ts
//
// Maps each academic page an employee can open to the platform grant that
// unlocks it. Pages not listed here are not grant-gated (dashboard, attendance,
// students, faculty-mode pages). The server enforces the same grants in
// functions/src/employeeGrants.ts, so this list only controls what is shown.

export const EMPLOYEE_PATH_GRANTS: Readonly<Record<string, string>> = {
  '/admin/class-schedule': 'schedule',
  '/admin/curriculum': 'curriculum',
  '/admin/curriculum-progress': 'curriculum',
  '/admin/assessments': 'assessments',
  '/admin/create-test': 'assessments',
  '/admin/my-tests': 'assessments',
  '/admin/schedule-tests': 'assessments',
  '/admin/question-bank': 'papers',
  '/admin/ai-questions': 'papers',
  '/admin/paper-generator': 'papers',
  '/admin/paper-review': 'papers',
  '/admin/papers/builder': 'papers',
  '/admin/grade-records': 'grading',
  '/admin/test-reports': 'reports',
  '/admin/analytics': 'reports',
}

export interface NavLinkLike {
  kind: 'link'
  path: string
}

export interface NavGroupLike {
  kind: 'group'
  children: Array<{ path: string }>
}

/** True when the employee may see this page given their grants. */
export function employeePathVisible(path: string, grants: readonly string[]): boolean {
  const required = EMPLOYEE_PATH_GRANTS[path]
  return !required || grants.includes(required)
}

/**
 * Drops links and group children the employee has no grant for. Groups with
 * no visible children are removed entirely.
 */
export function restrictEmployeeNav<T extends NavLinkLike | NavGroupLike>(
  entries: T[] | null,
  grants: readonly string[],
): T[] | null {
  if (!entries) return null
  const out: T[] = []
  for (const entry of entries) {
    if (entry.kind === 'link') {
      if (employeePathVisible(entry.path, grants)) out.push(entry)
    } else {
      const children = entry.children.filter((c) => employeePathVisible(c.path, grants))
      if (children.length > 0) out.push({ ...entry, children })
    }
  }
  return out
}
