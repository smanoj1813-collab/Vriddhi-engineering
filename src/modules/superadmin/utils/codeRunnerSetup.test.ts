import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  runnerSetupErrorMessage,
  runnerSetupHeadline,
  runnerSetupSeverity,
} from './codeRunnerSetup';

test('a ready runner is a success and says it can score', () => {
  const report = { ready: true, problems: [] };
  assert.equal(runnerSetupSeverity(report), 'success');
  assert.match(runnerSetupHeadline(report), /connected and can score/);
});

test('a runner with problems is an error and counts them in the headline', () => {
  const one = { ready: false, problems: ['JUDGE0_API_URL is not set.'] };
  assert.equal(runnerSetupSeverity(one), 'error');
  assert.equal(runnerSetupHeadline(one), 'The code compiler is not ready: 1 thing to fix.');
  const two = { ready: false, problems: ['a', 'b'] };
  assert.equal(runnerSetupHeadline(two), 'The code compiler is not ready: 2 things to fix.');
});

test('never reports ready while the server says it is not', () => {
  // An inconsistent response must not look green.
  const report = { ready: false, problems: [] };
  assert.equal(runnerSetupSeverity(report), 'warning');
  assert.notEqual(runnerSetupHeadline(report), 'The code compiler is connected and can score coding questions.');
});

test('permission and sign-in failures are said in plain words', () => {
  assert.equal(
    runnerSetupErrorMessage(new Error('permission-denied: Only a superadmin can check the runner setup.')),
    'Only a superadmin can check the code compiler.',
  );
  assert.equal(runnerSetupErrorMessage(new Error('unauthenticated')), 'Sign in again, then check the code compiler.');
  assert.equal(runnerSetupErrorMessage('boom'), 'Could not check the code compiler. Try again in a minute.');
});
