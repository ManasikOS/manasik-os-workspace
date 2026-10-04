# Inbox backend scale review: 500 messages/minute, and moving to Inngest

Status: **analysis only. No code, SQL or configuration was changed.**
Superseded in part: §6 (target architecture) and §9 (migration path) are replaced by
[`scale-inngest-implementation-plan.md`](./scale-inngest-implementation-plan.md), which uses a hybrid (one Postgres
queue for per-message work, Inngest for lifecycle workflows and schedules). §3–§5 (defects and bottlenecks) still apply.
Date: 2026-09-25
Scope: everything behind `/inbox`: the Meta webhooks (WhatsApp, Messenger, Instagram), inbound ingest, the three
job systems (`agent_jobs`, `channel_jobs`, the outbox), cron, Postgres triggers and projections, Realtime, and the
Server Actions the page calls.
Evidence: repository at `main@07c72bb`, plus read-only queries against the live Supabase project `Manasik OS`
(`klognjpwmqwlgeibvanf`, ap-southeast-1, Postgres 17).

> **Programme rule.** [`scaling.md`](./scaling.md) §2.3, §10.3 and §18 currently rule out replacing `channel_jobs`
> with another queue. The Inngest recommendation below goes against that. Under AGENTS.md, **the Architecture has to
> be amended first**: add a resolved decision (R8) to [`architecture.md`](./architecture.md) §16. No slice should be
> built before that. This report is the input for that decision.

---

## 1. Verdict

**The data model is sound. The execution model is not ready for 500 messages/minute.**

The strong parts: Postgres is the single source of truth, tenancy is RLS plus `agency_id` everywhere, inbound message
and job writes are atomic (`ingest_inbound_message_atomic`), each conversation gets a message sequence, and Realtime
uses a typed, PII-free Broadcast contract. None of this needs to be redesigned.

The weak part is how work gets executed. There are three hand-built queues, drained by `after()` callbacks tied to
webhook requests, `pg_cron → pg_net → Vercel` HTTP calls every minute, and a self-invoking shard fan-out. At the
target load it has these failure modes:

1. **Claimed AI-reply jobs get stuck for 5 minutes.** This happens by design of the loop and gets worse with load (§3.1).
2. **One burst of customer messages starts several AI turns in parallel.** The customer can get duplicate or
   out-of-order replies (§3.2).
3. **A retried AI job can send a second paid reply**, because AI sends go around the outbox (§3.3).
4. **A multi-message webhook can lose messages** after a partial failure (§3.4).
5. **The database is sized for a demo.** `max_connections = 60` is shared by PostgREST, Realtime, pg_cron and every
   concurrent drain loop (§4).

The job-execution layer should move to **Inngest**. Postgres, the atomic ingest RPC, RLS, the Realtime contract and
the SC2–SC6 client work all stay. Inngest brings per-conversation serialization, debounce, per-tenant concurrency,
throttling, memoized steps (a paid LLM call is never repeated on retry), durable retries, cancellation and a replay
UI. Today each of these is either hand-rolled or missing.

---

## 2. What the load actually is

"500 messages/minute" means more webhook traffic than 500 requests.

| Stream | Per minute | Per second | Notes |
|---|---:|---:|---|
| Inbound customer messages | 500 | 8.3 | Target |
| AI / staff outbound replies | ~500 | 8.3 | If the assistant answers most messages |
| Outbound status webhooks (sent/delivered/read) | ~1,500 | 25 | 3 per outbound on WhatsApp; Messenger/IG send `read`/`delivery` too |
| **Total Meta webhook requests** | **~2,000** | **~33** | |
| AI turns needing concurrency | — | — | 8.3/s × 5–10 s per tool-using turn ≈ **40–85 turns in flight** |

Status webhooks are 75% of the traffic. Each one currently causes a message `UPDATE`, which fires Realtime and
projection triggers (§5).

If 500/min is the **peak** rather than a 24-hour average, all design choices below still hold. Only the monthly cost
figures in §8 change.

---

## 3. Correctness defects that surface under load

These come first because 500/min turns rare edge cases into constant ones.

### 3.1 Claimed jobs stranded for 5 minutes (AI replies and staff sends): **critical**

`lib/agent/whatsapp/drain.ts` `processDueJobs`:

```ts
const jobs = await claimJobs(db, workerId, CLAIM_BATCH_SIZE);   // claims 10, marks RUNNING
for (const job of jobs) {
  if (Date.now() >= deadline) break;                           // ← leaves the rest RUNNING
  await runJob(job); …
}
```

