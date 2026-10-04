# Supabase scheduling: `pg_cron` jobs, setup, pause, monitor, roll back

Decision R9 ([`architecture.md`](../inbox/architecture.md) §16). Plan: [`supabase-native-scheduling-plan.md`](../inbox/supabase-native-scheduling-plan.md);
build order: `tasks/plan.md`.

> **Status: live, and the only scheduler.** `pg_cron` runs every scheduled job. Inngest has been removed from the app (T13 to T15, decision R9):
> no route, no packages, no settings, and the database objects that fed it are dropped by migration `20261227090000_drop_inngest_outbox.sql`.
> The old runbook is kept only as a pointer ([`inngest.md`](inngest.md)).

## How it works

```
pg_cron (every N minutes) → public.invoke_cron_route('/api/cron/<job>') → pg_net HTTP GET → the web app route
                                    ▲
         Supabase Vault: `cron_http_base_url`, `cron_http_secret` (must equal this deployment's CRON_SECRET)
```

- Every scheduled route is a plain `GET` guarded by `Authorization: Bearer $CRON_SECRET`. The route does the work; the database
  only fires the request.
- `invoke_cron_route` has an **allow-list** of paths. A path that is not on it raises an error, so it can never become an open
  "call any URL" function. It is executable by the service role only.
- Each job is idempotent and lease-based, so a late, repeated or overlapping run is harmless.
- **One scheduler per job.** `pg_cron` is the only scheduler. Never run a job from `pg_cron` and another system at once.

## One-time setup per environment

Run with the `service_role`, from the SQL editor or the CLI. Re-run whenever the deployment's domain or `CRON_SECRET` changes.

```sql
select public.set_cron_http_config(
  'https://<this deployment, no trailing slash>',
  '<the exact value of this deployment''s CRON_SECRET>'
);
```

Until this has been run, every job fires, finds no config, logs a warning and does nothing. It never guesses a URL or skips the
auth header. After running it, confirm one job answers `200`, not `401` (see "Check that a job works").

## The jobs

Schedules are UTC. Cadence of the two drains is decision D1 in `tasks/plan.md` and may change.

| Job name | Route | Schedule | Notes |
|---|---|---|---|
| `whatsapp-agent-jobs-drain` | `/api/cron/agent-jobs` | `* * * * *` | Safety-net drain; also runs the raw-event reconciler |
| `inbox-lanes` | `/api/cron/inbox-lanes` | `* * * * *` | Safety-net lane drain |
| `inbox-sla` | `/api/cron/inbox-sla` | `*/2 * * * *` | |
| `inbox-email-poll` | `/api/cron/inbox-email-poll` | `*/2 * * * *` | Already on `pg_cron` today |
| `lead-followups-sweep` | `/api/cron/lead-followups` | `*/10 * * * *` | |
| `departure-ops-jobs-drain` | `/api/cron/departure-ops-jobs` | `*/15 * * * *` | |
| `release-seat-holds` | `/api/cron/release-seat-holds` | `0 * * * *` | |
| `ai-usage-rollup` | `/api/cron/ai-usage-rollup` | `15 * * * *` | |
| `whatsapp-health-check` | `/api/cron/whatsapp-health` | `0 3 * * *` | |
| `whatsapp-billing-sync` | `/api/cron/whatsapp-billing-sync` | `0 4 * * *` | |
| `inbox-retention` | `/api/cron/inbox-retention` | `17 2 * * *` | |
| `finance-ops-sweep` | `/api/cron/finance-ops-sweep` | `0 * * * *` | **Created inactive.** Has never run in production; enabling it is a deliberate decision (D3) |
| `reply-window-sweep` | `/api/cron/reply-window-sweep` | `*/5 * * * *` | Reminds the owner of a person-owned chat whose reply window closes within 2 hours and is unanswered. Replaces the Inngest reminder; both share one ledger, so they cannot notify twice |
| `cron-route-results` | SQL: `public.cron_collect_route_results()` | `*/5 * * * *` | Copies each call's HTTP answer from `net._http_response` onto `cron_route_calls` before pg_net discards it |
| `cron-history-cleanup` | SQL: `public.cron_history_cleanup()` | `37 3 * * *` | Deletes `cron.job_run_details` and `cron_route_calls` rows older than 7 days |

The authoritative list is `select jobname, schedule, active from cron.job order by jobname;`. If it differs from this table,
the database wins and this page is wrong: fix the page.

## Pause and resume a job

Pausing keeps the job and its history; use it to stop a misbehaving job quickly. Takes effect on the next tick.

```sql
-- pause
select cron.alter_job((select jobid from cron.job where jobname = 'inbox-sla'), active := false);
-- resume
select cron.alter_job((select jobid from cron.job where jobname = 'inbox-sla'), active := true);
```

Pausing a drain is safe: the always-on worker (if deployed) and the next resume catch up from the queue. Pausing `inbox-sla` or
`inbox-email-poll` delays SLA breaches and new mail until resumed, so tell the people affected.

