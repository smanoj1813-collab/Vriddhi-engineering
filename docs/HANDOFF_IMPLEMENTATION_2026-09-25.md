# Implementation hand-off — in plain English (25 Sep 2026)

**Read this before anyone starts writing code for the optimisation plan.** It says, for every item:
what we do today, what it becomes, **what we give up** (the "drop-off"), and **what we gain**. No
jargon — where a technical word is unavoidable it is explained in brackets.

* The plan itself: `docs/HANDOFF_OPTIMISATION_2026-09-25.md`
* The clause-by-clause review, the model-price warning and the paper-corpus plan:
  `docs/HANDOFF_REVIEW_2026-09-25.md`
* This file: the same work, re-told for a decision-maker. If the three ever disagree, the review
  is right and this one is out of date.

---

## 0. The whole thing in ten lines

| | Today | After the plan | You give up | You gain |
|---|---|---|---|---|
| **AI cost** | ₹1,16,020 / year | ₹46,150 / year (while 2.5 Flash-Lite lasts); ≈ ₹86,070 on the 3.x replacement | The comfort of "one model everywhere" — cheap models answer chat/study material, the expensive one keeps grading and paper reading | 60 % off the bill, and three AI features that are **broken today** start working again |
| **Firestore reads** | ₹36,853 / year | ≈ ₹6,000–8,000 / year | Numbers on dashboards update on a timer instead of instantly | The biggest recurring cost line drops by ~80 % |
| **Download size / egress** | ₹3,936 / year | ≈ ₹1,000 / year | Nothing user-visible; internal risk of a stale cached file, which we guard against | Repeat visits stop re-downloading ~9 MB of app files — very noticeable on 4G |
| **Cloud Functions** | 14 dead functions still deployed, `api` runs on a big 2 GiB machine because of PDF work | Dead ones deleted, PDF work moved to its own function, `api` shrunk | One awkward deploy step (a delete prompt) and a careful route switch | Faster, cleaner deploys; cheaper, faster cold starts; less console noise |
| **Content** | 50 papers / 846 questions, no answers | "Most repeated questions", then AI model answers, then revision MCQs — all reviewed by a human before students see them | Reviewer time (≈5 hours for the existing 846 answers) | New study material built from content we already own, at ≈₹30 one-time |
| **Total cloud + AI** | ≈ ₹1.7 lakh / year | ≈ ₹0.7 lakh / year | — | ≈ ₹1 lakh / year, i.e. ₹34 → ₹14 per student |

Two honest warnings, both from the review: the AI saving **expires** (2.5 Flash-Lite is signalled
for retirement around Oct 2026, and 3.x prices double on 1 Jan 2027), and the real fix for that is
the shared AI cache plus capping `/chat`. Treat the cache and the cap as part of Phase 1, not as
"nice to have later".

---

## 1. Ground rules for whoever implements this

1. **One item, one pull request** (or one small group). Code + tests + a short "how to deploy and
   how to check it" note. Nothing is bundled silently with something else.
2. **Nothing user-visible is deleted in the same release that adds its replacement.** New path goes
   live first, old path keeps working for one release, old path is removed afterwards.
3. **Every item keeps the old path as a fallback** — summary doc missing? use the raw query. New
   model failing? fall back inside Gemini, then to the old provider. New route unknown? keep it
   mounted on both functions for one release.
4. **Never rename** a cloud function name, a URL route, a Firestore collection or a Storage folder
   in the same PR that introduces its replacement. Those names are contracts with phones that still
   have the old app installed.
5. **Tests before merge, always green, and every new test file must be added to the test list** —
   both test lists are written out by hand, so a file that is not listed simply never runs.
6. **Rules and tests together**: a new collection gets a security rule *and* a case in the rules
   test; a new query gets its index added to `firestore.indexes.json` and deployed **before** the
   code that needs it.

Current test baselines (25 Sep 2026) — these numbers may only go up:
root tests **461**, functions tests **847**, render checks **317**, `vite build` succeeds,
TypeScript clean on both sides.

---

## 2. Before you start: six decisions only you can make

