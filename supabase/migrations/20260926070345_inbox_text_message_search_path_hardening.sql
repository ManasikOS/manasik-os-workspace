-- LR1: this RPC is intentionally callable by authenticated staff, so lock its
-- SECURITY DEFINER lookup path instead of changing its caller contract.
-- Its body already qualifies every application object and enforces role and
-- active-agency ownership before it writes a message or outbox record.
alter function public.enqueue_inbox_text_message(uuid, text, uuid)
  set search_path = '';

revoke all on function public.enqueue_inbox_text_message(uuid, text, uuid) from public, anon;
grant execute on function public.enqueue_inbox_text_message(uuid, text, uuid) to authenticated;
