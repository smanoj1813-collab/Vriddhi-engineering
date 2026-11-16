# Firestore read/write volume & cost controls

This document captures the rules that emerged from the **Academic Risk cost
incident**, and the tooling we built to prevent a repeat. **Every new feature
that reads or writes more than a handful of Firestore documents per request
must satisfy these rules — Academic Insights in particular.**

## The incident (TL;DR)

The Academic Risk feature shipped an `refreshMyAcademicRiskAlerts` callable
that was client-triggerable and scanned a college's whole set of
attendance + submissions + topics on every page open. A cached tab, a
focus-reconnect timer, and a "Refresh" button were each capable of
kicking off a full scan. Concretely:

| Failure mode | What happened |
|---|---|
| Client-triggered full scans | Any role could ask for a college-wide recompute; a single power user was enough. |
| Unbounded discovery | The sweep walked the entire college without a page-size cap or cursor. |
| Download-and-discard | Queries pulled broad collections and filtered in JS (exam recovery pulled ~100 future tests 288×/day and dropped all but one). |
| Silent empty result on missing index | A missing composite index returned zero rows; the UI showed "0 at risk" and no error. |
| Rewriting unchanged documents | `updatedAt` was bumped on every sweep run, producing writes for every doc even when nothing changed — 50+ extra writes per click. |
| Mixed read/write ordering in transactions | Retries double-incremented counters. |
| Polling | Intervals, focus listeners and reconnect listeners each re-ran the scan. |
| Cache-collection anti-pattern | Writing into a separate "cache" collection just moves cost from reads to writes; process-local in-memory is safer. |
| Uncapped function instances | The risk callable OOM'd at 128 MiB and also saturated regional CPU. |
| Edit storms | A routine attendance/submission edit triggered a full recompute. |

## Non-negotiable rules (C1–C10)

These apply to **every** aggregation feature in this repo — not only Academic
Insights. Code review should reject any PR that violates them.

| # | Rule |
|---|---|
| **C1** | **No client-triggered full scans.** No role (student, faculty, HOD, admin, principal) may initiate a college-wide recomputation from an on-demand page open. |
| **C2** | **Bounded server-owned work only.** Deterministic page sizes, durable checkpoint cursors, explicit caps on accounts / time / concurrency. |
| **C3** | **Filter in Firestore, never download-and-discard in JS.** Every dimension that narrows a result set must be a `.where()` clause on the query. |
| **C4** | **Ship the composite index with the query**; on a missing index fall back to the old path, and **surface a coverage failure — never an empty "success"**. |
| **C5** | **Diff before write.** Skip the write when nothing meaningful changed. Never advance `updatedAt` just to create an event. |
| **C6** | **All transaction reads precede writes**, so SDK retries recompute against fresh state. |
| **C7** | **No polling.** Load on entry, on explicit refresh, or on a successful user action. No interval / focus / reconnect timers. |
| **C8** | **Process-local caching only**, if at all: short TTL (~90 s), small cap (~8 entries), tenant-scoped keys, single-flight, failed-read eviction. **No new Firestore cache collections.** |
| **C9** | **Cap function instances and set memory explicitly.** `maxInstances` and `memory` must be set on every aggregation callable. |
| **C10** | **Ordinary record edits must not trigger recomputation storms.** Event-driven rollups must be scoped to new/reopened/escalated changes only. |

## The preferred shape: snapshot rollups

For any page that surfaces aggregate numbers across a whole semester / college
(platform stats, attendance summary, daily summary, academic insights), the
snapshot pattern is:

1. A **scheduled** job precomputes rollups into a small number of documents.
2. The job **skips the write when unchanged** (deep-equal check), but always
   bumps a `heartbeat` field so clients can tell "stale" from "broken".
3. The page reads the rollup documents directly — **never** the raw
   collections. If the snapshot is missing or older than
   `MAX_AGE_MS`, the page falls back to a graceful "Data is being prepared"
   state (or a tightly-scoped direct read on small collections), not a
   full scan.

