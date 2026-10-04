# Inbox launch-readiness acceptance (LR2)

This is the staffed acceptance companion to the automated LR2 browser suite in
`e2e/inbox-lr2.spec.ts`. Together they cover LR2 in
[`launch-readiness-implementation-plan.md`](../inbox/launch-readiness-implementation-plan.md).
Run `npm run test:e2e` first against the same named non-production fixtures.
Use this procedure to capture the screen-reader and independent-review evidence
that an automated browser runner cannot provide.

Mocked sessions and component tests cannot replace this suite: it exercises
the deployed application, Supabase RLS, provider boundary, and Realtime
subscriptions together.

## Safety and evidence

- Run only against the named staging or disposable project. Never production.
- Use distinct disposable Agency A and Agency B; do not use customer data or
  customer provider contacts.
- Use the test contact and connected sandbox provider stated in the evidence
  record. Confirm before any external send.
- Keep credentials, access tokens, customer message text, and raw screenshots
  containing personal data out of git. Link to protected evidence instead.
- Record failures exactly as observed. A skipped step is not a pass.
- Stop immediately for cross-agency data, an unauthorized/duplicate provider
  send, or a misleading payment/booking confirmation; follow the release
  rollback procedure before continuing.

## Preconditions

Use the current deployed candidate; local source alone is not evidence.

| Fixture | Minimum state |
| --- | --- |
| Agency A | Disposable agency with Inbox migrations applied, a connected test channel, and open-window, closed-window, and Staff A2-owned conversations. |
| Agency B | Separate disposable agency with a distinctive conversation/contact that must never appear in Agency A. |
| Staff A1 | Eligible Agency A staff member who can take control, reply, note, and send. |
| Staff A2 | Another eligible Agency A staff member, used concurrently with A1. |
| Staff A-readonly | Agency A staff member denied Inbox write/take-control capability, or documented equivalent. |
| Provider fixture | Test-only contact plus provider delivery/status path; record the provider message ID for any send. |
| Failure fixture | Environment-safe way to make initial Inbox loading fail, then recover; never manufacture this in production. |

Record in protected release evidence: date/timezone, candidate commit and
deployed URL, Supabase project ref, protected IDs for the two agencies and
three staff identities, test contact/channel, browser versions/viewports,
operator, and independent reviewer.

## Golden human Inbox flow

Perform as Staff A1 in Agency A. Capture beginning/end screenshots or video,
and the provider/delivery evidence.

| # | Action | Expected result |
| --- | --- | --- |
| G1 | Sign in and open `/inbox`. | Inbox loads for Agency A; Agency B data is absent. |
| G2 | Select the known open-window conversation. | Thread, owner state, channel state, and composer match the selection. |
| G3 | Take control of an assistant/unassigned conversation. | Clear confirmation identifies Staff A1; ownership updates without reload. |
| G4 | Enter a distinctive draft, wait for normal draft saving, visit another conversation, then return. | Draft is restored and has not sent. |
| G5 | Send a distinctive, safe test reply. | Understandable sending/result state; exactly one message; provider/delivery state is observed and recorded. |
| G6 | Add a distinctive Internal note and refresh/reopen. | The note is visibly distinct from customer content and appears once. |

For G5, record the canonical Inbox message ID and provider/delivery reference.
A queued-but-unconfirmed delivery fails the delivery observation step.

## State and failure feedback

Use real session state and fixtures, never a mocked component.

| # | Scenario | Expected result |
| --- | --- | --- |
| N1 | Open an Agency A queue with no conversations. | Plain-language empty state; usable layout. |
| N2 | Use the controlled initial-load failure fixture, restore normal service, then retry. | Plain-language recovery feedback; no internal errors or Agency B data. |
| N3 | Open the closed-window WhatsApp conversation and attempt a free-form reply. | Explains why it cannot send and offers only allowed next actions; no provider send. |
| N4 | Sign in as Staff A-readonly and invoke a denied control. | Understandable denied-permission feedback; no mutation. |
| N5 | As A1, open the conversation owned by A2 and use the normal response path. | Ownership notice identifies the colleague and explains the policy; behavior matches it. |

Capture each result and conversation ID in protected evidence. For N2, record
the safe failure/recovery method; never copy stack traces, tokens, or customer
content into the release record.

## Accessibility acceptance

Run as A1 at 320 px, 768 px, 1024 px, and 1440 px. Use NVDA, VoiceOver, or an
equivalent screen reader and record its version.

| # | Check | Pass condition |
| --- | --- | --- |
| A1 | Keyboard-only traversal | Tab/Shift+Tab reach rail, list, thread controls, composer, note, and panel in a sensible order; each has visible focus. |
| A2 | Dialogs/sheets | For each dialog/sheet used above, focus moves inside, stays inside while open, Escape closes where applicable, and focus returns to its trigger. |
| A3 | Labels/errors | Composer, draft, note, take-control, failure, and retry controls have accessible names; help/error text is associated with its control. |
| A4 | Landmarks/context | Screen reader exposes meaningful landmarks/headings and announces selection, ownership/channel state, and new feedback without colour alone. |
| A5 | Responsive layout | No horizontal page scroll, clipped control, overlap, or unusable panel occurs at any required width. |

A keyboard trap, missing usable name, lost dialog focus, inaccessible critical
Inbox action, or misleading status is a critical accessibility failure.

## Realtime, reconnect, and tenant isolation

Use separate normal/private browser profiles or dedicated test-browser
profiles. Sign in A1/A2 to Agency A and a third profile to Agency B.

| # | Action | Expected result |
| --- | --- | --- |
| R1 | A1 and A2 open the same Agency A conversation. A1 sends a unique test reply. | A2 sees one new message and matching delivery/state without a full reload. |
| R2 | A2 adds a note and changes ownership/takes control where permitted. | A1 converges on the same state without duplicate entries or reload. |
| R3 | Disconnect A2's test browser for at least 10 seconds, make one A1 change, then reconnect A2. | A2 reconciles to current list/thread state exactly once; no stale/duplicate item remains. Record method/timings. |
| R4 | While A1/A2 work in Agency A, open Inbox and Agency B's distinctive conversation. | Agency A sessions render no Agency B conversation, contact, note, message, queue count, or Realtime update; Agency B sees only B data. |

Use a browser network-offline control or equivalent test-browser toggle for R3.
Do not inspect/export cookies, local storage, tokens, or Realtime credentials.

## Completion record

Copy this into a dated, access-controlled release evidence record. Every row
must pass before LR2 may be complete; skipped is a release blocker unless the
launch plan is formally amended.

| Area | Steps | Pass / Fail / Skipped | Evidence reference | Operator | Reviewer |
| --- | --- | --- | --- | --- | --- |
| Golden human flow | G1–G6 | | | | |
| Empty/load error/window/permission/ownership | N1–N5 | | | | |
| Accessibility | A1–A5 | | | | |
| Realtime/reconnect/tenancy | R1–R4 | | | | |

```text
I confirm this run used the deployed non-production candidate, isolated
Agency A and Agency B fixtures, real staff sessions, and the evidence cited
above. I found no critical accessibility issue, cross-agency disclosure,
unauthorized/duplicate send, or unrecorded failure.

Operator: __________________  Date: __________
Independent reviewer: _______  Date: __________
```

After a clean signed run, add a dated `docs/progress/` snapshot, update the
LR2 status in `docs/inbox/checklist.md`, and only then tick its acceptance
boxes. This procedure alone is not LR2 acceptance evidence.
