# Assessment Portal Redesign — Skills-First Assessment for Technical Colleges

Status: **Design proposal — direction approved, refinement round in progress.
No Phase-1 code yet; iterate on this doc with college feedback before build.**
Date: 2026-10-05 · Project: `vriddhi-engineering`

---

## 1. Why the current flow doesn't fit technical colleges

Today's assessment pipeline is university-shaped:

```
Question bank (PYQ)  →  Paper Builder + blueprint  →  schedule test
        →  proctored exam (frozen paper snapshot)  →  scheme-pack grading
        →  report with pass/fail categories
```

Its centre of gravity is the **question paper**: previous-year papers, paper
parsing (`paperParsing.ts`), paper review workflow (`paperWorkflow.ts`),
blueprints, and university scheme-pack grading (`schemePacks.ts`).

Technical colleges operate differently:

- There is **no question-paper module** in their assessment life — they don't
  circulate or reuse previous-year university papers.
- They assess **employability skills**: DSA, aptitude (quant/verbal/logical),
  language-specific proficiency (Java, Python, JS, SQL…), and
  **company-specific** patterns (TCS NQT, Infosys, Cognizant, Wipro, etc.).
- The unit of assessment is a **skill check or mock drive**, not a paper.
- The output they care about is **readiness** ("is this batch ready for the
  TCS drive in March?"), not scheme grades.

So the redesign keeps Vriddhi's proven **delivery engine** (scheduling,
freezing, autosave, proctoring, submission lifecycle — the hard 80% already
built in `studentAssessments.ts`) and replaces the **composition layer**
(paper-centric) with a **skill-centric** one. Nothing is deleted: colleges on
the university track keep today's flow untouched.

---

## 2. The new model — Skill Assessment Platform

### 2.1 Skill graph instead of papers

A small taxonomy owned per college, seeded from the platform:

```
skillDomains/{collegeId}            e.g. "Programming", "Aptitude", "Core CS"
  └─ skills/{skillId}               e.g. "Arrays & Strings", "Quantitative", "Java OOP"
       └─ topics (optional)         e.g. "Two-pointer", "Percentages"
```

Each skill carries: difficulty ladder (L1 recall → L4 apply/solve), linked
practice destinations (prep track, Coding Lab topic, study material), and an
optional mapping to curriculum courses so faculty can see "which course builds
which skill".

> Reuse, don't rebuild: the platform already stores a universal question pool
> (`universalQuestions` with `prepTags.stream` = aptitude / companies /
> universal and `prepTags.topicIds`), and the Prep module already models
> company test patterns (`prep_companies/{code}` with sections, question
> counts, verified-on dates). The skill graph formalises what those two
> collections already approximate.

### 2.2 Assessment types (the new "papers")

| Type | Purpose | Composition |
|---|---|---|
| **Diagnostic** | Baseline at intake / semester start | Fixed mix: aptitude + core DSA + language fundamentals |
| **Skill Check** | After a training unit | Single skill or small skill set, short (15–30 Q) |
| **Mock Drive** | Company-pattern rehearsal | Generated from a company's section weights (existing `prep_companies` patterns) |
| **Aptitude Sprint** | Timed practice with streaks | Aptitude pool, adaptive difficulty bands |
| **Readiness Gate** | Pre-placement certification | Mixed; produces a readiness score per target company |

An assessment is a **blueprint over skills**, not a document of questions:

```jsonc
// assessmentBlueprints/{collegeId}
{
  "title": "TCS NQT Mock — CSE Sem 6",
  "type": "mock_drive",
  "companyCode": "tcs",              // links prep_companies/{code}
  "sections": [
    { "name": "Numerical",  "skills": ["quant.percentages", "quant.ratio"], "count": 20, "minutes": 25 },
    { "name": "Verbal",     "skills": ["verbal.rc", "verbal.grammar"],      "count": 20, "minutes": 20 },
    { "name": "Reasoning",  "skills": ["logical.series", "logical.puzzle"],  "count": 15, "minutes": 20 },
    { "name": "Coding",     "skills": ["dsa.arrays", "dsa.strings"],         "count": 2,  "minutes": 40, "mode": "code" }
  ],
  "difficulty": { "easy": 0.3, "medium": 0.5, "hard": 0.2 },
  "targetCohort": { "branch": "CSE", "batch": "2027", "semester": 6 }
}
```

