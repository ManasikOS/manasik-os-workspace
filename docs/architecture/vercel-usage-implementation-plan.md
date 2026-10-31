# Implementation plan: bring Vercel Fluid Active CPU under the limit

Status: **proposed. No code, SQL or configuration has been changed.** · Written: 2026-10-23 · Owner: Platform
Builds on: [`vercel-usage-reduction-plan.md`](vercel-usage-reduction-plan.md) (the why, the inventory and decisions D1-D6). This document is the
**how**: ordered slices with files, tests, acceptance and rollback. Where it disagrees with that plan, section 2 says so and asks for approval.

Related: [`../runbooks/supabase-scheduling.md`](../runbooks/supabase-scheduling.md), [`../runbooks/inbox-worker.md`](../runbooks/inbox-worker.md),
[`cloudflare-hybrid-architecture.md`](cloudflare-hybrid-architecture.md), [`../progress/2026-10-17-gate-first-run-staging.md`](../progress/2026-10-17-gate-first-run-staging.md).

> Prices and limits are from memory and marked (verify). Everything about the code below was read on 2026-10-23; nothing is measured yet.

---

## 1. Problem and target

**Problem.** The team `ManasikOS` (Hobby) hit 4h 20m of 4h Fluid Active CPU and was paused on 17 Oct. In the 30-day usage view, the project
`manasik-os-workspace` (production) used 96.5% (4h 11m) and `manasik-os-staging` 3.5% (9m), at a flat 17-21 min a day since 4 Oct. A flat line with nobody
using production is a timer, not traffic. The timers are the `pg_cron` jobs that call `/api/cron/*` on Vercel: about 3,900 calls a day per database
(two every minute, two every 2 minutes, one every 5 minutes, one every 10 minutes, one every 15 minutes, and hourly or daily jobs), and each call boots a function
and loads the app. The email poll also opens IMAP sessions and parses mail on Vercel.

**Target** (measured the same way before and after, see section 9):

| Measure | Now | Target |
|---|---|---|
| Fluid Active CPU per month, both projects | over 4h in about 18 days | under 1h on an idle month, no pause |
| `/api/cron/*` invocations per day, idle | about 3,900 per database | under 200 per database |
| Oldest queued REALTIME job (`inbox_lane_health`) | not measured | no worse than today (seconds) |
| Customer-visible behaviour | | unchanged |

**Non-goals.** No feature change. No move of the Next.js app off Vercel. No new source of truth: Postgres stays the only one. No change to the
per-message queue, lane, outbox or send-gate design.

## 2. What the code reading changed

Three findings alter the earlier plan. **Approval needed for 2.1 and 2.2.**

### 2.1 The gate can live in Postgres; Cloudflare is not needed for it (revises D2)

The earlier plan has a Cloudflare Cron Trigger Worker ask "is there due work?" each minute and call Vercel only if yes. The same check can run **inside
`pg_cron`**: a SQL function counts due work and calls `invoke_cron_route(...)` only when the count is above zero (plus a floor call every N minutes as a
safety net). That removes a vendor, a deploy target, a secret store and a failure mode, and uses the allow-list, call recording and `cron_job_health()` that already exist.

Recommendation: **build the gate in Postgres (slice 2). Keep Cloudflare for the webhooks only (slice 6)**, where it earns its place. Revisit a Cloudflare gate only
if a job needs a trigger Postgres cannot give.

### 2.2 The webhook Worker is bigger than "store the raw event"

`handleWebhookDelivery` (`lib/whatsapp/webhook-handler.ts`) does, after verifying the signature: resolve the agency from `phone_number_id`, record the event
(`recordWebhookEvent`, dedupe on external event id), handle account-state changes, mark the webhook verified, ingest messages, record Business-app echoes,
record delivery statuses and per-message charges, then start drains with `after()`. Messenger and Instagram go through `lib/channels/messenger`.

