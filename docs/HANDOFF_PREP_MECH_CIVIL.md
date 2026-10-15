# Handoff: build the Mechanical (ME) and Civil (CV) Prep study packs

Written 2026-10-15 at the end of the session that delivered the ECE and EEE packs. Read this top to bottom before touching code; it contains everything the next session needs, including the verified scheme codes, the exact file pattern, the registration sites, the test template, the CI loop and the gotchas that cost time last round.

---

## 0. Where things stand

| Item | State |
| --- | --- |
| PR #9 | https://github.com/smanoj1813-collab/Vriddhi-engineering/pull/9 — branch `arena/3cd68a29-vriddhi-engineering`, head `003a25a`, CI green, **awaiting merge by the user**. Contains: CI fix for #8, ECE pack, EEE pack, engineering-only public hub. |
| Production | `api` function + hosting deployed from `a5501ec`; ECE and EEE seeded into Firestore via Prep Studio. `003a25a` (hub change) is frontend-only and still needs `npm run deploy:hosting` after merge. |
| User decision | Build **Mechanical first, then Civil**, each at full ECE/EEE parity: 15 theory cores + 4 PCC labs + 1 unsemestered supplement = **20 packs / 100 units / 100 MCQs** per branch. Options (ESC/AEC/PE) are NOT seeded (titles unverifiable). |
| Next session branch | A new Arena branch off `main`. **If #9 is not yet merged, the new branch must be based on (or merge in) `arena/3cd68a29-vriddhi-engineering`**, otherwise `engineeringSeedHelpers.ts` and the `eee`/`ece` registrations will be missing. Check with `git log --oneline -1 origin/main` vs `003a25a`. |

Standing user constraints from this session:
- Mirror the CSE/ECE/EEE structure exactly ("just like we did for CSE").
- Public hub shows only engineering programs (BCA, CSE, ECE, EEE — add `me`, `cv` to `PUBLIC_PROGRAM_CODES`).
- Deploy only the changed function (`firebase deploy --only functions:api`) — the user hits CPU quota on full deploys.
- One command at a time when walking the user through pull/deploy.

---

## 1. Verified VTU 2022 scheme (single mirror — say so in the scope doc)

Source: `chocofixxx69/gradeflow` → `lib/vtu-curriculum-catalog.js` (fetch with `gh api repos/chocofixxx69/gradeflow/contents/lib/vtu-curriculum-catalog.js -H "Accept: application/vnd.github.raw"`). It was accurate for every ECE code and title (which had five corroborating mirrors), but for EEE/ME/CV it is the **only** source. vtu.ac.in is unreachable from the sandbox. No second mirror covers ME/CV; do not spend time hunting (GitHub code search is rate-limited, other repos tried were useless).

**Neither ME nor CV has a separate Semester-3 mathematics course in this mirror** (unlike ECE's BMATEC301 and EEE's BEE301). The first BXX301 is a core subject.

### Mechanical Engineering — seed these 19 + supplement

| Sem | Code | Title (mirror string, normalised) | Cr | Pack role |
| --- | --- | --- | --- | --- |
| 3 | BME301 | Mechanics of Materials | 3 | core, order 1 |
| 3 | BME302 | Manufacturing Process | 4 | core (IPCC by credit pattern), order 2 |
| 3 | BME303 | Material Science and Engineering | 4 | core (IPCC), order 3 |
| 3 | BME304 | Basic Thermodynamics | 3 | core, order 4 |
| 3 | BMEL305 | Introduction to Modelling and Design for Manufacturing | 1 | lab, order 5 |
| 4 | BME401 | Applied Thermodynamics | 3 | core, order 1 |
| 4 | BME402 | Machining Science and Metrology | 4 | core (IPCC), order 2 |
| 4 | BME403 | Fluid Mechanics | 4 | core (IPCC), order 3 |
| 4 | BME404 | Mechanical Measurements and Metrology Lab | 1 | lab, order 4 — **note: code has no "L"** |
| 5 | BME501 | Industrial Management and Entrepreneurship | 3 | core, **stream 'management'**, order 1 |
| 5 | BME502 | Turbo Machines | 4 | core, order 2 |
| 5 | BME503 | Theory of Machines | 4 | core, order 3 |
| 5 | BME504L | CNC Programming and 3-D Printing Lab | 1 | lab, order 4 — **note: trailing "L"** |
| 6 | BME601 | Heat Transfer | 4 | core, order 1 |
| 6 | BME602 | Machine Design | 4 | core, order 2 |
| 6 | BMEL606L | Design Lab | 1 | lab, order 3 — **note: "L" both sides** |
| 7 | BME701 | Finite Element Methods | 4 | core, order 1 |
| 7 | BME702 | Hydraulics and Pneumatics | 4 | core, order 2 |
| 7 | BME703 | Control Engineering | 4 | core, order 3 |
| — | (none) | Foundations of Mechanics, Materials and Thermal Science (suggested) | — | supplement, order 900, `scopeNote` |

