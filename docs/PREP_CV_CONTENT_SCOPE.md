# Prep Studio CV study-pack scope and verification

**Status:** Curator-authored candidate content for Prep Studio. This is not an official VTU publication, a complete Civil Engineering degree syllabus, or a guarantee that a particular college uses this scheme. Students should compare the course codes, lab instructions and exam scope with their current college handout, and **faculty should review the pack before it is recommended to a class** (see "Faculty review before wider use" below).

The CV pack was built to the same contract as the CSE, ECE, EEE and ME packs (see `docs/PREP_CSE_CONTENT_SCOPE.md`, `docs/PREP_ECE_CONTENT_SCOPE.md`, `docs/PREP_EEE_CONTENT_SCOPE.md` and `docs/PREP_ME_CONTENT_SCOPE.md`), and on the **same thin evidence base as EEE and ME**: the official VTU scheme and syllabus PDFs at `vtu.ac.in` were not reachable while this pack was authored, and only **one** student-maintained curriculum mirror covered the Civil scheme. Course codes, titles and credits come from that single mirror; the module-level content inside each course was authored by the curator from standard civil-engineering textbooks and Indian Standards outlines, in VTU's five-module shape. **Treat every module map in this pack as a candidate outline until it is checked against the college's current detailed syllabus.**

## What is in the CV seed pack

The CV-specific seed contains **20 study-pack records, 100 five-part study units and 100 module-linked practice questions**. Each study unit is rendered in the existing Prep format: an explanation, subtopic briefs, a key model, a worked application, an exam tip, a solve method and a question. The module/unit IDs describe the current content, not the university's paper-question IDs.

The candidate map includes:

| Coverage | Included packs |
| --- | --- |
| Semester 3 | BCV301 Strength of Materials, BCV302 Engineering Survey, BCV303 Geology for Civil Engineering (title inferred, see below), BCV304 Water Supply and Waste Water Engineering, and the separate BCVL305 Computer Aided Building Planning and Drawing Lab |
| Semester 4 | BCV401 Analysis of Structures, BCV402 Fluid Mechanics and Hydraulics, BCV403 Transportation Engineering, and the separate BCVL404 Building Materials Testing Lab |
| Semester 5 | BCV501 Construction Management and Entrepreneurship, BCV502 Geotechnical Engineering, BCV503 Concrete Technology, and the separate BCVL504 Environmental Engineering Lab |
| Semester 6 | BCV601 Design of RCC Structures, BCV602 Irrigation Engineering and Hydraulic Structures, and the separate BCVL606 Software Application Lab |
| Semester 7 | BCV701 Design of Steel Structures, BCV702 Estimation and Contract Management, BCV703 Prestressed Concrete |
| Supplemental, unsemestered | Foundations of Mechanics, Materials and Surveying; it makes no VTU course-code or semester claim |

The seed route also adds the existing cross-program Student Toolkit and Science Reasoning supplement to CV (22 subjects / 108 units in the delivered bundle). Those two supplementary packs are not Civil university courses.

### Streams, options and integrated practical work

- **Every CV pack is tagged with the `civil` stream except BCV501**, which is tagged `management` because its content (planning networks, cost control and crashing, contracts, appraisal and entrepreneurship) is management rather than structural material. Its program tag is still `cv`.
- **No ESC/AEC/PE/OE option courses are seeded.** The scheme mirror lists the option slots only as placeholders (`BCV306X` and `BCV405X` "ESC/ETC/PLC", `BCV358X` and `BCV456X` Ability/Skill Enhancement, `BCV515X`, `BCV613X`, `BCV714X` Professional Elective, `BCV654X` and `BCV755X` Open Elective, `BCV657X`, and `BCV801X`/`BCV802X`). Three of the mirror's option-slot entries carry specific titles that were not verified and are **not** seeded: `BCVL456A` "Building Information Modelling in Civil Engineering" (an AEC), `BCVL657A` "Building Information Modelling – Advanced" (an AEC), and `BEE654B` "Technologies of Renewable Energy Sources" (listed under the Civil Semester 6 open-elective slot). A test asserts that no option-pattern code is present.
- **BCVL305, BCVL404, BCVL504 and BCVL606 are separate lab courses**, represented as five Prep study blocks each. The codes are reproduced as the mirror gives them, with the `BCVL` prefix. The blocks organise *typical* exercises and experiments for learning; the college lab sheet defines the official list, and the blocks are not claimed to be official theory modules.
- **The mirror lists duplicate lab entries.** `BCV305` and `BCVL305` both carry the building-drawing title, and `BCV504` and `BCVL504` both carry the environmental lab title. Only the `BCVL` forms are seeded, once each. Confirm with the college whether the duplicate codes are a mirror artefact or a real double listing.
- **BCV302, BCV303, BCV402, BCV403 and BCV502 remain single IPCC course records.** Their practical component is treated as integrated with the theory course, not as an extra course, and their experiment lists are not transcribed. **The IPCC flag is inferred, not read from an official document**: the 4-credit Semester 3 and 4 theory slots (including the Semester 5 "502" slot) are consistent with IPCC status, and the EEE pack treated the same slots the same way. The mirror carries no IPCC marker for any course.
- **BCV501, BCV503, BCV601, BCV602, BCV701–BCV703 are also 4-credit or larger courses but are not flagged IPCC**, with the exception of the management course BCV501 (3 credits). Their descriptions make no claim either way, so a college may still run an integrated practical for some of them.
- **Standards are cited for orientation only.** Where a unit names a standard, only the well-known principle is used. The Indian Standards referred to are IS 456:2000 (BCV601), IS 800:2007 (BCV701), IS 1343:2012 (BCV703), IS 10262 for the concrete mix-design method (BCV503), and IS 10500 for drinking water quality (BCV304). **Clause numbers, table values, partial factors and current editions must be checked against the standard or the college handout before use.** The design courses are written as method and principle outlines with sparse clause citations, not as design codes.