The existing raw-event reconciler (`lib/inbox/reconcile/raw-events.ts`) is **not** a substitute for that path:
- it waits `minAgeMs` = 120 s before it looks at an event, so replies would be two minutes late;
- it replays **messages only**, never echoes, delivery ticks, account changes or charges, by design.

So a Cloudflare Worker that only stores the raw event needs a new, fast **raw-event processor** in the Node worker that runs the whole of the handler's
remaining steps for each stored event. That refactor is the riskiest slice in this plan, so it comes last and is optional (slice 6).

### 2.3 Several jobs need no new infrastructure at all

- The Node worker already drains `channel_jobs`, the outbox, `agent_jobs`, delivery status and the raw-event reconcile (`worker/index.ts`). Once it runs, the
  every-minute `inbox-lanes` and `agent-jobs` crons are only a safety net and can drop to every 10 to 15 minutes.
- If no agency has a connected mailbox, the email poll has nothing to do. That is a one-query gate.
- The daily and hourly jobs (`whatsapp-health`, `whatsapp-billing-sync`, `inbox-retention`, `ai-usage-rollup`, `release-seat-holds`, `inbox-health`) cost under 100 calls a day in total. Leave them alone.

## 3. Job-by-job disposition

The authoritative list is `select jobname, schedule, active from cron.job order by jobname;` in each database. Routes that exist in `app/api/cron/` but were not in the
runbook table (`inbox-health`, `traveller-data-retention`, `onboarding-signup-alert`) must be checked against `cron.job` in slice 0.1.

| Job | Schedule today | Disposition | Slice |
|---|---|---|---|
| `inbox-lanes` | every minute | Worker is primary; cron becomes a 10-minute safety net, gated on queued work | 3, 2 |
| `whatsapp-agent-jobs-drain` (`agent-jobs`) | every minute | Same as `inbox-lanes`; also runs the reconciler, which the worker already runs | 3, 2 |
| `inbox-email-poll` | every 2 min | Move into the worker (timer); cron paused. Until then: gate on "any CONNECTED GMAIL connection" | 4, 2 |
| `inbox-sla` | every 2 min | Gate: run when a conversation has an SLA due or breached; floor call every 10 min | 2 |
| `reply-window-sweep` | every 5 min | Gate: run when a person-owned chat has a window closing within 2 h; floor 30 min | 2 |
| `lead-followups-sweep` | every 10 min | Gate on due follow-ups or open hand-offs; floor 30 min | 2 |
| `departure-ops-jobs-drain` | every 15 min | Gate on due `departure_ops_jobs`; floor 60 min | 2 |
| `finance-ops-sweep` | hourly, **inactive** | No change | none |
| `release-seat-holds`, `ai-usage-rollup`, `inbox-health` | hourly or similar | Leave; re-check cost after the first measure | 0.4 |
| `whatsapp-health`, `whatsapp-billing-sync`, `inbox-retention`, `traveller-data-retention` | daily | Leave | none |
| `cron-route-results`, `cron-history-cleanup` | SQL only | Leave (they do not call Vercel) | none |

## 4. Slices

Order: **0 (today) → 1 → 2 → 3 → 4 → 5 → optional 6**. Each slice is one PR (or one operational change), reversible, with its own verification.
Slices 0 and 1 stop the pause from recurring; 2 and 3 make idle cost near zero; 4 and 5 remove the heaviest per-call work; 6 is the Cloudflare webhook Worker.

### Slice 0: stop the bleeding and measure (operational, hours)

