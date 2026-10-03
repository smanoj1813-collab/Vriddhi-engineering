import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/accessProducts.ts
// ─── Platform-access products: duration, price, and what a student bought ────
//
// WHY THIS EXISTS
// Student onboarding had no notion of how long a student's platform access
// lasts or what was paid for it: every imported account was live forever with
// no record of which package it came from. There was nothing to renew, nothing
// to expire, and no way to answer "how many students are on the 3-year product
// and what is that worth?".
//
// A PRODUCT is the sellable unit — a name, a duration in MONTHS (1/2/3 years),
// and a price per student. Assigning it writes the window it buys onto the
// student:
//
//     accessProductId / accessProductName / accessDurationMonths / accessPrice
//     accessStart (yyyy-mm-dd) ──► accessEnd (yyyy-mm-dd, inclusive last day)
//
// The window rule lives here and is mirrored in src/shared/utils/accessWindow.ts
// (functions/ cannot import from src/ — rootDir: src). functions/test/
// accessProducts.test.ts imports BOTH copies and fails if they drift.
//
// WHAT IS COMPUTED vs STORED
// Only the dates are stored. "Active / Expiring / Expired" is derived from the
// end date against today, so a subscription ages correctly with no write and no
// cron job. The MIS callable aggregates those buckets server-side over the
// students collection, so a 5,000-student college never has to ship every row
// to the browser to draw one dashboard.
//
// Pure core (dates + aggregation) is exported for unit tests.

import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { verifyCaller } from './identityShared'

// ═════════════════════════════════════════════════════════════════════════════
// Pure core — dates
// ═════════════════════════════════════════════════════════════════════════════

export type AccessStatus = 'active' | 'expiring' | 'expired'

/** Days before the end date at which access is reported as "expiring". */
export const ACCESS_EXPIRING_SOON_DAYS = 60

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real yyyy-mm-dd calendar date (rejects 2026-02-30). */
export function isDateKey(value: unknown): value is string {
  const match = DATE_KEY.exec(String(value ?? '').trim())
  if (!match) return false
  const [, y, m, d] = match
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  )
}

function toUtcDate(key: string): Date {
  const [, y, m, d] = DATE_KEY.exec(key)!
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
}

function toKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * The same day `months` calendar months later, clamped to the last day of the
 * target month: 2026-01-31 + 1 month → 2026-02-28, not 2026-03-03.
 */
export function addMonthsToDateKey(dateKey: string, months: number): string | null {
  if (!isDateKey(dateKey)) return null
  if (!Number.isFinite(months)) return null
  const wholeMonths = Math.trunc(months)
  const start = toUtcDate(dateKey)
  const day = start.getUTCDate()
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + wholeMonths, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return toKey(target)
}

/** Add (or subtract) whole days to a date key. */
export function addDaysToDateKey(dateKey: string, days: number): string | null {
  if (!isDateKey(dateKey)) return null
  const date = toUtcDate(dateKey)
  date.setUTCDate(date.getUTCDate() + Math.trunc(days))
  return toKey(date)
}

export interface AccessWindow {
  /** First day of access (yyyy-mm-dd). */
  start: string
  /** LAST day of access, inclusive (yyyy-mm-dd). */
  end: string
  durationMonths: number
}

/**
 * The window a product of `durationMonths` buys from `startDate`.
 *
 * A 12-month product starting 2026-10-01 ends 2027-09-30 — the end date is the
 * last day covered. Returns null when the start date or the duration is
 * unusable.
 */
export function computeAccessWindow(startDate: unknown, durationMonths: unknown): AccessWindow | null {
  const start = String(startDate ?? '').trim()
  if (!isDateKey(start)) return null
  const months = Number(durationMonths)
  if (!Number.isFinite(months) || months <= 0) return null
  const wholeMonths = Math.max(1, Math.trunc(months))
  const exclusiveEnd = addMonthsToDateKey(start, wholeMonths)
  if (!exclusiveEnd) return null
  const end = addDaysToDateKey(exclusiveEnd, -1)
  if (!end) return null
  return { start, end, durationMonths: wholeMonths }
}

/** Whole days from `today` to the inclusive end date (negative once past). */
export function accessDaysLeft(endDate: unknown, today: unknown): number | null {
  const end = String(endDate ?? '').trim()
  const now = String(today ?? '').trim()
  if (!isDateKey(end) || !isDateKey(now)) return null
  return Math.round((toUtcDate(end).getTime() - toUtcDate(now).getTime()) / 86_400_000)
}

/**
 * active   — more than `warnDays` left
 * expiring — ends today or within `warnDays`
 * expired  — the end date is in the past, or missing (access that cannot be
 *            proved valid must be surfaced, not hidden)
 */
