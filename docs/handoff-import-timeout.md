# Handoff — bulk import `deadline-exceeded`

Written 2026-09-11. Branch: `arena/01a08955-vriddhi`.

This is the state of the bulk-import timeout as of the end of this session.
Read sections 1–3 before touching anything; sections 4–6 are what is still open.

---

## 1. What was actually wrong

Two separate causes. The first fix was necessary but not sufficient, which is
why the error survived one deploy.

### Cause 1 — the client gave up at 70 s (fixed in `9d90198`)

| | Limit | Where |
|---|---|---|
| Server `bulkCreateStudentAccounts` | **540 s** | `functions/src/studentAuth.ts:147` |
| Server `bulkProvisionStaff` | **540 s** | `functions/src/staffAuth.ts:201` |
| Client `httpsCallable` | **70 s — SDK default** | `src/modules/superadmin/api/superAdminApi.ts` |

The Firebase JS SDK's `HttpsCallableOptions.timeout` defaults to **70 000 ms**,
and its watchdog rejects with `FunctionsError('deadline-exceeded', ...)`. No
call site in the app ever passed a `timeout`, so any import large enough to
outlast 70 s failed with `FirebaseError: deadline-exceeded`. The message in the
console is character-for-character the SDK's own string — that is how the
client was identified as the culprit rather than the function.

**The dangerous part:** abandoning the HTTP request does **not** cancel the
Cloud Function. It runs to completion server-side, so accounts really are
created while the response — counts and every generated one-time password — is
discarded. The operator sees an error, assumes nothing happened, and is left
with provisioned students nobody can log into.

Re-running does not recover them: students have no `onExisting: 'reset'` option
(only staff do), so the server duplicate check reports every already-created
row as **failed — "email/regNo already exists"** and returns no passwords.

### Cause 2 — batch size 25 was still too big (fixed in `e831e4f`)

The first fix batched rows 25 at a time with a 120 s deadline. It still timed
out, because that estimate ignored the real per-row cost.

Each row makes roughly **three Firebase Auth round-trips**:

1. `auth.createUser`
2. `auth.setCustomUserClaims`
3. read the account back to verify it (`verifyAuthAccount`)

plus two Firestore writes. Every Auth call is wrapped in `withAuthQuotaRetry`
(`functions/src/identityShared.ts:531`): **up to 4 attempts with exponential
backoff — 400 / 800 / 1600 ms plus jitter** — whenever the project is throttled.
A throttled row therefore costs ~10 s, so 25 rows needed ~250 s against a 120 s
budget.

Final constants, in `src/shared/utils/batchedImport.ts`:

```
IMPORT_BATCH_SIZE        = 10      // worst case ~100 s
IMPORT_BATCH_TIMEOUT_MS  = 300_000 // 300 s — inside the 540 s server limit
```

Worst case is now about a third of the budget, while staying under the
callables' own 540 s server limit — so a genuinely wedged batch fails on the
client with a usable error rather than being killed after the work is done.

---

## 2. What changed

