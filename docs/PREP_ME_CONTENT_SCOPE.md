# Prep Studio ME study-pack scope and verification

**Status:** Curator-authored candidate content for Prep Studio. This is not an official VTU publication, a complete Mechanical Engineering degree syllabus, or a guarantee that a particular college uses this scheme. Students should compare the course codes, lab instructions and exam scope with their current college handout, and **faculty should review the pack before it is recommended to a class** (see "Faculty review before wider use" below).

The ME pack was built to the same contract as the CSE, ECE and EEE packs (see `docs/PREP_CSE_CONTENT_SCOPE.md`, `docs/PREP_ECE_CONTENT_SCOPE.md` and `docs/PREP_EEE_CONTENT_SCOPE.md`), and on the **same thin evidence base as EEE**: the official VTU scheme and syllabus PDFs at `vtu.ac.in` were not reachable while this pack was authored, and only **one** student-maintained curriculum mirror covered the Mechanical scheme. Course codes, titles and credits come from that single mirror; the module-level content inside each course was authored by the curator from standard mechanical-engineering textbooks in VTU's five-module shape. **Treat every module map in this pack as a candidate outline until it is checked against the college's current detailed syllabus.**

## What is in the ME seed pack

The ME-specific seed contains **20 study-pack records, 100 five-part study units and 100 module-linked practice questions**. Each study unit is rendered in the existing Prep format: an explanation, subtopic briefs, a key model, a worked application, an exam tip, a solve method and a question. The module/unit IDs describe the current content, not the university's paper-question IDs.

The candidate map includes:

| Coverage | Included packs |
| --- | --- |
| Semester 3 | BME301 Mechanics of Materials, BME302 Manufacturing Process, BME303 Material Science and Engineering, BME304 Basic Thermodynamics, and the separate BMEL305 Introduction to Modelling and Design for Manufacturing |
| Semester 4 | BME401 Applied Thermodynamics, BME402 Machining Science and Metrology, BME403 Fluid Mechanics, and the separate BME404 Mechanical Measurements and Metrology Lab |
| Semester 5 | BME501 Industrial Management and Entrepreneurship, BME502 Turbo Machines, BME503 Theory of Machines, and the separate BME504L CNC Programming and 3-D Printing Lab |
| Semester 6 | BME601 Heat Transfer, BME602 Machine Design, and the separate BMEL606L Design Lab |
| Semester 7 | BME701 Finite Element Methods, BME702 Hydraulics and Pneumatics, BME703 Control Engineering |
| Supplemental, unsemestered | Foundations of Mechanics, Materials and Thermal Science; it makes no VTU course-code or semester claim |

The seed route also adds the existing cross-program Student Toolkit and Science Reasoning supplement to ME (22 subjects / 108 units in the delivered bundle). Those two supplementary packs are not ME university courses.

### Streams, options and integrated practical work

- **Every ME pack is tagged with the new `mechanical` stream except BME501**, which is tagged `management` because its content (management functions, work study, entrepreneurship and MSME support, project appraisal) is management rather than mechanical material. Its program tag is still `me`.
- **No ESC/AEC/PE/OE option courses are seeded.** The scheme mirror lists the option slots only as placeholders (`BME306X` "ESC/ETC/PLC", `BME358X`, `BME405X`, `BME456X`, `BME515X`, `BME613X`, `BME654X`, `BME657X`, `BME714X`, `BME755X`) without option titles — the `BME405X` entry is even garbled in the mirror — so nothing is seeded for them. A test asserts that no option-pattern code is present.
- **BMEL305, BME404, BME504L and BMEL606L are separate lab courses**, represented as five Prep study blocks each. The codes are reproduced exactly as the mirror gives them, including the inconsistent `L` placement (`BMEL305`, `BME404`, `BME504L`, `BMEL606L`). The blocks organise *typical* exercises and experiments for learning; the college lab sheet defines the official list, and the blocks are not claimed to be official theory modules. BMEL305 is modelled as a CAD/drawing/DFM course because its title says so; confirm the CAD package and exercise list with the college.
- **BME302, BME303, BME402, BME403 and BME502 remain single IPCC course records.** Their practical component is treated as integrated with the theory course, not as an extra course, and their experiment lists are not transcribed. **The IPCC flag is inferred, not read from an official document**: the four Semester 3–4 courses are the 4-credit theory slots, consistent with IPCC status, and BME502 sits in the Semester 5 "502" slot that was corroborated as IPCC for ECE (BEC502) and flagged the same way in the EEE pack (BEE502). The handoff for this pack listed only the four Semester 3–4 courses; BME502 was added deliberately for consistency with the EEE precedent.
- **BME503, BME601, BME602 and BME701–BME703 are also 4-credit courses but are not flagged IPCC**, matching how the EEE pack treated the same slots. The mirror carries no IPCC marker for any course, so a college may run an integrated practical for some of these; their descriptions make no claim either way.
- **Standards are cited for orientation only.** Where a unit names a standard — ISO 286 limits and fits (BME402), ISO 1219 symbols and ISO 4406 cleanliness codes (BME702), ISO 6983 G-code conventions and ISO/ASTM 52900 process categories (BME504L), SP 46 drawing practice and ISO 2768 general tolerances (BMEL305), ISO 21940 balance grades (BMEL606L) — only the well-known principle is used. Clause numbers, table values and current editions must be checked against the standard or the college handout.

