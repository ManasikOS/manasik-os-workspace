# TASK-015 Bounded intake respects an already-active human handler

## What
Make the Inbox bounded-intake flow's entry check (`runBoundedInboxIntake` in
[`lib/inbox/autonomy/intake-runtime.ts`](../../lib/inbox/autonomy/intake-runtime.ts))
see the conversation's real `HUMAN_ACTIVE` state instead of a hardcoded
`false`, so it never starts (or hands over/reassigns) a conversation a
human agent already owns.

## Why
A stress-test pass over the Inbox module (2026-09-27) found that
`intakeLevel()` — the private gate `runBoundedInboxIntake` uses to decide
whether to run at all — calls `resolveEffectiveAutonomy` with
`conversationHumanActive: false` hardcoded, never reading the
conversation's actual `state`/`handling_mode`. This is the same input
[`authorizeAutomatedInboxSend`](../../lib/inbox/autonomy/runtime.ts) (the
function's own doc comment calls itself "the single server-side autonomy
decision used by every automated delivery path") computes correctly from
`conversation.state === "HUMAN_ACTIVE" || conversation.handling_mode ===
"HUMAN_ACTIVE"` before authorizing a send.

Because the entry gate ignores this, `runBoundedInboxIntake` can start —
and, on a handover-triggering answer, call `handoverIntake()`, which
writes `conversations.state = "HUMAN_REQUESTED"` and reassigns
`assigned_to_id` to a freshly-picked owner — even while a staff member is
actively replying in `HUMAN_ACTIVE`. The final outbound send is still
correctly blocked by `authorizeAutomatedInboxSend` inside
`deliverAgentReply`, so no message reaches the customer out of turn, but
the ownership/state overwrite and the lead-note/lead-field writes still
happen, silently clobbering the active agent's ownership of the
conversation. This contradicts the architecture's stated single-gate
guarantee (`docs/inbox/architecture.md` §1, §16 R-series decisions): a
second, less-guarded decision point should not exist for whether the
bounded-intake state machine runs at all.

## Data model changes
None.

## Access control changes
None — this only tightens an existing autonomy check to use data already
loaded by its caller; no new capability or role is introduced.

## UI surfaces
None. Server-side autonomy logic only
(`lib/inbox/autonomy/intake-runtime.ts`).

## Test plan
- Automated: add a case to
  [`lib/inbox/autonomy/intake-runtime.test.ts`](../../lib/inbox/autonomy/intake-runtime.test.ts)
  asserting `runBoundedInboxIntake` returns `false` and performs no writes
  (`deliver`, `ensureLead`, `assignOwner` all uncalled, `writes` empty)
  when the passed-in `conversation.state` is `"HUMAN_ACTIVE"` (and again
  for `handling_mode === "HUMAN_ACTIVE"` with a non-active `state`).
- Existing suite: `npx vitest run lib/inbox/autonomy/intake-runtime.test.ts`
  must keep passing unchanged (none of the existing fixtures set
  `state`/`handling_mode`, so their behavior is unaffected).
- Manual: none required — this is a pure server-side gate change with no
  UI surface.

## Status
Done.
