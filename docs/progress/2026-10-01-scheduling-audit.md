# Scheduling audit (task T2) — 2026-10-01

Read-only audit for [`tasks/plan.md`](../../tasks/plan.md) T2 (replace Inngest with Supabase-native scheduling). Nothing was changed.
No secret values, customer content or ciphertext are recorded here.

## What was checked, and where

| Source | How | Scope |
|---|---|---|
| Supabase project `klognjpwmqwlgeibvanf` ("Manasik OS", ap-southeast-1) | `execute_sql`, read-only `select`s | `cron.job`, `cron.job_run_details`, `net._http_response`, `vault.secrets` (names only), `inngest_outbox`, triggers, the live `invoke_cron_route` body |
| Vercel project `hajj-umrah-crm` (team `mohamedafrasdev's projects`) | environment-variable **names and targets** only; values were not decrypted | Production and preview |

**Environments.** This Supabase account has exactly **one** project, so there is no separate production database. Earlier docs call it
"staging"; the Vercel production target is the only live consumer I could find. I could not confirm which Supabase project the Vercel
production build points at (its URL variable is a sensitive value). The Vercel team also has a project named `manasik-os`; I did
**not** read it. If the app is deployed from that one, repeat the Vercel half of this audit there.

## Findings

### 1. Live defect: two jobs fail every run (not caused by Inngest)

The live `invoke_cron_route` allows nine paths. It does **not** allow `/api/cron/inbox-sla` or `/api/cron/inbox-retention`, so those
two `pg_cron` jobs raise `invoke_cron_route: <path> is not a recognised cron path` and never call the app.

| Job | Last success | Failures | Since |
|---|---|---|---|
| `inbox-sla` (`*/2`) | 2026-09-28 03:30 UTC | 2,257 (720 in the last 24 h, 0 successes) | 2026-09-28 03:32 UTC |
| `inbox-retention` (daily 02:17) | 2026-09-28 02:17 UTC | 3 (every night since) | 2026-09-29 |

Cause (from the migrations): `20261213090000_em2_inbox_email_poll_cron.sql` redefined the allow-list with nine paths and left these two out.
**Effect today:** the SLA sweep has not run for about three days, and conversation retention has not run for three nights. This
confirms the risk in the plan; it is a live bug that exists with or without the Inngest change.

### 2. Which scheduler runs what

`cron.job` has **11 active pg_cron jobs**. All 11 route jobs below exist, so Inngest schedules are **not** the runner (the I3 cutover script
would have unscheduled them).

| Job | Schedule | Active | Last 24 h (ok / failed) |
|---|---|---|---|
| `whatsapp-agent-jobs-drain` | `* * * * *` | yes | 1440 / 0 |
| `inbox-lanes` | `* * * * *` | yes | 1440 / 0 |
| `inbox-email-poll` | `*/2 * * * *` | yes | 720 / 0 |
| `inbox-sla` | `*/2 * * * *` | yes | **0 / 720** |
| `lead-followups-sweep` | `*/10 * * * *` | yes | 144 / 0 |
| `departure-ops-jobs-drain` | `*/15 * * * *` | yes | 96 / 0 |
| `release-seat-holds` | `0 * * * *` | yes | 24 / 0 |
| `ai-usage-rollup` | `15 * * * *` | yes | 24 / 0 |
| `whatsapp-health-check` | `0 3 * * *` | yes | 1 / 0 |
| `whatsapp-billing-sync` | `0 4 * * *` | yes | 1 / 0 |
| `inbox-retention` | `17 2 * * *` | yes | **0 / 1** |

- **Not scheduled anywhere:** `finance-ops-sweep` and `onboarding-signup-alert`. Neither has ever run on a timer here.
- Every HTTP call recorded in `net._http_response` (974 rows, last ~6 h) answered **200**. Config is correct: both Vault entries
  (`cron_http_base_url`, `cron_http_secret`) exist and the secret matches `CRON_SECRET`.
- About **4,400 scheduler ticks a day** hit the web app (two every-minute drains plus the rest).

### 3. Inngest is configured but only half in use

Vercel **production** has `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` and `INNGEST_ENCRYPTION_KEY`. It does **not** have
`INNGEST_SCHEDULES_ENABLED`, `INNGEST_KNOWLEDGE_INGEST`, `INNGEST_FINANCE_SWEEP_ENABLED`, `INNGEST_DRAIN_CRON`, or any `WORKER_*`
variable.

- Schedules: **off** (matches finding 2).
- Knowledge ingest: **legacy job** (`EMBED_DOCUMENT`); 5 such jobs exist.
- Events: `inngest_outbox` has **5 rows, all sent**, all of kind `inbox/conversation.window_opened`, oldest 2026-09-25. So the reply-window
  reminder is the only thing Inngest actually receives. The three `conversations_window_opened_*` triggers exist.
- The only thing that forwards them is the `agent-jobs` route (the worker is not configured on Vercel).
- Side note: the Inngest keys are stored as readable "encrypted" variables rather than sensitive ones (Vercel flags them
  `readable-secret`). They go away with the removal; if the removal slips, mark them sensitive.

