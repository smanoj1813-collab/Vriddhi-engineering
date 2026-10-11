// functions/test/codingReadCost.test.ts
//
// The cheap read path is only safe because a SHORT answer falls back to the full
// loader. If that rule ever loosened, a paper whose questions live somewhere the
// targeted lookup cannot see (legacy papers embed them on the test document)
// would be scored as if the questions were missing — a silent zero. The rule is
// one pure function, so it is pinned here rather than trusted.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { missingQuestionIds } from '../src/studentAssessments';

describe('missingQuestionIds', () => {
  it('is empty when the targeted read covered the request', () => {
    assert.deepEqual(missingQuestionIds(['q1', 'q2'], ['q1', 'q2']), []);
    // Extra ids the caller did not ask for are not a problem.
    assert.deepEqual(missingQuestionIds(['q1'], ['q1', 'q9']), []);
  });

  it('names exactly what was not found, so the caller can fall back', () => {
    assert.deepEqual(missingQuestionIds(['q1', 'q2', 'q3'], ['q1']), ['q2', 'q3']);
    assert.deepEqual(missingQuestionIds(['q1'], []), ['q1']);
  });

  it('dedupes and ignores blanks, so one question is never fetched twice', () => {
    assert.deepEqual(missingQuestionIds(['q1', 'q1', '', 'q2'], []), ['q1', 'q2']);
    assert.deepEqual(missingQuestionIds([], []), []);
  });

  it('treats a questionId alias as covering the request', () => {
    // The loader indexes a question under both its id and its questionId.
    assert.deepEqual(missingQuestionIds(['legacy-id'], ['legacy-id', 'bank-id']), []);
  });
});
