-- Behavioural verification for supabase/migrations/20261202090200_mi1_1_channel_jobs.sql (MI1.1).
--
-- Run against a database that has the migration applied (Supabase SQL editor or the MCP execute_sql tool).
-- It creates synthetic agencies/jobs, checks every behaviour, then ENDS IN A DELIBERATE ERROR so the whole
-- transaction rolls back and nothing persists. A passing run fails with `VERIFY {...}` where every value
-- is `true` and the benchmark numbers meet the exit criterion (claim p95 < 50 ms, no starvation).
--
-- Last run 2026-09-20 against the Manasik OS project: all true; 10 000 rows / 50 agencies (one holding 8 040),
-- claim p95 21.15 ms, max 28.61 ms, all 50 agencies served on each of the first 40 ticks.

set local session_replication_role = replica;  -- synthetic agencies only; rolled back with everything else
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  id1 uuid; id2 uuid; n integer; ra1 timestamptz; ra2 timestamptz; pay jsonb;
  claimed_a integer; claimed_b integer; claimed_again integer;
  st text; st2 text; att integer; ok_wrong boolean; ok_right boolean;
  released integer; s1 text;
  t0 timestamptz; durs double precision[] := '{}'; p95 double precision; pmax double precision;
  tick integer; got integer; served integer; min_served integer := 1000000; agencies uuid[] := '{}'; i integer;
  res jsonb := '{}'::jsonb; total_rows integer;
begin
  -- 1. coalescing
  id1 := public.enqueue_channel_job(a,'REALTIME','ENRICH','enrich:x','{"n":1}',0,0,3);
  id2 := public.enqueue_channel_job(a,'REALTIME','ENRICH','enrich:x','{"n":2}',0,4,3);
  select count(*), max(run_after), min(run_after), (array_agg(payload))[1] into n, ra2, ra1, pay from public.channel_jobs where agency_id=a and coalesce_key='enrich:x';
  res := res || jsonb_build_object('coalesce_one_row', n=1 and id1=id2, 'coalesce_later_run_after', ra2 > now(), 'coalesce_payload_latest', pay->>'n' = '2');
  perform public.enqueue_channel_job(b,'REALTIME','ENRICH','enrich:x','{}',0,0,3);
  select count(*) into n from public.channel_jobs where coalesce_key='enrich:x';
  res := res || jsonb_build_object('coalesce_is_per_agency', n=2);
  delete from public.channel_jobs;

  -- 2. fairness + 3. per-agency cap
  insert into public.channel_jobs (agency_id, lane, kind) select a,'REALTIME','ENRICH' from generate_series(1,500);
  insert into public.channel_jobs (agency_id, lane, kind) select b,'REALTIME','ENRICH' from generate_series(1,5);
  select count(*) filter (where agency_id=a), count(*) filter (where agency_id=b) into claimed_a, claimed_b from public.claim_channel_jobs('REALTIME','w1',20,10);
  select count(*) into claimed_again from public.claim_channel_jobs('REALTIME','w2',20,10) where agency_id=a;
  res := res || jsonb_build_object('fair_A_capped_at_10', claimed_a=10, 'fair_B_all_5_served_same_tick', claimed_b=5, 'cap_blocks_A_when_10_in_flight', claimed_again=0);
  delete from public.channel_jobs;

  -- 4. retry, backoff, dead-letter
  insert into public.channel_jobs (id, agency_id, lane, kind, max_attempts) values (id1, c,'BULK','REPLAY',2);
  perform * from public.claim_channel_jobs('BULK','wA',5,5);
  ok_wrong := public.complete_channel_job(id1,'someone-else');
  st := public.fail_channel_job(id1,'wA','boom',60);
  select run_after > now() into ok_right from public.channel_jobs where id=id1;
  select count(*) into got from public.claim_channel_jobs('BULK','wA',5,5);
  update public.channel_jobs set run_after = now() where id=id1;
  perform * from public.claim_channel_jobs('BULK','wA',5,5);
  st2 := public.fail_channel_job(id1,'wA','boom again',60);
  select attempts into att from public.channel_jobs where id=id1;
  res := res || jsonb_build_object('first_failure_requeued', st='QUEUED', 'backoff_delays_reclaim', ok_right and got=0, 'second_failure_dead', st2='DEAD', 'attempts_counted', att=2, 'wrong_worker_cannot_complete', ok_wrong=false);
  delete from public.channel_jobs;

  -- 5. stale lock release
  insert into public.channel_jobs (agency_id, lane, kind, status, attempts, max_attempts, locked_at, locked_by)
    values (a,'BULK','REPLAY','RUNNING',1,3, now() - interval '10 minutes','dead-worker'),
           (a,'BULK','REPLAY','RUNNING',3,3, now() - interval '10 minutes','dead-worker'),
           (a,'BULK','REPLAY','RUNNING',1,3, now(), 'live-worker');
  released := public.release_stale_channel_jobs(300);
  select string_agg(status, ',' order by attempts, locked_by nulls last) into s1 from public.channel_jobs;
  res := res || jsonb_build_object('stale_released_count_2', released=2, 'statuses', s1);
  delete from public.channel_jobs;

  -- 6. privileges: the queue crosses tenants, so no signed-in session may call it
  res := res || jsonb_build_object(
    'authenticated_cannot_claim', not has_function_privilege('authenticated','public.claim_channel_jobs(text,text,integer,integer)','execute'),
    'anon_cannot_claim', not has_function_privilege('anon','public.claim_channel_jobs(text,text,integer,integer)','execute'),
    'authenticated_cannot_enqueue', not has_function_privilege('authenticated','public.enqueue_channel_job(uuid,text,text,text,jsonb,integer,integer,integer)','execute'),
    'service_role_can_claim', has_function_privilege('service_role','public.claim_channel_jobs(text,text,integer,integer)','execute'));

  -- 7. benchmark: 10 000 queued rows across 50 agencies, skewed, 100 ticks
  for i in 1..50 loop agencies := agencies || gen_random_uuid(); end loop;
  insert into public.channel_jobs (agency_id, lane, kind) select agencies[1],'STANDARD','OFFER_MATCH' from generate_series(1,8040);
  for i in 2..50 loop
    insert into public.channel_jobs (agency_id, lane, kind) select agencies[i],'STANDARD','OFFER_MATCH' from generate_series(1,40);
  end loop;
  analyze public.channel_jobs;
  select count(*) into total_rows from public.channel_jobs;
  for tick in 1..100 loop
    t0 := clock_timestamp();
    create temp table if not exists tick_claim (id uuid, agency_id uuid) on commit drop;
    truncate tick_claim;
    insert into tick_claim select id, agency_id from public.claim_channel_jobs('STANDARD','bench',50,5);
    durs := durs || (extract(epoch from (clock_timestamp() - t0)) * 1000);
    select count(distinct agency_id) into served from tick_claim;
    if tick <= 40 then min_served := least(min_served, served); end if;
    update public.channel_jobs set status='DONE', locked_at=null, locked_by=null where id in (select id from tick_claim);
  end loop;
  select percentile_cont(0.95) within group (order by d), max(d) into p95, pmax from unnest(durs) d;
  res := res || jsonb_build_object('bench_rows', total_rows, 'bench_claim_p95_ms', round(p95::numeric,2), 'bench_claim_max_ms', round(pmax::numeric,2), 'bench_min_agencies_served_per_tick_first_40', min_served);

  raise exception 'VERIFY %', res::text;
end $$;
