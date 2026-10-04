# Plan: replace Inngest with Supabase-native scheduling

Status: **Implemented 2026-10-01** (T1 to T15; the remaining steps are outside the repository, see `docs/runbooks/inngest.md`) · Owner: Inbox + Copilot programme · Written: 2026-10-01
Supersedes: decision **R8** in [`architecture.md`](./architecture.md) §16, and the Inngest parts of
[`scale-inngest-implementation-plan.md`](./scale-inngest-implementation-plan.md), [`scaling.md`](./scaling.md) §10.4 and
[`docs/runbooks/inngest.md`](../runbooks/inngest.md).

Per [`AGENTS.md`](../../AGENTS.md), the architecture is changed **first** (step 0 below), and only then are slices built. This
document changes no code. It is the plan.

## 1. Why, and what the goal is

Inngest's execution allowance is too small for this app. The biggest consumer is the schedules: ten jobs, two of them every minute,
plus the raw-event reconciler every minute, which together are roughly 4,300 Inngest runs a day before a single customer writes.

**Goal:** run everything that Inngest runs today on Supabase (Postgres and its own scheduler) plus the web app and, if used, the
existing worker, with **no third-party execution quota**, **no new vendor**, and **no change in behaviour** for staff or customers.

**Non-goals:** no new features, no change to the per-message path (the Postgres job queue, lanes, outbox and send gate stay exactly
as they are), no change to what any job does.

## 2. What Inngest does today (inventory)

Verified from `lib/inbox/inngest/*`, `app/api/inngest/route.ts`, the worker, and the migrations.

| # | Inngest piece | What it really does | State today |
|---|---|---|---|
| 1 | 11 cron schedules in `schedules.ts` | Call the existing `app/api/cron/*` route handlers in-process on a timer: agent-jobs drain, inbox-lanes, inbox-sla, lead-followups, departure-ops-jobs, release-seat-holds, ai-usage-rollup, whatsapp-health, whatsapp-billing-sync, inbox-retention, finance-ops-sweep | Do nothing unless `INNGEST_SCHEDULES_ENABLED` is set. These jobs were originally pg_cron jobs |
| 2 | `raw-event-reconcile` (every minute) | Replays webhook deliveries whose messages never landed | Same switch. The `agent-jobs` route already runs it itself when Inngest schedules are off |
| 3 | `reply-window-reminder` | On an event, sleeps until 2 hours before a reply window closes, then notifies the owner. Re-checks up to 4 times | Event written by three DB triggers into `inngest_outbox` |
| 4 | `knowledge-document-ingest` | Chunks and embeds an uploaded document in resumable steps | **Off by default** (`INNGEST_KNOWLEDGE_INGEST`); the old `EMBED_DOCUMENT` job on `agent_jobs` is the fallback and the default |
| 5 | `inngest_outbox` + forwarder | Table of events, claimed and POSTed to Inngest with retries, run by the worker and by the `agent-jobs` cron | Only forwards when `INNGEST_EVENT_KEY` is set |
| 6 | `/api/inngest` route, encryption middleware, signing key | Lets Inngest call back into the app | Serves only with signing and encryption keys |
| 7 | **Not in Inngest at all:** `inbox-email-poll` | Email poll every 2 minutes | Still plain pg_cron (migration `20261213090000`) |

**The key finding:** only #3 is genuinely a "durable workflow" (a sleep). Everything else is a timer calling code that already
exists and is already idempotent. The app already has a working Supabase-native path: pg_cron + pg_net + Vault secrets +
`invoke_cron_route`, from migration `20260927090000_cron_jobs.sql`. Inngest was layered on top of it, and the cutover script
`scripts/sql/cutover-i3-pg-cron-to-inngest.sql` unscheduled those pg_cron jobs.

## 3. Target architecture

```
Supabase pg_cron ──(every N min)──► pg_net HTTP GET ──► /api/cron/<job>  (Bearer CRON_SECRET, same handlers as today)
                                         ▲
                       Vault: base URL + secret (set once per environment)

Customer message ─► webhook ─► Postgres (state, job queue, outbox)  ─► lane worker or the minute drain   [unchanged]

Reply-window reminder ─► ONE sweep job every 5 min (SQL query + existing exactly-once ledger)            [replaces the sleeping workflow]
Knowledge ingest      ─► the existing EMBED_DOCUMENT job on agent_jobs, made resumable by chunk range   [replaces the step function]
```

Principles, in the same spirit as the current R8 but without a vendor:

1. **Postgres owns state and the clock.** `pg_cron` is the only scheduler. No second scheduler may exist; that is the "every job
   runs twice" failure the Inngest cutover already warned about, just in reverse.
