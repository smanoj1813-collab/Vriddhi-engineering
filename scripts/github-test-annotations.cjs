#!/usr/bin/env node
/**
 * Turns a saved `node --test` log into GitHub Actions annotations.
 *
 * Why this exists: the rules suite runs inside the Firebase emulators on a
 * GitHub runner. When it fails, the useful lines — failing test names, the
 * assertion that broke, the counts — live in the job log, which is served
 * from a host that sandboxed/automated reviewers cannot reach. Annotations
 * ride on the check run itself (readable through api.github.com) and show up
 * inline on the failed run page, so nobody has to fight the log viewer.
 *
 * Supports both reporters Node picks automatically:
 *   - TAP  (stdout is not a TTY — what CI writes once the suite is tee'd)
 *   - spec (stdout is a TTY — what a developer sees locally)
 *
 * Usage (inside a workflow step, after the suite ran with `| tee`):
 *   node scripts/github-test-annotations.cjs <log-file>
 *
 * Emits:
 *   - one error annotation per failing test (name + assertion), capped
 *   - one error annotation listing every failing test name
 *   - one notice annotation with the suite counts
 *
 * Never fails the step: if the log is missing or unrecognised it says so in a
 * notice, because the suite's own exit code is the real signal.
 */
const fs = require('fs');

const MAX_MESSAGE = 60000; // GitHub rejects annotations larger than 64KB.
const MAX_DETAILED_FAILURES = 8; // Runner caps error annotations per step.
const MAX_FAILED_NAMES = 40;
const MAX_DETAIL_CHARS = 4000;
const MAX_BLOCK_LINES = 400;

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

const indentOf = (line) => line.length - line.trimStart().length;

// ---------------------------------------------------------------------------
// TAP reporter
// ---------------------------------------------------------------------------
// Shape of one failure (indentation is what makes the block boundaries
// unambiguous, so it is preserved rather than trimmed):
//
//   # Subtest: staff (faculty) attendance
//       not ok 1 - lets a faculty member read only their own day
//         ---
//         duration_ms: 34.1
//         type: 'test'
//         failureType: 'testCodeFailure'
//         error: |-
//           AssertionError [ERR_ASSERTION]: false == true
//           at ...
//         code: 'ERR_ASSERTION'
//         ...
//
// Suites roll up their children's failures (`not ok N - <suite name>` with
// `type: 'suite'`); those are skipped so each broken test is reported once.
function readYamlBlock(lines, notOkIndex, notOkIndent) {
  const block = { keys: {}, error: null, kind: null };
  let i = notOkIndex + 1;
  const limit = Math.min(lines.length, notOkIndex + MAX_BLOCK_LINES);

  // Walk to the opening `---` of this subtest's diagnostic block.
  while (i < limit && lines[i].trim() !== '---') i += 1;
  if (i >= limit) return block;
  const baseIndent = indentOf(lines[i]);
  i += 1;

  let errorIndent = -1;
  for (; i < limit; i += 1) {
    const line = lines[i];
    if (line.trim() === '---' && indentOf(line) === baseIndent) break; // next subtest
    if (line.trim() === '...' && indentOf(line) <= baseIndent) break; // end of block
    if (errorIndent >= 0) {
      if (line.trim() === '' || indentOf(line) >= errorIndent) {
        block.errorLines.push(line.slice(errorIndent));
        continue;
      }
      errorIndent = -1;
    }
    const key = line.match(/^\s*([A-Za-z_]+):\s?(.*)$/);
    if (!key || indentOf(line) < baseIndent) continue;
    const [, name, value] = key;
    if (value === '|-' || value === '|' || value === '>') {
      if (name === 'error') {
        errorIndent = indentOf(line) + 2;
        block.errorLines = [];
      }
      continue;
    }
    block.keys[name] = value.replace(/^'(.*)'$/, '$1');
  }
  if (block.errorLines && block.errorLines.length > 0) {
    block.error = block.errorLines.join('\n').trimEnd();
  }
  block.kind = block.keys.type || null;
  return block;
}