Not seeded (list in scope doc "omissions"): BME306X/BME405X ESC, BME358X/BME456X AEC, BME515X/613X/714X PE, BME654X/755X OE, BME657X, BME586 mini project, BME685/786 projects, BME801X/802X/803 (Sem 8), BNSK/BSCK/BBOK/BUHK/BRMK/BESK/BIKS common courses.

Because of the irregular lab codes, the EEE-style test `courseCode?.startsWith('BEEL')` does not transfer. Use an explicit list: `['BMEL305', 'BME404', 'BME504L', 'BMEL606L']`.

### Civil Engineering — seed these 19 + supplement

| Sem | Code | Title (mirror string, normalised) | Cr | Pack role |
| --- | --- | --- | --- | --- |
| 3 | BCV301 | Strength of Materials | 3 | core, order 1 |
| 3 | BCV302 | Engineering Survey | 4 | core (IPCC), order 2 |
| 3 | BCV303 | Engineering Geology | 4 | core (IPCC), order 3 — mirror string is the garbled `TD- Geology/CV PSB-Geology/CV`; "Engineering Geology" is the standard VTU title, **flag as inferred** |
| 3 | BCV304 | Water Supply and Waste Water Engineering | 3 | core, order 4 |
| 3 | BCVL305 | Computer Aided Building Planning and Drawing | 1 | lab, order 5 — mirror also lists a duplicate `BCV305`; use **BCVL305** |
| 4 | BCV401 | Analysis of Structures | 3 | core, order 1 |
| 4 | BCV402 | Fluid Mechanics and Hydraulics | 4 | core (IPCC), order 2 |
| 4 | BCV403 | Transportation Engineering | 4 | core (IPCC), order 3 |
| 4 | BCVL404 | Building Materials Testing Lab | 1 | lab, order 4 |
| 5 | BCV501 | Construction Management and Entrepreneurship | 3 | core, **stream 'management'**, order 1 |
| 5 | BCV502 | Geotechnical Engineering | 4 | core, order 2 |
| 5 | BCV503 | Concrete Technology | 4 | core, order 3 |
| 5 | BCVL504 | Environmental Engineering Lab | 1 | lab, order 4 — mirror also lists duplicate `BCV504`; use **BCVL504** |
| 6 | BCV601 | Design of RCC Structures | 4 | core, order 1 |
| 6 | BCV602 | Irrigation Engineering and Hydraulic Structures | 4 | core, order 2 |
| 6 | BCVL606 | Software Application Lab | 1 | lab, order 3 |
| 7 | BCV701 | Design of Steel Structures | 4 | core, order 1 |
| 7 | BCV702 | Estimation and Contract Management | 4 | core, order 2 |
| 7 | BCV703 | Prestressed Concrete | 4 | core, order 3 |
| — | (none) | Foundations of Mechanics, Materials and Surveying (suggested) | — | supplement, order 900, `scopeNote` |

Not seeded: BCV306X/405X ESC, BCV358X/456X AEC (incl. BCVL456A BIM), BCV515X/613X/714X PE, BCV654X/755X OE (mirror shows BEE654B Renewable Energy under CV Sem 6 OE), BCV657X (incl. BCVL657A BIM Advanced), BCV586 Mini Project / Extensive Survey Project, BCV685/786, Sem 8, common courses.

Civil labs all start with `BCVL`, so `startsWith('BCVL')` works for the test.

**Design-code caveat for Civil (and ME Machine Design):** BCV601 RCC (IS 456:2000), BCV701 Steel (IS 800:2007), BCV703 PSC (IS 1343:2012), BCV503 Concrete (IS 10262 mix design), BME602 Machine Design (design data handbook). Write these as method/principle outlines, quote clause numbers sparingly and only the well-known ones, and say in the scope doc that code clauses must be checked against the current edition. The user was told ME/CV content needs more careful faculty review than EEE.

