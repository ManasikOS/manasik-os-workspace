# TASK-030 Inbox browser acceptance plan

## What

A concrete plan to prove, in a real browser against the staging environment, that every human-facing Inbox flow works and
fails safely for each role. It extends the existing launch-readiness acceptance (LR2) from four narrow areas to the whole human
surface, says which steps are automated and which are done by a person, and maps each result to the checklist boxes it can close.

This is TASK-028 items P3.1 (browser acceptance) and P3.2 (accessibility). It adds tests and a run record. It builds no product
feature. Provider acceptance (P3.3), worker deployment (P3.4) and the rollback rehearsal (P3.8) are separate work.

## Why

The checklist has about 90 slices in flight and 150 unticked boxes, and the same reason recurs on the browser items: "no signed-in
non-production environment" (that environment is now the existing staging project, see TASK-029). The node-only unit suite proves business rules; it does not prove that a button is reachable by keyboard,
that a denied role sees a plain explanation, or that two staff see the same thread. The release rule in the programme is that skipped
is not a pass.

## Depends on

[TASK-029](TASK-029-inbox-non-production-environment.md) (seeded identities and fixtures on staging). **Staging already exists:** the
current Supabase project and Vercel deployment, with no live users. What the run still needs from TASK-029 is the seeded test agencies
and staff (P2.3), the two pending migrations applied (P2.1) and the owner's safe test contacts. The harness refuses to run against
production by project ref; set `INBOX_E2E_ENVIRONMENT=staging`. Tests work only in the two disposable `E2E-` agencies and never edit the
existing agencies. Also needs the Phase 1 pieces merged (they are) so failures are visible in Sentry.

## What already exists

`e2e/inbox-lr2.spec.ts` runs four tests, and `docs/runbooks/inbox-launch-readiness-acceptance.md` defines their steps:

| Area | Steps | Covered by |
|---|---|---|
| Golden human flow (sign in, open, take control, keep a draft, send, internal note) | G1 to G6 | Playwright test 1 |
| Empty state, load failure and retry, closed WhatsApp window, denied role, colleague-owned chat | N1 to N5 | Playwright test 2 (N2 needs a controlled failure fixture) |
| Keyboard and labels | A1 to A5 | Playwright test 4 plus a manual screen-reader pass |
| Two sessions converge after reconnect; no cross-agency disclosure | R1 to R4 | Playwright test 3 |

The harness refuses production by project ref, and the seeder resets fixtures so scenarios repeat.

## What the Inbox does that LR2 does not exercise

The Inbox offers 23 queue views, search, saved views, bulk actions, attachments, templates, saved replies, translation, new
WhatsApp chats, e-mail compose, handoffs, linked lead/booking/quote actions, passport and receipt handling, voice transcripts, a phone
layout, and thirteen keyboard shortcuts. None of that has browser evidence. The plan below adds it.

## Roles under test

Seeded in TASK-029 P2.2. Each step names the roles it must be run as; a step that lists a denied role must show a plain explanation
and make **no** change.

| Key | Who | Purpose |
|---|---|---|
| A1, A2 | Agency A Inbox staff | Normal work; concurrent sessions |
| A_READONLY | Agency A, no Inbox write | Denied-action feedback |
| FIN | Agency A Finance | Receipt copy to Finance, evidence review |
| CEO | Agency A CEO | Read-only on evidence |
| UNPRIV | Agency A Operations or Guide | Denied everywhere it should be |
| B1 | Agency B staff | Cross-agency isolation |

## Acceptance matrix (new steps, in addition to G, N, A, R)

Each ID gets one row in the run record with Pass, Fail or Skipped, an evidence link, the operator and an independent reviewer.
"Auto" means a Playwright test; "Manual" means a person, because it needs judgement, a real device, or a screen reader.

### V. Queues and views (A1; UNPRIV for denied views)

| ID | Check | Mode |
|---|---|---|
| V1 | Every one of the 23 views opens from the rail, shows only its own conversations, and its count matches the list for the open view | Auto |
| V2 | Switching view keeps the address bar and browser Back in step (`?view=`, `?conversation=`) | Auto |
| V3 | A view with no conversations shows the plain empty-state text for that view | Auto |
| V4 | A conversation outside the viewer's agency, opened by address, is not shown | Auto |

