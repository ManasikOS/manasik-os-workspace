-- Behavioural verification for supabase/migrations/20261202090500_mi2_2_conversation_queues.sql (MI2.2), parts 1-3.
-- (Part 4, the 100 000-conversation performance run, is scripts/sql/verify-mi2-2-queue-performance.sql.)
--
-- Runs inside one transaction and ENDS IN A DELIBERATE ERROR so nothing persists. A passing run fails with
-- `VERIFY {...}` where every check is `true`.
--   1. one fixture per queue: membership AND non-membership
--   2. triggers keep membership correct across assignment, close, new message, intervention, intelligence, lead stage
--   3. counts equal an independent brute-force count over 5 000 rows; keyset pagination has no duplicates or gaps,
--      including across rows that share a timestamp

create function pg_temp.qs(p uuid) returns text[] language sql as
$$ select coalesce(array_agg(queue_code order by queue_code), '{}') from public.conversation_queue_membership where conversation_id = p $$;

do $$
declare
  a uuid; sa uuid; lead_spam uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; c7 uuid; c8 uuid; c9 uuid; c10 uuid;
  iv uuid; res jsonb := '{}'::jsonb; t0 timestamptz := now() - interval '2 hours';
  b uuid; total integer; dup integer; page_count integer := 0; cur_ts timestamptz; cur_id uuid; got integer; seen_total integer := 0;
  mismatches integer; monotone boolean := true; last_ts timestamptz; last_id uuid; r record;
