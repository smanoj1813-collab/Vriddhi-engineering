# Assessment Portal — Design: How To Do It Well

Status: **Design specification (refinement round, approved direction)**
Date: 2026-10-05 · Project: `vriddhi-engineering` · Region: `asia-south1`
Supersedes: none — this expands the earlier redesign note into a build-ready spec.

---

## 1. Purpose

Technical colleges assess **employability skills**, not syllabus recall:
DSA, aptitude (quant / verbal / logical), language proficiency (Java, Python,
SQL, JS…), and company-specific patterns (TCS NQT, Infosys, Cognizant…).
There is **no question-paper module** in their world — no previous-year papers,
no blueprints over university subjects.

A well-done assessment portal therefore answers one question for every stakeholder:

> **"Is this student — and this batch — ready for the next gate, and what
> exactly closes the gap?"**

### Design principles (what "well" means here)

| # | Principle | Consequence |
|---|---|---|
| P1 | **Skills, not papers** | Every question is tagged to a skill; every result decomposes into skills. "Paper" disappears from the skills-mode vocabulary. |
| P2 | **Reuse the engine, replace the composition** | Scheduling, freezing, autosave, proctoring, submission lifecycle stay (they are battle-tested); only what creates a test changes. |
| P3 | **Every result loops into practice** | A report without a next action is a dead end. Each weak skill links to prep / Coding Lab / materials. |
| P4 | **Phone-first** | Most students will take tests on budget Android phones over patchy networks; the player must survive tab switches, low bandwidth, and small screens. |
| P5 | **College-configurable, never hardcoded** | Companies come from `prep_companies`, skills from the college graph; no college/branch names in code. |
| P6 | **Quota-neutral** | New endpoints ride the shared `api` Express function; no new Cloud Run services. |
| P7 | **Both tracks coexist** | University-mode colleges keep today's paper flow untouched (`assessmentMode` selects the track). |

---

## 2. Personas and the outcomes they need

| Persona | Outcome | Primary surfaces |
|---|---|---|
| Student | Know where I stand, what to practice, prove readiness before drives | Assessment hub, test player, My Readiness |
| Faculty / trainer | Run skill checks after my unit; see who didn't absorb it | Assessment Studio, class skill report |
| HOD / Admin | Batch health before placement season; schedule diagnostics & gates | Readiness dashboard, Assessment Studio |
| Placement cell | Per-company readiness lists; shortlist for drives | Company readiness board, exports |
| Superadmin | Curate company patterns & question pools; onboard colleges | Prep Content Studio (existing), pool tools |

---

## 3. Product model

### 3.1 Skill graph (per college, platform-seeded)

```
skillGraphs/{collegeId}
  domains[]            "Programming", "Aptitude", "Core CS", "Communication"
    skills[]           id, name, domainId, difficultyLadder L1–L4,
                       practiceLinks { prepTopicIds[], codingLabTopic?, materialTags[] },
                       courseCodes[]        ← optional mapping to curriculum courses
```

Seeding: the platform ships a starter graph (aptitude topics reuse the existing
`qa-*` / `lr-*` / `va-*` catalogue the prep module already maps company
sections to; programming skills start with DSA fundamentals). Colleges edit,
never from hardcoded lists.

### 3.2 Assessment types

| Type | Length | Frequency | Proctoring tier |
|---|---|---|---|
| **Diagnostic** | 40–60 Q, ~75 min | intake / semester start | light |
| **Skill Check** | 10–30 Q, 15–35 min | after training units | light |
| **Mock Drive** | company-pattern, 60–90 min | monthly / pre-drive | full |
| **Aptitude Sprint** | 10–20 Q, ≤ 20 min | self-paced practice | none |
| **Readiness Gate** | mixed, 60–90 min | once per drive season | full |

### 3.3 Blueprints (the new "paper")

```jsonc
// assessmentBlueprints/{collegeId}/{id}
{
  "title": "TCS NQT Mock — CSE Sem 6",
  "type": "mock_drive",
  "companyCode": "tcs-nqt",              // → prep_companies/{code}
  "sections": [
    { "name": "Numerical Ability", "skillIds": ["quant.percentages", "quant.ratio-time"],
      "count": 20, "minutes": 25, "difficulty": { "L1": 0.3, "L2": 0.5, "L3": 0.2 } },
    { "name": "Coding", "skillIds": ["dsa.arrays", "dsa.strings"],
      "count": 2, "minutes": 40, "mode": "code" }
  ],
  "targetCohort": { "branch": "CSE", "batch": "2027", "semester": 6 },
  "negativeMarking": { "enabled": false },
  "status": "draft | approved | scheduled"
}
```

