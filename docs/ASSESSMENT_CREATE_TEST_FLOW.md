# Create Test — staff-side assessment flow (design review)

**Status:** proposal for sign-off · 2026-10-05 · branch `arena/01a10cfa-vriddhi-engineering`
**Scope:** the *staff* half of the assessment portal — Create Test → sections →
add questions (custom / library, MCQ + coding) → proctoring → publish.
The *student* half (section-lock player, palette, autosave, resume, proctor
ladder, coding workspace, cost budgets) is already specified in
`docs/ASSESSMENT_PORTAL_REDESIGN.md`; this document **un-parks the authoring
half of it** and does not repeat it. Where the student end matters, it is
cited as REDESIGN §x.

Companion context: `docs/PORTAL_ROLE_CLEANUP_HANDOFF.md` (role rounds),
`docs/DEPLOY_ONE_VRIDDHI.md` + `docs/QUOTA_COMPATIBLE_DEPLOYMENT_PLAN.md`
(deploy/quota rules).

---

## 1. TL;DR — the recommendation in six lines

1. **Do not introduce a parallel "test" object.** The repo already stores
   sectioned papers (`papers/{id}` with `sections[]`) and schedules them
   (`scheduledTests`, callable-only). Create Test = *authoring a sectioned
   paper*; Schedule = the existing flow. One object, two verbs.
2. **Wizard = 2 steps, +1 when the college bought proctoring** (not a fixed
   "Step 3 of 3"): Test details → Sections → (Proctoring).
3. **Section count: add-only after creation**, never "locked forever" — the
   stated lock is a support ticket waiting to happen.
4. **Question editor and library picker already exist** (QuestionManager,
   UniversalQuestionBank with multi-select) — they get a section-aware
   "Add to Section N" mode and the live preview pane from your screenshot.
5. **Coding questions can be authored now, but cannot be auto-graded until
   the Judge0 decision is made** — `runStudentCode` is on the do-not-deploy
   list. Authoring-first is safe and costs nothing; execution is a separate,
   explicit decision (§7).
6. **Phase 1 is hosting-only** (`papers`/`questions` are client-writable under
   the current rules). Functions are touched only in Phase 3+, in line with
   the 20,000 milliCPU quota plan.

---

## 2. What already exists (so we extend, not rebuild)

| Capability | Where | State |
|---|---|---|
| Sectioned paper model (`sections[]`, marks, duration, status) | `src/types/assessment.ts` → `AssessmentPaper`, `PaperSection` | solid; missing per-section duration/type/default marks |
| Paper CRUD, client-direct | `src/modules/admin/api/paperApi.ts`; rules `match /papers` | staff create/update allowed → no backend needed for authoring |
| Question bank + authoring form | `QuestionManager.tsx`, `QuestionSubmissionForm.tsx`, `questionBankApi.ts`, rules `match /questions` | solid |
| Library picker with multi-select & filters | `UniversalQuestionBank.tsx` (college + universal + review tabs) | already has "N selected / Create Paper from selection" |
| AI question drafting | `AIQuestionsPage`, `/api/ai-questions` | live, stays |
| 4-step scheduler (paper → window → cohort → publish) | `src/modules/faculty/components/TestScheduler.tsx` | live; `scheduleAssessmentTest` callable is the single write door |
| Schedule-time readiness validation | `shared/utils/paperReadiness.ts` (`isPaperOnlineReady`) | reuse as the "can this test be published" gate |
| Delivery / attempt / autosave / submit / auto-submit | `functions/src/studentAssessments.ts` | live |
| Integrity primitives (clipboard, long-press, bulk-insert, shortcuts) | `shared/utils/examLockdown.ts` | live for **every** test, proctored or not |
| Tab-switch cap, shuffle Q/options/sections, late submission, result-publish date | `ScheduleTestInput` / TestScheduler state | live — your Step 1 toggles map 1:1 |
| Reports + manual grading queue | `AssessmentTestReports.tsx`, `AssessmentGradingQueue.tsx` | live |
| College feature toggles | `functions/src/collegeModules.ts` + `colleges/{id}/config/modules` | the pattern for the paid proctoring switch |
| Coding execution | `functions/src/codeRunner.ts` (`runStudentCode`, Judge0) | **excluded from deploys, decision pending** |

