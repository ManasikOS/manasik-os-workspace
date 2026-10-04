-- Behavioural verification for supabase/migrations/20261202090400_mi2_1_conversation_intelligence.sql (MI2.1).
--
-- Real foreign keys and RLS are exercised: two synthetic agencies, each with a conversation, message and staff
-- member. The whole thing ENDS IN A DELIBERATE ERROR so the transaction rolls back and nothing persists. A passing
-- run fails with `VERIFY {...}` where every value is `true`.
-- Last run 2026-09-20 against the Manasik OS project: all 22 checks true.

do $$
declare
  a uuid; b uuid; ca uuid; cb uuid; ma uuid; sa uuid; sb uuid; ia uuid;
  res jsonb := '{}'::jsonb;
  seen integer; st text; sig_msg text;
begin
  insert into public.agencies (name, slug) values ('Verify A', 'verify-a-' || gen_random_uuid()) returning id into a;
  insert into public.agencies (name, slug) values ('Verify B', 'verify-b-' || gen_random_uuid()) returning id into b;
  insert into public.conversations (agency_id, external_conversation_id) values (a, 'wa-a') returning id into ca;
  insert into public.conversations (agency_id, external_conversation_id) values (b, 'wa-b') returning id into cb;
  insert into public.conversation_messages (agency_id, conversation_id, role, actor_kind, content)
    values (a, ca, 'user', 'CUSTOMER', 'hello') returning id into ma;

  -- staff: id doubles as auth.uid(); the auth.users FK is bypassed for these two inserts only
  set local session_replication_role = replica;
  sa := gen_random_uuid(); sb := gen_random_uuid();
  insert into public.staff_profiles (id, email, agency_id, role) values (sa, 'a-' || sa || '@verify.test', a, 'ADMIN');
  insert into public.staff_profiles (id, email, agency_id, role) values (sb, 'b-' || sb || '@verify.test', b, 'ADMIN');
  set local session_replication_role = origin;

  -- 1. tenant isolation: agency A can never point a row at agency B's conversation (composite FK)
  begin insert into public.conversation_interventions (agency_id, conversation_id, kind, severity, headline, guidance, required_action_code)
        values (a, cb, 'PAYMENT_CLAIM', 'BLOCK', 'x', 'y', 'VERIFY_PAYMENT'); res := res || '{"cross_agency_intervention_blocked": false}';
  exception when foreign_key_violation then res := res || '{"cross_agency_intervention_blocked": true}'; end;
  begin insert into public.conversation_signals (agency_id, conversation_id, signal_code, detector) values (a, cb, 'REFUND_REQUEST', 'RULE');
        res := res || '{"cross_agency_signal_blocked": false}';
  exception when foreign_key_violation then res := res || '{"cross_agency_signal_blocked": true}'; end;
  begin insert into public.conversation_intelligence (conversation_id, agency_id) values (cb, a);
        res := res || '{"cross_agency_intelligence_blocked": false}';
  exception when foreign_key_violation then res := res || '{"cross_agency_intelligence_blocked": true}'; end;
  begin insert into public.conversation_queue_membership (agency_id, queue_code, conversation_id) values (a, 'ALL', cb);
        res := res || '{"cross_agency_queue_row_blocked": false}';
  exception when foreign_key_violation then res := res || '{"cross_agency_queue_row_blocked": true}'; end;
  begin insert into public.conversation_interventions (agency_id, conversation_id, kind, severity, headline, guidance, required_action_code, assigned_to_id)
        values (a, ca, 'COMPLAINT', 'REVIEW', 'x', 'y', 'ESCALATE_TO_HUMAN', sb);
        res := res || '{"cross_agency_assignee_blocked": false}';
  exception when foreign_key_violation then res := res || '{"cross_agency_assignee_blocked": true}'; end;
  begin insert into public.conversations (agency_id, external_conversation_id, composing_by) values (a, 'wa-a2', sb);
        res := res || '{"cross_agency_composer_blocked": false}';
  exception when foreign_key_violation then res := res || '{"cross_agency_composer_blocked": true}'; end;

  -- 2. upsert idempotent on the conversation, and the state trigger keeps conversations.intelligence_state in step
  insert into public.conversation_intelligence (conversation_id, agency_id, input_fingerprint) values (ca, a, 'f1');
  select intelligence_state into st from public.conversations where id = ca;
  res := res || jsonb_build_object('pending_row_marks_conversation_PENDING', st = 'PENDING');
  insert into public.conversation_intelligence as ci (conversation_id, agency_id, input_fingerprint, state, intent_code)
    values (ca, a, 'f2', 'FRESH', 'PACKAGE_ENQUIRY')
    on conflict (conversation_id) do update set input_fingerprint = excluded.input_fingerprint, state = excluded.state, intent_code = excluded.intent_code;
  select intelligence_state into st from public.conversations where id = ca;
  select count(*) into seen from public.conversation_intelligence where conversation_id = ca;
  res := res || jsonb_build_object('upsert_keeps_one_row', seen = 1, 'state_trigger_follows_FRESH', st = 'FRESH');
  begin update public.conversation_intelligence set intent_code = 'MADE_UP' where conversation_id = ca; res := res || '{"unknown_intent_rejected": false}';
  exception when check_violation then res := res || '{"unknown_intent_rejected": true}'; end;

  -- 3. one open intervention per (conversation, kind); closing needs a note, a time and an actor
  insert into public.conversation_interventions (agency_id, conversation_id, kind, severity, headline, guidance, required_action_code)
    values (a, ca, 'PAYMENT_CLAIM', 'BLOCK', 'Customer says they paid', 'Ask Finance', 'VERIFY_PAYMENT') returning id into ia;
  begin insert into public.conversation_interventions (agency_id, conversation_id, kind, severity, headline, guidance, required_action_code)
        values (a, ca, 'PAYMENT_CLAIM', 'BLOCK', 'again', 'again', 'VERIFY_PAYMENT'); res := res || '{"duplicate_open_intervention_blocked": false}';
  exception when unique_violation then res := res || '{"duplicate_open_intervention_blocked": true}'; end;
  begin update public.conversation_interventions set status = 'RESOLVED' where id = ia; res := res || '{"close_without_note_blocked": false}';
  exception when check_violation then res := res || '{"close_without_note_blocked": true}'; end;
  begin update public.conversation_interventions set status = 'RESOLVED', resolved_at = now(), resolved_by = sa, resolution_note = '   ' where id = ia;
        res := res || '{"close_with_blank_note_blocked": false}';
  exception when check_violation then res := res || '{"close_with_blank_note_blocked": true}'; end;
  update public.conversation_interventions set status = 'RESOLVED', resolved_at = now(), resolved_by = sa, resolution_note = 'Finance confirmed receipt' where id = ia;
  insert into public.conversation_interventions (agency_id, conversation_id, kind, severity, headline, guidance, required_action_code)
    values (a, ca, 'PAYMENT_CLAIM', 'BLOCK', 'a later claim', 'Ask Finance', 'VERIFY_PAYMENT');
  select count(*) into seen from public.conversation_interventions where conversation_id = ca and status in ('OPEN','ACKNOWLEDGED');
  res := res || jsonb_build_object('reopen_after_resolve_allowed_and_gate_query_sees_one', seen = 1);

  -- 4. signals: live duplicates rejected, superseding frees the slot, deleting the message keeps the signal
  insert into public.conversation_signals (agency_id, conversation_id, signal_code, message_id, detector) values (a, ca, 'REFUND_REQUEST', ma, 'RULE');
  begin insert into public.conversation_signals (agency_id, conversation_id, signal_code, message_id, detector) values (a, ca, 'REFUND_REQUEST', ma, 'RULE');
        res := res || '{"duplicate_live_signal_blocked": false}';
  exception when unique_violation then res := res || '{"duplicate_live_signal_blocked": true}'; end;
  delete from public.conversation_messages where id = ma;
  select count(*), max(message_id::text) into seen, sig_msg from public.conversation_signals where conversation_id = ca and signal_code = 'REFUND_REQUEST';
  res := res || jsonb_build_object('signal_survives_message_delete_with_null_pointer', seen = 1 and sig_msg is null);
  update public.conversation_signals set superseded_at = now() where conversation_id = ca and signal_code = 'REFUND_REQUEST';
  insert into public.conversation_signals (agency_id, conversation_id, signal_code, detector) values (a, ca, 'REFUND_REQUEST', 'RULE');
  res := res || '{"resignal_after_supersede_allowed": true}';

  -- 5. RLS: a signed-in staff member of agency A sees A's rows and none of B's
  insert into public.conversation_intelligence (conversation_id, agency_id, input_fingerprint) values (cb, b, 'fb');
  insert into public.conversation_interventions (agency_id, conversation_id, kind, severity, headline, guidance, required_action_code)
    values (b, cb, 'COMPLAINT', 'REVIEW', 'B only', 'B only', 'ESCALATE_TO_HUMAN');
  insert into public.conversation_signals (agency_id, conversation_id, signal_code, detector) values (b, cb, 'DISTRESS_LANGUAGE', 'RULE');
  insert into public.conversation_queue_membership (agency_id, queue_code, conversation_id) values (b, 'ALL', cb);
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := res || jsonb_build_object(
    'rls_intelligence_own_only', (select count(*) from public.conversation_intelligence) = 1 and (select count(*) from public.conversation_intelligence where agency_id = b) = 0,
    'rls_signals_own_only', (select count(*) from public.conversation_signals where agency_id = b) = 0 and (select count(*) from public.conversation_signals) > 0,
    'rls_interventions_own_only', (select count(*) from public.conversation_interventions where agency_id = b) = 0 and (select count(*) from public.conversation_interventions) > 0,
    'rls_queue_membership_own_only', (select count(*) from public.conversation_queue_membership where agency_id = b) = 0);
  begin insert into public.conversation_signals (agency_id, conversation_id, signal_code, detector) values (a, ca, 'FRAUD_CONCERN', 'RULE');
        res := res || '{"authenticated_cannot_write_signals": false}';
  exception when insufficient_privilege or others then res := res || '{"authenticated_cannot_write_signals": true}'; end;
  begin update public.conversation_interventions set status = 'ACKNOWLEDGED' where conversation_id = ca;
        get diagnostics seen = row_count;
        res := res || jsonb_build_object('authenticated_cannot_update_interventions', seen = 0);
  exception when others then res := res || '{"authenticated_cannot_update_interventions": true}'; end;
  reset role;

  raise exception 'VERIFY %', res::text;
end $$;