| Step | Action | Verify | Rollback |
|---|---|---|---|
| 0.1 | In **each** Supabase database run `select jobid, jobname, schedule, active from cron.job order by jobname;` and write the result into the progress note. Confirm which database calls which Vercel project (`cron_http_base_url` in Vault, via the service role) | The list matches section 3; any extra job is classified | n/a |
| 0.2 | **Production database: pause every job that calls Vercel.** Nobody uses production, so nothing is lost. `select cron.alter_job(jobid, active := false) from cron.job where command like '%invoke_cron_route%';` (leave `cron-route-results` and `cron-history-cleanup`) | `cron.job` shows them inactive; no new rows in `cron_route_calls` | Re-enable with `active := true` |
| 0.3 | **Staging database:** keep `inbox-email-poll`, `inbox-sla` and the two drains only if staging has real traffic. Otherwise pause as in 0.2. If kept, change every-minute jobs to `*/15 * * * *` with `cron.alter_job(jobid, schedule := '*/15 * * * *')` (decision D3) | Calls per hour fall as expected in `cron_route_calls` | Restore the schedule |
| 0.4 | Set `SENTRY_TRACES_SAMPLE_RATE` and `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` to `0` (or `0.01`) on both Vercel projects | Env diff; fewer Sentry transactions | Restore values |
| 0.5 | After the team is unpaused: record Vercel Usage by route for 7 days, and the cron call counts per job. Write `docs/progress/<date>-vercel-usage-baseline.md` with a top-10 routes by Active CPU | The note exists and orders the later slices | n/a |

Do 0.2 before the pause ends on 16 Nov (or before upgrading), or the team burns the new allowance on the same idle ticks.

> **Decision for the owner (D4).** Hobby is non-commercial only. Either wait out the pause to 16 Nov, or upgrade to Pro now. Upgrading unpauses the team immediately.
> This plan assumes the move to Pro happens at the first real customer regardless.

### Slice 1: `prefetch={false}` on navigation links (code, 1 PR)

Files: `components/app-sidebar.tsx` (about 19 `<Link>`s), the header and any other nav component that renders many links on every page.
Change: add `prefetch={false}` to each link that targets a `force-dynamic` page.
Tests: a component test that renders the sidebar and asserts no link has default prefetch; a snapshot is not enough.
Verify: on a fresh load in staging with `PERF_TIMING=1` (`lib/timing.ts`), the network tab shows no RSC prefetch burst; clicking a link still shows `loading.tsx` at once.
Rollback: revert the prop.

### Slice 2: gate the timers in Postgres (migration, 1 PR)

New migration (next free timestamp, additive, with a `-- Rollback:` line per repo convention):

1. `public.cron_due_work(p_job text) returns bigint` — `security definer`, `set search_path = ''`, `revoke all ... from public, anon, authenticated`, `grant execute ... to service_role`.
   One predicate per job, copied from **that route's own selection query** so the two cannot drift:
   - `inbox-lanes` / `agent-jobs`: count of `channel_jobs` and `agent_jobs` that are due and claimable.
   - `inbox-sla`: conversations with an SLA deadline reached or a repair candidate (`repairMissingEnrichJobs`, `repairMissingMediaJobs` selection).
   - `reply-window-sweep`: person-owned conversations whose window closes within 2 h and have no reminder in the ledger.
   - `lead-followups`: due quiet-lead follow-ups and open hand-off alerts.
   - `departure-ops-jobs`: due `departure_ops_jobs`.
   - `inbox-email-poll`: `count(*)` of `channel_connections` where `provider = 'GMAIL'` and `status = 'CONNECTED'`.
2. `public.cron_gated_invoke(p_job text, p_path text, p_floor interval)` — calls `cron_due_work`; if the count is above zero **or** the last recorded call of this
   path in `cron_route_calls` is older than `p_floor`, it calls `invoke_cron_route(p_path)`. Otherwise it returns without a network call. It writes one counter-only
   line (job name, count, decision) so skipped ticks are visible. No message text, names or phone numbers anywhere.
3. Re-schedule each job from section 3 to `select public.cron_gated_invoke(...)`. **Use `cron.alter_job` on the existing job, never a second `cron.schedule`**, so there is
   still exactly one scheduler per job.

Tests:
- SQL tests: each predicate returns 0 on an empty database and a positive count when one due row exists; the function is not executable by `authenticated` or `anon`.
- `lib/inbox/invoke-cron-route-allow-list.test.ts` still passes (no new route path is added; the allow-list is unchanged).
- A test per predicate that the gate and the route select the **same rows** (seed a due row, assert both see it).
- Tenant check: the predicates count across agencies by design; they return a count only, never rows or ids.

