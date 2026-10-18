// Web push for announcements. Best-effort by design: a failed push is logged
// and never fails the announcement itself, because the in-app panel is the
// source of truth and push is only a nudge.
//
// Device tokens live at colleges/{collegeId}/pushTokens/{token} and are written
// by the student's own browser (see src/shared/push/pushClient.ts). Each doc has
// { uid, studentId, collegeId, token }.

import * as admin from 'firebase-admin'
import { getFirestore } from 'firebase-admin/firestore'

export interface PushPayload {
  title: string
  body: string
  url: string
}

export interface PushResult {
  sent: number
  failed: number
  removed: number
}

/** FCM accepts at most 500 tokens per multicast call. */
export const MULTICAST_LIMIT = 500

export function chunk<T>(items: T[], size: number = MULTICAST_LIMIT): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Tokens FCM reports as gone (uninstalled, revoked, expired). Those docs are deleted. */
export function isDeadTokenCode(code: string | undefined): boolean {
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token'
}

/**
 * Sends to the registered devices of the given students, or to every device
 * in the college when `studentIds` is null (a broadcast).
 */
export async function sendPushToStudents(
  collegeId: string,
  studentIds: string[] | null,
  payload: PushPayload,
): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, removed: 0 }
  try {
    const db = getFirestore(admin.app(), 'default')
    const wanted = studentIds ? new Set(studentIds) : null
    const snap = await db.collection('colleges').doc(collegeId).collection('pushTokens').limit(20000).get()
    const targets = snap.docs
      .filter(d => !wanted || wanted.has(String(d.data().studentId || '')))
      .map(d => ({ token: String(d.data().token || d.id), ref: d.ref }))

    for (const batch of chunk(targets)) {
      const res = await admin.messaging().sendEachForMulticast({
        tokens: batch.map(b => b.token),
        notification: { title: payload.title, body: payload.body },
        data: { url: payload.url },
      })
      result.sent += res.successCount
      result.failed += res.failureCount
      const dead = res.responses
        .map((r, i) => (!r.success && isDeadTokenCode(r.error?.code) ? batch[i].ref : null))
        .filter((ref): ref is FirebaseFirestore.DocumentReference => ref !== null)
      await Promise.all(dead.map(ref => ref.delete()))
      result.removed += dead.length
    }
  } catch (err) {
    console.error('[push] send failed; announcement still saved', err)
  }
  return result
}