| # | Decision | Option A | Option B | What each costs you |
|---|---|---|---|---|
| D1 | Which models for the "fast" and "quality" tiers? | Fast = `gemini-2.5-flash-lite` (cheapest today, ≈₹46 K/yr) | Fast = `gemini-3.1-flash-lite` (safe till May 2027, ≈₹86 K/yr) | A = cheapest but expires soon and forces a second swap; B = ~2× the AI bill, one less surprise |
| D2 | Do we cap the AI chat at ~20 questions per student per day? | Yes — protects the largest cost line (40 % of AI spend) | No — keep it unlimited for now | Yes = some students hit a wall and will complain; No = the bill is unbounded and no other saving fixes it |
| D3 | Are we OK with dashboards that show "as of 10 minutes ago" plus a Refresh button? | Yes — that is where most of the Firestore saving comes from | No — keep them live and accept ≈₹30 K/yr more reads | Yes = numbers can look slightly stale; No = 2.4 and half of 3.2 lose their point |
| D4 | Students' attendance percentage will change for some of them (today it is computed from only the latest 500 records, about one semester; after the fix it uses the whole history). | Announce it, then switch | Keep the 500-record window on purpose | Announce = a week of "my attendance changed" tickets; Keep = the number stays wrong but nobody is surprised |
| D5 | Confirm the 14 "orphan" cloud functions really are unused (Cloud Run console → each service → request count, last 30 days must be 0). | Delete them | Keep them | Delete = if an old app build calls one it gets "not found" (it is in git history, easy to restore); Keep = every deploy keeps asking about them |
| D6 | Which costing document is the contract — the spreadsheet (`≈₹36,853` reads) or the script (`≈₹4,287` reads)? | Pick one and keep it updated | Leave both | Two documents disagreeing means nobody trusts the "before" number later |

Everything below assumes D1 = A, D2 = yes, D3 = yes, D4 = announce, D5 = confirmed dead,
D6 = the spreadsheet. If you choose differently, the drop-offs change, not the mechanics.

---

## 3. Item-by-item: before, after, drop-off, advantage

### 3.1 Fix the dead AI models and split them into two tiers — item 2.1 *(do this first)*

**Right now.** Three screens call `gemini-1.5-flash`, a model Google shut down on 29 Sep 2025. Those
calls fail and only "work" when a backup provider key happens to exist. Four different places
decide which model to use, in four different ways.

**After.** One list of models per tier in one file: a **fast** tier for chat, study material and
draft content; a **quality** tier for paper reading, grading and question generation. Each tier is a
*list*, so if the first model is refused the code tries the next one inside Gemini before falling
back to the other provider. The model names come from settings, never from code. The code also
starts recording "thinking tokens" and cached tokens, which newer models bill for and which today's
logs ignore.

**Drop-off.**
* We give up "one model for everything". Cheap models will write slightly plainer study material.
* A model swap can change the *shape* of the reply, not only its quality — JSON parsing that
  survives today could start failing, so each call site must be sample-tested (20 replies) before
  and after.
* Someone must own a small calendar task: the model names now carry a shutdown date, and they need
  re-checking every few months. Without that, this exact outage happens again in a year.

**Advantage.**
* Three broken features work again on the next deploy — that is a bug fix wearing a cost-saving hat.
* 60 % off the AI bill while the cheap model lasts.
* One place to change a model; a failing model can no longer take a feature down.

**Effort:** small (one file plus call sites plus a test). **Risk:** low. **Rollback:** change a
setting and redeploy.

---

### 3.2 Stop re-downloading the app on every visit — item 2.2

**Right now.** The hosting config tells browsers "never cache" JavaScript and CSS files. Vite
already gives every build a unique filename, so this rule is protecting nothing and costing
everything: every visit re-downloads roughly 9 MB.

**After.** Build files get a one-year "immutable" cache (their names change when the content
changes, so this is safe); the small files that must not be cached keep their old rules; and the app
gains a one-shot recovery for the classic failure mode ("we just deployed, your browser asked for a
file that no longer exists" → reload once automatically instead of showing a white screen).

**Drop-off.**
* This is the one Phase-1 item with a real way to hurt users: a stale cached page asking for a
  deleted file = white screen. So the recovery guard ships **in the same PR, first**.
* A hard refresh is still needed after deploys for the service worker. That is unchanged, but it
  matters more now.
* One-time risk to plan for: the cache rules apply to the request path, and the rewrite that serves
  deep links (`/student/dashboard`) is not `/index.html`. Deep links must be tested, not just the
  home page.

**Advantage.** Repeat visits get much faster (most visible on 4G phones, which is most students),
and download cost drops ~70 %. No screen changes, no new behaviour to learn.

**Effort:** small. **Risk:** medium-but-guarded. **Rollback:** revert two config lines, redeploy.

---

### 3.3 Delete the 14 dead Cloud Functions — item 2.3

**Right now.** Fourteen functions from a removed feature are still deployed. They cost nothing to
run, but every deploy stops to ask whether to delete them, and they clutter the console.

**After.** Deleted, with the 30-day "zero traffic" check as the gate.

**Drop-off.** If a phone somewhere is still running an old app build, its call now returns "not
found" instead of doing nothing useful. The code is in git history, so restoring is a redeploy.

**Advantage.** Deploys stop nagging, run faster, and the function list matches reality.

**Effort:** minutes. **Risk:** low, gated by the traffic check.

---

### 3.4 Superadmin screens: poll less, count instead of read — item 2.4

**Right now.** The superadmin console refreshes every 60 seconds to 2 minutes and, to show "42
colleges" or "1,800 students", it downloads the whole collection and counts the rows in the browser.
That is where the ≈81,000 reads per day per tab in the costing sheet comes from.

**After.** Refresh intervals become 5–10 minutes with a visible Refresh button and an "Updated
HH:MM" line. Counting is done by the database itself (answer in one read instead of one per 1,000
documents). A small scheduled job refreshes a platform stats document every 15 minutes; the console
reads that one document and, if it is missing or older than an hour, quietly falls back to the old
calculation.

