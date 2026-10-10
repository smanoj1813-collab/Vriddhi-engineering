# Handoff — bulk credential regeneration (follow-up to deadline-exceeded)

Written 2026-09-11. Branch: `arena/01a08f0d-vriddhi`. Builds on `arena/01a08955-vriddhi`.

## What this branch does

### 1. Restores the batched import fix onto a fresh main

`main` at `9cd234c` did not contain the batched sender. This branch cherry-picks
the two commits from `arena/01a08955-vriddhi`:

- `9d90198` — batch 25 rows, 120 s deadline, progress overlay, navigation blocking
- `e831e4f` — batch 25 → 10, timeout 120 s → 300 s, marker log

Constants in `src/shared/utils/batchedImport.ts`:

```
IMPORT_BATCH_SIZE       = 10
IMPORT_BATCH_TIMEOUT_MS = 300_000
```

Marker to prove the fix is deployed (section 3 of previous handoff):

```
[ImportUsers] batched sender: 300 row(s) in 30 batch(es) of 10, 300s per batch
```

### 2. Implements the missing bulk "Regenerate credentials" action

**Problem:** Every import that timed out created Auth accounts server-side and threw
the passwords away. Re-importing reports "email/regNo already exists" with no credential.

**Solution:** Rotate credentials in place, using the same chunked runner so a large
college does not hit the 70 s SDK deadline again.

New API in `src/modules/superadmin/api/superAdminApi.ts`:

- `BulkResetItem { id, name, email }`
- `BulkResetResult { id, name, email, temporaryPassword?, resetLink?, uid?, success, error? }`
- `BulkResetOutcome { results, failures, total, succeeded, failed }`
- `bulkResetCollection('students'|'faculty', items, onProgress)` — internal, logs
  `[BulkReset] batched sender (students): 300 row(s) in 30 batch(es) of 10, 300s per batch`
- `bulkResetStudentPasswords` / `bulkResetFacultyPasswords` — public wrappers
- `isFatalResetError` — stops on permission-denied, unauthenticated, deployment missing

Each row calls the existing `resetUserPassword` callable (60 s server timeout) which:
- sets a random temp password
- revokes refresh tokens (signs out everywhere)
- sets `mustChangePassword: true` claim
- returns `temporaryPassword` + `resetLink` once

Client adds best-effort `passwordResetRequired: true` on the profile doc (UI hint only,
never stores secret).

Hooks in `src/modules/superadmin/hooks/useSuperAdmin.ts`:

- `useBulkResetStudentPasswords`
- `useBulkResetFacultyPasswords`

UI:

- `src/modules/superadmin/components/BulkCredentialReset.tsx`
  - Modal, searchable, select all / filtered, progress overlay (`ImportProgressOverlay`)
  - Blocks in-app nav via modal, tab close via `useBlockUnload`
  - Results via `CredentialsTable` (masked by default, copy per row, CSV download)
  - Failure reporting by row range + per-row error
  - Marker log: `[BulkReset] batched sender (...)`

- `src/modules/superadmin/pages/BulkCredentialResetPage.tsx`
  - Route `/superadmin/credentials/regenerate`
  - College picker (shows student/faculty counts), students/faculty toggle
  - Filter table, regenerate button
  - Explains the three numbers from previous handoff and how to size recovery

Integration:

- `SuperAdminCollegeDetail` — overview quick actions + faculty tab + students tab each have
  "Regenerate X credential(s)" opening the modal with all items in that tab
- `SuperAdminStudents` — college filter (was missing), select all checkbox, bulk button in header
- `SuperAdminFaculty` — same (college filter existed, now also select all + bulk button)

Also restored:

- `ImportExports.tsx` — was missing after fresh branch, needed by FacultyImport/UserImport
- `parseCSV.ts` — upgraded to version with `invalidRows`, `warnings`, `invalidCount` so
  UserImport/FacultyImport compile (previous main had older shape)

## How to deploy (hosting only — no functions changed)

```powershell
cd "C:\Projects\Vriddhi"
git checkout arena/01a08f0d-vriddhi
git pull
npm run build
firebase deploy --only hosting --project vriddhi-engineering
```

Verify in browser console after starting an import:

```
[ImportUsers] batched sender: ...
[ImportFaculty] batched sender: ...
```

And after starting a bulk reset:

```
[BulkReset] batched sender (students): ...
```

If those lines are absent, the bundle is stale.

## How to recover the orphaned students

1. Go to `/superadmin/credentials/regenerate`
2. Pick the college that had the timed-out import
3. Check current count vs CSV row count
   - If counts differ a lot, consider resetting college data (Danger Zone) and re-importing cleanly
   - If overlap is large, select the affected cohort (search by batch, division, etc.)
4. Regenerate — keep page open, progress overlay shows Batch N of M
5. Download CSV, hand out via secure channel, ask users to change after first login
6. Alternatively, from College Detail → Students tab → Regenerate button does same for whole college

Faculty: same flow, but staff import already has `onExisting: 'reset'` so re-importing would also work.
Student re-import still reports "already exists" by design — use this tool.

## Tests

```
npm run test:unit
```

Should show 65 tests (5 files) including 8 batchedImport tests. `tsc --noEmit` passes.

## Still open / next

- The three numbers from previous handoff are still useful for sizing, but now recoverable via UI
- Consider merging PR #42 (now resolved) or opening focused PR from this branch
- No new Cloud Function — client-side bulk using existing `resetUserPassword` callable
- If a future server-side bulk reset callable is wanted, it would be more efficient (single round-trip per batch),
  but would require `firebase deploy --only functions` with `$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"` if discovery times out
