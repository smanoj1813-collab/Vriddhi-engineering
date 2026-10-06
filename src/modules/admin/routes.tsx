import { lazy, Suspense, Component, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RoleRoute } from '@/routes/components/RoleRoute';
import type { UserRole } from '@/modules/auth/context/AuthContext';
import Layout from '@/shared/components/Layout';

import { AdminPathGate } from './components/AdminPathGate';
const LibraryManagement = lazy(() => import('@/modules/office/pages/LibraryManagement'));
const LibraryFinesPage = lazy(() => import('@/modules/office/pages/LibraryFinesPage'));
const InventoryManagement = lazy(() => import('@/modules/office/pages/InventoryManagement'));
const VendorsPage = lazy(() => import('@/modules/office/pages/VendorsPage'));
const PurchaseRequestsPage = lazy(() => import('@/modules/office/pages/PurchaseRequestsPage'));
const PurchaseOrdersPage = lazy(() => import('@/modules/office/pages/PurchaseOrdersPage'));
const VendorBillsPage = lazy(() => import('@/modules/office/pages/VendorBillsPage'));
const FinanceReportsPage = lazy(() => import('@/modules/office/pages/FinanceReportsPage'));
const NoDuesPage = lazy(() => import('@/modules/office/pages/NoDuesPage'));
const AccountsDesk = lazy(() => import('@/modules/office/pages/AccountsDesk'));
const OperationsDesk = lazy(() => import('@/modules/office/pages/OperationsDesk'));
const AIAgentPage = lazy(() => import('./pages/AIAgentPage'));
const AIQuestionsPage = lazy(() => import('./pages/AIQuestionsPage'));
const AdminClassSchedule = lazy(() => import('./pages/AdminClassSchedule'));
const AdminCurriculum = lazy(() => import('./pages/AdminCurriculum'));
const AdmissionCenter = lazy(() => import('./pages/AdmissionCenter'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminFeeManagement = lazy(() => import('./pages/AdminFeeManagement'));
const FinanceSettings = lazy(() => import('./pages/FinanceSettings'));
const Analytics = lazy(() => import('./pages/Analytics'));
const AssignmentAnalytics = lazy(() => import('./pages/AssignmentAnalytics'));
const Assessments = lazy(() => import('./pages/Assessments'));
const AssessmentDetailPage = lazy(() => import('./pages/AssessmentDetailPage'));
const OnlineAssessmentScheduler = lazy(() => import('../faculty/pages/FacultyAssessments'));
const AssessmentTestReportsPage = lazy(() => import('./pages/AssessmentTestReports'));
const BranchConductionPage = lazy(() => import('./pages/BranchConductionPage'));
const Attendance = lazy(() => import('./pages/Attendance'));
// Staff (faculty) attendance — what the faculty themselves marked. Student
// attendance stays on `attendance`.
const FacultyAttendanceAdmin = lazy(() => import('./pages/FacultyAttendanceAdmin'));
const CollegeOnboarding = lazy(() => import('./pages/CollegeOnboarding'));
const CurriculumProgress = lazy(() => import('./pages/CurriculumProgress'));
const HODDashboard = lazy(() => import('./pages/HODDashboard'));
const GradeRecords = lazy(() => import('./pages/GradeRecords'));
const Journey = lazy(() => import('./pages/Journey'));
const PaperBuilder = lazy(() => import('./pages/PaperBuilder'));
const PaperGeneratorAdmin = lazy(() => import('./pages/PaperGeneratorPage'));
const PaperReview = lazy(() => import('../faculty/pages/FacultyPapers'));
const QuestionBank = lazy(() => import('./pages/QuestionBank'));
// Aliases kept temporarily for legacy deep-links; routes below point to QuestionBank with initialTab instead.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _LegacyReviewQueuePage = lazy(() => import('./pages/ReviewQueuePage'));
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _LegacyAdminUniversalBank = lazy(() => import('./pages/AdminUniversalBank'));
const Settings = lazy(() => import('./pages/Settings'));
const View360 = lazy(() => import('./pages/View360'));
const CreateTestWizard = lazy(() => import('./pages/CreateTestWizard'));
const MyTestsPage = lazy(() => import('./pages/MyTestsPage'));
const ExamManagement = lazy(() => import('./pages/ExamManagement'));
const UUCMSIntegration = lazy(() => import('./pages/UUCMSIntegration'));
const BCUComplianceDashboard = lazy(() => import('./pages/BCUComplianceDashboard'));
const SchemePacks = lazy(() => import('./pages/SchemePacks'));
const AcademicCalendar = lazy(() => import('./pages/AcademicCalendar'));
const GuestFacultyBilling = lazy(() => import('./pages/GuestFacultyBilling'));
const FacultyPayroll = lazy(() => import('./pages/FacultyPayroll'));
const ResultImporter = lazy(() => import('./pages/ResultImporter'));
const ChallanManagement = lazy(() => import('./pages/ChallanManagement'));
const PWAInstallPage = lazy(() => import('./pages/PWAInstallPage'));

// ═══════════════════════════════════════════════════════════════════════════
// Lazy loading wrappers
// ═══════════════════════════════════════════════════════════════════════════
function PageLoader() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading page...</p>
      </div>
    </div>
  );
}

class LazyErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[LazyErrorBoundary]', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <div className="text-rose-600 dark:text-rose-400 text-4xl mb-3">⚠</div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Failed to load page</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-2 font-mono bg-slate-50 dark:bg-slate-800 p-2 rounded">{this.state.error?.message || 'Unknown error'}</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-teal-500/20 text-teal-600 dark:text-teal-400 text-sm hover:bg-teal-500/30 transition-colors">Reload Page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function LazyPage({ children }: { children: ReactNode }) {
  return (
    <LazyErrorBoundary>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </LazyErrorBoundary>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Admin Routes — paths MUST match Layout.tsx navItems exactly
// ═══════════════════════════════════════════════════════════════════════════

// Question paper / question bank / question approval are HOD territory now.
// The principal's sidebar drops them; these wrappers make sure a bookmarked
// or hand-typed URL bounces the principal out too, instead of silently
// rendering a page the nav no longer advertises. Official Grade Records and
// the AI Question Generator join the list (hidden from principal, kept for
// a future plug-in — re-add 'principal' here and in Layout.tsx to restore).
const QUESTION_WORKFLOW_ROLES: UserRole[] = ['admin', 'hod', 'superadmin', 'employee'];
const questionWorkflowOnly = (node: ReactNode) => (
  <RoleRoute allowedRoles={QUESTION_WORKFLOW_ROLES}>{node}</RoleRoute>
);

// HOD round: Official Grade Records, Paper Review and Paper Generator left the
// HOD/admin sidebar as well (the department keeps the question bank and AI
// drafting; a new test-scheduling surface replaces this lane). Hidden, not
// deleted — the employee workspace and superadmin still run these pages, and
// the deep links bounce everyone else. Plug back for HOD/admin = add
// 'admin'/'hod' here and re-add the nav lines in Layout.tsx.
const PAPER_CRAFT_ROLES: UserRole[] = ['superadmin', 'employee'];
const paperCraftOnly = (node: ReactNode) => (
  <RoleRoute allowedRoles={PAPER_CRAFT_ROLES}>{node}</RoleRoute>
);

export const adminRoutes: RouteObject[] = [
  {
    path: '/admin',
    element: (
      // Every role that uses the /admin shell; AdminPathGate then decides page
      // by page (office roles reach only their modules, HODs no finance).
      <RoleRoute allowedRoles={['admin', 'principal', 'hod', 'superadmin', 'accounts', 'operations', 'employee']}>
        <AdminPathGate>
          <Layout />
        </AdminPathGate>
      </RoleRoute>
    ),
    children: [
      { index: true, element: <LazyPage><AdminDashboard /></LazyPage> },
      { path: 'dashboard', element: <LazyPage><AdminDashboard /></LazyPage> },
      { path: 'students', element: <LazyPage><AdminDashboard /></LazyPage> },
      { path: 'view360', element: <LazyPage><View360 /></LazyPage> },
      { path: 'attendance', element: <LazyPage><Attendance /></LazyPage> },
      { path: 'faculty-attendance', element: <LazyPage><FacultyAttendanceAdmin /></LazyPage> },
      { path: 'assessments', element: <LazyPage><Assessments /></LazyPage> },
      { path: 'assessments/:id', element: <LazyPage><AssessmentDetailPage /></LazyPage> },
      { path: 'schedule-tests', element: <LazyPage><OnlineAssessmentScheduler /></LazyPage> },
      // ── Create Test (same pages the faculty portal mounts) ────────────
      // Access is modelled in ADMIN_ROUTE_PERMISSIONS ('assessment.authorTests'),
      // so the principal bounces on a deep link while HOD/admin/employee pass.
      { path: 'create-test', element: <LazyPage><CreateTestWizard /></LazyPage> },
      { path: 'create-test/:id', element: <LazyPage><CreateTestWizard /></LazyPage> },
      { path: 'my-tests', element: <LazyPage><MyTestsPage /></LazyPage> },
      { path: 'test-reports', element: <LazyPage><AssessmentTestReportsPage /></LazyPage> },
      // Principal oversight: read-only branch-wise conduction picture.
      { path: 'branch-conduction', element: <LazyPage><BranchConductionPage /></LazyPage> },
      { path: 'grade-records', element: paperCraftOnly(<LazyPage><GradeRecords /></LazyPage>) },
      { path: 'fee-management', element: <LazyPage><AdminFeeManagement /></LazyPage> },
      { path: 'finance-settings', element: <LazyPage><FinanceSettings /></LazyPage> },
      // ── College office: library ──
      { path: 'library', element: <LazyPage><LibraryManagement /></LazyPage> },
      { path: 'library/:tab', element: <LazyPage><LibraryManagement /></LazyPage> },
      { path: 'library-fines', element: <LazyPage><LibraryFinesPage /></LazyPage> },
      { path: 'inventory', element: <LazyPage><InventoryManagement /></LazyPage> },
      { path: 'inventory/:tab', element: <LazyPage><InventoryManagement /></LazyPage> },
      { path: 'vendors', element: <LazyPage><VendorsPage /></LazyPage> },
      { path: 'purchase-requests', element: <LazyPage><PurchaseRequestsPage /></LazyPage> },
      { path: 'purchase-orders', element: <LazyPage><PurchaseOrdersPage /></LazyPage> },
      { path: 'purchase-orders/:tab', element: <LazyPage><PurchaseOrdersPage /></LazyPage> },
      { path: 'vendor-bills', element: <LazyPage><VendorBillsPage /></LazyPage> },
      { path: 'finance-reports', element: <LazyPage><FinanceReportsPage /></LazyPage> },
      { path: 'no-dues', element: <LazyPage><NoDuesPage /></LazyPage> },
      { path: 'accounts', element: <LazyPage><AccountsDesk /></LazyPage> },
      { path: 'operations', element: <LazyPage><OperationsDesk /></LazyPage> },
      { path: 'question-bank', element: questionWorkflowOnly(<LazyPage><QuestionBank initialTab="college" /></LazyPage>) },
      // B revamp: single hub — old deep-links render same page on its Universal / Review tab so bookmarks don't 404
      { path: 'universal-bank', element: questionWorkflowOnly(<LazyPage><QuestionBank initialTab="universal" /></LazyPage>) },
      { path: 'review-queue', element: questionWorkflowOnly(<LazyPage><QuestionBank initialTab="review" /></LazyPage>) },
      { path: 'paper-review', element: paperCraftOnly(<LazyPage><PaperReview /></LazyPage>) },
      { path: 'paper-generator', element: paperCraftOnly(<LazyPage><PaperGeneratorAdmin /></LazyPage>) },
      { path: 'class-schedule', element: <LazyPage><AdminClassSchedule /></LazyPage> },
      { path: 'curriculum', element: <LazyPage><AdminCurriculum /></LazyPage> },
      { path: 'curriculum-progress', element: <LazyPage><CurriculumProgress /></LazyPage> },
      { path: 'analytics', element: <LazyPage><Analytics /></LazyPage> },
      { path: 'assignment-analytics', element: <LazyPage><AssignmentAnalytics /></LazyPage> },
      { path: 'journey', element: <LazyPage><Journey /></LazyPage> },
      { path: 'settings', element: <LazyPage><Settings /></LazyPage> },
      { path: 'hod-dashboard', element: <LazyPage><HODDashboard /></LazyPage> },
      { path: 'ai-agent', element: <LazyPage><AIAgentPage /></LazyPage> },
      { path: 'ai-questions', element: questionWorkflowOnly(<LazyPage><AIQuestionsPage /></LazyPage>) },
      { path: 'onboarding', element: <LazyPage><CollegeOnboarding /></LazyPage> },
      { path: 'admissions', element: <LazyPage><AdmissionCenter /></LazyPage> },
      { path: 'papers/builder', element: questionWorkflowOnly(<LazyPage><PaperBuilder /></LazyPage>) },
      { path: 'papers/generator', element: paperCraftOnly(<LazyPage><PaperGeneratorAdmin /></LazyPage>) },
      // Karnataka University Features - Competitive with Uniclare
      { path: 'exam-management', element: <LazyPage><ExamManagement /></LazyPage> },
      { path: 'uucms-integration', element: <LazyPage><UUCMSIntegration /></LazyPage> },
      { path: 'bcu-compliance', element: <LazyPage><BCUComplianceDashboard /></LazyPage> },
      { path: 'scheme-packs', element: <LazyPage><SchemePacks /></LazyPage> },
      { path: 'academic-calendar', element: <LazyPage><AcademicCalendar /></LazyPage> },
      { path: 'guest-faculty-billing', element: <LazyPage><GuestFacultyBilling /></LazyPage> },
      { path: 'payroll', element: <LazyPage><FacultyPayroll /></LazyPage> },
      { path: 'result-importer', element: <LazyPage><ResultImporter /></LazyPage> },
      { path: 'challans', element: <LazyPage><ChallanManagement /></LazyPage> },
      { path: 'install-app', element: <LazyPage><PWAInstallPage /></LazyPage> },
      { path: 'pwa-install', element: <LazyPage><PWAInstallPage /></LazyPage> },
    ],
  },
];