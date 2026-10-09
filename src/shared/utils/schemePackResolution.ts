/** The academic cohort used to resolve the most specific pack assignment. */
export interface SchemePackContext {
  programId?: string | null;
  branchId?: string | null;
  admissionBatch?: string | null;
}

/** Stored on colleges/{collegeId}.schemePackAssignments. */
export interface SchemePackAssignment extends SchemePackContext {
  id?: string;
  schemePackId: string;
  programId: string;
  branchId?: string;
  admissionBatch?: string;
  updatedAt?: unknown;
}

export interface NormalizedSchemePackScope {
  programId: string;
  branchId: string;
  admissionBatch: string;
}

/** Case-insensitive comparison key; original labels remain stored for display. */
export function normalizeSchemePackScopeValue(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * A scoped override is either programme-wide, or tied to a complete
 * programme + branch + admission-batch cohort. Partial branch/batch scopes
 * are rejected so the resolver's precedence stays explicit and predictable.
 */
export function normalizeSchemePackScope(scope: SchemePackContext): NormalizedSchemePackScope | null {
  const programId = String(scope.programId ?? '').trim().replace(/\s+/g, ' ');
  const branchId = String(scope.branchId ?? '').trim().replace(/\s+/g, ' ');
  const admissionBatch = String(scope.admissionBatch ?? '').trim().replace(/\s+/g, ' ');
  if (!programId && !branchId && !admissionBatch) return null;
  if (!programId) throw new Error('Program is required for a scoped scheme-pack assignment.');
  if (Boolean(branchId) !== Boolean(admissionBatch)) {
    throw new Error('Specify both branch and admission batch for a cohort-specific assignment, or leave both blank for a programme-wide assignment.');
  }
  return { programId, branchId, admissionBatch };
}

export function schemePackScopeKey(scope: SchemePackContext): string {
  const normalized = normalizeSchemePackScope(scope);
  if (!normalized) return '';
  return [normalized.programId, normalized.branchId, normalized.admissionBatch]
    .map(normalizeSchemePackScopeValue)
    .join('|');
}

function timestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object') {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date };
    if (typeof candidate.toMillis === 'function') return candidate.toMillis();
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime();
  }
  const parsed = new Date(String(value ?? '')).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Resolve a programme+branch+batch override first, then a programme-wide
 * override. The caller applies college-default and platform-default fallbacks.
 */
export function findSchemePackAssignment(
  assignments: readonly SchemePackAssignment[] | null | undefined,
  context: SchemePackContext,
): SchemePackAssignment | null {
  const program = normalizeSchemePackScopeValue(context.programId);
  if (!program || !Array.isArray(assignments)) return null;

  const branch = normalizeSchemePackScopeValue(context.branchId);
  const batch = normalizeSchemePackScopeValue(context.admissionBatch);
  const candidates = assignments.filter((assignment) =>
    normalizeSchemePackScopeValue(assignment.programId) === program
  );
  const cohortMatch = branch && batch
    ? candidates.filter((assignment) =>
        normalizeSchemePackScopeValue(assignment.branchId) === branch
        && normalizeSchemePackScopeValue(assignment.admissionBatch) === batch
      )
    : [];
  const programmeMatch = candidates.filter((assignment) =>
    !normalizeSchemePackScopeValue(assignment.branchId)
    && !normalizeSchemePackScopeValue(assignment.admissionBatch)
  );
  const preferred = cohortMatch.length > 0 ? cohortMatch : programmeMatch;
  if (preferred.length === 0) return null;
  return [...preferred].sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))[0] ?? null;
}

export function resolveSchemePackId(
  assignments: readonly SchemePackAssignment[] | null | undefined,
  context: SchemePackContext,
  collegeDefaultId?: string | null,
  platformDefaultId = 'VTU_2022_BE_BTECH',
): string {
  const scoped = findSchemePackAssignment(assignments, context);
  return scoped?.schemePackId || collegeDefaultId?.trim() || platformDefaultId;
}
