import React, { useState, useEffect } from "react";
import { useCollegeBranding } from '@/shared/hooks/useCollegeBranding';
import { Outlet, useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth, type UserRole } from '../../modules/auth/context/AuthContext';
import { useThemeMode } from "../contexts/ThemeProvider";
import { useTranslation } from "../contexts/LanguageProvider";
import LanguageSwitcher from "./LanguageSwitcher";
import VriddhiLogo from "./VriddhiLogo";
import type { TranslationKey } from "../i18n";
import FloatingAIChatWidget from "./FloatingAIChatWidget";
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  IconButton,
  Avatar,
  Divider,
  Badge,
  Tooltip,
  Menu,
  MenuItem,
  Chip,
  Collapse,
} from "@mui/material";
import {
  ChevronLeft,
  ChevronRight,
  Dashboard,
  People,
  School,
  Assessment,
  Settings,
  ExitToApp,
  Assignment,
  CalendarToday,
  TrendingUp,
  QuestionAnswer,
  Description,
  AdminPanelSettings,
  SupervisedUserCircle,
  Business,
  UploadFile,
  PersonAdd,
  ManageAccounts,
  AttachMoney,
  BarChart as BarChartIcon,
  CreditCard as CreditCardIcon,
  MonitorHeart as MonitorHeartIcon,
  LightMode,
  DarkMode,
  AccountBalance,
  CheckCircle,
  Badge as BadgeIcon,
  AutoAwesome,
  Campaign,
  FolderZip,
  NotificationsNone,
  SwapHoriz,
  ExpandMore,
  ExpandLess,
  RateReview,
  InstallMobile,
  Apps,
  Close as CloseIcon,
  LocalLibrary,
  Inventory2,
  ShoppingCart,
  Storefront,
  ReceiptLong,
  AssignmentTurnedIn,
  AccountBalanceWallet,
  Layers as LayersIcon,
} from "@mui/icons-material";
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/Firebase/config';
import { isPwaStandalone, requestPwaInstall } from '../pwa/install';
import { canAccessAdminPath, type AccessSettings } from '@/modules/auth/permissions';
import { useAccessSettings } from '@/modules/admin/hooks/useAccessSettings';
import { useCollegeModules } from '@/shared/hooks/useCollegeModules';

const DRAWER_EXPANDED_WIDTH = 260;
const DRAWER_COLLAPSED_WIDTH = 76;

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  roles: string[];
  badge?: number;
  section?: string;
}

const NAV_LABEL_KEYS: Record<string, TranslationKey> = {
  Dashboard: "nav.dashboard",
  Colleges: "nav.colleges",
  Universities: "nav.universities",
  "Create College": "nav.createCollege",
  Admins: "nav.admins",
  "Create Admin": "nav.createAdmin",
  "Manage Faculty": "nav.manageFaculty",
  "Import Faculty": "nav.importFaculty",
  "Manage Students": "nav.manageStudents",
  "Import Students": "nav.importStudents",
  Curriculum: "nav.curriculum",
  Comparison: "nav.comparison",
  Billing: "nav.billing",
  "System Health": "nav.systemHealth",
  Students: "nav.students",
  "360° View": "nav.view360",
  Attendance: "nav.attendance",
  "Faculty Attendance": "nav.facultyAttendance",
  Assessments: "nav.assessments",
  "Question Bank": "nav.questionBank",
  "Question Review": "nav.questionReview",
  "AI Question Generator": "nav.aiQuestionGenerator",
  "Paper Generator": "nav.paperGenerator",
  "Class Schedule": "nav.classSchedule",
  "Fee Management": "nav.feeManagement",
  Analytics: "nav.analytics",
  Journey: "nav.journey",
  Settings: "nav.settings",
  "HOD Dashboard": "nav.hodDashboard",
  "Department Students": "nav.departmentStudents",
  "Mark Attendance": "nav.markAttendance",
  "My Attendance": "nav.myAttendance",
  "Mark Student Attendance": "nav.markStudentAttendance",
  Academics: "nav.academics",
  Insights: "nav.insights",
  "Upload Materials": "nav.uploadMaterials",
  "Assessment Schedule": "nav.assessmentSchedule",
  "My Curriculum": "nav.myCurriculum",
  Topics: "nav.topics",
  Assignments: "nav.assignments",
  "Upload Material": "nav.uploadMaterial",
  "Generated Papers": "nav.generatedPapers",
  "Student Analysis": "nav.studentAnalysis",
  "Reschedule Class": "nav.rescheduleClass",
  Announcements: "nav.announcements",
  Calendar: "nav.calendar",
  "Mentored Students": "nav.mentoredStudents",
  "Attendance Overview": "nav.attendanceOverview",
};

