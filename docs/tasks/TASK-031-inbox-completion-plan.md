# TASK-031 Inbox completion plan

## What
The single list of everything still open before the Inbox is fully complete and live in production. It replaces scattered "left to do" notes
in TASK-028, TASK-029 and TASK-030; those stay as the detailed references and each item below points to its owner doc.

## Why
Code and database security are done and merged (Phase 0 and 1 fixes, health endpoints, Sentry wiring, tenant-isolation fixes F1 to F3). What
is missing is proof in a real environment and the production setup. Nothing below adds new features.

## Data model changes
None planned. If the clean rebuild (item B1) finds a migration that cannot build from scratch, the fix is an additive migration with its own
RLS and isolation test. Removing the four staging-only `package_*` tables (item D2) is a migration only if the owner decides to drop them.

## Access control changes
None. Item D3 hardens existing guards to fail closed; it does not change who can do what.

## How to read this plan
Each item has an owner: **You** (needs your account, money or a decision), **Me** (I can do it once unblocked), or **Both**. Items are in the
order they should happen. "Blocked by" names what must finish first.

---

## A. Start now (long waits, no engineering needed)

| # | Item | Owner | Done when |
|---|---|---|---|
| A1 | **Start the production Meta app review** (WhatsApp, Instagram, Facebook Messenger permissions, business verification). Review takes days to weeks and is likely the longest wait. Ref: TASK-029 P2.6 step 1 | You | Meta shows the app approved for live use, or you hold a dated submission receipt |
| A2 | **Done 2026-10-02.** Sentry variables set in Vercel (`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT=staging`) and redeployed. `/api/observability/sentry-test` (PR #207) answered `sent: true`, environment `staging`. Still to tick: the event is visible in Sentry Issues | You | A deliberate test error appears in Sentry tagged `staging` |
| A3 | **Name the safe test contacts and numbers** that may receive messages from staging (your own phone, your own test accounts). Ref: TASK-029 open decision 1 | You | List written in TASK-029; nobody else is ever messaged |
| A4 | **Decide GitHub enforcement:** upgrade the plan so `inbox-ci` and `packages-ci` are required to merge, or accept advisory CI | You | Branch protection on `main` with both checks required, or the decision recorded |
| A5 | **Decide whether to drop the four staging-only `package_*` tables** (`package_content`, `package_faqs`, `package_media`, `package_seo_analyses`) | You | Decision recorded; if drop, I add the migration (D2) |

## B. Prove it works on staging

| # | Item | Owner | Blocked by | Done when |
|---|---|---|---|---|
| B1 | **Clean-rebuild proof (TASK-029 P2.2).** Build a fresh database from the 220 migrations with no hand edits; compare schema, buckets and cron jobs with staging; fix each failure additively. Needs a Supabase preview branch ($0.01344/hour, about $0.32/day, deleted afterwards) | Both: you confirm the cost, I run it | Cost confirmation | Empty schema diff, or each difference documented in `docs/progress/` |
| B2 | **Seed two `E2E-` agencies** with the fixture seeder (`scripts/e2e/seed-inbox-lr2-fixtures.ts`) so tests never touch your three real agencies | Me | A3 | Two agencies, their users and conversations exist; the seeder touched nothing else |
| B3 | **Run the 32 Playwright specs** against deployed staging; triage every failure as an app bug, a spec bug, or a fixture gap; fix and rerun until green | Me | B2 | 32 of 32 pass, results recorded in `docs/progress/` |
| B4 | **Two-agency browser isolation test:** a staff user from agency A cannot see, open, search or act on agency B's conversations, documents or settings through the UI | Me | B2 | New spec passes and is in CI's browser list |
| B5 | **Write the missing acceptance groups** O4, B4, C4 to C9, X and F from TASK-030 and run them | Me | B3 | Every step in the TASK-030 matrix has a passing spec or a recorded manual result |
| B6 | **Worker kill test:** stop the worker mid-send, restart it, confirm no message is lost or duplicated. Ref: TASK-029 P2.5 | Me | B3 | Outbox drains exactly once; recorded |
| B7 | **Provider round trip on staging:** send a message from the Inbox to a test number from A3 and receive a reply back into the thread, on the Meta test app | Both | A3 | Outbound delivered, inbound appears, status updates arrive; recorded |
| B8 | **Confirm alerts fire:** force a stuck outbox and a failing cron on staging and check the alert reaches you; verify retention catch-up | Both | A2 | Both alerts received; retention job log shows catch-up |

## C. Monitoring and process

| # | Item | Owner | Blocked by | Done when |
|---|---|---|---|---|
| C1 | **Create the five Sentry alert rules** from `docs/runbooks/inbox-health-alerts.md` (step-by-step settings are written there) and set who receives them | You | A2 (done) | Five rules exist; a test alert reaches the named people |
| C2 | **Confirm the outbox alert limits** (queue age and size thresholds) with real traffic numbers | You | B7 | Thresholds confirmed or changed in the runbook |
| C3 | **Name two on-call owners** and write the escalation path | You | None | Names in the runbook |
| C4 | **Rehearse rollback** (TASK-028 P3.8): redeploy the previous build and revert a migration plan on staging | Both | B3 | Rehearsal timed and recorded |

## D. Remaining security hardening (from the isolation audit)

| # | Item | Owner | Done when |
|---|---|---|---|
| D1 | **Twelve server-only tables:** confirm none is ever read with a signed-in user's session; add a test that no policy grants them to `authenticated` | Me | Test passes; audit doc updated |
| D2 | **Drop the four `package_*` tables** (only if A5 says drop) | Me | Additive migration applied, repo and staging match |
| D3 | **Rewrite the package wrappers' `current_staff_role() not in (...)` guards** to fail closed on their own, with a pgTAP case for a no-agency and a suspended-agency caller | Me | Migration applied to staging, plan passes |
| D4 | **Re-run `scripts/sql/verify-tenant-isolation.sql`** on staging and on the production database before launch | Me | Zero findings, output saved in `docs/progress/` |

## E. Production go-live (TASK-029 P2.6)

| # | Item | Owner | Blocked by | Done when |
|---|---|---|---|---|
| E1 | **Create the production Supabase project** (Pro plan) | You | B1 | Project exists in the right region |
| E2 | **Create or repoint the Vercel project** for production, with its own domain and TLS | You | None | Production URL serves a build |
| E3 | **Set fresh production environment variables:** Supabase keys, `CRON_SECRET`, Sentry (`SENTRY_ENVIRONMENT=production`), live Meta credentials and verify tokens, `OPENROUTER_API_KEY` with its own spend cap. Never copy staging secrets | You (I give the checklist) | E1, E2, A1 | All set; `INBOX_WORKER_ACTIVE` stays off until E6 |
| E4 | **Apply all migrations to production** and create the private storage buckets | Me, with your go-ahead | E1, B1 | Schema diff matches the proven build; buckets exist |
| E5 | **Run `set_cron_http_config()`** with the production URL and secret; confirm the cron jobs succeed | Me, with your go-ahead | E3, E4 | `cron_job_health()` shows none failing after 15 minutes |
| E6 | **Deploy the production worker** and turn on `INBOX_WORKER_ACTIVE` | Both | E3, E5 | `/healthz` and `/readyz` return 200; worker visible in monitoring |
| E7 | **Point the Meta webhooks** at production and verify the tokens | Both | A1, E3 | Meta's webhook check passes |
| E8 | **Create the first real agency by hand**, feature flags defaulted off | You | E4 | Agency exists, flags off |
| E9 | **Run the acceptance subset on production** with a disposable agency, then remove it | Me | E8, B5 | Subset green; disposable agency deleted |
| E10 | **Launch to the first real agency** and switch features on one at a time | You | everything above | First agency live; watched for a full day |

---

## Critical path
A1 (Meta review) is the longest wait, so it starts first and runs alongside everything else. Engineering path: A3, B2, B3, B4, B5, B6, B7.
Then B1, E1 to E9. The launch date is the later of "Meta approved" and "E9 green".

## What I will not do without your go-ahead
Create a Supabase branch (B1), apply anything to production (E4, E5), merge a PR, or send any message to a real person.

## Out of scope
New Inbox features, UI redesign, new channels, and changes to other modules.

## Test plan
- **Automated:** the 32 browser specs plus B4 and B5, the isolation pgTAP plans (storage, child tables, function authorization), the static
  migration tests, `inbox-ci` and `packages-ci`.
- **Manual or environment proof:** B1 schema diff, B6 kill test, B7 provider round trip, B8 alerts, C4 rollback rehearsal, D4 audit script.

## Status
Draft. Nothing in this plan has been started on 2026-10-02 except what TASK-028 to TASK-030 already record as done.
