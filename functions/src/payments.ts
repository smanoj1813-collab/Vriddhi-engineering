import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// functions/src/payments.ts
//
// Online fee payments via a payment gateway (Razorpay by default).
//
// "Flow now, keys later": the whole flow is wired, but if RAZORPAY_KEY_ID /
// RAZORPAY_KEY_SECRET are not set, createFeePaymentOrder returns
// { configured: false } and the client falls back to offline recording / proof
// submission. Uses Razorpay's REST API + HMAC verification through Node's
// built-in fetch/crypto, so there is no extra dependency to install.

import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import * as admin from 'firebase-admin'
import crypto from 'crypto'

const db = getFirestore(admin.app(), 'default')
// Finance staff may act on any fee row of their college; everyone else only on
// their own. HODs/admins no longer hold finance access (accounts team does).
const STAFF_ROLES = ['superadmin', 'principal', 'accounts']

function gatewayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) return null
  return { keyId, keySecret }
}

async function createGatewayOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
  const cfg = gatewayConfig()
  if (!cfg) return null
  const auth = 'Basic ' + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }),
  })
  if (!res.ok) {
    logger.error('Razorpay order creation failed', { status: res.status })
    throw new HttpsError('internal', 'Payment gateway rejected the order.')
  }
  const data = (await res.json()) as { id: string; amount: number; currency: string }
  return data
}

function validSignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function callerCollege(request: { auth?: { token?: Record<string, unknown> } }): string {
  const collegeId = request.auth?.token?.collegeId
  if (typeof collegeId !== 'string' || !collegeId) {
    throw new HttpsError('failed-precondition', 'This sign-in carries no college.')
  }
  return collegeId
}

async function loadOwnedPayment(
  request: { auth?: { uid: string; token?: Record<string, unknown> } },
  collegeId: string,
  paymentId: string,
): Promise<admin.firestore.DocumentData> {
  const uid = request.auth!.uid
  const role = String(request.auth?.token?.role ?? '').toLowerCase()
  const snap = await db.doc(`colleges/${collegeId}/feePayments/${paymentId}`).get()
  if (!snap.exists) throw new HttpsError('not-found', 'This fee record no longer exists.')
  const payment = snap.data()!
  if (STAFF_ROLES.includes(role)) return payment
  const userSnap = await db.doc(`users/${uid}`).get()
  const studentDocId = userSnap.exists ? String(userSnap.data()?.studentDocId ?? '') : ''
  const owns = payment.studentId === uid || (!!studentDocId && payment.studentId === studentDocId)
  if (!owns) throw new HttpsError('permission-denied', 'You can only pay your own fees.')
  return payment
}

/** Net amount still owed, mirroring the client's discount-aware balance. */
function netOwed(payment: admin.firestore.DocumentData): number {
  const total = Number(payment.amount ?? 0) || 0
  const discount = Number(payment.discountTotal ?? 0) || 0
  return Math.max(0, total - Math.max(0, discount))
}

/**
 * Credit a fee payment server-side (only ever called after a verified gateway
 * signature). Idempotent-ish: re-crediting the same order is guarded by the
 * caller marking the order paid first.
 */