**Not present today:** per-section duration/instructions/negative marking,
a coding question type, a "test code", candidate-facing report toggle,
camera/voice/object proctoring, and a single place where a faculty member
says "create a test" and walks out with something schedulable.

---

## 3. Information architecture

```
Sidebar (faculty + HOD)
└── Assessments
    ├── Create Test          ← NEW wizard  (/faculty/create-test, /admin/create-test)
    ├── My Tests             ← list of test templates (draft / ready / scheduled / completed)
    ├── Assessment Schedule  ← existing hub: schedule, my tests, manual grading
    ├── Question Bank · Universal Bank · AI Question Generator
    └── Reports
```

Lifecycle of one test object:

```
draft ──(every section has ≥1 question)──► ready ──(schedule)──► scheduled
   ▲                                                               │
   └──────────────── edit (allowed until first attempt) ───────────┘
                                                      live ──► completed ──► archived
```

Rule worth stating in the UI: **a test is editable until its first attempt
exists**; after that only the schedule window and result settings may change.

---

## 4. The wizard, page by page (your spec + recommended changes)

### Step 1 — Test details

| Your field | Keep / change | Note |
|---|---|---|
| Name of the Test | keep | required, 3–120 chars |
| Test Code | keep, **auto-suggest** | `CSE-DBMS-IAT1-2026`; unique per college, uppercase/trim normalised (pure util + test) |
| Number of sections | keep, **add-only later** | reducing is blocked, adding is allowed; wizard still asks up front so Step 2 can page `1/N` |
| Test Visibility (College) | keep, reword | "blank = visible to all institutions" only makes sense for platform/superadmin tests. For a college user show: *This college* (default) / *Platform library* (superadmin only) |
| Batch Visibility | **replace with the cohort picker** | TestScheduler already resolves program / branch / batch / semester / section from `students`; reuse it instead of a free-text batch |
| Test Description / Instructions | keep | instructions render on the student instructions screen (REDESIGN §2.3) |
| Number of tab switches allowed | keep | maps to `maxTabSwitches`; add the ladder (warn → warn → auto-submit) from REDESIGN §2.7 |
| Jumble Questions Yes/No | keep, **split in three** | shuffle questions / shuffle options / shuffle sections already exist as separate flags |
| Show performance report to candidates Yes/No | keep, **add "when"** | immediately / after the window closes / on a date (`resultPublishDate` exists). Add sub-toggles: score · answers · explanations · stats |
| — | **add: Test type** | Internal (IAT) · Practice · Mock drive · Diagnostic — drives defaults and reporting |
| — | **add: Total duration** | either the sum of section durations (default) or an explicit cap |

### Step 2 — Sections (`Enter Section k`, `k/N`)

Keep: name, type (MCQ / Coding), duration, instructions, default correct
marks, default penalty.

Recommended changes:

1. **Marks presets are presets, not a closed list.** `1 2 5 10` and
   `0.5 1 2 5 10` become quick-chips plus a free numeric field (0–100,
   0.25 steps). Many engineering IATs use 3 or 1.5.
2. **Penalty must allow 0 and be expressible as a fraction** of the correct
   mark (`1/4` is the common Karnataka pattern) — store the resolved number,
   show both.
3. **Add per-section: question count target** (for the pool-health check) and
   **"section lock on submit"** (default on for mock drives, off for IATs).
4. **Add per-section calculator / language allow-list** for coding sections.
5. Show a **running summary bar**: `3 sections · 60 questions · 120 marks ·
   90 min` — the single biggest usability win on this screen.