The loop claims 10 jobs and runs them **one at a time**. With a 25 s `after()` budget and 5–10 s per AI turn, only
3–5 of them run. The rest stay `RUNNING`, locked by a worker that has already exited. `releaseStaleLocks` releases
them only after **5 minutes** (`olderThanMs = 5 * 60_000`). At 500/min this happens on almost every drain, so a large
share of customers wait 5+ minutes for the "instant" AI reply.

`lib/inbox/outbox/drain.ts` `processDueInboxOutbox` (staff sends) uses the same claim-10-then-break pattern.

`channel_jobs` (`lib/inbox/jobs/drain.ts`) does **not** have this bug. It runs the batch with `Promise.all` and
releases or fails jobs that hit the deadline.

### 3.2 No per-conversation serialization of AI turns: **critical**

A customer often sends 3 messages in 4 seconds ("Hi", "Umrah package", "4 people"). Each one inserts its own
`PROCESS_INBOUND` row in `agent_jobs`. Each webhook starts its own `after(() => processDueJobs(...))`, so the three
jobs are claimed by three concurrent workers (`FOR UPDATE SKIP LOCKED` guarantees they are *different* workers). The
result is three model calls on overlapping context, three replies, possible reordering, and three times the cost.

`channel_jobs` enrichment already solves this with `coalesce_key` plus a settle delay (`lib/inbox/jobs/settle.ts`).
The customer-facing reply path does not.

### 3.3 AI reply send is not idempotent: **high**

`deliverAgentReply` (`lib/agent/whatsapp/reply-delivery.ts:104`) calls `adapter.sendReply()` directly. It does not
go through the transactional outbox that staff sends use. If the process dies or times out after Meta accepts the
message but before `completeJob`, the stale-lock release requeues the job. The retry then runs **a second paid LLM
turn and sends a second reply**. No idempotency key links "this inbound message" to "this reply".

### 3.4 Webhook dedupe key can drop messages: **high**

`whatsAppWebhookExternalEventId` uses only the **first** message id in the payload as the event key. Meta can batch
several messages into one delivery.

1. Message 1 is stored. Message 2's ingest throws, so the handler returns 500.
2. Meta retries. `recordWebhookEvent` hits `23505`, looks up the first message id, finds it, and returns `isNew = false`.
3. The handler answers `200 duplicate`. **Message 2 is never stored.**

Status payloads have the same problem: dedupe uses only the first status in the batch.

### 3.5 Conversation upsert is check-then-act: **medium**

`upsertConversationForInbound` does a `select`, then an `insert`. When a new customer's first two messages arrive in
parallel, both selects miss. One insert then fails on `conversations_external_id_unique`, so that webhook returns 500
and Meta retries after a delay. No data is lost, but first contact is slower and errors are noisy. Lead linking with
`createIfMissing: true` runs in the same window and is exposed to the same race (duplicate lead creation), unless its
own unique constraints catch it.

### 3.6 Slow external calls on the acknowledgement path: **medium**

Before returning 200, the WhatsApp handler:

- makes about **12–16 sequential PostgREST round trips per message**: event record, integration, `markWebhookVerified`,
  `ai_settings`, attribution, conversation select and update, lead linking, the atomic RPC, media rows and billing;
- calls **the Meta Graph API** (`sendWhatsAppUnsupportedNotice`) for videos and stickers.

Each step is fast on its own. In series, and under database pressure, this pushes acknowledgement p95 toward
Meta's timeout. Meta retries aggressively when it times out, which adds more load.

### 3.7 Unbounded audit and job tables: **medium**

Nothing purges `whatsapp_webhook_events` (full JSON payload for **every** delivery, statuses included),
`channel_jobs` `DONE` rows or `agent_jobs` `DONE` rows. The only deletes are in agency-reset functions. At ~2,000
webhooks/minute that is roughly 2.9 M payload rows per day. The claim queries' partial scans and window functions
slow down as these tables grow.

### 3.8 Migration history has drifted from the live database: **medium (operational)**

