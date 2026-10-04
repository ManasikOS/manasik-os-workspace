-- Q1 (docs/inbox/scale-inngest-implementation-plan.md §5.1): the AI reply becomes a job on the fair-share `channel_jobs`
-- queue instead of a row in `agent_jobs`, so that
--   * a burst of customer messages ("Hi", "Umrah package", "4 people") is ONE reply: jobs merge on a key while QUEUED, wait a
--     few seconds for the customer to pause, and the wait is capped so a chatty customer cannot postpone the reply forever;
--   * two turns for the SAME conversation never run at once: the claim skips a REPLY whose conversation already has one RUNNING;
--   * replies are fair across agencies (the queue's per-agency cap) and rank ahead of enrichment inside an agency;
--   * a retry never re-calls the model or sends twice: `reply_intents` records the intent BEFORE anything is sent.
--
-- Nothing changes for any agency until it is listed in `inbox_reply_queue_agencies` (service role only, so a tenant cannot
-- switch itself over). Every other agency keeps the `agent_jobs` path exactly as it was. Rolling back = delete the row.

-- 1. The new job kind.
alter table public.channel_jobs drop constraint if exists channel_jobs_kind_check;
alter table public.channel_jobs add constraint channel_jobs_kind_check check (kind in (
  'ENRICH', 'IDENTITY_MATCH', 'OFFER_MATCH', 'RISK_SCAN', 'QUEUE_REFRESH', 'HANDOFF_SUMMARY',
  'TRANSCRIBE_VOICE', 'READ_DOCUMENT', 'EXTRACT_RECEIPT', 'EMBED_KNOWLEDGE', 'RETENTION_SWEEP',
  'USAGE_ROLLUP', 'REPLAY', 'REPLY'));

-- 2. Which agencies use the queued reply path. Present = on. No policy and no grants: only the service role (and the
--    definer functions below) can read or write it.
create table if not exists public.inbox_reply_queue_agencies (
  agency_id  uuid primary key references public.agencies (id) on delete cascade,
  enabled_at timestamptz not null default now(),
  enabled_by text
);
comment on table public.inbox_reply_queue_agencies is
  'Agencies whose AI replies run as REPLY jobs on channel_jobs (Q1). A row switches the agency on; deleting it switches it back to agent_jobs. Platform-operated: no tenant access.';
alter table public.inbox_reply_queue_agencies enable row level security;
revoke all on table public.inbox_reply_queue_agencies from anon, authenticated;

-- 3. The durable record of one reply to one inbound message. Written before the model runs and before anything is sent, so
--    a crash at any point leaves evidence: what was decided, by which attempt, and whether the send may have happened.
--      GENERATING -> SENDING -> SENT | SKIPPED
--      SENDING whose lease ran out (the outcome is unknown) -> UNKNOWN: never re-sent automatically, staff decide.
--      GENERATED is a reply that was produced but not sent (a retryable send failure): a retry sends it without the model.
create table if not exists public.reply_intents (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies (id) on delete cascade,
  conversation_id     uuid not null,
  inbound_message_id  uuid not null,
  status              text not null default 'GENERATING'
                        check (status in ('GENERATING', 'GENERATED', 'SENDING', 'SENT', 'SKIPPED', 'UNKNOWN')),
  owner_token         text,
  lease_until         timestamptz,
  reply_text          text,
  reply_buttons       jsonb,
  provider_message_id text,
  skip_reason         text,
  attempts            integer not null default 1 check (attempts >= 1),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint reply_intents_one_per_inbound unique (agency_id, inbound_message_id),
  constraint reply_intents_conversation_fk foreign key (conversation_id, agency_id)
    references public.conversations (id, agency_id) on delete cascade,
  constraint reply_intents_message_fk foreign key (inbound_message_id, agency_id)
    references public.conversation_messages (id, agency_id) on delete cascade
);
comment on table public.reply_intents is
  'One row per AI reply to one inbound message (Q1): the idempotency record that stops a retry from re-calling the model or re-sending. Service role only.';

create index if not exists reply_intents_conversation_idx on public.reply_intents (agency_id, conversation_id);

drop trigger if exists reply_intents_set_updated_at on public.reply_intents;
create trigger reply_intents_set_updated_at
  before update on public.reply_intents
  for each row execute function public.set_updated_at();

alter table public.reply_intents enable row level security;
revoke all on table public.reply_intents from anon, authenticated;

-- 4. Makes the "is a reply for this conversation already running?" check in the claim an index probe.
create index if not exists channel_jobs_reply_running_idx
  on public.channel_jobs (agency_id, coalesce_key)
  where kind = 'REPLY' and status = 'RUNNING';

-- 5. The claim, unchanged except for one rule: a REPLY is not claimed while another REPLY for the same conversation is RUNNING.
--    It stays QUEUED (and keeps merging newer messages into itself) until the running turn finishes. The lane's advisory lock
--    serialises claims, so the check cannot race with another claim.
create or replace function public.claim_channel_jobs(
  p_lane            text,
  p_worker_id       text,
  p_limit           integer,
  p_per_agency_cap  integer
)
returns setof public.channel_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('channel_jobs.claim.' || p_lane));

  return query
  with in_flight as (
    select f.agency_id, count(*)::integer as n
      from public.channel_jobs f
     where f.lane = p_lane and f.status = 'RUNNING'
     group by f.agency_id
  ),
  ranked as (
    select j.id,
           j.run_after,
           row_number() over (partition by j.agency_id order by j.priority desc, j.run_after, j.id) as rn,
           j.agency_id
      from public.channel_jobs j
     where j.lane = p_lane and j.status = 'QUEUED' and j.run_after <= now()
       and not (
         j.kind = 'REPLY'
         and exists (
           select 1 from public.channel_jobs r
            where r.agency_id = j.agency_id and r.kind = 'REPLY' and r.status = 'RUNNING'
              and r.coalesce_key = j.coalesce_key
         )
       )
  ),
  eligible as (
    select r.id, r.rn, r.run_after
      from ranked r
      left join in_flight f on f.agency_id = r.agency_id
     where r.rn <= greatest(p_per_agency_cap - coalesce(f.n, 0), 0)
     order by r.rn, r.run_after, r.id
     limit greatest(p_limit, 0)
  ),
  locked as (
    select c.id
      from public.channel_jobs c
      join eligible e on e.id = c.id
     where c.status = 'QUEUED'
     order by e.rn, e.run_after, c.id
       for update of c skip locked
  )
  update public.channel_jobs u
     set status = 'RUNNING', locked_at = now(), locked_by = p_worker_id, attempts = u.attempts + 1
    from locked l
   where u.id = l.id
  returning u.*;
