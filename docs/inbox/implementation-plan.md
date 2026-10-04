# Manasik Inbox + Copilot — Implementation Plan

Status: **in progress.** Slices MI0.1 to MI4.5 are built and on `main`; MI4.6 is built
(see its "As built" note); Phases 5 and 6 are not started. [`checklist.md`](./checklist.md) is the source of
truth for what is done. Slices carry "*As built*" notes where they deviated from
the plan below (for example MI4.3 seeded `INBOX_RISK_MODEL`, not `INBOX_RISK`, which
MI4.1 had already seeded).

This is the executable build sequence for
[`docs/inbox/architecture.md`](./architecture.md)
(the "Architecture"). Read that first — this document does not repeat the
*why*, only *what to build, in what order, file by file*.

It builds **on top of** the already-delivered channel-neutral conversation
platform described in [`inbox-architecture.md`](../modules/inbox-architecture.md)
and [`inbox-implementation-plan.md`](../modules/inbox-implementation-plan.md), and
reuses the AI surface framework from
[`manasik-intelligence-implementation-plan.md`](../modules/manasik-intelligence-implementation-plan.md)
and the WhatsApp agent from
[`whatsapp-ai-agent-implementation-plan.md`](../modules/whatsapp-ai-agent-implementation-plan.md).

---

## 0. How to use this plan

- Slice ids are `MI<phase>.<n>` (Manasik Inbox). **Do not renumber** —
  commit messages and PR titles reference them.
- **One slice = one PR.** Independently deployable, `npm run typecheck &&
  npm run lint && npm test` green, no behaviour change to anything the
  slice does not name.
- Every slice has the same seven parts: Goal · Depends on · Migration ·
  Create · Modify · Tests · Exit criteria. "None" when a part is empty.
- **Migrations** are named here with the slice id as a suffix
  (`_mi1_1_...`). At PR time, replace with the real
  `YYYYMMDDHHMMSS_` prefix, next in sequence after the latest file in
  `supabase/migrations/`. Never renumber a merged migration. Every new
  table gets RLS **in the same migration**.
- **Every new AI surface ships `mode = 'SHADOW', enabled = false`** in its
  `ai_surface_settings` seed. Flipping a surface to `PROPOSE` or `ACTIVE`
  is a product-owner judgement after reviewing shadow output — it is never
  a build step in this plan.
- **Rollout and entitlement contract (FIX9).** `plans.features` controls the
  optional Inbox products (offer matching, identity resolution, SLA, media,
  owner panel, answer cache, and exports); `ai_surface_settings` controls
  model/autonomy execution and safety; and `agency_settings.inbox_queues_v2`
  is the temporary grouped-rail rollout. There are no `inbox_autonomy_l2` or
  `inbox_autonomy_l3` flags.
- The **existing WhatsApp reply path keeps working untouched** through
  every phase. No slice below modifies `lib/agent/whatsapp/drain.ts`'s
  job kinds or `agent_jobs`' schema.
- **The seven product decisions are settled** in Architecture §16
  (R1–R7): price staleness, SLA targets, assignment policy, answer-cache
  eligibility and approval, L2 promotion gating, multi-currency
  presentation, and retention. Slices below implement those answers — do
  not re-open them mid-build; change the Architecture first if one turns
  out wrong.

### Pre-flight (once)

1. Record the baseline: `npm run typecheck && npm run lint && npm test`.
   Any slice that regresses it is not done.
2. Snapshot the latest `supabase/migrations/` filename.
3. Capture production numbers: conversations per agency, inbound messages
   per day, p95 webhook→visible latency, current `ai_runs` volume and
   `agent_jobs` depth. Phase 1 and Phase 6 are judged against these.
4. Confirm `OPENROUTER_API_KEY`, `CRON_SECRET`, `META_APP_SECRET` are set
   per environment.
5. Create the tracking board with one row per slice from §9.

### BLN-01 — Specification refinement baseline (completed 2026-09-29)

The refinement programme in [`spec-implementation-plan.md`](./spec-implementation-plan.md)
starts from the standing MI architecture rather than replacing it. Its Phase 0
baseline is locked in
[`2026-09-29-inbox-bln-01-baseline.md`](../progress/2026-09-29-inbox-bln-01-baseline.md).

- Repository and Manasik OS migration histories match exactly: 209 files/rows.
- Existing WhatsApp, Messenger, Instagram, email, passport, receipt, audio, and
  autonomy capabilities are classified as baseline rather than rebuild work.
- Live evidence is recorded separately from code-only evidence; notably,
  Messenger still needs canonical end-to-end provider acceptance and production
  deployment parity is not claimed.
- D1-D7 are settled. Later specification tasks must use those decisions and the
  dependency order in `spec-task-list.md`.

This lock does not close any older MI slice whose own measured exit remains
open. It prevents later work from treating an unverified assumption as a fact.

---

## 1. Phase 0 — measurement and contracts (no user-visible change)

Nothing can be made cheap or fast before it is measured, and G11 means AI
cost is currently invisible.

### MI0.1 — Finish the AI cost ledger

- **Goal.** Every `ai_runs` row carries a real `cost_usd`; daily per-agency
  rollups exist.
- **Depends on.** None.
- **Migration.** `_mi0_1_ai_usage_daily` — `ai_usage_daily (agency_id,
  day, surface, runs, input_tokens, output_tokens, cache_read_tokens,
  cache_creation_tokens, cost_usd, conversations_enriched)`, PK
  `(agency_id, day, surface)`, RLS: staff read own agency, service_role
  write. Plus rate rows in `ai_model_rates` for any model slug in use that
  has none.
- **Create.** `lib/ai/rates.ts` — dated rate lookup with a 5-minute
  in-process cache; `lib/ai/rates.test.ts`.
- **Modify.** `lib/ai/telemetry.ts` — replace the placeholder
  `estimateCostUsd()` with a real four-component computation (input,
  output, cache-read, cache-write priced separately). Keep it
  non-throwing. `app/api/cron/*` — add the nightly rollup.
- **Tests.** Rate selection on an `effective_from` boundary; an unknown
  model records `null`, not `0`; cache-read tokens priced at the cache
  rate, not the input rate; rollup idempotent on re-run.
- **Exit.** `/management/ai-agent` shows a non-zero month-to-date AI cost
  for an agency with runs, and it reconciles with the OpenRouter dashboard
  within 5 %.

### MI0.2 — Pipeline contracts

- **Goal.** Typed, provider-neutral contracts for everything Phase 1+
  writes, so no later slice invents a second shape.
- **Depends on.** None.
- **Migration.** None.
- **Create.** `lib/inbox/intelligence/contracts.ts` — `IntentCode`,
  `Urgency`, `CommercialStage`, `Sentiment`, `RiskLevel`,
  `NextActionCode`, `SignalCode`, `InterventionKind`, `QueueCode`,
  `ConversationIntelligence`, `ConversationSignal`, `Intervention`,
  `HandoffSummary`, `WorkLane`, `JobKind`, plus Zod schemas for each.
  Re-export `TravelIntent` from `lib/copilot/sales/types.ts` rather than
  redefining it. `lib/inbox/intelligence/contracts.test.ts`.
- **Modify.** None.
- **Tests.** Every enum is closed and exhaustively switchable; the Zod
  schemas reject an unknown code; `TravelIntent` round-trips through
  `conversation_intelligence.travel_intent`'s jsonb shape.
- **Exit.** No `string` typed as an intent/signal/queue code anywhere in
  the new modules.

### MI0.3 — Observability baseline

- **Goal.** The KPIs the Architecture's §12 names are queryable before
  the features they measure exist.
- **Migration.** `_mi0_3_inbox_metrics_views` — `security invoker` views:
  `inbox_intelligence_kpis_daily`, `inbox_lane_health`,
  `inbox_gate_skip_reasons`. *As built:* also creates the empty,
  RLS'd `inbox_gate_decisions` log table (a view needs a base table, and
  MI2.3's exit reads it), and `inbox_lane_health` reads `agent_jobs` as
  lane `LEGACY_AGENT` until MI1.1 re-creates it with `channel_jobs`.
