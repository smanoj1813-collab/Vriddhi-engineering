import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin (automatically authenticated in Cloud Functions)
if (!getApps().length) {
  initializeApp();
}

export const db = getFirestore('default');
export const auth = getAuth();
