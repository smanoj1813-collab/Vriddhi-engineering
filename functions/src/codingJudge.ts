// functions/src/codingJudge.ts
//
// Scoring coded answers, and letting a student try their own code against the
// PUBLIC samples while the test is running.
//
// THE PROBLEM THIS SOLVES
// A faculty member can see that a student's answer is "some code". Whether it
// works, and how well, is not something a human can check for forty answer
// sheets — and it is exactly the thing ChatGPT does well, which is why the
// answer is scored by RUNNING it. The same question is put to every student
// with the SAME hidden test cases, so a code snippet copied from anywhere still
// has to be correct for this question's inputs; the marks come from how many
// cases pass, one part per case.
//
// TWO ENTRY POINTS
//   judgeCodingSubmissions  — Firestore trigger on codingJudgeJobs/{id}, fired
//                             by the submit transaction. Runs the hidden cases,
//                             writes the marks, finalises the attempt when
//                             nothing else is pending.
//   runAssessmentCode       — callable. Runs the question's SAMPLE cases only,
//                             for a student with a live attempt. The hidden
//                             cases are never reachable from the browser.
//
// READ/WRITE BUDGET (a deliberate design constraint, not an accident)
//   sample run  : 2-3 reads + 1 quota write per click; the paper is NOT loaded.
//   judged paper: 1 job write, then ~3 reads + ~3 writes per coding submission,
//                 and 1 read per 10 questions (not one per question).
//   The full question loader is a fallback, never the fast path.
//
// GRACEFUL DEGRADATION
// If the sandbox is not configured or will not run a case, the question is
// handed to the faculty queue as a manual-graded question with the reason
// recorded (`judgeError`) — never scored as zero. A college without Judge0
// configured simply grades the code by hand, exactly as it does today.

import { getFirestore } from 'firebase-admin/firestore';
import admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { CODING_JUDGE_JOBS_COLLECTION } from './codingJudgeQueue';
import { materializeCases, studentCaseSeed } from './codingVariants';
import {
  JUDGE0_API_KEY,
  createAndPollSubmission,
  judge0BaseUrl,
  listJudge0Languages,
} from './codeRunner';
import {
  CODE_RUNNER_DAILY_LIMIT,
  CODE_RUNNER_PER_MINUTE_LIMIT,
  decideCodeRunnerQuota,
  findJudge0LanguageId,
  limitRunnerOutput,
  parseCodeRunRequest,
  type CodeRunnerLanguage,
} from './codeRunnerCore';
import {
  codingAnswerProblem,
  countDryRun,
  gradeCodingCases,
  parseCodingConfig,
  verdictForCase,
  type CodingCase,
  type CodingCaseVerdict,
  type JudgeCaseOutcome,
} from './codingAssessmentCore';
import {
  computeAttemptTotals,
  gradeFromPercentageForScheme,
  type SchemeGradingSnapshot,
  type ServerAnswer,
  type ServerQuestion,
} from './assessmentGrading';
import { loadQuestionsByIds, loadTestQuestions, missingQuestionIds, resolveStudent, rowRef } from './studentAssessments';

/** Runs per answer sheet. Higher than the Coding Lab's: a paper has 4-5 questions. */
const ASSESSMENT_RUNS_PER_MINUTE = 12;
const ASSESSMENT_RUNS_PER_DAY = 400;
const MAX_SAMPLE_RUN_RESPONSE = 20_000;

interface StudentIdentity {
  id: string;
  collegeId: string;
}

/**
 * Compile and run one case. The verdict is deliberately thin — status id plus
 * the program's own output — because the pass/fail decision belongs to
 * `verdictForCase`, which the unit tests pin.
 */
async function runJudgeCase(input: {
  language: CodeRunnerLanguage;
  sourceCode: string;
  stdin: string;
  timeLimitSeconds: number;
}): Promise<JudgeCaseOutcome> {
  const baseUrl = judge0BaseUrl();
  const languages = await listJudge0Languages(baseUrl);
  const languageId = findJudge0LanguageId(input.language, languages);
  if (languageId === null) {
    throw new Error(`The compiler service does not have ${input.language} installed.`);
  }
  const submission = await createAndPollSubmission(baseUrl, languageId, input.sourceCode, input.stdin, {
    cpuTimeLimitSeconds: input.timeLimitSeconds,
  });
  return {
    statusId: Number(submission.status?.id ?? submission.status_id ?? 0),
    stdout: submission.stdout ?? '',
    stderr: submission.stderr ?? '',
    compileOutput: submission.compile_output ?? '',
    timeMs: Number(submission.time ?? 0),
    memoryKb: Number(submission.memory ?? 0),
  };
}

