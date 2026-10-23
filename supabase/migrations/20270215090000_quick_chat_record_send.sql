-- Quick Chat (docs/inbox/quick-chat-popup-spec.md, task T4): let Finance and Visa staff send ONE kind of message from a record page
-- (a receipt, a document request) without being given Inbox send rights.
--
-- Why a separate function: `enqueue_inbox_text_message` and the conversation policies are limited to ADMIN, MARKETING and OPERATIONS, and
-- that stays exactly as it is. Widening them would give FINANCE and VISA the whole Inbox at the database level. This function is the narrow
-- path instead, and it can do less than the Inbox send on purpose:
--   - FINANCE and VISA only (every other role keeps using enqueue_inbox_text_message);
--   - WhatsApp text only: no template, no file, no email subject/cc/bcc;
--   - only inside an open 24-hour reply window (the check is here, not just in the app);
--   - never a closed conversation, and never a conversation a colleague owns: it takes over only a chat that nobody owns or that is theirs,
--     and says so in the conversation's history exactly as the Inbox's own take-control does.
-- The application still runs the payment-protection gate on the text before calling it (that rule needs data this function does not read).
--
-- Reverse: drop function public.enqueue_record_text_message(uuid, text, uuid);

create or replace function public.enqueue_record_text_message(
  p_conversation_id uuid,
  p_body text,
  p_client_idempotency_key uuid
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
  v_body text := trim(coalesce(p_body, ''));
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.staff_role_in('FINANCE', 'VISA') then
    raise exception 'not permitted';
  end if;
  if length(v_body) = 0 or length(v_body) > 4000 then
    raise exception 'invalid message body';
  end if;

  select * into v_conversation
  from public.conversations
  where id = p_conversation_id
    and agency_id = public.current_agency_id()
  for update;

  if not found then raise exception 'conversation not found'; end if;

  -- A repeat of a send that already went out returns what was stored, before any rule that the first attempt may itself have changed.
  select m.id into v_message_id
  from public.conversation_messages m
  where m.agency_id = v_conversation.agency_id
    and m.client_idempotency_key = p_client_idempotency_key::text;
  if found then
    select o.id into v_outbox_id from public.outbox_messages o where o.message_id = v_message_id;
    return query select v_message_id, v_outbox_id;
    return;
  end if;

  if v_conversation.channel <> 'WHATSAPP' then raise exception 'record send is WhatsApp only'; end if;
  if v_conversation.state = 'CLOSED' then raise exception 'conversation is closed'; end if;
  if v_conversation.assigned_to_id is not null and v_conversation.assigned_to_id <> auth.uid() then
    raise exception 'conversation is owned by a colleague';
  end if;
  if v_conversation.service_window_expires_at is null or v_conversation.service_window_expires_at <= now() then
    raise exception 'outside the reply window';
  end if;
  if v_conversation.connection_id is null then raise exception 'conversation has no channel connection'; end if;

  select full_name into v_author_name from public.staff_profiles where id = auth.uid();

  -- Sending is a person answering: the assistant is paused and the sender owns the chat, as with the Inbox's take-control.
  if v_conversation.state <> 'HUMAN_ACTIVE' or v_conversation.assigned_to_id is distinct from auth.uid() then
    update public.conversations
    set state = 'HUMAN_ACTIVE', assigned_to_id = auth.uid(), assigned_to_name = coalesce(v_author_name, 'Staff')
    where id = v_conversation.id;

    insert into public.conversation_events (agency_id, conversation_id, kind, actor_kind, actor_id, data)
    values (
      v_conversation.agency_id, v_conversation.id, 'OWNER_CHANGED', 'STAFF', auth.uid(),
      jsonb_build_object(
        'from_id', v_conversation.assigned_to_id,
        'from_name', v_conversation.assigned_to_name,
        'to_id', auth.uid(),
        'to_name', coalesce(v_author_name, 'Staff'),
        'changed_by_name', v_author_name
      )
    );
  end if;

  insert into public.conversation_messages (
    agency_id, conversation_id, role, actor_kind, actor_id, actor_name_snapshot,
    content, message_type, delivery_status, direction, client_idempotency_key,
    content_parts, provider_sent_at, metadata
  ) values (
    v_conversation.agency_id, v_conversation.id, 'staff', 'STAFF', auth.uid(),
    coalesce(v_author_name, 'Staff'), v_body, 'TEXT', 'PENDING', 'OUTBOUND',
    p_client_idempotency_key::text,
    jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_body)), now(), '{}'::jsonb
  ) returning id into v_message_id;

  insert into public.outbox_messages (
    agency_id, connection_id, conversation_id, message_id, idempotency_key, command
  ) values (
    v_conversation.agency_id, v_conversation.connection_id, v_conversation.id,
    v_message_id, p_client_idempotency_key,
    jsonb_build_object(
      'provider_thread_id', v_conversation.external_conversation_id,
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_body)),
      'subject', null,
      'cc', null,
      'bcc', null
    )
  ) returning id into v_outbox_id;

  update public.conversations
  set last_outbound_at = now(), last_activity_at = now(), last_message_preview = left(v_body, 280)
  where id = v_conversation.id;

  return query select v_message_id, v_outbox_id;
end;
$$;

revoke all on function public.enqueue_record_text_message(uuid, text, uuid) from public, anon;
grant execute on function public.enqueue_record_text_message(uuid, text, uuid) to authenticated;