**Corrected 2026-09-25:** this section first claimed these migrations were unrecorded. They are recorded. A name-by-name
comparison of all 181 files against `schema_migrations` found exactly seven whose recorded *version* differs from the
file name (SC1, SC2 ×2, SC3, SC5, `detach_source_messages_on_conversation_delete`, `inbox_saved_views`): the tool stamped
`20260925041420` … `20260925042011` when they were applied, while the files are `20261202094000` … `20261203090000`.
(An earlier `max(version)` check hid this, because those timestamps sort before `20261202093900`.) The consequence is
real: the CLI compares versions, so `db push` would see the local files as unapplied and the remote versions as unknown.
The fix is to rename the seven history rows to the file versions, as was done for the earlier migrations. `checklist.md`
also said "nothing merged or deployed" for the scaling track; that has been corrected.

---

## 4. Capacity bottlenecks

### 4.1 Database connections

- `max_connections = 60` (live). This is the smallest Supabase compute tier.
- PostgREST, Realtime's authorization checks, pg_cron/pg_net, Supabase Auth and Storage all share that 60.
- Every `after()` drain (three per inbound webhook: agent 25 s, REALTIME 10 s, BULK 20 s), every staff send's outbox
  drain, the per-minute cron drains and up to 8 self-invoked shards all send claim, complete and fail RPCs through
  PostgREST.
- `claim_channel_jobs` takes a **global per-lane advisory lock** (`pg_advisory_xact_lock(hashtext('channel_jobs.claim.'||lane))`).
  With dozens of concurrent drains, each one waits for that lock while **holding a PostgREST pool connection**. This
  is how a queue backlog becomes "the whole app is slow", Inbox reads included.

The SC7 staging run (`docs/progress/2026-09-24-…`) measured a drain ceiling of about 49–57 jobs/s, but with jobs that
skipped the model entirely. It already failed the Burst profile (p95 20 s). Model-backed jobs will be far slower.

### 4.2 Per-message trigger work

One inbound message currently fires, synchronously inside the ingest transaction:

| Table | Triggers fired |
|---|---|
| `conversations` (UPDATE from the upsert) | `advance_version`, `inbox_realtime_update`, `refresh_queues` (runs `compute_conversation_queues` **twice** under a per-conversation advisory lock), `set_updated_at` |
| `conversation_messages` (INSERT) | `assign_sequence` (counter upsert), `inbox_realtime`, `refresh_human_agent_window`, `refresh_queues` (**again**) |
| `channel_jobs` / `agent_jobs` (INSERT) | `set_updated_at` |

Each status webhook adds a `conversation_messages` UPDATE, which fires `inbox_realtime_update`.

The queue projection runs twice per inbound message, and all of this sits inside the webhook's latency budget. It is
correct, but it is the most expensive part of ingest.

### 4.3 Realtime fan-out

`20261202094300_sc5_scoped_inbox_broadcasts.sql` was believed to be unapplied when this review was written, and the checklist said so. **It is applied**: a live check on 2026-09-25 found its list and presence broadcast functions and triggers. Whether the SC4 client is the deployed build is unconfirmed, and delivered events per inbound have not been measured. The paragraph below describes the pre-SC5 behaviour and may no longer hold. Every inbound message therefore still produced
agency-wide and conversation-topic broadcasts from several tables, and each delivery status is broadcast too. Supabase
counts one broadcast to N subscribers as N events. With 10 staff per agency on the Inbox, 500 inbound plus 1,500
statuses per minute adds up to tens of thousands of delivered events per minute. The client side of the fix (SC4) is
already built; the database side (SC5) is applied (see above).

### 4.4 Fairness

`channel_jobs` has per-agency fair share and in-flight caps. **`agent_jobs`, the customer-facing reply queue, has
neither**: `claim_agent_jobs` is plain `ORDER BY run_after`. One agency running a broadcast campaign that triggers
2,000 replies delays every other tenant's AI replies.

### 4.5 Scheduling topology

- Crons go through `pg_cron → invoke_cron_route → pg_net → Vercel`. That adds latency and a failure hop, and the
  database spends connections and workers issuing HTTP calls.
- `after()` keeps a function instance alive for up to 55 s per webhook just to poll queues. Most of those invocations
  find nothing to do.
- `agent-jobs/route.ts` compares the bearer token with `!==` rather than the constant-time `hasValidBearerSecret` that
  `inbox-lanes` uses. This is minor but inconsistent.

---

## 5. What is already right and must be kept