### S. Search and saved views (A1)

| ID | Check | Mode |
|---|---|---|
| S1 | Search by a fixture contact finds it; a non-match shows a plain "no results" state; clearing restores the list | Auto |
| S2 | Save a view, reload, find it, apply it, delete it. The 20-view limit message is clear | Auto |
| S3 | Search never reveals an Agency B conversation | Auto |

### O. Ownership and lifecycle (A1, A2, A_READONLY)

| ID | Check | Mode |
|---|---|---|
| O1 | Assign to a colleague from the owner control; ownership updates without reload; A2 sees it | Auto |
| O2 | Release to AI, then take control again | Auto |
| O3 | Close a conversation; it leaves open views and appears under Closed; reopening works | Auto |
| O4 | Create a handoff summary; the receiver acknowledges it once | Auto |
| O5 | A_READONLY sees a plain denied message for each of O1 to O4 and nothing changes | Auto |

### C. Composing (A1; A_READONLY for denial)

| ID | Check | Mode |
|---|---|---|
| C1 | Attach an allowed file; the staged file is shown, sent once, and appears as a media message. A disallowed type or oversize file is refused in plain words | Auto |
| C2 | Send a template from the picker, including one required outside the 24-hour window | Auto |
| C3 | Create a saved reply, insert it, send it | Auto |
| C4 | Translate a customer message; the translation is marked as such and is not sent unless the staff member sends it | Auto |
| C5 | Start a new WhatsApp chat to the **test recipient only**; a number already on file is matched, not duplicated | Auto |
| C6 | Compose an e-mail with subject, cc and bcc to the **test mailbox only**; replying keeps the thread | Auto |
| C7 | Send twice quickly or retry after a dropped response: exactly one message results (idempotency) | Auto |
| C8 | Two staff typing in one conversation see the presence banner; the second is warned before sending | Auto |
| C9 | Copilot suggestion, with AI surfaces **off**: no suggestion is offered and no control is misleading | Auto |

### K. Keyboard shortcuts (A1)

| ID | Check | Mode |
|---|---|---|
| K1 | `j`, `k`, `/`, `r`, `n`, `a` do what the help overlay says, and do nothing while typing in a text box | Auto |
| K2 | `?` opens the overlay; `Escape` closes the topmost panel; focus returns to where it was | Auto |
| K3 | Shortcuts for a denied or unavailable action explain why instead of failing silently | Auto |
| K4 | `g` then `d`, `q`, `e`, `b` open or start only what the role may, and never send or confirm anything | Auto |

### B. Bulk actions (A1; A_READONLY; UNPRIV)

| ID | Check | Mode |
|---|---|---|
| B1 | Select several conversations; the selection bar shows the count; the 50-item limit is explained | Auto |
| B2 | Bulk assign and bulk close change exactly the selected rows | Auto |
| B3 | Bulk mark as spam asks for confirmation; the rows move to Spam; restore from the Spam view works | Auto |
| B4 | A mixed selection where one row is not permitted changes **none** (fail closed) and says why | Auto |

### M. Phone and small screens (A1)

| ID | Check | Mode |
|---|---|---|
| M1 | At 375 px: the list shows first, opening a chat shows the thread, Back returns to the list | Auto |
| M2 | At 320, 375, 768, 1024 and 1440 px: no horizontal page scroll, clipped or overlapping control | Auto |
| M3 | On a real phone (iOS Safari and Android Chrome): M1 and the composer with the on-screen keyboard | Manual |

### X. Customer context and conversion (A1, FIN, UNPRIV)

| ID | Check | Mode |
|---|---|---|
| X1 | The recommended next action shows one action, routes only to an editable draft or a preview, and states the prerequisite when unavailable | Auto |
| X2 | Linked lead, booking and departure-group links open for allowed roles and are absent or explained for denied ones | Auto |
| X3 | A conversion preview never creates work or moves money until the confirm step; cancel leaves nothing behind | Auto |

### F. Finance and media (A1, FIN, CEO, UNPRIV)

