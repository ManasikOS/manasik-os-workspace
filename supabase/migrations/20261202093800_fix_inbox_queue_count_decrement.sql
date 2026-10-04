-- A negative queue delta cannot be the proposed INSERT row: PostgreSQL checks
-- conversation_count >= 0 before ON CONFLICT can turn that row into an UPDATE.
-- Apply additions and removals separately so an inbound message can move a
-- conversation from WAITING_CUSTOMER to NEEDS_REPLY without aborting ingest.

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
    having sum(d.delta) > 0
  )
  insert into public.conversation_queue_counts as q (agency_id, queue_code, conversation_count)
  select v_agency_id, d.queue_code, d.delta
    from queue_deltas d
  on conflict (agency_id, queue_code) do update
    set conversation_count = q.conversation_count + excluded.conversation_count;

  with queue_deltas as (
    select d.queue_code, sum(d.delta)::integer as delta
      from (
        select unnest(v_new_queue_codes) as queue_code, 1 as delta
        union all
        select unnest(v_old_queue_codes) as queue_code, -1 as delta
      ) d
     group by d.queue_code
    having sum(d.delta) < 0
  )
  update public.conversation_queue_counts q
     set conversation_count = q.conversation_count + d.delta
    from queue_deltas d
   where q.agency_id = v_agency_id
     and q.queue_code = d.queue_code;

  delete from public.conversation_queue_counts q
   where q.agency_id = v_agency_id and q.conversation_count = 0;
end;
$$;

revoke all on function public.refresh_conversation_queues(uuid) from public, anon, authenticated;
grant execute on function public.refresh_conversation_queues(uuid) to service_role;
