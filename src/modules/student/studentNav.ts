// Single source of truth for the student portal navigation. The desktop
// sidebar, the phone bottom bar, and the "More" sheet all read this list, so
// a new student page is registered once instead of in three layouts.
import {
  LayoutDashboard,
  Calendar,
  BookOpen,
  FileText,
  TrendingUp,
  Library,
  Clock,
  CreditCard,
  CalendarDays,
  Bell,
  Settings,
  GraduationCap,
  Download,
  Milestone,
  BookMarked,
  UserCheck,
  Receipt,
  School,
  Sparkles,
  Briefcase,
  Award,
  Code2,
  IdCard,
  type LucideIcon,
} from 'lucide-react'
import type { TranslationKey } from '../../shared/i18n'
import { isBcaStudent, type StudentProgramIdentity } from './codingLabAccess'

export type StudentNavGroup = 'academics' | 'practice' | 'money' | 'account'

export interface StudentNavItem {
  id: string
  label: string
  path: string
  icon: LucideIcon
  group: StudentNavGroup
  /** English label used when the student hasn't picked another language. */
  translationKey?: TranslationKey
  /** Shows a count of unread notifications. */
  badge?: 'notifications'
  /** Extra route spellings that should still light this item up. */
  aliases?: string[]
  /**
   * A section landing page that collects the other pages of its group. Hubs
   * are reached from the phone's bottom bar, so they never appear as a tile
   * inside the very list they are the header of.
   */
  hub?: boolean
  /** One line of "what will I find here", used on the section hub pages. */
  hint?: string
}

export const STUDENT_NAV_ITEMS: StudentNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/student/dashboard', icon: LayoutDashboard, group: 'academics', translationKey: 'nav.dashboard' },
  // Section hub: the phone's "Academics" tab. It owns the pages that belong to
  // the same heading on the sidebar and the dashboard quick tiles.
  { id: 'academics', label: 'Academics', path: '/student/academics', icon: School, group: 'academics', hub: true },
  { id: 'attendance', label: 'Attendance', path: '/student/attendance', icon: Calendar, group: 'academics', translationKey: 'nav.attendance', hint: 'Present / absent record and attendance percentage' },
  { id: 'assessments', label: 'Assessments', path: '/student/assessments', icon: BookOpen, group: 'academics', translationKey: 'nav.assessments', hint: 'Tests, results and detailed performance analysis' },
  { id: 'assignments', label: 'Assignments', path: '/student/assignments', icon: FileText, group: 'academics', translationKey: 'nav.assignments', hint: 'Submit your work and track what is pending' },
  { id: 'grades', label: 'Grades', path: '/student/grades', icon: TrendingUp, group: 'academics', translationKey: 'nav.grades', hint: 'Marks, credits and GPA' },
  { id: 'curriculum', label: 'Curriculum', path: '/student/curriculum', icon: BookMarked, group: 'academics', translationKey: 'nav.curriculum', hint: 'Your syllabus and how far it has been taught' },
  { id: 'timetable', label: 'Timetable', path: '/student/timetable', icon: Clock, group: 'academics', translationKey: 'nav.timetable', hint: 'Weekly class schedule with rooms and faculty' },
  // Section hub: the phone's "Learning" tab.
  { id: 'learning', label: 'Learning', path: '/student/learning', icon: Sparkles, group: 'practice', hub: true },
  { id: 'materials', label: 'Materials', path: '/student/materials', icon: Library, group: 'practice', translationKey: 'nav.materials', hint: 'Notes, slides and study material shared by faculty' },
  { id: 'courses', label: 'Courses', path: '/student/courses', icon: Award, group: 'practice', hint: 'Self-paced certificate programmes — lessons, labs, quizzes and projects' },
  { id: 'coding-lab', label: 'Coding Lab', path: '/student/coding-lab', icon: Code2, group: 'practice', hint: 'Practice C, C++, Java and Python with an in-browser code runner' },
  { id: 'library', label: 'Library', path: '/student/library', icon: GraduationCap, group: 'practice', translationKey: 'nav.library', hint: 'Books, journals and e-resources' },
  { id: 'journey', label: 'My Journey', path: '/student/journey', icon: Milestone, group: 'practice', translationKey: 'nav.journey', hint: 'Your progress across the programme' },
  { id: 'resume', label: 'Resume Builder', path: '/student/resume', icon: Briefcase, group: 'practice', hint: 'ATS-friendly resume templates, live preview and PDF download (Placement Pack)' },
  { id: 'faculty-connect', label: 'Faculty Connect', path: '/student/faculty-connect', icon: UserCheck, group: 'practice', aliases: ['/student/mentorship'], hint: 'Ask a mentor or a faculty member' },
  { id: 'fees', label: 'Fees', path: '/student/fees', icon: CreditCard, group: 'money', translationKey: 'nav.fees', aliases: ['/student/fee-portal'], hint: 'Dues, payments and receipts' },
  { id: 'challans', label: 'My Challans', path: '/student/challans', icon: Receipt, group: 'money', hint: 'Fee challans issued to you' },
  { id: 'halltickets', label: 'Hall Tickets', path: '/student/hall-tickets', icon: Download, group: 'money', hint: 'Download your exam hall tickets' },
  { id: 'no-dues', label: 'No-Dues Clearance', path: '/student/no-dues', icon: FileText, group: 'money', hint: 'Submit and track requests to clear campus dues' },
  { id: 'id-card', label: 'My ID Card', path: '/student/id-card', icon: IdCard, group: 'account', hint: 'Digital student ID with library barcode — download as PDF' },
  { id: 'events', label: 'Events', path: '/student/events', icon: CalendarDays, group: 'account', translationKey: 'nav.events', hint: 'Campus events and activities' },
  { id: 'notifications', label: 'Notifications', path: '/student/notifications', icon: Bell, group: 'account', translationKey: 'nav.notifications', badge: 'notifications', hint: 'Announcements and alerts for you' },
  { id: 'install-app', label: 'Install App', path: '/student/install-app', icon: Download, group: 'account', aliases: ['/student/pwa-install'] },
  { id: 'settings', label: 'Settings', path: '/student/settings', icon: Settings, group: 'account', translationKey: 'nav.settings', hint: 'Language, theme and account preferences' },
]

