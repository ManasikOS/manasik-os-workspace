# Inbox intelligence operations

## Alerts

- REALTIME oldest queued job above 10 seconds: page the on-call engineer; verify cron auth, shard fan-out and per-agency caps.
- STANDARD above 30 seconds or BULK above 15 minutes: warn; check dead letters and provider/model health.
- One agency receives no claim over two ticks while it has due work: treat as lane starvation.
- AI allowance at 80%: notify the owner that drafts become on-demand. At 100% without overage, verify S2/S5 stop while S0/S1 rules, risk and offer matching continue. At 120%, verify all model calls stop and human replies remain available.
- Provider outage: stop blind retries after the adapter classifies a permanent token/funding failure and surface the connection error.

## Replay

1. Identify the affected agency, time range, pipeline version and job kind. Never replay across agencies in one unreviewed command.
2. Confirm the handler is idempotent and no open payment, complaint or stale-price intervention would be bypassed.
3. Enqueue `REPLAY` jobs on BULK with a unique coalesce key and the original subject ids. Observe depth and dead letters.
4. Compare the regenerated projection and queues with the source messages. Record model cost, S0 skip rate and any changed proposal.

## Scale verification

Run `npx tsx scripts/load/inbox-multitenant.ts --execute --profile baseline --seed-fixtures` only in isolated staging. The runner creates 50 uniquely tagged disposable agencies and 200 conversations per agency, then removes only those agencies, conversations, connections and tagged jobs when the run ends. Alternatively, provide exactly 50 disposable agency ids in `LOAD_TEST_AGENCY_IDS`. The runner refuses to write unless `LOAD_TEST_ENVIRONMENT=staging`, `LOAD_TEST_PROJECT_REF` matches `NEXT_PUBLIC_SUPABASE_URL`, and `LOAD_TEST_PROJECT_REF` differs from `LOAD_TEST_PRODUCTION_PROJECT_REF`. When the current project contains only disposable dummy data, its owner may instead set `LOAD_TEST_ENVIRONMENT=disposable` and the exact `LOAD_TEST_DISPOSABLE_CONFIRMATION` documented in `.env.example`; this is an explicit exception, never an implied production override.

Capture the JSON result, delivered Realtime events per inbound event, Inbox Server Action calls per inbound event, webhook p95, queue-age percentiles, database connection use, event-to-visible latency, inbound-visible p95, triage p95, enrichment p95, draft p95, queue-count p95, S0 skip rate, cost per enriched conversation, and the no-noisy-neighbour comparison in a dated file under `docs/progress/`. The script removes only rows carrying its unique `loadRunId`; still take a backup and confirm the project is not production.

### Load profiles (scaling track SC7/SC8)

`--profile` selects the traffic shape (docs/inbox/scaling.md §12.1); every profile is planned by pure, unit-tested functions in `scripts/load/inbox-load-profiles.ts`, and a dry run (no `--execute`) prints the plan without touching the database.

| Profile | Shape | What it proves |
|---|---|---|
| `baseline` | 10,000 jobs queued at once (50 agencies × 200) | Drain rate and fairness under an instant backlog |
| `sustained` | 1,000 jobs/min for `--minutes` (default 10) | Queue age and p95 at the target rate |
| `burst` | 5,000/min for half of `--minutes`, then 1,000/min | Backlog absorption and recovery |
| `noisy-tenant` | 1,000/min, half of it from ONE agency | No other agency is starved (control-agency p95 spread ≤ 20%) |

Options: `--minutes N` (1–60), `--report path.json` writes the machine-readable report. A plan above 100,000 jobs is refused.

Directly inserted jobs do not trigger the after-webhook REALTIME drain a real message does, so without help their latency would measure the once-a-minute pg_cron interval. Set `LOAD_TEST_WORKER_URL` to the deployment that serves the database's cron (and keep `CRON_SECRET` in the environment) and the runner calls `/api/cron/inbox-lanes?lane=REALTIME` every two seconds to mimic those kicks. The report says whether it did (`workerKick`).

The rate profiles pass on the §11.3 queue SLOs: every job done, p95 under 5 s, dead-letter rate under 0.1%, control-agency spread ≤ 20%. Read the report's `queueAge` (oldest waiting job, sampled every 5 s) against the dedicated-worker gate in scaling.md §10.2 before changing any worker parameter, and change one parameter per experiment.

Not covered by this runner: signed webhook ingestion, browser Realtime subscribers, reconnect storms and delivery receipts. Those need a deployed build of the SC1–SC6 code and remain SC8 work.
