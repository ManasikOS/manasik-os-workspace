# Manasik Inbox — Multi-tenant Scaling Implementation Plan

Status: **proposed implementation plan; no production change has been made**

Owner: Inbox + Copilot programme

Last updated: 2026-09-24

This plan extends [`architecture.md`](./architecture.md), especially §7
(concurrency, fairness and latency), §9 (multi-tenancy) and §12
(observability). It does not replace the 33-slice programme in
[`implementation-plan.md`](./implementation-plan.md). The work below is a
focused scaling track that closes the gap between the current invalidation
prototype and a production Inbox handling sustained multi-tenant traffic.

The plan follows the programme rule: **one slice, one PR, nothing adjacent**.
Every completed slice must update [`checklist.md`](./checklist.md) in the same
PR. Point-in-time benchmark evidence belongs in `docs/progress/`; operational
procedures belong in `docs/runbooks/`.

---

## 1. Decision summary

Keep the current core stack:

- Next.js on Vercel for the product UI, authenticated Server Actions, Meta
  webhooks and bounded worker invocations.
- Supabase Postgres as the source of truth, with agency-scoped RLS.
- Supabase Realtime **Broadcast** as an ID-only invalidation and synchronization
  signal. Do not move to Postgres Changes.
- Supabase Storage for private message media.
- Meta channel adapters and the existing transactional outbox as the only
  provider-send path.
- The existing `channel_jobs` table and fair-share claim RPC for
  `REALTIME`, `STANDARD` and `BULK` work.

Do not add Redis, Kafka, Elasticsearch, a second database, per-tenant databases,
TanStack Query, or a replacement queue for this work. Add a continuously
running worker service only if the measured Vercel worker topology fails the
capacity gate in §12.

The first scaling constraint is **read and Realtime amplification**, not the
raw inbound rate. At 1,000 messages per minute the input is approximately
16.7 messages per second. The current browser subscribes to one agency-wide
topic and turns every invalidation into as many as four Server Action reads.
The database also emits invalidations from several tables for one logical
message. With ten connected staff, four broadcasts per inbound message would
produce about 667 delivered Realtime events per second before presence,
delivery receipts or reconnects are counted.

This track changes that behavior to:

1. persist and enqueue required work durably;
2. broadcast a small typed event to only the list or open conversation that
   needs it;
3. fetch only the changed row, message delta or projection;
4. reconcile after reconnect from Postgres;
5. scale workers by queue age and depth without allowing one agency to starve
   another.

---

## 2. Assumptions and fixed boundaries

### 2.1 Assumptions

- Target sustained traffic is **1,000 inbound messages per minute**, with a
  five-times burst for up to five minutes.
- The production test shape is at least 50 agencies, including one deliberately
  noisy tenant, and at least 500 concurrent browser connections.
- Staff may have the same agency Inbox open concurrently in several browser
  sessions.
- Supabase, Vercel and any future worker runtime are deployed in or nearest to
  Singapore. `vercel.json` already pins `sin1`.
- Realtime delivery is best effort. Postgres remains authoritative, and the UI
  must recover from a missed, duplicated or out-of-order event.
- Provider delivery and worker execution are at-least-once. Idempotency—not an
  “exactly once” claim—prevents duplicate observable effects.
- The current Inbox SLOs in Architecture §12 remain authoritative unless that
  architecture is changed first.

### 2.2 Always do

- Resolve the tenant from the verified channel connection at the webhook
  boundary; never trust `agency_id` from Meta or a browser payload.
- Keep Realtime payloads free of message text, customer names, phone numbers,
  prices, document values and other PII.
- Apply agency scoping in both repository queries and RLS.
- Keep AI and external provider calls outside database transactions and outside
  the webhook response path.
- Make every consumer idempotent and safe to retry after a timeout.
- Preserve human messaging when AI, workers or model providers are degraded.
- Measure before and after every performance change under the same load shape.

### 2.3 Change only after an architecture decision

- Replacing `channel_jobs` with Supabase Queues, Vercel Queues, SQS or Kafka.
- Moving provider sends outside the existing transactional outbox.
- Introducing Redis as authoritative state.
- Creating a database or Supabase project per agency.
- Adding an external long-running worker before the §12 capacity gate is run.

### 2.4 Never do

- Expose the Supabase secret/service-role key to a browser.
- Put message bodies or customer data in Realtime events.
- Depend on Realtime receipt for correctness.
- Cache tenant data under a key that omits agency and viewer scope.
- Acknowledge a provider event before it has a durable idempotency record.
- Let one agency bypass fair-share or per-agency concurrency caps.
- add an index without an `EXPLAIN (ANALYZE, BUFFERS)` before/after record.

---

## 3. Capability map and build order

| Capability id | Responsibility | Depends on |
|---|---|---|
| `scale-baseline` | Establish the current amplification, latency and resource baseline | — |
| `inbound-atomicity` | Make canonical message persistence and required job creation one durable outcome | `scale-baseline` |
| `realtime-contract` | Define typed PII-free event scopes, topics and database emission rules | `scale-baseline` |
| `scoped-reads` | Read one list row, count set, thread delta or projection instead of reloading the workspace | `realtime-contract` |
| `incremental-client` | Subscribe by scope, coalesce events and patch existing UI state | `scoped-reads` |
| `send-reconciliation` | Reconcile optimistic staff messages by idempotency key and delivery updates | `incremental-client` |
| `worker-capacity` | Prove or extend the existing fair-share worker topology | `inbound-atomicity` |
| `scale-proof` | Exercise the end-to-end system under sustained, burst and reconnect load | all earlier capabilities |
| `production-rollout` | Controlled agency rollout, alerting, rollback and operational ownership | `scale-proof` |

