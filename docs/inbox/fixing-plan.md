# Manasik Inbox + Copilot — Completion and Remediation Plan

Status: **planned**. This plan closes the implementation and verification gaps
found by the September 2026 code-backed audit of the complete Inbox programme.
It supplements [`architecture.md`](./architecture.md),
[`implementation-plan.md`](./implementation-plan.md), and
[`checklist.md`](./checklist.md); it does not replace their settled product
decisions R1–R7.

The programme is not being redesigned. The shortest safe path is to repair the
shared boundaries, finish the missing behaviour, prove the existing code in its
real environment, and then reconcile the documentation with `main`.

---

## 1. Objective

Finish every remaining Inbox requirement so that:

- every provider send passes one server-side channel, autonomy, entitlement,
  protection, ownership, and fact-freshness decision immediately before
  provider contact;
- retention cannot delete booking-linked correspondence early and can resume
  bounded work safely;
- AI-assisted conversation metering counts every qualifying path exactly once
  per billing period;
- L3 intake hands over on every forbidden topic, including the first message
  and Sinhala/Tamil messages;
- passport intelligence compares candidates with the correct agency-scoped
  traveller and departure facts;
- commercial projections, queue counts, language tools, routing, conversions,
  and rollout controls match the architecture;
- every original MI slice has either its exit evidence or an explicit,
  documented replacement acceptance criterion;
- the Inbox meets all Architecture §12 SLOs under the staging load harness.

Success means more than green unit tests. Provider delivery, browser
concurrency, Storage deletion, database RLS, dry-run/live reconciliation,
autonomy evidence, and scale SLOs must all be measured.

## 2. Scope and constraints

### In scope

1. The ten incomplete or architecturally misaligned areas identified by the
   audit: outbound policy, retention, metering, L3 intake, media comparison,
   queue/projection freshness, routing availability, feature rollout,
   language support, and workflow conversions.
2. The unproven exit criteria for the other built slices.
3. Performance verification and only the optimizations justified by those
   measurements.
4. Documentation and checklist reconciliation.

### Out of scope

- No new AI provider, queue product, cache service, or UI framework.
- No rewrite of `agent_jobs`, `channel_jobs`, the proposal kernel, or the
  canonical conversation model.
- No eager draft generation.
- No FX conversion.
- No automatic identity merge above exact normalized identity.
- No expansion of L3 beyond the four-field bounded intake already approved.

### Non-negotiable implementation rules

- One remediation slice per PR; update the Inbox checklist in the same PR.
- Reuse existing pure functions and repositories before adding another layer.
- Every trust-boundary input is Zod-validated.
- Every read and write is agency-scoped; every new table gets RLS in the same
  migration; every definer function uses `set search_path = ''` and a minimal
  grant.
- Deterministic facts remain authoritative. Models may classify or narrate,
  never calculate commercial, payment, inventory, eligibility, or policy facts.
- No optimization lands without a before/after measurement under identical
  conditions. A neutral or slower change is reverted.
- No new dependency unless the standard library and installed dependencies
  cannot solve the measured problem.

## 3. Capability map and build order

| Remediation capability | Responsibility | Depends on |
|---|---|---|
| `send-safety` | One final provider-send authorization boundary | — |
| `retention-integrity` | Correct booking classification, resumable deletion, Storage ordering | — |
| `usage-metering` | Exact AI-assisted-conversation metering and degradation | — |
| `intake-safety` | First-turn and multilingual L3 handover correctness | `send-safety`, `usage-metering` |
| `media-trust` | Traveller-aware passport/receipt review | `retention-integrity` |
| `projection-freshness` | Immediate commercial stage and queue refresh | — |
| `queue-performance` | Constant/safely bounded queue-count read cost | `projection-freshness` |
| `routing-availability` | Real per-person availability and eligible-role routing | — |
| `rollout-contract` | One canonical plan/surface/flag decision | preceding runtime repairs |
| `language-quality` | Translation view, language analytics, output-quality checks | `send-safety` |
| `conversion-contract` | Reconcile the sixteen workflow actions with the proposal kernel | `projection-freshness` |
| `operational-proof` | Database, browser, provider, retention, autonomy, and scale exits | all above |