- **Create.** `lib/metrics/inbox-intelligence-metrics.ts`.
- **Tests.** Each view is agency-scoped under RLS; a two-agency fixture
  returns no foreign rows.
- **Exit.** A query returns rows (all zero) for every KPI.

---

## 2. Phase 1 — lanes and fairness (G12)

The scale prerequisite. Everything after this rides on it.

### MI1.1 — `channel_jobs` with lanes and fair-share claiming

- **Goal.** A durable, coalescing, per-tenant-fair work queue.
- **Depends on.** MI0.2.
- **Migration.** `_mi1_1_channel_jobs` — the table in Architecture §5.7;
  `unique (agency_id, coalesce_key) where status = 'QUEUED'`; indexes on
  `(lane, status, run_after, priority desc)` and `(agency_id, status)`;
  RLS (staff read own agency; writes service_role only); and the
  `claim_channel_jobs(p_lane, p_worker_id, p_limit, p_per_agency_cap)`
  RPC using the ranked/`for update skip locked` form in Architecture §7.2,
  `security definer`, `set search_path = ''`, granted to `service_role`
  only (follow `20261126090000_lock_down_definer_functions.sql`).
  *As built:* Architecture §7.2's SQL sketch puts `FOR UPDATE SKIP LOCKED`
  on a query containing a window function, which Postgres rejects; the
  RPC ranks per agency in a subquery, locks in the outer query, and
  serialises claims per lane with an advisory lock so the per-agency cap
  is exact. Companion RPCs: `enqueue_channel_job` (coalescing upsert),
  `complete_channel_job`, `fail_channel_job`, `release_stale_channel_jobs`.
  `inbox_lane_health` is re-created here to add the three lanes.
- **Create.** `lib/inbox/jobs/queue.ts` (`enqueue`, `claim`, `complete`,
  `fail`, `releaseStaleLocks`, `depthByLane`); `lib/inbox/jobs/queue.test.ts`.
- **Modify.** None.
- **Tests.** Coalescing: two enqueues of the same key while queued ⇒ one
  row, later `run_after`. Fairness: 500 jobs from agency A and 5 from B ⇒
  one claim tick serves both. Cap: an agency at its in-flight cap claims
  nothing. Retry: exponential backoff, dead-letter at `max_attempts`.
  Stale-lock release. Cross-tenant: a claim never returns two agencies'
  rows to a worker that asked for one agency.
- **Exit.** Benchmark: 10 000 queued rows across 50 agencies, p95 claim
  under 50 ms, no starvation over 100 ticks.

### MI1.2 — Lane workers and the settle delay

- **Goal.** Three lanes drained on the existing two triggers, with the
  REALTIME lane kept short.
- **Depends on.** MI1.1.
- **Migration.** None.
- **Create.** `lib/inbox/jobs/drain.ts` — `processLane(lane, {budgetMs,
  perAgencyCap})`, one handler registry keyed by `JobKind`;
  `lib/inbox/jobs/drain.test.ts`.
- **Modify.** `app/api/cron/agent-jobs/route.ts` — add the three lane
  drains alongside the existing `processDueJobs` and
  `processDueInboxOutbox`, with per-lane budgets summing under 50 s.
  `lib/whatsapp/webhook-handler.ts` and
  `lib/channels/messenger/webhook-handler.ts` — the `after()` kick also
  drains REALTIME with a 10 s budget. Do **not** change their existing
  `processDueJobs` call.
- **Tests.** Budget respected (a long handler does not overrun); a
  handler throwing marks the job failed without killing the tick; the
  settle delay batches a five-message burst into one run.
- **Exit.** Synthetic burst of 200 messages across 3 agencies drains
  within two cron ticks with no REALTIME job older than 10 s.

### MI1.3 — Worker shard fan-out

- **Goal.** REALTIME depth spikes are absorbed by width, not by a longer
  loop.
- **Depends on.** MI1.2.
- **Migration.** `_mi1_3_inbox_lanes_cron` — allow-lists and schedules the coordinator (every minute). *(Added: not in the original plan.)*
- **Create.** `app/api/cron/inbox-lanes/route.ts` — accepts
  `?lane=&shard=`, and when REALTIME depth exceeds a threshold, fans out
  N self-invocations.
- **Modify.** None — `proxy.ts`'s `MACHINE_ROUTES` already contains the `/api/cron` prefix.
- **Tests.** Shard invocations do not double-process (guaranteed by
  `SKIP LOCKED`); the fan-out threshold is respected; unauthenticated
  requests get 401.
- **Exit.** 2 000-job REALTIME backlog clears in under 60 s.

---

## 3. Phase 2 — the intelligence projection (G1, G2)

### MI2.1 — Projection tables

- **Goal.** The tables the whole workspace reads.
- **Depends on.** MI0.2.
- **Migration.** `_mi2_1_conversation_intelligence` — the four tables in
  Architecture §5.1–5.4 (`conversation_intelligence`,
  `conversation_signals`, `conversation_interventions`,
  `conversation_queue_membership`), plus the §5.8 column additions to
  `conversations` and `conversation_messages`. All RLS'd in this
  migration; composite FKs to `(id, agency_id)`; indexes for every access
  path named in the Architecture.
- **Create.** `lib/data/conversation-intelligence-repository.ts` —
  `upsertIntelligence`, `loadIntelligence`, `recordSignals`,
  `supersedeSignals`, `openIntervention`, `resolveIntervention`,
  `listInterventions`. `lib/data/conversation-intelligence-repository.test.ts`.
- **Modify.** None.
- **Tests.** Upsert is idempotent on `input_fingerprint`; an intervention
  cannot be opened for another agency's conversation; RLS blocks
  cross-tenant read; the open-intervention gate query is correct.
- **Exit.** A seeded conversation has a readable, agency-scoped
  intelligence row.

### MI2.2 — Queue membership function and rail

- **Goal.** One SQL definition of every queue; counts become indexed
  `count(*)`.
- **Depends on.** MI2.1.
- **Migration.** `_mi2_2_conversation_queues` —
  `public.refresh_conversation_queues(p_conversation_id uuid)`
  (`security definer`, `set search_path = ''`, service_role + an
  authenticated wrapper for staff-driven writes), triggers on
  `conversations`, `conversation_intelligence`,
  `conversation_interventions`, `conversation_messages`, and a one-time
  backfill for existing rows.
- **Create.** `lib/inbox/queues.ts` — the `QueueCode` catalogue with
  label, description, icon and grouping (Inbox / Commercial / Operations /
  Channels), mirroring the PDF's rail. `lib/inbox/queues.test.ts`.
- **Modify.** `lib/inbox/views.ts` — keep the existing nine views as the
  fallback when `inbox_queues_v2` is off, and map each onto its new queue
  code so there is one predicate, not two.
  `lib/data/inbox-repository.ts` — replace the `VIEW_SCAN_LIMIT = 5000`
  in-memory count path with per-queue `count(*)`; cursor-paginate the list
  on `(last_activity_at desc, id desc)`.
  `app/inbox/components/inbox-view-rail.tsx` — render grouped
  queues with counts.
- **Tests.** Every queue predicate has a fixture asserting membership and
  non-membership; the trigger keeps membership correct across an
  assignment change, a close, a new message and an intervention; counts
  match a brute-force count over a 5 000-row fixture; pagination returns
  no duplicates or gaps across pages.
- **Exit.** Rail counts render p95 < 300 ms against a 100 k-conversation
  agency fixture; `explain analyze` shows index-only scans.

### MI2.3 — The S0 gate

- **Goal.** The cost lever, pure and tested, before any model call is
  wired.
