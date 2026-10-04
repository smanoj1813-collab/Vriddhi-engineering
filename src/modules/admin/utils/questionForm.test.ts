import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLearningOutcomes } from './questionForm';

describe('parseLearningOutcomes', () => {
  it('splits Unix and Windows newlines and trims empty rows', () => {
    assert.deepEqual(
      parseLearningOutcomes('  Outcome one  \r\n\tOutcome two\n\n   \r\nOutcome three '),
      ['Outcome one', 'Outcome two', 'Outcome three'],
    );
  });

  it('returns no outcomes for empty or whitespace-only input', () => {
    assert.deepEqual(parseLearningOutcomes(''), []);
    assert.deepEqual(parseLearningOutcomes(' \r\n\t\n'), []);
  });
});
