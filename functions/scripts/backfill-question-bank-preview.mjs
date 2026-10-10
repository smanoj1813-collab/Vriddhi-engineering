#!/usr/bin/env node
/**
 * Backfill previewText + searchKeywords on existing questionBank_meta docs
 * that were seeded before those fields existed (seed script pre-2026-04-14).
 *
 * For each questionBank_meta doc it reads the paired questionBank_content doc
 * (same id, as per seed-question-bank.mjs) and patches the meta doc with:
 *   previewText: first 160 chars of questionText (whitespace collapsed)
 *   searchKeywords: lowercased tokens from questionText + subjectId + topicId + tags
 *
 * Idempotent: re-running on already-patched docs is a no-op (unless --force).
 * Safe to run against a live production bank — it only writes the two fields
 * via {merge:true} and never touches content or review docs.
 *
 * Credentials: same as seed-question-bank.mjs
 *   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 * or GOOGLE_APPLICATION_CREDENTIALS.
 *
 * Usage:
 *   node functions/scripts/backfill-question-bank-preview.mjs         # dry run, shows what would be patched
 *   node functions/scripts/backfill-question-bank-preview.mjs --write # apply
 *   node functions/scripts/backfill-question-bank-preview.mjs --write --force  # rewrite even if fields exist
 *   node functions/scripts/backfill-question-bank-preview.mjs --limit 50          # only first 50
 */
import { createHash } from 'node:crypto';

const META = 'questionBank_meta';
const CONTENT = 'questionBank_content';

function buildPreviewText(text, maxLen = 160) {
  if (!text) return '';
  return String(text).replace(/\s+/g, ' ').trim().slice(0, maxLen);
}
function buildSearchKeywords(text, subjectId, topicId, tags) {
  const tokens = new Set();
  const add = (value) => {
    if (!value) return;
    String(value).toLowerCase().split(/\s+/).forEach((word) => {
      const cleaned = word.replace(/[^a-z0-9]/g, '');
      if (cleaned) tokens.add(cleaned.substring(0, 20));
      const raw = word.toLowerCase().substring(0, 20);
      if (raw && raw !== cleaned.substring(0, 20)) tokens.add(raw);
    });
  };
  add(text);
  add(subjectId);
  add(topicId);
  (tags || []).forEach((t) => add(t));
  return Array.from(tokens).filter(Boolean);
}

async function getAdmin() {
  try { return (await import('firebase-admin')).default; } catch {
    console.error('firebase-admin not found. Run: npm --prefix functions install');
    process.exit(1);
  }
}
function buildApp(admin) {
  const hasEnv = process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY;
  if (hasEnv) return admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n') }) });
  // Supports both GOOGLE_APPLICATION_CREDENTIALS and gcloud ADC (gcloud auth application-default login)
  // without requiring the env var to be set — Admin SDK discovers the ADC file automatically.
  try {
    return admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } catch (e) {
    console.error('No Firebase credentials found. Set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, or run: gcloud auth application-default login --project vriddhi-engineering');
    console.error('  Detail:', e.message);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const force = args.includes('--force');
  const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg, 10) : 0;

  const admin = await getAdmin();
  const app = buildApp(admin);
  const db = admin.firestore();

  console.log(write ? 'Backfill — WRITE mode (patching meta docs)' : 'Backfill — DRY RUN (pass --write to apply)');
  if (force) console.log('  --force: rewriting even when fields already exist');
  if (limit) console.log(`  --limit ${limit}`);

  // Stream meta docs in batches; Firestore limit per get() is unbounded but we page 500 at a time.
  const PAGE = 500;
  let lastDoc = null;
  let seen = 0, needPatch = 0, patched = 0, missingContent = 0;

  while (true) {
    let q = db.collection(META).orderBy('__name__').limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      if (limit && seen >= limit) break;
      seen++;
      const meta = doc.data();
      const alreadyHas = typeof meta.previewText === 'string' && Array.isArray(meta.searchKeywords) && meta.searchKeywords.length > 0;
      if (alreadyHas && !force) continue;
      needPatch++;

      // Read paired content doc
      let content;
      try {
        const cSnap = await db.collection(CONTENT).doc(doc.id).get();
        if (!cSnap.exists) { missingContent++; continue; }
        content = cSnap.data();
      } catch (e) {
        console.warn(`  ${doc.id}: failed to read content: ${e.message}`);
        missingContent++;
        continue;
      }
      const questionText = content.questionText || content.text || '';
      const previewText = buildPreviewText(questionText);
      const searchKeywords = buildSearchKeywords(questionText, meta.subjectId || content.subjectId || '', meta.topicId || content.topicId || '', meta.tags || content.tags || []);
      if (!write) {
        if (needPatch <= 5) console.log(`  would patch ${doc.id}: preview="${previewText.slice(0,60)}..." keywords=${searchKeywords.slice(0,4).join(',')}`);
        continue;
      }
      try {
        await db.collection(META).doc(doc.id).set({ previewText, searchKeywords, updatedAt: new Date().toISOString() }, { merge: true });
        patched++;
        if (patched % 100 === 0) console.log(`  patched ${patched}/${needPatch}...`);
      } catch (e) {
        console.warn(`  ${doc.id}: write failed: ${e.message}`);
      }
    }
    if (limit && seen >= limit) break;
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  console.log(`\nDone. Scanned ${seen} meta docs.`);
  console.log(`  need patch: ${needPatch}  missing content: ${missingContent}`);
  if (write) console.log(`  patched: ${patched}`);
  else console.log(`  (dry run — no writes; re-run with --write to apply)`);

  await app.delete();
}

main().catch(e => { console.error(e); process.exit(1); });