Examples in this repo: `platformStats.ts`, `attendanceSummary.ts`,
`dailySummary.ts` (where present).

## Cost harness

The SDK-boundary counter lives at `functions/test/helpers/costStore.ts`. It
wraps an in-memory Firestore stub and counts every `.get()`, `.where().get()`,
`.add()`, `.set()`, `.update()`, `.create()`, and transaction op that a
handler issues. Tests use `makeCostStore()` to feed a handler a fake Firestore
and assert per-invocation read/write ceilings.

### Adding a new ceiling test

1. Add a case to `functions/test/costControls.test.ts` that invokes the
   handler through `makeCostStore()`.
2. Assert `store.reads <= CEILING_READS` and `store.writes <= CEILING_Writes`
   for each shape of input (empty college, small college, at-cap).
3. The CI test:cost run fails the build when any ceiling is exceeded.

### Honest caveat

These are **SDK-boundary counts of handler intentions**, not billable rule /
index evaluation work, network cost, or actual deployed billing. They catch
regressions in code; they do **not** replace comparing real operation counts
under a comparable workload after deploy. Always re-measure in production
with Firebase Console's Usage tab for the first 48 hours after shipping an
aggregation feature.

## Cost gates that already exist — extend them, don't bypass them

| Gate | Command | Purpose |
|---|---|---|
| Backend cost regressions | `npm --prefix functions run test:cost` | Runs `costControls.test.ts` against the SDK-boundary counter. |
| Read/write counting harness | `functions/test/helpers/costStore.ts` | In-memory counter of handler intentions. |
| Frontend cost checks | `npm run test:render:cost` | `scripts/render-check/cost-controls.mjs`. |
| Cost model / baseline | `npm run cost:model`, `npm run assessment:baseline` | Parametric annual cost, fixture-measured baselines. |

## Capping function instances (C9)

Every onCall aggregation must set `region`, `memory`, `timeoutSeconds`,
`minInstances: 0`, and a conservative `maxInstances`. Engineering has
previously hit regional CPU quota (commit `f9c60f6` capped timetable
approvals at 5 instances); the Academic Risk callable OOM'd at 128 MiB
startup and needed 512 MiB. Aggregations default to **512 MiB**, and
**`maxInstances: 10`** unless a smaller number is proven safe.

## Instance caps by existing callable (reference)

| Callable | Memory | maxInstances | Timeout |
|---|---|---|---|
| `refreshPlatformStats` (scheduled) | 512 MiB | 1 | 300 s |
| `reconcileAttendanceSummaries` (scheduled) | 512 MiB | 1 | 540 s |
| `getCurriculumProgress` | 1 GiB | 10 | 120 s |
| `getAssignmentAnalytics` | 512 MiB | 20 | 60 s |
| `getAcademicInsights` | 512 MiB | 10 | 120 s |

## Per-invocation ceiling guidance

Use these as reference points when writing a new ceiling test. These are the
counts the snapshot pattern is designed to achieve for a typical 5,000-student
college; a live aggregation callable that exceeds them needs an explicit
sign-off.

| Operation | Reads (typical) | Writes |
|---|---|---|
| Platform stats page open | 1 (snapshot doc) | 0 |
| Attendance summary page open | 1 per student viewed | 0 |
| Curriculum progress (one college) | ≤ 8 | 0 |
| Assignment analytics (one college) | ≤ 5 | 0 |
| **Academic insights — overview (3.1a snapshot)** | **≤ 8** | **0** |
| **Academic insights — subject drill (3.1a snapshot)** | **≤ 3** | **0** |
| Academic insights — live aggregation (3.1b, NOT recommended) | ≤ bounded by semesters × subjects × page cap | 0 |

> Anything that reads more than ~30 documents on a page-open callable needs
> to be re-examined against C1–C3 before merge.