| Commit | What |
|---|---|
| `9d90198` | Batched sender for all three call sites: students and mixed staff in `importUsers`, plus `importFaculty`. Progress overlay. Navigation blocking. 8 unit tests. |
| `e831e4f` | Batch 25 → 10, timeout 120 s → 300 s. Added a `batched sender` marker log. |
| `1828b45` | Merged `main` in; resolved the `package.json` conflict (PR #42). |

New files:

- `src/shared/utils/batchedImport.ts` — the runner
- `src/shared/utils/batchedImport.test.ts` — 8 tests
- `src/modules/superadmin/components/ImportProgressOverlay.tsx` — modal progress
- `src/shared/hooks/useBlockUnload.ts` — `beforeunload` guard

**Navigation behaviour.** Closing/reloading the tab warns via `beforeunload`.
In-app navigation is blocked by the modal overlay, because this app mounts a
plain `<BrowserRouter>` and react-router's `useBlocker` only works under a data
router (`createBrowserRouter`). Migrating to a data router is a real
architectural change that was deliberately not made. **Switching browser tabs
is unaffected and remains safe.**

---

## 3. How to tell whether the fix is deployed

Start an import and read the console. The new code logs, before the first batch:

```
[ImportUsers] batched sender: 300 row(s) in 30 batch(es) of 10, 300s per batch
```

If an import fails and **that line is absent**, the deployed bundle predates
the fix — you are still running the single 70 s-capped request. Do not debug
further until that line appears.

You should also see the modal overlay advance ("Batch 4 of 30 · 30 of 300 rows
sent"). No overlay at all also means a stale bundle.

---

## 4. Still open — the students already created have unknown passwords

Every run that timed out created accounts server-side and threw the passwords
away. Re-importing will not recover them.

**Not yet built:** a bulk **"Regenerate credentials"** action — batch
`resetStudentPassword` (which returns a temp password, sets
`mustChangePassword: true`, and revokes sessions) across a college using the
same chunked runner, exporting the new passwords to CSV.

To size it, three numbers are still needed:

1. rows in the CSV that was imported
2. students now present in that college
3. how many were there **before** the import

If the overlap is small, resetting the college's data and re-importing cleanly
may be cheaper than regenerating credentials cohort by cohort.

---

## 5. Repo / process traps (cost real time this session)

- **`npm run test:unit` enumerates test files explicitly — it does not glob.**
  A new `*.test.ts` that is not listed silently never runs, and the count stays
  green. After the merge it runs seven files, 84 tests.
- **The sandbox's git history resets itself**, sometimes several times a
  session: the local branch reverts to the base commit and everything looks
  like one enormous uncommitted diff. Recover with
  `git fetch origin arena/01a08955-vriddhi` then `git reset FETCH_HEAD`.
  **Never force-push.** The remote branch has always had the work.
- **The sandbox clone is shallow (depth 1)** by default. `git merge-base` and
  `git merge-tree` fail with "unrelated histories" until you run
  `git fetch --unshallow origin`.
- **`node_modules` is wiped between snapshots.** Symptom: whole test *files*
  fail to load, not individual cases. Fix with
  `npm ci --ignore-scripts --no-audit --no-fund` (~6 min), then re-run. Use
  `./node_modules/.bin/tsc`, never `npx tsc`.
- **Deploying functions:** if `firebase deploy --only functions` fails with
  `Timeout after 10000`, set `$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"` first.
- To find a PR's real conflicts locally without switching branches:
  `git merge-tree --write-tree --name-only --messages HEAD origin/main`.

---

## 6. Next session, in order

1. **Deploy** (hosting only — no `functions/` files changed):

   ```powershell
   cd C:\Projects\Vriddhi
   git pull
   npm run build
   firebase deploy --only hosting
   ```

2. **Confirm the marker line** in the console (section 3). If absent, stop and
   work out why the bundle is stale — do not re-test the import.

3. **Re-run the import.** Expect ~30 batches for 300 rows, with visible
   progress. Already-created students will report as `email/regNo already
   exists` — that is the pre-existing damage, not a new bug.

4. **Collect the three numbers** from section 4 and decide between bulk
   credential regeneration and a clean re-import.

5. **PR #42** is `MERGEABLE` as of `1828b45` — the conflict is resolved. It is
   a large, stale PR (52 files) that bundles the Slice-2 sessions work together
   with all the superadmin import work. Consider whether to merge it as-is or
   close it and open a focused PR from the current branch.

---

## 7. Environment

- Works from `C:\Projects\Vriddhi` on **Windows PowerShell**; `/home/user/Vriddhi`
  is the sandbox clone and never touches his Firebase project.
- His Windows username is `Manoj s` — **quote every path containing it**.
- Project: `vriddhi-engineering`. Functions region `asia-south1`.
- Hosted at `https://vriddhi-engineering.web.app`.
