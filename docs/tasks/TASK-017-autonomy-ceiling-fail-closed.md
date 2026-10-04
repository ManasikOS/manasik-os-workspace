# TASK-017 Inbox autonomy ceiling fails closed on unresolved entitlements

## What
`saveInboxAutonomyLevel` in
[`app/(main)/management/ai-agent/actions.ts`](../../app/(main)/management/ai-agent/actions.ts)
now treats an unresolved entitlements row (`resolveEntitlements` returning
`null`) as an `L0` autonomy ceiling, instead of skipping the ceiling check
entirely.

## Why
A stress-test pass over the Inbox module (2026-09-27, finding #4) found
`if (entitlements && rank[parsed.data.level] > rank[entitlements.autonomyCeiling])`
— when `resolveEntitlements` returns `null` (no `agency_subscriptions` row
for the agency, or the read itself failed), the whole condition
short-circuits `false` and the ceiling check never runs. An admin could
persist `L2`/`L3` with reason `"Autonomy setting confirmed"` and no
ceiling violation ever recorded.

The actual send path,
[`authorizeAutomatedInboxSend`](../../lib/inbox/autonomy/runtime.ts:110),
already defaults a missing entitlements row to an `"L0"` ceiling
(`entitlements?.autonomyCeiling ?? "L0"`), so no automated message was
ever sent above what the plan actually allows — but the *stored* config
and its audit trail claimed an uncapped level was validly authorized,
which is misleading for anyone auditing "was this promotion within
entitlement," and would silently start honouring a real ceiling the
moment entitlements resolved again with a lower value than what was
already saved.

## Data model changes
None.

## Access control changes
None — this only makes an existing check fail closed instead of
fail open; no new capability or role.

## UI surfaces
None. Server Action only
(`app/(main)/management/ai-agent/actions.ts`). A save that hits this path
now returns a clearer refusal message than before (previously it would
have silently succeeded).

## Test plan
- Automated (new file):
  [`app/(main)/management/ai-agent/actions.test.ts`](../../app/(main)/management/ai-agent/actions.test.ts)
  covers all four combinations: entitlements unresolved + a promotion
  (refused, ceiling L0), entitlements unresolved + staying at L0
  (still allowed — this isn't a promotion), entitlements resolved but the
  requested level exceeds the plan's ceiling (refused with the existing
  plan-specific message, unchanged), and entitlements resolved with a
  ceiling that covers the request (allowed).
- Existing suite: full repo Vitest run passes unchanged
  (332 files / 3514 tests).
- Manual: none required — this is a pure server-side fail-closed default
  with no new UI surface.

## Status
Done.
