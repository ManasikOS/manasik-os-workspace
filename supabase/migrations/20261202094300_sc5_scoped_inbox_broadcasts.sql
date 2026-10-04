-- SC5 (docs/inbox/scaling.md §6.2): stop sending conversation-local changes to every agency client.
--
-- Before: one generic trigger sent EVERY change to BOTH `inbox:<agency>` and `inbox:<agency>:conversation:<id>`, so an
-- inbound message reached every connected staff member twice (a list event and a thread event), and a delivery tick, a
-- note, an intelligence write or a composer heartbeat woke the whole agency.
--
-- After (routing table, §6.2):
--   agency/list topic          conversations (visible changes only), interventions (queue membership can change)
--   conversation topic only    messages, notes, attachments, media analyses, intelligence, composer presence
-- and every UPDATE trigger carries a WHEN clause so a write that changes nothing visible emits nothing.
--
-- Payloads are unchanged in spirit (ids, enums, counters — see lib/inbox/realtime/contracts.ts). The managed `realtime`
-- schema is not touched: only `realtime.send()` is called, as before. The topic agency segment is unchanged, so the
-- existing `realtime.messages` policy still confines every event to its own agency.
--
-- Rollback: point the triggers back at `broadcast_inbox_invalidation()` (kept, unchanged) — agency-wide emission — while
-- the browser still converges by reconciliation.

-- Attachment / media-analysis events are addressed to the message they belong to.
create or replace function public.build_inbox_realtime_event(p_table text, p_op text, p_row jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_conversation uuid;
  v_operation text := case p_op when 'INSERT' then 'INSERT' when 'DELETE' then 'DELETE' else 'UPDATE' end;
begin
  if p_table = 'conversations' then
    v_conversation := (p_row ->> 'id')::uuid;
    return jsonb_build_object(
      'schemaVersion', 1,
      'scope', 'LIST',
      'conversationId', v_conversation,
      'conversationVersion', coalesce((p_row ->> 'version')::bigint, 1),
      'reason', 'CONVERSATION');
  end if;

  v_conversation := (p_row ->> 'conversation_id')::uuid;

  if p_table = 'conversation_messages' then
    return jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'scope', 'THREAD',
      'conversationId', v_conversation,
      'entity', 'MESSAGE',
      'entityId', (p_row ->> 'id')::uuid,
      'operation', v_operation,
      'sequenceNumber', (p_row ->> 'sequence_number')::bigint));
  elsif p_table = 'conversation_notes' then
    return jsonb_build_object(
      'schemaVersion', 1,
      'scope', 'THREAD',
      'conversationId', v_conversation,
      'entity', 'NOTE',
      'entityId', (p_row ->> 'id')::uuid,
      'operation', v_operation);
  elsif p_table in ('message_attachments', 'message_media_analyses') then
    return jsonb_build_object(
      'schemaVersion', 1,
      'scope', 'THREAD',
      'conversationId', v_conversation,
      'entity', case p_table when 'message_attachments' then 'ATTACHMENT' else 'MEDIA_ANALYSIS' end,
      'entityId', (p_row ->> 'id')::uuid,
      'operation', v_operation,
      'messageId', (p_row ->> 'message_id')::uuid);
  elsif p_table = 'conversation_intelligence' then
    return jsonb_build_object(
      'schemaVersion', 1,
      'scope', 'INTELLIGENCE',
      'conversationId', v_conversation,
      'revision', coalesce(p_row ->> 'updated_at', p_row ->> 'computed_at', ''));
  end if;

  return jsonb_build_object('schemaVersion', 1, 'scope', 'CONTEXT', 'conversationId', v_conversation, 'revision', 'unknown-source');
end;
$$;

revoke all on function public.build_inbox_realtime_event(text, text, jsonb) from public, anon, authenticated;

-- ── LIST: the agency topic only ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.broadcast_inbox_list_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_event jsonb;
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  v_event := public.build_inbox_realtime_event(tg_table_name, tg_op, v_row);
  perform realtime.send(v_event, 'inbox.invalidate', 'inbox:' || (v_row ->> 'agency_id'), true);
  return coalesce(new, old);
end;
$$;

-- ── THREAD / INTELLIGENCE: the conversation topic only ───────────────────────────────────────────────────────────
create or replace function public.broadcast_inbox_conversation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_conversation uuid;
  v_event jsonb;
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;

  -- Attachments and media analyses know their message, not their conversation.
  if tg_table_name in ('message_attachments', 'message_media_analyses') then
    select m.conversation_id into v_conversation from public.conversation_messages m where m.id = (v_row ->> 'message_id')::uuid;
    if v_conversation is null then return coalesce(new, old); end if; -- the message is gone (a cascade): its own DELETE event covers it
    v_row := v_row || jsonb_build_object('conversation_id', v_conversation);
  end if;

  v_event := public.build_inbox_realtime_event(tg_table_name, tg_op, v_row);
  perform realtime.send(v_event, 'inbox.invalidate', 'inbox:' || (v_row ->> 'agency_id') || ':conversation:' || (v_event ->> 'conversationId'), true);
  return coalesce(new, old);
end;
$$;

