// src/shared/utils/questionImage.ts
//
// Question-bank images — the figures a logical-reasoning, quantitative or
// science question needs and a plain text field cannot carry.
//
// The player has rendered `imageUrl` for a while (`QuestionRenderer`), the
// server already forwards it (`publicQuestion`), and the submission form has
// always LET faculty pick up to three files — it just dropped them on the
// floor (`images: []`, `storagePath: ''`). These helpers are the missing
// middle: validate what a question figure may be, and build the storage path
// the rules in `storage.rules` grant, so the same object a staff member uploads
// is the one a student's browser loads mid-test.
//
// Pure by design: no Firebase import, so the rules-shaped path can be pinned
// by unit tests without a bucket.

/** Storage cap per image. The form has promised "under 2MB" since day one. */
export const QUESTION_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** A question may carry at most this many figures. */
export const QUESTION_IMAGE_MAX_PER_QUESTION = 3;

/** Bound on a single path segment, so a rogue id cannot build a mile-long path. */
export const QUESTION_IMAGE_MAX_SEGMENT = 64;

/** Content types the rules accept, mapped to the extension stored on disk. */
const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const ALLOWED_EXTENSIONS = ['png', 'jpg', 'webp'];

export interface QuestionImageFileLike {
  name?: string;
  type?: string;
  size?: number;
}

/**
 * Resolve the on-disk extension for a picked file.
 *
 * MIME type wins — it is what the rules check — and the filename is the
 * fallback for the browsers that hand over an empty `type` for a file dropped
 * from a file manager. Anything not in the allowlist returns null, and the
 * caller refuses the file rather than guessing.
 */
export function questionImageExtension(file: QuestionImageFileLike): string | null {
  const byMime = MIME_EXTENSION[String(file.type || '').toLowerCase()];
  if (byMime) return byMime;

  const match = /\.([a-z0-9]{2,5})$/i.exec(String(file.name || '').trim());
  const byName = match?.[1]?.toLowerCase();
  if (!byName) return null;
  const normalized = byName === 'jpeg' ? 'jpg' : byName;
  return ALLOWED_EXTENSIONS.includes(normalized) ? normalized : null;
}

/** A user-readable reason the file cannot be used, or null when it can. */
export function validateQuestionImage(file: QuestionImageFileLike): string | null {
  if (!questionImageExtension(file)) return 'Use a PNG, JPG or WebP image.';
  const size = Number(file.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) return 'That image file is empty — pick it again.';
  if (size > QUESTION_IMAGE_MAX_BYTES) return 'Keep each image under 2 MB so the paper stays quick to load.';
  return null;
}

/**
 * Make one path segment safe: lowercase, `[a-z0-9_-]`, collapsed separators,
 * no leading/trailing separator, bounded length. This is also what stops an id
 * like `../../firestore.rules` from escaping the `images/questions/` prefix —
 * the dots and slashes are simply not in the alphabet.
 */
export function sanitizeQuestionImageSegment(value: unknown, fallback = 'general'): string {
  const cleaned = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+/, '')
    .replace(/[-_]+$/, '')
    .slice(0, QUESTION_IMAGE_MAX_SEGMENT);
  return cleaned || fallback;
}

export interface QuestionImagePathInput {
  collegeId: string;
  subjectId: string;
  topicId: string;
  questionId: string;
  extension: string;
  /** Unique tail (timestamp + random) so two uploads never overwrite each other. */
  nonce: string;
}

/**
 * The one canonical object path. `storage.rules` grants exactly this shape:
 *
 *   images/questions/{collegeId}/{subjectId}/{topicId}/{questionId}/{nonce}.{ext}
 *
 * The college segment is what keeps one tenant's figures out of another's
 * bucket listing; `platform` is the segment platform-curated (superadmin)
 * questions use, and the read rule treats it as shared.
 */
export function questionImagePath(input: QuestionImagePathInput): string {
  const rawExtension = String(input.extension ?? '').trim().toLowerCase();
  const extension = ALLOWED_EXTENSIONS.includes(rawExtension) ? rawExtension : 'png';
  return [
    'images',
    'questions',
    sanitizeQuestionImageSegment(input.collegeId, 'platform'),
    sanitizeQuestionImageSegment(input.subjectId),
    sanitizeQuestionImageSegment(input.topicId),
    sanitizeQuestionImageSegment(input.questionId),
    `${sanitizeQuestionImageSegment(input.nonce, 'img')}.${extension}`,
  ].join('/');
}

/**
 * Alt text for an uploaded figure. Screen readers are how a visually impaired
 * student sits the same paper, and the rules require nothing here — so the
 * default leans on the question itself rather than shipping an empty alt.
 */
export function questionImageAltText(questionText: unknown, index = 0): string {
  const excerpt = String(questionText ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const label = `figure ${index + 1}`;
  return excerpt ? `Figure for: ${excerpt} (${label})` : `Question ${label}`;
}
