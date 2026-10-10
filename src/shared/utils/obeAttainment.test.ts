// src/shared/utils/obeAttainment.test.ts
// NBA/OBE attainment pipeline tests. The worked example below is hand-verified
// end to end: 10 students, 2 COs, threshold 60%, levels L3≥70 / L2≥60 / L1≥50.
//   CO1: 8/10 clear → 80% → level 3; indirect 2.5 → combined 3×0.8+2.5×0.2 = 2.9
//   CO2: 5/10 clear → 50% → level 1; indirect 2.0 → combined 1×0.8+2.0×0.2 = 1.2
// Mapping CO1→{PO1:3, PO2:2}, CO2→{PO1:1, PSO1:3} gives
//   PO1 = (2.9×3 + 1.2×1)/4 = 2.475 → 2.48, PO2 = 2.9, PSO1 = 1.2.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateMarksByTool,
  aggregateQuestionMarksToCoScores,
  buildSarCoTable,
  buildSarOutcomeTable,
  calculateProgramOutcomeAttainment,
  combineDirectIndirect,
  directLevelForCo,
  evaluateOutcomeTargets,
  gapcV40AttainmentRules,
  indirectAttainmentFromSurveys,
  levelForPercentage,
  rollUpOutcomes,
  validateMapping,
} from './obeAttainment';
import { BLOOM_LEVELS, GAPC_V4_PROGRAM_OUTCOMES } from '../types/obe';

function studentScores(above: number, total: number, co: string) {
  return Array.from({ length: total }, (_, i) => ({
    studentId: `S${i + 1}`,
    coScores: { [co]: i < above ? { obtained: 8, max: 10 } : { obtained: 4, max: 10 } },
  }));
}

describe('obe — GAPC v4.0 framework vocabulary', () => {
  it('defines exactly 11 POs with the v4.0 titles', () => {
    assert.equal(GAPC_V4_PROGRAM_OUTCOMES.length, 11);
    assert.equal(GAPC_V4_PROGRAM_OUTCOMES[0].code, 'PO1');
    assert.equal(GAPC_V4_PROGRAM_OUTCOMES[4].title, 'Engineering Tool Usage');
    assert.equal(GAPC_V4_PROGRAM_OUTCOMES[5].title, 'The Engineer and the World');
    assert.equal(GAPC_V4_PROGRAM_OUTCOMES[6].title, 'Ethics');
    assert.equal(GAPC_V4_PROGRAM_OUTCOMES[10].code, 'PO11');
  });

  it('defines 6 Bloom levels with L3+ marked higher-order', () => {
    assert.equal(BLOOM_LEVELS.length, 6);
    assert.deepEqual(
      BLOOM_LEVELS.filter((b) => b.higherOrder).map((b) => b.code),
      ['L3', 'L4', 'L5', 'L6'],
    );
  });

  it('ships a one-click GAPC v4.0 rule fragment for scheme packs', () => {
    const rules = gapcV40AttainmentRules();
    assert.equal(rules.enabled, true);
    assert.equal(rules.framework, 'NBA-GAPC-v4.0');
    assert.equal(rules.coThresholdPercentage, 60);
    assert.equal(rules.directWeight, 0.8);
    assert.equal(rules.indirectWeight, 0.2);
    assert.deepEqual(rules.correlationScale, [1, 2, 3]);
  });
});

