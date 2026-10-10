// src/shared/utils/prepMedia.test.ts
//
// Run with: npm run test:unit   (node --import tsx --test)

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PREP_IMAGE_MAX_BYTES,
  insertMarkdownImage,
  markdownImageLine,
  prepImageExtension,
  prepMediaPathForFile,
  validatePrepImage,
} from './prepMedia'

const URL = 'https://vriddhi-engineering.appspot.com/prep-media/123-abc123.png'

describe('prepImageExtension', () => {
  it('prefers the MIME type', () => {
    assert.equal(prepImageExtension({ type: 'image/png', name: 'x.pdf' }), 'png')
    assert.equal(prepImageExtension({ type: 'image/jpeg', name: 'x.png' }), 'jpg')
    assert.equal(prepImageExtension({ type: 'image/webp', name: 'x' }), 'webp')
    assert.equal(prepImageExtension({ type: 'image/gif', name: 'x' }), 'gif')
  })

  it('falls back to the file name extension', () => {
    assert.equal(prepImageExtension({ type: '', name: 'diagram.PNG' }), 'png')
    assert.equal(prepImageExtension({ type: undefined, name: 'flow.jpeg' }), 'jpeg')
  })

  it('rejects non-image files', () => {
    assert.equal(prepImageExtension({ type: 'application/pdf', name: 'x.pdf' }), null)
    assert.equal(prepImageExtension({ type: 'image/svg+xml', name: 'x.svg' }), null)
    assert.equal(prepImageExtension({ type: '', name: 'noext' }), null)
    assert.equal(prepImageExtension({}), null)
  })
})

describe('validatePrepImage', () => {
  it('accepts a valid image', () => {
    assert.equal(validatePrepImage({ type: 'image/png', name: 'd.png', size: 1024 }), null)
  })

  it('rejects files over 4 MB', () => {
    const err = validatePrepImage({ type: 'image/png', name: 'big.png', size: PREP_IMAGE_MAX_BYTES + 1 })
    assert.ok(err && /4 MB/.test(err))
  })

  it('accepts exactly 4 MB', () => {
    assert.equal(validatePrepImage({ type: 'image/png', name: 'max.png', size: PREP_IMAGE_MAX_BYTES }), null)
  })

  it('rejects non-image MIME without extension fallback', () => {
    assert.ok(validatePrepImage({ type: 'application/pdf', name: 'x.pdf', size: 100 }))
  })

  it('rejects empty files', () => {
    assert.ok(validatePrepImage({ type: 'image/png', name: 'x.png', size: 0 }))
    assert.ok(validatePrepImage({}))
  })
})

describe('prepMediaPathForFile', () => {
  it('builds the rules-matched path shape', () => {
    assert.equal(prepMediaPathForFile('png', 1758120000000, 'abc123'), 'prep-media/1758120000000-abc123.png')
  })
})

describe('markdownImageLine', () => {
  it('wraps the caption and url', () => {
    assert.equal(markdownImageLine('Supply curve', URL), `![Supply curve](${URL})`)
  })

  it('collapses whitespace/newlines in the caption', () => {
    assert.equal(markdownImageLine('  Multi\nline  caption ', URL), `![Multi line caption](${URL})`)
  })

  it('falls back to a default caption', () => {
    assert.equal(markdownImageLine('', URL), `![Diagram](${URL})`)
  })
})

describe('insertMarkdownImage', () => {
  const line = markdownImageLine('Fig 1', URL)

  it('returns just the line for an empty document', () => {
    assert.equal(insertMarkdownImage('', line, 0), line)
  })

  it('appends with a blank line when the cursor is null', () => {
    assert.equal(insertMarkdownImage('Hello world', line, null), `Hello world\n\n${line}`)
  })

  it('inserts at the cursor with blank-line separation both sides', () => {
    // cursor 9 = between the two paragraphs (index of the 'p' in 'para two')
    const out = insertMarkdownImage('para one\npara two', line, 9)
    assert.equal(out, `para one\n\n${line}\n\npara two`)
  })

  it('inserts at the start for cursor 0', () => {
    assert.equal(insertMarkdownImage('body text', line, 0), `${line}\n\nbody text`)
  })

  it('clamps the cursor to the text length', () => {
    assert.equal(insertMarkdownImage('short', line, 999), `short\n\n${line}`)
  })

  it('does not double blank lines when the text already ends blank', () => {
    assert.equal(insertMarkdownImage('text\n\n', line, null), `text\n\n${line}`)
  })

  it('respects a cursor already on a blank line', () => {
    const text = 'a\n\nb'
    assert.equal(insertMarkdownImage(text, line, 2), `a\n\n${line}\n\nb`)
  })
})
