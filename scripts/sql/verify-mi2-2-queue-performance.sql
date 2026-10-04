-- Performance verification for MI2.2 (part 4): rail counts and list pagination at 100 000 conversations.
-- Runs in one transaction and ENDS IN A DELIBERATE ERROR (nothing persists). Read the numbers in `VERIFY {...}`.
--
-- Notes when running this:
--   * ANALYZE after loading conversations, before filling membership. Without statistics the planner seq-scans
--     `conversations` for every foreign-key check (~1 ms/row) — a test artefact, not a production behaviour.
--   * The membership fill uses compute_conversation_queues(null) (linear). Passing a 100 000-element uuid[] instead is
--     quadratic (`id = any(array)` is not hashed for a non-constant array) — fine for the one-element refresh, wrong for a bulk fill.
--
-- Last run 2026-09-20, Manasik OS project, 100 000 conversations / 322 859 membership rows:
--   counts RPC p95 131.0 ms (max 202.4)  ·  list first page 5.9 ms  ·  page after 40 000 rows 3.1 ms
--   list plan: Index Only Scan on conversation_queue_membership_activity_idx
--   counts plan: HashAggregate over Seq Scan (95 ms) — NOT index-only; it reads ~every row of the agency, so it scales linearly
--   (~1.3 s expected at 1 M conversations: introduce per-queue counters before an agency reaches that size)
--   membership backfill of 322 859 rows: 44 s (one-time; chunk it for a very large existing agency)
--   RPC ALL count equals brute force; signed-out caller gets no counts; another staff member's MINE count reads 0.

do $$
declare
  c uuid; sc uuid; sc2 uuid; t0 timestamptz := now() - interval '2 days'; t timestamptz; N integer := 100000;
  durs double precision[] := '{}'; p95 double precision; pmax double precision; t_ins double precision; t_fill double precision;
  cnt_rows integer; plan_line text; plan_counts text := ''; plan_list text := ''; res jsonb := '{}'::jsonb; i integer;
  list_first double precision; list_deep double precision; cur_ts timestamptz; cur_id uuid; mine integer; mine_other integer; anon_rows integer; brute_all integer; rpc_all integer;
begin
  insert into public.agencies (name, slug) values ('Perf C', 'perf-c-' || gen_random_uuid()) returning id into c;
  set local session_replication_role = replica;
  sc := gen_random_uuid(); sc2 := gen_random_uuid();
  insert into public.staff_profiles (id, email, agency_id, role) values (sc, 'p-' || sc || '@verify.test', c, 'ADMIN'), (sc2, 'p2-' || sc2 || '@verify.test', c, 'ADMIN');
  t := clock_timestamp();
  insert into public.conversations (agency_id, external_conversation_id, channel, state, assigned_to_id, last_inbound_at, last_outbound_at, last_activity_at)
  select c, 'p' || g,
         (array['WHATSAPP','INSTAGRAM','MESSENGER','GMAIL'])[1 + (g % 4)],
         (array['AI_ACTIVE','HUMAN_REQUESTED','HUMAN_ACTIVE','CLOSED'])[1 + (g % 4 + (g / 4) % 2) % 4],
         case when g % 3 = 0 then sc else null end,
         case when g % 5 <> 0 then t0 + ((g % 2880) || ' minutes')::interval end,
         case when g % 7 <> 0 then t0 + (((g * 3) % 2880) || ' minutes')::interval end,
         t0 + ((g % 2880) || ' minutes')::interval
    from generate_series(1, N) g;
  t_ins := extract(epoch from clock_timestamp() - t);
  set local session_replication_role = origin;
  analyze public.conversations;
  t := clock_timestamp();
  insert into public.conversation_queue_membership (agency_id, queue_code, conversation_id, priority_rank, last_activity_at)
    select w.agency_id, w.queue_code, w.conversation_id, w.priority_rank, w.last_activity_at
      from public.compute_conversation_queues(null) w where w.agency_id = c;
  t_fill := extract(epoch from clock_timestamp() - t);
  select count(*) into cnt_rows from public.conversation_queue_membership where agency_id = c;
  res := res || jsonb_build_object('n', N, 'insert_conversations_s', round(t_ins::numeric,1), 'backfill_s', round(t_fill::numeric,1), 'membership_rows', cnt_rows);
  analyze public.conversation_queue_membership;
  select count(*) filter (where state <> 'CLOSED') into brute_all from public.conversations where agency_id = c;

  perform set_config('request.jwt.claims', json_build_object('sub', sc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 1..15 loop
    t := clock_timestamp();
    perform * from public.inbox_queue_counts(sc);
    durs := durs || (extract(epoch from clock_timestamp() - t) * 1000);
  end loop;
  select percentile_cont(0.95) within group (order by d), max(d) into p95, pmax from unnest(durs) d;
  res := res || jsonb_build_object('counts_rpc_p95_ms', round(p95::numeric, 1), 'counts_rpc_max_ms', round(pmax::numeric, 1));
  select conversation_count into rpc_all from public.inbox_queue_counts(sc) where queue_code = 'ALL';
  select conversation_count into mine from public.inbox_queue_counts(sc) where queue_code = 'MINE';
  select conversation_count into mine_other from public.inbox_queue_counts(sc2) where queue_code = 'MINE';
  res := res || jsonb_build_object('rpc_ALL_matches_brute_force', rpc_all = brute_all, 'mine_for_self_positive', mine > 0, 'other_staff_mine_hidden', coalesce(mine_other, 0) = 0);

  t := clock_timestamp();
  perform conversation_id from public.conversation_queue_membership where agency_id = c and queue_code = 'ALL' order by last_activity_at desc, conversation_id desc limit 101;
  list_first := extract(epoch from clock_timestamp() - t) * 1000;
  select last_activity_at, conversation_id into cur_ts, cur_id from public.conversation_queue_membership where agency_id = c and queue_code = 'ALL' order by last_activity_at desc, conversation_id desc offset 40000 limit 1;
  t := clock_timestamp();
  perform conversation_id from public.conversation_queue_membership where agency_id = c and queue_code = 'ALL' and (last_activity_at, conversation_id) < (cur_ts, cur_id) order by last_activity_at desc, conversation_id desc limit 101;
  list_deep := extract(epoch from clock_timestamp() - t) * 1000;
  res := res || jsonb_build_object('list_first_page_ms', round(list_first::numeric, 2), 'list_page_after_40000_ms', round(list_deep::numeric, 2));
  for plan_line in execute 'explain (analyze, costs off, timing off) select queue_code, count(*) from public.conversation_queue_membership where agency_id = ''' || c || ''' group by queue_code' loop
    plan_counts := plan_counts || plan_line || ' | ';
  end loop;
  for plan_line in execute 'explain (analyze, costs off, timing off) select conversation_id from public.conversation_queue_membership where agency_id = ''' || c || ''' and queue_code = ''ALL'' and (last_activity_at, conversation_id) < (''' || cur_ts || ''', ''' || cur_id || ''') order by last_activity_at desc, conversation_id desc limit 101' loop
    plan_list := plan_list || plan_line || ' | ';
  end loop;
  res := res || jsonb_build_object('plan_counts', plan_counts, 'plan_list', plan_list);

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into anon_rows from public.inbox_queue_counts(sc);
  res := res || jsonb_build_object('signed_out_sees_no_counts', anon_rows = 0);
  reset role;
  raise exception 'VERIFY %', res::text;
end $$;
