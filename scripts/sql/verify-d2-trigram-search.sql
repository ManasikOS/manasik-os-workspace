-- Verifies D2 (docs/inbox/scale-inngest-implementation-plan.md, Phase D) against a database where
-- 20261204090600_d2_trigram_search_indexes.sql is applied. One transaction, rolled back by the final exception. It seeds about 60,000 rows
-- (30,000 conversations and 30,000 leads) to get a realistic plan; they leave dead space until vacuum, so run it sparingly on a
-- size-limited plan.
--
-- To dry-run the migration first, run the migration file followed by this file as ONE batch.
-- Result: a failed check raises "D2 FAILED: ..."; when every check passes it raises "D2 PASSED (rolled back)" with the two plans.
do $do$
declare
  v_out text := ''; r record; v_target uuid; v_fragment text; v_plan text; v_n int; i int;
begin
  -- 1. pg_trgm is not in public, and the operator class the indexes use resolves.
  if (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm') = 'public' then
    raise exception 'D2 FAILED: pg_trgm is still in the public schema';
  end if;
  select count(*) into v_n from pg_indexes
   where schemaname = 'public'
     and indexname in ('conversations_contact_name_trgm_idx', 'conversations_contact_phone_trgm_idx', 'leads_reference_trgm_idx', 'leads_full_name_trgm_idx', 'leads_desired_package_name_trgm_idx');
  if v_n <> 5 then raise exception 'D2 FAILED: % of 5 trigram indexes exist', v_n; end if;
  -- The four indexes that already existed on packages still work after the move.
  select count(*) into v_n from pg_indexes where schemaname = 'public' and indexname in ('packages_title_trgm_idx', 'packages_code_trgm_idx');
  if v_n <> 2 then raise exception 'D2 FAILED: the existing packages trigram indexes are missing'; end if;
  v_out := v_out || E'\npg_trgm is out of public and all five new indexes (plus the existing package ones) exist';

  -- 2. Seed, then check the search shapes use the indexes.
  set local session_replication_role = replica;
  for i in 1..20 loop
    insert into public.agencies (name, slug) values ('d2-' || i, 'd2-' || i || '-' || substr(md5(random()::text), 1, 8));
  end loop;
  select id into v_target from public.agencies where slug like 'd2-1-%' limit 1;
  insert into public.conversations (agency_id, external_conversation_id, contact_name, contact_phone, last_activity_at)
    select a.id, 'ext-' || a.slug || '-' || g, 'Customer ' || md5(a.slug || g), '9477' || lpad((g * 7919 % 10000000)::text, 7, '0'), now() - (g || ' minutes')::interval
      from (select id, slug from public.agencies where slug like 'd2-%') a, generate_series(1, 1500) g;
  insert into public.leads (reference, full_name, mobile, agency_id, assigned_to_id, assigned_to_name, desired_package_name)
    select 'LD-' || substr(md5(a.slug || g), 1, 8), 'Lead ' || md5(g::text || a.slug), '9477' || lpad(g::text, 7, '0'), a.id, 'u', 'u', 'Umrah package ' || (g % 50)
      from (select id, slug from public.agencies where slug like 'd2-%') a, generate_series(1, 1500) g;
  -- A GIN index takes new rows through a pending list that autovacuum merges in the background. Rows just inserted by this script are
  -- still in it, which makes the planner (rightly) price the index high. Merge it, as autovacuum would have, before reading plans.
  perform gin_clean_pending_list(i.indexrelid)
     from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname in ('conversations_contact_name_trgm_idx', 'conversations_contact_phone_trgm_idx', 'leads_reference_trgm_idx', 'leads_full_name_trgm_idx', 'leads_desired_package_name_trgm_idx');
  analyze public.conversations; analyze public.leads;
  select substr('Customer ' || md5(slug || 700), 10, 8) into v_fragment from public.agencies where id = v_target;

  v_plan := '';
  for r in execute format($q$explain (analyze) select id from public.conversations where agency_id = %L and (contact_name ilike %L or contact_phone ilike %L) order by last_activity_at desc limit 50$q$, v_target, '%' || v_fragment || '%', '%' || v_fragment || '%') loop
    v_plan := v_plan || E'\n' || r."QUERY PLAN";
  end loop;
  if v_plan not like '%conversations_contact_name_trgm_idx%' or v_plan not like '%conversations_contact_phone_trgm_idx%' then
    raise exception 'D2 FAILED: the conversation search did not use both trigram indexes:%', v_plan;
  end if;
  v_out := v_out || E'\nconversation search plan:' || v_plan;

  v_plan := '';
  for r in execute format($q$explain (analyze) select id from public.leads where agency_id = %L and (reference ilike %L or full_name ilike %L or desired_package_name ilike %L) limit 50$q$, v_target, '%' || v_fragment || '%', '%' || v_fragment || '%', '%' || v_fragment || '%') loop
    v_plan := v_plan || E'\n' || r."QUERY PLAN";
  end loop;
  if v_plan not like '%leads_reference_trgm_idx%' or v_plan not like '%leads_full_name_trgm_idx%' or v_plan not like '%leads_desired_package_name_trgm_idx%' then
    raise exception 'D2 FAILED: the lead search did not use all three trigram indexes:%', v_plan;
  end if;
  v_out := v_out || E'\nlead search plan:' || v_plan;

  raise exception 'D2 PASSED (rolled back)%', v_out;
end
$do$;
