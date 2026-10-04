-- MI1.1 — channel_jobs: a durable, coalescing, per-tenant-fair work queue (G12).
-- docs/inbox/implementation-plan.md MI1.1, Architecture §5.7, §7.2, §7.3.
--
-- The existing agent_jobs queue keeps serving WhatsApp agent turns UNCHANGED. New work goes to this table
-- so the lane scheduler can be introduced without re-testing the live reply path.
--
--   A. channel_jobs                — one row per unit of work, three lanes (REALTIME / STANDARD / BULK)
--   B. enqueue_channel_job()       — the only insert path. Coalesces on (agency_id, coalesce_key) while QUEUED:
--                                    a second enqueue is an upsert that only pushes run_after later, which is
--                                    what turns a five-message burst into one run. PostgREST cannot express a
--                                    partial-index ON CONFLICT, hence an RPC.
--   C. claim_channel_jobs()        — fair-share claim: at most p_per_agency_cap slots per agency (in-flight jobs
--                                    count against it), served round-robin by per-agency rank so one agency
--                                    dumping 2 000 messages cannot starve another's single job.
--                                    NOTE: Architecture §7.2's sketch puts FOR UPDATE SKIP LOCKED on a query
--                                    containing a window function, which Postgres rejects ("FOR UPDATE is not
--                                    allowed with window functions"). This keeps the same semantics: rank in a
--                                    subquery, lock in the outer query, and serialise claims per lane with an
--                                    advisory lock so the cap is exact rather than approximate. A claim is a
--                                    few milliseconds; workers never wait on job execution, only on each other's claim.
--   D. complete / fail / release   — state transitions. attempts is incremented at CLAIM time so a worker that
--                                    dies mid-job still counts, and release_stale_channel_jobs() dead-letters a
--                                    job that keeps killing its worker instead of retrying it forever.
--   E. inbox_lane_health           — re-created to add channel_jobs' lanes beside LEGACY_AGENT.
--
-- Every function is security definer with set search_path = '' and EXECUTE for service_role only (the queue
-- deliberately crosses tenants, so no signed-in staff session may call it). Follows
-- 20261126090000_lock_down_definer_functions.sql.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.channel_jobs (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies (id),

  lane           text not null check (lane in ('REALTIME', 'STANDARD', 'BULK')),
  -- Mirrors JOB_KINDS in lib/inbox/intelligence/contracts.ts; extend both together.
  kind           text not null check (kind in (
                   'ENRICH', 'IDENTITY_MATCH', 'OFFER_MATCH', 'RISK_SCAN', 'QUEUE_REFRESH', 'HANDOFF_SUMMARY',
                   'TRANSCRIBE_VOICE', 'READ_DOCUMENT', 'EXTRACT_RECEIPT', 'EMBED_KNOWLEDGE', 'RETENTION_SWEEP',
                   'USAGE_ROLLUP', 'REPLAY')),
  coalesce_key   text,
  payload        jsonb not null default '{}'::jsonb,
  priority       integer not null default 0,

  status         text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'DEAD')),
  attempts       integer not null default 0 check (attempts >= 0),
  max_attempts   integer not null default 3 check (max_attempts > 0),
  last_error     text,

  run_after      timestamptz not null default now(),
  locked_at      timestamptz,
  locked_by      text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.channel_jobs is
  'Lane-scheduled, per-tenant-fair work queue for the Inbox intelligence pipeline. Written and claimed only through the service_role RPCs in this migration; agent_jobs is untouched.';

-- The burst-coalescing guarantee (Architecture §7.3). NULL coalesce_key rows never collide.
create unique index if not exists channel_jobs_coalesce_uidx
  on public.channel_jobs (agency_id, coalesce_key)
  where status = 'QUEUED' and coalesce_key is not null;

create index if not exists channel_jobs_claim_idx on public.channel_jobs (lane, status, run_after, priority desc);
create index if not exists channel_jobs_agency_status_idx on public.channel_jobs (agency_id, status);

drop trigger if exists channel_jobs_set_updated_at on public.channel_jobs;
create trigger channel_jobs_set_updated_at
  before update on public.channel_jobs
  for each row execute function public.set_updated_at();

alter table public.channel_jobs enable row level security;

drop policy if exists "staff read channel_jobs" on public.channel_jobs;
create policy "staff read channel_jobs" on public.channel_jobs
  for select to authenticated
  using (agency_id = public.current_agency_id());