| Keep | Why |
|---|---|
| `ingest_inbound_message_atomic` and its `(agency_id, external_message_id)` unique guard | This is the final idempotency guard, whatever queue sits in front of it |
| `conversation_message_counters` and `sequence_number` | They order messages and make thread deltas work |
| Queue membership projection and exact counters | Correct. Change them to run once per message, not twice |
| Transactional outbox for staff sends plus `client_idempotency_key` | The right model; AI replies should use it too |
| Typed PII-free Broadcast contract, list and conversation topics, SC4 merge/single-flight client | The correct Realtime design. Finish SC5 |
| RLS, `requireUser()`, Zod at the boundary, service-role-only `SECURITY DEFINER` RPCs with pinned `search_path` | Non-negotiable, and implemented consistently |
| Tenant resolved from the verified connection, never from the payload | Correct. Keep it in the webhook |

---

## 6. Target architecture with Inngest

### 6.1 Principle

> **Postgres owns state. Inngest owns execution.**
> The webhook proves authenticity and hands off one durable event. Everything after that is an Inngest function
> whose steps call the existing repository and RPC code. No queue tables are claimed by hand, no work runs inside
> `after()`, and no HTTP crons go through pg_net.

```text
Meta ──► /api/webhooks/{whatsapp|messenger|instagram}
          1. bounded body + HMAC signature           (unchanged)
          2. resolve tenant from phone_number_id / page id   (1 cached read)
          3. INSERT channel_webhook_events (raw, per-ITEM idempotency key)   (1 write)
          4. inngest.send([...one event per message/status, id = provider id])
          5. 200 OK                                   ← target p95 < 150 ms
                        │
                        ▼
                 Inngest (durable)
 ┌───────────────────────────┬────────────────────────────┬──────────────────────────┐
 inbox/message.received      channel/status.received      inbox/staff.send.requested
 fn ingestInboundMessage     fn applyDeliveryStatuses     fn deliverOutboxMessage
  concurrency: conversation=1  batchEvents 100 / 1 s        idempotency: client key
               agency=N        one bulk RPC per batch       throttle: per connection
  steps: upsert conv → link
   lead → atomic RPC → media
  emits inbox/message.stored
          │
          ├──► fn replyWithAssistant  debounce(conversationId, 4 s, maxWait 15 s)
          │     concurrency: conversation=1, agency=plan cap, global=LLM cap
          │     cancelOn: inbox/conversation.human-took-over (same conversationId)
          │     steps: guard state → build context → step.run(LLM turn, memoized)
          │            → step.run(write outbox row, key reply:<messageId>) → step.run(send)
          │     onFailure: hand off to staff (HUMAN_REQUESTED) + note
          │
          ├──► fn enrichConversation  debounce(conversationId, 4 s) → S0 gate → S1…
          └──► fn processInboundMedia concurrency agency=2, retries 5, timeout-aware

 Scheduled (Inngest cron): SLA sweep, retention, usage rollup, lead follow-ups,
 seat holds, billing sync, health, reconciler (re-emit raw events never processed)
```

### 6.2 How each defect maps to an Inngest feature

| Problem | Inngest mechanism |
|---|---|
| §3.1 stranded jobs, 5-minute stale locks | No claiming. Each event is its own run and Inngest owns retry and timeout |
| §3.2 parallel AI turns per burst | `debounce: { key: "event.data.conversationId", period: "4s", timeout: "15s" }` plus `concurrency: [{ key: "event.data.conversationId", limit: 1 }]` |
| §3.3 duplicate paid reply on retry | `step.run("generate-reply")` is memoized: a retry after a later step fails **does not re-call the model**. Outbox row keyed `reply:<inboundMessageId>` makes the send idempotent |
| §3.4 batched webhook loses messages | Webhook fans out **one event per message** with `id: "wa:msg:<wamid>"`. Inngest dedupes by event id, and each message succeeds or retries on its own |
| §3.5 conversation insert race | `concurrency: conversation=1` on ingest serializes one customer's messages; the unique constraint stays as the backstop |
| §3.6 slow ack | Webhook does 2 DB calls plus 1 send. The rest moves into steps |
| §4.1 connection pressure from polling | No idle polling and no advisory-lock queue. Concurrency limits cap how many functions touch the database at once |
| §4.4 no fairness on replies | `concurrency: [{ key: "event.data.agencyId", limit: planCap }]` per tenant, plus a global limit sized to the LLM rate limit |
| Staff takes over mid-turn | `cancelOn` the `human-took-over` event for the same conversation |
| Meta rate limits per number/page | `throttle: { key: "event.data.connectionId", limit, period }` on send functions |
| Status storm (75% of traffic) | `batchEvents: { maxSize: 100, timeout: "1s" }`, then one bulk `UPDATE … FROM unnest()` RPC |
| pg_cron → pg_net → Vercel | Inngest `cron` triggers, with run history and alerting |
| Dead letters and replay | `onFailure` handler (hand off, audit) plus bulk replay from the dashboard |

