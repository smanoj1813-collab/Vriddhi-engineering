# CURRICULUM AUDIT — read/write address reconciliation (2026-09-13)

Session focus from the handoff: audit the curriculum domain the same way the
notification panel and student journey were audited — find where the code that
WRITES a collection disagrees with the code that READS it, in the client, in
Cloud Functions, and in the security rules. The three standing production
items (staffAttendance >1000-rule-expressions, two missing classSessions
indexes, two stale notification rules tests) were folded in because the rules
file budget makes them one edit.

## What the audit found

### F1 — `curriculumFacultyMappings`: reads looser than tenancy, writes looser than reads
`allow list: isStaff()` was **unscoped per document**: any signed-in staff
member could stream every college's mappings with one `getDocs(collection())`.
The app did exactly that — `sessionTopicsApi.fetchTaughtSubjects` ran an
unscoped `limit(200)` scan and filtered client-side. Worse, writes were
`isCollegeStaff() && sameCollege(...)` — which **includes faculty and
mentors**, so a teacher could self-assign any course in their college.
`delete` shared the create/update statement and read `request.resource.data`,
which is `null` on a delete: non-superadmin deletes could never succeed (the UI
hides this by soft-deleting via `status: 'removed'`).

**Fix (rules):** `get, list` are now `isSuperadmin() || (isStaff() &&
sameCollege(resource.data)) || isAssignedFaculty(resource.data)` — per-document
tenancy, with an owner branch so a legacy row missing its `collegeId` stamp
still reaches its teacher. Writes are `admin|hod|principal` only; `delete`
reads `resource.data`.
**Fix (client):** `fetchTaughtSubjects` reuses `listMappings` with a
`where('collegeId', …)` (or self-scoped `where('facultyId', …)` fallback)
query; `FacultyAttendance` now passes the caller's college claim down through
`fetchSessionTopicOptions` → `fetchFacultyCurriculumTopics`.

### F2 — `curriculum` + `syllabusExtracts`: `list` looser than `get`
`get` was tenant-scoped (`sameCollege || !('collegeId' in data)`), `list` was
plain `isStaff()` — a staff member on any college could list every college's
assigned curriculum (each row carrying the FULL parsed syllabus).
**Fix (rules):** both are now the single shared `canReadCurriculum(data)`, so a
list can never be looser than a get. Superadmin's unscoped collection reads on
the dashboard keep working (the superadmin branch passes per document).
Unassigned `syllabusExtracts` (field present, `collegeId: null`) stay
superadmin-only because `sameCollege` fails on them — the review queue is the
intended audience.

### F3 — completion silently dropped every curriculum-derived topic
The topics picker merges two stores: rows from the assigned **curriculum
documents** (composite ids `curriculumId__module__key`) and legacy **bank**
rows (`topics/*` doc ids). `FacultyAttendance.handleMarkComplete` sent
curriculum ids in `topicIds`, but `completeClassSession` resolved `topicIds`
ONLY via `db.collection('topics').doc(id).get()` — a composite id never
exists there, so its title was discarded: it never entered `topicsCovered`,
never matched a ledger row, and coverage stayed 0 no matter what was taught.
Ledger options were fine (titles travel).
**Fix:** `completeClassSession` now accepts `topics: [{topicId, title}]` pairs
(the client sends title for EVERY chosen option, id where one exists);
`validateCompleteInput` parses/trims/caps them, and the pure
`mergeCompletionTopics()` helper folds pairs → resolved bank ids → free-text
titles, de-duplicating on the normalised title with pairs winning. Old clients
(only `topicIds`/`topicTitles`) keep working through the same merge. The new
pair path also gives `buildLedgerRow` a real `topicId` to store, so the
session↔ledger edge now exists for curriculum topics too.

