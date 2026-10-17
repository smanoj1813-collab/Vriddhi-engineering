import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, Check, ArrowLeft, Pin,
  Calendar, BookOpen, AlertTriangle, Info, CheckCircle, Clock,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStudentData } from '../hooks/useStudentData';
import { markNotificationRead, markAllNotificationsRead } from '../api/studentDataApi';
import { deadlineCountdown, linkageBadgeText } from '../utils/deadlineCountdown';
import type { Notification } from '../types/student';
import { useAuth } from '@/modules/auth/context/AuthContext';
import { enablePush, pushKeyConfigured, type PushOutcome } from '@/shared/push/pushClient';

// ------------------------------------------------------------------
// The full notification panel.
//
// This page used to query `colleges/{collegeId}/notifications` directly, a
// subcollection that nothing in the codebase ever wrote — the faculty
// composer writes top-level `notifications` — so the panel rendered its empty
// state forever while the composer happily reported "Sent to N students".
// It now reads the same feed as the dashboard card and the sidebar badge
// (useStudentData → getMyNotifications), so the three can no longer disagree.
// ------------------------------------------------------------------

const typeIcons: Record<string, React.ReactNode> = {
  info: <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
  warning: <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
  success: <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
  event: <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400" />,
  academic: <BookOpen className="w-5 h-5 text-teal-600 dark:text-teal-400" />,
};

const typeColors: Record<string, string> = {
  info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  warning: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  event: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800',
  academic: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800',
};

