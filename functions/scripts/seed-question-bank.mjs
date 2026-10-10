#!/usr/bin/env node
/**
 * Seed the universal question bank from the repo's question content.
 *
 * Reads every `content/question-banks/**\/questions.json` and bulk-writes each
 * question into the shared pool as THREE linked documents:
 *   questionBank_meta/{id}      — small, filterable metadata
 *   questionBank_content/{id}   — full question payload
 *   questionReviews/{id}        — approval record (auto-approved, source=platform)
 *
 * Platform content is tagged `vriddhi-curated` + `free`, `visibility: public`,
 * `source: platform`, `status: approved` — free and visible to all colleges.
 * See docs/universal-question-bank-design.md §6.
 *
 * ID scheme: content-addressed sha1(subject + normalized text) → 20 hex chars.
 * Re-running the script is an idempotent update, not a duplicate-insert. The
 * previous random-doc() scheme duplicated the bank on every run — never re-run
 * --write on a main copy that still uses random ids.
 *
 * Requires the Firebase Admin SDK (declared in functions/package.json) and a
 * service account. Credentials are read from the environment exactly like
 * functions/src/services/questions.ts:
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * or GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON file.
 *
 * Usage (from repo root):
 *   npm --prefix functions install
 *   node functions/scripts/seed-question-bank.mjs            # dry-run preview
 *   node functions/scripts/seed-question-bank.mjs --write    # write to Firestore
 *   node functions/scripts/seed-question-bank.mjs --write --subject "Marketing Management"
 *   node functions/scripts/seed-question-bank.mjs --write --subject="Business Law"
 *
 * Never commit service-account credentials.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const BANK_DIR = join(ROOT, 'content', 'question-banks');

const META = 'questionBank_meta';
const CONTENT = 'questionBank_content';
const REVIEWS = 'questionReviews';

const PLATFORM_TAGS = ['vriddhi-curated', 'free'];
const CREATED_BY = {
  userId: 'vriddhi-seed',
  userName: 'Vriddhi',
  collegeId: null,
  collegeName: 'Vriddhi',
  role: 'superadmin',
};

const TYPE_MAP = {
  matching: 'match',
  assertion_reason: 'mcq',
  short: 'short_answer',
  long: 'long_answer',
};

function mapType(t) {
  return TYPE_MAP[t] || t;
}

function buildPreviewText(text, maxLen = 160) {
  if (!text) return '';
  return String(text).replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function buildSearchKeywords(text, subjectId, topicId, tags) {
  const tokens = new Set();
  const add = (value) => {
    if (!value) return;
    String(value)
      .toLowerCase()
      .split(/\s+/)
      .forEach((word) => {
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

function normalizeForId(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function idForQuestion(q) {
  const key = `${q.subject || 'General'}::${normalizeForId(q.text || '')}`;
  return createHash('sha1').update(key).digest('hex').slice(0, 20);
}

function loadQuestions() {
  const out = [];
  if (!existsSync(BANK_DIR)) return out;
  // Walk program folders (e.g. bba/) then subject folders, collecting every
  // questions.json (each contains a `questions[]` array).
  for (const program of readdirSync(BANK_DIR)) {
    const programDir = join(BANK_DIR, program);
    if (!existsSync(join(programDir, 'questions.json')) && !isDir(programDir)) continue;
    for (const subject of readdirSync(programDir)) {
      const p = join(programDir, subject, 'questions.json');
      if (existsSync(p)) pushQuestions(join(programDir, subject), out);
    }
  }
  return out;
}

function isDir(p) {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}

function pushQuestions(dir, out) {
  const data = JSON.parse(readFileSync(join(dir, 'questions.json'), 'utf-8'));
  const subject = data.subject || dir.split('/').pop();
  for (const q of data.questions || []) {
    out.push({ subjectDir: dir.split('/').pop(), subject, ...q });
  }
}

function toMeta(q, id) {
  const now = new Date().toISOString();
  const subjectId = q.subject || 'General';
  const topicId = q.topic || 'General';
  const tags = [...new Set([...(q.tags || []), ...PLATFORM_TAGS])];
  const previewText = buildPreviewText(q.text || '');
  const searchKeywords = buildSearchKeywords(q.text || '', subjectId, topicId, tags);
  return {
    subjectId,
    topicId,
    subTopicId: q.subTopicId || '',
    difficulty: q.difficulty || 'medium',
    questionType: mapType(q.type || 'mcq'),
    marks: q.marks ?? 1,
    language: q.language || 'en',
    tags,
    status: 'approved',
    visibility: 'public',
    sharedWith: [],
    source: 'platform',
    // Must be the real doc id: useQuestionBank.loadQuestionDetail reads this
    // path and calls downloadQuestion() on it. A literal "{id}" 404s the detail view.
    storagePath: `${CONTENT}/${id}.json`,
    hasImage: false,
    qualityRating: 0,
    usageCount: 0,
    createdBy: CREATED_BY,
    previewText,
    searchKeywords,
    createdAt: now,
    updatedAt: now,
  };
}

function toContent(q, id) {
  const now = new Date().toISOString();
  const tags = [...new Set([...(q.tags || []), ...PLATFORM_TAGS])];
  const options = Array.isArray(q.options)
    ? q.options.map((o) => (typeof o === 'string' ? { id: String.fromCharCode(65 + q.options.indexOf(o)), text: o, isCorrect: o === q.correctAnswer || q.options.length === 1 } : o))
    : [];
  // letter-indexed correctness when options are strings and correctAnswer is a letter
  if (options.length && typeof q.options?.[0] === 'string' && typeof q.correctAnswer === 'string' && /^[A-Da-d]$/.test(q.correctAnswer)) {
    const idx = q.correctAnswer.toUpperCase().charCodeAt(0) - 65;
    options.forEach((o, i) => (o.isCorrect = i === idx));
  }
  return {
    version: 1,
    questionText: q.text || '',
    options,
    correctAnswer: q.correctAnswer || '',
    explanation: q.explanation || '',
    hint: '',
    topicId: q.topic || 'General',
    subjectId: q.subject || 'General',
    subTopicId: q.subTopicId || '',
    difficulty: q.difficulty || 'medium',
    questionType: mapType(q.type || 'mcq'),
    marks: q.marks ?? 1,
    language: q.language || 'en',
    tags,
    images: [],
    hasImage: false,
    createdBy: CREATED_BY,
    source: 'platform',
    status: 'approved',
    visibility: 'public',
    sharedWith: [],
    quality: { rating: 0, reviewCount: 0, flagged: false },
    usageStats: { usedInPapers: 0, usedInAssessments: 0, collegesUsing: [] },
    versions: [],
    storagePath: `${CONTENT}/${id}.json`,
    metadataDocId: id,
    createdAt: now,
    updatedAt: now,
  };
}

function toReview(metaId, now) {
  return {
    questionId: metaId,
    submittedBy: CREATED_BY,
    submittedAt: now,
    status: 'approved',
    reviewedAt: now,
    reviewerId: CREATED_BY.userId,
    reviewerName: CREATED_BY.userName,
    reviewComment: 'Trusted platform submission (auto-approved).',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Guard against the `{id}` placeholder regression: every meta/content doc must
 * point at the real Firestore doc id, or the question-detail view 404s when it
 * resolves meta.storagePath through downloadQuestion(). Runs in both modes.
 */
