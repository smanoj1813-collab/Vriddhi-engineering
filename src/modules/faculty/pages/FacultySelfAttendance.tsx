// src/modules/faculty/pages/FacultySelfAttendance.tsx
//
// "My Attendance" — a faculty member marking their OWN attendance.
//
// This is not the student attendance page (FacultyAttendance.tsx, where a
// teacher marks a class). Here the only subject is the signed-in faculty
// member, and the record lands in `staffAttendance`, which is what the
// principal's dashboard and reports read.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CalendarDays, Check, Clock, Download,
  Loader2, LogIn, LogOut, RotateCcw, Save, TrendingUp,
} from 'lucide-react';

import { useMyStaffAttendance } from '../hooks/useMyStaffAttendance';
import {
  STAFF_STATUS_LABEL,
  STAFF_STATUS_ORDER,
  STAFF_STATUS_SHORT,
  STAFF_STATUS_STYLE,
  type StaffAttendanceStatus,
} from '@/shared/types/staffAttendance';
import {
  buildRegister,
  dateKeysBetween,
  dayOfWeek,
  formatDayLabel,
  hoursBetween,
  monthBounds,
  monthKeyOf,
  monthLabel,
  nowTime,
  summarizeByFaculty,
} from '@/shared/utils/staffAttendanceStats';
import {
  buildStaffAttendanceReport,
  downloadAttendanceReport,
  exportFilename,
  type ExportFormat,
} from '@/shared/utils/attendanceExport';

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function StatusChip({ status, active, onClick }: { status: StaffAttendanceStatus; active: boolean; onClick: () => void }) {
  const style = STAFF_STATUS_STYLE[status];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-all
        ${active ? `${style.chip} ring-2 ring-teal-500/40 shadow-sm` : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600'}`}
    >
      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
      {STAFF_STATUS_LABEL[status]}
    </button>
  );
}

function StatTile({ label, value, tone = 'slate' }: { label: string; value: string | number; tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'teal' }) {
  const tones = {
    slate: 'text-slate-900 dark:text-white',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
    teal: 'text-teal-600 dark:text-teal-400',
  };
  return (
    <div className="glass-card p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</p>
    </div>
  );
}

