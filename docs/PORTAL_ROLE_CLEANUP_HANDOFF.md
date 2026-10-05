# Portal role cleanup — handoff

**Status:** Principal round DONE (`cc61e84`, on PR #3, branch
`arena/01a10b53-vriddhi-engineering`). Next rounds: **HOD → faculty → students**.
This doc is the handoff: what shipped, the exact patterns to reuse, the pending
list, and the current HOD/faculty surfaces so the next round starts fast.

---

## 1. What the Principal round shipped

- Sidebar (`principalNav` in `src/shared/components/Layout.tsx`):
  - **University Exams group removed entirely** (Exam Management, UUCMS
    Integration, BCU Compliance, Scheme Packs, Result Importer).
  - **Assessments group = one item**: "Branch-wise Assessment Conduction"
    → `/admin/branch-conduction` (NEW read-only page, per-branch
    upcoming/ongoing/completed counts + live/next tests; built on the existing
    `listManagedAssessmentTests` callable — principal already passes its role
    gate; **zero new backend**).
  - **Grade Records + AI Question Generator hidden** (question bank / paper
    review / paper generator were already gone from principal).
- Deep links bounce the principal:
  - `questionWorkflowOnly` route wrapper (`src/modules/admin/routes.tsx`) now
    also wraps `grade-records` and `ai-questions`.
  - `ADMIN_ROUTE_PERMISSIONS` (`src/modules/auth/permissions.ts`) gained
    `uucms-integration`, `bcu-compliance`, `result-importer`
    (`universityExam.manage`) and `scheme-packs` (`engineering.schemePacks`) —
    roles `['admin','hod']`, principal absent.
- Flat `navItems` (search/quick-jump) dropped `principal` from the five hidden
  entries; principal mobile tab "Assessments" now lands on the new page.
- Tests: `permissions.test.ts` pins the new bounces; new pure utils + tests
  (`src/modules/admin/utils/branchConduction.ts` + `.test.ts`). Verified:
  tsc clean, 727/727 root tests, vite build clean. Functions **unchanged**.

Deploy for this round = **hosting only** (merge PR, then
`firebase deploy --only hosting` from `C:\Projects\Vriddhi-engineering-deploy`).

---

## 2. The hiding pattern (reuse exactly this, nothing parallel)

For each role surface, four touch points, in this order:

1. **Sidebar group** — the role's nav array in `Layout.tsx`:
   `principalNav` / `hodNav` / `facultyNav` / `accountsNav` / `operationsNav`
   (+ `collapsibleNavByRole` map, + the phone `mobileTabs` map further down).
2. **Flat `navItems`** (same file) — roles arrays feed search/quick-jump and
   the superadmin/mentor sidebar; drop the role string there too.
3. **Route bounce** — so bookmarks/deep links don't render hidden pages:
   - per-page `RoleRoute` wrapper in `routes.tsx` (see `questionWorkflowOnly`), or
   - an `ADMIN_ROUTE_PERMISSIONS` entry when a permission already models it
     (preferred when the matrix has the right role list — superadmin bypasses
     automatically).
4. **Tests** — extend `permissions.test.ts` (pure `canAccessAdminPath`
   assertions) and, for new derivations, a pure util + node test registered in
   root `package.json` `test:unit`.

**Hide, don't delete.** Remove the nav line / role string; keep the page.
Plug back later = re-add the line + role. Comment each removal with the
plug-back pointer (see the principalNav comments).

Verification loop: `npx tsc -p tsconfig.json --noEmit`,
`npm run test:unit` (root), `npm run build`; functions suite only if
`functions/` changed. (Sandbox note: node_modules may need
`PUPPETEER_SKIP_DOWNLOAD=true npm ci` after a fresh turn; rules tests need
Java + emulator → run on the Windows side.)

---

## 3. Current HOD surface (next round) — `hodNav`, shared by `admin` role

Landing: `/admin/hod-dashboard`. Groups today:

- **Students**: Students · 360° View · Admission Center
- **Attendance**: Attendance · Faculty Attendance
- **Academics**: Curriculum · Class Schedule · Academic Calendar · Scheme Packs
- **Assessments**: Assessments (test-reports) · Grade Records · Question Bank ·
  Paper Review · AI Question Generator · Paper Generator
- **Requests**: Purchase Requests
- **Insights**: Analytics · Assignment Analytics · Journey
- Links: Install App · Settings

Awaiting the user's list of what to remove/modify for HOD.

## 4. Current faculty surface (round after HOD) — `facultyNav`

Landing: `/faculty/dashboard`. Groups today:

- **Attendance**: My Attendance · Mark Student Attendance
- **Students**: Student Requests · Student Analysis · 360° View
- **Curriculum**: My Curriculum · Topics · Assignments · Upload Materials ·
  Reschedule Class
- **Schedule**: My Weekly Schedule · Calendar
- **Assessments**: AI Question Generator · Paper Generator · Generated Papers ·
  Question Bank · Universal Bank · Assessment Schedule · Auto-Grading 5M/10M
- **Insights**: Journey
- Links: My Salary · Install App · Announcements · Calendar · Settings

Faculty route guards live in `src/modules/faculty/routes.tsx` (same wrapper
idea applies). Students round comes after; the student-side toggle pattern is
`colleges/{id}/config/modules` (Assignments) — see ONE_VRIDDHI doc.

---

## 5. Pending / do-not-touch list (carries across rounds)

- **`runStudentCode` (Judge0)**: excluded from deploys via a *local-only* edit
  in the deploy worktree's `functions/src/index.ts` (import+export removed).
  The OLD deployment still exists in Cloud Run — deletion decision pending:
  `firebase functions:delete runStudentCode --region asia-south1`.
  Never deploy/placeholder/bypass it.
- **Admission Center (10 fns) + Student Portal FEE fns**: ON HOLD — no
  changes/redeploys/deletions; keep the shared `api` function.
- **`onAttendanceRecordWrite`** shows trigger `https` (legacy conflict) — plan:
  deploy new-name → verify → retire old; no deletion without approval.
- **Quota plan** (20,000 milliCPU, asia-south1): batches ≤ 5, no unchanged
  retries of quota-blocked functions, scaling caps need confirmation (pilot
  cap on `getMyNotifications` = 10 maxInstances is live).
- Merge/deploy flow: PR #3 → merge → deploy from
  `C:\Projects\Vriddhi-engineering-deploy` only (never the original checkout).
  This round needs hosting only; if functions ever change again: `api` alone,
  then pilot fn, per docs/DEPLOY_ONE_VRIDDHI.md.