**Drop-off.**
* Numbers are no longer "live". A college created 30 seconds ago may not appear immediately.
  Someone will report the dashboard as "wrong" unless the timestamp is on screen (that is why the
  "Updated HH:MM" line is part of the item, not optional polish).
* "Count" answers are approximate for a moment (the database counts a fraction of a second behind),
  and a brand-new stats document is one more thing to monitor.

**Advantage.** ~81,000 reads/day → ~8,000/day per tab. Nothing looks different to the user, and the
console still feels instant.

**Effort:** small–medium. **Risk:** low. **Rollback:** put the intervals back.

---

### 3.5 Student attendance: stop reading 500 records to draw one percentage — item 3.1

**Right now.** Every time a student opens the dashboard, the app downloads up to 500 attendance
rows and adds them up in the browser. That is ~600 reads per open, ~85 % of a student's total reads,
≈₹28,000 a year at 5,000 students — and it is wrong in a subtle way: a student with more than 500
records sees a percentage for *part* of their history.

**After.** One small document per student holds the totals (subject-wise, month-wise, last 20
sessions). A database trigger updates it whenever an attendance row changes, using simple
add/subtract maths. Old data is filled in once by a backfill job. If a student's summary is missing,
the app automatically uses today's raw query — so nothing breaks while the backfill runs.

**Drop-off.**
* **The percentage can change** after the backfill, because it now covers the whole history. That is
  a correctness fix that looks like a bug to the student. Decide D4 before shipping.
* The trigger is "at least once" by nature — it can fire twice or get dropped. So we need either an
  exactly-once marker inside the same transaction or a nightly reconcile, plus a "recompute if the
  summary disagrees with the raw count" safety net.
* One student's summary can be written hundreds of times in a burst during a re-import. Firestore
  dislikes more than ~1 write per second to one document, so the import path must aggregate or
  queue instead of hammering it.

**Advantage.** The single biggest Firestore saving (~85 % of student reads), attendance opens
instantly, and the number finally covers the whole history.

**Effort:** medium (trigger + backfill + fallback + rules + tests). **Risk:** medium. **Rollback:**
the client falls back automatically while the collection is empty; deleting the trigger loses no data.

---

### 3.6 Admin dashboard: count and average, don't download — item 3.2

**Right now.** Four queries each pull up to 500 rows to produce four numbers.

**After.** The database returns the counts and averages directly. Roughly 2,000 reads become about
10 per dashboard load.

**Drop-off.** Counts and averages trail real data by a moment — a student added one second ago may
not be in the number. And these "tell me the total" queries support fewer shapes than normal
queries, so anything unusual has to keep the old calculation as a fallback.

**Advantage.** ~2,000 reads → ~10 per load, one round trip instead of four, and no visible
difference in layout.

**Effort:** small. **Risk:** low.

---

### 3.7 Content from what we already own — items 3.3, 3.4, 3.5

**Right now.** 50 previous-year papers (846 questions) sit in code and are shown as lists. Nothing
is derived from them.

**After, in order:**
1. **"Most repeated questions"** — pure text matching on the server, no AI. Groups near-duplicate
   questions per subject and shows the years they appeared. Kannada needs its own text handling, so
   English ships first.
2. **Model answers** — one AI pass over the 846 questions (≈₹30 at the cheap tier), saved as drafts,
   reviewed in Prep Studio, published only on approval, and labelled as AI-generated and reviewed.
3. **Revision MCQs** — 5 per topic, built from the questions plus the published answers, same
   draft → review → publish road.

**Drop-off.**
* The real cost is **human review time**: ≈5 hours for the existing 846 answers, and it grows
  linearly with the corpus. A 5,000-paper corpus is "review weeks", not hours.
* Answers will be *indicative*, not model-perfect. They must be labelled or they will be quoted back
  at us as syllabus truth.
