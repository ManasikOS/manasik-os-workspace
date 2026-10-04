-- SC1 (docs/inbox/scaling.md §9): a canonical inbound message cannot commit without its required processing jobs.
--
-- Before: the webhook inserted the message, then separately queued the agent job and the ENRICH job. A failure between
-- the calls left a stored message with no job, and the provider's retry stopped at the message idempotency guard, so
-- the missing job was never created.
--
-- `ingest_inbound_message_atomic` does the minimum atomic write once the application has resolved the connection and
-- the conversation: message insert (idempotent on (agency_id, external_message_id)) + agent job + REALTIME ENRICH job,
-- all or nothing. No external calls, identity guessing, model, media download or provider send happen in it.
create or replace function public.ingest_inbound_message_atomic(
  p_agency_id uuid,
  p_conversation_id uuid,
  p_external_message_id text,
  p_content text,
  p_message_type text,
  p_metadata jsonb,
  p_agent_job_kind text,
  p_enrich_delay_seconds integer
)
returns table (message_id uuid, sequence_number bigint, is_duplicate boolean, agent_job_id uuid, enrich_job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
  v_sequence bigint;
  v_agent_job uuid;
  v_enrich_job uuid;
begin
  if p_agency_id is null or p_conversation_id is null then
    raise exception 'ingest_inbound_message_atomic: agency and conversation are required' using errcode = '22023';
  end if;
  if p_external_message_id is null or btrim(p_external_message_id) = '' then
    raise exception 'ingest_inbound_message_atomic: an external message id is required for idempotency' using errcode = '22023';
  end if;
  if p_agent_job_kind is not null and p_agent_job_kind not in ('PROCESS_INBOUND', 'TRANSCRIBE_AUDIO') then
    raise exception 'ingest_inbound_message_atomic: unsupported agent job kind' using errcode = '22023';
  end if;
  if p_enrich_delay_seconds is not null and (p_enrich_delay_seconds < 0 or p_enrich_delay_seconds > 3600) then
    raise exception 'ingest_inbound_message_atomic: enrich delay out of range' using errcode = '22023';
  end if;

  -- The conversation must belong to the agency the caller resolved: a wrong pairing must never write anywhere.
  perform 1 from public.conversations c where c.id = p_conversation_id and c.agency_id = p_agency_id;
  if not found then
    raise exception 'ingest_inbound_message_atomic: conversation does not belong to this agency' using errcode = '42501';
  end if;

  insert into public.conversation_messages as m
    (agency_id, conversation_id, external_message_id, role, actor_kind, content, message_type, metadata)
  values
    (p_agency_id, p_conversation_id, p_external_message_id, 'user', 'CUSTOMER',
     coalesce(p_content, ''), coalesce(p_message_type, 'TEXT'), coalesce(p_metadata, '{}'::jsonb))
  on conflict (agency_id, external_message_id) where external_message_id is not null
  do nothing
  returning m.id, m.sequence_number into v_message_id, v_sequence;

  if v_message_id is null then
    -- A committed duplicate: hand back the canonical identifiers and create nothing.
    select m.id, m.sequence_number into v_message_id, v_sequence
      from public.conversation_messages m
     where m.agency_id = p_agency_id and m.external_message_id = p_external_message_id;
    return query select v_message_id, v_sequence, true, null::uuid, null::uuid;
    return;
  end if;

  if p_agent_job_kind is not null then
    insert into public.agent_jobs (agency_id, kind, payload)
    values (p_agency_id, p_agent_job_kind, jsonb_build_object('conversationId', p_conversation_id, 'messageId', v_message_id))
    returning id into v_agent_job;
  end if;

  if p_enrich_delay_seconds is not null then
    v_enrich_job := public.enqueue_channel_job(
      p_agency_id, 'REALTIME', 'ENRICH', 'enrich:' || p_conversation_id::text,
      jsonb_build_object('conversationId', p_conversation_id, 'messageId', v_message_id),
      0, p_enrich_delay_seconds, 3);
  end if;

  return query select v_message_id, v_sequence, false, v_agent_job, v_enrich_job;
end;
$$;

revoke all on function public.ingest_inbound_message_atomic(uuid, uuid, text, text, text, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.ingest_inbound_message_atomic(uuid, uuid, text, text, text, jsonb, text, integer) to service_role;

-- Repair path (not the normal scheduler): messages stored before the atomic function existed, or whose enrichment job was
-- lost, are found by their EFFECT — a conversation with a recent customer message whose intelligence is missing or still
-- PENDING/STALE and which has no live ENRICH job — and given one coalesced job. Bounded by `p_limit`, agency-scoped,
-- and it never re-queues a conversation that already has a reading (FRESH/SKIPPED) or a recent dead-lettered ENRICH.
create or replace function public.repair_missing_enrich_jobs(p_agency_id uuid, p_older_than_seconds integer default 120, p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_repaired integer := 0;
  v_conversation uuid;
begin
  for v_conversation in
    select c.id
      from public.conversations c
     where c.agency_id = p_agency_id
       and c.last_inbound_at is not null
       and c.last_inbound_at < now() - make_interval(secs => greatest(p_older_than_seconds, 0))
       and c.last_inbound_at > now() - interval '24 hours'
       and coalesce((select i.state from public.conversation_intelligence i where i.conversation_id = c.id), 'PENDING') in ('PENDING', 'STALE')
       and not exists (
         select 1 from public.channel_jobs j
          where j.agency_id = p_agency_id and j.kind = 'ENRICH'
            and j.coalesce_key = 'enrich:' || c.id::text
            and (j.status in ('QUEUED', 'RUNNING') or (j.status = 'DEAD' and j.updated_at > now() - interval '24 hours'))
       )
     order by c.last_inbound_at
     limit greatest(least(p_limit, 500), 1)
  loop
    perform public.enqueue_channel_job(p_agency_id, 'REALTIME', 'ENRICH', 'enrich:' || v_conversation::text,
      jsonb_build_object('conversationId', v_conversation, 'repair', true), 0, 0, 3);
    v_repaired := v_repaired + 1;
  end loop;
  return v_repaired;
end;
$$;

revoke all on function public.repair_missing_enrich_jobs(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.repair_missing_enrich_jobs(uuid, integer, integer) to service_role;