| ID | Check | Mode |
|---|---|---|
| F1 | Receipt card: FIN sees "Copy to Finance"; others see why they cannot; a repeat click converges on the same item; the text says no payment is created or verified (FIN-03) | Auto |
| F2 | Finance review list: FIN can match or dismiss with a reason; CEO is read-only; UNPRIV is denied; the deep link highlights the item (FIN-05) | Auto |
| F3 | Passport card: review, save to Documents, apply details, assign a visa officer; originals stay private | Auto |
| F4 | Voice note: pending, complete, low-confidence, failed and disabled transcript states show beside working original playback for an allowed and a denied role (MED-03) | Auto + Manual (audio) |
| F5 | Brochure routing: allowed and denied destinations, the saved state, the Office-file limitation note, a repeated click; nothing is ever published or sent (MED-04) | Auto |
| F6 | Owner outcomes panel: each count opens the exact permitted rows; empty, delayed and partial states are explicit (OUT-02) | Auto |

### A+. Accessibility additions (extends A1 to A5)

| ID | Check | Mode |
|---|---|---|
| A6 | An automated axe scan of `/inbox` in each of V, composer open, dialog open, bulk selection and phone layout: zero serious or critical findings | Auto (add `@axe-core/playwright`) |
| A7 | Screen-reader pass (NVDA on Windows, VoiceOver on iOS or macOS): the thread is exposed as a log, new messages and feedback are announced, status is not colour-only | Manual |
| A8 | Contrast of text and focus indicators at 4.5:1 in light and dark themes | Auto (axe) + Manual |
| A9 | Focus returns to the trigger after every dialog and sheet used above | Auto |

## How the tests are built

- **New spec files** beside `inbox-lr2.spec.ts`, one per group (`inbox-views.spec.ts`, `inbox-composer.spec.ts`, and so on), sharing the
  existing config parser and fixtures. The `testMatch` in `playwright.config.ts` becomes a list.
- **Selectors use accessible roles and names**, the way a person finds a control. If a control cannot be found that way, that is an
  accessibility defect to log, not a reason to add a test id.
- **Each test starts from reset fixtures** (the seeder's re-run behaviour), signs in with a stored session per role (Playwright
  `storageState`, produced locally and never committed), and cleans up what it created.
- **Send safety:** every send in C and F goes to the Meta test number or the test mailbox. The harness aborts a test whose target is not
  on a short allow-list read from the environment. If the optional outbound allow-list from TASK-029 is built, it backs this up in the
  app itself.
- **Failure evidence:** screenshot, trace and video on failure (already configured). Evidence links go in the run record; screenshots
  that might contain personal data stay in protected storage, not git.
- **Retries:** one retry in CI, none locally. A test that passes only on retry is recorded as a defect (flaky), not a pass.
- **Run order:** isolation first (R4, S3, V4), then read-only groups (V, S, K, M, A+), then groups that change data (O, C, B, X, F).
  Reset fixtures between data-changing groups.

## Run procedure

1. Confirm the deployed build is the release candidate: record the commit SHA, URL, Supabase project ref and the worker version
   (TASK-028 P3.5). Local source is not evidence.
2. Reset fixtures; confirm Agency A and Agency B are separate and seeded.
3. Run the automated groups. Record each ID.
4. A named operator performs the manual steps (M3, A7, A8, F4 audio), with the browser, device and screen-reader versions recorded.
5. An **independent reviewer** (not the operator) checks the evidence for every row and signs the record.
6. Failures: file each as an issue with the ID, role, expected, observed and evidence. Fix in its own PR, then re-run **that group and
   the isolation group**, not just the failing step.

**Stop immediately** (and follow the rollback procedure before continuing) on any cross-agency data, any duplicate or unauthorised
send, or a misleading payment or booking confirmation. This is the rule already in the LR2 runbook.

## Where results go

- A dated record in `docs/progress/` (IDs, pass/fail, evidence references, versions, operator, reviewer), with no customer content.
- Checklist boxes in [`docs/inbox/checklist.md`](../inbox/checklist.md) are ticked **only** for flows actually demonstrated, in the same
  PR as the record, using this mapping:

| Result | Can close |
|---|---|
| F1 | FIN-03 browser acceptance |
| F2 | FIN-05 browser acceptance |
| F4 | MED-03 browser verification |
| F5 | MED-04 browser verification |
| K1, K2 | PRD-01 and PRD-02 browser keyboard acceptance |
| B3, B4 | PRD-03 browser confirmation test |
| F6 | OUT-02 browser drill-down |
| X1 | STF-01 browser acceptance (already shown once on a fixture; repeat on the release candidate) |
| G, N, A, R, V to M, A+ all pass | TASK-028 P3.1 and P3.2 exits |