/** Apply student-program visibility rules to destinations before rendering navigation. */
export function studentNavItemsForProfile(
  profile?: StudentProgramIdentity | null,
  codingLabEnabled?: boolean,
  assignmentsEnabled: boolean = true,
): StudentNavItem[] {
  // Omitted profile is kept for static route-model callers/tests. Real student
  // surfaces pass the college-checked entitlement from StudentDataProvider.
  const canUseCodingLab = profile === undefined || (isBcaStudent(profile) && codingLabEnabled === true)
  // Assignments is a college-level optional module (colleges/{id}/config/modules).
  // Defaults ON; only an explicit college decision hides it.
  const canUseAssignments = assignmentsEnabled !== false
  return STUDENT_NAV_ITEMS.filter(
    (item) =>
      (item.id !== 'coding-lab' || canUseCodingLab)
      && (item.id !== 'assignments' || canUseAssignments)
  )
}

/**
 * The four destinations a student reaches with a thumb, plus "More": the two
 * daily-use pages (Dashboard, Assessments) and the two section hubs
 * (Academics, Learning). Fees and Notifications live inside "More" — they are
 * checked occasionally, not every session.
 */
export const MOBILE_TAB_IDS = ['dashboard', 'academics', 'assessments', 'learning'] as const

/** The bottom-bar tabs in configured order, tolerant of a renamed id. */
export function mobileTabItems(): StudentNavItem[] {
  const picked = (MOBILE_TAB_IDS as readonly string[])
    .map((id) => STUDENT_NAV_ITEMS.find((item) => item.id === id))
    .filter((item): item is StudentNavItem => !!item)
  // Keep the configured order; if a tab id is ever renamed, fall back to
  // leading with Dashboard so the bar never renders three items.
  return picked.length === MOBILE_TAB_IDS.length ? picked : [STUDENT_NAV_ITEMS[0], ...picked].slice(0, MOBILE_TAB_IDS.length)
}