* English-only text matching will not work on Kannada; doing Kannada properly is a separate item.

**Advantage.** Genuinely new study material from content we already own, at almost no running cost —
and "most repeated questions" and "quick revision" are the kind of features students actually use
before exams.

**Effort:** 3.3 small, 3.4 medium, 3.5 medium. **Risk:** low (all drafts are human-reviewed).

---

### 3.8 Shared AI cache — item 4.1 *(this is the price-change fire escape)*

**Right now.** Every college asking for the same study pack or the same generated question triggers
its own AI call. Ten colleges = ten identical bills.

**After.** The first request stores the answer against a key made of the content, the model and a
"prompt version". Every later request with the same key reads the stored copy. Counters show how
many hits and misses we get.

**Drop-off.** A stale answer if we change a prompt and forget to bump the version — hence the
version in the key and a purge route. Cache entries are per syllabus/university, never per student,
so nothing personal is shared.

**Advantage.** Spend stops growing with the number of colleges, and identical content appears
instantly. This is the only item that offsets the 3.x price increase without removing features.

**Effort:** medium. **Risk:** low. **Order:** after Phase 1, before any price rise.

---

### 3.9 One PDF stack — item 4.3, and splitting the PDF function — item 4.4

**Right now.** Some documents (fee receipts, labels, reports, payroll) are drawn in the browser
using two heavy PDF libraries. Separately, the whole `api` function runs on a 2 GiB machine purely
because PDF routes need a headless browser.

**After.** Each document moves to the server renderer one at a time — the browser version stays until
that document is verified identical. When the last one moves, both browser libraries leave the
download. Then the PDF routes move into their own small service with a big machine, and `api` returns
to a normal 512 MiB — for one release the routes live on **both**, so no phone can hit a missing
route.

**Drop-off.** Until the last document is migrated, we carry two implementations (more code to keep
in step). A server renderer that fails takes printing with it, so the client path must stay until
parity is proven per document, and someone has to actually compare the outputs.

**Advantage.** Smaller download (faster first load), cheaper and faster cold starts, one rendering
style across the product, and the browser's memory is spared on low-end phones.

**Effort:** medium–large (it is a list of documents). **Risk:** medium; the fallback discipline is
what makes it safe.

---

## 4. The Cloud Functions themselves — what changes, in one place

| Function | Today | After | Drop-off to watch |
|---|---|---|---|
| 14 orphan functions | Deployed, unused, prompt on every deploy | Deleted | An old app build gets "not found" — restore from git if it happens |
| `api` | 2 GiB because PDF routes live here | 512 MiB, normal routes only | Routes must exist on the new service too for one release |
| *(new)* `pdf` | — | 2 GiB / 120 s, PDF routes only | The client has to point `/pdf/*` at the new base; until then both are mounted |
| *(new)* attendance trigger | — | Fires on every attendance row change, updates one summary doc | At-least-once delivery, and hot-document bursts — handled by the exactly-once guard or nightly reconcile, plus recompute-on-mismatch |
| *(new)* nightly reconcile | — | Repairs any summary that drifted | Two writers to the same summary is a design smell: keep the reconcile path documented |
| *(new)* `refreshPlatformStats` | Console counted rows in the browser | Every 15 min, writes one stats document | Dashboard freshness moves from seconds to minutes; "Updated HH:MM" must ship with it |
| *(new)* model canary | — | A tiny daily call that fails loudly if a model id stops existing | One more scheduled function to notice when it stops running |
| PDF rendering (resume, fee) | Browser-side for most documents | Server-side, document by document | Two implementations during migration |

Nothing here changes a function *name* — that is deliberate, because names are contracts with
installed apps.

---

## 5. What we are deliberately NOT doing (scope drop-offs)

| Not doing | Why | What we accept |
|---|---|---|
| Moving the payment functions to the Mumbai region | Only worth it if latency is a real complaint; it means changing webhook URLs and re-testing live payments | Fees keep working exactly as they do now |
| Reorganising the 93 "callable" functions into a tidier shape | Their names are client contracts; renaming breaks installed apps | A slightly cluttered list, and a rule: new features use routes, not new callables |
| Real-time dashboards for the superadmin | Real-time is precisely what the read bill is paying for; a 10-minute refresh with a manual button covers the actual use | Someone will ask "why is this not live" and the timestamp answers it |
| Kannada support in "most repeated questions" from day one | Kannada word-matching is a different piece of work, not a setting | English ships first; Kannada is its own item (and the new paper import already reads Kannada papers) |
| Big-bang replacement of the browser PDF libraries | One bad document means a user cannot print a receipt | Slower migration, one document at a time, with a fallback |

---

## 6. What must NOT be dropped

