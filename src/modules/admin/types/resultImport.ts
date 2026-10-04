// src/modules/admin/types/resultImport.ts
// University Result Importer - BCU, BNU, Davangere, Rani Channamma

export type ResultImportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ResultImportRow {
  rowNumber: number;
  // Student
  regNo: string;
  usn?: string;
  name: string;
  email?: string;
  course?: string;
  branch?: string;
  batch?: string;
  courseType?: string;
  /** Resolved per-row; retained only through preview/grouping, never written into source files. */
  schemePack?: import('@/shared/types/schemePack').UniversitySchemePack;
  schemePackId?: string | null;
  schemePackResolution?: 'cohort' | 'programme' | 'college' | 'platform';
  semester: number;
  
  // Subject
  subjectCode: string;
  subjectName: string;
  credits?: number;
  
  // Marks - BCU pattern: Internal 20 + External 80 = 100
  internal?: number;
  external?: number;
  total?: number;
  maxMarks?: number;
  
  // Grade
  grade?: string;
  gradePoint?: number;
  
  // Result
  result?: 'P' | 'F' | 'A' | 'W' | 'PASS' | 'FAIL';
  
  // SGPA/CGPA (optional, will calculate if not provided)
  sgpa?: number;
  cgpa?: number;
  
  // Marks card
  marksCardNo?: string;
  
  // Validation
  isValid?: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface ResultImportBatch {
  id: string;
  collegeId: string;
  universityId?: string;
  academicYear: string;
  semester: number;
  examType: 'regular' | 'supplementary' | 'revaluation';
  scheme: string; // SEP 2024, NEP 2020 etc
  
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  
  status: ResultImportStatus;
  progress: number; // 0-100
  
  // Stats
  passedCount?: number;
  failedCount?: number;
  averagePercentage?: number;
  averageSGPA?: number;
  
  // Processing
  importedCount?: number;
  failedCountImport?: number;
  errors?: Array<{
    rowNumber: number;
    regNo?: string;
    field: string;
    message: string;
  }>;
  
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

export interface ResultImportPreview {
  rows: ResultImportRow[];
  /**
   * G1: the scheme pack this file was validated against (college's assigned
   * university pack; BCU default when unassigned). Pass it to
   * groupResultsByStudent so grades/pass outcomes use the same rules.
   */
  schemePack?: import('@/shared/types/schemePack').UniversitySchemePack;
  /** A result file may contain more than one cohort using a different scoped pack. */
  schemePacks?: Record<string, import('@/shared/types/schemePack').UniversitySchemePack>;
  summary: {
    totalStudents: number;
    totalSubjects: number;
    uniqueStudents: number;
    averageMarks: number;
    passCount: number;
    failCount: number;
    passPercentage: number;
    gradeDistribution: Record<string, number>;
  };
  errors: Array<{
    rowNumber: number;
    message: string;
  }>;
  warnings: Array<{
    rowNumber: number;
    message: string;
  }>;
}

export interface ParsedResult {
  studentId?: string;
  studentName: string;
  regNo: string;
  usn?: string;
  semester: number;
  course?: string;
  branch?: string;
  batch?: string;
  schemePackId?: string | null;
  schemePackCode?: string;
  schemePackResolution?: 'cohort' | 'programme' | 'college' | 'platform';
  
  subjects: Array<{
    subjectCode: string;
    subjectName: string;
    credits?: number;
    courseType?: string;
    internal: number;
    external: number;
    total: number;
    maxMarks: number;
    grade: string;
    gradePoint: number;
    result: 'P' | 'F';
    isPass: boolean;
  }>;
  
  totalMarks: number;
  maxTotalMarks: number;
  percentage: number;
  sgpa: number;
  result: 'PASS' | 'FAIL' | 'ATKT';
  creditsEarned: number;
  totalCredits: number;
}

// Template for import
export const RESULT_IMPORT_TEMPLATE_HEADERS = [
  'regNo',
  'name',
  'semester',
  'subjectCode',
  'subjectName',
  'credits',
  'internal',
  'external',
  'total',
  'grade',
  'gradePoint',
  'result',
  'sgpa',
  'course',
  'batch',
];

export const RESULT_IMPORT_SAMPLE_ROWS = [
  {
    regNo: 'BCU2024BCA001',
    name: 'Ramesh Kumar',
    semester: 3,
    subjectCode: 'BCA301',
    subjectName: 'Data Structures',
    credits: 4,
    internal: 18,
    external: 65,
    total: 83,
    grade: 'A+',
    gradePoint: 9,
    result: 'P',
    sgpa: 8.5,
    course: 'BCA',
    batch: '2024-25',
  },
  {
    regNo: 'BCU2024BCA001',
    name: 'Ramesh Kumar',
    semester: 3,
    subjectCode: 'BCA302',
    subjectName: 'Database Management',
    credits: 4,
    internal: 16,
    external: 58,
    total: 74,
    grade: 'A',
    gradePoint: 8,
    result: 'P',
    sgpa: 8.5,
    course: 'BCA',
    batch: '2024-25',
  },
];