const navItems: NavItem[] = [
  // ─── SUPER ADMIN ───
  { label: "Dashboard", path: "/superadmin/dashboard", icon: <Dashboard fontSize="small" />, roles: ["superadmin"], section: "Overview" },
  { label: "Colleges", path: "/superadmin/colleges", icon: <Business fontSize="small" />, roles: ["superadmin"], section: "Institutions" },
  { label: "Universities", path: "/superadmin/universities", icon: <AccountBalance fontSize="small" />, roles: ["superadmin"], section: "Institutions" },
  { label: "Create College", path: "/superadmin/colleges/new", icon: <PersonAdd fontSize="small" />, roles: ["superadmin"], section: "Institutions" },
  { label: "Admins", path: "/superadmin/admins", icon: <SupervisedUserCircle fontSize="small" />, roles: ["superadmin"], section: "User Management" },
  { label: "Create Admin", path: "/superadmin/admins/new", icon: <AdminPanelSettings fontSize="small" />, roles: ["superadmin"], section: "User Management" },
  { label: "Access Control", path: "/superadmin/access", icon: <AdminPanelSettings fontSize="small" />, roles: ["superadmin"], section: "User Management" },
  { label: "Platform Employees", path: "/superadmin/employees", icon: <BadgeIcon fontSize="small" />, roles: ["superadmin"], section: "User Management" },
  { label: "Manage Faculty", path: "/superadmin/faculty", icon: <People fontSize="small" />, roles: ["superadmin"], section: "User Management" },
  { label: "Import Faculty", path: "/superadmin/faculty/import", icon: <UploadFile fontSize="small" />, roles: ["superadmin"], section: "User Management" },
  { label: "Manage Students", path: "/superadmin/students", icon: <ManageAccounts fontSize="small" />, roles: ["superadmin"], section: "User Management" },
  { label: "Import Students", path: "/superadmin/students/import", icon: <UploadFile fontSize="small" />, roles: ["superadmin"], section: "User Management" },
  { label: "Regenerate Credentials", path: "/superadmin/credentials/regenerate", icon: <BadgeIcon fontSize="small" />, roles: ["superadmin"], section: "User Management" },
  { label: "Curriculum", path: "/superadmin/curriculum", icon: <School fontSize="small" />, roles: ["superadmin"], section: "Academic" },
  // Prep Content Studio gets a first-class superadmin entry: it used to be
  // reachable only through /admin/settings → "AI Content & Cost" tab.
  { label: "Prep Content Studio", path: "/superadmin/prep-studio", icon: <AutoAwesome fontSize="small" />, roles: ["superadmin"], section: "Academic" },
  { label: "Question Bank", path: "/superadmin/question-bank", icon: <QuestionAnswer fontSize="small" />, roles: ["superadmin"], section: "Academic" },
  { label: "Comparison", path: "/superadmin/comparison", icon: <BarChartIcon fontSize="small" />, roles: ["superadmin"], section: "System" },
  { label: "Billing", path: "/superadmin/billing", icon: <CreditCardIcon fontSize="small" />, roles: ["superadmin"], section: "System" },
  // Products & Access MIS: the duration-and-price catalogue students are
  // onboarded onto, plus the subscription buckets and value per product.
  { label: "Products & Access MIS", path: "/superadmin/products", icon: <LayersIcon fontSize="small" />, roles: ["superadmin"], section: "System" },
  { label: "System Management", path: "/superadmin/system-management", icon: <Settings fontSize="small" />, roles: ["superadmin"], section: "System" },
  { label: "System Health", path: "/superadmin/health", icon: <MonitorHeartIcon fontSize="small" />, roles: ["superadmin"], section: "System" },
  // Superadmin can open the shared Settings surface (hosted under /admin, whose
  // RoleRoute already allows 'superadmin') to reach "AI Content & Cost" controls.
  { label: "Settings", path: "/admin/settings", icon: <Settings fontSize="small" />, roles: ["superadmin"], section: "System" },

  // ─── ADMIN / PRINCIPAL ───
  { label: "Dashboard", path: "/admin/dashboard", icon: <Dashboard fontSize="small" />, roles: ["admin", "principal"], section: "Main" },
  { label: "Students", path: "/admin/students", icon: <People fontSize="small" />, roles: ["admin", "principal"], section: "Academic" },
  { label: "360° View", path: "/admin/view360", icon: <Assessment fontSize="small" />, roles: ["admin", "principal"], section: "Academic" },
  { label: "Attendance", path: "/admin/attendance", icon: <CalendarToday fontSize="small" />, roles: ["admin", "principal"], section: "Academic" },
  { label: "Faculty Attendance", path: "/admin/faculty-attendance", icon: <BadgeIcon fontSize="small" />, roles: ["admin", "principal"], section: "Academic" },
  { label: "Assessments", path: "/admin/test-reports", icon: <Assignment fontSize="small" />, roles: ["admin", "principal"], section: "Academic" },
  { label: "Branch-wise Assessment Conduction", path: "/admin/branch-conduction", icon: <Assignment fontSize="small" />, roles: ["admin", "principal", "hod"], section: "Academic" },
  // Principal dropped earlier (question/paper craft is department work); the
  // HOD round then dropped Official Grade Records, Paper Review and Paper
  // Generator for `admin`/`hod` too — the department keeps the question bank
  // and AI drafting. Plug back = re-add the entries with their role strings
  // (and the roles in PAPER_CRAFT_ROLES, src/modules/admin/routes.tsx).
  { label: "Question Bank", path: "/admin/question-bank", icon: <QuestionAnswer fontSize="small" />, roles: ["admin"], section: "Assessment Tools" },
  { label: "AI Question Generator", path: "/admin/ai-questions", icon: <AutoAwesome fontSize="small" />, roles: ["admin"], section: "Assessment Tools" },
  { label: "Class Schedule", path: "/admin/class-schedule", icon: <CalendarToday fontSize="small" />, roles: ["admin", "principal"], section: "Operations" },
  { label: "Curriculum", path: "/admin/curriculum", icon: <School fontSize="small" />, roles: ["admin", "principal"], section: "Operations" },
  { label: "Admission Center", path: "/admin/admissions", icon: <People fontSize="small" />, roles: ["admin", "principal"], section: "Students" },
  { label: "Fee Management", path: "/admin/fee-management", icon: <AttachMoney fontSize="small" />, roles: ["principal"], section: "Finance" },
  { label: "Faculty Payroll", path: "/admin/payroll", icon: <AccountBalance fontSize="small" />, roles: ["principal"], section: "Finance" },
  { label: "Guest Faculty Billing", path: "/admin/guest-faculty-billing", icon: <BadgeIcon fontSize="small" />, roles: ["principal"], section: "Finance" },
  { label: "Finance Settings", path: "/admin/finance-settings", icon: <AttachMoney fontSize="small" />, roles: ["principal"], section: "Finance" },
  { label: "Analytics", path: "/admin/analytics", icon: <BarChartIcon fontSize="small" />, roles: ["admin", "principal"], section: "Insights" },
  // `admin` (= department HOD) dropped: assignment reporting is a principal lane.
  { label: "Assignment Analytics", path: "/admin/assignment-analytics", icon: <Assignment fontSize="small" />, roles: ["principal"], section: "Insights" },
  { label: "Journey", path: "/admin/journey", icon: <TrendingUp fontSize="small" />, roles: ["admin", "principal"], section: "Insights" },
  { label: "Settings", path: "/admin/settings", icon: <Settings fontSize="small" />, roles: ["admin", "principal"], section: "Settings" },

  // ─── HOD ───
  { label: "HOD Dashboard", path: "/admin/hod-dashboard", icon: <Dashboard fontSize="small" />, roles: ["hod"], section: "Main" },
  { label: "Department Students", path: "/admin/students", icon: <People fontSize="small" />, roles: ["hod"], section: "Academic" },
  { label: "360° View", path: "/admin/view360", icon: <Assessment fontSize="small" />, roles: ["hod"], section: "Academic" },
  { label: "Attendance", path: "/admin/attendance", icon: <CalendarToday fontSize="small" />, roles: ["hod"], section: "Academic" },
  { label: "Faculty Attendance", path: "/admin/faculty-attendance", icon: <BadgeIcon fontSize="small" />, roles: ["hod"], section: "Academic" },
  { label: "Assessments", path: "/admin/test-reports", icon: <Assignment fontSize="small" />, roles: ["hod"], section: "Academic" },
  // HOD round: Grade Records, Paper Review and Paper Generator removed here
  // too (same plug-back note as the admin block above).
  { label: "Question Bank", path: "/admin/question-bank", icon: <QuestionAnswer fontSize="small" />, roles: ["hod"], section: "Assessment Tools" },
  { label: "AI Question Generator", path: "/admin/ai-questions", icon: <AutoAwesome fontSize="small" />, roles: ["hod"], section: "Assessment Tools" },
  { label: "Class Schedule", path: "/admin/class-schedule", icon: <CalendarToday fontSize="small" />, roles: ["hod"], section: "Operations" },
  { label: "Curriculum", path: "/admin/curriculum", icon: <School fontSize="small" />, roles: ["hod"], section: "Operations" },
  { label: "Analytics", path: "/admin/analytics", icon: <BarChartIcon fontSize="small" />, roles: ["hod"], section: "Insights" },
  { label: "Journey", path: "/admin/journey", icon: <TrendingUp fontSize="small" />, roles: ["hod"], section: "Insights" },

  // ─── FACULTY ───
  // Faculty navigation is rendered from facultyNav (collapsible master
  // groups) instead of this flat list — see SidebarEntry below. Mentors
  // keep the flat list below.

  // ─── HOD ─── additional settings
  { label: "Settings", path: "/admin/settings", icon: <Settings fontSize="small" />, roles: ["hod"], section: "Settings" },

  // ─── MENTOR ───
  { label: "Dashboard", path: "/faculty/dashboard", icon: <Dashboard fontSize="small" />, roles: ["mentor"], section: "Overview" },
  { label: "Student Requests", path: "/faculty/appointments", icon: <People fontSize="small" />, roles: ["mentor"], section: "Overview" },
  { label: "Mentored Students", path: "/faculty/student-analysis", icon: <People fontSize="small" />, roles: ["mentor"], section: "Students" },
  { label: "360° View", path: "/faculty/view360", icon: <Assessment fontSize="small" />, roles: ["mentor"], section: "Students" },
  { label: "Attendance Overview", path: "/faculty/attendance", icon: <CalendarToday fontSize="small" />, roles: ["mentor"], section: "Attendance" },
  { label: "Settings", path: "/faculty/settings", icon: <Settings fontSize="small" />, roles: ["mentor"], section: "Settings" },
];

// ─── Faculty Collapsible Navigation ──────────────────────────────────────────
//
// The faculty sidebar is organised into master groups (Attendance, Students,
// Curriculum, Assessments) that expand/collapse, with single-page entries
// (Dashboard, Announcements, Calendar, Settings) rendered as plain links.
// Every path here must exist in src/modules/faculty/routes.tsx — this is a
// navigation-only reorganisation; no routes were added, removed, or renamed.

interface SidebarLeaf {
  label: string;
  path: string;
  icon: React.ReactNode;
}

type SidebarEntry =
  | { kind: "link"; label: string; path: string; icon: React.ReactNode }
  | { kind: "group"; label: string; icon: React.ReactNode; children: SidebarLeaf[] };

