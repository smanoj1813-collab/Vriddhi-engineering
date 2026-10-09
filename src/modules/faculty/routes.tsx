import { lazy, Suspense, Component, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { RoleRoute } from '@/routes/components/RoleRoute';
import { useAuth } from '@/modules/auth/context/AuthContext';
import Layout from '@/shared/components/Layout';

// ═══════════════════════════════════════════════════════════════════════════
// DEBUG: RouteTracer logs which route component is actually rendering.
// Open browser DevTools (F12) → Console to verify.
// ═══════════════════════════════════════════════════════════════════════════
function RouteTracer({ label, children }: { label: string; children: ReactNode }) {
  console.log(`[RouteTracer] ✅ Rendering: ${label} at ${window.location.pathname}`);
  return <>{children}</>;
}

const FacultyDashboard = lazy(() => import('./pages/FacultyDashboard'));
const FacultyAttendance = lazy(() => import('./pages/FacultyAttendance'));
const FacultyAttendanceMarking = lazy(() => import('./components/FacultyAttendanceMarking'));
// Faculty marking THEIR OWN attendance — distinct from FacultyAttendance, which
// is a teacher marking a class of students.
const FacultySelfAttendance = lazy(() => import('./pages/FacultySelfAttendance'));
const FacultyTopics = lazy(() => import('./pages/FacultyTopics'));
// Kept for the plug-back path (see RETIRED_FACULTY_PATHS below) — the page
// components are intact, only their routes redirect today.
const FacultyPapers = lazy(() => import('./pages/FacultyPapers'));
const UnifiedQuestionBank = lazy(() => import('@/shared/components/question-bank/UnifiedQuestionBank'));
const FacultyPaperGenerator = lazy(() => import('./pages/FacultyPaperGenerator'));
const FacultyStudentAnalysis = lazy(() => import('./pages/FacultyStudentAnalysis'));
const FacultyReschedule = lazy(() => import('./pages/FacultyReschedule'));
const FacultyUploadMaterial = lazy(() => import('./pages/FacultyUploadMaterial'));
const MemberLibrary = lazy(() => import('@/modules/office/pages/MemberLibrary'));
const FacultyAnnouncements = lazy(() => import('./pages/FacultyAnnouncements'));
const FacultyAssignments = lazy(() => import('./pages/FacultyAssignments'));
const FacultyAssessments = lazy(() => import('./pages/FacultyAssessments'));
const FacultyCalendar = lazy(() => import('./pages/FacultyCalendar'));
const FacultyCurriculum = lazy(() => import('./pages/FacultyCurriculum'));
const FacultySchedule = lazy(() => import('./pages/FacultySchedule'));
const FacultyAIQuestions = lazy(() => import('./pages/FacultyAIQuestions'));
const FacultySettings = lazy(() => import('./pages/FacultySettings'));
const FacultyMySalary = lazy(() => import('./pages/FacultyMySalary'));
const FacultyAppointmentsPage = lazy(() => import('./pages/FacultyAppointmentsPage'));
const FacultyAutoGrading = lazy(() => import('./pages/FacultyAutoGrading'));
const View360 = lazy(() => import('../admin/pages/View360'));
// Create Test lives in the admin module and is mounted by both portals, so
// faculty and HOD/admin author the same test object with one code path.
const CreateTestWizard = lazy(() => import('../admin/pages/CreateTestWizard'));
const MyTestsPage = lazy(() => import('../admin/pages/MyTestsPage'));
const PWAInstallPage = lazy(() => import('./pages/PWAInstallPage'));
const FacultyJourneyPage = lazy(() => import('./pages/FacultyJourneyPage'));

function FacultyAttendanceMarkingWrapper() {
  const { user } = useAuth();
  return (
    <FacultyAttendanceMarking
      collegeId={user?.collegeId ?? ''}
      facultyId={user?.uid ?? user?.id ?? ''}
      facultyName={user?.name ?? ''}
    />
  );
}

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

// ═══════════════════════════════════════════════════════════════════════════
// Error Boundary: catches lazy import failures so you see the error
// instead of a blank white screen or wrong component.
// ═══════════════════════════════════════════════════════════════════════════
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
            <p className="text-xs text-slate-500 mb-4">Check console for stack trace</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-teal-500/20 text-teal-600 dark:text-teal-400 text-sm hover:bg-teal-500/30 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function LazyPage({ children }: { label: string; children: ReactNode }) {
  return (
    <LazyErrorBoundary>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </LazyErrorBoundary>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Retired faculty surfaces (hidden, not deleted)
//
// Paper Generator, Generated Papers and Auto-Grading 5M/10M left the faculty
// sidebar: test creation moves to the sectioned Create Test flow, and
// descriptive auto-grading is parked until that flow lands. The page
// components stay in the repo; their paths redirect to the assessment hub so
// a bookmark or an old link never renders a surface the nav has dropped.
//
// Plug back = delete the entry here and re-add the nav line in Layout.tsx
// (facultyNav, Assessments group).
const RETIRED_FACULTY_PATHS: readonly string[] = [
  'paper-generator',
  'papers',
  'auto-grading',
];

const retiredFacultyRoutes: RouteObject[] = RETIRED_FACULTY_PATHS.map((path) => ({
  path,
  element: <Navigate to="/faculty/assessments" replace />,
}));

// Create + schedule tests = faculty, HOD, admin, employee (+ superadmin).
// Mentor is deliberately absent: mentoring is pastoral, not assessment.
// Plug back = add 'mentor' here (and the nav lines in Layout.tsx).
export const TEST_AUTHOR_ROLES = ['faculty', 'hod', 'admin', 'employee', 'superadmin'] as const;

function TestAuthorsOnly({ children }: { children: ReactNode }) {
  return <RoleRoute allowedRoles={[...TEST_AUTHOR_ROLES]}>{children}</RoleRoute>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Faculty Routes — ONLY faculty, hod, and mentor can access these pages.
// Principals, admins, and superadmins should use /admin/* routes instead.
// ═══════════════════════════════════════════════════════════════════════════
export const facultyRoutes: RouteObject[] = [
  {
    path: '/faculty',
    element: (
      <RoleRoute allowedRoles={['faculty', 'hod', 'mentor', 'employee']}>
        <Layout />
      </RoleRoute>
    ),
    children: [
      { index: true, element: <LazyPage label="faculty/index"><FacultyDashboard /></LazyPage> },
      { path: 'dashboard', element: <LazyPage label="faculty/dashboard"><FacultyDashboard /></LazyPage> },
      { path: 'attendance', element: <LazyPage label="faculty/attendance"><FacultyAttendance /></LazyPage> },
      { path: 'attendance-marking', element: <LazyPage label="faculty/attendance-marking"><FacultyAttendanceMarkingWrapper /></LazyPage> },
      // The faculty member's OWN attendance. `my-attendance` is the canonical
      // path; `self-attendance` is an alias so a hand-typed URL still lands.
      { path: 'my-attendance', element: <LazyPage label="faculty/my-attendance"><FacultySelfAttendance /></LazyPage> },
      { path: 'self-attendance', element: <LazyPage label="faculty/self-attendance"><FacultySelfAttendance /></LazyPage> },
      { path: 'topics', element: <LazyPage label="faculty/topics"><FacultyTopics /></LazyPage> },
      { path: 'question-bank', element: <LazyPage label="faculty/question-bank"><UnifiedQuestionBank initialTab="college" /></LazyPage> },
      { path: 'universal-bank', element: <LazyPage label="faculty/universal-bank"><UnifiedQuestionBank initialTab="universal" /></LazyPage> },
      { path: 'student-analysis', element: <LazyPage label="faculty/student-analysis"><FacultyStudentAnalysis /></LazyPage> },
      { path: 'appointments', element: <LazyPage label="faculty/appointments"><FacultyAppointmentsPage /></LazyPage> },
      { path: 'student-requests', element: <LazyPage label="faculty/student-requests"><FacultyAppointmentsPage /></LazyPage> },
      { path: 'reschedule', element: <LazyPage label="faculty/reschedule"><FacultyReschedule /></LazyPage> },
      { path: 'upload-material', element: <LazyPage label="faculty/upload-material"><FacultyUploadMaterial /></LazyPage> },
      { path: 'library', element: <LazyPage label="faculty/library"><MemberLibrary memberType="faculty" /></LazyPage> },
      { path: 'announcements', element: <LazyPage label="faculty/announcements"><FacultyAnnouncements /></LazyPage> },
      { path: 'assignments', element: <LazyPage label="faculty/assignments"><FacultyAssignments /></LazyPage> },
      { path: 'assessments', element: <LazyPage label="faculty/assessments"><FacultyAssessments /></LazyPage> },
      // ── Create Test ───────────────────────────────────────────────────
      // Authoring is for staff who actually set papers. Mentors use the
      // /faculty shell but never create tests, so these three paths carry
      // their own guard inside the parent one (decision D2).
      { path: 'create-test', element: <TestAuthorsOnly><LazyPage label="faculty/create-test"><CreateTestWizard /></LazyPage></TestAuthorsOnly> },
      { path: 'create-test/:id', element: <TestAuthorsOnly><LazyPage label="faculty/create-test/:id"><CreateTestWizard /></LazyPage></TestAuthorsOnly> },
      { path: 'my-tests', element: <TestAuthorsOnly><LazyPage label="faculty/my-tests"><MyTestsPage /></LazyPage></TestAuthorsOnly> },
      { path: 'calendar', element: <LazyPage label="faculty/calendar"><FacultyCalendar /></LazyPage> },
      { path: 'curriculum', element: <LazyPage label="faculty/curriculum"><FacultyCurriculum /></LazyPage> },
      { path: 'schedule', element: <LazyPage label="faculty/schedule"><FacultySchedule /></LazyPage> },
      { path: 'ai-questions', element: <LazyPage label="faculty/ai-questions"><FacultyAIQuestions /></LazyPage> },
      { path: 'view360', element: <LazyPage label="faculty/view360"><View360 /></LazyPage> },
      { path: 'journey', element: <LazyPage label="faculty/journey"><FacultyJourneyPage /></LazyPage> },
      { path: 'my-salary', element: <LazyPage label="faculty/my-salary"><FacultyMySalary /></LazyPage> },
      { path: 'settings', element: <LazyPage label="faculty/settings"><FacultySettings /></LazyPage> },
      { path: 'install-app', element: <LazyPage label="faculty/install-app"><PWAInstallPage /></LazyPage> },
      { path: 'pwa-install', element: <LazyPage label="faculty/pwa-install"><PWAInstallPage /></LazyPage> },
      // Hidden surfaces — these redirect; see RETIRED_FACULTY_PATHS above.
      ...retiredFacultyRoutes,
    ],
  },
];