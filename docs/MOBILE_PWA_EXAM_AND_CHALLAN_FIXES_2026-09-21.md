# Phone PWA: mobile shell, exam clipboard lock, student challan data

Reported from a real install of the Vriddhi PWA on a phone (student portal).
Three separate problems, all fixed here.

---

## 1. "The UI is still in desktop site mode"

Two different causes were stacked on top of each other, so both are addressed.

### 1a. The student portal had no phone navigation

`StudentSidebar` was one 18-row list, shown as a slide-over drawer behind a
hamburger on phones. Everything else on the portal assumed a mouse: no tab bar,
no thumb-height targets, and the AI chat launcher parked on top of whatever
chrome did exist.

Now the student shell is phone-first:

| Piece | File | What it does |
| --- | --- | --- |
| Compact app bar | `src/modules/student/components/StudentTopBar.tsx` | Current page name, theme toggle, notification bell with unread count. Notch-aware (`env(safe-area-inset-top)`), `md:hidden`. |
| Bottom tab bar | `src/modules/student/components/StudentBottomNav.tsx` | Dashboard · Assessments · Fees · Notifications · More. `aria-current`, 52px+ targets, active indicator, sits above the home-indicator area. |
| "More" sheet | `src/modules/student/components/StudentMoreSheet.tsx` | The remaining 14 destinations as tiles in four groups, plus language, theme, install and sign-out. Bottom sheet with backdrop, Esc/backdrop dismiss, body-scroll lock. |
| Shared nav model | `src/modules/student/studentNav.ts` | One list feeds the rail, the tab bar and the sheet (with route aliases and `findNavItem()` longest-prefix matching), so a new page is registered once. |

`StudentSidebar` keeps the desktop rail (collapsible, auto-expands below
1100px) and no longer renders mobile markup, so there is exactly one way to
navigate per form factor.

### 1b. Chrome's "Desktop site" toggle, which the installed app inherits

`index.html` already sent a correct `viewport` meta — but when the browser's
*Desktop site* switch is on, Chrome ignores the page's viewport entirely and
lays the app out at ~980px. Every `@media (max-width: 767px)` rule then fails
to match, and the app looks like a shrunken website. Nothing in the page can
undo that, so the app now detects it and explains it:

