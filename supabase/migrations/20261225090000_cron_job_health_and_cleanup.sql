-- T6 (tasks/plan.md): monitoring for the pg_cron jobs, replacing the run history and failure alerts Inngest would have given.
--
-- What the audit showed (docs/progress/2026-10-01-scheduling-audit.md): two jobs failed for three days and nothing said so, and
-- cron.job_run_details grows by about 5,000 rows a day with nothing trimming it. pg_cron only records whether the database call
-- ran, not whether the web app answered: a route that returns 500 every minute still shows "succeeded". This migration adds:
--
--   1. public.cron_route_calls: one row per scheduled call to the web app (request id, route, and later the HTTP status).
--      invoke_cron_route records each call; recording never stops the call itself.
--   2. public.cron_collect_route_results(): copies the HTTP answer from net._http_response (which pg_net trims after about
--      six hours) onto the call row. Runs every 5 minutes.
--   3. public.cron_history_cleanup(): deletes cron.job_run_details and cron_route_calls rows older than 7 days. Runs daily.
--   4. public.cron_job_health(): one row per job with its state: OK, STALE (no success in twice its interval), FAILING (two
--      scheduler errors or two HTTP errors in a row), PAUSED, or NEVER_RUN. This is what an alert reads. Nothing here sends an
--      alert; where it goes is a separate decision.
--
-- Platform table, not tenant data: no agency column. It holds route names, request ids and status codes only, never message
-- content, names or secrets. RLS is on with no policy, and no role but the owner (and the definer functions below) can touch it.
--
-- Rollback: select cron.unschedule('cron-route-results'); select cron.unschedule('cron-history-cleanup');
--   then re-apply the invoke_cron_route body from 20261224090000_cron_finance_ops_sweep_inactive.sql and drop the objects below.

create table if not exists public.cron_route_calls (
  request_id    bigint primary key,
  path          text not null,
  called_at     timestamptz not null default now(),
  status_code   integer,
  timed_out     boolean,
  error_message text,
  collected_at  timestamptz
);

comment on table public.cron_route_calls is
  'One row per scheduled call from pg_cron to a web-app route, with the HTTP answer once collected. Platform monitoring data, not tenant data: route names, request ids and status codes only.';

create index if not exists cron_route_calls_path_called_idx on public.cron_route_calls (path, called_at desc);
create index if not exists cron_route_calls_uncollected_idx on public.cron_route_calls (called_at) where collected_at is null;

alter table public.cron_route_calls enable row level security;
revoke all on table public.cron_route_calls from public, anon, authenticated;

