// src/modules/superadmin/services/codeRunnerSetupApi.ts
//
// Superadmin-only wrapper over the `checkCodeRunnerSetup` callable. It reads and
// writes nothing in Firestore; it makes one request to the configured runner.

import { httpsCallable } from 'firebase/functions';
import { functions } from '@/Firebase/config';
import type { CodeRunnerSetupReport } from '@/modules/superadmin/utils/codeRunnerSetup';

export async function checkCodeRunnerSetup(): Promise<CodeRunnerSetupReport> {
  const call = httpsCallable<Record<string, never>, CodeRunnerSetupReport>(functions, 'checkCodeRunnerSetup');
  const result = await call({});
  return result.data;
}