describe('obe — direct levels', () => {
  it('walks levels from the top with NBA defaults', () => {
    assert.equal(levelForPercentage(80), 3);
    assert.equal(levelForPercentage(70), 3);
    assert.equal(levelForPercentage(69.9), 2);
    assert.equal(levelForPercentage(50), 1);
    assert.equal(levelForPercentage(49.9), 0);
  });

  it('computes per-CO direct levels from student scores', () => {
    assert.deepEqual(directLevelForCo({ scores: studentScores(8, 10, 'CO1'), co: 'CO1' }), {
      attempted: 10,
      percentAboveThreshold: 80,
      level: 3,
    });
    assert.deepEqual(directLevelForCo({ scores: studentScores(5, 10, 'CO2'), co: 'CO2' }), {
      attempted: 10,
      percentAboveThreshold: 50,
      level: 1,
    });
  });

  it('ignores students with no attempt on the CO', () => {
    const result = directLevelForCo({
      scores: [
        { studentId: 'S1', coScores: { CO1: { obtained: 9, max: 10 } } },
        { studentId: 'S2', coScores: {} },
        { studentId: 'S3', coScores: { CO1: { obtained: 0, max: 0 } } },
      ],
      co: 'CO1',
    });
    assert.equal(result.attempted, 1);
    assert.equal(result.percentAboveThreshold, 100);
    assert.equal(result.level, 3);
  });

  it('honours pack overrides for threshold and levels', () => {
    const rules = gapcV40AttainmentRules();
    rules.coThresholdPercentage = 50;
    rules.levels = [{ level: 3, minPercentStudents: 90 }];
    // 8/10 clear 80% and 50%: 80% of students → below the 90 bar → level 0.
    assert.equal(directLevelForCo({ scores: studentScores(8, 10, 'CO1'), co: 'CO1', rules }).level, 0);
  });
});

describe('obe — question→CO aggregation', () => {
  it('folds question marks into per-student CO scores', () => {
    const scores = aggregateQuestionMarksToCoScores(
      [
        { studentId: 'S1', questionId: 'Q1', obtained: 8, max: 10 },
        { studentId: 'S1', questionId: 'Q2', obtained: 6, max: 10 },
        { studentId: 'S2', questionId: 'Q1', obtained: 4, max: 10 },
      ],
      { Q1: ['CO1'], Q2: ['CO2'] },
    );
    assert.equal(scores.length, 2);
    assert.deepEqual(scores[0].coScores, {
      CO1: { obtained: 8, max: 10 },
      CO2: { obtained: 6, max: 10 },
    });
  });

  it('splits multi-CO questions equally across COs', () => {
    const scores = aggregateQuestionMarksToCoScores(
      [{ studentId: 'S1', questionId: 'Q1', obtained: 8, max: 10 }],
      { Q1: ['CO1', 'CO2'] },
    );
    assert.deepEqual(scores[0].coScores, {
      CO1: { obtained: 4, max: 5 },
      CO2: { obtained: 4, max: 5 },
    });
  });

  it('skips untagged and zero-max questions without failing the import', () => {
    const scores = aggregateQuestionMarksToCoScores(
      [
        { studentId: 'S1', questionId: 'Q1', obtained: 8, max: 10 },
        { studentId: 'S1', questionId: 'Q9', obtained: 10, max: 10 },
        { studentId: 'S1', questionId: 'Q0', obtained: 0, max: 0 },
      ],
      { Q1: ['CO1'], Q0: ['CO1'] },
    );
    assert.deepEqual(scores[0].coScores, { CO1: { obtained: 8, max: 10 } });
  });

  it('clamps over-max marks instead of inflating attainment', () => {
    const scores = aggregateQuestionMarksToCoScores(
      [{ studentId: 'S1', questionId: 'Q1', obtained: 99, max: 10 }],
      { Q1: ['CO1'] },
    );
    assert.deepEqual(scores[0].coScores, { CO1: { obtained: 10, max: 10 } });
  });

  it('groups marks by tool for tool-wise tables', () => {
    const byTool = aggregateMarksByTool(
      [
        { studentId: 'S1', questionId: 'Q1', obtained: 8, max: 10, tool: 'CIE-1' },
        { studentId: 'S1', questionId: 'Q2', obtained: 6, max: 10, tool: 'SEE' },
        { studentId: 'S1', questionId: 'Q3', obtained: 6, max: 10 },
      ],
      { Q1: ['CO1'], Q2: ['CO1'], Q3: ['CO1'] },
    );
    assert.deepEqual(Object.keys(byTool).sort(), ['CIE-1', 'SEE', 'unassigned']);
    assert.deepEqual(byTool['CIE-1'][0].coScores, { CO1: { obtained: 8, max: 10 } });
  });
});

