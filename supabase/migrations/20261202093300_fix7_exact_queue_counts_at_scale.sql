-- FIX7: exact queue counts without reading every membership row on each rail render.
-- Counter changes are derived transactionally from the old and new memberships, so
-- no cache can become stale between a write and the Inbox read that follows it.

begin;

create table if not exists public.conversation_queue_counts (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  queue_code text not null,
  conversation_count integer not null check (conversation_count >= 0),
  primary key (agency_id, queue_code)
);

comment on table public.conversation_queue_counts is
  'Exact, internal counters for conversation_queue_membership. Only refresh_conversation_queues writes it; the rail reads it through inbox_queue_counts.';

alter table public.conversation_queue_counts enable row level security;
revoke all on table public.conversation_queue_counts from public, anon, authenticated;

-- Serialize membership writers while counters are backfilled. A writer that began
-- before this migration either finishes before the lock, or waits and uses the
-- replacement function after this transaction commits.
lock table public.conversation_queue_membership in share row exclusive mode;

insert into public.conversation_queue_counts as q (agency_id, queue_code, conversation_count)
select m.agency_id, m.queue_code, count(*)::integer
  from public.conversation_queue_membership m
 group by m.agency_id, m.queue_code
on conflict (agency_id, queue_code) do update
  set conversation_count = excluded.conversation_count;

-- A re-run must remove a counter for a queue which no longer has membership.
delete from public.conversation_queue_counts q
 where not exists (
   select 1
     from public.conversation_queue_membership m
    where m.agency_id = q.agency_id and m.queue_code = q.queue_code
 );

-- MINE remains user-specific rather than membership-backed. This partial index
-- gives its exact count the same bounded access path as the stored queues.
create index if not exists conversations_agency_assignee_open_count_idx
  on public.conversations (agency_id, assigned_to_id)
  where state <> 'CLOSED';

create or replace function public.refresh_conversation_queues(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_id uuid;
  v_old_queue_codes text[] := '{}'::text[];
  v_new_queue_codes text[] := '{}'::text[];
  v_computed_agency_id uuid;
begin
  -- The normal trigger paths can overlap (for example, a message and an
  -- intervention written together). Serializing one conversation prevents a
  -- stale old-set from applying its counter delta twice.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_conversation_id::text, 0));

  select m.agency_id,
         coalesce(array_agg(m.queue_code), '{}'::text[])
    into v_agency_id, v_old_queue_codes
    from public.conversation_queue_membership m
   where m.conversation_id = p_conversation_id
   group by m.agency_id;

  select coalesce(array_agg(w.queue_code), '{}'::text[]),
         (array_agg(w.agency_id))[1]
    into v_new_queue_codes, v_computed_agency_id
    from public.compute_conversation_queues(array[p_conversation_id]) w;

  v_agency_id := coalesce(v_agency_id, v_computed_agency_id);
  if v_agency_id is null then return; end if;

  delete from public.conversation_queue_membership m
   where m.agency_id = v_agency_id
     and m.conversation_id = p_conversation_id
     and not (m.queue_code = any (v_new_queue_codes));

  insert into public.conversation_queue_membership as m (agency_id, queue_code, conversation_id, priority_rank, last_activity_at)
  select w.agency_id, w.queue_code, w.conversation_id, w.priority_rank, w.last_activity_at
    from public.compute_conversation_queues(array[p_conversation_id]) w
  on conflict (agency_id, queue_code, conversation_id) do update
    set priority_rank = excluded.priority_rank,
        last_activity_at = excluded.last_activity_at
    where (m.priority_rank, m.last_activity_at) is distinct from (excluded.priority_rank, excluded.last_activity_at);

  with queue_deltas as (
    select d.queue_code, sum(d.delta)::integer as delta
      from (
        select unnest(v_new_queue_codes) as queue_code, 1 as delta
        union all
        select unnest(v_old_queue_codes) as queue_code, -1 as delta
      ) d
     group by d.queue_code
    having sum(d.delta) <> 0
  )
  insert into public.conversation_queue_counts as q (agency_id, queue_code, conversation_count)
  select v_agency_id, d.queue_code, d.delta
    from queue_deltas d
  on conflict (agency_id, queue_code) do update
    set conversation_count = q.conversation_count + excluded.conversation_count;

  delete from public.conversation_queue_counts q
   where q.agency_id = v_agency_id and q.conversation_count = 0;
end;
$$;

revoke all on function public.refresh_conversation_queues(uuid) from public, anon, authenticated;
grant execute on function public.refresh_conversation_queues(uuid) to service_role;

create or replace function public.inbox_queue_counts(p_staff_id uuid)
returns table (queue_code text, conversation_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
begin
  if v_agency is null
     or not public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA') then
    return;
  end if;

  return query
    select q.queue_code, q.conversation_count
      from public.conversation_queue_counts q
     where q.agency_id = v_agency
    union all
    select 'MINE', count(*)::integer
      from public.conversations c
     where c.agency_id = v_agency
       and c.assigned_to_id = p_staff_id
       and p_staff_id = auth.uid()
       and c.state <> 'CLOSED';
end;
$$;

revoke all on function public.inbox_queue_counts(uuid) from public, anon, authenticated;
grant execute on function public.inbox_queue_counts(uuid) to authenticated, service_role;

commit;