**Composition rule:** a blueprint is never a fixed question list. At schedule
time the engine draws questions from pools in priority order —
college-authored → platform universal pool → AI-generated top-up — matching
section counts × difficulty mix, then **freezes** them via the existing
`questionChunks` snapshot mechanism so live-pool edits never touch a running test.

**Shortfall handling:** if a section's pool is thin, scheduling does not fail
silently — it reports the exact skills short and offers one-click AI top-up
(existing `/api/ai-questions` route), or lets staff lower the count.

### 3.4 Company patterns are already half-built

`prep_companies/{code}` stores sections with `topicIds` into the aptitude
catalogue, question counts, per-section minutes, rounds (with eliminator
flags), and eligibility. **Mock Drive builder = import a company pattern →
sections pre-filled → college tweaks.** No new company modelling needed.

---

## 4. End-to-end flows (screen level)

### 4.1 Admin/HOD schedules a Mock Drive

```
Assessment Studio → New assessment → "Mock Drive"
  → pick company (from prep_companies) → sections auto-filled
  → adjust counts/minutes/difficulty → cohort picker (branch/batch/sem/division)
  → Pool check panel: "Numerical OK (412 candidates) · Coding SHORT by 3
     questions for dsa.strings [Generate with AI] [Reduce count]"
  → Approve & schedule → date window + auto-submit time
```

### 4.2 Faculty runs a Skill Check

```
Assessment Studio → "Skill Check" → pick 1–3 skills (graph picker with search)
  → count + duration suggested by difficulty → preview 5 sample questions
  → assign to class → publish (notification fans out via the existing
     announcement pipeline)
```

### 4.3 Student takes a test

Reuses today's player (`TestInstructionsPage → ActiveTestPage →
TestResultPage`) with skills-mode additions:

1. **Instructions screen** gains section map ("Numerical 20 Q · 25 min"),
   negative marking notice, device-check (battery %, network probe).
2. **Player**: section tabs with per-section timers when the pattern uses
   them (company mocks), else one shared timer; palette (answered / skipped /
   marked-for-review); autosave on every answer (existing autosave index);
   reconnect banner instead of data loss on network drops.
3. **Coding questions** launch as *trace-the-output / pseudocode / predict-
   the-behaviour* MCQs while Judge0 stays excluded; when a code runner is
   approved later, the same section gains `mode: 'code'` with test-case
   scoring — no schema break, no re-authoring.
4. **Result screen** leads with the skill radar and "what to do next",
   percentage + band label second.

### 4.4 Placement cell shortlists for a drive

```
Readiness dashboard → pick company → sort by readiness score
  → filter: ≥ cut-off in all sections · no active backlogs (journey data)
  → export CSV (same export machinery as test reports)
```

---

## 5. Test-taking quality bar (where portals usually fail)

| Concern | How it's done well |
|---|---|
| **Network drops** | Autosave already lands every answer server-side; on reconnect the player reloads the attempt doc, not local state. Submit retries idempotently (`{testId}_{studentId}` doc id already guarantees this). |
| **Tab-switch / app switch** | Existing proctor event log records switches; light-tier tests *count* them, full-tier flags after threshold. No auto-fail without staff review. |
| **Phone ergonomics** | One question per screen on small viewports; ≥ 44px tap targets; palette collapsible; no hover-only interactions. |
| **Fairness** | Same frozen snapshot for everyone in a cohort; shuffled question order + option order per student; window long enough for the slow device (window = duration + 30 min grace). |
| **Accessibility** | Readable font sizes, high-contrast palette states, keyboard navigation on desktop, math/notation rendered by the existing renderer. |
| **Integrity without cruelty** | Proctoring tiers per type (§3.2): practice sprints never proctor; gates proctor fully. Flags surface in the report queue — a human decides. |
| **Timezone & windows** | All times IST server-side; student sees their local rendering; auto-submit scheduler (existing) catches expired attempts. |

---

## 6. Content pipeline (questions)

```
sources:   college-authored → review queue → approved
           platform universal pool (universalQuestions, prepTags)
           AI generation (/api/ai-questions) → human review → approved
           company-pattern seeds (superadmin, Prep Content Studio)

every question carries: skillId, difficulty L1–L4, type, language,
                        usedCount, lastUsedAt, qualityFlags[]