Build order:

1. `send-safety` and `retention-integrity` first; they prevent external-policy
   mistakes and premature data deletion.
2. `usage-metering` and `intake-safety` before any L2/L3 rollout.
3. `media-trust`, `projection-freshness`, and `routing-availability`.
4. `queue-performance`, `rollout-contract`, `language-quality`, and
   `conversion-contract`.
5. `operational-proof`, then documentation closure.

---

## 4. Remediation slices

### FIX1 — One outbound authorization boundary

**Goal.** Every staff or automated message is authorized immediately before
provider contact, regardless of whether it came through the transactional
outbox or the legacy agent-delivery path.

**Modify.**

- Extract the policy read and decision currently embedded in
  `lib/inbox/outbox/drain.ts` into
  `lib/inbox/outbound/authorize-provider-send.ts`.
- The function loads the agency-scoped conversation, message author, support
  state, open interventions, live offer when figures are present, autonomy,
  entitlement, and channel-policy state.
- Call it from both `lib/inbox/outbox/drain.ts` and
  `lib/agent/whatsapp/reply-delivery.ts` immediately before `sendReply()`.
- Keep provider adapters transport-only. They must not each grow a second copy
  of the policy.
- Prefer routing automated replies into the existing outbox if that can be done
  without changing the proven retry semantics. Otherwise keep the direct path
  temporarily, but require the exact same authorization function and audit row.

Minimal boundary:

```ts
const decision = await authorizeProviderSend(db, request);
if (!decision.allowed) return { status: "REFUSED", reasons: decision.reasons };
return adapter.sendReply(connection, token, decision.command);
```

**Tests.** One table-driven test per channel state and author type; WhatsApp
inside/outside 24 hours; Messenger/Instagram inside 24 hours, HUMAN_AGENT, and
after seven days; every automated surface refused from HUMAN_AGENT; stale
price, insufficient seats, open payment review, entitlement clamp, and deny
list all fail closed. Assert both delivery paths call the shared function.

**Performance.** Fetch authorization inputs in one RPC or one bounded
`Promise.all`, with every predicate indexed. Record p50/p95 authorization
latency. Target p95 ≤ 100 ms excluding provider latency.

**Exit.** There is no provider `sendReply()` call for an Inbox message that is
not immediately preceded by the shared authorization decision. A provider
window test produces no invalid delivery attempt.

### FIX2 — Retention integrity and resumable batches

**Goal.** A conversation linked to a booking by any supported relationship
receives booking retention, and every destructive sweep is resumable and
auditable.

**Create/modify.**

- Add one SQL candidate function that classifies a conversation as
  booking-linked when either:
  - a booking has `source_conversation_id = conversation.id`; or
  - `conversation.lead_id` points to a lead with `booking_id`; or
  - an existing canonical booking/conversation link added by a future normal
    booking path exists.
- Use keyset cursors `(cutoff_timestamp, id)`, not offsets.
- Make `runRetentionSweepForAgency()` loop only until its wall-clock or row
  budget is reached, persisting the next cursor after every successful batch.
- Resume from the last successful cursor. An errored object must remain
  retryable and must not allow its database row to be deleted.
- Keep Storage-before-row deletion as the single destructive primitive used by
  nightly retention and Meta deletion.
- Include `agent_runs` only if its retained content falls under the same
  AI-run policy; otherwise document why it is excluded.

Candidate shape:

```sql
where c.last_activity_at < case
  when exists (select 1 from booking_links bl where bl.conversation_id = c.id)
    then p_booking_cutoff
  else p_enquiry_cutoff
end
and (c.last_activity_at, c.id) > (p_cursor_at, p_cursor_id)
order by c.last_activity_at, c.id
limit p_limit
```

