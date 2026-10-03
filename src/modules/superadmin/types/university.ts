// src/types/university.ts
// University, College Classification & Karnataka District Mapping Types

import { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

// ═══════════════════════════════════════════════════════════════════════
// UNIVERSITY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════

export type UniversityManagementType = "Government" | "Government Aided" | "Private";

export type AutonomyStatus = "Autonomous" | "Non-Autonomous";

export type UniversityPriority = 1 | 2 | 3 | 4 | 5 | null;

export type CourseCode = string;

export const ALL_COURSES: CourseCode[] = [
  "BA",
  "B.Com",
  "BBA",
  "BCA",
  "B.Sc",
  "BSW",
  "BPA",
  "B.Voc",
];

export const CORE_COURSES: CourseCode[] = ["BA", "B.Com", "BBA", "BCA", "B.Sc"];

// ═══════════════════════════════════════════════════════════════════════
// UNIVERSITY
// ═══════════════════════════════════════════════════════════════════════

export interface University {
  id: string;
  name: string;
  shortName: string;
  code: string; // e.g., "BU", "BCU", "MYS"
  managementType: UniversityManagementType;
  // Priority for Vriddhi rollout (1 = highest)
  priority: UniversityPriority;
  // Districts this university covers
  districts: string[];
  // Approximate affiliated college count range
  collegeCountMin: number;
  collegeCountMax: number;
  // Courses offered by this university
  courses: CourseCode[];
  // Special flags
  isWomensUniversity?: boolean;
  isNewUniversity?: boolean; // Post-2017 bifurcation
  // Contact / metadata
  website?: string;
  location?: string; // Headquarters city
  establishedYear?: number;
  // Vriddhi tracking
  onboardedColleges?: number;
  activeColleges?: number;
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt: string;
}

export interface CreateUniversityInput {
  name: string;
  shortName: string;
  code: string;
  managementType: UniversityManagementType;
  priority?: UniversityPriority;
  districts: string[];
  collegeCountMin: number;
  collegeCountMax: number;
  courses: CourseCode[];
  isWomensUniversity?: boolean;
  isNewUniversity?: boolean;
  website?: string;
  location?: string;
  establishedYear?: number;
}

export interface UpdateUniversityInput {
  name?: string;
  shortName?: string;
  code?: string;
  managementType?: UniversityManagementType;
  priority?: UniversityPriority;
  districts?: string[];
  collegeCountMin?: number;
  collegeCountMax?: number;
  courses?: CourseCode[];
  isWomensUniversity?: boolean;
  isNewUniversity?: boolean;
  website?: string;
  location?: string;
  establishedYear?: number;
  status?: "active" | "inactive" | "pending";
  onboardedColleges?: number;
  activeColleges?: number;
}

export interface ListUniversitiesOptions {
  status?: "active" | "inactive" | "pending" | "all";
  managementType?: UniversityManagementType | "all";
  priority?: number | "all";
  search?: string;
  limit?: number;
  pageSize?: number;
  lastDoc?: QueryDocumentSnapshot<DocumentData>;
}

// ═══════════════════════════════════════════════════════════════════════
// COLLEGE CLASSIFICATION (extends existing College type)
// ═══════════════════════════════════════════════════════════════════════

export interface CollegeClassification {
  // References
  universityId: string;
  universityName: string;
  universityShortName?: string;
  // Classification
  managementType: UniversityManagementType;
  autonomyStatus: AutonomyStatus;
  // Location
  district: string;
  // Courses this specific college offers (subset of university courses)
  offeredCourses: CourseCode[];
  // Vriddhi-specific
  vriddhiStatus: "not_onboarded" | "onboarding" | "active" | "suspended";
  onboardingDate?: string;
  // For analytics
  priorityTier?: number; // Inherited from university
}

// Partial update for existing colleges
export interface UpdateCollegeClassificationInput {
  universityId?: string;
  universityName?: string;
  managementType?: UniversityManagementType;
  autonomyStatus?: AutonomyStatus;
  district?: string;
  offeredCourses?: CourseCode[];
  vriddhiStatus?: "not_onboarded" | "onboarding" | "active" | "suspended";
}

// ═══════════════════════════════════════════════════════════════════════
// DISTRICT MAPPING
// ═══════════════════════════════════════════════════════════════════════

export interface DistrictUniversityMapping {
  district: string;
  primaryUniversityId: string;
  primaryUniversityName: string;
  secondaryUniversityId?: string; // For districts with multiple affiliations
  secondaryUniversityName?: string;
  courses: CourseCode[];
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// ANALYTICS / DASHBOARD
// ═══════════════════════════════════════════════════════════════════════

export interface UniversityStats {
  totalUniversities: number;
  totalColleges: number;
  onboardedColleges: number;
  activeColleges: number;
  byManagementType: Record<UniversityManagementType, number>;
  byPriority: Record<string, number>;
  byDistrict: Record<string, number>;
  coveragePercentage: number; // (onboarded / total) * 100
}

export interface UniversityRolloutProgress {
  universityId: string;
  universityName: string;
  priority: number;
  targetColleges: number;
  onboardedColleges: number;
  activeColleges: number;
  percentageComplete: number;
  lastOnboardedDate?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════════════

export function isValidCourseForUniversity(
  course: CourseCode,
  universityCourses: CourseCode[]
): boolean {
  return universityCourses.includes(course);
}

export function getUniversityByDistrict(
  district: string,
  mappings: DistrictUniversityMapping[]
): DistrictUniversityMapping | undefined {
  return mappings.find((m) => m.district === district);
}

export function getPriorityLabel(priority: UniversityPriority): string {
  if (priority === 1) return "Phase 1 — Critical";
  if (priority === 2) return "Phase 2 — High";
  if (priority === 3) return "Phase 3 — Medium";
  if (priority === 4) return "Phase 4 — Low";
  if (priority === 5) return "Phase 5 — Future";
  return "Unprioritized";
}

export function getManagementTypeColor(type: UniversityManagementType): string {
  switch (type) {
    case "Government":
      return "#14b8a6"; // teal-500
    case "Government Aided":
      return "#6366f1"; // indigo-500
    case "Private":
      return "#f59e0b"; // amber-500
    default:
      return "#94a3b8"; // slate-400
  }
}

export function getAutonomyColor(status: AutonomyStatus): string {
  return status === "Autonomous" ? "#22c55e" : "#64748b";
}

