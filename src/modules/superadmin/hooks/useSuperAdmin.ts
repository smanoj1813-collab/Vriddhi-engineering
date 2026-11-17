import { useQuery, useMutation, useQueryClient, UseQueryOptions } from "@tanstack/react-query";
import {
  createCollege,
  listColleges,
  getCollegeById,
  getCollegeDetailWithCounts,
  updateCollege,
  deleteCollege,
  resetCollegeData,
  relinkFacultyToCollege,
  createAdmin,
  promoteToAdmin,
  listAdmins,
  updateAdminStatus,
  importUsers,
  importFaculty,
  createFaculty,
  bulkUpdateStudentAcademicFields,
  getDashboardStats,
  bulkUpdateCollegeStatus,
  listStudents,
  getStudentByIdSuperAdmin,
  updateStudentSuperAdmin,
  getCollegeComparison,
  getCollegeComparisonTrend,
  getBenchmarkData,
  getSubscriptionPlans,
  getCollegeSubscriptions,
  getPaymentHistory,
  getRenewalAlerts,
  updateSubscriptionPlanById,
  toggleAutoRenew,
  sendRenewalReminder,
  getSystemHealth,
  getHealthHistory,
  getSlowQueries,
  getErrorLogs,
  getPerformanceMetrics,
  resolveError,
  acknowledgeAlert,
  getSystemConfig,
  updateSystemConfig,
  getSystemAuditLogs,
  listFaculty,
  getFacultyById,
  updateFaculty,
  deleteFaculty,
  toggleFacultyStatus,
  resetFacultyPassword,
  resetOfficeStaffPassword,
  type CredentialResetResult,
  resetStudentPassword,
  bulkResetStudentPasswords,
  bulkResetFacultyPasswords,
  type BulkResetItem,
  type BulkResetOutcome,
  SuperAdminApiError,
  type ResetCollegeDataResult,
  type RelinkFacultyResult,
  type CreateAdminResult,
} from "../api/superAdminApi";
import {
  listAccessProducts,
  createAccessProduct,
  updateAccessProduct,
  archiveAccessProduct,
  deleteAccessProduct,
  bulkUpdateStudentAccess,
  getAccessMis,
} from "../api/accessProductsApi";
import type { BatchProgress } from "@/shared/utils/batchedImport";

import {
  type CreateCollegeInput,
  type CreateAdminInput,
  type ImportUsersInput,
  type FacultyImportPayload,
  type ListStudentsOptions,
  type UpdateStudentInput,
  type BulkStudentAcademicUpdateInput,
  type BulkStudentAcademicUpdateResult,
  type College,
  type Admin,
  type AdminRole,
  type Student,
  type Faculty,
  type CreateFacultyInput,
  type CreateFacultyResult,
  type ListFacultyOptions,
  type UpdateFacultyInput,
  type PaginatedResult,
  type DashboardStats,
  type RecentActivity,
  type TopCollege,
  type ComparisonFilter,
  type ComparisonResult,
  type BenchmarkData,
  type SubscriptionPlan,
  type PaymentStatus,
  type CollegeSubscription,
  type PaymentHistory,
  type RenewalAlert,
  type SystemHealthStatus,
  type SlowQuery,
  type ErrorLog,
  type PerformanceMetric,
  type SystemConfig,
  type SystemAuditLog,
  type ImportResult,
  type ListCollegesOptions,
  type ListAdminsOptions,
  type AccessProduct,
  type AccessProductInput,
  type AccessMisResponse,
  type BulkAccessUpdateInput,
  type BulkAccessUpdateResult,
} from "../types/superAdmin";

// ═══════════════════════════════════════════════════════════════════════
// QUERY KEYS
// ═══════════════════════════════════════════════════════════════════════
export const useResetStudentPassword = () => {
  const queryClient = useQueryClient();
  return useMutation<
    CredentialResetResult,
    SuperAdminApiError,
    string
  >({
    mutationFn: resetStudentPassword,
    onSuccess: (_data, studentId) => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.studentDetail(studentId) });
    },
  });
};

