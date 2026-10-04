// src/shared/utils/engineeringScheme.test.ts
// Engineering scheme-pack rules: course types, SEE scaling, heads of passing,
// relative grading, OBE attainment and the question-paper pattern.
//
// The parity block at the end pins the non-tech packs to their existing G1
// behaviour so adding engineering cannot move a single BCU/KUD number.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateAttainment,
  checkHeadsOfPassing,
  convertCgpaToPercentage,
  generateSchemePaper,
  getCourseWeightage,
  getSchemeGrade,
  isEligibleForEndSemester,
  isInternalOnlyCourse,
  scaleSemesterEndMarks,
  validateSchemePaper,
  type BankQuestion,
} from './engineeringScheme';
import { calculateSchemeInternalMarks, checkSchemePassCriteria } from './schemeEngine';
import {
  AUTONOMOUS_ENGINEERING_5050,
  BCU_SEP_2024,
  VTU_2022_BE_BTECH,
  SCHEME_PACK_PRESETS,
} from '../types/schemePack';

describe('batch-scoped CGPA conversion', () => {
  it('uses the legacy adjustment for 2015, 2017 and 2018 admission batches', () => {
    assert.equal(convertCgpaToPercentage(8, '2015-2019', VTU_2022_BE_BTECH), 72.5);
    assert.equal(convertCgpaToPercentage(8, '2017', VTU_2022_BE_BTECH), 72.5);
    assert.equal(convertCgpaToPercentage(8, '2018-2022', VTU_2022_BE_BTECH), 72.5);
  });

  it('uses CGPA × 10 for 2022 onwards and the pack fallback for unknown batches', () => {
    assert.equal(convertCgpaToPercentage(8, '2022-2026', VTU_2022_BE_BTECH), 80);
    assert.equal(convertCgpaToPercentage(8, '2029', VTU_2022_BE_BTECH), 80);
    assert.equal(convertCgpaToPercentage(8, '2020', VTU_2022_BE_BTECH), 80);
  });

  it('rejects non-finite CGPA and does not evaluate unsupported formulas', () => {
    assert.equal(convertCgpaToPercentage(Number.NaN, '2022', VTU_2022_BE_BTECH), null);
    const unsafe = {
      ...VTU_2022_BE_BTECH,
      engineering: {
        ...VTU_2022_BE_BTECH.engineering,
        percentageConversion: { expression: 'globalThis.process.exit(1)' },
      },
    };
    assert.equal(convertCgpaToPercentage(8, '2022', unsafe), null);
    assert.equal(convertCgpaToPercentage(8, '2022', BCU_SEP_2024), null);
  });
});

describe('SEE scaling', () => {
  it('scales a 100-mark VTU paper down to 50', () => {
    assert.equal(scaleSemesterEndMarks(72, VTU_2022_BE_BTECH), 36);
    assert.equal(scaleSemesterEndMarks(100, VTU_2022_BE_BTECH), 50);
    assert.equal(scaleSemesterEndMarks(0, VTU_2022_BE_BTECH), 0);
  });

  it('does not scale when the pack has no scaleFrom', () => {
    assert.equal(scaleSemesterEndMarks(56, BCU_SEP_2024), 56);
  });

  it('never exceeds the pack maximum', () => {
    assert.equal(scaleSemesterEndMarks(140, VTU_2022_BE_BTECH), 50);
  });
});

describe('course-type weightages', () => {
  it('reads per-course-type splits and falls through to _default for unknown types', () => {
    assert.deepEqual(getCourseWeightage('theory', VTU_2022_BE_BTECH), { internal: 50, external: 50 });
    assert.deepEqual(
      getCourseWeightage('project', VTU_2022_BE_BTECH),
      { internal: 50, external: 100 },
    );
    assert.deepEqual(
      getCourseWeightage('unlisted-elective', VTU_2022_BE_BTECH),
      VTU_2022_BE_BTECH.engineering?.courseTypes?._default,
    );
  });

  it('reports integrated courses with their heads', () => {
    const ipcc = getCourseWeightage('ipcc', VTU_2022_BE_BTECH);
    assert.deepEqual(ipcc.heads, ['theory', 'practical']);
    assert.deepEqual(ipcc.internalSplit, { theory: 30, practical: 20 });
  });

  it('falls back to the pack defaults for non-tech packs', () => {
    assert.deepEqual(getCourseWeightage('theory', BCU_SEP_2024), { internal: 20, external: 80 });
  });

  it('marks internal-only courses', () => {
    assert.equal(isInternalOnlyCourse('seminar', VTU_2022_BE_BTECH), true);
    assert.equal(isInternalOnlyCourse('theory', VTU_2022_BE_BTECH), false);
  });
});

describe('VTU end-semester eligibility', () => {
  it('bars a student below 40% CIE from even sitting the SEE', () => {
    assert.equal(isEligibleForEndSemester(39.9, VTU_2022_BE_BTECH), false);
    assert.equal(isEligibleForEndSemester(40, VTU_2022_BE_BTECH), true);
  });

  it('imposes no internal bar where the university has none', () => {
    assert.equal(isEligibleForEndSemester(0, BCU_SEP_2024), true);
  });
});

