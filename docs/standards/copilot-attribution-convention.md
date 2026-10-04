# When something is "Manasik Copilot" and when it's just the system

This is the decision rule behind `lib/agent/identity.ts` and
`components/ui/copilot-mark.tsx` — those two files handle *how* the Copilot
is named and rendered once you've decided it applies. This file is the
missing piece: *when* it applies at all.

## The rule

> If a human could have produced the exact same row by clicking a button,
> it's **system behavior** — no label, no icon, it just happened.
>
> If it required judgment — reading a pattern, weighing a trade-off,
> drafting language, deciding what's worth surfacing — it's **Manasik
> Copilot**, and it earns the Sparkles mark and a name in the activity log,
> whether or not the action itself needed a human to approve it.

Approval status is not the test. A Class 1 action (the Copilot acts alone —
see `docs/departure-operations-agent-implementation-plan.md` §4) still gets
attributed; a scheduled job that recomputes a generated column does not,
even though neither one asked anyone's permission. The test is whether a
judgment happened, not whether a human was in the loop.

## Worked examples from the current codebase

**Stays unbranded (system):**
- The Overview tab's Blockers card
  (`app/(main)/departure-groups/[groupId]/components/tabs/overview-tab.tsx`).
  Every blocker today comes from `buildBlockers()` — a deterministic rule
  reading real flight/hotel/payment/document rows. Nothing about the list
  involved judgment, so it carries no `ActorChip`, no Sparkles, nothing.
  This is correct today and should stay that way *as long as `buildBlockers`
  stays deterministic*. If a blocker ever starts life as an agent-authored
  finding rather than a rule match, that specific blocker should carry an
  inline `ActorChip` — see "What changes this," below.
- `available_seats` recalculating itself, the sales-status auto-flip on
  seat-count change, the seat-hold expiry sweep. The Seat Hold Sweeper is
  listed explicitly in `SYSTEM_ACTOR_NAMES`
  (`lib/agent/identity.ts:73`) for exactly this reason — it runs no model
  and makes no judgement, and should keep reading as plain automation.
- Auto-assign rooming's mechanical placement (same booking → same room,
  respect billed occupancy type). The *placement* is a deterministic
  bin-packing pass; only a genuinely judgment-bearing addition on top of it
  (e.g. a proposed swap to satisfy a late roommate request) would earn
  attribution.

**Gets the Copilot mark:**
- Every row in `agent_proposals` and every finding on the Agent tab
  (`app/(main)/departure-groups/[groupId]/components/tabs/agent-tab.tsx`) —
  these are read, drafted, and prioritized by the model, so they're
  Manasik Copilot even before a human approves them.
- The AI ticket/visa cross-check (`analyseGroupPilgrimTicket`,
  `analyseGroupPilgrimVisa` in `lib/data/departure-groups.ts`) — matching a
  name, catching a PNR mismatch, is judgment, not a lookup.
- The WhatsApp sales assistant's replies, lead capture, and seat holds.

## What changes this

Any new Class 1 or Class 2 proposal kind (see the Copilot Expansion
Roadmap, Phase 2) is Copilot work by definition — it exists because it
required judgment the deterministic engines don't do. When one of those
starts surfacing *inside* an existing system-only surface — for instance, a
`LEAD_GROUP_MATCH_SUGGESTED` proposal showing up as a suggestion card next
to the Blockers list, or a `ROOM_SWAP_SUGGESTED` proposal changing what the
rooming mismatch count means — that specific row gets an inline
`ActorChip` (`components/ui/copilot-mark.tsx`, `inline` mode). The
surrounding system-derived content it sits next to does not retroactively
become branded just because the Copilot now has something to say
nearby — each row is judged on its own origin, not its neighbors'.

## Applying this to new code

Before wiring up a new automated action, ask: did anything upstream of
this write require reading a pattern or weighing a trade-off? If yes, stamp
the actor with a name from `COPILOT_NAME` /
`COPILOT_SURFACE_NAMES` (`lib/agent/identity.ts`) so `ActorChip` and
`isCopilotActor()` pick it up automatically. If no — it's a straight
rule, a generated column, a scheduled sweep — leave the actor field null or
use a `SYSTEM_ACTOR_NAMES` entry, and don't reach for `CopilotBadge` just
because the feature happens to live near AI-adjacent code.
