// functions/src/index.ts
// Main entry point — V2 HTTPS + Callable functions

import './globalOptions'
import { onRequest } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import express from 'express'
import cors from 'cors'

// ─── Load .env BEFORE anything else ───
import * as dotenv from 'dotenv'
dotenv.config()

// ─── Initialize Firebase Admin ───
import * as admin from 'firebase-admin'
admin.initializeApp()

// ─── Import routes ───
import { router as aiQuestionsRouter } from './routes/ai-questions'
import { router as aiChatRouter } from './routes/ai-chat'
import { router as prepRouter } from './routes/prep'
import { router as questionsRouter } from './routes/questions'
import { router as papersRouter } from './routes/papers'
import { router as configRouter } from './routes/config'
import { router as resumeRouter } from './routes/resume'
import { generalLimiter } from './middleware/rateLimit'
import { router as admissionIntakeRouter } from './routes/admissionIntake'
import { router as questionImportRouter } from './routes/questionImport'

// ═══════ Student Auth callable functions ═══════
import {
  syncStudentsToAuth,
  createStudentAuth,
  bulkCreateStudentAccounts,
} from './studentAuth'
import { provisionUser } from './userProvisioning'
import { grantUserRole, diagnoseIdentity } from './roleManagement'
import { manageOfficeStaff } from './officeStaff'
import { bulkProvisionStaff } from './staffAuth'
import { updateFacultyBranches } from './facultyManagement'
import { bulkUpdateStudentAcademicFields } from './studentManagement'
import { bulkUpdateStudentAccess, getAccessMis } from './accessProducts'
import { resetUserPassword, syncIdentityClaims, clearMyMustChangePassword } from './accountManagement'
import { auditAndRepairIdentities } from './identityRepair'
import { syncMyIdentity } from './selfIdentity'
import { saveMyStaffAttendance } from './staffAttendanceWrites'
import { resetCollegeData } from './collegeCleanup'
import { relinkFacultyToCollege } from './collegeLinks'
import { createFeePaymentOrder, verifyFeePayment, razorpayWebhook } from './payments'
import {
  beginMyAssignmentSubmission,
  cancelMyAssignmentSubmission,
  cleanupExpiredAssignmentSubmissionDrafts,
  finalizeMyAssignmentSubmission,
  getMyAssignments,
  gradeAssignmentSubmission,
  updateMyStudentProfile,
  listMentorDirectory,
  createFacultyAssignment,
  updateFacultyAssignment,
  transitionFacultyAssignment,
  deleteFacultyAssignmentDraft,
  getAssignmentSubmissionDownload,
} from './studentPortal'
import { runStudentCode } from './codeRunner'
import {
  getMyStudentTests,
  getMyTestInstructions,
  startMyStudentTest,
  getMyActiveStudentTest,
  autosaveMyStudentTest,
  submitMyStudentTest,
  logMyStudentTestEvent,
  getMyStudentTestResult,
  getAssessmentTestReport,
  suggestAssessmentGrading,
  getAssessmentConfig,
  saveAssessmentConfig,
  listManagedAssessmentTests,
  scheduleAssessmentTest,
  checkPaperScheduling,
  publishAssessmentTest,
  cancelAssessmentTest,
  gradeStudentAssessmentSubmission,
  listPendingAssessmentSubmissions,
  autoSubmitExpiredStudentTests,
} from './studentAssessments'
import { aiModelCanary } from './aiModelCanary'
import { refreshPlatformStats } from './platformStats'
import {
  backfillAttendanceSummaries,
  onAttendanceRecordWrite,
  reconcileAttendanceSummaries,
} from './attendanceSummary'
import {
  listManagedGradeRecords,
  saveDraftGradeRecords,
  publishGradeRecords,
  deleteDraftGradeRecords,
} from './gradeRecords'
import { savePaper, reviewPaper, submitPaperForReview, reopenPaperForEditing, getPaperFileDownload, deletePaper } from './paperWorkflow'
import { parsePaperFile, confirmPaperStructure } from './paperParsing'
// ─── Slice 2 "Delivery Spine" — timetable → class sessions ───
import {
  generateClassSessions,
  cancelWeeklySchedule,
  rescheduleClass,
  ensureClassSession,
  completeClassSession,
  getCurriculumProgress,
} from './classSchedule'
// ─── Auto curriculum ↔ faculty mapping (preview + apply) ───
import { autoMapCurriculum, applyAutoMapping } from './autoCurriculumMapping'
// ─── Bulk schedule import: validate → clash-check → (optional) write ───
import { bulkImportWeeklySchedules } from './scheduleImport'
// ─── University scheme packs: custom packs + college assignment (G1) ───
import { saveSchemePack, assignCollegeSchemePack } from './schemePacks'
// ─── Auto slot scheduler: day×period grid placement + coverage (G4) ───
import { autoGenerateWeeklySchedule } from './autoSchedule'
// ─── Academic calendar: holidays, fests, exam windows (Auto-Scheduler v2) ────
import { saveCalendarEvent, deleteCalendarEvent } from './calendar'
// ─── Assignment completion analytics (course/module/batch/division) ───
import { getAssignmentAnalytics } from './assignmentAnalytics'
// ─── Announcements: server-authoritative targeting + per-recipient reads ───
import {
  sendAnnouncement,
  listCollegeAnnouncements,
  deleteAnnouncement,
  setAnnouncementPinned,
  getMyNotifications,
  markMyNotificationRead,
  markAllMyNotificationsRead,
} from './notifications'
// ─── Student journey: real CGPA, cohort standing, readiness ───
import { getMyAcademicJourney } from './studentJourney'
import { getMyCurriculum } from './studentCurriculum'
import { getMyStudentAcademicContext, getFacultyAcademicContext, getPaperAcademicContext } from './academic/contextCallables'
// ─── Admission Center: the funnel before a student record exists ───
import {
  saveAdmissionApplication,
  transitionAdmissionStage,
  listAdmissionApplications,
  deleteAdmissionApplication,
  exportAdmittedApplicants,
  markAdmissionExported,
  getAdmissionConfig,
  saveAdmissionConfig,
  rotateAdmissionIngestToken,
  disableAdmissionIntake,
} from './admissions'