2. **Jobs call the existing route handlers.** No job logic is rewritten; only the trigger changes.
3. **Every job is idempotent and lease-based.** An overlapping or repeated run is harmless. (This is already true of the drains,
   the outbox and the ledgers; verify, don't assume, in step 3.)
4. **A job that needs to "wait" becomes a periodic sweep over a timestamp column**, using the existing exactly-once ledger. No
   durable sleeping.
5. **Never both:** at any moment each job has exactly one scheduler (see the cutover order in section 6).

### Why not the alternatives

| Option | Verdict |
|---|---|
| pg_cron + pg_net → existing routes | **Chosen.** Already built, already proven in this repo, no new vendor, no quota. |
| Supabase Edge Functions + pg_cron | Not needed. Would mean porting route code to Deno for no gain. |
| Supabase Queues (pgmq) | Not needed. `agent_jobs`, `inbox_jobs` and the outbox already are Postgres queues. Adding a second queue system is added complexity. |
| Vercel Cron | Plan limits on frequency and count, and it was deliberately replaced earlier (`vercel.json` was deleted). |
| Keep Inngest, pay for more | Rejected by you. |

## 4. Piece-by-piece replacement

### 4.1 Schedules (inventory rows 1, 2, 7) — easy
- Re-create one pg_cron job per route, calling `invoke_cron_route`. Cadences stay as they are now:

| Job name | Route | Schedule (UTC) |
|---|---|---|
| `whatsapp-agent-jobs-drain` | `/api/cron/agent-jobs` | `* * * * *` (consider `*/2` or `*/5`, see 4.6) |
| `inbox-lanes` | `/api/cron/inbox-lanes` | `* * * * *` (same) |
| `inbox-sla` | `/api/cron/inbox-sla` | `*/2 * * * *` |
| `inbox-email-poll` | `/api/cron/inbox-email-poll` | `*/2 * * * *` (already exists) |
| `lead-followups-sweep` | `/api/cron/lead-followups` | `*/10 * * * *` |
| `departure-ops-jobs-drain` | `/api/cron/departure-ops-jobs` | `*/15 * * * *` |
| `release-seat-holds` | `/api/cron/release-seat-holds` | `0 * * * *` |
| `ai-usage-rollup` | `/api/cron/ai-usage-rollup` | `15 * * * *` |
| `whatsapp-health-check` | `/api/cron/whatsapp-health` | `0 3 * * *` |
| `whatsapp-billing-sync` | `/api/cron/whatsapp-billing-sync` | `0 4 * * *` |
| `inbox-retention` | `/api/cron/inbox-retention` | `17 2 * * *` |
| `finance-ops-sweep` | `/api/cron/finance-ops-sweep` | `0 * * * *` (first time it ever runs; start disabled, enable deliberately) |
| `reply-window-sweep` (new, 4.2) | new route | `*/5 * * * *` |

- The raw-event reconciler needs **no job of its own**: `agent-jobs` already runs `reconcileRawEvents` whenever Inngest schedules
  are off. Confirm that in step 3.
- **Found while reading (verify against the live database before relying on it):** the latest definition of `invoke_cron_route`
  (`20261213090000`) allows nine paths and **omits** `/api/cron/inbox-sla`, `/api/cron/inbox-retention`,
  `/api/cron/finance-ops-sweep` and `/api/cron/onboarding-signup-alert`. Either a later migration or the live function differs,
  or the "put pg_cron back" rollback in the old cutover script would raise an error for those jobs. The new migration must
  redefine the allow-list in one place with every path above, and the pgTAP/SQL check must prove each path is accepted and an
  unknown path is refused.
- Secrets: reuse the Vault entries `cron_http_base_url` and `cron_http_secret` (`set_cron_http_config`), which must equal the
  deployment's `CRON_SECRET`. Re-run it per environment and whenever the domain or secret changes.

### 4.2 Reply-window reminder (row 3) — the only real redesign
Replace "an event that sleeps" with "a sweep that looks":

- **Trigger:** `reply-window-sweep` every 5 minutes calls one new route (same bearer check as the other cron routes).
- **Query:** person-owned conversations (`HUMAN_REQUESTED` or `HUMAN_ACTIVE`) whose `service_window_expires_at` is between now and
  now + 2 hours, not yet reminded for the current unanswered customer message.
- **Decision and exactly-once:** reuse the pure `decideWindowReminder` and the follow-up ledger (`claimFollowup`,
  `WINDOW_REMINDER` kind). The ledger's unique key already makes the reminder once per unanswered message, so a sweep that
  sees the same chat five times still sends one notification.
- **"Extended window" case** (customer writes again, the window slides): the sweep re-evaluates from the current column each
  run, so no 4-round loop is needed.
- **Drop** the three triggers (`conversations_window_opened_on_insert`, `_on_window`, `_on_handoff`) and
  `trg_enqueue_window_opened()`. Add a partial index on `(agency_id, service_window_expires_at)` for person-owned chats so the
  sweep stays cheap at scale.
- **Accuracy trade-off, accepted:** a reminder can arrive up to 5 minutes later than "exactly 2 hours before"; with a 2-hour lead
  this does not matter.

### 4.3 Knowledge document ingest (row 4) — remove the Inngest path
- The legacy `EMBED_DOCUMENT` job is already the default and the fallback. Keep it as the only path; delete the Inngest branch in
  `queueKnowledgeIngest` and the `INNGEST_KNOWLEDGE_INGEST` flag.
- Resumability was the one thing the step function gave. Chunks are already stored in Postgres, so make the job resumable the
  Postgres way: the job embeds in batches (it already has the helper `embedKnowledgeChunkRange` with `EMBED_STEP_CHUNKS = 32`),
  records progress on the document row, and **re-queues itself** until done. A crash resumes from the saved position through the
  normal lease-expiry and retry of `agent_jobs`. Final failure still marks the document FAILED with the same plain message.
- If you prefer not to touch this at all, the acceptable fallback is to leave the legacy job as it is (a long document restarts
  from the beginning after a crash). Decide in section 8.

### 4.4 The outbox and forwarder (row 5) — delete
- Remove `inngest_outbox`, `enqueue_inngest_event`, `claim_inngest_outbox`, `fail_inngest_outbox` and their helpers in a **late**
  migration, after the new path has run for a week (section 6, step 7). Until then the table is simply unused.
- Remove the worker's `inngest_outbox` auxiliary loop (`WORKER_FORWARD_INNGEST`) and the forwarder call inside the `agent-jobs`
  route.

### 4.5 Inngest plumbing (row 6) — delete
- Remove `app/api/inngest/route.ts`, `lib/inbox/inngest/*`, the `/api/inngest` entry in `proxy.ts` `MACHINE_ROUTES`, the packages
  `inngest` and `@inngest/middleware-encryption`, and the env vars `INNGEST_*` from `.env.example`.
- Delete the Inngest app and keys in the Inngest dashboard after the final cutover step.

### 4.6 Cost and load: what replaces the quota
There is no execution quota on pg_cron, but each tick is one Vercel function invocation. Control it:
- Per-minute drains are a **safety net**: the worker or the realtime path does the real work. Run them every 2 or 5 minutes unless
  the worker is not deployed; if the worker is not deployed, keep every minute. Decide with the launch-volume number from the load test.
- Check the web host's invocation and duration limits against about 1,440 invocations/day per minute-job and set a route
  `maxDuration` that fits the longest job (several routes already work to a time budget).
- Supabase side: pg_cron is part of Postgres; keep the number of simultaneously running jobs small (the platform guidance is no
  more than 8 at once, each short). Jobs are tiny because `pg_net` only sends the request; the work happens in the web app.

### 4.7 Monitoring (replaces Inngest run history and failure alerts)
Inngest gave per-run history, retries and alerts. Replace with what Supabase gives, plus one small check:
- **Run history:** `cron.job_run_details` (start, end, status, message) for the scheduler side and `net._http_response` (HTTP
  status of each call) for the web side.
- **Retention:** schedule a daily job that deletes `cron.job_run_details` rows older than 7 days and `net._http_response` rows older
  than 3 days; otherwise these tables grow without limit.
- **Missed or failing job alert:** one view that, per job, shows the last successful run and last non-2xx status; an alert fires
  when a job has not succeeded in 2× its interval or returns non-2xx twice in a row. Wire it to the same alert channel as the
  other launch alerts in [`production-wrap-up-plan.md`](./production-wrap-up-plan.md) W5.
- **Retries:** the old Inngest retries (2 to 3 per run) are replaced by the next tick, which is every few minutes and idempotent. This is
  sufficient for every job here; none needs a within-seconds retry.
- **Logs stay metadata-only,** as today (counts, never rows, names or messages).

## 5. Data and access changes
- **New migration(s)** (additive and reversible): re-create the pg_cron jobs, redefine `invoke_cron_route` with the full allow-list,
  add `reply-window-sweep` support (index) and the run-history cleanup job. No new tenant-owned table; no change to RLS. The new
  functions are `security definer`, `search_path = ''`, revoked from `public`, `anon`, `authenticated` and executable by the
  scheduler role only, exactly as the current ones are.
- **Late migration:** drop the window-opened triggers and the `inngest_outbox` objects.
- **Access control:** none changed. The cron routes keep their bearer-secret check; the sweep route follows `requireUser()`'s
  machine-route equivalent used by the other cron routes.

## 6. Order of work and cutover (never two schedulers)

Each step is one PR or one operation. Do not combine a migration, a deploy and a switch-off in one step.

0. **Architecture first.** Amend `architecture.md` §16: add decision **R9 — Postgres owns state and the clock; pg_cron owns schedules;
   no external workflow engine**, marking R8 superseded. Update `scaling.md` §10.4 and the Inngest sections of the Inbox plans and
   runbooks, and add a runbook `docs/runbooks/supabase-scheduling.md` replacing `inngest.md`.
1. **Audit** (read-only): list `select jobname, schedule, active from cron.job;` on staging and production; list the live
   `invoke_cron_route` body; confirm which jobs are pg_cron and which are Inngest today and what `INNGEST_SCHEDULES_ENABLED` is set to
   in each environment. Record the answer. If Inngest schedules were never enabled in production, the cutover is simply "stay on pg_cron".
2. **Migration A — schedules.** Restore every job in 4.1 as pg_cron, full allow-list, with `finance-ops-sweep` inactive. Apply to
   staging. Verify each job ran and answered 2xx.
3. **Idempotency check** (tests, no behaviour change): overlap two runs of each route and confirm no duplicate customer-visible
   effect; confirm `agent-jobs` runs the reconciler when Inngest is off. Fix only what is found.
4. **Switch off Inngest schedules:** only now set `INNGEST_SCHEDULES_ENABLED` empty and redeploy. Order matters: pg_cron on first
   (step 2), then Inngest schedules off. A one-to-two-minute double-run in between is harmless because every job is idempotent and the
   drains are lease-based.
5. **Reply-window sweep:** build the route and sweep (4.2) with its tests; apply the index; turn the `reply-window-sweep` job on. Run
   it alongside the old triggers for a few days: the ledger prevents a double notification. Compare counts, then drop the triggers.
6. **Knowledge ingest:** remove the Inngest branch; make the job resumable (4.3) if chosen.
7. **After one stable week:** remove the forwarder, worker loop and agent-jobs forwarder call; drop `inngest_outbox` objects; remove
   the route, library, packages, env vars and proxy entry; delete the Inngest account's app and keys.
8. **Docs and checklists:** retire `inngest.md`; update `docs/inbox/checklist.md`, the wrap-up plan (W3 env var list, W4, section 4 S1)
   and the runbooks index so nothing still describes Inngest.

Rollback at any step: re-run migration A's reverse (unschedule the new jobs) and set `INNGEST_SCHEDULES_ENABLED=1` **in that order**
(the old script's order, reversed), as long as the Inngest code and account still exist, which is why deletion is step 7, not earlier.

## 7. Verification

**Automated (no new feature tests beyond what each step needs):**
- Allow-list test: every path in 4.1 accepted by `invoke_cron_route`; an unknown path refused; the function is not executable by
  `authenticated` or `anon`.
- Each cron route: wrong or missing bearer → 401/403; right bearer → 200 with counts only.
- Reply-window sweep (pure decision already covered): window-closing, extended, answered, assistant-owned, closed, and a second
  sweep that sends **nothing** (exactly-once); two agencies never mix.
- `npm run lint`, `typecheck`, `test`, `build` pass after the removals; no import of `inngest` remains.

**Human checks (add to the wrap-up plan's section 4):**
- **M7** Each scheduled job appears in `cron.job` with the right schedule and shows a successful run within its interval.
- **M8** Stop the web app for 5 minutes, start it: the next ticks catch up, nothing duplicates.
- **M9** Inbound message with the worker off: it is processed by the next drain within the chosen interval.
- **M10** Reply window: a person-owned chat whose window closes in under 2 hours produces exactly one notification; the customer
  writing again moves it; answering cancels it.
- **M11** Upload a long knowledge document, restart the worker or web app mid-way: it finishes without re-embedding finished chunks
  (if resumable chosen) or finishes from the start (if not).
- **M12** Break a job (wrong secret): the missed-job alert fires within 2× its interval.
- **M13** Confirm in the Inngest dashboard that zero new runs appear after step 4, then after step 7 that nothing is registered.

## 8. Decisions I need from you

1. **Drain cadence:** every minute (safe, more Vercel invocations) or every 2 to 5 minutes (needs the worker deployed)?
2. **Knowledge ingest:** make the legacy job resumable (small change), or leave it restarting from the start after a crash?
3. **Finance ops sweep:** it has never run in production. Enable it now, or leave it off until after launch?
4. **Is Inngest enabled in production today?** If not, step 4 is a no-op and the whole change shrinks to steps 0, 2, 5, 6, 7.
5. **Worker:** is it going to be deployed for launch? That changes decision 1 and the monitoring in 4.7.

## 9. Impact on the production wrap-up plan

When this is approved, update [`production-wrap-up-plan.md`](./production-wrap-up-plan.md): W3 (remove `INNGEST_*` variables, add
the Vault cron config), W4 (scheduler owner is pg_cron, no choice to make), W5 (use the 4.7 alerts), and section 4 S1 (replace
"stop Inngest" with "pause a pg_cron job"). Add checks M7–M13 above. No other part of that plan changes.
