// src/modules/admin/api/questionImageUpload.ts
//
// Firebase Storage glue for question figures. Same shape as
// `src/shared/services/prepMediaUpload.ts`: validate with the pure helpers
// first (so a bad file fails with a sentence the author can act on, before a
// byte leaves the browser), then upload and hand back the download URL the
// question document stores.
//
// The path is the contract `storage.rules` grants — see
// `questionImagePath` in src/shared/utils/questionImage.ts. Nothing here
// invents a path, so rules and client can never disagree about a location.

import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '@/Firebase/config';
import {
  QUESTION_IMAGE_MAX_PER_QUESTION,
  questionImageAltText,
  questionImageExtension,
  questionImagePath,
  validateQuestionImage,
} from '@/shared/utils/questionImage';

export interface UploadedQuestionImage {
  url: string;
  storagePath: string;
  altText: string;
}

export interface QuestionImageUploadContext {
  collegeId: string;
  subjectId: string;
  topicId: string;
  /**
   * Folder label for the object. The create flow has no document id yet, so
   * callers pass a draft id; the storagePath recorded on the question is the
   * authoritative reference either way, and the id only has to be unique.
   */
  questionId: string;
  /** Question text, used to build a meaningful alt text. */
  questionText?: string;
}

/** Timestamp + random tail so two authors never overwrite each other's figure. */
function uploadNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Upload one figure; throws an Error with a user-readable message. */
export async function uploadQuestionImage(
  file: File,
  context: QuestionImageUploadContext,
  index = 0,
): Promise<UploadedQuestionImage> {
  const problem = validateQuestionImage(file);
  if (problem) throw new Error(problem);

  const extension = questionImageExtension(file);
  if (!extension) throw new Error('Use a PNG, JPG or WebP image.');

  const path = questionImagePath({
    collegeId: context.collegeId,
    subjectId: context.subjectId,
    topicId: context.topicId,
    questionId: context.questionId,
    extension,
    nonce: uploadNonce(),
  });

  const objectRef = ref(storage, path);
  await uploadBytes(objectRef, file, {
    contentType: file.type || (extension === 'jpg' ? 'image/jpeg' : `image/${extension}`),
  });
  const url = await getDownloadURL(objectRef);

  return {
    url,
    storagePath: path,
    altText: questionImageAltText(context.questionText, index),
  };
}

/**
 * Upload up to three figures in order. Sequential on purpose: a partial
 * failure leaves the earlier URLs known to the caller, and a question with one
 * figure is better than a question with none because the third upload timed
 * out. Callers surface the thrown message and let the author retry.
 */
export async function uploadQuestionImages(
  files: File[],
  context: QuestionImageUploadContext,
): Promise<UploadedQuestionImage[]> {
  const uploaded: UploadedQuestionImage[] = [];
  for (const [index, file] of files.slice(0, QUESTION_IMAGE_MAX_PER_QUESTION).entries()) {
    uploaded.push(await uploadQuestionImage(file, context, index));
  }
  return uploaded;
}
