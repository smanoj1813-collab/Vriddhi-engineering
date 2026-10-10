# Materials storage fix + Drive-link submissions (2026-09-21)

**Problem found in the 2026-09-21 audit:** `storage.rules` (the claims-only
rewrite) was missing a path contract for
`colleges/{collegeId}/materials/`. Every faculty material upload was therefore
**denied by the Storage rules**, and the client's "fallback" silently embedded
the whole file as a base64 data URL inside the Firestore material document —
7× the per-GB cost of Storage, plus Firestore's 1 MiB document cap made every
file over ~700 KB fail to save at all (the UI advertised 15 MB images and
100 MB videos).

This change fixes that, adds size validation, adds a **Google Drive link
option** for student assignments (zero stored bytes for large work), and adds
the retention + cost-visibility tooling.

---

## What changed

### 1. Storage rules — the fix (`storage.rules`)
New path contract `match /colleges/{collegeId}/materials/{fileName=**}`:
- **read** — same-college staff **and students** (mirrors the Firestore
  `materials` collection rules), plus superadmin for any tenant.
- **write** — same-college staff only; 50 MB cap; teaching-material MIME
  allowlist (pdf, doc/docx, ppt/pptx, images, mp4/mov/webm).
- **delete** — same-college staff or superadmin.

Rules tests added: `functions/test/firestore.rules.test.ts` →
`describe('teaching materials storage')` (tenant isolation, student
read/no-write, superadmin read, MIME rejection, 51 MB oversize rejection).

### 2. Client validation (`FacultyUploadMaterial.tsx`)
- Per-type size caps enforced **before** upload (25 MB pdf/doc/ppt, 15 MB
  image, 50 MB video) with a readable error instead of a server deny.
- The base64 fallback now only applies to files **≤ 300 KB** (the only size
  that can ever fit a Firestore doc with 33% inflation headroom). Larger
  files get an explicit "Storage failed, retry or use a link" error.
- UI copy corrected (video 100 MB → 50 MB).

### 3. Google Drive link submissions (students)
Students can now attach **up to 3 Google Drive file links** (in addition to,
or instead of, uploaded files) in `AssignmentUploadModal`:
- Only canonical `https://drive.google.com/file/d/{id}/view` links are
  accepted — client (`src/shared/utils/driveLink.ts`, unit-tested) **and**
  server (`normalizeDriveFileUrl` in `functions/src/studentPortal.ts`,
  unit-tested). Everything else — other domains, folders, `uc?id=`, other
  schemes — is rejected. Faculty click these links, so the allowlist is a
  security boundary, not just a UX nicety.
- Stored on the submission as `kind: 'driveLink'` attachments — **zero bytes
  in our bucket**.
- Faculty review UI (`FacultyAssignments.tsx`) renders Drive attachments as
  "open in Drive" external links; uploads keep the existing download flow.
- Server-side `finalizeMyAssignmentSubmission` verifies uploaded objects
  exactly as before and skips bucket checks for Drive links (validated by
  shape only). Link cap: 3 per submission.

Student UX note: the file must be shared in Drive as
**Anyone with the link → Viewer**. The modal says so.

### 4. Ops scripts (dry-run by default, `--apply`/`--write` to execute)
- `functions/scripts/migrate-materials-base64.mjs` — one-time migration of
  existing base64-embedded material docs into Storage (deterministic target
  path, idempotent, updates `fileUrl` + `storagePath`).
- `functions/scripts/set-storage-lifecycle.mjs` — sets GCS lifecycle rules:
  `assignment-submissions/` and `paper-files/` **auto-delete after 365 days**
  (materials and prep-media intentionally excluded — college-owned /
  published content).

### 5. CI (`.github/workflows/ci.yml`)
Added the **security-rules emulator suite** (`npm run test:rules`) to the
functions job — a broken `storage.rules`/`current-firestore.rules` edit now
fails the build. (Needs Java; ubuntu-latest ships with it. Local sandboxes
without Java cannot run this suite.)

### 6. Tests
- `src/shared/utils/driveLink.test.ts` (11 tests, added to `test:unit`).
- `functions/test/submissionDriveLink.test.ts` (5 tests, added to functions
  `test:unit`).
- 3 new storage-rules cases (run via `test:rules` in CI).
- Full local run: frontend 197/197, functions 661/661, tsc clean both
  sides, prod build clean, dead-code scan clean.

---

## Deploy order (important)

1. **Deploy the functions first** (`npm run deploy:functions`) — the
   finalise callable must understand `kind: 'driveLink'` before students can
   submit links (old functions would reject the new payload shape… actually
   old functions reject it as "does not meet upload policy", so new frontend
   + old functions = links break; uploads keep working either way).
2. **Deploy the rules** (`npm run deploy:rules`) — this is the fix that makes
   faculty material uploads land in Storage again. Until this deploy, new
   uploads still fall back to base64 (≤ 300 KB) or error out (> 300 KB).
3. **Deploy the hosting build** (`npm run deploy:hosting`).
4. **Run the migration** (needs a service account — never commit it):
   ```
   node functions/scripts/migrate-materials-base64.mjs            # dry-run
   node functions/scripts/migrate-materials-base64.mjs --apply
   node functions/scripts/migrate-materials-base64.mjs            # confirm 0 left
   ```
   After the migration, verify a few materials open in both the student and
   faculty views.
5. **Apply the lifecycle rules:**
   ```
   node functions/scripts/set-storage-lifecycle.mjs          # show current
   node functions/scripts/set-storage-lifecycle.mjs --apply  # set 365-day expiry
   ```

## Cost-visibility (do once, 5 minutes in the console)

Google Cloud Console → **Billing** → **Budgets & alerts** → create a budget
on the vriddhi-engineering project with alerts at **₹500** and **₹2,000**
per month. The realistic steady-state cost at current scale is a few hundred
rupees (Storage bytes + egress); the AI usage in paper parsing is the only
line that can move fast, and `ai_usage` telemetry already tracks it.

## Known follow-ups (not in this change)

- No frontend ESLint / `npm audit` gate yet — the dependency vulnerabilities
  from the audit (xlsx, pdfjs-dist, @xmldom, firebase-admin) are the next P0.
- Drive-link attachments cannot be previewed in-app (they open in Drive) —
  acceptable trade for zero storage cost.
- If colleges later demand permanent records of submissions, revisit the
  365-day lifecycle for `assignment-submissions/` (it is a one-flag change in
  the script).
