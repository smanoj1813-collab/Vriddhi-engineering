# Optimisation hand-off — 25 Sep 2026

> Action plan agreed on 25 Sep 2026: cut cost, consolidate, add content — **without breaking
> production**. This file keeps the plan in the repo so future sessions can follow it; the
> clause-by-clause review, corrections and the paper-corpus plan live in
> `docs/HANDOFF_REVIEW_2026-09-25.md` (read that first — it supersedes two numbers below).

## 0. Where things stand

| Item | State |
|---|---|
| `main` | `2511fe9` = merge of PR #82 (Access Control fix, 50 prep papers, costing docs, Resume Builder add-on) |
| Production | Deployed from `2511fe9` on 25 Sep 2026: Firestore rules ✔ Storage rules ✔ all functions ✔ hosting ✔ |
| Resume Builder | Live, **disabled for every college** until enabled per college (Superadmin → College → Overview → "Resume Builder add-on" card) |
| 14 orphan Cloud Functions | Still exist in the cloud (deletion declined during deploy on purpose) — see item 1.3. Verified 25 Sep 2026: zero references in `src/` and `functions/src` |
| Known live breakage | 3 routes call `gemini-1.5-flash`, shut down 29 Sep 2025 — see item 1.1 |
| Firebase project | `vriddhi-engineering`, functions region `asia-south1` (fee/Razorpay functions in `us-central1`), Node 22, 2nd-gen |
| Operator | Deploys from Windows PowerShell (`C:\Projects\Vriddhi`) — one command per line, no `&&`, one step at a time, wait for output |

Reference docs: `docs/RESUME_BUILDER.md`, `docs/RESUME_BUILDER_ADDON_COSTING_2026-09-25.md`,
`docs/COSTING_PLAN_1YEAR_5000_STUDENTS.md`, `docs/COSTING_AND_PRICING_ANALYSIS_2026-09-25.md`,
`docs/Vriddhi_Costing_Sheet.xlsx`.

## 1. Ground rules — "nothing breaks"

### 1.1 Working method
* One PR per item (or small group): code + tests + docs + a "deploy & verify" note in the description.
* Ship in the order below. Phase 1 items are independent and low risk; Phase 2 changes data paths; Phase 3 is structural.
* Any change that alters a data path keeps the **old path as a fallback** for one release (summary → raw query; new model → old provider chain; new route → old route still mounted).
* Never rename a callable, an Express route, a Firestore collection or a Storage path in the PR that introduces its replacement. Add new → switch client → remove old in a later PR.

### 1.2 Test gates (all green before every commit — current baselines, may only go up)

```bash
cd functions && npx tsc --noEmit -p . && npm run test:unit          # 820 tests today
npx tsc --noEmit && npm run test:unit && npm run test:render        # 435 unit, 306 render checks today
npx vite build                                                       # must succeed
cd functions && npm run test:rules                                   # when current-firestore.rules / storage.rules change (needs Java 17+)
```

* Test lists are **explicit** in `package.json` (root `test:unit`) and `functions/package.json` (`test:unit`) — add every new test file or it silently never runs.
* Pages using a new service need a stub in `scripts/render-check/stubs/` + alias in `scripts/render-check/vite.config.mts` (pattern: `stubs/resumeService.ts`) and a section in `scripts/render-check/run.mjs`.
* functions ESLint: `cd functions && npx eslint --ext .ts <changed files>`. Root has no ESLint config.

### 1.3 Invariants — do not change
* Resume credits: reserved **inside** the Firestore transaction in `functions/src/routes/resume.ts` (`POST /pdf`), released on render failure. No client-side credit logic, no html2canvas/raster fallback for resumes.
* `functions/src/index.ts` mounts every router at both `/api/<name>` and `/<name>` — keep both.
* Callable names + regions are client contracts (`httpsCallable(functions, 'name')`).
* Rules: every new collection needs rules **and** a case in `functions/test/firestore.rules.test.ts`. Default deny.
* `firestore.indexes.json` deploys separately (`npm run deploy:indexes`) — add a composite index there and deploy indexes **before** the code that uses it.

### 1.4 Deploy runbook (operator; agent supplies one command at a time)

```powershell
cd C:\Projects\Vriddhi
git checkout main
git pull origin main
npm ci
npm ci --prefix functions
firebase deploy --only firestore:rules --project vriddhi-engineering     # only if rules changed
firebase deploy --only storage --project vriddhi-engineering             # only if storage.rules changed
firebase deploy --only firestore:indexes --project vriddhi-engineering   # only if indexes changed (before functions/hosting)
firebase deploy --only functions --project vriddhi-engineering           # answer "n"/No to deletion prompts unless the PR says otherwise
firebase deploy --only hosting --project vriddhi-engineering
```

