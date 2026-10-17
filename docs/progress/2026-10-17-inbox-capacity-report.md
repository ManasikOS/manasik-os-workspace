# Inbox capacity report: users and messages per minute (17 Oct 2026)

Branch `UI-update`. Scope: `/inbox` and everything behind it (Meta webhooks, ingest, queues, worker, Realtime, Server Actions).

## Bottom line

| Question | Answer today | Confidence |
|---|---|---|
| Inbound customer messages per minute, **sustained, with AI replies** | **~300–500/min** | Medium. Derived from code and config, not measured end to end |
| Inbound messages per minute, **no AI reply** (staff-only) | **~600–1,000/min** | Low–medium. Queue measured, webhook and DB not |
| **Burst** | ~2,000/min for 1–2 min is survivable; **5,000/min is not** (backlog, then dead-lettered jobs) | Medium. A 5,000/min burst was measured on cheap jobs and failed |
| **Concurrent staff users** | **~100–200 browsers** comfortably (about 20–40 agencies × 5 staff). Hard limit comes from the Supabase plan's Realtime connection quota | Medium |
| The 10,000/min target in the new draft docs | **Not reachable on the current stack** (needs a larger database, partitioning, and the proposed edge design) | High |

Where this fits the business: a travel agency receiving 500 messages a minute is 30,000 an hour. Real load is likely one to two orders of magnitude below that, so capacity is **not the launch risk**. The unproven items in the 17 Oct analysis report are.

## What was and was not done

**Done:** read the webhook handler, ingest path, worker config and runtime, both drains, the Realtime client, rate-limit policy, cron migrations; read the 24 Sep load-test results and the 25 Sep scale review; ran two read-only queries (`max_connections`, buffers, row counts) on both Supabase projects.

**Not done:** no load test was run. Every figure below is either (M) measured by earlier runs, or (D) derived by me from code and config. Derived numbers are estimates, not promises. No browser, no real Meta traffic, no model-backed AI turns were measured.

## 1. How a message flows

1. Meta `POST /api/webhooks/whatsapp` (Vercel, `sin1`). Verifies HMAC signature, resolves the agency from the phone number id, never from the body.
2. `ingestWhatsAppInboundMessages` stores the message **and its jobs in one transaction** (`ingest_inbound_message_atomic`, migration SC1). Responds 200.
3. Work runs from the `channel_jobs` queue in three lanes: REALTIME (replies, triage), STANDARD, BULK. Fair-share claim, per-agency caps (REALTIME 10, STANDARD 5, BULK 2).
4. Drained by the **always-on worker** (`worker/index.ts`) when `INBOX_WORKER_ACTIVE=1`, otherwise by `after()` on the webhook plus a once-a-minute `pg_cron` call.
5. Staff sends go through a transactional outbox and drain. Delivery status ticks are buffered and applied in batches (Q4).
6. Postgres triggers emit **ID-only Realtime Broadcast** events. Browsers join one agency list topic and, for the open chat only, one conversation topic, then coalesce events into a few scoped reads.

## 2. Evidence

### Measured (24 Sep load runs, `docs/progress/2026-09-24-inbox-scaling-sc0-sc7.md`)

| Profile | Rate | p95 | Result |
|---|---|---|---|
| Sustained | 1,000 jobs/min × 5 min | 2.5 s | Pass, 0 dead-lettered |
| Noisy tenant (50% from one agency, 50 agencies) | 1,000/min × 4 min | 3.0 s | Pass; other agencies not starved (spread 4.6%) |
| Burst | 5,000/min × 2 min | 20.2 s | **Fail**: backlog to 17.5 s, 1.9% dead-lettered |
| Queue drain ceiling | | | ~49–57 jobs/s ≈ **3,000–3,400 jobs/min** |

Limits on that evidence: the jobs were near-free (the gate skipped them), so real capacity is lower; no webhook, browser or Realtime traffic was generated; the run used the old Vercel drain, before the always-on worker.

### Observed today on the databases (read-only)

| Project | `max_connections` | `shared_buffers` | Data |
|---|---|---|---|
| Manasik OS (`klognjpwmqwlgeibvanf`) | 60 | 224 MB | demo |
| ManasikOS Production (`bidmihfsljrurlnraqmf`) | 60 | 224 MB | 0 conversations, 0 messages, 0 jobs |

Both are the **smallest compute tier** (60 connections, 224 MB buffers). At that tier I would not extrapolate beyond a few hundred messages a minute, because one message writes about 15 rows across triggers and projections (estimate from `architecture-10k-edge-realtime.md`, not measured) and the 60 connections are shared by the API layer, Realtime, `pg_cron` and the worker.

## 3. Capacity by stage (derived)

