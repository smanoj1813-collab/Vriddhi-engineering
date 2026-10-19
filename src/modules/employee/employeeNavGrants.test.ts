import test from 'node:test'
import assert from 'node:assert/strict'
import { employeePathVisible, restrictEmployeeNav } from './employeeNavGrants'

test('a grant-gated page is visible only with its grant', () => {
  assert.equal(employeePathVisible('/admin/class-schedule', ['schedule']), true)
  assert.equal(employeePathVisible('/admin/class-schedule', ['papers']), false)
  assert.equal(employeePathVisible('/admin/paper-generator', ['papers']), true)
  assert.equal(employeePathVisible('/admin/grade-records', ['reports']), false)
})

test('pages with no grant requirement stay visible', () => {
  assert.equal(employeePathVisible('/admin/attendance', []), true)
  assert.equal(employeePathVisible('/admin/students', []), true)
})

test('restrictEmployeeNav drops empty groups and hidden links', () => {
  const nav = [
    { kind: 'link' as const, path: '/employee/dashboard' },
    {
      kind: 'group' as const,
      children: [{ path: '/admin/class-schedule' }, { path: '/admin/attendance' }],
    },
    {
      kind: 'group' as const,
      children: [{ path: '/admin/paper-generator' }, { path: '/admin/question-bank' }],
    },
    { kind: 'link' as const, path: '/admin/grade-records' },
  ]
  const out = restrictEmployeeNav(nav, ['schedule'])
  assert.deepEqual(out, [
    { kind: 'link', path: '/employee/dashboard' },
    { kind: 'group', children: [{ path: '/admin/class-schedule' }, { path: '/admin/attendance' }] },
  ])
})

test('restrictEmployeeNav with no grants keeps only ungated pages', () => {
  const nav = [
    { kind: 'group' as const, children: [{ path: '/admin/class-schedule' }, { path: '/admin/attendance' }] },
  ]
  assert.deepEqual(restrictEmployeeNav(nav, []), [
    { kind: 'group', children: [{ path: '/admin/attendance' }] },
  ])
  assert.equal(restrictEmployeeNav(null, []), null)
})
