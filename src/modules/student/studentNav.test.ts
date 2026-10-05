import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MOBILE_TAB_IDS,
  STUDENT_NAV_GROUPS,
  STUDENT_NAV_ITEMS,
  findNavItem,
  groupTilesByNavSection,
  mobileTabItems,
  moreSheetItems,
  navItemsInGroup,
  studentNavItemsForProfile,
} from './studentNav'

const DASHBOARD_TILES = [
  '/student/hall-tickets', '/student/attendance', '/student/assessments', '/student/assignments',
  '/student/grades', '/student/materials', '/student/coding-lab', '/student/timetable', '/student/curriculum',
  '/student/fees', '/student/challans', '/student/no-dues', '/student/library', '/student/events', '/student/notifications',
].map((to) => ({ to }))

test('grouping: every dashboard tile lands under a heading, none dropped', () => {
  const groups = groupTilesByNavSection(DASHBOARD_TILES)
  const rendered = groups.flatMap((group) => group.tiles.map((tile) => tile.to)).sort()
  assert.deepEqual(rendered, DASHBOARD_TILES.map((tile) => tile.to).sort())
})

test('grouping: money pages sit together, study pages with learning', () => {
  const groups = groupTilesByNavSection(DASHBOARD_TILES)
  const of = (path: string) => groups.find((g) => g.tiles.some((tile) => tile.to === path))?.label
  assert.equal(of('/student/challans'), 'Fees & exams')
  assert.equal(of('/student/fees'), 'Fees & exams')
  assert.equal(of('/student/hall-tickets'), 'Fees & exams')
  assert.equal(of('/student/no-dues'), 'Fees & exams')
  assert.equal(of('/student/materials'), 'Learning')
  assert.equal(of('/student/coding-lab'), 'Learning')
  assert.equal(of('/student/attendance'), 'Academics')
  assert.equal(of('/student/notifications'), 'Account')
})

test('grouping: headings come from the nav model, in its order', () => {
  const groups = groupTilesByNavSection(DASHBOARD_TILES)
  assert.deepEqual(groups.map((g) => g.label), STUDENT_NAV_GROUPS.map((g) => g.label))
  // A group with no tiles is skipped rather than printed as an empty heading.
  const onlyStudy = groupTilesByNavSection([{ to: '/student/grades' }])
  assert.deepEqual(onlyStudy.map((g) => g.label), ['Academics'])
})

test('grouping: an unknown route is kept under "More" instead of vanishing', () => {
  const groups = groupTilesByNavSection([{ to: '/student/grades' }, { to: '/student/brand-new-page' }])
  const last = groups[groups.length - 1]
  assert.equal(last.label, 'More')
  assert.deepEqual(last.tiles.map((tile) => tile.to), ['/student/brand-new-page'])
})

test('grouping: alias routes resolve to the group of the page they duplicate', () => {
  // /student/fee-portal is the old spelling of Fees; a tile or a link using it
  // must not end up orphaned under "More".
  assert.equal(findNavItem('/student/fee-portal')?.group, 'money')
  assert.equal(groupTilesByNavSection([{ to: '/student/fee-portal' }])[0].label, 'Fees & exams')
})

test('coding lab: the student route is reachable from the Learning group', () => {
  const item = findNavItem('/student/coding-lab')
  assert.equal(item?.id, 'coding-lab')
  assert.equal(item?.group, 'practice')
  assert.equal(item?.path, '/student/coding-lab')
  assert.ok(item?.hint)
  assert.ok(navItemsInGroup('practice').some((entry) => entry.id === 'coding-lab'))
  assert.equal(groupTilesByNavSection([{ to: '/student/coding-lab' }])[0].label, 'Learning')
})

test('programme visibility: Coding Lab appears only in BCA student navigation', () => {
  const bcaItems = studentNavItemsForProfile({ course: 'BCA' }, true)
  const unassignedBcaItems = studentNavItemsForProfile({ course: 'BCA' }, false)
  const baItems = studentNavItemsForProfile({ course: 'BA' }, true)
  const unknownItems = studentNavItemsForProfile(null, true)
  assert.ok(bcaItems.some((item) => item.id === 'coding-lab'))
  assert.ok(!unassignedBcaItems.some((item) => item.id === 'coding-lab'))
  assert.ok(!baItems.some((item) => item.id === 'coding-lab'))
  assert.ok(!unknownItems.some((item) => item.id === 'coding-lab'))
  assert.ok(moreSheetItems({ profile: { branch: 'BCA' }, codingLabEnabled: true }).some((item) => item.id === 'coding-lab'))
  assert.ok(!navItemsInGroup('practice', { course: 'B.Com' }, true).some((item) => item.id === 'coding-lab'))
})