---

## 2. The pattern (copy EEE exactly)

Per branch, create these files under `functions/src/data/`:

| File | Content | EEE reference to copy |
| --- | --- | --- |
| `meSeedHelpers.ts` / `cvSeedHelpers.ts` | profile + positional `meModule`/`cvModule` constructor + `buildMeCatalog` | `eeeSeedHelpers.ts` (12 lines change: program, label, stream, icon, publishedAt) |
| `meSeedData.ts` / `cvSeedData.ts` | aggregator; exports `ME_COURSE_SEEDS`, `ME_SUBJECTS`, `SEEDED_ME_TOPICS`, `SEEDED_ME_QUESTIONS` | `eeeSeedData.ts` |
| `meCoreSemester3.ts` | 4 cores (301–304) | `eeeCoreSemester3.ts` |
| `meCoreSemester4.ts` | 3 cores | `eeeCoreSemester4.ts` |
| `meCoreSemester5.ts` | 3 cores (501 with `stream: 'management'`) | `eeeCoreSemester5.ts` |
| `meCoreSemesters6to7.ts` | 5 cores | `eeeCoreSemesters6to7.ts` |
| `meCoreLabsAndSupplement.ts` | 4 labs + supplement | `eeeCoreLabsAndSupplement.ts` |

Profile suggestions:
```ts
// ME
{ program: 'me', label: 'ME', stream: 'mechanical', icon: 'Settings', publishedAt: '2026-10-16T09:00:00.000Z', schemeTag: 'candidate-vtu-2022-map' }
// CV
{ program: 'cv', label: 'Civil', stream: 'civil', icon: 'Landmark', publishedAt: '2026-10-16T12:00:00.000Z', schemeTag: 'candidate-vtu-2022-map' }
```
`icon` is a free string (never rendered as a component). Program codes `me`/`cv` match the mirror's branch codes; use lowercase everywhere.

### Contract every module must satisfy (enforced by `validatePrepCatalog` + the tests)
- Exactly **5 modules** per course; `moduleNumber` 1–5 in order.
- **≥ 4 subtopics** per module; each brief **≥ 20 chars** (aim 150–300 chars, one or two sentences of real content).
- One `question` per module: `answer` first, exactly 3 distractors, explanation.
- `keyModel` (one line of formulas/relations), `workedExample` (numeric, closed), `examTip`.
- IDs: subject `me-vtu22-<slug>`, module `me-<abbr>-mN-<slug>`, supplement `me-foundations-<slug>` (no `courseCode`, `order: 900`, `scopeNote`). Abbrs must be unique within the branch; cross-branch collisions are prevented by the `me-`/`cv-` prefix (a test checks against CSE+ECE+EEE anyway).
- Course `description` must contain the literal `'IPCC'` for the 4-credit integrated cores and `'college lab sheet'` for labs (tests grep for these).
- Semester → yearGroup is automatic (3–4 → 2nd-year, 5–6 → 3rd-year, 7 → 4th-year).

### Writing budget (what worked)
Each content file is ~25–35 KB. Write one file per `write_file` call, then immediately grep for half-finished sentences (last round left `…` and "corrected after noting" fragments in two worked examples). Run the check script (§4) after every file.

---

## 3. Registration sites (do all of these for each new program/stream)

Last round this was a Python `str.replace` batch; the exact anchors as of `003a25a`:

