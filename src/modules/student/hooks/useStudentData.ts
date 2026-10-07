// src/modules/student/hooks/useStudentData.ts
// ------------------------------------------------------------------
// Aggregates all real Firestore data for the student dashboard.
// Identity comes from useCurrentStudent() → no localStorage tokens.
// ------------------------------------------------------------------
import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type {
  Assignment,
  Notification,
  FeeSummary,
  StudentDashboardStats,
  Assessment,
  ClassSchedule,
  AttendanceSummary,
  StudentProfile,
} from '../types/student';
import {
  fetchProfile,
  fetchAttendance,
  fetchAttendanceDigest,
  fetchAssignments,
  fetchFees,
  fetchTodaySchedule,
  fetchNotifications,
  fetchStudentTests,
  type StudentProfileData,
  type StudentAssignmentData,
  type StudentClassSession,
  type StudentNotificationData,
  type StudentFeeData,
  type AttendanceSummaryData,
  type StudentTestCardData,
} from '../api/studentDataApi';
import { useAuth } from '../../auth/context/AuthContext';
import {
  isStudentAssessmentActionable,
  withEffectiveStudentAssessmentLifecycle,
} from '@/shared/utils/assessmentLifecycle';
import { canStudentUseCodingLab, isBcaStudent } from '../codingLabAccess';
import { fetchCollegeCodingLabAccess } from '@/shared/services/codingLabAccessService';
import { fetchCollegeModuleSettings, isCollegeModuleEnabled } from '@/shared/services/collegeModulesService';
import { fetchCollegePlacementPrepAccess } from '@/shared/services/placementPrepAccessService';

export interface UseStudentDataReturn {
  student: StudentProfile | null;
  profile: StudentProfile | null;
  assignments: Assignment[];
  notifications: Notification[];
  unreadNotifications: number;
  feeSummary: FeeSummary | null;
  fees: FeeSummary | null;
  stats: StudentDashboardStats | null;
  attendance: AttendanceSummary | null;
  assessments: Assessment[];
  schedule: ClassSchedule[];
  tests: StudentTestCardData[];
  todayDate: string;
  loading: boolean;
  error: string | null;
  warnings: string[];
  refresh: () => void;
  /** The resolved Firestore student document id (used by other pages). */
  studentId: string;
  collegeId: string;
  /** True only when this BCA student belongs to a college assigned the lab. */
  codingLabEnabled: boolean;
  /** College-level optional module toggle; defaults ON (fail-open read). */
  assignmentsEnabled: boolean;
  /** Company-prep master switch for the college; defaults ON (server default). */
  placementPrepEnabled: boolean;
}

const StudentDataContext = createContext<UseStudentDataReturn | null>(null);

function mapProfile(p: StudentProfileData | null): StudentProfile | null {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    phone: p.phone,
    regNo: p.regNo,
    rollNumber: p.rollNumber,
    branch: p.branch,
    semester: p.semester,
    division: p.division,
    section: p.section,
    batch: p.batch,
    avatar: p.avatar,
    collegeId: p.collegeId,
    course: p.course,
    accessProductId: p.accessProductId,
    accessProductName: p.accessProductName,
    accessDurationMonths: p.accessDurationMonths,
    accessStart: p.accessStart,
    accessEnd: p.accessEnd,
  };
}

function mapAttendance(a: AttendanceSummaryData | null): AttendanceSummary | null {
  if (!a) return null;
  return {
    percentage: a.percentage,
    presentClasses: a.present,
    totalClasses: a.totalClasses,
    absentClasses: a.absent,
  };
}

function mapAssignments(items: StudentAssignmentData[]): Assignment[] {
  return items.map((a) => ({
    id: a.id,
    title: a.title,
    subject: a.subject,
    subjectCode: a.subjectCode,
    description: a.description || '',
    dueDate: a.dueDate,
    dueTime: a.dueTime,
    maxMarks: a.maxMarks,
    status: a.status,
    submissionType: a.submissionType,
    courseId: a.courseId,
    courseName: a.courseName,
    moduleId: a.moduleId,
    moduleTitle: a.moduleTitle,
  }));
}

function mapNotifications(items: StudentNotificationData[]): Notification[] {
  return items.map((n) => ({
    id: n.id,
    title: n.title,
    message: n.message,
    type: n.type,
    timestamp: n.timestamp,
    read: n.read,
    priority: n.priority,
    category: n.category,
    deadline: n.deadline || undefined,
    courseName: n.courseName,
    moduleTitle: n.moduleTitle,
    assignmentId: n.assignmentId,
  }));
}

function mapFees(f: StudentFeeData): FeeSummary {
  return {
    totalFees: f.totalFees,
    paidFees: f.paidFees,
    pendingFees: f.pendingFees,
    totalPaid: f.totalPaid,
    totalBalance: f.totalBalance,
    totalOverdue: f.totalOverdue,
  };
}