* `src/shared/utils/viewportMode.ts` — `isDesktopLayoutOnPhone()` compares the
  layout viewport with the device's own width (`innerWidth ≥ screen.width ×
  1.6` on a coarse-pointer/mobile-UA device) and `subscribeToViewportMode()`
  tracks rotation, resizes and display-mode changes.
* `src/shared/components/DesktopViewNotice.tsx` — a dismissible card above the
  tab bar: "Desktop view is switched on … untick *Desktop site*", remembered for
  14 days.

### 1c. Global mobile polish (`src/index.css`, `index.html`, manifest)

* `-webkit-text-size-adjust: 100%` (no font jump on rotation / focus).
* `touch-action: manipulation` on controls — removes the 300 ms tap delay.
* Phones wrap long strings (`overflow-wrap: anywhere`) — a 30-character challan
  number used to widen the whole page, which reads as "desktop layout".
* Tables inside `.overflow-x-auto` / `.table-container` get tighter padding and
  a smaller body size below 768px, so the common student tables fit a phone.
* Scrollbars hidden on `pointer: coarse`; momentum scrolling kept.
* `env(safe-area-inset-*)` utilities (`.safe-area-bottom`, `.pb-float`) and
  sheet/`fadeIn` keyframes used by the new mobile surfaces.
* `interactive-widget=resizes-content` in the viewport meta: on Android the
  on-screen keyboard now resizes the layout instead of covering the answer box.
* A `@media print` block (`.print-sheet` / `.print-hide`) so a document opened
  on the phone prints as the document, not as the app around it.
* Manifest: `display_override: [standalone, minimal-ui, browser]`, `purpose: any`
  icons alongside the maskable one, and three app-icon **shortcuts** (My Tests,
  Fees & Challans, Attendance). `orientation: portrait` is kept on purpose — a
  mid-test rotation reflows the question card and the thumb bar.

---

## 2. "I could paste the answer from the clipboard during the test"

The block existed but could not work:

1. Every clipboard listener was behind `if (!proctored) return`, so any test
   without the proctoring flag accepted pasted answers.
2. The listeners were bubble-phase `document` handlers for `paste` / `copy` /
   `contextmenu` only. On a phone that misses the paths students actually use:
   the long-press **Paste**, the keyboard's **clipboard chip** (Gboard/SwiftKey
   commit it as a plain `insertText`, so no `paste` event ever fires), and
   **drag-and-drop** of a selection.

`src/shared/utils/examLockdown.ts` replaces them with one lockdown that is
installed for **every** attempt (`ActiveTestPage`), independent of proctoring:

* capture-phase `paste`, `copy`, `cut`, `drop`, `dragover`, `dragstart`,
  `selectstart`, `contextmenu`, `keydown`;
* capture-phase `beforeinput`, which is what actually catches mobile inserts:
  `insertFromPaste` / `insertFromDrop` / `insertFromYank` are cancelled, and a
  single `insertText` that is ≥ 24 characters or carries a newline is treated as
  a clipboard commit and cancelled (`isSuspiciousBulkInsert`);
* `shouldBlockKeydown` covers Ctrl/Cmd + `c v x a p s u j`, the Shift variants,
  F12, PrintScreen and Alt+Tab;
* a scoped stylesheet removes `-webkit-touch-callout` and text selection from
  the exam surface (question text can no longer be long-pressed and copied)
  while leaving the caret and selection alive **inside** the answer fields, so
  editing still works;
* if the browser exposes clipboard read permission, the pre-copied payload is
  cleared once at lockdown start.

Deliberately **not** blocked: `insertCompositionText` and
`insertReplacementText`. Kannada / Tamil / Telugu / Malayalam / Hindi medium
students type through transliteration IMEs; blocking composition would make
their answers impossible, and those insertions are per-segment, not clipboard
shaped.

`QuestionRenderer` also gained `lockClipboard`, which puts `onPaste` /
`onCut` / `onCopy` / `onDrop` / `onContextMenu` plus `spellCheck={false}`,
`autoComplete="off"` and `autoCorrect="off"` directly on every answer field, so
a paper rendered outside the exam page is still covered. Proctoring still
decides whether an event is *reported* to faculty; the block itself is not
optional. Instructions and the enter-gate screens now state the rule for
unproctored tests too.

Proved by tests, in both directions:

* `src/shared/utils/examLockdown.test.ts` — pure decision logic (8 cases).
* `scripts/render-check/run.mjs` — "Exam clipboard lockdown" section: 11 DOM
  checks in jsdom, including *teardown returns the clipboard* and *IME
  composition still works*, plus a mount check that the answer field itself
  cancels a paste.

---

## 3. "Challans in the student portal — where does the data come from?"

Challans live in `colleges/{collegeId}/challans`, written by the finance desk
(`feeApi.createChallan`) and read directly by the client — and that read was
**denied for everyone**: the collection had no `match` block, so the
`match /{document=**} { allow read, write: false }` catch-all in
`current-firestore.rules` answered every query, on the admin page and on the
student page alike. The admin hook swallowed the failure into `console.error`,
so the student portal showed a permanent "No challans yet" for rows that did
exist.

* **Rules** — added `colleges/{collegeId}/challans/{docId}`: college staff read
  the college's list; a student may only `get`/`list` rows whose `studentId`
  resolves to their own student record (the same `ownsStudentId` shape
  `feePayments` already uses, with the `studentId` predicate always carried by
  the client query); `create` demands a student, a non-negative amount and
  `status: 'generated'`; `update` may not rewrite the addressee or the amount,
  and only `admin`/`hod`/superadmin may verify. Students can never move their
  own challan to `verified`.
* **Declaring a payment (there is no upload)** — a student owns exactly one
  transition: `generated` / `rejected` / `expired` → `paid_at_bank`, and the rule
  admits only `status`, `bankReferenceNo`, `studentRemarks`, `paidAt`,
  `updatedAt` (`diff().affectedKeys().hasOnly([...])`, with the reference matching
  the same `^[A-Za-z0-9/-]{6,40}$` the client validates). The bank keeps the
  physical stamped copy for its own audit; a photograph added at the counter
  proves nothing about who handed it in and would turn the portal into an image
  host. `bankStampUrl` stays an office-filled field for the desk's own record,
  and `storage.rules` deliberately has no challan path — a student upload there
  would be rejected.
* **API** — `feeApi.getCollegeId(explicit?)` / `collegeRef(path, collegeId)`
  accept a caller-supplied tenant, so the student page resolves the college from
  its own profile instead of the admin module's `localStorage` key;
  `fetchChallans`/`fetchChallanById` take `collegeId`, `mapChallan` is exported,
  and new challan rows now carry `collegeId` like the fee rows do.
* **Student feed** — `src/modules/student/hooks/useMyChallans.ts`:
  student-scoped query, `loading` / `error` / `refresh`, counts and overdue
  derivation, and *human* failures — a `permission-denied` says the rules need
  deploying, an offline error says to retry, and a missing student record says
  the login is not linked (instead of firing a query the rules would reject).
* **Page** — `StudentChallans.tsx` is now a phone-first list: money-led
  summary (₹ payable is the headline, not a count), scrollable status chips
  with counts, per-status guidance (`generated` → print & pay, `rejected` →
  visit the office, `verified` → bank ref + paid), skeletons while loading, an
  explicit error card with a retry, and the challan itself in a bottom sheet on
  phones (`print-sheet`, so "Print / PDF" produces the 3-copy slip).
* `useChallanData` now surfaces `error` too, and `ChallanManagement` shows it —
  the same silent-empty-table failure on the admin side.

The student therefore never re-keys a number at the desk and the office never
loses the audit trail: `useMyChallans.declare()` files the reference, and
`ChallanDetailModal` in `ChallanManagement.tsx` shows it under "Declared by the
student — awaiting verification" and prefills the bank-reference input, so the
desk confirms instead of typing a 16-character UTR from a photograph.

Covered by the render checks: "student challans" mounts the page against two
seeded documents (one awaiting payment, one filed from the phone) and asserts the
challan number, the amount, the due date, the status, the three-copy sheet, the
amount in words, the bank account, the "I paid" sheet (reference field present,
no file input, submit disabled while empty) and that only an unpaid challan offers
the declaration — plus an empty-state check when nothing has been issued, and a
group that pins `declareChallanPaidAtBank`'s write path and payload keys against
what the rule allows.

---

## 4. Two follow-ups from the same phone trial (22 Sep)

**The tab-switch tally is gone from the student's header.** The running
"`2 warnings`" chip and the "`Tab switches left: 3`" chip are removed. Counting,
the faculty live log, the limit auto-submit, the alert fired on the switch itself
and the at-limit dialog all stay — what a student sees is only what they can act
on. A visible counter is a scoreboard they cannot influence: leaving the tab is
being noticed either way, and showing the remaining budget on a phone turned a
proctoring detail into a source of panic during the paper.

**The 30-second section break now plays once per section, not once per crossing.**
`navigateToIndex` used to gate *any* change of `sectionId`, so A → B → A cost a
minute of exam time and penalised the reviewing the question palette invites.
`src/modules/student/examSectionBreaks.ts` holds the rule (`shouldPlaySectionBreak`)
plus `enteredSectionsFromAnswers`, so it is unit-tested instead of being buried in
the page: a section is gated the first time the student lands in it and open
afterwards in both directions. "Already entered" is seeded from the saved answers
— `visitedAt` is written when a question is opened — because the set has to
survive a reload; otherwise a refresh would bill a section the student had
already worked through. The opening section is marked entered on load, since the
student is standing in it rather than crossing into it.

**The dashboard's quick actions are grouped.** 13 tiles in a `grid-cols-3` block
read as a wall on a phone, so they are now four short lists under the headings the
phone "More" sheet already uses (`groupTilesByNavSection` in `studentNav.ts`).
The tiles own their route, icon and label; the *group* comes from the nav model,
which is the point: neither surface can file a page under a different heading, and
a route the model does not know falls into a trailing "More" block rather than
disappearing from the dashboard.

```bash
npm run test:unit     # + examSectionBreaks (6) and studentNav grouping (6) cases
```

## Deploy note

The challan fix is **rules**, so it needs a rules deploy before students see any
challans:

```bash
npm run deploy:rules     # firestore:rules + storage, project vriddhi-engineering
npm run deploy:hosting   # the PWA build
```

Because the service worker precaches the build and `skipWaiting` is false,
phones pick the new bundle up through the existing "Update available" prompt —
worth telling students to tap it once, rather than relaunching the app.

## Verification run

```bash
npm run test:unit                                            # + examLockdown cases
npm run test:render                                          # + lockdown & challan checks
npm run check:dead-code
npx tsc --noEmit && npm run build
```