### Design data and worked-example values

- **BME602 Machine Design is written as a method-level outline.** VTU machine-design examinations are answered from a prescribed design data handbook. The factors used in its units (shock factors in the ASME shaft equation, the Barth velocity factor, Lewis form factors, Marin factors, key proportions, bolt property classes) are illustrative textbook values; **every factor and table value must be taken from the handbook edition the college prescribes**, and the description says so.
- **Property values in worked examples are rounded textbook values.** Steam-table entries (BME304, BME401), the R-134a enthalpies (BME401), water properties (BME403, BME601), friction factors and slip-gauge sets are typical values used to keep the arithmetic checkable. Students should re-read them from the tables or data book their college allows in the examination.
- Every worked example was recomputed during authoring, but faculty review (below) should still re-derive a sample with the tables the college permits.

## Verification notes

| Course area | Evidence used | Status in this pack |
| --- | --- | --- |
| All course codes, titles, credits and semester placement (BME301 … BME703 and the four labs) | One student-maintained curriculum catalogue on GitHub that reproduces the VTU 2022 scheme for eight branches (the same source used for EEE, and accurate for every ECE code and title that could be cross-checked) | **Scheme-level identity is from a single secondary source**, not confirmed against an official VTU PDF or a second mirror. Title strings were normalised only for case and ampersands: "Machining Science & Metrology", "Industrial Management & Entrepreneurship", "Turbo machines", "Mechanical Measurements and Metrology lab", "CNC Programming and 3-D Printing lab" and "Design lab" became the forms in the table above. |
| BME301, BME304 | Code/title from the mirror; module maps curator-authored from standard texts (Timoshenko–Gere, Rajput or Bansal for strength of materials; Nag, Cengel–Boles or Rajput for thermodynamics) | **Code and name are from the mirror; module detail is provisional.** BME301 includes beam deflection and thick cylinders but no unit on columns and struts; a college version may place these differently. |
| BME302, BME303 | Code/title from the mirror; module maps curator-authored (Rao or Kalpakjian for manufacturing; Callister or Raghavan for materials) | Provisional. BME302 is mapped as casting, welding, forming, and powder metallurgy with polymer processing and additive manufacturing; machining is assumed to sit in BME402. |
| BME401, BME403 | Code/title from the mirror; module maps curator-authored (Rajput or Nag for applied thermodynamics; Bansal, Modi–Seth or White for fluid mechanics) | Provisional. BME401 follows the familiar gas cycles / vapour cycles / combustion and engine testing / refrigeration and psychrometry / compressors and nozzles pattern; confirm against the 2022 detailed syllabus. |
| BME402 | Code/title from the mirror; module map curator-authored (Ghosh–Mallik for metal cutting; Jain or Gupta for metrology) | Provisional. The course is split three units of machining science and two units of metrology; the college split may differ. |
| BME501 Industrial Management and Entrepreneurship | Code/title from the mirror | Curator-authored from the common VTU management-and-entrepreneurship structure, with a work-study unit added because the title says "Industrial Management". Confirm whether the college version includes work study and how much project-management depth it expects. |
| BME502, BME503 | Code/title from the mirror; module maps curator-authored (Kadambi–Prasad or Yahya for turbomachines; Rattan, Ballaney or Bevan for theory of machines) | Provisional. BME503 is mapped as a combined kinematics-and-dynamics course (mechanisms, force analysis and flywheels, gears, cams with balancing, governors and gyroscopes); mechanical vibrations get no theory unit here (they appear only as Design Lab experiments), so confirm whether the college syllabus includes them. |
| BME601, BME602 | Code/title from the mirror; module maps curator-authored (Incropera or Kothandaraman for heat transfer; Shigley or Bhandari for machine design, with a design data handbook) | Provisional; see the design-data note above. |
| BME701, BME702, BME703 | Code/title from the mirror; module maps curator-authored (Chandrupatla–Belegundu or Logan for FEM; Esposito or Majumdar for fluid power; Nagrath–Gopal or Ogata for control) | Provisional. BME703 overlaps in topic with the EEE control course but was written separately with mechanical, hydraulic and thermal examples. |
| BMEL305, BME404, BME504L, BMEL606L | Code/title from the mirror; exercise and experiment groups curator-authored from the usual VTU lists for these labs | Typical exercises only; the official list is the college lab sheet. |
| Foundations of Mechanics, Materials and Thermal Science (supplement) | None claimed | Curator-authored bridging material (statics, particle dynamics, the tension test, thermal basics and units, drawing and measurement) for students entering Semester 3; no VTU claim. |