Build order:

```text
scale-baseline
   ├── inbound-atomicity ─────────────────┐
   └── realtime-contract → scoped-reads   │
                           → incremental-client
                           → send-reconciliation
inbound-atomicity → worker-capacity       │
all above ────────────────────────────────┴→ scale-proof → production-rollout
```

`inbound-atomicity` and `realtime-contract` may be built in parallel after the
baseline is recorded. All database-trigger changes must land before the final
client cutover is enabled.

---

## 4. Current-state evidence

### 4.1 What is already correct and must be reused

- Canonical provider-neutral conversations and messages.
- Unique provider message identifiers and staff
  `client_idempotency_key` support.
- Message `sequence_number` and the index on conversation order.
- A `conversations.version` column, currently unused as a synchronization
  contract.
- Cursor pagination for the conversation list.
- Exact queue counter rows and queue membership projections.
- Private agency-scoped Broadcast authorization.
- Conversation-specific topics already emitted by the database.
- Optimistic staff messages shown as `Sending…`.
- Durable provider outbox and delivery-status persistence.
- Fair-share `channel_jobs`, coalescing, retry, dead-lettering and stale-lock
  recovery.
- Opportunistic `after()` drain, scheduled drain and up to eight Vercel shards.
- A 50-agency × 200-conversation load harness and an Inbox operations runbook.

### 4.2 Bottlenecks and reliability gaps to close

1. `InboxRealtime` subscribes only to `inbox:<agency_id>` and ignores the
   existing conversation-specific topic.
2. Every event calls `refreshInboxDialog()`, which reloads the list, open
   conversation, customer context and intelligence in parallel.
3. Database triggers emit both agency and conversation broadcasts for changes
   that affect only one open conversation.
4. Message, conversation, note and intelligence writes can produce several
   events for one customer turn.
5. The list loader refetches up to 100 conversations and related preview rows
   when only one list row changed.
6. The thread loader rereads the newest 200 messages and their attachment/media
   context when only one message or delivery status changed.
7. Optimistic reconciliation compares message text and timestamps even though
   a database idempotency field already exists.
8. Inbound message insertion and required job creation are separate calls. A
   message can commit while a required job fails to enqueue; a provider retry
   can then stop at the message idempotency guard.
9. `conversations.version` exists but is not consistently advanced or used.
10. The current load harness measures queued enrichment jobs, not webhook
    ingestion, browser fan-out, Server Action amplification, reconnect recovery
    or delivery receipts.
11. MI6.5 has not been executed against a staging environment, so no production
    sizing claim has been proven.

---

## 5. Target runtime architecture

```text
Meta webhook
    │ verify signature, validate payload, resolve channel connection
    ▼
Vercel channel edge
    │ durable provider-event idempotency record
    │ canonical conversation update
    │ atomic message + required-job persistence
    └─────────────────────────────── respond 2xx
                    │
                    ▼
        Postgres fair-share work lanes
        REALTIME │ STANDARD │ BULK
                    │
           bounded idempotent workers
                    │
                    ▼
      projections + provider outbox + audits
                    │
             committed DB changes
                    ▼
       private PII-free Broadcast events
        ┌──────────────┴───────────────┐
        ▼                              ▼
inbox:<agency>: list state    inbox:<agency>:conversation:<id>
        │                              │
 one-row/count patch             sequence/projection delta
        └──────────────┬───────────────┘
                       ▼
               current browser state
              optimistic, no skeleton
```

The existing topic `inbox:<agency_id>` remains the list topic so deployment
does not require a compatibility channel. The existing
`inbox:<agency_id>:conversation:<conversation_id>` topic becomes the only topic
for thread, delivery, note, presence, media and intelligence changes.

---

## 6. Realtime contract

### 6.1 Event envelope

Create a discriminated union in `lib/inbox/realtime/contracts.ts` and a matching
SQL payload shape:

```ts
type InboxRealtimeEvent =
  | {
      schemaVersion: 1;
      scope: "LIST";
      conversationId: string;
      conversationVersion: number;
      reason: "CONVERSATION" | "QUEUE" | "INTERVENTION";
    }
  | {
      schemaVersion: 1;
      scope: "THREAD";
      conversationId: string;
      entity: "MESSAGE" | "NOTE" | "ATTACHMENT" | "MEDIA_ANALYSIS";
      entityId: string;
      operation: "INSERT" | "UPDATE" | "DELETE";
      sequenceNumber?: number;
    }
  | {
      schemaVersion: 1;
      scope: "CONTEXT" | "INTELLIGENCE" | "PRESENCE";
      conversationId: string;
      revision: number | string;
    };
```

Exact names may change during SC1, but the following constraints do not:

- `schemaVersion` is mandatory.
- `conversationId` is mandatory.
- No payload contains display text or other PII.
- Unknown versions or variants trigger one bounded reconciliation; they are not
  applied speculatively.
- A duplicate event is harmless.
- An older conversation version or message sequence cannot overwrite newer
  client state.

### 6.2 Topic routing