function collectTapFailures(lines) {
  const failures = [];
  const suiteStack = []; // { indent, name }
  let tapSummarySeen = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const subtest = line.match(/^(\s*)#\s*Subtest:\s*(.+?)\s*$/);
    if (subtest) {
      const indent = subtest[1].length;
      while (suiteStack.length > 0 && suiteStack[suiteStack.length - 1].indent >= indent) suiteStack.pop();
      suiteStack.push({ indent, name: subtest[2] });
      continue;
    }

    const notOk = line.match(/^(\s*)not ok\s+(\d+)\s+-\s+(.+?)\s*$/);
    if (notOk) {
      const indent = notOk[1].length;
      // The `# Subtest:` line for this entry is the innermost stack frame;
      // everything above it is the suite path.
      const path = suiteStack
        .filter((frame) => frame.indent < indent)
        .map((frame) => frame.name);
      const block = readYamlBlock(lines, i, indent);
      if (block.kind === 'suite') continue;
      failures.push({ name: notOk[3], path, block });
      continue;
    }

    if (/^#\s+(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s/.test(line)) {
      tapSummarySeen = true;
    }
  }

  return { failures, reporter: tapSummarySeen ? 'tap' : null };
}

// ---------------------------------------------------------------------------
// spec reporter (local runs)
// ---------------------------------------------------------------------------
function collectSpecFailures(lines) {
  const failures = [];
  const namePattern = /^\s*(?:✖|not ok)\s+(?!failing tests:)(.+?)(?:\s+\(\d+(?:\.\d+)?(?:ms|s)\))?\s*$/;
  const summaryStart = lines.findIndex((line) => /^\s*(✖|not ok)\s+failing tests:/.test(line));
  const from = summaryStart >= 0 ? summaryStart : 0;

  for (let i = from; i < lines.length; i += 1) {
    const match = lines[i].match(namePattern);
    if (!match) continue;
    const detail = lines.slice(i + 1, i + 20).filter((line) => line.trim() !== '');
    failures.push({
      name: match[1].trim(),
      path: [],
      block: { keys: {}, kind: 'test', error: detail.slice(1).join('\n').trimEnd() },
    });
  }
  return { failures, reporter: failures.length > 0 ? 'spec' : null };
}

const tap = collectTapFailures(lines);
const spec = tap.reporter ? { failures: [], reporter: null } : collectSpecFailures(lines);
const failures = tap.reporter ? tap.failures : spec.failures;
const reporter = tap.reporter || spec.reporter;

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------
function describeFailure(failure) {
  const { block } = failure;
  const bits = [];
  const where = failure.path.length > 0 ? `${failure.path.join(' › ')} › ${failure.name}` : failure.name;
  bits.push(`**${where}**`);
  if (block.kind === 'test') bits.push('type: test');
  if (block.error) bits.push(block.error);
  else if (block.keys.failureType || block.keys.code) {
    bits.push([block.keys.failureType, block.keys.code].filter(Boolean).join(' / '));
  }
  if (block.keys.expected !== undefined || block.keys.actual !== undefined) {
    bits.push(`expected: ${block.keys.expected}\nactual:   ${block.keys.actual}`);
  }
  return bits.join('\n').slice(0, MAX_DETAIL_CHARS);
}

if (failures.length === 0 && reporter) {
  annotate('notice', 'rules suite', 'No failing tests were found in the log — the failure happened before the suite reported.');
}

if (failures.length > 0) {
  for (const failure of failures.slice(0, MAX_DETAILED_FAILURES)) {
    annotate('error', 'rules suite failure', describeFailure(failure));
  }

  const names = [...new Set(failures.map((f) => (f.path.length > 0 ? `${f.path.join(' › ')} › ${f.name}` : f.name)))];
  const capped = names.slice(0, MAX_FAILED_NAMES);
  if (names.length > capped.length) capped.push(`… and ${names.length - capped.length} more (see the rules-suite artifact)`);
  annotate('error', `rules suite failing tests (${failures.length})`, capped.map((name) => `- ${name}`).join('\n'));
}

const summaryLines = lines.filter((line) =>
  /^(ℹ|#)\s+(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s/.test(line)
);
if (summaryLines.length > 0) {
  annotate('notice', 'rules suite summary', summaryLines.join('\n'));
}
if (!reporter) {
  annotate(
    'notice',
    'rules suite reporter unrecognised',
    `Could not parse ${logPath} as node --test TAP or spec output; showing the last lines of the log instead.\n\n` +
      lines.filter((line) => line.trim() !== '').slice(-40).join('\n')
  );
}
