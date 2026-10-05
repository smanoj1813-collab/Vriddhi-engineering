// src/modules/student/pages/StudentHubPage.tsx
//
// The phone's "Academics" and "Learning" tabs.
//
// The bottom bar can only carry four destinations, so the two section
// headings that already organise the sidebar, the dashboard quick tiles and
// the "More" sheet get a landing page of their own. The tiles come from the
// nav model — a page added to a group shows up here without touching this
// file, and no page can exist on the sidebar but be missing from its hub.
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from '../../../shared/contexts/LanguageProvider'
import type { TranslationKey } from '../../../shared/i18n'
import { useStudentData } from '../hooks/useStudentData'
import { STUDENT_NAV_GROUPS, navItemsInGroup, type StudentNavGroup } from '../studentNav'

interface StudentHubPageProps {
  group: StudentNavGroup
}

const GROUP_BLURB: Partial<Record<StudentNavGroup, string>> = {
  academics: 'Attendance, assignments, grades, timetable and curriculum — everything your programme is measured on.',
  practice: 'Study materials, the coding lab, placement prep, the library, your learning journey and faculty support.',
}

export default function StudentHubPage({ group }: StudentHubPageProps) {
  const { t } = useTranslation()
  const { profile, codingLabEnabled, assignmentsEnabled, placementPrepEnabled } = useStudentData()
  const definition = STUDENT_NAV_GROUPS.find((entry) => entry.id === group)
  const items = navItemsInGroup(group, profile, codingLabEnabled, assignmentsEnabled, placementPrepEnabled)

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-4">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {definition?.label || 'Academics'}
        </h1>
        {GROUP_BLURB[group] && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{GROUP_BLURB[group]}</p>
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const Icon = item.icon
          const label = item.translationKey
            ? t(item.translationKey as TranslationKey)
            : item.label
          return (
            <Link
              key={item.id}
              to={item.path}
              className="flex min-h-[74px] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors active:border-teal-300 active:bg-teal-50 dark:border-slate-800 dark:bg-slate-900/60 dark:active:border-teal-800 dark:active:bg-teal-950/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">{label}</span>
                {item.hint && (
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    {item.hint}
                  </span>
                )}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
