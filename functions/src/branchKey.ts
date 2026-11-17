// functions/src/branchKey.ts
//
// Server mirror of src/shared/utils/branchKey.ts and branchQuery.ts. Keep the
// two in step: same key rule, same known spellings.
//
// Match-only decision: stored branch values are not rewritten. "CSE",
// "B.E (CSE)" and "B.Tech (CSE)" all map to the same key, so the Academic
// Insights filter finds every student and mapping for a branch.

// Copy of DEFAULT_PROGRAMS in src/shared/constants/academicPrograms.ts.
export const KNOWN_BRANCH_SPELLINGS: readonly string[] = [
  'ECE', 'EEE', 'MECH', 'CIVIL', 'CSE', 'ISE', 'AIML', 'BCA', 'B.E',
  'B.E (ECE)', 'B.E (EEE)', 'B.E (MECH)', 'B.E (CIVIL)', 'B.E (CSE)', 'B.E (ISE)', 'B.E (AI & ML)',
  'B.Tech', 'B.Tech (ECE)', 'B.Tech (EEE)', 'B.Tech (MECH)', 'B.Tech (CIVIL)', 'B.Tech (CSE)',
  'B.Tech (ISE / IT)', 'B.Tech (AI & ML)', 'B.Tech (Data Science)',
  'BCA (Regular)', 'BCA (AI & Data Science)', 'BCA (Cloud & Cyber Security)',
  'MCA', 'M.Tech', 'M.Tech (VLSI & Embedded Systems)', 'M.Tech (Power Electronics & Drives)',
  'M.Tech (CAD/CAM & Machine Design)', 'M.Tech (Structural & Construction Engg)',
  'M.Tech (Computer Science & Engg)', 'MBA', 'Basic Sciences (1st Year Common)',
]

const WRAPPED_BRANCH = /^(B\.?\s*E|B\.?\s*Tech)\s*\((.+)\)$/i

/** Canonical comparison key. Empty string means "no branch". */
export function branchKey(value: string | null | undefined): string {
  let s = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return ''
  const wrapped = s.match(WRAPPED_BRANCH)
  if (wrapped) s = wrapped[2]
  return s
    .toUpperCase()
    .replace(/\bAND\b/g, ' ')
    .replace(/&/g, ' ')
    .replace(/[^A-Z0-9]/g, '')
}

export function sameBranch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = branchKey(a)
  return ka !== '' && ka === branchKey(b)
}

/** Stored spellings that name the same branch as `value`, for Firestore `in` (max 30). */
export function branchVariants(value: string | null | undefined): string[] {
  const raw = String(value ?? '').trim()
  const key = branchKey(raw)
  if (!key) return raw ? [raw] : []
  const out = new Set<string>([raw])
  for (const candidate of KNOWN_BRANCH_SPELLINGS) {
    if (branchKey(candidate) === key) out.add(candidate)
  }
  return [...out].slice(0, 30)
}
