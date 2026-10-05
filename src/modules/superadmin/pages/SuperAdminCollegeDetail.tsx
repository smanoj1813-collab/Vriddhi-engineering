import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  useCollege,
  useFacultyList,
  useStudents,
  useAdmins,
} from '../hooks/useSuperAdmin';
import {
  ArrowLeft,
  Building2,
  Users,
  GraduationCap,
  UserCog,
  Mail,
  Phone,
  MapPin,
  Globe,
  Calendar,
  CreditCard,
  Activity,
  BookOpen,
  ChevronRight,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Pencil,
  MoreVertical,
  AlertTriangle,
  Trash2,
  Loader2,
  KeyRound,
  Download,
  FileSpreadsheet,
  Copy,
  Check,
} from "lucide-react";
import { resetCollegeData } from '../api/superAdminApi';
import BulkCredentialReset from '../components/BulkCredentialReset';
import FacultyLinkRepair from '../components/FacultyLinkRepair';
import CompanyPrepVisibilityPanel from '@/shared/components/prep/CompanyPrepVisibilityPanel';
import CourseAssignmentPanel from '@/shared/components/courses/CourseAssignmentPanel';
import ResumeAddonPanel from '@/shared/components/resume/ResumeAddonPanel';
import CollegeModulesPanel from '@/shared/components/modules/CollegeModulesPanel';
import { downloadCsv } from '@/shared/utils/parseCSV';

// ── Helpers ────────────────────────────────────────────────────────────
function exportCollegeStudents(collegeName: string, collegeCode: string, students: any[]) {
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = collegeCode || collegeName.replace(/\s+/g, '-');
  downloadCsv(
    `${safeName}-students-${stamp}.csv`,
    ['Name', 'Reg No', 'Email', 'Phone', 'Batch', 'Division', 'Department', 'Mentor', 'Status', 'College Code'],
    students.map((s: any) => [
      s.name,
      s.regNo,
      s.email,
      s.phone || '',
      s.batch || '',
      s.division || '',
      s.department || '',
      s.mentor || '',
      s.status || '',
      collegeCode || '',
    ])
  );
}

function exportCollegeFaculty(collegeName: string, collegeCode: string, faculty: any[]) {
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = collegeCode || collegeName.replace(/\s+/g, '-');
  downloadCsv(
    `${safeName}-faculty-${stamp}.csv`,
    ['Faculty ID', 'Name', 'First Name', 'Last Name', 'Email', 'Phone', 'Department', 'Designation', 'Employment Type', 'Status', 'College Code'],
    faculty.map((f: any) => [
      f.facultyId || f.id,
      f.name || `${f.firstName || ''} ${f.lastName || ''}`.trim(),
      f.firstName || '',
      f.lastName || '',
      f.email,
      f.phone || '',
      f.department || '',
      f.designation || '',
      f.employmentType || '',
      f.status || '',
      collegeCode || f.collegeCode || '',
    ])
  );
}

// ── Types ──────────────────────────────────────────────────────────────
interface Tab {
  id: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
}

