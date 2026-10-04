-- SC2 (docs/inbox/scaling.md §6): every Inbox invalidation carries a validated, versioned, PII-free reason.
--
-- Topics do NOT change in this slice: each event still goes to `inbox:<agency>` and
-- `inbox:<agency>:conversation:<conversation>`, and the browser still performs its existing safe refresh, so this
-- migration changes what the message SAYS, not who receives it. Scoping the topics is SC5, after the client is deployed.
--
-- Payload rules (mirrored by lib/inbox/realtime/contracts.ts):
--   * `schemaVersion` and `conversationId` are always present;
--   * only ids, enums and counters — never message text, names, phone numbers or any other PII;
--   * the managed `realtime` schema is not touched; only `realtime.send()` is called, as before.

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
  elsif p_table = 'conversation_intelligence' then
    return jsonb_build_object(
      'schemaVersion', 1,
      'scope', 'INTELLIGENCE',
      'conversationId', v_conversation,
      -- A monotonic revision the browser can compare, never a value derived from customer content.
      'revision', coalesce(p_row ->> 'updated_at', p_row ->> 'computed_at', ''));
  end if;

  -- An unrecognised source: the browser treats this as one bounded reconciliation, never as data.
  return jsonb_build_object('schemaVersion', 1, 'scope', 'CONTEXT', 'conversationId', v_conversation, 'revision', 'unknown-source');
end;
$$;

revoke all on function public.build_inbox_realtime_event(text, text, jsonb) from public, anon, authenticated;

create or replace function public.broadcast_inbox_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_agency_id uuid;
  v_conversation_id uuid;
  v_event jsonb;
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  v_agency_id := (v_row ->> 'agency_id')::uuid;
  v_event := public.build_inbox_realtime_event(tg_table_name, tg_op, v_row);
  v_conversation_id := (v_event ->> 'conversationId')::uuid;

  perform realtime.send(v_event, 'inbox.invalidate', 'inbox:' || v_agency_id::text, true);
  perform realtime.send(v_event, 'inbox.invalidate', 'inbox:' || v_agency_id::text || ':conversation:' || v_conversation_id::text, true);
  return coalesce(new, old);
end;
$$;

revoke all on function public.broadcast_inbox_invalidation() from public, anon, authenticated;
