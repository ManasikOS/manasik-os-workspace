-- Durable outbound delivery. A staff request records the canonical message
-- and its outbox command before any provider call is attempted.

create or replace function public.enqueue_inbox_text_message(
  p_conversation_id uuid,
  p_body text,
  p_client_idempotency_key uuid
)
returns table (message_id uuid, outbox_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations%rowtype;
  v_message_id uuid;
  v_outbox_id uuid;
  v_author_name text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS') then
    raise exception 'not permitted';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 or length(p_body) > 10000 then
    raise exception 'invalid message body';
  end if;

  select * into v_conversation
  from public.conversations
  where id = p_conversation_id
    and agency_id = public.current_agency_id()
  for update;

  if not found then raise exception 'conversation not found'; end if;
  if v_conversation.state <> 'HUMAN_ACTIVE' then raise exception 'take control before replying'; end if;
  if v_conversation.connection_id is null then raise exception 'conversation has no channel connection'; end if;

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

  insert into public.conversation_messages (
    agency_id, conversation_id, role, actor_kind, actor_id, actor_name_snapshot,
    content, message_type, delivery_status, direction, client_idempotency_key,
    content_parts, provider_sent_at
  ) values (
    v_conversation.agency_id, v_conversation.id, 'staff', 'STAFF', auth.uid(),
    coalesce(v_author_name, 'Staff'), trim(p_body), 'TEXT', 'PENDING', 'OUTBOUND',
    p_client_idempotency_key::text,
    jsonb_build_array(jsonb_build_object('type', 'text', 'text', trim(p_body))), now()
  ) returning id into v_message_id;

  insert into public.outbox_messages (
    agency_id, connection_id, conversation_id, message_id, idempotency_key, command
  ) values (
    v_conversation.agency_id, v_conversation.connection_id, v_conversation.id,
    v_message_id, p_client_idempotency_key,
    jsonb_build_object(
      'provider_thread_id', v_conversation.external_conversation_id,
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', trim(p_body)))
    )
  ) returning id into v_outbox_id;

  update public.conversations
  set last_outbound_at = now(), last_activity_at = now(), last_message_preview = left(trim(p_body), 280)
  where id = v_conversation.id;

  return query select v_message_id, v_outbox_id;
end;
$$;

revoke all on function public.enqueue_inbox_text_message(uuid, text, uuid) from public, anon;
grant execute on function public.enqueue_inbox_text_message(uuid, text, uuid) to authenticated;

create or replace function public.claim_outbox_messages(p_worker_id text, p_limit integer)
returns setof public.outbox_messages
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.outbox_messages
    set status = 'RUNNING', locked_at = now(), locked_by = p_worker_id, attempts = attempts + 1
    where id in (
      select id from public.outbox_messages
      where status = 'QUEUED' and run_after <= now()
      order by run_after, created_at
      limit greatest(1, least(p_limit, 50))
      for update skip locked
    )
    returning *;
end;
$$;

revoke all on function public.claim_outbox_messages(text, integer) from public, authenticated, anon;
