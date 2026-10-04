# Inbox scaling track — SC0–SC7 progress and load-test results (2026-09-24)

Point-in-time snapshot for [`docs/inbox/scaling.md`](../inbox/scaling.md). Branch `scaling-inbox`. Target: Manasik OS Supabase project, attested by its owner as holding only disposable demo data (`LOAD_TEST_ENVIRONMENT=disposable`). Every fixture created by a run was removed afterwards and the database was confirmed back to 1 agency / 2 conversations / 60 messages.

## What the load runs measured — and what they did not

The runs queue `ENRICH` jobs directly into `channel_jobs` for 50 disposable agencies and measure how the **deployed** workers drain them (the database's `pg_cron` calls the deployment at `https://workspace.manasikos.com`). Read every number with these limits in mind:

- **The workers ran the build deployed at the time, not this branch.** In particular the `release_channel_job` fix below was not yet in the deployed drain code, so it is unmeasured.
- **The jobs are cheap.** The fixtures are `OTHER`-channel conversations with no messages, so the S0 gate skips every job (`s0SkipRate = 1`, cost 0). Real enrichment that calls a model will be slower; capacity for real traffic is therefore *lower* than these figures.
- **No webhook, browser or Realtime traffic was generated.** Delivered Realtime events per inbound, Server Action calls per inbound, webhook p95 and event-to-visible latency were not measured.
- `LOAD_TEST_WORKER_URL` made the runner call the REALTIME lane route every 2 s, mimicking the after-webhook drain kick. Without it, directly inserted jobs would wait for the once-a-minute cron.

## Results

| Profile | Jobs | Rate | Completed | p50 | p95 | max | Oldest queued job (max) | Samples > 10 s | Dead-lettered | Agency spread |
|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (10,000 at once) | 10,000 | instant | 9,779 | 90 s | 160 s | — | — | — | 2.2% (time budget) | 2.7% |
| Sustained | 5,000 | 1,000/min × 5 min | 5,000 | 1.4 s | **2.5 s** | 3.6 s | 0.9 s | 0 of 60 | 0 | 6.4% |
| Noisy tenant | 4,000 | 1,000/min × 4 min, 50% from one agency | 4,000 | 1.3 s | **3.0 s** | 4.0 s | 2.5 s | 0 of 48 | 0 | 4.6% |
| Burst | 12,000 | 5,000/min × 2 min, then 1,000/min × 2 min | 11,772 | 16.5 s | **20.2 s** | 23.9 s | 17.5 s | **22 of 48** | **1.9%** (time budget) | 2.1% |

Against the §11.3 bars (p95 < 5 s, dead-letter < 0.1%, agency spread ≤ 20%):

- **Sustained and Noisy tenant pass.** The current topology keeps up with the 1,000/min target with room to spare. Its measured drain ceiling (about 49–57 jobs/s ≈ 3,000–3,400/min) is roughly 3× the target, comfortably above the plan's 30% headroom.
- **Noisy-tenant isolation holds.** With half the traffic from one agency, the other 49 agencies' p95 was 2.66 s against the noisy agency's 3.13 s, and the spread between the best and worst control agency was 4.6%. No agency was starved.
- **Burst fails.** Arrival (about 83/s) exceeded the drain ceiling (about 49–57/s) for two minutes, so a backlog built: the oldest waiting job reached 17.5 s and p95 was 20 s. The backlog cleared 3 s after the burst phase ended. 228 jobs died with the reason *"Exceeded the lane's time budget"*.

## Defects found and fixed while measuring

1. **Load runner read 1,000 of 10,000 jobs.** The API returns at most 1,000 rows per request, so completion could never be detected and the first percentiles were computed on a slice. Now paged.
2. **HTTP 414 on a 10,000-id filter** (`ai_runs` lookup). Now chunked.
3. **Fixtures left behind.** Deleting 10,000 conversations in one statement exceeds the statement timeout (per-row triggers), so the runner threw in its `finally` block and left 50 agencies and 10,000 conversations behind. Removal now runs in batches of 300; the leftovers were removed by hand and the batched path was confirmed by the two runs after it.
4. **Healthy jobs dead-lettered when a tick ran out of time.** `claim_channel_jobs` counts an attempt at claim time, and a time-budget cutoff failed in-flight jobs through `fail_channel_job`, spending an attempt they never faulted for. `release_channel_job` (migration `20261202093900`, applied) refunds it when the job had used less than half the tick's budget; a genuinely slow job still fails normally. **Not yet measured** — the Burst run above still showed the old behaviour because the deployed drain did not have it. This is the first thing to re-measure after deploying.

## §10.2 dedicated-worker gate

| Condition | Evidence | Verdict |
|---|---|---|
| REALTIME p95 ≥ 5 s in two comparable runs | Burst 20.2 s (one run). Sustained 2.5 s and Noisy 3.0 s are under 5 s | One run: not yet |
| Oldest queued job > 10 s three times in 15 min | 22 of 48 five-second samples in Burst | Met, in Burst only |
| A 2,000-job backlog cannot clear in 60 s | 10,000 drained at ~57 jobs/s ⇒ 2,000 in ~35 s | Not met |
| Vercel timeout/invocation failure > 0.1% in the sustained run | 0 dead letters in Sustained; the Burst failures are the time-budget defect above | Not met |
| Cron interval, not processing time, dominates delay | Not the case with the kick enabled | Not met |
| Self-invocation throttling prevents the required shard width | Not observed | Not met |

**Decision: do not add a dedicated worker yet.** One profile trips one condition, on trivially cheap jobs, on a build that still has defect 4. The plan's rule is to change one thing per experiment and keep it only if it beats measurement noise:

1. Deploy `scaling-inbox`, re-run **Burst** (`--profile burst --minutes 4`). If the time-budget dead letters disappear and p95 improves, the defect was inflating the failure count.
2. If Burst p95 is still ≥ 5 s in that second comparable run, the gate has tripped: amend Architecture §7.4 and build the small dedicated worker around the existing `processLane()`.
3. Whatever happens, repeat with **real model-backed enrichment** before any capacity claim: these figures are an upper bound.

## State of SC1–SC7

| Slice | State |
|---|---|
| SC0 | Baseline measured (above); the Realtime/webhook parts of its exit are not |
| SC1 | Built; migration applied; fault injection proven on staging (0 stray messages, 0 stray jobs); repair path in the SLA sweep |
| SC2 | Built; migrations applied (typed events; **per-conversation message sequencing, which was missing entirely**) |
| SC3 | Built; `conversations.version` now advances on visible changes only |
| SC4 | Built (merge / plan / single-flight modules + dialog wiring); browser acceptance not done |
| SC5 | Migration written and proven in a rolled-back transaction (inbound message 1 agency-topic + 1 conversation-topic event, was 2 + 2; delivery, note and presence 0 + 1). **Not applied** — apply it after the SC4 client is deployed, then run `scripts/sql/verify-sc5-scoped-broadcasts.sql` |
| SC6 | Built; browser-generated idempotency key, exact reconciliation, retry-safe |
| SC7 | Harness for Sustained / Burst / Noisy tenant built and tested; runs recorded above; worker decision deferred as described |
| SC8 | Not started |

## What is still needed

- Deploy the branch, then apply `20261202094300_sc5_scoped_inbox_broadcasts.sql` and run its verify script.
- Signed-in, two-session browser acceptance for SC2, SC4 and SC6 (no browser session was available).
- A harness extension for signed webhook ingestion, Realtime subscribers, reconnect storms and delivery receipts, to measure delivered events and Server Action calls per inbound (the SC5 ≥70% exit).
- `EXPLAIN (ANALYZE, BUFFERS)` of the scoped reads at 100,000 conversations and a 10,000-message thread (SC3 exit).
- Meta test-provider acceptance and the staged rollout (SC8).
