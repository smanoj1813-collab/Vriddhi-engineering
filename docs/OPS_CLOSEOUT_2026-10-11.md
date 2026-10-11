# Ops close-out — agent-side results (2026-10-11)

Scope: the Phase A items from `docs/HANDOFF_*` (the post-PR #6 handoff) that an
agent can complete or verify without console access, plus what is left for a
human. The nightly watch item turned into real work — see
`docs/RULES_SUITE_FIX_2026-10-11.md`.

## Nightly watch → it was red, and it was not a flake

First run of `Rules nightly` on merged `main` (2026-10-11 09:09 UTC, run
38127335833) failed: **5 of 94 tests**. Both root causes are fixed in PR #7:

1. **1,000-expression budget**: staffAttendance write rules and the payslip
   review rule were denied with `maximum of 1000 expressions ... reached`.
   Payslip writes are client-side, so accounts/principal payroll actions were
   failing in production.
2. **`prep_paper_answers`**: the read rule tested a field that does not exist
   (`rejected`), and a missing key in rules is an error, not `false` — students
   could not read any published model answer.

**The merge does not fix production by itself.** Deploy the rules:

```bash
git checkout main && git pull
firebase deploy --only firestore:rules --project vriddhi-engineering
```

Then the nightly should be green the following morning. If it is red, the
failing test names arrive as check-run annotations plus a `rules-suite-log`
artifact.

## C4 — Realtime Database deletion: verified clear, ready for the console

Repo-wide evidence gathered 2026-10-11 (agent side):

| Check | Result |
| --- | --- |
| `getDatabase` / `firebase/database` imports in `src/`, `functions/src/` | none |
| `databaseURL` / `firebaseio.com` in any source, config, or `.env` file | none |
| `database.rules.json` | does not exist |
| `firebase.json` | no `database` section, so no deploy path touches RTDB |
| Only remaining mentions | the historical note in `docs/PROJECT_HEALTH_AUDIT_2026-09-26.md` |

Nothing in the codebase reads or writes RTDB. Before deleting the instance in
the Firebase console, confirm the console-side view matches: no non-empty
buckets that anything else (a script, a legacy client build still cached on a
phone) might touch. Then delete the instance — and optionally drop the
`databaseURL` line from the production env config if one still exists on the
deploy machine.

## Still human (console / connected machine)

1. **Deploy the rules** — PR #7 (above), the only step that changes production.
2. **Delete the RTDB instance** — evidence above.
3. **Cloud Run CPU quota increase** (asia-south1) — confirm whether it was
   filed/approved on 2026-10-10; it decides whether a full
   `npm run deploy:functions` is safe or the ≤10-function batching procedure
   still applies.
4. **Storage cleanup (~1 GB)** — failed-job folders under
   `question-paper-imports/` first; verify bucket size after.
   `deleteMaterial` auto-cleanup is deployed; this is pre-existing junk.
5. **P4-14 marketing-binary externalization** — run from a connected machine;
   the plan is recorded in `041d053`.
6. **Deploy-clone stash** — in `C:\Projects\Vriddhi-engineering-deploy`:
   `git stash drop` after confirming the only entry is
   `pre-pr6: runStudentCode removal + lock churn` (the code edit is obsolete;
   `CORS_EXTRA_ORIGINS` replaced it).
7. **Dependency majors** — decision doc is
   `docs/DEPENDENCY_SECURITY_2026-09-21.md`; do not bundle with feature work.

## Note on the handoff

The handoff references `docs/OPS_CLOSEOUT_2026-10-10.md` — that file is not in
this repository (checked at `ff406e1` and on this branch), so this document
supersedes it for the agent-side items.
