# Manasik Inbox + Manasik Copilot — Target Architecture

> **Product promise:** every message becomes a lead, a task, a booking
> action, or a resolved conversation — never just another chat.

Status: **design record, partly built.** Slices MI0.1 to MI4.5 are on `main`
(see [`checklist.md`](./checklist.md) for exactly what is done and what each
slice's exit criterion still needs); Phases 5 and 6 are not started. Where a
slice deviated from this design, the deviation is recorded on that slice's
line in the checklist and the plan. It is the cross-cutting design record for turning the existing Unified Inbox
(`app/inbox`, `lib/inbox`, `lib/channels`, `lib/agent/whatsapp`)
into an agency communication operating system.

Companion documents:

| Doc | Role |
|---|---|
| [`docs/inbox/implementation-plan.md`](./implementation-plan.md) | The ordered, slice-by-slice build sequence for this design |
| [`docs/modules/inbox-architecture.md`](../modules/inbox-architecture.md) | The channel-neutral conversation platform this builds **on top of** (already largely delivered) |
| [`docs/modules/manasik-intelligence-implementation-plan.md`](../modules/manasik-intelligence-implementation-plan.md) | The AI surface/autonomy/proposal framework this reuses rather than re-invents |
| [`docs/architecture/ai-model-selection.md`](../architecture/ai-model-selection.md) | Why the tier→model mapping in `lib/ai/provider.ts` is what it is |

---

## 1. Executive decision

Build **two** clearly separated products on one codebase:

1. **Manasik Inbox** — a fast, professional, channel-aware communication
   workspace. It must feel like a messaging client, not like an AI demo.
   It stays usable and fully functional with every AI surface switched
   off.
2. **Manasik Copilot** — an intelligence layer that reads conversations,
   understands travel intent, matches live offers, detects risk, and
   proposes actions. It **never** blocks a staff member, **never** sends
   an unapproved external message below its configured autonomy level,
   and **never** states a figure that is not in a deterministic fact
   pack.

The architecture rests on one rule that makes the whole thing both cheap
and trustworthy:

> **The deterministic system is the source of truth. The model interprets
> the customer and writes the prose.**

Seat counts, prices, availability, balances, policy deadlines and
eligibility come from SQL against tenant-scoped tables. The LLM's only
jobs are (a) turning messy human text into a structured intent, (b)
classifying risk/urgency, and (c) writing a reply constrained to facts it
was handed. Everything commercially or legally consequential is computed,
not generated.

Three consequences follow, and they are the reason this design is
affordable at multi-tenant scale:

- **Correctness is bounded** — an LLM regression cannot mis-price a
  package, because the LLM never computes a price.
- **Cost is bounded** — the expensive reasoning surface is small, and most
  inbound traffic never reaches a model at all (§8).
- **Latency is bounded** — every screen renders from deterministic
  projections; model output arrives later, over the realtime channel that
  already exists (§7.5).

---

## 2. What is going to change

### 2.1 The product shift

| Today | After this plan |
|---|---|
| An omnichannel inbox with an AI reply-draft button | A work-queue driven operations console where the queue itself is the intelligence |
| Queues = channel + assignment (`lib/inbox/views.ts`) | Queues = business consequence: New enquiries · Qualified · Booking-ready · Quote sent · Payment discussions · Documents · Visa issues · Departure changes · Complaints · Escalations |
| Copilot drafts a reply from lead columns (`lib/inbox/reply-context.ts`) | Copilot drafts from a verified offer: live departure group, live seats, live priced room type, approved inclusions |
| Offer matching lives only in the Leads module (`app/(main)/leads/copilot-actions.ts`) | Offer matching is a first-class Inbox surface, reachable from the conversation the question was asked in |
| Identity = one phone on one conversation | A cross-channel identity graph with staff-approved merges and an explicit "possible existing lead found" review card |
| AI ownership is binary (`AI_ACTIVE` / `AI_PAUSED`) | A four-level autonomy ladder per agency per surface, with a hard-coded never-autonomous deny list |
| Risk handling is a tag | A typed intervention record with an evidence link, a required action, and a routed owner |
| Conversation ends at the message list | Every conversation converts into one of ~16 operational objects, each linked back to the exact message |
| The owner sees message volume | The owner sees commercial signal and communication risk, every number drillable to its underlying queue |
| AI cost is unmeasured (`estimateCostUsd` returns `null`) | Per-run cost, per-agency daily ledger, plan entitlements, and a graceful degradation ladder |
| No plan/subscription concept on `agencies` | Plans, entitlements, metered AI conversations, and messaging pass-through |

### 2.2 What deliberately does **not** change

These are load-bearing and must survive the transformation intact:

- `leads` and `pilgrims` remain the customer sources of truth.
  `contact_identities` stays an **index**, never a competing master.
- `departure_group_bookings` remains the booking and seat-capacity source
  of truth; `departure_groups` + `departure_group_pricing` remain the
  price source of truth.
- Finance remains the source of truth for amount paid and outstanding
  balance. No Copilot surface may confirm a payment.
- Every Server Action starts with `requireUser()`; every read/write is
  agency-scoped; the service role is confined to verified webhooks and
  workers (`utils/supabase/admin.ts`).
- Provider credentials stay in Vault behind `credential_ref`
  (`lib/channels/vault.ts`, `lib/whatsapp/vault.ts`). No browser ever
  calls a channel API.
- One AI seam: `lib/ai/provider.ts`'s `generateStructured()` and the tool
  runner in `lib/agent/whatsapp/runtime.ts`. No surface opens its own
  client.
- The transactional outbox (`outbox_messages`, `lib/inbox/outbox/drain.ts`)
  remains the only path to a provider send.

---

## 3. Where the codebase already is

This is not a greenfield build. A large share of the PDF's vision is
already standing. Getting the sequencing right depends on being precise
about that.

### 3.1 Already delivered

| Capability | Where |
|---|---|
| Provider-neutral connections, identity index, match events | `channel_connections`, `contact_identities`, `identity_match_events` (`supabase/migrations/20260916073247_unified_inbox_core.sql`) |
| Canonical conversation/message model with lifecycle, handling mode, priority, SLA due, version, sequence numbers, idempotency keys | same migration, §C |
| Attachments, delivery events, event timeline, notes, mentions, saved replies, drafts, durable outbox | same migration, §D |
| WhatsApp, Messenger, Instagram adapters + OAuth + signature-verified webhooks + echo reconciliation + text splitting + attachment download | `lib/channels/*`, `lib/whatsapp/*`, `lib/meta/*`, `app/api/webhooks/*` |
| Durable job queue with `FOR UPDATE SKIP LOCKED` claims, stale-lock release, retry/dead-letter | `agent_jobs`, `lib/data/whatsapp-repository.ts`, `lib/agent/whatsapp/drain.ts` |
| Sub-second happy path: webhook acknowledges, then `after()` drains | `lib/whatsapp/webhook-handler.ts:278`, `lib/channels/messenger/webhook-handler.ts:294` |
| Scheduled guarantee drain | `app/api/cron/agent-jobs/route.ts` |
| Tool-calling agent loop with guardrails, free→paid model routing, quick replies, failed-turn handoff | `lib/agent/whatsapp/{runtime,guardrails,model-routing,quick-replies,failed-turn-handoff}.ts` |
| Tenant-scoped RAG knowledge base (bge-m3, 1024-dim, FTS + vector) | `knowledge_documents`, `knowledge_chunks`, `lib/ai/embeddings.ts`, `lib/agent/whatsapp/knowledge/*` |
| Voice-note transcription → same runtime as text | `lib/ai/transcription.ts`, `lib/agent/whatsapp/voice.ts` |
| Rule-based **and** LLM travel-intent extraction with per-fact evidence snippets | `lib/copilot/sales/intent-extraction.ts` (651 lines), `lib/copilot/sales/llm/openrouter-provider.ts` |
| Deterministic live offer matching: hard gates, ranking, waitlist, quote calculation | `lib/copilot/sales/offer-matching.ts` (522 lines), `quote-calculator.ts`, `knowledge-context.ts` |
| Ungrounded-figure blocking, consent gate, prompt fence, PII redaction | `lib/ai/trust/{claim-verifier,consent-gate,fence,redaction}.ts` |
| One AI provider seam with tiers, structured output, prompt caching, budget gate, telemetry | `lib/ai/provider.ts`, `lib/ai/budget.ts`, `lib/ai/telemetry.ts` |
| Per-agency per-surface autonomy ladder (`OFF/SHADOW/PROPOSE/ACTIVE`) with demotion threshold | `ai_surface_settings` (`supabase/migrations/20261108090000_ai_surface_settings.sql`) |
| **Proposal kernel** — typed proposals, capabilities, context packs, executor, approval events | `lib/agent/kernel/proposals/*` (agent_proposals, 15 proposal kinds) |
| Departure Operations Agent as the reference autonomous surface, with evals | `lib/agent/departure-ops/*` |
| Channel-policy-aware composer (Meta 24 h window, customer-first channels) | `lib/inbox/composer-state.ts` |
| Private, ID-only realtime invalidation with RLS on `realtime.messages` | `supabase/migrations/20260916081405_inbox_realtime_broadcast.sql` |
| Messaging spend ledger, per-agency budgets, dated model rate card | `whatsapp_message_charges`, `whatsapp_billing_budgets`, `ai_model_rates` |

**The intelligence primitives the PDF asks for mostly exist. They are
wired to the wrong screen.** Intent extraction and offer matching are
reachable from `/leads`, not from the conversation where the customer
actually asked the question.

### 3.2 The gaps

| # | Gap | Evidence |
|---|---|---|
| G1 | No conversation intelligence fields at all — no intent, urgency, stage, sentiment, potential value, risk, or next action on `conversations` | `20260916073247_unified_inbox_core.sql` adds none |
| G2 | Queues are channel/assignment only; no business-consequence queues | `lib/inbox/views.ts` — 9 views, all channel/ownership |
| G3 | Offer matching is not an Inbox surface | only consumer is `app/(main)/leads/copilot-actions.ts` |
| G4 | No risk/escalation engine: no payment-claim protection, stale-price guard, full-group guard, distress detection, or concurrent-composer lock | nothing in `lib/inbox` or `lib/ai/surfaces/inbox` |
| G5 | Identity resolution is per-provider only; no cross-channel graph, no staff-approved merge card | `contact_identities` unique on `(agency_id, provider, external_subject_id)`; `lib/inbox/lead-link-decision.ts` covers one lead link, not a merge review |
| G6 | No sales→operations handoff summary | no artifact anywhere |
| G7 | Conversation→workflow conversion stops at lead / booking / follow-up | `app/inbox/components/{capture-conversation-lead,create-booking,conversation-followup}*` only |
| G8 | Attachment intelligence not wired to the Inbox: passport/receipt extraction exists for the Documents module, not for inbound messages | `lib/data/{documents-ai,ticket-visa-ai,ticket-pdf-extraction}.ts` |
| G9 | Autonomy for the Inbox is binary; no L0–L3 ladder, no never-autonomous deny list in code | `conversations.handling_mode` has 4 values that mix ownership with autonomy |
| G10 | No owner-level inbox intelligence panel with drill-down | `/dashboard` and `/ai-insights` exist but carry no conversation-risk/commercial-signal view |
| G11 | AI cost is not measured per run; budget gate enforces on/off only | `lib/ai/telemetry.ts` `estimateCostUsd()` returns `null`; `lib/ai/budget.ts` header says so explicitly |
| G12 | Queue has no lanes, no per-tenant fairness, no per-tenant concurrency cap; the list view scans up to 5 000 rows per page load to compute counts | `lib/agent/whatsapp/drain.ts` (single FIFO, `CLAIM_BATCH_SIZE = 10`); `lib/data/inbox-repository.ts` `VIEW_SCAN_LIMIT = 5000` |
| G13 | No plan / entitlement / metering model on `agencies` | `supabase/migrations/20260824090000_tenancy.sql` — `agencies` has `name`, `slug`, `status` only |

Two more, narrower but real:

- **G14** — Meta's `HUMAN_AGENT` tag (a human-written reply up to 7 days
  after the customer's last message) is not modelled.
  `lib/inbox/composer-state.ts` currently tells staff the window is closed
  with no path forward, which under-uses a legitimate Meta mechanism for
  exactly the support case agencies hit most.
- **G15** — Language is handled inside the prompt but not as a
  conversation field, so there is no per-conversation language state,
  no staff-side translation view, and no language dimension in analytics.

---

## 4. Target architecture

```text
                        ┌───────────────────────────────────────────┐
  Meta webhooks ───────▶│  Channel edge (verify · persist · ack)    │  < 200 ms, no AI
  (WA · IG · Messenger) │  app/api/webhooks/* + lib/channels/*      │
                        └────────────────┬──────────────────────────┘
                                         │ enqueue (lane, coalesce key)
                        ┌────────────────▼──────────────────────────┐
                        │  Work lanes  (channel_jobs, fair-share)   │
                        │  REALTIME  ·  STANDARD  ·  BULK           │
                        └───┬──────────────┬──────────────┬─────────┘
                            │              │              │
        ┌───────────────────▼──┐  ┌────────▼───────┐  ┌───▼──────────────────┐
        │ Conversation         │  │ Identity       │  │ Media intelligence   │
        │ Intelligence Pipeline│  │ Resolution     │  │ (voice · doc · receipt)│
        │  S0 gate (no LLM)    │  │  graph + merge │  │  BULK lane only      │
        │  S1 triage (classify)│  │  proposals     │  └───┬──────────────────┘
        │  S2 intent (classify)│  └────────┬───────┘      │
        │  S3 offer (SQL only) │           │              │
        │  S4 risk (rules+LLM) │           │              │
        │  S5 next action      │           │              │
        └───────────┬──────────┘           │              │
                    │                      │              │
                    ▼                      ▼              ▼
      ┌─────────────────────────────────────────────────────────────────┐
      │  Projections (deterministic, agency-scoped, RLS)                │
      │  conversation_intelligence · conversation_signals ·             │
      │  conversation_interventions · conversation_queue_membership     │
      └───────────────┬─────────────────────────────────┬───────────────┘
                      │                                 │
                      ▼                                 ▼
      ┌───────────────────────────────┐   ┌──────────────────────────────┐
      │  Action layer                 │   │  Inbox workspace (RSC)       │
      │  agent_proposals kernel       │   │  queues · conversation ·     │
      │  16 conversion kinds          │◀──│  context rail · composer     │
      │  approve → typed executor     │   │  realtime ID-only invalidate │
      └───────────────┬───────────────┘   └──────────────────────────────┘
                      ▼
      ┌──────────────────────────────────────────────────────────────────┐
      │  CRM of record — leads · pilgrims · quotes · bookings ·          │
      │  payments · documents · visa · departure groups · tasks · audit  │
      └──────────────────────────────────────────────────────────────────┘
```

Five new boundaries, each independently testable:

1. **The gate (S0)** — a pure function that decides whether a message
   deserves any model call at all. This is the single biggest cost lever
   in the system (§8.2).
2. **The intelligence pipeline** — staged, each stage writing its own
   evidence, each stage skippable, each stage's output cached against a
   fingerprint.
3. **The signal store** — typed, evidence-linked facts about a
   conversation. Queues, alerts and the owner panel are all *derived*
   from it, so there is never a second definition of "booking-ready".
4. **The action layer** — the existing proposal kernel, extended with
   conversation-conversion kinds. Nothing the Copilot suggests bypasses
   it.
5. **The lane scheduler** — priority + per-tenant fairness, so a
   1 000-message burst in one agency cannot delay another agency's staff
   member by even a second (§7).

---

## 5. Data model

All new tables: `agency_id uuid not null default public.current_agency_id()`,
RLS enabled in the same migration, `(id, agency_id)` unique index for
composite FKs, `set_updated_at` trigger, indexes for every access path.
This is the standing rule from
[`docs/security/security-guidelines.md`](../security/security-guidelines.md),
not a per-table decision.

### 5.1 `conversation_intelligence` — one row per conversation

The projection the whole UI reads. Deliberately one row, upserted, not an
append-only log: the Inbox needs "what is true now" in one index hit.

| Column | Type | Notes |
|---|---|---|
| `conversation_id` | uuid PK | composite FK to `conversations (id, agency_id)` |
| `intent_code` | text | `PACKAGE_ENQUIRY`, `PRICE_REQUEST`, `BOOKING_REQUEST`, `PAYMENT_CLAIM`, `DOCUMENT_ISSUE`, `VISA_QUERY`, `ITINERARY_QUERY`, `COMPLAINT`, `CANCELLATION`, `GROUP_ENQUIRY`, `FAQ`, `SPAM`, `OTHER` — a closed enum, checked |
| `intent_confidence` | numeric(3,2) | shown to staff, never hidden |
| `travel_intent` | jsonb | the `TravelIntent` shape already defined in `lib/copilot/sales/types.ts` — reused verbatim, not re-modelled |
| `urgency` | text | `LOW/NORMAL/HIGH/CRITICAL` |
| `commercial_stage` | text | `UNQUALIFIED/QUALIFYING/READY_TO_RECOMMEND/QUOTE_SENT/BOOKING_READY/BOOKED/LOST` |
| `sentiment` | text | `POSITIVE/NEUTRAL/CONCERNED/ANGRY/DISTRESSED` |
| `estimated_value_cents` | bigint | from the matched offer, never from the model |
| `estimated_value_currency` | text | |
| `risk_level` | text | `NONE/REVIEW/BLOCK` — `BLOCK` means no Copilot draft is offered at all |
| `next_action_code` | text | closed enum mapping 1:1 to an action button |
| `language_code` | text | G15 |
| `summary` | text | the "catch me up" paragraph |
| `open_questions` | jsonb | the unanswered questions array |
| `matched_offer` | jsonb | the `OfferMatch` snapshot — group id, seats, price snapshot, inclusions, as-of timestamp |
| `source` | text | `RULES` or `LLM`, per `AiResult<T>` — staff always see which |
| `pipeline_version` | int | a bump invalidates every row without a migration |
| `input_fingerprint` | text | sha256 of (last message id + lead version + package/group version) — the idempotency and cache key (§8.3) |
| `computed_at` / `stale_at` | timestamptz | |
| `ai_run_id` | uuid | joins to `ai_runs` for cost and drill-down |

### 5.2 `conversation_signals` — append-only typed observations

One row per detected fact, each pointing at the message that caused it.
This is what makes every number in the owner panel drillable, which the
PDF requires explicitly ("no black-box AI score should exist without a
drill-down explanation").

`(agency_id, conversation_id, signal_code, message_id, detector, confidence,
evidence jsonb, superseded_at, created_at)`

`signal_code` examples: `INSTALMENT_INTEREST`, `GROUP_BOOKING_12_PLUS`,
`PRE_RAMADAN_DEADLINE`, `SEAT_RESERVATION_INTENT`,
`PAYMENT_CLAIM_UNVERIFIED`, `BANK_DETAIL_MISMATCH`, `STALE_PRICE_QUOTED`,
`GROUP_FULL_REQUESTED`, `PASSPORT_EXPIRY_RISK`, `REFUND_REQUEST`,
`DISTRESS_LANGUAGE`, `MINOR_OR_ASSISTANCE_NEEDED`, `SENSITIVE_DOC_RECEIVED`,
`WINDOW_CLOSING_SOON`, `CONCURRENT_COMPOSER`, `LOW_CONFIDENCE_DRAFT`.

`detector` is `RULE` or `MODEL` — half of these signals never need a
model, and separating them keeps the cheap half cheap.

### 5.3 `conversation_interventions` — the compact "human review required" card

A signal is an observation; an intervention is a **demand**. Separating
them prevents the failure mode where a high-value alert is buried in
fifty tags.

`(id, agency_id, conversation_id, kind, severity, headline, guidance,
required_action_code, assigned_role, assigned_to_id, status
(OPEN/ACKNOWLEDGED/RESOLVED/DISMISSED), resolved_by, resolution_note,
source_signal_ids uuid[], created_at, resolved_at)`

Invariant enforced in SQL, not in the UI: while an
intervention of kind `PAYMENT_CLAIM` is `OPEN`, no Copilot surface may
produce a draft containing a payment confirmation. The claim verifier
(`lib/ai/trust/claim-verifier.ts`) gets a second gate keyed on open
interventions.

### 5.4 `conversation_queue_membership` — derived, indexed queue rows

Fixing G2 and G12 together. Computing queues in application memory over a
5 000-row scan (`VIEW_SCAN_LIMIT`) will not hold at multi-tenant scale,
and the PDF's queues are semantic, not column-equality.

`(agency_id, conversation_id, queue_code, entered_at, priority_rank)` with
PK `(agency_id, queue_code, priority_rank desc, conversation_id)`.

Maintained by a single trigger-invoked `security definer` function
`public.refresh_conversation_queues(conversation_id)` that is the **one**
definition of every queue predicate, called on write to `conversations`,
`conversation_intelligence`, `conversation_interventions` and
`conversation_messages`. Queue counts become one indexed `count(*)` per
queue instead of a table scan plus in-memory filter.

Queue codes match the PDF's left rail exactly: `ALL`, `MINE`,
`UNASSIGNED`, `NEEDS_REPLY`, `WAITING_CUSTOMER`, `WAITING_TEAM`,
`RESOLVED`, `NEW_ENQUIRIES`, `QUALIFIED`, `BOOKING_READY`, `QUOTE_SENT`,
`PAYMENT_DISCUSSIONS`, `DOCUMENTS`, `VISA_ISSUES`, `DEPARTURE_CHANGES`,
`GROUP_CHANGES`, `COMPLAINTS`, `ESCALATIONS`, plus the three channel
codes.

### 5.5 `contact_identity_links` — the cross-channel graph (G5)

`contact_identities` stays exactly as it is (one row per provider
identity). The graph is a separate edge table so a wrong merge is
reversible without touching identity rows:

`(id, agency_id, left_identity_id, right_identity_id, link_type
(SAME_PERSON/SAME_HOUSEHOLD/FAMILY_MEMBER), evidence jsonb, confidence,
status (PROPOSED/CONFIRMED/REJECTED), proposed_by (SYSTEM/STAFF),
confirmed_by, created_at, confirmed_at)`

**Merges are never silent.** A proposed link surfaces as the PDF's
"Possible existing lead found" card with `[Link conversation]` /
`[Create separate lead]`. The reason is not politeness — linking two
identities exposes one person's conversation history to whoever opens the
other, so a wrong merge is a data-protection incident. Only
`EXACT_IDENTITY` on a normalized phone/email may auto-confirm; everything
else waits for a human.

### 5.6 `conversation_answer_cache` — the FAQ deflection cache (§8.4)

`(id, agency_id, question_fingerprint, question_embedding vector(1024),
answer_text, knowledge_version, source_chunk_ids uuid[], hit_count,
approved_by, created_at, last_used_at, expires_at)`

Agency-scoped, never cross-tenant. Invalidated by `knowledge_version`
(bumped on any knowledge document or package/price change), so a cached
answer can never outlive the fact it was built from.

### 5.7 `channel_jobs` — lanes and fairness (G12)

The existing `agent_jobs` table keeps serving WhatsApp agent turns
unchanged. New work goes to a new table so the lane scheduler can be
introduced without re-testing the live reply path:

`(id, agency_id, lane (REALTIME/STANDARD/BULK), kind, coalesce_key,
payload jsonb, priority int, run_after, attempts, max_attempts,
locked_at, locked_by, status, last_error, created_at)`

with:

- `unique (agency_id, coalesce_key) where status = 'QUEUED'` — the
  burst-coalescing guarantee (§7.3);
- a claim RPC that round-robins across agencies inside a lane (§7.2);
- `agency_id`-scoped in-flight counting for the concurrency cap.

### 5.8 Additions to existing tables

| Table | Addition | Why |
|---|---|---|
| `conversations` | `composing_by uuid`, `composing_at timestamptz` | collision protection (PDF §10 "lock conversation when another user is composing") |
| `conversations` | `human_agent_window_expires_at timestamptz` | G14 — Meta's 7-day human-agent path, distinct from the 24 h standard window |
| `conversations` | `intelligence_state text` (`PENDING/FRESH/STALE/SKIPPED/FAILED`) | lets the UI say "Copilot is reading this" honestly instead of rendering an empty panel |
| `conversation_messages` | `redaction_state text`, `sensitive_kinds text[]` | a message carrying a passport or bank detail is marked at ingest, before any model sees it |
| `agencies` | nothing | plan data goes in its own table (§14.2), so tenancy and billing stay separable |

### 5.9 Handoff artifact

`conversation_handoffs` — `(id, agency_id, conversation_id, booking_id,
from_team, to_team, summary jsonb, open_items jsonb, customer_expectations
jsonb, sentiment, created_by, acknowledged_by, acknowledged_at)`. The
`summary` jsonb is generated from deterministic CRM state and only
*narrated* by the model; `open_items` is computed from
`departure_group_readiness_items`, missing documents and payment state, so
"2 passport scans missing" is a fact, not a recollection.

---

## 6. The conversation intelligence pipeline

Six stages. Every stage is a pure function over a **context pack** plus,
where needed, one model call through `generateStructured()`. Every stage
can be skipped, and skipping is the normal case.

### S0 — Gate (no model, always runs)

Decides whether this inbound message deserves enrichment at all. Pure,
unit-tested, and the single biggest lever on cost.

Skip enrichment when any holds:
- the message is a pure acknowledgement (`ok`, `thanks`, an emoji, a
  sticker) under a token threshold and nothing is pending;
- `conversations.handling_mode = 'HUMAN_ACTIVE'` and a staff member has
  been active in the last 2 minutes — the human already has the context;
- the previous intelligence row's `input_fingerprint` is unchanged;
- the agency's inbox AI surface is `OFF`, or its entitlement is
  exhausted (§8.6);
- the conversation is `SPAM` or `CLOSED`.

Escalate straight to S4 (risk) and nothing else when a rule-level red flag
fires (`REFUND_REQUEST`, `DISTRESS_LANGUAGE`, `BANK_DETAIL_MISMATCH`) —
risk is never gated on cost.

Target: **55–70 % of inbound messages exit at S0.** That is the number to
instrument first and defend forever.

### S1 — Triage (`classify` tier)

One cheap call returning intent code, urgency, sentiment, language, and a
spam flag. Input is the last 6 messages plus a 400-token conversation
digest — never the full thread. Output is a closed enum, validated by Zod
before it is trusted; an out-of-enum answer falls back to `RULES` and the
lexicon detector.

### S2 — Structured travel intent (`classify` tier, conditional)

Runs only when S1's intent is commercial (`PACKAGE_ENQUIRY`,
`PRICE_REQUEST`, `BOOKING_REQUEST`, `GROUP_ENQUIRY`). Calls the **existing**
`TravelIntentExtractionService` contract — the rule implementation first
(`lib/copilot/sales/intent-extraction.ts`), and the LLM implementation only
when the rule pass leaves a required field unresolved. Both return
`TravelIntent` with per-fact evidence snippets, which is what lets the
context rail show *why* it thinks "4 adults, quad, December".

### S3 — Live offer match (**no model at all**)

Loads candidates through `loadCopilotKnowledgeContext()` and ranks them
with `matchOffers()` — both already written, both pure, both already
enforcing the hard gates (sellable status, live group status, published
package, journey type, seats for the whole party, requested room type
priced). This is where the PDF's "best viable offer engine" comes from,
and it costs nothing per call beyond SQL.

The price written into `matched_offer` is a **snapshot with an `as_of`
and the source row's `priced_at`**. Staleness is decided by comparison,
not by age: before any draft or send, `priced_at` and the live seat count
are re-read and compared against the snapshot, and a difference blocks the
send rather than a clock running out. The full rule, and the one remaining
time-based knob, are in §16 R1.

### S4 — Risk and escalation (rules first, model only on ambiguity)

Fifteen detectors. Eleven are pure rules over deterministic state and
never call a model:

| Detector | Deterministic input |
|---|---|
| `PAYMENT_CLAIM_UNVERIFIED` | claim phrase match × `payments` / `payment_allocations` for the linked booking |
| `BANK_DETAIL_MISMATCH` | account digits in the message × the approved account list in `agency_settings` |
| `STALE_PRICE_QUOTED` | figure in the outbound draft × a re-read of `departure_group_pricing.priced_at` (§16 R1) |
| `GROUP_FULL_REQUESTED` | requested group × live seat count |
| `PASSPORT_EXPIRY_RISK` | `pilgrims.passport_expiry` × departure date × the agency's validity threshold |
| `WINDOW_CLOSING_SOON` | `serviceWindowExpiresAt` − now < 2 h |
| `CONCURRENT_COMPOSER` | `conversations.composing_by` |
| `LOW_CONFIDENCE_DRAFT` | `intent_confidence` < threshold |
| `SENSITIVE_DOC_RECEIVED` | attachment classifier |
| `MINOR_OR_ASSISTANCE_NEEDED` | traveller DOB / assistance add-on |
| `UNRECORDED_BOOKING_CLAIM` | claimed booking reference × `departure_group_bookings` |

Four need language understanding and get one `classify` call, batched into
a single request: complaint vs frustration, fraud concern, medical
urgency, and religious-ruling requests.

Every detector that fires writes a signal; a detector with `severity >=
REVIEW` also opens an intervention with a required action and a routed
role.

### S5 — Next action + draft (`draft` tier, on demand only)

The reply draft is **not** generated eagerly. It is generated when a staff
member opens the conversation or presses *Draft reply*, because a draft
generated for a conversation nobody opens is pure waste — and at
multi-tenant volume it is the difference between a $10 and a $60 monthly
AI bill per agency.

The draft call is the existing `suggestConversationReply()`
(`lib/ai/surfaces/inbox/workflows.ts`) with its pack widened from lead
columns to the full fact pack: matched offer, seats, priced room type,
approved inclusions, policy thresholds, open interventions, channel state,
approved template list. `verifyClaims()` already withholds any draft
stating a figure absent from the pack; that behaviour is kept and extended
to cover the never-promise list (§10.3).

### Pipeline version and replay

`pipeline_version` on every row means a detector fix invalidates the
projection without a migration: bump the constant, and rows become stale
and re-enrich lazily on next view. Combined with `input_fingerprint`, the
pipeline is fully replayable over a date range for evaluation — which is
how S1/S4 accuracy gets measured against a labelled fixture set rather
than by vibes.

---

## 7. Concurrency, fairness and latency

The hard requirement: **many tenants, many simultaneous inbound bursts,
and no staff member ever waiting on AI.** Four mechanisms, each addressing
a different failure mode.

### 7.1 Never put a model on the critical path

The webhook edge already only verifies, persists and acknowledges
(`lib/whatsapp/webhook-handler.ts`). That stays. Three additional rules:

- A **page render never awaits a model call.** The three panes read
  `conversation_intelligence`; when the row is `PENDING`, the rail renders
  the deterministic half (lead facts, live offer match — both pure SQL)
  and a quiet "Copilot is reading this conversation" line. The enriched
  row arrives over the existing ID-only realtime broadcast.
- A **staff send never awaits a model call.** Draft generation is a
  separate Server Action; the composer is usable the instant the pane
  paints.
- A **customer-facing auto-reply is bounded by a timeout, not by hope.**
  `lib/agent/whatsapp/model-routing.ts` already has the pattern
  (`FREE_ATTEMPT_TIMEOUT_MS`, retry on the paid model); the same applies
  to any L2/L3 automated send, with a deterministic acknowledgement as the
  fallback.

### 7.2 Lane scheduling with per-tenant fair share

Three lanes, each with its own worker budget and its own claim RPC:

| Lane | Work | Target latency | Concurrency |
|---|---|---|---|
| `REALTIME` | S1 triage of a brand-new inbound, on-demand draft, identity match for an unknown sender | p95 < 3 s | high, per-tenant capped |
| `STANDARD` | S2–S5 enrichment, signal recompute, queue refresh, handoff summary | p95 < 30 s | medium |
| `BULK` | transcription, document OCR, receipt extraction, embedding, backfills, nightly replay | minutes | low, strictly capped |

Fair share inside a lane is the part that matters for multi-tenancy. The
claim RPC does not take the oldest N rows — it takes at most *k* rows per
agency, cycling agencies by their last-served timestamp:

```sql
-- claim_channel_jobs(p_lane, p_worker_id, p_limit, p_per_agency_cap)
with ranked as (
  select j.id,
         row_number() over (partition by j.agency_id
                            order by j.priority desc, j.run_after, j.id) as rn
  from public.channel_jobs j
  where j.lane = p_lane
    and j.status = 'QUEUED'
    and j.run_after <= now()
    and (select count(*) from public.channel_jobs f
         where f.agency_id = j.agency_id and f.status = 'RUNNING') < p_per_agency_cap
)
select ... from ranked where rn <= p_per_agency_cap
order by rn, ... limit p_limit
for update skip locked;
```

One agency dumping 2 000 messages gets `p_per_agency_cap` slots and no
more. Every other agency's REALTIME work is served in the same tick. This
is the single change that makes the difference between "works in a demo"
and "works with 200 agencies".

### 7.3 Burst coalescing

A customer sending five messages in eight seconds must produce **one**
enrichment run, not five. Two layers:

- `unique (agency_id, coalesce_key) where status = 'QUEUED'` on
  `channel_jobs`, with `coalesce_key = 'enrich:' || conversation_id` —
  enqueueing a second job while one is queued is a no-op upsert that only
  bumps `run_after`.
- A short **settle delay** (default 4 s, per-agency configurable) on
  enrichment jobs, so the pipeline reads the whole burst as one turn. The
  delay does not apply to REALTIME triage of a first-contact message,
  which is what the customer is waiting on.

### 7.4 Worker topology

Keep the current shape — it is correct and cheap — and extend it:

- **Opportunistic:** `after()` from the webhook drains the REALTIME lane
  with a 10 s budget (down from 25 s; a REALTIME tick must be short).
- **Scheduled:** the existing 1-minute cron
  (`app/api/cron/agent-jobs/route.ts`) drains all three lanes with
  per-lane budgets inside the 50 s function budget.
- **Overflow:** when `channel_jobs` REALTIME depth exceeds a threshold, the
  cron route fans out to N parallel invocations of itself with distinct
  `worker_shard` values instead of one worker looping longer. `SKIP
  LOCKED` already makes this safe.
- **Region:** `vercel.json` pins `sin1`, which is right for Sri Lanka —
  keep Supabase in the same region and keep model calls the only
  cross-region hop.

Deliberate non-decision: **do not adopt `pgmq` yet.** The existing
`FOR UPDATE SKIP LOCKED` pattern plus `run_after` gives durable retry,
dead-lettering and the per-agency fairness window function above, which
`pgmq`'s read/visibility-timeout model would make *harder* to express, not
easier. Revisit only if queue depth per tick regularly exceeds what a
one-minute cron can drain, and record that revisit as its own decision.

### 7.5 The read path

- Three independent Server Actions already split the Inbox load
  (`loadInboxListData` / `loadInboxConversationData` / `loadInboxLeadContext`
  in `lib/data/inbox-repository.ts`). Keep that split; add a fourth for
  intelligence so a slow projection read cannot delay the transcript.
- Replace the `VIEW_SCAN_LIMIT = 5000` in-memory count with indexed
  `count(*)` per queue over `conversation_queue_membership` (§5.4). This
  removes the only page-load cost that grows linearly with tenant size.
- Keep realtime payloads ID-only. The RLS policy on `realtime.messages`
  already scopes topics to `inbox:<agency_id>`; no message body, customer
  name or figure ever travels over the broadcast channel.
- The scaling track in [`scaling.md`](./scaling.md) narrows synchronization
  further: the agency topic is list-only, while the selected thread listens
  on `inbox:<agency_id>:conversation:<conversation_id>`. Events are typed,
  versioned identifiers; list rows and thread messages are read as scoped
  patches/deltas, with one bounded Postgres reconciliation after reconnect.
- Cursor-paginate the conversation list on
  `(last_activity_at desc, id desc)` — the index
  `conversations_inbox_list_idx` already exists for exactly this.

---

## 8. Cost engineering

Two agencies with identical message volume should not differ 10× in AI
bill because one of them types more politely. Cost control is
architectural, not a prompt-length habit.

### 8.1 The cost ladder

| Rung | Mechanism | Cost per event |
|---|---|---|
| 0 | S0 gate — no call | $0 |
| 1 | Rule detectors, offer matching, queue refresh | $0 (SQL/CPU) |
| 2 | Answer cache hit (§8.4) | ~$0 (one embedding, often cached too) |
| 3 | `classify` tier — triage, intent, batched risk | ~$0.0003 |
| 4 | `draft` tier — customer-facing prose | ~$0.002 |
| 5 | `reason` tier — money/eligibility explanation | ~$0.004 |
| 6 | Tool-calling agent turn (L3 autonomous intake) | ~$0.006–0.012 |

Rungs 3–6 use the tier→model map already in `lib/ai/provider.ts`
(`classify`/`agent` → `openai/gpt-5.6-luna` at $0.10/$0.60 per M tokens;
`draft`/`reason` → `google/gemini-3.8-flash` at $0.375/$1.875 per M), whose
selection rationale is recorded in
[`ai-model-selection.md`](../architecture/ai-model-selection.md). Figures above assume
1.5–3 k input and 300–500 output tokens per call with the system block
cached.

### 8.2 Make rung 0 the common case

The S0 gate, plus these:

- **Digest, never transcript.** A rolling 400-token conversation digest is
  maintained incrementally and is what S1–S5 read. Re-sending 40 messages
  on every turn is the most common way a design like this becomes
  expensive.
- **Prompt split, already in place.** `generateStructured()` passes the
  system block with `cache_control: ephemeral` and the volatile pack as
  the user message. Agency SOPs, brand voice and policy thresholds belong
  in the cached block; the conversation belongs in the volatile one.
- **Effort per call site.** `effort: "low"` for classify, `"medium"` for
  draft — the provider seam already does this by tier; no surface should
  override upward without a recorded reason.
- **Free-model-first with timeout fallback** for conversational turns,
  already implemented in `lib/agent/whatsapp/model-routing.ts`. Extend it
  to S1 triage, which is the highest-volume call in the system.

### 8.3 Fingerprint idempotency

`input_fingerprint = sha256(last_message_id ‖ lead.updated_at ‖
group_version ‖ pricing_version ‖ pipeline_version)`. Identical
fingerprint ⇒ reuse the row, make no call. This alone removes the entire
class of duplicate spend caused by webhook redelivery, double-clicks,
re-renders and retry storms. `lib/agent/kernel/hash.ts` already exists for
the hashing; `ai_runs.pack_fingerprint` already exists to record it.

### 8.4 Agency answer cache

The traffic pattern in this business is dominated by a few dozen repeated
questions ("what's included", "how much for a family of four in
December", "do I need a vaccination certificate"). Those should be
answered from `conversation_answer_cache` (§5.6):

1. embed the normalized question (bge-m3, already wired);
2. nearest-neighbour search **within the agency** above a similarity
   threshold, with matching `knowledge_version`;
3. on hit, return the stored approved answer with its source chunks, at
   rung 2 cost;
4. on miss, run the knowledge RAG path and — only if a human approves the
   answer — write it back to the cache.

Cache entries are approved, not auto-promoted: an unapproved answer in a
cache is a wrong answer repeated at scale. What may be cached at all, who
approves it, and how an entry expires or retires are settled in §16 R4 —
where prices and availability are explicitly never cacheable. Expected steady-state hit rate
after a month of real traffic: 30–45 % of FAQ-class questions, which are
themselves 40–60 % of inbound volume.

### 8.5 Complete the cost ledger (G11)

`estimateCostUsd()` in `lib/ai/telemetry.ts` returns `null` today and says
so in its own comment. Finish it:

- read the dated rate from `ai_model_rates` (`effective_from <= now()`,
  newest first), cached per process for 5 minutes;
- price input, output, cache-read and cache-write tokens separately —
  cache-read at $0.01/M vs input at $0.10/M is a 10× difference that must
  show up in the ledger or prompt caching looks worthless;
- write `cost_usd` on every `ai_runs` row;
- roll up nightly into `ai_usage_daily (agency_id, surface, day, runs,
  input_tokens, output_tokens, cost_usd, conversations_enriched)`.

### 8.6 Quotas and graceful degradation

`lib/ai/budget.ts` enforces on/off only. Extend it to a ladder that
degrades capability, never silence:

| Utilisation | Behaviour |
|---|---|
| < 80 % | full pipeline |
| 80 % | owner alert; S5 drafts move to on-demand only (no pre-generation anywhere) |
| 100 % of plan allowance | overage meter starts, or — if the agency opted out of overage — S2/S5 disable; S0/S1/S4 rules and offer matching continue |
| 120 % | all model calls stop; the Inbox runs fully deterministic |

Two invariants, both borrowed from the existing
`whatsapp_billing_budgets.block_marketing_at_100` posture ("a budget guard
must never silence a customer conversation"):

1. **A human staff reply is never blocked by an AI budget.**
2. **Risk detection (S4 rules) never stops.** Detecting an unverified
   payment claim costs nothing and is the feature most likely to pay for
   the subscription by itself.

---

## 9. Multi-tenancy non-negotiables

The PDF states these; this section makes them checkable.

| Boundary | Rule | Enforcement |
|---|---|---|
| Webhook → tenant | The tenant is resolved from the channel account id on the connection, never from the payload body | `lib/whatsapp/webhook-handler.ts`, `lib/channels/page-channel-adapter.ts` |
| Every model call | Carries `agency_id` in telemetry; the model never receives it and can never choose one | `generateStructured()` takes `agencyId` as a parameter, not from the prompt |
| Every retrieval | Knowledge, answer cache, offers, templates, SOPs filtered by `agency_id` before ranking, not after | repository layer; an eval fixture with two agencies asserts zero cross-tenant leakage |
| Every attachment | Tenant-private storage path, signed URL, access check before preview | `lib/channels/attachment-download.ts`, existing storage policies |
| Every automated send | Uses the agency's own token from Vault, and checks that agency's policy, budget, window and autonomy level | `lib/inbox/outbox/drain.ts` + the L0–L3 gate |
| Every usage record | `(agency_id, channel, surface, feature, model, cost, audit ref)` | `ai_runs`, `ai_usage_daily`, `whatsapp_message_charges` |
| Every queue tick | Per-agency in-flight cap and fair-share claim | `claim_channel_jobs` (§7.2) |
| Prompt injection | Customer text is data. The fence (`lib/ai/trust/fence.ts`) wraps inbound content; instructions inside a customer message never change tool behaviour | fence + tool capability allow-list |

One agency's noisy week must be visible to that agency and invisible to
every other. Fair-share claiming, per-agency budgets and per-agency
concurrency caps are all the same requirement viewed from three angles.

---

## 10. Autonomy and safety

### 10.1 The ladder

Per agency, per surface, stored in the existing `ai_surface_settings`
(`OFF/SHADOW/PROPOSE/ACTIVE` + `autonomy jsonb`). The PDF's four levels
map onto it:

| Level | `ai_surface_settings` | The Copilot may | External sends |
|---|---|---|---|
| L0 Observe | `SHADOW` | read, classify, tag, open interventions | none |
| L1 Assist | `PROPOSE` | draft replies/quotes, propose leads, prepare handoffs | every message human-approved |
| L2 Safe automate | `ACTIVE` + `autonomy.safe_replies` | greet, acknowledge, ask approved qualifying questions, send office-hours reply, send an approved brochure or checklist, answer an approved-cached FAQ, create a lead/task, assign a queue, notify a human | only from the approved-template / approved-answer set |
| L3 Bounded autonomous | `ACTIVE` + `autonomy.intake_flow` | run a structured intake conversation, collect dates/party/room/city, identify matching active options, schedule an appointment, send transactional updates from CRM data, and **hand over before price negotiation or booking confirmation** | within a declared flow, with mandatory handover triggers |

Default for a new agency: **L1**, with L0 for the first week of shadow
review — the posture the intelligence roadmap already established
("SHADOW by default"). L2 is never on by default on any plan; promotion to
it is gated on measured evidence rather than elapsed time, and starts
deliberately narrow (§16 R5).

### 10.2 Demotion is automatic

`ai_surface_settings.rejection_demote_threshold` (default 0.40) already
exists. Wire the Inbox surfaces to it: when staff reject or heavily edit
more than the threshold share of proposals over a rolling window, the
surface drops one level and tells the owner why. An autonomy level that
can only be raised by hand and never lowered by evidence is not a safety
control. Demotion runs the same thresholds as promotion (§16 R5) in
reverse, so there is exactly one definition of "good enough to act".

### 10.3 Never autonomous — in code, not configuration

This list lives in a TypeScript constant with a unit test asserting each
entry is unreachable at any autonomy level, because a deny list that an
admin toggle can clear is not a deny list:

confirm a payment · promise visa approval · grant a discount · confirm
unavailable inventory · make a financially material booking change · send
bank details from any source other than the locked approved account list ·
commit to a refund or cancellation · issue a religious ruling · give
health or safety advice · close a complaint · send a marketing broadcast
without explicit admin approval.

Enforced in three places, so no single bug opens it: the prompt (weakest),
`verifyClaims()` + a never-promise phrase matcher (middle), and the
outbound send gate that refuses the send outright (strongest).

### 10.4 Channel policy intelligence (PDF §6, G14)

The composer must know what is legally and technically sendable **before**
the button is live. `lib/inbox/composer-state.ts` already encodes the Meta
customer-first and 24-hour rules. Extend it to a full state, surfaced in
the UI as facts rather than a disabled button:

| Channel | State | Allowed action |
|---|---|---|
| WhatsApp | service window open | free-form reply |
| WhatsApp | service window closed | approved template only, categorised Marketing / Utility / Authentication, with the charge shown before sending |
| Messenger / Instagram | within 24 h | free-form reply |
| Messenger / Instagram | 24 h–7 days, active human support case | **human-written reply under the `HUMAN_AGENT` tag** — never automation, never promotion |
| Messenger / Instagram | beyond 7 days | no send; recommend re-engagement or continuing on WhatsApp where consent exists |

The `HUMAN_AGENT` path is gated on `handling_mode = 'HUMAN_ACTIVE'` and an
open support case, and is hard-blocked for every automated surface at
every autonomy level — Meta's policy restricts it to genuine human
replies, and its systems detect misuse. The 7-day expiry gets its own
column (§5.8) because it is a different clock from the 24-hour window and
must be shown as such.

Sources for these windows are cited in the source PDF and re-verified at
implementation time against
`developers.facebook.com/documentation/business-messaging/messenger-platform/policy`;
the rule table above is the contract the code is written against, and it
belongs in a runbook that is re-checked each quarter, because Meta changes
it (three message tags started erroring on 27 April 2026).

---

## 11. The workspace

### 11.1 Layout

Three panes plus a contextual rail, matching the PDF exactly:

```text
┌──────────────┬───────────────────────────┬──────────────────────────────┐
│ QUEUES       │ CONVERSATION              │ CUSTOMER / CONTEXT           │
│ (§5.4 codes) │ transcript · notes ·      │ identity · intent (with      │
│ counts from  │ attachments · voice ·     │ evidence) · matched offer ·  │
│ indexed      │ composer with window      │ open items · history ·       │
│ count(*)     │ state + template picker   │ confidence · actions         │
└──────────────┴───────────────────────────┴──────────────────────────────┘
```

Built only from shadcn components through MCP, with the mandated
`InputGroup` composition for every input, per
[`docs/standards/ui-standards.md`](../standards/ui-standards.md). No new
colours; the type scale and table conventions come from
[`design-tokens.md`](../architecture/design-tokens.md).

### 11.2 How the Copilot appears

The interaction rule from the PDF is a hard UI constraint, not a
preference:

- **No fourth full-height AI panel and no chat box.** The customer-context
  rail is primary; Copilot appears inside it as compact evidence plus one
  or two actions.
- **A draft appears inside the composer**, editable, not in a separate
  card the staff member has to copy from.
- **Copilot speaks only when it has something actionable**: a ready draft,
  a duplicate-contact match, a best-matching departure group, a required
  human review. Otherwise it is silent.
- **Restrained visual hierarchy**: a thin left border + small amber status
  for high urgency, a small red marker for required review, a green marker
  for a new qualified lead, a soft neutral tag for routine FAQ. Never ten
  badges on one row.
- **Every AI-derived value shows its source** (`RULES` vs `LLM`) and its
  confidence, and every extracted fact links back to the message it came
  from.

### 11.3 Conversation → workflow (G7)

One menu presents sixteen honest workflow actions. Twelve create through the
existing proposal kernel (`lib/agent/kernel/proposals/registry.ts`): pilgrim,
family/mahram relationship, package recommendation, seat hold, payment
follow-up, document request, visa task, rooming request, transport
requirement, guide escalation, complaint case, and post-trip feedback task.
Lead, quote and booking creation remain their existing guarded actions, with
the same source-link and idempotency contract. Departure-group assignment is
an update/selection — it creates no object and says so in the UI.

| Action | Contract |
|---|---|
| Lead, quote, booking | Existing guarded create action; source-linked to the conversation and latest customer message. |
| Pilgrim, relationship, package recommendation, seat hold | Typed proposal creates the named profile, relationship, lead note, or held booking. |
| Payment, document, visa, rooming, transport, guide, feedback | Typed proposal creates an assigned task with its normal 24-hour due date and a staff notification. |
| Complaint case | Typed proposal creates a Support case, its opening event, high-priority 24-hour SLA, and Operations notification. |
| Departure-group assignment | Selection/update only; no workflow record is claimed. |
| Create separate lead | Identity decision closes the candidate links, then uses the guarded lead-create path and stamps both source columns. |

Every created object stores `source_conversation_id` and
`source_message_id`. The PDF's rule — the inbox is never a dead end — is
enforced by that pair of columns being non-null on anything created here.

### 11.4 Owner intelligence (G10)

One panel, eleven numbers, every one a link to its queue: new enquiries ·
qualified opportunities · booking-ready · high-value family/group
enquiries · awaiting staff reply · nearing channel deadline · payment
claims needing verification · document/visa escalations · AI-safe
resolutions · human interventions required · pipeline influenced (computed
from `matched_offer` values, reported per currency and labelled an
estimate — never converted or summed across currencies, per §16 R6).

Each number is a `count(*)` over `conversation_queue_membership` or
`conversation_interventions`. No number on this panel may come from a
model, which is what makes every one of them drillable.

---

## 12. Observability and evaluation

| Concern | Mechanism |
|---|---|
| Per-run cost, latency, tokens, status | `ai_runs` (exists) + completed `cost_usd` |
| Tool calls and their arguments | `ai_tool_calls` (exists), redacted via `FORBIDDEN_KEYS` |
| Gate effectiveness | `s0_skip_rate` by reason, per agency, daily — the primary cost KPI |
| Cache effectiveness | answer-cache hit rate, prompt-cache read ratio |
| Queue health | depth, age, p50/p95/p99 per lane; per-agency in-flight; fair-share starvation alert |
| Classifier quality | a labelled fixture set per intent and per risk detector, run as a Vitest eval in the pattern of `lib/agent/departure-ops/__evals__/*`; precision on `PAYMENT_CLAIM_UNVERIFIED` and `BANK_DETAIL_MISMATCH` is the gate that must not regress |
| Draft quality | staff edit distance and rejection rate per surface, feeding `rejection_demote_threshold` |
| Cross-tenant isolation | a two-agency fixture asserting every retrieval path returns zero foreign rows — a required test for every new repository function |
| Policy compliance | a test per channel-window state asserting the send gate refuses what Meta forbids |

Service level objectives to hold the design to:

- inbound message visible in the Inbox: **p95 < 2 s** from webhook
- REALTIME triage complete: **p95 < 5 s**
- full enrichment complete: **p95 < 30 s**
- on-demand draft: **p95 < 6 s**
- queue count render: **p95 < 300 ms** at 100 k conversations per agency
- AI cost per enriched conversation: **≤ $0.012** steady state

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Wrong identity merge exposes one customer's history to another | No silent merge above `EXACT_IDENTITY`; edges are reversible; every link writes an `identity_match_events` row |
| A model states a price that has changed | Prices never come from the model; `STALE_PRICE_QUOTED` blocks a draft built on an old snapshot |
| An automated reply confirms a payment | Three-layer never-promise enforcement (§10.3) plus the open-intervention gate (§5.3) |
| Meta policy change silently breaks sending | Channel state is data, re-verified quarterly via a runbook; the send gate fails closed |
| One tenant's burst starves others | Fair-share claim + per-agency in-flight cap (§7.2) |
| AI spend runs away on a cheap plan | Fingerprint idempotency, coalescing, gate, and the degradation ladder (§8.6) |
| The Inbox becomes slow as tenants grow | Queue membership table replaces the 5 000-row scan; cursor pagination; indexed counts |
| Scope creep turns this into a rewrite | Phased slices behind per-agency flags; the current WhatsApp path keeps working untouched throughout (see the implementation plan) |
| Staff distrust the Copilot after one bad draft | Source + confidence on every value, evidence link on every fact, shadow mode before propose mode, automatic demotion on rejection |

---

## 14. Commercial architecture

### 14.1 What is being sold

Three revenue lines, deliberately separated so a Meta price change never
forces a re-pricing of the product:

1. **Platform subscription** — per agency per month, by plan tier, with a
   seat allowance. This is the margin.
2. **Metered AI conversations** — an allowance per plan, then transparent
   overage. Metered on *AI-assisted conversations* (a conversation with at
   least one enrichment or draft in the billing month), **not** per
   message and **not** per token: it is the unit the agency can predict
   and the unit that tracks our cost.
3. **Messaging pass-through** — Meta's per-message template charges,
   already metered per message in `whatsapp_message_charges`, billed at
   cost plus a small handling margin, with the charge shown in the
   composer *before* the send. Marketing/Utility/Authentication rates are
   country-specific and Meta changes them; never bake a rate into a plan.

Service messages inside the customer-service window are free to Meta
(with a monthly free-service allowance per WABA), which is precisely the
traffic this product generates most of — so the Inbox itself is cheap to
run, and the paid traffic is the re-engagement templates the agency
chooses to send.

### 14.2 Entitlement model

Three new tables, kept out of `agencies` so tenancy and billing stay
separable:

- `plans (code, name, currency, monthly_price, seat_allowance,
  channel_allowance, ai_conversation_allowance, autonomy_ceiling,
  features jsonb, active)` — platform-global reference data, like
  `ai_model_rates`.
- `agency_subscriptions (agency_id pk, plan_code, status, seats_purchased,
  current_period_start, current_period_end, overage_opt_in,
  ai_conversation_allowance_override, trial_ends_at)`.
- `agency_usage_counters (agency_id, period_start, metric, used, limit,
  updated_at)` — the counter `lib/ai/budget.ts` consults, with `metric` in
  `AI_CONVERSATIONS`, `AI_COST_USD`, `SEATS`, `CHANNELS`, `VOICE_MINUTES`,
  `DOC_EXTRACTIONS`.

`autonomy_ceiling` on the plan is what makes the tiering real: an agency
on Starter cannot set an Inbox surface to `ACTIVE` at all, because the
entitlement check runs before `ai_surface_settings` is written.

### 14.2.1 Canonical Inbox rollout contract (FIX9)

Optional Inbox products have one product input and one execution input:
`plans.features` entitles offer matching, identity resolution, SLA, media
intelligence, the owner panel, answer cache, and audit exports;
`ai_surface_settings` independently controls AI model execution, safety mode,
and autonomy. `agency_settings.inbox_queues_v2` is the sole temporary
queue-rail rollout switch until the legacy rail is retired. The typed
`resolveInboxFeatureAvailability()` resolver is used by repository/UI exposure
and server/worker enforcement. Hiding a control is never enforcement.

Human replies and deterministic payment-claim protection are baseline Inbox
behaviour, not paid feature switches. There are no `inbox_autonomy_l2` or
`inbox_autonomy_l3` flags: plan ceilings clamp `ai_surface_settings` directly.

### 14.2.2 Language state and staff translation (FIX10)

`conversation_intelligence.language_code` remains the current conversation
language state. Staff may request a translation of one message or the stored
digest on demand; it is labelled non-authoritative, leaves the original beside
it, is not persisted, and uses the same metered `generateStructured()` seam as
other Inbox AI. Owner language reporting groups that stored field in a
security-invoker KPI view; it never asks a model to manufacture totals.

### 14.3 Unit economics

Per-agency monthly cost at a representative 1 500 inbound conversations,
using the tier rates in §8.1 and a 60 % S0 skip rate:

| Component | Volume | Unit | Monthly |
|---|---|---|---|
| S1 triage (`classify`) | 600 | $0.0003 | $0.18 |
| S2 intent (`classify`, ~40 % of triaged) | 240 | $0.0004 | $0.10 |
| S3 offer match | 240 | $0 (SQL) | $0.00 |
| S4 risk (rules + 1 batched classify) | 600 | $0.0003 | $0.18 |
| S5 drafts (on demand, ~1.5 per opened conversation) | 700 | $0.0020 | $1.40 |
| `reason`-tier escalations | 60 | $0.0040 | $0.24 |
| Voice transcription | 120 min | ~$0.006/min | $0.72 |
| Document/receipt extraction | 150 | ~$0.003 | $0.45 |
| Embeddings (knowledge + cache) | — | — | ~$0.10 |
| **AI subtotal** | | | **≈ $3.40** |
| Infrastructure share (Supabase + Vercel + storage, amortised) | | | ≈ $4–8 |
| **Total cost to serve** | | | **≈ $8–12** |

That is the point of the architecture. A naive implementation — full
transcript on every message, eager drafts, a reasoning model for triage,
no gate, no cache, no fingerprint — runs the same volume at roughly
$45–70 in model spend alone, five to eight times higher for a worse
experience. The gate, the digest, the deterministic offer engine and the
fingerprint are where the margin lives.

Cost scales sub-linearly with conversation count (cache hit rate rises,
digests amortise) and super-linearly with **autonomy level**, since L3
tool-calling turns are rung 6. Price autonomy accordingly.

### 14.4 Pricing plans

Indicative USD list prices; LKR set at the prevailing rate at launch. Per
agency per month, billed annually with two months free.

| | **Starter** | **Growth** | **Professional** | **Enterprise** |
|---|---|---|---|---|
| Price | $49 | $149 | $399 | Custom (from $899) |
| Seats | 3 | 10 | 25 | Unlimited |
| Channels | WhatsApp | WhatsApp + Instagram + Messenger | All + Email | All + own Meta app (Mode A) |
| Unified inbox, notes, assignment, saved replies, templates | ✓ | ✓ | ✓ | ✓ |
| Channel-policy intelligence (windows, templates, `HUMAN_AGENT`) | ✓ | ✓ | ✓ | ✓ |
| AI-assisted conversations / month | 400 | 2 000 | 8 000 | Negotiated |
| Copilot summary + reply draft (L1) | ✓ | ✓ | ✓ | ✓ |
| Cross-channel identity resolution + merge review | — | ✓ | ✓ | ✓ |
| Live offer matching + quote from conversation | — | ✓ | ✓ | ✓ |
| Risk & escalation engine (payment claim, bank mismatch, stale price) | Payment claim only | ✓ | ✓ | ✓ |
| Business-consequence queues + SLA rules | — | ✓ | ✓ | ✓ |
| Safe auto-reply (L2) | — | ✓ | ✓ | ✓ |
| Bounded autonomous intake (L3) | — | — | ✓ | ✓ |
| Voice-note + document/receipt intelligence | — | 200 items | 1 500 items | Negotiated |
| Sales→operations handoff summaries | — | ✓ | ✓ | ✓ |
| Owner inbox-intelligence panel | — | Read-only | ✓ | ✓ + exports |
| Multi-branch / multi-brand | — | — | 2 branches | Unlimited |
| Audit export, SSO, DPA, priority support | — | — | Audit export | All |
| Overage (AI conversations) | $0.03 each | $0.025 each | $0.02 each | Negotiated |
| Extra seat | $12 | $10 | $8 | Included |
| Meta message charges | Pass-through + 10 % | Pass-through + 8 % | Pass-through + 5 % | At cost |

Gross margin at Growth: $149 revenue against ≈ $10–14 cost to serve at the
2 000-conversation allowance ⇒ **~91 %**, before support and sales cost.
Even a Growth agency running at 3× its allowance stays above 70 % because
overage is priced at roughly 8–10× marginal AI cost, which is honest
pricing for a metered feature and still leaves the agency far cheaper than
a per-seat competitor.

Positioning against the general-purpose omnichannel inboxes — which sit
around $59/month for small WhatsApp-only teams, ~$300–550/month for
mid-market AI plans, and $580–700/month for 20-seat plans with capped
annual conversation counts — is not price. It is that none of them can
answer "which December group has three quad seats left at the approved
price". That answer requires owning the Hajj/Umrah operational data model,
which is the moat, and it is why the Copilot must stay grounded in it
rather than becoming a generic chatbot.

### 14.5 Packaging rules

- **Never meter what the agency cannot predict.** No per-token pricing, no
  per-message AI pricing.
- **Never let a budget silence a customer.** Human replies and risk
  detection are unmetered at every tier (§8.6).
- **Show the cost before the send.** A template's charge appears in the
  composer; the monthly AI figure appears in the owner panel; both drill
  down to the ledger.
- **Autonomy is the upsell, not volume.** Volume is cheap; letting the
  agent act is what carries risk and therefore price.
- **Trial:** 14 days at Professional features with a 300-conversation
  allowance, then automatic drop to Starter — never a hard cut-off that
  loses messages.

---

## 15. Decisions taken

| # | Decision | Rationale |
|---|---|---|
| D1 | Deterministic core, LLM at the edges | Bounds correctness, cost and latency simultaneously (§1) |
| D2 | Reuse `TravelIntent`, `matchOffers`, the proposal kernel, `ai_surface_settings` and the fence/verifier rather than building new equivalents | They are written, tested and correct; the gap is wiring, not capability (§3) |
| D3 | A separate `channel_jobs` table with lanes, instead of extending `agent_jobs` | The live WhatsApp reply path must not be re-tested to introduce lane scheduling (§5.7) |
| D4 | Fair-share claiming with a per-agency in-flight cap | The one change that makes multi-tenant bursts safe (§7.2) |
| D5 | Drafts on demand, never eager | Largest single avoidable cost in a naive design (§6 S5) |
| D6 | One row per conversation for intelligence, plus an append-only signal log | The UI needs "now" in one hit; the owner panel needs drill-down (§5.1–5.2) |
| D7 | Queue membership as a derived, indexed table with one SQL definition | Removes the 5 000-row scan and prevents two definitions of "booking-ready" (§5.4) |
| D8 | No `pgmq` yet | The existing `SKIP LOCKED` + `run_after` pattern expresses per-tenant fairness more directly (§7.4) |
| D9 | Never-autonomous list in code with a test, not in configuration | A deny list an admin can clear is not a deny list (§10.3) |
| D10 | Meter AI-assisted conversations, not messages or tokens | The only unit both we and the agency can predict (§14.1) |
| D11 | Autonomy ceiling is a plan entitlement checked before `ai_surface_settings` is written | Makes tiering real rather than cosmetic (§14.2) |
| D12 | `HUMAN_AGENT` (7-day) modelled as its own window, hard-blocked for automation | Recovers a legitimate support path Meta allows, without policy risk (§10.4) |
| D13 | Price staleness by change-detection, not by an age threshold | A re-read is free and strictly more accurate than a clock (§16 R1) |
| D14 | SLA targets graded by revenue/trust consequence, with the channel window outranking every target | Missing a Meta window is unrecoverable; missing an internal target is not (§16 R2) |
| D15 | Assignment owner-sticky first, least-loaded only as a tie-break | Continuity is the value; even distribution is not (§16 R3) |
| D16 | Answer-cache approval defaults to ADMIN/CEO, and prices are never cacheable | One entry's wording gets repeated to thousands of customers (§16 R4) |
| D17 | L2 promotion gated on measured accuracy, not on elapsed shadow time | A time-only gate passes an agency whose Copilot was wrong all week (§16 R5) |
| D18 | Multi-currency figures bucketed, never converted | An invented FX rate reconciles with nothing in Finance (§16 R6) |
| D19 | Retention follows the record, not the plan tier | Selling history creates a compliance hazard and a perverse incentive (§16 R7) |

---


## 16. Resolved product decisions

The seven questions this design originally left open, answered. Each
answer names the knob, its default, and where it is enforced, so none of
them has to be re-litigated during the build.

### R1 — Price staleness is detected by **change**, not by age

**Decision.** Do not use a time threshold as the primary gate. Every
offer snapshot records `departure_group_pricing.priced_at` and the
group's `available_seats`; before any draft, quote or automated send that
mentions a figure, re-read both and compare:

| Comparison | Outcome |
|---|---|
| `priced_at` differs from the snapshot's | Hard block. Raise `STALE_PRICE_QUOTED`, re-run S3 silently, show the new figure with a "price changed since this was matched" line |
| Seats now insufficient for the party | Hard block. Raise `GROUP_FULL_REQUESTED`, offer the next viable option |
| `early_bird_valid_until` falls inside the quote validity window | Warn, not block. The draft must state the expiry date |
| Both unchanged | Proceed, and label the card "as of *time*" |

**Why.** A re-read costs nothing — one indexed SQL query, rung 1 in §8.1.
An age threshold is strictly worse than a comparison: it blocks correct
drafts when nothing changed, and permits wrong ones when a price moved
five minutes ago. `departure_group_pricing` already carries `priced_at`
and `price_source` for exactly this purpose, and the departure-groups
module already treats that row as the live selling price.

**The knob that remains.**
`agency_settings.offer_snapshot_max_age_minutes` (default **60**) controls
*display* freshness only: a card older than this re-matches when the
conversation is opened, so staff never read a stale rail. It never gates a
send — the comparison above does.

**Enforced in.** `lib/inbox/intelligence/offer.ts` (re-read),
`lib/inbox/risk/detectors/stale-price.ts` (signal),
`lib/inbox/risk/protection-gate.ts` (block), and the outbound send gate.

### R2 — SLA targets per queue

**Decision.** First-reply and resolution targets per queue, in the
agency's timezone (`agency_settings.timezone`, default `Asia/Colombo`),
against the working calendar already stored in `ai_settings.working_hours`.
The base first-reply target reuses the existing
`ai_settings.handoff_alert_minutes` (default 15) so an agency that has
already tuned it keeps its setting; per-queue values override it.

| Queue | First reply | Resolution | Clock |
|---|---|---|---|
| `ESCALATIONS`, `COMPLAINTS` | 15 min | 24 h | 24/7 — a distressed customer does not wait for opening hours |
| `BOOKING_READY` | 15 min | 4 h | Business hours |
| `PAYMENT_DISCUSSIONS` | 30 min | 4 h | Business hours |
| `NEW_ENQUIRIES` | 30 min | 8 h | Business hours; an out-of-hours arrival is due 30 min after opening |
| `NEEDS_REPLY` (catch-all) | 60 min | — | Business hours |
| `DEPARTURE_CHANGES`, `GROUP_CHANGES` | 2 h | 24 h | Business hours |
| `QUALIFIED`, `QUOTE_SENT` | 2 h | 48 h | Business hours |
| `DOCUMENTS`, `VISA_ISSUES` | 4 h | 3 business days | Business hours |
| `WAITING_CUSTOMER`, `WAITING_TEAM`, `RESOLVED` | — | — | Clock paused |

Three rules on top of the table:

1. **The channel window outranks every SLA.**
   `sla_due_at = least(queue_target, service_window_expires_at − 2 h)`.
   Missing a Meta window is unrecoverable; missing an internal target is
   not.
2. **The clock pauses** in `WAITING_CUSTOMER` and `WAITING_TEAM` and
   resumes on the next inbound. A conversation legitimately parked on the
   customer must not manufacture a breach.
3. **A breach is a signal, not an email storm.** Crossing `sla_due_at`
   writes `SLA_BREACHED` and raises the queue's `priority_rank`; it opens
   an intervention only for `ESCALATIONS`, `COMPLAINTS`,
   `PAYMENT_DISCUSSIONS` and `BOOKING_READY`.

**Why these numbers.** They are graded by revenue and trust consequence
rather than set uniformly. A booking-ready customer and an angry customer
are the two cases where minutes cost money; document and visa work is
genuinely multi-day, so a 30-minute target there would only train staff to
ignore the colour.

Defaults live in `inbox_sla_policies`, per agency, seeded with this table.

### R3 — Auto-assignment is owner-sticky, then skill, then least-loaded

**Decision.** A four-step resolution chain; first match wins.

1. **Owner-sticky** — if the resolved lead or pilgrim already has an
   owner and that person is on shift, assign to them. Continuity beats
   load balancing: the customer has a relationship, and re-explaining
   context is exactly the cost this product exists to remove.
2. **Designated coordinator** — a group enquiry (party ≥ the agency's
   group threshold, default 10) routes to the group-coordinator role; a
   `VISA_ISSUES` or `DOCUMENTS` conversation routes to the visa or
   documents role, per the PDF's §8 routing examples.
3. **Least-loaded among eligible on-shift staff**, where load = open
   conversations in `NEEDS_REPLY` weighted by queue priority. Round-robin
   on `last_assigned_at` breaks ties.
4. **Fallback** — `ai_settings.default_lead_owner_id`, the existing
   behaviour in `lib/agent/whatsapp/tools/handoff.ts`, unchanged, so
   nothing regresses for an agency that configures none of the above.

Never auto-assign to someone off-shift, on leave, or deactivated. Such a
conversation goes to `UNASSIGNED` with its SLA clock running, which is
honest, rather than into an absent person's queue, which is invisible.

**Why not pure round-robin.** It optimises the metric nobody cares about
(even distribution) at the cost of the one they do (the customer not
having to repeat themselves). Least-loaded is the right tie-break, not the
right first rule.

**Knobs.** `inbox_routing_policy` per agency: `sticky_enabled` (default
true), `group_threshold` (default 10), `load_balance_mode`
(`LEAST_LOADED` | `ROUND_ROBIN`, default `LEAST_LOADED`),
`respect_shifts` (default true).

### R4 — Answer-cache eligibility and approval

**(a) What may be cached.** Only answers whose every factual claim passes
`verifyClaims()` against agency-owned knowledge documents, and only for
these intent classes: `FAQ`, `ITINERARY_QUERY`, document-checklist
questions, and process questions (how booking works, what happens at the
airport, luggage rules, meal arrangements).

**Never cacheable**, regardless of who asks: any price or availability
figure (those are rung-1 SQL and they change — caching them is how an
agency quotes a dead price), visa outcomes or eligibility, payment and
refund questions, medical advice, religious rulings, and anything naming a
specific traveller. This list is a code constant beside the
never-autonomous list in §10.3, with the same kind of test.

**(b) Who approves.** A new capability `approveInboxAnswer` on the
`insights` module, defaulting to **ADMIN and CEO only**, grantable to a
senior sales role through the existing dynamic role-permissions system.
Not open to any senior sales role by default: an approved cache entry is
the one place in this design where one person's wording gets repeated to
thousands of customers unreviewed, so the default belongs at the top and
an agency can loosen it deliberately.

**(c) Lifecycle.** A candidate is proposed only after the same question
has been answered consistently **three or more times**, so approvers see a
short real list rather than a flood. An entry auto-invalidates on a
`knowledge_version` bump, auto-expires after **90 days unused**, and
auto-retires after **two staff rejections or heavy edits**, with the
reason recorded — a bad entry cannot quietly survive.

### R5 — L2 safe auto-reply is opt-in, gated on evidence rather than a calendar

**Decision.** Off by default on every plan, Growth included. Promotion
from L1 to L2 requires an explicit admin action, and the control stays
disabled until **all** of the following hold for that agency:

- ≥ 7 days in `SHADOW` or `PROPOSE` **and** ≥ 200 recorded shadow
  decisions — a quiet week is not evidence;
- S1 triage intent accuracy ≥ 85 % on that agency's reviewed sample;
- `PAYMENT_CLAIM_UNVERIFIED` precision ≥ 95 %;
- zero never-autonomous deny-list violations in the window;
- staff rejection rate below `rejection_demote_threshold` (default 0.40).

On promotion, L2 starts **deliberately narrow for 14 days**: out-of-hours
only, limited to acknowledgement, the configured
`ai_settings.out_of_hours_message`, approved qualifying questions, and
approved cached FAQ answers. Full L2 scope unlocks after that window if
the thresholds still hold.

**Why.** "A week of shadow review" is a proxy for confidence; these
thresholds are confidence itself. A time-only gate would pass an agency
whose Copilot was wrong 40 % of the time for seven days. The narrow first
fortnight also places the first autonomous sends where a mistake costs
least — at 2 a.m., on an acknowledgement.

The same thresholds run in reverse as the automatic demotion rule (§10.2),
so promotion and demotion share one definition.

### R6 — Multi-currency figures are bucketed, never converted

**Decision.** The owner panel's pipeline-influenced figure, and every
aggregate built from `matched_offer` values, is reported **per currency** —
never summed across currencies, never converted:

> Pipeline influenced · LKR 4,250,000 · USD 12,400 *(estimate, from
> matched offers)*

This follows the precedent already set in the reports module: the
`report_group_facts` view keeps `supplier_cost_by_currency` as a
per-currency jsonb bucket precisely so a KPI can never label SAR + LKR as
one number, and its migration comment says so. The Inbox reuses that
pattern instead of introducing an FX rate table.

Presentation: the agency's default currency
(`agency_settings.currency`) leads, others follow in descending value, and
a single-currency agency — the common case — sees exactly one figure and no
extra chrome. Every such figure is labelled an **estimate** and links to
the queue it was computed from.

**Why no conversion.** An FX rate is a finance decision with an as-of
date, an audit trail and a rate source. Inventing one inside an inbox
panel produces a number that reconciles with nothing in the Finance
module, which is worse than two honest numbers.

### R7 — Retention follows the record, not the plan tier

**Decision.** Retention is uniform across plan tiers and configurable
within platform-enforced bounds, stored beside the retention columns
`agency_settings` already has (`document_retention_years` 7,
`archived_group_retention_years` 7, `deactivated_user_retention_years` 1).

| Data | Default | Rationale |
|---|---|---|
| Messages on a conversation linked to a booking | **7 years**, matching `document_retention_years` | Commercial correspondence about a delivered service — the record that settles a dispute |
| Messages on an unconverted enquiry | **24 months** from last activity | Long enough for a returning pilgrim's next season, short enough not to hoard |
| Attachments — passports, IDs, receipts | **90 days** in the message store, then promoted into the Documents module (where the 7-year policy and its stricter access control apply) or deleted | A passport scan should not live in an inbox. Promotion is an explicit staff action; expiry is automatic |
| Voice notes — original audio | **180 days**; the transcript follows the message policy | The audio exists to check a doubtful transcription, which is a short-lived need |
| `conversation_intelligence`, `conversation_signals` | **24 months** | Year-over-year analytics and eval replay |
| `conversation_interventions` and their resolutions | Follows the parent conversation | A resolved payment dispute must outlive the message that caused it |
| `ai_runs` / `ai_tool_calls` | **13 months** (already redacted via `FORBIDDEN_KEYS`) | Year-over-year cost comparison, then gone |
| `channel_webhook_events` raw payloads | **30 days** | A debugging window, nothing more |

**Retention is deliberately not a plan feature.** Selling longer history
creates a compliance hazard — the floor for booking-linked records is a
legal question, not a pricing one — and a perverse incentive to keep
sensitive data in order to justify a tier. What *does* differ by tier is
**export and audit access**: Professional gets audit export, Enterprise
gets scheduled exports and a DPA. That is a capability, not a retention
period.

Deletion runs as a nightly BULK-lane job: idempotent, one audit row per
batch, and sharing a code path with the existing data-deletion endpoints
(`app/legal/data-deletion`, `app/api/webhooks/meta/data-deletion`) so a
Meta-initiated deletion request and the retention sweep behave
identically.

**Platform bounds**, not agency-editable: booking-linked messages ≥ 3
years and ≤ 10; attachments ≤ 365 days in the message store; raw webhook
payloads ≤ 90 days.

### R8 — Postgres owns state; one Postgres queue owns per-message work; Inngest owns lifecycle workflows and schedules

> **Superseded in part by [R9](#r9--postgres-owns-state-and-the-clock-pg_cron-owns-schedules-no-external-workflow-engine) (2026-10-01).** Points 1 and 4 (the Postgres queue owns per-message work; `pgmq` is not adopted) still stand. Points 2 and 3 (Inngest for schedules and lifecycle workflows, and the `inngest_outbox` bridge) are replaced by R9. Kept below as the record of what was decided and why.

**Decision.** Added 2026-09-25 from [`scale-inngest-implementation-plan.md`](./scale-inngest-implementation-plan.md) §2.

1. Every provider message, delivery status, AI reply, enrichment and media job is a row in `channel_jobs`, queued in the same
   transaction as the data it serves, claimed with fair share, and run by an always-on worker. `agent_jobs` is retired into it.
2. Inngest runs only work that is time-based, multi-step, or triggered by a lifecycle change: follow-up sequences, SLA escalation,
   reply-window reminders, handoff acknowledgement, knowledge-document ingestion, booking follow-through, and the scheduled jobs now
   run by `pg_cron` over HTTP. Inngest is never triggered once per message.
3. The bridge is one-directional and rare. A committed lifecycle change writes an `inngest_outbox` row in the same transaction; the
   worker forwards it to Inngest with the row id as the event id. Events carry ids only, never message text, names, phone numbers,
   passports or prices, because Inngest stores event payloads and step output.
4. Supabase Queues (`pgmq`) is not adopted: it has no merging of related messages, no per-conversation grouping, no fair share and
   no priorities, and `channel_jobs` has all four.

### R9 — Postgres owns state and the clock; `pg_cron` owns schedules; no external workflow engine

**Decision.** Added 2026-10-01 on the owner's instruction: the Inngest execution allowance is too small for this product, and the work
it did can be done on Supabase and the web app already in use. Full plan:
[`supabase-native-scheduling-plan.md`](./supabase-native-scheduling-plan.md); build order in `tasks/plan.md`.

1. **Schedules.** Every scheduled job is a `pg_cron` job that calls its existing `app/api/cron/*` route through `pg_net`, with the
   base URL and bearer secret held in Supabase Vault (`set_cron_http_config`, `invoke_cron_route`). The route handlers are unchanged;
   only the trigger moves. `pg_cron` is the only scheduler: a job must never have two schedulers at once.
2. **Time-based and lifecycle work is a sweep, not a sleep.** Work that waited on a timestamp (the reply-window reminder) becomes a
   periodic query over that timestamp column, made exactly-once by the existing follow-up ledger. No durable sleeping workflow, and no
   event is emitted for it.
3. **Multi-step work uses the Postgres queue.** Knowledge-document ingestion runs as the existing `EMBED_DOCUMENT` job on
   `agent_jobs`; if it must resume after a crash, it saves its progress on the document row and re-queues itself.
4. **No bridge.** `inngest_outbox`, its forwarder and its triggers are removed. Nothing in the database or the app depends on an
   external workflow vendor.
5. **Invariants kept from R8.** Postgres is the source of truth; per-message work stays on `channel_jobs` (R8 points 1 and 4);
   jobs are idempotent and lease-based so an overlapping or repeated run is harmless; logs and run output carry counts and ids only,
   never message text, names, phone numbers, passports or prices.
6. **Observability replaces vendor run history.** Scheduler history is `cron.job_run_details` and the HTTP result is
   `net._http_response`; a view and an alert flag a job that has not succeeded in twice its interval or has failed twice in a row, and a
   daily job trims both tables. Retries are the next tick, which is sufficient for every job here.

**Why not the alternatives.** Supabase Edge Functions would mean porting working route code for no gain; `pgmq` is still rejected
for per-message work (R8 point 4) and is not needed for the rest; Vercel Cron has plan limits and was deliberately replaced earlier;
paying for more Inngest executions was declined.

**Status of the change (2026-10-01).** Done in the app and the database: schedules and the reply-window reminder run on `pg_cron` and a Postgres sweep (T3 to T10),
knowledge ingest uses the `EMBED_DOCUMENT` job (T11), the Inngest code, route and packages are removed (T13, T14), and the outbox and its triggers are dropped
by migration `20261227090000_drop_inngest_outbox.sql` (T15, applied after the code deploy). R8 points 2 and 3 are history. What remains is outside the
repository: deleting the Inngest app and integration (see `docs/runbooks/inngest.md`).
