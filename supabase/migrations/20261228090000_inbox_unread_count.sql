-- Inbox unread badge (docs/tasks/TASK-027, finding F2).
--
-- `conversations.unread_count` has existed since the WhatsApp channel migration and the Inbox list renders it (bold name
-- and a count badge), but nothing ever wrote it: the only function that did, `increment_conversation_unread`, had no
-- caller and was locked to the service role. Every chat therefore looked read.
--
-- The count is now kept by the database, so every inbound path (WhatsApp, Messenger, Instagram, email, the atomic ingest
-- function) is covered without each one remembering to do it:
--   * a customer message increments it;
--   * staff clear it from the Inbox (`markConversationRead` server action, which updates the row under RLS).
--
-- The visible-version trigger (SC3) already treats `unread_count` as a visible column, so each change advances
-- `conversations.version` and reaches open browsers through the existing scoped list broadcast. No client change to
-- realtime is needed.
create or replace function public.bump_conversation_unread_on_customer_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
     set unread_count = c.unread_count + 1
   where c.id = new.conversation_id
     and c.agency_id = new.agency_id;
  return new;
end;
$$;

revoke all on function public.bump_conversation_unread_on_customer_message() from public, anon, authenticated;

drop trigger if exists conversation_messages_bump_unread on public.conversation_messages;
create trigger conversation_messages_bump_unread
  after insert on public.conversation_messages
  for each row when (new.role = 'user')
  execute function public.bump_conversation_unread_on_customer_message();