| Source change | Agency/list topic | Conversation topic | Browser read |
|---|---:|---:|---|
| Conversation activity/state/assignment/priority/lifecycle | Yes | When open-conversation header or composer state changed | One list-row patch; optionally one context patch |
| New message | No, provided the conversation summary update already emitted | Yes | Messages after last sequence |
| Message delivery status | No | Yes | Message by id |
| Note | No | Yes | Notes delta |
| Attachment/media analysis | No | Yes | Artifacts for affected message/id |
| Intelligence projection | Only when queue/list presentation changes | Yes | Intelligence only |
| Queue membership/counter | Yes | No | One row plus exact count set |
| Composer lease/presence | No | Yes | Presence only |
| Lead/booking context used by open rail | No | Yes | Lead context only |

Database trigger `WHEN` clauses must exclude timestamp-only updates that do not
change the visible Inbox. The migration must not create or alter objects in the
managed `realtime` schema other than the supported RLS policy on
`realtime.messages`; Supabase locked that schema down in 2026.

### 6.3 Conversation version

Use the existing positive integer `conversations.version` for list/header
ordering:

- increment it only for visible conversation mutations;
- return it in list rows and LIST events;
- ignore a list patch older than the version already held by the browser;
- do not use it as a substitute for message `sequence_number`;
- handle integer exhaustion by migrating to `bigint` before it becomes a
  practical risk; do not add that migration now.

### 6.4 Reconnect contract

Realtime is not a durable browser log. On WebSocket re-subscription, browser
resume or online recovery:

1. reload the active view's first list page and exact queue counts once;
2. reload the selected conversation from its last known message sequence;
3. reload selected conversation context and intelligence once;
4. preserve current UI while reconciliation runs;
5. coalesce simultaneous reconnect signals into one flight.

No periodic full-workspace polling is added unless field telemetry proves
reconnect recovery is insufficient.

---

## 7. Scoped read contracts

Add narrow repository functions and matching authenticated Server Actions.
Every action starts with `requireUser()`, validates with Zod, resolves the active
agency server-side and reads through RLS.

### 7.1 List patch

`loadInboxConversationListPatchAction({ conversationId, view })` returns:

- the current `InboxConversation` summary or `null` if it is no longer visible;
- whether the conversation belongs in the active view;
- its current sort cursor;
- `conversationVersion`;
- the exact queue-count set only when the event reason can change counts.

The repository reads one conversation, its latest preview/support-case state and
the minimum membership data needed for the active view. It must not execute the
100-row list loader.

### 7.2 Thread delta

`loadInboxThreadDeltaAction({ conversationId, afterSequence, messageIds })`
returns:

- messages with `sequence_number > afterSequence`, ordered ascending;
- requested existing message rows for delivery-status updates;
- attachment/media rows only for returned or requested messages;
- the highest returned sequence.

Initial load remains newest-first with a bounded page. Older history continues
to use keyset pagination. No delta query returns the entire 200-message page.

### 7.3 Notes, context, intelligence and presence

- Notes use `(created_at, id)` keyset deltas, plus explicit id reload for updates
  and deletes.
- Lead/booking context keeps the existing loader and is called only for a
  `CONTEXT` event.
- Intelligence keeps the existing fourth loader and is called only for an
  `INTELLIGENCE` event.
- Composer presence gets a narrow presence read; it does not reload messages.
- Signed attachment URLs are created only when the changed attachment is
  currently visible, not on every thread event.

### 7.4 Query verification

For every new query:

- seed representative agency-local cardinality;
- capture `EXPLAIN (ANALYZE, BUFFERS)` before proposing an index;
- ensure equality columns (`agency_id`, `conversation_id`) precede range/sort
  columns;
- measure write overhead after adding an index;
- discard any index that does not change the plan or the measured latency.

---

## 8. Browser synchronization behavior

### 8.1 State ownership

Keep state in `HeaderInboxDialogContent`; do not add another caching library.
Extract pure merge/order logic into a specifically named reducer module so it
can be tested in the existing Node Vitest environment.

Maintain:

- current first-page list plus already loaded older pages;
- active queue/view and exact counts;
- active conversation messages keyed by message id and ordered by sequence;
- latest applied conversation version and message sequence;
- per-scope request sequence numbers so a slow response cannot replace a newer
  one;
- pending event keys for coalescing.

### 8.2 Event coalescing

Coalesce events for 100–250 ms by:

```text
agency + conversation + scope + entity
```

Rules:

- several LIST events for one conversation produce one list-patch request;
- several message INSERT events produce one `afterSequence` request;
- delivery updates for different message ids may share one request;
- CONTEXT and INTELLIGENCE remain independent so a slow rail never delays the
  transcript;
- no coalescing window may exceed the 2-second inbound-visible SLO.

### 8.3 List merge rules

- Replace an existing item only when the returned version is newer.
- Remove an item that no longer belongs to the active view.
- Insert an item that newly enters the view only if it belongs within the loaded
  window; otherwise update counts and let pagination/reconciliation load it.
- Sort by `(last_activity_at desc, id desc)` using the exact timestamp string.
- Never lose pages the user explicitly loaded.
- Do not change the selected conversation because a stale list response
  completed later.

### 8.4 Thread merge rules

- Deduplicate by database message id.
- Order canonical messages by `sequence_number`, with the existing timestamp/id
  fallback only for legacy null sequences.
- Patch delivery state in place; do not remove and reinsert the bubble.
- Preserve scroll position when older history loads.
- Smooth-scroll only when the viewer is already near the bottom or just sent the
  message; do not drag a reader away from older messages.
- Respect `prefers-reduced-motion`.