-- No insert/update/delete policy for authenticated: only service_role (the RPCs below) writes.

-- ─────────────────────────────────────────────────────────────────────────────
-- B. enqueue_channel_job
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enqueue_channel_job(
  p_agency_id     uuid,
  p_lane          text,
  p_kind          text,
  p_coalesce_key  text,
  p_payload       jsonb,
  p_priority      integer,
  p_delay_seconds integer,
  p_max_attempts  integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_run_after timestamptz := now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 0), 0));
begin
  insert into public.channel_jobs as j
    (agency_id, lane, kind, coalesce_key, payload, priority, run_after, max_attempts)
  values
    (p_agency_id, p_lane, p_kind, p_coalesce_key, coalesce(p_payload, '{}'::jsonb),
     coalesce(p_priority, 0), v_run_after, coalesce(p_max_attempts, 3))
  on conflict (agency_id, coalesce_key) where status = 'QUEUED' and coalesce_key is not null
  do update set
    -- A later message extends the settle window; it never pulls the job earlier.
    run_after = greatest(j.run_after, excluded.run_after),
    payload   = excluded.payload,
    priority  = greatest(j.priority, excluded.priority)
  returning j.id into v_id;

  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. claim_channel_jobs — fair share
-- ─────────────────────────────────────────────────────────────────────────────
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
  -- One claim at a time per lane: makes the per-agency in-flight cap exact and the round-robin deterministic.
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
     set status = 'RUNNING',
         locked_at = now(),
         locked_by = p_worker_id,
         attempts = u.attempts + 1
    from locked l
   where u.id = l.id
  returning u.*;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. complete / fail / release stale locks
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.complete_channel_job(p_id uuid, p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.channel_jobs
     set status = 'DONE', locked_at = null, locked_by = null, last_error = null
   where id = p_id and status = 'RUNNING' and locked_by = p_worker_id;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Retry with backoff, or dead-letter once attempts are exhausted (attempts was incremented at claim).
create or replace function public.fail_channel_job(p_id uuid, p_worker_id text, p_error text, p_backoff_seconds integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.channel_jobs
     set status = case when attempts >= max_attempts then 'DEAD' else 'QUEUED' end,
         run_after = case when attempts >= max_attempts then run_after
                          else now() + make_interval(secs => greatest(coalesce(p_backoff_seconds, 0), 0)) end,
         last_error = left(coalesce(p_error, 'unknown error'), 2000),
         locked_at = null,
         locked_by = null
   where id = p_id and status = 'RUNNING' and locked_by = p_worker_id
  returning status into v_status;
  return v_status;  -- null when the job was not this worker's to fail
end;
$$;

-- A worker that died mid-job leaves a RUNNING row behind. Re-queue it, or dead-letter it if it keeps doing that.
create or replace function public.release_stale_channel_jobs(p_older_than_seconds integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.channel_jobs
     set status = case when attempts >= max_attempts then 'DEAD' else 'QUEUED' end,
         last_error = 'Released after the worker stopped responding',
         locked_at = null,
         locked_by = null
   where status = 'RUNNING'
     and locked_at < now() - make_interval(secs => greatest(p_older_than_seconds, 1));
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.enqueue_channel_job(uuid, text, text, text, jsonb, integer, integer, integer)',
    'public.claim_channel_jobs(text, text, integer, integer)',
    'public.complete_channel_job(uuid, text)',
    'public.fail_channel_job(uuid, text, text, integer)',
    'public.release_stale_channel_jobs(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. inbox_lane_health now covers channel_jobs' lanes too (same columns as MI0.3's view)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.inbox_lane_health
with (security_invoker = true) as
select h.agency_id,
       h.lane,
       count(*) filter (where h.status = 'QUEUED')::integer  as queued,
       count(*) filter (where h.status = 'RUNNING')::integer as running,
       count(*) filter (where h.status = 'FAILED')::integer  as failed,
       count(*) filter (where h.status = 'DEAD')::integer    as dead,
       coalesce(extract(epoch from (now() - min(h.run_after) filter (where h.status = 'QUEUED')))::integer, 0)
         as oldest_queued_age_seconds
  from (
    select agency_id, 'LEGACY_AGENT'::text as lane, status, run_after from public.agent_jobs
    union all
    select agency_id, lane, status, run_after from public.channel_jobs
  ) h
 group by h.agency_id, h.lane;
