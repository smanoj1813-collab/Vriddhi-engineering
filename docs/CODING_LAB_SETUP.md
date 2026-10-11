# Student Coding Lab — deployment and safety

The student route is `/student/coding-lab`; it appears in the dashboard, Learning hub, desktop navigation, and More menu only for BCA students at a college enabled by Superadmin. Superadmin manages the per-college switch in Prep Content Studio. The callable independently verifies the student's BCA profile, linked college, and that college's assignment before accepting a run. The editor supports the bundled C, C++, Java, and Python 3 examples. Runs go through an authenticated Firebase callable and a **server-configured Judge0-compatible API**. The browser never receives the runner credential and cannot set compiler flags or resource limits.

## Connect a runner before enabling live execution

The UI and sample library can be deployed independently, but **Run code remains unavailable until the Cloud Function has a runner URL**. Choose a managed Judge0 service or a Judge0 CE installation you control. Review that provider's retention, abuse, privacy, data-location and price terms first; student source and stdin are sent to it for execution. Do not put the provider key in a `VITE_*` variable or any browser bundle.

For Firebase project `<project-id>`:

1. Create `functions/.env.<project-id>` locally (do not commit it) and set the API base URL. The base URL may include a path prefix, but not credentials, query parameters or a fragment:

   ```dotenv
   JUDGE0_API_URL=https://your-judge0-host.example
   # Optional for RapidAPI-compatible gateways:
   # JUDGE0_API_KEY_HEADER=X-RapidAPI-Key
   # JUDGE0_API_HOST=your-provider-host
   ```

   The default API-key header is `X-Auth-Token`. Set `JUDGE0_API_KEY_HEADER` to another header name only if the provider requires it. `JUDGE0_API_HOST` adds `X-RapidAPI-Host` when set.

2. Store the key as a Firebase Functions secret (the secret is bound to the callable even if a self-hosted runner does not require authentication):

   ```sh
   firebase functions:secrets:set JUDGE0_API_KEY --project <project-id>
   ```

   For an unauthenticated self-hosted endpoint, set a non-sensitive placeholder value. The function will send it in the configured key header; if your gateway rejects unknown headers, configure the gateway to ignore that header or use a managed endpoint that supports authentication.

3. Deploy the functions. The key is bound to **every** function that calls the runner — the Coding Lab (`runStudentCode`), the in-test sample runner (`runAssessmentCode`), the hidden-test judge (`judgeCodingSubmissions`) and the setup check (`checkCodeRunnerSetup`). Deploy them together so none is left without the key:

   ```sh
   npm --prefix functions run build
   firebase deploy --only functions:runStudentCode,functions:runAssessmentCode,functions:judgeCodingSubmissions,functions:checkCodeRunnerSetup --project <project-id>
   ```

4. Verify it from inside the deployed project. Sign in as a **superadmin** and call the `checkCodeRunnerSetup` callable (no arguments). It reads nothing from Firestore, writes nothing, and makes one request to the runner. It returns `ready: true` only when the runner answers and has a compiler for each of `c`, `cpp`, `java` and `python`; otherwise `problems` says what to fix. It reports whether a key is present, never its value.

The callable is deployed in `asia-south1`, the same region used by the app's Firebase Functions client. It accepts only `c`, `cpp`, `java`, and `python`; the installed compiler list is fetched from Judge0 and cached briefly so different Judge0 versions do not require hard-coded language IDs.

## Sample runs in an assessment

Faculty choose how many times a student may run the public sample tests on each coding question: 10, 25, 50, 100, or Unlimited. The default is 25. The count is per student, per test, per question, so switching between papers or re-taking one does not reset it. A student who runs out can still submit, because marks come from the hidden tests. The per-minute and per-day throttles apply on top of the per-question budget, even when a question is unlimited, so "Unlimited" cannot become free code execution.

## Server-enforced execution limits

- 30 runs per student per UTC day; 6 per student per minute.
- 16,000 source characters and 4,000 stdin characters per request.
- Judge0 submission limits: 2 CPU seconds, 5 wall seconds, 128,000 KB memory, 64,000 KB stack, and at most 20 processes/threads.
- Each returned output field is truncated to 12,000 characters.
- The function does not store source code, stdin, or results. Usage counters are stored in the server-only `codeRunnerUsage` collection; Firestore rules deny client access by default.

A run is charged after the request has passed validation and the connected runner advertises the selected language. A provider outage after that point can therefore consume one run. Monitor the runner plan and Firebase Functions / Firestore costs; the per-student quota is not a global provider budget.

## Local testing

`functions/src/codeRunnerCore.ts` contains provider-independent request, language-resolution, output-bound and quota helpers. Its tests run with:

```sh
npm --prefix functions run test:unit
npm run build
npm run build:functions
```

Live execution requires a reachable Judge0-compatible service and Firebase Auth/Firestore emulator data for a linked student profile. The automated tests do not send code to an external runner.