async function creditFeePayment(
  collegeId: string,
  paymentId: string,
  amount: number,
  transactionId: string,
  meta: { paidOn?: string; by?: string; bankReference?: string } = {},
) {
  const ref = db.doc(`colleges/${collegeId}/feePayments/${paymentId}`)
  const todayStr = new Date().toISOString().slice(0, 10)
  await db.runTransaction(async t => {
    const snap = await t.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', 'This fee record no longer exists.')
    const payment = snap.data()!
    if (payment.status === 'waived') throw new HttpsError('failed-precondition', 'A waived fee cannot receive a payment.')
    const owed = netOwed(payment)
    const paid = Number(payment.paidAmount ?? 0) || 0
    const remaining = Math.max(0, owed - paid)
    if (amount > remaining) {
      throw new HttpsError('invalid-argument', `Amount exceeds the remaining balance of ₹${remaining}.`)
    }
    const newPaid = Math.min(paid + amount, owed)
    const dueDate = String(payment.dueDate ?? '').slice(0, 10)
    const status = owed > 0 && newPaid >= owed ? 'paid' : dueDate && dueDate < todayStr ? 'overdue' : 'partial'
    const receiptNo = `RCP-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`
    const by = meta.by || 'Online payment'
    t.update(ref, {
      paidAmount: newPaid,
      status,
      paidDate: meta.paidOn || todayStr,
      paymentMode: 'upi',
      transactionId,
      receiptNo,
      collectedBy: by,
      ...(meta.bankReference ? { bankReference: meta.bankReference } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    t.set(ref.collection('transactions').doc(), {
      type: 'payment',
      amount,
      paymentMode: 'upi',
      transactionId,
      receiptNo,
      paidOn: meta.paidOn || todayStr,
      submissionStatus: 'recorded',
      performedBy: by,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  })
}

/** Create a gateway order for a fee payment. Returns { configured:false } when unconfigured. */
export const createFeePaymentOrder = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const collegeId = callerCollege(request)
  const paymentId = String(request.data?.paymentId ?? '')
  if (!paymentId) throw new HttpsError('invalid-argument', 'paymentId is required')

  const payment = await loadOwnedPayment(request, collegeId, paymentId)
  const amount = Math.round((netOwed(payment) - (Number(payment.paidAmount ?? 0) || 0)) * 100) / 100
  if (amount <= 0) throw new HttpsError('failed-precondition', 'This fee is already fully paid.')

  const cfg = gatewayConfig()
  if (!cfg) {
    logger.info('createFeePaymentOrder: gateway not configured, returning offline fallback')
    return { configured: false }
  }

  const order = await createGatewayOrder(Math.round(amount * 100), `fee-${paymentId}`, {
    collegeId,
    paymentId,
    studentId: String(payment.studentId ?? ''),
  })
  if (!order) return { configured: false }

  await db.doc(`colleges/${collegeId}/paymentOrders/${order.id}`).set({
    collegeId,
    paymentId,
    provider: 'razorpay',
    razorpayOrderId: order.id,
    amount,
    currency: order.currency,
    status: 'created',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { configured: true, orderId: order.id, amount, currency: order.currency, keyId: cfg.keyId }
})

/** Verify a gateway payment signature and credit the fee. */
export const verifyFeePayment = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const collegeId = callerCollege(request)
  const { orderId, paymentId, gatewayPaymentId, signature } = request.data ?? {}
  if (!orderId || !paymentId || !gatewayPaymentId || !signature) {
    throw new HttpsError('invalid-argument', 'orderId, paymentId, gatewayPaymentId and signature are required.')
  }

  const cfg = gatewayConfig()
  if (!cfg) throw new HttpsError('failed-precondition', 'Payment gateway is not configured.')

  const orderRef = db.doc(`colleges/${collegeId}/paymentOrders/${orderId}`)
  const orderSnap = await orderRef.get()
  if (!orderSnap.exists || orderSnap.data()?.paymentId !== paymentId) {
    throw new HttpsError('not-found', 'Payment order not found.')
  }
  if (orderSnap.data()?.status === 'paid') {
    return { status: 'already_paid' }
  }

  if (!validSignature(String(orderId), String(gatewayPaymentId), String(signature), cfg.keySecret)) {
    throw new HttpsError('permission-denied', 'Payment signature verification failed.')
  }

  const payment = await loadOwnedPayment(request, collegeId, String(paymentId))
  const amount = Number(orderSnap.data()?.amount ?? 0)
  await creditFeePayment(collegeId, String(paymentId), amount, String(gatewayPaymentId), {
    bankReference: String(gatewayPaymentId),
    by: request.auth.token?.name ? String(request.auth.token.name) : 'Online payment',
  })
  await orderRef.update({
    status: 'paid',
    gatewayPaymentId: String(gatewayPaymentId),
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  void payment
  return { status: 'paid' }
})

/** Razorpay webhook — a backup credit path when the client never calls verify. */
export const razorpayWebhook = onRequest(async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) {
    res.status(503).send('webhook not configured')
    return
  }
  const signature = String(req.get('x-razorpay-signature') ?? '')
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody ?? '').digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(400).send('invalid signature')
    return
  }
  try {
    const event = req.body?.event as string
    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = req.body?.payload?.payment?.entity
      const orderEntity = req.body?.payload?.order?.entity
      const orderId = orderEntity?.id ?? paymentEntity?.order_id
      const gatewayPaymentId = paymentEntity?.id
      if (orderId && gatewayPaymentId) {
        const q = await db.collectionGroup('paymentOrders').where('razorpayOrderId', '==', orderId).limit(1).get()
        const doc0 = q.docs[0]
        if (doc0 && doc0.data()?.status !== 'paid') {
          const { collegeId, paymentId, amount } = doc0.data()
          await creditFeePayment(String(collegeId), String(paymentId), Number(amount), String(gatewayPaymentId))
          await doc0.ref.update({ status: 'paid', gatewayPaymentId: String(gatewayPaymentId), updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        }
      }
    }
    res.status(200).send('ok')
  } catch (error) {
    logger.error('razorpayWebhook failed', error)
    res.status(500).send('error')
  }
})