describe('heads of passing', () => {
  it('fails the course when one head is short, even if the other clears', () => {
    const result = checkHeadsOfPassing(
      [
        { code: 'theory', marks: 42, maxMarks: 70 },    // 60% — pass
        { code: 'practical', marks: 15, maxMarks: 40 }, // 37.5% — fail
      ],
      VTU_2022_BE_BTECH,
    );
    assert.equal(result.isPass, false);
    assert.equal(result.heads[0].isPass, true);
    assert.equal(result.heads[1].isPass, false);
    assert.match(result.remarks, /practical/);
  });

  it('passes when every head clears', () => {
    const result = checkHeadsOfPassing(
      [
        { code: 'theory', marks: 45, maxMarks: 70 },
        { code: 'practical', marks: 20, maxMarks: 40 },
      ],
      VTU_2022_BE_BTECH,
    );
    assert.equal(result.isPass, true);
  });

  it('degrades to a single check for courses with one head', () => {
    const result = checkHeadsOfPassing([{ code: 'total', marks: 45, maxMarks: 100 }], BCU_SEP_2024);
    assert.equal(result.isPass, true);
  });
});

describe('relative grading', () => {
  it('curves a large cohort by percentile', () => {
    const grade = getSchemeGrade({ percentage: 66, percentile: 92, cohortSize: 60 }, AUTONOMOUS_ENGINEERING_5050);
    assert.equal(grade.method, 'relative');
    assert.equal(grade.grade, 'A+');
    assert.equal(grade.gradePoint, 9);
  });

  it('falls back to the absolute table when the cohort is too small', () => {
    const grade = getSchemeGrade({ percentage: 66, percentile: 92, cohortSize: 18 }, AUTONOMOUS_ENGINEERING_5050);
    assert.equal(grade.method, 'absolute');
    assert.equal(grade.grade, 'B+');
    assert.equal(grade.gradePoint, 7);
  });

  it('never lets a percentile rescue a student below the absolute floor', () => {
    const grade = getSchemeGrade({ percentage: 30, percentile: 99, cohortSize: 60 }, AUTONOMOUS_ENGINEERING_5050);
    assert.equal(grade.grade, 'F');
    assert.equal(grade.gradePoint, 0);

    const noBandFloorPack = {
      ...AUTONOMOUS_ENGINEERING_5050,
      engineering: {
        ...AUTONOMOUS_ENGINEERING_5050.engineering,
        grading: {
          ...AUTONOMOUS_ENGINEERING_5050.engineering!.grading!,
          relativeBands: [{ grade: 'O', gradePoint: 10, minPercentile: 0 }],
        },
      },
    };
    const noBandFloorGrade = getSchemeGrade({ percentage: 39, percentile: 99, cohortSize: 60 }, noBandFloorPack);
    assert.equal(noBandFloorGrade.grade, 'F');
    assert.equal(noBandFloorGrade.method, 'absolute');
  });

  it('grades absolutely for VTU regardless of the cohort', () => {
    const grade = getSchemeGrade({ percentage: 79.25, percentile: 50, cohortSize: 60 }, VTU_2022_BE_BTECH);
    assert.equal(grade.method, 'absolute');
    assert.equal(grade.grade, 'B');
    assert.equal(grade.gradePoint, 8);
  });
});

describe('OBE attainment', () => {
  const cohort = Array.from({ length: 40 }, (_, i) => ({
    studentId: `S${i}`,
    coScores: {
      CO1: { obtained: i < 30 ? 18 : 8, max: 20 },   // 75% -> level 2
      CO2: { obtained: i < 36 ? 17 : 9, max: 20 },   // 90% -> level 3
      CO3: { obtained: i < 20 ? 15 : 10, max: 20 },  // 50% -> level 0
    },
  }));
  const coPoMap = { CO1: { PO1: 3, PO2: 2 }, CO2: { PO1: 2, PO3: 3 }, CO3: { PO2: 1, PO4: 2 } };

  it('computes CO levels and blends the indirect 80/20', () => {
    const report = calculateAttainment(
      { studentScores: cohort, coPoMap, indirect: { CO1: 2.6, CO2: 2.8, CO3: 2.2 } },
      VTU_2022_BE_BTECH,
    );
    const byCo = new Map(report.coAttainment.map((c) => [c.co, c]));
    assert.equal(byCo.get('CO1')?.directLevel, 2);
    assert.equal(byCo.get('CO2')?.directLevel, 3);
    assert.equal(byCo.get('CO3')?.directLevel, 0);
    assert.equal(byCo.get('CO1')?.combined, 2.12);
    assert.equal(byCo.get('CO2')?.combined, 2.96);
  });

  it('rolls CO attainment into POs using the correlation weights', () => {
    const report = calculateAttainment(
      { studentScores: cohort, coPoMap, indirect: { CO1: 2.6, CO2: 2.8, CO3: 2.2 } },
      VTU_2022_BE_BTECH,
    );
    // PO1 = (2.12*3 + 2.96*2) / 5
    assert.equal(report.poAttainment.PO1, 2.46);
    assert.equal(report.poAttainment.PO3, 2.96);
  });

  it('is disabled on packs without engineering rules', () => {
    const report = calculateAttainment({ studentScores: cohort, coPoMap }, BCU_SEP_2024);
    assert.equal(report.isEnabled, false);
    assert.deepEqual(report.coAttainment, []);
  });
});