A box whose exit is not fully met stays unticked with the reason written beside it.

## Pass criteria

- Every ID above has a Pass, a documented waiver signed by the owner, or the release does not go. **Skipped is a blocker.**
- Zero critical accessibility findings (a keyboard trap, an unnamed critical control, lost dialog focus, an inaccessible critical action,
  or a misleading status).
- Zero cross-agency disclosure and zero duplicate or unauthorised sends across the whole run.
- Each denied-role step shows a plain explanation and changes nothing.

## Code changes (each its own PR, none are product features)

1. Fixture and identity additions (shared with TASK-029): receipt, passport, voice note, departure group, payment-claim review, a
   disallowed file, an oversize file, and a controlled load-failure switch for N2.
2. The new Playwright spec files, `playwright.config.ts` `testMatch` list, and the `@axe-core/playwright` dev dependency.
3. A small helper that signs in per role and stores the session.
4. A `docs/runbooks/` update: the new steps appended to the acceptance runbook and the record template extended with the new groups.

## Decisions needed from the owner

1. **Independent reviewer:** who signs the record (must not be the operator).
2. **Device and browser matrix:** the plan assumes Chromium automated, plus iOS Safari and Android Chrome by hand, plus one desktop
   Safari or Firefox pass for the golden flow. Confirm or trim.
3. **Screen reader:** NVDA on Windows and VoiceOver on iOS, as assumed? Who runs it?
4. **Waivers:** is any step allowed to be waived for the interim release (human-only, AI off)? C9 and F4 are the likely ones.

## Estimate

About 5 working days of test writing (can start now), then 2 to 3 days to run and review once the environment exists, plus the time
to fix what it finds.

## Status

In progress. Most of the automated groups are written and merged or in review; none has been run against a real build.

- **Merged** (PR #196, read-only groups): V1, V2, V4, S1, S3 (`e2e/inbox-views-and-search.spec.ts`); K1, K2, M1, M2 at five widths
  (`e2e/inbox-keyboard-and-responsive.spec.ts`); A6 and A9 (`e2e/inbox-accessibility.spec.ts`), using `@axe-core/playwright`.
- **Written, in review** (data-changing groups): O1, O2, O3, O5, B1, B2, B3 (`e2e/inbox-ownership-and-bulk.spec.ts`); C1, C2, C3, C7
  (`e2e/inbox-composer.spec.ts`). These send real messages and change conversations, so they run only against staging, in the disposable `E2E-` agencies, serially,
  after the fixtures are reset. Playwright collects 32 tests in 6 files.
- **Not run.** They have never executed against a deployed app, so selectors and expected text were taken from the source and may
  need adjusting on the first real run. Expect some first-run fixes; that is normal, not a defect in the plan.
- **Needs from TASK-029:** fixture variables `INBOX_E2E_A_SEARCH_TERM`, `INBOX_E2E_B_SEARCH_TERM`, `INBOX_E2E_A2_NAME` (Staff A2 as shown
  in the owner picker) and `INBOX_E2E_TEMPLATE_NAME` (an approved template). A test whose variable is missing fails with a message
  naming it; it never skips. Also: Agency A needs at least three plain conversations in the All view and an empty Spam view at the
  start of the bulk tests.
- **Not written, with the reason:** O4 (handoff needs a confirmed-booking fixture); B4 (the mixed-selection rule must be read first and
  needs a fixture the server refuses to change); the 50-conversation bulk limit (unit-tested, because it needs 51 conversations); C4
  (translation calls an AI provider); C5 and C6 (need a test recipient number and a test mailbox); C8 (presence, partly covered by the
  LR2 coworker test); C9 (needs AI flags set per run); K3 and K4; S2; V1's rail-count check; M3, A7 and A8 (manual).
- **Groups X and F** (customer context, conversion previews, Finance and media cards) are not started: they need the receipt, passport,
  voice-note, departure-group and payment-claim fixtures from TASK-029 P2.2.
- **Next:** wait for the environment, run what exists, fix the first-run failures, then write X and F.