* **The resume credit stays inside the payment transaction**, released only if rendering fails. No
  client-side credit logic, no canvas-based fallback for resumes.
* **Both route mounts stay.** Every router is reachable at `/api/<name>` *and* `/<name>` — that
  double mount is what keeps old builds working.
* **Nothing publishes itself.** Imported papers and AI model answers are drafts until a human
  approves them in the review queue.
* **Rules + a rules test for every new collection or path.** Default is deny. The new
  `questionBankImportJobs` collection is server-only, and this is covered by tests.
* **The old path stays alive for one release** for every data-path change.
* **Indexes deploy before the code that needs them.**

---

## 7. How the work will be handed over, item by item

For each item the implementer produces a PR containing:

1. The code change (smallest version that delivers the item).
2. Tests, **added to the explicit test lists**, plus a render-check section if a screen changed.
3. A "Deploy & verify" note: which command, in which order, what to click, what to expect, and how
   to roll back.
4. A one-line note in the docs (`docs/*.md`) or the relevant README section.

The operator then deploys **one command at a time** and watches for 15 minutes: errors in Cloud
Logging, the Firestore read graph, and a quick click through the touched screens. Ask users to hard
refresh once — the service worker keeps the old build until it is accepted.

Suggested order (each step is worth shipping on its own):

```
1. 2.1 model tiers + telemetry      (fixes the live outage, cuts AI cost)
2. 2.2 cache headers + reload guard (fastest user-visible win)
3. 2.3 delete orphans               (5-minute cleanup)
4. 2.4 superadmin polling + counts  (read cost)
5. /chat cap + batched grading      (protects the biggest AI line)
6. 4.1 shared AI cache              (the price-rise fire escape)
7. 3.3 most-repeated questions      (free content, no AI)
8. 3.1 attendance summary           (biggest read saving, needs D4)
9. 3.2 admin dashboard counts       (small, clean)
10. 3.4/3.5 model answers + MCQs    (content, needs reviewer time)
11. 4.3/4.4 PDF consolidation       (structural)
12. 4.2/4.5 placement pack, small consolidations
```

---

## 8. How we will know it worked

| Measure | Before | Target | Where to look |
|---|---|---|---|
| AI spend / year | ₹1,16,020 | ₹46,150 while the cheap tier lasts; ₹86,070 on 3.x | Gemini billing page, cross-checked with the `ai_usage` collection |
| Firestore reads / year | ₹36,853 (sheet) | ≈₹6,000–8,000 | Firebase console → Firestore usage |
| Hosting download / year | ₹3,936 | ≈₹1,000 | Firebase console → Hosting usage |
| Student dashboard reads per open | up to ~600 | 1 + 1 write per change | Console, or the app's own counters |
| Admin dashboard reads per load | ~2,000 | ~10 | Console |
| AI features failing | 3 screens broken | 0 | Smoke test after deploy, no `gemini-1.5-flash` 404 in logs |
| Functions deployed | 14 orphans + oversized `api` | clean list, `api` at 512 MiB | Cloud Run console |

Notes on honesty: the read and cost figures are **model-based**, not billing measurements —
validate each one in the console the day after the deploy that changes it. The AI figures cannot be
smoke-tested in the coding sandbox at all (no Google API access), and the AI cache benefit only
shows up after the second college asks for the same content.

---

## 9. Related work already shipped (context for the same implementer)

The previous-year-paper **import pipeline** described in the review as "Route 2" (Superadmin →
Import papers → ZIP) is now built and merged into the working branch, landing papers in the
universal question bank as **pending drafts** — nothing publishes itself. It is the intake path that
the content items above (3.3–3.5) will eventually read from, and it already handles scanned and
Kannada documents. It still needs a production run: rules deploy, a rules test run on a machine with
the emulator tooling, and one real ZIP smoke test by the operator.

---

## 10. Item 2.1 — implemented (branch `arena/01a0d9ad-vriddhi`)

**What changed**

| Where | Before | After |
|---|---|---|
| Model ids | 7 call sites, 3 of them calling a model Google shut down in Sep 2025 | one registry: `functions/src/config/aiModels.ts`; a unit test greps the source and fails if any `gemini-<number>` literal appears outside it |
| Tiers | no tiers; four different ways of choosing a model | **fast** (chat, study material, prep drafts) and **quality** (paper parsing, grading, question generation, paper import) |
| Fallback | a dead model fell through to DeepSeek/OpenAI, or failed | a dead model moves to the *next model in the same tier* first; a transient error (quota/network) does **not** retry, so no call is spent twice |
| Lifecycle | no dates anywhere | each tier entry carries its shutdown date + a daily **canary** (`aiModelCanary`, 06:30 IST) that asks the tier's first model for one word and writes `platform/aiModelCanary`; a retired id logs `TIER MODEL IS GONE` |
| Telemetry | `promptTokenCount` + `candidatesTokenCount` only | thinking tokens counted into billable output, cached tokens tracked separately (`tokensThinking` / `tokensCached` on `ai_usage`), and the model that actually answered is recorded (chat, study packs, prep drafts, grading suggestions, paper-import audit rows) |

