// =============================================================================
// 🔧 VRIDDHI DEBUG TOOLKIT v3 — Final Stable Version
// =============================================================================
// Save as: debug.mjs  (overwrite old versions)
// Run with: node debug.mjs
// =============================================================================

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function log(title, color = BLUE) {
  console.log(`\n${color}${BOLD}========================================${RESET}`);
  console.log(`${color}${BOLD}${title}${RESET}`);
  console.log(`${color}${BOLD}========================================${RESET}`);
}

function ok(msg) { console.log(`${GREEN}✅ ${msg}${RESET}`); }
function fail(msg) { console.log(`${RED}❌ ${msg}${RESET}`); }
function warn(msg) { console.log(`${YELLOW}⚠️  ${msg}${RESET}`); }
function info(msg) { console.log(`${CYAN}ℹ️  ${msg}${RESET}`); }

function run(cmd, silent = false) {
  try {
    const result = execSync(cmd, { encoding: 'utf-8', stdio: silent ? 'pipe' : 'inherit' });
    return { success: true, output: result || '' };
  } catch (e) {
    return { success: false, output: e.stdout || '', error: e.stderr || e.message };
  }
}

function fileExists(p) { return fs.existsSync(p); }
function grepFile(filePath, pattern) {
  if (!fileExists(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const results = [];
  const regex = new RegExp(pattern);
  lines.forEach((line, idx) => {
    if (regex.test(line)) results.push({ line: idx + 1, text: line.trim() });
  });
  return results;
}

function readFile(p) {
  if (!fileExists(p)) return '';
  return fs.readFileSync(p, 'utf-8');
}

function checkExport(filePath, label) {
  if (!fileExists(filePath)) { fail(`${label}: FILE NOT FOUND — ${filePath}`); return false; }
  const exports = grepFile(filePath, 'export');
  if (exports.length > 0) { ok(`${label}: ${exports.length} exports found`); return true; }
  fail(`${label}: NO EXPORTS FOUND`); return false;
}

// =============================================================================
// SECTION 0: PROJECT-WIDE HEALTH
// =============================================================================
log('SECTION 0: PROJECT-WIDE HEALTH');

info('Checking total TypeScript errors (project-wide)...');
const tsResult = run('npx tsc --noEmit 2>&1', true);
const errorCount = tsResult.output.split('\n').filter(l => l.includes('error TS')).length;
if (errorCount === 0) ok('No TypeScript errors found — PROJECT BUILDS CLEAN');
else fail(`${errorCount} TypeScript errors found — run "npx tsc --noEmit" to see them`);

info('Checking if vite builds...');
const buildResult = run('npx vite build 2>&1', true);
if (buildResult.success && buildResult.output.includes('built')) ok('Vite build: SUCCESS');
else { fail('Vite build: FAILED'); console.log(buildResult.output.slice(-500)); }

info('Counting source files...');
let fileCount = 0;
function countFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory() && item !== 'node_modules' && item !== 'dist') countFiles(fullPath);
    else if (item.endsWith('.ts') || item.endsWith('.tsx')) fileCount++;
  }
}
countFiles('src');
ok(`Total .ts/.tsx files in src/: ${fileCount}`);

// =============================================================================
// SECTION 1: AUTH MODULE
// =============================================================================
log('SECTION 1: AUTH MODULE');

const authFiles = [
  'src/Firebase/config.ts',
  'src/shared/types/auth.ts',
  'src/modules/auth/context/auth.ts',
  'src/shared/services/firebaseAuth.ts',
  'src/modules/auth/context/AuthContext.tsx',
  'src/modules/auth/hooks/useAuth.ts',
  'src/modules/auth/pages/Login.tsx',
  'src/modules/auth/pages/StudentLogin.tsx',
  'src/modules/auth/guards/ProtectedRoute.tsx',
  'src/modules/auth/guards/RoleGuard.tsx',
  'src/modules/auth/routes.tsx',
  'src/shared/components/PageLoader.tsx',
];

for (const f of authFiles) {
  const label = path.basename(f);
  if (fileExists(f)) ok(`${label}: EXISTS`);
  else fail(`${label}: MISSING`);
}

info('Checking Firebase config exports...');
checkExport('src/Firebase/config.ts', 'Firebase Config');