```

- **Anti-repetition**: selection discounts `usedAt` recency per cohort (a
  student should not see the same question twice in one semester; engine
  already tracks `recentlyUsedQuestionIds` in paper context — generalize it).
- **Pool health dashboard** (admin): coverage per skill vs. demand from
  scheduled blueprints; thin-skill alerts before scheduling, not during.
- **AI top-up is drafted, never auto-published**: goes through the same
  review queue faculty already use for AI-generated questions.
- **Quality loop**: questions with abnormal discrimination (everyone right /
  everyone wrong) get flagged for review after each test.

---

## 7. Scoring, mastery, readiness — with a worked example

### 7.1 Attempt scoring (unchanged mechanics)

Choice/numeric types auto-grade; written answers grade manually (existing
grading queue) or via AI suggestion (existing `suggestAssessmentGrading`,
human confirms). New: each graded answer also credits its `skillId`.

### 7.2 Skill mastery (per student × skill)

```
mastery = Σ(wᵢ × scoreᵢ) / Σ(wᵢ)   over last 8 attempts
wᵢ = difficultyWeight(L) × 0.5^(ageDays/30)
difficultyWeight: L1 0.7 · L2 1.0 · L3 1.3 · L4 1.6
```

Bands (fixed platform scale, so cross-college comparisons hold):
`<40 Needs Training · 40–69 Developing · 70–84 Job-Ready · ≥85 Strong`.
The college-editable performance categories still label report bands —
mastery bands are a separate, stable ruler.

### 7.3 Company readiness

```
readiness(company) = Σ_section sectionWeight × projectedScore(section)
projectedScore = recency-weighted mean mastery of the section's mapped skills
```

Status vs. the college-entered cut-off per section:
`green ≥ cut-off · amber within 10 pts · red below`.

### 7.4 Worked example

> Anitha, CSE sem 6. Mock Drive (tcs-nqt): Numerical 14/20, Verbal 16/20,
> Reasoning 9/15, Coding section 1/2.
> → Skill deltas update: `quant.percentages` 0.62→0.71, `logical.puzzle`
> 0.48→0.46 (harder set), `dsa.arrays` 0.55→0.58.
> → Readiness(tcs-nqt): Numerical 74 (cut 60 ✅), Verbal 81 (cut 60 ✅),
> Reasoning 52 (cut 55 🟠), Coding 49 (cut 50 🟠).
> → Her result screen: "2 sections from green. Practice: Puzzles sprint
> (prep), Arrays drill set 3 (Coding Lab)." One tap adds both to her plan.

---

## 8. Reports and dashboards

| Surface | Audience | Shows |
|---|---|---|
| **Student result** | student | skill radar, section scores, band, next-practice actions, attempt history sparkline |
| **My Readiness** | student | per-target-company status chips, mastery trend, upcoming gates |
| **Class skill report** | faculty | after a Skill Check: per-student × per-skill matrix, who to reteach |
| **Cohort heat-map** | HOD/admin | branch × skill colour grid; drill to students; compare diagnostics vs now |
| **Company readiness board** | placement cell | students × selected companies, filters, CSV export, drive shortlist |
| **Attempt report** | admin | existing test report (participation, flags, proctor events) — unchanged |

All read from `skillMastery/{collegeId}/{studentId}` (recomputed post-submit),
so dashboards are single-document reads — cheap at classroom scale.

---

## 9. Engagement loop

- Existing notification pipeline announces publications; results push a
  "your result is ready — 2 actions" notification.
- **Practice plan**: weak-skill links accumulate into a student plan
  (prep topics / Coding Lab sets / materials) — visible on My Readiness.
- Optional streaks for Aptitude Sprints (college toggle; off by default —
  gamification is a college culture decision).

---

## 10. Architecture — reuse map

| Need | Reuse existing | New |
|---|---|---|
| Delivery / freezing / autosave / proctoring | `studentAssessments.ts` engine, `questionChunks`, `proctoringLogs`, auto-submit scheduler | `sourceKind: 'skills'` on `scheduledTests` |
| Scheduling UI/logic | `scheduleAssessmentTest` flow, cohort targeting | blueprint → question draw step |
| Company patterns | `prep_companies/{code}` + Prep Content Studio | import-into-blueprint action |
| AI questions | `/api/ai-questions` route + review queue | draft-into-pool step |
| Announcements/notifications | `notifications.ts` fan-out | result-ready template |
| Exports | report CSV machinery | readiness CSV |
| Settings | `assessmentConfigs/{collegeId}` | `+ assessmentMode`, `+ enabledAssessmentTypes`, `+ targetCompanies` |
| **New endpoints** | — | all on shared `api` router: `/api/skills*`, `/api/skill-questions*`, `/api/blueprints*`, `/api/readiness/*` — **zero new Cloud Run services** (P6) |

---

## 11. Data model (field spec)

```
skillGraphs/{collegeId}            { domains[], skills[], updatedAt, updatedBy }
skillQuestions/{collegeId}/{id}    { text, type, options?, answer, skillId,
                                     difficulty 1–4, tags[], language,
                                     status: draft|approved|archived,
                                     createdBy, usedCount, lastUsedAt, qualityFlags[] }
assessmentBlueprints/{collegeId}/{id}   §3.3
scheduledTests (existing) +        { sourceKind: 'paper'|'skills', blueprintId?,
                                     companyCode?, skillCoverage: {skillId: count} }
studentAssessments (existing) +    { skillScores: { [skillId]: {correct,total,avgDifficulty} },
                                     companyCode? }
skillMastery/{collegeId}/{studentId}  { bySkill: { [skillId]: {mastery,attempts,lastAt} },
                                     readiness: { [companyCode]: {score, sections[]} },
                                     plan: { items[] }, updatedAt }
assessmentConfigs/{collegeId} +    { assessmentMode: 'university'|'skills',
                                     enabledAssessmentTypes[], targetCompanies[] }
```

Firestore rules: mirror the existing `assessmentConfigs` / paper scoping —
students read their own mastery doc; staff read their college; writes only
through Functions.

---

## 12. Configuration & toggles

- `assessmentMode` selects the studio + report set a college sees;
  paper-centric pages hide in skills mode exactly like the Assignments toggle
  hides today's assignment flow (same `colleges/{id}/config` mechanism — no
  parallel system).
- `enabledAssessmentTypes`: a college may ship only Diagnostics + Skill Checks
  in month one and switch Mock Drives on before drive season.
- Fees/Admission remain on hold and are untouched; this portal adds no
  dependency on them.

---

## 13. Rollout plan with acceptance criteria

| Phase | Scope | Acceptance criteria |
|---|---|---|
| **0 (done)** | Assignments toggle; config docs extended; quota pilot | toggles live, 1248/710 tests green |
| **1 — Skills foundation** | graph CRUD, skill questions (manual + AI review), Diagnostic & Skill Check, skillScores on results, student radar | a pilot college runs a diagnostic end-to-end on phones; radar matches manual math (pinned unit tests) |
| **2 — Drives** | company pattern import, Mock Drive + Sprint, mastery + readiness v1, heat-map & readiness board, CSV exports | placement cell produces a drive shortlist matching a hand-computed list |
| **3 — Coding sections** | `mode: 'code'` when a runner is approved (Judge0 excluded until then); bridge MCQs until | parity scoring vs manual judge on 50-sample set |

Each phase ships behind `assessmentMode`; university colleges see zero change.

---

## 14. How we'll know it's done well (metrics)

- **Reliability**: 0 lost submissions (attempt docs reconcile 100%); autosave
  gap < 1 answer after forced refresh.
- **Performance**: instructions → first question < 3 s on a mid-range phone on 4G;
  dashboards single-read (p95 < 500 ms server time).
- **Validity**: item review flags < 5% of pool after 2 months; no student sees
  a repeated question inside a semester.
- **Adoption**: ≥ 90% of targeted students complete the first diagnostic;
  placement cell exports its first real shortlist from the board.
- **Quota**: zero new Cloud Run services across all phases.

---

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Thin question pools at pilot college | Pool-health alerts before scheduling; AI top-up through review; platform universal pool as backstop |
| Mastery noise from few attempts | Bands only surface after ≥ 2 attempts per skill; radar shows "needs data" state |
| College expectations ≠ company patterns | Patterns carry `patternVerifiedOn` + sources; college sees verification date |
| Quota pressure if anyone adds callables | Hard rule in review: skills endpoints live on `api` router (documented here + in code) |
| Proctoring over-flagging on cheap devices | Tiered proctoring; flags are review-queue items, never auto-fails |

---

## 16. Open questions (need answers before Phase 1)

1. Default `assessmentMode` for newly onboarded technical colleges — `skills`?
2. First pilot college + which assessment types they want on day one.
3. Company cut-offs: platform defaults per company, or college-only entry?
4. Proctoring tier for Skill Checks — light (default here) or full?
5. Mastery visibility: hide radar until the first diagnostic baseline?
6. Gamification (sprint streaks): offered as a college toggle, default off — agree?
