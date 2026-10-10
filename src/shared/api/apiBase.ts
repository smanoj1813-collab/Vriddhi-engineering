// src/shared/api/apiBase.ts
//
// The ONE place the browser learns where the `api` Cloud Function lives.
//
// Convention (documented in README → "Environment variables"):
//   * `VITE_API_BASE_URL` (preferred) or the legacy `VITE_API_URL` holds an
//     absolute URL to the Express app exported as the `api` function. The
//     `/api` suffix is optional — `normalizeApiBaseUrl` adds it when missing
//     and tolerates a trailing slash, so `https://<region>-<project>.<host>`
//     and `https://<region>-<project>.<host>/api/` are equivalent.
//   * For local development against the emulator, set `VITE_API_BASE_URL=/api`
//     and the Vite dev server proxies `/api/*` to the function (vite.config.ts).
//   * When nothing is set we fall back to the production function so a fresh
//     checkout without a `.env` still talks to a real backend.
//
// Every client (AI chat, PDF export, AI question generation) MUST build its
// URLs through `apiUrl()`; never hard-code a host or a `/api` prefix elsewhere.

export const DEFAULT_API_BASE_URL = 'https://asia-south1-vriddhi-engineering.cloudfunctions.net/api'

/**
 * Normalises a configured base URL so every caller can append `/papers/...`,
 * `/ai/chat`, etc. directly.
 *
 *  - trims whitespace and any trailing slashes
 *  - appends `/api` only when the value does not already end in `/api`
 *  - `''` / `undefined` → production default
 *  - `/` → same-origin `/api` (dev proxy / hosting rewrite setups)
 */
export function normalizeApiBaseUrl(raw?: string | null): string {
  const value = (raw ?? '').trim()
  if (!value) return DEFAULT_API_BASE_URL

  const trimmed = value.replace(/\/+$/, '')
  if (!trimmed) return '/api'

  return /\/api$/i.test(trimmed) ? trimmed : `${trimmed}/api`
}

/**
 * Reads the Vite env safely. `import.meta.env` is statically replaced by Vite
 * in the browser bundle; under plain Node (unit tests) it is undefined, and we
 * simply fall through to the default.
 */
function readConfiguredApiBase(): string | undefined {
  const env = (import.meta as ImportMeta & { env?: Partial<ImportMetaEnv> }).env
  return env?.VITE_API_BASE_URL || env?.VITE_API_URL || undefined
}

/** Absolute (or same-origin) base URL, always ending in `/api`, never with a trailing slash. */
export const API_BASE_URL = normalizeApiBaseUrl(readConfiguredApiBase())

/** Builds a full endpoint URL: `apiUrl('/ai/chat')` → `${API_BASE_URL}/ai/chat`. */
export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${suffix}`
}

// ─── PDF routes live in their own function (item 4.4) ───────────────────────
//
// The three Chrome-launching routes moved from `api` to `pdf` so that ordinary
// API traffic no longer runs on a 2 GiB instance. `pdfUrl()` builds those URLs.
//
// `VITE_PDF_BASE_URL` overrides the host when the two functions live in
// different regions. When nothing is set we derive it from the API base by
// swapping the trailing `/api` for `/pdf` — which is what the deployed names
// are — and fall back to the literal production host if that suffix is absent
// (a same-origin `/api` dev proxy, for example).

export const DEFAULT_PDF_BASE_URL = 'https://asia-south1-vriddhi-engineering.cloudfunctions.net/pdf'

/**
 * `https://…/api` → `https://…/pdf`. Anything without a trailing `/api`
 * (e.g. the same-origin `/api` dev proxy) yields null, and the caller then uses
 * the production default, which the Vite dev proxy forwards in development.
 */
export function derivePdfBaseUrl(apiBase: string): string | null {
  const trimmed = (apiBase || '').replace(/\/+$/, '')
  if (!/\/api$/i.test(trimmed)) return null
  return `${trimmed.slice(0, -4)}/pdf`
}

function readConfiguredPdfBase(): string | undefined {
  const env = (import.meta as ImportMeta & { env?: Partial<ImportMetaEnv> }).env
  return env?.VITE_PDF_BASE_URL || undefined
}

/** Absolute base URL of the `pdf` function, never with a trailing slash. */
export const PDF_BASE_URL = (() => {
  const configured = (readConfiguredPdfBase() || '').trim().replace(/\/+$/, '')
  if (configured) return /\/pdf$/i.test(configured) ? configured : `${configured}/pdf`
  return derivePdfBaseUrl(API_BASE_URL) || DEFAULT_PDF_BASE_URL
})()

/** Builds a PDF endpoint URL: `pdfUrl('/papers/x/pdf')`. */
export function pdfUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${PDF_BASE_URL}${suffix}`
}

/**
 * Thrown by `assertJsonResponse` when the backend did not answer with a JSON
 * document. Carries enough context to diagnose a hosting-rewrite mishit from
 * the console alone.
 */
export class ApiResponseError extends Error {
  readonly status: number
  readonly url: string
  readonly contentType: string
  readonly body: unknown

  constructor(message: string, details: { status: number; url: string; contentType: string; body?: unknown }) {
    super(message)
    this.name = 'ApiResponseError'
    this.status = details.status
    this.url = details.url
    this.contentType = details.contentType
    this.body = details.body
  }
}

export function isHtmlContentType(contentType: string): boolean {
  return /text\/html|application\/xhtml/i.test(contentType)
}

/** Hint appended to errors caused by a 200-HTML "success" from the SPA shell. */
export const HOSTING_REWRITE_HINT =
  'The response was an HTML document, which means the request never reached the `api` Cloud Function ' +
  '(most likely the SPA hosting rewrite served index.html). Check VITE_API_BASE_URL or the Vite dev proxy.'

function extractServerMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const record = body as Record<string, unknown>
  for (const key of ['message', 'error', 'detail']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

/**
 * Guards a `fetch` response that is expected to be JSON.
 *
 * Resolves only for `2xx` + `application/json`. Everything else throws an
 * `ApiResponseError` whose message is:
 *   - the server's own `message`/`error` for JSON error bodies (so UI toasts
 *     keep showing e.g. rate-limit text verbatim), or
 *   - a loud, URL-bearing description when the body is HTML or otherwise not
 *     JSON — so a hosting-rewrite mishit can never masquerade as an answer.
 */
export async function assertJsonResponse(response: Response, url: string = response.url): Promise<void> {
  const contentType = response.headers.get('content-type') || ''
  const isJson = /application\/json/i.test(contentType)

  if (response.ok && isJson) return

  let body: unknown
  let message = ''

  if (isJson) {
    body = await response.json().catch(() => undefined)
    message = extractServerMessage(body)
  }

  if (!message) {
    const where = `${response.status}${response.statusText ? ` ${response.statusText}` : ''} from ${url}`
    if (isHtmlContentType(contentType)) {
      message = `Unexpected HTML response (${where}). ${HOSTING_REWRITE_HINT}`
    } else if (!isJson) {
      message = `Unexpected non-JSON response (${where}, content-type: ${contentType || 'none'}).`
    } else {
      message = `API request failed (${where}).`
    }
  }

  throw new ApiResponseError(message, { status: response.status, url, contentType, body })
}
