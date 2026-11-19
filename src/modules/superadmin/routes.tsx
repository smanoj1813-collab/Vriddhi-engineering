import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { useParams } from 'react-router-dom';
import { RoleRoute } from '@/routes/components/RoleRoute';
import ErrorBoundary from '@/shared/components/ErrorBoundary';
import Layout from '@/shared/components/Layout';

const CreateCollege = lazy(() => import('./pages/CreateCollege'));
const CreateCollegeAdmin = lazy(() => import('./pages/CreateCollegeAdmin'));
const FacultyImport = lazy(() => import('./pages/FacultyImport'));
const MultiCollegeComparison = lazy(() => import('./pages/MultiCollegeComparison'));
const SubscriptionBilling = lazy(() => import('./pages/SubscriptionBilling'));
const AccessProducts = lazy(() => import('./pages/AccessProducts'));
const SuperAdminAdmins = lazy(() => import('./pages/SuperAdminAdmins'));
const SuperAdminCollegeDetail = lazy(() => import('./pages/SuperAdminCollegeDetail'));
const SuperAdminColleges = lazy(() => import('./pages/SuperAdminColleges'));
const BranchRegistry = lazy(() => import('./pages/BranchRegistry'));
const SuperAdminCurriculum = lazy(() => import('./pages/SuperAdminCurriculum'));
const SuperAdminDashboard = lazy(() => import('./pages/SuperAdminDashboard'));
const SuperAdminFaculty = lazy(() => import('./pages/SuperAdminFaculty'));
const SuperAdminFacultyDetail = lazy(() => import('./pages/SuperAdminFacultyDetail'));
const SuperAdminStudents = lazy(() => import('./pages/SuperAdminStudents'));
const SuperAdminUniversities = lazy(() => import('./pages/SuperAdminUniversities'));
const SuperAdminUniversityDetail = lazy(() => import('./pages/SuperAdminUniversityDetail'));
const SystemHealthMonitor = lazy(() => import('./pages/SystemHealthMonitor'));
const SystemManagement = lazy(() => import('./pages/SystemManagement'));
const UserImport = lazy(() => import('./pages/UserImport'));
const AccessControl = lazy(() => import('./pages/AccessControl'));
const PlatformEmployees = lazy(() => import('./pages/PlatformEmployees'));
const BulkCredentialResetPage = lazy(() => import('./pages/BulkCredentialResetPage'));
const SuperAdminQuestionBank = lazy(() => import('./pages/SuperAdminQuestionBank'));
const SuperAdminPrepStudio = lazy(() => import('./pages/SuperAdminPrepStudio'));

// Edit mode for an existing college reuses the CreateCollege form via an
// optional `collegeId` prop (see CreateCollege.tsx). Kept as its own route so
// the "Edit College" button on the detail page resolves instead of 404ing.
function EditCollegeRoute() {
  const { id } = useParams<{ id: string }>();
  return <CreateCollege collegeId={id} />;
}

export const superadminRoutes: RouteObject[] = [
  {
    path: '/superadmin',
    element: (
      <RoleRoute allowedRoles={['superadmin']}>
        <ErrorBoundary>
          <Layout />
        </ErrorBoundary>
      </RoleRoute>
    ),
    children: [
      { index: true, element: <SuperAdminDashboard /> },
      { path: 'dashboard', element: <SuperAdminDashboard /> },
      { path: 'access', element: <AccessControl /> },
      // Vriddhi employees: academic staff who work across colleges. The
      // identity is created in Access Control first, then assigned here.
      { path: 'employees', element: <PlatformEmployees /> },
      { path: 'colleges', element: <SuperAdminColleges /> },
      { path: 'branches', element: <BranchRegistry /> },
      { path: 'colleges/new', element: <CreateCollege /> },
      { path: 'colleges/:id/edit', element: <EditCollegeRoute /> },
      { path: 'colleges/:id', element: <SuperAdminCollegeDetail /> },
      { path: 'universities', element: <SuperAdminUniversities /> },
      { path: 'universities/:id', element: <SuperAdminUniversityDetail /> },
      { path: 'admins', element: <SuperAdminAdmins /> },
      { path: 'admins/new', element: <CreateCollegeAdmin /> },
      { path: 'students', element: <SuperAdminStudents /> },
      { path: 'students/import', element: <UserImport /> },
      { path: 'faculty', element: <SuperAdminFaculty /> },
      { path: 'faculty/:id', element: <SuperAdminFacultyDetail /> },
      { path: 'faculty/import', element: <FacultyImport /> },
      { path: 'credentials/regenerate', element: <BulkCredentialResetPage /> },
      { path: 'curriculum', element: <SuperAdminCurriculum /> },
      { path: 'comparison', element: <MultiCollegeComparison /> },
      { path: 'billing', element: <SubscriptionBilling /> },
      { path: 'products', element: <AccessProducts /> },
      { path: 'health', element: <SystemHealthMonitor /> },
      { path: 'system-management', element: <SystemManagement /> },
      { path: 'question-bank', element: <SuperAdminQuestionBank /> },
      { path: 'prep-studio', element: <SuperAdminPrepStudio /> },
    ],
  },
];