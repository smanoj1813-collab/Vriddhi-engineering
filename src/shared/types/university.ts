// src/shared/types/university.ts

export type ManagementType = 'government' | 'private' | 'aided' | 'autonomous' | 'deemed' | 'Government' | 'Private' | 'Aided' | 'Autonomous' | 'Deemed';
export type PriorityLevel = 1 | 2 | 3 | 4 | 5;
export type UniversityStatus = 'active' | 'inactive' | 'pending' | 'onboarding';
export type CourseCode = string;

export interface UniversityCourse {
  id: string;
  name: string;
  duration: string;
  type: string;
  specialization?: string;
}

export interface UniversityCollege {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'pending' | 'onboarding';
  location?: string;
  city?: string;
  district?: string;
  code?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// UNIVERSITY CLASSIFICATION (shared with types/superAdmin.ts)
// ═══════════════════════════════════════════════════════════════════════
export type UniversityManagementType = "Government" | "Government Aided" | "Private";
export type AutonomyStatus = "Autonomous" | "Non-Autonomous";
export type VriddhiStatus = "not_onboarded" | "onboarding" | "active" | "suspended";

export interface University {
  id: string;
  name: string;
  shortName?: string;
  code?: string;
  location: string;
  city?: string;
  district?: string;
  districts?: string[];
  state?: string;
  managementType: ManagementType;
  priority: PriorityLevel | null;
  status: UniversityStatus;
  courses: CourseCode[];
  colleges?: UniversityCollege[];
  establishedYear?: number;
  website?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  description?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  accreditation?: string;
  naacGrade?: string;
  nbaAccredited?: boolean;
  totalStudents?: number;
  totalFaculty?: number;
  departments?: string[];
  affiliatedColleges?: number;
  collegeCountMin: number;
  collegeCountMax: number;
  onboardedColleges?: number;
  activeColleges?: number;
  isNewUniversity?: boolean;
  isWomensUniversity?: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

// ═══════════════════════════════════════════════════════════════════════
// MISSING TYPES (needed by universityApi.ts)
// ═══════════════════════════════════════════════════════════════════════

export interface CreateUniversityInput {
  name: string;
  shortName?: string;
  code: string;
  managementType?: ManagementType;
  priority?: number | null;
  districts?: string[];
  collegeCountMin?: number;
  collegeCountMax?: number;
  courses?: CourseCode[];
  isWomensUniversity?: boolean;
  isNewUniversity?: boolean;
  website?: string;
  location?: string;
  establishedYear?: number;
  status?: UniversityStatus;
  city?: string;
  district?: string;
  state?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  description?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  accreditation?: string;
  naacGrade?: string;
  nbaAccredited?: boolean;
  totalStudents?: number;
  totalFaculty?: number;
  departments?: string[];
  affiliatedColleges?: number;
}

export interface UpdateUniversityInput extends Partial<CreateUniversityInput> {}

export interface CollegeClassification {
  universityId: string;
  universityName?: string;
  managementType?: UniversityManagementType;
  autonomyStatus?: AutonomyStatus;
  district?: string;
  offeredCourses?: CourseCode[];
  vriddhiStatus?: VriddhiStatus;
}

export interface UpdateCollegeClassificationInput extends Partial<CollegeClassification> {}

export interface UniversityRolloutProgress {
  universityId: string;
  universityName: string;
  priority: number;
  targetColleges: number;
  onboardedColleges: number;
  activeColleges: number;
  percentageComplete: number;
}

export interface ListUniversitiesOptions {
  status?: string;
  managementType?: string;
  priority?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface UniversityStats {
  totalUniversities: number;
  totalColleges: number;
  onboardedColleges: number;
  activeColleges: number;
  coveragePercentage: number;
  byManagementType: Record<string, number>;
  byPriority: Record<string, number>;
  byDistrict: Record<string, number>;
}

export interface RolloutItem {
  id: string;
  universityId: string;
  universityName: string;
  priority: number;
  status: string;
  targetDate?: Date | string;
  completedDate?: Date | string;
  notes?: string;
  targetColleges?: number;
  percentageComplete?: number;
  onboardedColleges?: number;
}

export interface DistrictUniversityMapping {
  district: string;
  primaryUniversityId: string;
  primaryUniversityName: string;
  secondaryUniversityId?: string;
  secondaryUniversityName?: string;
  courses: CourseCode[];
  notes?: string;
}

export interface UniversityPriorityConfig {
  universityId: string;
  priority: number;
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

export const getPriorityLabel = (priority: number): string => {
  const labels: Record<number, string> = {
    1: 'Critical',
    2: 'High',
    3: 'Medium',
    4: 'Low',
    5: 'Backlog',
  };
  return labels[priority] || 'Unknown';
};

export const getManagementTypeColor = (type: string): string => {
  const normalized = type.toLowerCase();
  const colors: Record<string, string> = {
    government: 'bg-blue-100 text-blue-800',
    private: 'bg-purple-100 text-purple-800',
    aided: 'bg-green-100 text-green-800',
    autonomous: 'bg-orange-100 text-orange-800',
    deemed: 'bg-pink-100 text-pink-800',
  };
  return colors[normalized] || 'bg-gray-100 text-gray-800';
};

/** Returns hex colors for inline styles (used by University Master table avatars) */
export const getManagementTypeColorHex = (type: string): { bg: string; text: string } => {
  const normalized = type.toLowerCase();
  const colors: Record<string, { bg: string; text: string }> = {
    government: { bg: "#1e40af", text: "#60a5fa" },
    private: { bg: "#7e22ce", text: "#c084fc" },
    aided: { bg: "#15803d", text: "#4ade80" },
    autonomous: { bg: "#c2410c", text: "#fb923c" },
    deemed: { bg: "#be185d", text: "#f472b6" },
  };
  return colors[normalized] || { bg: "#4b5563", text: "#9ca3af" };
};

export const getStatusColor = (status: string): string => {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    inactive: 'bg-red-100 text-red-800',
    pending: 'bg-yellow-100 text-yellow-800',
    onboarding: 'bg-blue-100 text-blue-800',
  };
  return colors[status] || 'bg-gray-100 text-gray-800';
};