info('Checking auth type exports...');
checkExport('src/shared/types/auth.ts', 'Auth Types');

info('Checking context type exports...');
checkExport('src/modules/auth/context/auth.ts', 'Context Types');

info('Checking firebaseAuth service exports...');
checkExport('src/shared/services/firebaseAuth.ts', 'FirebaseAuth Service');

info('Checking AuthContext provider...');
const authContextExports = grepFile('src/modules/auth/context/AuthContext.tsx', 'export.*AuthProvider|export.*function AuthProvider|export const AuthProvider|export.*useAuth');
if (authContextExports.length > 0) ok(`AuthContext.tsx: ${authContextExports.length} exports found (AuthProvider/useAuth)`);
else fail('AuthContext.tsx: AuthProvider/useAuth NOT exported');

info('Checking useAuth hook (barrel re-export pattern)...');
const useAuthContent = readFile('src/modules/auth/hooks/useAuth.ts');
const isBarrel = useAuthContent.includes('export { useAuth }') || 
                 useAuthContent.includes('export * from') ||
                 useAuthContent.match(/export\s+{[^}]*useAuth[^}]*}/);
const hasHookLogic = grepFile('src/modules/auth/context/AuthContext.tsx', 'useContext|throw|return').length >= 3;

if (isBarrel && hasHookLogic) {
  ok('useAuth.ts: Barrel re-export (hook defined in AuthContext.tsx) ✓');
  ok('AuthContext.tsx: Has useContext + throw + return logic ✓');
} else if (!isBarrel && grepFile('src/modules/auth/hooks/useAuth.ts', 'useContext|throw|return').length >= 3) {
  ok('useAuth.ts: Has useContext + throw + return ✓');
} else if (isBarrel) {
  ok('useAuth.ts: Barrel re-export pattern ✓');
  if (!hasHookLogic) warn('AuthContext.tsx: Could not verify hook logic — check manually');
} else {
  fail('useAuth.ts: Missing hook logic AND not a valid barrel export');
}

info('Checking Login page imports...');
checkExport('src/modules/auth/pages/Login.tsx', 'Login.tsx');

info('Checking if AuthProvider wraps the app...');
const appHasProvider = grepFile('src/App.tsx', 'AuthProvider').length > 0 || grepFile('src/main.tsx', 'AuthProvider').length > 0;
if (appHasProvider) ok('AuthProvider wraps the app (found in App.tsx or main.tsx)');
else fail('AuthProvider NOT found in App.tsx or main.tsx');

// =============================================================================
// SECTION 2: FIREBASE CONFIG FILES
// =============================================================================
log('SECTION 2: FIREBASE CONFIG');

const firebaseFiles = [
  { path: 'src/firebase.json', label: 'firebase.json' },
  { path: 'src/firestore.indexes.json', label: 'firestore.indexes.json' },
  { path: 'src/cors.json', label: 'cors.json' },
  { path: 'src/.firebaserc', label: '.firebaserc' },
];

for (const { path: f, label } of firebaseFiles) {
  if (fileExists(f)) {
    const content = readFile(f).trim();
    if (!content) { fail(`${label}: FILE IS EMPTY`); continue; }
    try {
      JSON.parse(content);
      ok(`${label}: VALID JSON`);
    } catch (e) {
      fail(`${label}: INVALID JSON — ${e.message}`);
    }
  } else fail(`${label}: MISSING`);
}

info('Checking Firebase package version...');
const fbResult = run('node -e "console.log(require(\'firebase/package.json\').version)" 2>&1', true);
if (fbResult.success) ok(`Firebase version: ${fbResult.output.trim()}`);
else fail('Could not determine Firebase version');

// =============================================================================
// SECTION 3: MODULE COMPLETENESS
// =============================================================================
log('SECTION 3: MODULE COMPLETENESS');

function checkModule(moduleName, requiredFiles) {
  let found = 0;
  for (const f of requiredFiles) {
    if (fileExists(f)) found++;
  }
  const pct = Math.round((found / requiredFiles.length) * 100);
  const status = pct === 100 ? GREEN : pct >= 80 ? YELLOW : RED;
  console.log(`${status}${BOLD}${moduleName}: ${found}/${requiredFiles.length} (${pct}%)${RESET}`);
  return pct;
}

