> **SUPERSEDED (2026-09-04) — read `docs/AUTH_LOGIN_PROVISIONING_AUDIT_2026-09-04.md`.**
> Diagnoses here were correct about the *symptom* (password accepted → every read denied, because
> authorization is claim-only) but the cures described are not the shipped ones:
> * “Null-safe identity resolution: claim → `users/{uid}` → `superadmins/{uid}`” — the
>   `users/{uid}` fallback for **role resolution** was removed. Rules read the claim only;
>   `isSuperadmin()` may still check `superadmins/{uid}`, because that collection is writable
>   exclusively by an existing superadmin. A claim-less account is repaired, not trusted:
>   `syncMyIdentity` at sign-in, `auditAndRepairIdentities` (Access Control → Identity repair)
>   or `npm run identity:doctor -- --apply`.
> * The client-REST provisioning path described here (Identity Toolkit `signUp` + writing
>   `password` onto the profile document) is **gone**. Passwords are never stored; the only
>   supported paths are `bulkCreateStudentAccounts`, `bulkProvisionStaff`, `grantUserRole`, and
>   `deliveryMode: 'reset-email'` for handing out a credential without displaying one.
> * §“Deploy” below lists `firebase deploy --only firestore:rules`. That is exactly the
>   half-deploy that made this bug look unfixed: the project must deploy rules **and** functions
>   **and** hosting together (`npm run deploy:all`), and the frontend now refuses to run an import
>   against a backend that reports a different `apiVersion`.

# Fix: Superadmin / Faculty / Student logins failing (ACCOUNT_NOT_FOUND)

## Symptoms

- Superadmin, faculty, and student accounts could not log in — Firebase Auth
  accepted the password, but the app bounced back to the login page with an
  "account not found" error.
- Even when logged in, the Superadmin **Faculty** and **Students** pages
  returned empty lists (permission-denied on the collection queries).
- Faculty/student accounts created through **Import Faculty / Import
  Students** existed in Firebase Auth but could not log in at all.

## Root cause

PR #23 ("identity-and-access hotfix") deployed deny-by-default Firestore rules
whose identity helpers **errored out** for most real accounts:

```
function claimRole()   { return request.auth.token.role; }   // ← ERRORS when claim absent
function role()        { return claimRole() ?? userDoc().role; } // ← get() on missing doc ERRORS
```

Rules assume every signed-in user has either:

1. `role` / `collegeId` **custom claims**, or
2. a `users/{uid}` Firestore profile document.

But the real database has three generations of accounts:

| Generation | Custom claims | `users/{uid}` doc | Where identity lives |
|---|---|---|---|
| Provisioned via `provisionUser` CF | ✅ | ✅ | users |
| **Legacy** (original seed) | ❌ | ❌ | `superadmins/{uid}`, `faculty/{uid}`, `students/{uid}` |
| Client-imported (REST `signUp`) | ❌ (REST API can't set claims) | ⚠️ write was denied by the same rules | `faculty/…` profile only |

For those accounts, `claimRole()` and the `userDoc()` fallback **throw a rules
error**, and any rule that touches `role()` / `collegeId()` is denied entirely.
The client's `getUserData()` (login role resolution) therefore read *nothing*,
returned `null`, and login threw `ACCOUNT_NOT_FOUND` — for superadmins,
faculty, and students alike. The same error made `isSuperadmin()` false/error
on the Faculty & Students list queries, and blocked the `users/{uid}` writes
that imports depend on (leaving orphaned Auth accounts with no profile).

Secondary issues fixed in the same pass:

- **Duplicate `AuthProvider`** — `App.tsx` wrapped the route tree in a second
  `AuthProvider` nested inside the one in `main.tsx`, creating two independent
  auth states with duplicate `onAuthStateChanged` identity resolution.
- **Cloud Function caller checks** only accepted `users/{uid}` docs, so a
  legacy superadmin could not even call `provisionUser` /
  `bulkCreateStudentAccounts`.

## What changed

### `current-firestore.rules`

1. **Null-safe identity resolution** — claim access guarded with
   `'role' in request.auth.token`; `users/{uid}` access guarded with
   `exists()`; `role()` resolution order is now
   **claim → users doc → `superadmins/{uid}` doc**; `collegeId()` falls back to
   the user's own `students/{uid}` / `faculty/{uid}` profile doc.
2. **Self-profile reads** (`isOwner(id)`) on `superadmins`, `faculty`,
   `admins`, `hods`, `mentors` so legacy accounts can resolve their identity
   at login (placed *before* any `resource.data` access that can error on
   missing legacy fields).
3. **Field-guarded** `ownsStudentProfile` / `ownsStudentId` / `sameCollege`.
4. **`users` create** allowed for a *verified superadmin only*, with
   validation (doc ID == `uid`, whitelisted role, no password material) —
   this un-blocks UserImport / FacultyImport, which must persist the lookup
   doc client-side because the REST signUp API cannot set claims.
   Everyone else stays Cloud-Function-only.

### `src/App.tsx`

Removed the nested duplicate `AuthProvider` (it is mounted once in `main.tsx`).

### `functions/src/userProvisioning.ts`, `functions/src/studentAuth.ts`

Caller identity checks fall back to `superadmins/{uid}` so legacy superadmins
can provision users and bulk-import students.

### `src/modules/superadmin/api/superAdminApi.ts`

Self-healing imports: when an import meets an email whose profile doc exists
but whose `users/{uid}` lookup doc is missing (an orphan from the broken
window), the import now **restores the missing doc** instead of failing the
row. Re-running the same import CSV heals previously broken accounts (their
original passwords keep working; the credentials table shows `—` for them).

## Verification

- `npm run build` — ✅ TypeScript + Vite clean
- `cd functions && npx tsc --noEmit` — ✅

## Deploy (required — these fixes are inert until deployed)

```bash
# 1. Firestore rules (this is what unblocks login)
firebase deploy --only firestore:rules

# 2. Cloud Functions (caller-check fallbacks)
npm --prefix functions run build
firebase deploy --only functions

# 3. Hosting (client fixes: double provider, import self-heal)
npm run build
firebase deploy --only hosting
```

## Recovering accounts created during the broken window

Accounts whose Auth user was created but whose profile/lookup docs were
written by a *denied* import can be healed two ways:

1. **Re-run the same import CSV** — the self-heal path restores the missing
   `users/{uid}` doc and reports it in the results panel (original password
   still valid).
2. For a single user, re-importing that one row through **Import Faculty** is
   enough.

No manual Firebase console surgery is required.

## Faculty pages: "Missing or insufficient permissions" after a successful login

This is a different, rules-only failure. The log looks like the user is resolved
(`Resolved user: Faculty`) but every faculty query on `weeklySchedules`,
`classSessions`, `assignments`, per-college `schedules`, and similar collections
fails with `Missing or insufficient permissions`.

Two related causes, both in `current-firestore.rules`:

1. **`allow read` with `resource.data` is not valid for list/query requests.**
   A `getDocs()` request has no `resource`, so a rule like
   `allow read: if ... sameCollege(resource.data)` cannot authorise a query even
   when the user is a valid staff member. The fix is to split the rule:
   - `allow get:` may use `resource.data` (single document reads).
   - `allow list:` is role-based (`isStaff()`), because the client already
     scopes the query by `collegeId` / `facultyId`.

2. **Legacy faculty identity resolution could exceed the document-access budget.**
   Faculty created before Access Control have no `users/{uid}` document and often
   no custom claims, so rules resolve role/college from `faculty/{uid}`. The old
   helpers called `exists()` + `get()` on the same profile more than once. Rules
   allow only 10 `get()/exists()` calls per request, so `role()`/`collegeId()`
   could error and every rule that depended on them was denied. The helpers now
   use `let` to fetch a profile document once.

### What changed

- `current-firestore.rules`: refactored `profileRole()`, `role()`,
  `profileCollegeId()` and `collegeId()` to use `let` and single-fetch lookups.
- Split `allow read` into `allow get` / `allow list` for `students`, `faculty`,
  per-college dashboard collections, `attendance`, `attendanceRecords`,
  `weeklySchedules`, `classSessions`, `curriculumFacultyMappings`,
  `submissions`, `curriculum`, `syllabusExtracts`, `topics`, `testPapers`.
- `functions/test/firestore.rules.test.ts`: added a legacy no-claim faculty test
  that runs the exact `weeklySchedules`, `classSessions`, and `assignments`
  queries used by the app.

### Deploy

```bash
firebase deploy --only firestore:rules
```

Optionally run the rules suite first (needs the Firebase emulator):

```bash
cd functions && npm run test:rules
```

If a user still fails after this and their account was provisioned through the
broken window, repair it once through **Superadmin → Access Control** so it gets
a `users/{uid}` document and refreshed custom claims.