function selfCheckIdWiring() {
  const probeId = 'probe123';
  const sample = { subject: 'Self-Check', topic: 'Self-Check', text: 'x', type: 'mcq' };
  const meta = toMeta(sample, probeId);
  const content = toContent(sample, probeId);
  const deterministic = idForQuestion({ subject: 'Business Law', text: '  What is  law?  ' });
  const deterministic2 = idForQuestion({ subject: 'Business Law', text: 'what is law?' });
  const checks = [
    [meta.storagePath === `${CONTENT}/${probeId}.json`, 'meta.storagePath must interpolate the doc id'],
    [content.storagePath === `${CONTENT}/${probeId}.json`, 'content.storagePath must interpolate the doc id'],
    [content.metadataDocId === probeId, 'content.metadataDocId must equal the meta doc id'],
    [!JSON.stringify(meta).includes('{id}') && !JSON.stringify(content).includes('{id}'), 'no literal {id} placeholder may survive'],
    [typeof meta.previewText === 'string' && meta.previewText.length <= 160, 'meta.previewText must be ≤160 chars'],
    [Array.isArray(meta.searchKeywords) && meta.searchKeywords.length > 0, 'meta.searchKeywords must be non-empty'],
    [meta.searchKeywords.every((k) => k === k.toLowerCase() && k.length <= 20), 'searchKeywords must be lowercased ≤20 chars'],
    [deterministic === deterministic2, 'idForQuestion must be deterministic (whitespace/case collapsed)'],
    [deterministic.length === 20 && /^[0-9a-f]+$/.test(deterministic), 'idForQuestion must be 20 hex chars'],
  ];
  const failed = checks.filter(([ok]) => !ok).map(([, msg]) => msg);
  if (failed.length) {
    console.error(`Seed script self-check FAILED:\n  - ${failed.join('\n  - ')}`);
    process.exit(1);
  }
}

