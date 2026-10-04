-- I1 (docs/inbox/scale-inngest-implementation-plan.md §5.3, Phase I; decision R8 in architecture.md §16): the bridge from Postgres to
-- Inngest. A lifecycle change (handed to staff, conversation gone quiet, booking created ...) writes one row here IN THE SAME
-- TRANSACTION as the change, so the event exists if and only if the change committed. The worker forwards rows to Inngest using the
-- row id as the event id, so a retry after a timeout is deduplicated by Inngest.
--
-- Events carry ids only: Inngest stores event payloads and step output. `enqueue_inngest_event` refuses a payload over 2 KB and
-- anything that is not a JSON object; which keys are allowed is enforced by the Zod catalogue in lib/inbox/inngest/events.ts.
--
-- Service-role only. RLS is on and no policy is defined, so no signed-in user can read or write it.
--
-- Deploy order: apply before the code that forwards.

create table if not exists public.inngest_outbox (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references public.agencies (id) on delete cascade,
  name             text not null check (name ~ '^[a-z][a-z0-9_.-]*/[a-z][a-z0-9_.-]*$'),
  data             jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 2048),
  created_at       timestamptz not null default now(),
  next_attempt_at  timestamptz not null default now(),
  attempts         integer not null default 0,
  locked_until     timestamptz,
  sent_at          timestamptz,
  dead_at          timestamptz,
  last_error       text
);
comment on table public.inngest_outbox is
  'Events waiting to be forwarded to Inngest (I1). Ids only. The row id is the Inngest event id. Written in the same transaction as the change it announces.';
alter table public.inngest_outbox enable row level security;
revoke all on table public.inngest_outbox from anon, authenticated;

-- Only unfinished rows are ever scanned; sent history (which only grows) stays out of the index.
create index if not exists inngest_outbox_pending_idx
  on public.inngest_outbox (next_attempt_at, id)
  where sent_at is null and dead_at is null;
-- Keeps the agency cascade delete cheap.
create index if not exists inngest_outbox_agency_idx on public.inngest_outbox (agency_id);

create or replace function public.enqueue_inngest_event(p_agency_id uuid, p_name text, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.inngest_outbox (agency_id, name, data)
  values (p_agency_id, p_name, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.enqueue_inngest_event(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_inngest_event(uuid, text, jsonb) to service_role;

-- Takes up to p_limit due rows and leases them. Two forwarders never take the same row (SKIP LOCKED); a forwarder that dies leaves
-- rows that become due again when the lease ends.
create or replace function public.claim_inngest_outbox(p_limit integer default 50, p_lease_seconds integer default 60)
returns setof public.inngest_outbox
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select o.id
      from public.inngest_outbox o
     where o.sent_at is null and o.dead_at is null
       and o.next_attempt_at <= now()
       and (o.locked_until is null or o.locked_until < now())
     order by o.next_attempt_at, o.id
     limit greatest(1, least(coalesce(p_limit, 50), 200))
       for update skip locked
  )
  update public.inngest_outbox o
     set attempts = o.attempts + 1,
         locked_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 60), 10))
    from picked
   where o.id = picked.id
  returning o.*;
$$;
revoke all on function public.claim_inngest_outbox(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_inngest_outbox(integer, integer) to service_role;

create or replace function public.complete_inngest_outbox(p_ids uuid[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with done as (
    update public.inngest_outbox
       set sent_at = now(), locked_until = null, last_error = null
     where id = any(p_ids) and sent_at is null
    returning 1
  )
  select count(*)::integer from done;
$$;
revoke all on function public.complete_inngest_outbox(uuid[]) from public, anon, authenticated;
grant execute on function public.complete_inngest_outbox(uuid[]) to service_role;

-- A failed forward: retry with exponential backoff (10 s, 20 s, 40 s ... capped at 15 min); after 12 attempts the row is parked as
-- dead so it stops being retried and can be inspected. The error is truncated and is never the payload.
create or replace function public.fail_inngest_outbox(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.inngest_outbox
     set locked_until = null,
         last_error = left(coalesce(p_error, 'unknown'), 500),
         next_attempt_at = now() + make_interval(secs => least(power(2, least(attempts, 12)) * 5, 900)),
         dead_at = case when attempts >= 12 then now() else null end
   where id = p_id and sent_at is null;
$$;
revoke all on function public.fail_inngest_outbox(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_inngest_outbox(uuid, text) to service_role;