6. Section type union: `mcq | msq | numerical | descriptive | coding`
   (descriptive = manual grading queue, which already exists).

### Step 3 — Proctoring (only when the college has the add-on)

Gate exactly like the Assignments module: a registry entry in
`functions/src/collegeModules.ts` (`proctoring`) stored at
`colleges/{id}/config/modules`, set when the college is created/billed, read
client-side by `useCollegeModules()`. If the college does not have it, the
wizard is 2 steps and the stepper says "Step 2 of 2" — no dead tab, no
"upgrade" nag inside the flow.

Within the page, the master toggle plus **three tiers** instead of a flat list
of nine switches (cost and credibility differ by an order of magnitude):

| Tier | Signals | How it runs | Marginal cost |
|---|---|---|---|
| **T1 Behavioural** (default, free) | Screen focus lost (SFL), tab switches, fullscreen exit, permission revoke (PR), copy/paste/bulk-insert, idle | Already implemented browser-side (`examLockdown`, tab counter); events batch into the attempt doc | ≈ 0 (2–4 writes/attempt) |
| **T2 Camera evidence** (paid) | Face not present (FNP), multiple faces (MFD), face mismatch (FM), object detected (OD) | **On-device** detection (TF.js BlazeFace / COCO-SSD) in the student's browser; only *events* and the occasional JPEG snapshot are uploaded to Storage | Storage + egress only; no GPU, no new Cloud Run service |
| **T3 Live monitoring** (paid, drives only) | Live video/screen streaming to a proctor console, voice detection (VD), ID authentication | Needs a media pipeline (WebRTC SFU or a vendor) — **not** Firebase-shaped | Real money: per-candidate-minute; must be priced before it is promised |

Recommendations for the controls you listed:

- Keep FM / FNP / MFD / PR / OD / SFL / VD as **per-test switches**, but grey
  out the tier the college has not bought, with the price shown — honest and
  it sells itself.
- **Default to Image Snapshots** (your "Streaming Type") at a 20–30 s
  interval. Live video for 1,000 candidates is a bandwidth bill, not a
  feature. Make the interval a numeric field (10–120 s) as you specified.
- **Enable Face Verification / ID Authentication** need a registered photo
  for every student; only offer them when the college has student photos on
  file (we can detect that) — otherwise every attempt flags FM on day one.
- Every signal is **evidence for a human**, never an automatic zero
  (REDESIGN §2.7) — the review queue pattern already exists.
- Storage retention: snapshots auto-delete after N days (default 30,
  college-configurable); say so on this page for DPDP hygiene.

### Confirmation screen

Your "Congratulations… add questions in each section" table is right. Add:

- a **readiness chip per section** (`0 questions — not schedulable`),
- **totals vs plan** (`12/20 questions · 24/40 marks`),
- a primary **Schedule test** button that stays disabled until every section
  is non-empty (reuses `isPaperOnlineReady`), and a secondary **Save as
  draft**,
- **Duplicate test** (clone for the next section/semester) — the single most
  requested action in every assessment tool.

---

## 5. Add questions — the two doors

### 5.1 Custom question (MCQ)

Your layout is right; the enhancements that matter:

