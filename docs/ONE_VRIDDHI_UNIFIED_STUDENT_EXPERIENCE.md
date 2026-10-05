# One Vriddhi — Unified Student Experience (Learning · Assessment · Practice)

Status: **Design direction — approved (2026-10-05). Current assessment flow stays as-is.**
Date: 2026-10-05 · Project: `vriddhi-engineering`

> Decision recorded: the assessment rebuild (see `ASSESSMENT_PORTAL_REDESIGN.md`,
> **parked as future reference**) is NOT the active direction. Vriddhi keeps its
> current assessment flow. The differentiator to design around is the **single
> unified platform**.

---

## 1. The problem this design exists to prevent

At PrepInsta, a student lives across **three separate dashboards**:

```
Learning product      Assessment product     Practice product
   own login             own login              own login
   own UI                own UI                 own UI
   own progress          own progress           own progress
```

A student's day is a commute: sign in to Learning for content → switch to the
Assessment portal for a test → switch to the Practice portal to drill. Three
homes, three progress stories, nothing connecting "I failed X" to "practice X
here" to "learn X there".

**Vriddhi's counter-position: one platform.** One sign-in, one home, one
navigation, one progress record — Learning, Assessment and Practice are
*pillars of one product*, not three products.

| A PrepInsta-style day | The One-Vriddhi day |
|---|---|
| Log in to LMS, watch a session | One sign-in → dashboard shows today's class + pending work |
| Open assessment portal, re-authenticate, take test | Same session → Assessments tile → take test |
| Open practice portal, re-authenticate, drill | Same session → result page offers the exact drill |
| Progress lives in 3 places, compared manually | One Journey page tells the whole story |

---

## 2. What "one platform" means — five invariants

| # | Invariant | Rule |
|---|---|---|
| U1 | **One identity** | One auth, one role/college claim. A pillar never re-authenticates. |
| U2 | **One home** | One student dashboard; pillars are sections of it, never separate apps. |
| U3 | **One nav model** | `studentNav.ts` is the single source of truth; sidebar, hubs, bottom bar, More-sheet and dashboard tiles all render from it (this is already enforced in code). |
| U4 | **One progress record** | Attendance, grades, test results, practice activity converge in `My Journey` — no pillar keeps a private scoreboard. |
| U5 | **Pillars link to each other** | Every result carries a next step into Learning or Practice; every learning unit can point at its Assessment. The loop is the product. |

---

## 3. The three pillars — as Vriddhi already has them

Grounded in the current nav model (`studentNav.ts`):

| Pillar | Capabilities today | Where they live |
|---|---|---|
| **Learning** | Curriculum, courses (self-paced), study materials, timetable, attendance, library | Academics group + Learning hub |
| **Assessment** | Tests (current flow — unchanged), assignments*, grades, results | Academics group (*assignments now behind a college toggle) |
| **Practice** | Coding Lab, company-prep guides & mocks (`/prep`), resume building, faculty connect | Learning hub + …**gap below** |

---

## 4. Gap analysis — where the unity leaks today

1. **The Practice pillar is half-connected.** The prep catalog
   (`/prep`: company guides, mock patterns, aptitude content — the most
   "practice" content on the platform) is a **public viewer with no entry
   point in student navigation**. Students reach Coding Lab (when their
   college enables it) but cannot reach company-prep from anywhere inside
   their portal — only via an out-of-band shared URL. *This is the headline
   gap: a pillar that exists but is invisible.*
2. **Cross-pillar links are thin.** A test result ends at a percentage; it
   does not route the student to the matching practice drill or study
   material. Learning completion doesn't invite the corresponding check.
3. **The dashboard is a page directory, not an action feed.** Quick tiles
   list destinations; they don't say *what to do next* across pillars.
4. **Journey is the spine, but nothing hangs on it yet.** `My Journey`
   aggregates academics; practice activity isn't part of the story yet.

None of these require a new dashboard — that would defeat the point. They are
wiring inside the one that exists.

---

## 5. The design — closing the gaps (additive, no rebuilds)

### 5.1 Make Practice visible: a Placement Prep entry in the Learning hub

- Add one nav item (`studentNav.ts`, Learning group): **"Placement Prep"**,
  hint "Company patterns, aptitude and mock practice".
- It opens the **existing** `/prep` viewer — published content only, which is
  exactly what the college's Company-Prep visibility panel already governs
  (master switch + per-company toggles, enforced server-side on list/detail/
  mock endpoints). Hidden colleges/companies stay hidden on deep links too.
- Backend: **zero new services, zero new collections** — the endpoints and
  visibility enforcement exist; this is nav + a college-scoped landing.
- Visibility rules follow existing patterns: item shows when the college's
  prep master switch is on (fail-closed like Coding Lab).

