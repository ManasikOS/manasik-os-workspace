-- TASK-028 P1.3: schedule the Inbox health check (app/api/cron/inbox-health/route.ts), which reports stuck cron jobs, an ageing outbox
-- and dead-lettered work to Sentry.
--
-- Order of release matters: DEPLOY the route first, then apply this migration. Until the route is deployed, the job would call a path the
-- app does not have and every run would answer 404 (and cron_job_health would then report this very job as failing).
--
-- invoke_cron_route: the body and behaviour are unchanged from 20261226090000 (including recording each call); the only change is one more
-- allowed path. The job is created only when it does not exist; an existing job is never touched. No table, column or index changes.
--
-- Rollback: select cron.unschedule('inbox-health');
--   then re-apply the invoke_cron_route body from 20261226090000_cron_reply_window_sweep.sql (thirteen paths).

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
    '/api/cron/finance-ops-sweep',
    '/api/cron/reply-window-sweep',
    '/api/cron/inbox-health'
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

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'inbox-health') then
    perform cron.schedule(
      'inbox-health',
      '*/5 * * * *',
      format('select public.invoke_cron_route(%L);', '/api/cron/inbox-health')
    );
  end if;
end $$;
