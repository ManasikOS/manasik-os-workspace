-- D1 (docs/inbox/scale-inngest-implementation-plan.md, Phase D): retention for the tables that grow without bound.
--
-- The nightly per-agency sweep (lib/inbox/retention/sweep.ts) now also covers raw WhatsApp deliveries, and finished `channel_jobs` and
-- `agent_jobs` rows. This migration adds what that sweep cannot do or needs to do cheaply:
--
--   1. Partial indexes so each night's page of finished jobs is an index range scan, not a scan of the table. They hold only finished
--      rows, so a job costs one index entry when it finishes and none while it is queued or running.
--   2. `purge_unattributed_raw_events`: raw deliveries with NO agency (an unknown phone number or Page, or a rejected signature) belong
--      to no agency, so the per-agency sweep never reaches them. They are the rows an unauthenticated caller can create, so they must
--      not live forever. Deleted in small SKIP LOCKED batches; service-role only.
--
-- Deploy order: independent of the code (the sweep works without the indexes, only slower); apply before the code for speed.

create index if not exists channel_jobs_finished_idx
  on public.channel_jobs (agency_id, created_at, id)
  where status in ('DONE', 'DEAD');
create index if not exists agent_jobs_finished_idx
  on public.agent_jobs (agency_id, created_at, id)
  where status in ('DONE', 'DEAD');

-- The unattributed purge scans by age; only agency-less rows are in these indexes.
create index if not exists whatsapp_webhook_events_unattributed_idx
  on public.whatsapp_webhook_events (received_at)
  where agency_id is null;
create index if not exists channel_webhook_events_unattributed_idx
  on public.channel_webhook_events (received_at)
  where agency_id is null;

-- Deletes up to p_batch agency-less raw deliveries older than p_days, from each table. Returns the number deleted. The window is
-- bounded to 1..90 days (the platform bound for raw payloads, architecture.md R7).
create or replace function public.purge_unattributed_raw_events(p_days integer default 30, p_batch integer default 2000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 30), 90));
  v_batch integer := greatest(1, least(coalesce(p_batch, 2000), 10000));
  v_total integer := 0;
  v_n     integer;
begin
  with doomed as (
    select e.id from public.whatsapp_webhook_events e
     where e.agency_id is null and e.received_at < now() - make_interval(days => v_days)
     order by e.received_at
     limit v_batch for update skip locked
  )
  delete from public.whatsapp_webhook_events e using doomed d where e.id = d.id;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  with doomed as (
    select e.id from public.channel_webhook_events e
     where e.agency_id is null and e.received_at < now() - make_interval(days => v_days)
     order by e.received_at
     limit v_batch for update skip locked
  )
  delete from public.channel_webhook_events e using doomed d where e.id = d.id;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  return v_total;
end;
$$;
revoke all on function public.purge_unattributed_raw_events(integer, integer) from public, anon, authenticated;
grant execute on function public.purge_unattributed_raw_events(integer, integer) to service_role;
