import React from "react";
import PortalHero from '../../../shared/components/portal/PortalHero'
import { useNavigate, Link } from "react-router-dom";
import { useDashboardStats, useSystemHealth } from '../hooks/useSuperAdmin';
import { describeFreshness } from '../utils/freshness';
import { useSeedUniversities } from '../../admin/hooks/useUniversities';
import { useNotification } from '../../../shared/providers/NotificationProvider';
import {
  LayoutDashboard, ArrowLeft, Building2, Users, GraduationCap, Shield,
  TrendingUp, Activity, BarChart3, Award, Clock, ArrowUpRight, Database, Loader2, Plus, RefreshCw
} from "lucide-react";
import type { TopCollege, RecentActivity } from '../types/superAdmin';

const getStatusColor = (status: string) => {
  switch (status) {
    case "active": return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";
    case "inactive": return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
    case "suspended": return "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800";
    case "trial": return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800";
    default: return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
  }
};

const getActivityIcon = (type: string) => {
  switch (type) {
    case "college_created": return Building2;
    case "admin_created": return Shield;
    case "student_imported": return Users;
    case "plan_changed": return BarChart3;
    case "login": return Activity;
    default: return Clock;
  }
};

const SuperAdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { showError, showSuccess } = useNotification();
  const { data, isLoading, error, refetch, isFetching } = useDashboardStats();
  const { data: health } = useSystemHealth();
  const seedMutation = useSeedUniversities();

  React.useEffect(() => {
    if (error) {
      showError(error.message || "Failed to load dashboard data");
    }
  }, [error, showError]);

  const handleSeedUniversities = async () => {
    if (!confirm("Seed all 23 Karnataka universities to Firestore?\n\nThis will create/update university data for the Vriddhi platform.")) return;
    try {
      const result = await seedMutation.mutateAsync();
      const totalSeeded = result.created + result.updated;
      showSuccess(`Universities seeded! ${totalSeeded} universities created/updated.`);
    } catch (err) {
      showError("Seed failed: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-3 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <p className="mt-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Loading Platform Metrics...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Failed to load platform data</h2>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-teal-600 text-white rounded-xl text-xs font-bold hover:bg-teal-700 transition-colors">
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const stats = data?.stats;
  const recentActivity = data?.recentActivity || [];
  const topColleges = data?.topColleges || [];
  // Snapshot doc timestamp when the server provided one, else this fetch's time.
  const freshness = describeFreshness(
    data?.updatedAt ?? (data ? new Date().toISOString() : null),
    { staleAfterMs: 30 * 60 * 1000 },
  );

  const statCards = [
    { label: "Partner Colleges", value: stats?.totalColleges || 0, icon: Building2, color: "text-teal-700 dark:text-teal-300", bg: "bg-teal-50 border-teal-200/80 dark:bg-teal-950/40 dark:border-teal-800" },
    { label: "Enrolled Students", value: stats?.totalStudents || 0, icon: Users, color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-50 border-blue-200/80 dark:bg-blue-950/40 dark:border-blue-800" },
    { label: "Active Faculty", value: stats?.totalFaculty || 0, icon: GraduationCap, color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50 border-emerald-200/80 dark:bg-emerald-950/40 dark:border-emerald-800" },
    { label: "College Admins", value: stats?.totalAdmins || 0, icon: Shield, color: "text-amber-700 dark:text-amber-300", bg: "bg-amber-50 border-amber-200/80 dark:bg-amber-950/40 dark:border-amber-800" },
    { label: "Total Assessments", value: stats?.activeAssessments || 0, icon: Activity, color: "text-purple-700 dark:text-purple-300", bg: "bg-purple-50 border-purple-200/80 dark:bg-purple-950/40 dark:border-purple-800" },
    { label: "System Health", value: health ? `${health.uptime24h.toFixed(2)}%` : "—", icon: TrendingUp, color: "text-cyan-700 dark:text-cyan-300", bg: "bg-cyan-50 border-cyan-200/80 dark:bg-cyan-950/40 dark:border-cyan-800" },
  ];

  return (
    <div className="space-y-6">
      <PortalHero
        eyebrow="Superadmin workspace"
        title="Your campus network, connected"
        description="Institutional onboarding, academic access and platform health — one place to keep the bigger picture in view."
      />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <LayoutDashboard className="w-6 h-6 text-teal-600" />
            <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Super Admin Console
            </h1>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-xs md:text-sm">
            Platform governance, institutional onboarding and aggregated network metrics
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Item 2.4 / clause A11: the numbers are a 15-minute snapshot, so the
              page says how old they are and offers a refresh instead of
              pretending to be live. */}
          <span
            className={`text-[11px] font-semibold ${freshness.stale ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}
            data-testid="dashboard-freshness"
          >
            {freshness.label}
          </span>
          {/* Item 4.1: the cache is the mitigation for the 3.x price change, so
              its effectiveness sits next to the data freshness — a row of hits
              that stops growing is the signal that a key changed. */}
          {data?.aiCache ? (
            <span
              className="text-[11px] font-semibold text-slate-500 dark:text-slate-400"
              data-testid="ai-cache-summary"
              title={`${data.aiCache.tokensServedFromCache.toLocaleString('en-IN')} output tokens served from cache instead of being generated`}
            >
              {(() => {
                const { hits, misses } = data.aiCache;
                const total = hits + misses;
                const pct = total > 0 ? Math.round((hits / total) * 100) : 0;
                return `AI cache ${pct}% (${hits}/${total} reused)`;
              })()}
            </span>
          ) : null}
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition-all shadow-xs disabled:opacity-60"
          >
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin text-teal-600" /> : <RefreshCw className="w-4 h-4 text-teal-600" />}
            Refresh
          </button>
          <button
            onClick={handleSeedUniversities}
            disabled={seedMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition-all shadow-xs"
          >
            {seedMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                Seeding...
              </>
            ) : (
              <>
                <Database className="w-4 h-4 text-teal-600" />
                Seed Universities
              </>
            )}
          </button>

          <Link
            to="/superadmin/colleges/new"
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-sm shadow-teal-600/20 transition-all"
          >
            <Plus className="w-4 h-4" /> Onboard College
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`p-4 rounded-2xl border ${card.bg} shadow-xs`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">{card.label}</span>
                <Icon className={`w-4 h-4 ${card.color} shrink-0`} />
              </div>
              <p className={`text-2xl font-extrabold ${card.color}`}>{card.value}</p>
            </div>
          );
        })}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Colleges */}
        <div className="lg:col-span-2 bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-teal-600" /> Active Member Institutions
            </h2>
            <Link to="/superadmin/colleges" className="text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1">
              View All <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {topColleges.length > 0 ? (
            <div className="space-y-3">
              {topColleges.map((c: TopCollege) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 hover:border-teal-300 dark:hover:border-teal-700 transition-all"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 font-extrabold text-sm flex items-center justify-center border border-teal-200/80 dark:border-teal-800 shrink-0">
                      {c.name?.charAt(0) || 'C'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{c.name}</p>
                      <p className="text-xs text-slate-500 font-medium">Code: {c.code || 'COL'} &bull; {c.studentCount ?? c.students ?? 0} students</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${getStatusColor(c.status || 'active')}`}>
                      {c.status || 'Active'}
                    </span>
                    <button
                      onClick={() => navigate(`/superadmin/colleges/${c.id}`)}
                      className="p-2 rounded-xl text-slate-400 hover:text-teal-600 hover:bg-white dark:hover:bg-slate-800 transition-colors"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-10 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30">
              <Building2 className="w-10 h-10 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">No colleges registered yet</p>
              <p className="text-xs text-slate-500 mt-0.5">Click "Onboard College" to register the first institution.</p>
            </div>
          )}
        </div>

        {/* Recent Platform Activity */}
        <div className="bg-white dark:bg-[#131b2e] border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-5 flex items-center gap-2">
            <Activity className="w-5 h-5 text-teal-600" /> Audit Log &amp; Feeds
          </h2>

          {recentActivity.length > 0 ? (
            <div className="space-y-3">
              {recentActivity.slice(0, 5).map((act: RecentActivity) => {
                const Icon = getActivityIcon(act.type);
                return (
                  <div key={act.id} className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
                    <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-900 dark:text-white">{act.description || act.action || 'Platform action'}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{act.collegeName || act.userName || act.user || 'System'}</p>
                      <span className="text-[10px] text-slate-400 mt-1 block">{act.timestamp ? new Date(act.timestamp).toLocaleDateString('en-IN') : 'Recently'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30">
              <Clock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No activity recorded</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SuperAdminDashboard;
