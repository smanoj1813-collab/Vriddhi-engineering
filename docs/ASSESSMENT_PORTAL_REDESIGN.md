# Assessment Portal — Design v3: Desktop-First, Cost-Engineered, Skills-Based

Status: **PARKED — future reference only (decision 2026-10-05).**
Vriddhi keeps its **current assessment flow**; the PrepInsta-style rebuild
specified below is not the active direction. The active design direction is
the unified platform: see `ONE_VRIDDHI_UNIFIED_STUDENT_EXPERIENCE.md`.
Retained so the thinking (cost budgets, section-lock player spec, proctor
ladder) stays available if an advanced assessment mode is ever green-lit as
an opt-in college add-on.
Date: 2026-10-05 · Project: `vriddhi-engineering` · Region: `asia-south1`

> Reference source: PrepInsta assessment platform student-end workflow
> (login/OTP → My Tests → instructions → section countdown → palette →
> autosave → section lock → proctoring → coding with run caps).
> Vriddhi takes that interaction contract, rebuilds it **desktop-only**,
> adds the skills/readiness layer, and engineers Firestore reads/writes and
> Cloud Run quota explicitly.

---

## 1. Design principles

| # | Principle | Consequence |
|---|---|---|
| P1 | **Skills, not papers** | Questions tag to skills; results decompose into skills; no PYQ/paper module for tech colleges. |
| P2 | **Reuse the engine** | Freeze/schedule/autosave/proctor/submit machinery exists — extend, don't duplicate. |
| P3 | **Desktop-only test player** | No mobile fallback. Laptop/system only: richer layout, keyboard shortcuts, hard device gate. Admin/faculty dashboards stay responsive. |
| P4 | **Every result loops into practice** | Weak skill → one-tap practice (prep / Coding Lab / materials). |
| P5 | **Read/write & cost are first-class requirements** | Every interaction has a Firestore budget (§10); debounced writes, lazy section reads, client-direct delivery. |
| P6 | **Quota-neutral** | New endpoints ride the deployed shared `api` function; no new Cloud Run services (20,000 milliCPU cap). |
| P7 | **Both tracks coexist** | `assessmentMode: skills | university` per college; university paper flow untouched. |
| P8 | **College-configurable, never hardcoded** | Companies from `prep_companies`, skills from college graph, limits from test config. |

---

## 2. Student journey (target spec — PrepInsta parity + Vriddhi extensions)

```
Login ──► My Tests dashboard ──► Instructions + environment check
      ──► Section countdown ──► Attempt (palette, timers, autosave)
      ──► Submit Section (locks) ──► …next section…
      ──► Final review ──► Submit Test ──► Result + skill radar + next actions
```

### 2.1 Login (three modes, college/test-configurable)

| Mode | Who | How | Cost |
|---|---|---|---|
| **Vriddhi account** | enrolled students | existing student auth (email + password, custom claims) — SSO into the portal | ₹0 |
| **Email OTP** | external/walk-in candidates (drives) | enter registered email → 6-digit OTP (5-min TTL, resend capped 3×/15 min) → Continue | 1 email/OTP (~₹0.01) + 2 writes |
| **Exam passcode** | mass drives, lab sessions | test-level passcode issued by college (printed/shared) + registered email match | ₹0 messaging |

OTP session doc: `assessmentOtp/{hash}` with TTL index (auto-expiry — no cleanup job,
no extra reads). Rate limits server-side on the shared `api` function.

### 2.2 My Tests dashboard

- Cards: test name, type badge (Mock Drive / Skill Check / Diagnostic / Gate),
  scheduled window ("Today 10:00–11:30 IST"), section summary, status
  (Upcoming / Live / Completed / Missed).
- **Start Test** enabled only inside the window (server-verified, not just UI).
- Completed tests show score chip + "View result".
- 1 query read (`scheduledTests` by college + cohort + window) — no per-test reads.

### 2.3 Instructions + environment gate (desktop-only enforced here)

Before questions, the student sees:

- Section structure table — e.g. `Coding Challenge — 3 Q / 60 min`,
  `CS Fundamentals — 20 Q / 20 min`, `Aptitude — 10 Q / 10 min`.
- Rules: no refresh/close, no external help, no tab switching, stable internet,
  repeated tab switches may auto-submit.
