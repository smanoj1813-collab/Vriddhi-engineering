// src/modules/admin/pages/AssignmentAnalytics.tsx
// Assignment completion reporting: completion % by course/module/batch/division
// plus overdue alerts. All numbers come from the getAssignmentAnalytics
// callable (staff-scoped server-side), so faculty and admin cannot see two
// different truths.

import React, { useCallback, useEffect, useState } from 'react'
import {
  BarChart3, BookOpen, Download, Loader2, RefreshCw, AlertTriangle,
  ClipboardCheck, CheckCircle2, Clock,
} from 'lucide-react'
import {
  getAssignmentAnalytics,
  type AssignmentAnalyticsResult,
  type GroupCompletion,
} from '../api/assignmentAnalyticsApi'
import { useCollegeModules } from '@/shared/hooks/useCollegeModules'

// ─── Small display helpers ───────────────────────────────────────────────────

function formatDeadline(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function pctColor(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500'
  if (pct >= 50) return 'bg-amber-500'
  return 'bg-rose-500'
}

const STATUS_LABELS: Record<string, string> = {
  published: 'Published',
  ongoing: 'Ongoing',
  closed: 'Closed',
  graded: 'Graded',
}

// ─── Group completion list (course / module / batch / division) ─────────────

function GroupSection({ title, icon: Icon, groups }: {
  title: string
  icon: React.ElementType
  groups: GroupCompletion[]
}) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-vriddhi-accent" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      </div>
      {groups.length === 0 ? (
        <p className="text-xs text-vriddhi-muted py-6 text-center">No linked data yet</p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-900 dark:text-white font-medium truncate min-w-0 pr-2">{group.label}</span>
                <span className="text-vriddhi-muted shrink-0">
                  {group.submitted}/{group.expected || 0} · {group.pct}%
                </span>
              </div>
              <div className="h-2 bg-vriddhi-dark rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${pctColor(group.pct)}`}
                  style={{ width: `${group.pct}%` }}
                />
              </div>
              <p className="text-[10px] text-vriddhi-muted/70 mt-0.5">
                {group.assignments} assignment{group.assignments === 1 ? '' : 's'}
                {group.late > 0 && ` · ${group.late} late`}
                {group.missing > 0 && ` · ${group.missing} missing`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function AssignmentAnalytics() {
  const { assignmentsEnabled } = useCollegeModules()
  const [data, setData] = useState<AssignmentAnalyticsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getAssignmentAnalytics())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the assignment report.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!assignmentsEnabled) {
      setLoading(false)
      return
    }
    load()
  }, [load, assignmentsEnabled])

  // Deep-link guard for the college-level Assignments module toggle.
  if (!assignmentsEnabled) {
    return (
      <div className="max-w-lg mx-auto mt-16">
        <div className="glass-card p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Assignments is switched off for this college</h2>
          <p className="text-sm text-vriddhi-muted">
            This college does not use the Assignments module right now, so there is no completion report. A college administrator can turn it back on in Settings → Modules.
          </p>
        </div>
      </div>
    )
  }

  const handleExport = () => {
    if (!data) return
    const lines: string[][] = []
    lines.push(['Assignment Analytics', `Generated ${new Date(data.generatedAt).toLocaleString('en-IN')}`])
    lines.push([])
    lines.push(['Overall', `${data.overall.submitted}/${data.overall.expected} submitted`, `${data.overall.pct}%`, `${data.overall.overdue} overdue`, `${data.overall.ungraded} ungraded`])
    lines.push([])
    lines.push(['Group', 'Assignments', 'Submitted', 'Expected', 'Late', 'Graded', 'Missing', 'Pct'])
    for (const section of ['byCourse', 'byModule', 'byBatch', 'byDivision'] as const) {
      for (const g of data.groups[section]) {
        lines.push([`${section.replace('by', '')}: ${g.key}`, String(g.assignments), String(g.submitted), String(g.expected), String(g.late), String(g.graded), String(g.missing), `${g.pct}%`])
      }
    }
    lines.push([])
    lines.push(['Assignment', 'Course', 'Module', 'Batch', 'Division', 'Status', 'Deadline', 'Submitted', 'Expected', 'Late', 'Graded', 'Missing', 'Pct', 'Overdue'])
    for (const row of data.rows) {
      lines.push([
        row.title, row.courseName, row.moduleTitle, row.batch, row.division, row.status,
        row.deadline ? row.deadline.slice(0, 10) : '', String(row.submitted), String(row.expected),
        String(row.late), String(row.graded), String(row.missing), `${row.completionPct}%`,
        row.overdue ? `yes (${row.overdueDays}d)` : '',
      ])
    }
    const csv = lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `assignment_analytics_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-vriddhi-accent" />
        <p className="text-sm text-vriddhi-muted mt-3">Computing the assignment report…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-lg mx-auto mt-16">
        <div className="glass-card p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Report unavailable</h2>
          <p className="text-sm text-vriddhi-muted mb-4">{error || 'No data returned.'}</p>
          <button
            onClick={load}
            className="px-4 py-2 bg-vriddhi-accent text-white rounded-xl text-sm hover:bg-teal-600 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const { overall, groups, overdueAlerts, rows } = data

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-8 gap-4">
        <div>
          <h1 className="section-title mb-1 flex items-center gap-3">
            <BarChart3 className="w-7 h-7 text-vriddhi-accent" />
            Assignment Analytics
          </h1>
          <p className="text-vriddhi-muted">
            Completion by course, module, batch and division{data.scope === 'own' ? ' — your assignments' : ''} · roster of {data.rosterSize} student{data.rosterSize === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 bg-vriddhi-card border border-vriddhi-border rounded-xl text-sm text-vriddhi-text hover:bg-vriddhi-border/50 transition-colors"
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-vriddhi-accent text-white rounded-xl text-sm hover:bg-teal-600 transition-colors"
          >
            <Download size={16} /> Export CSV
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-vriddhi-muted">Assignments</span>
            <BookOpen className="w-4 h-4 text-vriddhi-accent" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{overall.assignments}</p>
          <p className="text-[10px] text-vriddhi-muted/70 mt-1">Published through graded</p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-vriddhi-muted">Completion</span>
            <ClipboardCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{overall.pct}%</p>
          <p className="text-[10px] text-vriddhi-muted/70 mt-1">{overall.submitted} of {overall.expected} expected submissions</p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-vriddhi-muted">Overdue alerts</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <p className={`text-2xl font-bold ${overall.overdue > 0 ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>{overall.overdue}</p>
          <p className="text-[10px] text-vriddhi-muted/70 mt-1">Past deadline with missing students</p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-vriddhi-muted">Ungraded</span>
            <CheckCircle2 className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{overall.ungraded}</p>
          <p className="text-[10px] text-vriddhi-muted/70 mt-1">Submitted and waiting for a grade · {overall.late} late overall</p>
        </div>
      </div>

      {/* Overdue alerts */}
      <div className="glass-card overflow-hidden mb-8">
        <div className="p-5 border-b border-vriddhi-border flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-500" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Overdue Alerts</h3>
        </div>
        {overdueAlerts.length === 0 ? (
          <p className="text-xs text-vriddhi-muted py-8 text-center">
            Nothing overdue — every open assignment still has students inside the deadline.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-vriddhi-border">
                  <th className="table-header">Assignment</th>
                  <th className="table-header">Course → Module</th>
                  <th className="table-header">Cohort</th>
                  <th className="table-header">Deadline</th>
                  <th className="table-header text-center">Overdue</th>
                  <th className="table-header text-center">Missing</th>
                </tr>
              </thead>
              <tbody>
                {overdueAlerts.map((row) => (
                  <tr key={row.assignmentId} className="hover:bg-vriddhi-dark/30 transition-colors">
                    <td className="table-cell font-medium text-slate-900 dark:text-white">{row.title}</td>
                    <td className="table-cell">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 dark:text-violet-300">
                        <BookOpen className="w-3 h-3 shrink-0" />
                        {row.moduleTitle ? `${row.courseName} → ${row.moduleTitle}` : row.courseName}
                      </span>
                    </td>
                    <td className="table-cell text-vriddhi-muted text-xs">
                      {[row.batch, row.division].filter(Boolean).join(' · ') || 'Specific students'}
                    </td>
                    <td className="table-cell">{formatDeadline(row.deadline)}</td>
                    <td className="table-cell text-center">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300 ring-1 ring-rose-500/20">
                        <Clock className="w-3 h-3" /> {row.overdueDays}d
                      </span>
                    </td>
                    <td className="table-cell text-center">
                      <span className="font-semibold text-rose-600 dark:text-rose-400">{row.missing}</span>
                      <span className="text-vriddhi-muted">/{row.expected}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Grouped completion */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <GroupSection title="By Course" icon={BookOpen} groups={groups.byCourse} />
        <GroupSection title="By Module" icon={BookOpen} groups={groups.byModule} />
        <GroupSection title="By Batch" icon={ClipboardCheck} groups={groups.byBatch} />
        <GroupSection title="By Division" icon={ClipboardCheck} groups={groups.byDivision} />
      </div>

      {/* Per-assignment table */}
      <div className="glass-card overflow-hidden mb-8">
        <div className="p-5 border-b border-vriddhi-border">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Per Assignment</h3>
          <p className="text-xs text-vriddhi-muted mt-1">
            Completion = students who submitted ÷ students targeted. Missing students appear as overdue once the deadline passes.
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-vriddhi-muted py-10 text-center">
            No published assignments yet. Faculty publish from Assignments, and admin can attach an assignment
            when generating class sessions from the timetable.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-vriddhi-border">
                  <th className="table-header">Assignment</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Deadline</th>
                  <th className="table-header text-center">Submitted</th>
                  <th className="table-header text-center">Late</th>
                  <th className="table-header text-center">Graded</th>
                  <th className="table-header text-center">Missing</th>
                  <th className="table-header">Completion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.assignmentId} className="hover:bg-vriddhi-dark/30 transition-colors">
                    <td className="table-cell">
                      <p className="font-medium text-slate-900 dark:text-white">{row.title}</p>
                      <p className="text-[10px] text-vriddhi-muted">
                        {row.moduleTitle ? `${row.courseName} → ${row.moduleTitle}` : row.courseName}
                        {[row.batch, row.division].filter(Boolean).length > 0 &&
                          ` · ${[row.batch, row.division].filter(Boolean).join(' · ')}`}
                      </p>
                    </td>
                    <td className="table-cell">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-vriddhi-dark text-vriddhi-text">
                        {STATUS_LABELS[row.status] || row.status}
                      </span>
                    </td>
                    <td className="table-cell">
                      {formatDeadline(row.deadline)}
                      {row.overdue && (
                        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300 ring-1 ring-rose-500/20">
                          {row.overdueDays}d over
                        </span>
                      )}
                    </td>
                    <td className="table-cell text-center">{row.submitted}/{row.expected}</td>
                    <td className="table-cell text-center">{row.late}</td>
                    <td className="table-cell text-center">{row.graded}</td>
                    <td className="table-cell text-center">
                      <span className={row.missing > 0 ? 'text-rose-500 font-semibold' : ''}>{row.missing}</span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-vriddhi-dark rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pctColor(row.completionPct)}`}
                            style={{ width: `${row.completionPct}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-900 dark:text-white w-10">{row.completionPct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-center text-xs text-vriddhi-muted/40 pb-4">
        Computed server-side from assignments, submissions and the student roster · refreshed{' '}
        {new Date(data.generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}
