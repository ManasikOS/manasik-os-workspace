# Production go-live gate

`npm run verify:production` judges one deployment and prints **PASS**, **FAIL** or **PENDING** for each check (TASK-032 W7). It is the final
verification before launch: the first agency goes live only when it reports PASS, twice, at least 24 hours apart, on the commit that is live.
It reads and probes; it changes nothing except an optional report file.

## Running it

1. Copy `.env.gate.example` to `.env.gate` (ignored by git) and fill in the **required** settings for the deployment you are judging.
   The gate reads only `GATE_*` settings, never the app's own `NEXT_PUBLIC_*` ones, so it cannot silently judge whichever environment
   `.env.local` points at. Each optional setting turns a PENDING check into a real answer.
2. Run it:

   ```bash
   npm run verify:production
   ```

   It needs Node 22.9 or newer (it reads `.env.gate` with `--env-file-if-exists`). The report is printed, and also written to
   `GATE_REPORT_PATH` when that is set.
3. Read the exit code: **0** every check passed; **2** nothing is broken but something is still pending; **1** at least one check failed;
   **3** a required setting is missing.

Until production exists, run it against **staging** with `GATE_EXPECTED_ENVIRONMENT=staging` as a dress rehearsal. Everything except the
production-only comparisons can pass there, so the first production run holds no surprises.

## What it checks

| Check | Passes when | A FAIL usually means | PENDING until |
|---|---|---|---|
| G1 Liveness and build | `/api/health` and `/api/health/ready` answer 200, and the live build is `GATE_EXPECTED_COMMIT` | the app is down, cannot reach its database, or an older build is live | the expected commit is supplied |
| G2 Migrations | every migration file in the repository is applied, and nothing else is, compared by name | a migration was not applied, or the database has something the repository does not (hand-made drift) | n/a |
| G3 Tenant isolation | no tenant table without row-level security, no always-true policy, no server-only table with a client privilege, every tenant storage policy scoped by agency, no anonymous-callable definer function | a tenant boundary was opened; treat as a security incident until understood | n/a |
| G4 Scheduled jobs | no job failing, stale or never run, and `inbox-health` succeeded in the last 10 minutes | the database scheduler or a route is broken; see `cron_job_health()` | n/a |
| G5 Storage | the seven required buckets exist and every bucket is private | a bucket is missing or was made public | n/a |
| G6 Configuration | the deployment says it is the expected environment, has every required setting, has no test-only setting, and (production) shares no secret or identifier with the reference environment | a setting is missing, a test credential is live, or staging and production share a secret | the reference environment is supplied (production only) |
| G7 Worker | the worker's `/healthz` and `/readyz` answer 200 | the worker is stuck or down | a worker address is supplied |
| G8 Webhook security | every webhook refuses forged and unsigned events and a wrong verify token, and answers its real handshake | a webhook accepts a forged event (usually no app secret configured) or its token is wrong | the real verify tokens are supplied |
| G15 Schema matches the repository | every public-schema object (columns, constraints, indexes, triggers, policies, grants, functions, views) has the same hash as in a clean build of the repository (`supabase/schema-fingerprint.json`) | the database is not what the migrations build: a migration recorded as applied whose effect is missing, a hand-made object, or a change made outside migrations. The items name each object that differs, is missing, or is not in the repository | n/a |
| G13 Rollback | at least two ready production deployments exist, so the previous one can be restored | there is nothing earlier to roll back to | a Vercel token and project are supplied |
| G9, G10, G11, G12, G14 | not built yet (TASK-032 S7b and S8): disposable-agency acceptance, Sentry event received, Sentry alert rules, Meta live, alert delivery | | they are built; the gate cannot pass before then |

A check that cannot run is a FAIL with the reason, never a silent pass, and one failing check never stops the others.

## What it does to the target

- Reads: the public health endpoints, `/api/health/config` (with the cron secret), the worker's probes, and `public.gate_snapshot()`, a
  read-only database function that returns names and counts only and is executable by the service role only.
- Writes: each run sends two forged-or-unsigned webhook posts per channel (six in all). The app refuses them and records a small audit stub
  for each (no payload content is kept). It addresses only `sim-` accounts and signs with a fake secret, so it can never reach a real agency.
- Never prints a secret, a configuration value (other than the environment name) or customer data.

## Settings that need your hands

- `GATE_CRON_SECRET`, `GATE_SUPABASE_URL`, `GATE_SUPABASE_SECRET_KEY`: the target environment's own, from its host. Do not paste them into chat or commit them.
- `GATE_VERIFY_TOKEN_*`: the real webhook verify tokens, to prove each handshake works.
- `GATE_VERCEL_TOKEN`, `GATE_VERCEL_PROJECT`, `GATE_VERCEL_TEAM`: a read-only Vercel token for G13.

## The schema baseline (G15)

G2 compares migration NAMES, which cannot see a migration that is recorded as applied but whose effect is missing (staging passed G2 while missing two security protections and fifteen
tables' tenant-uniqueness). G15 compares what the database actually contains. `public.gate_schema_fingerprint()` (migration `20270109090000_gate_schema_fingerprint.sql`, service role
only) returns one 10-character hash per object; the baseline `supabase/schema-fingerprint.json` is the same fingerprint of a database BUILT FROM THE REPOSITORY.

**Whenever you add a migration**, regenerate the baseline, in the same PR: a test (`lib/ops/gate/schema-baseline.test.ts`) fails CI if the baseline does not describe the current migrations.

```bash
bash scripts/local/rebuild-from-migrations.sh        # an empty local Supabase database built from the migrations (wipe the local stack first)
bash scripts/local/write-schema-fingerprint.sh       # writes supabase/schema-fingerprint.json from that local database
```

Never run the second script against a shared environment: the baseline would then record that environment's drift as the intent. The script talks only to a local Docker container.
A function's body is hashed after removing `--` comments and collapsing whitespace, so a comment, an indentation change or a Windows line ending is never reported as drift, only a change in what the function does. A hash is of a definition, not a copy of it, so the baseline holds no data and nothing secret. Apply the migration to each environment you judge, as for `gate_snapshot()`.

## Applying `gate_snapshot()`

G2 to G5 read the database through `public.gate_snapshot()` (migration `20270105090000_gate_snapshot.sql`). Until it is applied to the target
database those four checks fail with "Could not find the function public.gate_snapshot". Apply the migration to each environment you judge.
