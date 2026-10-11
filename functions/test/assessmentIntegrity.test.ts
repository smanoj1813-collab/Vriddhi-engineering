// functions/test/assessmentIntegrity.test.ts
//
// These functions produce something a person will read about another person, so
// the tests are about restraint as much as arithmetic: the counts must be right,
// the flag must fire on the same evidence regardless of the score, and the
// wording must not assert a verdict the code cannot support.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  integrityLabel,
  scoredFullMarks,
  summarizeIntegrity,
} from '../src/assessmentIntegrityCore';

function event(type: string, extra: Record<string, unknown> = {}) {
  return { type, at: '2026-10-11T09:15:00.000Z', details: {}, ...extra };
}

describe('summarizeIntegrity', () => {
  it('is empty for an attempt with no events', () => {
    const summary = summarizeIntegrity([]);
    assert.equal(summary.total, 0);
    assert.equal(summary.reviewSuggested, false);
    assert.equal(summary.reason, '');
    assert.deepEqual(summary.recentInsertions, []);
    assert.deepEqual(summarizeIntegrity(null), summarizeIntegrity([]));
    assert.deepEqual(summarizeIntegrity('nonsense'), summarizeIntegrity([]));
  });

  it('counts each kind, and separates insertion attempts from focus noise', () => {
    const summary = summarizeIntegrity([
      event('paste_attempt', { details: { chars: 42 } }),
      event('paste_attempt', { details: { chars: 12 } }),
      event('drop_attempt', { details: { chars: 9 } }),
      event('tab_switch'),
      event('window_blur'),
      event('fullscreen_exit'),
      event('tab_limit_exceeded'),
      event('context_menu'),
    ]);
    assert.equal(summary.total, 8);
    assert.equal(summary.counts.paste_attempt, 2);
    assert.equal(summary.insertionCount, 3);
    assert.equal(summary.focusCount, 2);
    assert.equal(summary.fullscreenExits, 1);
    assert.equal(summary.tabLimitExceeded, 1);
    assert.equal(summary.reviewSuggested, true);
  });

  it('flags an insertion attempt, and says what it counted rather than what it concluded', () => {
    const summary = summarizeIntegrity([event('paste_attempt'), event('tab_switch'), event('tab_switch')]);
    assert.equal(summary.reviewSuggested, true);
    assert.match(summary.reason, /1 blocked attempt to paste or drop text into an answer/);
    assert.match(summary.reason, /2 switches away from the test window/);
    assert.doesNotMatch(summary.reason, /cheat|malpractice|guilty/i);
  });

  it('does not flag a paper that was only switched away from', () => {
    const summary = summarizeIntegrity([event('tab_switch'), event('window_blur'), event('fullscreen_exit')]);
    assert.equal(summary.reviewSuggested, false);
    // A fullscreen exit is its own kind of evidence, not a focus switch.
    assert.equal(summary.focusCount, 2);
    assert.match(summary.reason, /2 switches away from the test window/);
    assert.match(summary.reason, /1 fullscreen exit/);
    assert.equal(integrityLabel(summary), 'Noted');
    assert.equal(integrityLabel(summarizeIntegrity([event('tab_switch')])), 'Noted');
  });

  it('the flag does not depend on the score — only the wording does', () => {
    const events = [event('paste_attempt')];
    const failed = summarizeIntegrity(events, { scoredFullMarks: false });
    const aced = summarizeIntegrity(events, { scoredFullMarks: true });
    assert.equal(failed.reviewSuggested, true);
    assert.equal(aced.reviewSuggested, true);
    assert.doesNotMatch(failed.reason, /full marks/);
    assert.match(aced.reason, /scored full marks — worth reading the code beside it/);
  });

  it('keeps the moments, bounded, and the insertion detail the UI shows', () => {
    const events = Array.from({ length: 30 }, (_, index) =>
      event(index % 2 === 0 ? 'paste_attempt' : 'window_blur', {
        at: `2026-10-11T09:${String(index).padStart(2, '0')}:00.000Z`,
        details: { chars: index },
      }),
    );
    const summary = summarizeIntegrity(events);
    assert.equal(summary.total, 30);
    assert.equal(summary.firstEventAt, '2026-10-11T09:00:00.000Z');
    assert.equal(summary.lastEventAt, '2026-10-11T09:29:00.000Z');
    assert.equal(summary.recentInsertions.length, 10);
    // 15 insertions, the last 10 kept in order: even indices 10..28.
    assert.equal(summary.recentInsertions[0].chars, 10);
    // A char count the client never sent stays null rather than becoming 0.
    assert.equal(summarizeIntegrity([event('paste_attempt')]).recentInsertions[0].chars, null);
  });

  it('ignores junk events instead of inventing counts for them', () => {
    const summary = summarizeIntegrity([
      null,
      'paste_attempt',
      42,
      { at: 'no type' },
      { type: '' },
      { type: 'paste_attempt', at: 7, details: 'nope' },
    ]);
    assert.equal(summary.total, 1);
    assert.equal(summary.counts.paste_attempt, 1);
    assert.equal(summary.recentInsertions[0].chars, null);
  });

  it('treats an auto-submitted attempt as such however it is reported', () => {
    assert.equal(summarizeIntegrity([event('auto_submit')]).autoSubmitted, true);
    assert.equal(summarizeIntegrity([], { autoSubmitted: true }).autoSubmitted, true);
    assert.match(summarizeIntegrity([event('tab_limit_exceeded')]).reason, /submitted automatically/);
  });

  it('is labelled for the report column in one word', () => {
    assert.equal(integrityLabel(summarizeIntegrity([])), '');
    assert.equal(integrityLabel(summarizeIntegrity([event('paste_attempt')])), 'Review');
    assert.equal(integrityLabel(summarizeIntegrity([event('copy_attempt')])), '');
  });
});

describe('scoredFullMarks', () => {
  it('reads a percentage or marks out of a total', () => {
    assert.equal(scoredFullMarks({ percentage: 100 }), true);
    assert.equal(scoredFullMarks({ percentage: 99.6 }), true);
    assert.equal(scoredFullMarks({ percentage: 82.5 }), false);
    assert.equal(scoredFullMarks({ marksObtained: 20, totalMarks: 20 }), true);
    assert.equal(scoredFullMarks({ marksObtained: 18, totalMarks: 20 }), false);
  });

  it('stays silent when it cannot tell', () => {
    assert.equal(scoredFullMarks({}), false);
    assert.equal(scoredFullMarks({ marksObtained: null, totalMarks: 20 }), false);
    assert.equal(scoredFullMarks({ percentage: 0 }), false);
    assert.equal(scoredFullMarks({ marksObtained: 5, totalMarks: 0 }), false);
  });
});
