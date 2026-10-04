-- Housekeeping for two things the Inngest and attachment work left growing:
--
--   1. `inngest_outbox` keeps every forwarded event forever. Once Inngest has accepted an event the row has done its job; it is kept for a
--      short while (default 7 days) so a forwarding problem can still be traced, then deleted in small SKIP LOCKED batches. Dead rows
--      (12 failed attempts) are kept longer (default 30 days) because a person may still want to look at why.
--   2. A staff file is uploaded to the private `inbox-attachments` bucket BEFORE its message exists (F1). If the person then abandons the
--      composer, the file stays in storage with no `message_attachments` row pointing at it. `find_orphan_staged_uploads` lists those
--      objects so the nightly retention route can remove them through the Storage API (deleting the `storage.objects` row from SQL would
--      leave the file itself behind, so this function only READS).
--
-- Service-role only. Deploy order: independent of the code; apply before the code that calls them.

-- Keeps the purge an index range scan: only finished rows are in it.
create index if not exists inngest_outbox_finished_idx
  on public.inngest_outbox (coalesce(sent_at, dead_at))
  where sent_at is not null or dead_at is not null;

create or replace function public.purge_finished_inngest_outbox(
  p_sent_days integer default 7,
  p_dead_days integer default 30,
  p_batch     integer default 2000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent  integer := greatest(1, least(coalesce(p_sent_days, 7), 90));
  v_dead  integer := greatest(1, least(coalesce(p_dead_days, 30), 365));
  v_batch integer := greatest(1, least(coalesce(p_batch, 2000), 10000));
  v_n     integer;
begin
  with doomed as (
    select o.id from public.inngest_outbox o
     where (o.sent_at is not null and o.sent_at < now() - make_interval(days => v_sent))
        or (o.sent_at is null and o.dead_at is not null and o.dead_at < now() - make_interval(days => v_dead))
     order by coalesce(o.sent_at, o.dead_at)
     limit v_batch for update skip locked
  )
  delete from public.inngest_outbox o using doomed d where o.id = d.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_finished_inngest_outbox(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.purge_finished_inngest_outbox(integer, integer, integer) to service_role;

-- Staged staff files (`<agency>/outbound/<conversation>/<uuid>.<ext>`) older than p_older_than_hours that no message refers to.
-- The age floor keeps a file someone is still composing with; a file that becomes a message gets its `message_attachments` row in the
-- same transaction as the message, so it is never listed.
create or replace function public.find_orphan_staged_uploads(p_older_than_hours integer default 24, p_limit integer default 500)
returns table (name text)
language sql
security definer
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'inbox-attachments'
     and o.name ~ '^[0-9a-f-]{36}/outbound/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf|docx|xlsx|pptx)$'
     and o.created_at < now() - make_interval(hours => greatest(coalesce(p_older_than_hours, 24), 1))
     and not exists (select 1 from public.message_attachments a where a.storage_path = o.name)
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;
revoke all on function public.find_orphan_staged_uploads(integer, integer) from public, anon, authenticated;
grant execute on function public.find_orphan_staged_uploads(integer, integer) to service_role;