export const superAdminKeys = {
  all: ["superAdmin"] as const,
  colleges: () => [...superAdminKeys.all, "colleges"] as const,
  collegeList: (filters: ListCollegesOptions) => [...superAdminKeys.colleges(), { filters }] as const,
  collegeDetail: (id: string) => [...superAdminKeys.colleges(), "detail", id] as const,
  admins: () => [...superAdminKeys.all, "admins"] as const,
  adminList: (filters: ListAdminsOptions) => [...superAdminKeys.admins(), { filters }] as const,
  students: () => [...superAdminKeys.all, "students"] as const,
  studentList: (filters: ListStudentsOptions) => [...superAdminKeys.students(), { filters }] as const,
  studentDetail: (id: string) => [...superAdminKeys.students(), "detail", id] as const,
  dashboard: () => [...superAdminKeys.all, "dashboard"] as const,
  comparison: (filters: ComparisonFilter) => [...superAdminKeys.all, "comparison", filters] as const,
  comparisonTrend: (collegeId: string | null, metric: string, timeRange: string) =>
    [...superAdminKeys.all, "comparison-trend", collegeId || "all", metric, timeRange] as const,
  benchmark: (collegeId: string) => [...superAdminKeys.all, "benchmark", collegeId] as const,
  accessProducts: () => [...superAdminKeys.all, "access-products"] as const,
  accessMis: (collegeId?: string) => [...superAdminKeys.all, "access-mis", collegeId || "all"] as const,
  subscriptionPlans: () => [...superAdminKeys.all, "subscription-plans"] as const,
  subscriptions: () => [...superAdminKeys.all, "subscriptions"] as const,
  payments: (options?: object) => [...superAdminKeys.all, "payments", options || {}] as const,
  renewals: () => [...superAdminKeys.all, "renewals"] as const,
  health: () => [...superAdminKeys.all, "health"] as const,
  healthHistory: (hours: number) => [...superAdminKeys.all, "health-history", hours] as const,
  slowQueries: (limit: number) => [...superAdminKeys.all, "slow-queries", limit] as const,
  errors: (options?: object) => [...superAdminKeys.all, "errors", options || {}] as const,
  performance: (hours: number) => [...superAdminKeys.all, "performance", hours] as const,
  systemConfig: () => [...superAdminKeys.all, "system-config"] as const,
  systemAudit: () => [...superAdminKeys.all, "system-audit"] as const,
  faculty: () => [...superAdminKeys.all, "faculty"] as const,
  facultyList: (filters: ListFacultyOptions) => [...superAdminKeys.faculty(), { filters }] as const,
  facultyDetail: (id: string) => [...superAdminKeys.faculty(), "detail", id] as const,
};

// ═══════════════════════════════════════════════════════════════════════
// COLLEGE HOOKS
// ═══════════════════════════════════════════════════════════════════════
export const useColleges = (options: ListCollegesOptions = {}, queryOptions?: Omit<UseQueryOptions<PaginatedResult<College>, SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<PaginatedResult<College>, SuperAdminApiError>({
    queryKey: superAdminKeys.collegeList(options),
    queryFn: () => listColleges(options),
    staleTime: 1000 * 60 * 2,
    ...queryOptions,
  });
};

export const useCollege = (collegeId: string | null | undefined) => {
  return useQuery<College | null, SuperAdminApiError>({
    queryKey: superAdminKeys.collegeDetail(collegeId || ""),
    queryFn: () => (collegeId ? getCollegeById(collegeId) : Promise.resolve(null)),
    enabled: !!collegeId,
    staleTime: 1000 * 60 * 5,
  });
};

export const useCollegeDetail = (collegeId: string | null | undefined) => {
  return useQuery<College | null, SuperAdminApiError>({
    queryKey: [...superAdminKeys.collegeDetail(collegeId || ""), "with-counts"],
    queryFn: () => (collegeId ? getCollegeDetailWithCounts(collegeId) : Promise.resolve(null)),
    enabled: !!collegeId,
    staleTime: 1000 * 60 * 5,
  });
};