Question selection fills the blueprint from pools in priority order:
college-authored → platform universal pool → AI-generated (existing
`/ai-questions` route) → seeded aptitude set. Selected questions are frozen
into the same `questionChunks` snapshot mechanism the current engine uses, so
a student can never see the live pool change mid-test.

### 2.3 Delivery — reuse the existing engine

`scheduleAssessmentTest`'s machinery (freeze → `scheduledTests` →
`studentAssessments` attempts → autosave → proctor events → submit) is
transport-agnostic about *where questions came from*. The redesign:

- keeps all of it (frozen chunks, autosave index, proctoring logs, auto-submit
  scheduler, result lifecycle);
- adds `sourceKind: 'paper' | 'skills'` on `scheduledTests` so reports and the
  UI render the right shape;
- adds **coding sections** as a staged extension: while Judge0 stays excluded,
  coding questions ship as *write-the-output / trace / pseudocode MCQs*
  (schedulable today); when a code runner is approved later, the same section
  gains `mode: 'code'` with per-test-case scoring — no schema break.

### 2.4 Results — readiness instead of scheme grades

Reports shift from "grade per paper" to **skill mastery**:

- **Skill radar per student** — % mastery per skill (EMA over attempts,
  weighted by difficulty and recency).
- **Cohort heat-map** — branch × skill, flagging weak clusters before drives.
- **Company readiness score** — for each target company, the student's
  projected section scores vs. the company's historical cut-offs (patterns
  already carry section sizes; cut-offs start admin-editable per college).
- **Gap → practice loop** — every weak skill links to its practice
  destination (prep guide topic, Coding Lab, materials). This closes the loop
  the current portal leaves open: today a report ends at a percentage.

The existing college-editable performance categories
(`assessmentConfigs/{collegeId}.performanceCategories`) remain — they still
label the bands on every report.

### 2.5 College configuration

Extends the existing `assessmentConfigs/{collegeId}` document:

```jsonc
{
  "assessmentMode": "skills",        // "university" keeps today's paper flow
  "enabledAssessmentTypes": ["diagnostic", "skill_check", "mock_drive", "readiness_gate"],
  "targetCompanies": ["tcs", "infosys"],   // from prep_companies codes
  "performanceCategories": [...]     // unchanged, existing field
}
```

`assessmentMode` is the college-level decision; **both engines stay in the
codebase**, selected per college. No college/branch names are ever hardcoded —
companies come from `prep_companies`, skills from the college's graph.

---

## 3. What changes where

### Firestore (new collections; old ones untouched)

| Collection | Purpose |
|---|---|
| `skillGraphs/{collegeId}` | Domains/skills/topics, difficulty ladders, practice links |
| `assessmentBlueprints/{collegeId}` | Skill-based blueprints (replaces "paper" for skills colleges) |
| `skillQuestions/{collegeId}` | College-authored skill-tagged questions (draft → approved) |
| `scheduledTests` *(existing)* | gains `sourceKind: 'skills'`, `blueprintId`, `companyCode` |
| `studentAssessments` *(existing)* | gains `skillScores: { skillId: { correct, total, difficulty } }` |
| `skillMastery/{collegeId}/{studentId}` | Rolling mastery snapshot (reporting read model) |

### Functions — quota-aware by construction

Under the current 20,000 milliCPU Cloud Run quota, **no new callable
functions** should be created. All new endpoints mount on the already-deployed
shared `api` Express function (exactly like the new `/api/config/modules`
route in this change):

- `GET/POST /api/skills` — graph CRUD (staff)
- `GET/POST /api/skill-questions`, `POST /api/skill-questions/generate` (AI)
- `GET/POST /api/blueprints`, `POST /api/blueprints/:id/schedule`
- `GET /api/readiness/:studentId`, `GET /api/cohort-heatmap`

Scheduling/attempt delivery continues to use the existing deployed callables
(`getMyStudentTests`, `autosaveMyStudentTest`, …) once they clear the quota
block — no duplication of the engine.

### Frontend

- **Student hub**: Assessments tab shows cards by type (Diagnostic / Mock
  Drive / Skill Check) with readiness ring, not paper titles.
- **Assessment Studio** (admin/faculty): blueprint builder with skill picker +
  company pattern import ("start from TCS NQT pattern" → section weights
  pre-filled from `prep_companies`).
- **Readiness dashboard** (placement cell / HOD): cohort heat-map + company
  readiness board.
- The paper-centric pages (Paper Builder, Paper Review, PYQ import) remain for
  universities; `assessmentMode` decides which studio a college sees.

---