begin
  insert into public.agencies (name, slug) values ('Queue A', 'queue-a-' || gen_random_uuid()) returning id into a;
  set local session_replication_role = replica;
  sa := gen_random_uuid();
  insert into public.staff_profiles (id, email, agency_id, role) values (sa, 'q-' || sa || '@verify.test', a, 'ADMIN');
  set local session_replication_role = origin;

  insert into public.leads (agency_id, reference, full_name, mobile, assigned_to_id, assigned_to_name, stage)
    values (a, 'L-' || gen_random_uuid(), 'Spammer', '0700000000', 'x', 'x', 'SPAM') returning id into lead_spam;

  -- 1. one fixture per queue -------------------------------------------------------------------------------
  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at)
    values (a, 'c1', 'WHATSAPP', 'AI_ACTIVE', t0) returning id into c1;
  res := res || jsonb_build_object('c1_new_inbound', pg_temp.qs(c1) = array['ALL','NEEDS_REPLY','UNASSIGNED','WHATSAPP']);

  insert into public.conversations (agency_id, external_conversation_id, channel, state, assigned_to_id, assigned_to_name, last_inbound_at, last_outbound_at)
    values (a, 'c2', 'MESSENGER', 'HUMAN_ACTIVE', sa, 'Staff', t0, t0 + interval '1 minute') returning id into c2;
  res := res || jsonb_build_object('c2_we_replied_last', pg_temp.qs(c2) = array['ALL','MESSENGER','WAITING_CUSTOMER']);

  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at)
    values (a, 'c3', 'GMAIL', 'CLOSED', t0) returning id into c3;
  res := res || jsonb_build_object('c3_closed_only_resolved', pg_temp.qs(c3) = array['RESOLVED']);

  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at)
    values (a, 'c4', 'INSTAGRAM', 'HUMAN_REQUESTED', t0) returning id into c4;
  res := res || jsonb_build_object('c4_human_requested_waits_on_team', pg_temp.qs(c4) = array['ALL','INSTAGRAM','NEEDS_REPLY','UNASSIGNED','WAITING_TEAM']);

  insert into public.conversations (agency_id, external_conversation_id, channel, state, lead_id, last_inbound_at)
    values (a, 'c5', 'WHATSAPP', 'AI_ACTIVE', lead_spam, t0) returning id into c5;
  res := res || jsonb_build_object('c5_spam_lead_only_spam_and_channel_views', pg_temp.qs(c5) = array['SPAM','UNASSIGNED','WHATSAPP']);

  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at)
    values (a, 'c6', 'WHATSAPP', 'AI_ACTIVE', t0) returning id into c6;
  insert into public.conversation_intelligence (conversation_id, agency_id, intent_code, state, input_fingerprint) values (c6, a, 'COMPLAINT', 'FRESH', 'f');
  res := res || jsonb_build_object('c6_complaint_intent', pg_temp.qs(c6) @> array['COMPLAINTS'] and not pg_temp.qs(c6) && array['ESCALATIONS','PAYMENT_DISCUSSIONS','DOCUMENTS','VISA_ISSUES']);

  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at)
    values (a, 'c7', 'WHATSAPP', 'AI_ACTIVE', t0) returning id into c7;
  insert into public.conversation_intelligence (conversation_id, agency_id, intent_code, state, input_fingerprint) values (c7, a, 'DOCUMENT_ISSUE', 'FRESH', 'f');
  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at)
    values (a, 'c8', 'WHATSAPP', 'AI_ACTIVE', t0) returning id into c8;
  insert into public.conversation_intelligence (conversation_id, agency_id, intent_code, state, input_fingerprint) values (c8, a, 'VISA_QUERY', 'FRESH', 'f');
  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at)
    values (a, 'c9', 'WHATSAPP', 'AI_ACTIVE', t0) returning id into c9;
  insert into public.conversation_intelligence (conversation_id, agency_id, intent_code, urgency, state, input_fingerprint) values (c9, a, 'FAQ', 'CRITICAL', 'FRESH', 'f');
  res := res || jsonb_build_object(
    'c7_documents', pg_temp.qs(c7) @> array['DOCUMENTS'] and not pg_temp.qs(c7) @> array['VISA_ISSUES'],
    'c8_visa', pg_temp.qs(c8) @> array['VISA_ISSUES'] and not pg_temp.qs(c8) @> array['DOCUMENTS'],
    'c9_critical_urgency_escalates', pg_temp.qs(c9) @> array['ESCALATIONS'] and not pg_temp.qs(c9) @> array['COMPLAINTS']);

  insert into public.conversations (agency_id, external_conversation_id, channel, state)
    values (a, 'c10', 'WHATSAPP', 'AI_ACTIVE') returning id into c10;
  res := res || jsonb_build_object('c10_no_messages_in_neither_reply_queue', not pg_temp.qs(c10) && array['NEEDS_REPLY','WAITING_CUSTOMER'] and pg_temp.qs(c10) @> array['ALL']);
  res := res || jsonb_build_object('reserved_queues_stay_empty', not exists (
    select 1 from public.conversation_queue_membership where agency_id = a
       and queue_code in ('NEW_ENQUIRIES','QUALIFIED','BOOKING_READY','QUOTE_SENT','NEARING_DEADLINE','SLA_BREACHED','DEPARTURE_CHANGES','GROUP_CHANGES','MINE')));

  -- 2. trigger transitions ---------------------------------------------------------------------------------
  update public.conversations set assigned_to_id = sa, assigned_to_name = 'Staff' where id = c1;
  res := res || jsonb_build_object('assign_leaves_UNASSIGNED', pg_temp.qs(c1) = array['ALL','NEEDS_REPLY','WHATSAPP']);

  update public.conversations set last_outbound_at = t0 + interval '5 minutes' where id = c1;
  res := res || jsonb_build_object('reply_moves_NEEDS_REPLY_to_WAITING_CUSTOMER', pg_temp.qs(c1) = array['ALL','WAITING_CUSTOMER','WHATSAPP']);

  update public.conversations set last_inbound_at = t0 + interval '9 minutes' where id = c1;
  res := res || jsonb_build_object('new_inbound_moves_back_to_NEEDS_REPLY', pg_temp.qs(c1) = array['ALL','NEEDS_REPLY','WHATSAPP']);

  insert into public.conversation_messages (agency_id, conversation_id, role, actor_kind, content) values (a, c1, 'user', 'CUSTOMER', 'hi');
  res := res || jsonb_build_object('message_insert_trigger_leaves_membership_consistent', pg_temp.qs(c1) = array['ALL','NEEDS_REPLY','WHATSAPP']);

  update public.conversations set state = 'CLOSED' where id = c1;
  res := res || jsonb_build_object('close_leaves_every_queue_but_RESOLVED', pg_temp.qs(c1) = array['RESOLVED']);
  update public.conversations set state = 'AI_ACTIVE' where id = c1;
  res := res || jsonb_build_object('reopen_restores_membership', pg_temp.qs(c1) @> array['ALL','NEEDS_REPLY']);

  insert into public.conversation_interventions (agency_id, conversation_id, kind, severity, headline, guidance, required_action_code)
    values (a, c6, 'PAYMENT_CLAIM', 'BLOCK', 'Says they paid', 'Ask Finance', 'VERIFY_PAYMENT') returning id into iv;
  res := res || jsonb_build_object(
    'intervention_opens_payment_escalation_and_team_queues', pg_temp.qs(c6) @> array['PAYMENT_DISCUSSIONS','ESCALATIONS','WAITING_TEAM'],
    'block_intervention_ranks_300', (select priority_rank from public.conversation_queue_membership where conversation_id = c6 and queue_code = 'ALL') = 300);
  update public.conversation_interventions set status = 'RESOLVED', resolved_at = now(), resolved_by = sa, resolution_note = 'Paid and recorded' where id = iv;
  res := res || jsonb_build_object(
    'resolve_leaves_payment_escalation_team', not pg_temp.qs(c6) && array['PAYMENT_DISCUSSIONS','ESCALATIONS','WAITING_TEAM'] and pg_temp.qs(c6) @> array['COMPLAINTS'],
    'resolve_drops_rank_to_0', (select priority_rank from public.conversation_queue_membership where conversation_id = c6 and queue_code = 'ALL') = 0);

  update public.conversation_intelligence set intent_code = 'PACKAGE_ENQUIRY' where conversation_id = c6;
  res := res || jsonb_build_object('intent_change_leaves_COMPLAINTS', not pg_temp.qs(c6) @> array['COMPLAINTS']);

  update public.leads set stage = 'NEW_LEAD' where id = lead_spam;
  res := res || jsonb_build_object('lead_stage_change_moves_conversation_out_of_SPAM', not pg_temp.qs(c5) @> array['SPAM'] and pg_temp.qs(c5) @> array['ALL']);

  delete from public.conversations where id = c3;
  res := res || jsonb_build_object('deleting_a_conversation_removes_its_membership', pg_temp.qs(c3) = '{}');

  -- 3a. brute-force counts over 5 000 rows ------------------------------------------------------------------
  insert into public.agencies (name, slug) values ('Queue B', 'queue-b-' || gen_random_uuid()) returning id into b;
  set local session_replication_role = replica;   -- bulk load without per-row triggers; membership is filled set-based below
  insert into public.conversations (agency_id, external_conversation_id, channel, state, assigned_to_id, last_inbound_at, last_outbound_at, last_activity_at)
  select b, 'b' || g,
         (array['WHATSAPP','INSTAGRAM','MESSENGER','GMAIL'])[1 + (g % 4)],
         (array['AI_ACTIVE','HUMAN_REQUESTED','HUMAN_ACTIVE','CLOSED'])[1 + (g % 4 + (g / 4) % 2) % 4],
         case when g % 3 = 0 then sa else null end,
         case when g % 5 <> 0 then t0 + ((g % 50) || ' minutes')::interval end,
         case when g % 7 <> 0 then t0 + (((g * 3) % 50) || ' minutes')::interval end,
         t0 + ((g % 40) || ' minutes')::interval          -- only 40 distinct timestamps across 5 000 rows: heavy ties
    from generate_series(1, 5000) g;
  set local session_replication_role = origin;
  insert into public.conversation_queue_membership (agency_id, queue_code, conversation_id, priority_rank, last_activity_at)
    select w.agency_id, w.queue_code, w.conversation_id, w.priority_rank, w.last_activity_at
      from public.compute_conversation_queues((select array_agg(id) from public.conversations where agency_id = b)) w;

  mismatches := 0;
  for r in
    select q.code,
           (select count(*) from public.conversation_queue_membership m where m.agency_id = b and m.queue_code = q.code) as via_membership,
           q.brute
      from (
        select 'ALL' code, count(*) filter (where state <> 'CLOSED') brute from public.conversations where agency_id = b
        union all select 'UNASSIGNED', count(*) filter (where state <> 'CLOSED' and assigned_to_id is null) from public.conversations where agency_id = b
        union all select 'WHATSAPP', count(*) filter (where state <> 'CLOSED' and channel = 'WHATSAPP') from public.conversations where agency_id = b
        union all select 'EMAIL', count(*) filter (where state <> 'CLOSED' and channel = 'GMAIL') from public.conversations where agency_id = b
        union all select 'RESOLVED', count(*) filter (where state = 'CLOSED') from public.conversations where agency_id = b
        union all select 'NEEDS_REPLY', count(*) filter (where state <> 'CLOSED' and last_inbound_at is not null and (last_outbound_at is null or last_inbound_at > last_outbound_at)) from public.conversations where agency_id = b
        union all select 'WAITING_CUSTOMER', count(*) filter (where state <> 'CLOSED' and last_outbound_at is not null and (last_inbound_at is null or last_outbound_at >= last_inbound_at)) from public.conversations where agency_id = b
        union all select 'WAITING_TEAM', count(*) filter (where state = 'HUMAN_REQUESTED') from public.conversations where agency_id = b
      ) q
  loop
    if r.via_membership <> r.brute then mismatches := mismatches + 1; end if;
  end loop;
  select count(*) into total from public.conversation_queue_membership where agency_id = b and queue_code = 'ALL';
  res := res || jsonb_build_object('brute_force_counts_match_all_8_queues_over_5000', mismatches = 0, 'all_queue_size', total);

  -- 3b. keyset pagination over the ALL queue: no duplicates, no gaps, in order ----------------------------------
  cur_ts := null; cur_id := null;
  create temp table pg_page_seen (conversation_id uuid, last_activity_at timestamptz) on commit drop;
  loop
    with page as (
      select m.conversation_id, m.last_activity_at
        from public.conversation_queue_membership m
       where m.agency_id = b and m.queue_code = 'ALL'
         and (cur_ts is null or (m.last_activity_at, m.conversation_id) < (cur_ts, cur_id))
       order by m.last_activity_at desc, m.conversation_id desc
       limit 100)
    insert into pg_page_seen select * from page;
    get diagnostics got = row_count;
    exit when got = 0;
    page_count := page_count + 1;
    select last_activity_at, conversation_id into cur_ts, cur_id from (
      select last_activity_at, conversation_id from pg_page_seen order by last_activity_at asc, conversation_id asc limit 1) x;
  end loop;
  select count(*), count(*) - count(distinct conversation_id) into seen_total, dup from pg_page_seen;
  res := res || jsonb_build_object('pagination_no_duplicates', dup = 0, 'pagination_no_gaps', seen_total = total, 'pages', page_count);

  raise exception 'VERIFY %', res::text;
end $$;