test('module toggles: Assignments stays visible by default and hides when the college switches it off', () => {
  // Default (no toggle configured) keeps the core module visible.
  assert.ok(studentNavItemsForProfile({ course: 'BCA' }, true).some((item) => item.id === 'assignments'))
  assert.ok(studentNavItemsForProfile(null).some((item) => item.id === 'assignments'))
  // Explicit college decision: off everywhere the nav renders.
  const hidden = studentNavItemsForProfile({ course: 'BCA' }, true, false)
  assert.ok(!hidden.some((item) => item.id === 'assignments'))
  assert.ok(!navItemsInGroup('academics', { course: 'BCA' }, true, false).some((item) => item.id === 'assignments'))
  assert.ok(!moreSheetItems({ profile: { course: 'BCA' }, codingLabEnabled: true, assignmentsEnabled: false }).some((item) => item.id === 'assignments'))
  // …without disturbing unrelated items.
  assert.ok(hidden.some((item) => item.id === 'attendance'))
  assert.ok(hidden.some((item) => item.id === 'coding-lab'))
})

test('nav model: every item belongs to a declared group', () => {
  const declared = new Set(STUDENT_NAV_GROUPS.map((g) => g.id))
  for (const item of STUDENT_NAV_ITEMS) {
    assert.ok(declared.has(item.group), `${item.id} has group "${item.group}"`)
  }
})

// ── Phone bottom bar ────────────────────────────────────────────────────
// The bar carries Dashboard, Academics, Assessments, Learning and "More".
// Fees and Notifications moved inside "More"; Academics and Learning were
// pulled out as their own section hubs.
test('bottom bar: the four tabs are Dashboard, Academics, Assessments, Learning', () => {
  assert.deepEqual([...MOBILE_TAB_IDS], ['dashboard', 'academics', 'assessments', 'learning'])
  const labels = mobileTabItems().map((item) => item.label)
  assert.deepEqual(labels, ['Dashboard', 'Academics', 'Assessments', 'Learning'])
})

test('bottom bar: every tab resolves to a real route and an icon', () => {
  for (const item of mobileTabItems()) {
    assert.ok(item.path.startsWith('/student/'), `${item.id} has a student route`)
    assert.ok(item.icon, `${item.id} has an icon`)
  }
})

test('More sheet: fees and notifications are inside More, not tabs', () => {
  const ids = moreSheetItems().map((item) => item.id)
  assert.ok(ids.includes('fees'), 'Fees is reachable from More')
  assert.ok(ids.includes('notifications'), 'Notifications is reachable from More')
  for (const tabId of MOBILE_TAB_IDS) {
    assert.ok(!ids.includes(tabId), `${tabId} is a tab, so it is not repeated in More`)
  }
})

test('More sheet: hubs are tabs, never tiles inside the menu they head', () => {
  const ids = moreSheetItems().map((item) => item.id)
  assert.ok(!ids.includes('academics'))
  assert.ok(!ids.includes('learning'))
  // The installed app has nothing left to install, so that row is dropped.
  assert.ok(!moreSheetItems({ showInstallApp: false }).map((item) => item.id).includes('install-app'))
})

test('hubs: a section hub lists its own group and never itself', () => {
  const academics = navItemsInGroup('academics')
  assert.ok(academics.length >= 4)
  assert.ok(academics.every((item) => item.group === 'academics' && !item.hub))
  assert.ok(academics.some((item) => item.id === 'attendance'))
  assert.ok(academics.some((item) => item.id === 'grades'))
  // Dashboard and Assessments already have a bottom-bar tab of their own.
  assert.ok(!academics.map((item) => item.id).includes('dashboard'))
  assert.ok(!academics.map((item) => item.id).includes('assessments'))

  const learning = navItemsInGroup('practice')
  assert.ok(learning.every((item) => item.group === 'practice' && !item.hub))
  assert.ok(learning.some((item) => item.id === 'materials'))

  // Both hubs are reachable by their own URL and light up as the active tab.
  assert.equal(findNavItem('/student/academics')?.id, 'academics')
  assert.equal(findNavItem('/student/learning')?.id, 'learning')
  // …without swallowing their children.
  assert.equal(findNavItem('/student/academics/extra')?.id, 'academics')
  assert.equal(findNavItem('/student/attendance')?.id, 'attendance')
})

test('hubs: a hub is a declared group, and every listed page carries a hint', () => {
  const declared = new Set(STUDENT_NAV_GROUPS.map((group) => group.id))
  for (const item of STUDENT_NAV_ITEMS.filter((entry) => entry.hub)) {
    assert.ok(declared.has(item.group), `${item.id} belongs to a declared group`)
    assert.ok(navItemsInGroup(item.group).length >= 2, `${item.id} heads a group with pages to show`)
  }
  // The hub pages print one line per tile; a tile without a hint renders as a
  // bare label, which is exactly the dead-end list this feature replaced.
  for (const group of ['academics', 'practice'] as const) {
    for (const item of navItemsInGroup(group)) {
      assert.ok(item.hint, `${item.id} has a hint for the hub page`)
    }
  }
})
