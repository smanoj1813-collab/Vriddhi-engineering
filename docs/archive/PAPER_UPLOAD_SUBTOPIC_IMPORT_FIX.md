# Paper Upload: Sub-Topic Questions Import as ONE Question

**Date:** 2026-09-28
**Area:** `functions/src/paperParsing.ts` (paper upload → parse → confirm),
`functions/src/questionImport.ts` (superadmin bulk **Import papers (ZIP / PDF)**
→ Review Queue), shared rules in `functions/src/subpartMerge.ts`

## Problem

University question papers (e.g. the OE-code open-elective papers such as
`BHSCDSC-1 [OE-235]`, `BHSDSC-A1 [OE-234]`, `BMBDSC-1 [OE-230]`,
`BMDSC-1 [OE-226]`) print **one question that carries several sub-topics**:

```
Q.1. (A) Define Business Environment.
     (B) Explain the features of Business Environment.
     (C) What do you mean by Economic Environment ?
     (D) Describe the objectives of Business Environment.
```

The old parser surfaced every sub-topic as its **own** question (or, in some
layouts, dropped them entirely, or mis-read them as MCQ options) instead of
importing **1 question consisting of all sub-topics**.

### Failure modes that were fixed

| Printed layout | Old behaviour | New behaviour |
| --- | --- | --- |
| `1. Answer the following :` + `1) … 2) … 3) …` | 4 individual questions | 1 question, markers restored, marks summed |
| Number alone on a line, then `(A)…(D)` (table exports) | questions dropped entirely | 1 question per number, all sub-topics kept |
| `A) Define … B) Explain …` under a stem | mis-read as MCQ options | kept as sub-topics, typed short/long answer |
| Long compound questions | truncated at 600 chars (later sub-topics lost) | 3000-char budget for compound questions |
| Gemini fallback splitting sub-parts | stayed split | server-side merge re-combines them |

## How it works now

1. **Compound-question detection** — a question whose text contains a
   sub-topic marker (`(A)`, `a)`, `(i)` …) is marked *compound*. Structured
   sub-topic continuation lines count towards layout coverage (so these papers
   parse deterministically, no AI cost) and enjoy the wider 3000-char budget.
2. **Option guard** — a lettered line that starts with a question verb
   (`Define`, `Explain`, `Discuss`, …) or carries its own printed marks
   `(5M)` is a sub-topic, never an MCQ option.
3. **Merge pass** (runs on BOTH the deterministic and the Gemini output):
   - anything starting with `(b)` / `b)` / `(ii)` always joins the previous
     question — a standalone question never starts that way;
   - a first marker `(a)` / `(i)` joins only when the previous question opens
     a group ("Answer the following :", already carries markers …) and its
     marker chain hasn't reached this marker yet — so a fresh `(A)…` question
     after a finished `(A)…(D)` group stays separate;
   - numbered drafts (`1) 2) 3)`) merge only as a consecutive chain opened by
     an "Answer the following"-style question, so papers numbered `1) 2) 3)`
     at the top level stay intact;
   - marks of merged sub-parts are **summed**; nothing is ever invented.

## Superadmin: Universal Question Bank → Import papers (ZIP / PDF)

The same grouping now applies to the platform-wide bulk import
(`SuperAdminQuestionBank` → *Import papers (ZIP / PDF)* → Review Queue →
approve into the universal bank):

1. **Printed parts become visible text** — the import schema already asked the
   model for `parts`, but the Review Queue and pool cards render only `text`,
   so sub-topics were invisible. `normalizeImportedQuestions` now folds the
   printed parts into the question text: one row shows the stem **and** all
   its sub-topics.
2. **AI splits are re-combined** — `mergeImportedSubparts` (same rules as the
   paper-upload parser, shared from `subpartMerge.ts`) joins entries that
   start with `(b)` / `b)` / `(ii)` etc. back into their parent question and
   sums the sub-part marks. A fresh `(A)…` group after a finished one stays a
   separate question.
3. A warning reports how many sub-topic entries were joined, and the joined
   sub-topics are also kept in `parts` / `importParts` for structure.

## How to import the 4 OE papers exactly as printed

1. Faculty/Admin portal → **Question Papers** → **Upload paper**.
2. Fill in the paper record (title, subject, semester…) and attach the PDF
   (digital PDF/DOCX — scanned images are not parseable yet).
3. Click **Parse file**. The server reads the layout deterministically and
   shows each question with all its sub-topics inside one row — review the
   text and marks (per-sub-part marks are summed automatically).
4. **Save / Submit**. The one server-side Confirm writes the questions to the
   bank and marks the paper online-ready — one bank document per printed
   question, sub-topics included in its text.

If a paper's layout is unusual enough to fall back to Gemini, the same merge
pass still re-combines split sub-topics, and the faculty review step remains
the source of truth before anything is saved.

**Superadmin variant:** Super Admin Portal → Question Bank → *Import papers
(ZIP / PDF)* → drop the paper(s) → the job drafts them as `pending` → Review
Queue tab → approve each grouped question → it joins the universal bank as
ONE question with all sub-topics.

## Tests

`functions/test/paperParsing.test.ts` — new suites:

- `deterministic parse keeps sub-topics inside their parent question`
  (compound `(A)…(D)` groups, numbered `1) 2) 3)` chains, lettered `a)…d)`
  groups, table layouts, directive lines not treated as options, separate
  `(A)…` questions staying separate)
- `mergeSubpartQuestions (AI output re-combines split sub-topics)`

Full functions unit suite: **1040/1040 passing**.
