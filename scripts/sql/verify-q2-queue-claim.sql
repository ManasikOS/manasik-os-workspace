-- Verifies Q2 (docs/inbox/scale-inngest-implementation-plan.md, Phase Q) against a database where
-- 20261204090100_q2_queue_claim.sql is applied. Everything runs in one transaction that is rolled back by the final exception, so
-- nothing is written (the 50,000 timing rows included; they leave dead space until vacuum).
--
-- To dry-run the migration first, run the migration file followed by this file as ONE batch: the final exception aborts the whole
-- transaction, migration included.
--
-- Result: a failed check raises "Q2 FAILED: ..." naming it. When every check passes the script still raises, so nothing is kept,
-- with "Q2 PASSED (rolled back)", one line per check, and the timings.
do $do$
declare
  v_out text := '';
  v_a uuid; v_b uuid; v_c uuid;
  v_ids uuid[]; v_n int; v_lease timestamptz; v_status text; v_attempts int;
  v_j1 uuid; v_j2 uuid; v_j3 uuid; v_j4 uuid; v_j5 uuid;
  v_ms numeric[] := '{}'; t0 timestamptz; i int; v_claimed int; v_total int := 0; v_queued bigint; v_p50 numeric; v_p95 numeric; v_max numeric;

begin
  insert into public.agencies (name, slug) values ('q2-a', 'q2-a-' || substr(md5(random()::text), 1, 8)) returning id into v_a;
  insert into public.agencies (name, slug) values ('q2-b', 'q2-b-' || substr(md5(random()::text), 1, 8)) returning id into v_b;
  insert into public.agencies (name, slug) values ('q2-c', 'q2-c-' || substr(md5(random()::text), 1, 8)) returning id into v_c;
  -- Park every other QUEUED REALTIME job so the claims below see only these fixtures.
  update public.channel_jobs set run_after = now() + interval '1 day' where lane = 'REALTIME' and status = 'QUEUED';

  -- 1. The old four-argument call still works (the lease defaults), so code deployed before the lease change keeps claiming.
  perform * from public.claim_channel_jobs('REALTIME', 'q2-old-caller', 1, 1);
  v_out := v_out || E'\nthe four-argument call still works';

  -- 2. Who is chosen, and in what order, is unchanged: per agency by priority then age, capped, round-robin across agencies.
  --    A has five due jobs (priorities 0,0,10,10,5), B three (all 0), C one; per-agency cap 2.
  insert into public.channel_jobs (agency_id, lane, kind, payload, priority, status, run_after)
    values (v_a, 'REALTIME', 'ENRICH', '{"n":1}', 0,  'QUEUED', now() - interval '50 seconds'),
           (v_a, 'REALTIME', 'ENRICH', '{"n":2}', 0,  'QUEUED', now() - interval '40 seconds'),
           (v_a, 'REALTIME', 'ENRICH', '{"n":3}', 10, 'QUEUED', now() - interval '30 seconds'),
           (v_a, 'REALTIME', 'ENRICH', '{"n":4}', 10, 'QUEUED', now() - interval '20 seconds'),
           (v_a, 'REALTIME', 'ENRICH', '{"n":5}', 5,  'QUEUED', now() - interval '10 seconds'),
           (v_b, 'REALTIME', 'ENRICH', '{"n":6}', 0,  'QUEUED', now() - interval '30 seconds'),
           (v_b, 'REALTIME', 'ENRICH', '{"n":7}', 0,  'QUEUED', now() - interval '20 seconds'),
           (v_b, 'REALTIME', 'ENRICH', '{"n":8}', 0,  'QUEUED', now() - interval '10 seconds'),
           (v_c, 'REALTIME', 'ENRICH', '{"n":9}', 0,  'QUEUED', now() - interval '5 seconds');

  -- A limit of 3 returns each agency's best job first (rank 1 of A, B and C), not three of A's.
  select array_agg(id) into v_ids from public.claim_channel_jobs('REALTIME', 'q2-w1', 3, 2);
  select count(distinct agency_id) into v_n from public.channel_jobs where id = any(v_ids);
  if coalesce(array_length(v_ids, 1), 0) <> 3 or v_n <> 3 then raise exception 'Q2 FAILED: limit 3 did not take one job from each of three agencies (got % jobs, % agencies)', array_length(v_ids, 1), v_n; end if;
  if (select payload ->> 'n' from public.channel_jobs where id = any(v_ids) and agency_id = v_a) <> '3' then
    raise exception 'Q2 FAILED: agency A''s first pick was not its highest-priority, oldest job';
  end if;
  v_out := v_out || E'\nlimit 3 takes rank 1 from each agency; within an agency the highest priority, then oldest, comes first';

  -- The rest: cap 2 in flight per agency. A has 1 in flight (n=3), B 1, C 1 (its only job).
  select array_agg(id) into v_ids from public.claim_channel_jobs('REALTIME', 'q2-w2', 20, 2);
  select count(*) into v_n from public.channel_jobs where agency_id = v_a and status = 'RUNNING';
  if v_n <> 2 then raise exception 'Q2 FAILED: agency A has % running, the cap is 2', v_n; end if;
  select count(*) into v_n from public.channel_jobs where agency_id = v_b and status = 'RUNNING';
  if v_n <> 2 then raise exception 'Q2 FAILED: agency B has % running, the cap is 2', v_n; end if;
  if (select array_agg(payload ->> 'n' order by payload ->> 'n') from public.channel_jobs where agency_id = v_a and status = 'RUNNING') <> array['3','4'] then
    raise exception 'Q2 FAILED: agency A did not run its two priority-10 jobs';
  end if;
  v_out := v_out || E'\nthe per-agency cap counts jobs already in flight, and the two priority-10 jobs ran first';

  -- No job is handed out twice.
  perform * from public.claim_channel_jobs('REALTIME', 'q2-w3', 20, 10);
  select count(*) into v_n from public.channel_jobs where agency_id in (v_a, v_b, v_c) and status = 'RUNNING' and locked_by in ('q2-w1', 'q2-w2') and attempts <> 1;
  if v_n <> 0 then raise exception 'Q2 FAILED: % jobs already claimed by an earlier worker were claimed again', v_n; end if;
  v_out := v_out || E'\na running job is never claimed a second time';

  update public.channel_jobs set status = 'DONE', locked_at = null, locked_until = null, locked_by = null where agency_id in (v_a, v_b, v_c);

  -- 3. Leases. A live in-flight job counts against the cap; one whose lease ran out does not.
  insert into public.channel_jobs (agency_id, lane, kind, payload, status, locked_at, locked_until, locked_by, attempts)
    values (v_a, 'REALTIME', 'ENRICH', '{}', 'RUNNING', now(), now() + interval '60 seconds', 'q2-live', 1),
           (v_b, 'REALTIME', 'ENRICH', '{}', 'RUNNING', now() - interval '3 minutes', now() - interval '1 minute', 'q2-dead', 1);
  insert into public.channel_jobs (agency_id, lane, kind, payload, status, run_after)
    values (v_a, 'REALTIME', 'ENRICH', '{}', 'QUEUED', now() - interval '1 second'),
           (v_a, 'REALTIME', 'ENRICH', '{}', 'QUEUED', now() - interval '1 second'),
           (v_b, 'REALTIME', 'ENRICH', '{}', 'QUEUED', now() - interval '1 second'),
           (v_b, 'REALTIME', 'ENRICH', '{}', 'QUEUED', now() - interval '1 second');
  perform * from public.claim_channel_jobs('REALTIME', 'q2-w4', 20, 2);
  select count(*) into v_n from public.channel_jobs where agency_id = v_a and status = 'RUNNING' and locked_by = 'q2-w4';
  if v_n <> 1 then raise exception 'Q2 FAILED: agency A has a live job in flight and a cap of 2, so it should get 1 more, got %', v_n; end if;
  select count(*) into v_n from public.channel_jobs where agency_id = v_b and status = 'RUNNING' and locked_by = 'q2-w4';
  if v_n <> 2 then raise exception 'Q2 FAILED: agency B''s only in-flight job had an expired lease, so it should get 2, got %', v_n; end if;
  v_out := v_out || E'\na live in-flight job counts against the cap; one whose lease has run out does not';

  -- The claim stamps the lease it was asked for.
  update public.channel_jobs set status = 'DONE', locked_until = null, locked_at = null, locked_by = null where agency_id in (v_a, v_b);
  insert into public.channel_jobs (agency_id, lane, kind, payload, status, run_after)
    values (v_c, 'REALTIME', 'ENRICH', '{}', 'QUEUED', now() - interval '1 second') returning id into v_j1;
  perform * from public.claim_channel_jobs('REALTIME', 'q2-w5', 5, 5, 45);
  select locked_until into v_lease from public.channel_jobs where id = v_j1;
  if v_lease is null or v_lease < now() + interval '44 seconds' or v_lease > now() + interval '46 seconds' then
    raise exception 'Q2 FAILED: the lease was not stamped as 45 s ahead (got %)', v_lease;
  end if;
  perform public.complete_channel_job(v_j1, 'q2-w5');
  select locked_until into v_lease from public.channel_jobs where id = v_j1;
  if v_lease is not null then raise exception 'Q2 FAILED: completing a job left its lease set'; end if;
  v_out := v_out || E'\nthe claim stamps the requested lease and completing the job clears it';

  -- 4. One reply per conversation, now lease-aware: a live RUNNING reply blocks the next one; an expired one does not.
  insert into public.channel_jobs (agency_id, lane, kind, coalesce_key, payload, status, locked_at, locked_until, locked_by, attempts)
    values (v_a, 'REALTIME', 'REPLY', 'reply:q2-live-conv', '{}', 'RUNNING', now(), now() + interval '60 seconds', 'q2-live', 1),
           (v_a, 'REALTIME', 'REPLY', 'reply:q2-dead-conv', '{}', 'RUNNING', now() - interval '3 minutes', now() - interval '1 minute', 'q2-dead', 1);
  insert into public.channel_jobs (agency_id, lane, kind, coalesce_key, payload, status, run_after)
    values (v_a, 'REALTIME', 'REPLY', 'reply:q2-live-conv', '{}', 'QUEUED', now() - interval '1 second') returning id into v_j2;
  insert into public.channel_jobs (agency_id, lane, kind, coalesce_key, payload, status, run_after)
    values (v_a, 'REALTIME', 'REPLY', 'reply:q2-dead-conv', '{}', 'QUEUED', now() - interval '1 second') returning id into v_j3;
  select array_agg(id) into v_ids from public.claim_channel_jobs('REALTIME', 'q2-w6', 20, 10);
  if v_j2 = any(coalesce(v_ids, '{}')) then raise exception 'Q2 FAILED: a REPLY was claimed while a live one ran for the same conversation'; end if;
  if not (v_j3 = any(coalesce(v_ids, '{}'))) then raise exception 'Q2 FAILED: a REPLY stayed blocked behind a dead worker''s expired lease'; end if;
  v_out := v_out || E'\nan expired lease no longer blocks the next reply for its conversation; a live one still does';

  -- 5. Stale release uses the lease, with the old rule for rows that have none.
  update public.channel_jobs set status = 'DONE', locked_until = null, locked_at = null, locked_by = null where agency_id in (v_a, v_b, v_c);
  insert into public.channel_jobs (agency_id, lane, kind, payload, status, locked_at, locked_until, locked_by, attempts, max_attempts)
    values (v_a, 'REALTIME', 'ENRICH', '{}', 'RUNNING', now() - interval '3 minutes', now() - interval '30 seconds', 'x', 1, 3) returning id into v_j1;
  insert into public.channel_jobs (agency_id, lane, kind, payload, status, locked_at, locked_until, locked_by, attempts, max_attempts)
    values (v_a, 'REALTIME', 'ENRICH', '{}', 'RUNNING', now(), now() + interval '60 seconds', 'y', 1, 3) returning id into v_j2;
  insert into public.channel_jobs (agency_id, lane, kind, payload, status, locked_at, locked_until, locked_by, attempts, max_attempts)
    values (v_a, 'REALTIME', 'ENRICH', '{}', 'RUNNING', now() - interval '10 minutes', null, 'z', 1, 3) returning id into v_j3;
  insert into public.channel_jobs (agency_id, lane, kind, payload, status, locked_at, locked_until, locked_by, attempts, max_attempts)
    values (v_a, 'REALTIME', 'ENRICH', '{}', 'RUNNING', now() - interval '3 minutes', now() - interval '30 seconds', 'w', 3, 3) returning id into v_j4;
  insert into public.channel_jobs (agency_id, lane, kind, payload, status, locked_at, locked_until, locked_by, attempts, max_attempts)
    values (v_a, 'REALTIME', 'ENRICH', '{}', 'RUNNING', now() - interval '1 minute', null, 'v', 1, 3) returning id into v_j5;
  select public.release_stale_channel_jobs(300) into v_n;
  select status into v_status from public.channel_jobs where id = v_j1;
  if v_status <> 'QUEUED' then raise exception 'Q2 FAILED: a job with an expired lease was not released (%)', v_status; end if;
  select status into v_status from public.channel_jobs where id = v_j2;
  if v_status <> 'RUNNING' then raise exception 'Q2 FAILED: a job with a live lease was released (%)', v_status; end if;
  select status into v_status from public.channel_jobs where id = v_j3;
  if v_status <> 'QUEUED' then raise exception 'Q2 FAILED: a lease-less job untouched for 10 minutes was not released (%)', v_status; end if;
  select status into v_status from public.channel_jobs where id = v_j4;
  if v_status <> 'DEAD' then raise exception 'Q2 FAILED: an expired job out of attempts was not dead-lettered (%)', v_status; end if;
  select status into v_status from public.channel_jobs where id = v_j5;
  if v_status <> 'RUNNING' then raise exception 'Q2 FAILED: a lease-less job untouched for only 1 minute was released early (%)', v_status; end if;
  v_out := v_out || E'\nstale release follows the lease (live untouched, expired released, out of attempts dead-lettered) and keeps the 5-minute rule for lease-less rows';

  update public.channel_jobs set status = 'DONE', locked_until = null, locked_at = null, locked_by = null where agency_id in (v_a, v_b, v_c);

  -- 6. Timing: 50 agencies x 1,000 due queued jobs (50,000), 20 claims of 20 jobs, per-agency cap 10. Before Q2 (measured on
  --    Manasik OS): p50 80.30 ms, p95 84.02 ms, max 87.93 ms.
  insert into public.agencies (name, slug)
    select 'q2-perf-' || g, 'q2-perf-' || g || '-' || substr(md5(random()::text), 1, 8) from generate_series(1, 47) g;
  insert into public.channel_jobs (agency_id, lane, kind, payload, priority, status, run_after)
    select a.id, 'REALTIME', 'ENRICH', '{}'::jsonb, (n % 3) * 5, 'QUEUED', now() - (n || ' milliseconds')::interval
      from (select id from public.agencies) a cross join generate_series(1, 1000) n;
  analyze public.channel_jobs;
  select count(*) into v_queued from public.channel_jobs where lane = 'REALTIME' and status = 'QUEUED' and run_after <= now();
  for i in 1..20 loop
    t0 := clock_timestamp();
    select count(*) into v_claimed from public.claim_channel_jobs('REALTIME', 'q2-perf', 20, 10);
    v_ms := v_ms || (extract(epoch from clock_timestamp() - t0) * 1000)::numeric;
    v_total := v_total + v_claimed;
  end loop;
  select percentile_cont(0.5) within group (order by x), percentile_cont(0.95) within group (order by x), max(x) into v_p50, v_p95, v_max from unnest(v_ms) x;
  if v_p95 >= 20 then raise exception 'Q2 FAILED: claim p95 was % ms with % due jobs (the target is under 20 ms)', round(v_p95, 2), v_queued; end if;

  raise exception 'Q2 PASSED (rolled back):%
TIMING: due_queued=% claims=20 jobs_claimed=% p50_ms=% p95_ms=% max_ms=% (before Q2: p50 80.30, p95 84.02, max 87.93)',
    v_out, v_queued, v_total, round(v_p50, 2), round(v_p95, 2), round(v_max, 2);
end
$do$;
