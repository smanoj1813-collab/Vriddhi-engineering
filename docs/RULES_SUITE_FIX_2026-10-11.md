# Full rules suite: the first nightly run and the two bugs it caught (2026-10-11)

The nightly workflow added in PR #6 ran for the first time against `main`
(`ff406e1`) on 2026-10-11 09:09 UTC and failed. It was not a flake and not a
setup problem: **5 of 94 tests in `functions/test/firestore.rules.test.ts`
fail**, and two of those failures are live production bugs.

Both are fixed on `arena/549ffacf-vriddhi-engineering`; the suite is green there
(94/94, run 38135278924). Reproduce/inspect with:

```bash
gh run list --workflow rules-diagnostics.yml --limit 5
gh api repos/smanoj1813-collab/Vriddhi-engineering/check-runs/<jobId>/annotations
```

## Why nobody had seen it

`ci.yml` runs only `npm run test:rules:course-security` — a
`--test-name-pattern` slice (scheme packs, course assignments, mentors,
calendar, employees). Everything else in the 2,428-line rules test file ran for
the first time in CI on this nightly. The slice passed on the merge commit, so
PR #6 looked green.

## Bug 1 — the 1,000-expression budget silently denies valid writes

Four of the five failures came back as
`Unable to evaluate the expression as the maximum of 1000 expressions to
evaluate has been reached`, on `staffAttendance` create/update and the payslip
review update.

Firestore caps a request at **1,000 evaluated expressions**, and exceeding it
denies the request with the same client-visible error as a real denial
(`Missing or insufficient permissions`). The identity helpers were the cost:

- `canonicalRole()` walked ~30 alias comparisons on **every** call.
- `role()` / `claimedRole()` re-enter it, and they are called repeatedly —
  `isStaff()` → `isCollegeStaff()` → `tenantWrite()`, which compound write
  rules call **twice** (old and new document), plus a leading `isSuperadmin()`
  that pays an `exists()` lookup before the claim has been consulted.

Fix (all behaviour-preserving):

| Helper | Before | After |
| --- | --- | --- |
| `canonicalRole` | alias chain first | canonical spellings return early; chain only for legacy imports |
| `isCollegeStaff` | `isStaff() && (isSuperadmin() \|\| collegeId() != null)` | `(collegeId() != null \|\| isSuperadmin()) && isStaff()` |
| `tenantWrite` | `isSuperadmin() \|\| (…)` | `(isCollegeStaff() && sameCollege(data)) \|\| isSuperadmin()` |
| `isFinance` / `isOps` / `isBackOffice` / `isFinanceData` / `isPayrollAccounts` / `isPayrollApprover` | `isSuperadmin() \|\| (claim test)` | `(claim test) \|\| isSuperadmin()` |

`||` and `&&` are commutative, so the results are identical; only the order of
evaluation changed. Every reordered helper takes either the path's `collegeId`
or a document that exists on that path (the two `tenantWrite(resource.data)`
call sites are an `update` and a `delete`), so no branch can now throw where a
superadmin short-circuit used to save it.

**Production impact:** payslip writes are client-side
(`src/modules/admin/api/payrollApi.ts`), so accounts/principal payroll actions
were being denied in production. `staffAttendance` client writes had already
been retired in favour of the `saveMyStaffAttendance` callable, so there the
rules were only defence-in-depth.

## Bug 2 — `prep_paper_answers` was unreadable by design-by-accident

```
Property rejected is undefined on object.
```

The rule tested `resource.data.rejected != true`. **No such field exists** —
rejection is a `status` value (`'draft' | 'published' | 'rejected'`, written by
`functions/src/routes/prep.ts`). Reading a key that is not present is a rules
*error*, not `false`, so the read rule denied every published model answer.
Students could not open a single PYQ model answer.

Fix: `resource.data.status == 'published' && (!('rejected' in resource.data)
|| resource.data.rejected != true)` — status stays the gate, the membership
check keeps the author's extra guard meaningful if a legacy document ever
carries the flag.

## Follow-ups

1. **Deploy the rules.** The merge alone does not fix production:
   `firebase deploy --only firestore:rules --project vriddhi-engineering`
   (rules → indexes → functions → hosting is the documented order; this PR
   needs the rules step only).
2. **Watch the nightly.** It should be green the morning after the merge.
   Failure names now arrive as check-run annotations and as a
   `rules-suite-log` artifact, so a red night is diagnosable without the log
   viewer.
3. **Budget discipline for new rules.** The 1,000-expression ceiling is
   per-request, shared by every expression a statement evaluates. New write
   rules should follow the claim-first ordering above (`cheap token test ||
   exists() fallback`) and avoid calling the identity helpers more than
   necessary; a compound create+update in one Write stream can be counted
   together.
4. **Consider promoting the slice.** The course-security slice passed while
   these five failed. If runtime allows, widen per-PR CI
   (`npm run test:rules`) or add a second slice covering the write-heavy
   collections (staffAttendance, payslips, prep answers).
