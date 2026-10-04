-- Verifies F1 (docs/inbox/scale-inngest-implementation-plan.md, Phase F) against a database where
-- 20261204090800_f1_staff_media_message.sql is applied. One transaction, rolled back by the final exception.
-- To dry-run the migration first, run the migration file followed by this file as ONE batch.
--
-- Result: a failed check raises "F1 FAILED: ..."; when every check passes it raises "F1 PASSED (rolled back)" with one line per check.
do $do$
declare
  v_out text := '';
  v_a uuid; v_b uuid; v_staff uuid; v_stranger uuid; v_conn uuid; v_conv uuid; v_conv2 uuid; v_conv_ai uuid;
  v_msg uuid; v_out_id uuid; v_msg2 uuid; v_msg_again uuid; v_key uuid := gen_random_uuid();
  v_type text; v_content text; v_status text; v_cmd jsonb; v_n int; v_path text; v_preview text; v_scan text;
  v_png text; v_pdf text;
begin
  insert into public.agencies (name, slug) values ('f1-a', 'f1-a-' || substr(md5(random()::text), 1, 8)) returning id into v_a;
  insert into public.agencies (name, slug) values ('f1-b', 'f1-b-' || substr(md5(random()::text), 1, 8)) returning id into v_b;
  insert into public.channel_connections (agency_id, provider, provider_account_id, display_name, status)
    values (v_a, 'WHATSAPP', 'f1-pn', 'F1', 'CONNECTED') returning id into v_conn;
  insert into public.conversations (agency_id, external_conversation_id, connection_id, state) values (v_a, '94770000006', v_conn, 'HUMAN_ACTIVE') returning id into v_conv;
  insert into public.conversations (agency_id, external_conversation_id, connection_id, state) values (v_a, '94770000007', v_conn, 'HUMAN_ACTIVE') returning id into v_conv2;
  insert into public.conversations (agency_id, external_conversation_id, connection_id, state) values (v_a, '94770000008', v_conn, 'AI_ACTIVE') returning id into v_conv_ai;

  -- Staff: the id doubles as auth.uid(); the auth.users FK is bypassed for these two inserts only.
  set local session_replication_role = replica;
  v_staff := gen_random_uuid(); v_stranger := gen_random_uuid();
  insert into public.staff_profiles (id, email, agency_id, role) values (v_staff, 'f1-' || v_staff || '@verify.test', v_a, 'ADMIN');
  insert into public.staff_profiles (id, email, agency_id, role) values (v_stranger, 'f1-' || v_stranger || '@verify.test', v_b, 'ADMIN');
  set local session_replication_role = origin;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  v_png := v_a || '/outbound/' || v_conv || '/' || gen_random_uuid() || '.png';
  v_pdf := v_a || '/outbound/' || v_conv || '/' || gen_random_uuid() || '.pdf';

  -- 1. A photo with no caption: message, attachment and outbox command are created together, and no URL is stored.
  select r.message_id, r.outbox_id into v_msg, v_out_id
    from public.enqueue_inbox_media_message(v_conv, '', gen_random_uuid(), v_png, 'photo.png', 'image/png', 12345, repeat('a', 64)) r;
  select message_type, content, delivery_status into v_type, v_content, v_status from public.conversation_messages where id = v_msg;
  if v_type <> 'IMAGE' or v_content <> '' or v_status <> 'PENDING' then raise exception 'F1 FAILED: photo message was %/%/%', v_type, v_content, v_status; end if;
  select storage_path, scan_status into v_path, v_scan from public.message_attachments where message_id = v_msg;
  if v_path <> v_png or v_scan <> 'PENDING' then raise exception 'F1 FAILED: attachment row was % / %', v_path, v_scan; end if;
  select command into v_cmd from public.outbox_messages where id = v_out_id;
  if v_cmd -> 'content' -> 0 ->> 'type' <> 'media' or v_cmd -> 'content' -> 0 ->> 'kind' <> 'image' or v_cmd -> 'content' -> 0 ->> 'storage_path' <> v_png then
    raise exception 'F1 FAILED: outbox command was %', v_cmd;
  end if;
  if v_cmd::text ~* '(https?://|signed|token)' then raise exception 'F1 FAILED: the outbox command carries a URL or token: %', v_cmd; end if;
  select last_message_preview into v_preview from public.conversations where id = v_conv;
  if v_preview <> 'Photo' then raise exception 'F1 FAILED: preview was %', v_preview; end if;
  v_out := v_out || E'\na photo creates the message, its attachment (scan PENDING) and a media outbox command with no URL, together';

  -- 2. A document with a caption: the caption is the text part and the preview.
  select r.message_id, r.outbox_id into v_msg2, v_out_id
    from public.enqueue_inbox_media_message(v_conv, 'Your itinerary', gen_random_uuid(), v_pdf, 'Itinerary.pdf', 'application/pdf', 200000, null) r;
  select message_type, content into v_type, v_content from public.conversation_messages where id = v_msg2;
  select command into v_cmd from public.outbox_messages where id = v_out_id;
  if v_type <> 'DOCUMENT' or v_content <> 'Your itinerary' or v_cmd -> 'content' -> 0 ->> 'type' <> 'text' or v_cmd -> 'content' -> 1 ->> 'kind' <> 'document' then
    raise exception 'F1 FAILED: document message was %/% and command %', v_type, v_content, v_cmd;
  end if;
  select last_message_preview into v_preview from public.conversations where id = v_conv;
  if v_preview <> 'Your itinerary' then raise exception 'F1 FAILED: caption preview was %', v_preview; end if;
  v_out := v_out || E'\na document with a caption carries the caption as its text part and preview';

  -- 3. The same key again returns the same message and creates nothing new.
  select r.message_id into v_msg_again from public.enqueue_inbox_media_message(v_conv, 'Your itinerary', (select client_idempotency_key::uuid from public.conversation_messages where id = v_msg2), v_pdf, 'Itinerary.pdf', 'application/pdf', 200000, null) r;
  select count(*) into v_n from public.conversation_messages where conversation_id = v_conv and message_type in ('IMAGE', 'DOCUMENT');
  if v_msg_again <> v_msg2 or v_n <> 2 then raise exception 'F1 FAILED: a retry created % messages (returned %)', v_n, v_msg_again; end if;
  v_out := v_out || E'\na retry with the same key returns the same message';

  -- 4. Refusals.
  begin perform * from public.enqueue_inbox_media_message(v_conv, '', gen_random_uuid(), v_a || '/outbound/' || v_conv || '/' || gen_random_uuid() || '.png', 'x.png', 'application/x-msdownload', 10, null); raise exception 'Q';
  exception when raise_exception then if sqlerrm = 'Q' then raise exception 'F1 FAILED: an executable type was accepted'; end if; end;
  begin perform * from public.enqueue_inbox_media_message(v_conv, '', gen_random_uuid(), v_a || '/outbound/' || v_conv || '/' || gen_random_uuid() || '.png', 'x.png', 'image/png', 5 * 1024 * 1024 + 1, null); raise exception 'Q';
  exception when raise_exception then if sqlerrm = 'Q' then raise exception 'F1 FAILED: an oversized photo was accepted'; end if; end;
  begin perform * from public.enqueue_inbox_media_message(v_conv, '', gen_random_uuid(), v_b || '/outbound/' || v_conv || '/' || gen_random_uuid() || '.png', 'x.png', 'image/png', 10, null); raise exception 'Q';
  exception when raise_exception then if sqlerrm = 'Q' then raise exception 'F1 FAILED: another agency''s path was accepted'; end if; end;
  begin perform * from public.enqueue_inbox_media_message(v_conv, '', gen_random_uuid(), v_a || '/outbound/' || v_conv2 || '/' || gen_random_uuid() || '.png', 'x.png', 'image/png', 10, null); raise exception 'Q';
  exception when raise_exception then if sqlerrm = 'Q' then raise exception 'F1 FAILED: another conversation''s path was accepted'; end if; end;
  begin perform * from public.enqueue_inbox_media_message(v_conv, '', gen_random_uuid(), v_a || '/outbound/' || v_conv || '/../' || gen_random_uuid() || '.png', 'x.png', 'image/png', 10, null); raise exception 'Q';
  exception when raise_exception then if sqlerrm = 'Q' then raise exception 'F1 FAILED: a path with .. was accepted'; end if; end;
  begin perform * from public.enqueue_inbox_media_message(v_conv, '', gen_random_uuid(), v_a || '/outbound/' || v_conv || '/' || gen_random_uuid() || '.exe', 'x.exe', 'image/png', 10, null); raise exception 'Q';
  exception when raise_exception then if sqlerrm = 'Q' then raise exception 'F1 FAILED: an .exe path was accepted'; end if; end;
  begin perform * from public.enqueue_inbox_media_message(v_conv, repeat('x', 1001), gen_random_uuid(), v_a || '/outbound/' || v_conv || '/' || gen_random_uuid() || '.png', 'x.png', 'image/png', 10, null); raise exception 'Q';
  exception when raise_exception then if sqlerrm = 'Q' then raise exception 'F1 FAILED: a 1,001-character caption was accepted'; end if; end;
  begin perform * from public.enqueue_inbox_media_message(v_conv_ai, '', gen_random_uuid(), v_a || '/outbound/' || v_conv_ai || '/' || gen_random_uuid() || '.png', 'x.png', 'image/png', 10, null); raise exception 'Q';
  exception when raise_exception then if sqlerrm = 'Q' then raise exception 'F1 FAILED: a send on an AI-owned conversation was accepted'; end if; end;
  v_out := v_out || E'\nan executable type, an oversized photo, another agency''s or conversation''s path, a traversal, a bad extension, a long caption and an AI-owned chat are all refused';

  -- 5. A staff member of another agency cannot send into this one.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin perform * from public.enqueue_inbox_media_message(v_conv, '', gen_random_uuid(), v_a || '/outbound/' || v_conv || '/' || gen_random_uuid() || '.png', 'x.png', 'image/png', 10, null); raise exception 'Q';
  exception when raise_exception then if sqlerrm = 'Q' then raise exception 'F1 FAILED: another agency''s staff could send into this conversation'; end if; end;
  v_out := v_out || E'\nanother agency''s staff cannot send into this conversation';

  if has_function_privilege('anon', 'public.enqueue_inbox_media_message(uuid,text,uuid,text,text,text,bigint,text)', 'execute') then
    raise exception 'F1 FAILED: anon can run the send function';
  end if;
  v_out := v_out || E'\nanon cannot run it';

  raise exception 'F1 PASSED (rolled back)%', v_out;
end
$do$;
