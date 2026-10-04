-- I4 (docs/inbox/scale-inngest-implementation-plan.md, Phase I): tell the owner before a reply window closes on a customer nobody has answered.
--
-- Every Meta channel lets a business reply freely only within 24 hours of the customer's last message; after that a WhatsApp chat needs a
-- paid template and Messenger and Instagram allow nothing. Nothing warned staff that a window was about to close on a message still
-- waiting for a person. The `replyWindowReminder` Inngest function does (lib/inbox/inngest/lifecycle-functions.ts); this migration is its
-- database half:
--
--   1. `REPLY_WINDOW_CLOSING` as a notification kind and `WINDOW_REMINDER` as a follow-up ledger kind (the ledger's unique key makes the
--      reminder exactly-once per unanswered customer message).
--   2. Two triggers that write an `inngest_outbox` row, IN THE SAME TRANSACTION as the change, when a person-owned conversation has a window
--      open: when the window opens on a chat a person owns, and when a chat with an open window becomes person-owned.
--
-- Rare by design (decision R8: Inngest is not triggered once per message). The triggers fire only for human-owned chats and only when the
-- window OPENS, not when each message slides it forward, so the volume is a few events per staff-handled conversation, not one per
-- message. The `WHEN` clauses are evaluated before the function is called, so an inbound message on an assistant-owned chat, which is
-- nearly all traffic, costs nothing extra.
--
-- Deploy order: after the I1 migration (it needs `enqueue_inngest_event`).

alter table public.staff_notifications drop constraint if exists staff_notifications_kind_check;
alter table public.staff_notifications
  add constraint staff_notifications_kind_check
  check (kind in ('PROPOSAL_PENDING', 'HANDOFF_WAITING', 'HANDOFF_ESCALATED', 'WORKFLOW_CREATED', 'REPLY_WINDOW_CLOSING'));

alter table public.conversation_followups drop constraint if exists conversation_followups_kind_check;
alter table public.conversation_followups
  add constraint conversation_followups_kind_check
  check (kind in ('QUIET_NUDGE', 'HANDOFF_ALERT', 'HANDOFF_ESCALATION', 'WINDOW_REMINDER'));

-- security definer: the trigger runs as whoever changed the conversation (a webhook's service role, or a signed-in person), and
-- `enqueue_inngest_event` is executable by the service role only.
create or replace function public.trg_enqueue_window_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_inngest_event(
    new.agency_id,
    'inbox/conversation.window_opened',
    jsonb_build_object(
      'agencyId', new.agency_id,
      'conversationId', new.id,
      'windowClosesAt', to_char(new.service_window_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
  return null;
end;
$$;
revoke all on function public.trg_enqueue_window_opened() from public, anon, authenticated;

-- A conversation created already person-owned with a window open.
drop trigger if exists conversations_window_opened_on_insert on public.conversations;
create trigger conversations_window_opened_on_insert
  after insert on public.conversations
  for each row
  when (new.state in ('HUMAN_REQUESTED', 'HUMAN_ACTIVE') and new.service_window_expires_at is not null and new.service_window_expires_at > now())
  execute function public.trg_enqueue_window_opened();

-- A person-owned chat whose window was closed (or never open) and now opens again: the customer wrote after a lapse.
drop trigger if exists conversations_window_opened_on_window on public.conversations;
create trigger conversations_window_opened_on_window
  after update of service_window_expires_at on public.conversations
  for each row
  when (
    new.state in ('HUMAN_REQUESTED', 'HUMAN_ACTIVE')
    and new.service_window_expires_at is not null and new.service_window_expires_at > now()
    and (old.service_window_expires_at is null or old.service_window_expires_at <= now())
  )
  execute function public.trg_enqueue_window_opened();

-- A chat with an open window that becomes person-owned (the assistant asked for a person, or staff took control).
drop trigger if exists conversations_window_opened_on_handoff on public.conversations;
create trigger conversations_window_opened_on_handoff
  after update of state on public.conversations
  for each row
  when (
    new.state in ('HUMAN_REQUESTED', 'HUMAN_ACTIVE')
    and old.state is distinct from new.state
    and old.state not in ('HUMAN_REQUESTED', 'HUMAN_ACTIVE')
    and new.service_window_expires_at is not null and new.service_window_expires_at > now()
  )
  execute function public.trg_enqueue_window_opened();
