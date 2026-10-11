#!/usr/bin/env node
/**
 * Turns a saved `node --test` (spec reporter) log into GitHub Actions
 * annotations.
 *
 * Why this exists: the rules suite runs inside the Firebase emulators on a
 * GitHub runner. When it fails, the useful lines — failing test names, the
 * assertion that broke, the counts — live in the job log, which is served
 * from a host that sandboxed/automated reviewers cannot reach. Annotations
 * ride on the check run itself (api.github.com) and stay readable by anyone
 * with repo access, and they show up inline on the failed run page.
 *
 * Usage (inside a workflow step, after the suite ran with `| tee`):
 *   node scripts/github-test-annotations.cjs <log-file>
 *
 * Emits:
 *   - one error annotation listing every failing test name (capped)
 *   - one error annotation with the tail of the failure detail section
 *   - one notice annotation with the `ℹ tests …` summary lines
 *
 * Never fails the step: if the log is missing or unrecognised it emits a
 * notice saying so, because the suite's own exit code is the real signal.
 */
const fs = require('fs');

const MAX_MESSAGE = 60000; // GitHub rejects annotations larger than 64KB.
const MAX_FAILED_NAMES = 40;
const MAX_DETAIL_LINES = 80;

const logPath = process.argv[2];
if (!logPath) {
  console.error('usage: node scripts/github-test-annotations.cjs <log-file>');
  process.exit(2);
}

// Strip ANSI colour codes: the log may be written by a TTY-aware reporter.
const raw = fs.existsSync(logPath)
  ? fs.readFileSync(logPath, 'utf8').replace(/\u001b\[[0-9;]*m/g, '')
  : '';
const lines = raw.split(/\r?\n/);

/**
 * GitHub workflow command escaping:
 * `%` -> `%25`, `\r` -> `%0D`, `\n` -> `%0A`.
 * Titles additionally treat `,` and `:` as separators, so keep them out.
 */
function escapeData(text) {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function annotate(kind, title, message) {
  if (!message) return;
  const text = message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}\n… (truncated)` : message;
  process.stdout.write(`::${kind} title=${title}::${escapeData(text)}\n`);
}

if (!raw) {
  annotate(
    'notice',
    'rules suite log unavailable',
    `${logPath} was not found or was empty, so no failure detail could be attached. ` +
      'Run the suite again with the log written to the repo root.'
  );
  process.exit(0);
}

// ---- Summary counts ------------------------------------------------------
const summaryLines = lines.filter((line) => /^ℹ\s+(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s/.test(line));

// ---- Failing test names --------------------------------------------------
// The spec reporter prints a "✖ failing tests:" section at the end, then one
// block per failure. Name lines inside that section look like "✖ name (1.2ms)".
// Outside it, failing tests also appear in the run listing ("✖ name"), so this
// collects from the summary section first and falls back to any ✖ lines.
const summaryStart = lines.findIndex((line) => /^\s*(✖|not ok)\s+failing tests:/.test(line));
const searchFrom = summaryStart >= 0 ? summaryStart : 0;
const namePattern = /^\s*(?:✖|not ok)\s+(?!failing tests:)(.+?)(?:\s+\(\d+(?:\.\d+)?(?:ms|s)\))?\s*$/;

const failedNames = [];
for (let i = searchFrom; i < lines.length; i += 1) {
  const match = lines[i].match(namePattern);
  if (match) failedNames.push(match[1].trim());
}
const uniqueNames = [...new Set(failedNames)];
if (uniqueNames.length > MAX_FAILED_NAMES) {
  uniqueNames.length = MAX_FAILED_NAMES;
  uniqueNames.push(`… and more (see the rules-suite artifact for the full log)`);
}

if (uniqueNames.length > 0) {
  annotate('error', 'rules suite failing tests', uniqueNames.map((name) => `- ${name}`).join('\n'));
}

// ---- Failure detail ------------------------------------------------------
// Prefer the reporter's failure report (from "failing tests:" onward); if the
// run never got that far, fall back to the last lines of the log, which carry
// emulator startup / compile errors.
let detail;
if (summaryStart >= 0) {
  detail = lines.slice(summaryStart).filter((line) => line.trim() !== '').slice(0, MAX_DETAIL_LINES).join('\n');
} else {
  const tail = lines.filter((line) => line.trim() !== '');
  detail = tail.slice(-MAX_DETAIL_LINES).join('\n');
}
if (detail.trim() === (summaryLines.join('\n').trim()) || detail.trim() === '') {
  detail = lines.filter((line) => line.trim() !== '').slice(-MAX_DETAIL_LINES).join('\n');
}
annotate('error', 'rules suite failure detail', detail);

if (summaryLines.length > 0) {
  annotate('notice', 'rules suite summary', summaryLines.join('\n'));
}
