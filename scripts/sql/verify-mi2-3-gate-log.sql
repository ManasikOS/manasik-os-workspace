-- Behavioural verification for supabase/migrations/20261202090800_mi2_3_gate_reason_constraint.sql (MI2.3 exit criterion):
-- every gate skip is recorded with a reason and shows up in inbox_gate_skip_reasons and the s0_skip_rate KPI.
-- Runs in one transaction and ENDS IN A DELIBERATE ERROR so nothing persists; read the numbers in `VERIFY {...}`.
--
-- Last run 2026-09-20, Manasik OS: 10 decisions (6 skips, 4 enrichments) -> s0_skip_rate 0.6000; the view listed each
-- skip reason with its count; the SKIP_CLOSED row carried escalated_to_risk = 1; an unknown reason, a SKIP with an
-- ENRICH reason and an ENRICH with a SKIP reason were all rejected by the check constraints.

do $$
declare
  a uuid; c uuid; res jsonb := '{}'::jsonb; rows jsonb;
begin
  insert into public.agencies (name, slug) values ('Gate A', 'gate-a-' || gen_random_uuid()) returning id into a;
  insert into public.conversations (agency_id, external_conversation_id, channel, state) values (a, 'g1', 'WHATSAPP', 'AI_ACTIVE') returning id into c;
  insert into public.inbox_gate_decisions (agency_id, conversation_id, decision, reason, escalate_to_risk) values
    (a, c, 'SKIP', 'SKIP_ACKNOWLEDGEMENT', false), (a, c, 'SKIP', 'SKIP_ACKNOWLEDGEMENT', false), (a, c, 'SKIP', 'SKIP_ACKNOWLEDGEMENT', false),
    (a, c, 'SKIP', 'SKIP_HUMAN_ACTIVE', false), (a, c, 'SKIP', 'SKIP_UNCHANGED_INPUT', false), (a, c, 'SKIP', 'SKIP_CLOSED', true),
    (a, c, 'ENRICH', 'ENRICH_NEW_CONVERSATION', false), (a, c, 'ENRICH', 'ENRICH_NEW_MESSAGE', false), (a, c, 'ENRICH', 'ENRICH_NEW_MESSAGE', false), (a, c, 'ENRICH', 'ENRICH_NEW_MESSAGE', false);

  select jsonb_agg(jsonb_build_object('decision', decision, 'reason', reason, 'n', decisions, 'risk', escalated_to_risk) order by decision, reason) into rows
    from public.inbox_gate_skip_reasons where agency_id = a;
  res := res || jsonb_build_object('view_rows', rows);
  res := res || jsonb_build_object('kpi', (select jsonb_build_object('evaluated', gate_evaluated, 'skipped', gate_skipped, 'skip_rate', s0_skip_rate) from public.inbox_intelligence_kpis_daily where agency_id = a));

  begin insert into public.inbox_gate_decisions (agency_id, conversation_id, decision, reason) values (a, c, 'SKIP', 'SKIP_MADE_UP'); res := res || '{"unknown_reason_rejected": false}';
  exception when check_violation then res := res || '{"unknown_reason_rejected": true}'; end;
  begin insert into public.inbox_gate_decisions (agency_id, conversation_id, decision, reason) values (a, c, 'SKIP', 'ENRICH_NEW_MESSAGE'); res := res || '{"skip_with_enrich_reason_rejected": false}';
  exception when check_violation then res := res || '{"skip_with_enrich_reason_rejected": true}'; end;
  begin insert into public.inbox_gate_decisions (agency_id, conversation_id, decision, reason) values (a, c, 'ENRICH', 'SKIP_CLOSED'); res := res || '{"enrich_with_skip_reason_rejected": false}';
  exception when check_violation then res := res || '{"enrich_with_skip_reason_rejected": true}'; end;
  raise exception 'VERIFY %', res::text;
end $$;