No VTU model question paper, detailed syllabus PDF or module-tagged student question bank was used for any ME course, so **no ME module map is promoted to "follows the official syllabus"**. When the official `vtu.ac.in` scheme and syllabus PDFs for ME 2022 can be fetched, the table above should be re-checked and this document updated.

## Faculty review before wider use

Before a department recommends the ME pack to students, a faculty member should:

1. Compare each course's five units with the college's current detailed syllabus and note any unit that is missing, extra or in a different order.
2. Re-derive at least one worked example per course with the data book, steam tables or design data handbook the college permits in examinations, and correct values that differ from the edition in use.
3. Confirm which courses actually run as IPCC (including BME502, which is inferred) and whether any 4-credit course not flagged here has an integrated practical.
4. Check the four lab packs against the college lab sheet and the CAD/CNC/3-D printing software in use.
5. Record corrections and send them to the Prep content maintainers so the seed files can be updated and the pack re-seeded.

## Explicit omissions and limits

This is **not complete four-year ME coverage**. It deliberately omits:

- Semesters 1–2 (physics/chemistry cycle, first-year mathematics, engineering graphics, basic engineering courses, programming and common courses).
- Semester 3 ESC/ETC/PLC options (BME306X), AEC/SEC options (BME358X), Social Connect and Responsibility, and NSS/PE/Yoga courses.
- Semester 4 ESC options (BME405X), AEC/SEC options (BME456X), Biology for Engineers, Universal Human Values and other common courses.
- Semester 5 professional electives (BME515X), Mini Project BME586, Research Methodology and IPR, Environmental Studies and mandatory common courses.
- Semester 6 professional electives (BME613X), open electives (BME654X), AEC/SDC (BME657X), Major Project Phase I BME685 and Indian Knowledge System.
- Semester 7 professional electives (BME714X), open electives (BME755X) and Major Project Phase II BME786.
- Semester 8 (online electives BME801X/BME802X and the internship BME803) and any later regulation or college-specific additions.
- Exhaustive practical experiment lists for every IPCC course, instructor notes, official model answers, design-data tables and prior-year question papers.

Accordingly, "all modules/topics/subtopics" means all study units and subtopic briefs currently authored in these **selected candidate packs**, not every item in the complete ME degree or every local lab manual. The ME pack is marked as a candidate VTU 2022-aligned core so it can be reviewed and expanded — ideally against the official PDFs — without implying official endorsement or full-scheme coverage.
