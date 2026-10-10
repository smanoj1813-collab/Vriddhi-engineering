// =============================================================================
// 🔧 VRIDDHI DEBUG TOOLKIT v2 — Fixed for barrel re-exports & empty JSON
// =============================================================================
// Save as: debug.mjs  (overwrite the old one)
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

info('Checking total TypeScript errors...');
const tsResult = run('npx tsc --noEmit 2>&1', true);
const errorCount = tsResult.output.split('\n').filter(l => l.includes('error TS')).length;
if (errorCount === 0) ok('No TypeScript errors found');
else fail(`${errorCount} TypeScript errors found — run "npx tsc --noEmit" to see them`);

info('Checking if vite builds...');
const buildResult = run('npx vite build 2>&1', true);
if (buildResult.success && buildResult.output.includes('built')) ok('Vite build: SUCCESS');
else { fail('Vite build: FAILED'); console.log(buildResult.output.slice(-500)); }

// =============================================================================
// SECTION 1: AUTH MODULE (FIXED for barrel re-exports)
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
const useAuthContent = fs.readFileSync('src/modules/auth/hooks/useAuth.ts', 'utf-8');
const isBarrel = useAuthContent.includes("export { useAuth }") || useAuthContent.includes("export * from");
const hasHookLogic = grepFile('src/modules/auth/context/AuthContext.tsx', 'useContext|throw|return').length >= 3;

if (isBarrel && hasHookLogic) {
  ok('useAuth.ts: Barrel re-export (hook defined in AuthContext.tsx) ✓');
  ok('AuthContext.tsx: Has useContext + throw + return logic ✓');
} else if (!isBarrel && grepFile('src/modules/auth/hooks/useAuth.ts', 'useContext|throw|return').length >= 3) {
  ok('useAuth.ts: Has useContext + throw + return ✓');
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
log('SECTION 9: FIREBASE CONFIG');

const firebaseFiles = [
  { path: 'src/firebase.json', label: 'firebase.json' },
  { path: 'src/firestore.indexes.json', label: 'firestore.indexes.json' },
  { path: 'src/cors.json', label: 'cors.json' },
  { path: 'src/.firebaserc', label: '.firebaserc' },
];

for (const { path: f, label } of firebaseFiles) {
  if (fileExists(f)) {
    const content = fs.readFileSync(f, 'utf-8').trim();
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
// SECTION 3: FEATURE AUDIT — What's Wired vs Stubbed
// =============================================================================
log('SECTION 3: FEATURE AUDIT — Wired vs Stubbed');

function countOccurrences(dir, pattern, label) {
  let count = 0;
  function scan(d) {
    if (!fs.existsSync(d)) return;
    const items = fs.readdirSync(d);
    for (const item of items) {
      const fullPath = path.join(d, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory() && item !== 'node_modules' && item !== 'dist') scan(fullPath);
      else if ((item.endsWith('.ts') || item.endsWith('.tsx')) && !item.endsWith('.d.ts')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const matches = content.match(pattern) || [];
        count += matches.length;
      }
    }
  }
  scan(dir);
  return count;
}

const todoCount = countOccurrences('src', /TODO|FIXME|HACK|XXX/g, 'TODOs');
const anyCount = countOccurrences('src', /:\s*any\s*[^a-zA-Z]/g, 'any types');
const consoleCount = countOccurrences('src', /console\.log\(/g, 'console.logs');

info(`TODO/FIXME comments: ${todoCount}`);
info(`"any" type usages: ${anyCount}`);
info(`console.log statements: ${consoleCount}`);

// Check specific stub patterns
const stubPatterns = [
  { pattern: /mock|dummy|fake|stub/gi, label: 'Mock/Dummy data', severity: 'warn' },
  { pattern: /TODO.*Wire|TODO.*API|TODO.*Firestore/gi, label: 'Unwired API calls', severity: 'fail' },
  { pattern: /setTimeout.*mock|setInterval.*demo/gi, label: 'Demo timeouts', severity: 'warn' },
  { pattern: /hardcoded|HARDCODED/g, label: 'Hardcoded values', severity: 'warn' },
];

for (const { pattern, label, severity } of stubPatterns) {
  const count = countOccurrences('src', pattern, label);
  if (count > 0) {
    if (severity === 'fail') fail(`${label}: ${count} found`);
    else warn(`${label}: ${count} found`);
  } else {
    ok(`${label}: None found`);
  }
}

// =============================================================================
// SECTION 4: MODULE COMPLETENESS SCORE
// =============================================================================
log('SECTION 4: MODULE COMPLETENESS');

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

const authScore = checkModule('Auth', authFiles);

const superadminFiles = [
  'src/modules/superadmin/types/superAdmin.ts',
  'src/modules/superadmin/types/university.ts',
  'src/modules/superadmin/api/superAdminApi.ts',
  'src/modules/superadmin/api/universityApi.ts',
  'src/modules/superadmin/hooks/useSuperAdmin.ts',
  'src/modules/superadmin/pages/SuperAdminDashboard.tsx',
  'src/modules/superadmin/routes.tsx',
];
const saScore = checkModule('SuperAdmin', superadminFiles);

const adminFiles = [
  'src/modules/admin/types/index.ts',
  'src/modules/admin/api/dashboardApi.ts',
  'src/modules/admin/api/questionBankApi.ts',
  'src/modules/admin/hooks/useAdminDashboard.ts',
  'src/modules/admin/hooks/useQuestionBank.ts',
  'src/modules/admin/pages/AdminDashboard.tsx',
  'src/modules/admin/pages/QuestionBank.tsx',
  'src/modules/admin/routes.tsx',
];
const adminScore = checkModule('Admin', adminFiles);

const facultyFiles = [
  'src/modules/faculty/types/index.ts',
  'src/modules/faculty/api/facultyApi.ts',
  'src/modules/faculty/hooks/useFacultyData.ts',
  'src/modules/faculty/pages/FacultyDashboard.tsx',
  'src/modules/faculty/routes.tsx',
];
const facultyScore = checkModule('Faculty', facultyFiles);

const studentFiles = [
  'src/modules/student/types/student.ts',
  'src/modules/student/hooks/useStudentData.ts',
  'src/modules/student/pages/StudentDashboard.tsx',
  'src/modules/student/routes.tsx',
];
const studentScore = checkModule('Student', studentFiles);

// =============================================================================
// FINAL SUMMARY
// =============================================================================
log('FINAL SUMMARY', GREEN);

const overall = Math.round((authScore + saScore + adminScore + facultyScore + studentScore) / 5);
console.log(`${BOLD}Overall Project Completeness: ${overall}%${RESET}`);
console.log(`\n${CYAN}Files checked: 95+${RESET}`);
console.log(`${GREEN}TypeScript errors: ${errorCount}${RESET}`);
console.log(`${YELLOW}TODOs to wire: ${todoCount}${RESET}`);

info('\nNext steps:');
if (!fileExists('src/firestore.indexes.json') || !fs.readFileSync('src/firestore.indexes.json', 'utf-8').trim()) {
  console.log(`${RED}   → FIX: firestore.indexes.json is empty. Replace with valid JSON.${RESET}`);
}
if (todoCount > 50) {
  console.log(`${YELLOW}   → ${todoCount} TODOs found. Many features use mock data, not real APIs.${RESET}`);
}
console.log(`${CYAN}   → Share specific page files here for deep debugging${RESET}`);

// =============================================================================
// END
// =============================================================================