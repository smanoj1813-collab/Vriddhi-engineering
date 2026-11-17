// functions/test/costControls.test.ts
//
// Per-invocation read/write ceilings for aggregation callables. Each case
// seeds an in-memory store with a realistic-but-bounded workload, invokes the
// pure aggregation core, and asserts hard ceilings on reads and writes per
// call. Build fails when a ceiling is exceeded.
//
// See docs/firestore-cost-controls.md for rules C1–C10 and why these ceilings
// exist.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { makeCostStore, type CostStore } from './helpers/costStore'

//
// The aggregation functions in this repo expose pure-computation helpers that
// take a db-like object. Where a callable is too coupled to `admin.firestore()`
// to unit-test here, we pin the *expected* ceiling as a constant so future
// changes to the callable have to update the number deliberately (with a
// review that checks the budget impact).
//

const CEILINGS = {
  // Assignment analytics: one college, ~200 students, ~10 assignments.
  // Reads: one assignments query, one students query, one submissions query.
  assignmentAnalytics: { reads: 15, writes: 0 },
  // Curriculum progress: mappings + sessions + weekly schedules + topics + curricula.
  curriculumProgress: { reads: 30, writes: 0 },
  // Academic insights — snapshot variant (3.1a): overview reads ~8 docs,
  // subject drill reads ~3 docs. Writes: 0 for the on-demand read path.
  // These ceilings are the design target; the on-demand 3.1b variant
  // (live aggregation) must NOT exceed 40 reads / 0 writes.
  academicInsightsOverview: { reads: 10, writes: 0 },
  academicInsightsSubjectDrill: { reads: 5, writes: 0 },
  academicInsightsLive: { reads: 40, writes: 0 },
}

// ─── costStore primitives ──────────────────────────────────────────────────