// ── Component ──────────────────────────────────────────────────────────
const SuperAdminCollegeDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");

  // ── Reset Dialog State ─────────────────────────────────────────────
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [confirmCode, setConfirmCode] = useState("");
  const [deleteAuth, setDeleteAuth] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const copyCollegeId = async () => {
    if (!id) return;
    try {
      await navigator.clipboard?.writeText(id);
      setIdCopied(true);
      window.setTimeout(() => setIdCopied(false), 1500);
    } catch {
      // Clipboard access can be refused (insecure context, permissions); the
      // id stays visible and selectable on screen either way.
    }
  };

  // ── Bulk credential reset ──────────────────────────────────────────
  const [bulkReset, setBulkReset] = useState<null | { collection: 'students' | 'faculty'; items: Array<{ id: string; name: string; email: string; regNo?: string; department?: string }> }>(null);

  // ── Data fetching ──────────────────────────────────────────────────
  const {
    data: college,
    isLoading: collegeLoading,
    error: collegeError,
    refetch: refetchCollege,
  } = useCollege(id);

  // Always fetch all data for accurate stats cards, regardless of active tab
  const { data: facultyData, isLoading: facultyLoading, refetch: refetchFaculty } = useFacultyList(
    { collegeId: id || "" },
    { enabled: !!id }
  );

  const { data: studentsData, isLoading: studentsLoading, refetch: refetchStudents } = useStudents(
    { collegeId: id || "" },
    { enabled: !!id }
  );

  const { data: adminsData, isLoading: adminsLoading, refetch: refetchAdmins } = useAdmins(
    { collegeId: id || "" },
    { enabled: !!id }
  );

  const faculty = facultyData?.items || [];
  const students = studentsData?.items || [];
  const admins = adminsData?.items || [];

  // ── Reset Handler ──────────────────────────────────────────────────
  const handleReset = async () => {
    if (!id || !college) return;
    if (confirmCode.trim() !== college.code) {
      setResetError(`College code mismatch. Please type "${college.code}" to confirm.`);
      return;
    }

    setIsResetting(true);
    setResetError(null);

    try {
      await resetCollegeData(id, deleteAuth);
      setResetSuccess(true);
      setConfirmCode("");
      // Refetch all data
      await Promise.all([refetchCollege(), refetchFaculty(), refetchStudents(), refetchAdmins()]);
      setTimeout(() => {
        setShowResetDialog(false);
        setResetSuccess(false);
      }, 2000);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Reset failed. Please try again.");
    } finally {
      setIsResetting(false);
    }
  };

  const openResetDialog = () => {
    setShowResetDialog(true);
    setConfirmCode("");
    setResetError(null);
    setResetSuccess(false);
  };

  const closeResetDialog = () => {
    if (isResetting) return;
    setShowResetDialog(false);
    setConfirmCode("");
    setResetError(null);
    setResetSuccess(false);
  };

  // ── Tabs configuration ─────────────────────────────────────────────
  const tabs: Tab[] = [
    { id: "overview", label: "Overview", icon: <Activity className="w-4 h-4" /> },
    {
      id: "faculty",
      label: "Faculty",
      icon: <GraduationCap className="w-4 h-4" />,
      count: faculty.length,
    },
    {
      id: "students",
      label: "Students",
      icon: <Users className="w-4 h-4" />,
      count: students.length,
    },
    {
      id: "admins",
      label: "Admins",
      icon: <UserCog className="w-4 h-4" />,
      count: admins.length,
    },
    { id: "subscription", label: "Subscription", icon: <CreditCard className="w-4 h-4" /> },
  ];

  // ── Loading state ──────────────────────────────────────────────────
  if (collegeLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 dark:border-teal-400" />
      </div>
    );
  }

  // ── Error / Not Found ──────────────────────────────────────────────
  if (collegeError || !college) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Building2 className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-600 dark:text-slate-400 text-lg">College not found</p>
          <button
            onClick={() => navigate("/superadmin/colleges")}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-slate-900 dark:text-white rounded-lg transition-colors"
          >
            Back to Colleges
          </button>
        </div>
      </div>
    );
  }

  // ── Status badge color ─────────────────────────────────────────────
  const statusColors: Record<string, string> = {
    active: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    inactive: "bg-slate-500/20 text-slate-600 dark:text-slate-400 border-slate-500/30",
    suspended: "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30",
    trial: "bg-amber-100 dark:bg-amber-900/30 text-amber-400 border-amber-500/30",
  };

  // ── Plan badge color ───────────────────────────────────────────────
  const planColors: Record<string, string> = {
    basic: "bg-slate-500/20 text-slate-600 dark:text-slate-300",
    standard: "bg-blue-100 dark:bg-blue-900/30 text-blue-300",
    premium: "bg-purple-500/20 text-purple-600 dark:text-purple-300",
    enterprise: "bg-amber-100 dark:bg-amber-900/30 text-amber-300",
    pro: "bg-teal-100 dark:bg-teal-900/30 text-teal-300",
  };

  return (
    <div className="page-container">
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* RESET CONFIRMATION DIALOG                                     */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {showResetDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 border border-red-200 dark:border-red-900/50 rounded-2xl w-full max-w-md mx-4 overflow-hidden shadow-2xl">
            {/* Dialog Header */}
            <div className="bg-red-50 dark:bg-red-950/30 px-6 py-4 border-b border-red-100 dark:border-red-900/30">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-500/20 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-red-600 dark:text-red-400">Reset College Data</h3>
                  <p className="text-xs text-red-300/70">This action cannot be undone</p>
                </div>
              </div>
            </div>

            {/* Dialog Body */}
            <div className="p-6 space-y-4">
              {resetSuccess ? (
                <div className="text-center py-4">
                  <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400 mx-auto mb-3" />
                  <p className="text-emerald-600 dark:text-emerald-400 font-medium">College data reset successfully!</p>
                  <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                    All students, faculty, admins, curriculum and schedules have been deleted.
                    {deleteAuth ? " Linked login accounts were also deleted." : " Login accounts were kept intact."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-lg p-4">
                    <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">
                      You are about to permanently delete all data for:
                    </p>
                    <p className="text-slate-900 dark:text-white font-semibold">{college.name}</p>
                    <div className="mt-3 space-y-1 text-sm">
                      <p className="text-red-600 dark:text-red-300">• {college.studentCount || students.length} Students</p>
                      <p className="text-red-600 dark:text-red-300">• {college.facultyCount || faculty.length} Faculty members</p>
                      <p className="text-red-600 dark:text-red-300">• {college.adminCount || admins.length} Admins</p>
                      <p className="text-red-600 dark:text-red-300">• Curriculum, schedules &amp; mappings</p>
                      {deleteAuth && <p className="text-red-600 dark:text-red-300">• Firebase login accounts (deleted)</p>}
                    </div>
                  </div>

                  <label className="flex items-start gap-3 p-3 rounded-lg bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deleteAuth}
                      onChange={(e) => setDeleteAuth(e.target.checked)}
                      disabled={isResetting}
                      className="mt-1 h-4 w-4 accent-red-500"
                    />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      <span className="text-slate-900 dark:text-white font-medium">Also delete Firebase Auth login accounts.</span>{' '}
                      This is irreversible — the affected people lose their sign-in. Leave unchecked to keep logins intact
                      (a re-import recreates them). This option is OFF by default.
                    </span>
                  </label>

                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-400 mb-2">
                      Type the college code <span className="text-white font-mono bg-slate-700 px-1.5 py-0.5 rounded">{college.code}</span> to confirm:
                    </label>
                    <input
                      type="text"
                      value={confirmCode}
                      onChange={(e) => {
                        setConfirmCode(e.target.value);
                        setResetError(null);
                      }}
                      placeholder={`Type ${college.code}`}
                      className="w-full px-4 py-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-600 focus:outline-none focus:border-red-500 transition-colors"
                      disabled={isResetting}
                      autoFocus
                    />
                  </div>

                  {resetError && (
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm bg-red-950/30 border border-red-900/30 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      {resetError}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Dialog Footer */}
            {!resetSuccess && (
              <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
                <button
                  onClick={closeResetDialog}
                  disabled={isResetting}
                  className="px-4 py-2 text-slate-700 hover:text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-sm disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReset}
                  disabled={isResetting || confirmCode.trim() !== college.code}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-900/50 disabled:text-red-400/50 text-slate-900 dark:text-white rounded-lg transition-colors text-sm flex items-center gap-2"
                >
                  {isResetting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Reset Data
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bulk credential reset dialog */}
      {bulkReset && id && (
        <BulkCredentialReset
          collegeId={id}
          collegeName={college.name}
          collection={bulkReset.collection}
          items={bulkReset.items}
          onClose={() => setBulkReset(null)}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* HEADER                                                        */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-2">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
          <div className="flex items-center gap-3">
            {college.logo ? (
              <img
                src={college.logo}
                alt={college.name}
                className="w-10 h-10 rounded-lg object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{college.name}</h1>
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                {college.code} &bull; {college.city || college.location || "—"}
              </p>
              {/* The Firestore document id is what claims, rules and scripts
                  key on, yet it used to appear nowhere but the URL — so
                  operators pasted the code where an id was wanted. Show it,
                  copyable, next to the code it is so easily confused with. */}
              <button
                type="button"
                onClick={copyCollegeId}
                title="Copy the college's document id (used by claims, rules and scripts)"
                className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-slate-500 dark:text-slate-500 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
              >
                id&nbsp;{college.id}
                {idCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => exportCollegeStudents(college.name, college.code, students)}
              disabled={students.length === 0}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
              title={`Download ${students.length} students as CSV`}
            >
              <Download className="w-3.5 h-3.5" /> Students ({students.length})
            </button>
            <button
              onClick={() => exportCollegeFaculty(college.name, college.code, faculty)}
              disabled={faculty.length === 0}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
              title={`Download ${faculty.length} faculty as CSV`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> Faculty ({faculty.length})
            </button>
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium border ${
                statusColors[college.status] || statusColors.inactive
              }`}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
              {college.status}
            </span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                planColors[college.plan] || planColors.standard
              }`}
            >
              {college.plan}
            </span>
            <button
              onClick={() => navigate(`/superadmin/colleges/${id}/edit`)}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              title="Edit College"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* STATS CARDS                                                   */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
          label="Total Students"
          value={studentsLoading ? "..." : (studentsData?.total ?? college.studentCount ?? 0)}
          subtext={studentsLoading ? "Loading..." : `${studentsData?.items?.filter((s: any) => s.status === "active").length || 0} active`}
        />
        <StatCard
          icon={<GraduationCap className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
          label="Total Faculty"
          value={facultyLoading ? "..." : (facultyData?.total ?? college.facultyCount ?? 0)}
          subtext={facultyLoading ? "Loading..." : `${facultyData?.items?.filter((f: any) => f.status === "active").length || 0} active`}
        />
        <StatCard
          icon={<UserCog className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
          label="Admins"
          value={adminsLoading ? "..." : (adminsData?.total ?? college.adminCount ?? 0)}
        />
        <StatCard
          icon={<BookOpen className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
          label="Courses"
          value={college.courses || 0}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TABS                                                          */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="border-b border-slate-200 dark:border-slate-700 mb-6">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-teal-400 text-teal-600 dark:text-teal-400"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-xs text-slate-700 dark:text-slate-300">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TAB CONTENT                                                   */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="min-h-[400px]">
        {/* ── OVERVIEW TAB ───────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* College Info Card */}
            <div className="lg:col-span-2 glass-card p-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                College Information
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={college.email} />
                <InfoRow icon={<Phone className="w-4 h-4" />} label="Phone" value={college.phone} />
                <InfoRow
                  icon={<MapPin className="w-4 h-4" />}
                  label="Address"
                  value={[college.address, college.city, college.state, college.country]
                    .filter(Boolean)
                    .join(", ")}
                />
                <InfoRow icon={<Globe className="w-4 h-4" />} label="Website" value={college.website} isLink />
                <InfoRow
                  icon={<Calendar className="w-4 h-4" />}
                  label="Created"
                  value={college.createdAt ? new Date(college.createdAt).toLocaleDateString() : "—"}
                />
                <InfoRow
                  icon={<Clock className="w-4 h-4" />}
                  label="Last Updated"
                  value={college.updatedAt ? new Date(college.updatedAt).toLocaleDateString() : "—"}
                />
              </div>
            </div>

            {/* Quick Actions + Danger Zone */}
            <div className="space-y-6">
              {/* Quick Actions */}
              <div className="glass-card p-6">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Quick Actions</h3>
                <div className="space-y-2">
                  <ActionButton
                    label="Manage Students"
                    onClick={() => setActiveTab("students")}
                    icon={<Users className="w-4 h-4" />}
                  />
                  <ActionButton
                    label="Manage Faculty"
                    onClick={() => setActiveTab("faculty")}
                    icon={<GraduationCap className="w-4 h-4" />}
                  />
                  <ActionButton
                    label="Manage Admins"
                    onClick={() => setActiveTab("admins")}
                    icon={<UserCog className="w-4 h-4" />}
                  />
                  <ActionButton
                    label="View Subscription"
                    onClick={() => setActiveTab("subscription")}
                    icon={<CreditCard className="w-4 h-4" />}
                  />
                  <ActionButton
                    label="Import Faculty"
                    onClick={() => navigate("/superadmin/faculty/import")}
                    icon={<GraduationCap className="w-4 h-4" />}
                  />
                  <ActionButton
                    label="Import Students"
                    onClick={() => navigate("/superadmin/students/import")}
                    icon={<Users className="w-4 h-4" />}
                  />
                  <ActionButton
                    label={`Export Students (${students.length})`}
                    onClick={() => exportCollegeStudents(college.name, college.code, students)}
                    icon={<Download className="w-4 h-4" />}
                  />
                  <ActionButton
                    label={`Export Faculty (${faculty.length})`}
                    onClick={() => exportCollegeFaculty(college.name, college.code, faculty)}
                    icon={<FileSpreadsheet className="w-4 h-4" />}
                  />
                  <ActionButton
                    label="Regenerate Student Credentials"
                    onClick={() =>
                      setBulkReset({
                        collection: 'students',
                        items: students.map((s: any) => ({ id: s.id, name: s.name, email: s.email, regNo: s.regNo, department: s.department })),
                      })
                    }
                    icon={<KeyRound className="w-4 h-4" />}
                  />
                  <ActionButton
                    label="Regenerate Faculty Credentials"
                    onClick={() =>
                      setBulkReset({
                        collection: 'faculty',
                        items: faculty.map((f: any) => ({ id: f.id, name: `${f.firstName} ${f.lastName}`.trim() || f.name, email: f.email, department: f.department })),
                      })
                    }
                    icon={<KeyRound className="w-4 h-4" />}
                  />
                </div>
              </div>

              {/* Danger Zone */}
              <div className="bg-red-950/20 border border-red-900/40 rounded-xl p-6">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                  <h3 className="text-lg font-semibold text-red-600 dark:text-red-400">Danger Zone</h3>
                </div>
                <p className="text-sm text-red-300/70 mb-4">
                  Permanently delete all data for this college — students, faculty, admins,
                  curriculum, schedules, mappings and linked login accounts.
                  The college itself will remain.
                </p>
                <button
                  onClick={openResetDialog}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 text-red-600 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 rounded-lg transition-colors text-sm font-medium"
                >
                  <Trash2 className="w-4 h-4" />
                  Reset College Data
                </button>
              </div>
            </div>
          </div>
          <CompanyPrepVisibilityPanel collegeId={college.id} collegeName={college.name} />
          <CourseAssignmentPanel collegeId={college.id} collegeName={college.name} />
          <ResumeAddonPanel collegeId={college.id} collegeName={college.name} canEdit />
          <CollegeModulesPanel collegeId={college.id} collegeName={college.name} canEdit />
          </div>
        )}

        {/* ── FACULTY TAB ────────────────────────────────────────────── */}
        {activeTab === "faculty" && (
          <div className="space-y-4">
            <FacultyLinkRepair
              collegeId={college.id}
              collegeName={college.name}
              linkedCount={faculty.length}
              onRelinked={() => { void refetchFaculty(); void refetchCollege(); }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => exportCollegeFaculty(college.name, college.code, faculty)}
                disabled={faculty.length === 0}
                className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-50 bg-slate-100 dark:bg-slate-800"
                title="Download faculty list as CSV"
              >
                <Download className="w-4 h-4" /> Export {faculty.length} Faculty
              </button>
              <button
                onClick={() =>
                  setBulkReset({
                    collection: 'faculty',
                    items: faculty.map((f: any) => ({ id: f.id, name: `${f.firstName} ${f.lastName}`.trim() || f.name, email: f.email, department: f.department })),
                  })
                }
                disabled={faculty.length === 0}
                className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4" /> Regenerate {faculty.length} Faculty Credential(s)
              </button>
            </div>
            <DataTable
              title="Faculty Members"
              data={faculty}
              isLoading={facultyLoading}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              columns={[
                { key: "name", label: "Name", render: (f) => `${f.firstName} ${f.lastName}` },
                { key: "email", label: "Email" },
                { key: "department", label: "Department" },
                { key: "designation", label: "Designation" },
                { key: "employmentType", label: "Type", render: (f) => (
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    f.employmentType === "FULL_TIME" ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" :
                    f.employmentType === "PART_TIME" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" :
                    "bg-slate-500/20 text-slate-500 dark:text-slate-400"
                  }`}>
                    {f.employmentType?.replace("_", " ")}
                  </span>
                )},
                { key: "status", label: "Status", render: (f) => (
                  <span className={`inline-flex items-center gap-1 text-xs ${
                    f.status === "active" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  }`}>
                    {f.status === "active" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {f.status}
                  </span>
                )},
              ]}
              onRowClick={(f) => navigate(`/superadmin/faculty/${f.id}`)}
              emptyMessage="No faculty members found for this college."
            />
          </div>
        )}

        {/* ── STUDENTS TAB ───────────────────────────────────────────── */}
        {activeTab === "students" && (
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              <button
                onClick={() => exportCollegeStudents(college.name, college.code, students)}
                disabled={students.length === 0}
                className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-50 bg-slate-100 dark:bg-slate-800"
                title="Download student list as CSV"
              >
                <Download className="w-4 h-4" /> Export {students.length} Students
              </button>
              <button
                onClick={() =>
                  setBulkReset({
                    collection: 'students',
                    items: students.map((s: any) => ({ id: s.id, name: s.name, email: s.email, regNo: s.regNo, department: s.department })),
                  })
                }
                disabled={students.length === 0}
                className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4" /> Regenerate {students.length} Student Credential(s)
              </button>
            </div>
            <DataTable
              title="Students"
              data={students}
              isLoading={studentsLoading}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              columns={[
                { key: "name", label: "Name" },
                { key: "regNo", label: "Reg No" },
                { key: "email", label: "Email" },
                { key: "batch", label: "Batch" },
                { key: "division", label: "Division" },
                { key: "mentor", label: "Mentor" },
                { key: "status", label: "Status", render: (s) => (
                  <span className={`inline-flex items-center gap-1 text-xs ${
                    s.status === "active" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  }`}>
                    {s.status === "active" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {s.status}
                  </span>
                )},
              ]}
              emptyMessage="No students found for this college."
            />
          </div>
        )}

        {/* ── ADMINS TAB ─────────────────────────────────────────────── */}
        {activeTab === "admins" && (
          <DataTable
            title="College Admins"
            data={admins}
            isLoading={adminsLoading}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            columns={[
              { key: "name", label: "Name" },
              { key: "email", label: "Email" },
              { key: "role", label: "Role", render: (a) => (
                <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-300 rounded text-xs capitalize">
                  {a.role}
                </span>
              )},
              { key: "department", label: "Department" },
              { key: "phone", label: "Phone" },
              { key: "status", label: "Status", render: (a) => (
                <span className={`inline-flex items-center gap-1 text-xs ${
                  a.status === "active" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                }`}>
                  {a.status === "active" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {a.status}
                </span>
              )},
            ]}
            emptyMessage="No admins found for this college."
          />
        )}

        {/* ── SUBSCRIPTION TAB ───────────────────────────────────────── */}
        {activeTab === "subscription" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Current Plan</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 dark:text-slate-400">Plan</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    planColors[college.plan] || planColors.standard
                  }`}>
                    {college.plan}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 dark:text-slate-400">Billing Cycle</span>
                  <span className="text-slate-900 dark:text-white capitalize">{college.billingCycle}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 dark:text-slate-400">Status</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    college.status === "active" ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-red-500/20 text-red-600 dark:text-red-400"
                  }`}>
                    {college.status}
                  </span>
                </div>
                {college.subscriptionEnd && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600 dark:text-slate-400">Subscription Ends</span>
                    <span className="text-slate-900 dark:text-white">
                      {new Date(college.subscriptionEnd).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Usage</h3>
              <div className="space-y-4">
                <UsageBar label="Students" used={college.studentCount || 0} limit={college.currentStudents || 500} />
                <UsageBar label="Faculty" used={college.facultyCount || 0} limit={college.currentFaculty || 50} />
                <UsageBar label="Courses" used={college.courses || 0} limit={100} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

function StatCard({
  icon,
  label,
  value,
  subtext,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  subtext?: string;
}) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="p-2 bg-slate-700/50 rounded-lg">{icon}</div>
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{label}</p>
      {subtext && <p className="text-xs text-slate-500 mt-0.5">{subtext}</p>}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  isLink,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  isLink?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-slate-500 dark:text-slate-400">{icon}</div>
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
        {isLink ? (
          <a href={value.startsWith("http") ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            {value}
          </a>
        ) : (
          <p className="text-sm text-slate-900 dark:text-white">{value}</p>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 bg-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 border border-slate-700/50 rounded-lg transition-colors text-left group"
    >
      <span className="text-slate-600 dark:text-slate-400 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">{icon}</span>
      <span className="text-sm text-slate-700 group-hover:text-slate-900 dark:text-white flex-1">{label}</span>
      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-400" />
    </button>
  );
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-slate-600 dark:text-slate-400">{label}</span>
        <span className="text-slate-900 dark:text-white">
          {used} / {limit}
        </span>
      </div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface DataTableProps<T> {
  title: string;
  data: T[];
  isLoading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  columns: Array<{
    key: string;
    label: string;
    render?: (item: T) => React.ReactNode;
  }>;
  onRowClick?: (item: T) => void;
  emptyMessage: string;
}

function DataTable<T extends Record<string, any>>({
  title,
  data,
  isLoading,
  searchQuery,
  setSearchQuery,
  columns,
  onRowClick,
  emptyMessage,
}: DataTableProps<T>) {
  const filtered = searchQuery
    ? data.filter((item) =>
        columns.some((col) => {
          const val = col.render ? "" : item[col.key];
          return String(val).toLowerCase().includes(searchQuery.toLowerCase());
        })
      )
    : data;

  return (
    <div className="glass-card overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:border-teal-400 w-64"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="p-12 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 dark:border-teal-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-slate-500 dark:text-slate-400">{emptyMessage}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="text-left px-4 py-3 text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider"
                  >
                    {col.label}
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => (
                <tr
                  key={item.id || idx}
                  onClick={() => onRowClick?.(item)}
                  className={`border-b border-slate-100 dark:border-slate-800 ${
                    onRowClick ? "hover:bg-slate-100 dark:hover:bg-slate-700/30 cursor-pointer" : ""
                  } transition-colors`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-sm text-slate-900 dark:text-white">
                      {col.render ? col.render(item) : item[col.key]}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <MoreVertical className="w-4 h-4 text-slate-600" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default SuperAdminCollegeDetail;
