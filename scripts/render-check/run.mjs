// Mounts the staff-attendance components in jsdom and asserts on what actually
// lands in the DOM.
//
// Why this exists: `tsc` and `vite build` prove the code compiles, and the unit
// tests prove the maths is right, but neither proves a single component
// renders. This closes that gap. The I/O boundary (Firestore, AuthContext, the
// router) is stubbed by ./vite.config.mts; the components, their hooks, and the
// aggregation in staffAttendanceStats are the real shipped source.
//
// Run with: npm run test:render
import { createServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

const server = await createServer({
  configFile: path.resolve(here, 'vite.config.mts'),
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

async function mount(file, props) {
  const mod = await server.ssrLoadModule(file);
  const Comp = mod.default;
  if (typeof Comp !== 'function') throw new Error(`no default export from ${file}`);

  const host = document.createElement('div');
  document.body.appendChild(host);
  const reactRoot = createRoot(host);

  // The admin pages read through react-query; without a client they throw
  // "No QueryClient set". Every mount gets a fresh one so no section sees a
  // previous section's cache.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

  // Two passes: the first mounts and fires effects, the second lets the
  // awaited fixtures resolve and re-render.
  await act(async () => {
    reactRoot.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(Comp, props)
      )
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

  const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };

  return {
    text: () => host.textContent.replace(/\s+/g, ' ').trim(),
    /**
     * Like text(), but without anything inside a collapsed MUI Collapse.
     * Collapse keeps its children mounted with `visibility: hidden` (correct
     * for screen readers), so textContent alone would "see" closed accordions.
     */
    openText: () => {
      const clone = host.cloneNode(true);
      clone.querySelectorAll('.MuiCollapse-hidden').forEach((el) => el.remove());
      return clone.textContent.replace(/\s+/g, ' ').trim();
    },
    // <input> values never appear in textContent, so form state has to be read
    // off the elements themselves.
    value: (id) => {
      const el = host.querySelector(`#${id}`);
      return el ? el.value : null;
    },
    el: (selector) => host.querySelector(selector),
    all: (selector) => [...host.querySelectorAll(selector)],
    /** The first element whose own text is exactly `label` (a button/pill). */
    byText: (label, selector = 'button') =>
      [...host.querySelectorAll(selector)].find((e) => (e.textContent || '').replace(/\s+/g, ' ').trim() === label) ?? null,
    /** Real click through React's event system, then let effects settle. */
    click: async (target) => {
      const el = typeof target === 'string' ? host.querySelector(target) : target;
      if (!el) throw new Error(`nothing to click for ${typeof target === 'string' ? target : '<element>'}`);
      await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); });
      await settle();
    },
    hrefs: (selector = 'a') => [...host.querySelectorAll(selector)].map((a) => a.getAttribute('href')),
    /**
     * MUI renders Dialogs (and Snackbars) into a portal on <body>, so they are
     * invisible to the querySelector calls above — a dialog check has to look
     * at the document instead.
     */
    dialog: () => document.querySelector('.MuiDialog-root'),
    dialogText: () => (document.querySelector('.MuiDialog-root')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    dialogEl: (selector) => document.querySelector('.MuiDialog-root')?.querySelector(selector) ?? null,
    dialogButtons: () => [...(document.querySelector('.MuiDialog-root')?.querySelectorAll('button') ?? [])],
    /** Everything the student/principal can see, portals included. */
    bodyText: () => (document.body.textContent ?? '').replace(/\s+/g, ' ').trim(),
    /**
     * Type into an input the way a browser does. React only notices a change
     * made through the native value setter followed by an `input` event, so a
     * plain `el.value = ...` would leave the component's state behind.
     */
    type: async (target, text) => {
      const el = typeof target === 'string' ? host.querySelector(target) : target;
      if (!el) throw new Error(`nothing to type into for ${typeof target === 'string' ? target : '<element>'}`);
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, text);
        el.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      await settle();
      return el;
    },
    host,
    unmount: async () => { await act(async () => reactRoot.unmount()); queryClient.clear(); host.remove(); },
  };
}