const app = express()

// API is protected by Firebase auth tokens, so reflect the caller's origin
// rather than hard-coding a host list. This keeps the Firebase Hosting app,
// local development and preview environments all working.
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-College-Id'],
}))

app.options('*', cors())
app.use(express.json({ limit: '10mb' }))
app.use(generalLimiter)

const healthHandler = (req: any, res: any) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.2.0',
    environment: 'firebase-functions',
  })
}
app.get('/api/health', healthHandler)
app.get('/health', healthHandler)
app.get('/', healthHandler)

// ─── Mount routes ───
// Support both /api/* and /* paths because Firebase Functions v2 strips the function name
// from the URL. Calling https://.../api/ai/generate-questions arrives as /ai/generate-questions
app.use('/api/ai-chat', aiChatRouter)
app.use('/ai-chat', aiChatRouter)
app.use('/api/ai-questions', aiQuestionsRouter)
app.use('/ai-questions', aiQuestionsRouter)
app.use('/api/ai', aiChatRouter)
app.use('/ai', aiChatRouter)
app.use('/api/ai', aiQuestionsRouter)
app.use('/ai', aiQuestionsRouter)
app.use('/api/questions', questionsRouter)
app.use('/questions', questionsRouter)
app.use('/api/papers', papersRouter)
app.use('/papers', papersRouter)
app.use('/api/prep', prepRouter)
app.use('/prep', prepRouter)
app.use('/api/config', configRouter)
// Resume Builder add-on (student editor, PDF credits, college settings).
app.use('/api/resume', resumeRouter)
app.use('/resume', resumeRouter)

// Bulk question-paper import (PYQ corpus → question bank drafts). Mounted on its
// own prefix so it can never shadow /questions/:id style routes.
app.use('/api/question-import', questionImportRouter)
app.use('/question-import', questionImportRouter)

// Public Google Form intake — token-gated, no Firebase auth.
app.use('/api/admissions', admissionIntakeRouter)
app.use('/config', configRouter)

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path })
})

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Global error:', err)
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  })
})

// ─── Express API export (v2) ───
// FIX: Removed secrets array to avoid overlap error "Secret env var overlaps non-secret env var"
// GEMINI_API_KEY etc should be set via regular env vars (.env file) or Firebase env config
// If you want to use Secret Manager, set them ONLY as secrets and remove from .env
// Item 4.4: back to 512MiB. The three routes that launch headless Chrome now
// live in their own `pdf` function (routes/pdf.ts, re-exported below), so
// ordinary API traffic no longer pays for a Chrome-sized instance. The PDF
// routes stay mounted HERE for one release as well: an older deployed bundle
// still calls <api>/papers/:id/pdf, and that must keep working until the next
// release removes the old mounts.
export const api = onRequest(
  {
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 60,
    minInstances: 0,
    maxInstances: 10,
  },
  app
)

