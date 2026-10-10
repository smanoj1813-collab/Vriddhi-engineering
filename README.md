# Vriddhi — Academic Management System for Colleges

Vriddhi is a full-featured, role-based academic management platform for colleges. It brings
students, faculty, college administration, and platform operators onto a single system covering
attendance, assessments and tests, curriculum, question banks, AI-assisted paper generation,
fees, timetables, and more — powered by Firebase and modern React.

---

## Table of contents

- [Highlights](#highlights)
- [Roles](#roles)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment variables](#environment-variables)
  - [Run locally](#run-locally)
- [Firebase setup](#firebase-setup)
- [Cloud Functions (backend API)](#cloud-functions-backend-api)
- [AI / LLM providers](#ai--llm-providers)
- [Resume Builder add-on (Placement Pack)](#resume-builder-add-on-placement-pack)
- [Available scripts](#available-scripts)
- [Deployment](#deployment)
- [Data model](#data-model)
- [Notes](#notes)

---

## Highlights

- **Role-based dashboards** for students, faculty/HOD/mentors, college admins/principals, and
  platform superadmins.
- **Attendance** marking and viewing for both faculty and students.
- **Assessments & tests** with a full test-taking flow (instructions → active test → results),
  MCQ rendering, and step-by-step solutions.
- **Question bank** with manual, bulk-imported, and **AI-generated** aptitude questions,
  plus a one-click **curated platform seed** (759 B.Com / BA / B.Sc questions organised
  subject → topic → sub-topic) loaded from Superadmin → Question Bank.
- **AI paper generator** producing question papers from the question bank via Gemini / OpenAI / DeepSeek.
- **Curriculum management** — standardized curriculum upload, syllabus parsing, and mapping, including **auto-mapping** that suggests a scored faculty for every unmapped course (subject/branch/experience/load scoring, preview → approve — see `docs/auto-curriculum-mapping.md`).
- **University scheme packs (G1)** — per-university exam rules (marks split, IA composition, attendance slabs, pass criteria, grade table) drive compliance dashboards, hall-ticket blocking and result import. BCU preset by default; KUD-NEP + generic NEP presets; custom packs per college (`/admin/scheme-packs`).
- **Auto timetable generator (G4)** — mappings → grid: day×period auto-placement with faculty/room/cohort clash safety, lab spanning, faculty daily caps, unplaced-reason reporting and per-day hours coverage; preview → approve (Class Schedule → "Auto Generate").
- **Guest faculty lifecycle (G5)** — contract windows + per-period rates; guest-aware auto-mapping (12-period cap, full-time preference tier, expired-contract exclusion); timetable-derived monthly billing with CSV export (`/admin/guest-faculty-billing`). See `docs/g1-g4-g5-karnataka-college-features.md`.
- **Bulk timetable import** — CSV upload with server-side validation, de-duplication, clash detection (same engine as session generation) and curriculum-mapping cross-reference; preview a per-row report, then apply.
- **Fees** management and a student fee portal.
- **Timetable / scheduling** for classes and tests, with rescheduling for faculty.
- **Analytics & "View 360"** student insights, plus a superadmin multi-college comparison.
- **Multi-college / multi-university** support managed at the superadmin level, including
  subscription billing and a system health monitor.
- **South Indian language support** — Kannada, Tamil, Telugu, and Malayalam (plus English and
  Hindi) for the UI and for AI question generation in native Unicode scripts.

## Roles

| Role        | Area                    | Landing route            |
| ----------- | ----------------------- | ------------------------ |
| `superadmin`| Platform operations     | `/superadmin/dashboard`  |
| `admin`     | College administration  | `/admin/dashboard`       |
| `principal` | College leadership      | `/admin/dashboard`       |
| `hod`       | Head of department      | `/faculty/dashboard`     |
| `mentor`    | Faculty mentoring       | `/faculty/dashboard`     |
| `faculty`   | Teaching staff          | `/faculty/dashboard`     |
| `student`   | Student self-service    | `/student/dashboard`     |
| `parent`    | (defined, not yet a full module) | —                |

Role-based route protection is handled by `RoleRoute` / `RoleGuard` under `src/modules/auth/`,
and the root redirect maps each role to its dashboard in `src/routes/index.tsx`.

## Tech stack

**Frontend**

- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite 5](https://vitejs.dev/)
- [React Router 7](https://reactrouter.com/) (declarative routes via `useRoutes`)
- [Material UI v9](https://mui.com/) + [Tailwind CSS](https://tailwindcss.com/) + Emotion
- [TanStack React Query](https://tanstack.com/query) for server state
- [Recharts](https://recharts.org/) for charts, [Framer Motion](https://www.framer.com/motion/) for animation
- [KaTeX](https://katex.org/) for math rendering; `mammoth` / `xlsx` / `papaparse` for document & spreadsheet imports
- `jspdf` / `html2pdf.js` / `html2canvas` for PDF export

**Backend & platform**

- [Firebase](https://firebase.google.com/): Authentication, Firestore, Realtime Database, Cloud Storage, Hosting
- [Cloud Functions for Firebase v2](https://firebase.google.com/docs/functions) with an Express API (region `asia-south1`)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup), [Zod](https://zod.dev/) validation,
  rate limiting, and per-tier request checks
- LLM providers: [Gemini](https://ai.google.dev/), [OpenAI](https://openai.com/), and [DeepSeek](https://www.deepseek.com/)

## Repository structure

```
Vriddhi/
├── src/                        # Frontend application
│   ├── App.tsx                 # Root component + route rendering
│   ├── main.tsx                # Entry point (providers + router)
│   ├── Firebase/config.ts      # Firebase SDK initialization & service exports
│   ├── routes/                 # Route composition + role guards
│   ├── modules/
│   │   ├── auth/               # Login pages, AuthContext, guards
│   │   ├── student/            # Student dashboard, tests, fees, timetable, library…
│   │   ├── faculty/            # Attendance marking, schedule, question bank, papers…
│   │   ├── admin/              # College admin dashboard, analytics, curriculum, AI agent…
│   │   └── superadmin/         # Colleges, universities, imports, billing, health…
│   ├── shared/                 # Shared contexts, providers, types, utilities
│   ├── components/             # Cross-cutting UI components
│   ├── hooks/                  # Shared hooks
│   ├── api/ and services/      # Shared API/service helpers
│   └── Docs/                   # Internal docs (Firebase schema, agent rules)
├── functions/                  # Cloud Functions (Express backend)
│   └── src/
│       ├── index.ts            # App entry: Express app + callable exports
│       ├── routes/             # /api/ai-questions, /api/questions, /api/papers, /api/config
│       ├── middleware/         # Auth, rate limiting, tier checks
│       ├── services/           # Question generation, prompt building
│       ├── validation/         # Zod request schemas
│       └── studentAuth.ts      # Student auth sync / bulk account creation
├── data/
│   └── question-bank/          # Curated seed CSVs, the topic/sub-topic hierarchy and the
│                               # Python generator that validates them
├── scripts/                    # Seed / migration / fixture scripts + the unit & render test harnesses
├── firebase.json               # Firebase Hosting, Firestore, RTDB, Functions config
├── firestore.rules     # Firestore security rules
├── storage.rules                # Cloud Storage security rules
├── vite.config.ts              # Vite config, @/ alias, manual chunking
├── tailwind.config.js          # Tailwind configuration
└── package.json                # Frontend dependencies & scripts
```

Each module follows a consistent feature-based layout (`pages/`, `components/`, `hooks/`,
`api/` or `services/`, `types/`, `routes.tsx`), which keeps related code together.

## Getting started

### Prerequisites

- **Node.js 18+** (Node 20 is required for Cloud Functions — see `functions/package.json`)
- **npm**
- A **Firebase project** (for Auth, Firestore, Storage, Hosting, Functions)
- The **Firebase CLI** (`npm install -g firebase-tools`) for emulators and deployment

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/smanoj1813-collab/Vriddhi.git
cd Vriddhi

# 2. Install frontend dependencies
npm install

# 3. Install Cloud Functions dependencies
cd functions
npm install
cd ..
```

### Environment variables

Create a `.env` file in the repository root (see `.gitignore` — it is intentionally ignored)
with your Firebase web app configuration:

```bash
# Firebase web config (from Firebase Console → Project settings → Your apps)
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id

# Backend API base URL — the `api` Cloud Function (see "API base URL" below)
VITE_API_BASE_URL=https://asia-south1-your-project.cloudfunctions.net/api
```

The frontend reads these via `import.meta.env.VITE_*` in `src/Firebase/config.ts`.

#### API base URL

Every browser call to the Express `api` function (AI chat, AI question generation, PDF export)
goes through **one** normaliser, `src/shared/api/apiBase.ts`. It reads `VITE_API_BASE_URL`
(or the legacy `VITE_API_URL`), trims a trailing slash and appends `/api` only when it is
missing, so all of these are equivalent:

```
https://asia-south1-your-project.cloudfunctions.net
https://asia-south1-your-project.cloudfunctions.net/api
https://asia-south1-your-project.cloudfunctions.net/api/
```

If the variable is unset the production function URL is used. Do **not** build API URLs
anywhere else — use `apiUrl('/papers/…')` from `apiBase.ts`. Firebase Hosting has a single
SPA rewrite (`** → /index.html`), so a relative `fetch('/api/…')` in production would receive
`index.html` with HTTP 200; `assertJsonResponse()` turns that into a loud error instead of
letting it masquerade as a reply.

### Run locally

```bash
npm run dev
```

Vite serves the app at `http://localhost:5173`. The backend functions can be run locally with
the Firebase emulator suite (see below).

To exercise the real function from the dev server instead of the deployed one, set
`VITE_API_BASE_URL=/api` in `.env.local` and start the Functions emulator. `vite.config.ts`
proxies same-origin `/api/*` requests to
`http://localhost:5001/<VITE_FIREBASE_PROJECT_ID>/asia-south1/api` (override the target with
`VITE_DEV_API_PROXY_TARGET`). The proxy only exists in `npm run dev`; production builds always
call the absolute function URL.

```bash
# terminal 1
npm --prefix functions run serve        # build + firebase emulators:start --only functions
# terminal 2
VITE_API_BASE_URL=/api npm run dev
```

**Unit tests:** `npm run test:unit` (frontend: base-URL normaliser + PDF response contract) and
`npm --prefix functions run test:unit` (backend, including the Puppeteer renderer). Both run on
plain `node --test` via `tsx`.

**Rules tests:** `npm --prefix functions run test:rules` runs the full Firestore rules suite
(~95 tests) against the Firebase emulators — it needs **Java 17+** installed locally
(CI provisions Java 21; per-PR CI runs the faster `test:rules:course-security` slice,
and the full suite runs nightly).

## Firebase setup

1. Enable **Authentication → Email/Password** sign-in.
2. Enable **Firestore**.
3. Deploy the security rules:

   ```bash
   firebase deploy --only firestore:rules
   ```

   Rules file: `firestore.rules`. (Realtime Database was retired in
   2026-10 — no code read or wrote it; delete the instance in the Firebase
   console if it still exists.)

4. Run emulators locally:

   ```bash
   firebase emulators:start
   ```

   Or serve just the functions from the `functions/` directory with `npm run serve`.

## Cloud Functions (backend API)

The backend is an Express app exported as a Firebase **v2 HTTPS function** named `api`
(`functions/src/index.ts`), plus a few callable functions for student auth.

**REST endpoints** (all under the `api` function):

| Method | Path               | Purpose                                  |
| ------ | ------------------ | ---------------------------------------- |
| GET    | `/api/health`      | Health check + provider availability     |
| POST   | `/api/ai-questions`| Generate AI aptitude questions           |
| POST   | `/api/ai/*`        | AI generation aliases                    |
| *      | `/api/questions`   | Question CRUD                            |
| *      | `/api/papers`      | Paper generation                         |
| GET    | `/api/config`      | Runtime configuration                    |

**Callable functions:** student identity/profile and assignments use `bulkCreateStudentAccounts`, `updateMyStudentProfile`, `getMyAssignments`, `beginMyAssignmentSubmission`, `finalizeMyAssignmentSubmission`, `cancelMyAssignmentSubmission`, and `gradeAssignmentSubmission`. Secure online assessments use `getMyStudentTests`, `getMyTestInstructions`, `startMyStudentTest`, `getMyActiveStudentTest`, `autosaveMyStudentTest`, `submitMyStudentTest`, `logMyStudentTestEvent`, and `getMyStudentTestResult`; staff scheduling/grading uses `listManagedAssessmentTests`, `scheduleAssessmentTest`, `publishAssessmentTest`, `cancelAssessmentTest`, `listPendingAssessmentSubmissions`, and `gradeStudentAssessmentSubmission`; `autoSubmitExpiredStudentTests` recovers expired attempts after browser disconnects. Staff assignment authoring uses `createFacultyAssignment`, `updateFacultyAssignment`, `transitionFacultyAssignment`, `deleteFacultyAssignmentDraft`, and `getAssignmentSubmissionDownload`. Official transcript publication uses `listManagedGradeRecords`, `saveDraftGradeRecords`, `publishGradeRecords`, and `deleteDraftGradeRecords`. Paper authoring and review use `savePaper`, `reviewPaper`, and `getPaperFileDownload`. The legacy `syncStudentsToAuth` and `createStudentAuth` endpoints now return migration errors.

The API is protected by authentication middleware, rate limiting, and tier checks, with request
bodies validated by Zod schemas in `functions/src/validation/`.

AI generation accepts a `language` field (`en`, `hi`, `kn`, `ta`, `te`, `ml`, or the English
names). Prompts instruct the model to write question text, options, and explanations in the
chosen script while keeping JSON keys in English.

Interface language is stored in `localStorage` (`vriddhi_language`) and can be changed from the
header switcher or Settings → Appearance.

## AI / LLM providers

AI question and paper generation supports three providers, selected at runtime:

| Provider | Environment variable   |
| -------- | ---------------------- |
| Gemini   | `GEMINI_API_KEY`       |
| OpenAI   | `OPENAI_API_KEY`       |
| DeepSeek | `DEEPSEEK_API_KEY`     |

Set these in the `functions/` environment (e.g. `functions/.env` for local dev, or via
`firebase functions:config:set` / Secret Manager for production). Provider availability is
reported by `/api/health`.

## PDF export (Puppeteer)

`GET /api/papers/:id/pdf` and `POST /api/questions/export/pdf` render HTML to PDF with headless
Chrome through the shared helper `functions/src/utils/pdfRenderer.ts` (the only place that
calls `puppeteer.launch`). It resolves the browser binary in this order, checking each path
with `fs.existsSync`:

1. `CHROME_PATH`
2. `PUPPETEER_EXECUTABLE_PATH`
3. the Chrome downloaded by Puppeteer's `postinstall` (`puppeteer.executablePath()`; the cache
   is pinned to `functions/node_modules/.puppeteer_cache` by `functions/.puppeteerrc.cjs` so the
   binary ships with the deployed bundle, per the
   [Puppeteer guidance for Cloud Functions](https://pptr.dev/troubleshooting#running-puppeteer-on-google-cloud-functions))
4. `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`,
   `/usr/bin/google-chrome-stable`

Every render runs a single launch with hard timeouts, closes the browser in `finally`, and
`SIGKILL`s a hung Chrome so failures never leak processes. The `api` function runs with
`memory: '2GiB'` for this reason.

**Degradation contract.** When no usable Chrome is found (or it fails to launch) the routes do
*not* return a generic 500. They answer

```json
HTTP 503
{ "error": "pdf_renderer_unavailable", "fallback": "client", "probed": ["…"], "message": "…" }
```

and the web app (`src/shared/utils/pdfDownloader.ts`) renders the same document in the browser
with jsPDF + html2canvas, showing a non-blocking *"styling is approximate"* notice. Genuine
render faults stay on 500 (`pdf_render_timeout` / `pdf_render_failed`).

**Local dev / CI:** `PUPPETEER_SKIP_DOWNLOAD=true npm --prefix functions ci` (or
`--ignore-scripts`) skips the ~150 MB Chrome download; the PDF routes then return the 503
contract above and the browser fallback takes over. To test real server rendering locally,
point `CHROME_PATH` at any Chrome/Chromium binary in `functions/.env`.

## Resume Builder add-on (Placement Pack)

Students → **Learning → Resume Builder** (`/student/resume`). Five ATS-friendly single-column
templates (Classic, Modern, Compact, Fresher, Executive), a form editor with autosave, a live
server-rendered preview, a rule-based ATS readiness score and **text PDFs** produced by the
same Puppeteer helper as the paper export — never a browser screenshot, so recruiters'
parsers read every word. Sold per college: a superadmin switches it on from
**Colleges → {college} → Overview → Resume Builder add-on** (college admins see the same card
read-only in Settings → General).

Credits: each student gets `downloadsPerTemplate` (default **3**) PDF renders per template per
academic year (June–May). The credit is reserved in the same Firestore transaction that
authorises the render (`functions/src/routes/resume.ts`), so it cannot be bypassed from the
client; a failed render returns the credit. Every generated PDF is kept in Cloud Storage
(`resumes/{collegeId}/{uid}/{downloadId}.pdf`) and re-downloads are free. Preview is
watermarked and unlimited. Optional Gemini rewrite suggestions are off by default and capped
per student (`aiCallsPerStudent`, default 20; model via `RESUME_AI_MODEL`, default
`gemini-2.5-flash`). Design, endpoints, data model and operations:
[`docs/RESUME_BUILDER.md`](docs/RESUME_BUILDER.md); commercial reasoning:
[`docs/RESUME_BUILDER_ADDON_COSTING_2026-09-25.md`](docs/RESUME_BUILDER_ADDON_COSTING_2026-09-25.md).

## Available scripts

**Root (`package.json`)**

| Command            | Description                          |
| ------------------ | ------------------------------------ |
| `npm run dev`      | Start the Vite dev server            |
| `npm run build`    | Type-check (`tsc`) + production build|
| `npm run preview`  | Preview the production build locally |

**`functions/` (`functions/package.json`)**

| Command            | Description                              |
| ------------------ | ---------------------------------------- |
| `npm run build`    | Compile TypeScript                       |
| `npm run serve`    | Build + start functions emulator         |
| `npm run deploy`   | Deploy functions to Firebase             |
| `npm run logs`     | Stream function logs                     |

## Deployment

```bash
# 1. Build the frontend
npm run build

# 2. Deploy everything (hosting, functions, rules)
firebase deploy

# Or deploy individual pieces
firebase deploy --only hosting
firebase deploy --only functions
```

`firebase.json` is configured to host the `dist/` folder with SPA rewrites to `index.html`, and
runs `npm --prefix "$RESOURCE_DIR" run build` before deploying functions.

**Puppeteer / Chrome on deploy.** The Cloud Build step that installs `functions/` dependencies
must be allowed to run Puppeteer's `postinstall` (do **not** set `PUPPETEER_SKIP_DOWNLOAD` or
use `--ignore-scripts` for the deploy install); `functions/.puppeteerrc.cjs` keeps the
downloaded Chrome inside `node_modules/.puppeteer_cache` so it is deployed with the code. If
you prefer to manage the binary yourself, set `CHROME_PATH` (or `PUPPETEER_EXECUTABLE_PATH`) for
the runtime — `functions/.env` locally, or the function's environment variables in production —
and the renderer will use it first. Without a resolvable binary, PDF routes answer
`503 { fallback: 'client' }` and the browser renders the PDF instead (see *PDF export*).

## Data model

- **Users** — `users/{uid}` with role, college, department, and profile fields (see
  `src/modules/auth/context/auth.ts`).
- **Colleges** — `colleges/{collegeId}` with per-college subcollections such as
  `questionBank/{questionId}` (see `src/Docs/firbase/agent/Vriddhi_Agent_Rules.md` for the
  question-bank schema and ID format).
- **Questions** — two pools that coexist:
  - `questions/{questionId}` — a college's own bank (`collegeId`-scoped; feeds
    Admin → Question Bank, scheduled tests and the college paper generator).
  - `questionBank_meta/{id}` + `questionBank_content/{id}` (+ `questionReviews/{id}`) — the
    **universal pool** shared across colleges. `meta` is what lists/filters read
    (`subjectId`, `topicId`, `subTopicId`, `previewText`, `searchKeywords`, `visibility`,
    `status`);
    `content` holds the full payload (options, answer, explanation) and is read on
    preview/use only. A `public` row with `createdBy.collegeId == null` is
    platform-curated content visible to every college — that is what the
    superadmin seeder writes (see `data/question-bank/README.md`).
- The Firestore schema doc lives at `src/Docs/firbase/Vriddhi_Firebase_Schema.md`.

## Notes

- The frontend uses the `@/` path alias → `src/` (configured in both `tsconfig.json` and
  `vite.config.ts`).
- `src/Docs/` contains internal agent rules and the (currently empty) Firebase schema
  placeholder — useful context when extending AI question generation.
- Several one-off migration scripts live in the repository root (`fix-*.mjs`, `debug_*.mjs`,
  etc.). They are not part of the application build; a cleanup into a `scripts/` directory is a
  good follow-up task.
```
