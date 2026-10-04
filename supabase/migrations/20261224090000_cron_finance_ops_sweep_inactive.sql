-- T3 (tasks/plan.md): finish the pg_cron job set. After T3a the eleven live jobs all run, so what is left is the one job the app
-- has a route for but nobody ever scheduled.
--
-- `finance-ops-sweep` (app/api/cron/finance-ops-sweep/route.ts, the nightly Finance review) has never run on a timer: its route
-- says "wire this to run hourly" and no scheduler did. This migration allows its path and creates the job INACTIVE, so turning it
-- on later is one statement and nothing starts by surprise (decision D3 defaults to "leave it off"):
--
--   select cron.alter_job((select jobid from cron.job where jobname = 'finance-ops-sweep'), active := true);
--
-- Safe to re-run: the job is only created when it does not exist, and an existing job (its schedule, command or paused state)
-- is never touched. No other job is created, changed or removed; cadence of every other job is unchanged (decision D1: the drains stay
-- at every minute because the worker is not deployed).
--
-- Rollback: select cron.unschedule('finance-ops-sweep'); then re-apply the body from 20261223090000_invoke_cron_route_allow_list_fix.sql.

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

  return v_request_id;
end;
$$;

revoke all on function public.invoke_cron_route(text) from public, authenticated, anon;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'finance-ops-sweep') then
    perform cron.schedule(
      'finance-ops-sweep',
      '0 * * * *',
      format('select public.invoke_cron_route(%L);', '/api/cron/finance-ops-sweep')
    );
    perform cron.alter_job((select jobid from cron.job where jobname = 'finance-ops-sweep'), active := false);
  end if;
end $$;
