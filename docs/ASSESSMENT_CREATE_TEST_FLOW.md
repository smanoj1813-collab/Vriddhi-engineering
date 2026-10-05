# Create Test — staff-side assessment flow (cost-engineered plan)

**Status:** decisions locked 2026-10-05 · ready to build Phase 1 on your word
**Scope:** the *staff* half of the assessment portal — Create Test → sections →
add questions (custom / library, MCQ + coding) → publish.
The *student* half (section-lock player, palette, autosave, resume, coding
workspace, per-attempt cost budgets) is already specified in
`docs/ASSESSMENT_PORTAL_REDESIGN.md`; this document **un-parks the authoring
half** and does not repeat it. Citations below read REDESIGN §x.

Companion context: `docs/PORTAL_ROLE_CLEANUP_HANDOFF.md` (role rounds),
`docs/DEPLOY_ONE_VRIDDHI.md` + `docs/QUOTA_COMPATIBLE_DEPLOYMENT_PLAN.md`
(deploy/quota rules), `docs/COSTING_AND_PRICING_ANALYSIS_2026-09-25.md`.

---

## 0. Decisions on record (2026-10-05)

| # | Decision |
|---|---|
| D1 | **No HOD approval step.** A test goes from draft to scheduled without a review gate. (Paper Review stays out of the HOD portal.) |
| D2 | **Who may create AND schedule a test:** `faculty`, `hod`, `admin` (= department head) and `employee` (Vriddhi internal staff). Nobody else; principal keeps the read-only oversight lane. |
| D3 | **Proctoring is ON HOLD** — built only when a college asks and pays. Wizard is therefore **2 steps**, and the data model keeps a `proctoring` slot that stays absent until then. No camera/voice/streaming work is scheduled. |
| D4 | The reference flow (your current company's tool) is the **baseline, not the target**: Vriddhi matches its usability and beats it on reuse, speed-to-create and reporting — **without taking on its cost structure**. |

Still open: coding **execution** route (§7) — authoring is unaffected and costs nothing.

---

## 1. The governing rule: minimum marginal cost

Every element below is chosen so that **creating and running tests adds no
fixed cost to Vriddhi** — no new Cloud Run service (20,000 milliCPU cap), no
new top-level collection, no new composite index, no media pipeline, no
per-seat vendor.

Where the reference platform spends money, Vriddhi's answer:

| Reference platform spends on | Vriddhi's cheap equivalent | Marginal cost |
|---|---|---|
| A separate test/paper service + its own store | **Reuse `papers/{id}` with `sections[]`** (already client-writable by college staff under the current rules) | ₹0 — no backend, no migration |
| Per-answer writes during the attempt | Debounced flush already engineered (REDESIGN §10.2): ~12–18 writes/attempt | ~₹0.002/attempt |
| Serving all questions up front | Frozen chunk delivery per section (already live) | 3 reads/attempt |
| A content team authoring question pools | **Bank-first authoring**: library picker + "save every custom question to the bank" + bulk paste/CSV import (`questionFileParser.ts`, `parseCSV.ts` already exist) | ₹0 |
| AI generating every question | AI only on **measured shortfall**, capped per test, and every generated question is banked for reuse | the only variable cost — bounded by policy |
| Video proctoring / SFU / per-candidate minutes | **On hold (D3)**; when sold: on-device signals + snapshots, never a media server | ₹0 today |
| Code execution grid | Authoring-only until the Judge0 decision (§7) | ₹0 today |
| New dashboards | Existing reports, grading queue, analytics, journey | ₹0 |

**Dev cost is a cost too.** Phase 1–2 compose existing components
(`UniversalQuestionBank` picker, `QuestionManager` form, `TestScheduler`,
`paperReadiness`) instead of new ones; nothing is rewritten that already works.

---

## 1b. Running cost, numbered

Firestore, asia-south1 (verify against the live pricing page):
≈ **₹3 per 100,000 document reads**, ≈ **₹9 per 100,000 writes**.

| Event | Reads | Writes | Cost |
|---|---:|---:|---|
| Author one 3-section, 60-question test (library picks + a few custom) | ~60 | ~45 | **< ₹0.01** |
| Clone that test for the next section | ~2 | ~2 | ~₹0 |
| One student attempt (REDESIGN §10.4) | ~9 | ~22–30 | ~₹0.003 |
| **A 1,000-student drive on that test** | ~9,000 | ~26,000 | **≈ ₹2.6** |
| Snapshot-free proctoring signals (T1, already built) | 0 | 2–4/attempt | ~₹0.0003 |
| Cloud Run | — | — | **₹0 delta** (no new service; authoring is client-direct) |

The only line that can grow is AI generation, so it is the only line with a
policy: **bank first, AI on shortfall, capped, always banked afterwards**.

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

Who sees "Create Test" (D2): `faculty`, `hod`, `admin`, `employee`,
`superadmin`. Not `principal` (oversight only), not office roles.

```
Sidebar (faculty + HOD + employee)
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

### Step 3 — Proctoring — **ON HOLD (D3)**

Not built now. The wizard is **Step 1 of 2 / Step 2 of 2**; no greyed tab, no
upsell inside the flow. What is preserved so the hold costs nothing later:

- the `proctoring` block stays **absent** from the saved test (§6) — an
  absent block means "unproctored", which is exactly today's behaviour;
- the integrity floor that already ships stays ON for every test, proctored
  or not: clipboard / bulk-insert / long-press blocking (`examLockdown.ts`),
  tab-switch counting, fullscreen and focus events, idle detection. This is
  the free tier, already written, and it is what most internal tests need;
- when a college asks and pays, it arrives as a module toggle
  (`colleges/{id}/config/modules.proctoring`, the Assignments pattern) plus a
  third wizard step, in three priced tiers — **T1 behavioural (free, built)**,
  **T2 on-device camera evidence** (TF.js in the student's browser, snapshots
  to Storage, no GPU, no new service), **T3 live monitoring / voice / ID**
  (needs a vendor and a per-candidate-minute price). T3 is the only one that
  changes Vriddhi's cost structure, and it is sold before it is built.

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
  // "proctoring": { … }        // ON HOLD (D3) — field intentionally ABSENT.
  // Absent = unproctored = today's behaviour. The free integrity floor
  // (clipboard lock, tab/focus counting) applies to every test regardless.
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

// colleges/{id}/config/modules — unchanged today. A `proctoring` entry is
// added only when a college buys it (D3); its absence is the default.
{ "assignments": { "enabled": true } }
```

`scheduledTests` is unchanged: the schedule step keeps going through the
existing callable, and the delivery block (shuffle, tab cap, report
visibility) is copied — frozen — onto the scheduled test, so editing the
template later can never change a live exam. No new collection, no new
composite index, no migration: existing papers keep working, and a paper
without the new fields simply reads as a one-section test.

---

## 7. The one open decision: coding execution

Authoring coding questions (statement, constraints, I/O, examples, test
cases, marks per case, preview — exactly your spec) costs **₹0** and ships in
Phase 2. *Running* student code is the decision:

| Route | What it buys | Cost to Vriddhi | Verdict |
|---|---|---|---|
| **a. Authoring-first (recommended now)** | Coding sections exist; students write code in the workspace; grading is manual against visible cases, or the section is used as "write the logic" | ₹0, no deploy, no quota touch | **Default until a college needs auto-verdicts** |
| b. Re-enable Judge0 (`runStudentCode`) behind a paid toggle | Real verdicts | 1 function redeploy inside the quota batch + per-run compute; needs the pending deletion decision resolved first | Only when sold |
| c. Self-hosted runner (Cloud Run job, gVisor) | Verdicts at scale, no vendor | New service = quota + fixed cost | Not now |

Nothing in the data model changes between a → b: `mode: 'code'` simply starts
being executed. Zero re-authoring, which is the point.

## 8. Build phases (cheapest value first)

| Phase | Scope | Backend? | Deploy | Marginal cost |
|---|---|---|---|---|
| **1. Create Test wizard + My Tests** | 2-step wizard (details → sections), extended section model, confirmation screen with the section table, readiness gate (`isPaperOnlineReady`), **duplicate test**, draft/ready lifecycle, role gate per D2; pure utils (test-code normalisation, section/test totals, readiness) + node tests | none — `papers`/`questions` are client-writable | **hosting only** | ₹0 |
| **2. Question doors** | Custom MCQ editor with the live preview pane, library picker in "add to section" mode with filters + bulk select, **random pick by filter** ("add 10 medium DBMS MCQs"), pool-health meter, **bulk paste / CSV import**, coding question authoring + preview | none | **hosting only** | ₹0 |
| **3. Schedule integration** | `TestScheduler` step 1 reads the new template; delivery settings (shuffle, tab cap, report visibility) freeze onto `scheduledTests`; student instructions screen reads the section plan | `scheduleAssessmentTest` payload grows | `api` + 1 function, quota batch ≤ 5 | ~₹0 |
| **4. Reporting polish** | Section-wise and question-wise analytics on the existing reports page; "weak topic → practice" link into prep/Coding Lab | none | hosting only | ₹0 |
| **5. Proctoring** | ON HOLD (D3) — T1 already live; T2/T3 only on a paying college's ask | — | — | priced then |
| **6. Coding execution** | Only after §7 | yes | separate decision | priced then |

### Enhancements over the baseline tool, and what each costs

| Enhancement | Why it beats the reference flow | Cost |
|---|---|---|
| **Clone test / clone section** | IAT-2 is IAT-1 with new questions; the reference tool makes you retype everything | ₹0 (2 writes) |
| **Random pick by filter** | 60-question paper in ~2 minutes instead of 60 manual picks | ₹0 (1 query) |
| **Every custom question auto-banked** (tagged subject/topic/difficulty) | The pool grows as a by-product of teaching; test #2 is half the work | ₹0 |
| **Bulk paste / CSV import** | A Word question list becomes a section in one paste — the free alternative to AI | ₹0 (parsers exist) |
| **Pool-health meter** | Shows "only 6 hard questions match" *before* publishing; prevents the one genuinely expensive failure (a broken exam) | ₹0 |
| **Readiness gate** | A test with an empty section cannot be scheduled | ₹0 |
| **Running summary bar** (`3 sections · 60 Q · 120 marks · 90 min`) | Mistakes caught at authoring, not on exam morning | ₹0 |
| **AI top-up on shortfall only**, capped, always banked | Uses the existing `/api/ai-questions`; spend is bounded and amortised | the only variable line |
| **Section-wise + question-wise analytics** on existing reports | The reference tool stops at a score | ₹0 |
| **Free integrity floor on every test** | Clipboard/bulk-insert/tab counting already enforced — unproctored ≠ open book | ₹0 |

## 9. Remaining questions (small)

1. **Test code** — college-wide unique, or unique per subject/semester?
   (Default I will implement: college-wide unique, auto-suggested.)
2. **Negative marking default** for internal tests — `0`, or `1/4` of the
   correct mark? (Default: `0`, with the `1/4` chip one click away.)
3. **Candidate report default** — on for practice/mock, off for internal
   tests until results are finalised? (Default: that split.)
4. Can one test span branches (shared first-year papers), or is one test
   always one cohort? (Default: multi-cohort allowed — the picker supports it.)
5. Coding execution route (§7) — authoring proceeds regardless.
6. Does AI-generated paper output land straight in Create Test as a
   pre-filled template? (Default: yes; "Generated Papers" does not return.)

None of these block Phase 1 — each has a sane default that is one field to
change later.