describe('obe — indirect, blend and roll-up', () => {
  it('normalises survey responses onto the 0–3 scale', () => {
    assert.deepEqual(
      indirectAttainmentFromSurveys([
        { co: 'CO1', score: 4, maxScore: 5 },
        { co: 'CO1', score: 5, maxScore: 5 },
        { co: 'CO2', score: 2, maxScore: 3 },
      ]),
      { CO1: 2.7, CO2: 2 },
    );
  });

  it('blends 80/20 and tolerates a missing side', () => {
    assert.equal(combineDirectIndirect(3, 2.5), 2.9);
    assert.equal(combineDirectIndirect(1, 2.0), 1.2);
    assert.equal(combineDirectIndirect(2, null), 2);
    assert.equal(combineDirectIndirect(null, 2.4), 2.4);
    assert.equal(combineDirectIndirect(null, null), 0);
  });

  it('rolls CO values up to POs and PSOs through correlations', () => {
    assert.deepEqual(
      rollUpOutcomes({ CO1: 2.9, CO2: 1.2 }, { CO1: { PO1: 3, PO2: 2 }, CO2: { PO1: 1, PSO1: 3 } }),
      { PO1: 2.48, PO2: 2.9, PSO1: 1.2 },
    );
  });

  it('computes credit-weighted program-level attainment', () => {
    assert.deepEqual(
      calculateProgramOutcomeAttainment([
        { courseCode: 'CS301', credits: 4, outcomeAttainment: { PO1: 2.5, PO2: 2.0 } },
        { courseCode: 'CS302', credits: 3, outcomeAttainment: { PO1: 2.0 } },
        { courseCode: 'CS303', credits: 0, outcomeAttainment: { PO1: 3.0 } },
      ]),
      { PO1: 2.29, PO2: 2.0 },
    );
  });
});

describe('obe — targets, validation and SAR tables', () => {
  it('evaluates target gaps with met flags', () => {
    assert.deepEqual(evaluateOutcomeTargets({ PO1: 2.48, PO2: 2.9 }, { PO1: 2.0, PO2: 3.0 }), [
      { outcome: 'PO1', attained: 2.48, target: 2.0, gap: 0.48, met: true },
      { outcome: 'PO2', attained: 2.9, target: 3.0, gap: -0.1, met: false },
    ]);
  });

  it('validates mapping completeness before a run', () => {
    const good = validateMapping(
      { CO1: { PO1: 3 }, CO2: { PO1: 2, PSO1: 1 } },
      ['CO1', 'CO2'],
      ['PO1', 'PSO1', 'PO2'],
    );
    assert.equal(good.valid, true);
    assert.deepEqual(good.errors, []);
    assert.deepEqual(good.warnings, ['PO2 is not addressed by any CO mapping.']);

    const bad = validateMapping({ CO1: { PO1: 5 }, CO2: {} }, ['CO1', 'CO2']);
    assert.equal(bad.valid, false);
    assert.equal(bad.errors.length, 2);
  });

  it('builds SAR CO rows with attainment status', () => {
    assert.deepEqual(
      buildSarCoTable({
        cos: [
          { code: 'CO1', statement: 'Apply sorting algorithms.' },
          { code: 'CO2' },
        ],
        direct: { CO1: 3, CO2: 1 },
        indirect: { CO1: 2.5, CO2: 2.0 },
        combined: { CO1: 2.9, CO2: 1.2 },
        targets: { CO1: 2.0 },
      }),
      [
        {
          co: 'CO1',
          statement: 'Apply sorting algorithms.',
          direct: 3,
          indirect: 2.5,
          combined: 2.9,
          target: 2.0,
          status: 'attained',
        },
        {
          co: 'CO2',
          statement: undefined,
          direct: 1,
          indirect: 2.0,
          combined: 1.2,
          target: undefined,
          status: 'no-target',
        },
      ],
    );
  });

  it('builds SAR PO/PSO rows with gaps', () => {
    assert.deepEqual(
      buildSarOutcomeTable({
        outcomes: [
          { code: 'PO1', title: 'Engineering Knowledge' },
          { code: 'PSO1' },
        ],
        attainment: { PO1: 2.48, PSO1: 1.2 },
        targets: { PO1: 2.0, PSO1: 2.0 },
      }),
      [
        {
          outcome: 'PO1',
          title: 'Engineering Knowledge',
          attainment: 2.48,
          target: 2.0,
          gap: 0.48,
          status: 'attained',
        },
        {
          outcome: 'PSO1',
          title: undefined,
          attainment: 1.2,
          target: 2.0,
          gap: -0.8,
          status: 'not-attained',
        },
      ],
    );
  });
});