**Tests.** Direct source link; lead→booking link; unconverted enquiry; booking
at 24 months protected; booking past its configured window removed; multiple
batches; crash after Storage deletion; Storage failure before row deletion;
cursor resume; repeated sweep idempotency; promoted document survival; plan
tier has no effect; Meta deletion reaches the same end state.

**Performance.** `EXPLAIN (ANALYZE, BUFFERS)` the candidate query at 1 million
conversations. Add only an index proven to change the plan. Target each
250-row claim under 100 ms and keep total cron execution under its function
budget.

**Exit.** Controlled dry-run counts equal the live sweep, no protected booking
message is deleted, and no expired unpromoted passport remains after the
bounded backlog is drained.

### FIX3 — Complete AI-assisted conversation metering

**Goal.** Meter once per `(agency, conversation, billing period)` when any
qualifying enrichment, draft, approved-answer use, or L3 intake occurs.

**Modify.** Keep `meter_ai_conversation` as the atomic database authority. Add
one small application helper that derives the period consistently and call it
at the four workflow boundaries:

1. successful S1/S2/S4 model-assisted enrichment;
2. successful generated draft;
3. approved-answer cache response shown to staff or sent automatically;
4. first L3 intake turn.

Do not increment per message or per model call. Do not meter rule-only risk
detection or human sends.

```ts
await meterAiConversation(db, {
  agencyId,
  conversationId,
  periodStart: utcMonthStart(now),
});
```

**Tests.** Retry, webhook redelivery, multiple surfaces, cache hit plus draft,
and L3 turns all remain one unit in a period; the next period increments once;
two agencies with the same conversation UUID remain separate; rule-only paths
do not increment.

**Performance.** One `insert ... on conflict do nothing`; no read-before-write.
Target p95 ≤ 20 ms and prove the unique index is used.

**Exit.** A controlled fixture reconciles the usage counter to the distinct set
of qualifying conversations exactly, and the 80/100/120% degradation ladder
uses that number.

### FIX4 — L3 first-turn and multilingual safety

**Goal.** Every customer message, including the first, passes through the same
state transition and deny-topic detector before an automated response.

**Modify.**

- Initialize state, then always call `advanceIntakeFlow(state, customerText)`;
  do not special-case the first message around the transition.
- Extract forbidden-topic lexicons into a tested constant with English,
  Sinhala, Tamil, and common Singlish forms.
- Reuse the Inbox risk/never-promise vocabulary where meanings overlap rather
  than maintaining competing lists.
- When handing over, persist the provisional lead and collected facts, open or
  reuse one human-review intervention, assign an eligible owner, and send no
  automated answer to the forbidden question.
- Preserve idempotency on repeated message delivery.

**Tests.** First-message price/payment/booking/refund/visa/medical/religious
questions in all three languages; first message containing a valid date skips
the redundant dates question; duplicate first message sends nothing twice;
two stalls hand over; no booking/payment/inventory mutation is reachable.

**Output quality.** Questions remain short, ask one thing at a time, match the
detected language, and state plainly when a person will continue. Golden-output
tests check meaning and protected claims, not punctuation or exact prose.

**Exit.** The multilingual overnight scenario produces one provisional lead,
correct collected facts, one visible human-review requirement, and zero
deny-list violations.

### FIX5 — Traveller-aware media intelligence

**Goal.** Passport candidate fields are compared with the correct traveller,
booking, and departure date; receipt handling remains proof-only.

**Modify.**

- Add one agency-scoped media context loader returning the linked lead,
  booking, candidate travellers, departure date, and the agency passport
  validity threshold.
- Extend the pure passport reviewer to return field mismatches, expired status,
  and insufficient-validity-at-departure status.
- Never auto-select when several travellers are plausible. Show a required
  staff choice instead.
- Store candidate values separately from canonical pilgrim values. No media
  worker updates a pilgrim or payment record.
- Re-run or attach the analysis to the existing review card; do not create a
  second intervention for the same attachment.

**Tests.** Exact match; passport-number/name mismatch; expiry before departure;
expiry inside the configured validity threshold; low confidence; no linked
traveller; multiple travellers; cross-agency traveller; receipt never mutates
payment; original remains viewable after retry.

