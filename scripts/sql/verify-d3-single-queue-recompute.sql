-- Verifies D3 (docs/inbox/scale-inngest-implementation-plan.md, Phase D) against a database where
-- 20261204090700_d3_single_queue_recompute.sql is applied. One transaction, rolled back by the final exception.
-- To dry-run the migration first, run the migration file followed by this file as ONE batch.
--
-- Proves: (1) one inbound message computes queue membership once; (2) membership and the per-queue counters still match the
-- definition (compute_conversation_queues) after every kind of change; (3) the message trigger is gone and the others are not.
-- Result: a failed check raises "D3 FAILED: ..."; when every check passes it raises "D3 PASSED (rolled back)" with one line per check.
do $do$
declare
  v_out text := ''; v_agency uuid; v_conv uuid; v_lead uuid; i int; v_calls bigint; v_before bigint;
  v_member text; v_expected text; v_counter text; v_actual text;
begin
  set local track_functions = 'all';
  insert into public.agencies (name, slug) values ('d3-a', 'd3-a-' || substr(md5(random()::text), 1, 8)) returning id into v_agency;
  insert into public.conversations (agency_id, external_conversation_id) values (v_agency, 'd3-wa') returning id into v_conv;

  -- 1. Structure: the redundant trigger is gone; every trigger that feeds compute's real inputs remains.
  if exists (select 1 from pg_trigger t where t.tgname = 'conversation_messages_refresh_queues' and not t.tgisinternal) then
    raise exception 'D3 FAILED: the message-insert refresh trigger still exists';
  end if;
  if (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in
        ('conversations_refresh_queues', 'conversation_intelligence_refresh_queues', 'conversation_interventions_refresh_queues', 'leads_refresh_conversation_queues')) <> 4 then
    raise exception 'D3 FAILED: a trigger on one of compute''s real inputs is missing';
  end if;
  v_out := v_out || E'\nthe message trigger is gone; the four triggers on compute''s real inputs remain';

  -- 2. One computation per inbound message: the conversation update that records it, then the message insert.
  v_before := coalesce((select pg_stat_get_xact_function_calls('public.compute_conversation_queues(uuid[])'::regprocedure)), 0);
  for i in 1..20 loop
    update public.conversations set last_inbound_at = now() + (i || ' seconds')::interval, last_activity_at = now() + (i || ' seconds')::interval, state = 'AI_ACTIVE' where id = v_conv;
    insert into public.conversation_messages (agency_id, conversation_id, external_message_id, role, actor_kind, content, message_type)
      values (v_agency, v_conv, 'd3-in-' || i, 'user', 'CUSTOMER', 'hi', 'TEXT');
  end loop;
  v_calls := coalesce((select pg_stat_get_xact_function_calls('public.compute_conversation_queues(uuid[])'::regprocedure)), 0) - v_before;
  if v_calls <> 20 then raise exception 'D3 FAILED: 20 inbound messages ran compute % times (expected 20, one each)', v_calls; end if;
  v_out := v_out || E'\n20 inbound messages ran the computation 20 times (it was 4 per message)';

  -- A message on its own changes no queue input, so it does not recompute at all.
  v_before := coalesce((select pg_stat_get_xact_function_calls('public.compute_conversation_queues(uuid[])'::regprocedure)), 0);
  insert into public.conversation_messages (agency_id, conversation_id, external_message_id, role, actor_kind, content, message_type)
    values (v_agency, v_conv, 'd3-alone', 'user', 'CUSTOMER', 'hi', 'TEXT');
  if coalesce((select pg_stat_get_xact_function_calls('public.compute_conversation_queues(uuid[])'::regprocedure)), 0) - v_before <> 0 then
    raise exception 'D3 FAILED: a message insert on its own still recomputed queues';
  end if;
  v_out := v_out || E'\na message insert on its own recomputes nothing';

  -- 3. After each kind of change, membership equals the definition and the counters equal the membership.
  --    check(label) is inlined below as a block, repeated per scenario, to keep this a single self-contained script.

  -- 3a. Inbound, AI owned.
  select string_agg(queue_code, ',' order by queue_code) into v_member from public.conversation_queue_membership where conversation_id = v_conv;
  select string_agg(w.queue_code, ',' order by w.queue_code) into v_expected from public.compute_conversation_queues(array[v_conv]) w;
  if v_member is distinct from v_expected or v_member not like '%NEEDS_REPLY%' then raise exception 'D3 FAILED: inbound membership % vs definition %', v_member, v_expected; end if;

  -- 3b. A reply goes out: NEEDS_REPLY becomes WAITING_CUSTOMER, and the counters follow.
  update public.conversations set last_outbound_at = now() + interval '1 hour', last_activity_at = now() + interval '1 hour' where id = v_conv;
  select string_agg(queue_code, ',' order by queue_code) into v_member from public.conversation_queue_membership where conversation_id = v_conv;
  select string_agg(w.queue_code, ',' order by w.queue_code) into v_expected from public.compute_conversation_queues(array[v_conv]) w;
  if v_member is distinct from v_expected or v_member like '%NEEDS_REPLY%' or v_member not like '%WAITING_CUSTOMER%' then
    raise exception 'D3 FAILED: after a reply, membership % vs definition %', v_member, v_expected;
  end if;

  -- 3c. Needs a person.
  update public.conversations set state = 'HUMAN_REQUESTED' where id = v_conv;
  select string_agg(queue_code, ',' order by queue_code) into v_member from public.conversation_queue_membership where conversation_id = v_conv;
  select string_agg(w.queue_code, ',' order by w.queue_code) into v_expected from public.compute_conversation_queues(array[v_conv]) w;
  if v_member is distinct from v_expected or v_member not like '%WAITING_TEAM%' then raise exception 'D3 FAILED: HUMAN_REQUESTED membership % vs definition %', v_member, v_expected; end if;

  -- 3d. The lead is marked spam (the lead trigger recomputes).
  insert into public.leads (reference, full_name, mobile, agency_id, assigned_to_id, assigned_to_name)
    values ('D3-' || substr(md5(random()::text), 1, 8), 'D3 Lead', '94770000003', v_agency, 'u', 'u') returning id into v_lead;
  update public.conversations set lead_id = v_lead where id = v_conv;
  update public.leads set stage = 'SPAM' where id = v_lead;
  select string_agg(queue_code, ',' order by queue_code) into v_member from public.conversation_queue_membership where conversation_id = v_conv;
  select string_agg(w.queue_code, ',' order by w.queue_code) into v_expected from public.compute_conversation_queues(array[v_conv]) w;
  -- A spam lead is in SPAM and out of ALL and out of the work queues (it stays UNASSIGNED and on its channel).
  if v_member is distinct from v_expected or v_member not like '%SPAM%' or v_member like '%ALL%' or v_member like '%WAITING_TEAM%' then
    raise exception 'D3 FAILED: spam lead membership % vs definition %', v_member, v_expected;
  end if;

  -- 3e. Closed.
  update public.leads set stage = 'NEW_LEAD' where id = v_lead;
  update public.conversations set state = 'CLOSED' where id = v_conv;
  select string_agg(queue_code, ',' order by queue_code) into v_member from public.conversation_queue_membership where conversation_id = v_conv;
  select string_agg(w.queue_code, ',' order by w.queue_code) into v_expected from public.compute_conversation_queues(array[v_conv]) w;
  if v_member is distinct from v_expected or v_member <> 'RESOLVED' then raise exception 'D3 FAILED: closed membership % vs definition %', v_member, v_expected; end if;

  -- Counters equal the membership, per queue, for this agency.
  select string_agg(queue_code || '=' || conversation_count, ',' order by queue_code) into v_counter from public.conversation_queue_counts where agency_id = v_agency;
  select string_agg(queue_code || '=' || n, ',' order by queue_code) into v_actual
    from (select queue_code, count(*) n from public.conversation_queue_membership where agency_id = v_agency group by queue_code) s;
  if v_counter is distinct from v_actual then raise exception 'D3 FAILED: counters % do not match membership %', v_counter, v_actual; end if;
  v_out := v_out || E'\nmembership matches the definition and the counters match membership after: inbound, reply, needs-a-person, spam lead, closed';

  raise exception 'D3 PASSED (rolled back)%', v_out;
end
$do$;