### 8.5 Optimistic send

Move `client_idempotency_key` generation to the browser send attempt and pass it
through the validated Server Action to `enqueue_inbox_text_message`.

- The optimistic message id is that idempotency key.
- The canonical message returned/fetched contains the same key.
- Reconciliation is exact; remove text/timestamp matching.
- A network retry reuses the same key.
- A new deliberate send, even with identical text, receives a new key.
- Provider delivery changes patch the same message bubble.
- A failed send remains visible with an actionable retry affordance.
- A successful send does not call `refreshInboxDialog()`; the action result and
  subsequent scoped event settle it.

The provider send still occurs only through the durable outbox and final
authorization boundary.

---

## 9. Inbound durability

The webhook must not produce a canonical message without its required work
records.

Create one service-role-only database function that performs the minimum atomic
write after the application has resolved the connection and conversation:

1. insert the canonical message using
   `(agency_id, external_message_id)` idempotency;
2. if the insert won, enqueue the required legacy agent job when applicable;
3. enqueue/coalesce the `REALTIME` Inbox enrichment job;
4. return the canonical message id, sequence number, duplicate flag and queued
   work identifiers;
5. commit all or none.

The function must:

- use `SECURITY DEFINER` only because the verified webhook/worker has no user
  session;
- pin `search_path = ''` and fully qualify every object;
- verify the supplied conversation belongs to the supplied resolved agency;
- revoke execute from `public`, `anon` and `authenticated` and grant only the
  server role used by the channel edge;
- preserve all existing unique constraints as the final race guards;
- contain no external calls, identity guessing, AI, media download or provider
  send.

Lead linking, optional media analysis and billing enrichment may remain outside
this transaction only if each has a durable reconciliation path. Add an
agency-scoped reconciliation query for a message that has no expected job, and
run it from the scheduled guarantee drain. The query must be bounded and
keyset-paginated; it is a repair path, not the normal scheduler.

Webhook response policy:

- invalid signature: reject without processing;
- valid duplicate whose canonical message exists: acknowledge;
- valid event whose raw event exists but canonical message does not: retry the
  atomic persistence path;
- database unavailable or atomic persistence failed: return a retryable status;
- optional downstream enrichment failed after the atomic write: acknowledge and
  let its durable repair/queue path retry.

---

## 10. Worker capacity and execution

### 10.1 Phase-one topology

Retain the current topology while measuring it:

- webhook `after()` drains only `REALTIME` for a short bounded budget;
- scheduled guarantee drain services all lanes;
- the REALTIME coordinator fans out by width up to the existing shard cap;
- `FOR UPDATE SKIP LOCKED`, the lane advisory lock and per-agency caps remain the
  concurrency boundary;
- every handler observes `AbortSignal` where its dependency supports it and is
  still safe if work finishes after a timeout race.

Tune batch size, shard threshold or per-agency cap only from recorded queue-age
and database measurements. Do not increase all three together.

### 10.2 Dedicated-worker capacity gate

Adopt a continuously running worker only if the staging run or production
canary shows one of these with the existing eight-shard ceiling:

- REALTIME p95 completion is at least 5 seconds in two comparable runs;
- oldest REALTIME queued job exceeds 10 seconds three times in 15 minutes;
- a 2,000-job REALTIME backlog cannot clear in 60 seconds;
- Vercel timeout/invocation failure rate exceeds 0.1% during the sustained run;
- the cron recovery interval, rather than processing time, is the dominant queue
  delay;
- self-invocation throttling prevents the required shard width.

If any condition is met:

1. update Architecture §7.4 before implementation;
2. keep `channel_jobs` as the durable queue and `processLane()` as the shared
   execution primitive;
3. package a small Node worker with separate REALTIME, STANDARD and BULK process
   commands;
4. deploy at least two instances in Singapore or `ap-southeast-1` with restart,
   health check and secret management;
5. use a direct/persistent Postgres connection when IPv6 is available, or the
   appropriate session/dedicated pooler otherwise; size the application pool
   against database capacity;
6. retain Vercel cron as the recovery path during canary;
7. prove duplicate claims, deployment overlap and worker death remain safe;
8. remove Vercel as the primary drain only after seven stable days.

Preferred first external runtime if the gate trips: a two-service AWS ECS
Fargate deployment in `ap-southeast-1`, because it provides long-running
processes, health checks, controlled concurrency and mature rollback. The plan
does not authorize provisioning it before the gate.

### 10.3 Queue replacement gate

Do not replace `channel_jobs` merely because a managed queue exists. Revisit
only if Postgres queue claim/write load is itself measured as the bottleneck or
independent consumer replay becomes a product requirement. Any replacement
must preserve priority lanes, coalescing, per-agency fair share, per-agency
in-flight caps, delayed retry, dead-letter inspection and auditability.

### 10.4 Update: the hybrid runtime (decision R8)

> **Superseded 2026-10-01 by decision R9** ([`architecture.md`](./architecture.md) §16): scheduled jobs and the reply-window reminder move from Inngest to `pg_cron` and a Postgres sweep, and `inngest_outbox` is removed. The bullets below describe the live system until the steps in `tasks/plan.md` land; the first bullet (Postgres owns state, `channel_jobs` owns per-message work) still stands. See [`supabase-native-scheduling-plan.md`](./supabase-native-scheduling-plan.md).

Recorded after §10.2 and §10.3 were written; the gates above still stand.

