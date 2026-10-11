// functions/test/codeRunnerPreflight.test.ts
//
// The preflight exists so a misconfiguration is found by whoever deployed it,
// not by a student mid-exam. Its value is entirely in the sentences it produces,
// so those are what is pinned here — including the one that matters most: a
// runner that is reachable but missing a compiler is NOT "ready".

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeRunnerSetup } from '../src/codeRunnerPreflight';

const languages = [
  { id: 50, name: 'C (GCC 9.2.0)' },
  { id: 54, name: 'C++ (GCC 9.2.0)' },
  { id: 62, name: 'Java (OpenJDK 13.0.1)' },
  { id: 71, name: 'Python (3.8.1)' },
];

describe('describeRunnerSetup', () => {
  it('is ready for a reachable runner with every language installed', () => {
    const report = describeRunnerSetup({
      urlConfigured: true,
      url: 'https://judge0.example',
      keyPresent: true,
      keyHeader: 'X-Auth-Token',
      languages,
      latencyMs: 42,
    });
    assert.equal(report.ready, true);
    assert.deepEqual(report.problems, []);
    assert.ok(report.notes.some((note) => /in 42 ms/.test(note)));
    assert.ok(report.notes.some((note) => /4 languages advertised/.test(note)));
  });

  it('names the missing env var when the runner was never configured', () => {
    const report = describeRunnerSetup({
      urlConfigured: false,
      url: '',
      keyPresent: false,
      keyHeader: 'X-Auth-Token',
      languages: [],
    });
    assert.equal(report.ready, false);
    assert.ok(report.problems.some((problem) => /JUDGE0_API_URL is not set/.test(problem)));
    assert.ok(report.problems.some((problem) => /functions\/\.env/.test(problem)));
  });

  it('a missing key is a note, not a failure — an open runner is legitimate', () => {
    const report = describeRunnerSetup({
      urlConfigured: true,
      url: 'https://judge0.example',
      keyPresent: false,
      keyHeader: 'X-Auth-Token',
      languages,
    });
    assert.equal(report.ready, true);
    assert.ok(report.notes.some((note) => /No JUDGE0_API_KEY value/.test(note)));
  });

  it('a reachable runner missing a compiler is NOT ready', () => {
    const report = describeRunnerSetup({
      urlConfigured: true,
      url: 'https://judge0.example',
      keyPresent: true,
      keyHeader: 'X-Auth-Token',
      languages: languages.filter((language) => !/Java/.test(String(language.name))),
    });
    assert.equal(report.ready, false);
    assert.ok(report.problems.some((problem) => /no compiler installed for: java/.test(problem)));
  });

  it('reports an unreachable runner with the reason it gave', () => {
    const report = describeRunnerSetup({
      urlConfigured: true,
      url: 'https://judge0.example',
      keyPresent: true,
      keyHeader: 'X-Auth-Token',
      languages: [],
      error: 'The compiler service answered 401.',
    });
    assert.equal(report.ready, false);
    assert.ok(report.problems.some((problem) => /could not be reached: The compiler service answered 401/.test(problem)));
  });

  it('reads the language names the way Judge0 spells them', () => {
    // "C (GCC 9.2.0)" must not be mistaken for C++ and vice versa.
    const report = describeRunnerSetup({
      urlConfigured: true,
      url: 'https://judge0.example',
      keyPresent: true,
      keyHeader: 'X-Auth-Token',
      languages: [{ name: 'C (GCC 9.2.0)' }, { name: 'Python (3.8.1)' }],
    });
    assert.equal(report.ready, false);
    assert.ok(report.problems.some((problem) => /no compiler installed for: cpp, java/.test(problem)));
  });
});