**Operator knobs (no code change, no app redeploy)**

| Variable | Default | Use it to |
|---|---|---|
| `GEMINI_MODEL_FAST` | `gemini-2.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-2.5-flash` | pick the cheap tier. Comma-separated list, first entry first. e.g. `gemini-3.1-flash-lite` |
| `GEMINI_MODEL_QUALITY` | `gemini-2.5-flash` → `gemini-3.6-flash` | pick the strong tier (parsing/grading/questions) |
| `RESUME_AI_MODEL`, `QUESTION_IMPORT_AI_MODEL` | unset | still win for their own route; they are tried before the tier list |

**Deploy (operator, one command at a time)**

```powershell
cd C:\Projects\Vriddhi
git checkout main
git pull origin main
npm ci
npm ci --prefix functions
firebase deploy --only functions --project vriddhi-engineering
```

Only functions changed — no rules, no indexes, no hosting.

**Smoke test after deploy (5 minutes)**

1. Faculty → Study material → generate one topic → pack appears (this is one of the three broken features).
2. Student/faculty → AI chat → ask one question → a reply appears.
3. Superadmin → Prep Studio → draft one topic → draft appears.
4. Cloud Logging, last 5 minutes, filter `severity>=WARNING`: no `gemini-1.5` 404s, no `[StudyMaterial] LLM fallback` / `[AI Chat] Gemini call failed` warnings.
5. Firestore → `ai_usage/{today}` → `tokensIn` / `tokensOut` increment; `tokensThinking` appears once a 3.x model answers.
6. Next morning: Firestore → `platform` → `aiModelCanary` exists with `degradedTiers: []`.

**Rollback:** set the env var (or none — the code falls back inside the tier) and redeploy functions. No data migration, no schema change.

---

# 11. What shipped after §10 (session of 26 Sep 2026)

Six more plan items are implemented on the branch `arena/01a0d9ad-vriddhi`. §10 still
stands as written; nothing below changes it. Numbers in the push-preview "before/after"
tables are unchanged — these items make the operating cost land closer to the lower line
by removing work, not by moving it.

| Item | What it does | Where |
| --- | --- | --- |
| 2.4 | 15-minute `refreshPlatformStats` job writes one `platform/stats` doc (reads, storage, AI, and the AI-cache hit rate folded in from 4.1). One doc read instead of aggregate queries. | `functions/src/platformStats.ts` |
| 4.1 | Content cache in front of the generative routes (prep drafts, question sets, study packs, resume AI). Key = sha256 of kind + content key + model + prompt version; hit rate visible; cache failures never fail a request; **AI content is never readable by a browser** (rules deny the collection). | `functions/src/ai/contentEngine.ts` |
| 3.4 / 3.5 | Model answers for past papers behind an explicit review step, and MCQ sets generated from them. A published answer is the only one students see, and the review screen is the only way to publish. | `functions/src/prepModelAnswers.ts`, `routes/prep.ts` |
| 4.4 | PDF rendering moved off the main API function onto its own (`pdf`, 2 GiB, asia-south1). Papers, question banks and resumes all render there through one client helper. | `functions/src/routes/pdf.ts`, `src/shared/api/apiBase.ts` |
| 4.5 | One install page implementation behind the three role routes. | `src/shared/pages/PWAInstallPage.tsx` |
| 4.2 | Placement Pack: cover letter, LinkedIn About and interview prep for a real posting, plus a readiness column for the placement cell. | `docs/RESUME_BUILDER.md` §6b |
| 4.3 | The 584 kB PDF libraries left the first page load, and the attendance register now prints on the server as a text PDF with the browser path kept as fallback. | §12 below |

**Gates at hand-off:** functions 1013/1013, root 497/497, render check 382/382, `tsc` clean
(root and `functions/`), production build clean.

## 11.1 Your action list (all six, in order)

1. **D1 is still the only decision blocking the biggest saving** — pick the fast tier:
   `gemini-2.5-flash-lite` (₹ cheaper today, retired by ~20 Oct 2026) or
   `gemini-3.1-flash-lite` (available now, ₹0.25/₹1.50 per M). Until you pick one, the
   code ships with both in the list and 2.5 first. One env var, no code change:
   `GEMINI_MODEL_FAST` on the functions (`docs/HANDOFF_OPTIMISATION_2026-09-25.md` §D1).
