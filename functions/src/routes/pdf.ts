// functions/src/routes/pdf.ts
//
// Item 4.4 of docs/HANDOFF_OPTIMISATION_2026-09-25.md — split the PDF routes
// into their own function.
//
// Why: `api` ran at 2 GiB purely because these three routes launch headless
// Chrome (utils/pdfRenderer.ts). Every ordinary API request — a login, a list,
// an autosave — therefore paid for a Chrome-sized instance, and a Chrome crash
// could take the whole API down with it. Here the routes get their own 2 GiB
// function with its own timeout, and `api` drops back to 512 MiB.
//
// The migration contract (plan §4.4): mount these routes in BOTH functions for
// one release. The client routes `/pdf/*` to the new base URL, but an older
// deployed bundle — or a stale service worker cache — still calls
// `<api>/papers/:id/pdf`, which keeps working until the next release drops the
// old mounts.
//
// The handlers themselves are NOT reimplemented here: they are imported from
// the routers that own their HTML builders. Two copies of a PDF route is two
// places for the 503-and-fall-back-to-client contract to drift.

import cors from 'cors'
import express, { type Request, type Response, type NextFunction } from 'express'
import helmet from 'helmet'
import { apiCorsOptions } from '../middleware/cors'
import { onRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'

import { generalLimiter, reportPdfLimiter } from '../middleware/rateLimit'
import { verifyAuth, requireRole } from '../middleware/auth'
import { renderPaperPdf } from './papers'
import { exportQuestionsPdf } from './questions'
import { resumePdfHandler } from './resume'
import { exportAttendanceRegisterPdf } from './attendancePdf'

// The role lists are duplicated from the owning routers on purpose: the guard on
// a route must be visible next to the mount that exposes it, and the shared
// handler asserts college access itself.
const PAPER_READ_ROLES = ['superadmin', 'admin', 'principal', 'hod', 'faculty', 'mentor', 'student'] as const
const QUESTION_DRAFT_ROLES = ['superadmin', 'admin', 'principal', 'hod', 'faculty', 'mentor'] as const
const STUDENT_ROLES = ['student'] as const
// Who may print a register: the staff who can already see one on screen. The
// route renders the rows it is handed, so this list limits the renderer, not the
// data — the college/department scope is applied by the client's own queries.
const REPORT_ROLES = ['superadmin', 'admin', 'principal', 'hod', 'faculty', 'mentor'] as const

export const pdfApp = express()

// Same posture as the api app: response downloads go cross-origin to the
// hosting app, so CORP stays permissive and CORS governs who may call.
pdfApp.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))

pdfApp.use(cors(apiCorsOptions()))
pdfApp.options('*', cors(apiCorsOptions()))
pdfApp.use(express.json({ limit: '2mb' }))
pdfApp.use(generalLimiter)

const healthHandler = (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'pdf', timestamp: new Date().toISOString(), version: '1.0.0' })
}
pdfApp.get('/api/health', healthHandler)
pdfApp.get('/health', healthHandler)
pdfApp.get('/', healthHandler)

// ─── Mount the PDF routes on both prefixes ──────────────────────────────────
// `/api/*` is what the browser bundle calls; the bare prefixes exist for the
// same reason as in index.ts (Cloud Functions v2 strips the function name).
pdfApp.get('/api/papers/:id/pdf', verifyAuth, requireRole(...PAPER_READ_ROLES), renderPaperPdf)
pdfApp.get('/papers/:id/pdf', verifyAuth, requireRole(...PAPER_READ_ROLES), renderPaperPdf)
pdfApp.post('/api/questions/export/pdf', verifyAuth, requireRole(...QUESTION_DRAFT_ROLES), exportQuestionsPdf)
pdfApp.post('/questions/export/pdf', verifyAuth, requireRole(...QUESTION_DRAFT_ROLES), exportQuestionsPdf)
// The resume route keeps its own rate limiter (resumePdfLimiter) inside the
// handler's registration in routes/resume.ts; this mount only adds auth roles.
pdfApp.post('/api/resume/pdf', requireRole(...STUDENT_ROLES), resumePdfHandler)
pdfApp.post('/resume/pdf', requireRole(...STUDENT_ROLES), resumePdfHandler)
// The attendance register (item 4.3). New route, so it exists only here — there
// is no older bundle that calls it on the `api` function.
pdfApp.post('/api/attendance/register/pdf', verifyAuth, requireRole(...REPORT_ROLES), reportPdfLimiter, exportAttendanceRegisterPdf)
pdfApp.post('/attendance/register/pdf', verifyAuth, requireRole(...REPORT_ROLES), reportPdfLimiter, exportAttendanceRegisterPdf)

pdfApp.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found', path: req.path, service: 'pdf' })
})

pdfApp.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error('[pdf] unhandled route error', err)
  const message = err instanceof Error ? err.message : 'Internal server error'
  res.status(500).json({ error: message })
})

/**
 * The PDF function: Chrome-sized memory, a longer timeout than the API (a
 * 70-page paper can take half a minute to render), and its own instance cap so
 * a burst of exports cannot exhaust the API's.
 */
export const pdf = onRequest(
  {
    region: 'asia-south1',
    memory: '2GiB',
    timeoutSeconds: 120,
    minInstances: 0,
    maxInstances: 5,
  },
  pdfApp,
)
