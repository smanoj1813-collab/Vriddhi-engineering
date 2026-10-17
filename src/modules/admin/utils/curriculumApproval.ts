// Curriculum course-list approval — pure rules (no Firebase imports, unit tested).
//
// Scope: one approval record per (college, branch, semester), covering the
// active course-list documents for that branch and semester.
// Flow:  admin (or the branch HOD) sends the list → principal approves or returns.
//        The principal is the only approver. Nobody reviews their own submission.
//
// The approval is tied to the exact content that was sent: the server stores a
// fingerprint at submit and recomputes it at approval. If the list changed in
// between, approval is refused and the list must be sent again.
//
// Mirrored in functions/src/curriculumApprovalRules.ts. A parity test keeps both
// in step.

export type CurriculumApprovalStatus = 'draft' | 'submitted' | 'returned' | 'approved'

export type CurriculumActorRole = 'admin' | 'hod' | 'principal' | 'superadmin' | 'operations' | 'faculty' | 'student' | 'other'

export interface CurriculumApprovalRecord {
  collegeId: string
  branch: string
  semester: number
  status: CurriculumApprovalStatus
  /** Increments on each submit. */
  version: number
  submittedBy?: string
  submittedAt?: string
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
  /** Fingerprint of the course lists at submit time. */
  fingerprint?: string
  /** Fingerprint at the time of approval (equal to `fingerprint` when approved). */
  approvedFingerprint?: string
  approvedBy?: string
  approvedAt?: string
}

export interface CurriculumActor {
  uid: string
  role: CurriculumActorRole
  /** HOD department claim. */
  department?: string
}

export type CurriculumAction = 'submit' | 'approve' | 'return'

export type CurriculumDecision =
  | { ok: true }
  | { ok: false; reason: string }

export function normaliseCurriculumBranch(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Stable Firestore doc id for a branch+semester curriculum approval. */
export function curriculumApprovalId(collegeId: string, branch: string, semester: number): string {
  const slug = normaliseCurriculumBranch(branch).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${collegeId}__cur__${slug}__sem${semester}`
}

function isHodOfCurriculum(actor: CurriculumActor, branch: string): boolean {
  return actor.role === 'hod'
    && normaliseCurriculumBranch(actor.department) !== ''
    && normaliseCurriculumBranch(actor.department) === normaliseCurriculumBranch(branch)
}

/** Can `actor` take `action` on the curriculum approval `record` right now? */
export function canCurriculumAction(
  record: CurriculumApprovalRecord | null,
  action: CurriculumAction,
  actor: CurriculumActor,
  branch: string,
): CurriculumDecision {
  const status: CurriculumApprovalStatus = record?.status ?? 'draft'

  if (action === 'submit') {
    const allowed = actor.role === 'admin' || actor.role === 'superadmin' || isHodOfCurriculum(actor, branch)
    if (!allowed) {
      return { ok: false, reason: `Only the admin or the HOD of ${branch} can send this course list for approval.` }
    }
    if (status === 'submitted') {
      return { ok: false, reason: 'This course list is already waiting for the principal.' }
    }
    return { ok: true }
  }

  // approve / return
  if (!record) return { ok: false, reason: 'No course list has been sent for this branch and semester.' }
  if (status !== 'submitted') {
    return { ok: false, reason: `Only a course list that is waiting for approval can be ${action === 'approve' ? 'approved' : 'returned'}.` }
  }
  if (actor.uid && actor.uid === record.submittedBy) {
    return { ok: false, reason: 'You cannot review a course list you sent.' }
  }
  if (actor.role === 'principal' || actor.role === 'superadmin') return { ok: true }
  return { ok: false, reason: 'Only the principal can approve or return a course list.' }
}
