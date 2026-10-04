# Task list: Replace Inngest with Supabase-native scheduling

Plan: [`tasks/plan.md`](./plan.md) · Spec: `docs/inbox/supabase-native-scheduling-plan.md`
Sizes: XS 1 file · S 1–2 · M 3–5. One task = one PR unless marked (ops).
Standing verification for code tasks: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.

## Phase 0 — Decide and record

- [x] **T1 (S) Record decision R9 and the new runbook skeleton.** Amend `docs/inbox/architecture.md` §16 (R9: Postgres owns state and the clock; pg_cron owns schedules; no external workflow engine; R8 superseded). Update `docs/inbox/scaling.md` §10.4. Create `docs/runbooks/supabase-scheduling.md` (Vault config setup, job list, how to pause/resume a job, rollback). Mark Inngest sections in `scale-inngest-implementation-plan.md` and `docs/runbooks/inngest.md` as superseded.
  - Accept: R9 present and R8 marked superseded; runbook lists every job with its schedule; links resolve.
  - Verify: read the docs end to end; link check; no code diff.
  - Depends: none · Files: architecture.md, scaling.md, runbooks/supabase-scheduling.md, runbooks/README.md, inngest.md
  - Status: docs written 2026-10-01, links checked, **not yet committed or merged**.
- [x] **T2 (XS, ops) Read-only audit of staging and production.** Run `select jobname, schedule, active from cron.job;`, dump the live `invoke_cron_route` body, check `INNGEST_SCHEDULES_ENABLED`, `INNGEST_KNOWLEDGE_INGEST`, `INNGEST_EVENT_KEY`, and whether the worker runs. Record findings in `docs/progress/2026-10-xx-scheduling-audit.md` (no secrets).
  - Accept: each job marked "pg_cron / Inngest / neither" per environment; allow-list gap confirmed or refuted; D1–D5 answered.
  - Verify: you review the record.
  - Depends: none · Files: docs/progress/…
  - Status: done 2026-10-01, record in `docs/progress/2026-10-01-scheduling-audit.md`. Found: `inbox-sla` and `inbox-retention` fail every run on the live DB (missing from the `invoke_cron_route` allow-list); D4 = Inngest schedules are off, pg_cron is the runner; D5 = no worker. D1–D3 still open.

### Checkpoint 0
- [ ] R9 merged · audit recorded · D1–D5 answered · you approve moving to Phase 1

## Phase 1 — Schedules on pg_cron

- [ ] **T3a (XS, urgent) Allow-list hotfix.** Migration that redefines `invoke_cron_route` with the nine current paths plus `/api/cron/inbox-sla` and `/api/cron/inbox-retention` (and `finance-ops-sweep` only if D3 says yes); contract test. Needs your approval to apply to the live database.
  - Accept: every listed path accepted, an unknown path refused, not executable by anon/authenticated; after applying, `inbox-sla` and `inbox-retention` show a successful run and a 200 in `net._http_response`.
  - Verify: contract test; dry-run in a rolled-back transaction; apply; query `cron.job_run_details` for both jobs. Check retention's first run, since it will process three missed nights.
  - Depends: T2 · Files: supabase/migrations/…_invoke_cron_route_allow_list.sql, its test
  - Status 2026-10-01: migration `20261223090000_invoke_cron_route_allow_list_fix.sql` and `lib/inbox/invoke-cron-route-allow-list.test.ts` written (8 tests pass, lint and typecheck clean); dry-run passed; **applied to Manasik OS** at the user's request (recorded under the tool's own timestamp). Function verified: both paths present, access still postgres and service_role only. Post-apply: `inbox-sla` succeeded at 07:16 UTC and all four 07:16 HTTP calls returned 200; `inbox-retention` still to be checked at its 02:17 UTC run. Not committed.