### F4 — `getCurriculumProgress`'s second plan source was dead
The callable built planned topics from `facultyTopics` **plus**
`db.collection('topics').where('facultyId','==',facultyId)` — but bank rows
carry no `facultyId` (F3's comment in `sessionTopicsApi` documents this), so
that query returned nothing for everyone, forever. Faculty without hand-made
ledger rows saw 0 planned topics even with a full assigned syllabus.
**Fix:** the plan now comes from the authoritative source the picker uses —
`plannedTopicsFromCurriculum()` reads the assigned `curriculum` documents
(`db.getAll`, capped at `MAX_PROGRESS_CURRICULUM_DOCS = 10`) and flattens
`courses[].modules[].topics` with the same id→code→name course matching.
Coverage merge is unchanged: a planned title marked in a completed session
flips to covered.

### F5 — dead reader on the wrong address
`facultyApi.fetchFacultyTopics()` queried `topics/*` **by `facultyId`** —
always empty, zero callers (the live faculty Topics page uses
`useTopics` → `facultyTopics/*`). Removed; `FacultyTopic` remains re-exported
for compatibility.

### F6 — two `createSyllabusExtract` implementations, two write shapes
`StandardizedCurriculumUploader` wrote through the legacy
`superadmin/api/curriculumApi.ts` (shallow sanitize) while `useSyllabusParser`
wrote through `syllabusCurriculumApi.ts` (full nested null-fill) — same
collection, divergent docs. `syllabusCurriculumApi` is a functional superset
of the legacy file, so the page/uploader/admin-hook imports were re-pointed to
it and **`src/modules/superadmin/api/curriculumApi.ts` was deleted** — one
canonical curriculum API for all writers. (Answering the handoff question: the
only live writers into `curriculum` are `assignCurriculumToCollege` and
`createCurriculumDoc`, both superadmin-side, both writing the shape the
readers — the Assigned tab, admin `listCurriculumDocs`, faculty
`getDoc(curriculum/…)` — expect. The legacy `course/semester/subjects` shape
had NO live writer; its readers were dead code.)

### F7 — `topics` bank rule carried a dead owner clause
`allow get: … || (facultyId == uid)` — no writer ever stamps `facultyId` on a
bank row (F3), so the clause was unreachable complexity on a file that is
counting expressions. Removed; bank stays superadmin-write / staff-read.

### F8 — navigation: grouped UI role-gate + missing Admission Center
The grouped sidebar (`collapsibleNavByRole` in `src/shared/components/Layout.tsx`)
was registered for `faculty` and `principal` only, so a newly created admin got
the flat list. The grouped `principalNav` config also predates PR #49 and never
received the **Admission Center** entry — flat `navItems` got it, principals
could not reach the page at all. Fix: `admin` now shares `principalNav`
(re-documented as the college-portal nav), and Admission Center joins the
Students group; the route (`/admin/admissions`) and the `admissions` callable
already accept `admin|principal|hod|superadmin`, and HOD keeps its deliberately
different flat nav.

## Standing production items folded in
1. **staffAttendance 1000-expression overrun:** the overrun is a WHOLE-FILE
   budget, so the file was deduplicated instead of trimmed at the block. New
   shared functions — `tenantWrite(data)`, `collegePathWrite(pathCollege)`,
   `canReadCurriculum(data)`, `isAssignedFaculty(data)` — replace the inlined
   patterns at 20 use sites (classSessions, attendance/attendanceRecords ×2,
   attendanceSummary, issuedBooks, staffAttendance create/update, the seven
   `colleges/{id}` subcollection writes, facultyTopics, curriculum,
   syllabusExtracts) while staying semantically identical (superadmin escape
   hatches preserved — see the staffAttendance update test still expecting a
   superadmin to survive the facultyId-immutability clause). Heuristic estimate
   of the parse-tree size drops ~34; the emulator deploy check is the final
   word (run `npm run test:rules`, then `npm run deploy:rules`).
2. **classSessions composite indexes:** the principal attendance list sorts
   `date DESC, startTime DESC` behind `collegeId ==`; the class-schedule view
   sorts `date ASC, timeSlot ASC` behind `collegeId ==`. Each needs its own
   composite (a query with TWO sorts cannot auto-merge), but the optional
   branch/batch/facultyId/status filters are pure equalities that merge with
   single-field indexes — so exactly the two indexes the console links pointed
   at are now in `firestore.indexes.json`
   (`collegeId ASC + date DESC + startTime DESC`, and
   `collegeId ASC + date ASC + timeSlot ASC`). `npm run deploy:indexes`.
3. **stale notification rules tests:** the two tests asserting the pre-PR
   direct-student-read contract now assert `assertFails` (students go through
   the `getMyNotifications` callable), with a comment explaining why.

## Rules tests added
`functions/test/firestore.rules.test.ts` → `describe('curriculum read & write
tenancy')`: unscoped lists denied for admin/staff, college-scoped lists
allowed, cross-college gets denied, unassigned extracts invisible to staff but
not to superadmin, the self-assignment hole closed (faculty create/update
denied even on their own row), legacy owner reads allowed, admin delete
finally works, students locked out of mappings entirely, bank writes
superadmin-only.

## Verified in the sandbox (2026-09-13)
- functions unit **356/356** (was 347 — 9 new), `tsc` (functions) clean
- frontend `tsc` clean, `vite build` clean, unit **119/119**, render **48/48**,
  dead-code **274 files / 262 reachable / 0 unlisted orphans** (the deleted
  legacy API file drops out of both counts)
- GitHub Actions on PR #50: Frontend build ✓, Functions build ✓

The rules suite could NOT be executed in the agent sandbox: this environment's
egress allowlist reaches only `registry.npmjs.org` + `api.github.com`
(GitHub release binaries on `objects.githubusercontent.com` are blocked), and
the system package manager is rootless-locked — no JRE can be obtained by any
of: apt, Temurin direct download, or npm packages that claim to bundle a
runtime (`@vscjava/java-ls-jre-linux-x64` published without its `jre/` dir;
`pmd-bin`/`jdeploy` fetch theirs at install time). `firebase-tools` bundles the
emulator JARs but not Java itself, so `npm run test:rules` stays a
user-machine gate.

## Deploy order (unchanged) + notes
1. `npm run test:rules` on a machine with Java, then `npm run deploy:functions`
2. `npm run deploy:rules` (this is what unblocks faculty attendance saves)
3. `npm run deploy:indexes`
4. `npm run deploy:hosting`

If `deploy:rules` still reports the expression limit, the emulator will name
the line — the same helper pattern extends (every remaining
`isSignedIn() && (isSuperadmin() || isStaff())` pair is a candidate).

## Known / not in scope
- superadmin subscriptions/plans denials and the dashboard "Read budget
  exceeded" message are pre-existing and unrelated to curriculum.
- `useTopics` (faculty planner) is unchanged: it was already the correctly
  scoped reader/writer of `facultyTopics`.
- HOD keeps the flat nav by design; if it should group too, `hod` needs its
  own entry in `collapsibleNavByRole` (its flat slice differs: no Admission
  Center, no Question Review).
