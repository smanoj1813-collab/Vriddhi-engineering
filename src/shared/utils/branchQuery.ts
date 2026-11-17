// src/shared/utils/branchQuery.ts
//
// Firestore equality on a branch field that also matches the other stored
// spellings of the same branch (see branchKey.ts, match-only decision).
// One `in` clause instead of `==`: a single document read per match, so read
// cost is unchanged. Firestore allows at most 30 values in `in`; the known
// spellings per branch are far below that.

import { where, type QueryConstraint } from 'firebase/firestore';
import { DEFAULT_PROGRAMS } from '@/shared/constants/academicPrograms';
import { branchVariants } from './branchKey';

export function branchConstraint(value: string, field = 'branch'): QueryConstraint {
  const variants = branchVariants(value, DEFAULT_PROGRAMS).slice(0, 30);
  return variants.length > 1
    ? where(field, 'in', variants)
    : where(field, '==', variants[0] ?? value);
}
