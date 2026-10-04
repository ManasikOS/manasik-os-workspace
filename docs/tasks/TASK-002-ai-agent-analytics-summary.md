# TASK-002 AI Agent Analytics Summary

## What
A read-only "Assistant performance — last 30 days" section on the Manasik Copilot screen
(`/management/ai-agent`), replacing nothing: it sits above the existing "Recent activity" list. It
answers, in plain language: how many conversations the assistant took part in, how many it handled
without a person, how fast it replies, what it costs, which of its tools fail, whether prompt reuse
(caching) is working, and how many leads and held bookings it produced. Item G3 of
[whatsapp-go-live-plan.md](../modules/whatsapp-go-live-plan.md); metrics come from §14 of
[whatsapp-ai-agent-implementation-plan.md](../modules/whatsapp-ai-agent-implementation-plan.md).

## Why
`agent_runs` and `agent_tool_calls` already record everything needed (tokens, latency, status, tool
errors) but the screen only shows the last 15 raw rows, so nobody can tell whether the assistant is
healthy, cheap, or worth keeping on. The plan calls tool failure rate "the single most useful number
for debugging the agent" and a collapsing cache ratio the sign that prompt ordering broke.

## Data model changes
- **No schema change.** One data-only migration, `20261124090000_ai_model_rate_opus_5.sql`, adds the
  missing price row for `claude-opus-5`. Found while designing this: the WhatsApp agent runs on
  `claude-opus-5` (`lib/ai/provider.ts`) but `ai_model_rates` only prices `claude-sonnet-5`, so every
  run would be silently unpriced and the AI-cost figure on both this screen and the Billing screen
  would read $0. Rates ($5 / $25 per million input/output; cache read $0.50 and 5-minute cache
  write $6.25 from Anthropic's standard 0.1x / 1.25x multipliers) are Anthropic's list prices as of
  2026-06-24 and must be re-checked when they change.
- No new tables, columns, or policies. Reads go through the signed-in session client, so existing RLS
  applies (`agent_runs` / `agent_tool_calls`: ADMIN and CEO only, agency-scoped).

## Access control changes
- `lib/access/ai-agent-access.ts`: MARKETING's `viewAnalytics` goes from `true` to `false`. RLS on
  `agent_runs` / `agent_tool_calls` has never allowed MARKETING to read them, so MARKETING currently
  sees a misleading "No turns yet". This is exactly the UI-offers-what-RLS-rejects mismatch that
  file's header warns about. ADMIN and CEO are unchanged.

## UI surfaces
- `app/(main)/management/ai-agent/page.tsx` — mounts the new section inside a `Suspense` boundary
  with a skeleton.
- New: `ai-agent-analytics-section.tsx` (server, fetches, error state) and
  `ai-agent-analytics-summary.tsx` (client, tiles + two recharts bar charts + tool table).
- Built only from existing primitives: `Card`, `Table`, `Skeleton`, `ChartContainer`, `ToneBadge`,
  `EmptyState`, tone colors from `lib/ui/tone.ts`. No new colors, no new primitives.
- States: loading skeleton; designed empty state (no replies yet → explains why and links to the
  settings above / Integrations); specific error state with reload; unpriced-model warning.

## Logic
- `lib/agent/whatsapp/analytics.ts` — pure `summariseAgentActivity()` and `priceAgentRun()`; no I/O.
- `lib/data/ai-agent-analytics.ts` — session-client reads (30 Colombo days), bounded row limits with a
  `truncated` flag, then calls the pure function.
- `lib/data/whatsapp-billing-view.ts` — also fixed: it filtered `agent_runs` on a `surface` column that
  does not exist, so the query errored and its result was silently discarded. Now shares
  `priceAgentRun()` so the two screens can never disagree on AI cost.
- Definitions, stated on screen where they could mislead: "handled without a person" = the
  conversation is not currently `HUMAN_REQUESTED` / `HUMAN_ACTIVE` (a snapshot, not history);
  assistant cost is Anthropic usage, separate from Meta's WhatsApp fees (D10/D12 keep them apart).

## Test plan
- Vitest (`lib/agent/whatsapp/analytics.test.ts`): percentile edge cases, resolution rate incl.
  zero conversations, cost pricing against dated rates, unpriced model reporting, cache ratio,
  per-tool failure rate ordering, daily zero-fill across Colombo days, truncation flag.
- Browser (dev server, real signed-in session): empty state (production has 0 `agent_runs` today),
  desktop and mobile widths, dark mode, permission-denied for a non-ADMIN/CEO role by code path.
  Populated state cannot be seen on real data yet; covered by the unit tests instead.
- `npm run lint`, `typecheck`, `test` all green before PR.

## Status
Done in code, 2026-09-18. `npm run lint`, `typecheck` and `test` pass (321 tests, 21 new).
Verified in the browser: the real page renders the empty state (production has 0 `agent_runs`);
the populated layout was checked at narrow and desktop widths using a temporary scratch route with
fabricated data, since deleted. **Not yet done: the `claude-opus-5` rate migration has not been
applied to the production database** — until it is, the cost tile reads $0 and shows the "no price
on file" warning once real replies exist.

Open items found on the way, deliberately out of scope here:
- The `claude-sonnet-5` row in `ai_model_rates` reads $3 / $15 per million; Anthropic's published
  Sonnet 5 price is $2 / $10. Nothing in the WhatsApp agent uses that model today. Worth checking
  against the price list before anything does.
- Every page throws a React hydration error in the browser console (also `/dashboard`, `/leads`), so
  it is not from this task. Cause not investigated.