Rollback: hosting `firebase hosting:rollback`; functions = Cloud Run console → service → "Manage traffic" → previous revision, or redeploy the previous commit; rules = Firebase console → Rules → history → restore.

After every deploy watch for 15 minutes: Cloud Logging `resource.type="cloud_run_revision" severity>=ERROR`, the Firestore usage graph (reads/writes per day), and a manual smoke of the touched screens. Ask the user to hard-refresh (Ctrl+Shift+R) once — the PWA service worker (`registerType: 'prompt'`) may keep the previous build until accepted.

### 1.5 Sandbox facts
* No general outbound internet from bash; npm/pip registries work. **Gemini/Google APIs cannot be called from the sandbox** — model changes are verified in production after deploy.
* `npm ci --no-audit --no-fund --ignore-scripts` in root and `functions/` when `node_modules` is missing. Check `git log -1` at the start of each turn.
* Real-Chrome PDF check (resume templates): install `@sparticuz/chromium puppeteer-core pdf-parse@1.1.1` in a scratch dir outside the repo, extract `al2023.tar.br`, run with `LD_LIBRARY_PATH=<extracted>/lib`, render `renderResumeHtml(data, { templateId, mode: 'print' })` via `node --import tsx` from `functions/`, assert the `pdf-parse` text contains the name, a bullet, `₹` and the section headings.
* Python: `pip install --break-system-packages` (openpyxl is used by `scripts/build-costing-sheet.py`).

## 2. Phase 1 — this week

### 2.1 Gemini model switch (fixes a live outage + cuts AI cost)
**Why:** `gemini-1.5-flash` was shut down 29 Sep 2025; those calls fail and only work if a DeepSeek/OpenAI key exists.
**Where:** `functions/src/routes/ai-chat.ts:463` (study material) and `:1383` (`/chat`, uses `systemInstruction` + `startChat`); `functions/src/routes/prep.ts:167` (`POST /content/draft`). Already on 2.5 Flash: `paperParsing.ts:75`, `routes/ai-questions.ts:86`, `routes/resume.ts:604` (env `RESUME_AI_MODEL`), `studentAssessments.ts:2519`.
**Plan:**
1. In `functions/src/config/aiProviders.ts` add `export const GEMINI_MODELS = { fast: process.env.GEMINI_MODEL_FAST || '<fast model>', quality: process.env.GEMINI_MODEL_QUALITY || '<quality model>' }`.
2. Tier mapping: **fast** = study material, chat, prep drafts (later cover letter / interview questions); **quality** = paper parsing, grading suggestions, AI question generation, resume rewrite. Do not downgrade parsing/grading in this PR.
3. Where JSON is parsed out of the reply, pass `generationConfig: { responseMimeType: 'application/json' }`; keep the fence-stripping/parse-error handling untouched.
4. Keep the DeepSeek/OpenAI fallback chain exactly as it is.
5. Add a unit test that greps `functions/src` for the dead model literal and fails if found.
**Verify in production:** Faculty → Study material generate; AI chat reply; Superadmin → Prep Studio → draft a topic; Cloud Logging shows no `[StudyMaterial] LLM fallback` warnings and no 404 `models/gemini-1.5-flash`.
**Rollback:** set the env var and redeploy — no code change.
**Deploy:** `--only functions`.
**⚠ Read `docs/HANDOFF_REVIEW_2026-09-25.md` §2 (A1–A4) and §4 before choosing the model ids:** the 2.5 series is signalled for retirement in Oct 2026 and all 3.x Flash prices double on 1 Jan 2027, which changes the "₹40–50 K" outcome.