function formatWhen(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function StudentNotificationsPage() {
  const { notifications, unreadNotifications, studentId, loading, refresh } = useStudentData();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleMarkRead = async (id: string) => {
    setBusy(true);
    await markNotificationRead(id);
    await refresh();
    setBusy(false);
  };

  const handleMarkAllRead = async () => {
    setBusy(true);
    await markAllNotificationsRead(studentId);
    await refresh();
    setBusy(false);
  };

  /** Assignment-published entries get the course → module badge + a live
   *  deadline countdown chip + a jump to the assignments page. */
  const renderAssignmentMeta = (notification: Notification) => {
    if (notification.category !== 'assignment') return null;
    const badge = linkageBadgeText(notification.courseName, notification.moduleTitle);
    const countdown = deadlineCountdown(notification.deadline);
    if (!badge && !countdown && !notification.assignmentId) return null;
    const chip =
      countdown?.tone === 'overdue'
        ? 'text-rose-700 dark:text-rose-300 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-800'
        : countdown?.tone === 'soon'
          ? 'text-amber-700 dark:text-amber-300 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800'
          : 'text-slate-600 dark:text-slate-400 bg-slate-50 border-slate-200 dark:bg-slate-900/40 dark:border-slate-700';
    return (
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {badge && (
          <span className="inline-flex items-center gap-1 max-w-full text-[11px] font-bold text-violet-700 dark:text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-full px-2.5 py-0.5">
            <BookOpen size={11} className="shrink-0" />
            <span className="truncate">{badge}</span>
          </span>
        )}
        {countdown && (
          <span className={`inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-0.5 border ${chip}`}>
            <Clock size={11} /> {countdown.text}
          </span>
        )}
        {notification.assignmentId && (
          <button
            onClick={() => navigate('/student/assignments')}
            className="text-[11px] font-bold text-teal-700 dark:text-teal-400 hover:underline ml-1"
          >
            View assignment →
          </button>
        )}
      </div>
    );
  };

  const filtered = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {studentId && <PushOptIn studentId={studentId} />}
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
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
              Notifications
            </h1>
            <p className="text-xs text-slate-500">
              {unreadNotifications > 0
                ? `${unreadNotifications} unread announcement${unreadNotifications === 1 ? '' : 's'}`
                : 'You are all caught up'}
            </p>
          </div>
        </div>

        {unreadNotifications > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 text-xs font-bold border border-teal-200/80 dark:border-teal-800 transition-colors disabled:opacity-50 shrink-0"
          >
            <Check size={14} /> Mark all read
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            filter === 'all'
              ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/20'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          All ({notifications.length})
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            filter === 'unread'
              ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/20'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Unread ({unreadNotifications})
        </button>
      </div>

      {/* Notifications List */}
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {filtered.map((notification) => (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className={`p-4 md:p-5 rounded-2xl border transition-all ${
                notification.read
                  ? 'bg-white dark:bg-[#131b2e] border-slate-200 dark:border-slate-800'
                  : 'bg-teal-50/40 dark:bg-teal-950/20 border-teal-200 dark:border-teal-800/80 shadow-sm'
              }`}
            >
              <div className="flex items-start gap-3.5">
                <div
                  className={`p-2.5 rounded-xl shrink-0 ${typeColors[notification.type] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                >
                  {typeIcons[notification.type] || <Bell className="w-5 h-5" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                      {notification.title || 'Announcement'}
                    </h3>
                    <span className="text-[11px] font-medium text-slate-400 shrink-0 whitespace-nowrap">
                      {formatWhen(notification.timestamp)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed whitespace-pre-line">
                    {notification.message}
                  </p>

                  {renderAssignmentMeta(notification)}

                  <div className="mt-3 flex items-center gap-3 flex-wrap">
                    {notification.priority === 'urgent' || notification.priority === 'high' ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800">
                        {notification.priority}
                      </span>
                    ) : null}

                    {notification.read ? (
                      <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                        <Check size={12} /> Read
                      </span>
                    ) : (
                      <button
                        onClick={() => handleMarkRead(notification.id)}
                        disabled={busy}
                        className="text-[11px] font-bold text-teal-700 dark:text-teal-400 hover:underline flex items-center gap-1 disabled:opacity-50"
                      >
                        <Check size={12} /> Mark as read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {!loading && filtered.length === 0 && (
          <div className="text-center py-16 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] p-8 shadow-sm">
            <Pin className="w-6 h-6 text-slate-300 mx-auto mb-3" />
            <Bell className="w-12 h-12 text-slate-400 mx-auto mb-2" />
            <p className="text-slate-900 dark:text-white font-bold text-sm">
              {filter === 'unread' ? 'Nothing unread' : 'No notifications yet'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {filter === 'unread'
                ? 'Every announcement addressed to you has been read.'
                : 'Announcements from your college for your batch and branch appear here.'}
            </p>
          </div>
        )}

        {loading && notifications.length === 0 && (
          <div className="space-y-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-24 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131b2e] animate-pulse"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Opt-in for phone and desktop alerts. Hidden until the Web Push key is set
// in the build, so the page never shows a button that cannot work.
function PushOptIn({ studentId }: { studentId: string }) {
  const { user } = useAuth();
  const collegeId = user?.collegeId || localStorage.getItem('vriddhi_college_id') || '';
  const [state, setState] = useState<PushOutcome | 'idle' | 'busy' | 'error'>('idle');
  const [error, setError] = useState('');

  if (!pushKeyConfigured() || !collegeId) return null;

  const turnOn = async () => {
    setState('busy');
    setError('');
    try {
      setState(await enablePush(collegeId, studentId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on notifications.');
      setState('error');
    }
  };

  const message: Record<string, string> = {
    enabled: 'Phone alerts are on for this device.',
    denied: 'Notifications are blocked. Allow them in your browser settings, then try again.',
    unsupported: 'This browser does not support push alerts.',
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium text-slate-900 dark:text-white">Get alerts on this device</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {state === 'error' ? error : message[state] || 'College notices can also reach you as a phone or desktop alert.'}
        </p>
      </div>
      {state !== 'enabled' && (
        <button
          onClick={turnOn}
          disabled={state === 'busy'}
          className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
        >
          {state === 'busy' ? 'Turning on…' : 'Turn on alerts'}
        </button>
      )}
    </div>
  );
}

