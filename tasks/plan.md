# Implementation Plan: Replace Inngest with Supabase-native scheduling

Spec: [`docs/inbox/supabase-native-scheduling-plan.md`](../docs/inbox/supabase-native-scheduling-plan.md) (approved design; this file is the build order).
Task list: [`tasks/todo.md`](./todo.md). Written 2026-10-01. Read-only planning; no code changed.

## Overview

Inngest's execution quota is too small. Today it only (a) triggers existing `app/api/cron/*` routes on a timer, (b) runs one
sleeping workflow (the reply-window reminder), (c) hosts an off-by-default knowledge-ingest step function, and (d) receives events
through an `inngest_outbox` + forwarder. We move all of it onto what Supabase and the app already have: **pg_cron + pg_net + Vault →
the same cron routes**, a **5-minute SQL sweep** for the reminder, and the existing **`EMBED_DOCUMENT` job** for ingest. Then we delete
Inngest. No feature, no behaviour change, per-message path untouched.

## Architecture decisions

- **One scheduler at a time.** Each job has exactly one trigger (pg_cron or Inngest) at every step. Cutover order is always *new on, old off*; a 1–2 minute overlap is safe because jobs are idempotent and lease-based.
- **Reuse, don't rewrite.** Jobs keep their route handlers. The only new logic is the reply-window sweep, and it reuses `decideWindowReminder` and the `claimFollowup` ledger.
- **Delete last.** Inngest code and account stay until a one-week soak passes, so rollback (unschedule new jobs → re-enable `INNGEST_SCHEDULES_ENABLED`) always works.
- **Architecture before code** (AGENTS.md): amend `architecture.md` §16 with R9 and mark R8 superseded in the first task.
- **Vertical slices.** Each task ends in something runnable and verified: a job that actually fires, a reminder that actually appears, an env var that actually disappears.
- Each migration is additive, reversible, `security definer` + `search_path = ''`, revoked from public/anon/authenticated. One slice = one PR.

## Dependency graph

```
T1 R9 + docs ─┬─► T2 live audit ──► (decisions D1–D5)
              │
              └─► T3 allow-list + jobs migration ─► T4 apply+verify staging ─► T5 overlap/idempotency tests
                                                        │                              │
                                                        └──► T6 monitoring + alerts ◄──┘
                                                                     │
                                                      T7 cutover: Inngest schedules OFF
                                                                     │
                       ┌─────────────────────────────────────────────┤
                       ▼                                             ▼
        T8 reply-window sweep (route+tests)              T11 remove Inngest branch of knowledge ingest
                       ▼                                             ▼
        T9 sweep job + index (migration)                 T12 resumable ingest (optional, D2)
                       ▼
        T10 parallel run, compare, retire triggers
                       └──────────────┬──────────────────────────────┘
                                      ▼
                         soak 1 week (human)  ◄── Checkpoint 3
                                      ▼
        T13 remove forwarder (agent-jobs route, worker) ─► T14 delete Inngest code/route/packages/env
                                      ▼
        T15 late migration: drop triggers + inngest_outbox ─► T16 docs/checklist/wrap-up plan ─► T17 final verify + account teardown
```

Parallelizable after T7: {T8→T10} and {T11→T12} touch different files. T13–T15 are sequential.

## Phases and checkpoints

### Phase 0 — Decide and record (T1–T2)
Docs and a read-only audit. Output: R9 recorded, true state of production known, five decisions answered.
**Checkpoint 0:** R9 merged; audit written; D1–D5 answered by you.

### Phase 1 — Schedules on pg_cron (T3–T7)
The big win: about 4,300 Inngest runs a day disappear. Staging first, production after.
**Checkpoint 1:** every job has a successful run within its interval on staging; allow-list test passes; missed-job alert proven by breaking a job; Inngest schedules off with zero new Inngest runs; lint/typecheck/test/build green.

### Phase 2 — Reply-window reminder as a sweep (T8–T10)
Replaces the only true durable workflow. Old triggers run in parallel first; the ledger guarantees no double notification.
**Checkpoint 2:** a person-owned chat closing in under 2 h yields exactly one notification; a second sweep yields none; two agencies never mix; counts match the old path for several days.

### Phase 3 — Knowledge ingest (T11–T12)
**Checkpoint 3 (with soak):** upload a document, restart mid-way, it completes; one full week with no Inngest runs and no missed-job alerts.

### Phase 4 — Remove Inngest (T13–T17)
Only after the soak. **Checkpoint 4 (done):** no `inngest` import, package, env var, route, table or doc remains; deploy and rollback drills pass; wrap-up plan updated.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `invoke_cron_route` allow-list omits `inbox-sla`, `inbox-retention`, `finance-ops-sweep`, `onboarding-signup-alert` (latest migration `20261213090000`); a job would raise instead of run | **Confirmed live by T2: `inbox-sla` and `inbox-retention` fail every run since 2026-09-28 (silent missed SLA/retention)** | T3a hotfix first, then T3 redefines the full list; contract test proves each path accepted and an unknown one refused |
| Two schedulers run a job at once | Med (duplicates, though jobs are idempotent) | Strict order in T7; T5 overlap tests; compare run counts after cutover |
| No alert when a pg_cron job silently stops (Inngest gave this) | High | T6 builds the missed-job/non-2xx alert before T7 switches Inngest off |
| `cron.job_run_details` and `net._http_response` grow forever | Med | T6 daily cleanup job (7 d / 3 d) |
| Per-minute jobs cost Vercel invocations/duration | Med | D1 cadence decision; check host limits in T4; set `maxDuration` |
| Vault `CRON_SECRET` drifts from app env | Med | `set_cron_http_config` step in the runbook; T4 verifies a 200, not a 401 |
| Sweep reminds late (up to 5 min) or misses an edge | Low | 2 h lead makes it immaterial; T8 tests window-extended and answered cases; T10 parallel compare |
| Rolling back after Inngest code is deleted | High | Deletion is T13–T15, after the soak; rollback steps documented in T7 |
| `finance-ops-sweep` has never run in production | Med | Created inactive; enabling is its own explicit decision (D3) |

## Open questions (need your answer; defaults shown)

- **D1** Drain cadence: every minute (default if the worker is not deployed) or every 2–5 minutes?
- **D2** Make the knowledge job resumable (T12) or leave as is? Default: skip T12.
- **D3** Enable `finance-ops-sweep` now? Default: no, leave inactive.
- **D4** *(answered by T2: no, pg_cron runs the jobs; T7 is a no-op.)*
- **D5** *(answered by T2: not deployed.)* Keep the drains every minute unless you decide otherwise (D1).

## Notes

- Saved to `tasks/` as requested. `AGENTS.md` also allows a `docs/tasks/TASK-###` doc for discrete work; say so if you want this mirrored there.
- Verification commands used by every code task: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`. Migration tasks add a dry-run in a rolled-back transaction, then apply and verify (the project's migration convention).
- Tick `docs/inbox/checklist.md` in the same PR as any slice that belongs to it, only on merged and measured exits.