### Design data and worked-example values

- **BCV601, BCV701, BCV703 and BCV503 are written as method-level outlines.** Design-code clauses (limiting neutral-axis depth, partial safety factors, prestress loss formulae, mix-design steps) are quoted only where they are well known, and they are illustrative. **Every factor, table value and clause must be taken from the edition of the code the college prescribes.**
- **BCV602 Irrigation** uses textbook relations (Lacey's regime relations, Bligh's creep theory, the delta–duty relation and the middle-third rule). Creep ratios, silt factors and spillway coefficients are illustrative. State-specific norms and the local authority's design manual govern in practice.
- **Property values in worked examples are rounded textbook values** (water density, steel and concrete moduli, soil unit weights, friction angles, cement and aggregate specific gravities). They are chosen to keep the arithmetic checkable; students should use the values their college and code allow in the examination.
- **Several worked examples are illustrative rather than code-prescribed.** The BCV304 head-loss example, the BCV403 pavement-thickness reading and the BCV601 slab-panel decision use simplified values; they show the method, not a certified design.
- **The BCV303 title is inferred.** The mirror gives only a combined placeholder, "TD- Geology/CV PSB-Geology/CV", which does not name a single course. The title "Geology for Civil Engineering" used here was inferred from that placeholder and from the content of the course. The code and the credit (4) come from the mirror.
- Every worked example was recomputed during authoring, and the arithmetic in the design courses was re-checked. Faculty review (below) should still re-derive a sample with the tables the college permits.

## Verification notes

| Course area | Evidence used | Status in this pack |
| --- | --- | --- |
| All course codes, titles, credits and semester placement (BCV301 … BCV703 and the four labs) | One student-maintained curriculum catalogue on GitHub that reproduces the VTU 2022 scheme for eight branches (the same source used for ME and EEE) | **Scheme-level identity is from a single secondary source**, not confirmed against an official VTU PDF or a second mirror. Title strings were normalised only for case, spacing and the "ApplicationLab" typo: "Water Supply and Waste Water Engineering", "Software Application Lab" and "Environmental Engineering Lab" became the forms in the table above. |
| BCV301, BCV302 | Code/title from the mirror; module maps curator-authored (Timoshenko or Bansal for strength of materials; Punmia or Kanetkar for surveying) | Provisional. BCV301 includes bending stresses, shear, deflection and columns; BCV302 covers chain, compass, levelling, theodolite, tacheometry, traversing and curves. |
| BCV303 Geology for Civil Engineering | **Title inferred** from the mirror's placeholder "TD- Geology/CV PSB-Geology/CV" (see above); module map curator-authored (Parbin Singh or Bell for engineering geology) | **Inferred title; content provisional.** Confirm the course name and whether it includes the Indian seismic zoning and site-investigation content in this map. |
| BCV304 | Code/title from the mirror; module map curator-authored (Garg, Punmia or Birdie for water supply and waste water) | Provisional. The course is split into water sources and demand, intake and conveyance, treatment, distribution and sewerage. The drinking water quality reference is IS 10500; check the current edition. |
| BCV401, BCV402, BCV403 | Code/title from the mirror; module maps curator-authored (Reddy or Pandit for structural analysis; Modi–Seth or Bansal for fluid mechanics; Khanna–Justo or Kadiyali for transportation) | Provisional. BCV402 covers the flow principles and pipe and channel hydraulics; BCV403 covers highways, traffic, pavements, railways and airports. The course split may differ from the college's. |
| BCV501 Construction Management and Entrepreneurship | Code/title from the mirror | Curator-authored from the common construction-management structure (networks, cost, contracts, appraisal and an entrepreneurship unit). Confirm the depth of network analysis and whether entrepreneurship is taught in this course. |
| BCV502, BCV503 | Code/title from the mirror; module maps curator-authored (Punmia or Murthy for geotechnical engineering; Shetty or Neville for concrete technology) | Provisional. The BCV503 mix-design unit is a **method outline** of the IS 10262 approach, not a design procedure; check against the current edition. |
| BCV504 / BCVL504 | Mirror lists `BCV504` and `BCVL504` with the same title; only `BCVL504` is seeded | Lab. The blocks are typical water and wastewater tests; the college lab sheet defines the list. |
| BCV601, BCV602 | Code/title from the mirror; module maps curator-authored (Pillai–Menon, Krishna Raju or Varghese for RCC; Punmia or Garg for irrigation) | **Method outline; the RCC unit cites IS 456:2000 clauses sparingly and must be checked against the current edition.** The irrigation unit uses textbook relations; state norms govern in practice. |
| BCV701, BCV702, BCV703 | Code/title from the mirror; module maps curator-authored (Subramanian or Duggal for steel; Dutta or Chudley for estimating and contracts; Krishna Raju or Lin–Burns for prestressed concrete) | **Method outline; the steel and prestressed units cite IS 800:2007 and IS 1343:2012 clauses sparingly and must be checked against the current editions.** The estimating and contract unit uses standard rate-analysis and contract conventions. |
| BCVL305, BCVL404, BCVL504, BCVL606 | Code/title from the mirror; exercise and experiment groups curator-authored from the usual VTU lists for these labs | Typical exercises only; the official list is the college lab sheet. |
| Foundations of Mechanics, Materials and Surveying (supplement) | None claimed | Curator-authored bridging material (statics, stress and strain, building materials, chain survey and levelling, scales and plans) for students entering Semester 3; no VTU claim. |