**Performance.** Load all booking travellers in one query, not one per
candidate. Do not send canonical PII to a model; comparison is deterministic.

**Exit.** A real passport and receipt sent through a test provider produce the
document/Finance reviews described in `usage.md`, with private originals and
five-minute signed URLs.

### FIX6 — Event-driven commercial projection freshness

**Goal.** Quote, booking, loss, payment, and source-record changes update the
commercial stage and queues immediately rather than waiting for another
customer message.

**Modify.**

- Extract the deterministic commercial recompute from the enrichment pipeline
  into one idempotent service.
- Call it after quote creation/status change, booking creation/status change,
  lead loss/reopen, and relevant payment change.
- Enqueue one coalesced STANDARD job when the caller cannot safely recompute in
  the request. Use `commercial:<conversation_id>` as the coalesce key.
- Refresh queue membership only after the projection write succeeds.

**Tests.** `QUOTE_SENT`, `BOOKING_READY`, `BOOKED`, and `LOST` transitions are
visible without a new inbound message; retries coalesce; foreign records never
change another agency's projection.

**Performance.** One bounded record pack and one projection write. Target
event→fresh queue p95 < 2 s and no page render awaiting recompute.

**Exit.** Creating a quote or booking moves the open Inbox conversation to its
new queue without refresh-by-customer-message.

### FIX7 — Exact queue counts at scale

**Goal.** Queue counts stay below Architecture §12's p95 target without a scan
whose cost grows linearly with all membership rows.

**Measure first.** Capture `EXPLAIN (ANALYZE, BUFFERS)` and p50/p95 at 100k and
1m conversations for the current `inbox_queue_counts()` call. Record row-write
cost for `refresh_conversation_queues()`.

**Implementation decision gate.**

1. First try one indexed count per requested queue inside a single RPC. Keep it
   only if it meets the target and does not multiply total work.
2. If exact counts still exceed the target, add
   `conversation_queue_counts(agency_id, queue_code, count)` and maintain
   atomic deltas inside `refresh_conversation_queues()` using the old/new queue
   sets. Backfill once and add an audit reconciliation query.
3. Do not add Redis or an eventually consistent cache for exact operational
   counts.

**Tests.** Membership and counters remain equal after assignment, close,
message, intervention, commercial transition, retry, and concurrent refresh;
two-agency isolation; backfill idempotency.

**Exit.** Count render p95 < 300 ms at 1m conversations, with the before/after
plan and write-cost delta recorded. Revert any index that the final plan does
not use.

### FIX8 — Routing availability and capability correctness

**Goal.** R3 means owner-sticky, then coordinator, then least-loaded among
people who are actually available and capable of working the Inbox.

**Modify.**

- Use an existing leave/availability source if one exists at implementation
  time; otherwise add the smallest agency-scoped availability table with
  `(staff_id, starts_at, ends_at, kind)` and RLS.
- Keep agency working hours as the office calendar, not as a substitute for an
  individual shift.
- Candidate loading must require active access dates, Inbox `sendMessage`
  capability, current availability, and the designated skill/role.
- When nobody is eligible, leave the conversation visibly `UNASSIGNED`; never
  route to an incapable coordinator merely because their role name matches.

**Tests.** Owner on/off shift; active leave; deactivated/access-ended user;
coordinator without Inbox permission; least-loaded tie; round-robin tie;
fallback; no eligible person.

**Exit.** Real test staff demonstrate sticky, coordinator, least-loaded, and
unassigned paths with the SLA clock continuing correctly.

### FIX9 — Canonical rollout and entitlement contract

**Goal.** Replace the stale list of undocumented boolean flags with one clear
decision model and make every optional surface obey it.

**Decision.** Reuse what already exists:

- `plans.features` controls product entitlement for offer matching, identity,
  SLA, media, owner panel, answer cache, and exports;
- `ai_surface_settings` controls model/autonomy execution and safety modes;
- `agency_settings.inbox_queues_v2` remains the temporary queue-UI rollout
  switch until the legacy rail is retired.

