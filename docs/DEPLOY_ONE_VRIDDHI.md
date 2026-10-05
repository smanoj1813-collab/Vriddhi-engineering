# Deploy runbook — One Vriddhi (PR #3)

> Run this from the **deploy worktree** `C:\Projects\Vriddhi-engineering-deploy`
> — never from the original Windows checkout. Project: `vriddhi-engineering`,
> region `asia-south1`.

## What actually needs deploying

Phases B, C and D are **frontend-only** — they reuse existing endpoints
(`GET /prep/progress` already exists). No new Cloud Functions are introduced.
The only backend-adjacent artifact is the Firestore rules (Phase A nav needs
students to read `colleges/{id}/config/prep`).

## Steps

```powershell
cd C:\Projects\Vriddhi-engineering-deploy
git fetch origin
git checkout arena/01a10b53-vriddhi-engineering
git pull origin arena/01a10b53-vriddhi-engineering
firebase login   # only if not already logged in
```

### 1. Firestore rules first (unlocks Phase A nav)

```powershell
firebase deploy --only firestore:rules
```

Verify: sign in as a student of an enabled college → "Placement Prep" appears
in the Learning hub. Until this is deployed, the nav entry stays hidden
(fail-closed), but nothing breaks.

### 2. Functions — exactly two, in order

```powershell
firebase deploy --only functions:api
firebase deploy --only functions:getMyNotifications
```

- `api` carries the Express router (incl. the existing `/prep/progress` the
  Journey card reads). Deploy it **alone** first — it is the shared mega-function.
- `getMyNotifications` carries the approved pilot cap (maxInstances 10).

### 3. Hosting — makes the new UI visible

```powershell
firebase deploy --only hosting
```

This ships the Today strip, result Next steps card, prep↔tests loop link and
the Journey practice card.

## Do NOT deploy

- `runStudentCode` (Judge0) — excluded, no exceptions.
- Admission Center functions (10) and Student Portal FEE functions — ON HOLD;
  this branch does not touch them.
- Any blanket scaling changes. CPU/memory unchanged.

## Rollback

Frontend regressions: redeploy hosting from the previous commit.
Rules regression: `firebase deploy --only firestore:rules` from the previous
commit — the old rules only deny the new `config/prep` student read, which
silently hides the Placement Prep nav entry (fail-closed by design).
