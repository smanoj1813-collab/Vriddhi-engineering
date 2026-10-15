# Prep Studio EEE study-pack scope and verification

**Status:** Curator-authored candidate content for Prep Studio. This is not an official VTU publication, a complete Electrical and Electronics Engineering degree syllabus, or a guarantee that a particular college uses this scheme. Students should compare the course codes, lab instructions and exam scope with their current college handout.

The EEE pack was built to the same contract as the CSE and ECE packs (see `docs/PREP_CSE_CONTENT_SCOPE.md` and `docs/PREP_ECE_CONTENT_SCOPE.md`), but on the **thinnest evidence base of the three**: the official VTU scheme and syllabus PDFs at `vtu.ac.in` were not reachable while this pack was authored, and only **one** student-maintained curriculum mirror covered the EEE scheme (the ECE pack had five mutually corroborating mirrors). Course codes, titles and credits come from that single mirror; the module-level content inside each course was authored by the curator from standard electrical-engineering textbooks in VTU's five-module shape. **Treat every module map in this pack as a candidate outline until it is checked against the college's current detailed syllabus.**

## What is in the EEE seed pack

The EEE-specific seed contains **20 study-pack records, 100 five-part study units and 100 module-linked practice questions**. Each study unit is rendered in the existing Prep format: an explanation, subtopic briefs, a key model, a worked application, an exam tip, a solve method and a question. The module/unit IDs describe the current content, not the university's paper-question IDs.

The candidate map includes:

| Coverage | Included packs |
| --- | --- |
| Semester 3 | BEE301 Engineering Mathematics for EEE, BEE302 Electric Circuit Analysis, BEE303 Analog Electronic Circuits, BEE304 Transformers and Generators, and the separate BEEL305 Transformers and Generators Lab |
| Semester 4 | BEE401 Electric Motors, BEE402 Transmission and Distribution, BEE403 Microcontrollers, and the separate BEEL404 Electric Motors Lab |
| Semester 5 | BEE501 Engineering Management and Entrepreneurship, BEE502 Signals and Digital Signal Processing, BEE503 Power Electronics, and the separate BEEL504 Power Electronics Lab |
| Semester 6 | BEE601 Power System Analysis – I, BEE602 Control Systems, and the separate BEEL606 Control System Lab |
| Semester 7 | BEE701 Switchgear and Protection, BEE702 Industrial Drives and Applications, BEE703 Power System Analysis – II |
| Supplemental, unsemestered | Foundations of Circuits, Fields and Machines; it makes no VTU course-code or semester claim |

The seed route also adds the existing cross-program Student Toolkit and Science Reasoning supplement to EEE (22 subjects / 108 units in the delivered bundle). Those two supplementary packs are not EEE university courses.

### Streams, options and integrated practical work

- **Every EEE pack is tagged with the new `electrical` stream except BEE501**, which is tagged `management` because its content (management functions, entrepreneurship, project appraisal, IPR) is management rather than electrical material. Its program tag is still `eee`.
- **No ESC/AEC option courses are seeded.** The scheme mirror lists the Semester 3 and 4 ESC slots only as placeholders (`BEE306X`, `BEE405X`) without option titles, so — unlike the ECE pack, which seeded two verified options — nothing is seeded for them. A test asserts this.
- **BEEL305, BEEL404, BEEL504 and BEEL606 are separate lab courses** represented as five Prep study blocks each. Those blocks organise *typical* experiments for learning; the college lab sheet defines the official experiment list, and the blocks are not claimed to be official theory modules.
- **BEE302, BEE303, BEE402, BEE403 and BEE502 remain single IPCC course records.** Their practical component is treated as integrated with the theory course, not as an extra course, and their experiment lists are not transcribed exhaustively. (The mirror shows these as 4-credit courses, consistent with IPCC status; the IPCC flag itself is inferred from the credit pattern, not read from an official document.)
- **BEE403 Microcontrollers assumes an 8051-centred course.** Some colleges teach ARM Cortex-M under this code; the course description says to confirm the processor family.

## Verification notes