### 2.2 Hosting cache headers + chunk-reload guard (egress −70 %, faster app)
**Why:** `firebase.json` sends `Cache-Control: max-age=0, no-cache, no-store, must-revalidate` for `**/*.js` and `**/*.css`, so every hashed Vite asset is re-downloaded on every visit.
**Where:** `firebase.json` header rules; `vite.config.ts` (PWA `workbox` block, ~62–76); `src/main.tsx`.
**Plan:**
1. Replace the two rules with: `/assets/**` → `public, max-age=31536000, immutable`; `/*.js` (root only: `sw.js`, `workbox-*.js`, `registerSW.js`) → `max-age=0, no-cache, no-store, must-revalidate` (keep the existing `/sw.js` rule); `/index.html` and `/` → `max-age=0, no-cache, must-revalidate`; keep the manifest and `/icons/**` rules.
2. Add a one-shot reload guard in `src/main.tsx` for `vite:preloadError`: `sessionStorage` flag, reload once, otherwise surface the error.
3. Optional in the same PR: shrink the precache — `globIgnores` for the big lazy chunks and a `runtimeCaching` CacheFirst rule for `/assets/`. Keep `index.html` precached (`navigateFallback` depends on it). Do **not** change `registerType`/`skipWaiting`.
**Verify:** `curl -I https://vriddhi-engineering.web.app/assets/<any>.js` shows `immutable`; `/index.html` shows `no-cache`; open the app, visit 5 lazy pages (Resume Builder, Library, Fee Management, Curriculum, Question Bank) — no "Failed to fetch dynamically imported module".
**Rollback:** revert `firebase.json`, `--only hosting` (or `firebase hosting:rollback`).

### 2.3 Delete the 14 orphan Cloud Functions
`autoGenerateTimetable backfillEmployeeDirectory deleteQuestionBankItem duplicateAssessmentTest exportEmployeeAttendanceCsv exportEmployeesCsv listAuditLogs listEmployeeAttendance listEmployees markEmployeeAttendance provisionEmployee setEmployeeStatus updateEmployee upsertQuestionBankItem`

**Pre-check:** Cloud Run console → each service → Metrics → request count, last 30 days must be 0. Any traffic = an old client build still in use → wait a week and re-check.
**Command (one line):**
`firebase functions:delete autoGenerateTimetable backfillEmployeeDirectory deleteQuestionBankItem duplicateAssessmentTest exportEmployeeAttendanceCsv exportEmployeesCsv listEmployeeAttendance listEmployees listAuditLogs markEmployeeAttendance provisionEmployee setEmployeeStatus updateEmployee upsertQuestionBankItem --region asia-south1 --project vriddhi-engineering`
**Rollback:** the source exists in git history (`git log -S exportEmployeesCsv --oneline`) — redeploy from there. Benefit: no deletion prompt on every deploy, faster deploys.

### 2.4 Superadmin polling → cheaper reads
**Where:** `src/modules/superadmin/hooks/useSuperAdmin.ts` — `useDashboardStats` (2 min), `useRenewalAlerts` (10 min), `useSystemHealth` (60 s), `useHealthHistory` / `useSlowQueries` / `usePerformanceMetrics` (2 min), `useErrorLogs` (60 s). `getDashboardStats` in `src/modules/superadmin/api/superAdminApi.ts` scans whole collections (`colleges`, `users`, per-college `students/faculty/admins`).
**Plan:**
1. Client-only: dashboard 10 min, health 5 min, logs 5 min; keep manual "Refresh" buttons (note: `refetchOnWindowFocus: false` is already the global default in `src/main.tsx`). Replace collection scans that only need counts with `getCountFromServer`. Same return shapes.
2. Server: scheduled function `refreshPlatformStats` (every 15 min, `asia-south1`, 256 MiB) writes `platform/stats` using Admin-SDK `count()` aggregations; `getDashboardStats` reads that doc and **falls back to the current computation if the doc is missing or older than 1 h**. Rules: `platform/{doc}` superadmin read only, no client writes (+ rules test).
**Verify:** dashboard numbers identical before/after (screenshot compare); Firestore reads/day drop; render-check for `SuperAdminDashboard` stays green.

## 3. Phase 2 — weeks 2–3 (data paths + visible content)

