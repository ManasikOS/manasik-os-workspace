# TASK-028 Inbox production-readiness remediation

## What

Close every gap found in the 2026-10-02 Inbox launch-readiness analysis so the Inbox can be released to staff in two
stages: first a human-only interim release (AI replies and autonomy off), then the full programme release. This plan
orders the work, names an exit check for each item, and defines the rollout and rollback. It adds no new product
features.

It sits on top of [`launch-readiness-implementation-plan.md`](../inbox/launch-readiness-implementation-plan.md) (LR0–LR…)
and [`scaling.md`](../inbox/scaling.md); it does not replace them. Where an item below is already an LR or SC slice, the
slice stays the source of truth and this plan only sequences it. The checklist rule in `AGENTS.md` applies: one slice,
one PR, and a box is ticked in [`checklist.md`](../inbox/checklist.md) only when its exit is measured.

## Why

The analysis found strong code (typecheck clean, 2,511 of 2,512 Inbox tests passing, server-side send authorization,
agency scoping) but no proof it works under real conditions:

| # | Finding | Severity |
|---|---|---|
| F1 | `threadDayLabel` ignores its `now` argument and its test is pinned to 2026-10-01, so it fails on every other day | Medium (CI breaks daily) |
| F2 | `inbox-sla` and `inbox-retention` cron jobs failed on every run after 2026-09-28 (allow-list omission). Fix migrations exist; whether they are applied live is unconfirmed | **High** (SLA sweep and retention not running) |
| F3 | Browser acceptance is missing for most slices because there is no signed-in non-production environment | **High** (blocks ~all open exits) |
| F4 | Inbox worker is not confirmed deployed; `main` not confirmed as the live build | High |
| F5 | CI only covers the Packages module; nothing gates Inbox PRs | High |
| F6 | No error tracking, cron-health alerting or documented rollback drill | High |
| F7 | Scaling exits unmeasured; the Burst profile misses its capacity target | High (full release only) |
| F8 | Accessibility never verified in a browser | Medium |
| F9 | `actions.ts` (2,220 lines) and `inbox-workspace-controller.tsx` (849) are hard to review | Low |
| F10 | The only Supabase project ("Manasik OS") and Vercel deployment are **staging** (decided 2026-10-02: no live users yet, 3 test agencies, 5 conversations). The real production environment does not exist yet, so nothing has proven that the repository can build one from scratch | High (go-live risk, not a defect) |

## Release boundary

- **Interim release (R1):** human-operated Inbox. AI surfaces off, autonomy at L0, no automated sends. Needs
  Phases 0–3.
- **Full release (R2):** adds Copilot, media AI and autonomy L1+. Needs Phases 4–5 as well, and each autonomy level
  past L0 is enabled separately with its own evidence.

Never combine a deployment, a data migration and an autonomy increase in one release.

## Phases

### Phase 0: stop the bleeding (days, no dependencies)

**P0.1 Fix the day-divider label (F1).**
`threadDayLabel` compares against `now`, not the system clock (use `isSameDay` against `now` and `now - 1 day`). Rewrite
the test with explicit dates relative to the injected `now`, plus midnight-boundary and other-year cases.
Exit: test passes regardless of the real date (run it with the clock faked to two different days).

