// src/shared/services/chatResponseRules.ts
//
// Pure, dependency-free assistant logic: role boundaries, intent detection,
// action-pill routing and the offline reply composer.
//
// Deliberately free of Firebase/router imports so the privacy boundary can be
// asserted in plain node and reviewed in one file.

export interface ChatAction {
  id: string;
  label: string;
  path: string;
  icon: ChatActionIcon;
}

export type ChatActionIcon =
  | 'attendance'
  | 'fees'
  | 'assessments'
  | 'question-bank'
  | 'paper'
  | 'faculty'
  | 'timetable'
  | 'library'
  | 'materials'
  | 'grades'
  | 'analytics'
  | 'portal';

export interface AIChatReply {
  content: string;
  actions: ChatAction[];
}

/** Roles that may see question-paper authoring guidance and its deep links. */
const PAPER_AUTHORING_ROLES = new Set(['faculty', 'admin', 'superadmin', 'principal', 'hod']);
/** Institution-wide (as opposed to per-class) operational views. */
const INSTITUTION_ADMIN_ROLES = new Set(['admin', 'superadmin', 'principal']);

type ChatIntent =
  | 'attendance'
  | 'fees'
  | 'assessments'
  | 'questionBank'
  | 'schedule'
  | 'library'
  | 'facultyConnect'
  | 'curriculum'
  | 'study'
  | 'general';

export function isPaperAuthoringRole(role?: string): boolean {
  return PAPER_AUTHORING_ROLES.has(String(role || '').toLowerCase());
}

function detectIntent(text: string): ChatIntent {
  const q = text.toLowerCase();
  const has = (...needles: string[]) => needles.some(n => q.includes(n));

  if (has('office hour', 'appointment', 'book a slot', 'book time', 'book a meet', '1-on-1', 'one on one', 'mentor session', 'faculty connect', 'connect with faculty', 'meet a professor', 'meeting with the professor')) {
    return 'facultyConnect';
  }
  if (has('attendance', 'defaulter', 'shortage', 'present in class', 'absent', 'leave request')) return 'attendance';
  if (has('fee', 'fees', 'dues', 'payment', 'receipt', 'tuition', 'scholarship', 'refund', 'outstanding', 'clearance')) return 'fees';
  // "when is my exam paper" is a scheduling question; "generate an exam paper" is
  // an authoring request. Date-ish vocabulary decides which branch answers it.
  if (/(when|date|timing|schedule|resit|result|marks|grade|syllabus)/.test(q) && has('exam', 'test', 'paper', 'assessment') && !has('generate', 'draft', 'make', 'create', 'design', 'bloom')) {
    return 'assessments';
  }
  if (has('question bank', 'paper generator', 'generate a paper', 'generate paper', 'question paper', 'exam paper', 'generate an exam', 'generate a new', 'mcq', 'multiple choice', 'draft question', 'draft a', 'bloom', 'answer key', 'rubric', 'marks distribution')) {
    return 'questionBank';
  }
  if (has('exam', 'test', 'quiz', 'assessment', 'mid-sem', 'end sem', 'marks', 'grade', 'result', 'score', 'internal')) {
    return 'assessments';
  }
  if (has('timetable', 'schedule', 'reschedul', 'routine', 'lecture', 'lab session', 'room', 'academic calendar', 'holiday')) {
    return 'schedule';
  }
  if (has('library', 'borrow', 'isbn', 'return date', 'due date', 'issued book', 'e-resource')) return 'library';
  // Curriculum / mapping — must be before generic 'study' so syllabus-mapping queries land here
  if (has('my curriculum', 'assigned curriculum', 'assigned course', 'course mapping', 'faculty mapping', 'curriculum mapping', 'curriculum map', 'my courses', 'mapped course', 'branch semester', 'semester curriculum')) return 'curriculum';
  if (has('curriculum', 'syllabus mapping', 'module coverage', 'learning outcome')) return 'curriculum';
  if (has('explain', 'concept', 'understand', 'how does', 'what is', 'difference between', 'example', 'derivation', 'definition', 'revise', 'syllabus', 'notes')) {
    return 'study';
  }
  return 'general';
}

/**
 * Action pills are derived from the *question that was asked* plus the
 * requester's role, not from the wording of the answer. That keeps the deep
 * links meaningful for live LLM replies too, and means every path below is a
 * route the current role can actually open.
 */
