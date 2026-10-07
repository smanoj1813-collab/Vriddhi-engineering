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
  '/student/attendance', '/student/assessments', '/student/assignments',
  '/student/grades', '/student/materials', '/student/coding-lab', '/student/timetable', '/student/curriculum',
  '/student/library', '/student/events', '/student/notifications',
].map((to) => ({ to }))

test('grouping: every dashboard tile lands under a heading, none dropped', () => {
  const groups = groupTilesByNavSection(DASHBOARD_TILES)
  const rendered = groups.flatMap((group) => group.tiles.map((tile) => tile.to)).sort()
  assert.deepEqual(rendered, DASHBOARD_TILES.map((tile) => tile.to).sort())
})

test('grouping: fee & exam pages are removed from the student portal', () => {
  for (const path of ['/student/fees', '/student/fee-portal', '/student/challans', '/student/hall-tickets', '/student/no-dues']) {
    assert.equal(findNavItem(path), undefined, `${path} is not in the student nav`)
  }
  assert.ok(!STUDENT_NAV_GROUPS.some((g) => g.label === 'Fees & exams'))
})

test('grouping: study pages sit with learning', () => {
  const groups = groupTilesByNavSection(DASHBOARD_TILES)
  const of = (path: string) => groups.find((g) => g.tiles.some((tile) => tile.to === path))?.label
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

test('More sheet: notifications are inside More, not tabs', () => {
  const ids = moreSheetItems().map((item) => item.id)
  assert.ok(!ids.includes('fees'), 'Fees is removed')
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
