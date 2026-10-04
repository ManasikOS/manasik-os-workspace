-- F1 (docs/inbox/scale-inngest-implementation-plan.md, Phase F): a staff member sends a photo or a document from the Inbox.
--
-- `enqueue_inbox_text_message` records the canonical message and its outbox command in one transaction, so a message exists if and
-- only if it will be delivered. This is the same for a file: `enqueue_inbox_media_message` records the message, its
-- `message_attachments` row (so the thread shows it exactly like a customer's file) and the outbox command, together.
--
-- The file itself is already in the private `inbox-attachments` bucket under `<agency>/outbound/<conversation>/<uuid>.<ext>`, put there
-- through a signed upload URL the server issued and verified from the stored bytes before calling this (lib/inbox/attachments). This
-- function checks again what it can: the path is exactly this agency's and this conversation's, the type is on the allow-list, the
-- size is within the limit. It never takes a URL: the outbox drain signs a fresh short-lived URL at send time, so nothing that expires
-- is stored and nothing that grants access is kept in a row.
--
-- The scan status is left `PENDING`, honestly: nothing scans these files, they are checked by type, signature and size only.
--
-- Deploy order: apply before the code that calls it.

create or replace function public.enqueue_inbox_media_message(
  p_conversation_id uuid,
  p_caption text,
  p_client_idempotency_key uuid,
  p_storage_path text,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint,
  p_checksum_sha256 text
)
returns table (message_id uuid, outbox_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.conversations%rowtype;
  v_message_id uuid;
  v_outbox_id uuid;
  v_author_name text;
  v_caption text := trim(coalesce(p_caption, ''));
  v_kind text;
  v_max_bytes bigint;
  v_preview text;
  v_parts jsonb;
  v_command_content jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS') then
    raise exception 'not permitted';
  end if;

  -- The type allow-list, mirrored from lib/inbox/attachments/staff-attachment.ts.
  if p_mime_type in ('image/jpeg', 'image/png') then
    v_kind := 'image'; v_max_bytes := 5 * 1024 * 1024;
  elsif p_mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) then
    v_kind := 'document'; v_max_bytes := 10 * 1024 * 1024;
  else
    raise exception 'this file type cannot be sent';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > v_max_bytes then
    raise exception 'invalid file size';
  end if;
  if length(v_caption) > 1000 then
    raise exception 'invalid caption';
  end if;
  if p_filename is null or length(trim(p_filename)) = 0 or length(p_filename) > 255 then
    raise exception 'invalid file name';
  end if;

  select * into v_conversation
  from public.conversations
  where id = p_conversation_id
    and agency_id = public.current_agency_id()
  for update;

  if not found then raise exception 'conversation not found'; end if;
  if v_conversation.state <> 'HUMAN_ACTIVE' then raise exception 'take control before replying'; end if;
  if v_conversation.connection_id is null then raise exception 'conversation has no channel connection'; end if;

  -- The object must be this agency's and this conversation's, and of a name the server issued.
  if p_storage_path is null
     or split_part(p_storage_path, '/', 1) <> v_conversation.agency_id::text
     or split_part(p_storage_path, '/', 2) <> 'outbound'
     or split_part(p_storage_path, '/', 3) <> v_conversation.id::text
     or p_storage_path !~ '^[0-9a-f-]{36}/outbound/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf|docx|xlsx|pptx)$' then
    raise exception 'invalid attachment path';
  end if;

  select full_name into v_author_name from public.staff_profiles where id = auth.uid();

  select m.id into v_message_id
  from public.conversation_messages m
  where m.agency_id = v_conversation.agency_id
    and m.client_idempotency_key = p_client_idempotency_key::text;
  if found then
    select o.id into v_outbox_id from public.outbox_messages o where o.message_id = v_message_id;
    return query select v_message_id, v_outbox_id;
    return;
  end if;

  v_parts := (case when v_caption <> '' then jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_caption)) else '[]'::jsonb end)
    || jsonb_build_array(jsonb_build_object('type', v_kind, 'filename', p_filename, 'mime_type', p_mime_type, 'byte_size', p_byte_size));

  insert into public.conversation_messages (
    agency_id, conversation_id, role, actor_kind, actor_id, actor_name_snapshot,
    content, message_type, delivery_status, direction, client_idempotency_key,
    content_parts, provider_sent_at
  ) values (
    v_conversation.agency_id, v_conversation.id, 'staff', 'STAFF', auth.uid(),
    coalesce(v_author_name, 'Staff'), v_caption, case when v_kind = 'image' then 'IMAGE' else 'DOCUMENT' end,
    'PENDING', 'OUTBOUND', p_client_idempotency_key::text, v_parts, now()
  ) returning id into v_message_id;

  insert into public.message_attachments (
    agency_id, message_id, storage_path, filename, mime_type, byte_size, checksum_sha256, scan_status, metadata
  ) values (
    v_conversation.agency_id, v_message_id, p_storage_path, p_filename, p_mime_type, p_byte_size,
    nullif(p_checksum_sha256, ''), 'PENDING', jsonb_build_object('source', 'STAFF_UPLOAD')
  );

  v_command_content := (case when v_caption <> '' then jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_caption)) else '[]'::jsonb end)
    || jsonb_build_array(jsonb_build_object(
         'type', 'media', 'kind', v_kind, 'storage_path', p_storage_path,
         'mime_type', p_mime_type, 'filename', p_filename, 'byte_size', p_byte_size));

  insert into public.outbox_messages (
    agency_id, connection_id, conversation_id, message_id, idempotency_key, command
  ) values (
    v_conversation.agency_id, v_conversation.connection_id, v_conversation.id,
    v_message_id, p_client_idempotency_key,
    jsonb_build_object('provider_thread_id', v_conversation.external_conversation_id, 'content', v_command_content)
  ) returning id into v_outbox_id;

  v_preview := case when v_caption <> '' then v_caption when v_kind = 'image' then 'Photo' else 'Document: ' || p_filename end;
  update public.conversations
  set last_outbound_at = now(), last_activity_at = now(), last_message_preview = left(v_preview, 280)
  where id = v_conversation.id;

  return query select v_message_id, v_outbox_id;
end;
$$;

revoke all on function public.enqueue_inbox_media_message(uuid, text, uuid, text, text, text, bigint, text) from public, anon;
grant execute on function public.enqueue_inbox_media_message(uuid, text, uuid, text, text, text, bigint, text) to authenticated;