| Course area | Evidence used | Status in this pack |
| --- | --- | --- |
| All course codes, titles, credits and semester placement (BEE301 … BEE703 and the BEEL labs) | One student-maintained curriculum catalogue on GitHub that reproduces the VTU 2022 scheme for eight branches (the same source that proved accurate for every ECE code and title) | **Scheme-level identity is from a single secondary source**, not confirmed against an official VTU PDF or a second mirror. The mirror's exact title strings were kept (e.g. "Power system Analysis - I" normalised to "Power System Analysis – I"). |
| BEE301 Engineering Mathematics for EEE | Code/title from the mirror | The mirror lists this as `BEE301` rather than a `BMATE…` code as in some other 2022 streams; confirm the code with the college. Module map (Fourier series/transforms, Z-transforms, higher-order ODEs, Laplace, probability) is curator-authored from the common 2022 Mathematics-III structure. |
| BEE302, BEE303, BEE304, BEE401, BEE402, BEE403, BEE502, BEE503, BEE601, BEE602, BEE701, BEE702, BEE703 | Code/title from the mirror; module maps curator-authored from standard texts (Hayt/Sudhakar for circuits, Boylestad/Sedra–Smith for electronics, Nagrath–Kothari/Bimbhra for machines and power systems, Wadhwa/Mehta for T&D, Mazidi for 8051, Proakis/Oppenheim for DSP, Rashid/Bimbhra for power electronics, Nagrath–Gopal/Ogata for control, Badri Ram/Paithankar for protection, Dubey/Pillai for drives, Stevenson/Grainger for PSA) | **Code and name are from the mirror; module detail is provisional.** The maps are arranged in VTU's five-module shape and cover the topics that recur in VTU papers, but module boundaries and specific inclusions must be checked against the college's detailed syllabus. |
| BEE501 Engineering Management and Entrepreneurship | Code/title from the mirror | Curator-authored from the common VTU management-and-entrepreneurship structure (management, planning/organising/staffing, directing/controlling, entrepreneurship and SSI with Karnataka institutions, project appraisal and IPR). Confirm whether the college version includes ERP or additional IPR depth. |
| BEEL305, BEEL404, BEEL504, BEEL606 | Code/title from the mirror; experiment groups curator-authored from the usual VTU experiment lists for these labs | Typical experiments only; the official experiment list is the college lab sheet. |
| Foundations of Circuits, Fields and Machines (supplement) | None claimed | Curator-authored bridging material (phasors and AC power, magnetic circuits, DC transients, semiconductor basics, measurements and safety) for students entering Semester 3; no VTU claim. |

No VTU model question paper, detailed syllabus PDF or module-tagged student question bank was used for any EEE course, so **no EEE module map is promoted to "follows the official syllabus"**. When the official `vtu.ac.in` scheme/syllabus PDFs for EEE 2022 (Semesters 3–4, 5–6 and 7) can be fetched, the table above should be re-checked and this document updated.

## Explicit omissions and limits

This is **not complete four-year EEE coverage**. It deliberately omits:

- Semesters 1–2 (physics/chemistry cycle, first-year mathematics, basic electronics/electrical, programming, common courses).
- Semester 3 ESC options (BEE306X), AEC/SEC options (BEE358X), social-connect and mandatory common courses.
- Semester 4 ESC options (BEE405X), AEC/SEC options (BEE456X), and other scheme requirements.
- Semester 5 professional electives (BEE515X), Mini Project BEE586, Research Methodology/IPR, Environmental Studies and mandatory common courses.
- Semester 6 professional electives (BEE613X), open electives (BEE654X), AEC/SDC (BEE657X), and Project Phase I BEE685.
- Semester 7 professional electives (BEE714X), open electives (BEE755X), and Major Project Phase II BEE786.
- Semester 8 and any later regulation or college-specific additions.
- Exhaustive practical experiment lists for every IPCC course, instructor notes, official model answers, and prior-year question papers.

Accordingly, "all modules/topics/subtopics" means all study units and subtopic briefs currently authored in these **selected candidate packs**, not every item in the complete EEE degree or every local lab manual. The EEE pack is marked as a candidate VTU 2022-aligned core so it can be reviewed and expanded — ideally against the official PDFs — without implying official endorsement or full-scheme coverage.
