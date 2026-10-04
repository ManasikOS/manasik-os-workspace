-- Q2 (docs/inbox/scale-inngest-implementation-plan.md §5.1, Phase Q): a claim whose cost does not grow with the backlog, and a
-- lease per running job instead of one 5-minute stale timer for everything.
--
-- Before: `claim_channel_jobs` ranked EVERY due QUEUED job in the lane with a window function on each call, only to keep the
-- first few per agency. Measured on Manasik OS (50 agencies x 1,000 due jobs, 20 claims of 20 jobs, per-agency cap 10): p50 80 ms,
-- p95 84 ms, and it grows with the backlog. The lane's advisory lock is held for the whole call, so that time is also time no other
-- worker can claim.
--
-- After: the claim finds the agencies that have queued work (a skip scan over the index), then for each takes only the top
-- `cap - in_flight` jobs by priority and age, straight from the index. Work per call is about agencies x cap, not the backlog.
-- The lane lock stays (it is what makes the per-agency cap exact) but is now held for milliseconds. Which jobs are chosen, and in
-- what order, is unchanged: per agency by priority, then age; across agencies round-robin by rank; then `p_limit`.
--
-- Leases: a claim stamps `locked_until`. A job whose lease has run out is released by `release_stale_channel_jobs`, and it no longer
-- counts against its agency's cap or blocks the next REPLY for its conversation. A dead worker used to hold a conversation's
-- reply for up to 5 minutes; now it holds it for one lease (90 s for REALTIME). Rows without a lease (queued before this
-- migration) keep the old 5-minute rule.
--
-- Deploy order: apply this migration BEFORE the code that passes `p_lease_seconds`. The old 4-argument calls keep working against
-- the new function (the lease defaults to 300 s).

alter table public.channel_jobs add column if not exists locked_until timestamptz;
comment on column public.channel_jobs.locked_until is
  'When the claiming worker''s lease ends. After it, the job is treated as abandoned: released by release_stale_channel_jobs and ignored by the fairness cap and the one-reply-per-conversation rule.';

-- The claim's two lookups. The first serves both the skip scan over agencies and each agency's ordered top-N; the partial predicate
-- keeps DONE/DEAD history (which only grows) out of it. The second serves the in-flight count and stale release.
create index if not exists channel_jobs_queued_claim_idx
  on public.channel_jobs (lane, agency_id, priority desc, run_after, id)
  where status = 'QUEUED';
create index if not exists channel_jobs_running_idx
  on public.channel_jobs (lane, agency_id)
  where status = 'RUNNING';

-- The signature gains a defaulted argument, which makes it a different function: drop the old one so a call cannot be ambiguous.
drop function if exists public.claim_channel_jobs(text, text, integer, integer);

create or replace function public.claim_channel_jobs(
  p_lane            text,
  p_worker_id       text,
  p_limit           integer,
  p_per_agency_cap  integer,
  p_lease_seconds   integer default 300
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
  with recursive agency_scan(agency_id) as (
    -- A skip scan: each step jumps to the next agency that has queued work in this lane, instead of reading every queued row.
    (select j.agency_id from public.channel_jobs j where j.lane = p_lane and j.status = 'QUEUED' order by j.agency_id limit 1)
    union all
    select (select j.agency_id from public.channel_jobs j
             where j.lane = p_lane and j.status = 'QUEUED' and j.agency_id > s.agency_id
             order by j.agency_id limit 1)
      from agency_scan s
     where s.agency_id is not null
  ),
  agencies as (
    select s.agency_id from agency_scan s where s.agency_id is not null
  ),
  in_flight as (
    select f.agency_id, count(*)::integer as n
      from public.channel_jobs f
     where f.lane = p_lane and f.status = 'RUNNING'
       and coalesce(f.locked_until, f.locked_at + interval '5 minutes') > now()
     group by f.agency_id
  ),
  candidates as (
    select c.id, c.rn, c.run_after
      from agencies a
      left join in_flight f on f.agency_id = a.agency_id
     cross join lateral (
       select q.id, q.run_after, row_number() over (order by q.priority desc, q.run_after, q.id) as rn
         from (
           select j.id, j.run_after, j.priority
             from public.channel_jobs j
            where j.lane = p_lane and j.status = 'QUEUED' and j.agency_id = a.agency_id and j.run_after <= now()
              -- One reply per conversation at a time: skip a REPLY while another for the same conversation holds a live lease.
              and not (
                j.kind = 'REPLY'
                and exists (
                  select 1 from public.channel_jobs r
                   where r.agency_id = j.agency_id and r.kind = 'REPLY' and r.status = 'RUNNING'
                     and r.coalesce_key = j.coalesce_key
                     and coalesce(r.locked_until, r.locked_at + interval '5 minutes') > now()
                )
              )
            order by j.priority desc, j.run_after, j.id
            limit greatest(p_per_agency_cap - coalesce(f.n, 0), 0)
         ) q
     ) c
  ),
  eligible as (
    select e.id, e.rn, e.run_after
      from candidates e
     order by e.rn, e.run_after, e.id
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
         locked_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 10)),
         locked_by = p_worker_id,
         attempts = u.attempts + 1
    from locked l
   where u.id = l.id
  returning u.*;
end;
$$;

revoke all on function public.claim_channel_jobs(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_channel_jobs(text, text, integer, integer, integer) to service_role;

-- The other transitions clear the lease along with the lock. Bodies are otherwise unchanged.
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
     set status = 'DONE', locked_at = null, locked_until = null, locked_by = null, last_error = null
   where id = p_id and status = 'RUNNING' and locked_by = p_worker_id;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

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
         locked_until = null,
         locked_by = null
   where id = p_id and status = 'RUNNING' and locked_by = p_worker_id
  returning status into v_status;
  return v_status;  -- null when the job was not this worker's to fail
end;
$$;

create or replace function public.release_channel_job(p_id uuid, p_worker_id text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.channel_jobs
     set status = 'QUEUED',
         attempts = greatest(attempts - 1, 0),
         run_after = now(),
         last_error = left(coalesce(p_reason, 'released without penalty'), 2000),
         locked_at = null,
         locked_until = null,
         locked_by = null
   where id = p_id and status = 'RUNNING' and locked_by = p_worker_id;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- A running job is abandoned when its lease has run out. A row with no lease (claimed before this migration) uses the old rule:
-- untouched for `p_older_than_seconds`.
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
         locked_until = null,
         locked_by = null
   where status = 'RUNNING'
     and coalesce(locked_until, locked_at + make_interval(secs => greatest(p_older_than_seconds, 1))) < now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.complete_channel_job(uuid, text)',
    'public.fail_channel_job(uuid, text, text, integer)',
    'public.release_channel_job(uuid, text, text)',
    'public.release_stale_channel_jobs(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
