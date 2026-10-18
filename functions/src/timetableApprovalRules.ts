// Server copy of the timetable approval rules. Keep in step with
// src/modules/admin/utils/timetableApproval.ts — functions/test/timetableApprovalParity.test.ts
// fails if the two disagree on any decision.
//
// Flow: operations drafts -> submits -> branch HOD approves or returns.
// Principal may act only as a fallback with a written reason.

export type ApprovalStatus = 'draft' | 'submitted' | 'returned' | 'approved'
export type ApprovalAction = 'submit' | 'approve' | 'return' | 'edit'

export interface ApprovalRecord {
  collegeId: string
  branch: string
  semester: number
  status: ApprovalStatus
  version: number
  submittedBy?: string
  submittedAt?: string
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
  fallbackReason?: string
  legacyCutover?: boolean
}

export interface ApprovalActor {
  uid: string
  role: string
  department?: string
}

export type ApprovalDecision = { ok: true } | { ok: false; reason: string }

export function normaliseBranch(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function timetableApprovalId(collegeId: string, branch: string, semester: number): string {
  const slug = normaliseBranch(branch).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${collegeId}__${slug}__sem${semester}`
}

function isHodOf(actor: ApprovalActor, branch: string): boolean {
  return actor.role === 'hod'
    && normaliseBranch(actor.department) !== ''
    && normaliseBranch(actor.department) === normaliseBranch(branch)
}

export function canTimetableAction(
  record: ApprovalRecord | null,
  action: ApprovalAction,
  actor: ApprovalActor,
  opts: { fallbackReason?: string } = {},
): ApprovalDecision {
  const status: ApprovalStatus = record?.status ?? 'draft'
  const isOpsActor = actor.role === 'operations' || actor.role === 'superadmin'

  switch (action) {
    case 'edit':
      if (status === 'submitted') return { ok: false, reason: 'Timetable is with the HOD; it is locked until it is returned.' }
      if (!isOpsActor) return { ok: false, reason: 'Only operations staff can edit timetable drafts.' }
      return { ok: true }

    case 'submit':
      if (!isOpsActor) return { ok: false, reason: 'Only operations staff can submit a timetable.' }
      if (status !== 'draft' && status !== 'returned') {
        return { ok: false, reason: `Cannot submit a timetable that is ${status}.` }
      }
      return { ok: true }

    case 'approve':
    case 'return': {
      const verb = action === 'approve' ? 'approved' : 'returned'
      if (!record) return { ok: false, reason: 'No timetable has been submitted for this branch and semester.' }
      if (status !== 'submitted') return { ok: false, reason: `Only a submitted timetable can be ${verb}.` }
      if (actor.uid && actor.uid === record.submittedBy) {
        return { ok: false, reason: 'You cannot review a timetable you submitted.' }
      }
      if (isHodOf(actor, record.branch)) return { ok: true }
      if (actor.role === 'principal' || actor.role === 'superadmin') {
        if (!opts.fallbackReason || opts.fallbackReason.trim().length < 5) {
          return { ok: false, reason: 'Principal action needs a fallback reason (the HOD is unavailable).' }
        }
        return { ok: true }
      }
      return { ok: false, reason: `Only the HOD of ${record.branch} can ${action === 'approve' ? 'approve' : 'return'} this timetable.` }
    }
  }
}

/** Fields a timetable slot carries into the live `weeklySchedules` collection.
 *  Anything else on a draft is ignored, so client-only data never goes live. */
export const SLOT_FIELDS = [
  'subject', 'subjectCode', 'facultyId', 'facultyName', 'facultyInitials',
  'branch', 'batch', 'semester', 'division', 'section', 'room',
  'dayOfWeek', 'startTime', 'endTime', 'type', 'assignment',
  'effectiveFrom', 'effectiveTo',
  // Carried by the auto-scheduler. Without these an approved auto-generated
  // timetable would lose its module-queue hint and meeting identity.
  'mappingId', 'demandKey', 'meetingKey', 'moduleQueue', 'autoScheduled',
] as const

export function pickSlotFields(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of SLOT_FIELDS) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}