### 4. Worker

No `WORKER_*` configuration on Vercel and the runbook says it is not deployed. **Treat the worker as not deployed.**

### 5. Table growth

- `cron.job_run_details`: **62,419 rows** since 2026-09-08, about 5,000 a day; nothing trims it.
- `net._http_response`: only about 6 hours kept (974 rows). `pg_net` trims it itself, so **no cleanup job is needed for it.**

## Answers to the plan's open questions

| # | Question | Answer from the audit |
|---|---|---|
| D4 | Is Inngest running schedules in production? | **No.** pg_cron runs them. T7 is a no-op (record only). |
| D5 | Is the worker deployed? | **No** (no configuration, runbook agrees). Keep the safety-net drains at their current cadence; do not slow them. |
| D1 | Drain cadence | Still yours to decide. Because there is no worker, the audit supports **keeping every minute**. |
| D2 | Resumable knowledge ingest | Still yours. The audit shows 5 jobs total and the legacy path in use, so the risk is small. |
| D3 | Enable `finance-ops-sweep` | Still yours. It has never run; leave it off unless you want it. |

## Consequences for the plan

1. **T3 is now urgent in part.** The allow-list fix cannot wait for the whole of Phase 1: SLA and retention are failing today. See
   the proposal below.
2. **T6 shrinks:** drop the `net._http_response` cleanup; keep the `cron.job_run_details` cleanup (7 days).
3. **T7 is a no-op** (Inngest schedules were never enabled).
4. **T10/T15 scope is small:** only 5 outbox rows, all sent; nothing to drain before dropping the table.
5. The first move of Phase 1 is a **small hotfix migration** (allow-list only) rather than the full job-set migration.

## Proposed immediate step (needs your approval; this audit did not change anything)

A migration that redefines `invoke_cron_route` with the nine current paths plus `/api/cron/inbox-sla` and `/api/cron/inbox-retention`
(and `finance-ops-sweep` only if you want it), with a contract test. After it is applied, `inbox-sla` and `inbox-retention` recover on
their next tick. Retention will then run its backlog of three missed nights in one go, so check its first run.

---

## T4 verification — 2026-10-01 07:25 UTC (after T3a and T3 were applied)

Task T4 ("apply the job migration and prove each job fires") was reduced by the audit: the migrations were already applied (T3a at about 07:15,
T3 afterwards), so this records the proof. Read-only queries only.

| Job | Schedule | Runs in last hour | Succeeded | Last success (UTC) |
|---|---|---|---|---|
| `whatsapp-agent-jobs-drain` | every minute | 60 | 60 | 07:25 |
| `inbox-lanes` | every minute | 60 | 60 | 07:25 |
| `inbox-email-poll` | every 2 min | 30 | 30 | 07:24 |
| `inbox-sla` | every 2 min | 30 | **5** (all since the T3a fix; last failure 07:14) | 07:24 |
| `lead-followups-sweep` | every 10 min | 6 | 6 | 07:20 |
| `departure-ops-jobs-drain` | every 15 min | 4 | 4 | 07:15 |
| `release-seat-holds` | hourly | 1 | 1 | 07:00 |
| `ai-usage-rollup` | hourly :15 | 1 | 1 | 07:15 |
| `whatsapp-health-check` | daily 03:00 | 0 | – | 03:00 |
| `whatsapp-billing-sync` | daily 04:00 | 0 | – | 04:00 |
| `inbox-retention` | daily 02:17 | 0 | – | 2026-09-28 02:17 (**not yet re-proved**) |
| `finance-ops-sweep` | hourly, **inactive** | 0 | – | never run, as intended |

- **HTTP side:** `net._http_response` holds 167 responses for the last hour, all **200**, none timed out, none with an error. 167 equals the sum of the
  successful runs of the jobs that call the app in that hour (60 + 60 + 30 + 5 + 6 + 4 + 1 + 1), so every successful tick produced one answered request and
  no request went missing. No 401 or 403 appears, so the Vault secret matches `CRON_SECRET`.
- **Reconciler:** the `agent-jobs` route runs `reconcileRawEvents` whenever `INNGEST_SCHEDULES_ENABLED` is not set (code: `app/api/cron/agent-jobs/route.ts`),
  and it is not set, so no separate reconciler job is needed. Confirmed from code, not from a run result (the route returns counts the database does not keep).
- **Vercel limits: not verified.** The Vercel API does not expose the plan's function duration or invocation allowance. No cron route sets `maxDuration`,
  and `invoke_cron_route` waits up to 55 s. About **190 scheduler ticks an hour (about 4,500 a day)** reach the web app. **Action for you:** in the Vercel
  dashboard confirm the plan's default function duration is at least 55 s (or set `maxDuration` on the cron routes in a later task) and that about 4,500
  invocations a day is within the plan.
- **Still open for T4's acceptance:** the first `inbox-retention` run after the fix is at 02:17 UTC on 2026-10-02; check it succeeded and returned 200
  (it will also process the three missed nights).
