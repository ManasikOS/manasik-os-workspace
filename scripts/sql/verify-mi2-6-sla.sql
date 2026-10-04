-- Behavioural verification for supabase/migrations/20261202091100_mi2_6_inbox_sla_policies.sql (MI2.6 exit criterion):
-- NEARING_DEADLINE and SLA_BREACHED membership is correct, a breach raises priority, a paused / closed / cleared
-- conversation is in neither, and the seeded policies match R2. Runs in one transaction and ENDS IN A DELIBERATE
-- ERROR so nothing persists; read the numbers in `VERIFY {...}`.
--
-- Last run 2026-09-21, Manasik OS: deadline_counts {SLA_BREACHED 1, NEARING_DEADLINE 1}; the breached conversation ranked 150 in ALL and left
-- SLA_BREACHED once its deadline was cleared; far-off, no-deadline and closed conversations were in neither queue; all 12 policies seeded on
-- every agency with R2's numbers; a policy for a paused queue and a zero-minute target were both rejected by the check constraints.

do $$
declare
  a uuid; res jsonb := '{}'::jsonb; c_breach uuid; c_near uuid; c_far uuid; c_none uuid; c_closed uuid;
  rows jsonb; seeded jsonb;
begin
  insert into public.agencies (name, slug) values ('SLA A', 'sla-a-' || gen_random_uuid()) returning id into a;

  -- All five awaiting a reply (customer wrote last), differing only in sla_due_at / state.
  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at, sla_due_at)
    values (a, 'breach', 'WHATSAPP', 'AI_ACTIVE', now() - interval '3 hours', now() - interval '5 minutes') returning id into c_breach;
  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at, sla_due_at)
    values (a, 'near',   'WHATSAPP', 'AI_ACTIVE', now() - interval '1 hour', now() + interval '10 minutes') returning id into c_near;
  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at, sla_due_at)
    values (a, 'far',    'WHATSAPP', 'AI_ACTIVE', now() - interval '1 minute', now() + interval '3 hours') returning id into c_far;
  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at, sla_due_at)
    values (a, 'none',   'WHATSAPP', 'AI_ACTIVE', now() - interval '1 hour', null) returning id into c_none;
  insert into public.conversations (agency_id, external_conversation_id, channel, state, last_inbound_at, sla_due_at)
    values (a, 'closed', 'WHATSAPP', 'CLOSED', now() - interval '3 hours', now() - interval '5 minutes') returning id into c_closed;

  perform public.refresh_conversation_queues(id) from public.conversations where agency_id = a;

  select jsonb_object_agg(queue_code, n) into rows
    from (select queue_code, count(*) n from public.conversation_queue_membership
           where agency_id = a and queue_code in ('SLA_BREACHED', 'NEARING_DEADLINE') group by queue_code) t;
  res := res || jsonb_build_object('deadline_counts', rows);

  res := res || jsonb_build_object(
    'breach_in_breached',  exists (select 1 from public.conversation_queue_membership where conversation_id = c_breach and queue_code = 'SLA_BREACHED'),
    'near_in_nearing',     exists (select 1 from public.conversation_queue_membership where conversation_id = c_near   and queue_code = 'NEARING_DEADLINE'),
    'far_in_neither',      not exists (select 1 from public.conversation_queue_membership where conversation_id = c_far  and queue_code in ('SLA_BREACHED', 'NEARING_DEADLINE')),
    'no_deadline_in_neither', not exists (select 1 from public.conversation_queue_membership where conversation_id = c_none and queue_code in ('SLA_BREACHED', 'NEARING_DEADLINE')),
    'closed_never_breaches',  not exists (select 1 from public.conversation_queue_membership where conversation_id = c_closed and queue_code in ('SLA_BREACHED', 'NEARING_DEADLINE')));

  -- A breach raises the conversation's rank in every queue it is in; a conversation whose deadline was cleared (paused / replied) drops out.
  res := res || jsonb_build_object(
    'breach_rank_raised', (select priority_rank from public.conversation_queue_membership where conversation_id = c_breach and queue_code = 'ALL') >
                          (select priority_rank from public.conversation_queue_membership where conversation_id = c_none   and queue_code = 'ALL'),
    'breach_rank', (select priority_rank from public.conversation_queue_membership where conversation_id = c_breach and queue_code = 'ALL'));

  update public.conversations set sla_due_at = null, last_outbound_at = now() where id = c_breach;
  perform public.refresh_conversation_queues(c_breach);
  res := res || jsonb_build_object('cleared_leaves_breached', not exists (select 1 from public.conversation_queue_membership where conversation_id = c_breach and queue_code = 'SLA_BREACHED'));

  -- Seeds: every agency has all 12 policies, and R2's numbers are what was seeded.
  select jsonb_agg(jsonb_build_object('q', queue_code, 'fr', first_reply_minutes, 'res', resolution_minutes, 'clock', clock, 'iv', opens_intervention_on_breach) order by queue_code) into seeded
    from public.inbox_sla_policies p join (select id from public.agencies where id <> a order by created_at limit 1) x on x.id = p.agency_id;
  res := res || jsonb_build_object('seeded_policies', jsonb_array_length(coalesce(seeded, '[]'::jsonb)), 'seed_sample', seeded);
  res := res || jsonb_build_object('agencies_missing_policies',
    (select count(*) from public.agencies g where (select count(*) from public.inbox_sla_policies p where p.agency_id = g.id) < 12 and g.id <> a));

  begin insert into public.inbox_sla_policies (agency_id, queue_code, first_reply_minutes) values (a, 'WAITING_CUSTOMER', 5);
    res := res || '{"paused_queue_policy_rejected": false}';
  exception when check_violation then res := res || '{"paused_queue_policy_rejected": true}'; end;
  begin insert into public.inbox_sla_policies (agency_id, queue_code, first_reply_minutes) values (a, 'COMPLAINTS', 0);
    res := res || '{"zero_minutes_rejected": false}';
  exception when check_violation then res := res || '{"zero_minutes_rejected": true}'; end;

  raise exception 'VERIFY %', res::text;
end $$;