const checks = [];
function check(label, cond, detail) {
  checks.push({ label, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `\n        → ${(detail ?? '').slice(0, 400)}`}`);
}

let crashes = 0;
async function section(label, file, props, assertions) {
  try {
    const view = await mount(file, props);
    // Awaited: assertions may be async (click a toggle, then read the DOM).
    await assertions(view.text(), view);
    await view.unmount();
  } catch (err) {
    crashes++;
    check(`${label}: mounts without throwing`, false, String(err.stack ?? err.message));
  }
}

// ── Principal analysis panel ─────────────────────────────────────────────────
// The fixtures are 3 faculty and 7 records across 1–3 Sep 2026. September 2026
// has 26 working days (Sundays excluded), so the expected figures are:
//   credited = 2.5 (Bala) + 1 (Anitha) + 1 (Suresh) = 4.5
//   overall  = 4.5 / (26 × 3) = 5.8%
//   Bala     = 2.5 / 26      = 9.6%
await section('panel', '/src/modules/admin/components/FacultyAttendancePanel.tsx', { collegeId: 'college-a' }, (t) => {
  check('panel: mounts without throwing', true);
  check('panel: overall percentage matches the fixture maths (5.8%)', t.includes('5.8%'), t);
  check('panel: per-faculty percentage matches (9.6% for 2.5/26 days)', t.includes('9.6%'), t);
  check('panel: lists all three roster members, including ones with no records',
    t.includes('Bala Kumar') && t.includes('Anitha Rao') && t.includes('Suresh Menon'), t);
  check('panel: reports the working-day denominator (26)', t.includes('26'), t);
  check('panel: offers the month and date-range scopes', /Month/.test(t) && /Date range/i.test(t), t);
  check('panel: offers CSV, XLSX and PDF downloads', /CSV/.test(t) && /XLSX/.test(t) && /PDF/.test(t), t);
  check('panel: renders the day-by-day register', /Register/.test(t), t);
});

// ── Same panel in dashboard-tab (compact) form ───────────────────────────────
await section('panel (compact)', '/src/modules/admin/components/FacultyAttendancePanel.tsx',
  { collegeId: 'college-a', compact: true }, (t) => {
    check('panel (compact): mounts without throwing', true);
    check('panel (compact): still computes the analysis', t.includes('5.8%'), t);
  });

// ── Overview "today" tile ────────────────────────────────────────────────────
// The fixtures are all from 1–3 Sep, so on any other day nothing is marked and
// the tile must say so rather than render an empty shell.
await section('today card', '/src/modules/admin/components/FacultyAttendanceTodayCard.tsx',
  { collegeId: 'college-a' }, (t) => {
    check('today card: mounts without throwing', true);
    check('today card: reports the roster size (3 faculty)', t.includes('3 faculty'), t);
  });

// ── Phase 1 deterministic academic context (student / faculty / paper) ──────
// The fixtures mirror the deployed asia-south1 callables' response contracts
// exactly (including the `{ enabled: false }` feature gate and the spread
// Firestore document fields the normaliser must drop).

const studentContextFixture = {
  enabled: true,
  context: {
    kind: 'student', generatedFor: '2026-09-21', collegeId: 'college-a',
    student: { id: 'academic-student-a', uid: 'faculty-1', collegeId: 'college-a', name: 'Bala Kumar', branch: 'BCA', batch: '2026', semester: 3, section: 'A' },
    classes: [
      { id: 'cls-1', collegeId: 'college-a', date: '2026-09-21', startTime: '09:00', endTime: '10:00', subject: 'DBMS', subjectCode: 'CS301', facultyName: 'Dr Rao', room: 'R-101', status: 'scheduled', topicsCovered: ['Joins', 'Indexes'], branch: 'BCA', batch: '2026', semester: 3, section: 'A' },
    ],
    pendingAssignments: [
      { id: 'asg-1', collegeId: 'college-a', title: 'ER Diagram', courseName: 'DBMS', courseCode: 'CS301', dueDate: '2026-09-23T00:00:00.000Z', status: 'published' },
    ],
    upcomingTests: [
      { id: 'test-1', collegeId: 'college-a', title: 'Midterm', subject: 'DBMS', startDateTime: '2026-09-25T09:00:00.000Z', status: 'published' },
    ],
    curriculum: [
      { id: 'cur-1', collegeId: 'college-a', status: 'approved', courseCode: 'CS301', courseName: 'DBMS', semester: 3, modules: [{ id: 'm1' }, { id: 'm2' }] },
    ],
    attendance: {
      records: [{ date: '2026-09-18', status: 'present' }, { date: '2026-09-19', status: 'absent' }],
      present: 1, absent: 1, percentage: 50,
    },
  },
};

// A signed-in student sees their scoped day: classes, pending work, tests and
// the attendance figure the backend computed.
globalThis.__RC_ROLE = 'student';
globalThis.__RC_CALLABLE_DATA = { getMyStudentAcademicContext: studentContextFixture };
await section('student academic summary', '/src/modules/student/components/StudentAcademicSummary.tsx', {}, (t) => {
  check('summary: mounts without throwing', true);
  check('summary: names the generated-for date', t.includes('2026-09-21'), t);
  check('summary: lists the cohort-targeted class with room and topics',
    t.includes('DBMS') && t.includes('Dr Rao') && t.includes('R-101') && t.includes('Joins'), t);
  check('summary: lists the pending assignment (submitted ones never reach this list)',
    t.includes('ER Diagram'), t);
  check('summary: lists the upcoming assessment', t.includes('Midterm'), t);
  check('summary: renders the deterministic attendance figure (50%)', t.includes('50%'), t);
  check('summary: shows the curriculum course count', /1 course in your curriculum/.test(t), t);
});

// Feature gate off: the surface renders nothing at all (UI is not broken).
globalThis.__RC_CALLABLE_DATA = { getMyStudentAcademicContext: { enabled: false } };
await section('student academic summary (gate off)', '/src/modules/student/components/StudentAcademicSummary.tsx', {}, (t) => {
  check('summary (gate off): renders nothing instead of an error or zeros', t === '', t);
});

// Unauthenticated rejection: a clean, actionable alert — not a crash.
globalThis.__RC_CALLABLE_DATA = {};
globalThis.__RC_CALLABLE_ERRORS = {
  getMyStudentAcademicContext: { code: 'functions/unauthenticated', message: 'Authentication is required' },
};
await section('student academic summary (unauthenticated)', '/src/modules/student/components/StudentAcademicSummary.tsx', {}, (t) => {
  check('summary (unauthenticated): shows the mapped session-expired wording', /session has expired/i.test(t), t);
  check('summary (unauthenticated): offers a retry', /Retry/.test(t), t);
});
globalThis.__RC_CALLABLE_ERRORS = {};

const facultyContextFixture = {
  enabled: true,
  context: {
    kind: 'faculty', generatedFor: '2026-09-21', collegeId: 'college-a', facultyId: 'faculty-1',
    courses: [
      { id: 'course-1', collegeId: 'college-a', courseCode: 'CS301', courseName: 'DBMS', modules: [{ id: 'm1' }] },
      { id: 'course-2', collegeId: 'college-a', courseCode: 'CS302', courseName: 'Operating Systems', modules: [] },
    ],
    completedTopics: ['Normalization'],
    upcomingSessions: [
      { id: 'ses-1', date: '2026-09-22', courseId: 'course-1', courseCode: 'CS301', topicIds: ['t1'], topicNames: ['Joins'], status: 'scheduled' },
    ],
    assignmentHistory: [
      { id: 'fas-1', courseId: 'course-1', courseCode: 'CS301', title: 'Normalization Worksheet', dueDate: '2026-09-25', status: 'published' },
      { id: 'fas-2', courseId: 'course-1', courseCode: 'CS301', title: 'Graded Worksheet', status: 'graded' },
    ],
    assessmentHistory: [
      { id: 'fat-1', courseId: 'course-1', courseCode: 'CS301', title: 'Quiz 1', scheduledAt: '2026-09-24T09:00:00.000Z', status: 'published' },
      { id: 'fat-2', courseId: 'course-2', courseCode: 'CS302', title: 'Old Quiz', scheduledAt: '2026-09-01T09:00:00.000Z', status: 'completed' },
    ],
  },
};

globalThis.__RC_ROLE = 'faculty';
globalThis.__RC_CALLABLE_DATA = { getFacultyAcademicContext: facultyContextFixture };
await section('faculty academic planner', '/src/modules/faculty/components/FacultyAcademicPlanner.tsx', {}, (t) => {
  check('planner: mounts without throwing', true);
  check('planner: lists both college courses with codes', t.includes('CS301 — DBMS') && t.includes('CS302 — Operating Systems'), t);
  const expectedSessionDate = new Date('2026-09-22').toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  check('planner: lists the upcoming session on its date',
    t.includes('CS301') && t.includes(expectedSessionDate), t);
  check('planner: shows open assignments but not graded ones as open',
    t.includes('Normalization Worksheet') && !/Graded Worksheet/.test(t), t);
  check('planner: shows upcoming assessments but not completed ones',
    t.includes('Quiz 1') && !/Old Quiz/.test(t), t);
});

// The paper context: metadata only — the raw backend payload carries question
// text that the frontend contract must never surface.
const paperContextFixture = {
  enabled: true,
  context: {
    kind: 'paper', generatedFor: '2026-09-21', collegeId: 'college-a',
    course: { id: 'course-1', collegeId: 'college-a', courseCode: 'CS301', courseName: 'DBMS', modules: [] },
    candidates: [
      { id: 'q1', courseCode: 'CS301', difficulty: 'easy', bloomsLevel: 'remember', questionText: 'TOP SECRET QUESTION TEXT', correctAnswer: 'TOP SECRET ANSWER', approved: true },
      { id: 'q2', courseCode: 'CS301', difficulty: 'hard', bloomsLevel: 'apply', approved: true },
    ],
    blueprint: { totalQuestions: 5, totalMarks: 50, sections: [{ name: 'Section A', count: 3, marks: 6 }] },
    recentlyUsedQuestionIds: ['q9'],
    distributions: { difficulty: { easy: 1, hard: 1 }, blooms: { remember: 1, apply: 1 } },
  },
};

globalThis.__RC_ROLE = 'faculty';
globalThis.__RC_CALLABLE_DATA = { getPaperAcademicContext: paperContextFixture };
await section('paper academic insights', '/src/modules/faculty/components/PaperAcademicInsights.tsx', { courseId: 'course-1' }, (t) => {
  check('insights: mounts without throwing', true);
  check('insights: counts the approved candidates', /2\s*approved candidates/.test(t), t);
  check('insights: renders difficulty and Blooms distributions',
    /easy: 1/.test(t) && /hard: 1/.test(t) && /remember: 1/.test(t) && /apply: 1/.test(t), t);
  check('insights: shows the stored blueprint totals', t.includes('5 questions') && t.includes('50 marks'), t);
  check('insights: never renders question text or answer keys',
    !/TOP SECRET/.test(t), t);
  check('insights: states the metadata-only contract', /answer keys are never included/.test(t), t);
});

globalThis.__RC_ROLE = undefined;
globalThis.__RC_CALLABLE_DATA = {};

// ── Faculty "My Attendance" page ─────────────────────────────────────────────
await section('my attendance', '/src/modules/faculty/pages/FacultySelfAttendance.tsx', {}, (t) => {
  check('my attendance: mounts without throwing', true);
  check('my attendance: identifies the signed-in faculty member', t.includes('Bala Kumar'), t);
  check('my attendance: offers every status choice',
    /Present/.test(t) && /Late/.test(t) && /Half Day/.test(t) && /On Leave/.test(t) && /Absent/.test(t), t);
  check('my attendance: renders the month grid with Sundays marked off', /OFF/.test(t), t);
  check('my attendance: shows the member\'s own percentage (9.6%)', t.includes('9.6%'), t);
  check('my attendance: lists recent entries with hours worked', /8h/.test(t) && /4h/.test(t), t);
  check('my attendance: previews the download filename', /my_attendance_\d{4}-\d{2}\.xlsx/.test(t), t);
});

// ── Standalone admin page (resolves collegeId from AuthContext) ──────────────
await section('admin page', '/src/modules/admin/pages/FacultyAttendanceAdmin.tsx', {}, (t) => {
  check('admin page: mounts without throwing', true);
  check('admin page: renders the analysis panel inside it', t.includes('5.8%'), t);
});

// ── Student journey page ─────────────────────────────────────────────────────
// The fixture is the exact payload shape `getMyAcademicJourney` returns, so the
// page, its hook and buildJourneyStages are all the shipped source. The numbers
// are chosen to be checkable by hand:
//   credits/grade points  4×9, 3×8, 2×7, 3×9  → 101 points / 12 credits
//   CGPA                  8.42 (round(8.4166…, 2))
//   semester 1 SGPA       (36+24)/7  = 8.57
//   semester 2 SGPA       (14+27)/5  = 8.2
//   rank 4 of 40          percentile (40-4)/(40-1) = 92.3 → "Top 7.7%"
//   band                  8.42 clears the 8.0 cut-off → "Strong band"
//   gap to next band      9.0 - 8.42 = 0.58
const journeyFixture = {
  profile: {
    name: 'Asha Verma', regNo: '1VE21CS012', course: 'B.E.', branch: 'CSE',
    batch: '2026', division: 'A', semester: 5,
  },
  attendance: { percentage: 82, totalClasses: 210, present: 160, late: 12, absent: 38, requiredPercentage: 75 },
  assessments: {
    attempted: 6, graded: 5, awaitingGrading: 1, averagePercentage: 78.4,
    recent: [
      { title: 'Internal Assessment 2', subject: 'Data Structures', percentage: 84, grade: 'A', submittedAt: '2026-09-02T10:00:00.000Z' },
      { title: 'Internal Assessment 1', subject: 'Data Structures', percentage: 61, grade: 'C', submittedAt: '2026-08-02T10:00:00.000Z' },
    ],
  },
  grades: {
    published: true,
    subjects: [
      { code: 'CS301', subject: 'Data Structures', credits: 4, gradePoint: 9, grade: 'A', total: 88, semester: 1 },
      { code: 'CS302', subject: 'DMS', credits: 3, gradePoint: 8, grade: 'B+', total: 79, semester: 1 },
      { code: 'CS401', subject: 'Design and Analysis', credits: 2, gradePoint: 7, grade: 'B', total: 72, semester: 2 },
      { code: 'CS402', subject: 'Operating Systems', credits: 3, gradePoint: 9, grade: 'A', total: 91, semester: 2 },
    ],
    semesters: [
      { semester: 1, sgpa: 8.57, credits: 7 },
      { semester: 2, sgpa: 8.2, credits: 5 },
    ],
    cgpa: 8.42,
    creditsEarned: 12,
  },
  standing: { branch: 'CSE', batch: '2026', cohortSize: 40, rank: 4, percentile: 92.3 },
  readiness: {
    hasCgpa: true,
    band: {
      id: 'tier2', label: 'Strong band',
      outlook: 'Clears most campus drive cut-offs, including the majority of core and product roles posted by recruiters.',
    },
    minCgpaForBand: 8,
    nextBand: { id: 'tier1', label: 'Distinction band', minCgpa: 9, gap: 0.58 },
    attendanceGate: 75,
    attendanceShortfall: 0,
    bands: [
      { id: 'tier1', minCgpa: 9, label: 'Distinction band', outlook: 'Clears the highest academic cut-offs.' },
      { id: 'tier2', minCgpa: 8, label: 'Strong band', outlook: 'Clears most campus drive cut-offs.' },
      { id: 'tier3', minCgpa: 7, label: 'Competitive band', outlook: 'Meets the common 7.0 cut-off.' },
      { id: 'tier4', minCgpa: 6.5, label: 'Eligible band', outlook: 'Meets the widely used 6.5 cut-off.' },
      { id: 'tier5', minCgpa: 6, label: 'Minimum band', outlook: 'Meets the baseline 6.0 cut-off.' },
      { id: 'below', minCgpa: 0, label: 'Below common cut-off', outlook: 'Below the 6.0 cut-off most recruiters publish.' },
    ],
  },
};

globalThis.__RC_CALLABLE_DATA = { getMyAcademicJourney: journeyFixture };

await section('student journey', '/src/modules/student/pages/StudentJourneyPage.tsx', {}, (t) => {
  check('journey: mounts without throwing', true);
  check('journey: shows the credit-weighted CGPA (8.42), not a percentage-derived one', t.includes('8.42'), t);
  check('journey: shows the real cohort rank (#4 of 40), not a hardcoded #1',
    t.includes('#4') && t.includes('40'), t);
  check('journey: derives the percentile from the cohort (Top 7.7%)', t.includes('Top 7.7%'), t);
  check('journey: names the readiness band for 8.42 (Strong band)', t.includes('Strong band'), t);
  check('journey: states the measured gap to the next band (0.58)', t.includes('0.58'), t);
  check('journey: renders all five stages from enrolment to placement',
    /Enrolled/.test(t) && /Attending & learning/.test(t) && /Assessed/.test(t)
    && /Results published/.test(t) && /Placement ready/.test(t), t);
  check('journey: renders the real per-semester SGPA (8.57 and 8.2)',
    t.includes('8.57') && t.includes('8.2'), t);
  check('journey: reports attendance against the gate without a false warning',
    t.includes('82') && t.includes('Meets the 75% gate'), t);
  check('journey: lists real graded assessments with their scores',
    t.includes('Internal Assessment 2') && t.includes('84'), t);
  check('journey: does not invent an employer name or an offer',
    !/TCS|Infosys|Wipro|guaranteed placement/i.test(t), t);
});

// ── Same page when the college has published nothing ─────────────────────────
// The honest empty states matter more than the happy path: a student with no
// transcript must see "not published", never a 0 CGPA or an invented band.
globalThis.__RC_CALLABLE_DATA = {
  getMyAcademicJourney: {
    ...journeyFixture,
    grades: { published: false, subjects: [], semesters: [], cgpa: null, creditsEarned: 0 },
    standing: { branch: 'CSE', batch: '2026', cohortSize: 0, rank: null, percentile: null },
    readiness: { ...journeyFixture.readiness, hasCgpa: false, band: null, minCgpaForBand: null, nextBand: null },
  },
};

await section('student journey (no grades published)', '/src/modules/student/pages/StudentJourneyPage.tsx', {}, (t) => {
  check('journey (empty): mounts without throwing', true);
  check('journey (empty): renders an em dash for CGPA rather than 0', t.includes('—'), t);
  check('journey (empty): says grades are not published', t.includes('Not published yet'), t);
  check('journey (empty): explains that readiness needs published grades',
    t.includes('Readiness needs published grades'), t);
  check('journey (empty): does not claim a placement band', !/Strong band/.test(t), t);
  check('journey (empty): still renders the stage timeline', /Placement ready/.test(t), t);
});

// ── Admission settings ───────────────────────────────────────────────────────
// The merit weights and the Google Form mapping are per-college, so the panel
// must render the college's own values. A panel that quietly showed the Vriddhi
// defaults would let an office believe its scoring policy was different from
// what the server actually applies.
globalThis.__RC_CALLABLE_DATA = {
  getAdmissionConfig: {
    weights: { qualifying: 60, entrance: 30, interview: 10 },
    weightsCustomised: true,
    intake: {
      enabled: true,
      hasToken: true,
      fieldMapping: { applicantName: 'Full name', phone: 'Phone Number' },
      defaults: {
        program: 'B.Tech CSE',
        batch: '2026',
        source: 'Google Form',
        department: 'Computer Science',
      },
      endpoint: 'https://asia-south1-vriddhi-engineering.cloudfunctions.net/api/admissions/ingest',
      mappableFields: ['applicantName', 'phone'],
      lastSubmissionAt: '2026-09-10T09:30:00.000Z',
      submissionCount: 17,
      rejectedCount: 2,
    },
  },
};

const SETTINGS = '/src/modules/admin/components/AdmissionSettings.tsx';
const settingsProps = { collegeId: 'college-a', onClose: () => {}, onChanged: () => {} };

await section('admission settings', SETTINGS, settingsProps, (t, view) => {
  check('settings: mounts without throwing', true);
  check('settings: shows the college\'s own weights (60 / 30 / 10), not the 50/40/10 defaults',
    view.value('weight-qualifying') === '60'
    && view.value('weight-entrance') === '30'
    && view.value('weight-interview') === '10',
    `qualifying=${view.value('weight-qualifying')} entrance=${view.value('weight-entrance')} interview=${view.value('weight-interview')}`);
  check('settings: confirms the weights add up to 100%', t.includes('Total 100% — valid'), t);
  check('settings: reports the real submission counts (17 received, 2 rejected)',
    t.includes('17') && /Submissions received/.test(t) && /Rejected/.test(t), t);
  check('settings: shows the ingest endpoint the Apps Script must post to',
    t.includes('/api/admissions/ingest'), t);
  check('settings: echoes the mapped form question titles back to the college',
    view.value('map-applicantName') === 'Full name' && view.value('map-phone') === 'Phone Number',
    `applicantName=${view.value('map-applicantName')} phone=${view.value('map-phone')}`);
  check('settings: shows the per-college intake defaults',
    view.value('default-program') === 'B.Tech CSE'
    && view.value('default-department') === 'Computer Science'
    && view.value('default-batch') === '2026',
    `program=${view.value('default-program')} department=${view.value('default-department')}`);
  check('settings: does not display a plaintext token — it is shown once, at generation only',
    !/[A-Za-z0-9_-]{32}/.test(t) && t.includes('rotate it to see a new one'), t);
  check('settings: offers both rotate and revoke',
    /Rotate token/.test(t) && /Revoke/.test(t), t);
  check('settings: tells the college the trigger they must add',
    /On form submit/.test(t), t);
});

// ── Student "My Curriculum" page ─────────────────────────────────────────────
// The fixture is the exact payload `getMyCurriculum` returns. The page must
// show all three states, the per-subject percentage, the module being taught,
// the next scheduled classes WITH their planned topics, and behave sensibly
// when the college has mapped nothing yet.
const curriculumFixture = {
  generatedAt: '2026-09-13T00:00:00.000Z',
  student: { branch: 'BBA', batch: '2027', semester: 3, division: 'A' },
  noCurriculumAssigned: false,
  totals: { subjects: 1, topics: 5, completed: 2, current: 1, upcoming: 2, pct: 40 },
  upcomingClasses: [{
    id: 's1', date: '2099-01-05', dayOfWeek: 'Monday', startTime: '09:00', endTime: '10:00',
    subject: 'Financial Accounting', subjectCode: 'BBA101', facultyName: 'Vivek Ramesh', room: 'R-12',
    status: 'scheduled', topics: ['Journals'],
  }],
  subjects: [{
    curriculumId: 'cur-1', courseCode: 'BBA101', courseName: 'Financial Accounting', facultyName: 'Vivek Ramesh',
    credits: 4, totalHours: 40,
    totals: { total: 5, completed: 2, current: 1, upcoming: 2, pct: 40 },
    recentSessions: [], upcomingSessions: [],
    modules: [
      { moduleNo: '1', moduleName: 'Introduction', hours: 8, total: 3, completed: 2, current: 1, upcoming: 0, pct: 67, state: 'current', topics: [
        { title: 'What is Accounting', state: 'completed', coveredOn: '2026-09-01', plannedOn: null },
        { title: 'Double Entry', state: 'completed', coveredOn: '2026-09-05', plannedOn: null },
        { title: 'Journals', state: 'current', coveredOn: null, plannedOn: '2099-01-05' },
      ]},
      { moduleNo: '2', moduleName: 'Ledgers', hours: 10, total: 2, completed: 0, current: 0, upcoming: 2, pct: 0, state: 'upcoming', topics: [
        { title: 'Posting', state: 'upcoming', coveredOn: null, plannedOn: null },
        { title: 'Trial Balance', state: 'upcoming', coveredOn: null, plannedOn: null },
      ]},
    ],
  }],
};
globalThis.__RC_CALLABLE_DATA = { getMyCurriculum: curriculumFixture };
await section('curriculum', '/src/modules/student/pages/StudentCurriculumPage.tsx', {}, (t) => {
  check('curriculum: mounts without throwing', true);
  check('curriculum: identifies the cohort', /BBA/.test(t) && /Batch 2027/.test(t) && /Semester 3/.test(t), t);
  check('curriculum: lists the subject with its faculty and coverage %',
    t.includes('Financial Accounting') && t.includes('Vivek Ramesh') && t.includes('40%'), t);
  check('curriculum: shows Completed / Current / Upcoming states',
    /Completed/.test(t) && /Current/.test(t) && /Upcoming/.test(t), t);
  check('curriculum: the module being taught is expanded and marks taught topics with their date',
    t.includes('Module 1: Introduction') && t.includes('What is Accounting') && /Taught on 1 Sept?/.test(t), t);
  check('curriculum: "Currently studying" names the in-progress topic', /Currently studying/.test(t) && t.includes('Journals'), t);
  check('curriculum: next classes show the planned topic, faculty and room',
    /Next classes/.test(t) && t.includes('R-12') && t.includes('Journals'), t);
  check('curriculum: links to the timetable', /Full timetable/.test(t), t);
});

globalThis.__RC_CALLABLE_DATA = { getMyCurriculum: { ...curriculumFixture, subjects: [], upcomingClasses: [], noCurriculumAssigned: true,
  totals: { subjects: 0, topics: 0, completed: 0, current: 0, upcoming: 0, pct: 0 } } };
await section('curriculum (unmapped)', '/src/modules/student/pages/StudentCurriculumPage.tsx', {}, (t) => {
  check('curriculum (unmapped): explains that nothing is mapped instead of showing zeros',
    /No curriculum has been mapped/.test(t) && !/0%/.test(t), t);
});

globalThis.__RC_CALLABLE_DATA = {};
await section('curriculum (error)', '/src/modules/student/pages/StudentCurriculumPage.tsx', {}, (t) => {
  check('curriculum (error): surfaces the callable failure with a retry', /Could not load your curriculum/.test(t) && /Try again/.test(t), t);
});




// ── Public /prep hub (docs/handoff-prep-hub-redesign.md §3, §7) ──────────────
// The hub was rebuilt from a flat card grid into two jobs side by side: a
// semester accordion and a placement band. These checks pin the parts the
// brief calls out — title-first rows, one line of metadata, no descriptions or
// stream chips in the grid, semester grouping (with the yearGroup / "other"
// fallbacks), the UG/PG program control, the eligibility-filtered company row,
// and the "college hid company prep" case where the band must lose the company
// sub-block without leaving a hole.
const PREP_VIEWER = '/src/modules/prep/PrepPublicViewer.tsx';

const prepSubjects = [
  // Semester 1 — BBA, all 1st-year.
  { id: 'bba-micro', name: 'Microeconomics', stream: 'economics', track: 'academic', programs: ['bba', 'bcom'],
    yearGroup: '1st-year', semester: 1, order: 1, topicCount: 5, status: 'published',
    description: 'Demand, supply and elasticity explained for first-year commerce students.' },
  { id: 'bba-mpa', name: 'Management Principles & Applications', stream: 'management', track: 'academic', programs: ['bba'],
    yearGroup: '1st-year', semester: 1, order: 2, topicCount: 5, status: 'published',
    description: 'Fayol to Mintzberg, with cases from Indian firms.' },
  { id: 'bba-accounting', name: 'Fundamentals of Business Accounting', stream: 'commerce', track: 'academic', programs: ['bba', 'bcom', 'mcom'],
    yearGroup: '1st-year', semester: 1, order: 3, topicCount: 5, status: 'published',
    description: 'Journals, ledgers and the trial balance.' },
  // Semester 2 — note `stream: 'aptitude'` on an ACADEMIC subject: the split is
  // by track, never by stream, or the hub would file maths under placements.
  { id: 'bba-ob', name: 'Organizational Behaviour', stream: 'management', track: 'academic', programs: ['bba'],
    yearGroup: '1st-year', semester: 2, order: 4, topicCount: 5, status: 'published',
    description: 'Motivation, groups and leadership.' },
  { id: 'bba-math', name: 'Business Mathematics & Quantitative Techniques', stream: 'aptitude', track: 'academic', programs: ['bba'],
    yearGroup: '1st-year', semester: 2, order: 5, topicCount: 5, status: 'published',
    description: 'Matrices, calculus and linear programming for commerce.' },
  // Semester 3 — 2nd year.
  { id: 'bba-cost', name: 'Cost Accounting', stream: 'commerce', track: 'academic', programs: ['bba', 'bcom'],
    yearGroup: '2nd-year', semester: 3, order: 7, topicCount: 5, status: 'published', description: 'Costing methods.' },
  { id: 'bba-stats', name: 'Business Statistics', stream: 'aptitude', track: 'academic', programs: ['bba'],
    yearGroup: '2nd-year', semester: 3, order: 8, topicCount: 5, status: 'published', description: 'Measures of central tendency.' },
  // M.Com: one numbered semester, one year-group-only subject and one with
  // neither — the two documented fallbacks (§5.1).
  { id: 'mcom-adv-accounting', name: 'Advanced Corporate Accounting', stream: 'commerce', track: 'academic', programs: ['mcom'],
    yearGroup: '1st-year', semester: 1, order: 1, topicCount: 6, status: 'published', description: 'Consolidation and branch accounts.' },
  { id: 'mcom-research', name: 'Business Research Methods', stream: 'management', track: 'academic', programs: ['mcom'],
    yearGroup: '1st-year', order: 9, topicCount: 4, status: 'published', description: 'Sampling, hypotheses and SPSS.' },
  { id: 'mcom-elective', name: 'Elective Pack', stream: 'strategy', track: 'academic', programs: ['mcom'],
    order: 12, topicCount: 3, status: 'published', description: 'An elective with no semester or year yet.' },
  // Shared placement aptitude catalogue — every program.
  { id: 'apt-quantitative-aptitude', name: 'Quantitative Aptitude', stream: 'aptitude', track: 'aptitude',
    programs: ['bba', 'bcom', 'ba', 'bsc', 'bca', 'mba', 'mcom', 'mca'], order: 101, topicCount: 24, status: 'published',
    description: 'Numbers, percentages, time-speed-work, algebra, probability and DI.' },
  { id: 'apt-logical-reasoning', name: 'Logical Reasoning', stream: 'aptitude', track: 'aptitude',
    programs: ['bba', 'bcom', 'ba', 'bsc', 'bca', 'mba', 'mcom', 'mca'], order: 102, topicCount: 20, status: 'published',
    description: 'Series, coding-decoding, blood relations, seating arrangement.' },
  { id: 'apt-verbal-ability', name: 'Verbal Ability & Reading Skills', stream: 'communication', track: 'aptitude',
    programs: ['bba', 'bcom', 'ba', 'bsc', 'bca', 'mba', 'mcom', 'mca'], order: 103, topicCount: 18, status: 'published',
    description: 'Grammar, vocabulary, comprehension and sentence correction.' },
];

const company = (code, name, programs, extra = {}) => ({
  code, name, testName: `${name} Online Test`, tagline: `${name} tagline.`, audience: ['ug'], tier: 'mass',
  totalMinutes: 100, totalQuestions: 60, negativeMarking: false, sectionalCutoff: true,
  eligibility: { programs, degrees: 'Any graduate' }, sections: [], rounds: [], quickTips: [],
  patternVerifiedOn: '2026-09-01', sources: [], status: 'published', order: 1, topicCount: 12, ...extra,
});

const prepCompanies = [
  company('tcs-nqt', 'TCS', ['bba', 'bcom', 'ba', 'bsc', 'bca', 'mba', 'mcom', 'mca']),
  company('infosys', 'Infosys', ['bba', 'bcom', 'ba', 'bsc', 'bca', 'mba', 'mcom', 'mca']),
  company('wipro-nlth', 'Wipro', ['bba', 'bcom', 'bsc', 'bca']),
  // Capgemini hires tech/PG only — it must NOT show for BBA (§7).
  company('capgemini', 'Capgemini', ['bca', 'bsc', 'mca']),
];

const prepTopic = {
  id: 'bba-micro-t1', subjectId: 'bba-micro', title: 'Demand, Supply & Equilibrium', order: 1, difficulty: 'core',
  moduleNumber: 1, moduleName: 'Module 1: Microeconomics', subtopics: ['Demand'], explanationMd: '## Demand',
  formulas: [], tricks: [], howToSolve: [], featuredQuestionIds: [], status: 'published',
  generatedBy: 'curator', contentVersion: 1, tier: 'free',
};

const prepQuestion = {
  id: 'q-qa-1', questionText: 'If 20% of x is 40, what is x?', options: ['100', '200', '160', '80'], correctIndex: 1,
  explanation: 'x = 40 / 0.2 = 200.', difficulty: 'basic', status: 'approved',
  prepTags: { subjectId: 'apt-quantitative-aptitude', topicIds: ['qa-percentages'] },
  sectionId: 'quant', sectionName: 'Quantitative Ability',
};

function resetPrep(fixture = {}, { search = '', params = {} } = {}) {
  globalThis.__RC_PREP = { subjects: prepSubjects, companies: prepCompanies, ...fixture };
  globalThis.__RC_PREP_CALLS = [];
  globalThis.__RC_SEARCH = search;
  globalThis.__RC_SEARCH_SETS = [];
  globalThis.__RC_PARAMS = params;
  for (const key of ['vriddhi.prep.program', 'vriddhi.prep.collegeId',
    'vriddhi.prep.openSemesters.bba', 'vriddhi.prep.openSemesters.mcom', 'vriddhi.prep.openSemesters.bca']) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

const callsTo = (fn) => (globalThis.__RC_PREP_CALLS ?? []).filter((c) => c.fn === fn);
/** The accordion's header lines, in render order. */
const groupHeaders = (view) => view.all('button[aria-expanded]').map((b) => b.textContent.replace(/\s+/g, ' ').trim());
/** header text → aria-expanded, i.e. what the learner can actually see. */
const expandedGroups = (view) => Object.fromEntries(
  view.all('button[aria-expanded]').map((b) => [b.textContent.replace(/\s+/g, ' ').trim(), b.getAttribute('aria-expanded')]));
/** The breadcrumb, crumb by crumb (textContent alone runs them together). */
const crumbs = (view) => view.all('nav[aria-label="Breadcrumb"] li').map((li) => li.textContent.trim());

// ── Hub, BBA, default arrival ────────────────────────────────────────────────
resetPrep();
await section('prep hub (bba)', PREP_VIEWER, { view: 'hub' }, (t, view) => {
  const ot = view.openText();
  check('prep hub: mounts without throwing', true);
  check('prep hub: both jobs render — study column and placement band',
    /Study your subjects/.test(t) && /Prepare for placements/.test(t), t);
  check('prep hub: program control groups UG and PG instead of suffixing "(PG)"',
    /Undergraduate/.test(t) && /Postgraduate/.test(t) && !/\(PG\)/.test(t), t);
  const active = view.all('[aria-current="true"]');
  check('prep hub: the selected program is marked with aria-current',
    active.length === 1 && active[0].textContent.trim() === 'BBA', active.map((a) => a.textContent).join('|'));
  check('prep hub: the catalog is grouped by semester, in order, with year + count on the header',
    JSON.stringify(groupHeaders(view)) === JSON.stringify([
      'Semester 1 · 1st year · 3 subjects',
      'Semester 2 · 1st year · 2 subjects',
      'Semester 3 · 2nd year · 2 subjects',
    ]), groupHeaders(view).join(' | '));
  check('prep hub: semester 1 is open on arrival and lists its subjects, title first',
    t.includes('Microeconomics') && t.includes('Management Principles & Applications')
    && t.includes('Fundamentals of Business Accounting'), t);
  check('prep hub: later semesters stay collapsed instead of becoming a wall of cards',
    !ot.includes('Organizational Behaviour') && !ot.includes('Cost Accounting'), ot);
  // textContent runs "…Applications" and "5 topics" together, and the study
  // column's own total says "35 topics" — so exclude a preceding digit.
  const fiveTopicRows = (ot.match(/(?<!\d)5 topics/g) ?? []).length;
  check('prep hub: each visible subject row carries exactly one metadata line ("5 topics")',
    fiveTopicRows === 3, `count=${fiveTopicRows} tail=${ot.slice(-320)}`);
  check('prep hub: no descriptions in the grid — those live on the subject page',
    !ot.includes('Demand, supply and elasticity') && !ot.includes('Journals, ledgers'), ot);
  check('prep hub: no stream chip, no program list, no "All programs" noise on a row',
    !ot.includes('Quantitative Aptitude & Reasoning') && !ot.includes('Managerial Economics')
    && !ot.includes('BA, B.Com, BBA') && !/All programs/.test(ot), ot);
  check('prep hub: the three aptitude packs are compact tiles in the band',
    /Quantitative Aptitude/.test(t) && /Logical Reasoning/.test(t) && /Verbal Ability/.test(t)
    && /24 topics/.test(t) && /20 topics/.test(t) && /18 topics/.test(t), t);
  check('prep hub: aptitude is filed under placements, never under a semester',
    groupHeaders(view).every((h) => !/· 6[23] subjects/.test(h)) && !t.includes('Semester 101'), groupHeaders(view).join(' | '));
  check('prep hub: company guides render as a compact row inside the band',
    /Company guides/.test(t) && t.includes('TCS') && t.includes('Infosys') && t.includes('Wipro')
    && /Take a 20-question mock/.test(t), t);
  check('prep hub: Capgemini is filtered out for BBA by eligibility', !t.includes('Capgemini'), t);
  check('prep hub: renders from ONE subjects + ONE companies request (no per-card fetches)',
    callsTo('subjects').length === 1 && callsTo('companies').length === 1 && callsTo('subject').length === 0,
    JSON.stringify(globalThis.__RC_PREP_CALLS));
  check('prep hub: subject rows deep-link with the program they were browsed under',
    view.hrefs().includes('/prep/subject/bba-micro?program=bba'), view.hrefs().join(' '));
  check('prep hub: the mock CTA lands on the company mock tab',
    view.hrefs().some((h) => /^\/prep\/company\/tcs-nqt\?tab=mock/.test(h)), view.hrefs().join(' '));
  check('prep hub: keeps a share control for the page', view.all('[aria-label*="Share"]').length === 1, '');
  check('prep hub: the header no longer leads with NEP 2020 / CBCS jargon',
    !/NEP 2020 \/ CBCS study packs/.test(t) && /Free study packs/.test(t), t);
});

// ── Hub interaction: semester memory + program switch ────────────────────────
resetPrep();
await section('prep hub (accordion + program switch)', PREP_VIEWER, { view: 'hub' }, async (t, view) => {
  check('prep hub (interaction): mounts without throwing', true);
  const sem2 = view.all('button[aria-expanded]').find((b) => /Semester 2/.test(b.textContent));
  check('prep hub (interaction): semester headers are buttons with aria-expanded + aria-controls',
    Boolean(sem2) && sem2.getAttribute('aria-expanded') === 'false' && Boolean(sem2.getAttribute('aria-controls')), '');
  await view.click(sem2);
  const after = view.openText();
  check('prep hub (interaction): tapping a semester expands it in place',
    sem2.getAttribute('aria-expanded') === 'true' && after.includes('Organizational Behaviour')
    && after.includes('Business Mathematics & Quantitative Techniques'), after);
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('vriddhi.prep.openSemesters.bba') ?? 'null'); } catch { /* ignore */ }
  check('prep hub (interaction): open semesters are remembered per program',
    Array.isArray(stored) && stored.includes('sem-1') && stored.includes('sem-2'), JSON.stringify(stored));

  const mcom = view.byText('M.Com');
  check('prep hub (interaction): M.Com is its own pill, with no "(PG)" suffix', Boolean(mcom), '');
  await view.click(mcom);
  const switched = view.openText();
  check('prep hub (interaction): switching program updates the URL query',
    (globalThis.__RC_SEARCH_SETS ?? []).includes('?program=mcom'), JSON.stringify(globalThis.__RC_SEARCH_SETS));
  check('prep hub (interaction): switching program refetches that catalog exactly once',
    callsTo('subjects').length === 2 && callsTo('subjects')[1].params.program === 'mcom'
    && callsTo('companies').length === 2, JSON.stringify(globalThis.__RC_PREP_CALLS));
  check('prep hub (interaction): the new program shows its own subjects and hides BBA ones',
    switched.includes('Advanced Corporate Accounting') && !switched.includes('Microeconomics'), switched);
  check('prep hub (interaction): the study column reports what it is showing',
    /M\.Com · 4 subjects · 18 topics/.test(switched), switched);
  check('prep hub (interaction): a subject shared with another program is listed here too',
    switched.includes('Fundamentals of Business Accounting'), switched);
  check('prep hub (interaction): no semester → year group, no year group → "Other study packs"',
    JSON.stringify(groupHeaders(view)) === JSON.stringify([
      'Semester 1 · 1st year · 2 subjects',
      '1st year · 1 subject',
      'Other study packs · 1 subject',
    ]), groupHeaders(view).join(' | '));
  const other = view.all('button[aria-expanded]').find((b) => /Other study packs/.test(b.textContent));
  await view.click(other);
  check('prep hub (interaction): the catch-all group opens onto its subject',
    view.openText().includes('Elective Pack'), view.openText());
  check('prep hub (interaction): the chosen program is remembered on this device',
    localStorage.getItem('vriddhi.prep.program') === 'mcom', localStorage.getItem('vriddhi.prep.program'));
});

// ── Reloading restores the program and the open semester ─────────────────────
resetPrep({}, { search: '?program=bba' });
try { localStorage.setItem('vriddhi.prep.openSemesters.bba', JSON.stringify(['sem-3'])); } catch { /* ignore */ }
await section('prep hub (reload)', PREP_VIEWER, { view: 'hub' }, (t, view) => {
  const ot = view.openText();
  const expanded = expandedGroups(view);
  check('prep hub (reload): reopens the semester the learner left open, and only that one',
    ot.includes('Cost Accounting') && ot.includes('Business Statistics')
    && expanded['Semester 3 · 2nd year · 2 subjects'] === 'true'
    && expanded['Semester 1 · 1st year · 3 subjects'] === 'false', JSON.stringify(expanded));
});

// ── A `?sem=` hint from a breadcrumb wins over the stored semester ───────────
resetPrep({}, { search: '?program=bba&sem=2' });
await section('prep hub (?sem hint)', PREP_VIEWER, { view: 'hub' }, (t, view) => {
  const ot = view.openText();
  const expanded = expandedGroups(view);
  check('prep hub (?sem): opens the semester the learner came back from',
    ot.includes('Organizational Behaviour')
    && expanded['Semester 2 · 1st year · 2 subjects'] === 'true'
    && expanded['Semester 1 · 1st year · 3 subjects'] === 'false', JSON.stringify(expanded));
});

// ── BCA: Capgemini becomes eligible ─────────────────────────────────────────
resetPrep({}, { search: '?program=bca' });
await section('prep hub (bca)', PREP_VIEWER, { view: 'hub' }, (t) => {
  check('prep hub (bca): mounts without throwing', true);
  check('prep hub (bca): Capgemini IS offered to BCA — the filter is eligibility, not a hardcode',
    t.includes('Capgemini'), t);
  check('prep hub (bca): the placement band still leads with the aptitude tiles',
    /Prepare for placements/.test(t) && /Quantitative Aptitude/.test(t), t);
  check('prep hub (bca): with no BCA syllabus published the study block explains itself',
    /No BCA subjects published yet/.test(t), t);
  check('prep hub (bca): still exactly one subjects + one companies request',
    callsTo('subjects').length === 1 && callsTo('companies').length === 1, JSON.stringify(globalThis.__RC_PREP_CALLS));
});

// ── College hides company prep (§5.3 / §7) ───────────────────────────────────
resetPrep({ companies: [] });
await section('prep hub (company prep hidden)', PREP_VIEWER, { view: 'hub' }, (t) => {
  check('prep hub (hidden companies): mounts without throwing', true);
  check('prep hub (hidden companies): the band survives — aptitude is always there',
    /Prepare for placements/.test(t) && /Quantitative Aptitude/.test(t) && /Logical Reasoning/.test(t), t);
  check('prep hub (hidden companies): no company row and no mock CTA left behind',
    !/Company guides/.test(t) && !/Take a 20-question mock/.test(t), t);
  check('prep hub (hidden companies): the study column is untouched',
    /Semester 1 · 1st year · 3 subjects/.test(t), t);
});

// ── Nothing published at all ─────────────────────────────────────────────────
resetPrep({ subjects: [], companies: [] });
await section('prep hub (empty catalog)', PREP_VIEWER, { view: 'hub' }, (t) => {
  check('prep hub (empty): says the catalog is not published instead of rendering a shell',
    /No published BBA packs yet/.test(t), t);
});

// ── Subject + topic + company pages share one breadcrumb treatment ───────────
resetPrep({ topics: [prepTopic] }, { search: '?program=bba', params: { subjectId: 'bba-micro' } });
await section('prep subject page', PREP_VIEWER, { view: 'subject' }, (t, view) => {
  check('prep subject: mounts without throwing', true);
  check('prep subject: breadcrumb is Prep › BBA › Semester 1 › subject (§3.1)',
    JSON.stringify(crumbs(view)) === JSON.stringify(['Prep', 'BBA', 'Semester 1', 'Microeconomics']), crumbs(view).join(' | '));
  check('prep subject: the current page is the aria-current crumb, not a link',
    view.all('[aria-current="page"]').length === 1
    && view.all('[aria-current="page"]')[0].textContent.trim() === 'Microeconomics', '');
  check('prep subject: keeps its share control', /Share \/ copy link/.test(t), t);
  check('prep subject: topic links carry the program so "back" returns to the same catalog',
    view.hrefs().includes('/prep/subject/bba-micro/topic/bba-micro-t1?program=bba'), view.hrefs().join(' '));
});

resetPrep({ topics: [prepTopic] }, { search: '?program=bba', params: { subjectId: 'bba-micro', topicId: 'bba-micro-t1' } });
await section('prep topic page', PREP_VIEWER, { view: 'topic' }, (t, view) => {
  check('prep topic: mounts without throwing', true);
  check('prep topic: breadcrumb names program, semester, subject and topic',
    JSON.stringify(crumbs(view)) === JSON.stringify(
      ['Prep', 'BBA', 'Semester 1', 'Microeconomics', 'Demand, Supply & Equilibrium']), crumbs(view).join(' | '));
  check('prep topic: the subject crumb links back to the subject with its program',
    view.hrefs().includes('/prep/subject/bba-micro?program=bba'), view.hrefs().join(' '));
  check('prep topic: the semester crumb links back to that semester on the hub',
    view.hrefs().includes('/prep?program=bba&sem=1'), view.hrefs().join(' '));
  check('prep topic: still renders every content section',
    /Explanation/.test(t) && /Formulas/.test(t) && /Tricks/.test(t) && /How to Solve/.test(t) && /Practice/.test(t), t);
});

resetPrep({ questions: [prepQuestion] }, { search: '?program=bca&tab=mock', params: { companyCode: 'capgemini' } });
await section('prep company page', PREP_VIEWER, { view: 'company' }, (t, view) => {
  check('prep company: mounts without throwing', true);
  check('prep company: breadcrumb matches the subject/topic pages',
    JSON.stringify(crumbs(view)) === JSON.stringify(['Prep', 'BCA', 'Placement', 'Capgemini']), crumbs(view).join(' | '));
  check('prep company: ?tab=mock opens the mock rather than the pattern tab',
    /questions sampled from the topics this test uses/.test(t), t);
  check('prep company: keeps the checklist tab with its progress label',
    /Topics to prepare/.test(t), t);
});

resetPrep();

// ── Most repeated questions (item 3.3) ───────────────────────────────────────
// The grouping runs on the server; this view is the surface. Two things matter
// here: the subject picker comes from the API's own list (never a hard-coded
// one), and each group shows how many times the question was asked plus the
// years, so the claim is checkable by the student.
const repeatFixture = {
  subjects: [
    { subjectName: 'Financial Accounting', repeated: 2 },
    { subjectName: 'Business Law', repeated: 1 },
  ],
  questions: [
    {
      question: 'Explain the objectives of financial accounting with examples.',
      key: 'accounting objectives',
      subjectName: 'Financial Accounting',
      program: 'bcom',
      marks: 5,
      count: 3,
      years: [2024, 2023, 2022],
      examLabels: ['February/March 2024', 'February/March 2023', 'September 2022'],
      paperIds: ['bcu-bcom-5-2024', 'bcu-bcom-5-2023'],
      variants: ['Explain the objectives of financial accounting briefly.'],
    },
  ],
};

resetPrep({ frequent: repeatFixture }, { search: '?program=bcom&subject=Financial%20Accounting' });
await section('prep repeated questions', PREP_VIEWER, { view: 'repeats' }, (t, view) => {
  check('prep repeats: mounts without throwing', true);
  check('prep repeats: breadcrumb is Prep › B.Com › Most repeated questions',
    JSON.stringify(crumbs(view)) === JSON.stringify(['Prep', 'B.Com', 'Most repeated questions']),
    crumbs(view).join(' | '));
  check('prep repeats: asks the API for the chosen subject', 
    callsTo('frequent').some((c) => c.params?.subject === 'Financial Accounting' && c.params?.program === 'bcom'),
    JSON.stringify(globalThis.__RC_PREP_CALLS));
  check('prep repeats: shows how many times the question was asked',
    /Asked 3 times/.test(t), t);
  check('prep repeats: shows every year it appeared', /2024/.test(t) && /2023/.test(t) && /2022/.test(t), t);
  check('prep repeats: shows the marks', /5 marks/.test(t), t);
  check('prep repeats: keeps the shorter wording as "Also asked as"',
    /Also asked as/.test(t) && /briefly/.test(t), t);
  check('prep repeats: links to the papers it came from',
    view.all('a[href*="/prep/papers/bcu-bcom-5-2024"]').length > 0, t);
  check('prep repeats: subject picker is built from the API list, with counts',
    /Financial Accounting \(2\)/.test(t) && /Business Law \(1\)/.test(t), t);
  check('prep repeats: says the grouping is counting, not AI',
    /Nothing here is generated by AI/.test(t), t);
});

// No subject chosen yet: the picker must still render, from the same response.
resetPrep({ frequent: { subject: null, subjects: repeatFixture.subjects, questions: [] } }, { search: '?program=bcom' });
await section('prep repeated questions (no subject yet)', PREP_VIEWER, { view: 'repeats' }, (t, view) => {
  check('prep repeats (picker): mounts without throwing', true);
  check('prep repeats (picker): offers only the subjects that actually repeat',
    /Financial Accounting \(2\)/.test(t) && /Business Law \(1\)/.test(t), t);
  check('prep repeats (picker): prompts the learner to pick one',
    /Pick a subject/.test(t), t);
  // The share control builds its URL from window.location.origin + the path, so
  // the assertion is on the control being present on this page at all.
  check('prep repeats (picker): offers the share/copy control',
    view.all('[aria-label="Share or copy link to this page"], button').length > 0
      && /Share \/ copy link/.test(t), t);
});

// A program with papers but no repeats must say so instead of showing nothing.
resetPrep({ frequent: { subject: null, subjects: [], questions: [] } }, { search: '?program=bba' });
await section('prep repeated questions (empty)', PREP_VIEWER, { view: 'repeats' }, (t) => {
  check('prep repeats (empty): mounts without throwing', true);
  check('prep repeats (empty): explains that no question repeats yet', /No repeats found yet/.test(t), t);
  check('prep repeats (empty): points at the full paper sets instead', /previous year papers/.test(t), t);
});

resetPrep();

// ── Model answers and quick-revision MCQs on a paper (items 3.4 / 3.5) ──────
// What a STUDENT sees: published answers only, and the "AI-generated, reviewed"
// label has to be there — that label is the promise the review flow keeps.
const answerFixture = {
  paper: {
    id: 'bcu-bcom-5-2024',
    program: 'bcom',
    programLabel: 'B.Com',
    degreeLevel: 'undergraduate',
    universityCode: 'bcu',
    universityName: 'Bengaluru City University',
    scheme: 'NEP 2021-22 onwards (F+R)',
    semester: 5,
    subjectName: 'Financial Accounting',
    paperCode: 'DCBB503',
    examMonth: 'February/March',
    examYear: 2024,
    examLabel: 'February/March 2024',
    durationMinutes: 180,
    maxMarks: 70,
    instructions: [],
    questionCount: 2,
    tags: [],
    language: 'en',
    status: 'published',
    source: { title: 'BCU question paper', url: 'https://example.edu/p.pdf', publisher: 'BCU', retrievedOn: '2026-09-01' },
    sections: [
      {
        id: 's-B',
        title: 'Answer any two',
        instruction: 'Answer any two of the following. Each question carries 10 marks.',
        answerCount: 2,
        marksEach: 10,
        totalMarks: 20,
        questions: [
          { label: '1', text: 'Explain the objectives of financial accounting.' },
          { label: '2', text: 'Prepare a trading account from the given balances.' },
        ],
      },
    ],
  },
  answers: {
    answers: [
      {
        id: 'bcu-bcom-5-2024__s-B__1',
        paperId: 'bcu-bcom-5-2024',
        qid: 's-B__1',
        sectionId: 's-B',
        label: '1',
        question: 'Explain the objectives of financial accounting.',
        marks: 10,
        status: 'published',
        answerMd: 'Financial accounting records, classifies and summarises transactions.\n- Objective one: to ascertain profit or loss.',
      },
    ],
    // A draft is in the fixture on purpose: a student must not see it even when
    // the API is asked for the paper. The stub only returns it in `drafts`,
    // which the view ignores for non-reviewers — the same contract as the server.
    drafts: [
      {
        id: 'bcu-bcom-5-2024__s-B__2',
        paperId: 'bcu-bcom-5-2024',
        qid: 's-B__2',
        sectionId: 's-B',
        label: '2',
        question: 'Prepare a trading account from the given balances.',
        marks: 10,
        status: 'draft',
        answerMd: 'DRAFT THAT MUST NOT BE SHOWN TO A STUDENT.',
      },
    ],
  },
  mcqSets: [
    {
      id: 'bcu-bcom-5-2024__s-B__1_2',
      paperId: 'bcu-bcom-5-2024',
      subjectName: 'Financial Accounting',
      status: 'published',
      items: [
        {
          question: 'Which statement shows the gross profit of a trading business?',
          options: ['Trading account', 'Cash book', 'Ledger', 'Journal'],
          correctIndex: 0,
          explanation: 'The trading account brings together sales and cost of goods sold.',
        },
      ],
    },
  ],
};

globalThis.__RC_ROLE = 'student';
resetPrep(answerFixture, { search: '?program=bcom', params: { paperId: 'bcu-bcom-5-2024' } });
await section('prep paper with a published model answer', PREP_VIEWER, { view: 'paper' }, (t, view) => {
  check('prep paper answers: mounts without throwing', true);
  check('prep paper answers: the reviewed label is shown', /Model answer · AI-generated, reviewed/.test(t), t);
  check('prep paper answers: the answer text is not visible until asked for',
    !/Objective one: to ascertain profit or loss/.test(t), t);
  check('prep paper answers: a draft answer is NEVER rendered for a student',
    !/DRAFT THAT MUST NOT BE SHOWN TO A STUDENT/.test(t), t);
  check('prep paper answers: a student sees no review strip',
    view.all('[data-testid="answer-review-strip"]').length === 0, t);
  check('prep paper answers: the published quick-revision set renders',
    view.all('[data-testid="quick-revision-set"]').length === 1, t);
  check('prep paper answers: the MCQ correction is explained after an answer',
    /Trading account/.test(t) && /gross profit/.test(t), t);
});

// The reviewer sees the strip, the draft and the controls.
globalThis.__RC_ROLE = 'superadmin';
resetPrep(answerFixture, { search: '?program=bcom', params: { paperId: 'bcu-bcom-5-2024' } });
await section('prep paper review strip (superadmin)', PREP_VIEWER, { view: 'paper' }, async (t, view) => {
  check('prep paper review: mounts without throwing', true);
  check('prep paper review: the strip is present for a superadmin',
    view.all('[data-testid="answer-review-strip"]').length === 1, t);
  check('prep paper review: drafts are listed for review',
    /DRAFT THAT MUST NOT BE SHOWN TO A STUDENT/.test(t), t);
  check('prep paper review: says nothing publishes automatically',
    /Nothing is published automatically/.test(t), t);
  check('prep paper review: offers generate, publish and reject',
    /Generate next 25 answers/.test(t) && /Publish all drafts/.test(t) && /Reject all drafts/.test(t), t);

  // Publishing from the strip must call the review endpoint with the draft id.
  const publishButton = view.all('button').find((b) => /^Publish all drafts/.test(b.textContent || ''));
  await view.click(publishButton);
  const calls = callsTo('reviewAnswers');
  check('prep paper review: publishing calls the review endpoint with the draft id',
    calls.length === 1 && calls[0].params.action === 'publish'
      && calls[0].params.ids.includes('bcu-bcom-5-2024__s-B__2'),
    JSON.stringify(calls));
});

globalThis.__RC_ROLE = 'student';
resetPrep();


// ── Student "My Challans" ──────────────────────────────────────────────────
// The challan data path end to end on the student side: the college-scoped
// query the hook issues, the document mapping, the status filters, and the
// printable sheet a student takes to the bank. This is the flow that rendered a
// permanent "No challans yet" while the rows existed (the collection had no
// Firestore rule, so the read was denied and the failure only reached the log).
const { toasts: challanToasts } = await server.ssrLoadModule('/scripts/render-check/stubs/notificationProvider.ts');
const challanRow = {
  id: 'challan-1',
  data: () => ({
    challanNo: 'CH-202609-BCA-000123',
    type: 'university_exam',
    category: 'university_exam',
    studentId: 'student-domain-a',
    studentName: 'Bala Kumar',
    regNo: '21BCA045',
    course: 'BCA',
    batch: '2021-2024',
    semester: '5',
    examTitle: 'DCBCS503 Theory End-term Examination',
    examType: 'regular',
    amount: 2450,
    breakdown: [
      { label: 'Exam fee', amount: 1500 },
      { label: 'Marks card fee', amount: 450 },
      { label: 'Processing fee', amount: 500 },
    ],
    bankDetails: {
      bankName: 'State Bank of India', accountNo: '123456789012', ifsc: 'SBIN0040093',
      branch: 'BCU Campus Branch, Bengaluru', accountName: 'BCU - Examination Fees',
    },
    collegeCode: 'COLLEGE', collegeName: 'Vriddhi College', university: 'BCU',
    status: 'generated',
    generatedAt: '2026-09-01T06:00:00.000Z',
    dueDate: '2026-09-30',
    createdAt: '2026-09-01T06:00:00.000Z',
  }),
};

// A second row, already declared paid from the phone: this is the state where
// the office owes the student an answer, so the list has to show what they
// filed instead of another "go to the bank" call to action.
const filedRow = {
  id: 'challan-2',
  data: () => ({
    ...challanRow.data(),
    challanNo: 'CH-202609-BCA-000124',
    examTitle: 'DCBCS504 Practical Examination',
    amount: 1200,
    status: 'paid_at_bank',
    bankReferenceNo: 'SBIN01/2026/UTR4471',
    studentRemarks: 'Paid at counter 4 on 22 Sep.',
    paidAt: '2026-09-22T05:30:00.000Z',
  }),
};

globalThis.__RC_FIRESTORE_DOCS = [challanRow, filedRow];
await section('student challans', '/src/modules/student/pages/StudentChallans.tsx', {}, async (t, view) => {
  check('challans: mounts without throwing', true);
  check('challans: shows the challan the college issued for this student',
    t.includes('CH-202609-BCA-000123') && t.includes('DCBCS503 Theory End-term Examination'), t);
  check('challans: shows the amount and the due date', t.includes('\u20B92,450') && /Due 30 Sep/.test(t), t);
  check('challans: labels the row with its bank-payment status', /To pay/.test(t), t);
  check('challans: warns that a payable challan must be stamped at the bank',
    /Print this challan and pay at State Bank of India/.test(t), t);
  check('challans: a filed challan tells the student what the office is waiting for',
    /Filed from your side/.test(t) && t.includes('SBIN01/2026/UTR4471') && /waiting for the office/.test(t), t);
  check('challans: a filed challan is not asked to go back to the bank',
    !/Print this challan and pay at State Bank of India/.test(t.split('DCBCS504')[1] ?? ''), t);

  const printButton = view.byText('View & print', 'button');
  check('challans: offers one primary action per challan', !!printButton, t);
  if (printButton) {
    await view.click(printButton);
    const sheet = view.text();
    check('challans: the challan sheet carries all three bank copies',
      /BANK COPY/.test(sheet) && /UNIVERSITY COPY/.test(sheet) && /STUDENT COPY/.test(sheet), sheet.slice(0, 200));
    check('challans: the sheet writes the amount in words for the bank teller',
      /Two Thousand Four Hundred Fifty Rupees Only/.test(sheet), sheet.slice(0, 200));
    check('challans: the sheet names the university account to credit',
      /SBIN0040093/.test(sheet) && /123456789012/.test(sheet), sheet.slice(0, 300));
  }
  check('challans: no toast spam on a plain render', challanToasts.length === 0, challanToasts.join('|'));

  // The declaration sheet: reference field + an optional note, and nothing that
  // looks like a file upload (the stamped copy stays physical).
  const paidButton = view.all('button').find((b) => b.textContent?.trim() === 'I paid');
  check('challans: an unpaid challan can be declared paid from the phone', !!paidButton, t);
  if (paidButton) {
    await view.click(paidButton);
    const sheet = view.text();
    const field = view.el('#bank-ref');
    check('declare: the sheet asks for the bank reference only',
      /Bank reference \/ UTR number/.test(sheet) && !!field, sheet.slice(0, 200));
    check('declare: the sheet never asks for a file',
      view.all('input[type=file]').length === 0 && !/choose file/i.test(sheet), sheet.slice(0, 120));
    check('declare: the sheet says filing is not verification',
      /not mark the fee paid/i.test(sheet), sheet.slice(0, 400));
    const submit = view.all('button').find((b) => /File declaration/.test(b.textContent ?? ''));
    check('declare: an empty reference keeps the submit disabled', !!submit?.disabled, sheet.slice(0, 200));
    check('declare: the note is optional', !!view.el('#bank-note') && !view.el('#bank-note')?.hasAttribute('required'), t);
  }
  const paidButtons = view.all('button').filter((b) => b.textContent?.trim() === 'I paid');
  check('challans: only a challan that still awaits payment can be declared',
    paidButtons.length === 1, `${paidButtons.length} declare buttons`);
});
globalThis.__RC_FIRESTORE_DOCS = [];

// Empty ledger (nothing issued yet) must read as "nothing issued", never as a
// silent blank panel.
await section('student challans (empty)', '/src/modules/student/pages/StudentChallans.tsx', {}, (t) => {
  check('challans (empty): explains why the list is empty', /No challans yet/.test(t) && /as soon as the college generates/.test(t), t);
});


// ── Placement Pack: cover letter / LinkedIn About / interview prep (item 4.2) ──
// The checks that matter: the generated text must land in an editable field
// (never silently in the resume), the AI allowance must be visible, and a
// server refusal must be shown as the server worded it.
globalThis.__RC_ROLE = 'student';
const PACK_PANEL = '/src/modules/student/components/resume/PlacementPackPanel.tsx';
globalThis.__RC_RESUME = { pack: {} };
await section('placement pack (cover letter)', PACK_PANEL, { jobDescription: '', defaultJobTitle: 'Article Assistant' }, async (t, view) => {
  check('placement pack: mounts without throwing', true);
  check('placement pack: warns that nothing is added to the resume automatically',
    /you decide what a recruiter reads/.test(t), t);
  check('placement pack: asks for the posting, which is what makes it specific',
    /Job description \(paste it/.test(t), t);
  check('placement pack: the three tools are offered',
    /Cover letter/.test(t) && /LinkedIn About/.test(t) && /Interview prep/.test(t), t);
  const button = view.all('button').find((b) => /Write my cover letter/.test(b.textContent || ''));
  await view.click(button);
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  const letterField = view.all('[data-testid="cover-letter-output"]')[0];
  check('placement pack: the letter lands in an editable field',
    !!letterField && /I reconciled ledgers and filed GST returns/.test(letterField.value || ''), String(letterField && letterField.value).slice(0, 200));
  // `t` is the text captured BEFORE the click, so post-click assertions read
  // the live DOM.
  const afterLetter = view.text();
  check('placement pack: the remaining AI allowance is shown',
    /4 AI suggestions left/.test(afterLetter), afterLetter);
  check('placement pack: tells the student they are responsible for the claims',
    /you are responsible for every claim/.test(afterLetter), afterLetter);
  const calls = (globalThis.__RC_RESUME_CALLS ?? []).filter((c) => c.fn === 'coverLetter');
  check('placement pack: the request carries the role and the posting',
    calls.length === 1 && calls[0].params.jobTitle === 'Article Assistant', JSON.stringify(calls));
});

globalThis.__RC_RESUME = { pack: {} };
await section('placement pack (LinkedIn About)', PACK_PANEL, {}, async (t, view) => {
  check('placement pack (about): mounts without throwing', true);
  const tab = view.all('button').find((b) => /LinkedIn About/.test(b.textContent || ''));
  await view.click(tab);
  const button = view.all('button').find((b) => /Write my About/.test(b.textContent || ''));
  await view.click(button);
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  const aboutField = view.all('[data-testid="linkedin-about-output"]')[0];
  check('placement pack (about): the About text is shown in an editable field',
    !!aboutField && /final-year B\.Com student/.test(aboutField.value || ''), String(aboutField && aboutField.value).slice(0, 160));
});

globalThis.__RC_RESUME = { pack: {} };
await section('placement pack (interview prep)', PACK_PANEL, { defaultJobTitle: 'Article Assistant' }, async (t, view) => {
  check('placement pack (interview): mounts without throwing', true);
  const tab = view.all('button').find((b) => /Interview prep/.test(b.textContent || ''));
  await view.click(tab);
  const button = view.all('button').find((b) => /Prepare my questions/.test(b.textContent || ''));
  await view.click(button);
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  const afterQuestions = view.text();
  check('placement pack (interview): questions render with what is being checked',
    /reconciled 120 purchase ledgers/.test(afterQuestions) && /They are checking/.test(afterQuestions), afterQuestions);
  check('placement pack (interview): an answer hint is given', /error rate you worked to/.test(afterQuestions), afterQuestions);
});

// A refused call (allowance exhausted / feature off) must show the server's own
// sentence — not a generic failure message.
globalThis.__RC_RESUME = { pack: { error: 'You have used all 6 AI suggestions for this year.' } };
await section('placement pack (refused)', PACK_PANEL, { defaultJobTitle: 'Article Assistant' }, async (t, view) => {
  check('placement pack (refused): mounts without throwing', true);
  const button = view.all('button').find((b) => /Write my cover letter/.test(b.textContent || ''));
  await view.click(button);
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  const afterRefusal = view.text();
  check('placement pack (refused): the server’s own message is shown',
    /You have used all 6 AI suggestions for this year/.test(afterRefusal), afterRefusal);
  check('placement pack (refused): no output is shown for a refused call',
    view.all('[data-testid="cover-letter-output"]').length === 0, t);
});

globalThis.__RC_RESUME = undefined;

// ── Install page: one shared implementation behind three routes (item 4.5) ──
// The three per-role copies were identical in layout and had already drifted in
// copy and padding. These checks pin the shared page plus the fact that each
// route still renders its own role's text — which is the whole point of the
// consolidation: one file, three correct pages.
const PWA_INSTALL = '/src/shared/pages/PWAInstallPage.tsx';
await section('pwa install (student)', PWA_INSTALL, { role: 'student' }, (t) => {
  check('pwa install (student): mounts without throwing', true);
  check('pwa install (student): heading and student subtitle',
    /Install Vriddhi App/.test(t) && /hall ticket, room allotment, fee last date, results alerts/.test(t), t);
  check('pwa install (student): the student highlight list, not the faculty one',
    /Why install over Uniclare/.test(t) && !/Offline attendance marking/.test(t), t);
  check('pwa install (student): no admin comparison matrix', !/Uniclare Had/.test(t), t);
  check('pwa install (student): the offline matrix is shared', /What Works Offline/.test(t) && /Faculty Offline/.test(t), t);
  check('pwa install (student): notification guidance is present for every role',
    /Turn on notifications/.test(t), t);
});

await section('pwa install (faculty)', PWA_INSTALL, { role: 'faculty' }, (t) => {
  check('pwa install (faculty): mounts without throwing', true);
  check('pwa install (faculty): heading and faculty subtitle',
    /Install Vriddhi App/.test(t) && /mark attendance offline, question bank, auto-grading/.test(t), t);
  check('pwa install (faculty): the faculty highlight list', /Faculty Benefits/.test(t) && /Question bank & paper generator/.test(t), t);
  check('pwa install (faculty): no admin comparison matrix', !/Uniclare Had/.test(t), t);
});

await section('pwa install (admin)', PWA_INSTALL, { role: 'admin' }, (t) => {
  check('pwa install (admin): mounts without throwing', true);
  check('pwa install (admin): keeps the Uniclare comparison it always showed',
    /Uniclare Had/.test(t) && /Vriddhi PWA Has \+ More/.test(t), t);
  check('pwa install (admin): keeps the admin offline column', /Admin Offline/.test(t) && /BCU compliance dashboard/.test(t), t);
});

// The three route wrappers must still render their own role.
for (const [label, file, expect] of [
  ['admin', '/src/modules/admin/pages/PWAInstallPage.tsx', /Uniclare Had/],
  ['faculty', '/src/modules/faculty/pages/PWAInstallPage.tsx', /Faculty Benefits/],
  ['student', '/src/modules/student/pages/PWAInstallPage.tsx', /Why install over Uniclare/],
]) {
  await section(`pwa install route (${label})`, file, {}, (t) => {
    check(`pwa install route (${label}): mounts without throwing`, true);
    check(`pwa install route (${label}): renders the ${label} copy`, expect.test(t), t);
  });
}

// ── Phone shell (installed PWA) ────────────────────────────────────────────
// The bottom bar and the "More" sheet are what replaced the desktop drawer on
// a phone, so they have to render on their own — and the two of them together
// have to cover every destination the sidebar used to list.
await section('student bottom nav', '/src/modules/student/components/StudentBottomNav.tsx', { onOpenMore: () => {}, unreadNotifications: 3 }, (t, view) => {
  const links = view.all('nav a');
  check('bottom nav: mounts without throwing', true);
  check('bottom nav: offers the four primary destinations', links.length === 4, `${links.length} links`);
  check('bottom nav: Dashboard, Academics, Assessments and Learning are the tabs',
    view.hrefs('nav a').join(' ') === '/student/dashboard /student/academics /student/assessments /student/learning',
    view.hrefs('nav a').join(' '));
  check('bottom nav: Fees and Notifications are no longer tabs',
    !view.hrefs('nav a').some((href) => href === '/student/fees' || href === '/student/notifications'),
    view.hrefs('nav a').join(' '));
  check('bottom nav: everything else is reachable through More', !!view.byText('More', 'button'), t);
});

await section('student more sheet', '/src/modules/student/components/StudentMoreSheet.tsx', { open: true, onClose: () => {}, onSignOut: () => {} }, (t, view) => {
  check('more sheet: mounts without throwing', true);
  check('more sheet: groups the destinations', /Academics/.test(t) && /Fees & exams/.test(t) && /Account/.test(t), t);
  // Label text is asserted through the routes: without a LanguageProvider the
  // translated entries fall back to their keys, but every tile must still point
  // at the page the sidebar used to list.
  const sheetHrefs = view.hrefs('a');
  check('more sheet: keeps the pages a phone has no tab for',
    ['/student/attendance', '/student/assignments', '/student/grades', '/student/timetable',
      '/student/challans', '/student/hall-tickets', '/student/materials', '/student/library']
      .every((path) => sheetHrefs.includes(path)),
    sheetHrefs.join(' '));
  check('more sheet: signs the student out from the same place', /Sign out|Sign Out|signOut/i.test(t), t);
  check('more sheet: Fees and Notifications now live inside More',
    sheetHrefs.includes('/student/fees') && sheetHrefs.includes('/student/notifications'), sheetHrefs.join(' '));
  check('more sheet: a section hub is not a tile inside the menu it heads',
    !sheetHrefs.includes('/student/academics') && !sheetHrefs.includes('/student/learning'), sheetHrefs.join(' '));
  check('more sheet: does not duplicate a bottom tab',
    !sheetHrefs.includes('/student/dashboard') && !sheetHrefs.includes('/student/assessments'), sheetHrefs.join(' '));
  check('more sheet: carries the reader text-size control', /Text size/.test(t) && /100%/.test(t), t);
});


// ── Exam clipboard lockdown ────────────────────────────────────────────────
// The mobile PWA regression this guards: a `paste` listener alone is not a
// clipboard block on a phone. Android keyboards commit their clipboard chip as
// an ordinary `insertText`, and drag-and-drop never fires `paste` at all — while
// Indic students still have to be able to type through an IME. So the rules
// below pin all four paths in one go.
const { applyExamLockdown } = await server.ssrLoadModule('/src/shared/utils/examLockdown.ts');
{
  const host = document.createElement('div');
  document.body.appendChild(host);
  const field = document.createElement('textarea');
  host.appendChild(field);

  const blocked = [];
  const dispose = applyExamLockdown({
    root: host,
    onBlock: (reason, details) => blocked.push({ reason, details }),
  });

  const fire = (type) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    field.dispatchEvent(event);
    return event;
  };
  const fireInput = (inputType, data) => {
    const event = new window.Event('beforeinput', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'inputType', { value: inputType });
    Object.defineProperty(event, 'data', { value: data });
    field.dispatchEvent(event);
    return event;
  };
  const fireKey = (key, modifiers = {}) => {
    const event = new window.Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'key', { value: key });
    for (const [name, value] of Object.entries(modifiers)) Object.defineProperty(event, name, { value });
    field.dispatchEvent(event);
    return event;
  };

  check('lockdown: a paste into the answer box is cancelled', fire('paste').defaultPrevented);
  check('lockdown: a keyboard clipboard-chip burst (long insertText) is cancelled',
    fireInput('insertText', 'The quick brown fox jumps over the lazy dog').defaultPrevented);
  check('lockdown: a dragged-in selection is cancelled', fire('drop').defaultPrevented);
  check('lockdown: the long-press menu is cancelled', fire('contextmenu').defaultPrevented);
  check('lockdown: Ctrl+V and Ctrl+Shift+V are cancelled',
    fireKey('v', { ctrlKey: true }).defaultPrevented && fireKey('v', { ctrlKey: true, shiftKey: true }).defaultPrevented);
  check('lockdown: copying the question out is cancelled', fire('copy').defaultPrevented);
  check('lockdown: typing one character still works',
    !fireInput('insertText', 'a').defaultPrevented && !fireInput('insertText', 'Th').defaultPrevented);
  check('lockdown: IME composition (Kannada transliteration) still works',
    !fireInput('insertCompositionText', 'ಶಿಕ್ಷಣ ಇಲಾಖ').defaultPrevented);
  check('lockdown: ordinary keys are untouched', !fireKey('Tab').defaultPrevented && !fireKey('a').defaultPrevented);
  check('lockdown: every block is reported to the exam page for logging',
    blocked.some((b) => b.reason === 'paste_attempt')
      && blocked.some((b) => b.reason === 'drop_attempt')
      && blocked.some((b) => b.reason === 'keyboard_shortcut')
      && blocked.some((b) => b.reason === 'bulk_input'),
    JSON.stringify(blocked.map((b) => b.reason)));

  dispose();
  check('lockdown: teardown hands the clipboard back to the student', !fire('paste').defaultPrevented);
  field.remove();
  host.remove();
}

// The answer field itself also refuses clipboard events, so a surface that
// renders QuestionRenderer outside the exam page is still covered.
await section('question renderer (clipboard locked)', '/src/modules/student/components/QuestionRenderer.tsx', {
  question: { id: 'q1', type: 'short_answer', text: 'Explain normalisation.', marks: 5, difficulty: 'medium', options: [] },
  answer: {},
  onAnswer: () => {},
  isFlagged: false,
  onToggleFlag: () => {},
  questionNumber: 1,
  lockClipboard: true,
}, (t, view) => {
  const field = view.el('textarea');
  check('question: the short-answer field renders', !!field, t);
  if (field) {
    const paste = new window.Event('paste', { bubbles: true, cancelable: true });
    field.dispatchEvent(paste);
    check('question: the answer field cancels a paste before React sees it', paste.defaultPrevented);
  }
});


// ── The declaration write (only student-side mutation in this flow) ────────
// firestore.rules admits exactly these keys from a student, so the
// payload shape is pinned here: a "small extra field" added in the app would
// otherwise pass every test and fail for every student on their phone.
{
  const { normaliseBankReference, validateChallanDeclaration, declareChallanPaidAtBank } =
    await server.ssrLoadModule('/src/modules/admin/api/feeApi.ts');
  check('declare: the reference is compacted and upper-cased',
    normaliseBankReference(' sbin 01/2026/utr4471 ') === 'SBIN01/2026/UTR4471',
    normaliseBankReference(' sbin 01/2026/utr4471 '));
  check('declare: punctuation a bank never prints is refused here, not by the rule',
    validateChallanDeclaration({ bankReferenceNo: 'SBIN #12' }) !== null);
  check('declare: a real slip is accepted',
    validateChallanDeclaration({ bankReferenceNo: 'SBIN01/2026/UTR4471', remarks: 'counter 4' }) === null,
    String(validateChallanDeclaration({ bankReferenceNo: 'SBIN01/2026/UTR4471' })));
  check('declare: an over-long note is refused instead of silently truncated',
    validateChallanDeclaration({ bankReferenceNo: 'SBIN012026', remarks: 'x'.repeat(501) }) !== null);

  globalThis.__RC_WRITES = [];
  await declareChallanPaidAtBank('challan-1', { bankReferenceNo: 'sbin01/2026/utr4471', remarks: '   ' }, 'clg-x');
  const write = globalThis.__RC_WRITES[0] ?? {};
  check('declare: writes the challan under the student’s own college',
    write.path === 'colleges/clg-x/challans/challan-1', String(write.path));
  const allowed = ['status', 'bankReferenceNo', 'studentRemarks', 'paidAt', 'updatedAt'];
  check('declare: touches only the keys the student update rule admits',
    Object.keys(write.data ?? {}).length > 0 && Object.keys(write.data ?? {}).every((k) => allowed.includes(k)),
    JSON.stringify(Object.keys(write.data ?? {})));
  check('declare: a blank note is left out of the document',
    !('studentRemarks' in (write.data ?? {})), JSON.stringify(write.data ?? {}));
  check('declare: the amount and the addressee are never in a student payload',
    !('amount' in (write.data ?? {})) && !('studentId' in (write.data ?? {})), JSON.stringify(write.data ?? {}));
  check('declare: the status written is the one the office then verifies',
    write.data?.status === 'paid_at_bank', String(write.data?.status));

  globalThis.__RC_WRITES = [];
  let refused = '';
  try {
    await declareChallanPaidAtBank('challan-1', { bankReferenceNo: 'AB12' }, 'clg-x');
  } catch (err) {
    refused = String(err?.message ?? err);
  }
  check('declare: a too-short reference never reaches Firestore',
    refused.length > 0 && globalThis.__RC_WRITES.length === 0, `${refused}|${globalThis.__RC_WRITES.length} writes`);
  globalThis.__RC_WRITES = [];
}


// ── Completed assessment result ────────────────────────────────────────────
// The reported bug: a paper whose descriptive answers a faculty member marked
// (status `manual_graded` + marks) rendered "Correct 0/8 · Incorrect 0/8 ·
// Unattempted 0/8" in the performance summary and "0/5 correct · 5/5 marks"
// under Section A, next to a correct 15/20 score. Marks are the source of
// truth, so the page must read 5 correct (5 marks) and 3 partially correct
// (10 of 15 marks), and the section table has to agree with the overview.
const gradedPaperFixture = {
  studentAssessmentId: 'sa-1',
  assessmentId: 'test-1',
  title: 'Unit Test 1 — Business Statistics',
  subject: 'Business Statistics',
  totalMarks: 20,
  marksObtained: 15,
  percentage: 75,
  grade: 'B',
  gradePoint: 7,
  timeSpent: 1800,
  totalQuestions: 8,
  answeredCount: 8,
  correctCount: 5,
  partialCount: 3,
  incorrectCount: 0,
  unattemptedCount: 0,
  pendingCount: 0,
  correctMarks: 5,
  awardedMarks: 15,
  sectionScores: [
    { sectionName: 'Section A — MCQ', total: 5, correct: 5, partial: 0, incorrect: 0, unattempted: 0, score: 5, totalMarks: 5, correctMarks: 5, percentage: 100, timeTaken: 0, accuracy: 100 },
    { sectionName: 'Section B — Short answers', total: 3, correct: 0, partial: 3, incorrect: 0, unattempted: 0, score: 10, totalMarks: 15, correctMarks: 0, percentage: 67, timeTaken: 0, accuracy: 0 },
  ],
  questionResults: [
    ...['a1', 'a2', 'a3', 'a4', 'a5'].map((id, index) => ({
      questionId: id,
      questionText: `MCQ ${index + 1}`,
      questionType: 'mcq',
      sectionName: 'Section A — MCQ',
      marks: 1,
      marksObtained: 1,
      status: 'manual_graded',
      options: ['Option A', 'Option B'],
      correctAnswer: 'Option A',
      studentAnswer: 'Option A',
      isCorrect: true,
      isAttempted: true,
    })),
    ...[
      { id: 'b1', awarded: 4 },
      { id: 'b2', awarded: 3 },
      { id: 'b3', awarded: 3 },
    ].map(({ id, awarded }) => ({
      questionId: id,
      questionText: `Explain with an example (${id})`,
      questionType: 'short_answer',
      sectionName: 'Section B — Short answers',
      marks: 5,
      marksObtained: awarded,
      status: 'manual_graded',
      studentAnswer: 'The index number measures relative change…',
      isCorrect: false,
      isAttempted: true,
    })),
  ],
  leaderboard: [],
  rank: 0,
  totalStudents: 0,
  facultyFeedback: 'Good work on the objective part.',
  submittedAt: '2026-09-20T10:00:00.000Z',
  gradedAt: '2026-09-21T10:00:00.000Z',
  passingPercentage: 40,
  percentile: 0,
  completedAt: '2026-09-20T10:00:00.000Z',
  flaggedCount: 0,
  pendingManualGrading: false,
  autoScore: 0,
  autoMax: 0,
  manualPending: false,
  reviewReleased: true,
};

globalThis.__RC_PARAMS = { testId: 'test-1' };
globalThis.__RC_FIRESTORE_DOC = { data: { collegeId: 'college-a', studentDocId: 'student-1', name: 'Bala Kumar' } };
globalThis.__RC_CALLABLE_DATA = { getMyStudentTestResult: gradedPaperFixture };

await section('assessment result', '/src/modules/student/pages/TestResultPage.tsx', {}, async (t, view) => {
  check('result: mounts without throwing', true);
  check('result: keeps the score card percentage and marks',
    t.includes('75%') && t.includes('15/20'), t);
  check('result: performance summary counts the five full-mark answers',
    t.includes('Correct') && t.includes('5/8'), t);
  check('result: the three short answers read as partially correct, not zero',
    /Partially correct/.test(t) && t.includes('3/8'), t);
  check('result: unattempted is zero, not a copy of the question count',
    /Unattempted0\/8/.test(t.replace(/\s+/g, '')) || /Unattempted0\/8/.test(t.replace(/\s+/g, ' ')), t);
  check('result: shows the marks carried by the correct answers',
    t.includes('5 marks'), t);
  check('result: section A reads 5/5 correct with 5/5 marks',
    /Section A — MCQ/.test(t) && t.includes('5/5'), t);
  check('result: section B shows its 10/15 marks next to the partial count',
    t.includes('10/15'), t);
  check('result: Section Analysis tab is offered', !!view.byText('Section Analysis', 'button'), t);
  check('result: offers the reader text-size control', /Text size/.test(t) && /100%/.test(t), t);

  const analysisTab = view.byText('Section Analysis', 'button');
  if (analysisTab) {
    await view.click(analysisTab);
    const analysis = view.text();
    check('section analysis: every section is listed with its rows',
      /Section A — MCQ/.test(analysis) && /Section B — Short answers/.test(analysis), analysis);
    check('section analysis: carries the partial column the summary relies on',
      /Partial/.test(analysis) && /Unattempted/.test(analysis), analysis);
    check('section analysis: totals row adds up to the paper (5 correct, 3 partial, 0 incorrect)',
      /Total/.test(analysis) && analysis.includes('5') && analysis.includes('3'), analysis);
    check('section analysis: explains how partial marks are counted',
      /partially correct answers earned some, not all, of their marks/i.test(analysis), analysis);
  }
});

// A paper whose marks were never recorded must not be shown as zeros: the
// answer sheet is still with the faculty, and the page says so.
globalThis.__RC_CALLABLE_DATA = {
  getMyStudentTestResult: {
    ...gradedPaperFixture,
    pendingManualGrading: true,
    gradedAt: undefined,
  },
};
await section('assessment result (awaiting grading)', '/src/modules/student/pages/TestResultPage.tsx', {}, (t) => {
  check('result (awaiting): mounts without throwing', true);
  check('result (awaiting): explains that descriptive answers are still with the faculty',
    /awaiting grading/i.test(t), t);
});

globalThis.__RC_CALLABLE_DATA = {};
globalThis.__RC_FIRESTORE_DOC = undefined;
globalThis.__RC_PARAMS = undefined;

// ── Section hubs (the phone's Academics / Learning tabs) ───────────────────
await section('academics hub', '/src/modules/student/pages/StudentHubPage.tsx', { group: 'academics' }, (t, view) => {
  const hrefs = view.hrefs('a');
  check('academics hub: mounts without throwing', true);
  check('academics hub: lists the academic pages as tiles',
    ['/student/attendance', '/student/assignments', '/student/grades', '/student/timetable', '/student/curriculum']
      .every((path) => hrefs.includes(path)), hrefs.join(' '));
  check('academics hub: does not re-list the tabs that already exist',
    !hrefs.includes('/student/dashboard') && !hrefs.includes('/student/assessments') && !hrefs.includes('/student/academics'),
    hrefs.join(' '));
  check('academics hub: explains what each page is for', /attendance percentage/i.test(t), t);
});

await section('learning hub', '/src/modules/student/pages/StudentHubPage.tsx', { group: 'practice' }, (t, view) => {
  const hrefs = view.hrefs('a');
  check('learning hub: mounts without throwing', true);
  check('learning hub: lists the study pages as tiles',
    ['/student/materials', '/student/library', '/student/journey', '/student/faculty-connect']
      .every((path) => hrefs.includes(path)), hrefs.join(' '));
  check('learning hub: signs nothing extra into the hub', !hrefs.includes('/student/learning'), hrefs.join(' '));
});

// ── Phone app bar (sign out at the top) ────────────────────────────────────
let signedOut = 0;
await section('student top bar', '/src/modules/student/components/StudentTopBar.tsx',
  { unreadNotifications: 4, onSignOut: () => { signedOut += 1; } }, async (t, view) => {
    check('top bar: mounts without throwing', true);
    check('top bar: shows the unread notification count', !/^$/.test(t) && /4/.test(t), t);
    const logout = view.all('button').find((b) => /sign out|signout/i.test(b.getAttribute('aria-label') ?? ''));
    check('top bar: offers sign out in the top bar', !!logout, t);
    if (logout) {
      await view.click(logout);
      const dialog = view.text();
      check('top bar: asks for confirmation before signing out',
        /Sign out of Vriddhi\?/.test(dialog), dialog);
      const confirm = view.all('button').find((b) => (b.textContent ?? '').trim() === 'Sign out');
      check('top bar: the confirmation is a real second step', !!confirm, dialog);
      if (confirm) {
        await view.click(confirm);
        check('top bar: confirming signs the student out exactly once', signedOut === 1, String(signedOut));
      }
    }
  });

// ── Scheduling a class in a college that has no subject list ────────────────
// What the principal reported: with no subject mapped to the faculty member
// the Subject box was a dropdown with nothing in it and the Create button
// refused to open, so a class could not be scheduled at all. The fixture is
// exactly that college — one faculty member and no subjectsUG / subjectsPG —
// so the dropdown is genuinely empty and only free text can get the class in.
const scheduleFixtureDocs = [
  { id: 'fac-1', data: () => ({ collegeId: 'college-a', name: 'Dr Rao', department: 'Commerce' }) },
];
const scheduleFixtureDoc = { data: { collegeId: 'college-a', name: 'Dr Rao' } };

localStorage.setItem('vriddhi_college_id', 'college-a');
globalThis.__RC_FIRESTORE_DOCS = scheduleFixtureDocs;
globalThis.__RC_FIRESTORE_DOC = scheduleFixtureDoc;
globalThis.__RC_LOCATION_STATE = null;

await section('schedule dialog', '/src/modules/admin/pages/AdminClassSchedule.tsx', {}, async (t, view) => {
  check('schedule dialog: mounts without throwing', true);
  const addClass = view.byText('Add Class');
  check('schedule dialog: the page offers Add Class', !!addClass, t.slice(0, 200));
  if (!addClass) return;
  await view.click(addClass);

  const dialog = view.dialogText();
  check('schedule dialog: opens on click', /Add New Class Schedule/.test(dialog), dialog);

  const subject = view.dialogEl('input[placeholder="Type to search, or type a new subject"]');
  check('schedule dialog: the subject can be typed, not only picked from a list',
    !!subject && !subject.disabled && !subject.readOnly,
    subject ? `disabled=${subject.disabled} readOnly=${subject.readOnly}` : 'no subject input in the dialog');

  const create = view.dialogButtons().find((b) => (b.textContent ?? '').trim() === 'Create');
  check('schedule dialog: Create is not dead while the subject list is empty', !!create && !create.disabled,
    `create=${!!create} disabled=${create?.disabled}`);

  // Submitting with nothing filled in must name what is missing — the old
  // button simply refused to be pressed.
  if (create) {
    await view.click(create);
    const told = view.bodyText();
    check('schedule dialog: names the missing fields instead of refusing to submit',
      /Please fill:/.test(told) && /Subject/.test(told), told.slice(-260));
  }

  // …and the same button lets the class through once a subject is typed.
  if (subject && create) {
    await view.type(subject, 'Business Statistics');
    check('schedule dialog: a typed subject stays in the box', subject.value === 'Business Statistics', subject.value);
    await view.click(create);
    const told = view.bodyText();
    check('schedule dialog: the typed subject clears the Subject complaint',
      /Please fill:/.test(told) && !/Please fill: Subject/.test(told), told.slice(-260));
  }
});

// The curriculum page hands the dialog a prefill; this is the "Schedule Class"
// route a principal takes, and it has to end in a written class.
globalThis.__RC_LOCATION_STATE = {
  prefill: {
    subject: 'Business Statistics',
    subjectCode: 'BST101',
    facultyId: 'fac-1',
    branch: 'BCA',
    batch: '2026',
    semester: 4,
    division: 'A',
    section: 'A',
  },
};

await section('schedule dialog (prefilled)', '/src/modules/admin/pages/AdminClassSchedule.tsx', {}, async (t, view) => {
  check('prefilled schedule: mounts without throwing', true);
  const dialog = view.dialogText();
  check('prefilled schedule: opens from the curriculum prefill', /Add New Class Schedule/.test(dialog), dialog);
  check('prefilled schedule: says to type the subject when none is mapped',
    /No subject is mapped to this faculty yet/.test(dialog), dialog);

  const subject = view.dialogEl('input[placeholder="Type to search, or type a new subject"]');
  check('prefilled schedule: keeps the prefill as free text', subject?.value === 'Business Statistics', subject?.value);

  const room = view.dialogEl('input[placeholder="e.g. 301-A"]');
  check('prefilled schedule: still asks for the room', !!room, dialog.slice(0, 160));
  if (!room) return;
  await view.type(room, '301-A');

  const create = view.dialogButtons().find((b) => (b.textContent ?? '').trim() === 'Create');
  if (!create) {
    check('prefilled schedule: Create is offered', false, dialog);
    return;
  }
  globalThis.__RC_WRITES = [];
  await view.click(create);
  const write = (globalThis.__RC_WRITES ?? []).find((w) => w.path === 'addDoc');
  check('prefilled schedule: the class is written to the schedule collection', !!write,
    JSON.stringify(globalThis.__RC_WRITES ?? []).slice(0, 240));
  check('prefilled schedule: the write carries the typed subject, room and cohort',
    write?.data?.subject === 'Business Statistics' && write?.data?.room === '301-A'
      && write?.data?.branch === 'BCA' && write?.data?.semester === 4,
    JSON.stringify(write?.data ?? {}).slice(0, 300));
  check('prefilled schedule: tells the principal it worked',
    /Schedule created successfully/.test(view.bodyText()), view.bodyText().slice(-220));
});

// ── Curriculum → timetable flow: one screen, semesters 1–6 ──────────────────
// The page this replaced spread the job over three tabs and two other pages,
// and nothing on it said what was still missing. The fixture is a college with
// semester 2 half-done: one subject, assigned, on the timetable — so the ladder
// has exactly one semester with work in it, and every cross-collection join
// (curriculum ↔ mapping ↔ slot) has to actually resolve for the row to render
// as ready.
//
// The firestore stub hands the same seeded list to every query, so each fixture
// document also has to be harmless in the other mappers' eyes: the mapping, the
// slot and the faculty row all carry `courses: []`, and only the curriculum
// document carries a course.
const flowDocs = [
  {
    id: 'cur-1', data: () => ({
      collegeId: 'college-a', collegeName: 'Test College', branch: 'BCA', semester: 2, scheme: 'NEP',
      status: 'active', title: 'BCA 2026', syllabusExtractId: 'x', createdBy: 'u', assignedBy: 'u',
      createdAt: '2026-09-01T00:00:00.000Z', assignedAt: '2026-09-01T00:00:00.000Z',
      totalCourses: 1, totalModules: 0, totalHours: 0, totalMarks: 0,
      courses: [{
        id: 'c-1', code: 'BC201', name: 'Cost Accounting', credits: 4, totalHours: 60, totalMarks: 100,
        semester: 2, branch: 'BCA', modules: [], confidence: 'high',
      }],
    }),
  },
  {
    id: 'map-1', data: () => ({
      collegeId: 'college-a', curriculumId: 'cur-1', courseId: 'c-1', courseCode: 'BC201',
      courseName: 'Cost Accounting', facultyId: 'uid-fac-1', facultyName: 'Ravi Kumar', branch: 'BCA',
      semester: 2, batch: '2026', status: 'active', courses: [],
    }),
  },
  {
    id: 'slot-1', data: () => ({
      collegeId: 'college-a', subject: 'Cost Accounting', subjectCode: 'BC201', facultyId: 'fac-1',
      facultyName: 'Ravi Kumar', branch: 'BCA', semester: 2, batch: '2026', division: '', section: '',
      room: 'R12', dayOfWeek: 'monday', startTime: '09:00', endTime: '10:00', type: 'lecture',
      isActive: true, courses: [],
    }),
  },
  {
    id: 'fac-1', data: () => ({
      collegeId: 'college-a', uid: 'uid-fac-1', name: 'Ravi Kumar', firstName: 'Ravi',
      lastName: 'Kumar', status: 'active', department: 'Commerce', courses: [],
    }),
  },
];

const flowDocsWithoutSessions = [...flowDocs];

// One dated class for the slot, on a weekday other than the slot's Monday, so
// the reschedule dialog has a real move to preview. Seed dates are computed
// from today: a hardcoded one would silently fall into the past and the dialog
// would (correctly) report nothing to move.
{
  const future = new Date();
  future.setDate(future.getDate() + 10);
  while (future.getUTCDay() === 1) future.setDate(future.getDate() + 1);
  const dateKey = future.toISOString().slice(0, 10);
  flowDocs.push({
    id: 'slot-1_2026-10-05', data: () => ({
      collegeId: 'college-a', weeklyScheduleId: 'slot-1', subject: 'Cost Accounting', subjectCode: '',
      facultyId: 'fac-1', facultyName: 'Ravi Kumar', branch: '', semester: 2, batch: '2026',
      date: dateKey, startTime: '09:00', endTime: '10:00', timeSlot: '09:00-10:00', status: 'scheduled',
      attendanceMarked: false, courses: [],
    }),
  });
}

globalThis.__RC_ROLE = 'principal';
globalThis.__RC_FIRESTORE_DOCS = flowDocs;
globalThis.__RC_FIRESTORE_DOC = null;
globalThis.__RC_LOCATION_STATE = null;
localStorage.setItem('vriddhi_college_id', 'college-a');

await section('curriculum flow', '/src/modules/admin/pages/AdminCurriculum.tsx', {}, async (t, view) => {
  check('curriculum flow: mounts without throwing', true);
  check('curriculum flow: walks semesters 1 to 6', [1, 2, 3, 4, 5, 6]
    .every((n) => t.includes(`Semester ${n}`)), t.slice(0, 320));
  check('curriculum flow: lands on the first semester that has work in it, not on an empty one',
    view.openText().includes('Cost Accounting'), view.openText().slice(0, 320));
  check('curriculum flow: joins the curriculum course to its faculty assignment',
    t.includes('Ravi Kumar'), t.slice(0, 400));
  check('curriculum flow: joins the course to its timetable slot',
    /Mon 09:00–10:00 · R12/.test(t), t.slice(0, 400));
  check('curriculum flow: reports the programme-level progress',
    /1 of 1 subjects on the timetable/.test(t) && t.includes('100%'), t.slice(0, 320));
  check('curriculum flow: a semester with no curriculum says so instead of showing blank tiles',
    t.includes('No curriculum'), t.slice(0, 320));

  const schedule = view.byText('Add slot') ?? view.byText('Schedule');
  check('curriculum flow: the row offers the schedule action', !!schedule, t.slice(0, 240));
  if (schedule) {
    await view.click(schedule);
    const dialog = view.dialogText();
    // The subject lives in an <input>, so it is checked off the element rather
    // than out of textContent.
    const dialogInputs = [...(document.querySelector('.MuiDialog-root')?.querySelectorAll('input') ?? [])];
    check('curriculum flow: scheduling happens on this page, prefilled from the row',
      /Schedule this class/.test(dialog) && dialogInputs.some((i) => i.value === 'Cost Accounting'),
      `${dialog.slice(0, 200)} | inputs=${dialogInputs.map((i) => i.value).join(',')}`);
    check('curriculum flow: the dated classes are materialised by default',
      /dated classes for the next four weeks/.test(dialog), dialog.slice(0, 300));
  }

  // Close the schedule dialog first: MUI keeps it mounted, and a second modal
  // would make `view.dialogText()` read the wrong one.
  const cancel = view.dialogButtons().find((b) => (b.textContent ?? '').trim() === 'Cancel');
  if (cancel) await view.click(cancel);

  const reschedule = view.all('button').find((b) => /reschedul/i.test(b.getAttribute('aria-label') ?? ''));
  check('curriculum flow: a scheduled slot can be rescheduled from the row', !!reschedule, t.slice(0, 240));
  if (reschedule) {
    // Re-open from the row: the dialog must offer both scopes, and it must say
    // what it knows about the classes this slot has already produced.
    await view.click(reschedule);
    // A closed MUI dialog lingers in the DOM for its exit transition, so read
    // the last root — the one that was just opened.
    const roots = [...document.querySelectorAll('.MuiDialog-root')];
    const moveDialog = (roots[roots.length - 1]?.textContent ?? '').replace(/\s+/g, ' ').trim();
    check('curriculum flow: the reschedule dialog actually opens',
      /Reschedule/.test(moveDialog), `${roots.length} dialog(s): ${moveDialog.slice(0, 160)}`);
    check('curriculum flow: the reschedule dialog offers a permanent and a one-off move',
      /From this day on/.test(moveDialog) && /Just one class/.test(moveDialog), moveDialog.slice(0, 320));
    check('curriculum flow: it previews the classes the move will touch before anything is written',
      /1 class will move/.test(moveDialog), moveDialog.slice(0, 420));
    check('curriculum flow: the preview names the dates the class moves between',
      /→.*moves/.test(moveDialog), moveDialog.slice(0, 420));
    check('curriculum flow: it promises delivered classes are never changed',
      /already delivered, marked or covered are never changed/.test(moveDialog), moveDialog.slice(0, 360));
  }
});

// The same screen before any dated class exists: the dialog must say so rather
// than offering a move of nothing.
globalThis.__RC_FIRESTORE_DOCS = flowDocsWithoutSessions;
await section('curriculum flow (nothing materialised yet)', '/src/modules/admin/pages/AdminCurriculum.tsx', {}, async (t, view) => {
  check('curriculum flow (empty): mounts without throwing', true);
  const reschedule = view.all('button').find((b) => /reschedul/i.test(b.getAttribute('aria-label') ?? ''));
  if (!reschedule) {
    check('curriculum flow (empty): the slot can still be rescheduled', false, t.slice(0, 200));
    return;
  }
  await view.click(reschedule);
  const roots = [...document.querySelectorAll('.MuiDialog-root')];
  const moveDialog = (roots[roots.length - 1]?.textContent ?? '').replace(/\s+/g, ' ').trim();
  check('curriculum flow (empty): it reports that no dated class exists yet instead of inventing one',
    /No dated class exists for this slot yet/.test(moveDialog), moveDialog.slice(0, 320));
});

globalThis.__RC_FIRESTORE_DOCS = [];
globalThis.__RC_FIRESTORE_DOC = null;

// ── Superadmin question-bank seeder ──────────────────────────────────────────
// The universal pool page is read-only, so this dialog is the only way the
// curated CSV seed (data/question-bank) reaches it. Three things have to hold:
// the bundled CSV parses in the browser bundle, the run is idempotent (rows
// already in the pool are skipped, not duplicated), and the writes land with the
// platform-owned shape the visibility gate expects.
globalThis.__RC_ROLE = 'superadmin';
globalThis.__RC_FIRESTORE_DOCS = [];

const SEED_DIALOG = '/src/modules/superadmin/components/SeedQuestionBankDialog.tsx';

// Loaded through Vite, so the `?raw` CSV imports resolve exactly as they do in
// the app: the assertions below compare the UI against the shipped data module
// instead of a hardcoded 240 that would silently go stale.
const seedData = await server.ssrLoadModule('/src/modules/superadmin/data/questionBankSeed.ts');
const seedAll = seedData.resolveSeedRows('all', []);
const SEED_TOTAL = seedAll.rows.length;
const SEED_INVALID = seedAll.invalid.length;
const SEED_WRITES = SEED_TOTAL * 3;          // meta + content + review per question
const SEED_MCQ = seedAll.types.find((t) => t.name === 'mcq')?.count ?? 0;
const SEED_SUBJECTS = seedAll.subjects.length;
const SEED_SUBTOPICS = seedAll.subTopicCount;

check('seeder: the shipped CSVs still parse clean', SEED_INVALID === 0,
  `${SEED_INVALID} invalid row(s): ${JSON.stringify(seedAll.invalid.slice(0, 2))}`);
check('seeder: the bundled dataset is the full three-programme bank', SEED_TOTAL === 759,
  `parsed ${SEED_TOTAL} rows`);
check('seeder: every row carries a sub-topic (subject → topic → sub-topic)',
  SEED_SUBTOPICS === 144 && seedAll.rowsWithoutSubTopic === 0,
  `${SEED_SUBTOPICS} sub-topics, ${seedAll.rowsWithoutSubTopic} row(s) without one`);

await section('question bank seeder', SEED_DIALOG, { open: true, onClose: () => {} }, async (t, view) => {
  check('seeder: mounts without throwing', true);
  const dialog = view.dialogText();
  check('seeder: opens on the dataset step', /Seed Platform Question Bank/.test(dialog), dialog.slice(0, 200));
  check('seeder: parses the bundled CSV and reports every valid question',
    dialog.includes(`${SEED_TOTAL} valid questions`), dialog.slice(0, 400));
  check('seeder: breaks the dataset down by programme, subject and type',
    dialog.includes(`${SEED_SUBJECTS} subjects`) && dialog.includes(`mcq: ${SEED_MCQ}`), dialog.slice(0, 500));
  check('seeder: reports how deep the hierarchy goes',
    dialog.includes(`${SEED_SUBTOPICS} sub-topics`) && dialog.includes(`${seedAll.topicCount} topics`),
    dialog.slice(0, 500));
  check('seeder: previews the sub-topic column for the rows it will write',
    /Accounting Equation and Dual Aspect/.test(dialog), dialog.slice(0, 900));
  check('seeder: warns that the full bank exceeds the free-tier write quota',
    /over the 500-writes-per-day limit/.test(dialog) && /one programme at a time/.test(dialog),
    dialog.slice(-700));
  check('seeder: quotes the write cost before anything is committed',
    dialog.includes(`~${SEED_WRITES} Firestore writes`), dialog.slice(-400));

  const preview = view.dialogButtons().find((b) => /Preview & Validate/.test(b.textContent ?? ''));
  if (!preview) {
    check('seeder: offers Preview & Validate', false, dialog.slice(0, 200));
    return;
  }
  await view.click(preview);
  const planned = view.dialogText();
  check('seeder: an empty pool means every question is new',
    /currently holds 0 question/.test(planned) && planned.includes(`${SEED_TOTAL} new question`), planned.slice(0, 320));
  check('seeder: the seed button names the exact row count',
    view.dialogButtons().some((b) => (b.textContent ?? '').includes(`Seed ${SEED_TOTAL} question`)),
    view.dialogButtons().map((b) => b.textContent).join(' | '));

  const seed = view.dialogButtons().find((b) => (b.textContent ?? '').includes(`Seed ${SEED_TOTAL} question`));
  if (!seed) return;
  await view.click(seed);
  const done = view.dialogText();
  check('seeder: reports the seeded total', done.includes(`Seeded ${SEED_TOTAL} questions into the platform pool`), done.slice(0, 320));
  check('seeder: reports no failures', /Failed: 0/.test(done), done.slice(0, 320));
  check('seeder: tells the superadmin the list below reloaded',
    /reloads automatically/.test(done) && /seed-import/.test(done), done.slice(-320));
});

// Second run against a pool that already holds one of the seed questions: it must
// be skipped, not written again.
globalThis.__RC_FIRESTORE_DOCS = [{
  id: 'existing-seed-1',
  data: () => ({
    previewText: 'The accounting equation is stated as:',
    questionText: 'The accounting equation is stated as:',
    subjectId: 'Financial Accounting',
    topicId: 'Journal and Accounting Equation',
    tags: ['financial', 'B.Com', 'batch-2026-27', 'vriddhi-curated', 'free', 'seed-import'],
    status: 'approved',
    visibility: 'public',
    source: 'platform',
  }),
}];

await section('seeder (idempotent)', SEED_DIALOG, { open: true, onClose: () => {} }, async (t, view) => {
  check('seeder re-run: mounts without throwing', true);
  const preview = view.dialogButtons().find((b) => /Preview & Validate/.test(b.textContent ?? ''));
  if (!preview) {
    check('seeder re-run: offers Preview & Validate', false, view.dialogText().slice(0, 200));
    return;
  }
  await view.click(preview);
  const planned = view.dialogText();
  check('seeder re-run: sees the question already in the pool', /currently holds 1 question/.test(planned), planned.slice(0, 320));
  check('seeder re-run: skips the duplicate instead of writing it again',
    /1 skipped as already present/.test(planned) && planned.includes(`${SEED_TOTAL - 1} new question`), planned.slice(0, 400));
  check('seeder re-run: lists what it is skipping',
    /Already in the pool/.test(planned) && /accounting equation is stated as/.test(planned), planned.slice(0, 600));
  check('seeder re-run: the seed button only offers the new rows',
    view.dialogButtons().some((b) => (b.textContent ?? '').includes(`Seed ${SEED_TOTAL - 1} question`)),
    view.dialogButtons().map((b) => b.textContent).join(' | '));
});

// Inspect one written document: it has to be platform-owned public content keyed
// A–D, or the visibility gate hides it from every college.
globalThis.__RC_FIRESTORE_DOCS = [];
globalThis.__RC_WRITES = [];
await section('seeder (written shape)', SEED_DIALOG, { open: true, onClose: () => {} }, async (t, view) => {
  const preview = view.dialogButtons().find((b) => /Preview & Validate/.test(b.textContent ?? ''));
  if (!preview) {
    check('seeder writes: offers Preview & Validate', false, view.dialogText().slice(0, 200));
    return;
  }
  await view.click(preview);
  const seed = view.dialogButtons().find((b) => (b.textContent ?? '').includes(`Seed ${SEED_TOTAL} question`));
  if (!seed) {
    check('seeder writes: offers the seed action', false, view.dialogText().slice(0, 300));
    return;
  }
  await view.click(seed);
  check('seeder writes: reports success', view.dialogText().includes(`Seeded ${SEED_TOTAL} questions`), view.dialogText().slice(0, 240));

  // Inspect what actually got committed. A seeded row has to be platform-owned
  // public content with A–D option ids, or the visibility gate hides it from
  // every college and the test engine cannot grade it.
  const writes = globalThis.__RC_WRITES ?? [];
  const metaWrites = writes.filter((w) => w.collectionPath === 'questionBank_meta');
  const contentWrites = writes.filter((w) => w.collectionPath === 'questionBank_content');
  const reviewWrites = writes.filter((w) => w.collectionPath === 'questionReviews');
  check('seeder writes: three documents per question (meta + content + review)',
    metaWrites.length === SEED_TOTAL && contentWrites.length === SEED_TOTAL && reviewWrites.length === SEED_TOTAL,
    `meta=${metaWrites.length} content=${contentWrites.length} review=${reviewWrites.length}`);

  const meta = metaWrites[0]?.data ?? {};
  check('seeder writes: lands approved, public and platform-owned',
    meta.status === 'approved' && meta.visibility === 'public' && meta.source === 'platform',
    JSON.stringify({ status: meta.status, visibility: meta.visibility, source: meta.source }));
  check('seeder writes: createdBy is the superadmin with no college (so it is not college-private)',
    meta.createdBy?.role === 'superadmin' && meta.createdBy?.collegeId === null && !!meta.createdBy?.userId,
    JSON.stringify(meta.createdBy ?? {}));
  check('seeder writes: maps CSV subject → subjectId and unit → topicId',
    meta.subjectId === 'Financial Accounting' && meta.topicId === 'Journal and Accounting Equation',
    JSON.stringify({ subjectId: meta.subjectId, topicId: meta.topicId }));
  check('seeder writes: carries the search + preview fields the list view reads',
    Array.isArray(meta.searchKeywords) && meta.searchKeywords.length > 0 && /accounting equation/.test(meta.previewText ?? ''),
    JSON.stringify({ previewText: meta.previewText, keywords: (meta.searchKeywords ?? []).slice(0, 4) }));
  check('seeder writes: tags the programme, batch and platform ownership',
    ['B.Com', 'batch-2026-27', 'vriddhi-curated', 'free', 'seed-import'].every((tag) => (meta.tags ?? []).includes(tag)),
    JSON.stringify(meta.tags ?? []));

  const content = contentWrites[0]?.data ?? {};
  check('seeder writes: content holds the full question text',
    /The accounting equation is stated as:/.test(content.questionText ?? ''), JSON.stringify(content.questionText ?? ''));
  check('seeder writes: MCQ options are keyed A–D with exactly one correct',
    (content.options ?? []).map((o) => o.id).join(',') === 'A,B,C,D'
      && (content.options ?? []).filter((o) => o.isCorrect).length === 1,
    JSON.stringify(content.options ?? []));
  check('seeder writes: correctAnswer is the letter of the flagged option',
    content.correctAnswer === (content.options ?? []).find((o) => o.isCorrect)?.id,
    JSON.stringify({ correctAnswer: content.correctAnswer, options: content.options ?? [] }));
  check('seeder writes: explains the answer and keeps the marks',
    /Assets equal/.test(content.explanation ?? '') && content.marks === 1,
    JSON.stringify({ explanation: content.explanation, marks: content.marks }));
  check('seeder writes: maps CSV subtopic → subTopicId on both documents',
    meta.subTopicId === 'Accounting Equation and Dual Aspect'
      && content.subTopicId === 'Accounting Equation and Dual Aspect',
    JSON.stringify({ meta: meta.subTopicId, content: content.subTopicId }));
  check('seeder writes: every written row has a sub-topic, not just the first',
    metaWrites.every((w) => typeof w.data?.subTopicId === 'string' && w.data.subTopicId.trim().length > 0)
      && contentWrites.every((w) => typeof w.data?.subTopicId === 'string' && w.data.subTopicId.trim().length > 0),
    `meta blank: ${metaWrites.filter((w) => !w.data?.subTopicId).length}, content blank: ${contentWrites.filter((w) => !w.data?.subTopicId).length}`);
});

// A non-superadmin must be told the writes will be refused rather than being let
// halfway through the flow.
globalThis.__RC_ROLE = 'admin';
await section('seeder (wrong role)', SEED_DIALOG, { open: true, onClose: () => {} }, async (t, view) => {
  check('seeder as admin: mounts without throwing', true);
  check('seeder as admin: warns that Firestore rules will reject the writes',
    /You are signed in as/.test(view.dialogText()) && /superadmin action/.test(view.dialogText()),
    view.dialogText().slice(0, 300));
});

globalThis.__RC_ROLE = undefined;

// ── Superadmin Access Control: the College box accepts the college code ──────
// The reported bug: granting a role while typing the college's *code* (the
// identifier the operator chose on Create College and sees on the Colleges
// page) was refused as "college does not exist", because the box only
// accepted the Firestore document id — a string that appears nowhere in the
// product but the URL. The box now resolves code / name / id against the
// loaded colleges and sends the id; functions/src/collegeResolve.ts applies
// the same rules server-side for anything typed that is not in the list.
const ACCESS_CONTROL = '/src/modules/superadmin/pages/AccessControl.tsx';
const DEMO_COLLEGE_ID = 'k3Jd9sLp2QwErTyUiOp1';
globalThis.__RC_FIRESTORE_DOCS = [
  { id: DEMO_COLLEGE_ID, data: () => ({ name: 'Vriddhi Demo College', code: 'VDC-001', status: 'active' }) },
  { id: 'aZ8bN2mQ7xC4vB1nM6kL', data: () => ({ name: 'Seshadripuram College', code: 'SPM', status: 'active' }) },
];
globalThis.__RC_CALLABLE_DATA = {
  grantUserRole: {
    success: true, authVerified: true, uid: 'uid-admin-1', email: 'admin@vdc.edu', role: 'admin',
    collegeId: DEMO_COLLEGE_ID, collegeName: 'Vriddhi Demo College', collegeCode: 'VDC-001', created: false,
  },
};
globalThis.__RC_CALLABLE_PAYLOADS = [];
await section('access control (college code)', ACCESS_CONTROL, {}, async (t, view) => {
  check('access control: mounts without throwing', true);
  const collegeBox = view.el('input[role="combobox"]');
  check('access control: the College box is a searchable picker', !!collegeBox, t.slice(0, 300));
  if (!collegeBox) return;

  await view.type(collegeBox, 'vdc-001');
  check('access control: a typed college code (any case) resolves to the college and shows its id',
    new RegExp(`Vriddhi Demo College \\(VDC-001\\) · id ${DEMO_COLLEGE_ID}`).test(view.text()), view.text().slice(0, 600));

  await view.type(view.el('input[type="email"]'), 'admin@vdc.edu');
  await view.click('button[type="submit"]');
  const sent = (globalThis.__RC_CALLABLE_PAYLOADS ?? []).find((p) => p.name === 'grantUserRole')?.payload;
  check('access control: the grant is sent with the resolved document id, not the code',
    sent?.collegeId === DEMO_COLLEGE_ID && sent?.email === 'admin@vdc.edu', JSON.stringify(sent));
  check('access control: the success message names the college the grant landed on',
    /College: Vriddhi Demo College \(VDC-001\)/.test(view.text()), view.text().slice(0, 600));

  // Something not in the loaded list is passed through (the server resolves
  // or explains), and the helper says so instead of pretending it is invalid.
  await view.type(collegeBox, 'SOME-OTHER');
  check('access control: an unknown value is handed to the server rather than blocked',
    /server will still match it by code, name or document id/.test(view.text()), view.text().slice(0, 600));
});

// The identifier the operator pastes may also be the document id itself.
globalThis.__RC_CALLABLE_PAYLOADS = [];
await section('access control (document id)', ACCESS_CONTROL, {}, async (t, view) => {
  const collegeBox = view.el('input[role="combobox"]');
  if (!collegeBox) { check('access control (id): College picker present', false, t.slice(0, 300)); return; }
  await view.type(collegeBox, DEMO_COLLEGE_ID);
  check('access control (id): a pasted document id resolves too',
    /Vriddhi Demo College \(VDC-001\)/.test(view.text()), view.text().slice(0, 600));
});

// ── Resume Builder (student page + superadmin add-on panel) ──────────────────
// The page talks to the api function through resumeService (stubbed above):
// the check proves the editor, template picker, credit line, ATS panel and the
// download history all mount from ONE /resume/me response, that typing drives
// autosave + a server-rendered preview (never a client-side rasteriser), and
// that the add-on's "off" state renders the explanation instead of the editor.
const RESUME_PAGE = '/src/modules/student/pages/StudentResumePage.tsx';
const resumeCalls = (fn) => (globalThis.__RC_RESUME_CALLS ?? []).filter((c) => c.fn === fn);
const waitMs = async (ms) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

globalThis.__RC_RESUME = {};
globalThis.__RC_RESUME_CALLS = [];
await section('resume builder', RESUME_PAGE, {}, async (t, view) => {
  check('resume: mounts the editor from one /resume/me call', resumeCalls('fetchMyResume').length === 1 && /Resume Builder/.test(t), t.slice(0, 300));
  check('resume: five templates offered, the disabled one is locked',
    view.all('[role="radio"]').length === 5 && view.all('[role="radio"][disabled]').length === 1 && /Off for your college/.test(t), t.slice(0, 600));
  check('resume: credit line comes from the server (Classic 1 of 3 left)', /1 of 3 downloads left/.test(t), t.slice(0, 600));
  check('resume: prefilled from the student record', view.value('resume-fullName') === 'Bala Kumar', String(view.value('resume-fullName')));
  check('resume: ATS panel and download history render', /ATS readiness/.test(t) && /Classic · v1/.test(t) && /Classic · v2/.test(t), t.slice(0, 900));
  check('resume: contact section exposes email/phone inputs', Boolean(view.el('#resume-email')) && Boolean(view.el('#resume-phone')), '');

  await view.type('#resume-email', 'bala@example.com');
  await waitMs(2200);
  check('resume: typing triggers a server preview and an autosave (debounced, one each)',
    resumeCalls('fetchResumePreview').length >= 1 && resumeCalls('saveMyResume').length >= 1
    && resumeCalls('saveMyResume').at(-1).params.fullName === 'Bala Kumar',
    JSON.stringify(globalThis.__RC_RESUME_CALLS.map((c) => c.fn)));
  check('resume: the preview is the server HTML in a sandboxed iframe',
    Boolean(view.el('iframe[data-testid="resume-preview"]')) && view.el('iframe[data-testid="resume-preview"]').getAttribute('sandbox') === '', '');

  const dl = view.byText('Download PDF');
  check('resume: Download PDF is enabled while credits remain', Boolean(dl) && !dl.disabled, '');
  await view.click(dl);
  await waitMs(50);
  check('resume: download asks the server for the PDF (one credit) and saves the blob',
    resumeCalls('generateResumePdf').length === 1 && resumeCalls('generateResumePdf')[0].params.templateId === 'classic'
    && resumeCalls('saveBlobAs').length === 1, JSON.stringify(globalThis.__RC_RESUME_CALLS.map((c) => c.fn)));
  check('resume: after a download the page re-reads credits from the server', resumeCalls('fetchMyResume').length === 2, String(resumeCalls('fetchMyResume').length));

  const redl = view.all('[data-testid="resume-downloads"] button').find((b) => /PDF/.test(b.textContent));
  await view.click(redl);
  check('resume: re-downloading an old version is a free file fetch, not a new render',
    resumeCalls('redownloadResumePdf').length === 1 && resumeCalls('generateResumePdf').length === 1, JSON.stringify(globalThis.__RC_RESUME_CALLS.map((c) => c.fn)));
});

// Out of credits: the server refuses (409) and the page explains rather than rendering locally.
globalThis.__RC_RESUME = { exhausted: true, me: (await server.ssrLoadModule('/scripts/render-check/stubs/resumeService.ts')).__defaultResumeMe({
  credits: [
    { templateId: 'classic', used: 3, allowed: 3, remaining: 0, enabled: true },
    { templateId: 'modern', used: 0, allowed: 3, remaining: 3, enabled: true },
    { templateId: 'compact', used: 0, allowed: 3, remaining: 3, enabled: true },
    { templateId: 'fresher', used: 0, allowed: 3, remaining: 3, enabled: true },
    { templateId: 'executive', used: 0, allowed: 3, remaining: 3, enabled: true },
  ],
  resume: { data: { contact: { fullName: 'Bala Kumar', headline: '', email: '', phone: '', location: '', linkedin: '', github: '', website: '' }, summary: '', education: [], experience: [], projects: [], skills: [], certifications: [], achievements: [], languages: [], sectionOrder: ['summary', 'education', 'experience', 'projects', 'skills', 'certifications', 'achievements', 'languages'], targetJobDescription: '' }, templateId: 'classic', updatedAt: '2026-09-22T10:00:00.000Z' },
}) };
globalThis.__RC_RESUME_CALLS = [];
await section('resume builder (no credits left)', RESUME_PAGE, {}, async (t, view) => {
  const dl = view.byText('Download PDF');
  check('resume (exhausted): the button is disabled at 0 of 3', Boolean(dl) && dl.disabled && /0 of 3 downloads left/.test(t), t.slice(0, 600));
  check('resume (exhausted): earlier versions stay re-downloadable', view.all('[data-testid="resume-downloads"] button').length === 2, '');
  const modern = view.all('[role="radio"]').find((b) => /Modern/.test(b.textContent));
  await view.click(modern);
  const dl2 = view.byText('Download PDF');
  check('resume (exhausted): switching to a template with credits re-enables the download', Boolean(dl2) && !dl2.disabled && /3 of 3 downloads left · Modern/.test(view.text()), view.text().slice(0, 600));
});

// Add-on off for the college: no editor, an explanation instead.
globalThis.__RC_RESUME = { me: { enabled: false, cycle: '2026-27', settings: { downloadsPerTemplate: 3, aiAssist: false, aiCallsPerStudent: 0, templates: [] }, resume: null, credits: [], aiCredits: null, downloads: [] } };
globalThis.__RC_RESUME_CALLS = [];
await section('resume builder (add-on off)', RESUME_PAGE, {}, async (t, view) => {
  check('resume (off): explains the add-on instead of showing the editor', /Not enabled for your college yet/.test(t) && !view.el('#resume-fullName'), t.slice(0, 400));
  check('resume (off): nothing is rendered or saved', resumeCalls('fetchResumePreview').length === 0 && resumeCalls('saveMyResume').length === 0, '');
});

// Superadmin panel: switches editable, usage shown, save sends the settings.
globalThis.__RC_RESUME = {};
globalThis.__RC_RESUME_CALLS = [];
await section('resume add-on panel (superadmin)', '/src/shared/components/resume/ResumeAddonPanel.tsx', { collegeId: 'college-a', collegeName: 'Vriddhi Demo College', canEdit: true }, async (t, view) => {
  check('addon panel: loads settings + usage for the college', resumeCalls('fetchResumeAdminSettings').length === 1 && /12 resumes started/.test(t) && /7 PDFs/.test(t), t.slice(0, 500));
  check('addon panel: add-on is Off by default', /Off/.test(t) && view.el('[role="switch"][aria-label="Enable Resume Builder"]')?.getAttribute('aria-checked') === 'false', '');
  const save = view.byText('Save add-on settings');
  check('addon panel: save is disabled until something changes', Boolean(save) && save.disabled, '');
  await view.click('[role="switch"][aria-label="Enable Resume Builder"]');
  const save2 = view.byText('Save add-on settings');
  check('addon panel: flipping the master switch enables save', Boolean(save2) && !save2.disabled, '');
  await view.click(save2);
  const sent = resumeCalls('saveResumeAdminSettings')[0]?.params;
  check('addon panel: save sends enabled=true with the cap and template list', sent?.settings?.enabled === true && sent?.settings?.downloadsPerTemplate === 3 && sent?.collegeId === 'college-a', JSON.stringify(sent));
  check('addon panel: credit reset form is present for superadmins', Boolean(view.el('input[aria-label="Student email"]')) && Boolean(view.byText('Reset credits')), '');
});

await section('resume add-on panel (college admin, read-only)', '/src/shared/components/resume/ResumeAddonPanel.tsx', { collegeName: 'Vriddhi Demo College', canEdit: false, embedded: true }, async (t, view) => {
  check('addon panel (read-only): switches are disabled and there is no save or reset', view.all('[role="switch"]').every((s) => s.disabled) && !view.byText('Save add-on settings') && !view.byText('Reset credits'), '');
  check('addon panel (read-only): usage is still visible to the placement cell', /5 students downloaded/.test(t), t.slice(0, 400));
});

// ── Question-paper import panel ──────────────────────────────────────────────
// The panel uploads the archive and then drives the server worker one document
// per call. questionImportApi is stubbed (scripts/render-check/stubs/), so this
// proves the real panel: form validation, the upload→run loop, the counters, and
// that a failed document is surfaced instead of being swallowed.
const IMPORT_PANEL = '/src/modules/superadmin/components/PaperImportPanel.tsx';
const importStub = await server.ssrLoadModule('/scripts/render-check/stubs/questionImportApi.ts');
const importCalls = (fn) => (globalThis.__RC_IMPORT_CALLS ?? []).filter((c) => c.fn === fn);

globalThis.__RC_IMPORT_JOB = importStub.__defaultJob();
globalThis.__RC_IMPORT_DONE = true;
globalThis.__RC_IMPORT_CALLS = [];

await section('paper import panel', IMPORT_PANEL, {}, async (t, view) => {
  check('import panel: explains the flow and refuses a half-filled form',
    /Import previous-year papers/.test(t) && /pending draft/.test(t) && /Name the subject/.test(t),
    t.slice(0, 400));
  check('import panel: start is disabled until the subject is filled in',
    view.byText('Start import')?.disabled === true, String(view.byText('Start import')?.disabled));

  await view.type('#import-subject', 'Financial Accounting');

  const fileInput = view.el('#import-archive');
  const archive = new window.File(['zip-bytes'], 'bcu-papers.zip', { type: 'application/zip' });
  await act(async () => {
    Object.defineProperty(fileInput, 'files', { value: [archive], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  check('import panel: the chosen archive and its size are shown',
    /bcu-papers\.zip/.test(view.bodyText()) && /9 B/.test(view.bodyText()), view.bodyText().slice(0, 400));
  check('import panel: start enables only once form and archive are both present',
    view.byText('Start import')?.disabled === false, String(view.byText('Start import')?.disabled));

  await view.click(view.byText('Start import'));
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

  check('import panel: start reserves a job, uploads, then drives the worker',
    importCalls('startImportJob').length === 1 && importCalls('runJob').length >= 1,
    JSON.stringify((globalThis.__RC_IMPORT_CALLS ?? []).map((c) => c.fn)));
  check('import panel: the job payload carries the chosen subject and programme',
    importCalls('startImportJob')[0]?.params?.defaults?.subjectId === 'Financial Accounting'
      && importCalls('startImportJob')[0]?.params?.defaults?.program === 'bcom',
    JSON.stringify(importCalls('startImportJob')[0]?.params?.defaults));
  check('import panel: progress counters and the finished message render',
    /Questions drafted: 14/.test(view.bodyText()) && /Done: 14 question\(s\) drafted/.test(view.bodyText()),
    view.bodyText().slice(0, 500));
  check('import panel: a failed document is listed with its reason, not hidden',
    /Needs attention \(1\)/.test(view.bodyText()) && /kannada-paper-2023\.pdf/.test(view.bodyText())
      && /The model could not read this document/.test(view.bodyText()),
    view.bodyText().slice(0, 600));
  check('import panel: offers a duplicate check once documents have been parsed',
    Boolean(view.byText('Check duplicates')), '');

  await view.click(view.byText('Check duplicates'));
  check('import panel: duplicate report is rendered with a bulk reject action',
    /already exist/.test(view.bodyText()) && Boolean(view.byText('Reject them')),
    view.bodyText().slice(0, 600));

  await view.click(view.byText('Reject them'));
  check('import panel: rejecting duplicates sends the ids and reports the count',
    importCalls('rejectQuestions')[0]?.params?.ids?.length === 2 && /2 rejected/.test(view.bodyText()),
    JSON.stringify(importCalls('rejectQuestions')) + ' | ' + view.bodyText().slice(0, 400));
});

globalThis.__RC_IMPORT_JOB = undefined;
globalThis.__RC_IMPORT_DONE = undefined;
globalThis.__RC_IMPORT_CALLS = [];

globalThis.__RC_RESUME = undefined;
globalThis.__RC_RESUME_CALLS = [];

globalThis.__RC_CALLABLE_DATA = undefined;
globalThis.__RC_CALLABLE_PAYLOADS = [];
globalThis.__RC_FIRESTORE_DOCS = [];

globalThis.__RC_LOCATION_STATE = null;
globalThis.__RC_WRITES = [];

// Closing the dev server and printing the tally has to happen after the LAST
// section: a summary placed above the sections reports a stale total and lets a
// failure further down exit 0.
await server.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed, ${crashes} mount crash(es)`);

process.exit(failed.length === 0 && crashes === 0 ? 0 : 1);
