import test from 'node:test'
import assert from 'node:assert/strict'
import { canAccessAdminPath, roleHasPermission } from './permissions'

test('HODs and department admins hold no finance access', () => {
  for (const role of ['hod', 'admin'] as const) {
    assert.equal(roleHasPermission(role, 'fees.manage'), false)
    assert.equal(canAccessAdminPath(role, '/admin/fee-management'), false)
    assert.equal(canAccessAdminPath(role, '/admin/finance-settings'), false)
    assert.equal(canAccessAdminPath(role, '/admin/guest-faculty-billing'), false)
    assert.equal(canAccessAdminPath(role, '/admin/payroll'), false)
    assert.equal(canAccessAdminPath(role, '/admin/challans'), false)
    // academic pages unchanged
    assert.equal(canAccessAdminPath(role, '/admin/attendance'), true)
    assert.equal(canAccessAdminPath(role, '/admin/hod-dashboard'), true)
  }
})

test('accounts: finance only, never academic or library management', () => {
  assert.equal(canAccessAdminPath('accounts', '/admin/fee-management'), true)
  assert.equal(canAccessAdminPath('accounts', '/admin/accounts'), true)
  assert.equal(canAccessAdminPath('accounts', '/admin/library-fines'), true)
  assert.equal(canAccessAdminPath('accounts', '/admin/vendor-bills'), true)
  assert.equal(canAccessAdminPath('accounts', '/admin/library'), false)
  assert.equal(canAccessAdminPath('accounts', '/admin/library/catalogue'), false)
  assert.equal(canAccessAdminPath('accounts', '/admin/attendance'), false)
  assert.equal(canAccessAdminPath('accounts', '/admin/dashboard'), false)
})

test('operations: library/inventory, shared fines, no finance', () => {
  assert.equal(canAccessAdminPath('operations', '/admin/library'), true)
  assert.equal(canAccessAdminPath('operations', '/admin/library/circulation'), true)
  assert.equal(canAccessAdminPath('operations', '/admin/library-fines'), true)
  assert.equal(canAccessAdminPath('operations', '/admin/inventory'), true)
  assert.equal(canAccessAdminPath('operations', '/admin/purchase-orders'), true)
  assert.equal(canAccessAdminPath('operations', '/admin/fee-management'), false)
  assert.equal(canAccessAdminPath('operations', '/admin/payroll'), false)
  assert.equal(canAccessAdminPath('operations', '/admin/vendor-bills'), false)
  assert.equal(canAccessAdminPath('operations', '/admin/students'), false)
})

test('payroll: accounts manages it and principal retains approval access', () => {
  assert.equal(canAccessAdminPath('principal', '/admin/payroll'), true)
  assert.equal(canAccessAdminPath('accounts', '/admin/payroll'), true)
  // Legacy access documents cannot grant payroll to academic or operations roles.
  assert.equal(canAccessAdminPath('hod', '/admin/payroll', { payrollRoles: ['hod'] }), false)
  assert.equal(canAccessAdminPath('operations', '/admin/payroll', { payrollRoles: ['operations'] }), false)
  assert.equal(roleHasPermission('accounts', 'payroll.manage'), true)
  assert.equal(roleHasPermission('accounts', 'payroll.approve'), false)
  assert.equal(roleHasPermission('principal', 'payroll.manage'), false)
  assert.equal(roleHasPermission('principal', 'payroll.approve'), true)
})

test('vriddhi employees get the academic surface only', () => {
  // Scheduling, curriculum, assessments, papers, grade records, reports.
  for (const p of [
    '/admin/class-schedule',
    '/admin/curriculum',
    '/admin/curriculum-progress',
    '/admin/academic-calendar',
    '/admin/assessments',
    '/admin/schedule-tests',
    '/admin/test-reports',
    '/admin/grade-records',
    '/admin/question-bank',
    '/admin/paper-generator',
    '/admin/papers/builder',
    '/admin/students',
    '/admin/attendance',
    '/admin/analytics',
  ]) {
    assert.equal(canAccessAdminPath('employee', p), true, p)
  }
  // Institution-only work is excluded even though it sits on the academic side
  // of the default /admin rule.
  for (const p of [
    '/admin/admissions',
    '/admin/settings',
    '/admin/onboarding',
    '/admin/exam-management',
    '/admin/uucms-integration',
    '/admin/bcu-compliance',
    '/admin/scheme-packs',
    '/admin/result-importer',
    '/admin/ai-agent',
  ]) {
    assert.equal(canAccessAdminPath('employee', p), false, p)
  }
  // Finance / office modules stay with their own roles.
  for (const p of ['/admin/fee-management', '/admin/payroll', '/admin/library', '/admin/inventory', '/admin/vendor-bills']) {
    assert.equal(canAccessAdminPath('employee', p), false, p)
  }
  assert.equal(roleHasPermission('employee', 'paper.manage'), true)
  assert.equal(roleHasPermission('employee', 'fees.manage'), false)
  assert.equal(roleHasPermission('employee', 'payroll.manage'), false)
  assert.equal(roleHasPermission('employee', 'users.manage'), false)
})