export const useCreateCollege = () => {
  const queryClient = useQueryClient();
  return useMutation<College, SuperAdminApiError, CreateCollegeInput>({
    mutationFn: createCollege,
    onSuccess: (data: College) => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.colleges() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
      queryClient.setQueryData(superAdminKeys.collegeDetail(data.id), data);
    },
  });
};

export const useUpdateCollege = () => {
  const queryClient = useQueryClient();
  return useMutation<College, SuperAdminApiError, { collegeId: string; updates: Parameters<typeof updateCollege>[1] }>({
    mutationFn: ({ collegeId, updates }) => updateCollege(collegeId, updates),
    onSuccess: (data: College) => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.colleges() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.collegeDetail(data.id) });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};

export const useDeleteCollege = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, string>({
    mutationFn: deleteCollege,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.colleges() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};

export const useBulkUpdateCollegeStatus = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, { collegeIds: string[]; status: "active" | "inactive" | "suspended" }>({
    mutationFn: ({ collegeIds, status }) => bulkUpdateCollegeStatus(collegeIds, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.colleges() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════
// ADMIN HOOKS
// ═══════════════════════════════════════════════════════════════════════
export const useAdmins = (
  options: ListAdminsOptions = {},
  queryOptions?: Omit<UseQueryOptions<PaginatedResult<Admin>, SuperAdminApiError>, "queryKey" | "queryFn">
) => {
  return useQuery<PaginatedResult<Admin>, SuperAdminApiError>({
    queryKey: superAdminKeys.adminList(options),
    queryFn: () => listAdmins(options),
    staleTime: 1000 * 60 * 2,
    ...queryOptions,
  });
};

export const useCreateAdmin = () => {
  const queryClient = useQueryClient();
  return useMutation<CreateAdminResult, SuperAdminApiError, CreateAdminInput>({
    mutationFn: createAdmin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.admins() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};

export const useUpdateAdminStatus = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, { adminId: string; status: "active" | "inactive"; role?: string }>({
    mutationFn: ({ adminId, status, role }) => updateAdminStatus(adminId, status, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.admins() });
    },
  });
};

/**
 * Reissue the one-time password for an office-staff account (accounts /
 * operations). The temporary password is returned once and never persisted —
 * the UI must show it immediately with a copy affordance.
 */
export const useResetOfficeStaffPassword = () => {
  return useMutation<
    { ok: boolean; uid: string; temporaryPassword: string },
    SuperAdminApiError,
    { uid: string }
  >({
    mutationFn: ({ uid }) => resetOfficeStaffPassword(uid),
  });
};

export const usePromoteToAdmin = () => {
  const queryClient = useQueryClient();
  return useMutation<
    Admin,
    SuperAdminApiError,
    {
      uid: string;
      name: string;
      email: string;
      role: AdminRole;
      collegeId: string;
      phone?: string;
      department?: string;
    }
  >({
    mutationFn: promoteToAdmin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.admins() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.faculty() });
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════
// STUDENT HOOKS
// ═══════════════════════════════════════════════════════════════════════
export const useStudents = (options: ListStudentsOptions = {}, queryOptions?: Omit<UseQueryOptions<PaginatedResult<Student>, SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<PaginatedResult<Student>, SuperAdminApiError>({
    queryKey: superAdminKeys.studentList(options),
    queryFn: () => listStudents(options),
    staleTime: 1000 * 60 * 2,
    ...queryOptions,
  });
};

export const useStudent = (studentId: string | null | undefined) => {
  return useQuery<Student | null, SuperAdminApiError>({
    queryKey: superAdminKeys.studentDetail(studentId || ""),
    queryFn: () => (studentId ? getStudentByIdSuperAdmin(studentId) : Promise.resolve(null)),
    enabled: !!studentId,
    staleTime: 1000 * 60 * 5,
  });
};

export const useUpdateStudent = () => {
  const queryClient = useQueryClient();
  return useMutation<Student, SuperAdminApiError, { studentId: string; updates: UpdateStudentInput }>({
    mutationFn: ({ studentId, updates }) => updateStudentSuperAdmin(studentId, updates),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.students() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.studentDetail(data.id) });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
      queryClient.setQueryData(superAdminKeys.studentDetail(data.id), data);
    },
  });
};

export const useBulkUpdateStudentAcademicFields = () => {
  const queryClient = useQueryClient();
  return useMutation<
    BulkStudentAcademicUpdateResult,
    SuperAdminApiError,
    BulkStudentAcademicUpdateInput
  >({
    mutationFn: bulkUpdateStudentAcademicFields,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.students() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════
// IMPORT HOOKS
// ═══════════════════════════════════════════════════════════════════════
export const useImportUsers = () => {
  const queryClient = useQueryClient();
  return useMutation<ImportResult, SuperAdminApiError, ImportUsersInput>({
    mutationFn: importUsers,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.colleges() });
    },
  });
};

export const useImportFaculty = () => {
  const queryClient = useQueryClient();
  return useMutation<ImportResult, SuperAdminApiError, FacultyImportPayload>({
    mutationFn: importFaculty,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.colleges() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.facultyList({}) });
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD HOOKS
// ═══════════════════════════════════════════════════════════════════════

/** Item 2.4: the payload carries the snapshot's timestamp and origin so the page
 *  can say how old the numbers are (clause A11). */
export interface DashboardPayload {
  stats: DashboardStats;
  recentActivity: RecentActivity[];
  topColleges: TopCollege[];
  updatedAt?: string;
  source?: "snapshot" | "live";
  /** Item 4.1: AI content-cache counters carried by the same snapshot doc. */
  aiCache?: { hits: number; misses: number; tokensServedFromCache: number } | null;
}
export const useDashboardStats = (queryOptions?: Omit<UseQueryOptions<DashboardPayload, SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<DashboardPayload, SuperAdminApiError>({
    queryKey: superAdminKeys.dashboard(),
    queryFn: getDashboardStats,
    staleTime: 1000 * 60 * 5,
    // Item 2.4: the numbers come from a 15-minute snapshot doc. No timer: the
    // data refreshes on tab focus only when older than staleTime.
    refetchOnWindowFocus: true,
    ...queryOptions,
  });
};

// ═══════════════════════════════════════════════════════════════════════
// COMPARISON HOOKS
// ═══════════════════════════════════════════════════════════════════════
export const useCollegeComparison = (filters: ComparisonFilter) => {
  const { data: collegesData } = useColleges({ status: "active" });
  const allCollegeIds = collegesData?.items.map(c => c.id) || [];

  return useQuery<ComparisonResult, SuperAdminApiError>({
    queryKey: superAdminKeys.comparison(filters),
    queryFn: async () => {
      if (allCollegeIds.length < 2) {
        throw new SuperAdminApiError("At least 2 active colleges required for comparison");
      }
      return getCollegeComparison(allCollegeIds);
    },
    enabled: allCollegeIds.length >= 2,
    staleTime: 1000 * 60 * 5,
  });
};

export const useCollegeComparisonTrend = (
  collegeId: string | null,
  metric: string,
  timeRange: string
) => {
  return useQuery<Array<{ date: string; value: number }>, SuperAdminApiError>({
    queryKey: superAdminKeys.comparisonTrend(collegeId, metric, timeRange),
    queryFn: () => getCollegeComparisonTrend(collegeId, metric, timeRange),
    enabled: !!collegeId,
    staleTime: 1000 * 60 * 5,
  });
};

export const useBenchmarkData = (collegeId: string | null) => {
  return useQuery<BenchmarkData[], SuperAdminApiError>({
    queryKey: superAdminKeys.benchmark(collegeId || ""),
    queryFn: () => (collegeId ? getBenchmarkData(collegeId) : Promise.resolve([])),
    enabled: !!collegeId,
    staleTime: 1000 * 60 * 5,
  });
};

// ═══════════════════════════════════════════════════════════════════════
// SUBSCRIPTION HOOKS
// ═══════════════════════════════════════════════════════════════════════
export const useSubscriptionPlans = (queryOptions?: Omit<UseQueryOptions<SubscriptionPlan[], SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<SubscriptionPlan[], SuperAdminApiError>({
    queryKey: superAdminKeys.subscriptionPlans(),
    queryFn: getSubscriptionPlans,
    staleTime: 1000 * 60 * 5,
    ...queryOptions,
  });
};

export const useCollegeSubscriptions = (queryOptions?: Omit<UseQueryOptions<CollegeSubscription[], SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<CollegeSubscription[], SuperAdminApiError>({
    queryKey: superAdminKeys.subscriptions(),
    queryFn: getCollegeSubscriptions,
    staleTime: 1000 * 60 * 2,
    ...queryOptions,
  });
};

export const usePaymentHistory = (
  options?: { collegeId?: string; limit?: number; status?: PaymentStatus },
  queryOptions?: Omit<UseQueryOptions<PaginatedResult<PaymentHistory>, SuperAdminApiError>, "queryKey" | "queryFn">
) => {
  return useQuery<PaginatedResult<PaymentHistory>, SuperAdminApiError>({
    queryKey: superAdminKeys.payments(options),
    queryFn: () => getPaymentHistory(options),
    staleTime: 1000 * 60 * 2,
    ...queryOptions,
  });
};

export const useRenewalAlerts = (queryOptions?: Omit<UseQueryOptions<RenewalAlert[], SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<RenewalAlert[], SuperAdminApiError>({
    queryKey: superAdminKeys.renewals(),
    queryFn: getRenewalAlerts,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
    ...queryOptions,
  });
};

export const useUpdateSubscriptionPlan = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, { collegeId: string; planId: string }>({
    mutationFn: ({ collegeId, planId }) => updateSubscriptionPlanById(collegeId, planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.subscriptions() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.payments() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.renewals() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};

export const useToggleAutoRenew = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, { subscriptionId: string; enabled: boolean }>({
    mutationFn: ({ subscriptionId, enabled }) => toggleAutoRenew(subscriptionId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.subscriptions() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.renewals() });
    },
  });
};

export const useSendRenewalReminder = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, string>({
    mutationFn: sendRenewalReminder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.renewals() });
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════
// SYSTEM HEALTH HOOKS
// ═══════════════════════════════════════════════════════════════════════
export const useSystemHealth = (queryOptions?: Omit<UseQueryOptions<SystemHealthStatus, SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<SystemHealthStatus, SuperAdminApiError>({
    queryKey: superAdminKeys.health(),
    queryFn: getSystemHealth,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: true,
    ...queryOptions,
  });
};

export const useHealthHistory = (hours: number = 24, queryOptions?: Omit<UseQueryOptions<PerformanceMetric[], SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<PerformanceMetric[], SuperAdminApiError>({
    queryKey: superAdminKeys.healthHistory(hours),
    queryFn: () => getHealthHistory(hours),
    staleTime: 1000 * 60,
    refetchOnWindowFocus: true,
    ...queryOptions,
  });
};

export const useSlowQueries = (limit: number = 20, queryOptions?: Omit<UseQueryOptions<SlowQuery[], SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<SlowQuery[], SuperAdminApiError>({
    queryKey: superAdminKeys.slowQueries(limit),
    queryFn: () => getSlowQueries(limit),
    staleTime: 1000 * 60,
    refetchOnWindowFocus: true,
    ...queryOptions,
  });
};

export const useErrorLogs = (options?: { severity?: string; resolved?: boolean; limit?: number }, queryOptions?: Omit<UseQueryOptions<PaginatedResult<ErrorLog>, SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<PaginatedResult<ErrorLog>, SuperAdminApiError>({
    queryKey: superAdminKeys.errors(options),
    queryFn: () => getErrorLogs(options),
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: true,
    ...queryOptions,
  });
};

export const usePerformanceMetrics = (hours: number = 24, queryOptions?: Omit<UseQueryOptions<PerformanceMetric[], SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<PerformanceMetric[], SuperAdminApiError>({
    queryKey: superAdminKeys.performance(hours),
    queryFn: () => getPerformanceMetrics(hours),
    staleTime: 1000 * 60,
    refetchOnWindowFocus: true,
    ...queryOptions,
  });
};

export const useResolveError = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, string>({
    mutationFn: resolveError,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.errors() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.health() });
    },
  });
};

