// src/modules/student/services/assessmentCodeApi.ts
//
// Runs a student's own code against a question's SAMPLE tests while the test is
// live. This is a thin wrapper over the `runAssessmentCode` callable, which
// verifies the caller has an open attempt for that test and only ever runs the
// question's public cases — the hidden tests that decide the marks are not
// reachable from here, by design.

import { httpsCallable } from 'firebase/functions';
import { functions } from '@/Firebase/config';
import type { SampleRunResult } from '@/shared/utils/codingQuestion';

export interface AssessmentCodeRunResponse {
  questionId: string;
  caseCount: number;
  hiddenCaseCount: number;
  /** Present when some cases could not be run (e.g. the compiler is down). */
  failure?: string;
  results: SampleRunResult[];
  output: string;
}

/** Throws with a user-readable `message` on a refused run. */
export async function runAssessmentCode(input: {
  testId: string;
  questionId: string;
  language: string;
  code: string;
}): Promise<AssessmentCodeRunResponse> {
  const callable = httpsCallable<Record<string, unknown>, AssessmentCodeRunResponse>(
    functions,
    'runAssessmentCode',
  );
  const result = await callable({ ...input });
  return result.data;
}