| File | Edit |
| --- | --- |
| `functions/src/prepShared.ts` | `PrepStream` union: add `\| 'mechanical'` / `\| 'civil'` after `'electrical'`; `PREP_PROGRAM_CATALOG`: add `{ code: 'me', label: 'ME', degreeLevel: 'undergraduate', fullName: 'Bachelor of Engineering / Technology in Mechanical Engineering' }` after `eee` (and `cv` / `'Civil'` / `…in Civil Engineering`); update the two comment lines listing programs. |
| `functions/src/routes/prep.ts` | import block after the `eeeSeedData` import; `withUniversalSupplement('me', 'ME', ME_SUBJECTS, SEEDED_ME_TOPICS, SEEDED_ME_QUESTIONS),` after the `eee` line. |
| `functions/src/data/aptitudeShared.ts` | `ALL_PROGRAMS`: `'eee', 'me', 'cv', 'mba'`. |
| `functions/src/data/universalAcademicSupplement.ts` | `ALL_PROGRAMS` same; line ~55 `programs: ['bsc', 'bca', 'mca', 'cse', 'ece', 'eee', 'me', 'cv']` (Science Reasoning for tech programs). |
| `scripts/prep-import-lib.mjs` | `PREP_PROGRAM_CODES` add `'me', 'cv'` (a parity test compares this to `PREP_PROGRAM_CATALOG`); `else if (compact === 'me') program = 'me'` and `cv` after the `eee` line — beware `me` is a short token, check `guessPaperMetadata` doesn't mis-fire on filenames; add a unit case in `scripts/prep-import-lib.test.mjs` if it does. |
| `src/modules/prep/prepPublicShared.tsx` | `PROGRAMS`: add `{ code: 'me', label: 'ME', level: 'undergraduate' }`, `{ code: 'cv', label: 'Civil', level: 'undergraduate' }` after `eee`; `PUBLIC_PROGRAM_CODES = ['bca', 'cse', 'ece', 'eee', 'me', 'cv']`; `STREAM_COLORS`: `mechanical: '#475569'` (slate-600), `civil: '#92400e'` (amber-800) or similar; `AUDIENCE_LABELS.tech` string. |
| `src/modules/admin/components/PrepContentStudioTab.tsx` | `{ code: 'me', label: 'ME (candidate VTU core pack)' }`, `{ code: 'cv', label: 'Civil (candidate VTU core pack)' }` after `eee`. |
| `src/shared/utils/prepHelpers.ts` + `.test.ts` | `formatStreamLabel` mapping: `mechanical: 'Mechanical & Thermal'`, `civil: 'Civil & Structural'`; add asserts next to the `electrical` one. |
| `src/shared/services/prepContentService.ts` | `stream:` union add `\| 'mechanical' \| 'civil'`. |
| `functions/test/prepCatalog.test.ts` | import line after the `eeeSeedData` import; new `describe('candidate ME Prep study pack')` block before `describe('question mapping'` — copy the EEE block (7 tests) and change: counts (22/108/108 route bundle, 20/100), supplement id, management code (`BME501`), stream (`'mechanical'`), `expectedBySemester` table, IPCC code list (`BME302, BME303, BME402, BME403`), lab code list (explicit for ME), the no-options regex (`/^BME[34]0[56]/`). |
| Scope doc | `docs/PREP_ME_CONTENT_SCOPE.md` / `docs/PREP_CV_CONTENT_SCOPE.md` — copy `docs/PREP_EEE_CONTENT_SCOPE.md` structure (status, what is in, streams/options/IPCC, verification table, omissions). Say explicitly: single mirror, no official PDF, module maps curator-authored, IS-code caveat, the BCV303 title inference and the duplicate BCV305/BCV504 entries. |

`scripts/render-check/run.mjs` fixtures list neither `cse` nor `ece`/`eee` — leave alone.

---

## 4. Check script (run after every content file)

Save as `/tmp/pack-check.ts` and run with `cd functions && npx tsx /tmp/pack-check.ts` (replace `ME`/`me` as needed):

