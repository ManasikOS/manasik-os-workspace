-- Deleting a conversation failed for any conversation that a lead, task, quote, pilgrim or booking record was
-- raised from a MESSAGE of. "Clear all chats" showed "Could not clear the chats." and the retention sweep would hit the
-- same wall.
--
-- Cause: eight tables carry  CHECK (source_message_id IS NULL OR source_conversation_id IS NOT NULL)  ("a source
-- message needs a source conversation") and two foreign keys that both ON DELETE SET NULL their own column:
--   (source_conversation_id, agency_id) -> conversations         SET NULL (source_conversation_id)
--   (source_message_id,      agency_id) -> conversation_messages SET NULL (source_message_id)
-- Deleting a conversation runs the first action BEFORE the cascade reaches its messages, so for a moment the row has
-- a source message and no source conversation, and the check rejects the whole delete. The column list of a SET NULL
-- action may only name columns of that foreign key, so the conversation-side key cannot also clear source_message_id.
--
-- Fix: a BEFORE DELETE trigger on conversations clears source_message_id on those rows first (BEFORE row triggers run
-- before the foreign-key actions), so the check always holds. The CRM record itself is kept, exactly as the
-- conversation link already was: only the pointer to the deleted chat goes. It is agency-scoped by the deleted
-- row's own agency_id, and SECURITY DEFINER with an empty search_path so it works for the service role and cannot be
-- redirected. Not callable from the API: revoked below, and a trigger function needs no grant to fire.
--
-- Verified 2026-09-24 against the live data inside a transaction that was rolled back: with the trigger, the app's
-- exact clear sequence (outbox, agent jobs, conversations, as service_role) succeeds; without it, it fails on
-- departure_group_tasks_source_pair_check.

create or replace function public.detach_conversation_source_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.departure_group_bookings set source_message_id = null
    where source_conversation_id = old.id and agency_id = old.agency_id and source_message_id is not null;
  update public.departure_group_tasks set source_message_id = null
    where source_conversation_id = old.id and agency_id = old.agency_id and source_message_id is not null;
  update public.leads set source_message_id = null
    where source_conversation_id = old.id and agency_id = old.agency_id and source_message_id is not null;
  update public.lead_notes set source_message_id = null
    where source_conversation_id = old.id and agency_id = old.agency_id and source_message_id is not null;
  update public.lead_quotes set source_message_id = null
    where source_conversation_id = old.id and agency_id = old.agency_id and source_message_id is not null;
  update public.pilgrims set source_message_id = null
    where source_conversation_id = old.id and agency_id = old.agency_id and source_message_id is not null;
  update public.pilgrim_support_requests set source_message_id = null
    where source_conversation_id = old.id and agency_id = old.agency_id and source_message_id is not null;
  update public.booking_traveller_relationships set source_message_id = null
    where source_conversation_id = old.id and agency_id = old.agency_id and source_message_id is not null;
  return old;
end;
$$;

revoke all on function public.detach_conversation_source_messages() from public, anon, authenticated;

drop trigger if exists conversations_detach_source_messages on public.conversations;
create trigger conversations_detach_source_messages
  before delete on public.conversations
  for each row execute function public.detach_conversation_source_messages();
