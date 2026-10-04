-- Verifies SC5 (docs/inbox/scaling.md §6.2) against a database where 20261202094300_sc5_scoped_inbox_broadcasts.sql is applied.
-- Everything runs in one transaction that is rolled back by the final exception, so nothing is written.
--
-- Expected output (agency-topic / conversation-topic events emitted):
--   inbound message ............ 1 / 1   (before SC5: 2 / 2)
--   delivery status change ..... 0 / 1   (before SC5: 1 / 1)
--   no-op message update ....... 0 / 0
--   note added ................. 0 / 1
--   composer presence .......... 0 / 1
--   visible conversation change  1 / 0
--   no-op conversation update .. 0 / 0
do $do$
declare
  v_agency uuid; v_conv uuid; v_msg uuid; v_out text := '';
  a0 int; a1 int; c0 int; c1 int;
begin
  select agency_id, id into v_agency, v_conv from public.conversations limit 1;

  select count(*) filter (where topic !~ ':conversation:'), count(*) filter (where topic ~ ':conversation:') into a0, c0 from realtime.messages where event = 'inbox.invalidate';
  perform * from public.ingest_inbound_message_atomic(v_agency, v_conv, 'sc5-verify-1', 'x', 'TEXT', '{}'::jsonb, 'PROCESS_INBOUND', 4);
  select count(*) filter (where topic !~ ':conversation:'), count(*) filter (where topic ~ ':conversation:') into a1, c1 from realtime.messages where event = 'inbox.invalidate';
  v_out := v_out || format(E'inbound message: agency_topic=%s conversation_topic=%s\n', a1 - a0, c1 - c0);

  select id into v_msg from public.conversation_messages where external_message_id = 'sc5-verify-1';
  a0 := a1; c0 := c1;
  update public.conversation_messages set delivery_status = 'DELIVERED' where id = v_msg;
  select count(*) filter (where topic !~ ':conversation:'), count(*) filter (where topic ~ ':conversation:') into a1, c1 from realtime.messages where event = 'inbox.invalidate';
  v_out := v_out || format(E'delivery status change: agency_topic=%s conversation_topic=%s\n', a1 - a0, c1 - c0);

  a0 := a1; c0 := c1;
  update public.conversation_messages set delivery_status = 'DELIVERED' where id = v_msg;
  select count(*) filter (where topic !~ ':conversation:'), count(*) filter (where topic ~ ':conversation:') into a1, c1 from realtime.messages where event = 'inbox.invalidate';
  v_out := v_out || format(E'no-op message update: agency_topic=%s conversation_topic=%s\n', a1 - a0, c1 - c0);

  a0 := a1; c0 := c1;
  insert into public.conversation_notes (agency_id, conversation_id, body, author_id, author_name_snapshot)
    select v_agency, v_conv, 'verify', s.id, 'Verify' from public.staff_profiles s where s.agency_id = v_agency limit 1;
  select count(*) filter (where topic !~ ':conversation:'), count(*) filter (where topic ~ ':conversation:') into a1, c1 from realtime.messages where event = 'inbox.invalidate';
  v_out := v_out || format(E'note added: agency_topic=%s conversation_topic=%s\n', a1 - a0, c1 - c0);

  a0 := a1; c0 := c1;
  update public.conversations set composing_at = now() where id = v_conv;
  select count(*) filter (where topic !~ ':conversation:'), count(*) filter (where topic ~ ':conversation:') into a1, c1 from realtime.messages where event = 'inbox.invalidate';
  v_out := v_out || format(E'composer presence: agency_topic=%s conversation_topic=%s\n', a1 - a0, c1 - c0);

  a0 := a1; c0 := c1;
  update public.conversations set unread_count = unread_count + 1 where id = v_conv;
  select count(*) filter (where topic !~ ':conversation:'), count(*) filter (where topic ~ ':conversation:') into a1, c1 from realtime.messages where event = 'inbox.invalidate';
  v_out := v_out || format(E'visible conversation change: agency_topic=%s conversation_topic=%s\n', a1 - a0, c1 - c0);

  a0 := a1; c0 := c1;
  update public.conversations set unread_count = unread_count where id = v_conv;
  select count(*) filter (where topic !~ ':conversation:'), count(*) filter (where topic ~ ':conversation:') into a1, c1 from realtime.messages where event = 'inbox.invalidate';
  v_out := v_out || format(E'no-op conversation update: agency_topic=%s conversation_topic=%s\n', a1 - a0, c1 - c0);

  raise exception E'VERIFY-SC5 (rolled back)\n%', v_out;
end
$do$;
