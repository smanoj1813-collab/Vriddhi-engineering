import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import { RoleRoute } from '@/routes/components/RoleRoute';
import ErrorBoundary from '@/shared/components/ErrorBoundary';
import StudentLayout from './components/StudentLayout';
import { StudentDataProvider } from './hooks/useStudentData';
import { studentCourseRoutes } from '@/modules/courses/routes';

// ── Lazy-loaded pages (all read identity from AuthContext) ────────────
const StudentDashboard = lazy(() => import('./pages/StudentDashboard'));
const StudentGrades = lazy(() => import('./pages/StudentGrades'));
const StudentSettings = lazy(() => import('./pages/StudentSettings'));
const StudentMaterials = lazy(() => import('./pages/StudentMaterials'));
const StudentCodingLab = lazy(() => import('./pages/StudentCodingLab'));
const StudentResumePage = lazy(() => import('./pages/StudentResumePage'));
const StudentTimetable = lazy(() => import('./pages/StudentTimetable'));
const StudentIdCard = lazy(() => import('./pages/StudentIdCard'));
const MemberLibrary = lazy(() => import('@/modules/office/pages/MemberLibrary'));
const StudentEvents = lazy(() => import('./pages/StudentEvents'));
const StudentNotificationsPage = lazy(() => import('./pages/StudentNotificationsPage'));
const StudentTestDashboard = lazy(() => import('./pages/StudentTestDashboard'));
const TestInstructionsPage = lazy(() => import('./pages/TestInstructionsPage'));
const ActiveTestPage = lazy(() => import('./pages/ActiveTestPage'));
const TestResultPage = lazy(() => import('./pages/TestResultPage'));
const AttendancePage = lazy(() => import('./components/AttendancePage'));
const StudentAssignments = lazy(() => import('./pages/StudentAssignments'));
const StudentFacultyConnectPage = lazy(() => import('./pages/StudentFacultyConnectPage'));
const StudentJourneyPage = lazy(() => import('./pages/StudentJourneyPage'));
const StudentCurriculumPage = lazy(() => import('./pages/StudentCurriculumPage'));
const PWAInstallPage = lazy(() => import('./pages/PWAInstallPage'));
// Phone section hubs — the "Academics" and "Learning" bottom-bar tabs.
const StudentHubPage = lazy(() => import('./pages/StudentHubPage'));

export const studentRoutes: RouteObject[] = [
  {
    path: '/student',
    element: (
      // `parent` is accepted only because roleRoutes lands that role here until a
      // parent portal exists; every read is still keyed to the signed-in uid, and
      // Firestore rules, not this guard, decide what is visible.
      <RoleRoute allowedRoles={['student', 'parent']}>
        <StudentDataProvider>
          <ErrorBoundary>
            <StudentLayout />
          </ErrorBoundary>
        </StudentDataProvider>
      </RoleRoute>
    ),
    children: [
      { index: true, element: <StudentDashboard /> },
      { path: 'dashboard', element: <StudentDashboard /> },

      // Section hubs reached from the phone's bottom bar
      { path: 'academics', element: <StudentHubPage group="academics" /> },
      { path: 'learning', element: <StudentHubPage group="practice" /> },

      // Core pages
      { path: 'attendance', element: <AttendancePage /> },
      { path: 'assessments', element: <StudentTestDashboard /> },
      { path: 'assignments', element: <StudentAssignments /> },
      { path: 'grades', element: <StudentGrades /> },
      { path: 'journey', element: <StudentJourneyPage /> },
      { path: 'curriculum', element: <StudentCurriculumPage /> },
      { path: 'faculty-connect', element: <StudentFacultyConnectPage /> },
      { path: 'mentorship', element: <StudentFacultyConnectPage /> },

      // Test flow — both /assessments/:id and /test/:id styles supported
      { path: 'assessments/:testId/instructions', element: <TestInstructionsPage /> },
      { path: 'assessments/:testId/take', element: <ActiveTestPage /> },
      { path: 'assessments/:testId/result', element: <TestResultPage /> },
      { path: 'test/:testId/instructions', element: <TestInstructionsPage /> },
      { path: 'test/:testId/take', element: <ActiveTestPage /> },
      { path: 'test/:testId/result', element: <TestResultPage /> },

      // Self-paced certificate courses (bundled content packs, see
      // content/courses/README.md). Catalog → overview → lesson player.
      ...studentCourseRoutes,

      // Secondary pages
      { path: 'materials', element: <StudentMaterials /> },
      { path: 'coding-lab', element: <StudentCodingLab /> },
      { path: 'resume', element: <StudentResumePage /> },
      { path: 'timetable', element: <StudentTimetable /> },
      { path: 'id-card', element: <StudentIdCard /> },
      { path: 'fees', element: <Navigate to="/student/dashboard" replace /> },
      { path: 'fee-portal', element: <Navigate to="/student/dashboard" replace /> },
      { path: 'challans', element: <Navigate to="/student/dashboard" replace /> },
      { path: 'hall-tickets', element: <Navigate to="/student/dashboard" replace /> },
      { path: 'library', element: <MemberLibrary memberType="student" /> },
      { path: 'no-dues', element: <Navigate to="/student/dashboard" replace /> },
      { path: 'events', element: <StudentEvents /> },
      { path: 'notifications', element: <StudentNotificationsPage /> },
      { path: 'settings', element: <StudentSettings /> },
      { path: 'install-app', element: <PWAInstallPage /> },
      { path: 'pwa-install', element: <PWAInstallPage /> },
    ],
  },
];
