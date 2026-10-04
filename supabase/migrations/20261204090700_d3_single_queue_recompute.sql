-- D3 (docs/inbox/scale-inngest-implementation-plan.md, Phase D): recompute a conversation's queue membership once per inbound message,
-- not four times.
--
-- Before, one inbound message ran `compute_conversation_queues` FOUR times:
--   * twice per refresh: `refresh_conversation_queues` called it once to learn the new queue codes and again to insert them; and
--   * two refreshes per message: one from the `conversations` update trigger (the upsert that records last_inbound_at), and a second from
--     `conversation_messages_refresh_queues` when the message row was inserted.
-- All of it inside the webhook's latency budget, under a per-conversation advisory lock.
--
-- Why the message trigger can go: queue membership is a function of `compute_conversation_queues`, which reads only `conversations`,
-- `leads`, `conversation_intelligence` and `conversation_interventions`, never `conversation_messages`. A message insert changes none of its
-- inputs, so the refresh it triggered recomputed an unchanged answer. Whatever a message means for queues (last_inbound_at, last_outbound_at,
-- last_activity_at) is written to the `conversations` row, and that row's own trigger refreshes. The trigger's comment called it "belt and
-- braces"; it was redundant belt.
--
-- Why the double compute can go: every row `compute_conversation_queues` returns for one conversation carries the same agency, priority rank
-- and activity time (they come from one row of `ranked`), so one call yields everything the delete, the insert and the counters need.
--
-- The result is identical: same rows, same counters, same locking. Only the number of computations changes.
--
-- Deploy order: independent of the code.

drop trigger if exists conversation_messages_refresh_queues on public.conversation_messages;

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
  v_priority_rank integer;
  v_activity_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_conversation_id::text, 0));

  select m.agency_id,
         coalesce(array_agg(m.queue_code), '{}'::text[])
    into v_agency_id, v_old_queue_codes
    from public.conversation_queue_membership m
   where m.conversation_id = p_conversation_id
   group by m.agency_id;

  -- The one computation. Agency, rank and activity time are the same on every row for a conversation.
  select coalesce(array_agg(w.queue_code), '{}'::text[]),
         (array_agg(w.agency_id))[1],
         (array_agg(w.priority_rank))[1],
         (array_agg(w.last_activity_at))[1]
    into v_new_queue_codes, v_computed_agency_id, v_priority_rank, v_activity_at
    from public.compute_conversation_queues(array[p_conversation_id]) w;

  v_agency_id := coalesce(v_agency_id, v_computed_agency_id);
  if v_agency_id is null then return; end if;

  delete from public.conversation_queue_membership m
   where m.agency_id = v_agency_id
     and m.conversation_id = p_conversation_id
     and not (m.queue_code = any (v_new_queue_codes));

  insert into public.conversation_queue_membership as m (agency_id, queue_code, conversation_id, priority_rank, last_activity_at)
  select v_agency_id, q.queue_code, p_conversation_id, v_priority_rank, v_activity_at
    from unnest(v_new_queue_codes) as q(queue_code)
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
