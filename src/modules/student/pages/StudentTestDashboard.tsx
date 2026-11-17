import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlayArrow, Schedule, CheckCircle, Cancel,
  TrendingUp, EmojiEvents, Visibility, CalendarToday,
  AccessTime, Assessment, Lock, ArrowForward,
} from "@mui/icons-material";
import { MathRenderer } from '../components/MathRenderer';
import { useStudentData } from '../hooks/useStudentData';
import type { StudentTestCardData } from '../api/studentDataApi';

const TABS = [
  { key: "upcoming", label: "Upcoming", icon: <Schedule fontSize="small" />, color: "info" },
  { key: "active", label: "Active Now", icon: <PlayArrow fontSize="small" />, color: "success" },
  { key: "completed", label: "Completed", icon: <CheckCircle fontSize="small" />, color: "primary" },
  { key: "missed", label: "Missed", icon: <Cancel fontSize="small" />, color: "error" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function matchesTab(t: StudentTestCardData, tab: TabKey): boolean {
  if (tab === "upcoming") return t.status === "upcoming";
  if (tab === "active") return t.status === "available" || t.status === "ongoing";
  if (tab === "completed") return t.status === "completed" || t.status === "graded";
  if (tab === "missed") return t.status === "missed";
  return false;
}

function getTimeRemaining(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "Now";
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

const StudentTestDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { tests, loading, error, warnings, refresh } = useStudentData();
  const [activeTab, setActiveTab] = useState<TabKey>("upcoming");

  // The card flips from "Yet to start" to "Start Test" when the window opens.
  // No polling: ONE refresh is scheduled for the earliest upcoming start. Starts
  // more than 24 hours away are picked up on the next visit.
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; });
  const nextStartMs = useMemo(() => {
    let next: number | null = null;
    for (const t of tests) {
      if (t.status !== "upcoming" || !t.startDateTime) continue;
      const ms = new Date(t.startDateTime).getTime();
      if (Number.isNaN(ms)) continue;
      if (next === null || ms < next) next = ms;
    }
    return next;
  }, [tests]);
  useEffect(() => {
    if (nextStartMs === null) return;
    const delay = nextStartMs - Date.now() + 1000;
    // Start time already passed but still shown as upcoming: refresh once.
    if (delay <= 0) { refreshRef.current(); return; }
    if (delay > 24 * 60 * 60 * 1000) return;
    const id = setTimeout(() => refreshRef.current(), delay);
    return () => clearTimeout(id);
  }, [nextStartMs]);

  const results = useMemo(
    () => tests.filter((t) => t.status === "completed" || t.status === "graded"),
    [tests]
  );

  const filteredTests = useMemo(
    () => tests.filter((t) => matchesTab(t, activeTab)),
    [tests, activeTab]
  );

  const completedCount = results.length;
  const passedCount = results.filter((r) => (r.percentage ?? 0) >= 40).length;
  const avgScore = results.length
    ? Math.round(results.reduce((a, b) => a + (b.percentage ?? 0), 0) / results.length)
    : 0;
  const upcomingCount = tests.filter((t) => t.status === "upcoming").length;

  const goInstructions = (id: string) => navigate(`/student/test/${id}/instructions`);
  const goResult = (id: string) => navigate(`/student/test/${id}/result`);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-3 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <p className="mt-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Loading Assessments...</p>
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
        <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
          <Assessment className="text-teal-600" /> My Assessments &amp; Online Tests
        </h1>
        <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Take scheduled exams, view question solutions, and track test performance.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          icon={<CheckCircle className="text-emerald-600" />}
          label="Completed"
          value={completedCount}
          subtitle={`${passedCount} passed exams`}
          colorClass="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200"
        />
        <StatTile
          icon={<TrendingUp className="text-blue-600" />}
          label="Average Score"
          value={`${avgScore}%`}
          subtitle="Cumulative percentage"
          colorClass="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-200"
        />
        <StatTile
          icon={<EmojiEvents className="text-amber-600" />}
          label="Best Grade"
          value={results[0]?.grade || '—'}
          subtitle="Latest assessment"
          colorClass="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"
        />
        <StatTile
          icon={<Schedule className="text-teal-600" />}
          label="Upcoming"
          value={upcomingCount}
          subtitle="Scheduled tests"
          colorClass="border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-950/30 text-teal-800 dark:text-teal-200"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((tab) => {
          const count = tests.filter((t) => matchesTab(t, tab.key)).length;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-bold whitespace-nowrap transition-all ${
                active
                  ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/20'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {tab.icon}
              {tab.label}
              <span className={`ml-1 text-[11px] px-2 py-0.5 rounded-full font-extrabold ${active ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="space-y-3">
        {filteredTests.length === 0 ? (
          <div className="text-center py-16 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] p-8 shadow-sm">
            <div className="text-slate-400 flex justify-center mb-2">
              {activeTab === 'upcoming' ? <Schedule sx={{ fontSize: 40 }} /> :
               activeTab === 'active' ? <PlayArrow sx={{ fontSize: 40 }} /> :
               activeTab === 'completed' ? <CheckCircle sx={{ fontSize: 40 }} /> :
               <Cancel sx={{ fontSize: 40 }} />}
            </div>
            <p className="text-slate-900 dark:text-white font-bold text-sm">No {activeTab} tests</p>
            <p className="text-xs text-slate-500 mt-1">
              {activeTab === 'upcoming' && "You're all caught up! New tests will appear here when scheduled."}
              {activeTab === 'active' && 'No online tests are currently in progress.'}
              {activeTab === 'completed' && 'Your completed assessments and grades will appear here.'}
              {activeTab === 'missed' && "Great job! You haven't missed any scheduled exams."}
            </p>
          </div>
        ) : (
          filteredTests.map((test) => (
            <TestRow
              key={test.id}
              test={test}
              onStart={goInstructions}
              onResult={goResult}
            />
          ))
        )}
      </div>
    </div>
  );
};

const StatTile: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; subtitle: string; colorClass: string }> =
  ({ icon, label, value, subtitle, colorClass }) => (
    <div className={`rounded-2xl border p-4 shadow-sm ${colorClass}`}>
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-1 opacity-90">{icon}{label}</div>
      <div className="text-2xl font-extrabold">{value}</div>
      <div className="text-[11px] font-medium opacity-80 mt-0.5">{subtitle}</div>
    </div>
  );

const TestRow: React.FC<{
  test: StudentTestCardData;
  onStart: (id: string) => void;
  onResult: (id: string) => void;
}> = ({ test, onStart, onResult }) => {
  const isActive = test.status === 'available' || test.status === 'ongoing';
  const isCompleted = test.status === 'completed' || test.status === 'graded';
  const isMissed = test.status === 'missed';
  const start = test.startDateTime ? new Date(test.startDateTime) : null;
  const pct = test.percentage ?? (test.totalMarks && test.marksObtained ? (test.marksObtained / test.totalMarks) * 100 : undefined);

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-teal-300 dark:hover:border-teal-700 transition-all">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm md:text-base text-slate-900 dark:text-white truncate">
            <MathRenderer text={test.title} inline />
          </h3>
          <p className="text-xs text-teal-700 dark:text-teal-400 font-semibold mt-0.5">{test.subject || 'Academic Assessment'}</p>
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500 font-medium">
            {test.totalQuestions ? <span>{test.totalQuestions} Questions</span> : null}
            {test.duration ? <span>&bull; {test.duration} Minutes</span> : null}
            {test.totalMarks ? <span>&bull; {test.totalMarks} Total Marks</span> : null}
            {start && (
              <>
                <span className="flex items-center gap-1 font-semibold text-slate-600 dark:text-slate-300">
                  <CalendarToday sx={{ fontSize: 13 }} /> {start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
                <span className="flex items-center gap-1 font-semibold text-slate-600 dark:text-slate-300">
                  <AccessTime sx={{ fontSize: 13 }} /> {start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap md:flex-col items-center md:items-end gap-3 md:gap-2 shrink-0 w-full md:w-auto">
          {test.canResume && (
            <button
              onClick={() => onStart(test.id)}
              className="w-full md:w-auto justify-center min-h-[44px] md:min-h-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-sm shadow-amber-500/20"
            >
              <PlayArrow fontSize="small" /> Resume Test
            </button>
          )}
          {isActive && !test.canResume && test.canStart && (
            <button
              onClick={() => onStart(test.id)}
              className="w-full md:w-auto justify-center min-h-[44px] md:min-h-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold shadow-sm shadow-teal-600/20"
            >
              <PlayArrow fontSize="small" /> Start Test
            </button>
          )}
          {isActive && !test.canResume && !test.canStart && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 text-xs font-semibold">
              <Schedule fontSize="small" /> Not Started
            </span>
          )}
          {test.status === 'upcoming' && start && (
            // Deliberately NOT a button: a future test must read as
            // "yet to start", not as a start action. The card flips to
            // "Start Test" automatically once the window opens.
            <span className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-sky-200 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 text-xs font-bold">
              <Schedule fontSize="small" /> Yet to start · in {getTimeRemaining(test.startDateTime)}
            </span>
          )}
          {isMissed && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 text-xs font-bold">
              <Cancel fontSize="small" /> Missed
            </span>
          )}
          {isCompleted && (
            <>
              <div className="text-right space-y-1">
                {test.studentStatus === 'submitted' && (
                  <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded inline-flex items-center gap-1">
                    <CheckCircle sx={{ fontSize: 13 }} /> Test Attended
                  </div>
                )}
                {test.studentStatus === 'submitted' && test.needsManualGrading ? (
                  <div className="text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded">
                    Result pending · Awaiting Faculty Grading
                  </div>
                ) : test.studentStatus === 'graded' && !test.resultReleased ? (
                  <div className="text-xs font-bold text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-2 py-0.5 rounded">
                    Graded · Release Pending
                  </div>
                ) : (
                  <div className={`text-base font-extrabold ${(pct ?? 0) >= 40 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {test.marksObtained ?? '—'} / {test.totalMarks || '—'}
                  </div>
                )}
                <div className="text-[11px] text-slate-500 font-medium">
                  {pct != null ? `${Math.round(pct)}% Score` : ''} {test.grade ? `&bull; Grade ${test.grade}` : ''}
                </div>
              </div>
              {!(test.studentStatus === 'graded' && !test.resultReleased) && (
                <button
                  onClick={() => onResult(test.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 text-xs font-bold transition-colors"
                >
                  <Visibility fontSize="small" /> {test.studentStatus === 'submitted' ? 'View Submission' : 'Detailed Results'}
                </button>
              )}
            </>
          )}
          {!isActive && !isCompleted && !isMissed && test.status !== 'upcoming' && (
            <Lock fontSize="small" className="text-slate-400" />
          )}
        </div>
      </div>
    </div>
  );
};

export default StudentTestDashboard;