No VTU model question paper, detailed syllabus PDF or module-tagged student question bank was used for any CV course, so **no CV module map is promoted to "follows the official syllabus"**. When the official `vtu.ac.in` scheme and syllabus PDFs for CV 2022 can be fetched, the table above should be re-checked and this document updated.

## Faculty review before wider use

Before a department recommends the CV pack to students, a faculty member should:

1. Compare each course's five units with the college's current detailed syllabus and note any unit that is missing, extra or in a different order.
2. Re-derive at least one worked example per course with the tables and design data the college permits in examinations, and correct values that differ from the edition in use.
3. Check every design-code reference (IS 456:2000, IS 800:2007, IS 1343:2012, IS 10262, IS 10500) against the current edition, including every partial factor, limit and table value. The design courses are method outlines and must not be used as design procedures without this check.
4. Confirm the inferred BCV303 title, the IPCC status of BCV302, BCV303, BCV402, BCV403 and BCV502, and whether any 4-credit course not flagged here has an integrated practical.
5. Confirm how the duplicate BCV305/BCVL305 and BCV504/BCVL504 entries are treated in the college's scheme.
6. Check the four lab packs against the college lab sheet and the software and equipment in use.
7. Record corrections and send them to the Prep content maintainers so the seed files can be updated and the pack re-seeded.

## Explicit omissions and limits

This is **not complete four-year Civil Engineering coverage**. It deliberately omits:

- Semesters 1–2 (physics/chemistry cycle, first-year mathematics, engineering graphics, basic engineering courses, programming and common courses).
- Semester 3 ESC/ETC/PLC options (BCV306X), AEC/SEC options (BCV358X), Social Connect and Responsibility, and NSS/PE/Yoga courses.
- Semester 4 ESC options (BCV405X), AEC/SEC options (BCV456X including `BCVL456A` Building Information Modelling), Biology for Engineers, Universal Human Values and other common courses.
- Semester 5 professional electives (BCV515X), Mini Project and Extensive Survey Project BCV586, Research Methodology and IPR, Environmental Studies and mandatory common courses.
- Semester 6 professional electives (BCV613X), open electives (BCV654X, including the `BEE654B` renewable-energy entry), AEC/SDC (BCV657X, including `BCVL657A` BIM Advanced), Major Project Phase I BCV685 and Indian Knowledge System.
- Semester 7 professional electives (BCV714X), open electives (BCV755X) and Major Project Phase II BCV786.
- Semester 8 (online electives BCV801X/BCV802X and the internship BCV803) and any later regulation or college-specific additions.
- Exhaustive practical experiment lists for every IPCC course, instructor notes, official model answers, design-code tables, state-specific irrigation norms, and prior-year question papers.

Accordingly, "all modules/topics/subtopics" means all study units and subtopic briefs currently authored in these **selected candidate packs**, not every item in the complete Civil degree or every local lab manual. The CV pack is marked as a candidate VTU 2022-aligned core so it can be reviewed and expanded, ideally against the official PDFs, without implying official endorsement or full-scheme coverage.