### 6.3 What the webhook must still guarantee

The scaling rule "never acknowledge before a durable idempotency record" stays. Inngest's event API is durable once
it accepts the event, but the recommended design **also** keeps the single raw-event insert in Postgres:

1. `INSERT` the raw event with a **per-item** key (each message id, and each status id + status + timestamp),
   `ON CONFLICT DO NOTHING`.
2. `inngest.send(...)` with the same ids.
3. If step 2 fails, return 5xx so Meta retries. The Inngest event id dedupes the retry.
4. A scheduled **reconciler** re-sends raw events that have no processed marker after N minutes. Inngest's own dedupe
   window makes this safe. This covers an Inngest outage and is what makes "zero lost messages" provable.

`processed_at` on the raw row is set by the ingest function's last step. The reconciler reads a partial index
`WHERE processed_at IS NULL`.

### 6.4 Visibility latency

The message now shows in the Inbox after the ingest function runs rather than within the webhook. Inngest dispatch on
Vercel is typically sub-second, which stays well inside the 2 s "inbound visible" SLO. It **must be measured in the
harness**, not assumed. If it misses, the fallback is to run only the atomic RPC in the webhook (one call) and keep
lead linking, media and billing in Inngest.

### 6.5 Retire, keep, change

| Retire (after cutover) | Keep | Change |
|---|---|---|
| `agent_jobs` + `claim_agent_jobs` + `processDueJobs` | `ingest_inbound_message_atomic` (drop its job inserts; return ids only) | AI replies go through the outbox with a deterministic key |
| `channel_jobs` claim/fail/release RPCs, advisory lock, shard fan-out route | `channel_jobs` table **read-only** for history, then archive | Queue projection: compute once per message (merge the two trigger paths) |
| All `after(() => drain…)` calls | Realtime Broadcast contract, SC4 client | Apply SC5 |
| `invoke_cron_route` + pg_cron HTTP schedules | pg_cron only for pure-SQL housekeeping, if any | Dedupe key per item (§3.4) |
| `whatsapp_webhook_hits` (keyed route no longer exists) | Unique constraints as the final idempotency guard | Retention for raw events (e.g. 14 days), job history |

### 6.6 Function contract (sketch, for the architecture amendment; not implementation)

```ts
// Event names are the contract. Payloads carry ids only (no message text, no PII).
type InboxEvents = {
  "inbox/message.received":  { data: { agencyId: string; provider: ChannelProvider; connectionId: string;
                                        rawEventId: string; externalMessageId: string } };
  "inbox/message.stored":    { data: { agencyId: string; conversationId: string; messageId: string;
                                        sequenceNumber: number; agentAllowed: boolean; firstContact: boolean } };
  "channel/status.received": { data: { agencyId: string; externalMessageId: string;
                                        status: "SENT" | "DELIVERED" | "READ" | "FAILED"; at: string } };
  "inbox/staff.send.requested":        { data: { agencyId: string; outboxId: string; idempotencyKey: string } };
  "inbox/conversation.human-took-over": { data: { agencyId: string; conversationId: string } };
};
```

- The agency id in every event comes from the webhook's verified tenant resolution or a `requireUser()` session,
  never from provider or browser input. Every step re-scopes its reads by `agencyId`.
- Event ids are derived from the **intent** (provider message id, outbox id), never `randomUUID()`.
- The Inngest signing key verifies calls into `/api/inngest`. Add the route to the proxy's machine routes, like
  `/api/webhooks/*`.

---

## 7. Other changes needed regardless of Inngest

1. **Database compute.** Move off the 60-connection tier before load testing. Size it from the harness; expect a
   mid-size compute at this rate. Put any direct Postgres client on the Supavisor transaction pooler.
2. **SC5** is already applied. Confirm the SC4 client is the deployed build, run `scripts/sql/verify-sc5-scoped-broadcasts.sql`, and measure delivered events per inbound.
3. **Merge the double queue refresh.** One recompute per inbound message, ideally in the ingest function after the
   RPC, or with a trigger `WHEN` that skips the conversation-update path when the message trigger already covers it.