- Postgres owns state. `channel_jobs` and the always-on worker own per-message work, including the queued AI reply (Q1), and are unchanged
  in principle by anything below.
- Inngest owns scheduled jobs and lifecycle workflows only, and is never triggered once per message. It is not a replacement for
  `channel_jobs`; §10.3 is not tripped.
- The bridge is `inngest_outbox`, written in the same transaction as the change it announces. Events carry ids and timestamps only, step
  data is encrypted, and the forwarder uses the row id as the Inngest event id.
- Cost consequence: the free Inngest plan (50,000 executions a month) is smaller than the ten schedules at their current cadence. See
  `docs/runbooks/inngest.md` (Cost) for the options.

Full reasoning: `docs/inbox/architecture.md` §16 (R8) and `docs/inbox/scale-inngest-implementation-plan.md` §5.3.

---

## 11. Observability and capacity budgets

### 11.1 Trace identifiers

Carry these identifiers through structured logs and telemetry:

- channel provider and connection id;
- agency id;
- provider event/message id;
- conversation id and canonical message id;
- job id, lane, kind and attempt;
- AI run id when present;
- Realtime scope/reason, never payload PII;
- client reconciliation request id.

Do not log channel tokens, message bodies, customer identifiers or signed media
URLs.

### 11.2 Metrics

| Layer | Required metrics |
|---|---|
| Webhook | request count, signature rejection, duplicate rate, ack p50/p95/p99, persistence failures |
| Postgres | CPU, memory, IOPS, connection use, lock waits, slow queries, WAL growth, table/index size |
| Queue | depth, oldest age, claim p50/p95/p99, completion p50/p95/p99, retries, dead letters, per-agency in-flight, starvation |
| Realtime | connected clients, joins/sec, database broadcasts, delivered events/sec, authorization latency, disconnect/error reason |
| Server Actions | calls by action, p50/p95/p99, rows/bytes returned, error rate, calls per inbound message |
| Browser | event-to-visible latency, coalescing ratio, delta size, reconnect duration, stale-event drops, reconciliation failures, INP |
| Provider outbox | queued age, attempt count, provider latency, permanent failure and delivery-status latency |

### 11.3 SLOs and headroom

- Webhook acknowledgement: p95 below 500 ms; target below 200 ms.
- Inbound visible in the Inbox: p95 below 2 seconds.
- REALTIME triage: p95 below 5 seconds.
- Full enrichment: p95 below 30 seconds.
- On-demand draft: p95 below 6 seconds.
- List-row patch after event receipt: p95 below 500 ms.
- Selected-thread delta after event receipt: p95 below 500 ms.
- Queue-count render: p95 below 300 ms at 100,000 conversations per agency.
- Reconnect reconciliation: p95 below 3 seconds for the first page and selected
  thread on a representative connection.
- Noisy-neighbour degradation: no agency's REALTIME p95 more than 20% above the
  control cohort.
- Realtime delivered events: steady state below 60% and burst below 80% of the
  configured project ceiling.
- Database connections: steady state below 70% of the backend limit.
- Dead-letter rate: below 0.1%, with zero unreviewed safety-critical jobs.
- Cross-tenant leakage: exactly zero.

Alerts page on queue age and correctness risk, not raw traffic alone.

---

## 12. Load and failure test design

Extend `scripts/load/inbox-multitenant.ts` rather than creating unrelated load
scripts. Keep dry-run as the default and require `--execute` plus an explicit
non-production environment assertion.

### 12.1 Test profiles

| Profile | Shape | Purpose |
|---|---|---|
| Baseline | Current build, 1,000 inbound/min for 15 min | Measure amplification before changes |
| Sustained | 1,000 inbound/min for 60 min across 50+ agencies | Heat, pool, queue and WAL stability |
| Burst | 5,000 inbound/min for 5 min, then normal load | Backlog absorption and recovery |
| Noisy tenant | 50% of traffic from one agency | Fair-share proof |
| Browser fan-out | 500, then 1,000 authenticated WebSockets | Realtime quota and event amplification |
| Hot conversation | Several messages/sec in one conversation | coalescing, ordering and scroll behavior |
| Reconnect storm | All simulated clients reconnect in a bounded window | channel joins and reconciliation |
| Provider retry | duplicated and out-of-order webhook deliveries | idempotency and ordering |
| Worker death | terminate workers after claim and before completion | stale-lock recovery and duplicate safety |
| Model outage | timeout/fail all model calls | deterministic UI and human messaging continuity |
| Database pressure | representative reporting reads during message load | workload isolation and query plans |

### 12.2 Harness responsibilities

The completed harness must:

- drive verified staging webhook endpoints or an equivalent signed channel
  fixture, not only insert `channel_jobs`;
- preserve provider delivery ordering metadata and intentionally violate arrival
  order in the retry profile;
- create authenticated Realtime subscribers distributed across agencies;
- record sent broadcasts and delivered events separately;
- count every Inbox Server Action call by type;
- measure webhook-to-message-visible and event-to-client-visible latency;
- verify the selected thread contains every unique message exactly once and in
  sequence order;
- assert the client converges after dropped events and reconnect;
- assert zero foreign-agency identifiers or rows are observed;
- report database query/connection/lock metrics and queue age;
- use a unique run id and delete only tagged staging fixtures;
- write a machine-readable JSON report and a dated human summary under
  `docs/progress/`.

### 12.3 Performance-change rule

Each optimization is a separate experiment:

