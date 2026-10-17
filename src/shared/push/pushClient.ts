// Browser side of web push. A student opts in once; the token is stored at
// colleges/{collegeId}/pushTokens/{token} so announcements can reach this device.
//
// Needs VITE_FIREBASE_VAPID_KEY (the Web Push certificate key pair's public key
// from Firebase console → Project settings → Cloud Messaging). Without it, the
// function reports 'not-configured' and nothing is requested from the browser.

import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getMessaging, getToken, isSupported } from 'firebase/messaging'
import app, { auth, db } from '@/Firebase/config'

const VAPID_KEY = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim() || ''

export type PushOutcome = 'enabled' | 'denied' | 'unsupported' | 'not-configured'

export function pushKeyConfigured(): boolean {
  return VAPID_KEY.length > 0
}

/** Asks for permission, gets this browser's token, and stores it for the signed-in student. */
export async function enablePush(collegeId: string, studentId: string): Promise<PushOutcome> {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Sign in again to turn on notifications.')
  if (!pushKeyConfigured()) return 'not-configured'
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported())) return 'unsupported'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const registration = await navigator.serviceWorker.ready
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration })
  if (!token) return 'unsupported'

  await setDoc(
    doc(db, 'colleges', collegeId, 'pushTokens', token),
    { uid, studentId, collegeId, token, updatedAt: serverTimestamp() },
    { merge: true },
  )
  return 'enabled'
}

/** Removes this device's token, e.g. on sign-out or when the student turns notifications off. */
export async function disablePush(collegeId: string, token: string): Promise<void> {
  await deleteDoc(doc(db, 'colleges', collegeId, 'pushTokens', token))
}