**P0.2 Confirm and repair the cron jobs (F2).**
This ran against the live project, which is now staging (it was treated as production at the time). Query the live `invoke_cron_route`
definition and `cron.job_run_details` (read-only). If `inbox-sla` and
`inbox-retention` are still rejected, apply the existing fix migration through the normal migration path (reviewed
first, applied by the owner or with the owner's explicit go-ahead), then confirm
a successful run of each. If they were fixed, record the date. Then run the SLA sweep's backlog once and check
retention in dry-run first, because three or more nights of retention have been skipped and the first live run may
delete a larger-than-usual batch (confirm protected booking messages are untouched).
Exit: last-24-hour success count equals the expected count for both jobs, and the dry-run count equals the live sweep.

**P0.3 Add a drift guard so F2 cannot recur.**
A test that reads every `app/api/cron/*` route and every `cron.schedule` call in the migrations and asserts each
scheduled path is in the latest allow-list. The repo already has `invoke-cron-route-allow-list.test.ts`; extend it
rather than adding a second file.
Exit: removing a path from the allow-list in a branch fails the test.

### Phase 1: CI and observability (F5, F6)

**P1.1 Inbox CI job.** A workflow that runs `npm run typecheck`, `npm run lint` (with a warning ceiling equal to
today's count so it can only go down) and `npm run test` on every PR, with path filters for `app/inbox/**`,
`lib/inbox/**`, `lib/data/inbox-*`, `supabase/migrations/**`. Install Playwright browsers so the CSP test runs.
Exit: a deliberately failing test blocks a draft PR. Make the job a required check.

**P1.2 Error tracking with Sentry (decided).** Add `@sentry/nextjs` for the web app and `@sentry/node` for the
worker (`worker/index.ts`, bundled to `dist-worker`). Wire:
- server actions and route handlers (the `/api/webhooks/*` and `/api/cron/*` routes included) through
  `instrumentation.ts` / `onRequestError`, and a wrapper around the existing `inboxFailure` helper so handled failures
  are reported with a stable error code rather than only `console.error`;
- the client error boundary for `/inbox`;
- the worker's `defaultLog` and its unhandled-rejection path.

Configuration: one Sentry project per runtime (web, worker) or one project with a `runtime` tag; `environment` set to
`staging` for the current deployment and `production` for the future one; `release` set to the deployed commit SHA so P3.5 can tie errors to a build.
The DSN is a secret-store environment variable, never committed; the owner creates the Sentry organisation and project
and supplies it when configuring each environment.

Privacy (non-negotiable): `sendDefaultPii: false`, and a `beforeSend` / `beforeBreadcrumb` scrubber that removes message
bodies, phone numbers, email addresses, attachment names, passport and payment fields, and request bodies and headers.
Tag with agency id (an opaque id, not a name) and conversation id only. Disable session replay, or mask all text if it is
enabled. Set a sampling rate for traces, and rate-limit noisy errors.

Alerts: new issue, regression, and an error-rate spike on `/api/webhooks/*` and the send path, routed to the on-call
owners.
Exit: a forced error in each of the four places (server action, route handler, client boundary, worker) appears in
Sentry with the build SHA and no customer content; a unit test feeds the scrubber sample message, phone and email data
and asserts none survive.

**P1.3 Cron and queue health alerts.** Alert on: any pg_cron job with consecutive failures, outbox oldest-pending age
above the SLO, dead-letter count above zero, and webhook 5xx rate. The `cron_job_health` migration already exists;
connect it to a notification channel.
Exit: stop one job in a non-production environment and the alert fires within two intervals.

**P1.4 Health endpoint and structured logs.** Confirm a health route covers the app and the worker's `health-server`.
Exit: both return 200 in the deployed environment.

### Phase 2: make staging a proper test bed, and prove production can be built (F3, F10)

This unblocks most open checklist exits, so it is the critical path. The detailed plan is
[`TASK-029`](TASK-029-inbox-non-production-environment.md).

**The existing Supabase project and Vercel deployment are staging.** There are no live users, so acceptance tests, seed data and fault
injection may run there, with two cautions: its channel connections (Gmail, Instagram, Messenger, WhatsApp) are real provider accounts,
so every test send goes only to the owner's own test contacts; and the three existing agencies are never edited by a test, which
works in two disposable agencies of its own. The environment is multi-tenant and uses one shared set of environment variables for every
tenant, so row-level security and the code are the only things separating agencies. Isolation testing is therefore the highest-value
work in this phase.

**Production does not exist yet.** It will be a new Supabase project and a new Vercel target, built later from the repository, with
fresh secrets and its own live Meta app. Nothing in staging is ever copied to it.

**P2.1 Prove the repository can build production.** Apply all migrations from the repository, in order and with no hand edits, to a
fresh database (a Supabase preview branch, which costs money and needs the owner's cost confirmation, or a throwaway project). Diff
the result against staging; the checklist records that version stamps differ from file names, so compare by migration name.
Exit: schema diff between the fresh build and staging is empty, or every difference is documented.

**P2.1a Production go-live checklist (owner, later; TASK-029 P2.6).** Create the production Supabase project and Vercel target; apply
the migrations; set fresh production environment variables (including `CRON_SECRET`, `SENTRY_*`; `INBOX_WORKER_ACTIVE` only once a
worker runs); run `set_cron_http_config()` with the production URL; Meta live app with its review and verification (start early:
it has the longest lead time of anything here); domain and TLS; agency feature flags defaulted off. Exit: a read-only review of
names and targets (values not decrypted) matches this list.

**P2.2 Seed and identities.** Two agencies, and per agency one account each for Admin, CEO, Finance and an
unprivileged role (Operations or Guide), plus a Meta test contact. Credentials live in the secrets store and the
project's example-config file, never in docs or chat. Extend `e2e/inbox-lr2-config.ts`.
Exit: the Playwright harness signs in as each identity.

**P2.3 Two-agency isolation proof.** pgTAP or an equivalent test that agency A cannot read or write agency B's
conversations, messages, attachments (Storage), evidence, transcripts and Realtime topics.
Exit: all assertions pass; includes the MED-01 RLS test still listed as unrun.

### Phase 3: interim release R1 (human-only)

**P3.1 Browser acceptance for the human surface.** Using the Phase 2 environment, run and record:
list and 23 views, search and saved views, bulk actions including mark-spam and restore, composer (drafts, presence
banner, attachments, templates, saved replies, translation), take control, assign, release, close, handoff,
new WhatsApp chat, email compose, keyboard shortcuts (J, K, /, help overlay), phone layout and browser Back, and
denied-role behaviour for each control.
Exit: written run log in `docs/progress/` with screenshots, one pass per role. Tick the PRD, STF and FIN browser boxes
only for flows actually demonstrated.

**P3.2 Accessibility pass (F8).** Keyboard-only walk-through of the same flows, a screen-reader check of the thread
(`role="log"`), focus return after dialogs, and an axe or Lighthouse run on `/inbox`. Contrast at 4.5:1 for text.
Exit: zero serious or critical axe findings; any exceptions listed with an owner.

**P3.3 Provider acceptance.** With a Meta test contact: inbound, outbound inside the window, template outside it,
delivery status updates, duplicate webhook delivery, and a forced failure between enqueue and provider call.
Exit: no duplicate provider-visible reply and no send outside the allowed window (this is the FIX1 exit).

**P3.4 Worker deployment (F4).** Deploy the worker from `worker/Dockerfile` to non-production first, set
`INBOX_WORKER_ACTIVE=1` on that web deployment, confirm the outbox drains through the worker and that the scheduled
drain still recovers if the worker is stopped.
Exit: kill the worker mid-batch; queued messages still send via the scheduled drain, once each.

**P3.5 Confirm the deployed build (F4).** Record the commit SHA running in production and compare with `main`. If they
differ, list the merged-but-undeployed Inbox changes and migrations before choosing the release candidate.
Exit: release candidate SHA and target environments named in a `docs/progress/` snapshot (this is LR0).

**P3.6 Flags and kill switch.** Confirm every AI surface and autonomy level has an agency-level off switch, defaults
off, and that turning it off takes effect within one minute without a deploy.
Exit: toggled in non-production and observed.

**P3.7 Security and dependency gates.** Run `npm audit` (no critical or high), the Supabase security and performance
advisors, and a secrets scan of the repo. Re-check that every new Server Action starts with `requireUser()` (add a test
that fails if an exported action in `app/inbox/*actions.ts` lacks it).
Exit: advisor report attached to the snapshot with each finding fixed or accepted by the owner.

**P3.8 Rollback rehearsal.** In non-production: (a) redeploy the previous build, (b) turn off the flag set, (c) restore
a migration using its documented down-step or forward-fix, (d) stop the worker. Time each.
Targets: flag off under 1 minute, previous build under 5 minutes.
Exit: timings recorded; the rollback plan below is amended with what actually happened.

**R1 go/no-go.** All Phase 0–3 exits met, `build` green, two named owners on call for the first week.

### Phase 4: scale evidence (F7), needed for R2

Work the existing SC slices; this plan only fixes the order and the stop condition.

1. Re-run the Baseline load profile on the current build (delivered Realtime events per inbound, server-action calls
   per inbound, webhook p95, queue age percentiles, DB connections, event-to-visible latency).
2. Measure per-read p95 with `EXPLAIN (ANALYZE, BUFFERS)` at 100,000 conversations and a 10,000-message thread.
3. Fix the Burst profile (queue SLO with at least 30% throughput headroom). Sustained already passes at about 3x.
4. Re-measure Realtime event reduction (at least 70% fewer than Baseline) and convergence after a dropped event.
5. Two signed-in sessions: missed-event recovery and staff send visible without a full refresh.

Exit: each SC exit box in the checklist has a measured number beside it. If Burst cannot be met, R2 ships with a lower
documented ceiling instead of ticking the box.

### Phase 5: AI and autonomy enablement (R2)

Enable one step at a time, each for one week with metrics reviewed before the next.

1. Copilot suggestions for staff (draft only, human sends).
2. Media AI (transcripts, passport and receipt extraction), staff-only, with the MED live checks done: real provider
   audio request, persistence on the non-production table, brochure routing never auto-sending.
3. Autonomy L1, then L2, then L3. Each needs: sign-off by the agency owner in the documented approval and audit path,
   the multilingual overnight scenario (English, Sinhala, Tamil) producing one provisional lead and zero deny-list
   violations (FIX4 exit), and a clean 80/100/120% usage ladder check against a reconciled counter (FIX3 exit).
4. Collect OUT-03 release evidence: one week of reconciled metrics, reviewed risk samples, channel proof and the
   rollback drill from P3.8. Only then tick Checkpoint P6.

### Phase 6: maintainability (F9), after R1, never mixed with a release

- Split `app/inbox/actions.ts` by domain (messaging, assignment, passport and media, identity, conversion, views),
  moving code without changing behaviour. One PR per domain, with the existing tests unchanged and passing.
- Break `inbox-workspace-controller.tsx` into focused hooks (selection, URL state, realtime, keyboard).
- Remove the 13 unused-parameter lint warnings.
Exit: no behaviour change, test counts unchanged, no file over about 600 lines.

## Rollout (R1 and R2)

1. Deploy with every AI flag off and verify health, error tracker and cron health.
2. Enable for the internal team only; watch 24 hours.
3. Then one pilot agency, 24–48 hours; then all agencies in steps (25%, 50%, 100% of staff).
4. At each step apply these thresholds:

| Metric | Advance | Hold | Roll back |
|---|---|---|---|
| Error rate | within 10% of baseline | 10–100% above | more than 2x |
| p95 latency | within 20% | 20–50% above | more than 50% above |
| New client errors | none | under 0.1% of sessions | over 0.1% |
| Outbox oldest pending | within SLO | up to 2x SLO | over 2x SLO, or any duplicate send |

Also roll back immediately on a data-integrity issue, a cross-agency read, or a send outside the allowed window.

## Rollback plan

- **Flags:** switch the affected surface or autonomy level off (under 1 minute).
- **Code:** redeploy the previous build (under 5 minutes).
- **Worker:** stop it; the scheduled drain continues sending (confirmed in P3.4).
- **Migrations:** every migration is additive; for a bad one, ship a forward-fix migration rather than dropping data.
  Document the specific step beside each migration before it is applied.
- **Data from the new path** (for example transcripts or proposals) is kept, not deleted, on rollback.
- Notify the team in the agreed channel, and write a short note in `docs/progress/`.

## Data model changes

None planned. P0.2 may apply an already-written migration to production (with the owner's go-ahead); P2.1 applies the existing migration set to a fresh database to prove the build.
Any migration needed later must be additive, with RLS, an agency index and a two-agency isolation test in the same PR.

## Access control changes

None. P3.7 adds a test that every exported Inbox Server Action begins with `requireUser()`.

## UI surfaces

`/inbox` (full page and header overlay), management Inbox settings (autonomy, SLA, routing, retention), and the
owner Inbox intelligence panel. Only P0.1 changes UI text behaviour; everything else is verification.

## Test plan

Automated:
- P0.1 clock-independent day-label tests; P0.3 allow-list drift test; P3.7 server-action guard test; the Inbox CI job
  (P1.1) running typecheck, lint and the full Vitest suite plus the CSP test with Playwright installed.
- P2.3 two-agency isolation tests; P3.3 fault-injection tests at each persistence boundary.

Manual or browser (recorded in `docs/progress/`): P3.1, P3.2, P3.3, P3.4, P3.8, the Phase 4 measurements and each
Phase 5 step. The node-only Vitest suite is not accepted as proof of UI, RLS, provider or worker behaviour.

## Decisions needed from the owner

Decided: Sentry for error tracking (P1.2). The current Supabase project and Vercel deployment are **staging** (no live users); production
will be a new project and deployment created later. The owner pays for Supabase Pro and Vercel Pro and owns the Meta test app.

1. Which contacts and numbers are safe to receive test messages from staging.
2. ~~May the two pending migrations (`inbox_unread_count`, `cron_inbox_health`) be applied to staging.~~ Done 2026-10-02.
3. Cost confirmation for a Supabase preview branch, used for the clean-rebuild proof (P2.1).
4. Named on-call owners for the first release week.
5. When to start the production Meta app review, which has the longest lead time.
6. Whether R1 may go live before Phase 4, which this plan assumes (human-only traffic at current scale).

## Status

In progress. Phase 0 and the code for Phase 1 are merged to `main` (2026-10-02). What is merged is not the same as what is proven
or live; each line says which.

### Phase 0: done and merged

- **P0.1** merged (PR #186). `threadDayLabel` measures from the `now` it is given; tests use a different clock and the midnight
  boundary.
- **P0.2** verified read-only against the live project (now staging) on 2026-10-02 05:32 UTC; no change was needed. `invoke_cron_route`
  already allows `inbox-sla` and `inbox-retention`. `inbox-sla` had 669 successful runs in 24 h (last failure 2026-10-01 07:14 UTC);
  `inbox-retention` succeeded at 02:17 UTC on 2026-10-02 after failing the night before. **Open:** the retention catch-up already
  ran live, so no dry run was possible; reviewing what that run removed (protected booking messages untouched) is still to do.
- **P0.3** merged (PR #187). A test fails if a cron route is neither allow-listed nor declared unscheduled; shown to fail when
  `inbox-sla` is removed from the allow-list.

### Phase 1: code merged, live proof outstanding

- **P1.1 Inbox CI** merged (PR #188): `.github/workflows/inbox-ci.yml` runs typecheck, an Inbox lint ratchet (13 warnings, may only
  go down) and the full unit suite with Playwright Chromium, on every PR. **Open (owner, in GitHub):** mark "Inbox CI / inbox-ci" a
  required check, then open a throwaway PR with a failing test to prove it blocks. Until then the exit is not met.
- **P1.2 Sentry** merged (PRs #189, #190): scrubber for message text, phones, e-mails, cards and tokens (21 tests); DSN,
  environment and trace rate from environment variables; no Session Replay; 10% tracing that skips cron, webhook and tunnel
  requests; handled Inbox failures, error boundaries and the worker reported; `/monitoring` exempt from the sign-in proxy; example
  routes removed. **Open:** set `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT=staging` (not `production`: this deployment is staging) and the `SENTRY_AUTH_TOKEN` build secret in
  Vercel (without a DSN Sentry is silent); set `SENTRY_DSN` and `SENTRY_RELEASE` on the worker; prove a forced error in each of the
  four places (server action, route handler, client boundary, worker) reaches Sentry with no customer content. Not verified: a live
  event, source-map upload, or `next build` with the Sentry plugin.
- **P1.3 Health alerts** merged (PR #193): `/api/cron/inbox-health` (cron jobs, outbox age, stuck and dead-lettered messages,
  background-job age and dead letters, unreadable parts) reports to Sentry and sends a Sentry cron check-in. Read-only queries
  against production on 2026-10-02 showed a healthy system. **Open, in this order:** deploy the route; apply migration
  `20261229090000_cron_inbox_health.sql` (applied to staging on 2026-10-02, see below); create the five Sentry alert rules in
  [`docs/runbooks/inbox-health-alerts.md`](../runbooks/inbox-health-alerts.md); then stop a job on staging and confirm the
  alert fires. The outbox limits (120 s warning, 300 s critical) are starting values for the owner to confirm.
- **P1.4 Health endpoints and structured logs** merged (PR #193, from PR #191): `GET /api/health` (liveness),
  `GET /api/health/ready` (database read, 3 s limit), JSON log lines scrubbed like Sentry reports. The worker's `/healthz` and
  `/readyz` already existed. **Open:** the exit, both returning 200 in a deployed environment, is not yet observed.
- **Lockfile incident.** PR #189 reached `main` before its `picomatch` fix, so `main` failed `npm ci` on CI (and with it the new
  Inbox CI on every PR) until PR #193 merged the fix. Recorded so the cause is known: `fdir` needs `picomatch` 3 or 4 while the
  hoisted root copy was 2.3.2.

### Phase 2: replanned on 2026-10-02

The current project is staging, so Phase 2 no longer waits on a new environment. [`TASK-029`](TASK-029-inbox-non-production-environment.md)
is rewritten around it: seed two disposable agencies and test staff on staging, run the isolation tests there, deploy the worker and
Meta test round trip there, prove the repository builds a fresh database, and prepare the production go-live path. The owner has
confirmed they pay for Supabase Pro and Vercel Pro and own the Meta test app. Still open: the safe test contacts, permission to apply the
and a cost confirmation for the clean-rebuild branch. (The two pending migrations were applied; see below.)

**Verified on 2026-10-02 (read-only):** staging holds 3 agencies, 5 conversations, 62 messages, 5 channel connections and 8 auth users.
**Applied 2026-10-02 with the owner's go-ahead:** `inbox_unread_count` (a trigger that raises a conversation's unread count on a customer message; verified enabled, fires only for customer messages, security-definer with a fixed search path, not runnable by `anon` or `authenticated`) and `cron_inbox_health` (one more allowed cron path plus the `*/5` `inbox-health` job). Both are recorded in the migration history. The first `inbox-health` run succeeded and the route answered HTTP 200 `{"status":"healthy","findings":[]}`; `cron_job_health()` reports the job OK. Not yet confirmed: the Sentry check-in, which needs the DSN variables. `/api/health` and
`/api/health/ready` return 200 on build `b3721ff`, which closes the P1.4 exit for the web app. No Sentry DSN variable was found in
Vercel, so Sentry is silent until `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` are added. GitHub does not offer branch protection or
required checks on this private repository's current plan, so "Inbox CI" cannot be made a required check without upgrading it.

### Phases 3 to 6

Not started. Update this section as each phase lands, and tick the matching boxes in
[`checklist.md`](../inbox/checklist.md) in the same PR as the work.