- **Rich text with the toolbar from your screenshot** (bold/italic/lists/
  image/superscript/subscript/code/LaTeX) for question, options and
  explanation; live **Preview** pane exactly as shown (preview is the
  student's renderer, not a lookalike — one component, two call sites).
- **Options: 2–6**, not fixed 4; single- or multi-correct (MSQ) with the
  correct answers checked in-place; numerical (NAT) with a tolerance field.
- Per-question **custom correct marks / penalty** (your spec) — stored as
  overrides on the paper question, falling back to the section defaults.
- **Explanation** (shown in the performance report) — keep.
- Add: **topic / subject / Bloom level / difficulty** (they already exist on
  the question bank schema and power analytics and AI top-up).
- Add: **"Also save to Question Bank"** checkbox (default on) so custom
  questions stop being single-use.
- Add: **image upload to Storage** with a size cap; never base64 into
  Firestore (attempt docs must stay < 100 KB — REDESIGN §10.6).

### 5.2 Choose from library

Reuse `UniversalQuestionBank` in a "picker" mode:

- Filters: subject/topic, type, difficulty, company tag (`IBM`, `Amazon`,
  `CoCubes`…), source (college / universal), "not already in this test".
- Keep your header (`Total Questions: 20,346 · N Selected · Deselect all`),
  keep the inline correct-answer badge and the company/topic/difficulty chips
  from your sample — that layout is good.
- **Add to Section ▾** action (the picker must know which section it is
  filling), plus a **random pick** by filter (`add 10 medium Cloud Computing
  MCQs`) — the fastest path to a 60-question paper.
- Show **pool health** while filtering ("only 6 hard questions match") so a
  blueprint shortfall is visible before the test is published.

### 5.3 Coding question

Your authoring form (statement, constraints, I/O format, examples, N test
cases with visible/hidden, marks per correct test case, explanation) is the
right model, and the preview in your screenshot is exactly how it should
render. Changes:

- **Test cases: add/remove freely** (your mock shows a fixed 0–4); require
  ≥ 1 visible (sample) and ≥ 1 hidden.
- Keep **marks per test case** but also allow "all-or-nothing" — universities
  differ; store `scoring: 'per_case' | 'all_or_nothing'`.
- Add: **allowed languages**, **time/memory limits**, **starter code** and a
  **reference solution** (used to validate the test cases at authoring time —
  catches the classic trailing-whitespace mismatch).
- Store large inputs in Storage, not the question doc, past ~8 KB.
- Normalise outputs on compare (trim trailing spaces/newlines) and say so on
  the authoring screen, otherwise every student fails case 3.

---

## 6. Data model (additive, no new top-level collections in Phase 1–2)

```jsonc
// papers/{paperId}  — the "test template" (client-writable by college staff)
{
  "title": "DBMS IAT-1", "testCode": "CSE-DBMS-IAT1-2026",
  "type": "internal",            // internal | practice | mock_drive | diagnostic
  "status": "draft",             // draft | ready | archived
  "subject": "DBMS", "program": "B.E.", "branch": "CSE", "semester": 5,
  "visibility": { "scope": "college", "cohorts": [{ "branch": "CSE", "batch": "2023", "section": "A" }] },
  "description": "…", "instructions": "…",
  "durationMinutes": 90, "totalMarks": 40, "totalQuestions": 30,
  "delivery": {
    "shuffleQuestions": true, "shuffleOptions": true, "shuffleSections": false,
    "maxTabSwitches": 3,
    "candidateReport": { "enabled": true, "when": "after_window",
                         "show": ["score", "answers", "explanations", "stats"] }
  },
  "sections": [{
    "id": "s1", "order": 1, "name": "MCQ", "type": "mcq",
    "durationMinutes": 30, "instructions": "…",
    "defaultCorrectMarks": 2, "defaultPenalty": 0.5,
    "lockOnSubmit": true, "plannedQuestions": 20,
    "questions": [{ "questionId": "q_123", "order": 1, "marks": 2, "negativeMarks": 0.5 }]
  }],
  "proctoring": {               // present only when the college has the add-on
    "enabled": true, "tier": "camera",
    "signals": { "sfl": true, "pr": true, "fnp": true, "mfd": true, "fm": false, "od": false, "vd": false },
    "stream": { "mode": "camera", "type": "snapshots", "intervalSeconds": 30 },
    "faceVerification": false, "idAuthentication": false,
    "retentionDays": 30
  }
}

// questions/{id} — unchanged for MCQ; coding adds:
{
  "type": "coding",
  "statement": "…", "constraints": "…", "inputFormat": "…", "outputFormat": "…",
  "examples": [{ "input": "6 6\n5 2\n…", "output": "4 5 0 2 3 1", "explanation": "…" }],
  "testCases": [{ "input": "…", "output": "…", "visible": true }],
  "scoring": "per_case", "marksPerCase": 2,
  "languages": ["python", "cpp", "java"], "timeLimitMs": 2000, "memoryLimitMb": 256,
  "starterCode": { "python": "…" }, "referenceSolution": { "python": "…" }
}

// colleges/{id}/config/modules  — paid add-on switch (existing pattern)
{ "assignments": { "enabled": true }, "proctoring": { "enabled": true, "tier": "camera" } }
```

`scheduledTests` is unchanged: the schedule step keeps going through the
existing callable, and the proctoring block is copied (frozen) onto the
scheduled test so later template edits cannot change a live exam.

---

## 7. The two decisions only you can make

1. **Coding execution.** Authoring and preview cost nothing and can ship in
   Phase 2. Grading a coding section requires running code, and
   `runStudentCode` (Judge0) is excluded from deploys with its deletion
   decision pending. Options:
   a. **Authoring-first (recommended):** ship coding questions as content;
      sections carry them, students see the workspace with "run" disabled, and
      grading is manual against visible cases. No deploy, no cost.
   b. **Re-enable Judge0** behind the proctoring-style paid toggle, with
      per-attempt run caps (REDESIGN §2.8: 25 graded runs/problem) and a
      quota-capped redeploy of exactly one function.
   c. **Self-hosted runner** (Cloud Run job, gVisor) — the real long-term
      answer for a placement-prep product, and the most expensive to build.
2. **Proctoring tiers and price.** T1 is free and already half-built; T2 is
   a few weeks and a storage line item; T3 needs a vendor and a per-minute
   price. I need the commercial decision (what the college is sold at
   college-creation time) before the toggle registry is written, because that
   is what the toggle *means*.

---

## 8. Build phases

| Phase | Scope | Backend? | Deploy |
|---|---|---|---|
| **1. Create Test wizard + My Tests** | Steps 1–2, section model extension, confirmation screen, section table, readiness gate, duplicate test; pure utils (test-code normalisation, marks/section totals, readiness) + node tests | none — `papers`/`questions` are client-writable | hosting only |
| **2. Question doors** | Custom MCQ editor with live preview, library picker in "add to section" mode, random pick by filter, pool health, coding authoring + preview | none (Storage rules for images already exist) | hosting only |
| **3. Schedule integration** | TestScheduler step 1 reads the new template; freeze proctoring + delivery settings onto `scheduledTests`; student instructions screen reads section plan | `scheduleAssessmentTest` payload grows | `api` + 1 function, quota batch ≤ 5 |
| **4. Proctoring T1 → T2** | Module registry entry + wizard Step 3, event ladder in the player, on-device camera signals, snapshot upload + review queue | functions + Storage rules | staged, per quota plan |
| **5. Coding execution** | Only after decision §7.1 | yes | separate decision |

Phases 1–2 — the whole of what you specified as authoring — ship **without
touching `functions/`**, which keeps this round inside the same
hosting-only deploy posture as the principal and HOD rounds.

---

## 9. Open questions

1. Who may create a test: faculty for their own subjects only, HOD for the
   department, both? Is there an approval step before scheduling (HOD's Paper
   Review was removed this round — if tests need review, it comes back as a
   tab inside Assessments, not as a separate page).
2. Test code: college-wide unique, or per subject/semester?
3. Negative marking default for internal tests — 0, or 1/4 of correct?
4. Should "Show performance report" default to on for practice tests and off
   for internal tests?
5. Does a test ever span branches (shared first-year papers), or is one test
   always one cohort?
6. Proctoring commercials (§7.2) and snapshot retention period.
7. Coding execution route (§7.1).
8. Does "Generated Papers" (removed from the faculty sidebar this round) come
   back as "My Tests", or do AI-generated papers land straight in the Create
   Test flow as a pre-filled template? My assumption: the latter.
