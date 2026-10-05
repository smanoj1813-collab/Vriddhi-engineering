// src/modules/admin/utils/branchConduction.ts
//
// Principal oversight: branch-wise assessment conduction. Pure derivation
// over the existing listManagedAssessmentTests payload (which spreads the raw
// scheduledTests doc, so `branch` / `program` ride along even though the
// shared ScheduledTest client type doesn't declare them). No new backend
// surface; the status bucketing mirrors the server's
// effectiveManagedAssessmentStatus so the page never disagrees with it.

export interface ConductionTestLike {
  id: string
  title?: string
  subject?: string
  subjectName?: string
  branch?: string
  program?: string
  status?: string
  startDateTime?: unknown
  endDateTime?: unknown
}

export type ConductionBucket = 'upcoming' | 'ongoing' | 'completed' | 'cancelled'

export interface BranchConductionSummary {
  branch: string
  upcoming: number
  ongoing: number
  completed: number
  /** ongoing + upcoming tests, soonest first — what needs eyes right now. */
  active: Array<{ id: string; title: string; subject: string; bucket: ConductionBucket; startMs: number | null }>
}

/** Firestore Timestamp | Date | ISO string | epoch-ish → ms, or null. */
export function toMillis(value: unknown): number | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      const date = (value as { toDate(): Date }).toDate()
      return Number.isFinite(date.getTime()) ? date.getTime() : null
    } catch {
      return null
    }
  }
  return null
}

export function bucketTest(
  status: string | undefined,
  startMs: number | null,
  endMs: number | null,
  now: number
): ConductionBucket {
  const stored = String(status || '')
  if (stored === 'cancelled') return 'cancelled'
  if (stored === 'completed') return 'completed'
  if (endMs !== null && now > endMs) return 'completed'
  if (startMs !== null && now >= startMs) return 'ongoing'
  return 'upcoming'
}

export function branchLabel(test: ConductionTestLike): string {
  const branch = String(test.branch || '').trim()
  if (branch) return branch
  const program = String(test.program || '').trim()
  if (program) return program
  return 'College-wide'
}

/** Groups college tests by branch into conduction counts. Pure — unit tested. */
export function summarizeBranchConduction(
  tests: ConductionTestLike[],
  now: number = Date.now()
): BranchConductionSummary[] {
  const byBranch = new Map<string, BranchConductionSummary>()

  for (const test of tests) {
    const label = branchLabel(test)
    const summary = byBranch.get(label) || { branch: label, upcoming: 0, ongoing: 0, completed: 0, active: [] }
    const bucket = bucketTest(test.status, toMillis(test.startDateTime), toMillis(test.endDateTime), now)
    if (bucket === 'upcoming') summary.upcoming += 1
    else if (bucket === 'ongoing') summary.ongoing += 1
    else if (bucket === 'completed') summary.completed += 1
    // cancelled tests are intentionally not counted anywhere.

    if (bucket === 'upcoming' || bucket === 'ongoing') {
      summary.active.push({
        id: test.id,
        title: String(test.title || 'Assessment'),
        subject: String(test.subjectName || test.subject || ''),
        bucket,
        startMs: toMillis(test.startDateTime),
      })
    }
    byBranch.set(label, summary)
  }

  return [...byBranch.values()]
    .map((summary) => ({
      ...summary,
      active: summary.active.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity)),
    }))
    .sort((a, b) => a.branch.localeCompare(b.branch))
}