/**
 * Everything the "More" sheet lists: the pages that are not already a bottom
 * tab, and not the hubs themselves (a hub is a tab; listing it in More would
 * be a link to the menu the student is standing in).
 */
export function moreSheetItems(options: {
  showInstallApp?: boolean
  profile?: StudentProgramIdentity | null
  codingLabEnabled?: boolean
  assignmentsEnabled?: boolean
} = {}): StudentNavItem[] {
  const showInstallApp = options.showInstallApp !== false
  return studentNavItemsForProfile(options.profile, options.codingLabEnabled, options.assignmentsEnabled ?? true).filter(
    (item) =>
      !(MOBILE_TAB_IDS as readonly string[]).includes(item.id)
      && !item.hub
      && (showInstallApp || item.id !== 'install-app')
  )
}

/**
 * The pages that sit under a section heading, minus the hub that heads it and
 * minus anything that already owns a bottom-bar tab (a hub that repeats the
 * tab the student just tapped is a dead end, not a shortcut).
 */
export function navItemsInGroup(
  group: StudentNavGroup,
  profile?: StudentProgramIdentity | null,
  codingLabEnabled?: boolean,
  assignmentsEnabled: boolean = true,
): StudentNavItem[] {
  return studentNavItemsForProfile(profile, codingLabEnabled, assignmentsEnabled).filter(
    (item) => item.group === group && !item.hub && !(MOBILE_TAB_IDS as readonly string[]).includes(item.id)
  )
}

export const STUDENT_NAV_GROUPS: Array<{ id: StudentNavGroup; label: string }> = [
  { id: 'academics', label: 'Academics' },
  { id: 'practice', label: 'Learning' },
  { id: 'money', label: 'Fees & exams' },
  { id: 'account', label: 'Account' },
]

// (groupTilesByNavSection lives below findNavItem, which it depends on.)
const NAV_PATHS = new Map<string, string>(
  STUDENT_NAV_ITEMS.flatMap((item) => [[item.path, item.id] as [string, string], ...(item.aliases || []).map((alias) => [alias, item.id] as [string, string])])
)

/** The nav item that owns a pathname — longest match wins. */
export function findNavItem(pathname: string): StudentNavItem | undefined {
  // Longest match wins so /student/assessments/:id/take does not resolve to
  // the Assessments tab while a test is open, and an alias route
  // (/student/fee-portal) still lights up the tab it duplicates.
  const candidates = [...NAV_PATHS.entries()]
    .filter(([path]) => pathname === path || (path !== '/student/dashboard' && pathname.startsWith(path)))
    .sort(([a], [b]) => b.length - a.length)
  const ownerId = candidates[0] ? NAV_PATHS.get(candidates[0][0]) : undefined
  return STUDENT_NAV_ITEMS.find((item) => item.id === ownerId)
}

/**
 * Group a list of student pages by the nav group their route belongs to — the
 * same grouping the "More" sheet uses, so a page cannot sit under one heading
 * on the dashboard and another on the phone. Tiles the nav model does not know
 * fall into a trailing "More" block rather than being dropped: a silently
 * missing link is the failure this helper exists to prevent.
 */
export function groupTilesByNavSection<T extends { to: string }>(
  tiles: T[]
): Array<{ id: StudentNavGroup | 'other'; label: string; tiles: T[] }> {
  const grouped = STUDENT_NAV_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    tiles: tiles.filter((tile) => findNavItem(tile.to)?.group === group.id),
  })).filter((group) => group.tiles.length > 0)
  const known = new Set(grouped.flatMap((group) => group.tiles.map((tile) => tile.to)))
  const orphaned = tiles.filter((tile) => !known.has(tile.to))
  return orphaned.length > 0 ? [...grouped, { id: 'other' as const, label: 'More', tiles: orphaned }] : grouped
}
