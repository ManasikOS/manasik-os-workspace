-- MI2.5 — a change to the intelligence projection refreshes an open Inbox.
--
-- The Inbox refreshes on the `inbox.invalidate` broadcast that public.broadcast_inbox_invalidation() (migration
-- 20260916081405) sends for conversations, messages and notes. The projection's state trigger (MI2.1) touches
-- `conversations` only when `state` changes (PENDING -> FRESH), so a re-read that keeps the state FRESH — new intent,
-- new urgency after another message — would never refresh the context rail. This adds the projection itself to the
-- same broadcast. The function already handles any table with agency_id and conversation_id, and its payload carries
-- only the conversation id (no customer data), so nothing else changes.

drop trigger if exists conversation_intelligence_inbox_realtime on public.conversation_intelligence;
create trigger conversation_intelligence_inbox_realtime
  after insert or update or delete on public.conversation_intelligence
  for each row execute function public.broadcast_inbox_invalidation();

-- Rollback (commented — additive migration, not applied automatically):
-- drop trigger if exists conversation_intelligence_inbox_realtime on public.conversation_intelligence;
