// Timetable approval workflow — pure rules (no Firebase imports, unit tested).
//
// Scope: one approval record per (college, branch, semester).
// Flow:  ops drafts → ops submits → branch HOD approves or returns.
//        Principal may approve only as a documented fallback when the HOD is
//        unavailable. Only an approved version is copied to the live
//        `weeklySchedules` collection that students and faculty read.
//
// Rules enforced here (and mirrored in firestore.rules / the Cloud Function):
//  - Only operations staff can submit; nobody approves their own submission.
//  - Only the HOD of the matching branch can approve or return.
//  - The principal can approve or return only with a fallback reason.
//  - A submitted version is locked; editing needs it returned or approved first.
//  - Approving an existing live timetable is a legacy cut-over: the live docs
//    are marked approved without a new review.

export type TimetableApprovalStatus = 'draft' | 'submitted' | 'returned' | 'approved'

export type TimetableActorRole = 'operations' | 'hod' | 'principal' | 'admin' | 'superadmin' | 'faculty' | 'student' | 'other'

export interface TimetableApprovalRecord {
  collegeId: string
  branch: string
  semester: number
  status: TimetableApprovalStatus
  /** Increments on each submit. */
  version: number
  submittedBy?: string
  submittedAt?: string
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
  /** Set when the principal approved in place of the HOD. */
  fallbackReason?: string
  /** Set when the timetable was approved by the legacy cut-over. */
  legacyCutover?: boolean
}

export interface TimetableActor {
  uid: string
  role: TimetableActorRole
  /** HOD / admin department claim. */
  department?: string
}

export type TimetableAction = 'submit' | 'approve' | 'return' | 'edit'

export type TimetableDecision =
  | { ok: true }
  | { ok: false; reason: string }

export function normaliseBranch(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Stable Firestore doc id for a branch+semester approval record. */
export function timetableApprovalId(collegeId: string, branch: string, semester: number): string {
  const slug = normaliseBranch(branch).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${collegeId}__${slug}__sem${semester}`
}

function isHodOf(actor: TimetableActor, branch: string): boolean {
  return actor.role === 'hod'
    && normaliseBranch(actor.department) !== ''
    && normaliseBranch(actor.department) === normaliseBranch(branch)
}

/** Can `actor` take `action` on `record` right now? */
export function canTimetableAction(
  record: TimetableApprovalRecord | null,
  action: TimetableAction,
  actor: TimetableActor,
  opts: { fallbackReason?: string } = {},
): TimetableDecision {
  const status: TimetableApprovalStatus = record?.status ?? 'draft'

  switch (action) {
    case 'edit': {
      if (status === 'submitted') return { ok: false, reason: 'Timetable is with the HOD; it is locked until it is returned.' }
      if (actor.role !== 'operations' && actor.role !== 'superadmin') {
        return { ok: false, reason: 'Only operations staff can edit timetable drafts.' }
      }
      return { ok: true }
    }

    case 'submit': {
      if (actor.role !== 'operations' && actor.role !== 'superadmin') {
        return { ok: false, reason: 'Only operations staff can submit a timetable.' }
      }
      if (status !== 'draft' && status !== 'returned') {
        return { ok: false, reason: `Cannot submit a timetable that is ${status}.` }
      }
      return { ok: true }
    }

    case 'approve':
    case 'return': {
      if (!record) return { ok: false, reason: 'No timetable has been submitted for this branch and semester.' }
      if (status !== 'submitted') return { ok: false, reason: `Only a submitted timetable can be ${action === 'approve' ? 'approved' : 'returned'}.` }
      if (actor.uid && actor.uid === record.submittedBy) {
        return { ok: false, reason: 'You cannot review a timetable you submitted.' }
      }
      if (isHodOf(actor, record.branch)) return { ok: true }
      if (actor.role === 'principal' || actor.role === 'superadmin') {
        // Principal acts only as a fallback, with a recorded reason.
        if (!opts.fallbackReason || opts.fallbackReason.trim().length < 5) {
          return { ok: false, reason: 'Principal action needs a fallback reason (the HOD is unavailable).' }
        }
        return { ok: true }
      }
      return { ok: false, reason: `Only the HOD of ${record.branch} can ${action === 'approve' ? 'approve' : 'return'} this timetable.` }
    }
  }
}

/** Apply a successful action; caller must check `canTimetableAction` first. */
export function applyTimetableAction(
  record: TimetableApprovalRecord | null,
  action: TimetableAction,
  actor: TimetableActor,
  at: string,
  opts: { note?: string; fallbackReason?: string; collegeId: string; branch: string; semester: number } = {
    collegeId: '', branch: '', semester: 0,
  },
): TimetableApprovalRecord {
  const base: TimetableApprovalRecord = record ?? {
    collegeId: opts.collegeId,
    branch: opts.branch,
    semester: opts.semester,
    status: 'draft',
    version: 0,
  }
  switch (action) {
    case 'edit':
      return { ...base, status: 'draft' }
    case 'submit':
      return {
        ...base,
        status: 'submitted',
        version: base.version + 1,
        submittedBy: actor.uid,
        submittedAt: at,
        reviewedBy: undefined,
        reviewedAt: undefined,
        reviewNote: undefined,
        fallbackReason: undefined,
      }
    case 'approve':
      return {
        ...base,
        status: 'approved',
        reviewedBy: actor.uid,
        reviewedAt: at,
        reviewNote: opts.note?.trim() || undefined,
        fallbackReason: actor.role === 'principal' ? opts.fallbackReason?.trim() : undefined,
      }
    case 'return':
      return {
        ...base,
        status: 'returned',
        reviewedBy: actor.uid,
        reviewedAt: at,
        reviewNote: opts.note?.trim() || undefined,
        fallbackReason: actor.role === 'principal' ? opts.fallbackReason?.trim() : undefined,
      }
  }
}

/** Legacy cut-over: an existing live timetable is treated as approved. */
export function legacyApprovedRecord(
  collegeId: string,
  branch: string,
  semester: number,
  at: string,
): TimetableApprovalRecord {
  return {
    collegeId,
    branch,
    semester,
    status: 'approved',
    version: 1,
    reviewedAt: at,
    legacyCutover: true,
  }
}

/** Live timetables are read by students and faculty; only approved ones may be. */
export function isLiveEligible(record: TimetableApprovalRecord | null): boolean {
  return record?.status === 'approved'
}
