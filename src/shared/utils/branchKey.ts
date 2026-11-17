// src/shared/utils/branchKey.ts
//
// One rule for "same branch", used by every filter that compares branch names.
// Stored values are NOT rewritten (match-only decision): "CSE", "B.E (CSE)" and
// "B.Tech (CSE)" all map to the same key, so filters and reports stop missing
// students who were saved under a different spelling.
//
// Only the B.E / B.Tech wrapper is stripped. BCA, MCA and MBA values are kept
// whole, because "BCA (Regular)" and "BCA (Cloud & Cyber Security)" are
// specialisations, not branches. Keep this file and functions/src/branchKey.ts
// in step: they implement the same rule.

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

/** True when two stored branch values name the same branch. Blank never matches. */
export function sameBranch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = branchKey(a)
  return ka !== '' && ka === branchKey(b)
}

/**
 * Every spelling in `known` that names the same branch as `value`, plus `value`
 * itself. Used for Firestore `in` queries, which need the exact stored strings.
 */
export function branchVariants(value: string | null | undefined, known: readonly string[]): string[] {
  const raw = String(value ?? '').trim()
  const key = branchKey(raw)
  if (!key) return raw ? [raw] : []
  const out = new Set<string>([raw])
  for (const candidate of known) {
    if (branchKey(candidate) === key) out.add(candidate)
  }
  return [...out]
}
