// src/shared/utils/pdfDownloader.test.ts
//
// Run with: npm run test:unit   (node --import tsx --test)
//
// Pins the client half of the PDF degradation contract shared with
// functions/src/utils/pdfRenderer.ts.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiResponseError, HOSTING_REWRITE_HINT } from '../api/apiBase'
import { readServerPdfResponse } from './pdfDownloader'

const url = 'https://asia-south1-vriddhi-engineering.cloudfunctions.net/api/papers/p1/pdf'

function response(status: number, contentType: string | null, body: string | Uint8Array): Response {
  const headers = new Headers()
  if (contentType) headers.set('content-type', contentType)
  return new Response(body, { status, headers })
}

describe('readServerPdfResponse', () => {
  it('returns the blob for 200 application/pdf', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4')
    const outcome = await readServerPdfResponse(response(200, 'application/pdf', bytes), url)
    assert.equal(outcome.kind, 'pdf')
    if (outcome.kind === 'pdf') {
      assert.equal(await outcome.blob.text(), '%PDF-1.4')
    }
  })

  it('signals a client fallback for 503 { fallback: "client" }', async () => {
    const originalWarn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => { warnings.push(args) }
    try {
      const body = JSON.stringify({ error: 'pdf_renderer_unavailable', fallback: 'client', message: 'No Chrome', probed: ['/usr/bin/chromium'] })
      const outcome = await readServerPdfResponse(response(503, 'application/json', body), url)
      assert.deepEqual(outcome, { kind: 'fallback', reason: 'No Chrome' })
      assert.equal(warnings.length, 1)
      assert.match(String(warnings[0][0]), /server renderer unavailable/)
    } finally {
      console.warn = originalWarn
    }
  })

  it('does NOT fall back for a 503 without the explicit fallback flag', async () => {
    await assert.rejects(
      readServerPdfResponse(response(503, 'application/json', '{"message":"Service Unavailable"}'), url),
      (err: unknown) => err instanceof ApiResponseError && err.message === 'Service Unavailable' && err.status === 503,
    )
  })

  it('keeps genuine render faults (500) as errors carrying the server message', async () => {
    await assert.rejects(
      readServerPdfResponse(response(500, 'application/json', '{"error":"pdf_render_timeout","message":"PDF rendering timed out after 30000ms during render"}'), url),
      (err: unknown) => err instanceof ApiResponseError && /timed out after 30000ms/.test(err.message),
    )
  })

  it('rejects a 200 text/html SPA shell loudly, naming the URL and the rewrite', async () => {
    await assert.rejects(
      readServerPdfResponse(response(200, 'text/html; charset=utf-8', '<!doctype html>'), url),
      (err: unknown) => {
        assert.ok(err instanceof ApiResponseError)
        assert.match(err.message, /Expected a PDF from https:\/\/asia-south1.*but received text\/html/)
        assert.ok(err.message.includes(HOSTING_REWRITE_HINT))
        return true
      },
    )
  })

  it('reports the old double-/api 404 with the Functions error text', async () => {
    await assert.rejects(
      readServerPdfResponse(response(404, 'application/json', '{"error":"Route not found","path":"/api/api/papers/p1/pdf"}'), url),
      (err: unknown) => err instanceof ApiResponseError && err.message === 'Route not found',
    )
  })

  it('falls back to a status-bearing message for non-JSON failures', async () => {
    await assert.rejects(
      readServerPdfResponse(response(502, 'text/plain', 'Bad Gateway'), url),
      (err: unknown) => err instanceof ApiResponseError && err.message === `Failed to download PDF: 502 from ${url}`,
    )
  })
})