/** A one-sentence reason from whatever the sandbox or the network threw. */
function judgeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message) return 'The compiler service could not run this test.';
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

interface CodingQuestionOutcome {
  questionId: string;
  status: 'judged' | 'pending_manual';
  marksObtained: number | null;
  judge: Record<string, unknown>;
  judgeError?: string;
}

/**
 * Scores one answer against every hidden case. Any infrastructure failure
 * (missing compiler, sandbox unreachable, a case that produced no verdict)
 * abandons the whole question to manual grading: awarding marks from a half-run
 * would be worse than not awarding them.
 */
async function judgeOneAnswer(
  question: ServerQuestion,
  answer: ServerAnswer,
  marks: number,
  seedInput: { testId: string; studentId: string },
): Promise<CodingQuestionOutcome> {
  const coding = question.coding;
  const code = answer.coding;
  if (!coding || !code) {
    return {
      questionId: question.id,
      status: 'pending_manual',
      marksObtained: null,
      judge: {},
      judgeError: 'The answer has no code stored against it.',
    };
  }

  // The student's cases: their own numbers, drawn from the same seed the paper
  // and the in-test sample run use, so what they debugged against is exactly
  // what is scored here.
  const materialized = materializeCases(
    coding.testCases,
    coding.placeholders,
    studentCaseSeed({ testId: seedInput.testId, studentId: seedInput.studentId, questionId: question.id }),
  );
  if (materialized.errors.length > 0) {
    // A template the server cannot evaluate would produce a wrong expected
    // output, which marks correct code wrong. Hand it to faculty instead.
    return {
      questionId: question.id,
      status: 'pending_manual',
      marksObtained: null,
      judge: {},
      judgeError: `The test values could not be prepared: ${materialized.errors[0]}`,
    };
  }

  const verdicts: CodingCaseVerdict[] = [];
  let failure: string | null = null;
  for (const [index, testCase] of materialized.cases.entries()) {
    try {
      const outcome = await runJudgeCase({
        language: code.language,
        sourceCode: code.code,
        stdin: testCase.stdin,
        timeLimitSeconds: coding.timeLimitSeconds,
      });
      verdicts.push(verdictForCase(index, outcome, testCase.expectedOutput));
    } catch (error) {
      failure = judgeFailureMessage(error);
      break;
    }
  }

  if (failure || verdicts.length !== materialized.cases.length) {
    return {
      questionId: question.id,
      status: 'pending_manual',
      marksObtained: null,
      judge: {},
      judgeError: failure || 'Some tests could not be run by the compiler service.',
    };
  }

  const grade = gradeCodingCases(materialized.cases as CodingCase[], verdicts, marks);
  return {
    questionId: question.id,
    status: 'judged',
    marksObtained: grade.marksObtained,
    judge: {
      language: code.language,
      // Recorded so a mark can be explained later: which student's numbers
      // these tests used, and whether they were per-student at all.
      varied: materialized.varied,
      marksMax: grade.marksMax,
      passedCount: grade.passedCount,
      caseCount: grade.caseCount,
      solved: grade.solved,
      // Per-case detail: what passed, how fast, and — for the student's own
      // failing cases — their program's output. The EXPECTED output is
      // deliberately absent: a student can read this document.
      cases: verdicts.map((verdict) => ({
        index: verdict.index,
        passed: verdict.passed,
        status: verdict.status,
        reason: verdict.reason,
        timeMs: verdict.timeMs,
        ...(verdict.passed ? {} : { got: verdict.got.slice(0, 500) }),
      })),
    },
  };
}

/**
 * The worker. Idempotent by construction: it re-reads the attempt, acts only on
 * questions still marked `pending_judge`, and re-checks inside the transaction
 * that wrote the marks — so a retried event, or a faculty member finishing the
 * paper by hand first, cannot double-count.
 */
