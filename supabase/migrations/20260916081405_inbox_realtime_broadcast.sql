-- Private, ID-only Inbox invalidations. The browser always refetches the
-- RLS-filtered page; realtime never carries message bodies or customer data.
-- `realtime` is provider-managed: this migration only creates policies on its
-- supported messages table and calls the documented `realtime.send` API.

drop policy if exists inbox_realtime_receive on realtime.messages;
create policy inbox_realtime_receive on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and split_part(realtime.topic(), ':', 1) = 'inbox'
    and split_part(realtime.topic(), ':', 2) = public.current_agency_id()::text
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')
  );

drop policy if exists inbox_realtime_presence_write on realtime.messages;
create policy inbox_realtime_presence_write on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('presence', 'broadcast')
    and split_part(realtime.topic(), ':', 1) = 'inbox'
    and split_part(realtime.topic(), ':', 2) = public.current_agency_id()::text
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  );

create or replace function public.broadcast_inbox_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_id uuid;
  v_conversation_id uuid;
begin
  if tg_op = 'DELETE' then
    v_agency_id := old.agency_id;
    v_conversation_id := case when tg_table_name = 'conversations' then old.id else old.conversation_id end;
  else
    v_agency_id := new.agency_id;
    v_conversation_id := case when tg_table_name = 'conversations' then new.id else new.conversation_id end;
  end if;

  perform realtime.send(
    jsonb_build_object('conversation_id', v_conversation_id),
    'inbox.invalidate',
    'inbox:' || v_agency_id::text,
    true
  );
  perform realtime.send(
    jsonb_build_object('conversation_id', v_conversation_id),
    'inbox.invalidate',
    'inbox:' || v_agency_id::text || ':conversation:' || v_conversation_id::text,
    true
  );

  return coalesce(new, old);
end;
$$;

revoke all on function public.broadcast_inbox_invalidation() from public, anon, authenticated;

drop trigger if exists conversations_inbox_realtime on public.conversations;
create trigger conversations_inbox_realtime
  after insert or update or delete on public.conversations
  for each row execute function public.broadcast_inbox_invalidation();

drop trigger if exists conversation_messages_inbox_realtime on public.conversation_messages;
create trigger conversation_messages_inbox_realtime
  after insert or update or delete on public.conversation_messages
  for each row execute function public.broadcast_inbox_invalidation();

drop trigger if exists conversation_notes_inbox_realtime on public.conversation_notes;
create trigger conversation_notes_inbox_realtime
  after insert or update or delete on public.conversation_notes
  for each row execute function public.broadcast_inbox_invalidation();
