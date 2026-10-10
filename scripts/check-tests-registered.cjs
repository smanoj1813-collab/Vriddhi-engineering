// Guard: every *.test file must be registered in its package's `test:unit`
// script (or be an explicitly excluded emulator suite). Runs as the first step
// of both `test:unit` scripts, so an orphaned test file fails the suite
// instead of silently never executing (audit P1-2).
//
// Usage: node scripts/check-tests-registered.cjs [root|functions|both]

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TEST_EXT = /\.(test)\.(ts|tsx|mjs|cjs|js)$/;

const PACKAGES = {
  root: {
    packageJson: path.join(ROOT, 'package.json'),
    scanDirs: [path.join(ROOT, 'src'), path.join(ROOT, 'scripts')],
    // No exclusions: every root test file runs in the unit suite.
    excluded: new Set(),
  },
  functions: {
    packageJson: path.join(ROOT, 'functions', 'package.json'),
    scanDirs: [path.join(ROOT, 'functions', 'test')],
    // Emulator-driven, runs under `test:rules`, not the unit suite.
    excluded: new Set(['functions/test/firestore.rules.test.ts']),
  },
};

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (TEST_EXT.test(entry.name)) {
      out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

function checkOne(name) {
  const pkg = PACKAGES[name];
  const script = JSON.parse(fs.readFileSync(pkg.packageJson, 'utf8')).scripts?.['test:unit'] ?? '';
  const failures = [];
  const existing = new Set();
  for (const dir of pkg.scanDirs) {
    if (fs.existsSync(dir)) for (const file of walk(dir, [])) existing.add(file);
  }
  for (const file of [...existing].sort()) {
    if (pkg.excluded.has(file)) continue;
    // Functions lists paths relative to functions/ (test/x.test.ts); root
    // lists repo-relative paths (src/..., scripts/...). Accept either form.
    const local = file.replace(/^functions\//, '');
    if (!script.includes(file) && !script.includes(local)) {
      failures.push(`ORPHAN  ${file} — exists on disk but is not in ${name} test:unit`);
    }
  }
  // Stale entries: anything the script names that is not on disk (typo guard).
  const listed = script.match(/(?:^|[\s"'])([\w./-]+\.test\.(?:ts|tsx|mjs|cjs|js))/g) ?? [];
  for (const raw of listed) {
    const file = raw.trim().replace(/^["']/, '');
    const norm = file.startsWith('./') ? file.slice(2) : file;
    const abs = path.join(ROOT, name === 'functions' ? 'functions' : '', norm);
    if (!fs.existsSync(abs) && !pkg.excluded.has(norm) && !pkg.excluded.has(`functions/${norm}`)) {
      failures.push(`MISSING ${file} — listed in ${name} test:unit but not on disk`);
    }
  }
  // Excluded files must still exist and must be claimed by another script.
  for (const file of pkg.excluded) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      failures.push(`STALE-EXCLUSION ${file} — exclusion no longer matches a file`);
    }
  }
  return failures;
}

const target = process.argv[2] ?? 'both';
const names = target === 'both' ? ['root', 'functions'] : [target];
if (!names.every((n) => PACKAGES[n])) {
  console.error(`usage: node scripts/check-tests-registered.cjs [root|functions|both]`);
  process.exit(2);
}
let failures = [];
for (const name of names) failures = failures.concat(checkOne(name));
if (failures.length > 0) {
  console.error('check-tests-registered: FAIL');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`check-tests-registered: ok (${names.join(', ')})`);
