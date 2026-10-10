// src/modules/admin/api/feeApi.ts
// Firestore API for the college fee ledger.
//
// Fee data is tenant-scoped below colleges/{collegeId}. The browser never
// chooses a college from a form: AuthContext refreshes the verified claim and
// stores the id only as a path selector for this API. Firestore rules remain
// the authorization boundary.

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from '@/Firebase/config'
import {
  creditLedger,
  normalizeReference,
  suggestTransactionId,
  type PaymentSubmissionStatus,
} from '../utils/feeReference'
import { feeNetPayable } from '../utils/financeRules'

export { feeNetPayable } from '../utils/financeRules'

const MAX_READS = 500

// Receipt numbering prefix — configurable per college (Finance Settings →
// Receipts & letterhead). Pages that record payments call setReceiptPrefix()
// once the branding doc loads; the default keeps historic RCP-YYYY-NNNNNN.
let receiptPrefix = 'RCP'

export function setReceiptPrefix(prefix: string | undefined | null): void {
  const clean = String(prefix || '').trim().toUpperCase().replace(/[^A-Z0-9/-]/g, '')
  receiptPrefix = clean || 'RCP'
}

export function nextReceiptNo(): string {
  return `${receiptPrefix}-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`
}

/** What collectPayment hands back so the UI can offer the receipt immediately. */
export interface CollectPaymentResult {
  receiptNo: string
  transactionId: string
  paidOn: string
  amount: number
  paymentMode: PaymentMode
  bankReference?: string
}

function getCollegeId(explicit?: string | null): string {
  // Callers that already know their tenant (a student page resolving the
  // college from its own profile) pass it in; everyone else falls back to the
  // key AuthContext persists from the verified token claim.
  const id = (explicit && explicit.trim()) || localStorage.getItem('vriddhi_college_id')
  if (!id) {
    throw new Error(
      'This sign-in carries no college to scope fee queries to. Sign out and back in so the token is refreshed; if it persists, ask an administrator to link this profile to a college.'
    )
  }
  return id
}

function collegeRef(path: string, collegeId?: string | null) {
  return collection(db, 'colleges', getCollegeId(collegeId), path)
}

function collegeDocRef(path: string, collegeId?: string | null) {
  return doc(db, 'colleges', getCollegeId(collegeId), path)
}

