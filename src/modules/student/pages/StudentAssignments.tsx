import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Clock, CheckCircle2, XCircle, AlertTriangle, FileUp, Upload, BookOpen, ChevronRight } from 'lucide-react';
import { useStudentData } from '../hooks/useStudentData';
import AssignmentUploadModal from '../components/AssignmentUploadModal';
import { linkageBadgeText } from '../utils/deadlineCountdown';
import type { Assignment } from '../types/student';

type FilterKey = 'pending' | 'submitted' | 'graded' | 'all';

const statusConfig: Record<string, { icon: typeof Clock; color: string; bg: string; label: string }> = {
  pending: { icon: Clock, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800', label: 'Pending' },
  overdue: { icon: XCircle, color: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800', label: 'Overdue' },
  submitted: { icon: CheckCircle2, color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800', label: 'Submitted' },
  'late-submitted': { icon: AlertTriangle, color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-50 border-orange-200 dark:bg-orange-950/40 dark:border-orange-800', label: 'Late' },
  graded: { icon: CheckCircle2, color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-800', label: 'Graded' },
};

/** The "course" an assignment belongs to — linked course first, subject fallback. */
const courseOf = (a: Assignment): string => a.courseName?.trim() || a.subject?.trim() || 'General';

export default function StudentAssignments() {
  const { assignments, loading, error, warnings, refresh, assignmentsEnabled } = useStudentData();
  const [filter, setFilter] = useState<FilterKey>('pending');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Assignment | null>(null);

  // Deep-link guard: the nav hides this page when the college switches the
  // Assignments module off, but a bookmarked URL must get the same answer.
  if (!assignmentsEnabled) {
    return (
      <section className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm dark:border-amber-900/60 dark:bg-[#131b2e]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-lg font-extrabold text-slate-900 dark:text-white">Assignments is switched off for your college</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          This college does not use the Assignments module right now. If you think it should be available, contact your college administrator.
        </p>
        <Link to="/student/academics" className="mt-4 inline-flex rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white hover:bg-teal-700">
          Back to Academics
        </Link>
      </section>
    );
  }

  const handleSubmitted = () => {
    refresh();
  };

  // Distinct courses across the loaded assignments (linked course name, or
  // the subject when the faculty published it without a curriculum link).
  const courses = useMemo(() => {
    const set = new Set<string>();
    assignments.forEach((a) => set.add(courseOf(a)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [assignments]);

  const filtered = useMemo(() => {
    const list = assignments.filter((a) => {
      const matchesStatus = filter === 'all' || a.status === filter;
      const matchesCourse = courseFilter === 'all' || courseOf(a) === courseFilter;
      return matchesStatus && matchesCourse;
    });
    return [...list].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  }, [assignments, filter, courseFilter]);

  const counts = useMemo(() => ({
    pending: assignments.filter((a) => a.status === 'pending').length,
    submitted: assignments.filter((a) => a.status === 'submitted').length,
    graded: assignments.filter((a) => a.status === 'graded').length,
    all: assignments.length,
  }), [assignments]);

  const getDaysLeft = (dueDate: string, dueTime?: string) => {
    const timeStr = dueTime ? `T${dueTime}` : 'T23:59:59';
    const due = new Date(`${dueDate}${timeStr}`);
    const ms = due.getTime() - Date.now();
    if (Number.isNaN(ms)) return { text: 'Check date', urgent: false };
    if (ms < 0) {
      const days = Math.floor(-ms / 86_400_000);
      return { text: days > 0 ? `Overdue by ${days} day${days === 1 ? '' : 's'}` : 'Overdue', urgent: true };
    }
    const hours = Math.ceil(ms / (1000 * 60 * 60));
    if (hours < 24) return { text: `${Math.max(1, hours)}h left`, urgent: true };
    const days = Math.ceil(ms / 86_400_000);
    return { text: `${days} day${days === 1 ? '' : 's'} left`, urgent: false };
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-3 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <p className="mt-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Loading Assignments...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200" role="alert">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {warnings.map((warning) => (
        <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status">
          {warning}
        </div>
      ))}

      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Course Assignments</h1>
        <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5">Submit homework, practical writeups and view teacher feedback</p>
      </div>

      {/* Tabs + course filter */}
      <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
        <div className="flex gap-2 overflow-x-auto">
          {([
            { key: 'pending', label: 'Pending' },
            { key: 'submitted', label: 'Submitted' },
            { key: 'graded', label: 'Graded' },
            { key: 'all', label: 'All Assignments' },
          ] as { key: FilterKey; label: string }[]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-4 py-2 rounded-xl text-xs md:text-sm font-bold transition-all whitespace-nowrap ${
                filter === tab.key
                  ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/20'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label} ({counts[tab.key]})
            </button>
          ))}
        </div>
        {courses.length > 1 && (
          <div className="relative shrink-0 ml-auto">
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              aria-label="Filter by course"
              className="appearance-none bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-700 rounded-xl pl-8 pr-8 py-2 text-xs md:text-sm font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-teal-500 cursor-pointer"
            >
              <option value="all">All courses</option>
              {courses.map((course) => (
                <option key={course} value={course}>{course}</option>
              ))}
            </select>
            <BookOpen size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-violet-600 dark:text-violet-400 pointer-events-none" />
            <ChevronRight size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 -rotate-90 text-slate-400 pointer-events-none" />
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] p-8 shadow-sm">
          <FileUp className="w-12 h-12 text-slate-400 mx-auto mb-2" />
          <p className="text-slate-900 dark:text-white font-bold text-sm">No assignments found</p>
          <p className="text-xs text-slate-500 mt-0.5">No tasks match your selected filter right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const cfg = statusConfig[a.status] || statusConfig.pending;
            const Icon = cfg.icon;
            const due = getDaysLeft(a.dueDate, a.dueTime);
            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] p-5 shadow-sm hover:shadow-md hover:border-teal-300 dark:hover:border-teal-700 transition-all"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="font-bold text-sm md:text-base text-slate-900 dark:text-white">{a.title}</h3>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold border ${cfg.bg} ${cfg.color}`}>
                        <Icon size={12} /> {cfg.label}
                      </span>
                    </div>
                    <p className="text-xs text-teal-700 dark:text-teal-400 font-semibold mt-1">
                      {a.subject}{a.subjectCode ? ` · ${a.subjectCode}` : ''}
                    </p>
                    {linkageBadgeText(a.courseName, a.moduleTitle) && (
                      <div className="mt-1.5">
                        <span
                          className="inline-flex items-center gap-1.5 max-w-full text-[11px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-full px-2.5 py-0.5"
                          title="Linked to a course/module in your curriculum"
                        >
                          <BookOpen size={11} className="shrink-0" />
                          <span className="truncate">{linkageBadgeText(a.courseName, a.moduleTitle)}</span>
                        </span>
                      </div>
                    )}
                    {a.description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 line-clamp-2 leading-relaxed">{a.description}</p>}
                  </div>

                  <div className="text-right flex flex-col items-end gap-2.5 shrink-0">
                    {a.status === 'graded' && a.marksObtained != null && (
                      <div className="text-base font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-3 py-1 rounded-xl border border-blue-200 dark:border-blue-800">
                        {a.marksObtained} / {a.maxMarks ?? '100'} Marks
                      </div>
                    )}
                    {a.dueDate && (() => {
                      const openWork = a.status === 'pending' || a.status === 'overdue';
                      return (
                        <div className="flex flex-col items-end gap-1">
                          <div className="text-xs font-medium text-slate-500">
                            Due {new Date(a.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                          {openWork && (
                            <span className={`inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2 py-0.5 border ${
                              due.urgent
                                ? 'text-rose-700 dark:text-rose-300 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800'
                                : 'text-amber-700 dark:text-amber-300 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800'
                            }`}>
                              <Clock size={11} /> {due.text}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    {(a.status === 'pending' || a.status === 'overdue') && (
                      <button
                        onClick={() => setSelected(a)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold shadow-xs transition-colors"
                      >
                        <Upload size={13} /> Submit Assignment
                      </button>
                    )}
                    {a.status === 'submitted' && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                        <CheckCircle2 size={13} /> Awaiting Faculty Grade
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {selected && (
        <AssignmentUploadModal
          assignment={selected}
          isOpen={!!selected}
          onClose={() => setSelected(null)}
          onSubmit={handleSubmitted}
        />
      )}
    </div>
  );
}