### 3.1 Student attendance summary doc (~₹28 K/yr and it stops scaling)
**Why:** `fetchAttendance` (`src/modules/student/api/studentDataApi.ts:235`) reads up to **500 raw `attendanceRecords`** (`where collegeId == && studentId ==, orderBy date desc, limit 500`) and `useStudentData.ts:234` calls it on every dashboard mount.
**Writers of `attendanceRecords` (mostly client-side):** `src/modules/faculty/api/facultyApi.ts`, `src/modules/admin/api/attendanceApi.ts`, `src/modules/admin/api/examManagementApi.ts`, plus `functions/src/studentJourney.ts` and `functions/src/collegeCleanup.ts`. Because writers are spread out, maintain the summary with a **Firestore trigger**, not in the writers.
**Plan:**
1. New doc `attendanceSummaries/{studentId}`: `{ collegeId, total, present, absent, late, leave, onDuty, medicalLeave, bySubject, byMonth, recent: last 20, updatedAt, version }`.
2. `functions/src/attendanceSummary.ts`: `onDocumentWritten('attendanceRecords/{id}')` (v2, `asia-south1`, 256 MiB) applying **incremental deltas in a transaction** (create +new; update −old +new; delete −old). Pure `applyAttendanceDelta(summary, before, after)` unit-tested (all status values, subject/month buckets). Unknown statuses count in `total` only. See review §2 A7/A8 for the exactly-once and hot-document clauses.
3. Backfill: superadmin-only callable `backfillAttendanceSummaries({ collegeId })`, idempotent, batched 400 writes, resumable via a cursor doc.
4. Self-heal: when a client reads a summary whose `total` disagrees with a `getCountFromServer` on the raw query, call `recomputeMyAttendanceSummary` (or flag it). Plus a scheduled nightly reconcile.
5. Client: `fetchAttendanceSummary(studentId)`; **if the doc is missing → fall back to today's raw query**. Dashboard uses the summary; `AttendancePage.tsx` keeps raw records but paginates (`limit(60)` + "Load more").
6. Rules: owner + college staff read; Admin-SDK-only writes; rules test.
7. `useStudentData.ts`: add React Query caching (`staleTime` 2 min).
**Verify:** compare summary vs AttendancePage for 3 students in 2 colleges; Firestore reads the next day; trigger error rate 0.
**Rollback:** the client falls back automatically while the collection is empty; the trigger can be deleted without data loss.

### 3.2 Admin dashboard: `count()` / `sum()` instead of `limit(500)` scans
**Where:** `src/modules/admin/api/dashboardApi.ts` — `MAX_READS = 500` (L10); scans at L134 (active students), L160 (attendance since cutoff), L177 (assessments), L187 (scores).
**Plan:** `getCountFromServer` for counts, `getAggregateFromServer({ average, sum })` for attendance % and score averages; keep `limit(20)` only where a list is rendered. Return shapes unchanged (pin them with a test or a render-check stub). ~2,000 → ~10 reads per load.

### 3.3 "Most repeated questions" (zero AI)
**Data:** `functions/src/data/prepPapers/*.ts` (50 papers, 846 questions), served by `functions/src/prepPapers.ts` + `routes/prep.ts` `GET/POST /papers`; UI `src/modules/prep/PrepPapersViews.tsx`; Prep Studio tab `src/modules/admin/components/PrepContentStudioTab.tsx`.
**Plan:** `functions/src/prepFrequentQuestions.ts` — normalise text (lowercase, strip numbering/punctuation), group near-duplicates within a subject (Jaccard ≥ 0.6), output per subject `{ question, marks, years[], papers[], count }` sorted by count; unit-test grouping on 3 hand-made cases; endpoint `GET /api/prep/papers/frequent?subject=` (public, `Cache-Control: public, max-age=3600`); a "Most repeated" tab in `PrepPapersViews.tsx` with year badges + a render-check section. **Kannada needs its own normaliser** (see review §5.4 item 8).

### 3.4 Model answers for the 846 questions (one-time ≈ ₹30)
Superadmin-only `POST /api/prep/papers/answers/generate` (batch ≤ 25 per call, `aiGenerationLimiter`, tier **fast**, prompt includes subject, marks, question, "indicative answer for a Karnataka undergraduate exam, headings + bullet points, length by marks"); store `prep_paper_answers/{paperId}_{qid}` as `draft`; Prep Studio review list with Publish/Reject (reuse the draft/publish pattern in `PrepContentStudioTab.tsx` + `routes/prep.ts` `/content/publish`); the paper view shows published answers labelled "Model answer · AI-generated, reviewed". Rules: public read only where `status == 'published'`; Admin-SDK writes. Tests: prompt builder + answer sanitiser. Cost ≈ 846 × (≈400 in + ≈600 out tokens).

### 3.5 Quick-revision MCQ sets from papers (after 3.4)
5 MCQs per topic from questions + published answers (tier fast, batch, drafted → reviewed → published), served through the existing prep mock UI (`PrepPublicViewer.tsx` company mocks show the pattern). Same rules/tests pattern as 3.4.

## 4. Phase 3 — structural