### 5.2 Dashboard: from page directory to three-pillar pulse

Keep the tiles; add a compact "Today" strip above them, composed from data the
dashboard already loads (`useStudentData` — no new fetches for v1):

```
┌ TODAY ──────────────────────────────────────────────────────────────┐
│ 📅 10:00 DBMS (timetable)   📝 1 assignment due (Assessments)       │
│ 🎯 1 test this week         💡 Practice pick: TCS aptitude set      │
└─────────────────────────────────────────────────────────────────────┘
```

Each row deep-links into its pillar. The "practice pick" starts as a simple
rule (nearest upcoming test's subject → matching prep subject; else company
prep if the college enables it) — no AI, no new infra.

### 5.3 The cross-pillar loop (the actual moat)

```
        LEARN ──────────► ASSESS
      (materials,        (tests, assignments,
       courses, units)    current flow, unchanged)
          ▲                     │
          │ result tells you    │ result tells you
          │ what to learn       │ what to drill
          │                     ▼
        PRACTICE ◄──────────────┘
   (coding lab, prep mocks, drills)
```

Concrete v1 links (all deep links, no new engines):

- **Result → Practice:** test result page shows "Practice this" — links to
  the prep subject/company matching the test's subject/tags.
- **Result → Learning:** same page shows "Study this" — the course/material
  tagged to the subject (existing materials & course tagging).
- **Practice → Assessment:** prep company page links upcoming tests/mock
  windows for that company (existing scheduled tests list).
- **Learning → Assessment:** course/material completion state (existing
  `courseProgress`) surfaces "ready for a skill check" when the college
  schedules one — appears naturally via the assessments list.

### 5.4 Journey as the one progress record

`My Journey` (already live) gains, incrementally:
- Practice activity rows: coding-lab sessions, prep mock attempts (data
  sources exist: coding lab state, prep progress endpoints).
- One readiness line per enabled target company — so the placement story
  lives inside the same spine as CGPA and attendance.

### 5.5 Nav hygiene rules (keep unity permanent)

- New student surfaces are added **only** through `studentNav.ts` (hubs,
  bottom bar, More-sheet, dashboard all follow automatically — enforced by
  tests).
- Optional modules stay behind college toggles (assignments today; same
  `colleges/{id}/config` mechanism for anything new) — unity means *one
  surface*, not *every feature for everyone*.
- No pillar may add its own top-level destination or its own login — a
  review rule, documented here.

---

## 6. Anti-patterns this design rejects

| Rejected | Why |
|---|---|
| A separate assessment portal/login | That's the PrepInsta fragmentation we're the alternative to |
| Per-pillar dashboards or apps | Three homes = three progress stories |
| Rebuilding the assessment player now | Current flow stays (decided); changes here are wiring, not engine |
| Duplicating progress stores per pillar | Journey is the single spine |
| Adding a mobile-specific product surface | Desktop-first portals; existing responsive student UI stays as-is |

---

## 7. Cost & quota posture

- **Frontend-first**: nav item + dashboard strip + result-page links. No new
  Cloud Run services, no new callables — everything reads what the client
  already reads or uses existing published-prep endpoints (quota-neutral, P6
  of the assessment doc).
- **Reads**: dashboard strip composes from the existing `useStudentData`
  batch (0 extra fetches in v1); result links are static deep links (0 reads
  until clicked).
- **Writes**: none added in this design.
- **Enforcement stays server-side**: prep visibility is already checked on
  the API; the nav entry is a courtesy, not the boundary.

---

## 8. Phases & acceptance

| Phase | Scope | Acceptance |
|---|---|---|
| **A — Practice visible** ✅ | Placement Prep nav item → existing `/prep` viewer, governed by the college visibility panel | student of an enabled college reaches company prep in ≤ 2 taps from home; disabled college sees nothing, deep links refused |
| **B — Today strip** | three-pillar pulse on dashboard from existing data | strip renders from data already loaded; every row deep-links correctly |
| **C — Loop links** | result → practice/learning links; prep → upcoming tests | every completed test offers ≥ 1 correct next step; links respect college toggles |
| **D — Journey spine** | practice activity + company readiness rows in My Journey | one page answers "how am I doing" across all three pillars |

Each phase ships independently; none touches the assessment engine.

## 9. Open questions

1. "Placement Prep" label — or the college-facing brand (e.g. "Career Prep")?
2. Prep entry for colleges with the master switch on but zero published
   content — show with an empty state, or hide until first publish?
3. Should the dashboard strip replace the current quick-tiles section on
   desktop, or sit above it (current plan: above)?
4. Practice activity in Journey: show from day one (empty states) or after a
   college has real activity?
