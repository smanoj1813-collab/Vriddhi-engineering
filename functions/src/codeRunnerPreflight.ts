// functions/src/codeRunnerPreflight.ts
//
// "Is the code compiler actually connected?" — answered from inside the
// deployed project, in one call, by the person who just configured it.
//
// WHY THIS EXISTS
// The runner is configured out-of-band: a URL in `functions/.env.<project-id>`
// and an API key in Firebase secret manager. If either is missing or wrong, the
// failure surfaces later as a student's code run refusing to work — and the
// message they get ("the compiler service could not run this test") is true but
// useless to whoever is holding the deploy. Worse, a key bound to one function
// and not another works in the Coding Lab and fails in an exam, which is exactly
// the class of bug this project has already been bitten by.
//
// So: a superadmin-only callable that probes the configured runner and reports
// what it found, in sentences that name the fix. It reads nothing from Firestore
// and writes nothing — one outbound HTTP call to the runner's /languages.
//
// It deliberately reports only whether an API key is PRESENT, never its value,
// and the language list is the runner's own, so a mismatched installation
// (Java missing, say) is visible before an exam rather than during one.

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import {
  JUDGE0_API_KEY,
  judge0BaseUrl,
  listJudge0Languages,
} from './codeRunner';
import { CODING_LANGUAGES } from './codingAssessmentCore';
import { resolveStaff } from './studentAssessments';

/** Pure: turns the probe's raw results into sentences that name the fix. */
export function describeRunnerSetup(input: {
  urlConfigured: boolean;
  url: string;
  keyPresent: boolean;
  keyHeader: string;
  languages: Array<{ id?: number | string; name?: string }>;
  error?: string;
  latencyMs?: number;
}): { ready: boolean; problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];

  if (!input.urlConfigured) {
    problems.push(
      'JUDGE0_API_URL is not set. Add it to functions/.env.<project-id> (an HTTPS base URL, no credentials or query string) and redeploy.',
    );
  }
  if (!input.keyPresent) {
    notes.push(
      'No JUDGE0_API_KEY value is bound to this function. That is correct only for a runner with authentication disabled; otherwise run `firebase functions:secrets:set JUDGE0_API_KEY --project <project-id>` and redeploy.',
    );
  }
  if (input.urlConfigured && input.error) {
    problems.push(`The runner could not be reached: ${input.error}`);
  }
  if (input.urlConfigured && !input.error) {
    notes.push(`Reached ${input.url}${typeof input.latencyMs === 'number' ? ` in ${input.latencyMs} ms` : ''}.`);
    notes.push(`Sending the key in the "${input.keyHeader}" header.`);
  }

  const names = input.languages.map((language) => String(language.name || '').toLowerCase());
  const missing = CODING_LANGUAGES.filter((language) => {
    const pattern = language === 'cpp' ? /^c\+\+/ : language === 'c' ? /^c\s*(\/|\()/ : new RegExp(`^${language}`);
    return !names.some((name) => pattern.test(name));
  });
  if (input.urlConfigured && !input.error && missing.length > 0) {
    problems.push(
      `The runner has no compiler installed for: ${missing.join(', ')}. A coding question that offers them cannot be scored; install them on the Judge0 instance or restrict the question to the languages it has.`,
    );
  }
  if (input.languages.length > 0) notes.push(`${input.languages.length} languages advertised by the runner.`);

  return { ready: problems.length === 0, problems, notes };
}

/**
 * Superadmin-only probe. Cost: 0 Firestore reads, 0 writes, 1 HTTP call.
 */
export const checkCodeRunnerSetup = onCall(
  {
    region: 'asia-south1',
    memory: '256MiB',
    timeoutSeconds: 30,
    minInstances: 0,
    maxInstances: 5,
    secrets: [JUDGE0_API_KEY],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required');
    const staff = await resolveStaff(uid, request.auth?.token || {});
    if (staff.role !== 'superadmin') {
      throw new HttpsError('permission-denied', 'Only a superadmin can check the runner setup.');
    }

    // Presence only — never the value, and never in the response.
    let keyPresent = false;
    try {
      keyPresent = JUDGE0_API_KEY.value().trim().length > 0;
    } catch {
      keyPresent = false;
    }

    const rawUrl = String(process.env.JUDGE0_API_URL || '').trim();
    const keyHeader = String(process.env.JUDGE0_API_KEY_HEADER || 'X-Auth-Token').trim();
    const rapidApiHost = String(process.env.JUDGE0_API_HOST || '').trim();

    let url = '';
    let languages: Array<{ id?: number | string; name?: string }> = [];
    let error = '';
    let latencyMs: number | undefined;
    if (rawUrl) {
      try {
        url = judge0BaseUrl();
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.message : 'The configured URL is invalid.';
      }
      if (!error) {
        const startedAt = Date.now();
        try {
          languages = await listJudge0Languages(url);
          latencyMs = Date.now() - startedAt;
        } catch (thrown) {
          error = thrown instanceof Error ? thrown.message : 'The runner did not answer.';
        }
      }
    }

    const report = describeRunnerSetup({
      urlConfigured: Boolean(rawUrl),
      url,
      keyPresent,
      keyHeader,
      languages,
      ...(error ? { error } : {}),
      ...(latencyMs === undefined ? {} : { latencyMs }),
    });
    if (rapidApiHost) report.notes.push(`Gateway host header set to ${rapidApiHost}.`);
    if (!report.ready) {
      logger.warn('[CodeRunnerPreflight] Runner not ready', { problems: report.problems });
    }
    return {
      ...report,
      keyPresent,
      keyHeader,
      languageCount: languages.length,
      // The runner's own language names, so a mismatched install is obvious.
      languages: languages.map((language) => String(language.name || '')).filter(Boolean).slice(0, 50),
      checkedAt: new Date().toISOString(),
    };
  },
);