-- ── PRESENCE: the composer lease, conversation topic only ────────────────────────────────────────────────────────
create or replace function public.broadcast_inbox_presence_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'schemaVersion', 1,
      'scope', 'PRESENCE',
      'conversationId', new.id,
      'revision', coalesce(new.composing_at::text, 'released')),
    'inbox.invalidate',
    'inbox:' || new.agency_id::text || ':conversation:' || new.id::text,
    true);
  return new;
end;
$$;

-- ── INTERVENTIONS: queue membership can change (agency list) and the open card changes (conversation) ────────────
create or replace function public.broadcast_inbox_intervention_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
begin
  select c.version into v_version from public.conversations c where c.id = new.conversation_id;
  perform realtime.send(
    jsonb_build_object(
      'schemaVersion', 1,
      'scope', 'LIST',
      'conversationId', new.conversation_id,
      'conversationVersion', coalesce(v_version, 1),
      'reason', 'INTERVENTION'),
    'inbox.invalidate',
    'inbox:' || new.agency_id::text,
    true);
  perform realtime.send(
    jsonb_build_object(
      'schemaVersion', 1,
      'scope', 'INTELLIGENCE',
      'conversationId', new.conversation_id,
      'revision', coalesce(new.updated_at::text, '')),
    'inbox.invalidate',
    'inbox:' || new.agency_id::text || ':conversation:' || new.conversation_id::text,
    true);
  return new;
end;
$$;

revoke all on function public.broadcast_inbox_list_event() from public, anon, authenticated;
revoke all on function public.broadcast_inbox_conversation_event() from public, anon, authenticated;
revoke all on function public.broadcast_inbox_presence_event() from public, anon, authenticated;
revoke all on function public.broadcast_inbox_intervention_event() from public, anon, authenticated;

-- ── Triggers ─────────────────────────────────────────────────────────────────────────────────────────────────────

-- conversations: LIST on insert/delete, and on an UPDATE only when the visible version advanced (SC3). A presence-only
-- or bookkeeping-only update leaves the version alone and emits nothing here.
drop trigger if exists conversations_inbox_realtime on public.conversations;
create trigger conversations_inbox_realtime
  after insert or delete on public.conversations
  for each row execute function public.broadcast_inbox_list_event();
create trigger conversations_inbox_realtime_update
  after update on public.conversations
  for each row when (old.version is distinct from new.version)
  execute function public.broadcast_inbox_list_event();
create trigger conversations_inbox_realtime_presence
  after update of composing_by, composing_at on public.conversations
  for each row when (old.composing_by is distinct from new.composing_by or old.composing_at is distinct from new.composing_at)
  execute function public.broadcast_inbox_presence_event();

-- conversation_messages: THREAD on the conversation topic; an UPDATE only when something actually changed.
drop trigger if exists conversation_messages_inbox_realtime on public.conversation_messages;
create trigger conversation_messages_inbox_realtime
  after insert or delete on public.conversation_messages
  for each row execute function public.broadcast_inbox_conversation_event();
create trigger conversation_messages_inbox_realtime_update
  after update on public.conversation_messages
  for each row when (old.* is distinct from new.*)
  execute function public.broadcast_inbox_conversation_event();

drop trigger if exists conversation_notes_inbox_realtime on public.conversation_notes;
create trigger conversation_notes_inbox_realtime
  after insert or delete on public.conversation_notes
  for each row execute function public.broadcast_inbox_conversation_event();
create trigger conversation_notes_inbox_realtime_update
  after update on public.conversation_notes
  for each row when (old.body is distinct from new.body)
  execute function public.broadcast_inbox_conversation_event();

-- The reading is rewritten by every enrichment run; only a change to its content (not its clock) is an event.
drop trigger if exists conversation_intelligence_inbox_realtime on public.conversation_intelligence;
create trigger conversation_intelligence_inbox_realtime
  after insert or delete on public.conversation_intelligence
  for each row execute function public.broadcast_inbox_conversation_event();
create trigger conversation_intelligence_inbox_realtime_update
  after update on public.conversation_intelligence
  for each row when ((to_jsonb(old) - 'updated_at' - 'computed_at') is distinct from (to_jsonb(new) - 'updated_at' - 'computed_at'))
  execute function public.broadcast_inbox_conversation_event();

-- Attachments and media analyses had no trigger at all: a finished analysis never reached an open thread.
create trigger message_attachments_inbox_realtime
  after insert or update or delete on public.message_attachments
  for each row execute function public.broadcast_inbox_conversation_event();
create trigger message_media_analyses_inbox_realtime
  after insert or delete on public.message_media_analyses
  for each row execute function public.broadcast_inbox_conversation_event();
create trigger message_media_analyses_inbox_realtime_update
  after update on public.message_media_analyses
  for each row when (old.status is distinct from new.status or old.review_fields is distinct from new.review_fields or old.selected_traveller_id is distinct from new.selected_traveller_id or old.transcript is distinct from new.transcript)
  execute function public.broadcast_inbox_conversation_event();

-- Opening, acknowledging or closing a review can move a conversation between queues without touching its own row.
create trigger conversation_interventions_inbox_realtime
  after insert on public.conversation_interventions
  for each row execute function public.broadcast_inbox_intervention_event();
create trigger conversation_interventions_inbox_realtime_update
  after update on public.conversation_interventions
  for each row when (old.status is distinct from new.status or old.kind is distinct from new.kind)
  execute function public.broadcast_inbox_intervention_event();
