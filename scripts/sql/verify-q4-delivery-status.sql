-- Verifies Q4 (docs/inbox/scale-inngest-implementation-plan.md, Phase Q) against a database where
-- 20261204090200_q4_delivery_status_batching.sql is applied. Everything runs in one transaction that is rolled back by the final
-- exception, so nothing is written.
--
-- To dry-run the migration first, run the migration file followed by this file as ONE batch: the final exception aborts the whole
-- transaction, migration included.
--
-- Result: a failed check raises "Q4 FAILED: ..." naming it. When every check passes the script still raises, so nothing is kept,
-- with "Q4 PASSED (rolled back)" and one line per check.
do $do$
declare
  v_out text := '';
  v_agency uuid; v_other uuid; v_conv uuid;
  v_status text; v_error text; v_n int; v_taken int; v_changed int;
  i int;
begin
  insert into public.agencies (name, slug) values ('q4-a', 'q4-a-' || substr(md5(random()::text), 1, 8)) returning id into v_agency;
  insert into public.agencies (name, slug) values ('q4-b', 'q4-b-' || substr(md5(random()::text), 1, 8)) returning id into v_other;
  insert into public.conversations (agency_id, external_conversation_id) values (v_agency, 'q4-wa') returning id into v_conv;

  -- Five outbound messages in state SENT, one in the other agency with a colliding external id.
  for i in 1..5 loop
    insert into public.conversation_messages (agency_id, conversation_id, external_message_id, role, actor_kind, content, message_type, delivery_status)
      values (v_agency, v_conv, 'q4-m' || i, 'staff', 'STAFF', 'x', 'TEXT', 'SENT');
  end loop;

  -- 1. One statement, three ticks for one message: the furthest wins, whatever the arrival order.
  select public.apply_message_delivery_updates(
    array[v_agency, v_agency, v_agency], array['q4-m1', 'q4-m1', 'q4-m1'], array['READ', 'DELIVERED', 'SENT'], array[null, null, null]::text[]
  ) into v_changed;
  select delivery_status into v_status from public.conversation_messages where agency_id = v_agency and external_message_id = 'q4-m1';
  if v_status <> 'READ' then raise exception 'Q4 FAILED: READ, DELIVERED, SENT for one message left %, not READ', v_status; end if;
  if v_changed <> 1 then raise exception 'Q4 FAILED: three ticks for one message counted as % changes, not 1', v_changed; end if;
  v_out := v_out || E'\nthree ticks for one message become one write, and READ wins in any arrival order';

  -- 2. Never backwards: a late DELIVERED does not undo READ, and reports no change.
  select public.apply_message_delivery_updates(array[v_agency], array['q4-m1'], array['DELIVERED'], array[null]::text[]) into v_changed;
  select delivery_status into v_status from public.conversation_messages where agency_id = v_agency and external_message_id = 'q4-m1';
  if v_status <> 'READ' or v_changed <> 0 then raise exception 'Q4 FAILED: a late DELIVERED moved READ to % (changed %)', v_status, v_changed; end if;
  v_out := v_out || E'\na late DELIVERED does not move READ back, and writes nothing';

  -- 3. A failure keeps its reason; a later good tick clears it.
  select public.apply_message_delivery_updates(array[v_agency], array['q4-m2'], array['FAILED'], array['Undeliverable']) into v_changed;
  select delivery_status, delivery_error into v_status, v_error from public.conversation_messages where agency_id = v_agency and external_message_id = 'q4-m2';
  if v_status <> 'FAILED' or v_error <> 'Undeliverable' then raise exception 'Q4 FAILED: FAILED was stored as %/%', v_status, v_error; end if;
  perform public.apply_message_delivery_updates(array[v_agency], array['q4-m2'], array['DELIVERED'], array[null]::text[]);
  select delivery_error into v_error from public.conversation_messages where agency_id = v_agency and external_message_id = 'q4-m2';
  if v_error is not null then raise exception 'Q4 FAILED: the failure reason survived a later DELIVERED (%)', v_error; end if;
  v_out := v_out || E'\na failure keeps its reason and a later delivery clears it';

  -- 4. A tick for another agency's message id, or an unknown one, changes nothing.
  select public.apply_message_delivery_updates(array[v_other, v_agency], array['q4-m3', 'q4-unknown'], array['READ', 'READ'], array[null, null]::text[]) into v_changed;
  select delivery_status into v_status from public.conversation_messages where agency_id = v_agency and external_message_id = 'q4-m3';
  if v_changed <> 0 or v_status <> 'SENT' then raise exception 'Q4 FAILED: a tick for another agency or an unknown message changed % rows (m3 is %)', v_changed, v_status; end if;
  v_out := v_out || E'\na tick is applied only inside its own agency, and an unknown message is ignored';

  -- 5. The buffer: drained oldest first, removed as it is applied, and empty afterwards.
  insert into public.message_delivery_status_buffer (agency_id, external_message_id, delivery_status)
    values (v_agency, 'q4-m3', 'DELIVERED'), (v_agency, 'q4-m3', 'READ'), (v_agency, 'q4-m4', 'DELIVERED'), (v_agency, 'q4-m5', 'READ');
  select d.taken, d.changed into v_taken, v_changed from public.drain_message_delivery_status_buffer(500) d;
  -- Other agencies' buffered rows (real data) are drained too; only this fixture is asserted on.
  if v_taken < 4 then raise exception 'Q4 FAILED: drained % of 4 buffered ticks', v_taken; end if;
  select count(*) into v_n from public.conversation_messages
   where agency_id = v_agency and ((external_message_id = 'q4-m3' and delivery_status = 'READ')
      or (external_message_id = 'q4-m4' and delivery_status = 'DELIVERED') or (external_message_id = 'q4-m5' and delivery_status = 'READ'));
  if v_n <> 3 then raise exception 'Q4 FAILED: % of 3 buffered messages reached their furthest state', v_n; end if;
  select count(*) into v_n from public.message_delivery_status_buffer where agency_id = v_agency;
  if v_n <> 0 then raise exception 'Q4 FAILED: % applied ticks were left in the buffer', v_n; end if;
  v_out := v_out || E'\nthe buffer applies each message once at its furthest state and is empty afterwards';

  -- 6. An empty buffer is a no-op.
  select d.taken into v_taken from public.drain_message_delivery_status_buffer(500) d;
  if v_taken <> 0 then raise exception 'Q4 FAILED: an empty buffer reported % taken', v_taken; end if;
  v_out := v_out || E'\nan empty buffer takes nothing';

  raise exception 'Q4 PASSED (rolled back)%', v_out;
end
$do$;