end;
$$;

revoke all on function public.claim_channel_jobs(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_channel_jobs(text, text, integer, integer) to service_role;

-- 6. The atomic inbound write (SC1), with one addition: for an agency in `inbox_reply_queue_agencies`, the agent job is a
--    REPLY on channel_jobs instead of a row in agent_jobs. Its id comes back in the same `agent_job_id` column, so callers are
--    unchanged. Voice notes (TRANSCRIBE_AUDIO) keep the old path; their follow-up reply is queued by the transcription job.
--    The reply merges on 'reply:<conversation>', waits at most 10 s (0 for a first contact) and is never pushed later than 20 s
--    after the job was first queued. `sequenceNumber` records which inbound message this turn answers.
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
    if p_agent_job_kind = 'PROCESS_INBOUND'
       and exists (select 1 from public.inbox_reply_queue_agencies q where q.agency_id = p_agency_id) then
      insert into public.channel_jobs as j
        (agency_id, lane, kind, coalesce_key, payload, priority, run_after, max_attempts)
      values
        (p_agency_id, 'REALTIME', 'REPLY', 'reply:' || p_conversation_id::text,
         jsonb_build_object('conversationId', p_conversation_id, 'messageId', v_message_id, 'sequenceNumber', v_sequence),
         10, now() + make_interval(secs => least(greatest(coalesce(p_enrich_delay_seconds, 0), 0), 10)), 5)
      on conflict (agency_id, coalesce_key) where status = 'QUEUED' and coalesce_key is not null
      do update set
        -- A later message extends the settle window so the burst is one turn, but never past 20 s after the job was
        -- first queued: a customer who keeps typing must still get an answer.
        run_after = least(greatest(j.run_after, excluded.run_after), j.created_at + interval '20 seconds'),
        payload   = excluded.payload
      returning j.id into v_agent_job;
    else
      insert into public.agent_jobs (agency_id, kind, payload)
      values (p_agency_id, p_agent_job_kind, jsonb_build_object('conversationId', p_conversation_id, 'messageId', v_message_id))
      returning id into v_agent_job;
    end if;
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
