import { useState, useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useStudentData } from '../hooks/useStudentData';
import { useThemeMode } from '../../../shared/contexts/ThemeProvider';
import { useTranslation } from '../../../shared/contexts/LanguageProvider';
import LanguageSwitcher from '../../../shared/components/LanguageSwitcher';
import VriddhiLogo from '../../../shared/components/VriddhiLogo';
import { isPwaStandalone, requestPwaInstall } from '../../../shared/pwa/install';
import type { TranslationKey } from '../../../shared/i18n';
import { studentNavItemsForProfile, STUDENT_NAV_GROUPS, type StudentNavItem } from '../studentNav';
import {
  ChevronRight,
  Sun,
  Moon,
  LogOut,
  Download,
} from 'lucide-react';

/**
 * Desktop sidebar only. On a phone the same destinations are served by the
 * bottom bar + "More" sheet (see StudentBottomNav / StudentMoreSheet): a
 * slide-over drawer with an 18-row list is precisely what made the installed
 * app feel like a squeezed desktop site.
 */
export default function StudentSidebar({ onSignOut }: { onSignOut: () => void }) {
  const { profile, unreadNotifications, codingLabEnabled, assignmentsEnabled } = useStudentData();
  const { resolvedMode, toggleMode } = useThemeMode();
  const { t } = useTranslation();

  const [isCollapsed, setIsCollapsed] = useState(() => {
    return localStorage.getItem('vriddhi-student-collapsed') === 'true';
  });

  const showInstallApp = !isPwaStandalone();

  const toggleCollapsed = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    localStorage.setItem('vriddhi-student-collapsed', String(next));
  };

  // A collapsed rail is a mouse affordance; a narrow desktop window gets the
  // full list so labels are never cut off mid-word.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 1100px)');
    const apply = () => {
      if (media.matches) {
        setIsCollapsed(false);
        localStorage.setItem('vriddhi-student-collapsed', 'false');
      }
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  const sidebarWidth = isCollapsed ? 'w-20' : 'w-64';

  // In the installed app there is nothing left to install, so that row would
  // just be dead weight in the list.
  // Install is already a button in the footer, and the hub pages (Academics,
  // Learning) are exactly what the section headings below represent — so on
  // desktop the list is grouped under headings, matching the phone's sections.
  const navItems = studentNavItemsForProfile(profile, codingLabEnabled, assignmentsEnabled).filter((item) => item.id !== 'install-app' && !item.hub);
  const topItems = navItems.filter((item) => item.id === 'dashboard');
  const groupedItems = STUDENT_NAV_GROUPS.map((g) => ({
    ...g,
    items: navItems.filter((item) => item.group === g.id && item.id !== 'dashboard'),
  })).filter((g) => g.items.length > 0);

  const renderItem = (item: StudentNavItem) => {
    const Icon = item.icon;
    const badge = item.badge === 'notifications' && unreadNotifications > 0 ? unreadNotifications : undefined;
    const translatedLabel = item.translationKey ? t(item.translationKey as TranslationKey) : item.label;
    return (
      <NavLink
        key={item.id}
        to={item.path}
        end={item.path === '/student/dashboard'}
        title={isCollapsed ? translatedLabel : undefined}
        className={({ isActive }) => `flex items-center gap-3 px-3 py-2 min-h-[38px] rounded-xl text-sm transition-all duration-150 group
          ${isActive
            ? 'bg-teal-600 text-white font-semibold shadow-sm shadow-teal-600/20'
            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 font-medium'
          }
          ${isCollapsed ? 'justify-center' : ''}
        `}
      >
        {({ isActive }) => (
          <>
            <div className="relative shrink-0">
              <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400 group-hover:text-teal-600 dark:group-hover:text-teal-400'}`} />
              {badge && (
                <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-rose-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </div>
            {!isCollapsed && <span className="truncate text-[13px]">{translatedLabel}</span>}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <>
    <aside
      className={`hidden md:flex fixed left-0 top-0 h-full ${sidebarWidth} shrink-0 flex-col bg-white dark:bg-[#131b2e] border-r border-slate-200 dark:border-slate-800 transition-all duration-300 z-50`}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <Link
          to="/student/dashboard"
          className="flex items-center gap-3 overflow-hidden"
          aria-label="Vriddhi Institutions"
        >
          {isCollapsed ? (
            <VriddhiLogo variant="mark" height={32} reverse={resolvedMode === 'dark'} className="shrink-0" />
          ) : (
            <VriddhiLogo variant="horizontal" height={32} reverse={resolvedMode === 'dark'} className="shrink-0" />
          )}
          {!isCollapsed && (
            <span className="text-[10px] font-semibold text-teal-600 dark:text-teal-400 tracking-wider uppercase truncate">
              {t('nav.studentPortal')}
            </span>
          )}
        </Link>
        <button
          onClick={toggleCollapsed}
          className="flex p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
          aria-label={isCollapsed ? 'Expand menu' : 'Collapse menu'}
        >
          <ChevronRight
            className={`w-4 h-4 transition-transform duration-300 ${isCollapsed ? '' : 'rotate-180'}`}
          />
        </button>
      </div>

      {/* Profile Card */}
      {!isCollapsed && (
        <div className="p-3 mx-2 my-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
              {profile?.name?.charAt(0) || 'S'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-slate-900 dark:text-white text-xs font-bold truncate">
                {profile?.name || 'Student User'}
              </p>
              <p className="text-slate-500 dark:text-slate-400 text-[11px] truncate">
                {profile?.regNo || 'Reg. No'}
              </p>
              <span className="inline-block text-[10px] font-semibold text-teal-700 dark:text-teal-300 bg-teal-100/80 dark:bg-teal-950/60 px-1.5 py-0.5 rounded mt-0.5">
                {profile?.course || 'Undergraduate'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="p-2 overflow-y-auto flex-1">
        {topItems.map(renderItem)}
        {groupedItems.map((group) => (
          <div key={group.id} className="pt-3">
            {isCollapsed ? (
              <div className="mx-3 mb-1 border-t border-slate-200 dark:border-slate-800" />
            ) : (
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">{group.items.map(renderItem)}</div>
          </div>
        ))}
      </nav>

      {/* Bottom Controls */}
      <div className="p-2 border-t border-slate-200 dark:border-slate-800 shrink-0 space-y-1 bg-white dark:bg-[#131b2e]">
        {!isCollapsed && (
          <div className="px-1 pb-1">
            <LanguageSwitcher compact showLabel={false} className="w-full" />
          </div>
        )}
        {showInstallApp && (
          <button
            onClick={requestPwaInstall}
            title={isCollapsed ? 'Install app' : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-colors
              ${isCollapsed ? 'justify-center' : ''}
            `}
          >
            <Download className="w-4 h-4 shrink-0" />
            {!isCollapsed && <span>Install app</span>}
          </button>
        )}
        <button
          onClick={toggleMode}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors
            ${isCollapsed ? 'justify-center' : ''}
          `}
        >
          {resolvedMode === 'dark' ? <Sun className="w-4 h-4 shrink-0 text-amber-400" /> : <Moon className="w-4 h-4 shrink-0 text-slate-500" />}
          {!isCollapsed && <span>{resolvedMode === 'dark' ? t('common.lightMode') : t('common.darkMode')}</span>}
        </button>

        <button
          onClick={onSignOut}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors
            ${isCollapsed ? 'justify-center' : ''}
          `}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!isCollapsed && <span>{t('common.signOut')}</span>}
        </button>
      </div>
    </aside>
    {/* Spacer: the aside is fixed, so this reserves its column width. */}
    <div className={`hidden md:block ${sidebarWidth} shrink-0 transition-all duration-300`} />
    </>
  );
}