describe('question paper generation', () => {
  const bank: BankQuestion[] = [];
  for (let module = 1; module <= 5; module += 1) {
    for (let i = 1; i <= 4; i += 1) {
      bank.push({
        id: `Q${module}_${i}`,
        module,
        marks: 20,
        co: `CO${((module - 1) % 4) + 1}`,
        bloomLevel: ['L2', 'L3', 'L4', 'L5'][i - 1],
        difficulty: (['easy', 'medium', 'medium', 'hard'] as const)[i - 1],
      });
    }
  }

  it('builds the VTU 10-question / 5-module pattern', () => {
    const { paper, checks } = generateSchemePaper(bank, VTU_2022_BE_BTECH);
    assert.equal(paper.selected.length, 10);
    assert.equal(paper.answerableMarks, 100);
    assert.equal(paper.sections.length, 5);
    assert.equal(paper.durationMinutes, 180);
    const failures = checks.filter((c) => c.status === 'fail');
    assert.deepEqual(failures, []);
  });

  it('fails validation when a module is uncovered and CO tags are missing', () => {
    const thin = bank
      .filter((q) => q.module !== 5)
      .map((q) => ({ ...q, co: undefined } as BankQuestion));
    const { checks } = generateSchemePaper(thin, VTU_2022_BE_BTECH);
    assert.equal(checks.find((c) => c.code === 'MODULE_COVERAGE')?.status, 'fail');
    assert.equal(checks.find((c) => c.code === 'CO_TAGGED')?.status, 'fail');
  });

  it('builds the section pattern for autonomous colleges', () => {
    const sectionBank: BankQuestion[] = [];
    for (const marks of [2, 8, 20]) {
      for (let i = 0; i < 10; i += 1) {
        sectionBank.push({
          id: `S${marks}_${i}`,
          marks,
          co: `CO${(i % 5) + 1}`,
          bloomLevel: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'][i % 6],
          difficulty: (['easy', 'medium', 'hard'] as const)[i % 3],
        });
      }
    }
    const { paper, checks } = generateSchemePaper(sectionBank, AUTONOMOUS_ENGINEERING_5050);
    assert.equal(paper.sections.length, 3);
    assert.equal(paper.answerableMarks, 100);
    assert.equal(checks.find((c) => c.code === 'TOTAL_MARKS')?.status, 'pass');
    assert.ok(checks.some((c) => c.code === 'DIFFICULTY'));
  });

  it('rejects a pack with no paper template', () => {
    assert.throws(() => generateSchemePaper(bank, BCU_SEP_2024), /paperTemplate/);
    assert.equal(validateSchemePaper(
      { templateCode: 'x', durationMinutes: 0, rawTotal: 0, sections: [], selected: [], answerableMarks: 0 },
      BCU_SEP_2024,
    )[0].status, 'fail');
  });
});

describe('non-tech parity — engineering must not move existing numbers', () => {
  it('keeps BCU internal assessment identical', () => {
    const ia = calculateSchemeInternalMarks(
      { testMarks: [18, 16, 12], assignmentMarks: 5, attendancePercentage: 88 },
      BCU_SEP_2024,
    );
    // best 2 of 3 -> 17/20 -> 8.5, + 4 attendance (86-90 slab) + 5 assignment
    assert.equal(ia.testAverage, 8.5);
    assert.equal(ia.attendanceMarks, 4);
    assert.equal(ia.assignmentMarks, 5);
    assert.equal(ia.totalIA, 17.5);
    assert.equal(ia.totalPossible, 20);
  });

  it('keeps BCU pass criteria identical', () => {
    const pass = checkSchemePassCriteria({ semesterEndMarks: 56, internalMarks: 17.5 }, BCU_SEP_2024);
    assert.equal(pass.maxTotal, 100);
    assert.equal(pass.aggregatePercentage, 73.5);
    assert.equal(pass.isPass, true);
  });

  it('still exposes the original three presets plus the two engineering packs', () => {
    assert.deepEqual(
      SCHEME_PACK_PRESETS.map((p) => p.code),
      ['BCU_SEP_2024', 'KUD_NEP_CBAE', 'GENERIC_NEP_2020', 'VTU_2022_BE_BTECH', 'AUTONOMOUS_ENGINEERING_5050'],
    );
  });

  it('leaves non-tech packs without an engineering block', () => {
    for (const code of ['BCU_SEP_2024', 'KUD_NEP_CBAE', 'GENERIC_NEP_2020']) {
      const pack = SCHEME_PACK_PRESETS.find((p) => p.code === code);
      assert.equal(pack?.engineering, undefined, code);
    }
  });
});