- Negative marking & per-section lock notice if configured.
- **Environment check (blocking):**
  - viewport ≥ 1024 px and desktop UA → else hard stop: *"This assessment
    requires a laptop or desktop. Mobile is not supported."*
  - browser Chrome/Edge latest ± 1 (others warn, don't block),
  - battery ≥ 20% or plugged in (Battery API where available),
  - network probe (small HEAD request) — poor connection gets a warning,
  - fullscreen consent for proctored tests,
  - webcam check for camera-proctored tests (future phase).

### 2.4 Section countdown

- 5-second (configurable) countdown before each section activates — also
  spreads the Firestore read spike when 1,000 students start together.
- On activate: sectional timer starts; questions stream in (lazy, §10).

### 2.5 Test player — desktop 3-pane layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Test title · Section tabs [Coding|CS Fund|Aptitude] · ⏱ Section 24:12 ·  │
│ ⏱ Total 1:12:40 · candidate chip · help (F1)                            │
├──────────────┬──────────────────────────────────────────┬────────────────┤
│ PALETTE      │ QUESTION CANVAS                          │ SUMMARY        │
│ ┌─┬─┬─┬─┬─┐  │ Q.4 / 20                        [🚩]     │ Answered  12   │
│ │1│2│3│4│5│  │ Statement, passage/code/figure render    │ Unanswered 6   │
│ ├─┼─┼─┼─┼─┤  │                                          │ Marked     2   │
│ │…│ │ │ │ │  │  (A) option        (B) option            │ ── legend ──   │
│ └─┴─┴─┴─┴─┘  │  (C) option        (D) option            │ ▢ grey: not    │
│ Grey=not     │                                          │ ▣ green: done  │
│  answered    │  ◀ Prev   Clear   Mark for review   Next ▶│ ▨ rose: marked │
│ Green=done   │  Jump to question: [ 7 ]                 │ [Submit Section]│
│ Rose=marked  │                                          │ [End Test…]    │
└──────────────┴──────────────────────────────────────────┴────────────────┘
```

Interaction contract (parity with the reference workflow, desktop-enhanced):

- **Auto-save on selection** — answer persists without a Save button;
  debounce batches writes server-side (§10.2).
- **Palette click = jump**; keyboard: `←/→` navigate, `A–D`/`1–4` select,
  `M` mark, `C` clear, `Enter` next, `F1` help.
- **Clear** returns the question to grey (unanswered).
- **Mark for review** (rose) — review queue listed in the Summary pane.
- Answers modifiable until **section submit**; submitted sections lock and
  their palette greys out with a 🔒.
- Timer warnings at 5 min / 1 min (banner + palette pulse), never a silent kill:
  expiry → auto-submit with an on-screen "auto-submitted" report.

### 2.6 Section & final submission

- **Submit Section** opens a recap modal: answered / unanswered / marked
  counts per section → confirm → locked forever (server records
  `sectionState[i].submittedAt`).
- After the last section: **Final review** modal (all sections, counts,
  flagged list) → **Submit Test** → confirmation with test id → result page
  as soon as grading lands (choice sections instant; written answers show
  "grading in progress").
- Submission is **idempotent** (attempt doc id `{testId}_{studentId}` — an
  existing engine guarantee): double-clicks, retries, and reconnects can never
  create duplicate attempts.

### 2.7 Proctoring — rule ladder, not instant punishment

Events are logged to the existing `proctoringLogs` pipeline; the *response*
is a per-test configured ladder:

| Event | Default response (configurable per test) |
|---|---|
| Tab/window switch | 1st–2nd: warning banner + log · 3rd: final warning · ≥ `maxTabSwitches` (default 5): **auto-submit + disqualification flag for staff review** |
| Fullscreen exit (proctored tests) | same ladder as tab switch |
| Idle > 3 min | "Are you still there?" prompt; no activity 10 min → log |
| Copy/paste attempt | log only (never blocks — false positives punish honest students) |
| Network drop | grace mode: local buffer keeps answers; reconnect resumes; grace window (default 10 min) beyond → auto-submit saved state |
| Refresh/close mid-test | re-entry restores server-side attempt state (answers, palette, timer) — **never** a fresh start |

Staff side: flags land in a review queue (existing grading-queue pattern);
a human confirms disqualification — the system never silently zeroes a student.

### 2.8 Coding assessments (desktop split-pane workspace)

```
┌─ PROBLEM (left, scrollable) ────────┬─ EDITOR (right) ───────────────────┐
│ Title · difficulty · skill tags     │ Language: [C++▾ Java▾ Python▾ …]   │
│ Statement, constraints, I/O format  │ monospace editor, tab-indent,      │
│ Sample input/output (2–3)           │ autosave like every other answer   │
│                                     ├────────────────────────────────────┤
│                                     │ TEST AREA                          │
│                                     │ Custom input [        ] [▶ Dry run]│
│                                     │  → stdout/stderr, time, memory     │
│                                     │ Graded runs: 18/25 left [Run cases]│
│                                     │  → verdict per visible case        │
│                                     │ [Submit problem]                   │
└─────────────────────────────────────┴────────────────────────────────────┘
```

- **Language selection per problem** from the college's allowed set.
- **Dry runs (custom input): unlimited** — rate-limited to 1 concurrent +
  3 s cooldown to stop abuse; results show stdout/stderr only.
- **Graded runs: 25 per problem (configurable 10–50)** against hidden test
  cases; counter visible; at 0 the runner locks (code still editable &
  submittable) — the cap is per-problem, exhaustion never auto-submits the
  *whole* test unless the test config says so.
- Execution: while Judge0 stays excluded, coding problems run as
  trace-the-output / predict / pseudocode MCQs **or** the college's own lab
  runner integration; `mode: 'code'` activates real execution once a runner
  is approved — zero schema change, zero re-authoring.

### 2.9 Recommended environment (shown on instructions screen)

Chrome/Edge latest · stable internet · no refresh · no tab switching ·
laptop/desktop only · power connected for tests > 45 min.

---

## 3. Where Vriddhi goes beyond the reference platform

| Area | Reference flow | Vriddhi addition |
|---|---|---|
| Results | score per test | **skill radar + mastery bands** per attempt; trend across attempts |
| Meaning of scores | percentage | **company readiness** vs college-set cut-offs (patterns from `prep_companies`) |
| After a weak result | nothing | **one-tap practice plan**: prep topic / Coding Lab drill / materials |
| Test creation | manual paper building | **blueprints over skills** + company-pattern import + AI top-up with pool-shortfall warnings |
| Crash recovery | typically lost session | **server-authoritative resume** — refresh/re-login restores exact state |
| Question quality | static pool | discrimination flags (all-right/all-wrong items auto-routed to review) |
| Integrity | auto-disqualification | **review queue** — flags are evidence, a human decides |
| Cohort insight | per-student only | **heat-map** (branch × skill) + placement shortlists |

---

## 4. Product model (unchanged from v2 — summary)

- `skillGraphs/{collegeId}`: domains → skills (L1–L4) → practice links.
- Assessment types: Diagnostic · Skill Check · Mock Drive · Aptitude Sprint ·
  Readiness Gate (each with length/proctoring defaults).
- `assessmentBlueprints/{collegeId}`: sections over skills × difficulty mix;
  composition at schedule time draws from college pool → universal pool →
  AI top-up, then **freezes** (existing `questionChunks`).
- Mock Drive builder imports `prep_companies/{code}` sections (topicIds,
  counts, minutes, eliminator rounds already modelled there).

---

## 5. Engine changes needed (additive only)

| Change | Where | Why |
|---|---|---|
| `sectionState[]` on attempt docs (locked/active/submitted + timestamps) | `studentAssessments.ts` | section-lock semantics (reference parity) |
| Per-section lazy delivery of frozen chunks | same | cost + security (§10.3) |
| Debounced answer-flush endpoint | same | write budget (§10.2) |
| Proctor ladder config on `scheduledTests` (`maxTabSwitches`, `autoSubmitOnBreach`, `fullscreenRequired`) | schedule flow | per-test integrity policy |
| OTP + passcode auth routes on shared `api` | `routes/` | drive-mode login |
| Coding runner abstraction (`mode: 'code'` stub → runner adapter) | new module, runner stays pluggable | future Judge0/college-lab integration |

No change to university-mode behaviour; all additions gated by
`sourceKind: 'skills'` or explicit config.

---

## 6. Mastery, readiness & reports (formulas from v2, kept)

- Mastery per student×skill: recency-weighted mean over last 8 attempts
  (half-life 30 d, difficulty weights L1 0.7 → L4 1.6); bands
  <40 Needs Training · 40–69 Developing · 70–84 Job-Ready · ≥85 Strong.
- `readiness(company) = Σ sectionWeight × projectedSectionScore` vs
  college-entered cut-offs (green/amber/red).
- Surfaces: student result + My Readiness · class skill report (faculty) ·
  cohort heat-map (HOD) · company readiness board + CSV (placement cell).
- Dashboards read one `skillMastery/{collegeId}/{studentId}` doc each —
  single-read surfaces (§10).

---

## 7. Staff-side flows (summary)

- **Assessment Studio**: blueprint builder (blank / company-pattern import /
  clone), pool-health panel with exact shortfall per skill + AI top-up,
  cohort picker, schedule window, proctor config, negative marking.
- **Review queues**: AI-generated questions → approve; proctor flags →
  decide; flagged items → revise/archive.
- **Readiness dashboard** (HOD/placement): heat-map, per-company boards,
  exports via existing CSV machinery.

---

## 8. Configuration

`assessmentConfigs/{collegeId}` gains:

```jsonc
{
  "assessmentMode": "skills",            // university keeps paper flow
  "enabledAssessmentTypes": ["diagnostic", "skill_check", "mock_drive"],
  "targetCompanies": ["tcs-nqt", "infosys"],
  "loginMode": "account",                // account | otp | passcode (per test override)
  "codingRunCapDefault": 25,
  "devicePolicy": "desktop"              // only supported value today
}
```

Toggles reuse the existing `colleges/{id}/config` mechanism — no parallel system.

---

## 9. Architecture & reuse map

| Need | Reuse | New |
|---|---|---|
| Delivery/freeze/autosave/proctor/submit | `studentAssessments.ts`, `questionChunks`, `proctoringLogs`, auto-submit scheduler | section-lock state machine |
| Scheduling & cohorts | `scheduleAssessmentTest` flow | blueprint draw step |
| Company patterns | `prep_companies` + Prep Content Studio | import action |
| AI questions | `/api/ai-questions` + review queue | pool top-up step |
| Notifications | `notifications.ts` | result-ready template |
| Auth | existing student auth | OTP/passcode routes **on shared `api`** |
| New endpoints | — | `/api/assessment-auth/*`, `/api/skills*`, `/api/skill-questions*`, `/api/blueprints*`, `/api/readiness/*` — **all on the deployed `api` function: 0 new Cloud Run services (P6)** |

---

## 10. Read/write & cost engineering (first-class requirement)

### 10.1 Pricing posture

- Firestore in **asia-south1 (regional)** ≈ ₹0.003/10k reads, ₹0.009/10k writes
  (≈ $0.036/$0.108 per 100k — verify against current pricing page).
- Cloud Run quota is the hard wall (20,000 milliCPU): delivery must not add
  services; compute per request is already paid for by the deployed `api`
  function (512 MiB × 10, min 0 → ₹0 when idle).
- Strategy: **reads client-direct from Firestore where rules allow;
  writes through the smallest possible number of server operations.**

### 10.2 Write budget — debounced answer flush

Naive autosave = 1 write per interaction (a 60-Q test ≈ 100+ writes).
Instead:

- Client buffers answers; flush triggers: every **5 changed answers** or
  **10 s** since last flush, whichever first; plus hard flushes on
  section submit / final submit / tab hide / beforeunload / 30 s heartbeat.
- One flush = **one** attempt-doc update (answers map merged server-side).

Result: ~100 interactions → **~12–18 writes per attempt**.

### 10.3 Read budget — lazy sections, chunked snapshots

- Instructions: 1 read (test doc). Dashboard: 1 query.
- Questions: frozen chunks of 25 (existing cap) fetched **per section at
  activation** — a 60-Q test ≈ 3 chunk reads, and later sections are never
  on the wire early (also an anti-leak win).
- Result: attempt doc + mastery snapshot = 2 reads.

### 10.4 Per-attempt budget (60-Q, 3-section test)

| Step | Reads | Writes |
|---|---:|---:|
| Login (OTP mode) | 1 | 2 |
| Dashboard + instructions | 2 | 0 |
| Start (attempt create) | 1 | 1 |
| Section chunks (lazy, ×3) | 3 | 0 |
| Answers (debounced) | 0 | 12–18 |
| Proctor events (batched) | 0 | 2–4 |
| Section submits (×3) | 0 | 3 |
| Final submit + grading | 0 | 2 |
| Result view | 2 | 0 |
| **Total per attempt** | **≈ 9** | **≈ 22–30** |

### 10.5 Drive-scale cost (1,000 students × one 60-Q mock drive)

- ≈ 9k reads + ≈ 26k writes ≈ **₹3–4 Firestore** for the whole drive.
- Storage: ~100 KB/attempt → 100 MB ≈ ₹1/month (TTL policies clean expired
  OTP docs and draft sessions automatically).
- Cloud Run: ~3 requests/attempt on the *existing* `api` service → well
  inside the free request tier; **no quota delta**.
- Naive per-answer-write design would be 100k+ writes (~₹11–12/drive and 4×
  write latency during peaks) — the debounce is a requirement, not a nicety.

### 10.6 Scale protections

- Section countdown jitter + lazy chunks flatten the start spike.
- Proctor batches capped (existing MAX_STORED_PROCTOR_EVENTS=500).
- Attempt docs stay < 100 KB (answer maps, not blobs); files (coding
  artifacts, if any) go to Storage, never Firestore.
- Composite indexes for cohort queries ship in `firestore.indexes.json`
  before launch (existing repo convention).

---

## 11. Data model (additions over v2)

```
scheduledTests +     { sectionPlan: [{ name, skillIds, count, minutes, mode,
                                       negativeMarking? }],
                       proctor: { tier, maxTabSwitches, autoSubmitOnBreach,
                                  fullscreenRequired, camera? },
                       loginMode, passcodeHash? }
studentAssessments + { sectionState: [{ status, activatedAt, submittedAt }],
                       activeSection, flushSeq,
                       skillScores, companyCode? }
assessmentOtp/{hash} { emailHash, codeHash, testId, expiresAt (TTL), tries }
skillGraphs / skillQuestions / assessmentBlueprints / skillMastery  (as v2)
```

---

## 12. Rollout & acceptance

| Phase | Scope | Acceptance |
|---|---|---|
| 0 (done) | Assignments toggle, config docs, quota pilot | toggles live; 1248/710 tests green |
| 1 — Core player parity | section-lock player, palette/keyboard, debounced autosave, resume, environment gate, instructions/countdown | pilot college runs a 3-section Skill Check; refresh-mid-test resumes with 0 lost answers; measured writes/attempt ≤ budget |
| 2 — Skills & drives | graph + questions, blueprints + company import, mastery/radar, readiness board, heat-map | placement cell shortlist matches hand-computed list |
| 3 — Proctor hardening + coding | ladder config UI, review queue, `mode: 'code'` with approved runner | parity verdicts vs manual judge on 50-sample set |

Success metrics: 0 lost submissions; refresh-resume 100%; instructions→first
question < 2 s on lab desktops; writes/attempt within §10.4; quota delta = 0
services; ≥ 90% diagnostic completion in pilot.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| 1,000-student start spike | countdown jitter + lazy per-section chunks + client-direct reads |
| Debounce loses last answers on crash | flush on `visibilitychange`/`beforeunload` + 30 s heartbeat; worst case = last ≤10 s |
| Lab machines with old browsers | environment gate warns early; supported matrix published on instructions screen |
| Proctor false positives | ladder + human review queue; copy/paste log-only |
| Thin question pools | pool-health alerts pre-schedule; AI top-up through review; universal pool backstop |
| OTP email cost/spam | resend caps, TTL sessions, passcode mode for mass drives |
| Quota creep | hard rule: skills endpoints live on `api` router (documented + enforced in review) |

---

## 14. Open questions

1. Default `assessmentMode` for newly onboarded tech colleges — `skills`?
2. First pilot college + day-one assessment types.
3. OTP email provider (transactional email service vs Firebase email-link
   auth) — drives the per-OTP cost; passcode mode can be the default until decided.
4. Proctor defaults: `maxTabSwitches=5`, auto-submit on breach — confirm.
5. Coding graded-run cap: 25/problem default (range 10–50) — confirm.
6. Company readiness cut-offs: college-only entry or platform seed defaults?
7. Hide mastery radar until first diagnostic baseline?
8. Sprint streak gamification: college toggle, default off — agree?
