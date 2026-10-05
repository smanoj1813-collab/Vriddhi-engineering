# Quota-Compatible Deployment Plan — Cloud Run CPU Quota (asia-south1)

Status: **Proposal — nothing applied. Scaling caps require explicit approval.**
Date: 2026-10-05 · Project: `vriddhi-engineering` · Region: `asia-south1`

---

## 1. Situation

- Cloud Run CPU quota: **20,000 milliCPU**. The increase request was denied as
  ineligible (directed to Sales).
- Deploy errors repeatedly show **30,000–40,000 milliCPU requested vs 20,000
  allowed**, with Cloud Run stating those requests need `maxScale` ≤ 20.
  Retrying unchanged did not help.
- Of 117 non-Judge0 functions: 65 present/deployed, **51 blocked by quota**,
  1 trigger-type conflict (`onAttendanceRecordWrite` — see §6). No functions
  unattempted.
- `runStudentCode` (Judge0) stays excluded — no deploy, no placeholder secret,
  no bypass.
- Admission Center's 10 functions stay **on hold** (not deleted, not redeployed).
- Deployments run from the prepared worktree `C:\Projects\Vriddhi-engineering-deploy`,
  never the original Windows checkout; approved source changes must be synced
  to that worktree first.

## 2. What the blocked functions request today (audited from source)

Cloud Run v2 allocates CPU from the memory tier: **256 MiB → ~167 milliCPU per
instance, 512 MiB → ~333 milliCPU**. Requested quota per service =
cpu-per-instance × `maxInstances`.

| Settings | Requested per service | Count (of 41 in-scope) | Functions |
|---|---|---|---|
| 256 MiB × 30 | ~5.0 vCPU | 28 | announcement/notification set, `getAssessmentConfig`, `saveAssessmentConfig`, `listManagedAssessmentTests`, `checkPaperScheduling`, `publishAssessmentTest`, `cancelAssessmentTest`, `gradeStudentAssessmentSubmission`, `getAssessmentTestReport`, `listManagedGradeRecords`, `reviewPaper`, `submitPaperForReview`, `reopenPaperForEditing`, assignment authoring set (`createFacultyAssignment`, `updateFacultyAssignment`, `transitionFacultyAssignment`, `deleteFacultyAssignmentDraft`), `listMentorDirectory`, `getMyAssignments`, `beginMyAssignmentSubmission`, `cancelMyAssignmentSubmission`, `gradeAssignmentSubmission` |
| 256 MiB × 40 | ~6.7 vCPU | 6 | `getAssignmentSubmissionDownload`, `getMyStudentTests`, `getMyTestInstructions`, `autosaveMyStudentTest`, `logMyStudentTestEvent`, `getPaperFileDownload` |
| 512 MiB × 30 | ~10.0 vCPU | 5 | `finalizeMyAssignmentSubmission`, `listPendingAssessmentSubmissions`, `savePaper`, `getMyAcademicJourney`, `getMyCurriculum` |
| 512 MiB × 40 | ~13.3 vCPU | 2 | `getMyActiveStudentTest`, `getMyStudentTestResult` |

**Total requested by these 41 functions as written: ≈ 256 vCPU (256,000
milliCPU) — 12.8× the entire regional quota.** A single deployment batch of
6–8 of them is exactly the 30,000–40,000 milliCPU the errors report.

(The 10 on-hold Admission functions are excluded from this proposal.)

## 3. Proposed minimal change (CPU and memory untouched)

Do exactly what the Cloud Run error prescribes — bring `maxScale`
(`maxInstances`) down — with the smallest viable values, then verify.

### Step 1 — Pilot (one active, non-admission function)

Pick `getMyNotifications` (active, core area, 256 MiB, read-only):

- Set `maxInstances: 30 → 10` (~1.67 vCPU requested).
- Sync change to the deployment worktree, build, deploy **alone**.
- Verify: deploys cleanly, responds in the app, Cloud Run console shows
  maxScale 10.

### Step 2 — Roll out the remaining in-scope functions in batches of ≤ 5

Caps (memory and CPU unchanged):

| Memory tier | maxInstances: now → cap | Requested per service |
|---|---|---|
| 256 MiB | 30/40 → **10** | ~1.67 vCPU |
| 512 MiB | 30/40 → **6** | ~2.0 vCPU |

Worst-case batch of five ≈ **10 vCPU ≤ quota**, and no single service
approaches the maxScale-20 threshold the errors cite.

Concurrency note: these are low-QPS academic callables (per-college staff and
student traffic, not public spikes). The hot path during a live test is
`autosaveMyStudentTest` / `getMyActiveStudentTest`; if latency regressions
appear during exam windows, raise those two first — they were the only 40-cap
functions for a reason.

### Step 3 — Only if Step 2 still hits quota: consolidate, don't shrink further

Every callable is its own Cloud Run service. The strongest code-level lever is
**moving low-traffic callables onto the already-deployed shared `api` Express
function as routes** — zero extra quota per endpoint. The new
`GET/PUT /api/config/modules` added in this change demonstrates the pattern.
Candidates (read-mostly, small payloads, no scheduled triggers):
`markMyNotificationRead`, `markAllMyNotificationsRead`, `setAnnouncementPinned`,
`deleteAnnouncement`, `cancelAssessmentTest`, `reopenPaperForEditing`,
`getAssessmentConfig`, `saveAssessmentConfig`.
Consolidation changes client call sites, so it is a **separate approved work
item**, not part of the pilot.

## 4. Explicit non-goals (per prior decisions)

- ❌ No CPU or memory changes (only approved separately).
- ❌ No porting of settings from the Windows stash; no blanket cap without sign-off.
- ❌ No further unchanged retries of quota-blocked functions.
- ❌ No Admission Center function changes/deploys (on hold, resources kept).
- ❌ The shared `api` function is not removed (it serves other routes incl. Admission routes).
- ❌ Judge0/`runStudentCode` stays out.

## 5. Before deploying from this change

This session added **one Express route pair** (`/api/config/modules`) to the
existing `api` function and **no new callable exports** — deploying `api` again
adds no Cloud Run services. The `api` function itself is already within quota
(512 MiB × 10). After syncing this branch to the deployment worktree, the
suggested order is:

1. Deploy `api` alone (carries the module-toggle endpoints). Verify.
2. Pilot `getMyNotifications` with the Step-1 cap. Verify.
3. Batch the remaining in-scope functions ≤ 5 at a time with Step-2 caps.

## 6. Separate blocker: `onAttendanceRecordWrite` trigger conflict

The deployed function is HTTPS while source defines a background/event
trigger; Firebase cannot convert trigger types in place. Attendance is a
needed area. Planned safe migration (requires approval before execution):

1. Deploy the event-trigger under a **new name** (e.g.
   `onAttendanceRecordWriteV2`) — old HTTPS function keeps serving.
2. Verify the new trigger fires on test attendance writes (summary
   reconciliation visible in `attendanceSummaries`).
3. Only after verification, and with sign-off, retire the old HTTPS function.

No deletion happens without explicit approval.
