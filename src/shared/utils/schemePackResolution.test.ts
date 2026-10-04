import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findSchemePackAssignment,
  normalizeSchemePackScope,
  resolveSchemePackId,
  schemePackScopeKey,
  type SchemePackAssignment,
} from './schemePackResolution';

const assignments: SchemePackAssignment[] = [
  { id: 'program', schemePackId: 'PROGRAM_PACK', programId: 'B.E.' },
  {
    id: 'cohort',
    schemePackId: 'COHORT_PACK',
    programId: 'B.E.',
    branchId: 'Computer Science',
    admissionBatch: '2022-2026',
  },
  {
    id: 'other',
    schemePackId: 'OTHER_PACK',
    programId: 'B.Tech',
    branchId: 'Computer Science',
    admissionBatch: '2022-2026',
  },
];

describe('scheme pack assignment resolution', () => {
  it('prefers a complete programme, branch and admission-batch match', () => {
    assert.equal(
      findSchemePackAssignment(assignments, {
        programId: 'b.e.',
        branchId: ' computer   science ',
        admissionBatch: '2022-2026',
      })?.schemePackId,
      'COHORT_PACK',
    );
  });

  it('falls back to the programme-wide assignment when cohort fields do not match', () => {
    assert.equal(
      findSchemePackAssignment(assignments, {
        programId: 'B.E.',
        branchId: 'Electrical',
        admissionBatch: '2022-2026',
      })?.schemePackId,
      'PROGRAM_PACK',
    );
    assert.equal(
      findSchemePackAssignment(assignments, { programId: 'B.E.' })?.schemePackId,
      'PROGRAM_PACK',
    );
  });

  it('uses the college default and then the platform default when no scope matches', () => {
    assert.equal(resolveSchemePackId(assignments, { programId: 'MCA' }, 'COLLEGE_DEFAULT'), 'COLLEGE_DEFAULT');
    assert.equal(resolveSchemePackId(assignments, { programId: 'MCA' }), 'BCU_SEP_2024');
  });

  it('requires a complete cohort scope and uses stable normalized keys', () => {
    assert.throws(
      () => normalizeSchemePackScope({ programId: 'B.E.', branchId: 'CSE' }),
      /both branch and admission batch/,
    );
    assert.equal(
      schemePackScopeKey({ programId: ' B.E. ', branchId: 'CSE', admissionBatch: '2022-2026' }),
      'b.e.|cse|2022-2026',
    );
    assert.equal(normalizeSchemePackScope({ programId: 'B.E.' })?.branchId, '');
    assert.equal(normalizeSchemePackScope({}), null);
  });
});