Do not add duplicate `inbox_autonomy_l2/l3` booleans. Update the Architecture
and implementation plan to remove those stale flag promises.

**Modify.** Add one typed `resolveInboxFeatureAvailability()` function that
combines subscription features, surface state, and any temporary rollout flag.
Use it in repository/UI exposure and in server/worker execution. Hiding a UI
control is not enforcement.

**Tests.** Starter/Growth/Professional/Enterprise; grandfathered agency;
feature hidden and direct action refused; downgrade clamps autonomy and removes
premium execution; human replies and deterministic payment-risk protection
remain available.

**Performance.** Extend the existing short entitlement cache rather than
creating a second cache. Key by agency and include the plan/subscription
version or accept the existing ≤60-second staleness with immediate enforcement
on writes that reduce privilege.

**Exit.** Every optional feature has one named controlling input and one
server-side enforcement point, documented in Architecture §14.

### FIX10 — Language translation and output quality

**Goal.** Close G15 completely and improve staff/customer output without
turning the Inbox into another AI chat panel.

**Create/modify.**

- Keep `language_code` as the conversation state.
- Add an on-demand staff translation action for individual messages or the
  current digest. It uses `generateStructured()`, is clearly non-authoritative,
  preserves the original beside it, and stores no translation unless the
  existing message-analysis storage can hold it safely.
- Add language buckets to the deterministic KPI view; no model-generated
  totals.
- Improve drafting inputs by removing duplicated facts, keeping the frozen
  system block stable, ordering verified facts before prose guidance, and
  limiting history to the digest plus the most recent turns.
- Standardize user-facing fallback output: what was understood, what cannot be
  confirmed, and the single next action. Never expose model/provider errors to
  staff or customers.

Short output contract:

```ts
type StaffFacingAiResult<T> = {
  value: T | null;
  source: "RULES" | "LLM";
  confidence: number | null;
  note: string | null;
};
```

Reuse the existing `AiResult` where compatible; do not introduce this second
type merely to rename fields.

**Tests.** English/Sinhala/Tamil and mixed input; original always visible;
translation carries source/confidence; no figure or protected promise absent
from the fact pack; concise golden examples; provider failure gives a useful
deterministic fallback; language KPI is agency-scoped.

**Performance.** Translation is on demand and separately metered. No page
render awaits a model. Draft p95 remains < 6 s and the system fingerprint stays
stable for prompt-cache reuse.

**Exit.** Staff can understand a message without replacing its original, and
owners can drill into language usage without cross-tenant or model-derived
counts.

### FIX11 — Reconcile the sixteen workflow actions

**Goal.** Make the documented conversion contract honest and consistent.

**Decision step.** For each of the sixteen architecture actions, record whether
it creates an object, updates/selects an existing object, or is a communication
action. Do not pretend a selector or draft creates a workflow record.

- Keep the twelve existing typed proposal kinds where they create domain
  records.
- Route lead, quote, and booking creation through the proposal kernel only if
  doing so removes duplicated validation without weakening the existing
  transaction/capacity guards. Otherwise document them as existing guarded
  actions and give them the same source-link and idempotency contract.
- Document departure-group assignment as a selection/update, not a created
  object.
- Ensure identity-graph “Create separate lead” stamps source conversation and
  message.
- Add assignment/notification and the owning module's normal SLA where a
  created task or support case would otherwise be invisible.

**Tests.** One named test per architecture action; both source columns on every
created object; direct-action and proposal paths enforce equivalent capability,
agency, idempotency, and validation rules; no partial write after failure.

**Exit.** The passport-expiry scenario is reproduced in a browser and every
offered action performs exactly what its label says.

### FIX12 — Traceability and database security verification

**Goal.** Make programme completion auditable rather than inferred.

- Add one test or describe block naming each G1–G15 and R1–R7. It may point to
  existing fixtures; do not duplicate good tests only to satisfy naming.
- Add database integration scripts for every new/changed RLS path, definer RPC,
  composite foreign key, check constraint, and cross-agency retrieval.
