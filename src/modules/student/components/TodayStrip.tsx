// src/modules/student/components/TodayStrip.tsx
//
// One Vriddhi Phase B — the three-pillar pulse on the dashboard. Instead of a
// directory of pages, the student's home starts with WHAT TO DO NEXT across
// Learning, Assessment and Practice — composed from data the dashboard already
// loaded (useStudentData), so this adds ZERO fetches. Every row deep-links
// into its pillar; rows with nothing to say simply don't render.

import { Link } from 'react-router-dom'
import { BookOpen, Calendar, FileText, Target } from 'lucide-react'
import { useStudentData } from '../hooks/useStudentData'
import { buildTodayItems, type TodayItem } from '../utils/todayStrip'

const ITEM_ICONS: Record<TodayItem['id'], typeof Calendar> = {
  class: Calendar,
  assignment: FileText,
  test: BookOpen,
  practice: Target,
}

const ITEM_STYLES: Record<TodayItem['id'], string> = {
  class: 'border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-300 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200',
  assignment: 'border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200',
  test: 'border-blue-200 bg-blue-50 text-blue-800 hover:border-blue-300 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200',
  practice: 'border-teal-200 bg-teal-50 text-teal-800 hover:border-teal-300 dark:border-teal-900/60 dark:bg-teal-950/40 dark:text-teal-200',
}

export default function TodayStrip() {
  const { schedule, assignments, tests, assignmentsEnabled, placementPrepEnabled, codingLabEnabled } = useStudentData()
  const items = buildTodayItems({ schedule, assignments, tests, assignmentsEnabled, placementPrepEnabled, codingLabEnabled })
  if (items.length === 0) return null

  return (
    <section aria-label="Today" className="flex flex-wrap items-center gap-2" data-testid="today-strip">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        Today
      </span>
      {items.map((item) => {
        const Icon = ITEM_ICONS[item.id]
        return (
          <Link
            key={item.id}
            to={item.to}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${ITEM_STYLES[item.id]}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {item.label}
          </Link>
        )
      })}
    </section>
  )
}
