# TASK-018 Conversation header wrap fix + send-gate self-containment

## What
Two low-severity items from the 2026-09-27 stress-test report:

1. **#5 — narrow-column header overlap.** The Inbox thread header
   ([`app/inbox/components/conversation-panel.tsx`](../../app/inbox/components/conversation-panel.tsx))
   now wraps onto two rows instead of overlapping when the customer
   name/channel line and the owner control / status badge / actions
   group don't both fit on one line.
2. **#6 (send-gate item) — `automatedInboxSendGate` now re-applies the
   entitlement ceiling itself** instead of only trusting the caller to
   have capped `level` first
   ([`lib/inbox/autonomy/send-gate.ts`](../../lib/inbox/autonomy/send-gate.ts)).

The other two #6 observations from the report needed no code change:
- **Cron coordinator fan-out double-fire** — verified safe, not fixed.
  `claim_channel_jobs`
  ([`supabase/migrations/20261202090200_mi1_1_channel_jobs.sql`](../../supabase/migrations/20261202090200_mi1_1_channel_jobs.sql))
  takes a `pg_advisory_xact_lock` per lane before claiming and locks rows
  `FOR UPDATE ... SKIP LOCKED`, uniformly for every lane including
  REALTIME. Two overlapping coordinator invocations can never double-claim
  the same job; the worst case is one wasted round of shard HTTP calls,
  not a correctness bug.
- **Retention/composer-presence logic** — already reviewed in the
  original report and found sound (resumable cursor sweep, non-blocking
  soft lease); no action needed.

## Why
- **#5:** the thread header's left group (avatar + name + channel line,
  `min-w-0` + `truncate`) and right group (owner select, status badge,
  actions menu, panel-toggle button — `shrink-0`, ~380px of fixed-ish
  content) were laid out with `justify-between` and no wrapping. Whenever
  the thread column is narrower than the sum of both groups' natural
  widths — which happens at the ~800px pane width used to reproduce this,
  and even at a wide window once the customer-details rail is open — the
  non-shrinking right group squeezed the left group down to a few pixels,
  hiding the customer's name and phone/channel line behind the owner
  control instead of truncating it legibly.
- **Send-gate item:** `authorizeAutomatedInboxSend` (runtime.ts) already
  caps `level` against the plan's entitlement ceiling before calling
  `automatedInboxSendGate`, so this is a no-op at the one real call site
  today. But the gate itself had no independent floor — a future call
  site that passed an uncapped `level` would silently bypass the ceiling,
  and no unit test on the gate itself would catch that, since the gate's
  own tests only exercise `level` as given. Passing `entitlementCeiling`
  through and re-applying `lowerAutonomyLevel` inside the gate makes "never
  send above the plan's ceiling" hold regardless of caller discipline.

## Data model changes
None.

## Access control changes
None.

## UI surfaces
[`app/inbox/components/conversation-panel.tsx`](../../app/inbox/components/conversation-panel.tsx) —
the thread header now takes two rows instead of one at narrow widths;
no new controls, no color changes.

## Test plan
- Automated: [`lib/inbox/autonomy/send-gate.test.ts`](../../lib/inbox/autonomy/send-gate.test.ts)
  gained three cases — refuses an uncapped `L3` when `entitlementCeiling`
  is `L1`, is a no-op when the caller already capped `level`, and behaves
  exactly as before when no ceiling is passed at all (older-caller
  compatibility).
- Existing suite: full repo Vitest run passes unchanged
  (332 files / 3517 tests).
- Manual: verified in the browser at the pane's default width (~800px,
  the width that reproduced the original overlap) and at 1440px with the
  customer-details rail open and closed — the header now wraps cleanly
  with both the name and the owner/status/actions group fully readable,
  never overlapping, at every width tried.

## Status
Done.