export function accessStatus(
  endDate: unknown,
  today: unknown,
  warnDays: number = ACCESS_EXPIRING_SOON_DAYS,
): AccessStatus {
  const left = accessDaysLeft(endDate, today)
  if (left === null) return 'expired'
  if (left < 0) return 'expired'
  if (left <= Math.max(0, Math.trunc(warnDays))) return 'expiring'
  return 'active'
}

// ═════════════════════════════════════════════════════════════════════════════
// Pure core — the fields an assignment writes
// ═════════════════════════════════════════════════════════════════════════════

/** The catalogue row (accessProducts/{id}) as stored. */
export interface AccessProductDoc {
  id: string
  name: string
  code: string
  durationMonths: number
  price: number
  currency: string
  description?: string
  active: boolean
}

export interface AccessFields {
  accessProductId: string
  accessProductName: string
  accessDurationMonths: number
  accessPrice: number
  accessCurrency: string
  accessStart: string
  accessEnd: string
}

/**
 * The student-document fields a product assignment writes. Both the import
 * callable and the bulk-assign callable go through this, so a student's window
 * is derived identically wherever it is set. Returns null when the product or
 * the start date cannot produce a window.
 */
export function buildAccessFields(
  product: Pick<AccessProductDoc, 'id' | 'name' | 'durationMonths' | 'price'> & { currency?: string },
  startDate: unknown,
): AccessFields | null {
  if (!product || !product.id) return null
  const window = computeAccessWindow(startDate, product.durationMonths)
  if (!window) return null
  return {
    accessProductId: product.id,
    accessProductName: String(product.name || '').trim(),
    accessDurationMonths: window.durationMonths,
    accessPrice: Number(product.price) || 0,
    accessCurrency: String(product.currency || 'INR'),
    accessStart: window.start,
    accessEnd: window.end,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Pure core — MIS aggregation
// ═════════════════════════════════════════════════════════════════════════════

/** One student's access-relevant fields, as the aggregator reads them. */
export interface AccessRow {
  studentId?: string
  name?: string
  regNo?: string
  collegeId?: string
  productId?: unknown
  productName?: unknown
  durationMonths?: unknown
  price?: unknown
  end?: unknown
}

export interface AccessProductSummary {
  productId: string
  productName: string
  durationMonths: number
  price: number
  students: number
  active: number
  expiring: number
  expired: number
  /** price × (active + expiring) — the value of access still running. */
  activeValue: number
  /** price × expired — lapsed subscriptions, the renewal pipeline. */
  expiredValue: number
}

export interface AccessMisSummary {
  today: string
  totals: {
    students: number
    withProduct: number
    active: number
    expiring: number
    expired: number
    /** Students with no product/end date on file at all. */
    unassigned: number
    activeValue: number
    expiredValue: number
  }
  byProduct: AccessProductSummary[]
  byCollege: Array<{ collegeId: string; students: number; active: number; expiring: number; expired: number; unassigned: number }>
}

const UNASSIGNED_KEY = '__unassigned__'

/**
 * Aggregate access rows into the MIS view: per-product buckets + totals.
 *
 * Every row counts exactly once: a row with no product id lands in the
 * synthetic "unassigned" product so the buckets always add up to `students`.
 */
export function summarizeAccess(
  rows: readonly AccessRow[],
  today: string,
  warnDays: number = ACCESS_EXPIRING_SOON_DAYS,
): AccessMisSummary {
  const byProduct = new Map<string, AccessProductSummary>()
  const byCollege = new Map<string, { collegeId: string; students: number; active: number; expiring: number; expired: number; unassigned: number }>()
  const totals = {
    students: 0,
    withProduct: 0,
    active: 0,
    expiring: 0,
    expired: 0,
    unassigned: 0,
    activeValue: 0,
    expiredValue: 0,
  }

  for (const row of rows) {
    const productId = String(row.productId ?? '').trim()
    const assigned = Boolean(productId)
    const status = assigned ? accessStatus(row.end, today, warnDays) : 'expired'
    const price = Number(row.price) || 0

    const key = assigned ? productId : UNASSIGNED_KEY
    let entry = byProduct.get(key)
    if (!entry) {
      entry = {
        productId: assigned ? productId : '',
        productName: assigned ? String(row.productName ?? '').trim() || productId : 'No product assigned',
        durationMonths: Math.trunc(Number(row.durationMonths)) || 0,
        price,
        students: 0,
        active: 0,
        expiring: 0,
        expired: 0,
        activeValue: 0,
        expiredValue: 0,
      }
      byProduct.set(key, entry)
    }
    entry.students += 1
    if (!assigned) {
      entry.expired += 1
    } else if (status === 'active') {
      entry.active += 1
      entry.activeValue += price
      entry.price = entry.price || price
      entry.durationMonths = entry.durationMonths || Math.trunc(Number(row.durationMonths)) || 0
    } else if (status === 'expiring') {
      entry.expiring += 1
      entry.activeValue += price
      entry.price = entry.price || price
      entry.durationMonths = entry.durationMonths || Math.trunc(Number(row.durationMonths)) || 0
    } else {
      entry.expired += 1
      entry.expiredValue += price
    }

    totals.students += 1
    if (!assigned) {
      totals.unassigned += 1
    } else {
      totals.withProduct += 1
      if (status === 'active') {
        totals.active += 1
        totals.activeValue += price
      } else if (status === 'expiring') {
        totals.expiring += 1
        totals.activeValue += price
      } else {
        totals.expired += 1
        totals.expiredValue += price
      }
    }

    const collegeId = String(row.collegeId ?? '').trim() || '(none)'
    let college = byCollege.get(collegeId)
    if (!college) {
      college = { collegeId, students: 0, active: 0, expiring: 0, expired: 0, unassigned: 0 }
      byCollege.set(collegeId, college)
    }
    college.students += 1
    if (!assigned) college.unassigned += 1
    else if (status === 'active') college.active += 1
    else if (status === 'expiring') college.expiring += 1
    else college.expired += 1
  }

  const products = [...byProduct.values()].sort(
    (a, b) => b.students - a.students || a.productName.localeCompare(b.productName),
  )
  const colleges = [...byCollege.values()].sort((a, b) => b.students - a.students)

  return { today, totals, byProduct: products, byCollege: colleges }
}

// ═════════════════════════════════════════════════════════════════════════════
// Catalogue helpers (Firestore)
// ═════════════════════════════════════════════════════════════════════════════

export const MAX_ACCESS_PRODUCTS = 200
const MAX_MIS_STUDENTS = 20_000
const MIS_PAGE_SIZE = 1_000

export function docToAccessProduct(id: string, data: Record<string, unknown>): AccessProductDoc {
  return {
    id,
    name: String(data.name ?? '').trim(),
    code: String(data.code ?? '').trim(),
    durationMonths: Math.trunc(Number(data.durationMonths)) || 0,
    price: Number(data.price) || 0,
    currency: String(data.currency ?? 'INR'),
    description: String(data.description ?? ''),
    active: data.active !== false,
  }
}

/** Load a product by id, or null when it does not exist / is archived. */
export async function loadActiveProduct(
  db: admin.firestore.Firestore,
  productId: unknown,
): Promise<AccessProductDoc | null> {
  const id = String(productId ?? '').trim()
  if (!id) return null
  const snap = await db.collection('accessProducts').doc(id).get()
  if (!snap.exists) return null
  const product = docToAccessProduct(snap.id, (snap.data() || {}) as Record<string, unknown>)
  return product.active ? product : null
}

/** Today in IST — the college day, not the server's UTC day. */
export function todayInIst(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
  return ist.toISOString().slice(0, 10)
}

// ═════════════════════════════════════════════════════════════════════════════
// Callable — assign / reassign / clear a student's platform access
// ═════════════════════════════════════════════════════════════════════════════

const MAX_STUDENTS = 500
const WRITE_CHUNK_SIZE = 200
const REGION = { region: 'asia-south1' as const }

interface BulkAccessInput {
  studentIds?: unknown
  productId?: unknown
  startDate?: unknown
  clearAccess?: unknown
}

interface BulkAccessResult {
  updated: number
  missingIds: string[]
  productName: string
  accessStart: string
  accessEnd: string
  cleared: number
}

/** Fields removed when access is cleared (Firestore delete sentinels). */
export const ACCESS_FIELD_NAMES = [
  'accessProductId',
  'accessProductName',
  'accessDurationMonths',
  'accessPrice',
  'accessCurrency',
  'accessStart',
  'accessEnd',
] as const

export const bulkUpdateStudentAccess = onCall(
  { ...REGION, memory: '512MiB', timeoutSeconds: 120, maxInstances: 10 },
  async (request): Promise<BulkAccessResult> => {
    await verifyCaller(request, ['superadmin'])

    const input = (request.data || {}) as BulkAccessInput
    if (!Array.isArray(input.studentIds)) {
      throw new HttpsError('invalid-argument', 'studentIds must be an array')
    }
    const studentIds = Array.from(
      new Set(input.studentIds.map((id) => String(id || '').trim()).filter(Boolean)),
    )
    if (studentIds.length === 0) throw new HttpsError('invalid-argument', 'Select at least one student')
    if (studentIds.length > MAX_STUDENTS) {
      throw new HttpsError('invalid-argument', `Update at most ${MAX_STUDENTS} students at a time`)
    }

    const db = getFirestore(admin.app(), 'default')
    const clear = input.clearAccess === true
    const today = todayInIst()

    let product: AccessProductDoc | null = null
    let fields: AccessFields | null = null
    if (!clear) {
      product = await loadActiveProduct(db, input.productId)
      if (!product) {
        throw new HttpsError(
          'failed-precondition',
          'Pick an active product — that product does not exist or has been archived',
        )
      }
      const startDate = String(input.startDate ?? '').trim() || today
      fields = buildAccessFields(product, startDate)
      if (!fields) {
        throw new HttpsError(
          'invalid-argument',
          `Access start date "${startDate}" is not a yyyy-mm-dd date, or the product has no duration`,
        )
      }
    }

    const refs = studentIds.map((id) => db.collection('students').doc(id))
    const snapshots = await db.getAll(...refs)
    const existing = snapshots.filter((snapshot) => snapshot.exists)
    const missingIds = snapshots.filter((snapshot) => !snapshot.exists).map((snapshot) => snapshot.id)
    const now = admin.firestore.FieldValue.serverTimestamp()

    let updated = 0
    for (let offset = 0; offset < existing.length; offset += WRITE_CHUNK_SIZE) {
      const chunk = existing.slice(offset, offset + WRITE_CHUNK_SIZE)
      const write = db.batch()
      for (const snapshot of chunk) {
        const student = (snapshot.data() || {}) as Record<string, unknown>
        const updates: Record<string, unknown> = { updatedAt: now }
        if (fields) {
          Object.assign(updates, fields)
        } else {
          for (const name of ACCESS_FIELD_NAMES) updates[name] = admin.firestore.FieldValue.delete()
        }
        write.update(snapshot.ref, updates)

        const uid = String(student.userId || student.uid || '').trim()
        if (uid) write.set(db.collection('users').doc(uid), updates, { merge: true })
        updated += 1
      }
      await write.commit()
    }

    return {
      updated,
      missingIds,
      productName: product?.name || '',
      accessStart: fields?.accessStart || '',
      accessEnd: fields?.accessEnd || '',
      cleared: clear ? updated : 0,
    }
  },
)

// ═════════════════════════════════════════════════════════════════════════════
// Callable — MIS aggregation
// ═════════════════════════════════════════════════════════════════════════════

export interface AccessMisResponse extends AccessMisSummary {
  generatedAt: string
  /** Next expiries across the college (or one college when filtered), soonest first. */
  expiringSoon: Array<{
    studentId: string
    name: string
    regNo: string
    collegeId: string
    productName: string
    end: string
    daysLeft: number | null
  }>
}

export const getAccessMis = onCall(
  { ...REGION, memory: '512MiB', timeoutSeconds: 120, maxInstances: 10 },
  async (request): Promise<AccessMisResponse> => {
    await verifyCaller(request, ['superadmin'])
    const raw = (request.data || {}) as Record<string, unknown>
    const collegeId = String(raw.collegeId ?? '').trim()
    const today = todayInIst()

    const db = getFirestore(admin.app(), 'default')
    const rows: AccessRow[] = []
    let cursor: admin.firestore.QueryDocumentSnapshot | null = null

    // Paged server-side scan; only the fields the summary needs are returned.
    for (;;) {
      let query: admin.firestore.Query = db
        .collection('students')
        .select(
          'name',
          'regNo',
          'collegeId',
          'accessProductId',
          'accessProductName',
          'accessDurationMonths',
          'accessPrice',
          'accessEnd',
        )
        .limit(MIS_PAGE_SIZE)
      if (collegeId) query = query.where('collegeId', '==', collegeId)
      if (cursor) query = query.startAfter(cursor)
      const snap = await query.get()
      if (snap.empty) break
      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>
        rows.push({
          studentId: doc.id,
          name: String(data.name ?? ''),
          regNo: String(data.regNo ?? ''),
          collegeId: String(data.collegeId ?? ''),
          productId: data.accessProductId,
          productName: data.accessProductName,
          durationMonths: data.accessDurationMonths,
          price: data.accessPrice,
          end: data.accessEnd,
        })
      }
      cursor = snap.docs[snap.docs.length - 1]
      if (rows.length >= MAX_MIS_STUDENTS || snap.size < MIS_PAGE_SIZE) break
    }

    const summary = summarizeAccess(rows, today)
    const expiringSoon = rows
      .filter((row) => row.productId && accessStatus(row.end, today) !== 'expired')
      .map((row) => ({
        studentId: String(row.studentId || ''),
        name: String(row.name || ''),
        regNo: String(row.regNo || ''),
        collegeId: String(row.collegeId || ''),
        productName: String(row.productName || ''),
        end: String(row.end || ''),
        daysLeft: accessDaysLeft(row.end, today),
      }))
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
      .slice(0, 200)

    return { generatedAt: new Date().toISOString(), ...summary, expiringSoon }
  },
)