-- invoke_cron_route: the allow-list and behaviour are unchanged from 20261224090000; the only addition is recording the call.
create or replace function public.invoke_cron_route(p_path text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_base_url text;
  v_secret text;
  v_request_id bigint;
begin
  if p_path not in (
    '/api/cron/agent-jobs',
    '/api/cron/whatsapp-health',
    '/api/cron/whatsapp-billing-sync',
    '/api/cron/departure-ops-jobs',
    '/api/cron/release-seat-holds',
    '/api/cron/lead-followups',
    '/api/cron/ai-usage-rollup',
    '/api/cron/inbox-lanes',
    '/api/cron/inbox-email-poll',
    '/api/cron/inbox-sla',
    '/api/cron/inbox-retention',
    '/api/cron/finance-ops-sweep'
  ) then
    raise exception 'invoke_cron_route: % is not a recognised cron path', p_path;
  end if;

  select ds.decrypted_secret into v_base_url
    from vault.decrypted_secrets ds join vault.secrets s on s.id = ds.id
    where s.name = 'cron_http_base_url';
  select ds.decrypted_secret into v_secret
    from vault.decrypted_secrets ds join vault.secrets s on s.id = ds.id
    where s.name = 'cron_http_secret';

  if v_base_url is null or v_secret is null then
    raise warning 'invoke_cron_route(%): cron_http_base_url/cron_http_secret not configured — call public.set_cron_http_config() first', p_path;
    return null;
  end if;

  select net.http_get(
    url := v_base_url || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 55000
  ) into v_request_id;

  -- Monitoring must never stop a job: if recording fails, the call has already been made and the job still succeeds.
  begin
    insert into public.cron_route_calls (request_id, path) values (v_request_id, p_path) on conflict do nothing;
  exception when others then
    raise warning 'invoke_cron_route(%): could not record the call: %', p_path, sqlerrm;
  end;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_cron_route(text) from public, authenticated, anon;

create or replace function public.cron_collect_route_results()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_collected integer;
begin
  update public.cron_route_calls c
     set status_code = r.status_code,
         timed_out = coalesce(r.timed_out, false),
         error_message = left(r.error_msg, 200),
         collected_at = now()
    from net._http_response r
   where r.id = c.request_id
     and c.collected_at is null;
  get diagnostics v_collected = row_count;

  -- pg_net always records an answer, a timeout or an error within about a minute. No record after 15 minutes means it was lost.
  update public.cron_route_calls
     set collected_at = now(), timed_out = true, error_message = 'no response was recorded'
   where collected_at is null
     and called_at < now() - interval '15 minutes';

  return v_collected;
end;
$$;

create or replace function public.cron_history_cleanup()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_runs integer;
  v_calls integer;
begin
  delete from cron.job_run_details where start_time < now() - interval '7 days';
  get diagnostics v_runs = row_count;
  delete from public.cron_route_calls where called_at < now() - interval '7 days';
  get diagnostics v_calls = row_count;
  return v_runs + v_calls;
end;
$$;

-- How often a schedule is meant to fire, in seconds, for the shapes this app uses. Anything else answers null, and a job with an
-- unknown interval is never reported as STALE (it can still be FAILING).
create or replace function public.cron_expected_interval_seconds(p_schedule text)
returns integer
language sql immutable set search_path = '' as $$
  select case
    when p_schedule = '* * * * *' then 60
    when p_schedule ~ '^\*/[0-9]{1,2} \* \* \* \*$' then (substring(p_schedule from '^\*/([0-9]{1,2}) '))::integer * 60
    when p_schedule ~ '^[0-9]{1,2} \* \* \* \*$' then 3600
    when p_schedule ~ '^[0-9]{1,2} [0-9]{1,2} \* \* \*$' then 86400
    else null
  end;
$$;

create or replace function public.cron_job_health()
returns table (
  jobname text,
  schedule text,
  active boolean,
  expected_interval_seconds integer,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer,
  last_http_status integer,
  consecutive_http_failures integer,
  state text,
  reason text
)
language sql security definer set search_path = '' as $$
  with jobs as (
    select j.jobid, j.jobname, j.schedule, j.active,
           public.cron_expected_interval_seconds(j.schedule) as interval_seconds,
           substring(j.command from '/api/cron/[a-z0-9-]+') as route
      from cron.job j
  ),
  runs as (
    select d.jobid, d.status, d.start_time,
           row_number() over (partition by d.jobid order by d.start_time desc) as position
      from cron.job_run_details d
     where d.start_time > now() - interval '7 days'
  ),
  run_summary as (
    select jobid,
           max(start_time) as last_run_at,
           max(start_time) filter (where status = 'succeeded') as last_success_at,
           max(start_time) filter (where status <> 'succeeded') as last_failure_at,
           coalesce(min(position) filter (where status = 'succeeded') - 1, count(*))::integer as consecutive_failures
      from runs
     group by jobid
  ),
  calls as (
    select c.path, c.status_code, c.called_at,
           (c.status_code is null or c.status_code >= 400 or coalesce(c.timed_out, false)) as failed,
           row_number() over (partition by c.path order by c.called_at desc) as position
      from public.cron_route_calls c
     where c.collected_at is not null
       and c.called_at > now() - interval '7 days'
  ),
  call_summary as (
    select path,
           (array_agg(status_code order by called_at desc))[1] as last_http_status,
           coalesce(min(position) filter (where not failed) - 1, count(*))::integer as consecutive_http_failures
      from calls
     group by path
  )
  select j.jobname, j.schedule, j.active, j.interval_seconds,
         r.last_run_at, r.last_success_at, r.last_failure_at,
         coalesce(r.consecutive_failures, 0),
         c.last_http_status,
         coalesce(c.consecutive_http_failures, 0),
         case
           when not j.active then 'PAUSED'
           when r.last_run_at is null then 'NEVER_RUN'
           when coalesce(r.consecutive_failures, 0) >= 2 or coalesce(c.consecutive_http_failures, 0) >= 2 then 'FAILING'
           when j.interval_seconds is not null
                and coalesce(r.last_success_at, '-infinity'::timestamptz) < now() - make_interval(secs => j.interval_seconds * 2 + 60) then 'STALE'
           else 'OK'
         end,
         case
           when not j.active then 'The job is paused.'
           when r.last_run_at is null then 'The job has not run yet.'
           when coalesce(r.consecutive_failures, 0) >= 2 then 'The scheduler reported an error on the last ' || r.consecutive_failures || ' runs.'
           when coalesce(c.consecutive_http_failures, 0) >= 2 then 'The web app answered with an error (or did not answer) on the last ' || c.consecutive_http_failures || ' calls.'
           when j.interval_seconds is not null
                and coalesce(r.last_success_at, '-infinity'::timestamptz) < now() - make_interval(secs => j.interval_seconds * 2 + 60) then 'No successful run in more than twice its interval.'
           else null
         end
    from jobs j
    left join run_summary r on r.jobid = j.jobid
    left join call_summary c on c.path = j.route
   order by j.jobname;
$$;

revoke all on function public.cron_collect_route_results() from public, anon, authenticated;
revoke all on function public.cron_history_cleanup() from public, anon, authenticated;
revoke all on function public.cron_expected_interval_seconds(text) from public, anon, authenticated;
revoke all on function public.cron_job_health() from public, anon, authenticated;
grant execute on function public.cron_job_health() to service_role;

-- The two housekeeping jobs run SQL directly (no web call). Created only if missing; an existing job is never touched.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'cron-route-results') then
    perform cron.schedule('cron-route-results', '*/5 * * * *', 'select public.cron_collect_route_results();');
  end if;
  if not exists (select 1 from cron.job where jobname = 'cron-history-cleanup') then
    perform cron.schedule('cron-history-cleanup', '37 3 * * *', 'select public.cron_history_cleanup();');
  end if;
end $$;
