# Vriddhi — Complete project audit (2026-09-07)

**Scope:** every screen's data path, `current-firestore.rules`, `storage.rules`,
all 47 deployable Cloud Functions, CI, and data-integrity open items.
**Branch:** `arena/01a07c5a-vriddhi` (tree = PR #32 merge `5de9933`).
**Method:** static read of the repo. Verified state from
`docs/AUTH_LOGIN_PROVISIONING_AUDIT_2026-09-04.md` (§5–§13) is trusted, not re-derived.
Ground truth (382 linked students, 53/53 tests, tsc clean, "all 45 functions") is
cross-checked against the tree and corrected where the tree disagrees.

---

## 0. Corrections to the handoff, before anything else

1. **`docs/AUDIT_HANDOFF_2026-09-07.md` does not exist in this tree.** There is no
   file of that name anywhere under `/home/user`. Everything below that the prompt
   attributed to it has been re-verified directly against the code instead.
2. **"Only 2 files still render mock data" is under-counted.** The exact
   `MOCK_STUDENTS = [] // TODO: Fetch from API` pattern is unique to
   `HODDashboard.tsx`, but the *defect* ("screen renders from an empty
   placeholder array") exists in **6 routed screen files**:
   - `src/modules/admin/pages/HODDashboard.tsx` (all 5 tabs)
   - `src/modules/faculty/pages/FacultyAnnouncements.tsx`
   - `src/modules/faculty/pages/FacultyCalendar.tsx`
   - `src/modules/faculty/pages/FacultyLibrary.tsx`
   - `src/modules/faculty/pages/FacultyReschedule.tsx`
   - `src/modules/faculty/pages/FacultyStudentAnalysis.tsx`
   Plus two *static* (no-data, no-mock) screens: `AIAgentPage.tsx` ("under
   development" card) and `SuperAdminUniversityDetail.tsx` (seed/static list).
3. **"All 45 functions updated" — the repo defines 47 deployables.** `index.ts`
   exports `api` (1 `onRequest`) plus **46 names**: 44 `onCall` + 2 `onSchedule`
   (`cleanupExpiredAssignmentSubmissionDrafts`, `autoSubmitExpiredStudentTests`).
   If "45" counted only the 44 callables + the Express `api`, the two schedulers
   are the un-mentioned delta. Worth pinning down before the next release note.
4. **`FacultyStudentAnalysis.tsx` still renders `NaN%`.** It computes
   `Math.round(reduce/total)` with `facultyStudents = []` (total 0) and prints
   `{stats.avgAttendance}%` → `NaN%`. §13 of the 09-04 audit fixed this for the
   HOD overview only; this faculty screen still shows it.

---

## 1. Architecture snapshot

| Layer | State |
| --- | --- |
| Frontend | Vite 5 + React 18 + TS 5.4, Firebase SDK `^12.15.0` |
| Backend | Gen-2 Functions, all pinned `region: 'asia-south1'`, Node `20` (`engines`) |
| Project | `vriddhi-engineering` (`.firebaserc` tracked, un-ignored) |
| Firestore rules | `current-firestore.rules` (834 lines, claim-only) |
| Storage rules | `storage.rules` (profile-document identity — see §4.2) |
| RTDB | `database.rules.json` fully locked (`.read/.write: false`) |
| Indexes file | `firestore.indexes.json` — 63 composites, all `COLLECTION` scope, 0 single-field |
| CI | `.github/workflows/ci.yml` — build only (frontend + functions), Node 20 |
| Deploy workflow | `deploy.yml` **absent from the repo** (operator machine only, untracked by design) |

Deployables by type (regions all asia-south1):

- 1× `onRequest` — `api` (Express; AI/questions/papers/config routes)
- 44× `onCall` — auth/identity (`syncStudentsToAuth`, `createStudentAuth`,
  `bulkCreateStudentAccounts`, `provisionUser`, `bulkProvisionStaff`,
  `resetUserPassword`, `syncIdentityClaims`, `grantUserRole`, `diagnoseIdentity`,
  `auditAndRepairIdentities`, `syncMyIdentity`, `resetCollegeData`), student portal
  (profile, assignments, submission sessions, download), assessments/tests,
  grade records, papers.
- 2× `onSchedule` — `cleanupExpiredAssignmentSubmissionDrafts`,
  `autoSubmitExpiredStudentTests`.

---

## 2. Screen inventory — route → data owner

`/` redirects via `ROLE_DASHBOARD` (single map, `roleRoutes.ts`):
`superadmin→/superadmin/dashboard`, `admin` & `principal→/admin/dashboard`,
`hod→/admin/hod-dashboard`, `faculty` & `mentor→/faculty/dashboard`,
`student` & `parent→/student/dashboard`, unknown→`/login`.

Route guards: `/admin` allows `admin|principal|hod|superadmin`; `/faculty` allows
`faculty|hod|mentor`; `/student` allows `student|parent` (wrapped in
`StudentDataProvider`); `/superadmin` allows `superadmin`.

### Student (`/student/*`) — all behind `useStudentData` (one shared load)

| Screen | Data owner | Status |
| --- | --- | --- |
| dashboard | `useStudentData` → `studentDataApi` (profile via `resolveStudentRecord`, attendance, fees, schedule, notifications) + `getMyAssignments`/`getMyStudentTests` callables | LIVE |
| attendance | `useStudentData` attendance (`attendanceRecords` query) | LIVE |
| assessments / test flow | `testApi` callables (`getMyStudentTests`, `getMyTestInstructions`, `startMyStudentTest`, `autosave…`, `submit…`, `getMyStudentTestResult`) | LIVE |
| assignments | `assignmentService` (`begin/finalize/cancelMyAssignmentSubmission` + Storage session upload) | LIVE |
| grades | `studentDataApi.fetchGrades` (`gradeRecords` where collegeId+studentId+status=published) | LIVE |
| materials | `colleges/{cid}/materials` (direct) | LIVE |
| timetable | `useStudentSchedule` + `fetchTodaySchedule` (`weeklySchedules` + `classSessions`) | LIVE* |
| fees | `useStudentProfile` + `useFeeData` (`feeStructures`/`fees`) | LIVE |
| library | `libraryBooks` + `issuedBooks` (direct) | LIVE |
| events | `colleges/{cid}/events` (direct) | LIVE |
| notifications | `colleges/{cid}/notifications` (direct) — see §6.3 schema split | LIVE |
| settings | `updatePassword` + `updateMyStudentProfile` callable | LIVE |

\* `fetchTodaySchedule` fetches `weeklySchedules` scoped by `collegeId`+`branch`
(server-side `where`), then **matches `batch/semester/division` client-side after
`limit(500)`**. Per the rules of engagement this is a latent "silently no data for
rows past the cap" risk if a college+branch ever exceeds 500 weekly rows.

### Faculty (`/faculty/*`)

| Screen | Data owner | Status |
| --- | --- | --- |
| dashboard | `scheduleApi` (`colleges/{cid}/schedules`) | LIVE |
| attendance / attendance-marking | `useFacultyAttendance` → `facultyApi` (batch write incl. `attendanceSummary`) | LIVE |
| topics | `useTopics` | LIVE |
| papers / question-bank / paper-generator | `paperAPI`/`questionBankAPI` (axios → `api` function) | LIVE |
| **student-analysis** | `facultyStudents = []` (empty) — **NaN% bug** | **MOCK** |
| **reschedule** | `classSessions = []` (empty), local-state only | **MOCK** |
| **library** | `mockBooks/mockIssued = []`, add/issue/return write to React state only | **MOCK** |
| **announcements** | `mockAnnouncements = []`, send writes to React state only; hardcoded "125"/"42" recipient counts | **MOCK** |
| **calendar** | `mockEvents = []`, hardcoded current month (June 2026) | **MOCK** |
| upload-material | `useMaterials`/`materialApi` | LIVE |
| assignments | `assignmentApi` (callables) | LIVE |
| assessments | callables (`listPendingAssessmentSubmissions`, `gradeStudentAssessmentSubmission`) + `TestScheduler` | LIVE |
| curriculum | `useFacultyCurriculum` | LIVE |
| schedule | `useFacultySchedule` | LIVE |
| ai-questions | `useAIQuestionGenerator` | LIVE* |
| view360 | `View360` (`students` query) | LIVE |
| settings | `updatePassword` + profile update (direct) | LIVE |

\* `useAIQuestionGenerator.saveAll` falls back to **the first college in the
`colleges` collection** when no collegeId resolves, then persists it to
localStorage. Cross-tenant data-integrity risk (see §6.2).

### Admin (`/admin/*`) — `admin|principal|hod|superadmin`

| Screen | Data owner | Status |
| --- | --- | --- |
| dashboard / index / **students** | `AdminDashboard` (direct `students`/`faculty`/`admins` where collegeId) | LIVE |
| view360 | `students` query | LIVE |
| attendance | `attendanceApi` (direct) | LIVE* |
| assessments | `assessmentsApi` (direct + callables) | LIVE |
| grade-records | direct `students` + `listManagedGradeRecords`/`saveDraft…`/`publish…` callables | LIVE |
| fee-management | `useFeeData` → `feeApi` (`colleges/{cid}/…`) | LIVE |
| question-bank / paper-builder / paper-generator / paper-review / review-queue | `questionBankApi`/`paperApi` (axios → `api`) + `useQuestionBank` | LIVE |
| class-schedule | `useAdminSchedule` → `scheduleApi` | LIVE |
| curriculum | `useCurriculumMapping` | LIVE |
| analytics / journey | `useDashboardData`/`useJourney` → `dashboardApi`/`journeyApi` | LIVE |
| settings | direct (`updatePassword`, `colleges/{cid}.systemSettings`) | LIVE |
| **hod-dashboard** | `MOCK_STUDENTS/MOCK_FACULTY/MOCK_APPROVALS/… = []` — every tab | **MOCK** |
| ai-agent | static "under development" card | STUB |
| ai-questions | `useAIQuestionGenerator` | LIVE |
| onboarding | `superAdminApi` + `onboardingService` ("Validation only" tabs; no write for schedules/assessments) | PARTIAL |

\* `Attendance.tsx`'s `useCollegeId()` reads `localStorage['collegeId']` /
`localStorage['user']` — **keys the current `AuthContext` never writes**
(it writes `vriddhi_college_id`). On a fresh sign-in the attendance page resolves
no college and its queries run **unscoped** (see §6.2).

### Superadmin (`/superadmin/*`) — all via `useSuperAdmin`/`superAdminApi` unless noted

dashboard, access (`identityApi.auditAndRepairIdentities`), colleges (+ new/detail),
admins (+ new), students (+ import via `bulkCreateStudentAccounts`), faculty
(+ detail/import via `bulkProvisionStaff`), curriculum (`useSyllabusCurriculum`),
comparison, billing (`subscriptions`), health (`useSystemHealth` etc.):
**LIVE** (client SDK reads of `colleges`, `students`, `faculty`, `admins`,
`subscriptions`, universities; writes via superadmin-gated callables).
`universities/:id` → **STATIC** seed list (`karnatakaUniversities`), no Firestore.

---

## 3. Firestore rules (`current-firestore.rules`) — compliant

- Identity is claim-only: `role()`/`collegeId()`/`claimedRole()` read
  `request.auth.token.role/collegeId` only; the legacy profile-fallback helpers
  are gone. `isSuperadmin()` = claim **or** `superadmins/{uid}` doc (the only
  doc-based exception, itself superadmin-writable).
- `noPasswordField()` guards every profile collection write; `secretFieldDeletes()`
  in the callables mirrors it.
- `ownsStudentId()`/`myStudentDocId()` use the `users/{uid}.studentDocId` pointer
  with the `students/{id}` fallback; the pointer short-circuits before the
  `get()`/`exists()` fallback, keeping list costs at 1 cached read per request for
  a linked student. Field reads are behind `'x' in resource.data` where needed
  (e.g. `attendance`, `feeStructures`, `fees`, `gradeRecords`).
- Per-user scoping is owner-based where a student must list their own rows
  (`attendance`, `attendanceRecords`, `weeklySchedules`, `classSessions`,
  `materials`, `events`, `notifications`, `announcements`), matching §11.
- One un-guarded reference remains: top-level `notifications/{id}`
  `allow read` uses `ownsStudentId(resource.data.studentId)` without an
  `'studentId' in resource.data` guard. The student path queries
  `where('studentId','==',own)`, so candidates always carry the field; but any
  staff/other query that returns a notification lacking `studentId` would fail
  the whole request. Low risk today, easy to harden.
- **Index note:** the file declares 63 composites and the student query paths'
  indexes are all present (`attendanceRecords(collegeId,studentId,date desc)`,
  `notifications(studentId,timestamp desc)`, `gradeRecords(collegeId,studentId,
  status,semester desc)`, `weeklySchedules(collegeId,branch)`,
  `classSessions(collegeId,date)`). The console still holds additional composites
  not in the file — **never answer "yes" to deleting console indexes not in the
  file.**

---

## 4. Where the deployment-adjacent surfaces lag the claim-only model

### 4.1 `storage.rules` still derives identity from client-writable documents

`resolvedRole()`/`resolvedCollegeId()` in `storage.rules` are **entirely
profile-document based** (`users`, `faculty`, `students`, `admins`, `hods`,
`mentors`) — they never read `request.auth.token`. That is exactly the
"profile document supplies role/college" pattern the Firestore rules deleted in
§4.2 of the 09-04 audit, and it is forgeable the same way. `ownsStudentId` here
also still uses the old per-row `students/{id}` reads instead of the
`users/{uid}.studentDocId` pointer. **Fix: rewrite storage identity to
claim-only + pointer-based `ownsStudentId`, mirroring `current-firestore.rules`.**

### 4.2 Express API (`api` function) authz has a profile-document fallback

`functions/src/middleware/auth.ts` `verifyAuth` verifies the ID token (good) but
then sets `req.user.role = claimRole || profile?.role` and
`collegeId = claimCollegeId || profile?.collegeId`, with `resolveUserProfile()`
walking `users` + all six profile collections. Because the Express routes use the
**Admin SDK** (rules do not apply), a claim-less account with a resolvable
profile document can be authorized with a profile-derived role — the precise
vector §3.4 called out. Additionally, GET `/api/questions` and `/api/papers`
(and config) only require `verifyAuth` + same-college, so **any signed-in member
of a college (including a student) can read the whole college question bank and
papers through the API** even though the Firestore rules reserve `questions`/
`papers` for staff. Medium severity. Fix: require the **claim** for role in the
middleware (drop `profile?.role` fallback), and add `requireRole` to the read
routes that the rules restrict.

### 4.3 `resetCollegeData` deletes Firebase Auth accounts

`collegeCleanup.ts` calls `auth.deleteUsers(...)` with `deleteAuthUsers` **default
`true`**. This is a direct violation of the rule "never delete an Auth account."
It is superadmin-gated and college-scoped, and the re-upload recreates accounts,
but the safety rule exists because of a real outage. **Recommend: default
`deleteAuthUsers` to `false` (explicit opt-in) or remove the Auth deletion path
and leave accounts disabled/linked-out instead.** `studentAuth.ts` also calls
`auth.deleteUser(createdAuthUid)` as a compensating rollback of an account the
*same* loop iteration just created (never a reclaimed account) — acceptable, but
worth documenting as the only legitimate delete.

---

## 5. Functions — scoping and identity, verified

- Server-side `where` scoping confirmed in the read callables:
  `getMyAssignments` (`submissions where studentId == own`),
  `getMyStudentTests` (`studentAssessments where studentId == own`),
  `listManagedAssessmentTests` (`collegeId`, + `facultyId` for faculty),
  `listManagedGradeRecords` (`collegeId`). No client-filter-after-limit here.
- `auditAndRepairIdentities` (identityRepair.ts): dry-run default, superadmin-only,
  8-way concurrency, quota retry, per-row `decideProfileAccount` (email-anchored,
  mismatch refusal), advisory `DUPLICATE_PROFILE`, orphan reverse-sweep,
  `STALE_CLAIMS_NO_PROFILE` reclaim with full-scan gate. **No disable action
  exists** — orphans are reported and asked to be "grant a role, then re-run"
  (§12). Merging duplicates is deliberately unimplemented.
- `mustChangePassword` is written (`accountManagement.ts`, `roleManagement.ts`,
  `userProvisioning.ts`) and **read nowhere** in frontend or functions. Confirmed
  decoration.

---

## 6. Cross-cutting risks found while tracing data paths

1. **Admin `/admin/attendance` college scoping is broken on fresh sign-in.**
   `useCollegeId()` reads `localStorage['collegeId']` / `localStorage['user']` —
   keys `AuthContext` does not write. Result: `filters.collegeId` undefined →
   unscoped `classSessions`/`attendanceRecords` queries. (Rules admit
   `isStaff()` on those lists, so staff may see cross-college rows rather than a
   clean deny.)
2. **AI question generator "first college" fallback** (see Faculty section). A
   missing collegeId can save AI questions to an arbitrary college.
3. **Notification schema is split.** `studentDataApi`/dashboard use top-level
   `notifications`; `StudentNotificationsPage` reads `colleges/{cid}/notifications`
   (and `recipientId in [...]`). Two writers, two schemas — the dashboard badge
   and the notifications page can disagree.
4. **`functions/src/config/firebase.js` (+ `.js.map`) are still committed**
   build leftovers (audit 09-04 §9.5 open). Add to `.gitignore` and delete.
5. **`test:unit` only runs 3 of 10 test files.** The script is
   `node --test test/timetableConflicts.test.ts test/verifyAuth.legacy.test.ts
   test/identityProvisioning.test.ts`. `assessmentGrading`, `auth`,
   `collegeScope`, `gradeRecords`, `languages`, `paperWorkflow` (and the rules
   suite) are not run by it. So "add `test:unit` to CI" alone would not run most
   unit tests.
6. **CI runs Node 20 in both jobs; `engines` is Node 20.** The runtime is
   decommissioned 2026-10-30 — a hard deadline for this tree. Do **not**
   `npm audit fix --force`; the Node-20 pin is being carried on purpose until the
   runtime migration lands.
7. **`deploy:all` bundles `firestore:indexes` with rules/functions/hosting.**
   The rules-of-engagement discipline is to deploy rules+hosting **separately**
   from indexes, because a single-field "composite" is API-rejected and aborts the
   batch. The current file has 0 single-field entries, but the script structure
   reintroduces the blast radius if one is ever added.
8. **`getAllStudentsAttendanceSummary` (`attendanceApi.ts`) is unbounded** —
   no `limit` on `classSessions`, then chunked `in` queries on `attendanceRecords`.
   Fine at 382 students; linear cost as cohorts grow.

---

## 7. Data-integrity open items (status)

| Item | Verdict |
| --- | --- |
| HOD overview from `MOCK_STUDENTS = []` | Confirmed — plus 5 faculty screens (§0.2). Wire `HODDashboard` to `dashboardApi`/`feeApi` as a contained change. |
| 4 orphan Auth accounts | Data item. `auditAndRepairIdentities` reports them (`orphanAccounts`); no grant/disable action exists in code. Operator decision: grant a role then re-run the pass, or disable in console. |
| 2 duplicate profiles (`superadmins/1XEhSuU6igtL9up5c1kB`, `hods/dj2OY8kpMkanq54TOxBj_Multi-Department`) | Data item. Reported as advisory `DUPLICATE_PROFILE`; merge deliberately unimplemented — needs a human decision on which document survives. |
| `mustChangePassword` written, never consumed | Confirmed. Either build the forced-change screen or stop writing the claim. |
| HOD `Multi-Department` matches 0 students | Data item. The label comes from the duplicate HOD doc; no student carries that department. Resolves when the duplicate is merged and the overview is wired to a real department filter. |
| Node 20 decommission 2026-10-30 | Code fact (`engines`, both CI jobs). Migration PR is the owner's follow-up; don't `npm audit fix --force`. |
| `npm run test:unit` missing from `ci.yml` | Confirmed — and note §6.5: even when added, the script runs only 3/10 test files. |
| `.github/workflows/deploy.yml` untracked | Confirmed absent from repo; present only on the operator machine. CI remains build-only by design. |

---

## 8. Rules-of-engagement compliance matrix

| Rule | Status |
| --- | --- |
| Never delete an Auth account | ❌ `resetCollegeData` deletes by default (`deleteAuthUsers: true`). `studentAuth` rollback is a compensating delete of a just-created account. |
| Never write a password to Firestore | ✅ `noPasswordField()` + `secretFieldDeletes()` |
| Claims are the authz source; `users/{uid}` is identity | ✅ Firestore rules. ❌ `storage.rules` and Express `verifyAuth` still fall back to profile docs. |
| ≤10 get()/exists() per query; guard field reads | ✅ pointer short-circuit; mostly guarded. ⚠️ one unguarded `resource.data.studentId` in top-level `notifications` read. |
| Server-side `where`, never client filter after limit | ✅ callables. ⚠️ `fetchTodaySchedule` cohort matching is client-side after `limit(500)`. |
| Rules denial ≠ callable denial (read error code) | ✅ client distinguishes `permission-denied` vs not-found in `resolveStudentRecord`, `studentDataApi`, `classifyReadError`. |
| Indexes: never answer "delete indexes not in your file" | ⚠️ not actionable in code; file has 63, console has more. Keep discipline. |
| Deploy rules+hosting separately from indexes | ⚠️ `deploy:all` bundles them; file currently has no single-field entries. |
| Windows/PowerShell; one step per message | N/A to audit; applies to any fix phase. |

---

## 9. Prioritized recommendations

**P0 (data-loss / security):**
1. `resetCollegeData`: default `deleteAuthUsers` off (or drop Auth deletion) —
   re-breaks "never delete an Auth account" today.
2. `storage.rules`: claim-only identity + pointer `ownsStudentId`.
3. Express `verifyAuth`: role from claim only; add `requireRole` to
   `questions`/`papers`/`config` reads.

**P1 (correctness):**
4. Wire `HODDashboard` (and decide on the 5 faculty mock screens + 2 stubs) to
   their data owners, or mark them explicitly "not connected" in the UI.
5. Fix `FacultyStudentAnalysis` `NaN%`.
6. Fix admin `/admin/attendance` collegeId resolution (use `user.collegeId` from
   `useAuth`, fall back to `vriddhi_college_id`).
7. Remove the "first college" fallback in `useAIQuestionGenerator.saveAll`.

**P2 (hygiene / process):**
8. Add `test:unit` to CI — and first widen the script to run all 10 test files.
9. Delete/ignore `functions/src/config/firebase.js(.map)`.
10. Split `deploy:all` so indexes deploy separately from rules+hosting.
11. Decide `mustChangePassword` (consume it or drop it).
12. Start the Node 20 → 22 runtime migration PR well before 2026-10-30.

---

## 10. Post-audit fixes applied (2026-09-07)

Status of every P0/P1/P2 item after the fix pass on `arena/01a07c5a-vriddhi`.
Commit `5c90584` (P0 #3, the Express API authz leak) was applied first and is
already on the branch; the items below follow it.

| # | Item | Resolution |
| --- | --- | --- |
| P0-1 | `resetCollegeData` deletes Auth by default | ✅ Default is now `deleteAuthUsers: false` (explicit opt-in). The Super Admin reset dialog gained a **"Also delete Firebase Auth login accounts"** checkbox, OFF by default, and its success copy reflects the choice. |
| P0-2 | `storage.rules` derives role/college from profile docs | ✅ Rewritten to claim-only identity (`role`/`collegeId` from `request.auth.token`), mirroring `current-firestore.rules`; `ownsStudentId` now also accepts the `users/{uid}.studentDocId` pointer. |
| P0-3 | Express `verifyAuth` profile fallback + open questions/papers reads | ✅ (commit `5c90584`) claim-only `verifyAuth`; `READ_ROLES` staff-gate on every questions/papers GET. |
| P1-4 | HODDashboard + 5 faculty mock screens + 2 stubs | ✅ `HODDashboard` overview + students tabs now read `useDashboardData` (per-college legacy collections); faculty/subjects/approvals tabs show an honest "not connected" notice. `FacultyAnnouncements/Calendar/Library/Reschedule/StudentAnalysis` carry a shared `NotConnectedBanner`. The 2 static stubs (`AIAgentPage`, `SuperAdminUniversityDetail`) are already honest (under-development card / static seed list) and left as-is. |
| P1-5 | `FacultyStudentAnalysis` `NaN%` | ✅ Empty-cohort guard; the two averages render `—` when there is no cohort. |
| P1-6 | `/admin/attendance` college scoping | ✅ `useCollegeId()` reads the claim (`user.collegeId`) then `vriddhi_college_id`; the legacy `collegeId`/`user` localStorage keys are gone. |
| P1-7 | AI question generator "first college" fallback | ✅ Removed; a missing collegeId now fails closed (the Firestore write is still rules-gated on the claim). |
| P2-8 | `test:unit` narrow + missing from CI | ✅ Script now runs all 9 non-emulator test files under `node --import tsx`; CI functions job gained a `test:unit` step. |
| P2-9 | Committed `firebase.js(.map)` leftovers | ✅ Deleted and added `functions/lib/`, `functions/src/**/*.js(.map)` to `.gitignore`. |
| P2-10 | `deploy:all` bundles indexes | ✅ `deploy:all` now deploys `firestore:rules,storage,functions,hosting`; `deploy:indexes` deploys indexes separately; `deploy:rules` now also ships `storage` (it was configured in `firebase.json` but never in any script). |
| P2-11 | `mustChangePassword` written, never consumed | Decision: **keep the claim** (harmless, forward-looking) and defer the forced-change screen to a dedicated PR — it needs a new route plus a re-authentication flow the client does not have yet. No producer changes made. |
| P2-12 | Node 20 → 22 runtime migration | Deferred — operator-owned, has its own PR. Do not `npm audit fix --force`. |

Verification run in the workspace: `functions` `npm run build` exit 0; widened
`npm run test:unit` **74/74**; frontend `npm run build` (tsc + vite) exit 0.
The rules emulator suite (`npm run test:rules`) could not run in this sandbox
(no Java); run it locally before deploying `storage.rules`.

### 10.1 Rules-suite verification follow-up (2026-09-08)

Ran `npm run test:rules` on the operator's Windows machine (after installing
JDK 21 — firebase-tools v15 requires Java ≥ 21, and its Java check uses
`spawn("java")` with no `JAVA_HOME` fallback, so PATH must expose JDK 21).

Result: **storage passes 2/2** (paper authoring + assignment submission) —
`storage.rules` rewrite verified against the emulator. The 3 failures were all
Firestore-rules tests that were stale relative to the claim-only rules (and
fail identically on `main` — the branch never touched either file):

1. student timetable list expected 1 row, got 2 — the legacy-faculty `weeklySchedules`
   fixture shared `branch: 'CSE'` with the student's query, inflating the count.
2. "denies students access to attempt scores" — the rules deliberately let a
   student read their OWN `studentAssessments` attempt (portal results); the test
   still asserted the old deny-everything.
3. legacy no-claim faculty list — the claim-only rules intentionally removed
   profile-doc role/college resolution; the test still asserted the old behavior.

All three are now fixed to match the claim-only rules (own-vs-other attempt
scoping; legacy no-claim faculty denied until claims are issued). While in the
fixture, `branch` values were corrected from engineering codes (`CSE`/`ECE`) to
non-technical UG/PG programs (`B.Com`, `B.Sc`) per
`src/shared/constants/academicPrograms.ts`. Two live engineering-code leaks were
also removed: `functions/src/routes/questions.ts` `/batch-branch` fallback
(now non-tech programs + 3-year academic list, no 4th year) and the
`FacultyAssignments` "e.g., CSE" placeholder (now "e.g., B.Com").

### 10.2 Non-technical domain sweep (2026-09-08)

Confirmed: Vriddhi targets PG/UG non-technical colleges only (arts, commerce,
science, management, computer applications) — never B.Tech/BE. A full sweep for
engineering markers (`CSE/ECE/EEE`, `B.Tech`, "Computer Science", 4-year batches
`NNNN-NNNN`, 10-semester bounds) found and removed every live leak:

- `scripts/seed-phase2-assessment.mjs` — subject "Computer Science" → "Computer
  Applications", branch `CSE` → `BCA`, batch `2024-2028` → `2024`.
- `src/modules/admin/services/onboardingService.ts` — student + schedule upload
  templates: batch "year range" `2024-2028` → admission year `2024`; semester
  max 10 (5-year engineering pattern) → 6.
- `src/shared/utils/parseCSV.ts` — student CSV template sample row: `2024-2028`
  → `2024`, "Computer Science" → `B.Com` (faculty sample was already correct).
- `src/modules/faculty/pages/FacultyLibrary.tsx` — default new-book category
  "Computer Science" → "Computer Applications" (matches its own category list).
- `functions/test/{paperWorkflow,timetableConflicts}.test.ts` — `CSE`→`BCA` /
  `B.Com` fixture values.
- `STUDENT_BULK_UPLOAD_FIX.md` — CSV example "Computer Science"/"Electronics" →
  `B.Com` / `B.Sc`.

`attic/` (137 dead-code files, excluded from build/typecheck) intentionally
left untouched — it is a reference archive, not live code. The only remaining
matches for the search patterns are the `#eee` CSS hex color (false positive)
and the intentional `DEPRECATED_TECH_BRANCHES` denylist in
`src/shared/constants/academicPrograms.ts`.

### 10.3 Academic years start at 2026 (2026-09-08)

Per product requirement (already encoded in `attendanceBatches.ts`:
`ATTENDANCE_MIN_BATCH_YEAR = 2026`), all hardcoded batch/admission years and
academic-year ranges were moved to 2026 onward. Pre-2026 values are treated as
obsolete. Changed across 27 files: batch lists (`questions.ts`, `config.ts`,
`AIQuestionGenerator`, `DEFAULT_BATCHES`, `FacultyUploadMaterial`,
`AdminFeeManagement` year dropdown), academic-year defaults/placeholders
(`Settings` 2026-2027 + 2026 semester dates, `FacultyTopics`,
`useCurriculumMapping`, `AdminCurriculum`, `AdminClassSchedule` CSV, paper
editors), sample CSV/template rows (`onboardingService` R2026*** + batch 2026,
`parseCSV`, `questionFileParser`, `BulkImportModal`, `FacultyBulkImport`,
`STUDENT_BULK_UPLOAD_FIX.md`), curriculum template scheme years (`SEP 2026`,
`SEP 2026-2027`, `syllabusParser` comment), `Journey` achievement dates,
`StudentDashboard` batch fallback, `FacultyAssignments` batch placeholder, and
seed `batch`/`joiningDate` (2026). DOB, phone numbers, and university
`establishedYear` (historical facts) intentionally unchanged.