## Check that a job works

```sql
-- the scheduler side: did it run, and did it succeed?
select jobid, status, start_time, end_time, return_message
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'inbox-sla')
 order by start_time desc limit 5;

-- the web side: what did the app answer? (status_code should be 200)
select id, status_code, created
  from net._http_response
 order by created desc limit 10;
```

- `401` or `403`: the Vault secret does not equal `CRON_SECRET`. Re-run the setup above.
- `404`: the route does not exist in this deployment (deployed an old build) or the path is wrong.
- `5xx`: read the route's runtime logs. The next tick retries; `select * from public.cron_job_health()` reports a job that failed twice in a row as `FAILING` (see Monitoring).
- No row at all: the job is paused, the Vault config is missing, or the path is not on the allow-list.

Run output and logs carry **counts and ids only**, never message text, names, phone numbers, passports or prices.

## Monitoring

Read it with the service role (SQL editor or the service key); it is not open to staff sessions:

```sql
select jobname, state, reason, last_success_at, consecutive_failures, last_http_status, consecutive_http_failures
  from public.cron_job_health()
 order by (state = 'OK'), jobname;
```

| State | Meaning |
|---|---|
| `OK` | Ran, and its last success is within twice its interval |
| `STALE` | No success in more than twice its interval (an interval is known for every-minute, every-n-minutes, hourly and daily schedules) |
| `FAILING` | The scheduler reported an error on the last 2 runs, **or** the web app answered with an error (or not at all) on the last 2 calls |
| `PAUSED` | The job is switched off (for example `finance-ops-sweep`, deliberately) |
| `NEVER_RUN` | Scheduled but has not run yet (a new job, for example `cron-history-cleanup` until 03:37 UTC) |

- pg_cron records only that the database call ran; whether the web app answered is in `public.cron_route_calls`, filled in every 5 minutes.
  A route that answers 500 every minute still shows "succeeded" in `cron.job_run_details`, but `cron_job_health()` reports it `FAILING`.
- `cron_route_calls` holds route names, request ids and status codes only, never content. It is private (row-level security, no policy).
- **No alert is wired yet.** `cron_job_health()` is what an alert would read; where an alert should go (in-app, email, or on-call) is still to
  be decided. Until then, check it daily and after every deploy. A job in any state other than `OK` that you did not expect needs action.
- Old rows are removed by `cron-history-cleanup` (7 days).

## Roll back

There is no second scheduler to fall back to, and no flag to flip. Recover by problem:

- **One job misbehaves.** Pause it (see "Pause and resume a job") and fix the route. Nothing else changes; every job is idempotent and catches up when resumed.
- **The call-recording change misbehaves** (`invoke_cron_route`). Re-apply the previous body from `20261224090000_cron_finance_ops_sweep_inactive.sql` (twelve
  routes, no recording; add `reply-window-sweep` back if that job should still run) and `select cron.unschedule('cron-route-results');
  select cron.unschedule('cron-history-cleanup');`. Jobs keep running; only job health goes blank.
- **The reply-window sweep misbehaves.** `select cron.unschedule('reply-window-sweep');`. There is no other reminder path any more, so tell staff to watch
  the "Needs reply" and "Nearing deadline" views by hand until it is fixed. Nothing is sent to customers by this job, so a pause only delays reminders.
- **A bad deploy.** Redeploy the previous build in Vercel (Promote the earlier deployment). The database changes are additive (the one removal, the Inngest
  outbox, held only delivered event ids) and safe to leave. A build from before the Inngest removal still starts: it would only find its outbox calls failing.
- **Wanting a workflow engine back.** Restore the code from git history (the `lib/inbox/inngest` folder, the commit before "remove Inngest from the app") and the
  database objects from `20261204090300_i1_inngest_outbox.sql`, `20261204091000_e1_outbox_purge_and_orphan_uploads.sql` and
  `20261204090900_i4_reply_window_reminder.sql`. Never run it next to `pg_cron` for the same job.

## Things that are easy to get wrong

- **Two schedulers.** If `INNGEST_SCHEDULES_ENABLED` is set while the `pg_cron` job exists, the job runs twice. Always: new
  scheduler on, then old scheduler off, then watch.
- **Allow-list drift.** A new route needs its path added to `invoke_cron_route` in a migration, or its job raises an error.
- **Secret drift.** Changing `CRON_SECRET` in the app without re-running `set_cron_http_config` makes every job answer `401`.
- **Table growth.** `cron.job_run_details` and `cron_route_calls` grow without limit unless `cron-history-cleanup` exists and runs. `net._http_response` trims itself.
- **Release order for a new route.** Deploy the route first, then add its job. If the job goes first it calls a path the app does not have yet and every run answers 404.
- **Adding a route to the allow-list.** Redefine `invoke_cron_route` with the full list and keep the call-recording block, or the new job will not appear in job health. `lib/inbox/invoke-cron-route-allow-list.test.ts` fails if a scheduled route is missing from the latest definition.