- [ ] **T3 (M) Migration A: full allow-list and the job set.** *(Audit: split into T3a above, a small allow-list hotfix to do first, and this remainder.)* New migration redefines `invoke_cron_route` with all paths (agent-jobs, inbox-lanes, inbox-sla, inbox-email-poll, lead-followups, departure-ops-jobs, release-seat-holds, ai-usage-rollup, whatsapp-health, whatsapp-billing-sync, inbox-retention, finance-ops-sweep, and onboarding-signup-alert if the audit says it is used) and (re)schedules each job idempotently at the agreed cadence (D1); `finance-ops-sweep` inactive unless D3 says otherwise. Reverse notes in the file. Add a migration contract test in the repo's existing style.
  - Accept: every path accepted, an unknown path refused; function not executable by anon/authenticated; schedules match plan §4.1; `search_path = ''`.
  - Verify: contract test passes; dry-run in a rolled-back transaction on staging; lint/typecheck/test.
  - Depends: T1, T2 · Files: supabase/migrations/…_scheduling_pg_cron.sql, its test
  - Status 2026-10-01: **scope reduced by the audit.** After T3a all 11 live jobs already run, and the repo's earlier migrations already schedule them, so the only gap left is `finance-ops-sweep`. Written: `20261224090000_cron_finance_ops_sweep_inactive.sql` (allows the path; creates the job only if missing, hourly, **inactive**; never touches an existing job) and extended `lib/inbox/invoke-cron-route-allow-list.test.ts` (11 tests pass, lint clean). Defaults used: D1 keep every-minute drains, D3 leave the sweep off. Dry-run on Manasik OS in a rolled-back transaction passed (12 jobs, 11 active, sweep inactive, ACL unchanged; live untouched). **Applied to Manasik OS 2026-10-01** (12 jobs, 11 active, sweep inactive with 0 runs, access unchanged). `onboarding-signup-alert` is deliberately not scheduled (its route answers 500 on a spike by design; needs a decision).
- [~] **T4 (S, ops) Apply Migration A to staging and prove each job fires.** Run `set_cron_http_config` with the staging URL and `CRON_SECRET`; apply; wait one full interval of every job (daily jobs: trigger once by hand through the same function).
  - Accept: each job has a successful row in `cron.job_run_details` and a 2xx in `net._http_response`; no 401/403; the agent-jobs run also shows the reconciler ran; host invocation/duration limits checked for the D1 cadence.
  - Verify: query output saved to the progress note (counts only).
  - Depends: T3 · Files: progress note
  - Status 2026-10-01: migrations already applied (T3a, T3). Proof recorded in the audit note (T4 section): every active job succeeded in its interval, 167 of 167 HTTP calls answered 200 with no timeouts, no 401/403, reconciler runs inside `agent-jobs`. **Open:** `inbox-retention` first run (2026-10-02 02:17 UTC) and your check of the Vercel plan's function duration (>= 55 s) and invocation allowance (about 4,500 a day).
