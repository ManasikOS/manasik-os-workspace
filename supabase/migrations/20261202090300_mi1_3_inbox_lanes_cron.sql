-- MI1.3 — schedule the Inbox lane coordinator (app/api/cron/inbox-lanes/route.ts) every minute.
--
-- The coordinator reads REALTIME depth and either drains inline or fans out N shard invocations of itself.
-- Only the allow-list in invoke_cron_route changes (body copied from 20261202090000_mi0_1_ai_usage_daily.sql);
-- shard requests are self-invocations carrying the same bearer secret, so they need no allow-list entry.

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
    '/api/cron/inbox-lanes'
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
  begin
    perform cron.unschedule('inbox-lanes');
  exception when others then
    null; -- first apply
  end;

  perform cron.schedule(
    'inbox-lanes',
    '* * * * *',
    format('select public.invoke_cron_route(%L);', '/api/cron/inbox-lanes')
  );
end $$;
