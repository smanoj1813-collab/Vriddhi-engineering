# Scheme Packs for B.E. / B.Tech

How the existing (G1) scheme-pack system is extended to cover engineering
colleges without forking a single line of evaluation logic.

## Where we started

G1 already solved the hard half of the problem for Karnataka's non-tech
universities. `src/shared/types/schemePack.ts` + `src/shared/utils/schemeEngine.ts`
express one university's scheme of examination as data — attendance slabs, IA
composition, pass bars, grade table, SGPA — and ship three presets:
`BCU_SEP_2024`, `KUD_NEP_CBAE`, `GENERIC_NEP_2020`. `bcuCompliance.ts` keeps
its old API as thin wrappers, so every existing screen is unchanged.

**So engineering does not need a second engine.** It needs the five things a
non-tech scheme of examination has no vocabulary for.

## What engineering adds

| Gap | Non-tech reality | Engineering reality |
| --- | --- | --- |
| Course types | one "standard" course | theory 50:50, lab 50:50, project 50:100, seminar internal-only |
| Heads of passing | one aggregate bar | VTU passes theory and practical **separately** |
| Paper vs. marks | 80 is 80 | VTU sets a **100-mark paper, scaled to 50** |
| Grading | absolute grade table | autonomous institutions **curve** the cohort |
| Outcomes | not applicable | NBA/OBE **CO → PO attainment** |
| Eligibility | attendance alone | VTU also bars anyone below **40% CIE** from the SEE |

All five live in one optional block on the pack:

```ts
engineering?: {
  courseTypes?: Record<string, SchemeCourseTypeWeightage>
  grading?: { method: 'absolute' | 'relative'; relativeBands?; minCohortSizeForRelative? }
  percentageConversion?: { expression: string; note?: string }
  paperTemplate?: SchemePaperTemplate
  attainment?: SchemeAttainmentRules
}
```

**It is optional.** Every non-tech pack omits it, and the G1 engine keeps
returning exactly the numbers it returns today. A test pins that:
"non-tech parity — engineering must not move existing numbers".

## The two packs added

| Pack | For | Shape |
| --- | --- | --- |
| `VTU_2022_BE_BTECH` | VTU-affiliated B.E./B.Tech | CIE 50 + SEE 50 (paper 100 → 50), three bars: CIE ≥ 40% to sit, SEE ≥ 35%, aggregate ≥ 40%. Absolute S/A/B/C/D/E/F. `VTU_10Q_5MODULES_20M` paper. |
| `AUTONOMOUS_ENGINEERING_5050` | Autonomous institutions | 50:50, **relative** grading by cohort percentile with an absolute pass floor, sectioned paper (A/B/C), NBA attainment on. |

Unknown course types fall through to `_default`, so `CSE AIML`, `CSE IoT`,
robotics or any branch added next year is covered without a code change — the
same "no hardcoded branches" rule the rest of the product follows.

## New module: `src/shared/utils/engineeringScheme.ts`

| Function | Answers |
| --- | --- |
| `getCourseWeightage(courseType, pack)` | how does this course split internal/external? |
| `isInternalOnlyCourse(courseType, pack)` | does this course even have a university exam? |
| `scaleSemesterEndMarks(raw, pack)` | the paper was 100 marks — what counts? |
| `isEligibleForEndSemester(internalPct, pack)` | may this student sit the SEE at all? |
| `checkHeadsOfPassing(heads, pack)` | did every head clear, separately? |
| `getSchemeGrade({ percentage, percentile, cohortSize }, pack)` | curve or table, and the floor wins |
| `calculateAttainment(input, pack)` | CO levels → PO roll-up (NBA 80/20) |
| `generateSchemePaper(questions, pack)` / `validateSchemePaper` | build a valid paper for this university |

Every function takes the pack as its last argument and defaults to
`DEFAULT_SCHEME_PACK`, matching the G1 engine's calling convention.

## Why the grade floor matters

VTU's regulations say pass = 40% aggregate, but VTU's own grade table awards
the pass grade **E only at ≥ 50%**. Hardcoding either number is wrong for
somebody. Percentage conversion is batch-scoped too: `CGPA × 10` for the
2022 batch onwards, `(CGPA − 0.75) × 10` for 2015/17/18. Both live in the
pack so a college can correct them without a release.

## Verification of sources

VTU numbers come from the *VTU (Award of B.E./B.Tech Degree) Regulations 2022*
(22OB 4.2 CIE, 22OB 6.3 passing standards, 22OB 6.1 absolute grading), and the
source note on each pack records exactly where it came from. Anything marked
`sourceNote` is a template — a college-specific pack replaces the defaults, it
does not edit the code.
