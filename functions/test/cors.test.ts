// functions/test/cors.test.ts
// The Express CORS allow-list: prod origins + preview channels + localhost
// get through, everything else is denied, non-browser callers pass through.

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedCorsOrigin } from '../src/middleware/cors'

describe('cors allow-list', () => {
  afterEach(() => {
    delete process.env.CORS_EXTRA_ORIGINS
  })

  it('allows the production hosting origins', () => {
    assert.equal(isAllowedCorsOrigin('https://vriddhi-engineering.web.app'), true)
    assert.equal(isAllowedCorsOrigin('https://vriddhi-engineering.firebaseapp.com'), true)
  })

  it('allows hosting preview channels but not lookalikes', () => {
    assert.equal(isAllowedCorsOrigin('https://vriddhi-engineering--pr-123-abc12.web.app'), true)
    assert.equal(isAllowedCorsOrigin('https://vriddhi-engineering--staging-x9y8.firebaseapp.com'), true)
    assert.equal(isAllowedCorsOrigin('https://evil-vriddhi-engineering.web.app'), false)
    assert.equal(isAllowedCorsOrigin('https://vriddhi-engineering.web.app.evil.com'), false)
    assert.equal(isAllowedCorsOrigin('http://vriddhi-engineering.web.app'), false)
  })

  it('allows http localhost on any port (local dev)', () => {
    assert.equal(isAllowedCorsOrigin('http://localhost:5173'), true)
    assert.equal(isAllowedCorsOrigin('http://127.0.0.1:3000'), true)
    assert.equal(isAllowedCorsOrigin('https://localhost:5173'), false)
  })

  it('lets non-browser callers through and rejects garbage', () => {
    assert.equal(isAllowedCorsOrigin(undefined), true)
    assert.equal(isAllowedCorsOrigin(null), true)
    assert.equal(isAllowedCorsOrigin(''), true)
    assert.equal(isAllowedCorsOrigin('not-a-url'), false)
    assert.equal(isAllowedCorsOrigin('https://evil.com'), false)
  })

  it('honours the CORS_EXTRA_ORIGINS escape hatch', () => {
    process.env.CORS_EXTRA_ORIGINS = 'https://staff.example.in, https://admin.example.in '
    assert.equal(isAllowedCorsOrigin('https://staff.example.in'), true)
    assert.equal(isAllowedCorsOrigin('https://admin.example.in'), true)
    assert.equal(isAllowedCorsOrigin('https://other.example.in'), false)
  })
})