1. record baseline and variance;
2. change one mechanism;
3. repeat the same profile;
4. keep only improvements larger than measurement noise with all correctness
   assertions green;
5. record discarded attempts so they are not repeated.

---

## 13. Implementation slices

### SC0 — Baseline, contract and architecture amendment

- **Goal.** Freeze the load model, measurement method, event contract and
  rollout order before code changes.
- **Depends on.** Nothing.
- **Modify.** `docs/inbox/architecture.md`, `docs/inbox/checklist.md`,
  `docs/runbooks/inbox-intelligence-operations.md`,
  `scripts/load/inbox-multitenant.ts`.
- **Work.** Add Realtime amplification metrics and browser subscriber mode to
  the harness; document the scoped topic/read architecture in §7.5; add this
  scaling track to the programme checklist.
- **Tests.** Dry-run does no writes; environment guard rejects production;
  invalid profiles fail before traffic is generated.
- **Exit.** A current-build staging baseline records delivered events per
  inbound, Server Action calls per inbound, webhook p95, queue-age percentiles,
  database connections and event-to-visible latency for the Baseline profile.
- **Rollback.** Documentation/harness only.

### SC1 — Atomic inbound message and required-job persistence

- **Goal.** A canonical message cannot commit without its required processing
  jobs.
- **Depends on.** SC0.
- **Migration.** Create the service-role-only atomic persistence function and
  any bounded reconciliation index proven necessary.
- **Modify/Create.** `lib/inbox/ingest.ts`,
  `lib/data/whatsapp-repository.ts`, their existing tests, one migration-content
  test, and checklist/doc updates.
- **Tests.** Concurrent duplicate events produce one message and one logical job;
  failure before commit produces neither; a committed duplicate returns the
  canonical identifiers; foreign-agency conversation is rejected; grants and
  `search_path` are locked down; reconciliation restores a deliberately missing
  job without duplicating a healthy one.
- **Exit.** Staging fault injection at every persistence boundary produces no
  message-without-required-job and no duplicate provider-visible reply.
- **Rollback.** Application can return to the old calls while the additive
  function remains unused; do not drop it until all in-flight deployments age
  out.

### SC2 — Typed Realtime contract without client behavior change

- **Goal.** Every current invalidation carries a validated, versioned, PII-free
  reason while the browser still performs its existing safe full refresh.
- **Depends on.** SC0.
- **Migration.** Replace the generic trigger function with a fully qualified,
  locked-down event builder; retain current topics during this slice.
- **Create.** `lib/inbox/realtime/contracts.ts` and
  `lib/inbox/realtime/contracts.test.ts`.
- **Modify.** `app/inbox/components/inbox-realtime.tsx`, migration
  assertions and checklist/doc files.
- **Tests.** Parse every event variant; reject unknown or PII-bearing fields;
  verify topic agency segment; assert Realtime policies prevent a second agency
  joining; verify managed `realtime` schema objects are not modified.
- **Exit.** A signed-in staging client logs valid event variants for message,
  delivery, note, intelligence, presence and queue changes, with no PII in
  Realtime Inspector.
- **Rollback.** The client treats an unrecognized event as a bounded full
  reconciliation.

### SC3 — Scoped repositories and Server Actions

- **Goal.** Provide the narrow reads required for incremental synchronization.
- **Depends on.** SC2.
- **Modify/Create.** `lib/validations/inbox.ts`,
  `lib/data/inbox-repository.ts`, `app/inbox/dialog-actions.ts`,
  `app/inbox/types.ts`, and focused repository/action tests.
- **Work.** Add list patch, thread delta, note delta, message-by-id and presence
  reads; reuse existing lead-context and intelligence loaders.
- **Tests.** Cursor boundaries, duplicate sequence, delete/update, no-visible-row,
  active-view membership, stale version and two-agency isolation. Migration/query
  tests prove required composite indexes; staging captures query plans.
- **Exit.** At 100,000 conversations and a 10,000-message hot thread, every
  scoped read meets its §11 p95 and returns only the requested agency's data.
- **Rollback.** Existing full loaders remain the initial-load and reconciliation
  path.

### SC4 — Incremental client synchronization

- **Goal.** Realtime updates list/thread/context/intelligence state without a
  workspace refresh or skeleton.
- **Depends on.** SC3.
- **Create.** A specifically named pure merge module under
  `lib/inbox/realtime/` with Vitest coverage.
- **Modify.** `components/header-inbox-dialog.tsx`,
  `app/inbox/components/inbox-realtime.tsx`,
  `app/inbox/components/inbox-workspace-content.tsx`, and the minimum
  affected types/tests.
- **Work.** Subscribe to agency list plus selected conversation topics; coalesce
  by scope; call scoped actions; merge by version/sequence; reconcile once on
  reconnect/visibility recovery.
- **Tests.** Pure state tests cover duplicate/out-of-order events, a list item
  moving views, preserving loaded pages, a slow old response, message ordering,
  delivery patching, coalescing and reconnect convergence.
- **Browser acceptance.** Two signed-in staff sessions see inbound, outbound,
  note, intelligence, queue and presence changes without refresh; switching
  conversations removes the old subscription; missed-event recovery converges.
- **Exit.** One inbound message causes no more than one list-patch call per
  connected agency client and one thread-delta call only for clients viewing
  that conversation; no four-part refresh occurs.
- **Rollback.** One client-side switch restores bounded full reconciliation;
  remove it after canary rather than keeping a permanent feature flag.