- **Depends on.** MI2.1.
- **Create.** `lib/inbox/intelligence/gate.ts` — `shouldEnrich(input):
  {enrich: boolean; reason: GateReason; escalateToRisk: boolean}`, pure,
  every rule from Architecture §6 S0. `lib/inbox/intelligence/gate.test.ts`
  with at least 25 fixtures.
- **Modify.** None.
- **Tests.** Acknowledgement-only text skips; unchanged fingerprint
  skips; `HUMAN_ACTIVE` with recent staff activity skips; surface `OFF`
  skips; exhausted entitlement skips; a refund/distress/bank-mismatch
  phrase escalates to risk **even when every skip rule holds** — this is
  the test that must never be deleted.
- **Exit.** Gate decisions are recorded in `inbox_gate_skip_reasons` with
  a reason for every skip.

### MI2.4 — S1 triage

- **Goal.** Intent, urgency, sentiment, language on every enriched
  conversation.
- **Depends on.** MI2.1, MI2.3, MI1.2.
- **Migration.** `_mi2_4_inbox_triage_surface` — seed
  `ai_surface_settings` rows for surface `INBOX_TRIAGE` (`SHADOW`,
  disabled) for every agency.
- **Create.** `lib/inbox/intelligence/digest.ts` — the rolling 400-token
  conversation digest, maintained incrementally, with tests.
  `lib/ai/surfaces/inbox/triage.ts` — one `generateStructured({tier:
  "classify"})` call returning the closed-enum shape, with a rule-based
  lexicon fallback when the model returns `null` or an out-of-enum value.
  `lib/inbox/intelligence/pipeline.ts` — the stage orchestrator (S0→S1
  only in this slice). Handler registration for `JobKind = "ENRICH"`.
- **Modify.** `lib/whatsapp/webhook-handler.ts`,
  `lib/channels/messenger/webhook-handler.ts` — after persisting an
  inbound message, enqueue `ENRICH` on the REALTIME lane with
  `coalesce_key = 'enrich:' || conversationId`. Persist-and-ack behaviour
  is unchanged; the enqueue is one insert.
- **Tests.** Fixture set of 60 labelled messages (English, Sinhala, Tamil,
  mixed) asserting intent accuracy ≥ 85 % and zero `SPAM`
  false-positives on genuine enquiries; a model failure leaves `source =
  'RULES'` and a populated `note`; no call is made when the gate says
  skip; the digest never exceeds its token budget.
- **Exit.** In shadow mode, `conversation_intelligence` fills for live
  traffic with p95 triage latency < 5 s, and the S0 skip rate is visible
  and ≥ 50 %.

### MI2.5 — Context rail reads the projection

- **Goal.** Staff see intent, urgency and confidence — the first visible
  payoff.
- **Depends on.** MI2.4.
- **Create.** `app/inbox/components/conversation-intelligence-rail.tsx`
  and `intelligence-evidence-popover.tsx` (shadcn only; every fact links
  to its source message).
- **Modify.** `app/inbox/components/customer-context-panel.tsx` —
  compose the new rail above the existing lead block, never replacing it.
  `lib/data/inbox-repository.ts` — add `loadInboxIntelligence()` as a
  **fourth** independent loader so a slow projection read cannot delay the
  transcript. `app/inbox/types.ts` — extend with the intelligence
  shape.
- **Tests.** A `PENDING` row renders the deterministic half plus the
  "Copilot is reading this conversation" line and never an empty panel; a
  `RULES`-sourced row is labelled as such; a `FAILED` row shows the note;
  realtime invalidation refreshes the rail without a full reload.
- **Exit.** Manual verification in the browser at desktop, tablet and
  mobile widths per
  [`docs/standards/ui-standards.md`](../standards/ui-standards.md).

---

### MI2.6 — SLA policy and the deadline clock (R2)

- **Goal.** Architecture §16 R2's table, enforced against the agency's
  working calendar, with the channel window outranking every target.
- **Depends on.** MI2.2.
- **Migration.** `_mi2_6_inbox_sla_policies` — `inbox_sla_policies
  (agency_id, queue_code, first_reply_minutes, resolution_minutes,
  clock (BUSINESS_HOURS | ALWAYS), opens_intervention_on_breach)`, PK
  `(agency_id, queue_code)`, RLS'd, seeded per agency from R2's table.
  Reuses `agency_settings.timezone` and `ai_settings.working_hours`; adds
  no second calendar.
- **Create.** `lib/inbox/sla/business-hours.ts` — a pure
  `addBusinessMinutes(from, minutes, workingHours, timezone)` and
  `isWithinBusinessHours()`, with tests covering a Friday evening
  arrival, a public-holiday gap, a midnight rollover and a DST-free
  `Asia/Colombo` baseline. `lib/inbox/sla/due-at.ts` — the pure
  `computeSlaDueAt()` implementing
  `least(queue_target, service_window_expires_at − 2 h)`, clock pausing in
  `WAITING_CUSTOMER` / `WAITING_TEAM`, and the out-of-hours rule that a
  `NEW_ENQUIRIES` message arriving overnight is due 30 min after opening.
  `app/(main)/management/settings/inbox-sla-form.tsx` — per-queue editing.
- **Modify.** `refresh_conversation_queues` — set `conversations.sla_due_at`
  and raise `priority_rank` on breach; `lib/inbox/queues.ts` — a
  `NEARING_DEADLINE` derived view for the owner panel's count;
  `lib/inbox/risk/registry.ts` — `SLA_BREACHED` signal, opening an
  intervention only for the four queues R2 names.
- **Tests.** One fixture per row of R2's table; the channel window wins
  when it is sooner (the test that must not be deleted — a missed Meta
  window is unrecoverable); a conversation parked on the customer never
  breaches; resuming on an inbound restarts the clock without
  back-dating; a 24/7-clock queue breaches overnight and a business-hours
  queue does not.
- **Exit.** `NEARING_DEADLINE` and `SLA_BREACHED` counts are correct
  against a seeded agency in `Asia/Colombo`, and no breach fires for a
  paused conversation.

---

## 4. Phase 3 — commercial intelligence (G3, G5)

### MI3.1 — S2 structured travel intent in the Inbox

- **Goal.** The PDF's §3 extraction, in the conversation.
- **Depends on.** MI2.4.
- **Migration.** `_mi3_1_inbox_intent_surface` — seed `INBOX_INTENT`
  (`SHADOW`, disabled).
- **Create.** `lib/ai/surfaces/inbox/travel-intent.ts` — calls the
  existing rule extractor first
  (`lib/copilot/sales/intent-extraction.ts`), and the existing LLM
  provider (`lib/copilot/sales/llm/openrouter-provider.ts`) only for
  fields the rules left unresolved.
- **Modify.** `lib/inbox/intelligence/pipeline.ts` — add S2, conditional
  on a commercial intent code. `conversation-intelligence-rail.tsx` —
  render travellers, window, room, origin and budget with their evidence
  snippets.
- **Tests.** The PDF's own worked example ("4 adults from Kandy, December,
  school holidays, close hotel, quad") extracts every field with
  evidence; a rules-only path produces no model call; a partial rule
  result triggers exactly one LLM call, not two.
- **Exit.** Intent fields visible with evidence, `source` labelled per
  field.

### MI3.2 — S3 live offer matching in the Inbox

- **Goal.** The PDF's §4 "best viable offer" engine, reachable from the
  conversation. **Zero model cost.**
- **Depends on.** MI3.1.
- **Migration.** None.
- **Create.** `lib/inbox/intelligence/offer.ts` — a thin adapter calling
  `loadCopilotKnowledgeContext()` then `matchOffers()`
  (`lib/copilot/sales/*`) with the conversation's intent, writing the
  ranked result into `conversation_intelligence.matched_offer` with an
  `as_of`, the source `departure_group_pricing.priced_at`, and the seat
  count it was matched against — the three values R1's change-detection
  compares. Exposes `revalidateOffer(snapshot)` returning
  `FRESH | PRICE_CHANGED | SEATS_INSUFFICIENT | EARLY_BIRD_EXPIRING`.
  `app/inbox/components/conversation-offer-card.tsx` — best option,
  seats, price, inclusions, known constraints, alternatives, and the four
  PDF actions (`Draft reply`, `Create quote`, `Open group`,
  `Ask follow-up`).
