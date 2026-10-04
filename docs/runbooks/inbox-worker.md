# Inbox worker: run, deploy, roll out, roll back

The always-on worker (slice Q3 of [`docs/inbox/scale-inngest-implementation-plan.md`](../inbox/scale-inngest-implementation-plan.md))
is a small Node process that keeps the Inbox queues moving: the assistant's replies, enrichment and media on
`channel_jobs`, staff sends (the outbox) and the legacy `agent_jobs`. It replaces "a webhook's function stays alive for up to
25 s to drain the queue" with "a process that is already running picks the job up within a fraction of a second".

**It is never required for correctness.** Every claim is a lease, and the scheduled drains (once a minute) keep running. A worker
that is down, slow or restarting only makes replies later, never lost. That is what makes the rollout below safe.

The code is `worker/index.ts` and `lib/inbox/worker/`. It has not been deployed anywhere yet; nothing in production changes until
you do the steps in section 4.

## 1. Build and check it locally

```bash
npm run worker:build
```

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co SUPABASE_SECRET_KEY=<secret key> npm run worker:check
```

`worker:check` starts nothing and connects to nothing. It reports, as JSON, whether the configuration parses, which required
variables are missing (by name, never by value), and whether every job handler loads under plain Node. It exits 1 on any problem, so
run it in CI and as the image's smoke test (the Dockerfile does).

To run it: `npm run worker:start`. It logs one JSON object per line and listens on `WORKER_PORT` (default 8080).

`esbuild` is used to bundle it. It is currently present only because `vite` depends on it; add it as a direct dev dependency
(`npm install -D esbuild`) the next time you have network access, so a `vite` upgrade cannot remove it.

## 2. Configuration

Everything is an environment variable. The worker refuses to start on a bad value and lists every problem at once.

**Required** (the worker will not start without them)

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The Supabase project URL |
| `SUPABASE_SECRET_KEY` | The service-role key. It reads and writes every agency's rows, so treat it as the most sensitive value in the system |

**Needed for the assistant to work** (the worker starts without them and warns; replies then fail)

| Variable | What it is |
|---|---|
| `OPENROUTER_API_KEY` | The model provider key |
| `AI_AGENT_MODEL`, `AI_REASON_MODEL`, `AI_DRAFT_MODEL`, `AI_CLASSIFY_MODEL` | Model overrides. Leave unset to use the defaults |
| `AI_FREE_CHAT_MODEL` | Opt-in free model. Leave unset to always use the paid model |
| `OPENROUTER_DATA_POLICY` | `deny` or `zdr`: restrict which providers may see prompts (see `.env.example`). Enable in staging first |
| `VOICE_TRANSCRIPTION_MODEL`, `KNOWLEDGE_EMBEDDING_MODEL` | Only if you override the defaults |
| `META_GRAPH_VERSION` | The Graph API version used when sending. Set it to the same value as the web deployment |

**Deliberately not given to the worker.** `META_APP_SECRET`, `INSTAGRAM_APP_SECRET`, `*_VERIFY_TOKEN`, `CRON_SECRET` and the Supabase
publishable key are used only to verify inbound webhooks and cron calls, which stay on the web deployment. Channel access tokens are
read from Supabase Vault with the service-role key at the moment of a send; they are not environment variables. Giving the worker only
what it uses means a leaked worker cannot forge a webhook or call a cron route.

**Tuning** (all optional; defaults are sized for the 500 messages/minute target)

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_CONCURRENCY_REALTIME` / `_STANDARD` / `_BULK` | 40 / 10 / 4 | Jobs run at once per lane. Replies are network-bound (about 5 to 17 s each), so about 40 covers 500 messages a minute. Raise it if the queue's oldest job age grows; each unit adds one database connection's worth of claims and writes |
| `WORKER_PER_AGENCY_CAP_*` | 10 / 5 / 2 | Most jobs of one agency in flight in a lane. This is what keeps one busy agency from starving the rest |
| `WORKER_JOB_TIMEOUT_MS_*` | 75 000 / 100 000 / 150 000 | A job still running after this is failed for retry. **Must stay at least 5 s under the lane's lease** (90 / 120 / 180 s); the worker refuses to start otherwise, because a job that outlives its lease is handed to another worker while this one is still running it |
| `WORKER_DRAIN_OUTBOX`, `WORKER_DRAIN_AGENT_JOBS` | true | Also send staff messages and run the legacy jobs. Turn off on a second instance if you only want one process doing each |
| `WORKER_DRAIN_DELIVERY_STATUS` | true | Apply buffered delivery ticks (sent, delivered, read) in batches. Needs the Q4 migration |
| `WORKER_RECONCILE_RAW_EVENTS` | true | Once a minute, repair webhook deliveries whose messages never landed (I2). Needs the I2 migration |
| `WORKER_PORT` (or `PORT`) | 8080 | The health port |
| `WORKER_SHUTDOWN_GRACE_MS` | 20 000 | How long running jobs get to finish on SIGTERM before they are handed back |
| `WORKER_STALE_SWEEP_MS` | 15 000 | How often expired leases are returned to the queue |