### SC5 — Scope database broadcasts

- **Goal.** Stop sending conversation-local changes to every agency client.
- **Depends on.** SC4 deployed and verified.
- **Migration.** Route triggers according to §6.2; add meaningful-column `WHEN`
  clauses; consistently advance visible conversation versions; ensure each
  provider message produces the minimum logical event set.
- **Modify.** Realtime migration-content tests and checklist/doc files.
- **Tests.** Transaction fixtures count emitted topics/events for every source
  table; presence/delivery/intelligence do not emit agency-wide events;
  conversation/list mutations still do; cross-agency RLS remains intact.
- **Exit.** Under the same Baseline profile, delivered Realtime events per
  inbound and Server Action calls per inbound fall by at least 70%, and all
  clients converge after an intentionally dropped event.
- **Rollback.** Restore agency-wide LIST emission, not legacy four-part client
  refresh; correctness remains recoverable through reconciliation.

### SC6 — Exact optimistic-send reconciliation

- **Goal.** Sending is instant and duplicate-safe without a full Inbox refresh.
- **Depends on.** SC4.
- **Modify.** `app/inbox/components/message-composer.tsx`,
  `app/inbox/components/conversation-panel.tsx`,
  `lib/inbox/pending-messages.ts`, `app/inbox/actions.ts`, validation and
  focused tests.
- **Work.** Generate and reuse `client_idempotency_key` in the browser; return
  canonical acknowledgement; settle exact keys; apply delivery events in place;
  remove send-triggered `refreshInbox()`.
- **Tests.** Same text sent twice, network retry, response lost after commit,
  provider failure, delivery progression and out-of-order status events.
- **Exit.** A staff send appears immediately, one canonical message/outbox row is
  created under retries, and all open sessions converge without a full refresh.
- **Rollback.** Preserve the durable outbox row; a bounded conversation
  reconciliation can settle pending UI.

### SC7 — Worker capacity proof and conditional runtime

- **Goal.** Meet lane SLOs at sustained and burst load without premature
  infrastructure.
- **Depends on.** SC1 and SC5.
- **Modify.** Existing lane drain/fan-out configuration, tests, operations
  runbook and progress snapshot only where measurement supports a change.
- **Work.** Run the current topology first. Tune one parameter per experiment.
  If §10.2 trips, amend Architecture §7.4 and add the smallest dedicated worker
  package/deployment needed to run the existing `processLane()` primitive.
- **Tests.** Worker death, overlapping deployments, stale-lock recovery,
  per-agency cap, starvation, retry/dead-letter, long handler abort and provider
  timeout.
- **Exit.** Sustained and Burst profiles meet queue SLOs with at least 30%
  throughput headroom, or the dedicated worker canary does and the Vercel
  recovery path is proven.
- **Rollback.** Scale dedicated workers to zero and restore Vercel primary drain;
  jobs remain in Postgres.

### SC8 — Full scale proof and production rollout

- **Goal.** Close MI6.5 with measured evidence and roll out safely.
- **Depends on.** SC1–SC7.
- **Modify.** `scripts/load/inbox-multitenant.ts`,
  `docs/runbooks/inbox-intelligence-operations.md`, `docs/inbox/checklist.md`;
  create a dated `docs/progress/` result.
- **Tests.** Run every §12 profile; `npm run lint`, `npm run typecheck` and
  `npm run test`; Supabase security/performance advisors; signed-in two-agency
  browser acceptance; Meta test-provider acceptance.
- **Rollout.** Internal agency → 5% agencies → 25% → 50% → 100%, with at least
  one business day at each stage and automatic stop conditions in §14.
- **Exit.** Every §11 SLO passes, no noisy-neighbour or tenant-isolation failure
  occurs, Realtime/database headroom is documented, runbook ownership exists,
  and MI6.5/checklist counts are accurately updated.

---

## 14. Rollout and rollback

### 14.1 Deployment order

1. Deploy SC2 client parsing before reducing any broadcasts.
2. Deploy SC3 scoped reads.
3. Deploy SC4 client subscriptions and incremental merging.
4. Verify old agency-topic fallback behavior for already-open clients.
5. Apply SC5 routing migration only after the new client is the active
   production deployment.
6. Deploy SC6 exact send reconciliation.
7. Run SC7/SC8 canaries before broad agency rollout.

Do not combine the client cutover and broadcast-reduction migration into one
irreversible release.

### 14.2 Automatic rollout stop conditions

Pause progression when any condition occurs:

- cross-tenant event or row observed;
- duplicate provider-visible send;
- missing canonical message or required job;
- inbound-visible p95 at or above 2 seconds for 15 minutes;
- REALTIME oldest age above 10 seconds for three samples;
- Realtime events above 80% of configured ceiling;
- Realtime reconnect/error rate above 1%;
- database connections above 85% or sustained CPU above 80%;
- Server Action or webhook error rate above 1%;
- client reconciliation failure above 0.5%.

### 14.3 Rollback order

1. Stop the rollout, but keep accepting and persisting webhooks.
2. Restore broad LIST invalidations if clients are stale.
3. Re-enable bounded full reconciliation in the active client deployment.
4. Scale external workers down only after Vercel recovery drain is healthy.
5. Never delete queued jobs, outbox rows or canonical messages as rollback.
6. Replay only an agency-scoped, idempotent range following the runbook.

---

## 15. Security and tenancy verification

Every slice touching data access or SQL must prove:

