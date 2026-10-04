-- I2 (docs/inbox/scale-inngest-implementation-plan.md, Phase I): repair a webhook delivery whose messages never landed.
--
-- The webhook stores the raw delivery first, then the messages. If the process dies between the two, or Meta stops retrying, the raw
-- event is in `whatsapp_webhook_events` / `channel_webhook_events` and the customer's message is not in the Inbox. Nothing marked the
-- raw event as handled, so nothing could tell. The reconciler (lib/inbox/reconcile/raw-events.ts) finds deliveries that hold messages,
-- checks each message is stored, and replays the ones that are not through the same idempotent ingest the webhook uses. It marks an
-- event `processed_at` once every message is accounted for, so it is looked at once.
--
-- These functions only SELECT candidates and stamp `processed_at`/`error`. They never touch conversations or messages; the replay goes
-- through the application's normal ingest path.
--
-- Service-role only. Deploy order: apply before the code that reconciles.

-- Only unhandled, signed, tenant-resolved events are ever scanned; handled history (which only grows) stays out of the index.
create index if not exists whatsapp_webhook_events_unreconciled_idx
  on public.whatsapp_webhook_events (received_at)
  where processed_at is null and agency_id is not null and signature_valid;
create index if not exists channel_webhook_events_unreconciled_idx
  on public.channel_webhook_events (received_at)
  where processed_at is null and agency_id is not null and signature_valid;

-- Candidate deliveries that hold messages, in the age window [p_min_age_seconds, p_max_age_seconds]. Events that failed a previous
-- attempt sort last, so one stubborn event cannot hold up the rest. p_source is 'WHATSAPP' or 'CHANNEL' (Messenger and Instagram).
create or replace function public.find_unreconciled_raw_events(
  p_source          text,
  p_min_age_seconds integer,
  p_max_age_seconds integer,
  p_limit           integer default 200
)
returns table (id uuid, provider text, agency_id uuid, payload jsonb, error text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 500));
begin
  if p_source = 'WHATSAPP' then
    return query
      select e.id, 'WHATSAPP'::text, e.agency_id, e.payload, e.error
        from public.whatsapp_webhook_events e
       where e.processed_at is null and e.agency_id is not null and e.signature_valid
         and e.received_at <= now() - make_interval(secs => greatest(p_min_age_seconds, 0))
         and e.received_at >= now() - make_interval(secs => greatest(p_max_age_seconds, 1))
         and e.payload @? '$.entry[*].changes[*].value.messages'
       order by (e.error is not null), e.received_at
       limit v_limit;
  elsif p_source = 'CHANNEL' then
    return query
      select e.id, e.provider, e.agency_id, e.payload, e.error
        from public.channel_webhook_events e
       where e.processed_at is null and e.agency_id is not null and e.signature_valid
         and e.received_at <= now() - make_interval(secs => greatest(p_min_age_seconds, 0))
         and e.received_at >= now() - make_interval(secs => greatest(p_max_age_seconds, 1))
         and e.payload @? '$.entry[*].messaging'
       order by (e.error is not null), e.received_at
       limit v_limit;
  else
    raise exception 'find_unreconciled_raw_events: unknown source';
  end if;
end;
$$;
revoke all on function public.find_unreconciled_raw_events(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.find_unreconciled_raw_events(text, integer, integer, integer) to service_role;

-- Stamps events as handled (p_error null) or records why a replay failed (they stay eligible for the next pass). The error is
-- truncated and is a message, never the payload.
create or replace function public.mark_raw_events_reconciled(p_source text, p_ids uuid[], p_error text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_source = 'WHATSAPP' then
    update public.whatsapp_webhook_events e
       set processed_at = case when p_error is null then now() else e.processed_at end,
           error = left(p_error, 300)
     where e.id = any(p_ids) and e.processed_at is null;
  elsif p_source = 'CHANNEL' then
    update public.channel_webhook_events e
       set processed_at = case when p_error is null then now() else e.processed_at end,
           error = left(p_error, 300)
     where e.id = any(p_ids) and e.processed_at is null;
  else
    raise exception 'mark_raw_events_reconciled: unknown source';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.mark_raw_events_reconciled(text, uuid[], text) from public, anon, authenticated;
grant execute on function public.mark_raw_events_reconciled(text, uuid[], text) to service_role;
