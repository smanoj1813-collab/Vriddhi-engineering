// src/Firebase/config.ts
// PATCH: Add `functions` export for callable Cloud Functions

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions"; // ← ADD THIS

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, 'default');
export const auth = getAuth(app);
export const storage = getStorage(app);
// All callable functions in this repository are deployed in asia-south1.
// Using the SDK default (us-central1) makes valid callables look unavailable.
export const functions = getFunctions(app, 'asia-south1'); // ← ADD THIS

export default app;

// ── Build-time configuration check ─────────────────────────────────────
// Vite inlines these at build time. If they are absent from the build
// environment the app would boot and then fail cryptically on the first
// Auth/Firestore call. Exposing the status lets main.tsx show a clear
// "Firebase not configured" screen instead. Correctly configured builds
// report `configured: true` and the app renders normally.
const REQUIRED_FIREBASE_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

export interface FirebaseConfigStatus {
  configured: boolean;
  missing: string[];
}

export const firebaseConfigStatus: FirebaseConfigStatus = (() => {
  const missing = REQUIRED_FIREBASE_ENV.filter(
    (k) => !import.meta.env[k as keyof ImportMetaEnv],
  );
  return { configured: missing.length === 0, missing };
})();