export default function FacultySelfAttendance() {
  const {
    facultyId,
    facultyName,
    department,
    month,
    setMonth,
    range,
    form,
    setForm,
    records,
    recordForDate,
    selectDate,
    save,
    loading,
    saving,
    error,
    setError,
    savedAt,
    summary,
    today,
    collegeId,
  } = useMyStaffAttendance();

  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Selecting today on first load so the form shows an existing mark, if any.
  useEffect(() => {
    void selectDate(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `monthBounds` already handles short months and leap years, so the grid is
  // never asked to render a 31 February. Computed once and shared by the
  // calendar, the stats and the export so they cannot disagree.
  const monthWindow = useMemo(() => {
    const bounds = monthBounds(month) ?? range;
    return {
      kind: 'month' as const,
      start: bounds.start,
      end: bounds.end,
      label: monthLabel(month),
      month,
    };
  }, [month, range]);

  const monthDays = useMemo(() => dateKeysBetween(monthWindow.start, monthWindow.end), [monthWindow]);

  // The grid's first column is Sunday, but the 1st of the month rarely is —
  // pad with blank cells so every date lands under its real weekday. Without
  // this the whole month shifts (October 2026 starts on a Thursday: the 1st
  // rendered under "Sunday", Sundays read as Wednesdays, and today — a
  // Saturday — showed up in the Tuesday column).
  const leadBlanks = useMemo(() => {
    if (monthDays.length === 0) return 0;
    const firstDow = dayOfWeek(monthDays[0]);
    return firstDow >= 0 ? firstDow : 0;
  }, [monthDays]);

  const existing = recordForDate(form.date);
  const isFutureDate = form.date > today;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await save();
    if (ok) {
      setToast(`Attendance saved for ${formatDayLabel(form.date)}`);
      setError(null);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      // The roster id MUST be the real uid: summarizeByFaculty keys off
      // record.facultyId, and a placeholder here produced two rows — an empty
      // one for the placeholder and a second for the actual uid.
      const me = [{ id: facultyId, name: facultyName, department }];
      const register = buildRegister(records, me, monthWindow);
      const summaries = summarizeByFaculty(records, me, monthWindow);
      const report = buildStaffAttendanceReport({
        records,
        summaries,
        register,
        range: monthWindow,
        collegeName: department && department !== 'General' ? `Department: ${department}` : undefined,
      });
      const filename = await downloadAttendanceReport(format, 'my_attendance', monthWindow, {
        ...report,
        title: `${facultyName} — Attendance`,
      });
      setToast(`Downloaded ${filename}`);
    } catch (err) {
      console.error('[FacultySelfAttendance] export failed', err);
      setToast('Export failed — please try again.');
    } finally {
      setExporting(false);
    }
  };

  const counts = summary?.counts;
  const percentage = summary?.percentage ?? 0;

  return (
    <div className="page-container max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <Link
          to="/faculty/dashboard"
          className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:text-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
          aria-label="Back to dashboard"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="section-title mb-1">My Attendance</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Mark your own attendance. {facultyName}
            {department && department !== 'General' ? ` · ${department}` : ''} — your principal sees this in their dashboard.
          </p>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <button
            type="button"
            onClick={() => handleExport('excel')}
            disabled={exporting || records.length === 0}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {monthLabel(month)}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {/* pre-line: permission-denial errors now carry EVIDENCE lines
              (token claims at failure time + exact write path) */}
          <span className="whitespace-pre-line">{error}</span>
          <button type="button" onClick={() => setError(null)} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Marking form */}
      <form onSubmit={handleSubmit} className="glass-card mb-6 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-teal-600 dark:text-teal-400" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Mark attendance</h2>
          </div>
          {existing && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Check size={12} /> Already marked {STAFF_STATUS_LABEL[existing.status]}
              {existing.markedAt ? ` · ${new Date(existing.markedAt).toLocaleString('en-IN')}` : ''}
            </span>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Date</span>
                <input
                  type="date"
                  value={form.date}
                  max={today}
                  onChange={(e) => void selectDate(e.target.value)}
                  className="input-field w-auto"
                />
              </label>
              <button
                type="button"
                onClick={() => void selectDate(today)}
                className="btn-secondary h-[42px] text-sm"
              >
                Today
              </button>
            </div>

            <div>
              <span className="mb-2 block text-xs font-medium text-slate-500 dark:text-slate-400">Status</span>
              <div className="flex flex-wrap gap-2">
                {STAFF_STATUS_ORDER.map((status) => (
                  <StatusChip
                    key={status}
                    status={status}
                    active={form.status === status}
                    onClick={() => setForm((f) => ({ ...f, status }))}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  <LogIn size={12} className="mr-1 inline" />Check in
                </span>
                <div className="flex gap-2">
                  <input
                    type="time"
                    value={form.checkIn}
                    onChange={(e) => setForm((f) => ({ ...f, checkIn: e.target.value }))}
                    className="input-field"
                  />
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, checkIn: nowTime() }))}
                    className="btn-secondary shrink-0 text-xs"
                    title="Use current time"
                  >
                    <Clock size={14} /> Now
                  </button>
                </div>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  <LogOut size={12} className="mr-1 inline" />Check out
                </span>
                <div className="flex gap-2">
                  <input
                    type="time"
                    value={form.checkOut}
                    onChange={(e) => setForm((f) => ({ ...f, checkOut: e.target.value }))}
                    className="input-field"
                  />
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, checkOut: nowTime() }))}
                    className="btn-secondary shrink-0 text-xs"
                    title="Use current time"
                  >
                    <Clock size={14} /> Now
                  </button>
                </div>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Note (optional)</span>
              <input
                type="text"
                value={form.note}
                maxLength={160}
                placeholder="e.g. Duty at university exam centre"
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                className="input-field"
              />
            </label>
          </div>

          <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/50">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{formatDayLabel(form.date)}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{STAFF_STATUS_LABEL[form.status]}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {form.checkIn || '—'} → {form.checkOut || '—'}
                {form.checkIn && form.checkOut ? ` · ${hoursLabel(form.checkIn, form.checkOut)}` : ''}
              </p>
              {isFutureDate && (
                <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">Future dates cannot be marked.</p>
              )}
              {!collegeId && (
                <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                  No college on your account — saving will fail until an admin links it.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving || isFutureDate} className="btn-primary flex-1 text-sm disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {existing ? 'Update' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm((f) => ({ ...f, status: 'present', checkIn: '', checkOut: '', note: '' }));
                }}
                className="btn-secondary text-sm"
                title="Clear the form"
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Month stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Attendance" value={`${percentage}%`} tone={percentage >= 90 ? 'emerald' : percentage >= 75 ? 'teal' : percentage >= 60 ? 'amber' : 'rose'} />
        <StatTile label="Present" value={counts?.present ?? 0} tone="emerald" />
        <StatTile label="Late" value={counts?.late ?? 0} tone="amber" />
        <StatTile label="Leave" value={(counts?.leave ?? 0) + (counts?.medical ?? 0)} />
        <StatTile label="Absent" value={counts?.absent ?? 0} tone="rose" />
        <StatTile label="Not marked" value={summary?.unmarked ?? 0} />
      </div>

      {/* Month calendar */}
      <div className="glass-card mb-6 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
            <TrendingUp size={18} className="text-teal-600 dark:text-teal-400" />
            {monthLabel(month)}
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              max={monthKeyOf(today)}
              onChange={(e) => setMonth(e.target.value)}
              className="input-field w-auto text-sm"
            />
            <div className="flex gap-1">
              {(['csv', 'excel', 'pdf'] as ExportFormat[]).map((format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => handleExport(format)}
                  disabled={exporting || records.length === 0}
                  className="btn-secondary px-3 py-1.5 text-xs uppercase disabled:opacity-50"
                  title={`Download ${monthLabel(month)} as ${format.toUpperCase()}`}
                >
                  {format === 'excel' ? 'XLSX' : format.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-500 dark:text-slate-400">
            <Loader2 className="mr-2 animate-spin" size={18} /> Loading {monthLabel(month)}…
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {DAY_INITIALS.map((d, i) => (
              <div key={`head-${i}`} className="pb-1 text-center text-[11px] font-semibold uppercase text-slate-400">
                {d}
              </div>
            ))}
            {Array.from({ length: leadBlanks }, (_, i) => (
              <div key={`blank-${i}`} aria-hidden="true" />
            ))}
            {monthDays.map((date) => {
              const record = recordForDate(date);
              const dow = dayOfWeek(date);
              const isSunday = dow === 0;
              const isToday = date === today;
              const isFuture = date > today;
              const style = record ? STAFF_STATUS_STYLE[record.status] : null;
              return (
                <button
                  key={date}
                  type="button"
                  disabled={isFuture}
                  onClick={() => void selectDate(date)}
                  title={record ? `${formatDayLabel(date)} — ${STAFF_STATUS_LABEL[record.status]}` : `${formatDayLabel(date)} — not marked`}
                  className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border text-xs transition-all
                    ${isFuture ? 'cursor-not-allowed border-dashed border-slate-200 text-slate-300 dark:border-slate-800 dark:text-slate-600' : 'hover:border-teal-400 dark:hover:border-teal-500'}
                    ${style ? style.chip : isSunday ? 'border-slate-200 bg-slate-100/70 text-slate-400 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-500' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}
                    ${isToday ? 'ring-2 ring-teal-500/60' : ''}`}
                >
                  <span className="font-semibold">{Number(date.slice(8))}</span>
                  <span className="mt-0.5 text-[10px] font-bold">{record ? STAFF_STATUS_SHORT[record.status] : isSunday ? 'OFF' : '—'}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {STAFF_STATUS_ORDER.map((status) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${STAFF_STATUS_STYLE[status].dot}`} />
              {STAFF_STATUS_LABEL[status]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" /> Not marked / Sunday
          </span>
        </div>
      </div>

      {/* Recent records */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Recent entries</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">{records.length} record{records.length === 1 ? '' : 's'} in {monthLabel(month)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Date', 'Day', 'Status', 'In', 'Out', 'Hours', 'Note', 'Source'].map((h) => (
                  <th key={h} className="table-header whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 31).map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="table-cell whitespace-nowrap font-medium text-slate-900 dark:text-white">{r.date}</td>
                  <td className="table-cell whitespace-nowrap">{formatDayLabel(r.date).slice(0, 6)}</td>
                  <td className="table-cell">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${STAFF_STATUS_STYLE[r.status].chip}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${STAFF_STATUS_STYLE[r.status].dot}`} />
                      {STAFF_STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="table-cell whitespace-nowrap">{r.checkIn || '—'}</td>
                  <td className="table-cell whitespace-nowrap">{r.checkOut || '—'}</td>
                  <td className="table-cell whitespace-nowrap">{r.hoursWorked ? `${r.hoursWorked}h` : '—'}</td>
                  <td className="table-cell max-w-[240px] truncate" title={r.note}>{r.note || '—'}</td>
                  <td className="table-cell whitespace-nowrap text-xs capitalize text-slate-500 dark:text-slate-400">{r.source}</td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    No attendance marked yet for {monthLabel(month)}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400 dark:text-slate-500">
        Download filename preview: {exportFilename('my_attendance', monthWindow, 'excel')}
        {savedAt ? ` · Last saved ${new Date(savedAt).toLocaleTimeString('en-IN')}` : ''}
      </p>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 shadow-lg dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

/** `09:15` + `17:45` → `8.5h`. Lives next to the form that renders it. */
function hoursLabel(checkIn: string, checkOut: string): string {
  return `${hoursBetween(checkIn, checkOut)}h`;
}