- Realtime topic authorization derives the agency from the authenticated
  session and prevents another agency from joining.
- Every new table, view or function has the correct exposure and RLS/grant
  posture in the same migration.
- Every `SECURITY DEFINER` function pins `search_path`, fully qualifies objects,
  validates agency ownership internally and revokes default execution grants.
- Every Server Action starts with `requireUser()`, validates input and resolves
  the active agency server-side.
- Every storage URL remains short-lived and requires an authorized agency-scoped
  read before signing.
- Load-test fixtures use disposable staging agencies. A current project may be
  used only when its owner has explicitly attested that it contains no live
  data and the harness receives the exact disposable-data confirmation; any
  other production-target attempt is refused.
- Structured logs and Realtime events contain identifiers only, not message or
  document content.
- Supabase security advisors report no new warning for the changed objects.

Use at least two agencies in every repository, RPC and Realtime authorization
test. A same-agency test is not proof of tenancy.

---

## 16. Commands and evidence

Normal repository gates:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Focused tests should be run during each slice, but all four commands above are
required before its PR.

The load harness remains safe by default:

```bash
npx tsx scripts/load/inbox-multitenant.ts
```

Execution is allowed only against the isolated staging project after the script
prints and validates the resolved project reference:

```bash
npx tsx scripts/load/inbox-multitenant.ts --execute --profile sustained
```

Before applying a migration:

1. create it with `supabase migration new <descriptive-name>`;
2. iterate against local/staging SQL without polluting migration history;
3. run security and performance advisors;
4. capture relevant `EXPLAIN (ANALYZE, BUFFERS)` plans;
5. generate/review the clean migration and verify the migration list;
6. apply to staging and execute its documented rollback rehearsal.

Each performance PR records:

- test profile and data cardinality;
- before/after p50, p95 and p99;
- run-to-run variance;
- database/query plan changes;
- Realtime sent versus delivered counts;
- write-cost change;
- verdict: kept or reverted.

---

## 17. Definition of done

- [ ] SC0–SC8 are merged individually with accurate checklist updates.
- [ ] Canonical inbound message and required-job persistence is atomic or a
      formally equivalent failure-proof mechanism is demonstrated.
- [ ] The browser subscribes to one agency list topic and only the selected
      conversation topic.
- [ ] Realtime payloads are typed, versioned, private and contain no PII.
- [ ] A message, delivery, presence or intelligence event does not reload the
      entire workspace.
- [ ] List and thread updates use row/delta reads with stale-response protection.
- [ ] Optimistic staff messages reconcile by `client_idempotency_key`.
- [ ] Reconnect after dropped events converges without a page refresh.
- [ ] Exact queue counts and active-view membership remain correct under
      concurrent updates.
- [ ] Sustained 1,000 inbound messages/minute passes for 60 minutes.
- [ ] A five-times five-minute burst drains back within the documented recovery
      window.
- [ ] At least 500 concurrent browser connections pass; the measured safe ceiling
      and required Supabase plan/settings are documented.
- [ ] No agency's REALTIME p95 degrades more than 20% under another agency's
      burst.
- [ ] All Architecture §12 SLOs pass with at least 30% processing headroom.
- [ ] Database, Realtime and worker alert thresholds are active and owned.
- [ ] Zero cross-tenant leakage is observed across reads, events, jobs, storage
      and logs.
- [ ] Provider duplicate/out-of-order delivery, worker death, model outage and
      reconnect storm tests pass.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build`
      pass.
- [ ] Supabase security and performance advisors show no new warnings.
- [ ] A dated scale result and the final operations runbook are committed.
- [ ] MI6.5 is ticked only after its measured exit criterion is met.

---

## 18. Rejected alternatives for this stage

| Alternative | Decision |
|---|---|
| Postgres Changes subscriptions | Reject; Broadcast is the documented scalable/private path and the repository already uses it. |
| Supabase Queues/`pgmq` | Defer; FIFO/visibility semantics do not replace current priority, coalescing and tenant fair-share without rebuilding them. |
| Vercel Queues | Defer; it is beta, approximate-order and has no built-in dead-letter queue. It does not remove the need for tenant fairness. |
| Kafka | Reject at 16.7 sustained inbound messages/sec; operational cost is unjustified. |
| Redis for messages or locks | Reject; Postgres constraints, queue claims and Supabase Presence already own these concerns. |
| Per-tenant database/project | Reject; shared schema plus `agency_id` and RLS is the correct current isolation model. Revisit only for contractual data residency or a measured enterprise noisy-neighbour requirement. |
| Full client cache framework | Reject; current state ownership plus a small pure merge reducer is enough and avoids a second invalidation model. |
| Periodic full Inbox polling | Reject; it multiplies reads and still provides worse freshness. Use scoped Broadcast plus bounded reconnect reconciliation. |

---

## 19. External references to re-check before implementation

Supabase behavior and limits change. Re-check these official sources in every
slice that depends on them:

- [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits)
- [Supabase Realtime settings and event accounting](https://supabase.com/docs/guides/realtime/settings)
- [Supabase database-change subscriptions](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Supabase database connections and pool selection](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase connection pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits)
- [Supabase Realtime schema lockdown](https://supabase.com/changelog/realtime-schema-locked-down-against-modification)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Vercel Queues](https://vercel.com/docs/queues)

As of this plan, Supabase documents that one broadcast to 100 subscribers
counts as 100 events, which is why delivered fan-out—not merely database
broadcast rows—is the controlling capacity metric.