async function getAdmin() {
  try {
    return (await import('firebase-admin')).default;
  } catch {
    console.error('firebase-admin not found. Run: npm --prefix functions install');
    process.exit(1);
  }
}

function buildApp(admin) {
  const hasEnv =
    process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY;
  if (hasEnv) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  // Also supports gcloud ADC (gcloud auth application-default login) without env var
  try {
    return admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } catch (e) {
    console.error(
      'No Firebase credentials found. Set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, or run: gcloud auth application-default login --project vriddhi-engineering'
    );
    console.error('  Detail:', e.message);
    process.exit(1);
  }
}

async function main() {
  selfCheckIdWiring();
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  // support both --subject="X" and --subject "X"
  let subjectFilter = (args.find((a) => a.startsWith('--subject=')) || '').split('=')[1];
  if (!subjectFilter) {
    const idx = args.indexOf('--subject');
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) subjectFilter = args[idx + 1];
  }
  if (subjectFilter) subjectFilter = subjectFilter.trim();

  const allRaw = loadQuestions();
  const all = allRaw.filter((q) => !subjectFilter || String(q.subject).trim().toLowerCase() === subjectFilter.toLowerCase());
  if (subjectFilter && !all.length) {
    console.log(`No questions found for subject "${subjectFilter}". Available subjects:`);
    const avail = [...new Set(allRaw.map((q) => q.subject))].sort();
    for (const s of avail) console.log(`  - ${s}`);
    return;
  }
  if (!all.length) {
    console.log('No questions found. Check content/question-banks/.');
    return;
  }

  const bySubject = {};
  for (const q of all) bySubject[q.subject] = (bySubject[q.subject] || 0) + 1;
  console.log(`Loaded ${all.length} questions across ${Object.keys(bySubject).length} subjects:`);
  for (const [s, n] of Object.entries(bySubject)) console.log(`  - ${s}: ${n}`);

  // Deduplicate by content-addressed id so a re-run is an update, not a duplicate.
  const deduped = new Map();
  for (const q of all) {
    const id = idForQuestion(q);
    if (!deduped.has(id)) deduped.set(id, q);
  }
  if (deduped.size !== all.length) {
    console.log(`  (deduped ${all.length - deduped.size} duplicate texts → ${deduped.size} unique)`);
  }
  const uniqueQuestions = Array.from(deduped.entries()).map(([id, q]) => ({ id, q }));

  if (!write) {
    console.log('\nDry run — pass --write to write to Firestore. (Credentials required only for --write.)');
    console.log(`Would write ${uniqueQuestions.length} unique questions (content-addressed ids).`);
    const sample = uniqueQuestions.slice(0, 3);
    for (const { id, q } of sample) {
      const meta = toMeta(q, id);
      console.log(`  sample ${id}: ${q.subject} / ${q.topic} — preview="${meta.previewText.slice(0, 60)}..." keywords=${meta.searchKeywords.slice(0, 4).join(',')}`);
    }
    return;
  }

  const admin = await getAdmin();
  const app = buildApp(admin);
  const db = admin.firestore();
  const now = new Date().toISOString();
  const BATCH = 400; // Firestore batch cap is 500 writes

  // Pre-flight: count existing docs so the operator can see idempotency.
  try {
    const existing = await db.collection(META).count().get();
    const count = existing.data().count;
    console.log(`Pre-flight: ${count} existing docs in ${META} (re-run will update, not duplicate).`);
  } catch {
    try {
      const snap = await db.collection(META).limit(1).get();
      console.log(`Pre-flight: ${META} readable (count aggregation not available), sample ${snap.size} doc(s) found.`);
    } catch (e) {
      console.log(`Pre-flight count skipped: ${e.message}`);
    }
  }

  let total = 0;
  const chunkSize = Math.floor(BATCH / 3);
  for (let i = 0; i < uniqueQuestions.length; i += chunkSize) {
    const chunk = uniqueQuestions.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const { id: metaId, q } of chunk) {
      // Deterministic ids make re-runs idempotent (set overwrites).
      batch.set(db.collection(META).doc(metaId), toMeta(q, metaId), { merge: false });
      batch.set(db.collection(CONTENT).doc(metaId), toContent(q, metaId), { merge: false });
      // Review doc id is also deterministic (metaId) so re-runs don't create duplicate reviews.
      batch.set(db.collection(REVIEWS).doc(metaId), toReview(metaId, now), { merge: false });
    }
    await batch.commit();
    total += chunk.length;
    console.log(`  seeded ${total}/${uniqueQuestions.length} questions…`);
  }

  console.log(`Done. Seeded ${total} questions into the universal question bank (public + free, content-addressed).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