Verify (staging): an idle minute produces no `cron_route_calls` row for gated jobs; inserting one due job produces a call within one tick; stopping the gate (rollback)
returns to the old behaviour. `select * from public.cron_job_health()` stays `OK` (the floor keeps jobs inside "twice the interval").
Rollback: `cron.alter_job` each job back to `select public.invoke_cron_route('/api/cron/<job>')`; drop the two functions.

Risk and guard: a wrong predicate silently stops a job. The floor call is the guard, and `cron_job_health()` reports `STALE` if even the floor fails.
Choose each floor so that a gate bug delays work by at most the floor, not forever.

### Slice 3: stop in-request draining and make the worker primary (deploy + config)

Prerequisite: slice 2 is not required, but the worker is. Follows `runbooks/inbox-worker.md` section 4 exactly.

| Step | Action | Verify | Rollback |
|---|---|---|---|
| 3.1 | `docker build -f worker/Dockerfile -t inbox-worker .` then `worker:check` **inside the image**. The Dockerfile has never run on a Docker daemon | `worker:check` exits 0 | n/a |
| 3.2 | Choose the host (D1): an always-on host in Singapore (same region as Supabase `ap-southeast-1`), two instances, 0.5-1 vCPU and 512 MB-1 GB each, SIGTERM grace at least `WORKER_SHUTDOWN_GRACE_MS` + 10 s. Cost check first: a Fly or Railway pair is small, Cloudflare Containers only if simpler (verify) | Host chosen, monthly cost written in the progress note | n/a |
| 3.3 | Deploy **one** instance with only `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `OPENROUTER_API_KEY` and model settings. Do **not** give it `META_APP_SECRET`, `CRON_SECRET` or verify tokens (the runbook says so on purpose) | `/healthz` ok; `lane_summary` `claimed` and `processed` rise on a test message; oldest REALTIME job is seconds old | Scale to zero; the drains take over |
| 3.4 | Add the second instance | Both healthy | Scale down one |
| 3.5 | Set `INBOX_WORKER_ACTIVE=1` on the Vercel project and redeploy | Webhooks return at once; no `after()` drain logs; reply latency unchanged | Unset and redeploy |
| 3.6 | After a clean week: `cron.alter_job` `inbox-lanes` and `whatsapp-agent-jobs-drain` to `*/10 * * * *` (still gated if slice 2 is in) | `inbox_lane_health` oldest job unchanged; `cron_route_calls` for both drops about 90% | Restore `* * * * *` |

Acceptance: with the worker healthy, an idle hour makes at most a handful of `/api/cron/inbox-lanes` and `/api/cron/agent-jobs` calls, and a customer message still gets a reply in the usual time.

### Slice 4: email poll moves into the worker (code, 1 PR)

Files: `worker/index.ts`, `lib/inbox/worker/config.ts` (new `WORKER_POLL_EMAIL` and `WORKER_EMAIL_POLL_MS`, default 120000), a new loop in `lib/inbox/worker/`
that lists CONNECTED GMAIL connections and calls `pollAgencyMailbox(db, agencyId)` per agency using `forEachAgencyWithinBudget` and the same slice rotation as the route.
Reuse, do not copy: `lib/channels/email/imap-poll.ts`, `lib/inbox/cron-agency-run.ts`.
Concerns to settle in the PR:
- The worker runs two instances; two polls must not collide on one mailbox. Take a per-agency lease (or advisory lock) before polling, as the job queue does. If the existing poll is already safe under overlap (the route runs idempotently), say so with a test.
- IMAP credentials are read from Vault with the service-role key as the web route does; confirm no new environment variable is needed and add the IMAP and `mailparser` runtime to the worker bundle (`worker:build`, then `worker:check`).
- Logs: counts and ids only.
Tests: unit test the loop with a fake `pollAgencyMailbox`; a test that an agency error does not stop others; `worker:check` loads the new path.
Verify (staging): mail still arrives within about 2 minutes; `/api/cron/inbox-email-poll` calls stop after the cron is paused.
Rollback: `cron.alter_job(... active := true)` on `inbox-email-poll` and set `WORKER_POLL_EMAIL=false`. **One scheduler at a time: turn the new one on, then the old one off, then watch.**

### Slice 5: cache reads and trim the request path (code, 3 PRs)

| PR | Change | Files | Tests and verify |
|---|---|---|---|
| 5.1 | Cache the inputs of `getCurrentStaffRole` per user for about 60 s (`unstable_cache` or `use cache`, keyed by user id, tagged), invalidated where roles change. Authorisation in server actions still uses `requireUser()` and RLS, never the cache | `app/(main)/layout.tsx`, `proxy.ts`, the role loader | Query count per navigation falls; a role change shows within the TTL; a test that a removed role is denied after invalidation |
| 5.2 | Per-tenant tagged caching for slow-changing reads (settings, branches, branding, supplier and package lists), `revalidateTag` in the existing server actions. **Cache data, never rendered HTML** | the repositories under `lib/data/` | Cross-tenant test: agency A never sees agency B's cached data; edit then read shows new data |
| 5.3 | Cache dashboard aggregates 30-60 s, or precompute into a table refreshed by a `pg_cron` SQL job | dashboard loaders | Numbers match the live query within the TTL; CPU and query count drop |

Measure first (slice 0.5). If the top-10 routes show these are small once the cron load is gone, defer 5.2 and 5.3.

### Slice 6 (optional, last): Cloudflare webhook Worker (new `cloudflare/webhooks/`)

Do this only after slices 0-5 land and the measurement shows webhook functions are still a material share, or when you want Vercel isolated from inbound traffic.

**Design (two halves, because of 2.2).**

Half A, the Worker (`cloudflare/webhooks/`, `wrangler.jsonc` in the repo, secrets in Cloudflare only):
1. `GET`: answer the Meta verify handshake (needs the verify tokens as secrets).
2. `POST`: read the raw body with the same size bound as `readBoundedWebhookBody`, verify `x-hub-signature-256` with Web Crypto (HMAC-SHA256, constant-time compare) using the app secret for that route, reject with 401 otherwise.
3. Insert the raw event into `whatsapp_webhook_events` or `channel_webhook_events` with the **same dedupe key** the Vercel path uses (`whatsAppWebhookExternalEventId`) via a narrow Supabase RPC (`security definer`, only the columns needed). Do not give the Worker the service-role key; give it an RPC-only role or a scoped key (verify what Supabase supports).
4. Return 200. The Worker holds no business state.

Half B, the processor (Node worker): a new `processPendingRawEvents` loop with `minAge` near 0 that claims unprocessed events with a lease and runs the remaining steps of
`handleWebhookDelivery` (resolve agency, account-state changes, verification mark, ingest, echoes, statuses, charges, enqueue) for each. This requires extracting the post-record
part of `handleWebhookDelivery` into `processStoredWhatsAppEvent(admin, event)`, which both the Vercel route and the worker call (one code path, so behaviour cannot diverge).
Messenger and Instagram get the same treatment through `processMessengerEvents`. Latency target: p95 from Worker 200 to message in the Inbox under 2 s; if that cannot be met with a 1 s poll, add a push (HTTP ping to the worker's port) later.

Cutover per channel, one at a time (WhatsApp, Messenger, Instagram, data-deletion, deauthorize): deploy the Worker on a proxied `hooks.<domain>`; send Meta test deliveries; repoint one callback URL;
keep the Vercel route live as the fallback for a week of clean soak.
Verify: forged and unsigned requests get 401 with no row written beyond the size stub; duplicates are ignored; the raw-event reconciler finds nothing missing; no webhook requests reach Vercel.
Rollback: repoint the Meta callback URL to the Vercel route (instant). The data is already in Postgres.
Security review is mandatory for this slice: signature verification, secret scope, replay and body-size limits.

## 5. Infrastructure and configuration

| Item | Where | Notes |
|---|---|---|
| Node worker, 2 instances | Singapore host (D1) | Env: Supabase URL, service key, OpenRouter key, model vars. Not the webhook or cron secrets |
| Vercel env | both projects | `INBOX_WORKER_ACTIVE=1` (slice 3.5), Sentry sample rates (0.4) |
| Supabase | both databases | Slice 2 migration; pauses and schedules done with `cron.alter_job` |
| Cloudflare (slice 6 only) | `hooks.<domain>` proxied; app domain stays DNS-only (D5) | Secrets: app secrets and verify tokens; no service-role key |
| `.env.example` | repo | Add `INBOX_WORKER_ACTIVE`, `WORKER_POLL_EMAIL`, `WORKER_EMAIL_POLL_MS` with comments, no values |

## 6. Documentation to change as each slice lands

| Doc | Change |
|---|---|
| `docs/runbooks/supabase-scheduling.md` | New "gated" column in the jobs table, the gate function, the floor, and "one scheduler per job" restated |
| `docs/runbooks/inbox-worker.md` | Replace "has not been deployed anywhere yet" with the host, instance count and date; document the email poll loop |
| `docs/architecture/vercel-usage-reduction-plan.md` | Mark D2 revised (gate in Postgres) once approved; link this plan |
| `docs/architecture/README.md` | Link this plan next to the existing row |
| `docs/progress/` | One dated note per slice with before and after numbers |
| New `docs/runbooks/cloudflare-webhooks.md` | Only if slice 6 is built |

## 7. Risks

| Risk | Mitigation |
|---|---|
| A gate predicate is wrong and a job never runs | Predicates copied from the route's own query, a same-rows test, and a floor call that bounds the delay |
| A job runs from two schedulers | `cron.alter_job` on the existing job only; new on, then old off; jobs are already idempotent and lease-based |
| The worker is down and replies are late | Gated cron safety net stays at 10 minutes until the worker has soaked a week; scale to zero is a valid rollback |
| Two worker instances poll one mailbox | Per-agency lease, or proven idempotent under overlap, in slice 4 |
| A cached value leaks across tenants | Key by agency id, cross-tenant test per cached read, never cache rendered HTML |
| A stale role grants access | Short TTL, tag invalidation, authorisation never reads the cache |
| The webhook Worker accepts a forged event | Constant-time HMAC, per-route secret, size bound, only a stub stored for a bad signature; security review before cutover |
| Message loss during webhook cutover | One channel at a time, Vercel route kept live, raw-event reconciler as audit |
| Optimising the wrong thing | Slice 0.5 measures first and may reorder slices 5 and 6 |

## 8. Open decisions for the owner

1. Approve revising D2: **gate in Postgres, Cloudflare for webhooks only** (section 2.1)?
2. Wait for the pause to end on 16 Nov, or upgrade to Pro now (D4)?
3. Worker host and a second instance (D1): which provider, and is about two small instances a month acceptable?
4. Is production live to real customers yet? If not, slice 0.2 is safe to do today.
5. Build slice 6 (webhook Worker) at all, or stop after slice 5 if the numbers are good?

## 9. Measurement

Record before and after each slice in `docs/progress/`:
- Vercel Usage: Fluid Active CPU and invocations by route, for both projects.
- `select jobname, count(*) from cron_route_calls where created_at > now() - interval '1 day' group by 1 order by 2 desc;` (adjust to the table's actual timestamp column).
- `inbox_lane_health`: oldest queued REALTIME job age (must not worsen).
- `select * from public.cron_job_health();` (all `OK`, or `PAUSED` only where intended).
- Worker `lane_summary`: `claimed`, `processed`, `deadLettered`, `unhandled`, `timedOut`.

Done means: an idle week uses under about 1h of Active CPU across both projects, the team is not paused, and no customer-visible behaviour changed.