export function deriveChatActions(query: string, role?: string): ChatAction[] {
  const r = String(role || 'student').toLowerCase();
  // Students/parents get the /student surface; mentors share the faculty one.
  const isStudent = r === 'student' || r === 'parent';
  const isFaculty = r === 'faculty' || r === 'mentor';
  const isInstAdmin = INSTITUTION_ADMIN_ROLES.has(r) || r === 'hod';
  const canAuthorPapers = isPaperAuthoringRole(r);
  const intent = detectIntent(query);

  const act = (id: string, label: string, path: string, icon: ChatActionIcon): ChatAction => ({ id, label, path, icon });
  const out: ChatAction[] = [];
  const push = (a: ChatAction) => {
    if (!out.some(existing => existing.path === a.path)) out.push(a);
  };

  switch (intent) {
    case 'attendance':
      if (isStudent) {
        push(act('attendance', 'Open Attendance Portal', '/student/attendance', 'attendance'));
        push(act('faculty', 'Connect with Faculty', '/student/faculty-connect', 'faculty'));
      } else if (isFaculty) {
        push(act('attendance', 'Mark / Review Attendance', '/faculty/attendance', 'attendance'));
        push(act('analytics', 'View Student Analytics', '/faculty/student-analysis', 'analytics'));
      } else {
        push(act('attendance', 'Open Attendance Portal', '/admin/attendance', 'attendance'));
        push(act('view360', '360° Defaulter List', '/admin/view360', 'analytics'));
      }
      break;

    case 'fees':
      if (isStudent) {
        push(act('fees', 'View Fee Portal', '/student/fees', 'fees'));
        push(act('notifications', 'Fee Notifications', '/student/notifications', 'portal'));
      } else if (isInstAdmin) {
        push(act('fees', 'Fee Management', '/admin/fee-management', 'fees'));
        push(act('analytics', 'Collection Analytics', '/admin/analytics', 'analytics'));
      } else if (isFaculty) {
        push(act('announcements', 'Issue an Announcement', '/faculty/announcements', 'portal'));
      }
      break;

    case 'questionBank':
      if (canAuthorPapers) {
        if (isFaculty) {
          // Faculty round: Paper Generator left the faculty portal with the
          // Generated Papers page; question drafting + the assessment hub stay.
          push(act('question-bank', 'Open Question Bank', '/faculty/question-bank', 'question-bank'));
          push(act('ai-questions', 'AI Question Drafting', '/faculty/ai-questions', 'paper'));
        } else {
          // HOD round: Paper Generator / Paper Review left the department
          // portal, so the assistant stops offering them here.
          push(act('question-bank', 'Open Question Bank', '/admin/question-bank', 'question-bank'));
          push(act('ai-questions', 'AI Question Drafting', '/admin/ai-questions', 'paper'));
        }
      } else if (isStudent) {
        // Privacy boundary: students get their assessment + tutoring surface.
        push(act('assessments', 'My Assessments', '/student/assessments', 'assessments'));
        push(act('materials', 'Study Notes', '/student/materials', 'materials'));
        push(act('faculty', 'Connect with Faculty', '/student/faculty-connect', 'faculty'));
      } else if (isFaculty) {
        // Faculty-side role without authoring rights (e.g. mentor).
        push(act('assessments', 'Assessment Manager', '/faculty/assessments', 'assessments'));
        push(act('appointments', 'Student Office Hours', '/faculty/appointments', 'faculty'));
      }
      break;

    case 'assessments':
      if (isStudent) {
        push(act('assessments', 'My Assessments', '/student/assessments', 'assessments'));
        push(act('grades', 'Grades & Results', '/student/grades', 'grades'));
        push(act('faculty', 'Book a Revision Slot', '/student/faculty-connect', 'faculty'));
      } else if (isFaculty) {
        push(act('assessments', 'Assessment Manager', '/faculty/assessments', 'assessments'));
        if (canAuthorPapers) push(act('question-bank', 'Open Question Bank', '/faculty/question-bank', 'question-bank'));
      } else {
        push(act('assessments', 'Assessments', '/admin/assessments', 'assessments'));
        // Official Grade Records is no longer a department surface.
        push(act('reports', 'Assessment Reports', '/admin/test-reports', 'analytics'));
      }
      break;

    case 'schedule':
      if (isStudent) {
        push(act('timetable', 'My Timetable', '/student/timetable', 'timetable'));
        push(act('events', 'Academic Events', '/student/events', 'portal'));
      } else if (isFaculty) {
        push(act('schedule', 'My Schedule', '/faculty/schedule', 'timetable'));
        push(act('reschedule', 'Reschedule Request', '/faculty/reschedule', 'portal'));
      } else {
        push(act('schedule', 'Class Schedule', '/admin/class-schedule', 'timetable'));
      }
      break;

    case 'library':
      // Only students and faculty have a library surface; staff fall back below.
      if (isStudent) push(act('library', 'My Library Account', '/student/library', 'library'));
      else if (isFaculty) push(act('library', 'Library Desk', '/faculty/library', 'library'));
      break;

    case 'facultyConnect':
      if (isStudent) {
        push(act('faculty', 'Connect with Faculty', '/student/faculty-connect', 'faculty'));
      } else if (isFaculty) {
        push(act('appointments', 'Manage Office Hours', '/faculty/appointments', 'faculty'));
      } else {
        push(act('appointments', 'Department Overview', '/admin/hod-dashboard', 'faculty'));
      }
      break;

    case 'curriculum':
      if (isStudent) {
        push(act('curriculum', 'My Curriculum', '/student/curriculum', 'materials'));
        push(act('faculty', 'Ask Faculty about Syllabus', '/student/faculty-connect', 'faculty'));
      } else if (isFaculty) {
        push(act('curriculum', 'My Curriculum', '/faculty/curriculum', 'portal'));
        push(act('topics', 'Topics & Modules', '/faculty/topics', 'portal'));
        push(act('ai-questions', 'Generate Questions from Topic', '/faculty/ai-questions', 'paper'));
      } else {
        push(act('curriculum', 'Curriculum Mapping', '/admin/curriculum', 'portal'));
        push(act('schedule', 'Class Schedule', '/admin/class-schedule', 'timetable'));
        if (canAuthorPapers) push(act('question-bank', 'Question Bank', '/admin/question-bank', 'question-bank'));
      }
      break;

    case 'study':
      if (isStudent) {
        push(act('materials', 'Study Material', '/student/materials', 'materials'));
        push(act('faculty', 'Ask a Professor 1-on-1', '/student/faculty-connect', 'faculty'));
        push(act('assessments', 'Practice Assessments', '/student/assessments', 'assessments'));
      } else if (isFaculty) {
        push(act('materials', 'Upload Material', '/faculty/upload-material', 'materials'));
        push(act('topics', 'Topic Explorer', '/faculty/topics', 'portal'));
      } else {
        push(act('curriculum', 'Curriculum Maps', '/admin/curriculum', 'portal'));
      }
      break;

    default:
      if (isStudent) {
        push(act('dashboard', 'Student Dashboard', '/student/dashboard', 'portal'));
        push(act('assessments', 'My Assessments', '/student/assessments', 'assessments'));
        push(act('faculty', 'Connect with Faculty', '/student/faculty-connect', 'faculty'));
      } else if (isFaculty) {
        push(act('dashboard', 'Faculty Dashboard', '/faculty/dashboard', 'portal'));
        push(act('attendance', 'Attendance', '/faculty/attendance', 'attendance'));
      } else {
        push(act('dashboard', 'Admin Dashboard', '/admin/dashboard', 'portal'));
        push(act('analytics', 'Institution Analytics', '/admin/analytics', 'analytics'));
      }
  }

  // A query with no role-reachable destination (e.g. a staff member asking about
  // the library) still gets the general landing pills rather than an empty row.
  if (out.length === 0) {
    if (isStudent) {
      out.push(act('dashboard', 'Student Dashboard', '/student/dashboard', 'portal'));
    } else if (isFaculty) {
      out.push(act('dashboard', 'Faculty Dashboard', '/faculty/dashboard', 'portal'));
    } else {
      out.push(act('dashboard', 'Admin Dashboard', '/admin/dashboard', 'portal'));
    }
  }

  return out.slice(0, 3);
}

