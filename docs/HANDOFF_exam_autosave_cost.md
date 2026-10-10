# Hand-off: cut Firestore reads/writes during live student tests

**Scope for the next session: this task only.** Everything else (PWA, mobile
layout, curriculum fixes) is merged/deployed via PR from
`arena/01a09a4b-vriddhi`; do not touch it.

## Problem (measured from code, 2026-09-13)

Per student, per 60-min / 50-question test, today:

| Path | Frequency | Firestore per call | Per student |
|---|---|---|---|
| `autosaveMyStudentTest` | every 15 s, **even when nothing changed** (`ActiveTestPage.tsx` L24 `AUTOSAVE_INTERVAL_MS = 15_000`, L204-208) | `resolveStudent` 2 reads (`users` + `students` query) + attempt read + `scheduledTests` read + **`loadTestQuestions` = N question reads** + txn read + 1 write ≈ 55 reads / 1 write | ~13,200 reads, 240 writes, 240 invocations |
| `logMyStudentTestEvent` | fire-and-forget on every `tab_switch`, `window_blur`, `copy_attempt`, `paste_attempt`, `context_menu`, `keyboard_shortcut`, `fullscreen_exit`… (`ActiveTestPage.tsx` L116-127, listeners L210-265) | 3 reads + 1 `proctoringLogs` add | unbounded (30 events → 90 reads, 30 writes) |
| start / submit | once each | ~60 reads | ~120 |

200 students ≈ **2.7 M reads, 50 k writes, 50 k invocations per exam** (~₹90–120).
Target: ≈ 60–80 k reads, < 10 k writes (≈ 97 % cut).

## Files

- `functions/src/studentAssessments.ts`
  - `resolveStudent` ~L55-70 (2 reads per call)
  - `loadTestQuestions` L186-245 (subcollection `scheduledTests/{id}/assessmentQuestions`, legacy fallbacks to `test.questions` / paper `questions` docs)
  - `sanitizeAnswers` L336-~400 (validates option ids against questions — this is *why* autosave loads all questions)
  - `startMyStudentTest` L534 (transaction creates attempt; writes `studentUid` L579)
  - `autosaveMyStudentTest` L670-706
  - `submitMyStudentTest` L729 (authoritative grade — keep full question load here)
  - `logMyStudentTestEvent` L869-902 (`proctoringLogs` add, `MAX_PROCTOR_DETAILS_BYTES` 4000)
- `src/modules/student/pages/ActiveTestPage.tsx` — `runAutosave` L186-201, interval L203-208, `recordProctorEvent` L116-127, `handleAnswer` L293, `doSubmit` ~L129, buffers `answersRef` / `proctorEventsRef` (last 200 events)
- `src/modules/student/api/testApi.ts` — `autosaveStudentAssessment` L84 (sends full keyed answer map), `logProctorEvent` L144; `call()` wrapper for httpsCallable
- Tests: `functions/test/*.test.ts` run with `node --import tsx --test` (NB: module-level `admin.firestore()` breaks imports — use lazy getters). `functions/test/autosaveIndex.test.ts` (new) pins index-validation ≡ legacy-validation, merge, and proctor-event bounds. Front-end render checks: `npm run test:render` (58).
- Rules: `current-firestore.rules` (students never write `studentAssessments` directly — all via callables; keep it that way).

## Plan (agreed with user)

1. **Client: dirty flag.** Set `dirtyRef = true` in `handleAnswer`/`toggleFlag`; `runAutosave` returns early when clean. Reset after a successful save.
2. **Client: interval 15 s → 60 s + 3 s debounce after last change.** Also flush on `visibilitychange` (hidden) and `pagehide` (use `keepalive`-safe path: just call the callable; if it fails, it retries on next tick).

   *(60 s chosen over 30 s by the user, 2026-09-13. With the dirty flag the interval is only a
   safety net — the 3 s debounce covers active answering and the pagehide/visibilitychange
   flush covers normal exit. Cost: worst-case unsaved window on a hard crash/force-quit
   widens from ~30 s to ~60 s. The ≈97 % read cut is independent of this choice.)*