// The Chrome-sized half of the API (item 4.4). See routes/pdf.ts for the mount
// contract and the one-release overlap with `api`.
export { pdf } from './routes/pdf'

// Vriddhi platform employees (global academic staff assigned to colleges).
export {
  assignEmployeeColleges,
  setEmployeeActiveCollege,
  getMyEmployeeAccess,
  listPlatformEmployees,
  suspendPlatformEmployee,
} from './employeeAccess'

// ═══════ Callable functions exports ═══════
export {
  syncStudentsToAuth,
  createStudentAuth,
  bulkCreateStudentAccounts,
  provisionUser,
  bulkProvisionStaff,
  updateFacultyBranches,
  bulkUpdateStudentAcademicFields,
  bulkUpdateStudentAccess,
  getAccessMis,
  resetUserPassword,
  syncIdentityClaims,
  clearMyMustChangePassword,
  grantUserRole,
  manageOfficeStaff,
  diagnoseIdentity,
  auditAndRepairIdentities,
  syncMyIdentity,
  saveMyStaffAttendance,
  resetCollegeData,
  relinkFacultyToCollege,
  createFeePaymentOrder,
  verifyFeePayment,
  razorpayWebhook,
  updateMyStudentProfile,
  runStudentCode,
  listMentorDirectory,
  getMyAssignments,
  beginMyAssignmentSubmission,
  finalizeMyAssignmentSubmission,
  cancelMyAssignmentSubmission,
  gradeAssignmentSubmission,
  cleanupExpiredAssignmentSubmissionDrafts,
  createFacultyAssignment,
  updateFacultyAssignment,
  transitionFacultyAssignment,
  deleteFacultyAssignmentDraft,
  getAssignmentSubmissionDownload,
  getMyStudentTests,
  getMyTestInstructions,
  startMyStudentTest,
  getMyActiveStudentTest,
  autosaveMyStudentTest,
  submitMyStudentTest,
  logMyStudentTestEvent,
  getMyStudentTestResult,
  getAssessmentTestReport,
  suggestAssessmentGrading,
  getAssessmentConfig,
  saveAssessmentConfig,
  listManagedAssessmentTests,
  scheduleAssessmentTest,
  checkPaperScheduling,
  publishAssessmentTest,
  cancelAssessmentTest,
  gradeStudentAssessmentSubmission,
  listPendingAssessmentSubmissions,
  autoSubmitExpiredStudentTests,
  aiModelCanary,
  refreshPlatformStats,
  onAttendanceRecordWrite,
  reconcileAttendanceSummaries,
  backfillAttendanceSummaries,
  listManagedGradeRecords,
  saveDraftGradeRecords,
  publishGradeRecords,
  deleteDraftGradeRecords,
  savePaper,
  reviewPaper,
  submitPaperForReview,
  reopenPaperForEditing,
  getPaperFileDownload,
  deletePaper,
  parsePaperFile,
  confirmPaperStructure,
  generateClassSessions,
  cancelWeeklySchedule,
  rescheduleClass,
  ensureClassSession,
  completeClassSession,
  getCurriculumProgress,
  autoMapCurriculum,
  applyAutoMapping,
  bulkImportWeeklySchedules,
  saveSchemePack,
  assignCollegeSchemePack,
  autoGenerateWeeklySchedule,
  saveCalendarEvent,
  deleteCalendarEvent,
  getAssignmentAnalytics,
  sendAnnouncement,
  listCollegeAnnouncements,
  deleteAnnouncement,
  setAnnouncementPinned,
  getMyNotifications,
  markMyNotificationRead,
  markAllMyNotificationsRead,
  getMyAcademicJourney,
  getMyCurriculum,
  getMyStudentAcademicContext,
  getFacultyAcademicContext,
  getPaperAcademicContext,
  saveAdmissionApplication,
  transitionAdmissionStage,
  listAdmissionApplications,
  deleteAdmissionApplication,
  exportAdmittedApplicants,
  markAdmissionExported,
  getAdmissionConfig,
  saveAdmissionConfig,
  rotateAdmissionIngestToken,
  disableAdmissionIntake,
}