2. **Deploy order matters for 4.4.** The `pdf` function is new, so it must exist before
   the web app points at it:
   ```powershell
   firebase deploy --only functions,pdf --project vriddhi-engineering   # or --only functions
   ```
   `--only functions` deploys every function in the codebase including `pdf`. Confirm the
   `pdf` function's URL appears, then deploy hosting. If the URL is not live, the client
   falls back to the `api` host for downloads (old path stays alive one release).
3. **Rules must ship with 4.1 / 3.4 / 3.5** — `aiContentCache`, `prep_paper_answers` and
   `prep_mcq_sets` are in `current-firestore.rules` already; deploy
   `firestore:rules` in the same release as the functions. Students must never read the
   cache or an unpublished answer.
4. **Announce the attendance % definition (D4)** before the next publish: it is now
   present + on-duty + late over total. One line to students and one to faculty.
5. **D5 orphan cleanup** — 14 unused collections, zero references. Export them, wait the
   30 days with no traffic, then delete.
6. **D6 is not a task, it is the contract** — the ₹36,853 read figure must be verified
   against the spreadsheet before anyone calls the read saving real.
7. **Smoke test for the new surfaces (10 minutes):**
   - Student → Resume Builder → *Placement Pack* → paste a posting → the letter lands in
     the editable box (nothing is written into the resume), the AI counter drops by one,
     Copy works.
   - Admin → Placement cell (or `GET /resume/admin/placement-stats?format=csv`) → rows
     with readiness bands and a working CSV download.
   - Student/faculty → Study material → generate the SAME topic twice: the second call
     returns `source: "cache"` in the response and reaches no model.
   - Prep Studio → review one model answer → publish → the student's paper view shows it
     with the "AI-generated, reviewed" label.
   - Download a paper PDF and a resume PDF: both must be served by the `pdf` function
     host, not `api`.
   - Student → PWA install page → copy says "student"; admin → admin copy.

## 11.2 What is deliberately left

* **2.3 (dead-path removal)** stays an operator job: the 14 names are listed in
  `docs/HANDOFF_OPTIMISATION_2026-09-25.md` and none of them is referenced by code. Deleting
  them is a console action after the D5 waiting period, not a code change.
* **4.3, second half** — the PDF libraries are lazy and the attendance register is
  server-rendered (§12). The other four documents (finance reports, payslips, barcode
  labels, no-dues certificate) still draw in the browser; §12.2 lists them in the order I
  recommend doing them, and why the next one needs your eyes on the parity check.
* Nothing in this release auto-publishes anything a student reads. Drafts stay drafts until
  a human reviews them; the review screen is the only publish path.

---

# 12. Item 4.3 — the PDF stack, and what is left of it

*(2.3 needs no code: it is the one-line `firebase functions:delete` in
`docs/HANDOFF_OPTIMISATION_2026-09-25.md` §2.3, and it must not run until the Cloud Run
console shows 0 requests over 30 days for all 14 services. The source stays in git, so the
rollback is a redeploy if an old client turns out to still call one.)

The plan's 4.3 wanted one PDF stack, server-rendered text PDFs, and the removal of
`jspdf` + `html2canvas` from the client. Here is exactly where that stands, because part of
it is finished and part of it is a decision for you.

## 12.1 Done — the libraries are no longer on the first-page path

`jspdf` + `html2canvas` are 584 kB. They used to be preloaded by `index.html` for **every**
visitor, including the ones who never download anything: one stray `import jsPDF from 'jspdf'`
was enough to put the chunk in the entry graph, and Vite helpfully added a
`<link rel="modulepreload">` for it.

* `src/shared/utils/pdfRuntime.ts` is now the **only** module that loads them
  (`loadPdfLibs()`), and it does so with a dynamic `import()` inside the click that needs a
  PDF. A failed load is deliberately not cached, so a flaky connection retries instead of
  failing for the rest of the session; `preloadPdfLibs()` exists for hover-warming a page
  whose primary action is an export.
* Every consumer goes through it: `pdfGenerator` (paper/question previews),
  `attendanceExport`, `financePdf` (payslips, receipts, guest bills, salary certificates),
  `labelsPdf` (library/asset barcode sheets), `reportPdf` (library, inventory, finance
  reports) and `noDuesApi` (no-dues certificate). `downloadAttendanceReport` became async
  because of it — its three call sites await inside their existing try/catch.
* `vite.config.ts` filters the chunk out of `modulePreload` (`resolveDependencies`) — without
  it Vite still emitted a preload link for it and the saving would have been zero.
