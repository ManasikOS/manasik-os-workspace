# TASK-029 Inbox staging environment and the path to production

## What

Make the existing Supabase project and Vercel deployment a proper **staging** environment for the Inbox, then use it to prove the
three things the repository cannot prove today: that the code works in a real browser against real providers, that one agency can never
see another's data, and that the repository can build a production environment from nothing.

This is Phase 2 of [TASK-028](TASK-028-inbox-production-readiness-remediation.md). It builds no product feature. The code changes are
small and listed in "Code changes".

## Why

- **Decision (2026-10-02): the current Supabase project and Vercel deployment are staging.** There are no live users. Real production
  does not exist yet and will be a new Supabase project and Vercel target, created later from this repository, with its own secrets and
  its own live Meta app. Nothing in staging is ever copied into it.
- Earlier drafts of this plan treated the current project as production and called for a second, separate non-production project. That
  is no longer needed: the cost and Meta test-app questions are answered (the owner pays for Supabase Pro and Vercel Pro and owns the
  Meta test app), and acceptance tests may run here.
- The product is **multi-tenant with one shared set of environment variables** for every tenant. App-level secrets (Meta app credentials,
  `CRON_SECRET`, the service key) are the same for all agencies; per-agency tokens live in the database. So the only things separating
  agencies are the application code and row-level security, which makes isolation testing the highest-value work here.
- Migrations have only ever been applied to this one project, partly by hand. Nobody has proved they build a working database from
  nothing. That proof is also the production plan, because production will be created from them.

## What staging holds today (read-only check, 2026-10-02)

3 agencies, 5 conversations, 62 messages, 5 channel connections (Gmail, Instagram, Messenger, WhatsApp) and 8 auth users. The channel
connections are real provider accounts, so a test send goes out for real. 218 of 220 repository migrations are applied by name; the two
that are not are `inbox_unread_count` (its code is already deployed) and `cron_inbox_health`. The deployment's health endpoints answer
200 on build `b3721ff`.

## What already exists (reuse, do not rebuild)

| Asset | Where | What it gives us |
|---|---|---|
| Browser acceptance harness and specs | `playwright.config.ts`, `e2e/*.spec.ts` (32 tests, TASK-030) | Refuses to run unless `INBOX_E2E_ENVIRONMENT` is `staging` or `disposable` and the project ref differs from `INBOX_E2E_PRODUCTION_PROJECT_REF` |
| Fixture seeder | `scripts/e2e/seed-inbox-lr2-fixtures.ts` | Dry run by default, `--execute` writes; seeds Agency A and B conversations; does **not** create accounts |
| Acceptance runbook | `docs/runbooks/inbox-launch-readiness-acceptance.md` | The golden flow, failure feedback, accessibility, Realtime and isolation steps, evidence record |
| Load harness | `scripts/load/inbox-multitenant.ts` | Refuses production by project ref (`LOAD_TEST_*` variables) |
| Database checks | `supabase/tests/database/*.test.sql` (pgTAP) and `scripts/sql/verify-*.sql` | Cross-agency denial for evidence and voice transcripts; many verification scripts that roll back |
| Scheduling runbook | `docs/runbooks/supabase-scheduling.md` | `set_cron_http_config()` and the Vault entries each environment needs |
| Migration history aligner | `scripts/sql/align-migration-history.sql` | Documents that version stamps differ from file names for 18 migrations |
| Meta app review runbook | `docs/runbooks/whatsapp-app-review-submission.md` | The production Meta submission process |

## Hard rules

1. **Staging data is disposable; production data never touches staging, and staging data never goes to production.**
2. **Tests work in two disposable agencies of their own** (names prefixed `E2E-`). They never edit the three existing agencies.
3. **Test sends go only to the owner's own test contacts**, because staging's channel connections are real provider accounts.
4. **Fresh secrets for production.** No key, token or secret from staging is reused in production.
5. **One-way flow once production exists:** every change is applied to staging first, accepted there, and only then to production.
6. **Credentials live in a password manager or CI secret store**, never in git, chat or docs. The repository holds variable names only.

## Phases

### P2.0 Name the environment correctly (day 0)

- In Vercel set `SENTRY_ENVIRONMENT=staging` (and `NEXT_PUBLIC_SENTRY_ENVIRONMENT=staging`), and add the Sentry DSN variables
  (`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`); none was found on 2026-10-02, so Sentry is silent until they exist.
- For the test harnesses set `INBOX_E2E_ENVIRONMENT=staging` and `LOAD_TEST_ENVIRONMENT=staging`. Set the `*_PRODUCTION_PROJECT_REF`
  variables to a value that cannot equal staging's ref until production exists, then to production's real ref.
- Take a schema-only snapshot of staging (read-only, no data) and keep it outside git. It is the baseline for P2.2.

### P2.1 Bring staging up to date (day 1)

