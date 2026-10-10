# AI Question Generation & Paper Builder Audit

Date: 2026-08-22
Branch: `arena/01a02915-vriddhi`

## What was audited

Admin and faculty AI question generation, question bank CRUD/linking, paper building/preview/export, the Firestore-backed Functions API, auth/role/tier middleware, AI provider configuration, and the API URLs used by the frontend.

## Fixed

### Backend (functions)
- **Auth middleware** (`functions/src/middleware/auth.ts`)
  - Replaced the custom `vriddhi_<uid>_<timestamp>` token check with Firebase Admin ID-token verification.
  - Legacy `vriddhi_*` tokens still accepted for older clients.
  - Profiles are resolved from `users` first, then the legacy `superadmins`/`admins`/`faculty`/`hods`/`mentors`/`students` collections.
  - `requireRole` retained and used on AI write routes.
- **Questions API** (`functions/src/routes/questions.ts`)
  - Replaced the stub with a real Firestore-backed CRUD API: list (with filters/pagination), get, create, bulk create, update, delete, clone, stats, PYQ years/names, batch/branch config, duplicate detection, paper link/unlink, linked-papers lookup, and questions PDF export.
  - Routes are college-scoped and auth-checked.
- **Papers API** (`functions/src/routes/papers.ts`)
  - Added list/get/create/update/delete/duplicate/status endpoints that keep `questions` and `papers` linked in both directions.
  - Kept `GET /api/papers/:id/pdf`; removed the misplaced `/questions/export/pdf` route (now served by the questions router).
- **AI generation** (`functions/src/routes/ai-questions.ts`)
  - Added `checkTier`, `enforceQuestionLimit`, `incrementUsage`, and role guards to generate/save routes.
  - Generation no longer auto-writes into `questions` (it only logs generation and returns questions), preventing duplicate documents when the UI saves afterward.
  - `/save` now prefers `firestoreId`, records `importedIds`/`createdIds`, and returns the expected response shape.
- **CORS** (`functions/src/index.ts`)
  - Reflected caller origin instead of hard-coded host list so the hosted Firebase app + local/preview dev hosts can call the API.

### Frontend (admin + faculty)
- **API URL consistency**
  - > **Correction (base-URL wiring fix):** an earlier revision of this note claimed that
    > `admin/api/client`, `shared/api/client` and `pdfDownloader` shared this logic. Neither
    > `client` module existed, and the two clients that did exist encoded *opposite*
    > conventions (`pdfDownloader` appended `/api` to a value that already ended in `/api`,
    > producing `…/api/api/papers/:id/pdf` → 404, while `aiChatService` used a relative URL that
    > the SPA rewrite answered with `index.html`). No production client reached the function.
  - All clients (`shared/services/aiChatService`, `shared/utils/pdfDownloader`,
    `admin/api/aiQuestionApi`) now import the single normaliser `src/shared/api/apiBase.ts`,
    which prefers `VITE_API_BASE_URL`, then `VITE_API_URL`, then the Cloud Functions URL, and
    appends `/api` only when absent. Non-JSON "successes" are rejected by `assertJsonResponse`.
  - API clients now use Firebase `getIdToken()` when no legacy token is stored.
- **Question bank services un-mocked**
  - `src/services/questionBankAPI.ts`, `src/modules/admin/services/questionBankAPI.ts`, `src/modules/admin/api/questions.ts`, and `src/api/questions.ts` now delegate to the real Firestore-backed `src/modules/admin/api/questionBankApi.ts` instead of in-memory mocks / stubbed HTTP endpoints.
- **AI question flow**
  - `generateQuestionsWithAI` maps `firestoreId` properly.
  - `GeneratedQuestion` type now includes `firestoreId`.
  - `useAssessment`, `PaperGeneratorAdmin`, and faculty question bank now share the real question repository.
- **Paper builder**
  - `PaperBuilder` now persists papers via `createPaper` and links the included questions (`linkQuestionToPaper`).
- **Paper preview / generation stubs replaced**
  - `cloudStorageApi.ts` now implements question content download (`questionBank_content` → metadata → college `questions` fallback), paper upload, paper generation from approved `questionBank_meta`, template generation, and paper previews for both universal and legacy college papers.
- **Faculty UI**
  - `FacultyAIQuestions` now calls the real AI generator and can save generated questions.
  - `FacultyPaperGenerator` now loads real approved questions, persists created papers, links them, and downloads real PDFs from the API.

### Firestore indexes
- Added composite indexes in `firestore.indexes.json` for `questions`/`papers` (collegeId + createdAt), `questionBank_meta`, and `papers_universal` queries used by the question and paper flows.

## Verification

```
./node_modules/.bin/tsc --noEmit        # root — passed
npm run build                           # root Vite build — passed
functions: npm run build                # functions tsc — passed
```

(The literal `npx tsc --noEmit` command resolves to the deprecated `tsc@2.0.4` package in this environment; use `./node_modules/.bin/tsc --noEmit` or `npm run build`, which both use the project-local compiler.)

## Deployment requirement

The frontend now generates AI questions and downloads paper PDFs through the
`api` Cloud Function. The currently deployed Cloud Function must be rebuilt and
redeployed for the new Firebase-auth middleware, tier limits, and the
questions/papers CRUD routes to be live:

```
cd functions && npm run build && firebase deploy --only functions --project vriddhi-engineering
```

Firestore rules are unchanged. The composite indexes in `firestore.indexes.json`
should also be deployed when ready:

```
firebase deploy --only firestore:indexes --project vriddhi-engineering
```

## Still not wired (outside this deliverable)

- `QuestionSubmissionForm.tsx`, `ReviewQueue.tsx`, `UniversalQuestionBank.tsx`, and a few `components/question-bank/*` files are not wired into the active route tree yet; they can be removed or completed separately.
- Dead/legacy mock components (`src/modules/faculty/pages/PaperGenerator.tsx`, `src/modules/faculty/components/QuestionManager.tsx`, `src/modules/faculty/components/PaperBuilder.tsx`, `src/modules/faculty/components/TestScheduler.tsx`) are not imported by any active route.
