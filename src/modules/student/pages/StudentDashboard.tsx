import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStudentData } from '../hooks/useStudentData';
import StudentAcademicSummary from '../components/StudentAcademicSummary';
import TodayStrip from '../components/TodayStrip';
import {
  Calendar, BookOpen, FileText, CreditCard, Clock, CheckCircle, AlertTriangle,
  Bell, ChevronRight, TrendingUp, MapPin, BarChart3, Library, Settings, Receipt,
  GraduationCap, Sparkles, User, CalendarDays, BookMarked, ShieldCheck, Code2
} from 'lucide-react';
import type { Assessment, ClassSchedule, StudentProfile } from '../types/student';
import { deadlineCountdown, linkageBadgeText } from '../utils/deadlineCountdown';
import { useTranslation } from '../../../shared/contexts/LanguageProvider';
import type { TranslationKey } from '../../../shared/i18n';
import { groupTilesByNavSection } from '../studentNav';
import { accessStatus, formatDurationMonths, isDateKey } from '../../../shared/utils/accessWindow';

/**
 * Where the student's platform access stands, from the fields the import /
 * bulk-assign stamps on their record. Absent for accounts provisioned before
 * products existed — the dashboard then simply shows nothing extra.
 */
function AccessBadge({ profile }: { profile: Pick<StudentProfile, 'accessEnd' | 'accessProductName' | 'accessDurationMonths'> }) {
  const end = typeof profile.accessEnd === 'string' ? profile.accessEnd : '';
  if (!isDateKey(end)) return null;
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const status = accessStatus(end, today);
  const tone =
    status === 'active'
      ? 'bg-white/20 text-teal-50'
      : status === 'expiring'
        ? 'bg-amber-400/30 text-amber-50'
        : 'bg-rose-500/30 text-rose-50';
  const endLabel = new Date(`${end}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <p className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      <ShieldCheck size={13} />
      {typeof profile.accessProductName === 'string' && profile.accessProductName
        ? `${profile.accessProductName} · `
        : ''}
      {typeof profile.accessDurationMonths === 'number' ? `${formatDurationMonths(profile.accessDurationMonths)} · ` : ''}
      {status === 'expired' ? `Access ended ${endLabel}` : `Access till ${endLabel}`}
    </p>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, subtext, color }: {
  icon: React.ElementType; label: string; value: string; subtext?: string; color: string;
}) {
  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    teal: {
      bg: 'bg-teal-50 dark:bg-teal-950/40',
      text: 'text-teal-700 dark:text-teal-300',
      border: 'border-teal-200/80 dark:border-teal-800/60',
    },
    blue: {
      bg: 'bg-blue-50 dark:bg-blue-950/40',
      text: 'text-blue-700 dark:text-blue-300',
      border: 'border-blue-200/80 dark:border-blue-800/60',
    },
    amber: {
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-200/80 dark:border-amber-800/60',
    },
    rose: {
      bg: 'bg-rose-50 dark:bg-rose-950/40',
      text: 'text-rose-700 dark:text-rose-300',
      border: 'border-rose-200/80 dark:border-rose-800/60',
    },
    emerald: {
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-200/80 dark:border-emerald-800/60',
    },
    violet: {
      bg: 'bg-violet-50 dark:bg-violet-950/40',
      text: 'text-violet-700 dark:text-violet-300',
      border: 'border-violet-200/80 dark:border-violet-800/60',
    },
  };

  const scheme = colorMap[color] || colorMap.teal;

  return (
    <div className={`rounded-2xl border ${scheme.border} ${scheme.bg} p-4 md:p-5 shadow-sm transition-all duration-200 hover:shadow-md`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 truncate">{label}</p>
          <h3 className={`text-xl md:text-2xl font-extrabold ${scheme.text}`}>{value}</h3>
          {subtext && <p className="text-xs mt-1 text-slate-500 dark:text-slate-400 truncate font-medium">{subtext}</p>}
        </div>
        <div className={`p-2.5 rounded-xl bg-white dark:bg-slate-900/60 shadow-xs shrink-0 ${scheme.text}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

function ScheduleCard({ session }: { session: ClassSchedule }) {
  // `status` and `topic` come from the merged classSessions row (see
  // fetchTodaySchedule) — a class the faculty completed or cancelled, and the
  // topics they covered/planned, used to be dropped on the floor here.
  const status = String(session.status || 'scheduled');
  const statusMeta: Record<string, { label: string; cls: string }> = {
    completed: { label: 'Taught', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
    ongoing: { label: 'In class', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
    cancelled: { label: 'Cancelled', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  };
  const badge = statusMeta[status];
  const topics = session.topic ? session.topic.split(',').map((t) => t.trim()).filter(Boolean) : [];
  return (
    <div className="flex items-start gap-3 p-3.5 md:p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs hover:border-teal-300 dark:hover:border-teal-700 transition-all">
      <div className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 shrink-0">
        <Clock className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{session.subject}</p>
          {badge && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${badge.cls}`}>{badge.label}</span>}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate font-medium">
          {session.teacher || session.facultyName || 'Faculty Member'}
        </p>
        {topics.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {topics.map((t, i) => (
              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">{t}</span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] italic text-slate-400 mt-1">Topic not announced yet</p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs md:text-sm font-bold text-slate-800 dark:text-slate-200">{session.startTime}</p>
        <p className="text-[11px] text-slate-500 flex items-center gap-1 justify-end font-medium">
          <MapPin size={11} className="text-teal-600" /> {session.room || 'Hall'}
        </p>
      </div>
    </div>
  );
}

function NotificationCard({ notification }: { notification: {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  category?: string;
  deadline?: string;
  courseName?: string;
  moduleTitle?: string;
  assignmentId?: string;
} }) {
  const typeColors: Record<string, string> = {
    info: 'border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300',
    warning: 'border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
    success: 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
  };
  const isAssignment = notification.category === 'assignment';
  const countdown = isAssignment ? deadlineCountdown(notification.deadline) : null;
  const badge = isAssignment ? linkageBadgeText(notification.courseName, notification.moduleTitle) : null;
  return (
    <div className={`p-3.5 rounded-xl border ${typeColors[notification.type] || typeColors.info}`}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0">
          {isAssignment ? <BookOpen className="w-4 h-4 text-violet-500" /> :
           notification.type === 'warning' ? <AlertTriangle className="w-4 h-4 text-amber-500" /> :
           notification.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-500" /> :
           <Bell className="w-4 h-4 text-blue-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-slate-900 dark:text-white">{notification.title}</p>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">{notification.message}</p>
          {(badge || countdown) && (
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              {badge && (
                <span className="inline-flex items-center gap-1 max-w-full text-[10px] font-bold text-violet-700 dark:text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-full px-2 py-0.5">
                  <BookOpen size={10} className="shrink-0" />
                  <span className="truncate">{badge}</span>
                </span>
              )}
              {countdown && (
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5 border ${
                  countdown.tone === 'overdue'
                    ? 'text-rose-700 dark:text-rose-300 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800'
                    : countdown.tone === 'soon'
                      ? 'text-amber-700 dark:text-amber-300 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800'
                      : 'text-slate-600 dark:text-slate-400 bg-slate-50 border-slate-200 dark:bg-slate-900/40 dark:border-slate-700'
                }`}>
                  <Clock size={10} /> {countdown.text}
                </span>
              )}
            </div>
          )}
        </div>
        {!notification.read && <div className="w-2 h-2 rounded-full bg-teal-600 shrink-0 mt-1" />}
      </div>
    </div>
  );
}

function QuickAction({ to, icon: Icon, label, color }: {
  to: string; icon: React.ElementType; label: string; color: string;
}) {
  return (
    <Link
      to={to}
      className="p-3 md:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs hover:border-teal-500/50 hover:shadow-md transition-all text-center group flex flex-col items-center justify-center"
    >
      <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 flex items-center justify-center mb-2 group-hover:scale-110 group-hover:bg-teal-600 group-hover:text-slate-900 dark:text-white transition-all shadow-xs">
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-teal-700 dark:group-hover:text-teal-400 transition-colors">{label}</p>
    </Link>
  );
}

// Every destination the dashboard offers as a tile. The list carries the route,
// the icon and a label; the *heading* it appears under comes from the shared nav
// model (studentNav), which is what keeps this in step with the phone "More"
// sheet — a page cannot be under "Fees & exams" in one and "Account" in the
// other, because neither surface decides its own group.
const QUICK_ACTIONS: Array<{
  to: string;
  icon: React.ElementType;
  color: string;
  /** English label, used when there is no translation key. */
  label: string;
  labelKey?: TranslationKey;
}> = [
  { to: '/student/hall-tickets', icon: FileText, label: 'Hall Tickets', color: 'rose' },
  { to: '/student/attendance', icon: Calendar, label: 'Attendance', labelKey: 'nav.attendance', color: 'teal' },
  { to: '/student/assessments', icon: BookOpen, label: 'Assessments', labelKey: 'nav.assessments', color: 'blue' },
  { to: '/student/assignments', icon: FileText, label: 'Assignments', labelKey: 'nav.assignments', color: 'amber' },
  { to: '/student/grades', icon: TrendingUp, label: 'Grades', labelKey: 'student.gradesGpa', color: 'emerald' },
  { to: '/student/materials', icon: Library, label: 'Materials', labelKey: 'student.studyNotes', color: 'violet' },
  { to: '/student/coding-lab', icon: Code2, label: 'Coding Lab', color: 'teal' },
  { to: '/student/timetable', icon: Clock, label: 'Timetable', labelKey: 'nav.timetable', color: 'rose' },
  { to: '/student/curriculum', icon: BookMarked, label: 'Curriculum', labelKey: 'nav.curriculum', color: 'violet' },
  { to: '/student/fees', icon: CreditCard, label: 'Fees', labelKey: 'student.feePortal', color: 'teal' },
  { to: '/student/challans', icon: Receipt, label: 'Challans', color: 'emerald' },
  { to: '/student/library', icon: BookOpen, label: 'Library', labelKey: 'student.eLibrary', color: 'blue' },
  { to: '/student/no-dues', icon: FileText, label: 'No-Dues', color: 'emerald' },
  { to: '/student/events', icon: CalendarDays, label: 'Events', labelKey: 'student.campusEvents', color: 'amber' },
  { to: '/student/notifications', icon: Bell, label: 'Notifications', labelKey: 'student.alerts', color: 'violet' },
];

// ─── Main Component ─────────────────────────────────────────────────

export default function StudentDashboard() {
  const { t } = useTranslation();
  const {
    loading,
    error,
    warnings,
    refresh,
    profile,
    codingLabEnabled,
    assignmentsEnabled,
    attendance,
    assessments,
    assignments,
    fees,
    schedule,
    notifications,
    unreadNotifications,
    todayDate,
  } = useStudentData();

  const [activeTab, setActiveTab] = useState<'overview' | 'schedule' | 'notifications'>('overview');

  const paidFees = fees?.paidFees || 0;
  const pendingFees = fees?.pendingFees || 0;
  const totalFees = fees?.totalFees || 0;
  const paidPercent = totalFees > 0 ? Math.round((paidFees / totalFees) * 100) : 0;
  const pendingPercent = totalFees > 0 ? Math.round((pendingFees / totalFees) * 100) : 0;

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-3 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <p className="mt-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('common.loadingDashboard')}</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100" role="alert">
          <h1 className="text-lg font-extrabold">Student portal unavailable</h1>
          <p className="mt-2 text-sm">
            {error || 'Your account is not linked to a student profile. Contact your college administrator.'}
          </p>
          <button
            type="button"
            onClick={refresh}
            className="mt-4 rounded-xl bg-rose-700 px-4 py-2 text-sm font-bold text-white hover:bg-rose-800"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      {warnings.map((warning) => (
        <div
          key={warning}
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          {warning}
        </div>
      ))}

      {/* Welcome Banner */}
      <div className="rounded-3xl bg-gradient-to-r from-teal-600 via-teal-700 to-teal-800 text-white p-5 md:p-8 shadow-lg shadow-teal-600/15 relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center font-black text-2xl md:text-3xl text-white shadow-inner shrink-0">
              {profile?.name?.charAt(0) || 'S'}
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/20 text-[11px] font-bold uppercase tracking-wider text-teal-100 mb-1">
                <GraduationCap size={13} />
                {t('student.studentPortal')}
              </div>
              <h1 className="text-xl md:text-3xl font-extrabold tracking-tight">
                {t('student.welcomeBack', { name: profile?.name?.split(' ')[0] || t('role.student') })}
              </h1>
              <p className="text-xs md:text-sm text-teal-100 font-medium mt-0.5">
                {profile?.regNo || 'Reg. ID'} &bull; {profile?.course || 'Undergraduate'} &bull; {profile?.batch || '2026'}
              </p>
              {profile && <AccessBadge profile={profile} />}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/student/assessments"
              className="w-full sm:w-auto justify-center px-4 py-3 sm:py-2.5 rounded-xl bg-white text-teal-800 hover:bg-teal-50 font-bold text-xs md:text-sm shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
            >
              <BookOpen size={16} />
              {t('student.takeTests')}
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
        <StatCard
          icon={Calendar}
          label={t('student.attendanceRate')}
          value={`${attendance?.percentage ?? 0}%`}
          subtext={t('student.sessionsAttended', { present: attendance?.presentClasses ?? 0, total: attendance?.totalClasses ?? 0 })}
          color="teal"
        />
        <StatCard
          icon={BookOpen}
          label={t('student.activeTests')}
          value={String(assessments?.length ?? 0)}
          subtext={t('student.availableAssessmentsSub')}
          color="blue"
        />
        <StatCard
          icon={FileText}
          label={t('student.assignments')}
          value={String(assignments?.length ?? 0)}
          subtext={t('student.pendingSubmissions')}
          color="amber"
        />
        <StatCard
          icon={CreditCard}
          label={t('student.feeBalance')}
          value={`₹${pendingFees.toLocaleString()}`}
          subtext={pendingFees > 0 ? t('student.pendingPayment') : t('student.fullyCleared')}
          color={pendingFees > 0 ? 'rose' : 'emerald'}
        />
      </div>

      {/* Deterministic academic context (getMyStudentAcademicContext callable).
          Renders nothing when the backend feature gate is off. */}
      <StudentAcademicSummary />

      {/* One Vriddhi Phase B: the three-pillar pulse — what to do next across
          Learning, Assessment and Practice, from data already loaded. */}
      <TodayStrip />

      {/* Quick Actions — up to 15 destinations from the shared student nav,
          split into their nav groups. Programme-specific actions are filtered
          for this student before they are rendered. */}
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-teal-600" />
          {t('student.quickNav')} - Karnataka University
        </h2>
        <div className="space-y-4">
          {groupTilesByNavSection(QUICK_ACTIONS.filter((action) =>
            (action.to !== '/student/coding-lab' || codingLabEnabled)
            && (action.to !== '/student/assignments' || assignmentsEnabled)
          )).map((group) => (
            <div key={group.id}>
              <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span className="h-1 w-1 rounded-full bg-teal-500" aria-hidden="true" />
                {group.label}
              </p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {group.tiles.map((action) => (
                  <QuickAction
                    key={action.to}
                    to={action.to}
                    icon={action.icon}
                    label={action.labelKey ? t(action.labelKey) : action.label}
                    color={action.color}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 p-3 bg-gradient-to-r from-teal-50 to-blue-50 dark:from-teal-950/20 dark:to-blue-950/20 border border-teal-200/50 dark:border-teal-800/50 rounded-xl">
          <p className="text-xs font-bold text-teal-800 dark:text-teal-200 flex items-center gap-2">
            <GraduationCap size={14} />
            New: Karnataka University Features - Hall Tickets, Room Allotment, UUCMS Sync, BCU Compliance (Beating Uniclare)
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[
          { id: 'overview', label: t('student.overview') },
          { id: 'schedule', label: t('student.todaySchedule') },
          { id: 'notifications', label: `${t('nav.notifications')}${unreadNotifications > 0 ? ` (${unreadNotifications})` : ''}` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-xl text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Columns */}
          <div className="lg:col-span-2 space-y-6">
            {/* Upcoming Assessments */}
            <div className="rounded-2xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 p-5 md:p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-teal-600" /> {t('student.availableAssessments')}
                </h2>
                <Link to="/student/assessments" className="text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1">
                  View All <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {assessments.length > 0 ? (
                <div className="space-y-3">
                  {assessments.slice(0, 3).map((a: Assessment) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between p-3.5 md:p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 hover:border-teal-300 dark:hover:border-teal-700 transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2.5 rounded-xl bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 shrink-0 font-bold text-xs">
                          {a.type || 'MCQ'}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{a.title}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{a.subject}</p>
                        </div>
                      </div>
                      <Link
                        to={`/student/test/${a.id}/instructions`}
                        className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-slate-900 dark:text-white text-xs font-bold shadow-xs shrink-0"
                      >
                        {t('student.startTest')}
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-dashed border-slate-200 dark:border-slate-800">
                  <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('student.noPendingAssessments')}</p>
                  <p className="text-xs text-slate-500 mt-0.5">You're all caught up with your online evaluations.</p>
                </div>
              )}
            </div>

            {/* Pending Assignments */}
            <div className="rounded-2xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 p-5 md:p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-amber-600" /> {t('student.pendingAssignments')}
                </h2>
                <Link to="/student/assignments" className="text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1">
                  View All <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {assignments.length > 0 ? (
                <div className="space-y-3">
                  {assignments.slice(0, 3).map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between p-3.5 md:p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-700 transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{a.title}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5 flex-wrap">
                            <span className="truncate">{a.subject}</span>
                            {linkageBadgeText(a.courseName, a.moduleTitle) && (
                              <span className="inline-flex items-center gap-1 max-w-[160px] px-1.5 py-0.5 rounded-full text-[10px] font-bold text-violet-700 dark:text-violet-300 bg-violet-500/10 border border-violet-500/20">
                                <BookOpen className="w-2.5 h-2.5 shrink-0" />
                                <span className="truncate">{linkageBadgeText(a.courseName, a.moduleTitle)}</span>
                              </span>
                            )}
                            {deadlineCountdown(a.dueDate ? `${a.dueDate}T23:59:59` : undefined) && (
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                deadlineCountdown(`${a.dueDate}T23:59:59`)!.tone === 'overdue'
                                  ? 'text-rose-700 dark:text-rose-300 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800'
                                  : 'text-amber-700 dark:text-amber-300 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800'
                              }`}>
                                <Clock className="w-2.5 h-2.5" />
                                {deadlineCountdown(`${a.dueDate}T23:59:59`)!.text}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2.5 py-1 rounded-lg border border-amber-200/60 shrink-0">
                        Due {a.dueDate}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-dashed border-slate-200 dark:border-slate-800">
                  <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('student.noPendingAssignments')}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Great job! All assigned submissions are completed.</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Fee Status Card */}
            <div className="rounded-2xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 p-5 md:p-6 shadow-sm">
              <h3 className="font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2 text-base">
                <CreditCard className="w-5 h-5 text-teal-600" /> {t('student.feeSummary')}
              </h3>
              <div className="space-y-3.5">
                <div>
                  <div className="flex justify-between text-xs font-bold mb-1.5">
                    <span className="text-slate-500 dark:text-slate-400">Total Paid</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">₹{paidFees.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${paidPercent}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-bold mb-1.5">
                    <span className="text-slate-500 dark:text-slate-400">Pending Amount</span>
                    <span className="text-rose-600 dark:text-rose-400 font-extrabold">₹{pendingFees.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div className="h-full rounded-full bg-rose-500 transition-all duration-500" style={{ width: `${pendingPercent}%` }} />
                  </div>
                </div>
              </div>

              <Link
                to="/student/fees"
                className="mt-5 block w-full py-2.5 rounded-xl text-center bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/50 dark:hover:bg-teal-900/50 text-teal-700 dark:text-teal-300 font-bold text-xs border border-teal-200/80 dark:border-teal-800/80 transition-colors"
              >
                {t('student.goFeePortal')}
              </Link>
            </div>

            {/* Recent Notifications */}
            <div className="rounded-2xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 p-5 md:p-6 shadow-sm">
              <h3 className="font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2 text-base">
                <Bell className="w-5 h-5 text-teal-600" /> {t('student.recentAlerts')}
              </h3>
              <div className="space-y-2.5">
                {notifications.slice(0, 3).map((n) => (
                  <NotificationCard key={n.id} notification={n} />
                ))}
              </div>
              <Link
                to="/student/notifications"
                className="mt-4 block text-center text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline"
              >
                View all notifications →
              </Link>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'schedule' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-teal-600" /> Today's Scheduled Lectures
            </h2>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{todayDate}</span>
          </div>

          {schedule.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {schedule.map((s) => (
                <ScheduleCard key={s.id} session={s} />
              ))}
            </div>
          ) : (
            <div className="p-10 text-center rounded-2xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 shadow-sm">
              <Calendar className="w-10 h-10 text-slate-600 dark:text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">No classes scheduled today</p>
              <p className="text-xs text-slate-500 mt-1">Enjoy your study break or prepare for upcoming assessments.</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Bell className="w-5 h-5 text-teal-600" /> All Notifications
          </h2>
          {notifications.length > 0 ? (
            <div className="space-y-3">
              {notifications.map((n) => (
                <NotificationCard key={n.id} notification={n} />
              ))}
            </div>
          ) : (
            <div className="p-10 text-center rounded-2xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 shadow-sm">
              <Bell className="w-10 h-10 text-slate-600 dark:text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">No notifications</p>
              <p className="text-xs text-slate-500 mt-1">You will see announcements and assignment alerts here.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