export const useAcknowledgeAlert = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, string>({
    mutationFn: acknowledgeAlert,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.health() });
    },
  });
};

export const useSystemConfig = (queryOptions?: Omit<UseQueryOptions<SystemConfig, SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<SystemConfig, SuperAdminApiError>({
    queryKey: superAdminKeys.systemConfig(),
    queryFn: getSystemConfig,
    staleTime: 1000 * 60,
    ...queryOptions,
  });
};

export const useSystemAuditLogs = (limitCount = 30, queryOptions?: Omit<UseQueryOptions<SystemAuditLog[], SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<SystemAuditLog[], SuperAdminApiError>({
    queryKey: [...superAdminKeys.systemAudit(), limitCount],
    queryFn: () => getSystemAuditLogs(limitCount),
    staleTime: 1000 * 30,
    ...queryOptions,
  });
};

export const useUpdateSystemConfig = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, Partial<Omit<SystemConfig, 'id' | 'updatedAt' | 'updatedBy'>>>({
    mutationFn: updateSystemConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.systemConfig() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.systemAudit() });
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════
// FACULTY HOOKS
// ═══════════════════════════════════════════════════════════════════════
export const useCreateFaculty = () => {
  const queryClient = useQueryClient();
  return useMutation<CreateFacultyResult, SuperAdminApiError, CreateFacultyInput>({
    mutationFn: createFaculty,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.faculty() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.colleges() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};

export const useFacultyList = (options: ListFacultyOptions = {}, queryOptions?: Omit<UseQueryOptions<PaginatedResult<Faculty>, SuperAdminApiError>, "queryKey" | "queryFn">) => {
  return useQuery<PaginatedResult<Faculty>, SuperAdminApiError>({
    queryKey: superAdminKeys.facultyList(options),
    queryFn: () => listFaculty(options),
    staleTime: 1000 * 60 * 2,
    ...queryOptions,
  });
};

export const useFaculty = (facultyId: string | null | undefined) => {
  return useQuery<Faculty | null, SuperAdminApiError>({
    queryKey: superAdminKeys.facultyDetail(facultyId || ""),
    queryFn: () => (facultyId ? getFacultyById(facultyId) : Promise.resolve(null)),
    enabled: !!facultyId,
    staleTime: 1000 * 60 * 5,
  });
};

export const useUpdateFaculty = () => {
  const queryClient = useQueryClient();
  return useMutation<Faculty, SuperAdminApiError, { facultyId: string; updates: UpdateFacultyInput }>({
    mutationFn: ({ facultyId, updates }) => updateFaculty(facultyId, updates),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.faculty() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.facultyDetail(data.id) });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};

export const useDeleteFaculty = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, string>({
    mutationFn: deleteFaculty,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.faculty() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.colleges() });
    },
  });
};

