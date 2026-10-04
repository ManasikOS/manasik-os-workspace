# Inbox health alerts

How the Inbox tells the team when its background machinery is unhealthy (TASK-028 P1.3). Nothing here sends a customer message or
changes data; it only reads and reports.

## How it works

1. `pg_cron` calls `/api/cron/inbox-health` every five minutes (job `inbox-health`).
2. The route checks, across all agencies:

| Check id | Reported when | Severity |
|---|---|---|
| `cron:<job name>` | a scheduled job is FAILING or STALE (critical) or active but never ran (warning). Paused jobs are ignored | critical / warning |
| `outbox-age` | the oldest due outgoing message has waited over 120 s (warning) or 300 s (critical) | warning / critical |
| `outbox-stuck` | any message has been "sending" for over 10 minutes | warning |
| `outbox-dead-letters` | any outgoing message failed permanently in the last 24 h (the customer did not get it) | critical |
| `job-age:REALTIME` / `STANDARD` / `BULK` | the oldest due background job waited over 60/300/3600 s (warning) or 180/900/14400 s (critical) | warning / critical |
| `job-dead-letters` | any background job failed permanently in the last 24 h | warning |
| `read-failed:<part>` | a part of the system could not be read; unknown is never treated as healthy | critical |

3. Each finding goes to Sentry as one message, grouped by check id, so a problem that lasts an hour is one issue with many events.
   Findings contain counts, job names and ages only. No message text, phone numbers or agency ids.
4. Each run also sends a Sentry **cron check-in** (monitor `inbox-health`). If the check itself stops (the database scheduler is down,
   the app is down), Sentry reports a missed check-in. That is the safety net for every other alert.

The thresholds are in `lib/inbox/health/evaluate.ts` (`HEALTH_THRESHOLDS`) and are covered by tests.

## Set up in Sentry (one time, owner)

Sentry decides who is told. Do this once per Sentry project, after the DSN is set and a test event has arrived (open
`/api/observability/sentry-test` as an ADMIN). Sentry's screens change names now and then; the **conditions and values** below are what
matter, so match those if a label looks slightly different.

**Before you start**
- Create two notification targets in your team's chat or e-mail: an **on-call** channel (people who can act at night) and a **team**
  channel (read during the working day). In Sentry: Settings, Integrations (Slack, Microsoft Teams, e-mail through "Issue Owners" or
  a named member). Until a target exists, an alert can only notify members by e-mail.
- Open **Alerts**, then **Create Alert**, then **Issues**, for rules 1, 2, 4 and 5. Choose the environment shown in each rule.
- Every issue alert has three parts: **When** (a trigger), **If** (filters), **Then** (the notification). Give each rule the name shown.

### Rule 1: Critical Inbox health (on-call, immediately)
- **Environment:** the one you are protecting (`staging` now; add a copy for `production` later).
- **When:** "A new issue is created" **and** "The issue changes state from resolved to unresolved". Add "The issue is seen more than 1 time
  in 1 hour" only if you want every recurrence; leave it off for now.
- **If (all):** "The event's tags match" `inbox_health_severity` **equals** `critical`.
- **Then:** send a notification to the **on-call** channel.
- **Action interval:** at most once per **1 hour** for the same issue.
- **Why:** these are the problems where a customer's message is late or lost, or the system cannot see its own state.

### Rule 2: Warning Inbox health (team, once a day)
- **When:** "A new issue is created".
- **If (all):** tag `inbox_health_severity` **equals** `warning`.
- **Then:** notify the **team** channel.
- **Action interval:** once per **24 hours** for the same issue.
- **Why:** slow queues and aging jobs should be seen, but not wake anyone.

### Rule 3: Health check stopped (on-call)
This is a **Cron monitor** rule, not an issue alert. It is the safety net: if the scheduler or the app is down, no other health alert can
fire.
1. Open **Crons** in the left menu. The monitor `inbox-health` appears after the first check-in (the check runs every 5 minutes, so wait
   up to 10 minutes after the DSN is live).
2. Open the monitor, then **Edit**, then **Alerts**.
3. Turn on notifications for **missed** and **failed** check-ins. Set the failure threshold to **1** and recovery to **1** (the route
   already sets these; confirm they match).
