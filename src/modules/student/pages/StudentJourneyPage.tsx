import { motion } from 'framer-motion';
import {
  ArrowLeft, GraduationCap, Trophy, CalendarCheck, Target,
  CheckCircle2, Circle, Clock, AlertTriangle, RefreshCw,
  TrendingUp, Briefcase, Info, Lock, Download, Bell, FileText, CreditCard, Receipt
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useMyJourney, buildJourneyStages, type StageState } from '../hooks/useMyJourney';
import { useEffect, useState } from 'react';
import { fetchStudentTimelineFromRealData } from '@/modules/admin/api/journeyMilestonesApi';
import PWAInstallCard from '@/shared/components/PWAInstallCard';
import type { Milestone } from '@/modules/admin/api/journeyApi';
import { useStudentProfile } from '../hooks/useStudentProfile';
import { useAuth } from '../../auth/context/AuthContext';
import { useStudentData } from '../hooks/useStudentData';
import { fetchLearnerProgress, type LearnerProgressData } from '@/shared/services/prepContentService';
import { summarizePrepPractice } from '../utils/journeyPractice';

// ------------------------------------------------------------------
// Student journey: enrolment → placement, from real records.
//
// Every number on this page is computed server-side by
// `getMyAcademicJourney` from the student's own attendance rows, assessment
// attempts and published grade records. Where the college has published
// nothing yet the page says so explicitly — it never substitutes a
// plausible-looking default for a missing value.
// ------------------------------------------------------------------

