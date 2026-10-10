// Shared CORS policy for the `api` and `pdf` Express apps (audit P2-7).
//
// Auth is Bearer-token based (no cookies), so reflecting any origin was
// tolerable — but an allow-list is cheap defence-in-depth. Allowed callers:
// the production hosting origins, any Firebase Hosting preview channel of
// this project (*.web.app / *.firebaseapp.com), and http localhost for local
// development. Requests with no Origin header (curl, schedulers,
// server-to-server) are not browser CORS requests and pass through.
// CORS_EXTRA_ORIGINS (comma-separated) is the escape hatch for future
// domains. Mirrors cors.json (Storage), which models the same origin set.

import type { CorsOptions } from 'cors'

const PROD_ORIGINS = ['https://vriddhi-engineering.web.app', 'https://vriddhi-engineering.firebaseapp.com']
// Preview channels keep the project id as a PREFIX
// (<project>--<channel>-<hash>.web.app), so prefix-match — never suffix-match:
// anyone can register a lookalike project such as evil-vriddhi-engineering.
const CHANNEL_HOSTS = [
  { prefix: 'vriddhi-engineering--', suffix: '.web.app' },
  { prefix: 'vriddhi-engineering--', suffix: '.firebaseapp.com' },
]

export function isAllowedCorsOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true
  const extra = (process.env.CORS_EXTRA_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (PROD_ORIGINS.includes(origin) || extra.includes(origin)) return true
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.protocol === 'http:') return true
  const host = url.hostname.toLowerCase()
  return (
    url.protocol === 'https:' &&
    CHANNEL_HOSTS.some(({ prefix, suffix }) => host.startsWith(prefix) && host.endsWith(suffix))
  )
}

export function apiCorsOptions(): CorsOptions {
  return {
    origin: (origin, callback) => callback(null, isAllowedCorsOrigin(origin ?? undefined)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-College-Id'],
  }
}