- Run migrations in a rolled-back verification transaction, apply them to the
  target environment, then query the applied schema.
- Verify the existing WhatsApp path with all new optional surfaces disabled.

**Exit.** A generated traceability table maps every G/R identifier to code,
test, live evidence, and its completing PR.

### FIX13 — Browser and provider acceptance

**Goal.** Close every UI/provider exit that unit tests cannot prove.

Run the scenarios in `usage.md` §13 with test contacts and non-production
financial/document data. At minimum:

- responsive Inbox rail at desktop, tablet, and mobile;
- two-browser composer presence;
- intent/offer/evidence/identity cards;
- quote, booking, all conversion actions, and Operations handoff;
- WhatsApp window boundary and approved template charge;
- Messenger/Instagram HUMAN_AGENT boundaries;
- voice, passport, receipt, promotion to Documents, and signed links;
- L0→L1→L2 promotion/demotion with audit rows;
- owner metric drill-through and two-currency presentation;
- allowance behavior at 80%, 100%, 120%, and 200%;
- retention dry-run/live reconciliation.

Record dates, environment, fixture ids, observed result, screenshots where
useful, and any provider bill/rate comparison in a new `docs/progress/`
snapshot. Do not place secrets or customer PII in evidence.

### FIX14 — Scale verification and performance guardrails

**Goal.** Complete MI6.5 and prevent regressions.

1. Establish a staging baseline before FIX7 and again after all fixes.
2. Run `scripts/load/inbox-multitenant.ts` with 50 agencies × 200
   conversations and synchronized bursts.
3. Record p50/p95/p99 per lane, per-agency fairness, webhook→visible latency,
   draft latency, S0 skip rate, cache hit rate, cost per enriched conversation,
   queue count latency at 100k and 1m rows, and database write overhead.
4. Compare identical cold/warm conditions and multiple runs; keep only changes
   that beat normal variance.
5. Add stable CI guards for pure/query-plan invariants. Keep live/provider SLOs
   in staging monitoring rather than a flaky unit suite.

Required budgets:

| Metric | Required result |
|---|---|
| inbound visible | p95 < 2 s |
| REALTIME triage | p95 < 5 s |
| full enrichment | p95 < 30 s |
| on-demand draft | p95 < 6 s |
| queue counts at 1m conversations | p95 < 300 ms |
| provider-send authorization, excluding provider | p95 < 100 ms |
| AI cost per enriched conversation | ≤ $0.012 |
| S0 skip rate | ≥ 50% live traffic |
| cross-agency fairness | noisy tenant degrades another tenant's REALTIME p95 by < 20% |
| cross-tenant leakage | zero |

Record kept and reverted performance experiments so a neutral optimization is
not attempted again.

### FIX15 — Reconcile documentation and close the programme

**Goal.** Make the docs reflect the deployed implementation rather than old
branch state.

- Update `architecture.md` where an approved implementation decision differs
  from the original design, especially rollout controls and conversion kinds.
- Update `implementation-plan.md` “As built” notes and remove statements that
  Phases 5–6 are unstarted.
- Update `checklist.md` merge state, counts, R1–R7, G1–G15, and exits strictly
  from evidence produced by FIX12–FIX14.
- Add one final phase-completion snapshot under `docs/progress/`.
- Keep unchecked anything whose live or measured exit is still missing.

**Exit.** A new engineer can derive the exact deployed state from the docs
without reading branch history or re-auditing the whole repository.

---

## 5. Original-slice closure map

This table ensures no MI slice disappears inside the remediation work.

