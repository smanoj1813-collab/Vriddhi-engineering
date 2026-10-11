// functions/test/questionImages.test.ts
//
// Question figures arrive at the player in two shapes: editor papers carry a
// flat `imageUrl`, and the question bank stores `images: [{url, altText,
// storagePath}]` (see src/shared/utils/questionImage.ts). The player renders
// `imageUrl` only, so this pins the normaliser that reconciles them — the step
// that decides whether a figure attached in the bank ever reaches a student
// mid-test.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeQuestion } from '../src/studentAssessments';

describe('normalizeQuestion image mapping', () => {
  it('keeps a flat imageUrl (editor-paper shape)', () => {
    const question = normalizeQuestion(
      { text: 'Find x', type: 'mcq', options: [{ id: 'A', text: '1' }], imageUrl: 'https://cdn/figure.png' },
      'q-1',
      1,
    );
    assert.equal(question.imageUrl, 'https://cdn/figure.png');
  });

  it("resolves the bank's images[0].url into the flat field the player renders", () => {
    const question = normalizeQuestion(
      {
        text: 'Read the graph',
        type: 'mcq',
        options: [{ id: 'A', text: '1' }],
        images: [
          { url: 'https://cdn/graph.png', storagePath: 'images/questions/c/m/t/q-2/abc.png', altText: 'Graph' },
          { url: 'https://cdn/second.png', storagePath: 'x', altText: 'second' },
        ],
      },
      'q-2',
      2,
    );
    assert.equal(question.imageUrl, 'https://cdn/graph.png');
  });

  it('omits imageUrl entirely when there is no figure (and survives junk)', () => {
    const withoutImage = normalizeQuestion(
      { text: 'Plain text question', type: 'mcq', options: [{ id: 'A', text: '1' }] },
      'q-3',
      3,
    );
    assert.equal(withoutImage.imageUrl, undefined);
    assert.ok(!('imageUrl' in withoutImage));

    const junk = normalizeQuestion(
      { text: 'Junk images field', type: 'mcq', options: [{ id: 'A', text: '1' }], images: ['not-an-object', null, { url: 42 }] },
      'q-4',
      4,
    );
    assert.equal(junk.imageUrl, undefined);
  });
});
