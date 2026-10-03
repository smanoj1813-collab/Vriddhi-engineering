import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin (automatically authenticated in Cloud Functions)
if (!getApps().length) {
  initializeApp();
}

export const db = getFirestore('default');
export const auth = getAuth();

// Lazy Realtime Database handle: getDatabase() throws at module load when
// FIREBASE_CONFIG is absent (deploy code analysis / local tooling), which
// made functions undeployable. Resolve on first use instead.
let _rtdb: ReturnType<typeof getDatabase> | null = null;
export function getRtdb() {
  if (!_rtdb) _rtdb = getDatabase();
  return _rtdb;
}