- [x] **T5 (M) Prove idempotency under overlap.** Add tests that run two overlapping invocations of each route (agent-jobs, inbox-lanes, inbox-sla, lead-followups, retention, email-poll, release-seat-holds) and assert no duplicate customer-visible effect and no double claim; assert `agent-jobs` runs `reconcileRawEvents` when Inngest schedules are off. Fix only what a test proves broken.
  - Accept: tests cover every route listed; any fix is minimal and separately explained.
  - Verify: focused vitest files, then the full suite.
  - Depends: T3 · Files: route test files under app/api/cron/*, small fixes if needed
  - Status 2026-10-01: done, **not committed**. `app/api/cron/cron-overlap.test.ts` (31 tests: all 7 routes run twice at the same moment, both complete with the same answer, wrong or missing secret starts no work, plus the `agent-jobs` reconciler runs on its own when Inngest schedules are off) and `lib/inbox/cron-dedupe-guarantees.test.ts` (12 tests: skip-locked claims, the ledger's unique key and its race, message and intervention unique indexes, seat-hold release is idempotent). Lint and typecheck clean; no production code needed fixing. Limits: the SQL guarantees are checked from the migrations, not by a real two-session race. Finding (low): two seat-hold releases that load the same data write the same seat counts but each adds an internal activity entry, so the log can show a duplicate line.
- [~] **T6 (M) Monitoring that replaces Inngest history and alerts.** Migration B: a view of last success and last non-2xx per job; a daily cleanup job (`cron.job_run_details` older than 7 days, `net._http_response` older than 3 days); the missed-job rule (no success in 2× interval, or two non-2xx in a row) wired to the launch alert channel. Update the runbook.
  - Accept: breaking one job (wrong secret) trips the alert within 2× its interval on staging; cleanup removes old rows; the view exposes counts and statuses only.
  - Verify: contract test for the view and cleanup; the staging break-and-restore drill.
  - Depends: T4 · Files: migration, test, runbook
  - Status 2026-10-01: migration `20261225090000_cron_job_health_and_cleanup.sql` + `lib/inbox/cron-job-health-migration.test.ts` (10 tests) written; allow-list test updated; lint clean. Dry-run on Manasik OS in a rolled-back transaction with synthetic jobs passed: OK / STALE / FAILING (scheduler errors) / FAILING (two HTTP 500s) / PAUSED / NEVER_RUN all classified correctly, collector copies the HTTP answer and marks a lost call, cleanup keeps recent rows and removes old ones (first run would delete about 33,100 of 37,700 rows), access limited to the service role. The first run correctly reports `inbox-retention` as FAILING (its last 3 runs failed; recovers after 2026-10-02 02:17 UTC). **Applied to Manasik OS 2026-10-01** (14 jobs, 13 active; the first recorded calls appeared on the 07:53 tick; access as dry-run). **Open:** the alert itself. The health function is what an alert reads; nothing sends it anywhere yet, and the acceptance line ("breaking a job trips the alert within 2x its interval") cannot be met until you choose the channel. Runbook update waits for apply.
- [x] **T7 (S) Cutover: stop Inngest firing the schedules.** *(The audit said no-op; T7's check found it is not: see status.)* Only after T4–T6 are green. Unset `INNGEST_SCHEDULES_ENABLED` and redeploy; watch for 24 h. For production, repeat T3/T4 first, then this. If D4 says it was never on, record "no-op".
  - Accept: zero new Inngest function runs; each job still runs on pg_cron at its cadence; no alert fired; error rate and p95 within 10% / 20% of baseline.
  - Verify: Inngest dashboard, `cron.job_run_details`, runtime logs.
  - Depends: T4, T5, T6 · Files: lib/inbox/inngest/functions.ts, registry.test.ts
  - Status 2026-10-01: **finding.** `INNGEST_SCHEDULES_ENABLED` was never set, but the schedule functions are still registered with Inngest, so Inngest still ran every one as an empty tick and counted each as an execution. Vercel production logs show about 110 `/api/inngest` requests (status 206) per 30 minutes: about 220 an hour, about 5,300 a day, which is what used up the allowance. Fix written: `functions.ts` no longer registers the 11 schedules or the reconciler, leaving only the reply-window reminder and knowledge ingest (both event-driven); `registry.test.ts` now asserts no registered function has a cron trigger and has a positive control (101 Inngest tests pass, lint and typecheck clean). **Committed, merged (PR #180) and deployed 2026-10-01; verified: `/api/inngest` requests went from about 37 per 10 minutes to 0 in the last 4 minutes after the deploy (the few seen just after were the sync and the last in-flight runs).** Original to-do: deploy, make sure Inngest re-syncs the app (the Vercel integration normally does it on deploy; otherwise Sync in the Inngest dashboard), then confirm `/api/inngest` requests fall to about zero (check with `get_runtime_logs` grouped by path) and the Inngest dashboard shows no new cron runs.

### Checkpoint 1
- [ ] allow-list test green · all jobs succeed on staging and production · alert drill passed · Inngest schedules off with zero new runs · lint/typecheck/test/build green · you approve Phase 2

## Phase 2 — Reply-window reminder as a sweep

- [x] **T8 (M) Sweep route and query.** New cron route `reply-window-sweep` (same bearer check as the other cron routes) that selects person-owned chats (`HUMAN_REQUESTED`/`HUMAN_ACTIVE`) whose window closes within 2 h, runs the existing `decideWindowReminder`, and notifies through the existing `checkAndRemind`/ledger path. Counts-only response.
  - Accept: closing-soon chat → one notification; answered, assistant-owned, closed, expired → none; window extended → re-evaluated from the current column; second sweep → none (exactly-once); two agencies never mix; every query agency-scoped.
  - Verify: unit tests for each case; two-agency test; focused vitest then full suite.
  - Depends: T7 · Files: app/api/cron/reply-window-sweep/route.ts (+test), lib/inbox/window-sweep.ts (+test); window-reminder.ts reused
  - Status 2026-10-01 (branch `feat/reply-window-sweep`, **not committed**): `lib/inbox/window-sweep.ts` (per-agency sweep reusing `decideWindowReminder` and `checkAndRemind`; prefilters chats that already have a finished reminder after the customer's latest message), `app/api/cron/reply-window-sweep/route.ts`, `lib/inbox/window-sweep.test.ts` (16 tests: agency scope, two-hour bound, answered/assistant/closed/expired skipped, once across two sweeps, unfinished claim retried, failure counted without echoing details, budget, no message text read) and the route added to the overlap tests (39 pass). `window-reminder.ts` now exports `WINDOW_REMINDER_PERSON_STATES` (one shared list). Lint and typecheck clean. A test found my first version logged the raw error message; it now logs only the error kind. The route is not yet scheduled: T9 adds its pg_cron job and allow-list entry.
- [x] **T9 (S) Migration C: sweep job and index.** Partial index on `(agency_id, service_window_expires_at)` for person-owned chats; add the route to the allow-list; schedule `reply-window-sweep` every 5 minutes.
  - Accept: `explain` shows the index used on a seeded set; job appears in `cron.job` and runs 2xx on staging.
  - Verify: contract test; dry-run then apply; query plan saved.
  - Depends: T8 · Files: migration, test
  - Status 2026-10-01 (branch `feat/reply-window-sweep`): migration `20261226090000_cron_reply_window_sweep.sql` (partial index `conversations_window_closing_idx`, `reply-window-sweep` added to the allow-list, job created every 5 minutes only if missing; body of `invoke_cron_route` otherwise unchanged, still recording calls) and 4 new tests in `lib/inbox/invoke-cron-route-allow-list.test.ts` (29 pass, lint clean). Dry-run on Manasik OS in a rolled-back transaction passed: job created active at `*/5 * * * *`, 15 jobs, path allowed and an unknown path refused, access unchanged, and the sweep's query plans as an Index Scan on the new index; live database untouched. **Applied to Manasik OS 2026-10-01 11:14 UTC, after PR #181 was merged and its production deploy was READY.** First run at 11:15 UTC: scheduler succeeded, route answered 200 `{agencies: 3, failedAgencies: 0, examined: 0, reminded: 0, ...}`; nothing was examined because no person-owned chat currently has a window closing within two hours. Rollback is in the migration header.
- [-] **T10 (S, ops) Parallel run, compare, confirm. CLOSED 2026-10-01 without its exit, by your instruction to proceed with T13 to T15: the old reminder path no longer exists, so there is nothing left to compare with.** Run old triggers and the sweep together for several days; compare notifications per day (ledger counts) between paths; confirm no duplicates and no remaining event consumer for the old path.
  - Accept: the sweep notifies for every chat the old path did; zero duplicates.
  - Verify: ledger count query; progress note.
  - Depends: T9 · Files: progress note
  - Outcome: the side-by-side comparison never reached a real chat. What stands instead: both paths shared one ledger key, so no duplicate was ever possible; the old path's 3 reminders match what the sweep's rule selects; the sweep has run every 5 minutes since 11:15 UTC with 200 each time. **Still unproven end to end:** the sweep sending a real reminder. The wrap-up plan test **V5** covers it, and a throwaway chat can prove it on request (it writes to the live database).
  - Status 2026-10-01: both paths live together since 11:14 UTC. **A duplicate is impossible**: both end in the same `checkAndRemind` and the ledger's unique key (no per-path column), so whichever claims first notifies and the other does nothing. Baseline recorded in `docs/progress/2026-10-01-reply-window-comparison.md`: the old path has sent 3 reminders (3 ledger rows, 3 notifications), each exactly two hours before its window closed and each for an unanswered chat, which the sweep's rule would also select (the sweep would land up to 5 minutes later). The sweep has run once (200, nothing due). The note holds the comparison query and an exit rule: done when one real chat passes the check, or after 7 days of healthy `cron_job_health()` for `reply-window-sweep` with your acceptance that traffic was too low. A throwaway-chat proof is available but writes to the live database and needs your explicit go-ahead. Not committed.

### Checkpoint 2
- [ ] exactly-once proven live · counts match · you approve Phase 3

## Phase 3 — Knowledge ingest

- [x] **T11 (S) Make the legacy job the only path.** Remove the Inngest branch and `INNGEST_KNOWLEDGE_INGEST` from `lib/agent/whatsapp/knowledge/queue.ts`; update `queue.test.ts`; callers unchanged.
  - Accept: an upload always queues `EMBED_DOCUMENT`; no import of `lib/inbox/inngest/events` from this file.
  - Verify: queue test; upload a document on staging and see it become ready.
  - Depends: T7 · Files: queue.ts, queue.test.ts
  - Status 2026-10-01 (branch `chore/scheduling-t10`, committed): `queueKnowledgeIngest` now only queues the `EMBED_DOCUMENT` job and returns nothing (no switch, no Inngest import, no fallback); the three callers in `app/(main)/management/ai-agent/knowledge/actions.ts` now `await` it and then call `drainSoon()` (they used to call it only when the legacy job was chosen, which is now always); `INNGEST_KNOWLEDGE_INGEST` removed from `.env.example`; `queue.test.ts` rewritten (4 tests, including that a queueing failure reaches the caller and that the old switch changes nothing); comments in `functions.ts` and `knowledge-function.ts` updated. 148 related tests pass, lint and typecheck clean. **Open:** the live check (upload a document and see it become ready) needs this deployed. The Inngest function stays registered but nothing can trigger it; T13 to T15 remove it.
- [-] **T12 (M, optional per D2) Resumable embedding. SKIPPED 2026-10-01 by your decision (D2): the audit showed 5 knowledge jobs ever and no crash; a long document that is interrupted will restart from the start.** The job embeds in batches with the existing `embedKnowledgeChunkRange`/`EMBED_STEP_CHUNKS`, saves progress on the document row, and re-queues until done; a final failure still marks the document FAILED with the same plain message.
  - Accept: killing the job mid-way and letting the lease expire completes without re-embedding finished chunks; the dead-letter path is unchanged.
  - Verify: ingest tests for resume and final failure; staging kill-and-resume drill.
  - Depends: T11 · Files: ingest.ts, drain.ts, tests, possibly a small migration for the progress column

### Checkpoint 3 (start of the one-week soak)
- [ ] long-document upload completes on staging · no Inngest runs · no missed-job alerts · you approve the soak result after 7 days

## Phase 4 — Remove Inngest (only after the soak)

- [x] **T13 (S) Remove the forwarder.** Delete the forwarder call in `app/api/cron/agent-jobs/route.ts`, the worker's `inngest_outbox` loop and `WORKER_FORWARD_INNGEST` (`worker/index.ts`, `lib/inbox/worker/config.ts`, `worker-runtime.ts`), and their tests.
  - Accept: nothing references `forwardInngestOutbox`; the worker starts and `worker:check` passes.
  - Verify: worker tests; full suite.
  - Depends: Checkpoint 3 · Files: agent-jobs/route.ts, worker/index.ts, config.ts, worker-runtime.ts (+tests)
  - Status 2026-10-01 (branch `chore/remove-inngest`): **done early at your instruction**, before T10's exit and the one-week soak, so the old reminder path and the rollback path are gone. Commit `22b8a9c`: forwarder removed from `agent-jobs` and the worker (`WORKER_FORWARD_INNGEST`), `agent-jobs` always runs the reconciler, retention housekeeping no longer purges an outbox; `lib/inbox/inngest/*` and `app/api/inngest` deleted (the reply-window logic moved to `lib/inbox/window-reminder.ts` for the sweep); `proxy.ts`, `.env.example`, `package.json` and the lockfile cleaned; three Inngest-only SQL scripts deleted. Typecheck clean, lint clean, 4,071 of 4,072 tests pass (the known Chromium one fails). Merged as PR #183 and deployed to production (commit `904c58b`, READY 2026-10-01); the new deployment answered 200 on the cron routes.
- [x] **T14 (M) Delete the Inngest code, route, packages and env.** Remove `lib/inbox/inngest/*`, `app/api/inngest/route.ts`, the `/api/inngest` entry in `proxy.ts`, packages `inngest` and `@inngest/middleware-encryption`, all `INNGEST_*` entries in `.env.example`, and the Inngest cutover SQL scripts (keep the notes in docs).
  - Accept: `grep -ri inngest` finds only historical docs; install, lint, typecheck, test and build pass.
  - Verify: the four standing commands; `npm audit` no worse.
  - Depends: T13 · Files: the deletions above, package.json, package-lock.json, proxy.ts, .env.example
- [x] **T15 (S) Late migration: drop leftovers.** Drop the three window-opened triggers, `trg_enqueue_window_opened`, `inngest_outbox` and `enqueue_/claim_/fail_inngest_outbox`. Rollback note included.
  - Accept: nothing in code reads these objects; advisors clean; Supabase and repository migration histories match.
  - Verify: dry-run in a rolled-back transaction; apply on staging; the reply-window sweep and email poll still work after the drop.
  - Depends: T14 · Files: migration, contract test
  - Status 2026-10-01: migration `20261227090000_drop_inngest_outbox.sql` and `lib/inbox/no-inngest.test.ts` (9 tests: no package, route, import, env variable or database call left, and the migration drops exactly the 3 triggers, 1 trigger function, 5 outbox functions and the table, in order, with no cascade) written. Dry-run on Manasik OS in a rolled-back transaction passed (0 Inngest functions or triggers left, table gone, `find_orphan_staged_uploads` and the reconcile functions kept, ledger and notifications untouched, sweep job still scheduled); live untouched. **Applied to Manasik OS 2026-10-01 16:23 UTC after the T13/T14 deploy was READY.** Verified: 0 Inngest functions or triggers left, `inngest_outbox` gone, `find_orphan_staged_uploads` and the reconcile functions kept, the 3 ledger reminders and 3 notifications untouched, `reply-window-sweep` still scheduled.
- [x] **T16 (S) Docs and checklists.** Retire `docs/runbooks/inngest.md` (leave a pointer), update `docs/inbox/checklist.md`, README indexes and `production-wrap-up-plan.md` (W3 env list, W4 scheduler owner, W5 alerts, section 4 S1); add human checks M7–M13.
  - Accept: no doc tells a reader to use Inngest; the wrap-up plan matches the new reality.
  - Verify: doc read-through; link check.
  - Depends: T15 · Files: docs only
  - Status 2026-10-01: done in PR #183 (`inngest.md` is a pointer, runbook recovery section rewritten, architecture R9 and the plans updated, wrap-up plan W3/W4/W5/S1 and tests V1 to V8). `docs/inbox/checklist.md` has no Inngest entries to change.
  - Status 2026-10-01: **part done early, not committed** (it describes what is already true): `docs/runbooks/supabase-scheduling.md` now says it is live and documents `cron_job_health()` and the two housekeeping jobs; `docs/inbox/production-wrap-up-plan.md` has W3 (Vault entries, `INNGEST_*` not needed for schedules), W4 settled as pg_cron, W5 job-health line, S1 rewritten for pg_cron, the scheduler question settled, and a new test section V1 to V8. **Still to do after T15:** retire `inngest.md` to a pointer, update `docs/inbox/checklist.md`, and tick V7 once nothing is registered.
- [ ] **T17 (S, ops) Final verification and teardown.** Run M7–M13; deploy and rollback drill on staging; then delete the Inngest app and keys in its dashboard and remove the secrets from hosting.
  - Accept: M7–M13 all pass; production error rate and latency unchanged; the Inngest account has nothing registered.
  - Verify: dated evidence in the progress note.
  - Depends: T16

### Checkpoint 4 (done)
- Status 2026-10-01: code, packages, settings and database objects are gone (T13 to T15). Left: **T17**, which only you can do: delete the Inngest app and integration in the Inngest and Vercel dashboards, remove the `INNGEST_*` variables from Vercel, and cancel the account if wanted (steps in `docs/runbooks/inngest.md`). Then run wrap-up tests V1 to V8 and confirm `inbox-retention` after its first run at 02:17 UTC on 2026-10-02.
- [ ] no `inngest` anywhere in code, packages, env, tables · all jobs healthy for a week on pg_cron · alerts proven · wrap-up plan updated · you sign off
