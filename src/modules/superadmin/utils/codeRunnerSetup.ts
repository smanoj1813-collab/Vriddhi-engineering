// src/modules/superadmin/utils/codeRunnerSetup.ts
//
// Pure presentation rules for the superadmin "Check code compiler" result. The
// server decides `ready`, `problems` and `notes`; this only chooses how to show
// them, so the wording stays in one tested place.

export interface CodeRunnerSetupReport {
  ready: boolean;
  problems: string[];
  notes: string[];
  keyPresent: boolean;
  keyHeader: string;
  languageCount: number;
  languages: string[];
  checkedAt: string;
}

export type RunnerSetupSeverity = 'success' | 'warning' | 'error';

export function runnerSetupSeverity(report: Pick<CodeRunnerSetupReport, 'ready' | 'problems'>): RunnerSetupSeverity {
  if (report.ready) return 'success';
  return report.problems.length > 0 ? 'error' : 'warning';
}

/** One line for the top of the result. Never claims ready when there are problems. */
export function runnerSetupHeadline(report: Pick<CodeRunnerSetupReport, 'ready' | 'problems'>): string {
  if (report.ready) return 'The code compiler is connected and can score coding questions.';
  if (report.problems.length > 0) {
    return `The code compiler is not ready: ${report.problems.length} thing${report.problems.length === 1 ? '' : 's'} to fix.`;
  }
  return 'The code compiler needs attention.';
}

/** Turns the callable's error text into something a superadmin can act on. */
export function runnerSetupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/permission|superadmin/i.test(message)) {
    return 'Only a superadmin can check the code compiler.';
  }
  if (/unauthenticated|sign in/i.test(message)) {
    return 'Sign in again, then check the code compiler.';
  }
  return message || 'Could not check the code compiler. Try again in a minute.';
}