function asString(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return value == null ? '' : String(value)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function numeric(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

// ─── Types ──────────────────────────────────────────────

export type FeeStatus = 'paid' | 'pending' | 'overdue' | 'partial' | 'waived'
export type FeeCategory = 'tuition' | 'exam' | 'university_exam' | 'eligibility' | 'library' | 'lab' | 'hostel' | 'transport' | 'misc'
export type PaymentMode = 'cash' | 'card' | 'upi' | 'netbanking' | 'cheque' | 'dd'

/** Re-exported so the admin UI and student portal share one submission lifecycle. */
export type { PaymentSubmissionStatus } from '../utils/feeReference'

/** Extra proof/details an operator (or a verifying admin) attaches to a payment. */
export interface CollectPaymentOptions {
  /** Operator-entered bank/UPI reference. Blank → an id is auto-generated. */
  transactionId?: string
  bankReference?: string
  /** Storage download URL of the payment screenshot (see feeProofStorage). */
  screenshotUrl?: string
  /** Actual date money changed hands (YYYY-MM-DD). Defaults to today. */
  paidOn?: string
}

/** A student's self-declared payment awaiting finance-office verification. */
export interface SubmitProofInput {
  amount: number
  paymentMode: PaymentMode
  transactionId?: string
  bankReference?: string
  screenshotUrl?: string
  paidOn?: string
  remarks?: string
}

export interface FeeStructure {
  id: string
  category: FeeCategory
  name: string
  amount: number
  course: string
  batch: string
  dueDate: string
  academicYear: string
  semester: string
  description?: string
  lateFeePerDay?: number
  createdAt?: string
  updatedAt?: string
}

export interface FeePayment {
  id: string
  studentId: string
  studentName: string
  regNo: string
  course: string
  batch: string
  structureId: string
  category: FeeCategory
  amount: number
  paidAmount: number
  status: FeeStatus
  dueDate: string
  paidDate?: string
  paymentMode?: PaymentMode
  transactionId?: string
  receiptNo?: string
  bankReference?: string
  screenshotUrl?: string
  /** Total discount applied (category / merit / management), reduces the amount owed. */
  discountTotal?: number
  /** Late-payment fine assessed, added to the amount owed. */
  lateFine?: number
  /** Materialised payable = max(0, amount − discountTotal) + lateFine. */
  netAmount?: number
  remarks?: string
  collectedBy?: string
  createdAt: string
  updatedAt: string
}

export interface FeeStudent {
  id: string
  name: string
  regNo: string
  course: string
  batch: string
  collegeId: string
}

export interface CreateFeePaymentInput {
  studentId: string
  studentName: string
  regNo: string
  course: string
  batch: string
  structureId?: string
  category: FeeCategory
  amount: number
  dueDate: string
  remarks?: string
}

export interface FeeTransaction {
  id: string
  type: 'payment' | 'waiver' | 'discount'
  amount: number
  paymentMode?: PaymentMode
  transactionId?: string
  receiptNo?: string
  /** Bank/UPI reference the operator or student supplied (distinct from the generated id). */
  bankReference?: string
  /** Storage download URL of the payment screenshot, when one was attached. */
  screenshotUrl?: string
  /** Actual date money changed hands (YYYY-MM-DD). */
  paidOn?: string
  /** recorded → pending_verification → verified | rejected (see feeReference). */
  submissionStatus?: PaymentSubmissionStatus
  /** Who filed a student-submitted proof. */
  submittedBy?: string
  verifiedBy?: string
  verifiedAt?: string
  rejectionReason?: string
  remarks?: string
  performedBy?: string
  createdAt: string
}

export interface FeeSummary {
  totalDue: number
  totalPaid: number
  totalPending: number
  totalOverdue: number
  totalWaived: number
  countPaid: number
  countPending: number
  countOverdue: number
  countPartial: number
}

export interface FeeFilters {
  course: string
  batch: string
  status: FeeStatus | 'all'
  category: FeeCategory | 'all'
  search: string
  dateFrom: string
  dateTo: string
  studentId?: string
}

function mapPayment(id: string, raw: Record<string, unknown>): FeePayment {
  const amount = numeric(raw.amount)
  const paidAmount = Math.min(Math.max(numeric(raw.paidAmount), 0), amount)
  const storedStatus = (raw.status || 'pending') as FeeStatus
  const dueDate = asString(raw.dueDate).slice(0, 10)
  const derivedStatus: FeeStatus =
    storedStatus === 'waived' || storedStatus === 'paid'
      ? storedStatus
      : paidAmount >= amount && amount > 0
        ? 'paid'
        : dueDate && dueDate < today()
          ? 'overdue'
          : paidAmount > 0
            ? 'partial'
            : 'pending'

  return {
    id,
    studentId: String(raw.studentId || ''),
    studentName: String(raw.studentName || 'Unknown student'),
    regNo: String(raw.regNo || ''),
    course: String(raw.course || ''),
    batch: String(raw.batch || ''),
    structureId: String(raw.structureId || ''),
    category: (raw.category || 'misc') as FeeCategory,
    amount,
    paidAmount,
    status: derivedStatus,
    dueDate,
    paidDate: raw.paidDate ? asString(raw.paidDate).slice(0, 10) : undefined,
    paymentMode: raw.paymentMode as PaymentMode | undefined,
    transactionId: raw.transactionId ? String(raw.transactionId) : undefined,
    receiptNo: raw.receiptNo ? String(raw.receiptNo) : undefined,
    bankReference: raw.bankReference ? String(raw.bankReference) : undefined,
    screenshotUrl: raw.screenshotUrl ? String(raw.screenshotUrl) : undefined,
    discountTotal: raw.discountTotal == null ? undefined : numeric(raw.discountTotal),
    lateFine: raw.lateFine == null ? undefined : numeric(raw.lateFine),
    remarks: raw.remarks ? String(raw.remarks) : undefined,
    collectedBy: raw.collectedBy ? String(raw.collectedBy) : undefined,
    createdAt: asString(raw.createdAt),
    updatedAt: asString(raw.updatedAt),
  }
}

function mapStructure(id: string, raw: Record<string, unknown>): FeeStructure {
  return {
    id,
    category: (raw.category || 'misc') as FeeCategory,
    name: String(raw.name || 'Fee'),
    amount: numeric(raw.amount),
    course: String(raw.course || ''),
    batch: String(raw.batch || ''),
    dueDate: asString(raw.dueDate).slice(0, 10),
    academicYear: String(raw.academicYear || ''),
    semester: String(raw.semester || ''),
    description: raw.description ? String(raw.description) : undefined,
    lateFeePerDay: raw.lateFeePerDay == null ? undefined : numeric(raw.lateFeePerDay),
    createdAt: asString(raw.createdAt),
    updatedAt: asString(raw.updatedAt),
  }
}

// ─── Reads ──────────────────────────────────────────────

/**
 * `collegeId` is the signed-in identity's college, passed in by the finance
 * desk. It is a TENANT SCOPE, not an authorisation decision: the security rules
 * still compare every document against the ID-token claim, so passing a college
 * the caller does not hold can only ever produce an empty result, never a
 * cross-tenant read. Passing it means the desk is scoped by the same verified
 * value the rules use instead of by a localStorage copy that can be stale.
 */
export async function fetchFeeStructures(collegeId?: string | null): Promise<FeeStructure[]> {
  const snap = await getDocs(query(collegeRef('feeStructures', collegeId), limit(MAX_READS)))
  return snap.docs
    .map(d => mapStructure(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

export async function fetchFeeStudents(scopeCollegeId?: string | null): Promise<FeeStudent[]> {
  const collegeId = getCollegeId(scopeCollegeId)
  const snap = await getDocs(query(collection(db, 'students'), where('collegeId', '==', collegeId), limit(MAX_READS)))
  return snap.docs
    .map(d => {
      const raw = d.data() as Record<string, unknown>
      return {
        id: d.id,
        name: String(raw.name || 'Unnamed student'),
        regNo: String(raw.regNo || raw.registrationNumber || raw.usn || ''),
        course: String(raw.course || raw.department || raw.branch || ''),
        batch: String(raw.batch || raw.academicYear || ''),
        collegeId: String(raw.collegeId || collegeId),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function fetchFeePayments(
  filters?: Partial<FeeFilters>,
  collegeId?: string | null
): Promise<FeePayment[]> {
  const constraints = filters?.studentId
    ? [where('studentId', '==', filters.studentId), limit(MAX_READS)]
    : [limit(MAX_READS)]
  const snap = await getDocs(query(collegeRef('feePayments', collegeId), ...constraints))

  let payments = snap.docs.map(d => mapPayment(d.id, d.data() as Record<string, unknown>))
  if (filters?.course && filters.course !== 'all') payments = payments.filter(p => p.course === filters.course)
  if (filters?.batch && filters.batch !== 'all') payments = payments.filter(p => p.batch === filters.batch)
  if (filters?.category && filters.category !== 'all') payments = payments.filter(p => p.category === filters.category)
  if (filters?.status && filters.status !== 'all') payments = payments.filter(p => p.status === filters.status)
  if (filters?.search) {
    const search = filters.search.toLowerCase().trim()
    payments = payments.filter(p => `${p.studentName} ${p.regNo} ${p.category} ${p.receiptNo || ''}`.toLowerCase().includes(search))
  }
  if (filters?.dateFrom) payments = payments.filter(p => p.dueDate >= filters.dateFrom!)
  if (filters?.dateTo) payments = payments.filter(p => p.dueDate <= filters.dateTo!)

  return payments.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

export async function fetchFeeTransactions(paymentId: string): Promise<FeeTransaction[]> {
  const snap = await getDocs(query(collection(collegeDocRef(`feePayments/${paymentId}`), 'transactions'), limit(100)))
  return snap.docs
    .map(d => {
      const raw = d.data() as Record<string, unknown>
      return {
        id: d.id,
        type: (raw.type || 'payment') as FeeTransaction['type'],
        amount: numeric(raw.amount),
        paymentMode: raw.paymentMode as PaymentMode | undefined,
        transactionId: raw.transactionId ? String(raw.transactionId) : undefined,
        receiptNo: raw.receiptNo ? String(raw.receiptNo) : undefined,
        bankReference: raw.bankReference ? String(raw.bankReference) : undefined,
        screenshotUrl: raw.screenshotUrl ? String(raw.screenshotUrl) : undefined,
        paidOn: raw.paidOn ? asString(raw.paidOn).slice(0, 10) : undefined,
        submissionStatus: raw.submissionStatus as PaymentSubmissionStatus | undefined,
        submittedBy: raw.submittedBy ? String(raw.submittedBy) : undefined,
        verifiedBy: raw.verifiedBy ? String(raw.verifiedBy) : undefined,
        verifiedAt: raw.verifiedAt ? asString(raw.verifiedAt) : undefined,
        rejectionReason: raw.rejectionReason ? String(raw.rejectionReason) : undefined,
        remarks: raw.remarks ? String(raw.remarks) : undefined,
        performedBy: raw.performedBy ? String(raw.performedBy) : undefined,
        createdAt: asString(raw.createdAt),
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ─── Mutations ──────────────────────────────────────────

export async function createFeePayment(input: CreateFeePaymentInput): Promise<FeePayment | null> {
  const amount = numeric(input.amount)
  if (!input.studentId || !input.studentName || amount <= 0 || !input.dueDate) {
    throw new Error('Student, amount and due date are required.')
  }

  const dueDate = input.dueDate.slice(0, 10)
  const docRef = await addDoc(collegeRef('feePayments'), {
    studentId: input.studentId,
    studentName: input.studentName,
    regNo: input.regNo,
    course: input.course,
    batch: input.batch,
    category: input.category,
    ...(input.remarks ? { remarks: input.remarks } : {}),
    amount,
    dueDate,
    structureId: input.structureId || '',
    paidAmount: 0,
    status: dueDate < today() ? 'overdue' : 'pending',
    collegeId: getCollegeId(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return {
    id: docRef.id,
    ...input,
    amount,
    dueDate,
    structureId: input.structureId || '',
    paidAmount: 0,
    status: dueDate < today() ? 'overdue' : 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export async function collectPayment(
  paymentId: string,
  amount: number,
  mode: PaymentMode,
  remarks?: string,
  options?: CollectPaymentOptions,
): Promise<CollectPaymentResult> {
  const paymentRef = collegeDocRef(`feePayments/${paymentId}`)
  const requestedAmount = numeric(amount)
  if (requestedAmount <= 0) throw new Error('Payment amount must be greater than zero.')

  const transactionId = normalizeReference(options?.transactionId) || suggestTransactionId()
  const receiptNo = nextReceiptNo()
  const actor = auth.currentUser?.displayName || auth.currentUser?.email || 'College finance office'
  const paidOn = (options?.paidOn || today()).slice(0, 10)
  const bankReference = normalizeReference(options?.bankReference) || undefined
  const screenshotUrl = options?.screenshotUrl || undefined

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(paymentRef)
    if (!snapshot.exists()) throw new Error('This fee record no longer exists.')
    const payment = snapshot.data() as Record<string, unknown>
    const netOwed = Math.max(0, numeric(payment.amount) - numeric(payment.discountTotal))
    const remaining = Math.max(0, netOwed - numeric(payment.paidAmount))
    if (payment.status === 'waived') throw new Error('A waived fee cannot receive a payment.')
    if (requestedAmount > remaining) throw new Error(`Payment exceeds the remaining balance of ₹${remaining.toLocaleString('en-IN')}.`)

    const { paidAmount: newPaidAmount, status: newStatus } = creditLedger(
      { amount: netOwed, paidAmount: payment.paidAmount, dueDate: payment.dueDate },
      requestedAmount,
      today(),
    )
    const transactionRef = doc(collection(paymentRef, 'transactions'))

    transaction.update(paymentRef, {
      paidAmount: newPaidAmount,
      status: newStatus,
      paidDate: paidOn,
      paymentMode: mode,
      transactionId,
      receiptNo,
      collectedBy: actor,
      ...(bankReference ? { bankReference } : {}),
      ...(screenshotUrl ? { screenshotUrl } : {}),
      ...(remarks ? { remarks } : {}),
      updatedAt: serverTimestamp(),
    })
    transaction.set(transactionRef, {
      type: 'payment',
      amount: requestedAmount,
      paymentMode: mode,
      transactionId,
      receiptNo,
      bankReference: bankReference || '',
      ...(screenshotUrl ? { screenshotUrl } : {}),
      paidOn,
      submissionStatus: 'recorded',
      remarks: remarks || '',
      performedBy: actor,
      createdAt: serverTimestamp(),
    })
  })

  return { receiptNo, transactionId, paidOn, amount: requestedAmount, paymentMode: mode, bankReference }
}

/**
 * A student files their own payment proof (transaction id + screenshot). This
 * records a `pending_verification` transaction but does NOT credit the ledger —
 * the balance only moves when an admin approves it via verifyPaymentProof.
 */
export async function submitPaymentProof(paymentId: string, input: SubmitProofInput): Promise<boolean> {
  const paymentRef = collegeDocRef(`feePayments/${paymentId}`)
  const requestedAmount = numeric(input.amount)
  if (requestedAmount <= 0) throw new Error('Payment amount must be greater than zero.')

  const snapshot = await getDoc(paymentRef)
  if (!snapshot.exists()) throw new Error('This fee record no longer exists.')
  const payment = snapshot.data() as Record<string, unknown>
  if (payment.status === 'waived') throw new Error('A waived fee cannot receive a payment.')
  const remaining = Math.max(0, numeric(payment.amount) - numeric(payment.paidAmount))
  if (requestedAmount > remaining) {
    throw new Error(`Amount exceeds the remaining balance of ₹${remaining.toLocaleString('en-IN')}.`)
  }

  const actor = auth.currentUser?.displayName || auth.currentUser?.email || 'Student'
  const paidOn = (input.paidOn || today()).slice(0, 10)
  const bankReference = normalizeReference(input.bankReference) || undefined
  const screenshotUrl = input.screenshotUrl || undefined
  const transactionRef = doc(collection(paymentRef, 'transactions'))

  await setDoc(transactionRef, {
    type: 'payment',
    amount: requestedAmount,
    paymentMode: input.paymentMode,
    transactionId: normalizeReference(input.transactionId) || suggestTransactionId(),
    bankReference: bankReference || '',
    ...(screenshotUrl ? { screenshotUrl } : {}),
    paidOn,
    submissionStatus: 'pending_verification',
    submittedBy: actor,
    remarks: input.remarks || '',
    performedBy: actor,
    createdAt: serverTimestamp(),
  })
  return true
}

/**
 * Finance-office review of a student-submitted proof. `approve` credits the
 * ledger (same math as collectPayment) and stamps a receipt; `reject` leaves the
 * balance untouched. Guarded against double-reviewing the same submission.
 */
export async function verifyPaymentProof(
  paymentId: string,
  transactionId: string,
  decision: 'approve' | 'reject',
  reason?: string,
): Promise<boolean> {
  const collegeId = getCollegeId()
  const paymentRef = collegeDocRef(`feePayments/${paymentId}`, collegeId)
  const transactionRef = doc(db, 'colleges', collegeId, 'feePayments', paymentId, 'transactions', transactionId)
  const actor = auth.currentUser?.displayName || auth.currentUser?.email || 'College finance office'

  await runTransaction(db, async transaction => {
    const paymentSnap = await transaction.get(paymentRef)
    if (!paymentSnap.exists()) throw new Error('This fee record no longer exists.')
    const txnSnap = await transaction.get(transactionRef)
    if (!txnSnap.exists()) throw new Error('This payment submission no longer exists.')
    const txn = txnSnap.data() as Record<string, unknown>
    if (txn.submissionStatus && txn.submissionStatus !== 'pending_verification') {
      throw new Error('This submission has already been reviewed.')
    }

    if (decision === 'reject') {
      transaction.update(transactionRef, {
        submissionStatus: 'rejected',
        verifiedBy: actor,
        verifiedAt: serverTimestamp(),
        rejectionReason: (reason || '').trim() || 'Rejected by the finance office',
      })
      return
    }

    const payment = paymentSnap.data() as Record<string, unknown>
    if (payment.status === 'waived') throw new Error('A waived fee cannot receive a payment.')
    const amount = numeric(txn.amount)
    const netOwed = Math.max(0, numeric(payment.amount) - numeric(payment.discountTotal))
    const remaining = Math.max(0, netOwed - numeric(payment.paidAmount))
    if (amount > remaining) {
      throw new Error(`Amount exceeds the remaining balance of ₹${remaining.toLocaleString('en-IN')}.`)
    }
    const { paidAmount, status } = creditLedger(
      { amount: netOwed, paidAmount: payment.paidAmount, dueDate: payment.dueDate },
      amount,
      today(),
    )
    const receiptNo = nextReceiptNo()

    transaction.update(paymentRef, {
      paidAmount,
      status,
      paidDate: String(txn.paidOn || today()).slice(0, 10),
      paymentMode: txn.paymentMode as PaymentMode | undefined,
      transactionId: txn.transactionId ? String(txn.transactionId) : '',
      ...(txn.bankReference ? { bankReference: String(txn.bankReference) } : {}),
      ...(txn.screenshotUrl ? { screenshotUrl: String(txn.screenshotUrl) } : {}),
      receiptNo,
      collectedBy: actor,
      updatedAt: serverTimestamp(),
    })
    transaction.update(transactionRef, {
      submissionStatus: 'verified',
      verifiedBy: actor,
      verifiedAt: serverTimestamp(),
      receiptNo,
    })
  })
  return true
}

export async function waiveFee(paymentId: string, remarks: string): Promise<boolean> {
  const paymentRef = collegeDocRef(`feePayments/${paymentId}`)
  const actor = auth.currentUser?.displayName || auth.currentUser?.email || 'College finance office'

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(paymentRef)
    if (!snapshot.exists()) throw new Error('This fee record no longer exists.')
    const payment = snapshot.data() as Record<string, unknown>
    if (payment.status === 'paid') throw new Error('A fully paid fee cannot be waived.')
    const remaining = Math.max(0, numeric(payment.amount) - numeric(payment.paidAmount))
    const transactionRef = doc(collection(paymentRef, 'transactions'))
    transaction.update(paymentRef, {
      status: 'waived',
      remarks: remarks.trim() || 'Fee waived by administration',
      waivedAmount: remaining,
      waivedAt: serverTimestamp(),
      waivedBy: actor,
      updatedAt: serverTimestamp(),
    })
    transaction.set(transactionRef, {
      type: 'waiver',
      amount: remaining,
      remarks: remarks.trim() || 'Fee waived by administration',
      performedBy: actor,
      createdAt: serverTimestamp(),
    })
  })
  return true
}

export interface ApplyDiscountInput {
  amount: number
  /** Human label of the rule, e.g. "SC concession" or "Merit 90%+". */
  label?: string
  remarks?: string
}

/**
 * Apply a discount to a fee (category / merit / management / custom). Records an
 * auditable `discount` transaction and increases `discountTotal` (capped at the
 * gross amount). Never touches paidAmount.
 */
export async function applyDiscount(paymentId: string, input: ApplyDiscountInput): Promise<boolean> {
  const paymentRef = collegeDocRef(`feePayments/${paymentId}`)
  const amount = numeric(input.amount)
  if (amount <= 0) throw new Error('Discount amount must be greater than zero.')
  const actor = auth.currentUser?.displayName || auth.currentUser?.email || 'College finance office'

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(paymentRef)
    if (!snapshot.exists()) throw new Error('This fee record no longer exists.')
    const payment = snapshot.data() as Record<string, unknown>
    const gross = numeric(payment.amount)
    const existing = numeric(payment.discountTotal)
    const newDiscount = Math.min(existing + amount, gross)
    const applied = Math.round((newDiscount - existing) * 100) / 100
    if (applied <= 0) throw new Error('This fee is already fully discounted.')
    const transactionRef = doc(collection(paymentRef, 'transactions'))
    transaction.update(paymentRef, {
      discountTotal: newDiscount,
      netAmount: Math.max(0, gross - newDiscount) + numeric(payment.lateFine),
      updatedAt: serverTimestamp(),
    })
    transaction.set(transactionRef, {
      type: 'discount',
      amount: applied,
      remarks: input.label
        ? `${input.label}${input.remarks ? ` — ${input.remarks}` : ''}`
        : (input.remarks || 'Discount applied'),
      performedBy: actor,
      createdAt: serverTimestamp(),
    })
  })
  return true
}

export async function createFeeStructure(data: Omit<FeeStructure, 'id'>): Promise<FeeStructure | null> {
  const docRef = await addDoc(collegeRef('feeStructures'), {
    category: data.category,
    name: data.name,
    amount: data.amount,
    course: data.course,
    batch: data.batch,
    dueDate: data.dueDate,
    academicYear: data.academicYear,
    semester: data.semester,
    ...(data.description ? { description: data.description } : {}),
    ...(data.lateFeePerDay != null ? { lateFeePerDay: data.lateFeePerDay } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { id: docRef.id, ...data } as FeeStructure
}

// ─── Computed helpers ───────────────────────────────────

export function calculateSummary(payments: FeePayment[]): FeeSummary {
  const outstanding = (p: FeePayment) => Math.max(0, p.amount - p.paidAmount)
  return {
    totalDue: payments.reduce((sum, p) => sum + p.amount, 0),
    totalPaid: payments.reduce((sum, p) => sum + p.paidAmount, 0),
    totalPending: payments.filter(p => p.status === 'pending' || p.status === 'partial').reduce((sum, p) => sum + outstanding(p), 0),
    totalOverdue: payments.filter(p => p.status === 'overdue').reduce((sum, p) => sum + outstanding(p), 0),
    totalWaived: payments.filter(p => p.status === 'waived').reduce((sum, p) => sum + outstanding(p), 0),
    countPaid: payments.filter(p => p.status === 'paid').length,
    countPending: payments.filter(p => p.status === 'pending').length,
    countOverdue: payments.filter(p => p.status === 'overdue').length,
    countPartial: payments.filter(p => p.status === 'partial').length,
  }
}

export function getCourseWiseSummary(payments: FeePayment[]) {
  return Array.from(new Set(payments.map(p => p.course))).map(course => {
    const rows = payments.filter(p => p.course === course)
    return {
      course,
      totalDue: rows.reduce((sum, p) => sum + p.amount, 0),
      totalPaid: rows.reduce((sum, p) => sum + p.paidAmount, 0),
      totalPending: rows.filter(p => p.status !== 'paid' && p.status !== 'waived').reduce((sum, p) => sum + Math.max(0, p.amount - p.paidAmount), 0),
      studentCount: new Set(rows.map(p => p.studentId)).size,
    }
  })
}

export function getCategoryWiseSummary(payments: FeePayment[]) {
  const categories: FeeCategory[] = ['tuition', 'exam', 'university_exam', 'eligibility', 'library', 'lab', 'hostel', 'transport', 'misc']
  return categories.map(category => {
    const rows = payments.filter(p => p.category === category)
    return {
      category,
      totalDue: rows.reduce((sum, p) => sum + p.amount, 0),
      totalPaid: rows.reduce((sum, p) => sum + p.paidAmount, 0),
      count: rows.length,
    }
  }).filter(c => c.count > 0)
}

// ─── Challan Types (Karnataka University - BCU/BNU) ───────────────────────
export type ChallanStatus = 'generated' | 'paid_at_bank' | 'verified' | 'rejected' | 'expired'
export type ChallanType = 'university_exam' | 'eligibility' | 'revaluation' | 'marks_card' | 'other'

export interface ChallanBreakdown {
  label: string
  amount: number
}

export interface Challan {
  id: string
  challanNo: string // CH-202425-BCA-000001
  type: ChallanType
  category: FeeCategory
  studentId: string
  studentName: string
  regNo: string
  usn?: string
  course: string
  batch: string
  semester: string
  examSessionId?: string
  examTitle?: string
  examType?: 'regular' | 'supplementary' | 'revaluation' | 'improvement'
  subjects?: Array<{ code: string; name: string }>
  amount: number
  breakdown: ChallanBreakdown[]
  bankDetails: {
    bankName: string
    accountNo: string
    ifsc: string
    branch: string
    accountName: string
  }
  collegeCode: string
  collegeName: string
  university: 'BCU' | 'BNU' | 'Davangere' | 'Rani Channamma' | 'Other'
  status: ChallanStatus
  generatedAt: string
  dueDate: string
  paidAt?: string
  verifiedAt?: string
  verifiedBy?: string
  bankReferenceNo?: string
  bankStampUrl?: string
  remarks?: string
  /** The student's own note when they declare the payment at the counter. */
  studentRemarks?: string
  feePaymentId?: string
  createdAt: string
  updatedAt: string
}

export interface CreateChallanInput {
  type: ChallanType
  studentId: string
  studentName: string
  regNo: string
  usn?: string
  course: string
  batch: string
  semester: string
  examSessionId?: string
  examTitle?: string
  examType?: 'regular' | 'supplementary' | 'revaluation' | 'improvement'
  subjects?: Array<{ code: string; name: string }>
  amount: number
  breakdown?: ChallanBreakdown[]
  dueDate: string
  university?: 'BCU' | 'BNU' | 'Davangere' | 'Rani Channamma' | 'Other'
  collegeCode?: string
  collegeName?: string
  bankDetails?: Challan['bankDetails']
  remarks?: string
}

/** Exported so the student portal can map the same rows without re-declaring the shape. */
export function mapChallan(id: string, raw: Record<string, unknown>): Challan {
  return {
    id,
    challanNo: String(raw.challanNo || ''),
    type: (raw.type || 'university_exam') as ChallanType,
    category: (raw.category || 'university_exam') as FeeCategory,
    studentId: String(raw.studentId || ''),
    studentName: String(raw.studentName || ''),
    regNo: String(raw.regNo || ''),
    usn: raw.usn ? String(raw.usn) : undefined,
    course: String(raw.course || ''),
    batch: String(raw.batch || ''),
    semester: String(raw.semester || ''),
    examSessionId: raw.examSessionId ? String(raw.examSessionId) : undefined,
    examTitle: raw.examTitle ? String(raw.examTitle) : undefined,
    examType: raw.examType as Challan['examType'],
    subjects: Array.isArray(raw.subjects) ? raw.subjects as Challan['subjects'] : undefined,
    amount: numeric(raw.amount),
    breakdown: Array.isArray(raw.breakdown) ? raw.breakdown as ChallanBreakdown[] : [],
    bankDetails: (raw.bankDetails as Challan['bankDetails']) || {
      bankName: 'State Bank of India',
      accountNo: '000000000000',
      ifsc: 'SBIN0000000',
      branch: 'BCU Branch',
      accountName: 'Bangalore City University',
    },
    collegeCode: String(raw.collegeCode || ''),
    collegeName: String(raw.collegeName || ''),
    university: (raw.university || 'BCU') as Challan['university'],
    status: (raw.status || 'generated') as ChallanStatus,
    generatedAt: asString(raw.generatedAt),
    dueDate: asString(raw.dueDate).slice(0, 10),
    paidAt: raw.paidAt ? asString(raw.paidAt) : undefined,
    verifiedAt: raw.verifiedAt ? asString(raw.verifiedAt) : undefined,
    verifiedBy: raw.verifiedBy ? String(raw.verifiedBy) : undefined,
    bankReferenceNo: raw.bankReferenceNo ? String(raw.bankReferenceNo) : undefined,
    bankStampUrl: raw.bankStampUrl ? String(raw.bankStampUrl) : undefined,
    remarks: raw.remarks ? String(raw.remarks) : undefined,
    studentRemarks: raw.studentRemarks ? String(raw.studentRemarks) : undefined,
    feePaymentId: raw.feePaymentId ? String(raw.feePaymentId) : undefined,
    createdAt: asString(raw.createdAt),
    updatedAt: asString(raw.updatedAt),
  }
}

// ─── Challan Reads ─────────────────────────────────────
export async function fetchChallans(filters?: {
  studentId?: string
  status?: ChallanStatus
  type?: ChallanType
  /** Tenant override for callers outside the admin module (student portal). */
  collegeId?: string | null
  /** A digest only needs the newest few rows; do not read 500 for a banner. */
  limit?: number
}): Promise<Challan[]> {
  const constraints: any[] = [limit(Math.min(filters?.limit ?? MAX_READS, MAX_READS))]
  if (filters?.studentId) constraints.push(where('studentId', '==', filters.studentId))
  if (filters?.status) constraints.push(where('status', '==', filters.status))
  if (filters?.type) constraints.push(where('type', '==', filters.type))
  const snap = await getDocs(query(collegeRef('challans', filters?.collegeId), ...constraints))
  return snap.docs.map(d => mapChallan(d.id, d.data() as Record<string, unknown>)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

export async function fetchChallanById(id: string, collegeId?: string | null): Promise<Challan | null> {
  const snap = await getDoc(collegeDocRef(`challans/${id}`, collegeId))
  if (!snap.exists()) return null
  return mapChallan(snap.id, snap.data() as Record<string, unknown>)
}

// ─── Challan Mutations ─────────────────────────────────
export async function createChallan(input: CreateChallanInput): Promise<Challan> {
  const collegeId = getCollegeId()
  const challanNo = `CH-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${input.course.toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`
  const breakdown = input.breakdown || [{ label: `${input.type.replace('_', ' ')} Fee`, amount: input.amount }]
  
  const docRef = await addDoc(collegeRef('challans'), {
    collegeId,
    challanNo,
    type: input.type,
    category: input.type === 'eligibility' ? 'eligibility' : 'university_exam',
    studentId: input.studentId,
    studentName: input.studentName,
    regNo: input.regNo,
    usn: input.usn || input.regNo,
    course: input.course,
    batch: input.batch,
    semester: input.semester,
    examSessionId: input.examSessionId || '',
    examTitle: input.examTitle || '',
    examType: input.examType || 'regular',
    subjects: input.subjects || [],
    amount: input.amount,
    breakdown,
    bankDetails: input.bankDetails || {
      bankName: 'State Bank of India',
      accountNo: '123456789012',
      ifsc: 'SBIN0040093',
      branch: 'BCU Campus Branch, Bengaluru',
      accountName: input.university ? `${input.university} - Examination Fees` : 'Bangalore City University - Examination Fees',
    },
    collegeCode: input.collegeCode || collegeId.slice(0, 8).toUpperCase(),
    collegeName: input.collegeName || 'College',
    university: input.university || 'BCU',
    status: 'generated',
    generatedAt: serverTimestamp(),
    dueDate: input.dueDate,
    remarks: input.remarks || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  // Also create a feePayment entry for tracking
  const feePaymentRef = await addDoc(collegeRef('feePayments'), {
    studentId: input.studentId,
    studentName: input.studentName,
    regNo: input.regNo,
    course: input.course,
    batch: input.batch,
    category: input.type === 'eligibility' ? 'eligibility' : 'university_exam',
    amount: input.amount,
    paidAmount: 0,
    status: 'pending',
    dueDate: input.dueDate,
    challanId: docRef.id,
    challanNo,
    examSessionId: input.examSessionId || '',
    remarks: `Challan ${challanNo} for ${input.examTitle || input.type}`,
    collegeId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  await updateDoc(docRef, { feePaymentId: feePaymentRef.id })

  return {
    id: docRef.id,
    challanNo,
    type: input.type,
    category: input.type === 'eligibility' ? 'eligibility' : 'university_exam',
    studentId: input.studentId,
    studentName: input.studentName,
    regNo: input.regNo,
    usn: input.usn,
    course: input.course,
    batch: input.batch,
    semester: input.semester,
    examSessionId: input.examSessionId,
    examTitle: input.examTitle,
    examType: input.examType,
    subjects: input.subjects,
    amount: input.amount,
    breakdown,
    bankDetails: input.bankDetails || {
      bankName: 'State Bank of India',
      accountNo: '123456789012',
      ifsc: 'SBIN0040093',
      branch: 'BCU Campus Branch, Bengaluru',
      accountName: `${input.university || 'BCU'} - Examination Fees`,
    },
    collegeCode: input.collegeCode || collegeId.slice(0, 8).toUpperCase(),
    collegeName: input.collegeName || 'College',
    university: input.university || 'BCU',
    status: 'generated',
    generatedAt: new Date().toISOString(),
    dueDate: input.dueDate,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    feePaymentId: feePaymentRef.id,
  }
}

export async function createBulkChallans(inputs: CreateChallanInput[]): Promise<{ created: number; failed: number; errors: string[] }> {
  let created = 0
  let failed = 0
  const errors: string[] = []
  for (const input of inputs) {
    try {
      await createChallan(input)
      created++
    } catch (e) {
      failed++
      errors.push(`${input.regNo}: ${e instanceof Error ? e.message : 'Failed'}`)
    }
  }
  return { created, failed, errors }
}

export async function verifyChallan(challanId: string, bankReferenceNo: string, remarks?: string): Promise<boolean> {
  const ref = collegeDocRef(`challans/${challanId}`)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Challan not found')
  const data = snap.data() as Record<string, unknown>
  if (data.status === 'verified') throw new Error('Challan already verified')
  
  await updateDoc(ref, {
    status: 'verified',
    bankReferenceNo,
    verifiedAt: serverTimestamp(),
    verifiedBy: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
    remarks: remarks || data.remarks || '',
    updatedAt: serverTimestamp(),
  })

  // Update linked feePayment to paid
  const feePaymentId = data.feePaymentId as string
  if (feePaymentId) {
    const feeRef = collegeDocRef(`feePayments/${feePaymentId}`)
    const feeSnap = await getDoc(feeRef)
    if (feeSnap.exists()) {
      const receiptNo = `RCP-CH-${Date.now()}`
      const transactionId = `TXN-CH-${bankReferenceNo}`
      await updateDoc(feeRef, {
        paidAmount: data.amount,
        status: 'paid',
        paidDate: today(),
        paymentMode: 'dd',
        transactionId,
        receiptNo,
        bankReferenceNo,
        verifiedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      const txnRef = doc(collection(feeRef, 'transactions'))
      await updateDoc(feeRef, {}) // dummy to keep transaction
      const { addDoc: addTxnDoc, collection: coll, serverTimestamp: st } = await import('firebase/firestore')
      await addTxnDoc(coll(feeRef, 'transactions'), {
        type: 'payment',
        amount: data.amount,
        paymentMode: 'dd',
        transactionId,
        receiptNo,
        bankReferenceNo,
        remarks: `Challan ${data.challanNo} verified - Bank Ref ${bankReferenceNo}`,
        performedBy: auth.currentUser?.displayName || auth.currentUser?.email || 'Admin',
        createdAt: st(),
      })
    }
  }

  return true
}

export async function markChallanPaidAtBank(challanId: string, bankStampUrl?: string): Promise<boolean> {
  const ref = collegeDocRef(`challans/${challanId}`)
  await updateDoc(ref, {
    status: 'paid_at_bank',
    paidAt: serverTimestamp(),
    bankStampUrl: bankStampUrl || '',
    updatedAt: serverTimestamp(),
  })
  return true
}

export async function rejectChallan(challanId: string, reason: string): Promise<boolean> {
  const ref = collegeDocRef(`challans/${challanId}`)
  await updateDoc(ref, {
    status: 'rejected',
    remarks: reason,
    updatedAt: serverTimestamp(),
  })
  return true
}

// ─── Student challan declaration (pay at bank → file the reference → verify) ─
//
// A student who has paid at the counter files the bank reference number from
// their phone so the finance desk has something to reconcile against. There is
// deliberately NO file upload here: the stamped copy is a paper record the
// college collects at the office, and the challan row only needs the reference,
// the date and the student's note. `bankStampUrl` stays the field the office
// itself fills in (markChallanPaidAtBank / verifyChallan).
//
// The write is deliberately narrow, and `firestore.rules` restricts a
// student's update to exactly these keys plus the paid timestamp: the addressee
// and the amount are immutable, and `verified` remains a staff-only status.
// Keep the validator and the rule in step — a new field here means updating the
// rule's `hasOnly` list in the same change.

export interface ChallanDeclarationInput {
  bankReferenceNo: string
  remarks?: string
}

/**
 * Bank slips are photographed and typed under a counter's fluorescent lights:
 * spaces and stray line breaks from a copy/paste are normal, so the reference
 * is compacted before it is compared or stored.
 */
export function normaliseBankReference(value: string): string {
  return (value || '').trim().replace(/\s+/g, '').toUpperCase()
}

/** Returns an error message, or null when the declaration can be filed. */
export function validateChallanDeclaration(input: {
  bankReferenceNo: string
  remarks?: string
}): string | null {
  const reference = normaliseBankReference(input.bankReferenceNo)
  if (!reference) return 'Enter the bank reference / UTR number printed on your stamped receipt.'
  if (!/^[A-Z0-9/-]{6,40}$/.test(reference)) {
    return 'The bank reference is the 6-40 character number on your receipt (letters, digits, / and - only).'
  }
  if ((input.remarks || '').length > 500) return 'Keep the note under 500 characters.'
  return null
}

/**
 * Files the student's declaration. Only the fields the rule admits are written,
 * so a student can never edit the amount they owe, who the challan was issued
 * to, or the verification outcome.
 */
export async function declareChallanPaidAtBank(
  challanId: string,
  input: ChallanDeclarationInput,
  collegeId?: string | null
): Promise<void> {
  const invalid = validateChallanDeclaration(input)
  if (invalid) throw new Error(invalid)
  const remarks = (input.remarks || '').trim().slice(0, 500)
  await updateDoc(collegeDocRef(`challans/${challanId}`, collegeId), {
    status: 'paid_at_bank',
    bankReferenceNo: normaliseBankReference(input.bankReferenceNo),
    // An empty note is left out rather than stored as '': the office reads this
    // field as "the student added something", and '' would look like they did.
    ...(remarks ? { studentRemarks: remarks } : {}),
    paidAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export function getMonthlyCollection(payments: FeePayment[]) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthMap: Record<string, number> = {}
  payments.forEach(p => {
    if (p.paidDate) {
      const month = new Date(`${p.paidDate}T12:00:00`).toLocaleString('en-US', { month: 'short' })
      monthMap[month] = (monthMap[month] || 0) + p.paidAmount
    }
  })
  return months.map(month => ({ month, collected: monthMap[month] || 0, target: 0 }))
}

export function getOverduePayments(payments: FeePayment[]): FeePayment[] {
  return payments.filter(p => p.status === 'overdue')
}

export function getOutstandingAmount(payment: FeePayment): number {
  return Math.max(0, payment.amount - payment.paidAmount)
}