4. Notify the **on-call** channel.
- **Why:** if the monitor never appears, the DSN, the deployed route or the `inbox-health` database job is not working. Check
  `cron.job_run_details` first.

### Rule 4: Webhook and send-path errors (on-call, only when it is a burst)
- **When:** "The issue is seen more than **5** times in **5 minutes**".
- **If (any):**
  - "The event's tags match" `inbox_context` **starts with** `inbox.sendStaffMessage`
  - "The event's attribute matches" `http.url` **contains** `/api/webhooks/`
- **Then:** notify the **on-call** channel.
- **Action interval:** once per **30 minutes** for the same issue.
- **Why:** a single failed webhook is normal (Meta retries). A burst means customers' messages are not arriving or staff replies are not
  leaving.

### Rule 5: Handled failures (team)
- **When:** "A new issue is created".
- **If (all):** tag `handled` **equals** `true`.
- **Then:** notify the **team** channel.
- **Action interval:** once per **24 hours** for the same issue.
- **Why:** these are errors the code caught and turned into a friendly message, so a user saw "something went wrong" but nothing crashed.

### Check that it works
1. Rule 1 and 2: you cannot cause these safely by creating bad data. Use the staging test in **Testing the alert** below.
2. Rule 3: after the first run, the `inbox-health` monitor shows a green check-in.
3. Rule 4 and 5: nothing to do now; they fire on real problems. Confirm each rule shows **Enabled** and lists the right channel.
4. Send the sample notification from each rule (the **Send Test Notification** button) so you know the channel receives it.

### Sentry plan limits
Alert and cron-monitor counts differ by plan. If Sentry refuses a rule, tell the engineer which one and we will merge rules 1 and 2 into
one rule with two actions rather than drop any severity.

## Health endpoints and structured logs (P1.4)

| Endpoint | Meaning | Answers |
|---|---|---|
| web `GET /api/health` | liveness: the app process is serving. Touches no database, so a database blip never restarts a healthy app | `200 {"status":"ok","build":"<7-char commit>"}` |
| web `GET /api/health/ready` | readiness: one trivial database read with a 3-second limit | `200 {"status":"ready"}` or `503 {"status":"not_ready"}`; the body never contains error text or host names |
| web `GET /api/health/config` | configuration: which required settings are present, the environment name, and a short fingerprint of each secret and identifier so staging and production can be compared. **Not public**: it needs `Authorization: Bearer $CRON_SECRET`. Never returns a secret or identifier value (TASK-032 S2) | `200 {"environment","ready","problems","variables",...}`; `ready` is false when something required is missing or a test-only setting is set |
| worker `GET /healthz` | every loop is advancing (503 when one is stuck) | the worker's existing endpoint, port `WORKER_PORT`/`PORT` (default 8080) |
| worker `GET /readyz` | started and not draining | the worker's existing endpoint |

All four are public by design and carry no customer or configuration data. Point an uptime monitor at `/api/health/ready` for the web app
and the platform health check at the worker's `/healthz`.

Web logs are one JSON line per event, matching the worker: `{"ts","level","event",...}`. Filter on `event` (for example
`inbox.action_failed`, `inbox.health.checked`, `health.ready.database_failed`). Every string field is scrubbed of phone numbers, e-mail
addresses and tokens before it is written. Use `logEvent` from `lib/observability/log.ts` for new log lines; do not log message text.

## Release order

1. Deploy the route (this PR). It can be called by hand without the schedule:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/inbox-health` returns `{"status":"healthy","findings":[]}`.
2. Apply migration `20261229090000_cron_inbox_health.sql` (adds one allowed path and schedules the job).
3. Confirm in `cron.job_run_details` that `inbox-health` succeeds, then confirm the Sentry check-in appears.

## Testing the alert

On staging only (never on production, once it exists): make one job fail (for example point its `cron_http_base_url` Vault entry at a path that
answers 500, or stop the web app) and confirm a `cron:<job>` issue arrives within about two intervals. Pausing a job does not
work as a test, because paused jobs are ignored on purpose. Never test by creating dead-letter rows in an environment with real customers.

## Rollback

`select cron.unschedule('inbox-health');` stops the check. The route stays harmless. Re-apply the `invoke_cron_route` body from
`20261226090000_cron_reply_window_sweep.sql` to drop the allowed path.
