-- SEC-1 and SEC-2 of docs/progress/2026-10-05-inbox-security-and-bug-audit.md.
--
-- SEC-1. `staff write conversations` was FOR ALL for ADMIN/MARKETING/OPERATIONS with no column limits, so a signed-in staff member could call
-- the REST API directly and (a) delete a conversation although only an administrator may, (b) push `service_window_expires_at` /
-- `human_agent_window_expires_at` into the future and send outside Meta's reply window, (c) repoint a chat at another lead or channel.
--   * DELETE is now administrators only.
--   * A BEFORE INSERT/UPDATE guard refuses, for a statement run directly as `authenticated`, any change to the reply-window columns, `channel`,
--     `external_conversation_id`, `agency_id` and `lead_id`. Server code (service role) and SECURITY DEFINER functions run under another
--     role, so inbound webhooks, the outbox and the identity-link flow are unaffected. Ordinary staff edits (state, owner, unread count,
--     lifecycle, last_outbound_at) still work.
--
-- SEC-2. `staff insert conversation_messages` let any of those roles insert a row with any role / actor / content, i.e. a forged customer
-- or colleague message. Staff messages now come only from SECURITY DEFINER functions that set the author from `auth.uid()`:
-- `enqueue_inbox_text_message` / `enqueue_inbox_media_message` (existing) and `record_staff_template_message` (new, for an
-- already-sent WhatsApp template). The direct insert policy is dropped.
--
-- Idempotent. Rollback: recreate the two policies from 20260825090000_whatsapp_channel.sql, drop the trigger and the function.

-- ── SEC-1: conversations ───────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "staff write conversations" on public.conversations;
drop policy if exists conversations_staff_insert on public.conversations;
drop policy if exists conversations_staff_update on public.conversations;
drop policy if exists conversations_admin_delete on public.conversations;

create policy conversations_staff_insert on public.conversations
  for insert to authenticated
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS'));

create policy conversations_staff_update on public.conversations
  for update to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS'));

create policy conversations_admin_delete on public.conversations
  for delete to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN'));

create or replace function public.guard_conversation_protected_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Only a statement run directly by a signed-in user is restricted. The service role, the table owner and SECURITY DEFINER functions
  -- (which run as their owner) are the server's own writes and pass.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.service_window_expires_at is not null or new.human_agent_window_expires_at is not null then
      raise exception 'reply windows are set by the server' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.service_window_expires_at is distinct from old.service_window_expires_at
     or new.human_agent_window_expires_at is distinct from old.human_agent_window_expires_at
     or new.channel is distinct from old.channel
     or new.external_conversation_id is distinct from old.external_conversation_id
     or new.agency_id is distinct from old.agency_id
     or new.lead_id is distinct from old.lead_id then
    raise exception 'this conversation field is changed by the server only' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_conversation_protected_columns() from public, anon, authenticated;

drop trigger if exists conversations_guard_protected_columns on public.conversations;
create trigger conversations_guard_protected_columns
  before insert or update on public.conversations
  for each row execute function public.guard_conversation_protected_columns();

-- ── SEC-2: conversation_messages ───────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "staff insert conversation_messages" on public.conversation_messages;

-- Records a WhatsApp template the server has just sent through Meta. The author is the caller, never a parameter.
create or replace function public.record_staff_template_message(
  p_conversation_id uuid,
  p_external_message_id text,
  p_content text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_agency uuid;
  v_author_name text;
  v_message_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS') then
    raise exception 'not permitted';
  end if;
  if p_content is null or length(trim(p_content)) = 0 or length(p_content) > 10000 then
    raise exception 'invalid message body';
  end if;

  select agency_id into v_conversation_agency
  from public.conversations
  where id = p_conversation_id and agency_id = public.current_agency_id();
  if not found then raise exception 'conversation not found'; end if;

  select full_name into v_author_name from public.staff_profiles where id = auth.uid();

  insert into public.conversation_messages (
    agency_id, conversation_id, external_message_id, role, actor_kind, actor_id, actor_name_snapshot,
    content, message_type, delivery_status, direction, provider_sent_at, metadata
  ) values (
    v_conversation_agency, p_conversation_id, p_external_message_id, 'staff', 'STAFF', auth.uid(),
    coalesce(v_author_name, 'Staff'), trim(p_content), 'TEMPLATE', 'SENT', 'OUTBOUND', now(),
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_message_id;

  return v_message_id;
end;
$$;

revoke all on function public.record_staff_template_message(uuid, text, text, jsonb) from public, anon;
grant execute on function public.record_staff_template_message(uuid, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