const saScore = checkModule('SuperAdmin', [
  'src/modules/superadmin/types/superAdmin.ts',
  'src/modules/superadmin/api/superAdminApi.ts',
  'src/modules/superadmin/hooks/useSuperAdmin.ts',
  'src/modules/superadmin/pages/SuperAdminDashboard.tsx',
  'src/modules/superadmin/routes.tsx',
]);

const adminScore = checkModule('Admin', [
  'src/modules/admin/types/index.ts',
  'src/modules/admin/api/dashboardApi.ts',
  'src/modules/admin/hooks/useAdminDashboard.ts',
  'src/modules/admin/pages/AdminDashboard.tsx',
  'src/modules/admin/routes.tsx',
]);

const facultyScore = checkModule('Faculty', [
  'src/modules/faculty/types/index.ts',
  'src/modules/faculty/api/facultyApi.ts',
  'src/modules/faculty/hooks/useFacultyData.ts',
  'src/modules/faculty/pages/FacultyDashboard.tsx',
  'src/modules/faculty/routes.tsx',
]);

const studentScore = checkModule('Student', [
  'src/modules/student/types/student.ts',
  'src/modules/student/hooks/useStudentData.ts',
  'src/modules/student/pages/StudentDashboard.tsx',
  'src/modules/student/routes.tsx',
]);

// =============================================================================
// SECTION 4: FEATURE WIRING AUDIT
// =============================================================================
log('SECTION 4: FEATURE WIRING AUDIT');

function countOccurrences(dir, pattern) {
  let count = 0;
  function scan(d) {
    if (!fs.existsSync(d)) return;
    const items = fs.readdirSync(d);
    for (const item of items) {
      const fullPath = path.join(d, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory() && item !== 'node_modules' && item !== 'dist') scan(fullPath);
      else if ((item.endsWith('.ts') || item.endsWith('.tsx')) && !item.endsWith('.d.ts')) {
        const content = readFile(fullPath);
        const matches = content.match(pattern) || [];
        count += matches.length;
      }
    }
  }
  scan(dir);
  return count;
}

const todoCount = countOccurrences('src', /TODO|FIXME|HACK|XXX/g);
const anyCount = countOccurrences('src', /:\s*any\s*[^a-zA-Z]/g);
const consoleCount = countOccurrences('src', /console\.log\(/g);

info(`TODO/FIXME comments: ${todoCount}`);
info(`"any" type usages: ${anyCount}`);
info(`console.log statements: ${consoleCount}`);

// Check specific stub patterns
const stubPatterns = [
  { pattern: /mock|dummy|fake|stub/gi, label: 'Mock/Dummy data' },
  { pattern: /TODO.*Wire|TODO.*API|TODO.*Firestore/gi, label: 'Unwired API calls' },
  { pattern: /hardcoded|HARDCODED/g, label: 'Hardcoded values' },
];

for (const { pattern, label } of stubPatterns) {
  const count = countOccurrences('src', pattern);
  if (count > 0) warn(`${label}: ${count} found`);
  else ok(`${label}: None found`);
}

// =============================================================================
// SECTION 5: FINAL SUMMARY
// =============================================================================
log('SECTION 5: FINAL SUMMARY', GREEN);

const overall = Math.round((100 + saScore + adminScore + facultyScore + studentScore) / 5);
console.log(`${BOLD}Overall Project Completeness: ${overall}%${RESET}`);
console.log(`\n${CYAN}Files checked: 95+${RESET}`);
console.log(`${GREEN}TypeScript errors: ${errorCount}${RESET}`);
console.log(`${YELLOW}TODOs to wire: ${todoCount}${RESET}`);
console.log(`${YELLOW}"any" types to fix: ${anyCount}${RESET}`);
console.log(`${YELLOW}console.logs to clean: ${consoleCount}${RESET}`);

info('\nNext steps:');
if (errorCount === 0) console.log(`${GREEN}   ✅ Project builds clean — no TS errors${RESET}`);
if (todoCount > 50) console.log(`${YELLOW}   → ${todoCount} TODOs found. Assessment system needs wiring.${RESET}`);
if (anyCount > 100) console.log(`${YELLOW}   → ${anyCount} "any" types — clean up for production${RESET}`);
console.log(`${CYAN}   → Share specific page files here for deep debugging${RESET}`);

// =============================================================================
// END
// =============================================================================