## 4. Phased rollout (each phase independently shippable)

| Phase | Scope | Depends on |
|---|---|---|
| **0 — Toggles (done in this change)** | Assignments module behind college toggle; assessment config extended to carry `assessmentMode`; no behaviour change | — |
| **1 — Skill graph + diagnostics** | Graph CRUD, skill questions (manual + AI), Diagnostic + Skill Check types, skill-scoring on results, student skill radar | quota-compatible deploy of assessment callables |
| **2 — Mock drives** | Company pattern import into blueprints, Mock Drive + Aptitude Sprint, readiness score v1, cohort heat-map | Phase 1 + `prep_companies` catalogue |
| **3 — Coding sections** | `mode: 'code'` sections once a code runner is approved (Judge0 remains excluded until then; MCQ-style coding questions bridge the gap) | separate approval |

Assignments stay **out of this redesign**: they work differently per college,
are now behind a college toggle, and will be revisited only after the
colleges' own requirements arrive.

---

## 5. Refinement areas (for the current design-review round)

Concrete detail added for discussion — each item is a decision point colleges
or the product owner should react to:

### 5.1 Mastery calculation

Per student × skill: `mastery = Σ(weight_i × score_i) / Σ(weight_i)` over the
last N attempts (N = 8), where `weight_i = difficultyWeight × recencyDecay`
(recency half-life 30 days). Bands: <40% *Needs Training*, 40–69% *Developing*,
70–84% *Job-Ready*, ≥85% *Strong*. The college-editable performance categories
still label report bands; mastery bands are a separate, fixed scale so cross-
college comparisons stay meaningful.

### 5.2 Company readiness score

`readiness(company) = Σ_section (sectionWeight × projectedSectionScore)` where
`projectedSectionScore` is the mean mastery of the section's mapped skills
discounted by attempt recency. Cut-offs start as per-college editable numbers
(seeded blank — no invented data); a drive is "green" at ≥ cut-off for every
section, "amber" within 10 points, else "red". Open point: should the platform
ship default cut-offs per company for colleges that want them?

### 5.3 Blueprint builder UX

Three entry paths, all ending in the same editor:
1. **Blank** — pick type, add sections, assign skills.
2. **From company pattern** — choose a company guide (`prep_companies`),
   section weights/counts pre-filled, college tweaks.
3. **Clone** — copy a previous blueprint (next batch, next drive).
Validation mirrors the paper scheduler: every section resolvable to ≥ count
pool questions, or a shortfall warning naming the skills with thin pools and
offering AI generation for exactly the gap.

### 5.4 Data-model field detail (for review)

- `skillQuestions/{collegeId}/{id}`: `{ text, type, options?, answer, skillId,
  difficulty 1-4, tags[], status: draft|approved, createdBy, usedCount, lastUsedAt }`
- `scheduledTests` additions: `{ sourceKind: 'paper'|'skills', blueprintId?,
  companyCode?, skillCoverage: { skillId: count } }`
- `studentAssessments` additions: `{ skillScores: { [skillId]: { correct,
  total, avgDifficulty } }, companyCode? }`
- `skillMastery/{collegeId}/{studentId}`: `{ bySkill: { [skillId]: { mastery,
  attempts, lastAttemptAt } }, readiness: { [companyCode]: score }, updatedAt }`
  (recomputed post-submit; reports read this doc — cheap dashboards).

### 5.5 What "no question paper module" means in the UI

For a `skills`-mode college: Paper Builder, Paper Review, PYQ import and
scheme-grade entry do not appear in navigation (same toggle mechanism used for
Assignments today). Their functions stay deployed for university-mode colleges;
no deletion. `getMyCurriculum` / grading records remain shared infrastructure.

## 6. Open questions (need answers before build)

1. ~~Fee/exam hold scope~~ — **Resolved 2026-10-05:** fees are on hold too
   (deployed fee callables untouched); exam-area work frozen like Admission.
2. **Default `assessmentMode`** — for newly onboarded technical colleges:
   default `skills`? Existing colleges keep `university` unless they opt in.
3. **Which assessment types** does the first pilot college want on day one?
4. **Readiness cut-offs** — platform defaults per company, or college-only entry?
5. **Proctoring depth** for low-stakes skill checks — keep full proctoring or
   a lighter "honesty pledge" mode to reduce friction on practice attempts?
6. **Mastery visibility to students** — full radar from attempt #1, or only
   after a diagnostic baseline? (Avoids noisy 0% radars on day one.)