const stageStyles: Record<StageState, { dot: string; icon: React.ReactNode; ring: string; label: string; text: string }> = {
  done: {
    dot: 'bg-emerald-500 border-emerald-400 text-white',
    icon: <CheckCircle2 className="w-4 h-4" />,
    ring: 'ring-emerald-500/20',
    label: 'Completed',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  active: {
    dot: 'bg-amber-500 border-amber-400 text-white',
    icon: <Clock className="w-4 h-4" />,
    ring: 'ring-amber-500/20',
    label: 'In progress',
    text: 'text-amber-600 dark:text-amber-400',
  },
  blocked: {
    dot: 'bg-rose-500 border-rose-400 text-white',
    icon: <AlertTriangle className="w-4 h-4" />,
    ring: 'ring-rose-500/20',
    label: 'Needs attention',
    text: 'text-rose-600 dark:text-rose-400',
  },
  upcoming: {
    dot: 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-500',
    icon: <Circle className="w-4 h-4" />,
    ring: 'ring-slate-500/10',
    label: 'Upcoming',
    text: 'text-slate-500 dark:text-slate-400',
  },
};

function StatCard({
  label,
  value,
  suffix,
  hint,
  icon,
  tone = 'slate',
}: {
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: 'slate' | 'teal' | 'amber' | 'emerald' | 'rose';
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-700 dark:text-slate-200',
    teal: 'text-teal-600 dark:text-teal-400',
    amber: 'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    rose: 'text-rose-600 dark:text-rose-400',
  };
  return (
    <div className="p-4 rounded-2xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 shadow-sm">
      <div className="flex items-center gap-2 mb-2 text-slate-500">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-2xl font-extrabold tracking-tight ${tones[tone]}`}>
        {value}
        {suffix ? <span className="text-sm font-semibold text-slate-400 ml-1">{suffix}</span> : null}
      </p>
      {hint ? <p className="text-[11px] text-slate-500 mt-1">{hint}</p> : null}
    </div>
  );
}

function EmptyNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{body}</p>
    </div>
  );
}

/**
 * One Vriddhi Phase D — the practice pillar on the Journey spine.
 *
 * Reads the learner's existing Placement Prep progress (GET /prep/progress)
 * and derives visit / completion / quiz counts — no new backend surface.
 * The card hides itself entirely when the college has switched Placement Prep
 * off, and on any read error it stays silent rather than showing invented
 * numbers. An honest empty state invites the first practice session.
 */
function PracticeActivityCard() {
  const { placementPrepEnabled } = useStudentData();
  const [progress, setProgress] = useState<LearnerProgressData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!placementPrepEnabled) return;
    let cancelled = false;
    fetchLearnerProgress()
      .then((data) => !cancelled && setProgress(data))
      .catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; };
  }, [placementPrepEnabled]);

  if (!placementPrepEnabled || failed) return null;
  const summary = summarizePrepPractice(progress);

  const cells = [
    { label: 'Topics visited', value: summary.topicsVisited },
    { label: 'Topics completed', value: summary.topicsCompleted },
    { label: 'Topic quizzes attempted', value: summary.quizzesAttempted },
  ];

  return (
    <div className="p-5 md:p-6 rounded-3xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
          <Target className="w-4 h-4 text-teal-500" /> Practice activity
        </h2>
        <Link
          to="/prep"
          className="text-[11px] font-bold text-teal-600 dark:text-teal-400 hover:underline"
        >
          {summary.topicsVisited > 0 ? 'Continue practising →' : 'Start practising →'}
        </Link>
      </div>

      {summary.topicsVisited === 0 ? (
        <EmptyNote
          title="No practice activity yet"
          body="Placement prep topics, company guides and topic quizzes you complete will count here from day one — start with any topic."
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {cells.map((cell) => (
              <div
                key={cell.label}
                className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800"
              >
                <p className="text-xl font-extrabold text-slate-900 dark:text-white">{cell.value}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mt-0.5">
                  {cell.label}
                </p>
              </div>
            ))}
          </div>
          {summary.lastVisitedAt && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3">
              Last practised {new Date(summary.lastVisitedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function StudentJourneyPage() {
  const { journey, loading, error, refresh } = useMyJourney();
  const { user } = useAuth();
  const { profile: studentProfile } = useStudentProfile(user?.uid);
  const navigate = useNavigate();
  const [realTimeline, setRealTimeline] = useState<Milestone[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);

  useEffect(() => {
    const loadTimeline = async () => {
      const studentId = studentProfile?.id;
      if (!studentId) { setTimelineLoading(false); return; }
      try {
        const data = await fetchStudentTimelineFromRealData(studentId);
        setRealTimeline(data);
      } catch (e) {
        console.error('[StudentJourney] timeline failed', e);
      } finally {
        setTimelineLoading(false);
      }
    };
    loadTimeline();
  }, [studentProfile?.id]);

  if (loading) {
    return (
      <div className="space-y-4 max-w-5xl mx-auto">
        {[0, 1, 2].map((key) => (
          <div
            key={key}
            className="h-28 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error || !journey) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] p-8">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <p className="font-bold text-slate-900 dark:text-white text-sm">Could not load your journey</p>
        <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{error || 'Please try again.'}</p>
        <button
          onClick={refresh}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-bold"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  const stages = buildJourneyStages(journey);
  const { grades, standing, readiness, attendance, assessments, profile } = journey;
  const completedStages = stages.filter((stage) => stage.state === 'done').length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/student/dashboard')}
            aria-label="Back to dashboard"
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors shrink-0"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              My Journey
            </h1>
            <p className="text-xs text-slate-500 truncate">
              {[profile.course, profile.branch, profile.batch && `Batch ${profile.batch}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Where you stand */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="CGPA"
          value={grades.cgpa !== null ? String(grades.cgpa) : '—'}
          suffix={grades.cgpa !== null ? '/10' : undefined}
          hint={
            grades.published
              ? `${grades.creditsEarned} credits published`
              : 'Not published yet'
          }
          icon={<GraduationCap className="w-4 h-4" />}
          tone="teal"
        />
        <StatCard
          label="Standing"
          value={standing.rank !== null ? `#${standing.rank}` : '—'}
          suffix={standing.cohortSize > 0 ? `/ ${standing.cohortSize}` : undefined}
          hint={
            standing.percentile !== null
              ? `Top ${(100 - standing.percentile).toFixed(1)}% of your branch & batch`
              : 'Ranked once grades are published'
          }
          icon={<Trophy className="w-4 h-4" />}
          tone="amber"
        />
        <StatCard
          label="Attendance"
          value={attendance.percentage !== null ? `${attendance.percentage}` : '—'}
          suffix={attendance.percentage !== null ? '%' : undefined}
          hint={
            attendance.percentage === null
              ? 'Nothing marked yet'
              : attendance.percentage < readiness.attendanceGate
                ? `${readiness.attendanceGate - attendance.percentage}% below the ${readiness.attendanceGate}% gate`
                : `Meets the ${readiness.attendanceGate}% gate`
          }
          icon={<CalendarCheck className="w-4 h-4" />}
          tone={
            attendance.percentage !== null && attendance.percentage < readiness.attendanceGate
              ? 'rose'
              : 'emerald'
          }
        />
        <StatCard
          label="Assessments"
          value={`${assessments.graded}`}
          suffix={`/ ${assessments.attempted} graded`}
          hint={
            assessments.averagePercentage !== null
              ? `Average ${assessments.averagePercentage}%`
              : assessments.attempted === 0
                ? 'No attempts yet'
                : 'Awaiting grades'
          }
          icon={<Target className="w-4 h-4" />}
        />
      </div>

      {/* Stage timeline */}
      <div className="p-5 md:p-6 rounded-3xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-slate-900 dark:text-white text-sm">
            From enrolment to placement
          </h2>
          <span className="text-[11px] font-bold text-slate-500">
            {completedStages} of {stages.length} complete
          </span>
        </div>

        <div className="relative">
          <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-slate-200 dark:bg-slate-800" />
          <div className="space-y-5">
            {stages.map((stage) => {
              const style = stageStyles[stage.state];
              return (
                <motion.div
                  key={stage.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="relative flex items-start gap-4"
                >
                  <div
                    className={`relative z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 ring-4 ${style.dot} ${style.ring}`}
                  >
                    {style.icon}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                        {stage.title}
                      </h3>
                      <span className={`text-[10px] font-bold uppercase tracking-wide ${style.text}`}>
                        {style.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {stage.description}
                    </p>
                    <p className="text-xs text-slate-700 dark:text-slate-300 mt-1.5">{stage.detail}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* One Vriddhi Phase D — the practice pillar joins the spine. Numbers
          come from the learner's existing Placement Prep progress
          (GET /prep/progress); the card renders only while the college keeps
          Placement Prep visible, and hides itself on any read error instead
          of showing stale or invented progress. */}
      <PracticeActivityCard />

      {/* Connected Timeline - Fees, Challans, Hall Tickets, Results */}
      <div className="p-5 md:p-6 rounded-3xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 shadow-sm">
        <h2 className="font-bold text-slate-900 dark:text-white text-sm mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-teal-500" /> Connected Journey — Fees, Challans, Hall Tickets, Results (Uniclare parity)
        </h2>
        {timelineLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-6 h-6 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : realTimeline.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-xs text-slate-500">No timeline yet — auto-connects from fee payments, challans, hall tickets, grades, assessments</p>
            <div className="flex flex-wrap gap-2 justify-center mt-3">
              {[
                { icon: CreditCard, label: 'Fee Payments' },
                { icon: Receipt, label: 'Challans' },
                { icon: Download, label: 'Hall Tickets' },
                { icon: Trophy, label: 'Results' },
                { icon: Target, label: 'Assessments' }
              ].map(({ icon: Icon, label }) => (
                <span key={label} className="text-[11px] px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center gap-1">
                  <Icon className="w-3 h-3" /> {label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-slate-200 dark:bg-slate-800" />
            <div className="space-y-4">
              {realTimeline.map((m) => {
                const statusColor = m.status === 'completed' ? 'bg-emerald-500 border-emerald-400' : m.status === 'active' ? 'bg-amber-500 border-amber-400' : m.status === 'warning' ? 'bg-rose-500 border-rose-400' : 'bg-slate-300 border-slate-400';
                const Icon = m.id.includes('fee') ? CreditCard : m.id.includes('challan') ? Receipt : m.id.includes('ht') || m.id.includes('hall') ? Download : m.id.includes('grade') ? Trophy : Target;
                return (
                  <div key={m.id} className="relative flex items-start gap-4">
                    <div className={`relative z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 ${statusColor} text-white`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-xs text-slate-900 dark:text-white">{m.title}</h4>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase ${m.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : m.status === 'active' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : m.status === 'warning' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>{m.status}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{m.date} • {m.description}</p>
                      {m.metric && <p className="text-[11px] text-teal-600 dark:text-teal-400 mt-1">{m.metric}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* PWA Install Card - Uniclare parity */}
      <PWAInstallCard variant="banner" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Semester progression */}
        <div className="p-5 md:p-6 rounded-3xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 shadow-sm">
          <h2 className="font-bold text-slate-900 dark:text-white text-sm mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-teal-500" /> Semester progression
          </h2>

          {grades.semesters.length === 0 ? (
            <EmptyNote
              title="No published grades yet"
              body="Your SGPA and CGPA appear here as soon as your college publishes grade records. Test percentages are never converted into grades."
            />
          ) : (
            <div className="space-y-3">
              {grades.semesters.map((entry) => {
                const width = entry.sgpa !== null ? Math.min(100, (entry.sgpa / 10) * 100) : 0;
                return (
                  <div key={entry.semester}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        Semester {entry.semester}
                      </span>
                      <span className="text-slate-500">
                        {entry.sgpa !== null ? `${entry.sgpa} SGPA` : '—'} · {entry.credits} credits
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-teal-500 transition-all"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300">Cumulative</span>
                <span className="font-extrabold text-teal-600 dark:text-teal-400">
                  {grades.cgpa !== null ? `${grades.cgpa} CGPA` : '—'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Placement readiness */}
        <div className="p-5 md:p-6 rounded-3xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 shadow-sm">
          <h2 className="font-bold text-slate-900 dark:text-white text-sm mb-4 flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-emerald-500" /> Where you stand for placement
          </h2>

          {!readiness.hasCgpa ? (
            <EmptyNote
              title="Readiness needs published grades"
              body="Your placement band is calculated from your real CGPA. It unlocks once your college publishes your grade records."
            />
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-teal-50/60 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800">
                <p className="text-[11px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">
                  Current band
                </p>
                <p className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">
                  {readiness.band?.label}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                  {readiness.band?.outlook}
                </p>
              </div>

              {readiness.nextBand && (
                <div className="p-3 rounded-2xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-start gap-2.5">
                  <Target className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-700 dark:text-slate-300">
                    <span className="font-bold">Next band: {readiness.nextBand.label}</span> at{' '}
                    {readiness.nextBand.minCgpa} CGPA
                    {readiness.nextBand.gap !== null
                      ? ` — ${readiness.nextBand.gap} point${readiness.nextBand.gap === 1 ? '' : 's'} to go.`
                      : '.'}
                  </p>
                </div>
              )}

              {readiness.attendanceShortfall > 0 && (
                <div className="p-3 rounded-2xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-700 dark:text-slate-300">
                    <span className="font-bold">Attendance gate not met.</span> You are{' '}
                    {readiness.attendanceShortfall}% below the {readiness.attendanceGate}% most
                    recruiters require. Most drives filter on this before academics.
                  </p>
                </div>
              )}

              {/* CGPA scale */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">
                  Cut-off scale
                </p>
                <div className="space-y-1.5">
                  {readiness.bands.map((band) => {
                    const isCurrent = readiness.band?.id === band.id;
                    const achieved = grades.cgpa !== null && grades.cgpa >= band.minCgpa;
                    return (
                      <div
                        key={band.id}
                        className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-xs ${
                          isCurrent
                            ? 'bg-teal-50 dark:bg-teal-950/40 border-teal-300 dark:border-teal-700'
                            : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <span
                          className={`font-semibold ${
                            isCurrent
                              ? 'text-teal-800 dark:text-teal-200'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {band.minCgpa}+ · {band.label}
                        </span>
                        {achieved ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : (
                          <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  This band reflects your CGPA against the cut-offs recruiters commonly publish. It is
                  not an offer or a shortlist. The companies that actually recruit from your college
                  are listed in the placement drives your college publishes — applications will open
                  here once that portal is live.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent assessments */}
      <div className="p-5 md:p-6 rounded-3xl bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 shadow-sm">
        <h2 className="font-bold text-slate-900 dark:text-white text-sm mb-4">
          Recent graded assessments
        </h2>
        {assessments.recent.length === 0 ? (
          <EmptyNote
            title="Nothing graded yet"
            body="Your graded tests will appear here with their real scores. Results are shown only after your college releases them."
          />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {assessments.recent.map((entry, index) => (
              <div key={`${entry.title}-${index}`} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                    {entry.title || 'Assessment'}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">{entry.subject}</p>
                </div>
                <div className="text-right shrink-0">
                  <p
                    className={`text-sm font-extrabold ${
                      entry.percentage >= 75
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : entry.percentage >= 50
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {entry.percentage}%
                  </p>
                  {entry.grade ? (
                    <p className="text-[11px] text-slate-500">Grade {entry.grade}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
