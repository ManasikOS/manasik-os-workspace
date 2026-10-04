-- Q4 (docs/inbox/scale-inngest-implementation-plan.md §5.1, Phase Q): delivery ticks in batches instead of one UPDATE each.
--
-- Before: every status Meta sends (sent, delivered, read: about three per outbound message, roughly three quarters of all webhook
-- traffic) was its own UPDATE of a wide, heavily indexed `conversation_messages` row, in its own transaction, from the webhook.
-- It was also last-write-wins: a `read` that arrived before its `delivered` was overwritten, so a tick could go backwards.
--
-- After:
--   1. `apply_message_delivery_updates` applies many statuses in ONE statement. Several statuses for the same message collapse to the
--      furthest one (READ beats DELIVERED beats SENT), and a status never moves a message backwards.
--   2. With the always-on worker active, the webhook only appends to `message_delivery_status_buffer` (one multi-row INSERT per webhook,
--      no read-modify-write of the message) and `drain_message_delivery_status_buffer` applies up to a few hundred at once, every second.
--      The sent, delivered and read of one message, which used to be three UPDATEs, become one.
--   The open thread still updates: the existing row trigger broadcasts each changed row, and a status that changes nothing is skipped.
--
-- Nothing is lost if the worker is down: `drain_message_delivery_status_buffer` is also called by the scheduled drain, and a status is only
-- removed from the buffer in the same statement that applies it.
--
-- Deploy order: apply this migration BEFORE the code that calls it.

-- 1. Ordering of delivery states. PENDING < SENT and FAILED < DELIVERED < READ.
create or replace function public.delivery_status_rank(p_status text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_status
    when 'PENDING'   then 0
    when 'SENT'      then 1
    when 'FAILED'    then 1
    when 'DELIVERED' then 2
    when 'READ'      then 3
    else 0
  end
$$;

-- 2. The buffer. Service-role only: no policy is defined, so RLS denies everyone else.
create table if not exists public.message_delivery_status_buffer (
  id                   bigint generated always as identity primary key,
  agency_id            uuid not null references public.agencies (id) on delete cascade,
  external_message_id  text not null,
  delivery_status      text not null check (delivery_status in ('SENT', 'DELIVERED', 'READ', 'FAILED')),
  delivery_error       text,
  received_at          timestamptz not null default now()
);
comment on table public.message_delivery_status_buffer is
  'Delivery statuses reported by a channel, waiting to be applied to conversation_messages in a batch (Q4). Rows are deleted in the statement that applies them.';
alter table public.message_delivery_status_buffer enable row level security;
revoke all on table public.message_delivery_status_buffer from anon, authenticated;

-- 3. Apply many statuses in one statement. Returns the number of messages whose row actually changed.
create or replace function public.apply_message_delivery_updates(
  p_agency_ids           uuid[],
  p_external_message_ids text[],
  p_statuses             text[],
  p_errors               text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with incoming as (
    select t.agency_id, t.external_message_id, t.delivery_status, t.delivery_error, t.ord
      from unnest(p_agency_ids, p_external_message_ids, p_statuses, p_errors) with ordinality
             as t(agency_id, external_message_id, delivery_status, delivery_error, ord)
     where t.agency_id is not null and t.external_message_id is not null and t.delivery_status is not null
  ),
  -- One winner per message: the furthest state; among equals, the latest received.
  best as (
    select distinct on (i.agency_id, i.external_message_id)
           i.agency_id, i.external_message_id, i.delivery_status, i.delivery_error
      from incoming i
     order by i.agency_id, i.external_message_id, public.delivery_status_rank(i.delivery_status) desc, i.ord desc
  ),
  changed as (
    update public.conversation_messages m
       set delivery_status = b.delivery_status,
           delivery_error  = case when b.delivery_status = 'FAILED' then b.delivery_error else null end
      from best b
     where m.agency_id = b.agency_id
       and m.external_message_id = b.external_message_id
       -- Never backwards: a late `delivered` does not undo `read`.
       and public.delivery_status_rank(b.delivery_status) >= public.delivery_status_rank(m.delivery_status)
       -- And no write, no trigger, no broadcast when nothing changes.
       and (m.delivery_status, m.delivery_error) is distinct from
           (b.delivery_status, case when b.delivery_status = 'FAILED' then b.delivery_error else null end)
    returning 1
  )
  select count(*)::integer into v_changed from changed;

  return v_changed;
end;
$$;
revoke all on function public.apply_message_delivery_updates(uuid[], text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.apply_message_delivery_updates(uuid[], text[], text[], text[]) to service_role;

-- 4. Take up to p_limit buffered statuses and apply them. Two workers never take the same row (SKIP LOCKED), and a row leaves the
--    buffer in the same transaction that applies it, so a crash between the two puts it back rather than losing it.
create or replace function public.drain_message_delivery_status_buffer(p_limit integer default 500)
returns table (taken integer, changed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken   integer;
  v_changed integer;
  v_agency  uuid[];
  v_ext     text[];
  v_status  text[];
  v_error   text[];
begin
  with picked as (
    select e.id
      from public.message_delivery_status_buffer e
     order by e.id
     limit greatest(1, least(coalesce(p_limit, 500), 2000))
       for update skip locked
  ),
  removed as (
    delete from public.message_delivery_status_buffer e
     using picked p
     where e.id = p.id
    returning e.id, e.agency_id, e.external_message_id, e.delivery_status, e.delivery_error
  )
  select count(*)::integer,
         array_agg(r.agency_id order by r.id),
         array_agg(r.external_message_id order by r.id),
         array_agg(r.delivery_status order by r.id),
         array_agg(r.delivery_error order by r.id)
    into v_taken, v_agency, v_ext, v_status, v_error
    from removed r;

  if v_taken = 0 then
    return query select 0, 0;
    return;
  end if;

  v_changed := public.apply_message_delivery_updates(v_agency, v_ext, v_status, v_error);
  return query select v_taken, v_changed;
end;
$$;
revoke all on function public.drain_message_delivery_status_buffer(integer) from public, anon, authenticated;
grant execute on function public.drain_message_delivery_status_buffer(integer) to service_role;
