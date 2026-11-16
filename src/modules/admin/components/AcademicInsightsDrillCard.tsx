// src/modules/admin/components/AcademicInsightsDrillCard.tsx
//
// Principal-overview entry point into the Academic Insights drill-down
// (overview → semester → subject). Cost rules (docs/firestore-cost-controls.md):
//  - ONE bounded callable call per client per 5 min (staleTime). The server
//    also caches for 90 s (C8), so this card never polls and never refetches
//    on window focus or remount inside the stale window.
//  - Only the summary totals are shown here. The drill-down page fetches once
//    and groups in memory; this card does not fan out per level.

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, BookOpen } from 'lucide-react'
import { getAcademicInsights } from '../api/academicInsightsApi'

const FIVE_MINUTES = 5 * 60 * 1000

export default function AcademicInsightsDrillCard() {
  const q = useQuery({
    queryKey: ['principalDashboard', 'academicInsightsSummary'],
    queryFn: () => getAcademicInsights({}),
    staleTime: FIVE_MINUTES,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })

  const totals = q.data?.totals
  const metrics: Array<{ label: string; value: number | undefined }> = [
    { label: 'Semesters', value: totals?.semesters },
    { label: 'Subjects', value: totals?.subjects },
    { label: 'Faculty', value: totals?.faculty },
    { label: 'Students', value: totals?.students },
  ]

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-[#131b2e]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
            <BookOpen size={18} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Academic Insights</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Curriculum coverage, classes, attendance and scores</p>
          </div>
        </div>
        <Link
          to="/admin/academic-insights"
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-500/10"
        >
          Open drilldown <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>

      {q.isError ? (
        <p className="mt-4 text-xs text-rose-600 dark:text-rose-300">Academic insights could not be loaded. Open the drilldown to retry.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-900/60">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{m.label}</p>
              <p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white">
                {q.isLoading || m.value === undefined ? '…' : m.value.toLocaleString('en-IN')}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