export const judgeCodingSubmissions = onDocumentCreated(
  {
    document: `${CODING_JUDGE_JOBS_COLLECTION}/{jobId}`,
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 540,
    minInstances: 0,
    maxInstances: 20,
    retry: true,
    // Without this the judge runs with no runner credential and every case
    // fails in production while working perfectly in the emulator.
    secrets: [JUDGE0_API_KEY],
  },
  async (event) => {
    const jobRef = event.data?.ref;
    const job = event.data?.data();
    if (!jobRef || !job) return;
    const attemptId = String(job.attemptId || '');
    const testId = String(job.testId || '');
    if (!attemptId || !testId) {
      await jobRef.set({ status: 'failed', error: 'The job has no attempt reference.', finishedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    const db = getFirestore(admin.app(), 'default');
    const attemptRef = db.collection('studentAssessments').doc(attemptId);
    await jobRef.set(
      { status: 'running', startedAt: admin.firestore.FieldValue.serverTimestamp(), attempts: admin.firestore.FieldValue.increment(1) },
      { merge: true },
    );

    const attemptDoc = await attemptRef.get();
    const row = attemptDoc.data();
    if (!attemptDoc.exists || !row) {
      await jobRef.set({ status: 'failed', error: 'The attempt no longer exists.', finishedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    const breakdown: Array<Record<string, unknown>> = Array.isArray(row.gradingBreakdown) ? row.gradingBreakdown : [];
    const pendingIds = breakdown
      .filter((item) => String(item?.status || '') === 'pending_judge')
      .map((item) => String(item?.questionId || ''))
      .filter(Boolean);
    if (pendingIds.length === 0) {
      // Already judged (a replay), or a faculty member graded the paper first.
      await jobRef.set({ status: 'done', finishedAt: admin.firestore.FieldValue.serverTimestamp(), skipped: true }, { merge: true });
      return;
    }

    const testDoc = await db.collection('scheduledTests').doc(testId).get();
    const test = testDoc.data() || {};
    // Read cost: only the questions being judged (1 read per 10), not the whole
    // paper. The full loader runs only if the targeted read came back short —
    // legacy papers keep their embedded questions, and those still need it.
    const targeted = await loadQuestionsByIds(testId, pendingIds);
    const missing = missingQuestionIds(pendingIds, targeted.keys());
    const questions = missing.length === 0
      ? [...targeted.values()]
      : await loadTestQuestions(testId, test);
    const answers = new Map<string, ServerAnswer>(
      (Array.isArray(row.answers) ? row.answers as ServerAnswer[] : []).map((answer) => [answer.questionId, answer]),
    );

    const outcomes: CodingQuestionOutcome[] = [];
    for (const questionId of pendingIds) {
      const question = questions.find((item) => item.id === questionId || item.questionId === questionId);
      const answer = question ? answers.get(question.id) : undefined;
      if (!question || !question.coding || !answer) {
        outcomes.push({
          questionId,
          status: 'pending_manual',
          marksObtained: null,
          judge: {},
          judgeError: !question || !question.coding
            ? 'The question is no longer a coding question; it must be graded by hand.'
            : 'No coded answer was stored for this question.',
        });
        continue;
      }
      try {
        outcomes.push(await judgeOneAnswer(
          question,
          answer,
          Math.max(0, Number(question.marks) || 0),
          { testId, studentId: String(row.studentId || '') },
        ));
      } catch (error) {
        outcomes.push({
          questionId,
          status: 'pending_manual',
          marksObtained: null,
          judge: {},
          judgeError: judgeFailureMessage(error),
        });
      }
    }

    const byQuestion = new Map(outcomes.map((outcome) => [outcome.questionId, outcome]));
    const awardedTotal = Math.round(
      outcomes.reduce((sum, outcome) => sum + (outcome.marksObtained || 0), 0) * 100,
    ) / 100;
    const fallbackCount = outcomes.filter((outcome) => outcome.status === 'pending_manual').length;

    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(attemptRef);
      const current = fresh.data();
      if (!fresh.exists || !current) return;

      let applied = 0;
      let newlyManualMarks = 0;
      const nextBreakdown = (Array.isArray(current.gradingBreakdown) ? current.gradingBreakdown : [])
        .map((item: Record<string, unknown>) => {
          const outcome = byQuestion.get(String(item?.questionId || ''));
          if (!outcome || String(item?.status || '') !== 'pending_judge') return item;
          applied += 1;
          if (outcome.status === 'judged') {
            return { ...item, status: 'judged', marksObtained: outcome.marksObtained, judge: outcome.judge };
          }
          // Handed to faculty, who can now see the reason and the student's own
          // output; the marks this question is worth move into the manual cap.
          const marks = Number((current.manualQuestionSnippets as Array<Record<string, unknown>> | undefined)
            ?.find((snippet) => String(snippet?.questionId) === outcome.questionId)?.marks) || 0;
          newlyManualMarks += marks;
          return { ...item, status: 'pending_manual', marksObtained: null, judgeError: outcome.judgeError };
        });

      if (applied === 0) return;

      const autoScore = Math.round(((Number(current.autoScore) || 0) + awardedTotal) * 100) / 100;
      const judgePending = nextBreakdown.some((item) => String(item?.status || '') === 'pending_judge');
      const manualPending = nextBreakdown.filter((item) => String(item?.status || '') === 'pending_manual');
      const manualGradeableMax = Math.round(((Number(current.manualGradeableMax) || 0) + newlyManualMarks) * 100) / 100;
      const needsManual = manualGradeableMax > 0 || manualPending.length > 0;
      const totalMarks = Number(current.totalMarks)
        || questions.reduce((sum, question) => sum + question.marks, 0);

      const patch: Record<string, unknown> = {
        autoScore,
        gradingBreakdown: nextBreakdown,
        judgeStatus: judgePending ? 'pending' : fallbackCount > 0 ? 'failed' : 'done',
        needsManualGrading: needsManual,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (newlyManualMarks > 0) patch.manualGradeableMax = manualGradeableMax;
      if (fallbackCount > 0) {
        patch.judgeError = outcomes.find((outcome) => outcome.judgeError)?.judgeError || '';
      }
      // Coding questions the judge could not run become manual questions, so the
      // faculty queue can render the code and cap the marks per question.
      if (newlyManualMarks > 0) {
        const existing = Array.isArray(current.manualQuestionSnippets) ? current.manualQuestionSnippets as Array<Record<string, unknown>> : [];
        const additions = manualPending
          .filter((item) => !existing.some((snippet) => String(snippet?.questionId) === String(item.questionId)))
          .map((item) => {
            const question = questions.find((candidate) => candidate.id === String(item.questionId));
            const answer = question ? answers.get(question.id) : undefined;
            return {
              questionId: String(item.questionId),
              text: String(question?.text || '').slice(0, 2000),
              marks: Math.max(0, Number(question?.marks) || 0),
              answerText: answer?.coding
                ? ['```' + answer.coding.language, answer.coding.code, '```'].join('\n').slice(0, 4000)
                : '',
            };
          });
        patch.manualQuestionSnippets = [...existing, ...additions];
      }

      if (!judgePending && !needsManual) {
        const totals = computeAttemptTotals({
          autoScore,
          manualScore: 0,
          penaltyPercentage: Number(current.latePenaltyPercentage) || 0,
          totalMarks,
        });
        const derived = gradeFromPercentageForScheme(
          totals.percentage,
          (current.schemePackSnapshot || test.schemePackSnapshot) as SchemeGradingSnapshot | undefined,
        );
        Object.assign(patch, {
          status: 'graded',
          marksObtained: totals.marksObtained,
          percentage: totals.percentage,
          grade: derived.grade,
          gradePoint: derived.gradePoint,
          gradeMethod: derived.method,
          isPass: derived.grade !== 'F',
          gradedAt: admin.firestore.FieldValue.serverTimestamp(),
          gradedBy: 'server-code-judge',
        });
        transaction.update(db.collection('scheduledTests').doc(testId), {
          totalGraded: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      transaction.update(attemptRef, patch);
    });

    logger.info('[CodingJudge] Judged coded answers', {
      attemptId,
      testId,
      pending: pendingIds.length,
      judged: outcomes.length - fallbackCount,
      manualFallbacks: fallbackCount,
      awarded: awardedTotal,
    });
    await jobRef.set(
      {
        status: fallbackCount > 0 && fallbackCount === outcomes.length ? 'failed' : 'done',
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        judgedCount: outcomes.length - fallbackCount,
        manualFallbackCount: fallbackCount,
      },
      { merge: true },
    );
  },
);

/**
 * Runs a student's code against the question's SAMPLE cases during a live test.
 *
 * Scope is the point: this callable can only reach a question that belongs to a
 * test the caller is currently sitting, and it only ever receives the question's
 * PUBLIC cases. The hidden cases are not returned by any code path a browser can
 * call, so the "run it" button cannot be used to read the answer key.
 */
export const runAssessmentCode = onCall(
  {
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 60,
    minInstances: 0,
    // Capped to fit the asia-south1 CPU quota (20 vCPU per project and region).
    // Gen-2 functions handle up to 80 concurrent requests per instance by
    // default, so 10 instances is far more than sample runs need.
    maxInstances: 10,
    secrets: [JUDGE0_API_KEY],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required');
    const student = await resolveStudent(uid, request.auth?.token || {}) as StudentIdentity;
    const testId = String(request.data?.testId || '').trim();
    const questionId = String(request.data?.questionId || '').trim();
    if (!testId || !questionId || testId.includes('/') || questionId.includes('/')) {
      throw new HttpsError('invalid-argument', 'Test and question are required');
    }
    const parsed = parseCodeRunRequest({
      language: request.data?.language,
      sourceCode: request.data?.code,
      stdin: '',
    });

    const db = getFirestore(admin.app(), 'default');
    const attemptRef = rowRef(testId, student.id);
    // Read cost on the hot path: attempt + the one question being run (2 reads).
    // The scheduled-test document is read ONLY when the targeted lookup misses
    // (legacy papers embed their questions), so a student clicking "run" ten
    // times costs ten cheap lookups rather than ten whole-paper loads.
    const attemptDoc = await attemptRef.get();
    const row = attemptDoc.data();
    if (!attemptDoc.exists || !row || row.studentId !== student.id) {
      throw new HttpsError('failed-precondition', 'You do not have an attempt for this test.');
    }
    if (String(row.status) !== 'in_progress') {
      throw new HttpsError('failed-precondition', 'This attempt is no longer being written.');
    }
    const targeted = await loadQuestionsByIds(testId, [questionId]);
    let question = targeted.get(questionId);
    if (!question) {
      const testDoc = await db.collection('scheduledTests').doc(testId).get();
      if (!testDoc.exists) throw new HttpsError('failed-precondition', 'Scheduled test not found');
      const questions = await loadTestQuestions(testId, testDoc.data() || {});
      question = questions.find((item) => item.id === questionId || item.questionId === questionId);
    }
    const coding = parseCodingConfig(question?.coding);
    if (!question || !coding) {
      throw new HttpsError('invalid-argument', 'That question is not a coding question.');
    }
    const problem = codingAnswerProblem(parsed.language, parsed.sourceCode, coding.languages);
    if (problem) throw new HttpsError('invalid-argument', problem);
    if (coding.sampleCases.length === 0) {
      throw new HttpsError('failed-precondition', 'This question has no sample tests — review your code and submit.');
    }

    // The samples the student runs are THEIR samples — the same numbers the
    // hidden tests and the paper use for them, so what they debug is what is
    // scored.
    const sampleSeed = studentCaseSeed({ testId, studentId: student.id, questionId: question.id });
    const materializedSamples = materializeCases(coding.sampleCases, coding.placeholders, sampleSeed);
    if (materializedSamples.errors.length > 0) {
      throw new HttpsError('failed-precondition', `This question's sample tests need fixing: ${materializedSamples.errors[0]}`);
    }

    // `testId:questionId` scopes the per-question counter to this sitting.
    const dryRunQuota = await consumeAssessmentRunQuota(uid, `${testId}:${question.id}`, coding.dryRunLimit);

    const verdicts: Array<Record<string, unknown>> = [];
    let failure: string | null = null;
    for (const [index, testCase] of materializedSamples.cases.entries()) {
      try {
        const outcome = await runJudgeCase({
          language: parsed.language,
          sourceCode: parsed.sourceCode,
          stdin: testCase.stdin,
          timeLimitSeconds: coding.timeLimitSeconds,
        });
        const verdict = verdictForCase(index, outcome, testCase.expectedOutput);
        verdicts.push({
          index,
          passed: verdict.passed,
          status: verdict.status,
          reason: verdict.reason,
          stdin: testCase.stdin.slice(0, 500),
          // Sample cases are public by definition, so echoing what was expected
          // is the whole point of running them.
          expectedOutput: testCase.expectedOutput.slice(0, 1000),
          got: verdict.got.slice(0, 1000),
          timeMs: verdict.timeMs,
        });
      } catch (error) {
        failure = judgeFailureMessage(error);
        break;
      }
    }

    if (failure && verdicts.length === 0) {
      throw new HttpsError('unavailable', failure);
    }
    const payload = JSON.stringify({ failure, verdicts });
    if (payload.length > MAX_SAMPLE_RUN_RESPONSE) {
      throw new HttpsError('resource-exhausted', 'The output was too large to return. Try a smaller program.');
    }
    return {
      questionId: question.id,
      caseCount: materializedSamples.cases.length,
      hiddenCaseCount: coding.testCases.length,
      ...(failure ? { failure } : {}),
      results: verdicts,
      output: limitRunnerOutput(verdicts.map((verdict) => String(verdict.got || '')).join('\n')),
      // What the editor shows as "N sample runs left". -1 = unlimited.
      dryRunsUsed: dryRunQuota.dryRunsUsed,
      dryRunLimit: dryRunQuota.dryRunLimit,
      dryRunsRemaining: dryRunQuota.dryRunsRemaining,
    };
  },
);

/**
 * Per-student budget for in-test sample runs.
 *
 * Two budgets in ONE document and ONE write (the document was already read and
 * written here, so the per-question limit costs nothing extra):
 *   - the whole-student throttle (12/minute, 400/day) — the abuse brake, and the
 *     reason "unlimited" still cannot be turned into a free code-execution
 *     service;
 *   - the question's own dry-run limit, counted per test:question (see
 *     countDryRun). `0` = unlimited.
 */
async function consumeAssessmentRunQuota(
  uid: string,
  questionKey: string,
  dryRunLimit: number,
): Promise<{ remaining: number; dryRunsUsed: number; dryRunLimit: number; dryRunsRemaining: number }> {
  const db = getFirestore(admin.app(), 'default');
  const ref = db.collection('assessmentCodeUsage').doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const stored = snapshot.data();
    const decision = decideCodeRunnerQuota(
      stored,
      Date.now(),
      ASSESSMENT_RUNS_PER_DAY,
      ASSESSMENT_RUNS_PER_MINUTE,
    );
    if (!decision.allowed) {
      throw new HttpsError(
        'resource-exhausted',
        decision.reason === 'minute'
          ? `Please wait a minute before running your code again (${ASSESSMENT_RUNS_PER_MINUTE} runs per minute).`
          : `You have used today's ${ASSESSMENT_RUNS_PER_DAY} code runs. Submit your answer without running it.`,
      );
    }

    const counted = countDryRun(stored?.runsByKey, questionKey, dryRunLimit);
    if (!counted.allowed) {
      throw new HttpsError(
        'resource-exhausted',
        `You have used all ${counted.limit} sample runs for this question. You can still submit your answer — it is graded against hidden tests, not the samples.`,
      );
    }

    transaction.set(ref, {
      dayKey: decision.dayKey,
      dailyRuns: decision.dailyRuns,
      minuteKey: decision.minuteKey,
      minuteRuns: decision.minuteRuns,
      runsByKey: counted.next,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {
      remaining: decision.dailyRemaining,
      dryRunsUsed: counted.used,
      dryRunLimit: counted.limit,
      dryRunsRemaining: counted.remaining,
    };
  });
}

// Referenced so the constants above stay the single source of truth if either
// budget is ever tuned: the Coding Lab's defaults remain its own.
export const ASSESSMENT_CODE_BUDGETS = {
  perMinute: ASSESSMENT_RUNS_PER_MINUTE,
  perDay: ASSESSMENT_RUNS_PER_DAY,
  labPerMinute: CODE_RUNNER_PER_MINUTE_LIMIT,
  labPerDay: CODE_RUNNER_DAILY_LIMIT,
};

export type { StudentIdentity };
