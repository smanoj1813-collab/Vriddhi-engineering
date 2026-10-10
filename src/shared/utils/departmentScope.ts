// src/shared/utils/departmentScope.ts
// ------------------------------------------------------------------
// Client-side department scoping for the HOD portal.
//
// admin ≡ department HOD (see Layout.tsx / ROLE_DASHBOARD): those two roles
// see only their own department, while principal, superadmin, faculty and
// mentors keep their existing college-wide view.
//
// The check is deliberately TOLERANT, matching the rules-side `deptScoped`
// helper in firestore.rules:
//   - viewer has no department tag          → cannot scope, show everything;
//   - document is untagged (legacy row)     → visible until backfill tags it;
//   - document department is 'All'          → college-wide row, visible;
//   - otherwise case-insensitive exact match.
// This means no row ever silently disappears before
// `scripts/backfill-department.mjs` has run.
// ------------------------------------------------------------------

/** Roles whose view of the college is limited to their own department. */
export function shouldScopeToDepartment(role: string | null | undefined): boolean {
  return role === 'hod' || role === 'admin';
}

/**
 * Does this document belong in the viewer's department scope?
 * Pass `viewerDepartment` only when `shouldScopeToDepartment(viewerRole)`.
 */
export function docInDepartment(
  doc: { department?: string | null } | null | undefined,
  viewerDepartment: string | null | undefined
): boolean {
  const viewer = String(viewerDepartment ?? '').trim().toLowerCase();
  if (!viewer) return true;
  const docDept = String(doc?.department ?? '').trim().toLowerCase();
  if (!docDept || docDept === 'all') return true;
  return docDept === viewer;
}

/**
 * Scope an array in one call for the roles that need it.
 * Returns the array untouched for college-wide roles or an empty viewer tag.
 */
export function filterByViewerDepartment<T extends { department?: string | null }>(
  rows: readonly T[],
  viewerRole: string | null | undefined,
  viewerDepartment: string | null | undefined
): T[] {
  if (!shouldScopeToDepartment(viewerRole)) return rows as T[];
  const dept = String(viewerDepartment ?? '').trim();
  if (!dept) return rows as T[];
  return rows.filter((row) => docInDepartment(row, dept));
}