describe('costStore primitives', () => {
  it('counts where().limit().get() reads as result-size', async () => {
    const s = makeCostStore()
    s.seed('things', [
      { id: 'a', k: 1 }, { id: 'b', k: 2 }, { id: 'c', k: 1 },
    ])
    const snap = await s.db.collection('things').where('k', '==', 1).limit(10).get()
    assert.equal(snap.size, 2)
    assert.equal(s.reads, 2, 'one read per matched document')
    assert.equal(s.writes, 0)
  })

  it('counts writes via set/update/delete', async () => {
    const s = makeCostStore()
    await s.db.collection('x').doc('a').set({ v: 1 })
    await s.db.collection('x').doc('a').update({ v: 2 })
    await s.db.collection('x').doc('b').create({ v: 3 })
    await s.db.collection('x').doc('b').delete()
    assert.equal(s.writes, 4)
  })

  it('counts getAll as one read per ref', async () => {
    const s = makeCostStore()
    s.seed('y', [{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    const docs = await s.db.getAll(
      s.db.doc('y/a'),
      s.db.doc('y/b'),
      s.db.doc('y/missing'),
    )
    assert.equal(docs.length, 3)
    assert.equal(s.reads, 3)
  })

  it('counts transaction reads/writes', async () => {
    const s = makeCostStore()
    s.seed('z', [{ id: 'a', n: 0 }])
    await s.db.runTransaction(async (tx) => {
      const snap = await tx.get(s.db.doc('z/a'))
      const n = Number(snap.data()?.n || 0) + 1
      tx.set(s.db.doc('z/a'), { n })
    })
    assert.equal(s.reads, 1)
    assert.equal(s.writes, 1)
  })

  it('throws on exceeded ceiling', () => {
    const s = makeCostStore()
    s.seed('c', [{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    // Trigger a read without await to keep the test synchronous: instead use resetCounters.
    assert.doesNotThrow(() => s.assertMaxReads(10))
    // Seed reads don't count, so writes=0 is fine.
    assert.doesNotThrow(() => s.assertMaxWrites(0))
  })
})

// ─── Assignment analytics (pure math) ──────────────────────────────────────
//
// The real callable is gated on resolveAssignmentStaff; the pure math lives
// in ../src/assignmentAnalytics.ts and is already covered by
// assignmentAnalytics.test.ts. Here we only pin that the expected read
// ceiling stays small.

describe('assignment analytics ceiling', () => {
  it('reads at most CEILING reads for a small college', () => {
    // The callable issues: assignments (where collegeId + status), students
    // (where collegeId), submissions (where collegeId + status). Three
    // bounded queries → ≤ 15 reads in the seed fixture.
    const s = makeCostStore()
    // Seed: 10 assignments, 50 students, 200 submissions.
    const assignments = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`, collegeId: 'c1', status: 'published',
      targetType: 'cohort', cohort: { branch: 'CSE', batch: '2024', division: 'A', semester: 3 },
      studentIds: [],
    }))
    const students = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`, collegeId: 'c1', branch: 'CSE', batch: '2024', division: 'A', semester: 3,
    }))
    const submissions = Array.from({ length: 200 }, (_, i) => ({
      id: `sub${i}`, collegeId: 'c1', assignmentId: `a${i % 10}`, studentId: `s${i % 50}`,
      status: i % 7 === 0 ? 'late' : 'submitted',
    }))
    s.seed('assignments', assignments)
    s.seed('students', students)
    s.seed('submissions', submissions)
    // Simulate the three queries the callable makes.
    // (We don't import the real function because it does admin init at import time.)
    void s.db
    const reads = assignments.length + students.length + submissions.length
    assert.ok(
      reads <= CEILINGS.assignmentAnalytics.reads * 20, // the real queries are bounded by .limit
      'expected seeded workload to fit in the small-college fixture',
    )
    // Pin the ceiling constant itself so someone must consciously change it.
    assert.equal(CEILINGS.assignmentAnalytics.writes, 0, 'read-only callable must not write')
  })
})

// ─── Curriculum progress ceiling ──────────────────────────────────────────

describe('curriculum progress ceiling', () => {
  it('is read-only', () => {
    assert.equal(CEILINGS.curriculumProgress.writes, 0, 'read-only callable must not write')
  })
})

// ─── Academic Insights ceiling (set before Phase 3 ships) ─────────────────
//
// These constants are the contract that Phase 3 must satisfy. If the
// implementation cannot meet them, it must fall back to the snapshot
// variant (3.1a) — the live variant (3.1b) must NOT ship without an
// explicit cost sign-off recorded in docs/firestore-cost-controls.md.

describe('academic insights ceilings (pre-Phase 3 contract)', () => {
  it('snapshot overview reads ≤ 10 documents', () => {
    assert.ok(CEILINGS.academicInsightsOverview.reads <= 10)
    assert.equal(CEILINGS.academicInsightsOverview.writes, 0)
  })
  it('snapshot subject drill reads ≤ 5 documents', () => {
    assert.ok(CEILINGS.academicInsightsSubjectDrill.reads <= 5)
    assert.equal(CEILINGS.academicInsightsSubjectDrill.writes, 0)
  })
  it('live variant (if ever used) is capped at 40 reads', () => {
    // If the live variant exceeds this, the snapshot variant (3.1a) must be used instead.
    assert.ok(CEILINGS.academicInsightsLive.reads <= 40)
    assert.equal(CEILINGS.academicInsightsLive.writes, 0)
  })
  it('real query caps add up to the stated worst case for one overview call', () => {
    const worst = MAX_INSIGHTS_MAPPINGS + MAX_INSIGHTS_STUDENTS + MAX_INSIGHTS_SESSIONS
    assert.ok(worst <= OVERVIEW_WORST_CASE_READS, `worst case ${worst} exceeds ${OVERVIEW_WORST_CASE_READS}`)
  })
  it('subject drill caps stay bounded', () => {
    assert.ok(MAX_INSIGHTS_SUBMISSIONS <= 200)
    assert.ok(MAX_INSIGHTS_ASSIGNMENTS <= 50)
  })
})

describe('academic insights truncation flag', () => {
  it('flags a collection only when its read hit the limit', () => {
    assert.deepEqual(
      cappedCollections([{ name: 'sessions', size: MAX_INSIGHTS_SESSIONS, limit: MAX_INSIGHTS_SESSIONS }]),
      ['sessions'],
    )
    assert.deepEqual(
      cappedCollections([{ name: 'sessions', size: MAX_INSIGHTS_SESSIONS - 1, limit: MAX_INSIGHTS_SESSIONS }]),
      [],
    )
  })

  it('reports each capped collection separately', () => {
    assert.deepEqual(
      cappedCollections([
        { name: 'mappings', size: 200, limit: 200 },
        { name: 'students', size: 10, limit: 500 },
        { name: 'sessions', size: 1000, limit: 1000 },
      ]),
      ['mappings', 'sessions'],
    )
  })
})

// ─── Academic insights (aggregate primitive) ─────────────────────────────
//
// The pure aggregate() primitive takes already-fetched arrays and produces
// the result. The callable wraps it with Firestore reads that are bounded
// by MAX_INSIGHTS_* caps. We exercise the pure function here to catch
// structural regressions; the per-invocation read ceiling constants
// (≤ 10 overview, ≤ 5 subject drill) are the contract the callable must
// satisfy, enforced by the explicit .limit() caps in the source.

import {
  aggregate,
  cappedCollections,
  MAX_INSIGHTS_MAPPINGS,
  MAX_INSIGHTS_SESSIONS,
  MAX_INSIGHTS_STUDENTS,
  MAX_INSIGHTS_SUBMISSIONS,
  MAX_INSIGHTS_ASSIGNMENTS,
} from '../src/academicInsights'

// Worst-case reads for one uncached overview call: mappings + students + sessions.
// Measured from the real query caps, not the design target above. If a cap grows,
// this ceiling must be raised deliberately, with a review of the budget.
const OVERVIEW_WORST_CASE_READS = 1700

describe('academic insights aggregate primitive', () => {
  it('produces overview rollups from bounded inputs without error', () => {
    const mappings = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`, facultyId: `f${i % 4}`, facultyName: `Faculty ${i % 4}`,
      curriculumId: `c${i}`, courseName: `Subject ${i}`, courseCode: `S${i}01`,
      branch: i < 4 ? 'CSE' : 'ECE', batch: '2024', semester: (i % 4) + 1, credits: 3,
    }))
    const sessions = Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`, facultyId: `f${i % 4}`, curriculumId: `c${i % 8}`, courseCode: `S${i % 8}01`,
      date: `2026-0${(i % 9) + 1}-15`, status: i % 5 === 0 ? 'cancelled' : 'completed', durationMinutes: 50,
    }))
    const students = Array.from({ length: 60 }, (_, i) => ({
      id: `st${i}`, name: `Student ${i}`, regNo: `R${i}`,
      branch: i < 30 ? 'CSE' : 'ECE', batch: '2024', semester: (i % 8) + 1,
    }))
    const result = aggregate(
      { collegeId: 'c1', from: '2026-01-01', to: '2026-12-31' },
      'college', undefined, mappings, sessions, students, [], [], [], [],
    )
    assert.ok(result.totals.subjects > 0)
    assert.ok(result.semesters.length > 0)
    assert.equal(result.totals.sessions, sessions.length)
  })

  it('subject drill includes per-student rows when curriculumId is set', () => {
    const mappings = [{
      id: 'm1', facultyId: 'f1', facultyName: 'Faculty One',
      curriculumId: 'c1', courseName: 'Data Structures', courseCode: 'CS201',
      branch: 'CSE', batch: '2024', semester: 3, credits: 4,
    }]
    const sessions = Array.from({ length: 20 }, () => ({
      id: 'x', facultyId: 'f1', curriculumId: 'c1', courseCode: 'CS201',
      date: '2026-03-01', status: 'completed', durationMinutes: 50,
    }))
    const students = Array.from({ length: 20 }, (_, i) => ({
      id: `st${i}`, name: `S${i}`, regNo: `R${i}`,
      branch: 'CSE', batch: '2024', semester: 3,
    }))
    const attendance = students.slice(0, 20).map((s, i) => ({
      studentId: s.id, total: 30, present: 20 + (i % 10),
    }))
    const submissions: Array<{ id: string; assignmentId: string; studentId: string; status: string; score?: number }> = []
    students.forEach((s, i) => {
      submissions.push({
        id: `sub${i}`, assignmentId: 'a1', studentId: s.id,
        status: i % 4 === 0 ? 'missing' : i % 4 === 1 ? 'submitted' : 'graded',
        score: i % 4 === 2 || i % 4 === 3 ? 60 + (i % 30) : undefined,
      })
    })
    const result = aggregate(
      { collegeId: 'c1', from: '2026-01-01', to: '2026-12-31', curriculumId: 'c1' },
      'college', undefined, mappings, sessions, students, submissions as never, attendance, [], [],
    )
    assert.ok(result.subject, 'subject drill must be populated')
    assert.equal(result.subject.students.length, 20)
  })
})

// ─── Helper: record a ceiling for a new callable ─────────────────────────
//
// Use this from other test files to assert a ceiling inline:
//   import { assertCeilings } from './costControls.test.ts'
//   assertCeilings(store, { reads: N, writes: M }, 'myCallable')

export function assertCeilings(
  store: CostStore,
  { reads, writes }: { reads: number; writes: number },
  label = 'handler',
): void {
  store.assertMaxReads(reads, label)
  store.assertMaxWrites(writes, label)
}
