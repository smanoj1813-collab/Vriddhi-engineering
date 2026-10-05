// src/modules/admin/pages/BranchConductionPage.tsx
//
// Principal oversight — "Branch-wise Assessment Conduction". A read-only
// pulse of how assessments are running per branch: upcoming / ongoing /
// completed counts plus the tests that need eyes right now. Built entirely
// on the existing listManagedAssessmentTests callable (the principal already
// passes its role gate); no scheduling controls live here — the principal
// oversees, HOD/faculty conduct.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Clock, CheckCircle2, CalendarClock, RefreshCw, AlertTriangle } from 'lucide-react'
import { listScheduledTests } from '../api/assessmentsApi'
import { summarizeBranchConduction, type ConductionTestLike } from '../utils/branchConduction'

function CountCell({ label, value, tone }: { label: string; value: number; tone: 'sky' | 'amber' | 'emerald' }) {
  const tones = {
    sky: 'text-sky-600 dark:text-sky-400',
    amber: 'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
  } as const
  return (
    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
      <p className={`text-xl font-extrabold ${tones[tone]}`}>{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}

export default function BranchConductionPage() {
  const [tests, setTests] = useState<ConductionTestLike[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listScheduledTests()
      setTests(list as unknown as ConductionTestLike[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load assessments.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const summaries = useMemo(() => summarizeBranchConduction(tests), [tests])
  const totals = useMemo(
    () =>
      summaries.reduce(
        (acc, s) => ({ upcoming: acc.upcoming + s.upcoming, ongoing: acc.ongoing + s.ongoing, completed: acc.completed + s.completed }),
        { upcoming: 0, ongoing: 0, completed: 0 }
      ),
    [summaries]
  )

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-teal-500" /> Branch-wise Assessment Conduction
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Oversight only — scheduling and conduction stay with the departments.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="h-32 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-6 rounded-2xl border border-dashed border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20 text-center">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Could not load assessments</p>
          <p className="text-xs text-slate-500 mt-1">{error}</p>
          <button onClick={load} className="mt-4 px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-bold">
            Retry
          </button>
        </div>
      ) : summaries.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-center">
          <CalendarClock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">No assessments scheduled yet</p>
          <p className="text-xs text-slate-500 mt-1">
            When departments schedule tests, the branch-wise conduction picture appears here.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <CountCell label="Upcoming" value={totals.upcoming} tone="sky" />
            <CountCell label="Ongoing" value={totals.ongoing} tone="amber" />
            <CountCell label="Completed" value={totals.completed} tone="emerald" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {summaries.map((summary) => (
              <div key={summary.branch} className="p-4 rounded-2xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h2 className="font-bold text-sm text-slate-900 dark:text-white truncate">{summary.branch}</h2>
                  {summary.ongoing > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      Live now
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <CountCell label="Upcoming" value={summary.upcoming} tone="sky" />
                  <CountCell label="Ongoing" value={summary.ongoing} tone="amber" />
                  <CountCell label="Done" value={summary.completed} tone="emerald" />
                </div>
                {summary.active.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Nothing scheduled right now.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {summary.active.slice(0, 4).map((test) => (
                      <li key={test.id} className="flex items-start gap-2 text-xs">
                        {test.bucket === 'ongoing' ? (
                          <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-sky-500 shrink-0 mt-0.5" />
                        )}
                        <span className="min-w-0">
                          <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate">{test.title}</span>
                          {test.subject && <span className="text-slate-500 block truncate">{test.subject}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