| Stage | Limit | Per minute | Basis |
|---|---|---:|---|
| Webhook accept | Vercel concurrency, ingest RPC | >1,000 | Each call is short; stateless |
| Atomic ingest + triggers | DB CPU and connections (Micro tier) | **~500–1,000 messages** | ~15 row writes per message, 60 connections (D) |
| Queue drain (cheap jobs) | `claim_channel_jobs` | ~3,000 (M) | Measured |
| **AI reply turns** | REALTIME concurrency 40 ÷ ~5–10 s per tool-using turn | **~240–480 turns** | `config.ts` default, set for 500/min (D) |
| Outbound sends + status webhooks | Meta rate limit, outbox drain | ~500 sends | Each send brings 2–3 status events, so webhook volume is ~4× message volume (doc estimate) |
| Realtime delivery | Supabase plan quota | see §4 | |

The **AI turn limit is the binding stage** for answered conversations, at roughly 300–500 a minute. The model provider's own rate limit (OpenRouter) is outside this repo and also applies.

Note: status webhooks (sent, delivered, read) are about three-quarters of Meta's traffic. A "500 messages/minute" workload is therefore about 2,000 webhook calls a minute.

## 4. Concurrent users

- Each browser holds **1 list-topic channel plus 1 open-chat channel**. 100 staff is about 100–200 Realtime channels over about 100 sockets.
- With the SC5 migration (`20261202094300_sc5_scoped_inbox_broadcasts.sql`, present in the repo; I did not check whether it is applied to either project), one inbound message produces **2 broadcasts** (one list, one conversation), against 4 before.
- Fan-out: a message in an agency with 10 viewers delivers about 10 list events plus a few thread events. At 500 messages/minute spread over 50 agencies that is about 80–100 delivered events a second, within a Pro-plan Realtime quota (verify the figure on your plan; Supabase quotas change).
- Read amplification is controlled: a client batcher folds events into one plan, a hidden tab reads nothing, reconnects reconcile once. Worst case is about 3–4 Server Action reads per viewed event.
- The Realtime **concurrent connection quota** is the first user ceiling (about 200 on free, about 500 on Pro by default, higher on request; verify). With 2 sockets per user at most, that is roughly **100–250 simultaneously open Inbox tabs** before a quota change.
- Per-user write limits (`lib/inbox/rate-limit/policy.ts`): 15 new WhatsApp chats an hour, 60 template sends an hour, 40 Copilot suggestions an hour per staff member. These cap human-driven AI cost, not message throughput. Bulk actions are capped at 50 conversations.

## 5. Weak points under load

1. **Smallest database tier.** 60 connections shared by everything; the worker, drains and Realtime compete. First thing to saturate.
2. **Burst handling.** Measured failure at 5,000/min. A fix for the time-budget dead-lettering (`release_channel_job`) exists but was not measured; re-run the Burst profile on the worker topology.
3. **AI turns are the cost and latency ceiling**, 40 in flight by default. Model-backed jobs have never been load-tested.
4. **Unmeasured path.** No test generates signed webhooks, Realtime subscribers, reconnect storms or delivery receipts together, so events per inbound and Server Action calls per inbound are unconfirmed. SC3's `EXPLAIN` at 100,000 conversations is also not done.
5. **Table growth.** `conversation_messages` is a single table. Fine for months at realistic volume; at the 10,000/min design it would add about 14 million rows a day and needs partitioning.
6. **Single worker.** One container is one point of failure; the `pg_cron` drain remains as the fallback, with up to a minute of delay.
7. Earlier defects (claimed jobs stranded for 5 minutes in the agent drain) are fixed in current code: unreached jobs are handed back immediately (`lib/agent/whatsapp/drain.ts`). I did not re-verify the other 25 Sep defects (parallel AI turns per burst, non-idempotent AI send, first-id webhook dedupe) against current code.

## 6. Recommendations

| Priority | Action | Effect |
|---|---|---|
| 1 | Run one end-to-end load test on a **branch/staging database with the worker running**: signed webhooks, 25 simulated browsers, real model calls at 100, 300, 500/min | Replaces estimates with measurements |
| 2 | Upgrade production Supabase compute above Micro before real traffic, and put the worker on the transaction pooler | Removes the connection ceiling; likely 2–4× headroom |
| 3 | Confirm the SC5 migration is applied in production and run its verify script | Halves Realtime events |
| 4 | Confirm the Realtime connection and message quotas of your plan | Defines the real user ceiling |
| 5 | Alert on queue age (the `inbox-health` cron exists) and AI turns in flight | Early warning |
| 6 | Only if sustained volume exceeds ~1,000/min: partition messages, adopt the edge design in `architecture-10k-edge-realtime.md` | The 10K path; not needed for launch |

## 7. Honest summary

On the current code and the smallest database tier, plan for **about 300–500 answered messages per minute sustained, and about 100–200 staff online at once**. The queue layer has been shown to handle 1,000 jobs a minute with good latency, and the architecture is sound (atomic ingest, fair-share queues, ID-only Realtime). What is missing is proof of the whole path under load, and a database tier sized for it. Stated figures marked (D) should be treated as engineering estimates until recommendation 1 is run.
