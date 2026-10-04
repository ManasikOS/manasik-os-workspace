-- T3a (tasks/plan.md): restore two scheduled jobs that have been failing on every run.
--
-- `inbox-sla` (every 2 minutes) and `inbox-retention` (daily) are scheduled in pg_cron and call
-- `public.invoke_cron_route`, but the latest definition of that function (20261213090000_em2_inbox_email_poll_cron.sql)
-- copied an older allow-list and left both paths out. Every run raised
-- "invoke_cron_route: <path> is not a recognised cron path" and never reached the app:
-- inbox-sla has failed since 2026-09-28 03:32 UTC, inbox-retention every night since 2026-09-29
-- (docs/progress/2026-10-01-scheduling-audit.md).
--
-- The ONLY change from the live function is two more paths in the allow-list. The body, the security posture
-- (security definer, search_path = public, no access for public/authenticated/anon) and every other path are unchanged.
-- No job is created, changed or removed here: both jobs already exist in cron.job.
--
-- Effect after applying: both jobs recover on their next tick. inbox-retention will then process the nights it missed in one run.
--
-- Rollback: re-apply the body from 20261213090000_em2_inbox_email_poll_cron.sql (nine paths). That restores the failing state, so
-- only do it if the two routes themselves misbehave, and pause the two jobs first:
--   select cron.alter_job((select jobid from cron.job where jobname = 'inbox-sla'), active := false);
--   select cron.alter_job((select jobid from cron.job where jobname = 'inbox-retention'), active := false);

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
    '/api/cron/inbox-retention'
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