* `src/shared/utils/pdfRuntime.test.ts` (6 tests, in `test:unit`) covers the caching and
  retry contract **and** greps the source tree so no future file can reintroduce a static
  import — a bundle mistake is invisible in review, so it is a test instead.

Verified by the build, not by reasoning: before, `dist/index.html` contained
`<link rel="modulepreload" href="/assets/pdf-….js">` and the entry chunk imported it; after,
the reference count is 0 and the chunk is reached only by `import("./pdf-….js")` at the
moment of use. The service worker still precaches the chunk in the background
(`globPatterns: **/*.js`) so offline exports keep working — that download is off the
critical path and does not block first paint. If you would rather never fetch it at all,
exclude `pdf-*.js` from the precache and accept that the first export needs the network.

## 12.1b Done — the attendance register prints on the server (with the old path intact)

The first document is migrated, chosen because it is the most-used export and a plain
table:

* `POST /pdf/attendance/register/pdf` — the client posts the report it already built
  (title, subtitle, sheets of headers + rows) and gets a text PDF back. It renders what it
  is given and **reads nothing from Firestore**, so there is no second copy of the
  attendance visibility rules to keep in step, and no data migration if the route changes.
* The HTML builder (`functions/src/reports/attendanceRegister.ts`) is pure and validated
  *before* Chrome starts: max 4 sheets, 8,000 rows, 16 columns, 300 characters per cell,
  rows padded or trimmed to the header width, every cell escaped. 18 tests in
  `functions/test/attendanceRegister.test.ts` cover exactly the things that would ruin a
  printed register — an injected `<img onerror>` in a student name, a skewed table, or a
  report big enough to hold a 2 GiB instance for a minute.
* Client (`src/shared/utils/serverReportPdf.ts`, 12 tests): 503 (renderer cold), 429 (rate
  limit), 400/401/403, a hosting rewrite answering with the SPA shell, a 0-byte body, a
  timeout and a dead network all resolve to `{ kind: 'fallback' }` — the browser draws the
  sheet with jsPDF exactly as it does today. **Nothing in the new path can fail a download
  that used to work**; the worst case is a couple of seconds slower. `reportPdfLimiter`
  (10/min per user) sits in front of the route for the same reason.
* Verified on the branch: functions 1013/1013, root 497/497, render 382/382, both tsc clean,
  build clean, and `dist/index.html` no longer references the PDF chunk at all.

**Your parity check (the plan's own condition)** — after deploying, open Admin → Attendance,
export PDF for one month, and compare it with the same export from a browser that fell back
(the console prints one warning line when it does). Check the three things that differ by
nature: the header band, whether column widths still suit your longest student name, and the
page footer ("Page 2 of 7"). If it matches, the next release can drop the browser path for
this document; if it does not, tell me which part and I will adjust the HTML — the jsPDF path
stays either way until you say so.

**Deploy note:** the route lives on the `pdf` function, so the deploy in §11.1 step 2 covers
it. No new collection, no rules change, no index.

## 12.2 Not done — moving each document to a server-rendered text PDF

The plan named `functions/src/utils/pdfRenderer.ts` as the template for the remaining
documents. Two facts decide how this should be finished, and they are yours to weigh:

1. **The renderer launches Chrome** (that is why 4.4 gave the `pdf` function 2 GiB and a
   120-second timeout). A payslip or a barcode label sheet that today renders in ~200 ms in
   the browser would come back in seconds, and every export would hold a Chrome instance.
   Cheap in money, visible in latency, and it needs the network.
2. **Each document is a hand-laid-out drawing** (`labelsPdf` draws Code 39 bars, `reportPdf`
   lays out letterhead tables, `financePdf` draws payslip columns). Re-drawing them in
   server HTML is a rewrite per document with a parity risk that only your eyes can settle —
   the plan's own condition is "keep the client path as fallback until parity is verified per
   document".

Recommendation, in this order:

| Order | Document | Why first |
| --- | --- | --- |
| 1 | Attendance register export (`attendanceExport`) | Widest use, plain table, and the sheet is already a plain data model — the HTML template is mechanical |
| 2 | Finance reports + payslips (`reportPdf`, `financePdf`) | Needed for archives that must be reproducible years later; low volume |
| 3 | Barcode label sheets (`labelsPdf`) | Highest drawing risk; client rendering is genuinely better here |
| 4 | No-dues certificate (`noDuesApi`) | Signable document; server side is where signatures should live |

Getting to 4.3's "delete `jspdf` from the client" finish line means doing 1–4 with a
side-by-side comparison each time. Say the word and I will start with the attendance
register: server route on the `pdf` function, client falls back to today's path until you
have compared both outputs on one real sheet.