- **Modify.** `lib/inbox/intelligence/pipeline.ts` — add S3.
  `app/inbox/actions.ts` — Server Actions for
  `createQuoteFromConversation` and `openDepartureGroupFromConversation`,
  each `requireUser()` + capability-checked + Zod-validated at the
  boundary.
- **Tests.** Reuse the offer-matching fixtures already in the repo; add
  Inbox-level cases: sold-out group appears only as a waitlist option; a
  group whose room type is unpriced is never offered; the recommendation
  changes when live seats change; `as_of`, `priced_at` and the matched
  seat count are all recorded; `revalidateOffer` returns
  `PRICE_CHANGED` after a reprice and `FRESH` when only `updated_at`
  moved (R1 compares `priced_at`, not `updated_at`); a cross-tenant group
  is never a candidate.
- **Exit.** A staff member answers "cheapest 10-day Umrah in November for
  three" from the conversation without opening another screen, and the
  seat/price figures match `/departure-groups` exactly.

### MI3.3 — Cross-channel identity graph and merge review

- **Goal.** The PDF's §2, with no silent merges.
- **Depends on.** MI2.1.
- **Migration.** `_mi3_3_contact_identity_links` — the edge table in
  Architecture §5.5, RLS'd, plus indexes on both identity columns and on
  `(agency_id, status)`.
- **Create.** `lib/inbox/identity/graph.ts` — candidate proposal
  (normalized phone/email exact, name + travel-window heuristic, profile
  match) with a confidence band per candidate; pure ranking, tested.
  `lib/inbox/identity/graph.test.ts`.
  `app/inbox/components/identity-match-card.tsx` — the PDF's
  "Possible existing lead found" card with `[Link conversation]` /
  `[Create separate lead]`.
- **Modify.** `lib/inbox/lead-linking.ts` and
  `lib/inbox/lead-link-decision.ts` — route a non-exact match through a
  `PROPOSED` link instead of linking; `lib/inbox/identity.ts` — read the
  graph when resolving. `app/inbox/actions.ts` — confirm/reject
  actions writing `identity_match_events`.
- **Tests.** Only `EXACT_IDENTITY` auto-confirms; a rejected link is never
  re-proposed; confirming a link never merges lead records (it links
  identities, per Architecture §2.2); a link across agencies is
  impossible; unlinking restores the prior state.
- **Exit.** The PDF's Instagram→WhatsApp worked example produces the merge
  card, not a duplicate lead.

### MI3.4 — Commercial stage and estimated value

- **Goal.** The commercial queues get their predicate.
- **Depends on.** MI3.2, MI2.2.
- **Create.** `lib/inbox/intelligence/commercial-stage.ts` — a pure
  function deriving `commercial_stage` and `estimated_value_cents` from
  deterministic state (quote existence, booking existence, matched offer,
  payment state). **No model call.**
- **Modify.** `lib/inbox/intelligence/pipeline.ts`;
  `refresh_conversation_queues` gains the commercial queue predicates.
- **Tests.** Each stage transition has a fixture; value comes only from
  the matched offer, never from the model; a lost lead leaves every
  commercial queue.
- **Exit.** `NEW_ENQUIRIES`, `QUALIFIED`, `BOOKING_READY`, `QUOTE_SENT`
  populate correctly against a seeded agency.

---

### MI3.5 — Routing and auto-assignment (R3)

- **Goal.** Architecture §16 R3's four-step chain, so a conversation
  reaches the right person without a staff member triaging by hand.
- **Depends on.** MI3.3, MI2.2.
- **Migration.** `_mi3_5_inbox_routing_policy` — `inbox_routing_policy
  (agency_id pk, sticky_enabled default true, group_threshold default 10,
  load_balance_mode default 'LEAST_LOADED', respect_shifts default true,
  coordinator_role_by_queue jsonb)`, RLS'd; plus
  `staff_profiles.last_assigned_at` for the round-robin tie-break.
- **Create.** `lib/inbox/routing/resolve-owner.ts` — the pure four-step
  chain (owner-sticky → designated coordinator → least-loaded on-shift →
  `ai_settings.default_lead_owner_id`), taking candidate staff with their
  shift state and current load as input so it is fully unit-tested;
  `lib/inbox/routing/load.ts` — the weighted open-conversation count;
  `app/(main)/management/settings/inbox-routing-form.tsx`.
- **Modify.** `lib/agent/whatsapp/tools/handoff.ts` — `assignOwner()`
  delegates to the chain, keeping its current single-owner behaviour as
  the final fallback so nothing regresses for an unconfigured agency;
  `lib/inbox/intelligence/pipeline.ts` — assign on first inbound of an
  unassigned conversation.
- **Tests.** Sticky wins over least-loaded when the owner is on shift and
  loses when they are not; an off-shift, on-leave or deactivated staff
  member is never assigned and the conversation lands in `UNASSIGNED`
  with its SLA clock running; a party of 12 routes to the group
  coordinator; `VISA_ISSUES` routes to the visa role; round-robin breaks
  a load tie deterministically by `last_assigned_at`; an agency with no
  policy row behaves exactly as it does today.
- **Exit.** A new enquiry from a known customer reaches their existing
  owner; an unknown 12-person enquiry reaches the group coordinator.

---

## 5. Phase 4 — protection (G4) and continuity (G6, G7)

This is the phase that makes the Inbox operationally essential rather than
merely clever.

### MI4.1 — Rule-based risk detectors

- **Goal.** Eleven deterministic detectors, no model, no cost.
- **Depends on.** MI2.1.
- **Migration.** `_mi4_1_approved_payment_accounts` — an approved-account
  list on `agency_settings` (or its own small table) so
  `BANK_DETAIL_MISMATCH` has a locked source of truth, RLS'd, editable by
  Admin/Finance only; plus
  `agency_settings.offer_snapshot_max_age_minutes` (default 60), R1's only
  time-based knob, which governs *display* refresh and never a send.
- **Create.** `lib/inbox/risk/detectors/*.ts` — one file per detector from
  Architecture §6 S4's table, each pure, each with its own test file;
  `lib/inbox/risk/registry.ts`; `lib/inbox/risk/run.ts`.
- **Modify.** `lib/inbox/intelligence/pipeline.ts` — add S4 rules.
- **Tests.** Per detector: a positive, a negative, and a
  near-miss. `PAYMENT_CLAIM_UNVERIFIED` must fire when a claim exists and
  no confirmed payment does, and must **not** fire when finance has
  confirmed it. `BANK_DETAIL_MISMATCH` must fire on a digit sequence
  absent from the approved list and not on an approved one.
  `STALE_PRICE_QUOTED` must fire when `priced_at` has moved and **not**
  fire merely because the snapshot is old (R1 — this is the test that
  keeps the cheap, correct behaviour from regressing into a timer).
- **Exit.** Detectors run on live traffic in shadow with precision
  measured per detector; `PAYMENT_CLAIM_UNVERIFIED` precision ≥ 95 % is
  the gate for MI4.2.

### MI4.2 — Interventions and the protection gate

- **Goal.** A compact "human review required" card, and a hard block on
  confirming what must not be confirmed.
- **Depends on.** MI4.1.
- **Create.** `app/inbox/components/conversation-intervention-card.tsx`
  — headline, guidance, required action, assign-to-role, resolve/dismiss
  with a note. `lib/inbox/risk/protection-gate.ts` — refuses a draft or an
  automated send while a blocking intervention is open.
  `lib/inbox/risk/never-promise.ts` — the Architecture §10.3 deny list as
  a constant plus a phrase matcher.