3. **Client → server: send only the delta** (answers changed since last ack, keyed by questionId). Server merges into existing `answers` array/map; keep `answers` shape identical to today so `submitMyStudentTest` / `getMyStudentTestResult` are untouched.
4. **Server: stop loading questions on autosave.** In `startMyStudentTest`, after `loadTestQuestions`, write a compact `answerIndex: { [questionId]: { optionIds: string[], type } }` on the attempt doc (bounded: 400 q × ~10 opts ≈ well under 1 MiB, but check size; if > ~200 KB store in `studentAssessments/{id}/meta/answerIndex` instead). `autosaveMyStudentTest` validates via a new `sanitizeAnswersWithIndex(delta, answerIndex)` — no `scheduledTests` read, no question reads. Fallback: if index missing (attempts started before deploy), use the old path.
5. **Server: skip `resolveStudent` on autosave/log.** Attempt row already has `studentUid` (written at start, L579). Check `row.studentUid === request.auth.uid` (and status `in_progress`) — 1 read total. Keep `resolveStudent` for start/submit.
6. **Proctor events: batch.** Client stops calling `logMyStudentTestEvent` per event except for `fullscreen_exit`, `auto_submit`, `fullscreen_denied` (severity-high, faculty live view). All events ride in `proctorEventsRef` and are sent with autosave; server appends to `proctorEvents` on the attempt (cap 500, `arrayUnion` or slice) and writes **one** `proctoringLogs` summary doc per flush only if the batch is non-empty. Confirm what reads `proctoringLogs` today (`grep -rn proctoringLogs functions/src src` → only the writer; faculty UI does not query it yet) before changing its shape.
7. Optional cheap wins: `maxInstances` on autosave 80 → 40 (fewer cold starts don't matter; cost is per-invocation not instances), `memory` stays 256 MiB.

## Acceptance

- Same 50-question test: autosave with no changes → **0** calls; with continuous answering → ≤ 1 call / 60 s from the safety tick (debounce-driven saves may add ≤ 1 per 3 s burst while actively answering), each ≤ 3 reads + 1 write.
- Submit/grade result identical to before (unit test: same answers → same `autoScore`).
- Attempt started **before** deploy still autosaves and submits (fallback path).
- Answers are not lost when the student backgrounds the app right after answering (pagehide flush).
- `tsc` clean in root + `functions/`, `node --import tsx --test functions/test`, `npm run test:render` 58/58.
- Deploy: `firebase deploy --only functions:startMyStudentTest,functions:autosaveMyStudentTest,functions:logMyStudentTestEvent,hosting`. Functions predeploy builds TS. Remind user `git pull` on the arena branch first.

## Runtime alignment

The Functions runtime declaration is now Node 22 in both `functions/package.json`
and `functions/package-lock.json`. Node 20 is not an acceptable deployment target
because it is scheduled for decommissioning on 2026-10-30. Local emulator work
should use Node 22; Node 24 is newer than the repository's supported runtime and
can prevent the Functions emulator from loading the module correctly.

## Phase 0 implementation status (2026-09-19)

The code-level optimization is now present and covered by the autosave tests:

- `scripts/assessment-cost-baseline.mjs` provides a deterministic fixture estimate for 50, 200 and 1,000 students. It is explicitly **not** a production measurement; run the emulator/load scenarios before rollout.
- `startMyStudentTest` writes answer-key-free frozen snapshots under `scheduledTests/{testId}/questionChunks/chunk-NNN`.
- Chunks contain at most 25 questions and are additionally capped at 750,000 JSON bytes, leaving headroom under Firestore's 1 MiB document limit.
- `getMyActiveStudentTest` reads the bounded chunk collection for new attempts and falls back to the legacy question loader when chunks are absent.
- `functions/test/autosaveIndex.test.ts` covers chunk bounds, answer-key stripping, answer-index equivalence, merge behavior and proctor-event limits.

Run the fixture with:

```bash
npm run assessment:baseline
npm run assessment:baseline -- --json
```

The fixture's nominal 200-student scenario is 30,000 reads, 4,400 writes and 2,400 invocations, versus the old 2,682,000 reads, 54,400 writes and 54,400 invocations. These figures depend on the explicit assumptions in the script and must not be presented as measured billing data.

## Context the next session needs

- Firebase project `vriddhi-engineering`, region `asia-south1`, live at https://vriddhi-engineering.web.app. No admin creds / CLI in the sandbox — cannot inspect live data; all changes code-level, user deploys from Windows PowerShell.
- Node 20 Functions runtime is decommissioned 2026-10-30; upgrade to Node 22 + latest `firebase-functions` is a separate pending item (do it before or together with this deploy if convenient, but don't block on it).
- FCM push is deferred by the user.