export const useToggleFacultyStatus = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, { facultyId: string; status: "active" | "inactive" }>({
    mutationFn: ({ facultyId, status }) => toggleFacultyStatus(facultyId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.faculty() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};

export const useResetFacultyPassword = () => {
  const queryClient = useQueryClient();
  return useMutation<CredentialResetResult, SuperAdminApiError, string>({
    mutationFn: resetFacultyPassword,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.faculty() });
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════
// COLLEGE RESET HOOK
// ═══════════════════════════════════════════════════════════════════════
export const useRelinkFacultyToCollege = () => {
  const queryClient = useQueryClient();
  return useMutation<
    RelinkFacultyResult,
    SuperAdminApiError,
    { collegeId: string; facultyDocIds?: string[]; dryRun?: boolean }
  >({
    mutationFn: relinkFacultyToCollege,
    onSuccess: (result) => {
      if (result.dryRun) return;
      queryClient.invalidateQueries({ queryKey: superAdminKeys.colleges() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.faculty() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};

export const useResetCollegeData = () => {
  const queryClient = useQueryClient();
  return useMutation<
    ResetCollegeDataResult,
    SuperAdminApiError,
    string
  >({
    mutationFn: (collegeId: string) => resetCollegeData(collegeId, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.colleges() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.faculty() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.students() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.admins() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};

// ═══════════════════════════════════════════════════════════════════════
// BULK CREDENTIAL RESET HOOKS
// ═══════════════════════════════════════════════════════════════════════
export const useBulkResetStudentPasswords = () => {
  return useMutation<
    BulkResetOutcome,
    SuperAdminApiError,
    { items: BulkResetItem[]; onProgress?: (p: BatchProgress) => void }
  >({
    mutationFn: ({ items, onProgress }) => bulkResetStudentPasswords(items, onProgress),
  });
};

export const useBulkResetFacultyPasswords = () => {
  return useMutation<
    BulkResetOutcome,
    SuperAdminApiError,
    { items: BulkResetItem[]; onProgress?: (p: BatchProgress) => void }
  >({
    mutationFn: ({ items, onProgress }) => bulkResetFacultyPasswords(items, onProgress),
  });
};

export type { BulkResetItem, BulkResetOutcome } from "../api/superAdminApi";

// ═══════════════════════════════════════════════════════════════════════
// PLATFORM-ACCESS PRODUCTS + MIS
// ═══════════════════════════════════════════════════════════════════════
export const useAccessProducts = () => {
  return useQuery<AccessProduct[], SuperAdminApiError>({
    queryKey: superAdminKeys.accessProducts(),
    queryFn: listAccessProducts,
    staleTime: 1000 * 60 * 5,
  });
};

export const useCreateAccessProduct = () => {
  const queryClient = useQueryClient();
  return useMutation<string, SuperAdminApiError, AccessProductInput>({
    mutationFn: createAccessProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.accessProducts() });
    },
  });
};

export const useUpdateAccessProduct = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, { productId: string; updates: Partial<AccessProductInput> }>({
    mutationFn: ({ productId, updates }) => updateAccessProduct(productId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.accessProducts() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.accessMis() });
    },
  });
};

export const useArchiveAccessProduct = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, { productId: string; active: boolean }>({
    mutationFn: ({ productId, active }) => archiveAccessProduct(productId, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.accessProducts() });
    },
  });
};

export const useDeleteAccessProduct = () => {
  const queryClient = useQueryClient();
  return useMutation<void, SuperAdminApiError, string>({
    mutationFn: deleteAccessProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.accessProducts() });
    },
  });
};

export const useAccessMis = (collegeId?: string) => {
  return useQuery<AccessMisResponse, SuperAdminApiError>({
    queryKey: superAdminKeys.accessMis(collegeId),
    queryFn: () => getAccessMis(collegeId),
    staleTime: 1000 * 60 * 2,
  });
};

export const useBulkUpdateStudentAccess = () => {
  const queryClient = useQueryClient();
  return useMutation<BulkAccessUpdateResult, SuperAdminApiError, BulkAccessUpdateInput>({
    mutationFn: bulkUpdateStudentAccess,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: superAdminKeys.students() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.accessMis() });
      queryClient.invalidateQueries({ queryKey: superAdminKeys.dashboard() });
    },
  });
};
