-- T15 (tasks/plan.md): remove what only Inngest used (decision R9).
--
-- Inngest is gone from the app: the forwarder, the worker's forwarding loop, the `/api/inngest` route and the packages were removed in T13 and
-- T14, and the reply-window reminder now runs as the pg_cron sweep (T8 to T10). What is left in the database is the machinery that fed it:
--
--   * three triggers on public.conversations that wrote a `inbox/conversation.window_opened` event into the outbox when a person-owned chat's
--     reply window opened, and the function they call (`trg_enqueue_window_opened`);
--   * the outbox table `public.inngest_outbox` (5 rows at the time of writing, all already sent: ids and timestamps only) and the five functions
--     that read and write it.
--
-- RELEASE ORDER: deploy the code that no longer calls any of these FIRST, then apply this. While the old code runs, the housekeeping job calls
-- `purge_finished_inngest_outbox` and would count a failure every night once that function is gone; the old agent-jobs route also calls
-- `claim_inngest_outbox`. After the T13/T14 deploy nothing calls them.
--
-- Not touched: the follow-up ledger and its `WINDOW_REMINDER` kind, the `REPLY_WINDOW_CLOSING` notification kind (the sweep uses both), the
-- `find_orphan_staged_uploads` function (still used by the nightly housekeeping), and the raw-event reconcile functions (still used).
--
-- Rollback: the objects are defined in 20261204090300_i1_inngest_outbox.sql, 20261204091000_e1_outbox_purge_and_orphan_uploads.sql and
-- 20261204090900_i4_reply_window_reminder.sql; re-apply those statements. The 5 outbox rows would be lost; they are only a record of events that
-- were already delivered.

-- 1. Stop new events: the triggers, then the function they call.
drop trigger if exists conversations_window_opened_on_insert on public.conversations;
drop trigger if exists conversations_window_opened_on_window on public.conversations;
drop trigger if exists conversations_window_opened_on_handoff on public.conversations;
drop function if exists public.trg_enqueue_window_opened();

-- 2. The functions over the outbox (before the table: claim_inngest_outbox returns the table's row type).
drop function if exists public.purge_finished_inngest_outbox(integer, integer, integer);
drop function if exists public.complete_inngest_outbox(uuid[]);
drop function if exists public.fail_inngest_outbox(uuid, text);
drop function if exists public.claim_inngest_outbox(integer, integer);
drop function if exists public.enqueue_inngest_event(uuid, text, jsonb);

-- 3. The table, with its indexes.
drop table if exists public.inngest_outbox;