interface LocalReplyOptions {
  role: string;
  name: string;
}

/** Exported for unit-level assertions on tone, structure and role gating. */
export function buildLocalReply(query: string, { role, name }: LocalReplyOptions): AIChatReply {
  const intent = detectIntent(query);
  const isStudent = role === 'student' || role === 'parent';
  const isFacultyLike = role === 'faculty' || role === 'mentor';
  const canAuthorPapers = isPaperAuthoringRole(role);

  const content = composeReply({ intent, role, name, isStudent, isFacultyLike, canAuthorPapers });
  return { content, actions: deriveChatActions(query, role) };
}

function composeReply(args: {
  intent: ChatIntent;
  role: string;
  name: string;
  isStudent: boolean;
  isFacultyLike: boolean;
  canAuthorPapers: boolean;
}): string {
  const { intent, name, isStudent, isFacultyLike, canAuthorPapers } = args;

  switch (intent) {
    case 'attendance':
      if (isStudent) {
        return `### 📊 Your Attendance Analysis
Hello **${name}**, here is where you stand and what moves the number:

- **Mandatory threshold**: maintain at least **75% aggregate attendance** to stay eligible for end-semester examinations.
- **Subject-wise view**: the Attendance portal lists every lecture, practical session and approved leave request.
- **At-risk subjects**: any single subject below 75% is treated separately from the aggregate — check each row, not just the total.

> **Key takeaway**: one unapproved absence in a 30-hour subject costs roughly 3.3 percentage points. If a subject is already below the line, request a make-up assignment through your faculty mentor now rather than at the end of the term.`;
      }
      if (isFacultyLike) {
        return `### 📊 Class Attendance Overview
- **Marking**: enter daily lecture and lab attendance from **Faculty Attendance**, which auto-recomputes subject-wise percentages.
- **Defaulters**: filter the class list by "below 75%" in **Student Analytics** to isolate at-risk students.
- **Intervention**: issue a remedial notice from **Faculty Announcements**; parents on linked accounts are notified automatically.

> **Key takeaway**: percentages recalculate on save, so a corrected entry is reflected in View 360 and the defaulter list without any further action.`;
      }
      return `### 📊 Attendance & Cohort Intelligence
- **Threshold**: the 75% minimum aggregate applies college-wide; defaulter lists are generated per subject, not per student average.
- **Cohort drill-down**: **View 360°** breaks attendance down by batch, branch and subject so dips are attributable.
- **Compliance**: daily lecture-log completion is tracked under **Attendance Management** for the audit trail.

> **Key takeaway**: compare subject-level dips against lecturer log compliance first — most cohort-wide shortages trace back to unmarked lectures, not student absences.`;

    case 'fees':
      if (isStudent) {
        return `### 💳 Student Fee Portal
- **Balances**: pending semester fees, instalment schedules and past transactions live under **Fee Portal**.
- **Receipts**: download the official fee-clearance receipt once a payment is reconciled.
- **Offline payments**: a demand draft or NEFT transfer takes **24–48 hours** for the finance office to reconcile before it appears here.

> **Key takeaway**: exam registration unlocks only after reconciliation, not after you transfer the money — plan at least two working days ahead of the deadline.`;
      }
      if (isFacultyLike) {
        return `### 💳 Fees — Faculty View
- Fee ledgers are owned by the accounts office; faculty access is read-only for the students in their advisories.
- To chase a batch-wide arrears list, request the finance desk through **Faculty Announcements** or escalate to your HOD.

> **Key takeaway**: use the advisory view for counselling, and let the fee desk handle receipts, waivers and reconciliation.`;
      }
      return `### 💳 Institutional Fee Collection
- **Realisation vs. arrears**: **Fee Management** splits collected, pending and partially paid cohorts by academic year and branch.
- **Automated invoicing**: students receive balance notifications ahead of semester examination registration.
- **Export**: reconciliation sheets can be exported per cohort for the finance audit.

> **Key takeaway**: outstanding dues cluster by branch and batch — run the arrears export before chasing individual students.`;

    case 'questionBank':
      if (canAuthorPapers) {
        return `### 📝 Examination & Question Bank System
- **Universal Question Bank**: verified questions catalogued by subject, difficulty and Bloom's taxonomy level, with a faculty review queue.
- **Interactive Paper Builder**: assemble balanced papers from syllabus templates or manual selection; marks distribution is validated live.
- **Automated PDF Export**: generate printable papers with university watermark, duration, section divisions and answer-key variant.
- **Governance**: generated papers route to **Paper Review** before release.

> **Key takeaway**: aim for a Bloom's spread of roughly 30% remember/understand, 40% apply/analyse and 30% evaluate/create — the builder warns you when a paper drifts.`;
      }

      if (isStudent) {
        // Privacy boundary — students never receive paper-authoring guidance.
        return `### 📚 Assessments & Study Support
Question-paper generation, the universal question bank and Bloom's taxonomy controls are restricted to **faculty and administration**, so I can't walk you through those screens.

Here is what I *can* help you with:

- **Concept explanations**: ask me to explain any topic from your syllabus, with examples and step-by-step derivations.
- **Study notes**: revision material published by your faculty sits under **Study Material**.
- **Scheduled assessments**: upcoming tests, instructions and past results are in **My Assessments**.
- **Faculty help**: book a one-on-one slot during published office hours.

> **Key takeaway**: phrase your question as a topic — for example "explain the difference between cost and financial accounting" — and I will build an explanation with worked examples.`;
      }

      // Faculty-surface role that does not hold authoring rights (e.g. mentor).
      return `### 📝 Question-Bank Access — Restricted
Question-bank curation, paper generation and the review queue are limited to **subject faculty and administration**, so those screens are not available on this role.

- **Assessment status**: published tests and submission progress are tracked in **Assessment Manager**.
- **Office hours**: student requests for exam help arrive in **Faculty Appointments**.
- **Syllabus coverage**: unit and topic mapping can be reviewed in **Topic Explorer**.

> **Key takeaway**: route paper-design requests to the subject faculty — you can still schedule the remedial session that follows them.`;

    case 'assessments':
      if (isStudent) {
        return `### 🗓️ Your Scheduled Assessments
- **Upcoming tests**: dates, duration, covered units and instructions sit under **My Assessments**; each entry opens its instruction page first.
- **During a test**: the timer runs server-side, so refreshing the page does not extend it.
- **Results**: marks and answer reviews appear under **Grades** once the faculty publishes them.

> **Key takeaway**: read the instruction page before the timer starts — it lists the allowed attempts and the syllabus units that will be tested.`;
      }
      if (isFacultyLike) {
        return `### 🗓️ Assessment Manager
- **Schedule**: create tests per cohort with unit selection, duration and attempt limits in **Faculty Assessments**.
- **Publishing**: papers move from draft → review → published; unpublished drafts stay invisible to students.
- **Grading**: auto-graded for MCQs, manual for written answers, and marks are released only when you publish the result.

> **Key takeaway**: publish results in one action — partial releases create re-computation queries from students mid-review.`;
      }
      return `### 🗓️ Assessment Operations
- **Calendar**: institutional test windows are coordinated in **Assessments**, which prevents two cohorts sharing a lab from being scheduled together.
- **Grade records**: published marks roll up into **Grade Records** for transcript generation.
- **Review queue**: pending papers awaiting approval are surfaced on the admin review screen.

> **Key takeaway**: the review queue is the bottleneck before exam weeks — clear it early or papers will be released without the second check.`;

    case 'schedule':
      if (isStudent) {
        return `### 🗓️ Timetable & Academic Calendar
- **Weekly grid**: lectures, labs and their rooms are mapped in **Timetable**, with cancelled sessions flagged automatically.
- **Events**: college-wide events, exam dates and holidays appear under **Events**.
- **Changes**: when faculty reschedule a lecture, the update flows to your timetable and notifications.

> **Key takeaway**: a cancelled lecture still shows in the grid with a strike-through — check before travelling to a room.`;
      }
      if (isFacultyLike) {
        return `### 🗓️ Faculty Schedule & Rescheduling
- **Weekly slots**: your assigned lectures and labs are listed in **Faculty Schedule**, with room and cohort conflicts highlighted.
- **Reschedule**: submit a request from **Reschedule** with the preferred room and a reason; your HOD receives it for approval.
- **After approval**: affected cohorts are notified and the students' timetables update automatically.

> **Key takeaway**: requests raised less than 24 hours before the lecture need an urgent note in the reason field, otherwise they are approved on the next working cycle.`;
      }
      return `### 🗓️ Timetable Governance
- **Allocation**: room, cohort and faculty assignments are validated against availability in **Class Schedule**, flagging double-booking before it is saved.
- **Approvals**: pending reschedule requests queue under the HOD dashboard.
- **Calendar**: exam windows and holidays are college-wide overrides that the generator respects.

> **Key takeaway**: clear pending reschedules before publishing the next week — published timetables snap back to stale rooms if requests are approved late.`;

    case 'library':
      return `### 📚 Digital Library Management
- **Catalogue**: search by title, author, subject or ISBN across physical and e-resources.
- **Issue & return**: due dates are computed from the lending policy, with one renewal allowed when no hold exists.
- **Account**: current issues, overdue fines and history are listed in your library view.

> **Key takeaway**: an overdue book silently blocks exam-registration clearance in some colleges — clear holds before the fee receipt is requested.`;

    case 'facultyConnect':
      if (isStudent) {
        return `### 🤝 Booking a Faculty Session
1. Open **Faculty Connect** and choose the professor for the subject you need help with.
2. Pick a slot from their **published office hours**; the availability grid marks already-booked times.
3. Select the meeting type — cabin visit, virtual (meet link is attached by the faculty) or doubt-clearing group.
4. Submit. The request shows **Pending** until the professor confirms, then moves to **Confirmed** with the location or link.

> **Key takeaway**: write the specific topic or question in the note field — requests with a concrete question are confirmed far faster than "need help"`;
      }
      if (isFacultyLike) {
        return `### 🤝 Office Hours & Student Requests
1. Set your **weekly office hours** once in Faculty Appointments; the grid drives every student-facing slot picker.
2. Incoming requests arrive with the student, subject and their note — **confirm** to attach a cabin or virtual meet link.
3. **Decline with remarks** if the topic belongs to another faculty member; the student sees the remark instead of a silent rejection.

> **Key takeaway**: keep a couple of flexible slots open each week — fixed hours fill instantly, and the flexible ones absorb the surge before assessments.`;
      }
      return `### 🤝 Office Hours — Administrative View
- Faculty publish their weekly availability in **Faculty Appointments**; students book against those hours from Faculty Connect.
- Department-level load (requests received, confirmation latency, declines) is visible in the HOD dashboard.
- Administration does not act on individual student requests — they belong to the assigned professor.

> **Key takeaway**: if a department shows repeated declines for the same subject, that is a mentoring-coverage gap rather than a scheduling problem.`;

    case 'curriculum':
      if (isFacultyLike) {
        return `### 📘 Your Assigned Curriculum — Faculty View
Hello **${name}**, your courses are assigned by the college admin from the central syllabus bank:

- **My Curriculum** lists every course mapped to you — branch, semester, batch/division, credits, hours and the full module tree with topics and learning outcomes.
- **Topics** merges those curriculum modules with your own lesson-plan ledger: each bank topic appears as *Planned* (or *Covered* once a class session marks it) and your hand-added topics sit alongside.
- **AI assist — two clicks away**: on any module or topic choose **Ask AI** (explains the concept with an example) or **Generate Questions** (opens the AI Question Studio prefilled with that subject + topic so you can draft Bloom-tagged questions straight into the bank).

> **Key takeaway**: use *My Curriculum* as the source of truth — if a course disappears, the mapping was removed in **Admin → Curriculum**; topics then reappear only after it is reassigned.`;
      }
      if (isStudent) {
        return `### 📘 Curriculum & Syllabus
- **Your syllabus**: the curriculum assigned to your college, broken into courses → modules → topics and mapped in **My Curriculum** (student view) and **Study Material** where faculty upload notes.
- **Progress**: completed vs upcoming units are derived from scheduled class sessions.

> **Key takeaway**: open the topic in your material and ask your professor during office hours if the published notes don't cover it.`;
      }
      return `### 📘 Curriculum Mapping — Admin View
- **Assign from bank**: curricula arrive from the superadmin syllabus parser; open **Curriculum → Curriculum** to see each doc, its courses/modules and how many courses are already mapped.
- **Map to faculty**: in the course row choose **Assign Faculty** — faculty are ranked by matching subjects they teach, and a warning appears if you pick someone who hasn't listed that subject.
- **Schedule**: any active mapping can **Schedule Class** directly into **Class Schedule**, and the faculty's **My Curriculum** plus **Topics** update instantly — the same topics also seed their AI question generation.

> **Key takeaway**: keep mappings single-owner per course/batch/division — duplicate assignments create split schedules.`;

    case 'study':
      return `### 💡 Concept & Study Support
- **Explain it**: ask for any syllabus topic and I will return a definition, the intuition behind it, a worked example and common exam traps.
- **Study notes**: notes, slides and reference PDFs your faculty published are in **Study Material**.
- **Practice**: scheduled assessments double as revision checkpoints, with results and answer reviews.
- **Stuck?**: book the professor during office hours rather than waiting for the next lecture.

> **Key takeaway**: ask one concept at a time and mention the subject — "explain depreciation for Cost Accounting" produces a materially better answer than a broad revision request.`;

    default:
      return `### 🤖 Vriddhi AI Assistant
Hello **${name}** — I answer free-form questions about the Vriddhi campus platform. Try asking in plain language:

- **Academics**: attendance rules, grade trends, subject-wise performance.
- **Assessments**: upcoming tests, instructions, how results are published.
- **Scheduling**: timetables, events, class reschedule requests.
- **Services**: fee portal, receipts and library account status.
- **Study help**: explain a concept, or build a revision outline for a unit.

> **Key takeaway**: be specific about your subject and what you want to do — I will answer it and offer the matching portal link.`;
  }
}
