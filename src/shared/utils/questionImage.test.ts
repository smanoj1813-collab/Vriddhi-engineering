// src/shared/utils/questionImage.test.ts
//
// Pins the contract `storage.rules` grants: only PNG/JPG/WebP under 2 MB, and
// only paths that start with `images/questions/{collegeId}/...` — a heading
// that no crafted id, subject or filename can escape.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_IMAGE_MAX_BYTES,
  questionImageAltText,
  questionImageExtension,
  questionImagePath,
  sanitizeQuestionImageSegment,
  validateQuestionImage,
} from './questionImage';

test('extension resolves from MIME first, then filename, and refuses the rest', () => {
  assert.equal(questionImageExtension({ type: 'image/png', name: 'figure.png' }), 'png');
  assert.equal(questionImageExtension({ type: 'image/jpeg', name: 'photo.jpg' }), 'jpg');
  assert.equal(questionImageExtension({ type: 'image/webp', name: 'graph.webp' }), 'webp');
  // Some file managers hand over an empty type; the name is the fallback.
  assert.equal(questionImageExtension({ type: '', name: 'geometry-diagram.JPEG' }), 'jpg');
  assert.equal(questionImageExtension({ type: 'image/gif', name: 'loop.gif' }), null);
  assert.equal(questionImageExtension({ type: 'application/pdf', name: 'paper.pdf' }), null);
  assert.equal(questionImageExtension({}), null);
});

test('validation rejects non-images, empties and oversized files with a readable reason', () => {
  assert.equal(validateQuestionImage({ type: 'image/png', name: 'ok.png', size: 1024 }), null);
  assert.equal(
    validateQuestionImage({ type: 'image/png', name: 'just-under.png', size: QUESTION_IMAGE_MAX_BYTES }),
    null,
  );
  assert.match(String(validateQuestionImage({ type: 'image/gif', name: 'x.gif', size: 10 })), /PNG, JPG or WebP/);
  assert.match(String(validateQuestionImage({ type: 'image/png', name: 'zero.png', size: 0 })), /empty/);
  assert.match(
    String(validateQuestionImage({ type: 'image/png', name: 'big.png', size: QUESTION_IMAGE_MAX_BYTES + 1 })),
    /under 2 MB/,
  );
});

test('segments are normalised and cannot escape the prefix', () => {
  assert.equal(sanitizeQuestionImageSegment('Math'), 'math');
  assert.equal(sanitizeQuestionImageSegment('CO1 / Unit 2'), 'co1-unit-2');
  assert.equal(sanitizeQuestionImageSegment('  --weird__--  '), 'weird');
  assert.equal(sanitizeQuestionImageSegment(''), 'general');
  assert.equal(sanitizeQuestionImageSegment('../../firestore.rules'), 'firestore-rules');
  assert.equal(sanitizeQuestionImageSegment('a'.repeat(200)).length, 64);
});

test('the built path always has the shape the storage rules grant', () => {
  const path = questionImagePath({
    collegeId: 'College-A!',
    subjectId: 'math',
    topicId: 'quant',
    questionId: 'q-17',
    extension: 'jpg',
    nonce: 'abc123',
  });
  assert.equal(path, 'images/questions/college-a/math/quant/q-17/abc123.jpg');
  assert.equal(path.split('/').length, 7);
});

test('a hostile question id cannot climb out of images/questions', () => {
  const path = questionImagePath({
    collegeId: '../../../etc',
    subjectId: '..',
    topicId: '/',
    questionId: '../..',
    extension: 'PNG',
    nonce: '..',
  });
  assert.ok(path.startsWith('images/questions/'));
  assert.ok(!path.includes('..'));
  // Extension is allowlisted, not trusted.
  assert.ok(path.endsWith('.png'));
  assert.equal(path.split('/').length, 7);
  assert.ok(!path.split('/').some((segment) => segment === '' || segment === '.'));
});

test('alt text leans on the question when there is one', () => {
  assert.equal(questionImageAltText('Find x in the figure', 0), 'Figure for: Find x in the figure (figure 1)');
  assert.equal(questionImageAltText('   spaced \n question  ', 2), 'Figure for: spaced question (figure 3)');
  assert.equal(questionImageAltText('', 1), 'Question figure 2');
});
