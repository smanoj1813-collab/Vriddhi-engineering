// src/modules/admin/components/FacultyAttendancePanel.tsx
//
// Faculty (staff) attendance analysis for the principal / admin / HOD.
//
// Rendered twice from the same component so the numbers cannot drift:
//   • AdminDashboard → "Faculty Attendance" tab
//   • /admin/faculty-attendance (sidebar link, full page)
//
// Everything here is read-only. A principal reviews and downloads; the faculty
// member owns their own record (firestore.rules enforces that).

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarRange, CheckCircle2, Download, FileSpreadsheet,
  FileText, Loader2, RefreshCw, Search, TimerReset, Users, XCircle,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '@/Firebase/config';
import { useStaffAttendanceAnalytics } from '../hooks/useStaffAttendanceAnalytics';
import {
  STAFF_STATUS_LABEL,
  STAFF_STATUS_ORDER,
  STAFF_STATUS_STYLE,
  type StaffAttendanceStatus,
} from '@/shared/types/staffAttendance';
import {
  buildStaffAttendanceReport,
  downloadAttendanceReport,
  type ExportFormat,
} from '@/shared/utils/attendanceExport';
import { formatDayLabel, monthLabel } from '@/shared/utils/staffAttendanceStats';

const CHART_COLORS: Record<StaffAttendanceStatus, string> = STAFF_STATUS_ORDER.reduce(
  (acc, s) => ({ ...acc, [s]: STAFF_STATUS_STYLE[s].hex }),
  {} as Record<StaffAttendanceStatus, string>,
);