**Done on 2026-10-02.** With the owner's go-ahead, the two pending migrations were applied to staging: `20261228090000_inbox_unread_count` and
`20261229090000_cron_inbox_health` (deploy-then-migrate order, which is already satisfied for both). Confirm: unread counts rise on an
inbound message and clear on read; the `inbox-health` job exists and succeeds; the Sentry cron check-in appears.
**Exit:** staging has all 220 migrations by name.

### P2.2 Prove the repository can build production (days 1 to 3)

1. Create a **Supabase preview branch** from this project (it builds a fresh database from the repository's migrations) or a throwaway
   project. A branch costs money; the owner confirms the cost first. Delete it afterwards.
2. Apply all 220 migrations in order with the Supabase CLI or branch build and **no hand edits**.
3. Expect failures and treat each as a finding. Staging was partly built by hand (buckets, Vault entries, history stamps), so a clean
   rebuild may expose a migration that depends on something it never creates. Fix with a new additive migration or a documented manual
   step; never edit an applied migration.
4. Create or confirm the private storage buckets (`inbox-attachments`, `content-vault`, `knowledge-base`, `payment-proofs`).
5. Confirm the same pg_cron jobs exist and `cron_job_health()` reports none FAILING after 15 minutes.

**Exit:** a schema-only dump of the fresh build differs from the P2.0 staging snapshot in nothing but object ids and migration-history
version stamps (compare by migration **name**). Record the empty diff, or each documented difference, in `docs/progress/`.

### P2.3 Seed identities and fixtures (days 3 to 4)

1. Create two disposable agencies on staging, `E2E-Agency-A` and `E2E-Agency-B`, and Auth users by hand or the admin API (the seeder
   never creates accounts): in A, `A1` and `A2` (Inbox-capable), `A_READONLY` (denied write), **Finance**, **CEO** (read-only on
   evidence) and an **unprivileged role** (Operations or Guide); in B, `B1`.
2. Extend `scripts/e2e/inbox-lr2-fixtures-config.ts` and `.env.example` with the extra identities and the TASK-030 fixture variables
   (`INBOX_E2E_A_SEARCH_TERM`, `INBOX_E2E_B_SEARCH_TERM`, `INBOX_E2E_A2_NAME`, `INBOX_E2E_TEMPLATE_NAME`). Names only; values go in
   `.env.local` or a CI secret store.
3. Run the seeder as a dry run, read the plan, then `--execute`. Re-running resets fixtures.
4. Add synthetic fixtures the open slices need: a receipt and a passport image, a voice note, a departure group, an open payment-claim
   review, a disallowed file and an oversize file. All made up; no real documents.
5. The owner names the test contacts and numbers that may receive messages; the fixtures' contacts use only those.

**Exit:** the Playwright harness signs in as each identity, and the seeded conversations load for the right agency only.

### P2.4 Prove tenant isolation (days 4 to 6)

1. Run the two existing pgTAP files against staging, and the relevant `scripts/sql/verify-*.sql` scripts (they roll back).
2. Add checks for the surfaces that have none, each asserting **all four** of: same-agency allowed, cross-agency denied, unauthorised
   role denied, anonymous denied: `conversations`, `conversation_messages`, `outbox_messages`, `channel_jobs`, `message_attachments`;
   the Storage policies for `inbox-attachments`, `payment-proofs` and `content-vault`; `realtime.messages`; and the SECURITY DEFINER
   and `service_role` functions (`cron_job_health`, `invoke_cron_route`, the enqueue RPCs), each unreachable by `anon` and
   `authenticated`.
3. Run the Supabase security and performance advisors and attach the report.
4. Run the LR2 isolation steps with Agency A and B signed in at once, then the TASK-030 search and view isolation tests.

**Exit:** all assertions pass, including the MED-01 RLS test the checklist lists as unrun, and the advisor report has no unreviewed
security finding.

### P2.5 Worker and Meta test round trip on staging (days 5 to 8)

1. Deploy the worker from `worker/Dockerfile` to a host with the staging `SUPABASE_SECRET_KEY` and project URL. Confirm `/healthz` and
   `/readyz` answer 200, then set `INBOX_WORKER_ACTIVE=1` on the staging deployment. Kill it mid-batch and confirm the scheduled drain
   still sends each message once (TASK-028 P3.4).
2. With the owner's Meta test app and test numbers: an inbound message appears for the right agency, an outbound reply reaches only the
   test recipient, delivery status updates arrive, and a duplicate webhook delivery creates no duplicate (TASK-028 P3.3).
3. Add Messenger and Instagram test users only if those channels are part of the acceptance run.

**Exit:** one round trip each way on WhatsApp with the provider message id in the protected evidence record, and the worker kill test
passes.

### P2.6 The path to production (owner; start the long items now)

Production is a new environment created from the repository. This is the go-live checklist, in order:

1. **Start the production Meta app review now.** A live Meta app with Embedded Signup needs app review and likely business
   verification, which can take weeks and is the longest lead time here. Follow `docs/runbooks/whatsapp-app-review-submission.md`.
2. Create the production Supabase project (Pro) and Vercel target. Recommended: a **separate Vercel project** for production, so the
   current project keeps serving staging and a wrong variable can never point one at the other; the alternative is to repoint this
   project's Production variables at the new database, which is simpler but easier to get wrong.
3. Apply all migrations to the new database (proved in P2.2). Review `scripts/sql/align-migration-history.sql` first; it is for the
   staging history, not for a fresh database.
4. Set fresh production environment variables: Supabase keys, `CRON_SECRET`, Sentry (`SENTRY_ENVIRONMENT=production`), the live Meta app
   credentials and verify tokens, `OPENROUTER_API_KEY` with its own spend cap. `INBOX_WORKER_ACTIVE` only after a production worker runs.
5. Run `set_cron_http_config()` with the production URL and secret; confirm the cron jobs succeed.
6. Domain and TLS, Meta webhook URL and tokens, agency feature flags defaulted off, first agency created by hand.
7. Run the TASK-030 acceptance subset against production with its own disposable agency, then remove it.
8. Rehearse rollback (TASK-028 P3.8), name two on-call owners, then release to the first real agency.

## Code changes (small, each its own PR)

1. **Fixtures config:** extra identities and TASK-030 variables in `scripts/e2e/inbox-lr2-fixtures-config.ts`, its test and
   `.env.example`.
2. **Isolation checks:** new pgTAP files under `supabase/tests/database/`.
3. **Staging banner (recommended):** a visible "Staging" strip driven by a public environment variable, so staging is never mistaken
   for production once both exist. Uses existing shadcn components and the project's design rules.
4. **Outbound allow-list (recommended, needs your approval):** an environment variable listing the only recipients a staging
   deployment may send to, enforced in `lib/inbox/outbound/authorize-provider-send.ts` (the one place every send passes). It turns
   "test contacts only" from a habit into a guard, which matters because staging's connections are real. It touches the send path, so
   it gets its own PR and tests.
5. **CI job (optional, later):** run the pgTAP suite against a throwaway local database in GitHub Actions.

No schema change is planned. If P2.2 finds a migration that cannot rebuild, the fix is an additive migration with its own RLS and
isolation test, per the repository rules.

## Decisions

Answered: the owner pays for Supabase Pro and Vercel Pro; the owner owns the Meta test app; the current project is staging.

Still open:
1. Which contacts and numbers may receive test messages from staging.
2. ~~May the two pending migrations be applied to staging (P2.1).~~ Done 2026-10-02.
3. Cost confirmation for the Supabase preview branch used in P2.2.
4. Whether to build the outbound allow-list (code change 4).
5. When to start the production Meta app review (P2.6 step 1), and who completes business verification.
6. Separate Vercel project for production, or repoint this one (P2.6 step 2).

## Test plan

- **Automated:** isolation assertions (P2.4); the fixtures-config unit test; the existing harness and the 32 browser tests (TASK-030).
- **Environment proof:** the empty schema diff (P2.2), the health endpoints, the worker kill test and provider round trip (P2.5).
- **Browser:** the TASK-030 specs and the LR2 golden flow, run against the deployed staging build.

## Risks

| Risk | Mitigation |
|---|---|
| A migration cannot build from scratch | That is a finding, not a failure of the plan. Fix additively; record it in `docs/progress/` |
| A test message reaches a real person | Rules 2 and 3; the optional outbound allow-list; the owner's own test contacts only |
| A test edits one of the three existing agencies | Tests use `E2E-` agencies only; the seeder is scoped to them |
| Staging and production drift apart | One-way promotion; periodic schema diff; a staging banner |
| Meta review takes longer than the build | Start it first (P2.6 step 1); it is not on the engineering critical path |
| Shared secrets across tenants leak | One set per environment; fresh for production; never in git; rotate on any suspicion |

## Estimate

About 8 working days for one engineer for P2.0 to P2.5, with P2.5 overlapping P2.3 and P2.4. P2.6 is mostly waiting (Meta review) and
owner configuration.

## Done when

- Staging has all 220 migrations by name, and its Sentry environment is `staging`.
- A fresh build from the repository matches staging's schema, or every difference is documented.
- The Playwright harness signs in as all seeded identities, and Agency A never sees Agency B in the browser or the database tests.
- Health endpoints answer 200 on staging and the worker; the worker kill test passes.
- One WhatsApp round trip is recorded with the Meta test number.
- The production go-live checklist is accepted by the owner and the Meta review has started.

## Status

Replanned on 2026-10-02 around the staging decision. Nothing in P2.0 to P2.6 is started. Waiting on the open decisions above, mainly the
safe test contacts. P2.1 is done: both pending migrations were applied to staging on 2026-10-02 and verified (the `inbox-health` job ran and answered 200).