| Original slice | Remaining closure work |
|---|---|
| MI0.1 | FIX13 OpenRouter reconciliation and live month-to-date display |
| MI0.2 | FIX12 traceability proof only |
| MI0.3 | FIX12 live view/RLS verification |
| MI1.1 | FIX14 repeat fairness/query benchmark after final migrations |
| MI1.2 | FIX14 deployed 200-message/two-tick exit |
| MI1.3 | FIX14 2,000-job fan-out exit |
| MI2.1 | FIX12 final schema/RLS verification |
| MI2.2 | FIX7 count-path optimization and FIX13 rail verification |
| MI2.3 | FIX14 live S0 result and FIX12 G12 traceability |
| MI2.4 | FIX13/FIX14 live triage latency and skip rate |
| MI2.5 | FIX13 responsive browser verification |
| MI2.6 | FIX13 deployed cron and paused-clock verification |
| MI3.1 | FIX13 live evidence-labelled intent card |
| MI3.2 | FIX1 freshness gate, waitlist presentation, FIX13 live group match |
| MI3.3 | FIX9 entitlement/rollout enforcement and FIX13 cross-channel flow |
| MI3.4 | FIX6 immediate event-driven recompute |
| MI3.5 | FIX8 individual availability and capability correctness |
| MI4.1 | FIX12 signal verdict traceability and FIX13 live precision |
| MI4.2 | FIX1 shared protection boundary and FIX13 worked payment scenario |
| MI4.3 | FIX13 one-week shadow recall evidence |
| MI4.4 | FIX13 two-browser presence |
| MI4.5 | FIX13 confirmed-booking handoff and acknowledgement |
| MI4.6 | FIX11 conversion reconciliation and browser evidence |
| MI5.1 | FIX10 output quality and FIX13 seeded grounded draft |
| MI5.2 | FIX3 complete metering and FIX13 live cache-hit proof |
| MI5.3 | FIX1 direct-send policy closure and provider acceptance |
| MI5.4 | FIX5 traveller-aware comparison and live media proof |
| MI6.1 | FIX1/FIX9 enforcement and FIX13 audited promotion/demotion |
| MI6.2 | FIX3/FIX4 metering and multilingual first-turn safety |
| MI6.3 | FIX7 performance and FIX13 exact drill-through reconciliation |
| MI6.4 | FIX3 usage accuracy and FIX9 entitlement contract |
| MI6.5 | FIX14 staging scale run and measured snapshot |
| MI6.6 | FIX2 retention integrity and FIX13 dry-run/live proof |

---

## 6. Testing and verification commands

Every remediation PR runs:

```powershell
npm run lint
npm run typecheck
npm run test
```

Database-changing PRs also run their named `scripts/sql/verify-*.sql` script
in a rolled-back transaction before applying the migration. UI PRs require the
relevant signed-in browser scenario. Performance PRs require the exact baseline
and result commands, fixture size, query plan, and repeated measurements in the
PR description.

The existing 279 lint warnings are not an excuse for new warnings. Each PR must
leave the warning count no higher than its baseline; Inbox-touched files should
leave with zero warnings.

## 7. PR and checklist discipline

For each FIX slice:

1. Mark its checklist work in flight with `- [~]` and the branch/PR.
2. Implement only that slice and its smallest required migration/test set.
3. Run unit, integration, security, and performance checks proportional to the
   risk.
4. Record manual/live evidence before marking the exit complete.
5. Merge, then tick the original MI, G, R, and programme boxes that the evidence
   genuinely closes.

Do not tick an original slice merely because FIX code exists. The final state
must be observable, measured, agency-isolated, and documented.

## 8. Programme exit criteria

The remediation programme is complete only when:

- all FIX1–FIX15 exits pass;
- every MI0.1–MI6.6 row in the closure map has evidence;
- G1–G15 and R1–R7 each map to a named passing test;
- all Architecture §12 SLOs pass in staging;
- provider policy tests show zero invalid send attempts;
- retention dry-run/live counts reconcile with no protected deletion;
- AI conversation counters reconcile exactly to qualifying conversations;
- every never-autonomous topic is refused at L0–L3 in English, Sinhala, and
  Tamil where applicable;
- `npm run lint`, `npm run typecheck`, and `npm run test` pass;
- the current WhatsApp baseline remains unchanged when optional Inbox surfaces
  are off;
- architecture, implementation plan, checklist, usage guide, runbooks, and
  progress snapshots describe the deployed system accurately.