```ts
import { ME_COURSE_SEEDS, ME_SUBJECTS, SEEDED_ME_TOPICS, SEEDED_ME_QUESTIONS } from '/home/user/<repo>/functions/src/data/meSeedData.ts'
import { CSE_SUBJECTS, SEEDED_CSE_TOPICS, SEEDED_CSE_QUESTIONS } from '/home/user/<repo>/functions/src/data/cseSeedData.ts'
import { universalAcademicSupplementFor } from '/home/user/<repo>/functions/src/data/universalAcademicSupplement.ts'
import { validatePrepCatalog } from '/home/user/<repo>/functions/src/prepShared.ts'
import { createHash } from 'node:crypto'
const sup = universalAcademicSupplementFor('me')
const bundle = { programCode: 'me', subjects: [...ME_SUBJECTS, ...sup.subjects], topics: { ...SEEDED_ME_TOPICS, ...sup.topics }, questions: [...SEEDED_ME_QUESTIONS, ...sup.questions] }
const r = validatePrepCatalog(bundle as any)
console.log('valid', r.valid, 'errors', r.errorCount, 'subjects', r.subjectCount, 'topics', r.topicCount, 'questions', r.questionCount)
for (const i of r.issues.slice(0, 20)) console.log(' -', i.code, i.message)
console.log('courses', ME_COURSE_SEEDS.length, 'subjects', ME_SUBJECTS.length, 'questions', SEEDED_ME_QUESTIONS.length)
const thin: string[] = []
for (const s of ME_SUBJECTS) for (const t of SEEDED_ME_TOPICS[s.id]) { if ((t.subtopicDetails?.length ?? 0) < 4) thin.push(t.id + ' <4 subs'); for (const d of t.subtopicDetails ?? []) if (d.briefMd.trim().length < 20) thin.push(d.id) }
console.log('thin', thin)
const bySem: Record<string, string[]> = {}
for (const s of ME_SUBJECTS) (bySem[s.semester ?? 'none'] ??= []).push(`${s.order}:${s.syllabusRef?.match(/· ([A-Z0-9]+) ·/)?.[1] ?? s.id}`)
console.log(bySem)
// Must stay 98ba832d9d5aecfd78311f6666c8f35e7d783164 — proves the shared builder did not change CSE output.
console.log('CSE hash', createHash('sha1').update(JSON.stringify({ CSE_SUBJECTS, SEEDED_CSE_TOPICS, SEEDED_CSE_QUESTIONS })).digest('hex'))
```

Also grep each content file for fragments: `grep -n "…\|corrected after\|TODO\|\.\.\. " functions/src/data/me*.ts`.

---

## 5. CI loop (what GitHub runs; all must pass locally before pushing)

```bash
# one-time
npm ci && PUPPETEER_SKIP_DOWNLOAD=1 npm --prefix functions ci   # Chrome download is blocked in the sandbox
# frontend job
node scripts/check-dead-code.cjs && npm run test:unit && npm run validate:courses && npm run test:render:courses && npm run build
# functions job
npm --prefix functions run build && npm --prefix functions run lint && npm --prefix functions run test:unit
```
Expected baselines at `003a25a`: frontend 847 tests, functions 1419 tests (each new pack block adds 7), builds clean, lint `--max-warnings 0`.

Fast inner loop while authoring: `cd functions && npx tsc --noEmit -p . && node --import tsx --test test/prepCatalog.test.ts`.

---

## 6. Gotchas learned this round

- **`gh pr edit` fails silently** (GraphQL "Projects (classic)" deprecation error) — the PR body silently reverted twice. Use `gh api -X PATCH repos/smanoj1813-collab/Vriddhi-engineering/pulls/<n> -f title=… -F body=@file.md` instead.
- `gh pr checks` right after a push shows the *previous* run; wait ~45 s or compare the run id / `gh run list --branch … --limit 1 --json headSha,conclusion`.
- Downloading Actions logs is blocked from the sandbox; reproduce failures locally.
- `scopeNote` is a valid optional field on `EngineeringCourseSeed` (used by the supplements).
- Don't let `npm audit fix` touch the lockfile.
- The public hub's `ProgramControl` defaults to `PUBLIC_PROGRAMS`; the Papers library passes its own list — leave it.
- Writing all five content files before running anything worked, but one typo fix per file was needed afterwards; grep for fragments before committing.

---

## 7. Delivery sequence (same as last time)

1. Plumbing (registration + helpers + aggregator) → `tsc` passes with empty arrays if you want to compile early.
2. Content files one by one; check script after each.
3. Test block + scope doc.
4. Full CI loop locally, commit with a descriptive message (see `git log -3` for the style), push, wait for GitHub CI.
5. Ask the user whether ME should ride on the same PR as CV or be merged first (last time they chose one PR for everything).
6. Walk the user through, **one command per message**: `git fetch/checkout/pull` → `npm ci` (+ functions) → `npm run test:unit` both → `npm run build:functions` → `firebase deploy --only functions:api --project vriddhi-engineering` → `npm run deploy:hosting` → Prep Studio → tick only the new packs → "Seed N Selected".
7. Verify counts in Studio (ME: 22 subjects / 108 topics with the two universal supplements; same for CV) and the public hub chips.

Deliverables the user expects per branch: the pack in Studio and on the public hub, a green PR, and a scope doc that is honest about the evidence.
