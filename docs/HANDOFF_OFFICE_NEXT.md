# Handoff: next office features

Branch: `arena/5af39d1f-vriddhi-engineering` (PR #10, merged into `main` together with this handoff file).
Project: `vriddhi-engineering`. Frontend Firestore database: **`default`** (not `(default)`).

## 1. What is already built and live

- **Hostel** (`/admin/hostel`): blocks (boys or girls, warden), rooms (capacity, active or maintenance), bed allocation with gender and capacity checks, vacate, and **Auto-place** (preview, then apply). Auto-place has Boys/Girls filters and Select all shown.
  - Files: `src/modules/office/api/hostelApi.ts`, `src/modules/office/utils/hostelEngine.ts`, `src/modules/office/pages/HostelManagement.tsx`.
  - Priority: farther from home first, then earliest applicant, then reg no.
- **Transport** (`/admin/transport`): routes with vehicle, driver, seats and stops (order and annual fee per stop). Student enrolment by stop with seat checks. Removal frees the seat. Occupancy per route and stop.
  - Files: `src/modules/office/api/transportApi.ts`, `src/modules/office/utils/transportEngine.ts`, `src/modules/office/pages/TransportManagement.tsx`.
- **Collections** under `colleges/{collegeId}/`: `hostelBlocks`, `hostelRooms`, `hostelAllocations` (doc id = studentId), `transportRoutes`, `transportEnrolments` (doc id = studentId).
- **Access:** `hostel.manage` and `transport.manage` for `operations` and `principal` (`src/modules/auth/permissions.ts`). Sidebar entries are in `operationsNav` in `src/shared/components/Layout.tsx`.
- **Rules:** `firestore.rules`, `isOps(collegeId)`, `match` blocks next to `libraryStockChecks`.
- **Targeting:** `firebase.json` has `"database": "default"` in the `firestore` section. Without it, `firebase deploy` released rules to `(default)`, which the app does not use.

Tests: `src/modules/office/utils/hostelEngine.test.ts` (15 with transport, incl. a regression test for non-string dates) and `transportEngine.test.ts`. Both are registered in `test:unit`.

## 2. Hostel and transport hardening (not started)

Current state: capacity, gender and stop checks run **in the browser inside Firestore transactions**. The rules only check `isOps`, so a user who bypasses the app could write invalid data.

Next chat should:
1. Add rules-emulator tests in `functions/test/` for the five new collections. Cover operations allowed, accounts denied, cross-college denied, and unauthenticated denied. The existing `test:rules` script uses `firebase emulators:exec` with `--config ../firebase.json`. Keep that config to one Firestore entry, because the emulator only loads rules when there is exactly one.
2. **Decide** whether booking should move to a callable Cloud Function (`api` or a new function) so the server enforces capacity and gender. Trade-off: stronger guarantees vs. another deploy and more latency. Ask the user before building.
3. Test the auto-place preview and apply with a student whose gender is missing, and with `appliedAt` in different formats.

## 3. Transport fees linked to fees and challans (not started)

Enrolment already stores `annualFee` per stop (`transportEnrolments`). Remaining work:
1. Find the existing fee assignment and challan flow (search `feeAssignments`, `challan`, `fee-management` and the fee-management page). Reuse it rather than building a second ledger.
2. On enrolment, raise a transport fee line for the student. Decide the billing rule: once per year, or per term.
3. On removal, decide the policy: refund, credit, or no change. Ask the user.
4. Show transport dues in the student fee view and in Accounts.

## 4. Push notifications (not started)

The college already has a notification panel. Next chat should:
1. Find the existing panel and how it stores and displays notices.
2. Add **push** notifications through the existing mechanism. Check first whether Firebase Cloud Messaging is already set up. Do not assume.
3. SMS and WhatsApp are **future work**. Leave a provider interface and do not build them now.

## 5. Grievance redressal, including ragging complaints (not started)

Ragging is a sensitive category. Design first, then build.

Requirements to confirm with the user before building:
- **Confidential intake.** Option to report anonymously, or with a name shown only to the committee. Only restricted roles can see the identity.
- **Ragging cases** go to a separate queue with a restricted audience (the anti-ragging committee and principal). General office staff should not see them.
- **Status workflow** with timestamps for each step, and an audit log that cannot be edited.
- **Victim support** fields: counselling offered, warden or hostel involvement, and safety measures taken.
- **Escalation** to the external authority required by the regulations. Check the current UGC anti-ragging regulations and state rules before writing the escalation steps. Do not hard-code helpline numbers or deadlines from memory.
- **Data retention** and who can export.

General grievances (fees, transport, hostel, academic) can use the same intake with a category field.

## 6. DPDP consent records (not started)

Check the current DPDP Act 2023 and its rules before designing. Confirm which purposes need consent in this product (for example student photos, parent contact, notifications).

Needed:
- **Consent records:** purpose, version of notice, timestamp, source, and withdrawal.
- **Data principal requests:** access, correction and erasure, with a status trail.
- Rules so that only the relevant office can read consent history.

## 7. Lessons from this session (read before deploying)

- **Deploy targets.** The app uses the `default` Firestore database. Check `firebase.json` before deploying rules.
- **Deploy commands** (one at a time, from the repo root on Windows):
  - Rules only: `firebase deploy --only firestore:rules`
  - One function: `firebase deploy --only functions:api`
  - Frontend: `firebase deploy --only hosting`
  - Avoid full deploys because of the CPU quota.
- **Sandbox.** `node_modules` has disappeared between sessions. Reinstall with `PUPPETEER_SKIP_DOWNLOAD=1 npm ci`, then run `npm run test:unit`.
- **Local branch drift.** The sandbox checkout can fall behind the remote. Before committing, compare with `origin/arena/5af39d1f-vriddhi-engineering`. Never force-push.
- **Permission errors in the UI.** If a page says "Security rules refused", check the database target first, then the rules, then the sign-in claim.
- **Crash-prone inputs.** Student `createdAt` can be a Firestore Timestamp, not a string. Coerce before string operations.

## 8. Open decisions for the user

1. Cloud Function for bed and seat booking, or keep the client transactions and rely on rules and tests?
2. Transport fee billing: once a year, or per term? Refund or credit when a student leaves the route?
3. Ragging: who sees cases beyond the committee, and what is the escalation path for this college?
4. Push notifications: which channel and which events come first?
5. DPDP: which consent purposes apply to this product?