- **Modify.** `lib/ai/trust/claim-verifier.ts` — add the never-promise
  check alongside the existing ungrounded-figure check.
  `lib/ai/surfaces/inbox/workflows.ts` — consult the protection gate
  before drafting. `app/inbox/actions.ts` — the send action
  re-checks the gate server-side (hiding a button is never the boundary).
- **Tests.** A test per deny-list entry asserting the phrase is refused at
  **every** autonomy level; an open `PAYMENT_CLAIM` intervention blocks a
  draft containing a confirmation; resolving it unblocks; the gate is
  enforced in the Server Action even when the client sends the request
  directly.
- **Exit.** The PDF's worked example ("customer says they paid LKR
  250 000, no payment recorded") produces the intervention card, a Finance
  review task, and a draft that acknowledges without confirming.

### MI4.3 — Model-assisted risk classification

- **Goal.** The four judgement-dependent detectors, in one batched call.
- **Depends on.** MI4.2.
- **Migration.** `_mi4_3_inbox_risk_surface` — seed `INBOX_RISK`
  (`SHADOW`, disabled).
- **Create.** `lib/ai/surfaces/inbox/risk-classify.ts` — one
  `classify`-tier call returning complaint / fraud-concern /
  medical-urgency / religious-ruling flags with confidence.
- **Modify.** `lib/inbox/risk/run.ts` — run rules first, call the model
  only when rules are inconclusive **and** the gate allowed enrichment.
- **Tests.** A labelled fixture set of 40 messages; a distressed message
  is never classified as routine (recall on `DISTRESSED` ≥ 95 % is the
  gate); a model failure falls back to the lexicon, never to "no risk".
- **Exit.** Shadow review shows no missed complaint over a week of live
  traffic.

### MI4.4 — Collision protection and presence

- **Goal.** The PDF's §10 requirement that two staff never reply at once.
- **Depends on.** MI2.1.
- **Create.** `app/inbox/components/composer-presence-banner.tsx`.
- **Modify.** `app/inbox/components/message-composer.tsx` — claim
  `composing_by`/`composing_at` on focus, release on blur/send, with a
  heartbeat; `app/inbox/actions.ts` — a soft claim action;
  `20260916081405_inbox_realtime_broadcast.sql`'s presence policy is
  already in place, so this rides the existing topic.
- **As built.** The lease is implemented in
  `lib/data/inbox-composer-presence-repository.ts`: a conditional,
  agency-scoped update refuses to overwrite another staff member's fresh
  60-second heartbeat; a claim becomes stale after two minutes. Claim and
  release synchronise the transient `CONCURRENT_COMPOSER` signal on the
  trusted worker client, while the composer remains sendable at all times.
- **Tests.** A stale claim (older than the heartbeat window) is ignored;
  the banner never hard-blocks a reply, only warns (a hard lock strands a
  conversation when a tab closes); `CONCURRENT_COMPOSER` signal is written.
- **Exit.** Two browser sessions on one conversation each see the other.

### MI4.5 — Sales→operations handoff summary

- **Goal.** The PDF's §11 artifact.
- **Depends on.** MI3.4.
- **Migration.** `_mi4_5_conversation_handoffs` — the table in
  Architecture §5.9, RLS'd. *As built:* also seeds `INBOX_HANDOFF`
  disabled/`SHADOW`; grants authenticated staff UPDATE on acknowledgement
  columns only so the handed-over snapshot is immutable through the Data
  API; adds JSON/sentiment constraints and the standing `updated_at`
  trigger/index conventions.
- **Create.** `lib/inbox/handoff/build.ts` — assembles the deterministic
  summary (customer, selection, commercial status, open items from
  `departure_group_readiness_items` + missing documents + payment state);
  `lib/ai/surfaces/inbox/handoff-narrate.ts` — a `draft`-tier call that
  only narrates customer expectations and sentiment, never facts;
  `app/inbox/components/handoff-summary-sheet.tsx`.
- **Modify.** `app/inbox/actions.ts`; the Operations module's
  booking view to surface an unacknowledged handoff.
- **As built.** Creation is a deliberate action on a confirmed booking.
  The deterministic snapshot is saved once per booking; the narrator is
  actually invoked by that action and stores its expectations with
  `RULES`/`LLM` attribution and confidence. Operations sees open items and
  acknowledges through a dedicated capability; a repeat click returns the
  original immutable snapshot rather than silently rewriting history.
- **Tests.** Open items are computed, not generated — a fixture with two
  missing passport scans yields exactly "2 passport scans missing"; the
  narration cannot introduce a figure (`verifyClaims`); acknowledgement is
  recorded with an actor.
- **Exit.** A confirmed booking produces a handoff that Operations can
  acknowledge, and the conversation links to it.

### MI4.6 — Conversation → workflow conversions

- **Goal.** The PDF's §13 — sixteen conversions, none a dead end.
- **Depends on.** MI3.2, MI4.2.
- **Migration.** `_mi4_6_conversation_source_links` — add
  `source_conversation_id` / `source_message_id` (nullable, composite FK)
  to every target table that lacks them (quotes, tasks, document
  requests, visa tasks, support cases, rooming/transport requests,
  feedback requests), each indexed.
- **Create.** `lib/agent/kernel/proposals/kinds/conversation-*.ts` — the
  new proposal kinds, registered in the existing
  `lib/agent/kernel/proposals/registry.ts` so approval, audit and
  execution are inherited, not rebuilt.
  `app/inbox/components/conversation-convert-menu.tsx`.
- **Modify.** `lib/agent/kernel/proposals/capabilities.ts` — capability
  keys per conversion; `lib/access/inbox-access.ts` — the matching
  capabilities; `app/inbox/actions.ts`.
- **As built.** Twelve proposal kinds through a parameterised framework (typed fields, server-supplied choices, per-kind module capability) plus the `convertConversation` capability on `inbox`; lead, quote and booking keep their own buttons and stamp the same source link; departure-group assignment only selects and creates nothing. Task conversions assign the relevant group owner (or the approving staff member) and notify them; complaint cases use Support's high-priority 24-hour SLA. A second migration (`_mi4_6b`) covers the tables the first did not. Details, the tenant-safety fix to traveller matching and the remaining open items are in `checklist.md`.
- **Tests.** Per conversion: created object carries both source columns;
  capability denial is enforced server-side; a proposal rejected leaves no
  partial write (transactional); an idempotency key prevents a
  double-click creating two objects.