## 3. Deployment requirements

Where it runs is your decision (cost and operations differ); these are the requirements, whichever you choose.

- **Two instances** (or more), so a restart or a crash never leaves the queue with no worker. They need no coordination: claims are
  serialised per lane in the database and use `FOR UPDATE SKIP LOCKED`.
- **Near the database.** Supabase is in `ap-southeast-1` (Singapore); run the worker in the same region. Every job makes several
  round trips.
- **Size.** Start with 0.5 to 1 vCPU and 512 MB to 1 GB per instance: the work is waiting on the network, not computing. Watch memory
  under the first real load and adjust.
- **Restart on failure, and use the health checks.** Liveness: `GET /healthz` (503 when a loop has stopped advancing, which is a hung
  process that should be restarted). Readiness: `GET /readyz` (503 once shutdown begins, so a deploy stops routing to a draining
  worker). The bodies are counters only. There is no other route.
- **Graceful stop.** The platform must send SIGTERM and wait at least `WORKER_SHUTDOWN_GRACE_MS` plus 10 s before it kills the process.
  On SIGTERM the worker stops claiming, lets running jobs finish, then hands any remainder straight back to the queue with their
  attempt refunded, so a deploy never makes a customer wait out a lease.
- **Secrets** come from the platform's secret store as environment variables. They are never in the image, the repository or a log.
  The image is built without any (its build-time check uses placeholders).
- **Egress allow-list**, if the platform supports one. The worker needs to reach only: the Supabase project host
  (`<project>.supabase.co`), `graph.facebook.com` and `graph.instagram.com` (sending), `openrouter.ai` (the model), and Meta's media
  hosts when downloading a customer's photo or voice note (the Graph API returns the URL; the DNS suffixes are typically
  `fbcdn.net` and `fbsbx.com`, which you should confirm in staging). It needs no inbound access except the health port from the platform.
- **Logs** are JSON lines with event names, lane names and counters only. They never contain a job payload, message text or secret;
  a test enforces it. Keep it that way if you add a log line.
- **Not verified yet:** `worker/Dockerfile` was written without a running Docker daemon. Build it once
  (`docker build -f worker/Dockerfile -t inbox-worker .`) and run `worker:check` inside it before relying on it.

## 4. Rolling it out

Apply the migrations first, in order: Q1 (`20261204090000_q1_reply_queue.sql`), Q2 (`20261204090100_q2_queue_claim.sql`), then Q4
(`20261204090200_q4_delivery_status_batching.sql`), I1 (`20261204090300_i1_inngest_outbox.sql`), I2
(`20261204090400_i2_raw_event_reconcile.sql`), then deploy the code. The worker needs both: it claims with a lease, which the Q2 function provides.

1. **Start one worker** with the web deployment unchanged. Both now drain the queues; claims never overlap, so this is safe.
   Check `GET /healthz`, and the `lane_summary` log lines, once a minute per lane.
2. **Confirm it is doing the work.** In the summaries, `claimed` and `processed` should rise as messages arrive, `deadLettered` and
   `unhandled` should stay at 0, and `timedOut` near 0. In Supabase, the oldest QUEUED REALTIME job should be seconds old at most
   (the `inbox_lane_health` view shows it).
3. **Start the second instance.** Check both report healthy.
4. **Set `INBOX_WORKER_ACTIVE=1` on the web deployment** and redeploy it. The WhatsApp and Messenger/Instagram webhooks and the staff
   send no longer start their own drain after they respond, so those functions return immediately. The scheduled drains still run every
   minute as the safety net.
5. **Watch for a day** before enabling the queued reply path for a real agency (`inbox_reply_queue_agencies`, see the plan doc).

**Rollback, in order of speed:** unset `INBOX_WORKER_ACTIVE` and redeploy the web app (webhooks drain again by themselves); scale the
workers to zero (the scheduled drains take over, replies are up to a minute slower); nothing else is needed. No job is lost by any of
these: jobs live in Postgres, and a stopped worker's running jobs are handed back or expire with their lease.

## 5. What to watch

| Signal | Healthy | If not |
|---|---|---|
| Oldest QUEUED REALTIME job age (`inbox_lane_health`) | seconds | The worker is down, or concurrency is too low for the load. Check `/healthz`, then raise `WORKER_CONCURRENCY_REALTIME` |
| `deadLettered` in the summaries | 0 | Read `last_error` on the dead `channel_jobs` rows; a model or Meta outage looks like this |
| `unhandled` in the summaries | 0 | A job kind has no handler in this build: the worker and the code that enqueues it are on different versions |
| `timedOut` in the summaries | near 0 | Jobs are exceeding their timeout: the model provider is slow, or the timeout is set too low |
| `stale_jobs_released` log lines | rare | Workers are dying mid-job (out of memory, killed without the grace period) |
| Log lines `claimChannelJobs failed` | none | The database is unreachable or overloaded; the worker keeps retrying every second and recovers by itself |
