# Inngest (removed)

Inngest is no longer part of this system (decision R9, [`architecture.md`](../inbox/architecture.md) §16). This page is kept so old links still land
somewhere. Nothing here needs doing.

## What replaced it

| It used to | Now |
|---|---|
| Run the scheduled jobs and the raw-event reconciler on a timer | `pg_cron` calls the same `/api/cron/*` routes. The reconciler runs inside `agent-jobs`. See [`supabase-scheduling.md`](supabase-scheduling.md) |
| Remind the owner before a reply window closes (a function that slept) | The `reply-window-sweep` job (`lib/inbox/window-sweep.ts`), every 5 minutes, through the same follow-up ledger |
| Chunk and embed knowledge documents in steps | The `EMBED_DOCUMENT` job on `agent_jobs`, queued by `lib/agent/whatsapp/knowledge/queue.ts` |
| Receive events through the `inngest_outbox` table and the worker's forwarder | Nothing: no events leave the database any more |

## What was removed

- Code: `lib/inbox/inngest/*`, `app/api/inngest`, the forwarder in the `agent-jobs` route and in the worker (`WORKER_FORWARD_INNGEST`), the outbox purge in the
  nightly housekeeping, the `/api/inngest` entry in `proxy.ts`, and the packages `inngest` and `@inngest/middleware-encryption`.
- Settings: every `INNGEST_*` variable (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_ENCRYPTION_KEY`, `INNGEST_ENCRYPTION_KEY_PREVIOUS`,
  `INNGEST_SCHEDULES_ENABLED`, `INNGEST_FINANCE_SWEEP_ENABLED`, `INNGEST_DRAIN_CRON`, `INNGEST_KNOWLEDGE_INGEST`, `INNGEST_BASE_URL`).
  Remove them from the hosting project too (they are harmless but unused).
- Database (migration `20261227090000_drop_inngest_outbox.sql`): the three `conversations_window_opened_*` triggers and `trg_enqueue_window_opened`, the table
  `inngest_outbox`, and `enqueue_inngest_event`, `claim_inngest_outbox`, `complete_inngest_outbox`, `fail_inngest_outbox`, `purge_finished_inngest_outbox`.
- Scripts: `scripts/sql/cutover-i3-pg-cron-to-inngest.sql`, `verify-i1-inngest-outbox.sql`, `verify-i4-reply-window-reminder.sql`.

## What was kept

The follow-up ledger and its `WINDOW_REMINDER` kind, the `REPLY_WINDOW_CLOSING` notification kind, `find_orphan_staged_uploads` and the raw-event reconcile functions,
all still used. The knowledge ingest phase functions in `lib/agent/whatsapp/knowledge/ingest.ts` are unused but kept, with tests, in case resumable ingestion is wanted.

## Finishing the removal outside the repository

1. In the Inngest dashboard, delete the app (or at least confirm it shows no functions and no runs). The app no longer answers `/api/inngest`.
2. Delete the Inngest integration from the Vercel project and remove the `INNGEST_*` variables.
3. Cancel the Inngest account or plan if you no longer want it.

The history of how it worked is in git (the commit before "remove Inngest from the app") and in
[`scale-inngest-implementation-plan.md`](../inbox/scale-inngest-implementation-plan.md) (partly superseded).