- **Exit.** The PDF's passport-expiry example offers `[Open existing
  pilgrim] [Create document issue] [Request renewal document] [Assign Visa
  Officer] [Draft safe reply]`, and each works.

---

## 6. Phase 5 — grounded replies, media, and channel policy

### MI5.1 — Widen the reply pack and the draft surface

- **Goal.** The PDF's §5 — a draft built on verified offer facts, not lead
  columns.
- **Depends on.** MI3.2, MI4.2.
- **Create.** `lib/inbox/reply-pack.ts` — the widened fact pack (matched
  offer with `as_of`, live seats, priced room type, approved inclusions,
  policy thresholds, open interventions, channel state, approved template
  list, agency brand voice and SOP block), redacted through the existing
  `redact()` backstop.
- **Modify.** `lib/inbox/reply-context.ts` — keep as the narrow pack for
  the no-intelligence fallback path; `lib/ai/surfaces/inbox/workflows.ts`
  — accept the widened pack, split system (frozen: persona, SOP, brand
  voice — cached) from instruction (volatile: pack + digest);
  `app/inbox/components/message-composer.tsx` — the draft lands
  **inside** the composer, editable, with `[Edit] [Send] [Attach
  brochure] [Create quote]`.
- **Tests.** A draft quoting a figure absent from the pack is withheld
  (existing `verifyClaims` behaviour, re-asserted with the wider pack); a
  draft is refused while a blocking intervention is open; a stale price
  snapshot refuses; the system block is identical across calls for one
  agency (so the prompt cache actually hits) — assert by fingerprint.
- **Exit.** The PDF's suggested-reply example is reproducible against
  seeded data, with real inclusions and real availability.

### MI5.2 — Answer cache

- **Goal.** Architecture §8.4 — FAQ deflection at near-zero cost.
- **Depends on.** MI5.1.
- **Migration.** `_mi5_2_conversation_answer_cache` — the table in
  Architecture §5.6 with an HNSW/IVFFlat index on the 1024-dim embedding
  matching `knowledge_chunks`' configuration; RLS'd; plus a
  `knowledge_version` counter on `agency_settings` bumped by knowledge,
  package and pricing writes.
- **Create.** `lib/inbox/answers/eligibility.ts` — R4(a) as a pair of code
  constants: the cacheable intent classes, and `NEVER_CACHEABLE`
  (any price or availability figure, visa outcome or eligibility, payment
  or refund question, medical advice, religious ruling, or anything
  naming a specific traveller). Sits beside
  `lib/inbox/risk/never-promise.ts` and is tested the same way.
  `lib/inbox/answers/cache.ts` — lookup, candidate proposal after the
  third consistent answer, write-back on approval, invalidate on version
  bump, 90-day unused expiry, retirement after two rejections or heavy
  edits with the reason recorded; `lib/inbox/answers/cache.test.ts`.
  `app/(main)/management/ai-agent/knowledge/approved-answers.tsx` — the
  approval queue.
- **Modify.** `lib/ai/surfaces/inbox/workflows.ts` — consult the cache
  before the knowledge RAG path, and refuse to cache anything
  `eligibility.ts` excludes. `lib/access/insights-access.ts` and the
  `role_permissions` seed — the new `approveInboxAnswer` capability,
  defaulting to ADMIN and CEO only per R4(b), grantable to another role
  through the existing dynamic role-permissions system.
- **Tests.** A hit requires matching `knowledge_version` **and** the
  similarity threshold; a version bump invalidates; an unapproved answer
  is never served; no cross-tenant hit is possible (a two-agency fixture
  with identical questions). One test per `NEVER_CACHEABLE` class
  asserting it cannot be written to the cache even by an admin — a price
  answer is the one that matters most. A candidate is not proposed on the
  first or second occurrence; an entry unused for 90 days stops being
  served; two rejections retire it with a reason; a staff member without
  `approveInboxAnswer` is refused server-side.
- **Exit.** Hit rate visible in the KPI view; the same question twice
  makes one model call, not two.

### MI5.3 — Full channel-policy state and the `HUMAN_AGENT` path (G14)

- **Goal.** Architecture §10.4's table, enforced and displayed.
- **Depends on.** None (independent of intelligence).
- **Migration.** `_mi5_3_human_agent_window` — add
  `human_agent_window_expires_at` to `conversations`, maintained on
  inbound.
- **Create.** `lib/channels/policy-state.ts` — one function returning the
  full state (window, allowed action, template requirement, tag
  eligibility, projected charge) per channel;
  `app/inbox/components/channel-policy-banner.tsx` and
  `template-picker-sheet.tsx` (categorised Marketing / Utility /
  Authentication with the charge shown before sending);
  `docs/runbooks/channel-messaging-policy-verification.md` — the quarterly
  re-verification procedure against Meta's policy pages.
- **Modify.** `lib/inbox/composer-state.ts` — return the richer state
  while keeping the existing block reasons; `lib/channels/profile.ts` and
  each adapter — declare tag support; `lib/inbox/outbox/drain.ts` and the
  Messenger/Instagram clients — send the `HUMAN_AGENT` tag **only** for a
  human-authored reply on a conversation in `HUMAN_ACTIVE` with an open
  support case.
- **Tests.** A state test per row of the Architecture §10.4 table; the tag
  is refused for every automated surface at every autonomy level (the
  critical policy test); beyond 7 days no send is attempted and the UI
  recommends re-engagement; the projected charge matches
  `whatsapp_message_charges`' rate source.
- **Exit.** No delivery failure attributable to a window/tag mistake over
  a week of live traffic.

### MI5.4 — Media intelligence (G8)

- **Goal.** The PDF's §12 — voice, passport images, payment receipts,
  brochures. All on the BULK lane.
- **Depends on.** MI1.2, MI4.2.
- **Migration.** `_mi5_4_message_media_analyses` — analyses keyed to
  `message_attachments`, reusing the `document_ai_analyses` shape where it
  fits; a `sensitive_kinds` marker written at ingest before any model sees
  the message.
- **Create.** `lib/inbox/media/classify.ts` (document type),
  `lib/inbox/media/passport.ts` (fields → compare to the pilgrim record →
  flag mismatch/expiry → route to document review),
  `lib/inbox/media/receipt.ts` (amount / reference / date → attach as
  payment **proof**, never a confirmation),
  `app/inbox/components/attachment-intelligence-card.tsx` (uncertain
  fields highlighted, original always playable/viewable).
- **Modify.** `lib/agent/whatsapp/voice.ts` / `lib/ai/transcription.ts` —
  keep the existing transcription path; surface uncertainty in the UI and
  always retain the original audio. Attachment ingest enqueues BULK jobs.
- **Tests.** A receipt never sets any payment state — it only opens a
  `PAYMENT_CLAIM` intervention with the proof attached (the single most
  important test in this slice); an expired passport raises
  `PASSPORT_EXPIRY_RISK`; low-confidence extracted fields are marked, not
  silently applied; a transcription is never treated as authoritative
  (original retained and linked).
- **Exit.** A voice note becomes a summary with the audio still playable;
  a passport image opens a document review with candidate fields;
  a receipt opens a Finance review.

---

## 7. Phase 6 — autonomy, owner view, and commercial

### MI6.1 — Autonomy ladder for Inbox surfaces (G9)

- **Goal.** L0–L3 per agency per surface, with the deny list in code.
- **Depends on.** MI4.2, MI5.1.
- **Migration.** `_mi6_1_inbox_autonomy` — seed `INBOX_REPLY`,
  `INBOX_INTAKE` surfaces (`SHADOW`, disabled) and define the
  `autonomy` jsonb shape (`safe_replies`, `intake_flow`,
  `office_hours`, `approved_template_ids`, `handover_triggers`).
- **Create.** `lib/inbox/autonomy/level.ts` — resolve the effective level
  from plan entitlement ∧ `ai_surface_settings` ∧ conversation state;
  `lib/inbox/autonomy/send-gate.ts` — the final refusal point for every
  automated send; `lib/inbox/autonomy/promotion.ts` — R5's gate as one
  pure function returning `{eligible, blockers[]}` over the five
  thresholds (≥ 7 days and ≥ 200 shadow decisions, triage accuracy
  ≥ 85 %, `PAYMENT_CLAIM_UNVERIFIED` precision ≥ 95 %, zero deny-list
  violations, rejection rate under `rejection_demote_threshold`), plus
  the 14-day narrow-scope window that follows promotion;
  `lib/inbox/autonomy/level.test.ts`, `promotion.test.ts`.
- **Modify.** `app/(main)/management/ai-agent/ai-agent-form.tsx` — the
  level selector with a plain-language description of what each level may
  do, the never-autonomous list shown read-only, and the L2 control
  **disabled with its blockers named** until `promotion.ts` says eligible
  (R5); `lib/inbox/outbox/drain.ts` — consult the send gate.
- **Tests.** The entitlement ceiling wins over the surface setting; each
  deny-list item is refused at L3; demotion fires when the rolling
  rejection rate crosses `rejection_demote_threshold` and tells the owner
  why, using the same thresholds as promotion; L2 can send only from the
  approved template/answer set. R5 specifically: an agency with 7 days
  but only 150 decisions is **not** eligible; one meeting every threshold
  is; within the 14-day narrow window an in-hours send is refused and an
  out-of-hours acknowledgement is allowed; the window expiring widens
  scope only if the thresholds still hold.
- **Exit.** An agency can be moved L0→L1→L2 with observable, reversible
  behaviour change and a complete audit trail, and the L2 control cannot
  be enabled while any R5 blocker stands.

### MI6.2 — L3 bounded autonomous intake

- **Goal.** The PDF's workflow 1 — 24/7 pilgrimage lead intake.
- **Depends on.** MI6.1, MI3.2.
- **Create.** `lib/inbox/autonomy/intake-flow.ts` — a declared state
  machine (dates → departure city → room arrangement → passport
  readiness), each step drawing from approved questions, with mandatory
  handover triggers before price negotiation, booking confirmation, or any
  deny-list topic; `lib/inbox/autonomy/__evals__/*` in the pattern of
  `lib/agent/departure-ops/__evals__/*`.
- **Modify.** `lib/agent/whatsapp/tools/registry.ts` — the intake tool set
  is a strict subset; no tool that writes money or confirms inventory.
- **Tests.** Evals for the PDF's eight-step worked example; a price
  question mid-flow triggers handover, not an answer; a flow never
  completes a booking; a flow that stalls hands off to a human with a
  summary; the whole flow works in Sinhala and Tamil.
- **Exit.** Overnight enquiries produce provisional leads, correct queue
  assignment, and a human-review requirement, with zero deny-list
  violations across the eval suite.

### MI6.3 — Owner inbox intelligence (G10)

- **Goal.** The PDF's §"What the CEO sees" — eleven drillable numbers.
- **Depends on.** MI2.2, MI4.2, MI3.4.
- **Migration.** `_mi6_3_inbox_owner_kpis` — a `security invoker` view
  over `conversation_queue_membership` and `conversation_interventions`.
- **Create.** `app/(main)/dashboard/components/inbox-intelligence-panel.tsx`
  — each number a link to `/inbox?queue=<code>`.
- **Modify.** `lib/data/dashboard-repository.ts`;
  `lib/access/insights-access.ts`.
- **Create (cont.)** `lib/inbox/pipeline-value.ts` — R6's per-currency
  bucketing: sums `matched_offer` values into one figure **per currency**,
  agency default currency first, others descending, never converted and
  never summed across currencies, following the
  `report_group_facts.supplier_cost_by_currency` precedent.
- **Tests.** Every number equals a brute-force count over the fixture; no
  number originates from a model; RLS scopes every count. R6
  specifically: a two-currency fixture renders two labelled figures and
  never a combined total; a single-currency agency renders exactly one
  figure with no extra chrome; there is no FX rate anywhere in the code
  path (asserted by the absence of any conversion input); every figure
  carries the word "estimate" and links to its queue.
- **Exit.** Each number drills to the exact underlying queue, and a
  multi-currency agency sees per-currency figures with no invented total.

### MI6.4 — Plans, entitlements and metering (G13)

- **Goal.** The commercial model in Architecture §14.
- **Depends on.** MI0.1.
- **Migration.** `_mi6_4_plans_entitlements` — `plans` (platform-global,
  readable by all, writable by service_role, like `ai_model_rates`),
  `agency_subscriptions`, `agency_usage_counters`; RLS'd; seed the four
  plan rows from Architecture §14.4 and put every existing agency on a
  grandfathered plan so nothing degrades on deploy.
- **Create.** `lib/billing/entitlements.ts` — `resolveEntitlements(agencyId)`
  with a short cache; `lib/billing/meter.ts` — increment
  `AI_CONVERSATIONS` once per conversation per billing period (idempotent
  on `(agency_id, conversation_id, period)`);
  `app/platform/agencies/[agencyId]` — plan assignment for platform
  admins; `app/(main)/management/settings` — a read-only usage/allowance
  card for the agency.
- **Modify.** `lib/ai/budget.ts` — replace the on/off-only check with the
  degradation ladder in Architecture §8.6, preserving both invariants (a
  human reply is never blocked; S4 rules never stop);
  `lib/inbox/intelligence/gate.ts` — read the exhausted-entitlement
  condition.
- **Tests.** The metering counter is idempotent across retries and
  webhook redelivery; each rung of the degradation ladder is asserted; a
  human staff send succeeds at 200 % utilisation; risk detection runs at
  200 % utilisation; an entitlement downgrade cannot raise an autonomy
  level already set above the new ceiling (it clamps and records why).
- **Exit.** An agency at its allowance degrades exactly as specified, the
  owner sees why, and no customer conversation is silenced.

### MI6.5 — Scale verification

- **Goal.** Prove the Architecture's SLOs, not assume them.
- **Depends on.** every slice except MI6.6, which can land in parallel.
- **Create.** `scripts/load/inbox-multitenant.ts` — 50 agencies × 200
  conversations × a synchronised burst; `docs/progress/` snapshot of the
  results; `docs/runbooks/inbox-intelligence-operations.md` — queue depth
  alarms, lane starvation, budget exhaustion, provider outage, and the
  replay procedure.
- **Tests.** Assert each SLO from Architecture §12; assert the S0 skip
  rate and cost-per-enriched-conversation are within target; assert no
  agency's REALTIME p95 degrades by more than 20 % under another agency's
  burst.
- **Exit.** Every SLO met, results recorded, runbook written.

### MI6.6 — Retention and deletion (R7)

- **Goal.** Architecture §16 R7's table, executed nightly, sharing one
  code path with the existing data-deletion endpoints.
- **Depends on.** MI2.1, MI5.4, MI1.2. Independent of MI6.1–MI6.5 and can
  run in parallel with Phase 5.
- **Migration.** `_mi6_6_conversation_retention` — retention columns
  beside the ones `agency_settings` already has
  (`booking_linked_message_retention_years` default 7,
  `enquiry_message_retention_months` default 24,
  `inbox_attachment_retention_days` default 90,
  `voice_audio_retention_days` default 180,
  `intelligence_retention_months` default 24,
  `ai_run_retention_months` default 13,
  `webhook_payload_retention_days` default 30), each with a **check
  constraint enforcing R7's platform bounds** (booking-linked ≥ 3 and ≤ 10
  years; attachments ≤ 365 days; webhook payloads ≤ 90 days) so a bound is
  enforced by the database, not by a form; plus
  `inbox_retention_sweeps (id, agency_id, ran_at, scope, rows_deleted,
  objects_deleted, dry_run, error)` as the audit trail.
- **Create.** `lib/inbox/retention/policy.ts` — a pure
  `resolveRetention(settings)` returning the effective window per scope,
  clamped to the platform bounds; `lib/inbox/retention/sweep.ts` — the
  idempotent, batched sweep for each scope, with a `dryRun` mode that
  counts without deleting; `lib/inbox/retention/promote-attachment.ts` —
  the explicit staff action that moves an attachment into the Documents
  module (where `document_retention_years` and its stricter access
  control take over) instead of letting it expire;
  `app/(main)/management/settings/inbox-retention-form.tsx` — the
  per-agency form, showing the platform bound beside each field;
  `docs/runbooks/inbox-retention-and-deletion.md`.
- **Modify.** `app/api/cron/*` — register the nightly BULK-lane sweep;
  `app/legal/data-deletion` and `app/api/webhooks/meta/data-deletion` —
  route through `sweep.ts` so a Meta-initiated deletion and the retention
  sweep behave identically; `app/inbox/components/attachment-intelligence-card.tsx`
  — a "Save to documents" action and a visible expiry date on every
  attachment.
- **Tests.** Each scope deletes exactly what R7's table specifies and
  nothing adjacent — a booking-linked conversation is **not** swept at
  24 months (the test that protects the dispute record); an unconverted
  enquiry is; an attachment promoted to Documents survives the 90-day
  expiry while an unpromoted one does not; a resolved intervention
  outlives the message that caused it; the sweep is idempotent across
  re-runs and resumable after a mid-batch failure; a settings value
  outside the platform bounds is rejected by the check constraint, not
  just by the form; every sweep writes an `inbox_retention_sweeps` row;
  a Meta deletion request and a retention sweep produce identical
  end-state for the same subject; retention is identical across plan
  tiers (asserted, since R7 makes it deliberately not a plan feature).
- **Exit.** A dry run over a seeded agency reports the expected counts per
  scope, the live sweep matches them, and no passport attachment older
  than its retention window remains in the message store.

---

## 8. Cross-cutting requirements for every slice

Checked in review; a slice missing any of these is not done.

1. **Security.** New table ⇒ RLS in the same migration. New Server Action
   or Route Handler ⇒ `requireUser()` first, capability check, Zod at the
   boundary, agency-scoped read/write. New `security definer` function ⇒
   `set search_path = ''` and an explicit, minimal `grant`.
2. **Naming.** No generic component or function names. `ConversationOfferCard`,
   not `Card`; `refreshConversationQueues`, not `refresh`.
3. **UI.** shadcn through MCP only. Every input in the mandated
   `InputGroup` composition. No new colours. Copy that a non-technical
   staff member understands, per
   [`docs/standards/ui-standards.md`](../standards/ui-standards.md).
4. **AI.** All model calls through `generateStructured()` or the shared
   tool runner. `surface`, `agencyId`, `subjectType`, `subjectId` always
   passed. Never throw to the caller — return `{value: null, source:
   "RULES", note}` and let the deterministic fallback take over.
5. **Attribution.** Every AI-derived value shows `RULES` vs `LLM` and its
   confidence, per the copilot attribution convention.
6. **Tests.** Business-rule branching gets a Vitest test. Every new
   repository function gets a two-agency cross-tenant isolation test.
   `npm run lint && npm run typecheck && npm run test` green before the PR.
7. **Docs.** Update this plan and the Architecture when implementation
   diverges. A phase completing gets a snapshot in `docs/progress/`.

---

## 9. Slice index and sequencing

| Slice | Deliverable | Depends on | Flag |
|---|---|---|---|
| MI0.1 | AI cost ledger completed | — | — |
| MI0.2 | Pipeline contracts | — | — |
| MI0.3 | Observability baseline | MI0.1 | — |
| MI1.1 | `channel_jobs` + fair-share claim | MI0.2 | — |
| MI1.2 | Lane workers + settle delay | MI1.1 | — |
| MI1.3 | Worker shard fan-out | MI1.2 | — |
| MI2.1 | Projection tables | MI0.2 | `inbox_intelligence` |
| MI2.2 | Queue membership + rail | MI2.1 | `inbox_queues_v2` |
| MI2.3 | S0 gate | MI2.1 | `inbox_intelligence` |
| MI2.4 | S1 triage | MI2.3, MI1.2 | `ai_surface_settings` |
| MI2.5 | Context rail reads projection | MI2.4 | baseline |
| MI2.6 | SLA policy + deadline clock (R2) | MI2.2 | `inbox_queues_v2` |
| MI3.1 | S2 travel intent | MI2.4 | `ai_surface_settings` |
| MI3.2 | S3 live offer matching | MI3.1 | `plans.features.offer_matching` |
| MI3.3 | Identity graph + merge review | MI2.1 | `plans.features.identity_resolution` |
| MI3.4 | Commercial stage + value | MI3.2, MI2.2 | `inbox_queues_v2` |
| MI3.5 | Routing + auto-assignment (R3) | MI3.3, MI2.2 | `inbox_queues_v2` |
| MI4.1 | Rule risk detectors | MI2.1 | baseline |
| MI4.2 | Interventions + protection gate | MI4.1 | baseline |
| MI4.3 | Model-assisted risk | MI4.2 | `ai_surface_settings` |
| MI4.4 | Collision protection | MI2.1 | — |
| MI4.5 | Handoff summary | MI3.4 | `inbox_intelligence` |
| MI4.6 | Conversation→workflow conversions | MI3.2, MI4.2 | — |
| MI5.1 | Widened reply pack + composer draft | MI3.2, MI4.2 | `ai_surface_settings` |
| MI5.2 | Answer cache | MI5.1 | `plans.features.answer_cache` |
| MI5.3 | Channel policy state + `HUMAN_AGENT` | — | — |
| MI5.4 | Media intelligence | MI1.2, MI4.2 | `plans.features.media_intelligence` |
| MI6.1 | Autonomy ladder | MI4.2, MI5.1 | `plans.autonomy_ceiling` + `ai_surface_settings` |
| MI6.2 | L3 bounded intake | MI6.1, MI3.2 | `plans.autonomy_ceiling` + `ai_surface_settings` |
| MI6.3 | Owner intelligence panel | MI2.2, MI4.2, MI3.4 | `plans.features.owner_panel` |
| MI6.4 | Plans, entitlements, metering | MI0.1 | `plans.features` |
| MI6.5 | Scale verification + runbooks | all but MI6.6 | — |
| MI6.6 | Retention + deletion (R7) | MI2.1, MI5.4, MI1.2 | — |

### Parallelisation

- MI5.3 (channel policy) is independent of the whole intelligence stack
  and can run alongside Phase 1 or 2 — it is also the highest
  value-per-effort slice for an agency already sending on Meta channels.
- MI4.4 (collision) is independent after MI2.1.
- MI6.4 (commercial) only needs MI0.1 and can run in parallel with
  Phase 3–5.
- MI6.6 (retention) needs only MI2.1, MI5.4 and MI1.2, and should land
  **before** an agency accumulates a year of attachments rather than
  after — a retention policy applied retroactively to a full store is a
  migration, not a sweep.
- MI1.x must land before MI2.4 ships to more than a pilot agency;
  shipping model calls onto the unfair single FIFO is the one sequencing
  mistake that will be felt in production.

### Value checkpoints

The PDF's own advice — make five things excellent before adding autonomy —
maps to these checkpoints:

| After | An agency can |
|---|---|
| Phase 2 | See intent, urgency and business-consequence queues; work by consequence instead of channel |
| Phase 3 | Attach a conversation to the right lead, and answer an availability question with live, correct figures |
| Phase 4 | Be protected from premature payment confirmation, and hand a booking to Operations with the whole story |
| Phase 5 | Reply with a grounded draft, never hit a channel-policy failure, and read voice notes and receipts |
| Phase 6 | Run bounded automation overnight, see commercial risk as an owner, and be billed for it |

Do not ship Phase 6 to an agency that has not run Phase 2–4 in shadow for
at least a week. Autonomy on top of unmeasured intelligence is the one
failure mode that loses an agency's trust permanently.

---

## 10. Definition of done for the whole programme

- All fifteen gaps (G1–G15) in Architecture §3.2 closed, each with a
  test naming its gap id.
- All seven resolved decisions (R1–R7 in Architecture §16) implemented
  and covered: change-detection staleness (not a timer), per-queue SLA
  with the channel window outranking it, owner-sticky routing,
  answer-cache eligibility and ADMIN/CEO approval, evidence-gated L2
  promotion, per-currency bucketing with no FX conversion anywhere, and
  retention bounds enforced by database constraint.
- Every SLO in Architecture §12 met under the MI6.5 load test.
- AI cost per enriched conversation ≤ $0.012 measured, not estimated.
- S0 skip rate ≥ 50 % measured on live traffic.
- Zero cross-tenant leakage across every retrieval path, asserted by a
  two-agency fixture in every repository test file.
- Every never-autonomous item refused at every autonomy level, with a test
  per item.
- The current WhatsApp reply path behaves identically to its pre-programme
  baseline for an agency with every new flag off.
- `docs/inbox/architecture.md` and this plan
  updated to match what was actually built, with a `docs/progress/`
  snapshot per phase.