function mapSchedule(items: StudentClassSession[]): ClassSchedule[] {
  return items.map((s) => ({
    id: s.id,
    subject: s.subject,
    startTime: s.startTime,
    endTime: s.endTime,
    room: s.room,
    faculty: s.facultyName,
    facultyName: s.facultyName,
    teacher: s.facultyName,
    type: s.type,
    topic: s.topic,
    status: s.status,
  }));
}

function mapAssessments(tests: StudentTestCardData[]): Assessment[] {
  return tests.map((t) => ({
    id: t.id,
    title: t.title,
    subject: t.subject,
    date: t.startDateTime ? t.startDateTime.split('T')[0] : '',
    time: t.startDateTime ? new Date(t.startDateTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
    type: deriveType(t.title),
    status: t.status,
    totalMarks: t.totalMarks,
    venue: '',
  }));
}

function deriveType(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('quiz')) return 'quiz';
  if (t.includes('mid')) return 'midterm';
  if (t.includes('final') || t.includes('end sem')) return 'final';
  if (t.includes('unit test')) return 'unit-test';
  return 'assessment';
}

const useStudentDataSource = (explicitStudentId?: string): UseStudentDataReturn => {
  const { user } = useAuth();

  const [studentDocId, setStudentDocId] = useState<string>('');
  const [collegeId, setCollegeId] = useState<string>(user?.collegeId || '');
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [codingLabEnabled, setCodingLabEnabled] = useState(false);
  const [assignmentsEnabled, setAssignmentsEnabled] = useState(true);
  // Fail closed: hidden until the college's prep switch confirms otherwise.
  const [placementPrepEnabled, setPlacementPrepEnabled] = useState(false);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [feeSummary, setFeeSummary] = useState<FeeSummary | null>(null);
  const [stats, setStats] = useState<StudentDashboardStats | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [schedule, setSchedule] = useState<ClassSchedule[]>([]);
  const [tests, setTests] = useState<StudentTestCardData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const todayDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const unreadNotifications = notifications.filter((n) => !n.read).length;

  const fetchData = useCallback(async () => {
    const uid = explicitStudentId || user?.uid;
    if (!uid) {
      setCodingLabEnabled(false);
      setPlacementPrepEnabled(false);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setCodingLabEnabled(false);
      setPlacementPrepEnabled(false);
      setError(null);
      setWarnings([]);

      const profileData = await fetchProfile(uid, user?.email || undefined);
      if (!profileData) {
        setProfile(null);
        setCodingLabEnabled(false);
        setPlacementPrepEnabled(false);
        throw new Error(
          'Your account is not linked to a student profile. Contact your college administrator.'
        );
      }

      setStudentDocId(profileData.id);
      setCollegeId(profileData.collegeId || user?.collegeId || '');

      const mappedProfile = mapProfile(profileData);
      setProfile(mappedProfile);

      const today = new Date().toISOString().split('T')[0];

      const results = await Promise.allSettled([
        // Item 3.1: the dashboard reads the one-document summary instead of up to
        // 500 attendance rows (~600 reads per open). Falls back on its own.
        fetchAttendanceDigest(profileData.id, profileData.collegeId || user?.collegeId || ''),
        fetchAssignments(profileData.id),
        fetchFees(profileData.id, profileData.collegeId || user?.collegeId),
        fetchTodaySchedule(
          {
            collegeId: profileData.collegeId || user?.collegeId || '',
            branch: profileData.branch,
            batch: profileData.batch,
            semester: profileData.semester,
            division: profileData.division,
            section: profileData.section,
          },
          today
        ),
        fetchNotifications(profileData.id),
        fetchStudentTests(profileData.collegeId || user?.collegeId, profileData.id),
        isBcaStudent(mappedProfile)
          ? fetchCollegeCodingLabAccess(profileData.collegeId || user?.collegeId || '')
          : Promise.resolve(false),
        // College module toggles (Assignments, ...). The read is fail-open:
        // a missing config doc or a hiccup keeps the default (module ON).
        fetchCollegeModuleSettings(profileData.collegeId || user?.collegeId || ''),
        // Placement Prep master switch (config/prep). Defaults ON; only an
        // explicit switch-off hides the entry. Fails closed on read errors.
        fetchCollegePlacementPrepAccess(profileData.collegeId || user?.collegeId || ''),
      ] as const);

      const serviceNames = [
        'attendance',
        'assignments',
        'fees',
        'timetable',
        'notifications',
        'assessments',
        'coding lab access',
        'module settings',
        'placement prep access',
      ];
      // Saying WHICH service failed is not enough: a Firestore rules denial and a
      // Cloud Function refusing the account look identical on screen, and they need
      // different fixes (one is a query, the other is identity). Quote the reason.
      const failures = results
        .map((result, index) => {
          if (result.status === 'fulfilled') return '';
          // Fees are no longer shown in the student portal; never warn about them.
          if (serviceNames[index] === 'fees') return '';
          const reason = result.reason as { code?: string; message?: string } | undefined;
          const detail = reason?.code || reason?.message || String(reason ?? 'unknown error');
          return `${serviceNames[index]} (${detail})`;
        })
        .filter(Boolean);
      if (failures.length) {
        setWarnings([
          `Some portal data could not be loaded: ${failures.join(', ')}. Empty values are not authoritative.`,
        ]);
      }

      const attendanceData = results[0].status === 'fulfilled' ? results[0].value : null;
      const assignmentData = results[1].status === 'fulfilled' ? results[1].value : [];
      const feeData = results[2].status === 'fulfilled' ? results[2].value : null;
      const scheduleData = results[3].status === 'fulfilled' ? results[3].value : [];
      const notificationData = results[4].status === 'fulfilled' ? results[4].value : [];
      const rawTestData = results[5].status === 'fulfilled' ? results[5].value : [];
      const codingLabAssigned = results[6].status === 'fulfilled' ? results[6].value : false;
      const moduleSettings = results[7].status === 'fulfilled' ? results[7].value : null;
      const placementPrepAccess = results[8].status === 'fulfilled' ? results[8].value : false;
      const testData = rawTestData.map((test) => withEffectiveStudentAssessmentLifecycle(test));

      setCodingLabEnabled(canStudentUseCodingLab(mappedProfile, codingLabAssigned));
      setAssignmentsEnabled(isCollegeModuleEnabled(moduleSettings, 'assignments'));
      setPlacementPrepEnabled(placementPrepAccess);
      setAttendance(mapAttendance(attendanceData));
      setAssignments(mapAssignments(assignmentData));
      setFeeSummary(feeData ? mapFees(feeData) : null);
      setSchedule(mapSchedule(scheduleData));
      setNotifications(mapNotifications(notificationData));
      setTests(testData);
      // The dashboard panel is explicitly "Available Assessments". Keep the
      // full history in `tests`, but never turn upcoming/completed/missed (or a
      // stale expired `available`) row into a Start Test card.
      const actionableTests = testData.filter((test) => isStudentAssessmentActionable(test));
      setAssessments(mapAssessments(actionableTests));

      const pendingAssignments = assignmentData.filter(
        (a) => a.status === 'pending' || a.status === 'overdue'
      ).length;
      const upcomingTests = testData.filter(
        (t) => t.status === 'upcoming' || isStudentAssessmentActionable(t)
      ).length;

      setStats({
        attendancePercentage: attendanceData?.percentage,
        pendingAssignments,
        upcomingTests,
        upcomingAssessments: upcomingTests,
        upcomingClasses: scheduleData.filter((s) => s.status !== 'cancelled' && s.status !== 'completed').length,
        feeDue: feeData?.pendingFees,
        newNotifications: notificationData.filter((n) => !n.read).length,
        overdueAssignments: assignmentData.filter((a) => a.status === 'overdue').length,
        lowAttendanceSubjects: attendanceData
          ? attendanceData.percentage < attendanceData.requiredPercentage ? 1 : 0
          : undefined,
        cgpa: profileData.cgpa,
      });
    } catch (err) {
      console.error('[useStudentData] Fetch error:', err);
      setProfile(null);
      setCodingLabEnabled(false);
      // Fail closed: a gated section stays hidden when its check cannot run.
      setPlacementPrepEnabled(false);
      // Fail open: an error must not hide a core module the college uses.
      setAssignmentsEnabled(true);
      setStudentDocId('');
      setCollegeId('');
      setAttendance(null);
      setAssignments([]);
      setNotifications([]);
      setFeeSummary(null);
      setStats(null);
      setAssessments([]);
      setSchedule([]);
      setTests([]);
      setError(err instanceof Error ? err.message : 'Failed to load student data');
    } finally {
      setLoading(false);
    }
  }, [explicitStudentId, user?.uid, user?.email, user?.collegeId, refreshKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    student: profile,
    profile,
    assignments,
    notifications,
    unreadNotifications,
    feeSummary,
    fees: feeSummary,
    stats,
    attendance,
    assessments,
    schedule,
    tests,
    todayDate,
    loading,
    error,
    warnings,
    refresh: () => setRefreshKey((k) => k + 1),
    studentId: studentDocId,
    collegeId,
    codingLabEnabled,
    assignmentsEnabled,
    placementPrepEnabled,
  };
};

/**
 * One shared academic-data load for the entire student route tree. The sidebar
 * and active page consume the same snapshot instead of issuing duplicate
 * profile plus six-domain requests on every navigation.
 */
export function StudentDataProvider({ children }: { children: ReactNode }) {
  const value = useStudentDataSource();
  return createElement(StudentDataContext.Provider, { value }, children);
}

export function useStudentData(): UseStudentDataReturn {
  const value = useContext(StudentDataContext);
  if (!value) {
    throw new Error('useStudentData must be used within StudentDataProvider');
  }
  return value;
}

export default useStudentData;