### 4.1 AI content engine with a shared cache
`functions/src/ai/contentEngine.ts`: `generate({ kind, key, promptVersion, tier, prompt, schema })` → cache doc `aiContentCache/{sha256(kind|key|model|promptVersion)}`; hit returns the stored output, miss calls Gemini, stores it, records `hits/misses` in `platform/stats`. Wrap call sites one at a time, highest volume first: study material, then prep drafts, then question generation with `(university, syllabus unit, type, difficulty)` as the key. Keep the rate limiters. Cache entries are per university/syllabus, never per student data. **Review §6 moves this to step 6 — it is the mitigation for the 3.x price change.**

### 4.2 Placement Pack extensions
Behind `colleges/{id}/config/resumeBuilder` flags: store `completeness` + rule-based `atsScore` on `resumes/{uid}`; `POST /resume/cover-letter` and `/resume/linkedin-about` (tier fast, counted against `aiCallsPerStudent`); `POST /resume/interview-questions` (resume + JD → 15 questions, cached by JD hash for 24 h); placement-cell dashboard `GET /resume/admin/placement-stats` + CSV export; aptitude practice sets tagged `aptitude`; mock-interview slots reusing `src/api/facultyAppointmentApi.ts`. Unit tests for prompt builders/sanitisers, render-check sections, `docs/RESUME_BUILDER.md` update.

### 4.3 One PDF stack (server text PDFs only)
Inventory client PDF code: `html2canvas` (1 import), `jspdf` (2 imports) — `src/shared/utils/pdfDownloader.ts` (raster fallback) plus the `pdfGenerator`, `financePdf`, `labelsPdf`, `reportPdf`, `payrollDocs` chunks. Migrate each document to a server route using `functions/src/utils/pdfRenderer.ts` (the resume pipeline is the template), **keep the client path as fallback until parity is verified per document**, then remove `html2canvas`/`jspdf`. Check whether the 593 kB `pdf` chunk is `pdfjs-dist` for viewing materials — if so it stays (viewing ≠ generating).

### 4.4 Split `pdf` from `api`
`api` runs at 2 GiB only because PDF routes launch Chrome. Create `export const pdf = onRequest({ memory: '2GiB', timeoutSeconds: 120 })` mounting only render routes; `api` back to 512 MiB. Keep the routes mounted in **both** functions for one release; `src/shared/api/apiBase.ts` routes `/pdf/*` to the new base; remove from `api` afterwards.

### 4.5 Small consolidations
* `PWAInstallPage.tsx` exists 3× (admin/faculty/student) → one shared page with a role prop; render-check covers the 3 routes.
* Do **not** big-bang regroup the 93 callables — names are client contracts. Rule going forward: new server features are Express routes on `api`, not new callables.
* Fee functions in `us-central1`: only move if latency is a real complaint (deploy same names in `asia-south1` → switch the client's `getFunctions(app, region)` → update the Razorpay webhook URL → verify a ₹1 test payment → delete the `us-central1` versions).

## 5. Per-PR checklist

- [ ] Old path still works as fallback (or N/A — explain)
- [ ] functions `tsc` + `test:unit` green; root `tsc` + `test:unit` + `test:render` green; `vite build` OK; `test:rules` if rules changed
- [ ] New tests added **and** listed in the explicit test lists
- [ ] New collections: rules + rules test; new queries: composite index in `firestore.indexes.json`
- [ ] Deploy order written in the PR (indexes → rules → functions → hosting) and rollback noted
- [ ] Post-deploy smoke steps written for the operator (which screen, what to click, what to expect)
- [ ] Docs updated (`README.md` section or `docs/*.md`)

## 6. Targets to track (5,000 students, ₹96/USD)

| Line | Today (sheet) | After Phase 1–2 |
|---|---|---|
| AI / LLM | ₹1,16,020 | ₹40–50 K **while 2.5 Flash-Lite lasts**; ₹86 K on the 3.x replacement — see review §4 |
| Firestore reads | ₹36,853 | ~₹6–8 K (3.1 + 2.4 + 3.2) |
| Hosting egress | ₹3,936 | ~₹1 K (2.2) |
| Functions | ₹0 (free tier) | ₹0 |
| **Cloud + AI total** | **≈ ₹1.7 L** | **≈ ₹0.7 L** (per student ₹34 → ~₹14) |

Update `docs/Vriddhi_Costing_Sheet.xlsx` ("Resume Add-on" and base sheets) via `scripts/build-costing-sheet.py` when assumptions change; after 2.4 ships, set the `saR` input from 81,000 to 8,000 so the "after" column is honest.