test('principal oversees everything; superadmin bypasses', () => {
  for (const p of ['/admin/fee-management', '/admin/library', '/admin/inventory', '/admin/dashboard'])
    assert.equal(canAccessAdminPath('principal', p), true, p)
  assert.equal(canAccessAdminPath('superadmin', '/admin/anything'), true)
  assert.equal(canAccessAdminPath(null, '/admin/dashboard'), false)
  assert.equal(canAccessAdminPath('faculty', '/admin/library'), false)
})

test('HODs may raise purchase requests', () => {
  assert.equal(canAccessAdminPath('hod', '/admin/purchase-requests'), true)
  assert.equal(canAccessAdminPath('faculty', '/admin/purchase-requests'), false)
})

test('principal no longer owns the university exam page', () => {
  assert.equal(canAccessAdminPath('principal', '/admin/exam-management'), false)
  assert.equal(canAccessAdminPath('principal', '/admin/exam-management/hall-tickets'), false)
  // The exam branch retains full control.
  assert.equal(canAccessAdminPath('admin', '/admin/exam-management'), true)
  assert.equal(canAccessAdminPath('hod', '/admin/exam-management'), true)
  assert.equal(canAccessAdminPath('superadmin', '/admin/exam-management'), true)
  // Institution-only work stays out of the employee workspace.
  assert.equal(canAccessAdminPath('employee', '/admin/exam-management'), false)
  assert.equal(canAccessAdminPath('faculty', '/admin/exam-management'), false)
  assert.equal(canAccessAdminPath('accounts', '/admin/exam-management'), false)
})

test('the principal keeps a read-only university-exam lane and everything else', () => {
  // Permissions: no write, still read.
  assert.equal(roleHasPermission('principal', 'universityExam.manage'), false)
  assert.equal(roleHasPermission('principal', 'universityExam.publish'), false)
  assert.equal(roleHasPermission('principal', 'universityExam.view'), true)
  // The change is scoped to that one route — academic oversight is untouched.
  // (Official Grade Records and the AI Question Generator left the principal's
  // sidebar too; they bounce at the route layer, not in this matrix.)
  for (const p of [
    '/admin/dashboard',
    '/admin/attendance',
    '/admin/analytics',
    '/admin/test-reports',
    '/admin/payroll',
    '/admin/fee-management',
  ]) {
    assert.equal(canAccessAdminPath('principal', p), true, p)
  }
  assert.equal(roleHasPermission('principal', 'payroll.approve'), true)
})

test('the whole University Exams group is out of the principal portal', () => {
  for (const p of [
    '/admin/exam-management',
    '/admin/uucms-integration',
    '/admin/bcu-compliance',
    '/admin/result-importer',
    '/admin/scheme-packs',
  ]) {
    assert.equal(canAccessAdminPath('principal', p), false, p)
    assert.equal(canAccessAdminPath('admin', p), true, p)
    assert.equal(canAccessAdminPath('hod', p), true, p)
    assert.equal(canAccessAdminPath('superadmin', p), true, p)
  }
})

test('engineering permissions are additive and obey deny-by-default', () => {
  assert.equal(roleHasPermission('hod', 'obe.attainment'), true)
  assert.equal(roleHasPermission('principal', 'obe.attainment'), true)
  assert.equal(roleHasPermission('employee', 'obe.attainment'), true)
  assert.equal(roleHasPermission('faculty', 'obe.attainment'), false)
  assert.equal(roleHasPermission('student', 'obe.attainment'), false)
  assert.equal(roleHasPermission('admin', 'engineering.schemePacks'), true)
  assert.equal(roleHasPermission('hod', 'engineering.schemePacks'), true)
  assert.equal(roleHasPermission('principal', 'engineering.schemePacks'), false)
  // Unknown permissions and missing roles are never granted.
  assert.equal(roleHasPermission('admin', 'not.a.real.permission'), false)
  assert.equal(roleHasPermission(null, 'universityExam.manage'), false)
})