4. **Retention jobs** for raw webhook events, finished job history and AI run telemetry.
5. **Reconcile migration history** with the live database (§3.8), and correct the checklist's scaling-track status.
6. **LLM capacity.** 40–85 concurrent tool-using turns needs a matching provider rate-limit tier. Set Inngest's global
   concurrency for `replyWithAssistant` just under it, so bursts queue instead of failing with HTTP 429.
7. **Cache tenant resolution.** Cache the `phone_number_id`/page id → connection lookup and `ai_settings` per
   invocation or briefly in memory. They are read on every webhook.

---

## 8. Cost and operational notes on Inngest

- Inngest bills by function runs and steps. As a rough count: ingest about 4 steps, reply about 4 steps (debounce
  folds bursts together), enrichment about 2, and statuses batched 100:1. That is about **8–10 steps per inbound
  message**. At a sustained 500/min this is about 6–7 M steps per day, which is enterprise-plan scale. If 500/min is
  the peak and the daily average is much lower, the bill scales down proportionally. **Check current Inngest pricing
  against the real daily volume before committing.** Keeping ingest as few coarse steps is the main cost lever.
- Each step is a separate HTTP invocation of `/api/inngest` on Vercel. Function-invocation counts go up, but
  wall-clock time spent idle in `after()` polling goes away.
- Region: run the Inngest app's Vercel functions in `sin1`, next to Supabase ap-southeast-1, as today.
- New dependency: an Inngest outage delays processing but does not lose data, because of the raw-event table and the
  reconciler (§6.3). The runbook needs an "Inngest degraded" section.
- Local development: Inngest Dev Server alongside `npm run dev`. Unit tests keep calling the step bodies directly.
  Inngest's test engine covers debounce and concurrency behaviour.

---

## 9. Migration path (strangler, one slice per PR)

Order by risk. The customer-facing reply path is first because it has the worst defects.

| # | Slice | Exit criterion |
|---|---|---|
| I0 | Architecture amendment R8 (Postgres state / Inngest execution); update scaling.md §2.3, §10, §18; reconcile migration history | Decision recorded; checklist accurate |
| I1 | Inngest client, `/api/inngest` route with signing key, proxy exemption, Dev Server, event contract types + Zod | Hello-world function runs on staging |
| I2 | Stopgap hardening on the current path: fix §3.1 (release unprocessed claims), §3.4 (per-item dedupe key), and add AI reply outbox key (§3.3) | Harness shows no 5-min stragglers and no duplicate replies |
| I3 | `replyWithAssistant` on Inngest behind a per-agency flag; ingest emits `inbox/message.stored` instead of inserting `agent_jobs` for flagged agencies | Burst of 3 messages → 1 reply; staff takeover cancels in-flight turn; retry never re-bills the model |
| I4 | `enrichConversation` + `processInboundMedia` replace the ENRICH/BULK lanes | REALTIME triage p95 < 5 s under Burst profile |
| I5 | Webhook thin path + `ingestInboundMessage` function + reconciler | Ack p95 < 200 ms at 2,000 webhooks/min; zero lost messages in fault injection |
| I6 | `applyDeliveryStatuses` with batching | Status write count reduced about 100×; ticks still update the open thread |
| I7 | Staff send (`deliverOutboxMessage`) with throttle per connection | No duplicate sends under network retry |
| I8 | Crons to Inngest schedules; remove pg_net HTTP crons | All schedules visible with run history |
| I9 | Remove `after()` drains, `agent_jobs` claim path, lane fan-out; archive tables | 7 stable days on 100% of agencies |
| I10 | Full scale proof (existing SC8 profiles, now through signed webhooks) | 500/min sustained for 60 min, 5× burst for 5 min, noisy-tenant spread ≤ 20% |

Slice I2 matters on its own. It is small, it fixes the three worst customer-visible defects on the current path, and
it protects production while the Inngest slices ship.

---

## 10. Items to verify before building

- Real model-backed turn latency at p50 and p95 per channel. It sets the concurrency caps and the LLM tier.
- Real share of inbound messages that trigger an AI reply. It sets outbound and status volume.
- Inngest debounce plus concurrency semantics on the plan tier being bought, specifically the maximum debounce period
  and the number of concurrency keys per function.
- Whether Meta batches multiple messages per WhatsApp delivery at this volume. §3.4 should be fixed either way.
- Supabase Realtime quota on the chosen plan, measured with SC5 applied.
