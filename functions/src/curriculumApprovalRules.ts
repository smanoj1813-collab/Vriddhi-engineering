// Curriculum course-list rules — pure (no Firebase imports, unit tested).
//
// Superadmin assigns a course list to the college. From then on:
//  - Operations, admin and superadmin VERIFY the list for a branch and semester.
//    Timetable drafting and sending to the HOD are blocked until it is verified.
//    A change to the list after verification needs a fresh verify.
//  - The principal REVIEWS it (approve or return). This is a sign-off, not a gate.
//  - HODs can read the list. They cannot act on it.
//
// Verification is bound to the exact content: the server stores a fingerprint of
// the course documents at verify time and checks it again before timetable writes.
// Mirrored in functions/src/curriculumApprovalRules.ts; a parity test keeps them in step.

export type CurriculumReviewStatus = 'pending' | 'approved' | 'returned'

export type CurriculumActorRole =
  | 'admin' | 'hod' | 'principal' | 'superadmin' | 'operations' | 'employee' | 'faculty' | 'student' | 'other'

export interface CurriculumApprovalRecord {
  collegeId: string
  branch: string
  semester: number
  /** Ops verification. Set by verify; absent until the list is first verified. */
  verifiedFingerprint?: string
  verifiedBy?: string
  verifiedAt?: string
  /** Principal review. */
  reviewStatus: CurriculumReviewStatus
  /** Fingerprint the principal approved. Approval holds only for that content. */
  reviewFingerprint?: string
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
  version: number
}

export interface CurriculumActor {
  uid: string
  role: CurriculumActorRole
  department?: string
}

export type CurriculumDecision =
  | { ok: true }
  | { ok: false; reason: string }

export function normaliseCurriculumBranch(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Stable Firestore doc id for a branch+semester curriculum record. */
export function curriculumApprovalId(collegeId: string, branch: string, semester: number): string {
  const slug = normaliseCurriculumBranch(branch).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${collegeId}__cur__${slug}__sem${semester}`
}

/** Who may verify a course list (ops confirms it before it is scheduled). */
export function canVerifyCurriculum(actor: CurriculumActor): CurriculumDecision {
  if (actor.role === 'operations' || actor.role === 'admin' || actor.role === 'superadmin' || actor.role === 'employee') return { ok: true }
  return { ok: false, reason: 'Only operations or admin can verify a course list.' }
}

/** Who may approve or return a course list (the principal's sign-off). */
export function canReviewCurriculum(actor: CurriculumActor): CurriculumDecision {
  if (actor.role === 'principal' || actor.role === 'superadmin') return { ok: true }
  return { ok: false, reason: 'Only the principal can approve or return a course list.' }
}

/**
 * Timetable writes (draft edits, copy from live, send to HOD) need the course
 * list verified. `currentFingerprint` is the fingerprint of the list right now.
 */
export function curriculumGate(
  record: CurriculumApprovalRecord | null,
  currentFingerprint: string | null,
  branch: string,
  semester: number,
): CurriculumDecision {
  if (currentFingerprint === null) {
    return { ok: false, reason: `There is no course list for ${branch}, semester ${semester} yet. The superadmin assigns it first.` }
  }
  if (!record?.verifiedFingerprint) {
    return { ok: false, reason: `Verify the course list for ${branch}, semester ${semester} in Curriculum Approvals before scheduling its classes.` }
  }
  if (record.verifiedFingerprint !== currentFingerprint) {
    return { ok: false, reason: `The course list for ${branch}, semester ${semester} changed after it was verified. Verify it again before scheduling.` }
  }
  return { ok: true }
}
