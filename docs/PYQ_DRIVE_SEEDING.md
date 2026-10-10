# Shared original-PDF PYQs — English/Kannada, without university attribution

## What is prepared

The user's public Drive collection is catalogued as **original PDF links**, not
as AI-generated questions or an unverified OCR transcription.

- 175 publicly listed PDF entries were inventoried across BBA, BSW, LANGUAGES,
  OPEN ELECTIVES and UG- OPEN ELECTIVE.
- 153 are included: BBA 27; BSW 26; Languages 10; Open Electives 64; UG Open
  Elective 26.
- Languages includes **4 English and 6 Kannada** papers. Hindi, Sanskrit,
  Telugu and Urdu language-subject entries are excluded. The selection also
  excludes recognised Hindi/Telugu/Urdu elective language subjects (22 excluded
  entries in total). Unknown language subjects within LANGUAGES need review
  rather than being silently included.
- This does not remove, rename or edit the user's Drive files, nor delete any
  existing database rows.
- All **46 eligible MA semester folders** were checked: each returned an
  empty-state page with no public PDF listing. Hindi/Telugu/Urdu MA programme
  folders are excluded by the same language-subject policy. These observations
  do not certify private/unlisted contents as empty. No empty folder is seeded
  as a paper; add actual public MA file entries when available.
- Archives are not also seeded as papers. Identical Drive file IDs are
  deduplicated; filenames shared by different Drive IDs are retained because
  byte-level deduplication cannot be verified without downloading originals.

**University is not assigned.** New file records have blank university fields;
they are omitted from the downloadable compact seed and from university facets
and UI labels. Existing university-attributed, reviewed text papers remain
unchanged. Reviewed text papers can now also omit a university, while all
section/rubric/marks validation remains in force.

The original-PDF mode does not infer exam year/month, scheme, marks, duration or
answers. Its internal numerical unknown value is `0`; the interface and compact
seed omit unknown metadata instead of showing "year 0", "0 marks" or "0
questions". Semester and programme grouping come only from the supplied folder
structure. `language: 'und'` means the script of an untranscribed subject paper
is unknown; it is not automatically labelled English because its filename uses
Latin letters. English/Kannada subject entries have their corresponding tags.

Students get a PYQ card and **Open original PDF**. There is no model-answer or
MCQ generation interface on original-PDF entries. A verified transcription for
a programme supported by the text-paper schema can be saved as a structured
paper with the normal integrity checks; re-seeding will not overwrite it.
Additional paper-only programme categories would need text-schema support before
transcription publishing. No automatic OCR or transcription is part of this seed.

## Files

- `functions/src/data/prepPapers/drivePyqSources.json` — original filenames,
  Drive IDs, folder grouping, 46 MA directory checks and inventory coverage;
  no PDF binaries.
- `functions/src/data/prepPapers/drivePyqFiles.ts` — filtered, expanded bundle.
- `functions/src/prepPaperFiles.ts` — pure selection, ID and preparation helpers.
- `data/pyq/drive-pyq.seed.json` — downloadable compact original-PDF seeds and
  inclusion/exclusion summary. This is an envelope containing `papers`, not a
  single-paper request body.
- `data/pyq/README.md` — generated summary.

Re-generate and validate the exported files offline (no cloud or AI calls):

```powershell
npm run pyq:prepare
```

Do not paste the whole envelope into the Studio's **one-paper JSON** box.
Individual objects from its `papers` array are supported by `POST /prep/papers`
and that editor; for the full prepared batch, use the bundle selector below.

## Deploy (operator, after merging/pulling these changes)

Run one command at a time in PowerShell. Stop if a command fails.

```powershell
git pull --ff-only origin main
npm ci
npm --prefix functions ci
npm run pyq:prepare
firebase deploy --only functions:api --project vriddhi-engineering
firebase deploy --only hosting --project vriddhi-engineering
```

Deployment hooks build Functions and Hosting automatically. Only the `api`
function and frontend changed: no new indexes, rules, collection permissions,
Judge0 configuration or provider keys are required for this feature. Nothing is
seeded by deploying code.

## Seed (explicit Superadmin action)

1. Hard-refresh the app after deployment.
2. Open **Superadmin → Prep Content Studio**.
3. Deselect the other bundles, then select **Shared PYQ PDFs (English / Kannada
   languages)**. This new option is **off by default** in the UI.
4. Click **Seed Selected** and confirm publication of the original file links.
5. Check the returned paper count. First run: 153 entries, assuming none of
   these IDs already exist. Re-running preserves existing rows and adds only
   missing IDs. It never deletes or overwrites reviewed/edited/draft papers.
6. Open **Previous year question papers** or `/prep/papers?program=languages`.
   Confirm the Languages list has only English/Kannada, no university labels,
   and **Open original PDF** reaches the expected paper.

The existing `papers` bundle (50 reviewed, university-attributed text papers)
is separate from the new **`pyq-files`** bundle. Selecting only `pyq-files` does
not re-seed academic subject packs or those older papers. API operators may
request `POST /prep/seed-all` with `{ "programs": ["pyq-files"] }` using their
existing authenticated Superadmin session. `programs: "all"` explicitly selects
all bundles, including these file links.

Source entries use stable SHA-256-derived IDs based on case-sensitive Drive file
IDs. The seeder first checks existing IDs and uses create-only writes, protecting
existing review decisions and preventing duplicate rows. The current bundle
fits within one Firestore write batch when selected alone. Normal Firebase read
and write charges still apply.

Keep the original Drive files publicly readable and downloadable; seeding links
does not copy them into Firebase Storage. If a source file is removed or its
sharing is restricted later, its link can stop working. An archived, licensed
Storage copy can be added in a future step; large raw scans should not enter Git.

## Validation

```powershell
node --import tsx --test functions/test/prepPaperFiles.test.ts functions/test/prepPapers.test.ts src/shared/utils/prepPaperDisplay.test.ts
npm run build:functions
npm run build
```

No production deployment or Firebase seeding is performed by these commands.