const facultyNav: SidebarEntry[] = [
  { kind: "link", label: "Dashboard", path: "/faculty/dashboard", icon: <Dashboard fontSize="small" /> },

  {
    kind: "group",
    label: "Attendance",
    icon: <CalendarToday fontSize="small" />,
    children: [
      { label: "My Attendance", path: "/faculty/my-attendance", icon: <BadgeIcon fontSize="small" /> },
      { label: "Mark Student Attendance", path: "/faculty/attendance-marking", icon: <CheckCircle fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Students",
    icon: <People fontSize="small" />,
    children: [
      { label: "Student Requests", path: "/faculty/appointments", icon: <People fontSize="small" /> },
      { label: "Student Analysis", path: "/faculty/student-analysis", icon: <Assessment fontSize="small" /> },
      { label: "360° View", path: "/faculty/view360", icon: <Assessment fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Curriculum",
    icon: <School fontSize="small" />,
    children: [
      { label: "My Curriculum", path: "/faculty/curriculum", icon: <School fontSize="small" /> },
      { label: "Topics", path: "/faculty/topics", icon: <School fontSize="small" /> },
      { label: "Assignments", path: "/faculty/assignments", icon: <Assignment fontSize="small" /> },
      { label: "Upload Materials", path: "/faculty/upload-material", icon: <UploadFile fontSize="small" /> },
      { label: "Reschedule Class", path: "/faculty/reschedule", icon: <CalendarToday fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Schedule",
    icon: <CalendarToday fontSize="small" />,
    children: [
      { label: "My Weekly Schedule", path: "/faculty/schedule", icon: <CalendarToday fontSize="small" /> },
      { label: "Calendar", path: "/faculty/calendar", icon: <CalendarToday fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Assessments",
    icon: <Assignment fontSize="small" />,
    children: [
      { label: "AI Question Generator", path: "/faculty/ai-questions", icon: <AutoAwesome fontSize="small" /> },
      { label: "Paper Generator", path: "/faculty/paper-generator", icon: <Description fontSize="small" /> },
      { label: "Generated Papers", path: "/faculty/papers", icon: <Description fontSize="small" /> },
      { label: "Question Bank", path: "/faculty/question-bank", icon: <QuestionAnswer fontSize="small" /> },
      { label: "Universal Bank", path: "/faculty/universal-bank", icon: <QuestionAnswer fontSize="small" /> },
      { label: "Assessment Schedule", path: "/faculty/assessments", icon: <Assignment fontSize="small" /> },
      { label: "Auto-Grading 5M/10M", path: "/faculty/auto-grading", icon: <Assessment fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Insights",
    icon: <TrendingUp fontSize="small" />,
    children: [
      { label: "Journey", path: "/faculty/journey", icon: <TrendingUp fontSize="small" /> },
    ],
  },

  { kind: "link", label: "My Salary", path: "/faculty/my-salary", icon: <AttachMoney fontSize="small" /> },
  { kind: "link", label: "Install App", path: "/faculty/install-app", icon: <InstallMobile fontSize="small" /> },
  { kind: "link", label: "Announcements", path: "/faculty/announcements", icon: <Campaign fontSize="small" /> },
  { kind: "link", label: "Calendar", path: "/faculty/calendar", icon: <CalendarToday fontSize="small" /> },
  { kind: "link", label: "Settings", path: "/faculty/settings", icon: <Settings fontSize="small" /> },
];

/**
 * Principal — the oversight portal. The question/paper craft surface is
 * removed (per product decision): the question-paper pages (Paper Review,
 * Paper Generator), the Question Bank (which also hosts question approval),
 * Official Grade Records and the AI Question Generator belong to the
 * department HOD (`hodNav` below) — hidden, not deleted, so they can be
 * plugged back in later. The whole University Exams group likewise left the
 * principal's sidebar (institution-office job; routes bounce deep links).
 * The principal keeps the oversight lane (Assessments) plus students,
 * attendance, academics, finance and insights — exactly as before.
 */
const principalNav: SidebarEntry[] = [
  { kind: "link", label: "Dashboard", path: "/admin/dashboard", icon: <Dashboard fontSize="small" /> },

  {
    kind: "group",
    label: "Students",
    icon: <People fontSize="small" />,
    children: [
      { label: "Students", path: "/admin/students", icon: <People fontSize="small" /> },
      { label: "360° View", path: "/admin/view360", icon: <Assessment fontSize="small" /> },
      { label: "Admission Center", path: "/admin/admissions", icon: <People fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Attendance",
    icon: <CalendarToday fontSize="small" />,
    children: [
      { label: "Attendance", path: "/admin/attendance", icon: <CalendarToday fontSize="small" /> },
      { label: "Faculty Attendance", path: "/admin/faculty-attendance", icon: <BadgeIcon fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Academics",
    icon: <School fontSize="small" />,
    children: [
      { label: "Curriculum", path: "/admin/curriculum", icon: <School fontSize="small" /> },
      { label: "Class Schedule", path: "/admin/class-schedule", icon: <CalendarToday fontSize="small" /> },
      { label: "Academic Calendar", path: "/admin/academic-calendar", icon: <CalendarToday fontSize="small" /> },
    ],
  },

  // REMOVED for principal: the whole University Exams group (Exam Management,
  // UUCMS Integration, BCU Compliance, Scheme Packs, Result Importer).
  // University-exam compliance is an institution-office job run by the
  // admin/exam branch; routes bounce the principal (see ADMIN_ROUTE_PERMISSIONS
  // in src/modules/auth/permissions.ts). Re-add the group + role entries to
  // plug it back.

  {
    kind: "group",
    label: "Assessments",
    icon: <Assignment fontSize="small" />,
    children: [
      // The principal's single assessment surface: a read-only branch-wise
      // conduction picture. Crafting, scheduling and reports live with HOD.
      { label: "Branch-wise Assessment Conduction", path: "/admin/branch-conduction", icon: <Assignment fontSize="small" /> },
      // REMOVED for principal (live in hodNav instead):
      //   Question Bank · Paper Review · Paper Generator
      // HIDDEN for principal (plug back by re-adding the nav line + the role
      // in routes.tsx): Official Grade Records · AI Question Generator —
      // the principal oversees assessments; HOD/faculty craft them.
    ],
  },

  {
    kind: "group",
    label: "Finance",
    icon: <AttachMoney fontSize="small" />,
    children: [
      { label: "Accounts Desk", path: "/admin/accounts", icon: <AccountBalanceWallet fontSize="small" /> },
      { label: "Fee Management", path: "/admin/fee-management", icon: <AttachMoney fontSize="small" /> },
      { label: "Faculty Payroll", path: "/admin/payroll", icon: <AccountBalance fontSize="small" /> },
      { label: "Guest Faculty Billing", path: "/admin/guest-faculty-billing", icon: <BadgeIcon fontSize="small" /> },
      { label: "Vendor Bills", path: "/admin/vendor-bills", icon: <ReceiptLong fontSize="small" /> },
      { label: "Library Fines", path: "/admin/library-fines", icon: <LocalLibrary fontSize="small" /> },
      { label: "Challan Management", path: "/admin/challans", icon: <Description fontSize="small" /> },
      { label: "Finance Reports", path: "/admin/finance-reports", icon: <BarChartIcon fontSize="small" /> },
      { label: "Finance Settings", path: "/admin/finance-settings", icon: <AttachMoney fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Library & Inventory",
    icon: <LocalLibrary fontSize="small" />,
    children: [
      { label: "Operations Desk", path: "/admin/operations", icon: <Dashboard fontSize="small" /> },
      { label: "Library", path: "/admin/library", icon: <LocalLibrary fontSize="small" /> },
      { label: "Inventory & Assets", path: "/admin/inventory", icon: <Inventory2 fontSize="small" /> },
      { label: "Purchase Requests", path: "/admin/purchase-requests", icon: <ShoppingCart fontSize="small" /> },
      { label: "Purchase Orders", path: "/admin/purchase-orders", icon: <ReceiptLong fontSize="small" /> },
      { label: "Vendors", path: "/admin/vendors", icon: <Storefront fontSize="small" /> },
      { label: "No-Dues", path: "/admin/no-dues", icon: <AssignmentTurnedIn fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Insights",
    icon: <TrendingUp fontSize="small" />,
    children: [
      { label: "Analytics", path: "/admin/analytics", icon: <BarChartIcon fontSize="small" /> },
      { label: "Assignment Analytics", path: "/admin/assignment-analytics", icon: <Assignment fontSize="small" /> },
      { label: "Journey", path: "/admin/journey", icon: <TrendingUp fontSize="small" /> },
    ],
  },

  { kind: "link", label: "Install App", path: "/admin/install-app", icon: <InstallMobile fontSize="small" /> },
  { kind: "link", label: "Settings", path: "/admin/settings", icon: <Settings fontSize="small" /> },
];

/**
 * Department HOD portal — shared by the `hod` role and the former `admin`
 * role (admin IS a department head now). Everything a department runs day to
 * day: students, attendance, academics, assessments & approvals (question
 * bank, paper review, AI papers), finance and insights. The university-exam
 * slice stays with the principal, exactly as before. Lands on
 * /admin/hod-dashboard (see ROLE_DASHBOARD).
 */
const hodNav: SidebarEntry[] = [
  { kind: "link", label: "HOD Dashboard", path: "/admin/hod-dashboard", icon: <Dashboard fontSize="small" /> },

  {
    kind: "group",
    label: "Students",
    icon: <People fontSize="small" />,
    children: [
      { label: "Students", path: "/admin/students", icon: <People fontSize="small" /> },
      { label: "360° View", path: "/admin/view360", icon: <Assessment fontSize="small" /> },
      { label: "Admission Center", path: "/admin/admissions", icon: <People fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Attendance",
    icon: <CalendarToday fontSize="small" />,
    children: [
      { label: "Attendance", path: "/admin/attendance", icon: <CalendarToday fontSize="small" /> },
      { label: "Faculty Attendance", path: "/admin/faculty-attendance", icon: <BadgeIcon fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Academics",
    icon: <School fontSize="small" />,
    children: [
      { label: "Curriculum", path: "/admin/curriculum", icon: <School fontSize="small" /> },
      { label: "Class Schedule", path: "/admin/class-schedule", icon: <CalendarToday fontSize="small" /> },
      { label: "Academic Calendar", path: "/admin/academic-calendar", icon: <CalendarToday fontSize="small" /> },
      { label: "Scheme Packs", path: "/admin/scheme-packs", icon: <AccountBalance fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Assessments",
    icon: <Assignment fontSize="small" />,
    children: [
      { label: "Assessments", path: "/admin/test-reports", icon: <Assignment fontSize="small" /> },
      { label: "Question Bank", path: "/admin/question-bank", icon: <QuestionAnswer fontSize="small" /> },
      { label: "AI Question Generator", path: "/admin/ai-questions", icon: <AutoAwesome fontSize="small" /> },
      // HIDDEN for HOD/admin (plug back by re-adding the nav line here, the
      // role string in the flat navItems above, and 'admin'/'hod' to
      // PAPER_CRAFT_ROLES in src/modules/admin/routes.tsx):
      //   Official Grade Records · Paper Review · Paper Generator
      // The department keeps the question bank + AI drafting; the test
      // scheduling surface that replaces this lane is pending design.
    ],
  },

  {
    kind: "group",
    label: "Requests",
    icon: <ShoppingCart fontSize="small" />,
    children: [
      // HODs hold no finance access; departments raise purchase requests
      // that follow the college's approval chain.
      { label: "Purchase Requests", path: "/admin/purchase-requests", icon: <ShoppingCart fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Insights",
    icon: <TrendingUp fontSize="small" />,
    children: [
      { label: "Analytics", path: "/admin/analytics", icon: <BarChartIcon fontSize="small" /> },
      // HIDDEN for HOD/admin (plug back: re-add this line, the role string in
      // the flat navItems above, and drop the '/admin/assignment-analytics'
      // entry from ADMIN_ROUTE_PERMISSIONS in src/modules/auth/permissions.ts):
      //   Assignment Analytics — assignment reporting stays with the principal.
      { label: "Journey", path: "/admin/journey", icon: <TrendingUp fontSize="small" /> },
    ],
  },

  { kind: "link", label: "Install App", path: "/admin/install-app", icon: <InstallMobile fontSize="small" /> },
  { kind: "link", label: "Settings", path: "/admin/settings", icon: <Settings fontSize="small" /> },
];

/**
 * Accounts team — the college finance office. Accounts always prepares and
 * processes payroll; the principal reviews submitted runs for approval.
 */
const accountsNav: SidebarEntry[] = [
  { kind: "link", label: "Accounts Desk", path: "/admin/accounts", icon: <Dashboard fontSize="small" /> },
  {
    kind: "group",
    label: "Collections",
    icon: <AttachMoney fontSize="small" />,
    children: [
      { label: "Fee Management", path: "/admin/fee-management", icon: <AttachMoney fontSize="small" /> },
      { label: "Challan Management", path: "/admin/challans", icon: <Description fontSize="small" /> },
      { label: "Library Fines", path: "/admin/library-fines", icon: <LocalLibrary fontSize="small" /> },
    ],
  },
  {
    kind: "group",
    label: "Payments",
    icon: <AccountBalance fontSize="small" />,
    children: [
      { label: "Vendor Bills", path: "/admin/vendor-bills", icon: <ReceiptLong fontSize="small" /> },
      { label: "Guest Faculty Billing", path: "/admin/guest-faculty-billing", icon: <BadgeIcon fontSize="small" /> },
      { label: "Faculty Payroll", path: "/admin/payroll", icon: <AccountBalance fontSize="small" /> },
      { label: "Vendors", path: "/admin/vendors", icon: <Storefront fontSize="small" /> },
      { label: "Purchase Approvals", path: "/admin/purchase-requests", icon: <ShoppingCart fontSize="small" /> },
    ],
  },
  {
    kind: "group",
    label: "Reports",
    icon: <BarChartIcon fontSize="small" />,
    children: [
      { label: "Finance Reports", path: "/admin/finance-reports", icon: <BarChartIcon fontSize="small" /> },
      { label: "No-Dues", path: "/admin/no-dues", icon: <AssignmentTurnedIn fontSize="small" /> },
    ],
  },
  { kind: "link", label: "Finance Settings", path: "/admin/finance-settings", icon: <Settings fontSize="small" /> },
  { kind: "link", label: "Install App", path: "/admin/install-app", icon: <InstallMobile fontSize="small" /> },
];

/** Operations team — library, inventory, stores and purchasing. */
const operationsNav: SidebarEntry[] = [
  { kind: "link", label: "Operations Desk", path: "/admin/operations", icon: <Dashboard fontSize="small" /> },
  {
    kind: "group",
    label: "Library",
    icon: <LocalLibrary fontSize="small" />,
    children: [
      { label: "Issue & Return", path: "/admin/library/desk", icon: <SwapHoriz fontSize="small" /> },
      { label: "Catalogue", path: "/admin/library/catalogue", icon: <LocalLibrary fontSize="small" /> },
      { label: "Loans & Renewals", path: "/admin/library/loans", icon: <Assignment fontSize="small" /> },
      { label: "Reservations", path: "/admin/library/reservations", icon: <CalendarToday fontSize="small" /> },
      { label: "Gate Register", path: "/admin/library/gate", icon: <People fontSize="small" /> },
      { label: "Stock Verification", path: "/admin/library/stock", icon: <CheckCircle fontSize="small" /> },
      { label: "Library Reports", path: "/admin/library/reports", icon: <BarChartIcon fontSize="small" /> },
      { label: "Library Settings", path: "/admin/library/settings", icon: <Settings fontSize="small" /> },
      { label: "Library Fines", path: "/admin/library-fines", icon: <AttachMoney fontSize="small" /> },
    ],
  },
  {
    kind: "group",
    label: "Inventory",
    icon: <Inventory2 fontSize="small" />,
    children: [
      { label: "Assets", path: "/admin/inventory/assets", icon: <Inventory2 fontSize="small" /> },
      { label: "Consumables & Stock", path: "/admin/inventory/stock", icon: <Inventory2 fontSize="small" /> },
      { label: "Inventory Settings", path: "/admin/inventory/settings", icon: <Settings fontSize="small" /> },
    ],
  },
  {
    kind: "group",
    label: "Purchasing",
    icon: <ShoppingCart fontSize="small" />,
    children: [
      { label: "Purchase Requests", path: "/admin/purchase-requests", icon: <ShoppingCart fontSize="small" /> },
      { label: "Purchase Orders & GRN", path: "/admin/purchase-orders", icon: <ReceiptLong fontSize="small" /> },
      { label: "Vendors", path: "/admin/vendors", icon: <Storefront fontSize="small" /> },
    ],
  },
  { kind: "link", label: "No-Dues", path: "/admin/no-dues", icon: <AssignmentTurnedIn fontSize="small" /> },
  { kind: "link", label: "Install App", path: "/admin/install-app", icon: <InstallMobile fontSize="small" /> },
];

/** Drop /admin entries the role may not open using the fixed role permissions. */
function filterNavForRole(entries: SidebarEntry[] | undefined, role: UserRole, access: AccessSettings): SidebarEntry[] | null {
  if (!entries) return null;
  const ok = (path: string) => !path.startsWith('/admin') || canAccessAdminPath(role, path, access);
  const out: SidebarEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'link') {
      if (ok(entry.path)) out.push(entry);
    } else {
      const children = entry.children.filter(c => ok(c.path));
      if (children.length) out.push({ ...entry, children });
    }
  }
  return out;
}

/** Roles whose sidebar renders as collapsible master groups. */
/**
 * Vriddhi platform employee: the academic workspace only. Every /admin path
 * below is admitted for the employee role by canAccessAdminPath (and the
 * institution-only pages are excluded there), so the sidebar and the route
 * gate cannot drift apart. Paths under /faculty are the shareable academic
 * pages that key off the acting uid, which is exactly how an employee works
 * "as faculty" in the active college.
 */
const employeeNav: SidebarEntry[] = [
  { kind: "link", label: "Dashboard", path: "/employee/dashboard", icon: <Dashboard fontSize="small" /> },

  {
    kind: "group",
    label: "Scheduling",
    icon: <CalendarToday fontSize="small" />,
    children: [
      { label: "Class Schedule", path: "/admin/class-schedule", icon: <CalendarToday fontSize="small" /> },
      { label: "My Weekly Schedule", path: "/faculty/schedule", icon: <CalendarToday fontSize="small" /> },
      { label: "Attendance", path: "/admin/attendance", icon: <CheckCircle fontSize="small" /> },
      { label: "Faculty Attendance", path: "/admin/faculty-attendance", icon: <BadgeIcon fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Curriculum",
    icon: <School fontSize="small" />,
    children: [
      { label: "Curriculum", path: "/admin/curriculum", icon: <School fontSize="small" /> },
      { label: "Curriculum Progress", path: "/admin/curriculum-progress", icon: <School fontSize="small" /> },
      { label: "My Curriculum", path: "/faculty/curriculum", icon: <School fontSize="small" /> },
      { label: "Academic Calendar", path: "/admin/academic-calendar", icon: <CalendarToday fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Assessments & Papers",
    icon: <Assignment fontSize="small" />,
    children: [
      { label: "Assessments", path: "/admin/assessments", icon: <Assignment fontSize="small" /> },
      { label: "Schedule Test", path: "/admin/schedule-tests", icon: <Assignment fontSize="small" /> },
      { label: "Question Bank", path: "/admin/question-bank", icon: <QuestionAnswer fontSize="small" /> },
      { label: "Question Generator", path: "/admin/ai-questions", icon: <AutoAwesome fontSize="small" /> },
      { label: "Paper Generator", path: "/admin/paper-generator", icon: <Description fontSize="small" /> },
      { label: "Paper Review", path: "/admin/paper-review", icon: <Description fontSize="small" /> },
      { label: "Paper Builder", path: "/admin/papers/builder", icon: <Description fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Students",
    icon: <People fontSize="small" />,
    children: [
      { label: "Students", path: "/admin/students", icon: <People fontSize="small" /> },
      { label: "360° View", path: "/admin/view360", icon: <Assessment fontSize="small" /> },
    ],
  },

  {
    kind: "group",
    label: "Results & Reports",
    icon: <TrendingUp fontSize="small" />,
    children: [
      { label: "Grade Records", path: "/admin/grade-records", icon: <Assignment fontSize="small" /> },
      { label: "Test Reports", path: "/admin/test-reports", icon: <BarChartIcon fontSize="small" /> },
      { label: "Analytics", path: "/admin/analytics", icon: <BarChartIcon fontSize="small" /> },
    ],
  },
];

const collapsibleNavByRole: Partial<Record<string, SidebarEntry[]>> = {
  faculty: facultyNav,
  employee: employeeNav,
  // Admin ≡ department HOD: they get the HOD portal, not a separate admin
  // surface. Principal gets the deliberately minimal university-exam nav.
  admin: hodNav,
  hod: hodNav,
  principal: principalNav,
  accounts: accountsNav,
  operations: operationsNav,
};

// ─── Phone chrome (parity with the student portal) ───────────────────────────
//
// The student portal replaced the "desktop sidebar squeezed into a phone"
// with a compact top bar, a thumb-reachable bottom tab bar and a "More"
// sheet. The staff portals (faculty, principal, admin — plus HOD, mentor and
// superadmin, which share this layout) get the same treatment: the two
// breakpoints meet at MUI's `md` (900px), where the permanent drawer takes
// over. Every path referenced here already exists in the role's nav above.

interface MobileTab {
  label: string;
  path: string;
  icon: React.ReactNode;
  /** Extra route spellings that should light this tab up (active state only). */
  aliases?: string[];
}

interface MobileNavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

interface MobileNavSection {
  label: string;
  items: MobileNavItem[];
}

/** The four destinations a role reaches with a thumb, plus "More". */
const mobileTabsByRole: Record<string, MobileTab[]> = {
  employee: [
    { label: "Dashboard", path: "/employee/dashboard", icon: <Dashboard fontSize="small" /> },
    {
      label: "Scheduling",
      path: "/admin/class-schedule",
      icon: <CalendarToday fontSize="small" />,
      aliases: ["/faculty/schedule", "/admin/attendance"],
    },
    {
      label: "Curriculum",
      path: "/admin/curriculum",
      icon: <School fontSize="small" />,
      aliases: ["/admin/curriculum-progress", "/faculty/curriculum"],
    },
    {
      label: "Assessments",
      path: "/admin/assessments",
      icon: <Assignment fontSize="small" />,
      aliases: ["/admin/schedule-tests", "/admin/question-bank", "/admin/paper-generator"],
    },
  ],
  faculty: [
    { label: "Dashboard", path: "/faculty/dashboard", icon: <Dashboard fontSize="small" /> },
    {
      label: "Attendance",
      path: "/faculty/my-attendance",
      icon: <CheckCircle fontSize="small" />,
      aliases: ["/faculty/attendance", "/faculty/attendance-marking", "/faculty/self-attendance"],
    },
    {
      label: "Students",
      path: "/faculty/student-analysis",
      icon: <People fontSize="small" />,
      aliases: ["/faculty/appointments", "/faculty/student-requests", "/faculty/view360"],
    },
    { label: "Assessments", path: "/faculty/assessments", icon: <Assignment fontSize="small" /> },
  ],
  mentor: [
    { label: "Dashboard", path: "/faculty/dashboard", icon: <Dashboard fontSize="small" /> },
    {
      label: "Student Requests",
      path: "/faculty/appointments",
      icon: <People fontSize="small" />,
      aliases: ["/faculty/student-requests"],
    },
    { label: "Students", path: "/faculty/student-analysis", icon: <Assessment fontSize="small" /> },
    { label: "Attendance", path: "/faculty/attendance", icon: <CalendarToday fontSize="small" /> },
  ],
  admin: [
    // Admin is a department HOD — same landing and tabs as `hod`.
    { label: "HOD Dashboard", path: "/admin/hod-dashboard", icon: <Dashboard fontSize="small" /> },
    { label: "Students", path: "/admin/students", icon: <People fontSize="small" /> },
    { label: "Attendance", path: "/admin/attendance", icon: <CalendarToday fontSize="small" /> },
    { label: "Assessments", path: "/admin/test-reports", icon: <Assignment fontSize="small" /> },
  ],
  principal: [
    // Original four tabs — the question/paper pages are NOT tabs, so nothing
    // to remove here; they were dropped from principalNav (the More sheet).
    // The Assessments tab is the read-only branch-wise conduction picture.
    { label: "Dashboard", path: "/admin/dashboard", icon: <Dashboard fontSize="small" /> },
    { label: "Students", path: "/admin/students", icon: <People fontSize="small" /> },
    { label: "Attendance", path: "/admin/attendance", icon: <CalendarToday fontSize="small" /> },
    { label: "Assessments", path: "/admin/branch-conduction", icon: <Assignment fontSize="small" /> },
  ],
  hod: [
    { label: "HOD Dashboard", path: "/admin/hod-dashboard", icon: <Dashboard fontSize="small" /> },
    { label: "Students", path: "/admin/students", icon: <People fontSize="small" /> },
    { label: "Attendance", path: "/admin/attendance", icon: <CalendarToday fontSize="small" /> },
    { label: "Assessments", path: "/admin/test-reports", icon: <Assignment fontSize="small" /> },
  ],
  accounts: [
    { label: "Desk", path: "/admin/accounts", icon: <Dashboard fontSize="small" /> },
    { label: "Fees", path: "/admin/fee-management", icon: <AttachMoney fontSize="small" /> },
    { label: "Bills", path: "/admin/vendor-bills", icon: <ReceiptLong fontSize="small" /> },
    { label: "Reports", path: "/admin/finance-reports", icon: <BarChartIcon fontSize="small" /> },
  ],
  operations: [
    { label: "Desk", path: "/admin/operations", icon: <Dashboard fontSize="small" /> },
    { label: "Issue/Return", path: "/admin/library/desk", icon: <SwapHoriz fontSize="small" />, aliases: ["/admin/library"] },
    { label: "Inventory", path: "/admin/inventory/assets", icon: <Inventory2 fontSize="small" />, aliases: ["/admin/inventory"] },
    { label: "Purchasing", path: "/admin/purchase-orders", icon: <ShoppingCart fontSize="small" />, aliases: ["/admin/purchase-requests", "/admin/vendors"] },
  ],
  superadmin: [
    { label: "Dashboard", path: "/superadmin/dashboard", icon: <Dashboard fontSize="small" /> },
    { label: "Colleges", path: "/superadmin/colleges", icon: <Business fontSize="small" /> },
    { label: "Admins", path: "/superadmin/admins", icon: <SupervisedUserCircle fontSize="small" /> },
    { label: "Universities", path: "/superadmin/universities", icon: <AccountBalance fontSize="small" /> },
  ],
};

/** True when the current location points at this nav path. */
function isNavPathActive(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

interface LayoutProps {
  children?: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, logout } = useAuth();
  const { data: collegeBranding } = useCollegeBranding(user?.collegeId);
  const { resolvedMode, toggleMode } = useThemeMode();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('vriddhi-sidebar-collapsed') === 'true';
  });
  const [collegeName, setCollegeName] = useState<string>('');
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(null);
  // Phone-only "More" sheet — the mobile answer to the desktop sidebar,
  // mirroring StudentMoreSheet on the student portal.
  const [moreOpen, setMoreOpen] = useState(false);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('vriddhi-sidebar-collapsed', String(next));
  };

  useEffect(() => {
    const loadCollegeName = async () => {
      if (!user?.collegeId) {
        setCollegeName('');
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'colleges', user.collegeId));
        if (snap.exists()) {
          const data = snap.data();
          setCollegeName(data.name || data.shortName || data.collegeName || '');
        }
      } catch (err) {
        console.error('[Layout] Failed to fetch college name:', err);
      }
    };
    loadCollegeName();
  }, [user?.collegeId]);

  const handleLogout = async () => {
    setUserMenuAnchor(null);
    setMoreOpen(false);
    await logout();
    navigate("/login");
  };

  const effectiveRole = user?.role || "admin";
  const showInstallApp = !isPwaStandalone();

  // College-level optional modules (colleges/{id}/config/modules). When a
  // college switches Assignments off, its nav entries disappear for every
  // role; the callables stay the authoritative boundary.
  const { assignmentsEnabled } = useCollegeModules();
  const moduleHiddenPaths = React.useMemo(() => {
    const hidden = new Set<string>();
    if (!assignmentsEnabled) {
      hidden.add('/faculty/assignments');
      hidden.add('/admin/assignment-analytics');
    }
    return hidden;
  }, [assignmentsEnabled]);

  const filteredNav = React.useMemo(() => {
    const seen = new Set<string>();
    return navItems
      .filter(item => item.roles.includes(effectiveRole))
      .filter(item => !moduleHiddenPaths.has(item.path))
      .filter(item => {
        if (seen.has(item.path)) return false;
        seen.add(item.path);
        return true;
      });
  }, [effectiveRole, moduleHiddenPaths]);

  // ─── Faculty collapsible groups ────────────────────────────────────────────
  // One open/closed set for the master groups. Landing on (or navigating to) a
  // child route auto-opens the group that owns it, so a deep link like
  // /faculty/assignments never renders with its group mysteriously shut.
  // Groups may still be closed manually — the effect only runs on route change.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const pathname = location.pathname;

  const navLabel = (label: string) =>
    NAV_LABEL_KEYS[label] ? t(NAV_LABEL_KEYS[label]) : label;

  const { access } = useAccessSettings();
  const collapsibleNav = React.useMemo(() => {
    const filtered = filterNavForRole(collapsibleNavByRole[effectiveRole], effectiveRole as UserRole, access);
    if (!filtered || moduleHiddenPaths.size === 0) return filtered;
    const out: SidebarEntry[] = [];
    for (const entry of filtered) {
      if (entry.kind === 'link') {
        if (!moduleHiddenPaths.has(entry.path)) out.push(entry);
      } else {
        const children = entry.children.filter((c) => !moduleHiddenPaths.has(c.path));
        if (children.length) out.push({ ...entry, children });
      }
    }
    return out;
  }, [effectiveRole, access, moduleHiddenPaths]);

  const activeGroup = React.useMemo(() => {
    if (!collapsibleNav) return null;
    return (
      collapsibleNav.find(
        (entry) =>
          entry.kind === "group" &&
          entry.children.some((child) => isNavPathActive(pathname, child.path))
      ) ?? null
    );
  }, [collapsibleNav, pathname]);

  useEffect(() => {
    if (activeGroup && activeGroup.kind === "group") {
      setOpenGroups((prev) =>
        prev.has(activeGroup.label) ? prev : new Set(prev).add(activeGroup.label)
      );
    }
  }, [activeGroup]);

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const followNavPath = (path: string) => {
    navigate(path);
    setMoreOpen(false);
  };

  // ─── Phone chrome derivations ──────────────────────────────────────────────
  // Tabs fall back to the role's first few destinations if a role ever gains
  // no dedicated entry above, so the bar (and its More sheet) never vanishes.
  const mobileTabs: MobileTab[] = React.useMemo(() => {
    const predefined = mobileTabsByRole[effectiveRole];
    if (predefined) return predefined;
    return filteredNav.slice(0, 4).map((item) => ({
      label: item.label,
      path: item.path,
      icon: item.icon,
    }));
  }, [effectiveRole, filteredNav]);

  const isMobileTabActive = (tab: MobileTab) =>
    [tab.path, ...(tab.aliases ?? [])].some(
      (p) => pathname === p || pathname.startsWith(`${p}/`)
    );

  /** Title shown in the phone top bar: the page the user is on. */
  const pageTitle = React.useMemo(() => {
    const candidates: { path: string; label: string }[] = [];
    if (collapsibleNav) {
      for (const entry of collapsibleNav) {
        if (entry.kind === 'link') candidates.push({ path: entry.path, label: entry.label });
        else for (const child of entry.children) candidates.push({ path: child.path, label: child.label });
      }
    } else {
      for (const item of filteredNav) candidates.push({ path: item.path, label: item.label });
    }
    const matched = candidates
      .filter((c) => pathname === c.path || pathname.startsWith(`${c.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (matched) return navLabel(matched.label);
    const dash = candidates.find((c) => c.path.endsWith('/dashboard'));
    if (dash) return navLabel(dash.label);
    return collegeName || t('brand.academicManagement');
    // navLabel closes over t; both are stable per language.
  }, [collapsibleNav, filteredNav, pathname, collegeName, navLabel, t]);

  /**
   * Sections rendered as tiles inside the More sheet: the role's whole nav
   * (collapsible groups, or flat items bucketed by their section), minus the
   * paths that already own a bottom-bar tab — a tile that repeats the tab the
   * user just tapped is a dead end. Alias paths are active-state only, so
   * e.g. "Mark Student Attendance" stays reachable from the sheet even
   * though the Attendance tab lights up on it.
   */
  const mobileNavSections: MobileNavSection[] = React.useMemo(() => {
    const tabPaths = new Set(mobileTabs.map((tab) => tab.path));
    const sections: MobileNavSection[] = [];
    if (collapsibleNav) {
      const loose: MobileNavItem[] = [];
      for (const entry of collapsibleNav) {
        if (entry.kind === 'link') {
          if (!tabPaths.has(entry.path)) {
            loose.push({ label: entry.label, path: entry.path, icon: entry.icon });
          }
        } else {
          const items = entry.children
            .filter((child) => !tabPaths.has(child.path))
            .map((child) => ({ label: child.label, path: child.path, icon: child.icon }));
          if (items.length > 0) sections.push({ label: navLabel(entry.label), items });
        }
      }
      if (loose.length > 0) sections.push({ label: 'Menu', items: loose });
    } else {
      const order: string[] = [];
      const bySection = new Map<string, MobileNavItem[]>();
      for (const item of filteredNav) {
        if (tabPaths.has(item.path)) continue;
        const key = item.section || 'Menu';
        if (!bySection.has(key)) {
          bySection.set(key, []);
          order.push(key);
        }
        bySection.get(key)!.push({ label: item.label, path: item.path, icon: item.icon });
      }
      for (const key of order) sections.push({ label: key, items: bySection.get(key)! });
    }
    return sections;
  }, [collapsibleNav, filteredNav, mobileTabs, navLabel]);

  // Any route change closes the sheet — tapping a tile should land on the
  // page, not on a menu that is still covering it.
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  // While the sheet is open the page behind it must not scroll (same
  // behaviour as the student "More" sheet).
  useEffect(() => {
    if (!moreOpen || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "superadmin": return { bg: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300", label: t("role.superadmin") };
      // Admin IS a department HOD now: same badge, same portal title
      // ("Head of Dept Portal"), same nav and department scoping as `hod`.
      case "admin":
      case "hod": return { bg: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300", label: t("role.hod") };
      case "principal": return { bg: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300", label: t("role.principal") };
      case "mentor": return { bg: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300", label: t("role.mentor") };
      case "faculty": return { bg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300", label: t("role.faculty") };
      case "accounts": return { bg: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300", label: "Accounts" };
      case "operations": return { bg: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300", label: "Operations" };
      default: return { bg: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200", label: role };
    }
  };

  const currentRoleInfo = getRoleBadgeColor(effectiveRole);

  const drawerWidth = collapsed ? DRAWER_COLLAPSED_WIDTH : DRAWER_EXPANDED_WIDTH;

  const drawerContent = (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.paper" }}>
      {/* Brand Header */}
      <Box
        sx={{
          height: 64,
          px: 2.5,
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Link
          to="/"
          style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}
          aria-label="Vriddhi Institutions"
        >
          {collapsed ? (
            <VriddhiLogo variant="mark" height={34} reverse={resolvedMode === "dark"} className="shrink-0" />
          ) : (
            <VriddhiLogo variant="horizontal" height={34} reverse={resolvedMode === "dark"} className="shrink-0" />
          )}
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tracking-wide uppercase truncate">
                {t("brand.subtitle")}
              </span>
            </div>
          )}
        </Link>

        {/* Desktop Collapse Toggle */}
        <Box sx={{ display: { xs: "none", md: "block" } }}>
          <IconButton
            size="small"
            onClick={toggleCollapse}
            sx={{
              color: "text.secondary",
              bgcolor: resolvedMode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
              '&:hover': { bgcolor: resolvedMode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
            }}
          >
            {collapsed ? <ChevronRight fontSize="small" /> : <ChevronLeft fontSize="small" />}
          </IconButton>
        </Box>
      </Box>

      {/* College & Profile Mini-Banner */}
      {!collapsed && (
        <Box
          sx={{
            p: 2,
            mx: 1.5,
            my: 1.5,
            borderRadius: 2.5,
            bgcolor: resolvedMode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(13, 148, 136, 0.04)',
            border: '1px solid',
            borderColor: resolvedMode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(13, 148, 136, 0.12)',
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <Avatar
            src={user?.avatar || undefined}
            sx={{
              width: 38,
              height: 38,
              bgcolor: 'primary.main',
              fontWeight: 700,
              fontSize: 15,
              boxShadow: '0 2px 4px rgba(13, 148, 136, 0.25)',
            }}
          >
            {user?.name?.charAt(0) || user?.displayName?.charAt(0) || 'U'}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 700, color: "text.primary", fontSize: '0.85rem' }}>
              {user?.name || user?.displayName || 'Faculty User'}
            </Typography>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-md ${currentRoleInfo.bg}`}>
                {currentRoleInfo.label}
              </span>
            </div>
            {collegeName && (
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5, fontSize: '11px', fontWeight: 500 }} noWrap>
                {collegeName}
              </Typography>
            )}
          </Box>
        </Box>
      )}

      {/* Navigation Links */}
      <List sx={{ flex: 1, overflowY: "auto", px: 1, py: 1 }}>
        {collapsibleNav ? (
          <>
            {/* Grouped roles (faculty, principal): collapsible master groups.
                Navigation-only reorganisation — every path lives in the role's
                routes file unchanged. */}
            {collapsibleNav.map((entry) => {
              if (entry.kind === "link") {
                const isActive =
                  isNavPathActive(pathname, entry.path) ||
                  (pathname === "/faculty" && entry.path === "/faculty/dashboard");
                return (
                  <ListItem key={entry.path} disablePadding sx={{ mb: 0.5 }}>
                    <Tooltip title={collapsed ? navLabel(entry.label) : ""} placement="right" arrow>
                      <ListItemButton
                        onClick={() => followNavPath(entry.path)}
                        selected={isActive}
                        sx={{
                          borderRadius: 2,
                          justifyContent: collapsed ? "center" : "flex-start",
                          px: collapsed ? 1.5 : 2,
                          py: 1,
                          minHeight: 44,
                          transition: "all 0.15s ease",
                          "&.Mui-selected": {
                            bgcolor: "primary.main",
                            color: "#ffffff",
                            boxShadow: "0 2px 8px rgba(13, 148, 136, 0.25)",
                            "&:hover": { bgcolor: "primary.dark" },
                            "& .MuiListItemIcon-root": { color: "#ffffff" },
                            "& .MuiTypography-root": { fontWeight: 600 },
                          },
                          "&:hover": {
                            bgcolor: resolvedMode === "dark" ? "rgba(255,255,255,0.05)" : "#f1f5f9",
                          },
                        }}
                      >
                        <ListItemIcon
                          sx={{
                            minWidth: collapsed ? "auto" : 36,
                            color: isActive ? "#ffffff" : "text.secondary",
                            justifyContent: "center",
                          }}
                        >
                          {entry.icon}
                        </ListItemIcon>
                        {!collapsed && (
                          <ListItemText
                            primary={
                              <Typography
                                variant="body2"
                                sx={{
                                  fontSize: "0.875rem",
                                  fontWeight: isActive ? 600 : 500,
                                  color: isActive ? "#ffffff" : "text.primary",
                                }}
                              >
                                {navLabel(entry.label)}
                              </Typography>
                            }
                          />
                        )}
                      </ListItemButton>
                    </Tooltip>
                  </ListItem>
                );
              }

              const isGroupActive = entry.children.some((child) =>
                isNavPathActive(pathname, child.path)
              );
              const isOpen = openGroups.has(entry.label);

              return (
                <React.Fragment key={entry.label}>
                  <ListItem disablePadding sx={{ mb: 0.5 }}>
                    <Tooltip title={collapsed ? navLabel(entry.label) : ""} placement="right" arrow>
                      <ListItemButton
                        onClick={() =>
                          collapsed
                            ? followNavPath(entry.children[0].path)
                            : toggleGroup(entry.label)
                        }
                        aria-expanded={isOpen}
                        sx={{
                          borderRadius: 2,
                          justifyContent: collapsed ? "center" : "flex-start",
                          px: collapsed ? 1.5 : 2,
                          py: 1,
                          minHeight: 44,
                          transition: "all 0.15s ease",
                          ...(isGroupActive
                            ? {
                                bgcolor:
                                  resolvedMode === "dark"
                                    ? "rgba(13, 148, 136, 0.14)"
                                    : "rgba(13, 148, 136, 0.07)",
                                "& .MuiListItemIcon-root": { color: "primary.main" },
                                "& .MuiTypography-root": { fontWeight: 700, color: "primary.main" },
                              }
                            : {
                                "&:hover": {
                                  bgcolor:
                                    resolvedMode === "dark" ? "rgba(255,255,255,0.05)" : "#f1f5f9",
                                },
                              }),
                        }}
                      >
                        <ListItemIcon
                          sx={{
                            minWidth: collapsed ? "auto" : 36,
                            color: isGroupActive ? "primary.main" : "text.secondary",
                            justifyContent: "center",
                          }}
                        >
                          {entry.icon}
                        </ListItemIcon>
                        {!collapsed && (
                          <>
                            <ListItemText
                              primary={
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontSize: "0.875rem",
                                    fontWeight: isGroupActive ? 700 : 600,
                                    color: isGroupActive ? "primary.main" : "text.primary",
                                  }}
                                >
                                  {navLabel(entry.label)}
                                </Typography>
                              }
                            />
                            {isOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                          </>
                        )}
                      </ListItemButton>
                    </Tooltip>
                  </ListItem>

                  {!collapsed && (
                    <Collapse in={isOpen} timeout="auto" unmountOnExit>
                      <List disablePadding sx={{ px: 0.5, mb: 0.5 }}>
                        {entry.children.map((child) => {
                          const isActive = isNavPathActive(pathname, child.path);
                          return (
                            <ListItem key={child.path} disablePadding sx={{ mb: 0.25 }}>
                              <ListItemButton
                                onClick={() => followNavPath(child.path)}
                                selected={isActive}
                                sx={{
                                  borderRadius: 2,
                                  pl: 3.5,
                                  pr: 2,
                                  py: 0.75,
                                  minHeight: 40,
                                  transition: "all 0.15s ease",
                                  "&.Mui-selected": {
                                    bgcolor: "primary.main",
                                    color: "#ffffff",
                                    boxShadow: "0 2px 8px rgba(13, 148, 136, 0.25)",
                                    "&:hover": { bgcolor: "primary.dark" },
                                    "& .MuiListItemIcon-root": { color: "#ffffff" },
                                    "& .MuiTypography-root": { fontWeight: 600 },
                                  },
                                  "&:hover": {
                                    bgcolor:
                                      resolvedMode === "dark" ? "rgba(255,255,255,0.05)" : "#f1f5f9",
                                  },
                                }}
                              >
                                <ListItemIcon
                                  sx={{
                                    minWidth: 30,
                                    color: isActive ? "#ffffff" : "text.secondary",
                                    justifyContent: "center",
                                  }}
                                >
                                  {child.icon}
                                </ListItemIcon>
                                <ListItemText
                                  primary={
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        fontSize: "0.82rem",
                                        fontWeight: isActive ? 600 : 500,
                                        color: isActive ? "#ffffff" : "text.primary",
                                      }}
                                    >
                                      {navLabel(child.label)}
                                    </Typography>
                                  }
                                />
                              </ListItemButton>
                            </ListItem>
                          );
                        })}
                      </List>
                    </Collapse>
                  )}
                </React.Fragment>
              );
            })}
          </>
        ) : (
        filteredNav.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path !== "/admin" && item.path !== "/faculty" && item.path !== "/superadmin" && location.pathname.startsWith(item.path));

          return (
            <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
              <Tooltip title={collapsed ? (NAV_LABEL_KEYS[item.label] ? t(NAV_LABEL_KEYS[item.label]) : item.label) : ""} placement="right" arrow>
                <ListItemButton
                  onClick={() => navigate(item.path)}
                  selected={isActive}
                  sx={{
                    borderRadius: 2,
                    justifyContent: collapsed ? "center" : "flex-start",
                    px: collapsed ? 1.5 : 2,
                    py: 1,
                    minHeight: 44,
                    transition: 'all 0.15s ease',
                    "&.Mui-selected": {
                      bgcolor: "primary.main",
                      color: "#ffffff",
                      boxShadow: "0 2px 8px rgba(13, 148, 136, 0.25)",
                      "&:hover": { bgcolor: "primary.dark" },
                      "& .MuiListItemIcon-root": { color: "#ffffff" },
                      "& .MuiTypography-root": { fontWeight: 600 },
                    },
                    "&:hover": {
                      bgcolor: resolvedMode === 'dark' ? 'rgba(255,255,255,0.05)' : '#f1f5f9',
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: collapsed ? "auto" : 36,
                      color: isActive ? "#ffffff" : "text.secondary",
                      justifyContent: "center",
                    }}
                  >
                    {item.badge ? (
                      <Badge badgeContent={item.badge} color="error">
                        {item.icon}
                      </Badge>
                    ) : (
                      item.icon
                    )}
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText
                      primary={
                        <Typography
                          variant="body2"
                          sx={{
                            fontSize: '0.875rem',
                            fontWeight: isActive ? 600 : 500,
                            color: isActive ? "#ffffff" : "text.primary",
                          }}
                        >
                          {NAV_LABEL_KEYS[item.label] ? t(NAV_LABEL_KEYS[item.label]) : item.label}
                        </Typography>
                      }
                    />
                  )}
                </ListItemButton>
              </Tooltip>
            </ListItem>
          );
        })
        )}
      </List>

      <Divider sx={{ borderColor: "divider" }} />

      {/* Footer / Controls */}
      <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
        {showInstallApp && (
          <ListItemButton
            onClick={requestPwaInstall}
            sx={{
              borderRadius: 2,
              justifyContent: collapsed ? "center" : "flex-start",
              px: collapsed ? 1.5 : 2,
              py: 0.8,
              color: "primary.main",
              "&:hover": { bgcolor: resolvedMode === 'dark' ? 'rgba(20,184,166,0.1)' : '#f0fdfa' },
            }}
          >
            <ListItemIcon sx={{ minWidth: collapsed ? "auto" : 36, color: "primary.main", justifyContent: "center" }}>
              <InstallMobile fontSize="small" />
            </ListItemIcon>
            {!collapsed && (
              <ListItemText
                primary={<Typography variant="body2" sx={{ fontSize: '0.85rem', fontWeight: 600 }}>Install app</Typography>}
              />
            )}
          </ListItemButton>
        )}

        <ListItemButton
          onClick={toggleMode}
          sx={{
            borderRadius: 2,
            justifyContent: collapsed ? "center" : "flex-start",
            px: collapsed ? 1.5 : 2,
            py: 0.8,
            color: "text.secondary",
            "&:hover": { bgcolor: resolvedMode === 'dark' ? 'rgba(255,255,255,0.05)' : '#f1f5f9' },
          }}
        >
          <ListItemIcon sx={{ minWidth: collapsed ? "auto" : 36, color: "text.secondary", justifyContent: "center" }}>
            {resolvedMode === "dark" ? <LightMode fontSize="small" /> : <DarkMode fontSize="small" />}
          </ListItemIcon>
          {!collapsed && (
            <ListItemText
              primary={
                <Typography variant="body2" sx={{ fontSize: '0.85rem', fontWeight: 500 }}>
                  {resolvedMode === "dark" ? t("common.lightMode") : t("common.darkMode")}
                </Typography>
              }
            />
          )}
        </ListItemButton>

        <ListItemButton
          onClick={handleLogout}
          sx={{
            borderRadius: 2,
            justifyContent: collapsed ? "center" : "flex-start",
            px: collapsed ? 1.5 : 2,
            py: 0.8,
            color: "error.main",
            "&:hover": { bgcolor: "error.light", opacity: 0.15 },
          }}
        >
          <ListItemIcon sx={{ minWidth: collapsed ? "auto" : 36, color: "error.main", justifyContent: "center" }}>
            <ExitToApp fontSize="small" />
          </ListItemIcon>
          {!collapsed && (
            <ListItemText
              primary={
                <Typography variant="body2" sx={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {t("common.signOut")}
                </Typography>
              }
            />
          )}
        </ListItemButton>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", width: "100%", minWidth: 0, minHeight: "100vh", bgcolor: "background.default" }}>
      {/* ─── Top App Bar ─── */}
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          bgcolor: "background.paper",
          color: "text.primary",
          borderBottom: "1px solid",
          borderColor: "divider",
          boxShadow: "0 1px 3px 0 rgba(0,0,0,0.04)",
          // Respect the notch in the installed PWA; the main area offsets by
          // the same amount so the 64px toolbar still meets the content.
          pt: { xs: "env(safe-area-inset-top)", md: 0 },
          transition: (theme) => theme.transitions.create(['width', 'margin'], {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          }),
        }}
      >
        <Toolbar sx={{ minHeight: 64, px: { xs: 1.5, sm: 3 } }}>
          {/* Title — the current page on phones (student top bar parity),
              the college name on desktop. minWidth+truncate keeps long
              names from wrapping the toolbar out of alignment. */}
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box
              sx={{
                display: { xs: "flex", md: "none" },
                flexDirection: "column",
                minWidth: 0,
              }}
            >
              <span className="truncate text-[15px] font-bold leading-tight text-slate-900 dark:text-slate-100">
                {pageTitle}
              </span>
              <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                {t("role.portal", { role: currentRoleInfo.label })}
              </span>
            </Box>
            <Box
              sx={{
                display: { xs: "none", md: "flex" },
                flexDirection: "column",
                minWidth: 0,
              }}
            >
              <span className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {t("role.portal", { role: currentRoleInfo.label })}
              </span>
              <div className="flex items-center gap-2 min-w-0">
                {collegeBranding?.logoUrl && (
                  <img src={collegeBranding.logoUrl} alt="" className="h-6 w-6 rounded object-contain shrink-0" />
                )}
                <span className="truncate text-base lg:text-lg font-bold text-slate-800 dark:text-slate-100">
                  {collegeName || t("brand.academicManagement")}
                </span>
              </div>
            </Box>
          </Box>

          {/* Right Header Utilities */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
            <LanguageSwitcher compact showLabel={false} className="hidden sm:inline-flex" />
            {/* Theme toggle: phone/tablet only. On desktop (md+) the permanent
                sidebar footer already has Dark Mode, so showing it here too was
                a duplicate. */}
            <Tooltip title={resolvedMode === "dark" ? t("common.lightMode") : t("common.darkMode")}>
              <IconButton onClick={toggleMode} color="inherit" size="small" sx={{ p: 1, display: { xs: "inline-flex", md: "none" } }}>
                {resolvedMode === "dark" ? <LightMode fontSize="small" /> : <DarkMode fontSize="small" />}
              </IconButton>
            </Tooltip>

            {/* No sign-out up here: a destructive action in the persistent
                header was one thumb-tap away on every screen. On phones it
                lives at the bottom of the "More" sheet; everywhere else it is
                in the avatar menu (and the desktop sidebar footer). */}

            {/* Portal Switch Links */}
            <Link
              to="/student/dashboard"
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-50 hover:bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 border border-teal-200/60 dark:border-teal-800 transition-colors"
            >
              <School fontSize="inherit" />
              {t("nav.studentView")}
            </Link>

            {/* User Profile avatar menu */}
            <IconButton
              onClick={(e) => setUserMenuAnchor(e.currentTarget)}
              size="small"
              sx={{ ml: 0.5 }}
            >
              <Avatar
                src={user?.avatar || undefined}
                sx={{
                  width: 34,
                  height: 34,
                  bgcolor: "primary.main",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {user?.name?.charAt(0) || user?.displayName?.charAt(0) || 'U'}
              </Avatar>
            </IconButton>

            <Menu
              anchorEl={userMenuAnchor}
              open={Boolean(userMenuAnchor)}
              onClose={() => setUserMenuAnchor(null)}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
              slotProps={{
                paper: {
                  sx: {
                    mt: 1.5,
                    minWidth: 220,
                    borderRadius: 3,
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                    border: '1px solid',
                    borderColor: 'divider',
                  },
                },
              }}
            >
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {user?.name || user?.displayName || "User"}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                  {user?.email || "Academic User"}
                </Typography>
                <div className="mt-2">
                  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md ${currentRoleInfo.bg}`}>
                    {currentRoleInfo.label}
                  </span>
                </div>
              </Box>
              <Divider />
              {showInstallApp && (
                <MenuItem onClick={() => {
                  setUserMenuAnchor(null);
                  requestPwaInstall();
                }}>
                  <ListItemIcon><InstallMobile fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Install app" secondary="Add Vriddhi to this device" />
                </MenuItem>
              )}
              <MenuItem onClick={() => {
                setUserMenuAnchor(null);
                if (effectiveRole === 'faculty' || effectiveRole === 'mentor') navigate('/faculty/settings');
                else if (effectiveRole === 'hod') navigate('/admin/settings');
                else navigate('/admin/settings');
              }}>
                <ListItemIcon><Settings fontSize="small" /></ListItemIcon>
                <ListItemText primary="Settings" />
              </MenuItem>
              <MenuItem onClick={handleLogout} sx={{ color: "error.main" }}>
                <ListItemIcon sx={{ color: "error.main" }}><ExitToApp fontSize="small" /></ListItemIcon>
                <ListItemText primary={t("common.signOut")} />
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>

      {/* ─── Drawer Navigation ─── */}
      <Box
        component="nav"
        sx={{
          width: { md: drawerWidth },
          flexShrink: { md: 0 },
          transition: (theme) => theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          }),
        }}
      >
        {/* Desktop Permanent Drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: drawerWidth,
              borderRight: "1px solid",
              borderColor: "divider",
              overflowX: "hidden",
              transition: (theme) => theme.transitions.create('width', {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.leavingScreen,
              }),
            },
          }}
          open
        >
          {drawerContent}
        </Drawer>
      </Box>

      {/* ─── Main Content Area ─── */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${drawerWidth}px)` },
          minWidth: 0,
          maxWidth: "100%",
          minHeight: "100vh",
          // Clear the fixed header (plus the notch inset on phones) and, on
          // phones, the bottom tab bar — same offsets the student layout uses.
          pt: { xs: "calc(64px + env(safe-area-inset-top))", md: "64px" },
          pb: { xs: "calc(64px + env(safe-area-inset-bottom))", md: 0 },
          bgcolor: "background.default",
          overflow: "auto",
          transition: (theme) => theme.transitions.create(['width', 'margin'], {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          }),
        }}
      >
        <div className="p-3 sm:p-6 lg:p-8 max-w-[1600px] mx-auto min-w-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {children || <Outlet />}
        </div>
      </Box>

      {/* ─── Phone Bottom Tab Bar (student-portal parity) ─── */}
      <nav
        aria-label="Primary"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0f1729]/95 backdrop-blur-md safe-area-bottom min-[900px]:hidden"
      >
        <ul className="flex items-stretch justify-around px-1 pt-1">
          {mobileTabs.map((tab) => {
            const isActive = isMobileTabActive(tab);
            const label = navLabel(tab.label);
            return (
              <li key={tab.path} className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => followNavPath(tab.path)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={label}
                  className={`relative flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-t-xl px-1 py-1.5 transition-colors ${
                    isActive
                      ? "text-teal-700 dark:text-teal-300"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  <span
                    className={`absolute top-0 h-0.5 w-8 rounded-full transition-all ${
                      isActive ? "bg-teal-600 dark:bg-teal-400" : "bg-transparent"
                    }`}
                  />
                  <span className="relative">{tab.icon}</span>
                  <span
                    className={`w-full truncate px-0.5 text-center text-[10px] leading-none ${
                      isActive ? "font-bold" : "font-medium"
                    }`}
                  >
                    {label}
                  </span>
                </button>
              </li>
            );
          })}
          <li className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-label="More"
              className={`relative flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-t-xl px-1 py-1.5 transition-colors ${
                moreOpen
                  ? "text-teal-700 dark:text-teal-300"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              <span
                className={`absolute top-0 h-0.5 w-8 rounded-full transition-all ${
                  moreOpen ? "bg-teal-600 dark:bg-teal-400" : "bg-transparent"
                }`}
              />
              <Apps fontSize="small" />
              <span className="text-[10px] font-medium leading-none">More</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* ─── Phone "More" Sheet — the rest of the nav + controls + sign out ─── */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-[60] min-[900px]:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] animate-[fadeIn_.15s_ease-out]"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-slate-200 bg-white pb-[calc(16px+env(safe-area-inset-bottom))] shadow-2xl dark:border-slate-800 dark:bg-[#131b2e] animate-[sheetUp_.22s_cubic-bezier(.22,1,.36,1)]">
            {/* Sheet header: who is signed in */}
            <div className="sticky top-0 z-10 bg-white/95 px-4 pb-3 pt-2.5 backdrop-blur dark:bg-[#131b2e]/95">
              <div className="mx-auto h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {user?.name || user?.displayName || "User"}
                  </p>
                  <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {[currentRoleInfo.label, collegeName].filter(Boolean).join(" • ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  aria-label="Close"
                  className="-mr-1 rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <CloseIcon fontSize="small" />
                </button>
              </div>
            </div>

            {/* Tile grid: every destination not already on the bottom bar */}
            <div className="space-y-5 px-4 pb-2">
              {mobileNavSections.map((section) => (
                <section key={section.label}>
                  <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {section.label}
                  </h2>
                  <div className="grid grid-cols-3 gap-2">
                    {section.items.map((item) => (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setMoreOpen(false)}
                        className="relative flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-3 text-center transition-colors active:bg-teal-50 active:border-teal-300 dark:border-slate-800 dark:bg-slate-900/60 dark:active:bg-teal-950/40"
                      >
                        <span className="text-teal-700 dark:text-teal-300">{item.icon}</span>
                        <span className="text-[11px] font-semibold leading-tight text-slate-700 dark:text-slate-200">
                          {navLabel(item.label)}
                        </span>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* Controls: language, theme, install, sign out */}
            <div className="mt-2 space-y-2 px-4">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <LanguageSwitcher compact showLabel={false} className="w-full" />
                </div>
                <button
                  type="button"
                  onClick={toggleMode}
                  aria-label={resolvedMode === "dark" ? "Light mode" : "Dark mode"}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  {resolvedMode === "dark" ? (
                    <LightMode fontSize="small" />
                  ) : (
                    <DarkMode fontSize="small" />
                  )}
                </button>
              </div>
              {showInstallApp && (
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    requestPwaInstall();
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs font-bold text-teal-800 transition-colors active:bg-teal-100 dark:border-teal-800/60 dark:bg-teal-950/40 dark:text-teal-200"
                >
                  <InstallMobile fontSize="small" /> Install Vriddhi on this phone
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700 transition-colors active:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
              >
                <ExitToApp fontSize="small" /> {t("common.signOut")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Global Multi-Role AI Assistant ─── */}
      <FloatingAIChatWidget />
    </Box>
  );
};

export default Layout;