function Kpi({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone: 'teal' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate' }) {
  const tones = {
    teal: 'text-teal-600 dark:text-teal-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
    violet: 'text-violet-600 dark:text-violet-400',
    slate: 'text-slate-900 dark:text-white',
  };
  return (
    <div className="glass-card p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export default function FacultyAttendancePanel({
  collegeId,
  collegeName: collegeNameProp,
  compact = false,
}: {
  collegeId: string | undefined;
  collegeName?: string;
  /** Dashboard tab hides the page-level heading. */
  compact?: boolean;
}) {
  const state = useStaffAttendanceAnalytics(collegeId);
  const {
    month, setMonth, kind, setKind, customStart, setCustomStart, customEnd, setCustomEnd,
    department, setDepartment, search, setSearch, departments, range, summaries, register,
    trend, totals, byDepartment, pendingToday, loading, error, reload, lastLoadedAt,
  } = state;

  const [collegeName, setCollegeName] = useState(collegeNameProp ?? '');
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (collegeNameProp) setCollegeName(collegeNameProp);
  }, [collegeNameProp]);

  useEffect(() => {
    if (!collegeId || collegeNameProp) return;
    let cancelled = false;
    getDoc(doc(db, 'colleges', collegeId))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const data = snap.data();
        setCollegeName(String(data.name || data.shortName || data.collegeName || ''));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [collegeId, collegeNameProp]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const pieData = useMemo(
    () =>
      STAFF_STATUS_ORDER.filter((s) => totals.counts[s] > 0).map((s) => ({
        name: STAFF_STATUS_LABEL[s],
        status: s,
        value: totals.counts[s],
      })),
    [totals.counts],
  );

  const trendData = useMemo(
    () => trend.map((d) => ({ ...d, short: d.date.slice(8) })),
    [trend],
  );

  const handleExport = async (format: ExportFormat) => {
    setExporting(format);
    try {
      const report = buildStaffAttendanceReport({
        records: state.records,
        summaries,
        register,
        range,
        collegeName,
      });
      const filename = await downloadAttendanceReport(format, 'faculty_attendance', range, report);
      setToast(`Downloaded ${filename}`);
    } catch (err) {
      console.error('[FacultyAttendancePanel] export failed', err);
      setToast(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(null);
    }
  };

  if (!collegeId) {
    return (
      <div className="glass-card flex flex-col items-center justify-center gap-2 p-10 text-center">
        <AlertTriangle className="text-amber-500" size={28} />
        <p className="font-medium text-slate-900 dark:text-white">No college linked to your account</p>
        <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
          Faculty attendance is scoped to a college. Ask a superadmin to attach your account to a college, then reload.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      {!compact && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Faculty Attendance</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Self-marked staff attendance for {collegeName || 'your college'} · {range.label}
            </p>
          </div>
        </div>
      )}

      {/* Controls: range + filters + download */}
      <div className="glass-card flex flex-wrap items-end gap-3 p-4">
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Period</span>
          <div className="flex gap-1 rounded-xl border border-slate-200 p-1 dark:border-slate-700">
            {([
              { value: 'month', label: 'Month' },
              { value: 'custom', label: 'Date range' },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setKind(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  kind === opt.value
                    ? 'bg-teal-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {kind === 'month' ? (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Month</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input-field w-auto text-sm" />
          </label>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">From</span>
              <input
                type="date"
                value={customStart}
                onChange={(e) => { setCustomStart(e.target.value); setKind('custom'); }}
                className="input-field w-auto text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">To</span>
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onChange={(e) => { setCustomEnd(e.target.value); setKind('custom'); }}
                className="input-field w-auto text-sm"
              />
            </label>
          </>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Department</span>
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className="input-field w-auto text-sm">
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>

        <label className="block min-w-[180px] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Search</span>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Faculty name or email…"
              className="input-field pl-9 text-sm"
            />
          </div>
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void reload()} className="btn-secondary text-sm" title="Reload">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <div className="flex overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            {([
              { format: 'csv' as ExportFormat, icon: Download, label: 'CSV' },
              { format: 'excel' as ExportFormat, icon: FileSpreadsheet, label: 'XLSX' },
              { format: 'pdf' as ExportFormat, icon: FileText, label: 'PDF' },
            ]).map(({ format, icon: Icon, label }) => (
              <button
                key={format}
                type="button"
                onClick={() => handleExport(format)}
                disabled={exporting !== null || summaries.length === 0}
                className="flex items-center gap-1.5 border-r border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors last:border-r-0 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                title={`Download ${range.label} as ${label}`}
              >
                {exporting === format ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Attendance" value={`${totals.percentage}%`} hint={range.label} tone={totals.percentage >= 90 ? 'emerald' : totals.percentage >= 75 ? 'teal' : totals.percentage >= 60 ? 'amber' : 'rose'} />
        <Kpi label="Faculty" value={totals.rosterSize} hint="in scope" tone="slate" />
        <Kpi label="Present" value={totals.counts.present} tone="emerald" />
        <Kpi label="Late" value={totals.counts.late} tone="amber" />
        <Kpi label="Leave" value={totals.counts.leave + totals.counts.medical} tone="violet" />
        <Kpi label="Absent" value={totals.counts.absent} tone="rose" />
      </div>

      {loading && (
        <div className="glass-card flex items-center justify-center gap-2 p-8 text-slate-500 dark:text-slate-400">
          <Loader2 className="animate-spin" size={18} /> Loading faculty attendance…
        </div>
      )}

      {!loading && totals.rosterSize === 0 && (
        <div className="glass-card flex flex-col items-center gap-2 p-10 text-center">
          <Users className="text-slate-400" size={28} />
          <p className="font-medium text-slate-900 dark:text-white">No faculty in scope</p>
          <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
            {search || department !== 'all'
              ? 'No faculty match the current filter.'
              : 'No active faculty profiles are linked to this college yet. Import faculty from the superadmin console, or clear the filters above.'}
          </p>
        </div>
      )}

      {!loading && totals.rosterSize > 0 && (
        <>
          {/* Charts */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="glass-card p-5 lg:col-span-2">
              <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                <CalendarRange size={16} className="text-teal-600 dark:text-teal-400" />
                Daily attendance trend
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={trendData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                  <XAxis dataKey="short" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }}
                    labelStyle={{ color: '#e2e8f0' }}
                    labelFormatter={(_, payload) => {
                      const item = payload?.[0]?.payload as { label?: string } | undefined;
                      return item?.label ?? '';
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="present" name="Present" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="late" name="Late" stackId="a" fill="#f59e0b" />
                  <Bar dataKey="leave" name="Leave" stackId="a" fill="#8b5cf6" />
                  <Bar dataKey="absent" name="Absent" stackId="a" fill="#ef4444" />
                  <Bar dataKey="unmarked" name="Not marked" stackId="a" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="glass-card p-5">
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">Status split</h3>
              {pieData.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">No records in this period.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3}>
                        {pieData.map((entry) => (
                          <Cell key={entry.status} fill={CHART_COLORS[entry.status]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                    {pieData.map((entry) => (
                      <span key={entry.status} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[entry.status] }} />
                        {entry.name}: <b>{entry.value}</b>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Department + pending today */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="glass-card p-5">
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">Department comparison</h3>
              {byDepartment.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No data.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(160, byDepartment.length * 42)}>
                  <BarChart data={byDepartment} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                    <XAxis type="number" domain={[0, 100]} stroke="#94a3b8" fontSize={11} unit="%" />
                    <YAxis type="category" dataKey="department" stroke="#94a3b8" fontSize={11} width={110} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }}
                      formatter={(value) => [`${Number(value ?? 0)}%`, 'Attendance']}
                    />
                    <Bar dataKey="percentage" name="Attendance" fill="#14b8a6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="glass-card p-5">
              <h3 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                <TimerReset size={16} className="text-amber-500" />
                Not marked today
              </h3>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Faculty with no attendance record for {formatDayLabel(new Date().toISOString().slice(0, 10))}.
              </p>
              {pendingToday.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle2 size={16} /> Everyone in scope has marked today.
                </p>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {pendingToday.slice(0, 40).map((member) => (
                    <li key={member.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{member.name}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{member.department}</span>
                    </li>
                  ))}
                  {pendingToday.length > 40 && (
                    <li className="px-3 py-1 text-xs text-slate-500 dark:text-slate-400">+{pendingToday.length - 40} more</li>
                  )}
                </ul>
              )}
            </div>
          </div>

          {/* Per-faculty table */}
          <div className="glass-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Faculty summary · {range.label}</h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {summaries.length} faculty · {totals.marked} records
                {lastLoadedAt ? ` · updated ${new Date(lastLoadedAt).toLocaleTimeString('en-IN')}` : ''}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Faculty</th>
                    <th className="table-header">Department</th>
                    <th className="table-header text-center">Working days</th>
                    <th className="table-header text-center">Marked</th>
                    {STAFF_STATUS_ORDER.map((s) => (
                      <th key={s} className="table-header text-center" title={STAFF_STATUS_LABEL[s]}>
                        {STAFF_STATUS_LABEL[s].split(' ')[0]}
                      </th>
                    ))}
                    <th className="table-header text-right">Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((s) => (
                    <tr key={s.facultyId} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="table-cell">
                        <p className="font-medium text-slate-900 dark:text-white">{s.facultyName}</p>
                        {s.designation && <p className="text-xs text-slate-500 dark:text-slate-400">{s.designation}</p>}
                      </td>
                      <td className="table-cell whitespace-nowrap">{s.department || 'General'}</td>
                      <td className="table-cell text-center">{s.expectedDays}</td>
                      <td className="table-cell text-center">
                        {s.marked}
                        {s.unmarked > 0 && (
                          <span className="ml-1 text-xs text-amber-600 dark:text-amber-400" title={`${s.unmarked} working day(s) not marked`}>
                            ({s.unmarked}✕)
                          </span>
                        )}
                      </td>
                      {STAFF_STATUS_ORDER.map((status) => (
                        <td key={status} className="table-cell text-center">
                          {s.counts[status] > 0 ? (
                            <span className={`inline-flex min-w-[26px] justify-center rounded-md border px-1.5 py-0.5 text-xs font-semibold ${STAFF_STATUS_STYLE[status].chip}`}>
                              {s.counts[status]}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300 dark:text-slate-400">–</span>
                          )}
                        </td>
                      ))}
                      <td className="table-cell text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div
                              className={`h-full rounded-full ${s.percentage >= 90 ? 'bg-emerald-500' : s.percentage >= 75 ? 'bg-teal-500' : s.percentage >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`}
                              style={{ width: `${Math.min(s.percentage, 100)}%` }}
                            />
                          </div>
                          <span className={`w-12 text-right text-sm font-semibold ${s.percentage >= 90 ? 'text-emerald-600 dark:text-emerald-400' : s.percentage >= 75 ? 'text-teal-600 dark:text-teal-400' : s.percentage >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {s.percentage}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monthly register */}
          <div className="glass-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Register · {monthLabel(range.month ?? month)}</h3>
              <div className="flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                {STAFF_STATUS_ORDER.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <span className={`h-2 w-2 rounded-full ${STAFF_STATUS_STYLE[s].dot}`} />
                    {STAFF_STATUS_LABEL[s]}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1">
                  <XCircle size={11} /> – = not marked
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="table-header sticky left-0 bg-slate-50 dark:bg-slate-900">Faculty</th>
                    {register.dates.map((d) => (
                      <th key={d} className="table-header px-1 text-center font-medium" title={formatDayLabel(d)}>
                        {Number(d.slice(8))}
                      </th>
                    ))}
                    <th className="table-header text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {register.rows.map((row) => (
                    <tr key={row.facultyId} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="table-cell sticky left-0 max-w-[180px] truncate whitespace-nowrap bg-white font-medium text-slate-900 dark:bg-slate-900 dark:text-white">
                        {row.facultyName}
                      </td>
                      {row.cells.map((cell, i) => (
                        <td key={`${row.facultyId}-${register.dates[i]}`} className="border-b border-slate-100 px-1 py-2 text-center dark:border-slate-800/60">
                          {cell ? (
                            <span className={`inline-flex min-w-[22px] justify-center rounded border px-1 py-0.5 font-semibold ${STAFF_STATUS_STYLE[cell].chip}`}>
                              {cell === 'present' ? 'P' : cell === 'late' ? 'L' : cell === 'halfday' ? 'H' : cell === 'absent' ? 'A' : cell === 'leave' ? 'LV' : cell === 'medical' ? 'ML' : cell === 'onduty' ? 'OD' : 'W'}
                            </span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-400">–</span>
                          )}
                        </td>
                      ))}
                      <td className="table-cell text-right font-semibold text-slate-700 dark:text-slate-200">{row.percentage}%</td>
                    </tr>
                  ))}
                  {register.rows.length === 0 && (
                    <tr>
                      <td colSpan={register.dates.length + 2} className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                        Nothing to show for {range.label}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800 shadow-lg dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-300">
          <Download size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
