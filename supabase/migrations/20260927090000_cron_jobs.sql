-- Cron scheduling via Supabase itself — `pg_cron` fires on schedule,
-- `pg_net` makes the HTTP call. Replaces vercel.json (deleted): every
-- scheduled route in this app is a plain `GET` guarded by
-- `Authorization: Bearer $CRON_SECRET`, so Postgres calling it out is no
-- different from any other scheduler — see the doc comment atop each of
-- the five route files this migration wires up.
--
-- Two pieces of information the SQL below cannot know at migration time —
-- this deployment's public base URL, and the value of its `CRON_SECRET`
-- env var — live in Supabase Vault instead of being hardcoded here (same
-- posture as every other secret in this app; see D3/D5 of
-- docs/modules/whatsapp-meta-connection-implementation-plan.md). Run this ONCE per
-- environment, from the SQL editor or the CLI, with `service_role`:
--
--   select public.set_cron_http_config(
--     'https://crm.yourdomain.com',   -- no trailing slash
--     'the exact value of your CRON_SECRET env var'
--   );
--
-- Until that call is made, every scheduled job fires, finds no config, logs
-- a warning, and does nothing — it never guesses a URL or skips the auth
-- header. Re-run it whenever the deployment's domain or CRON_SECRET changes.

create extension if not exists pg_cron;
-- Supabase's own convention: pg_net's extension metadata lives in
-- `extensions`, though the `net.http_get`/`net.http_post` functions it
-- creates always land in their own `net` schema regardless.
create extension if not exists pg_net with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Vault-backed config. `service_role` only, like every other Vault
--    wrapper in this codebase — a signed-in staff member's session client
--    must never be able to read or overwrite where cron jobs point.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_cron_http_config(p_base_url text, p_cron_secret text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'cron_http_base_url';
  if v_id is not null then
    perform vault.update_secret(v_id, p_base_url);
  else
    perform vault.create_secret(p_base_url, 'cron_http_base_url', 'Base URL (no trailing slash) the scheduled cron routes are called at.');
  end if;

  select id into v_id from vault.secrets where name = 'cron_http_secret';
  if v_id is not null then
    perform vault.update_secret(v_id, p_cron_secret);
  else
    perform vault.create_secret(p_cron_secret, 'cron_http_secret', 'Must equal this deployment''s CRON_SECRET env var — sent as the Bearer token on every scheduled cron call.');
  end if;
end;
$$;

comment on function public.set_cron_http_config(text, text) is
  'One-time-per-environment setup: where scheduled cron jobs call, and the bearer token they authenticate with. service_role only — run from the SQL editor, never from application code.';

revoke all on function public.set_cron_http_config(text, text) from public, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. The dispatcher. `security definer` so `cron.schedule`'s job (which
--    runs as the role that scheduled it, typically `postgres`) can read
--    Vault regardless of who's asking, but the allow-list below is what
--    actually keeps this from becoming an open HTTP-call-anything RPC —
--    it is `revoke`d from every role that could otherwise invoke it
--    directly over PostgREST.
-- ─────────────────────────────────────────────────────────────────────────────
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
    '/api/cron/release-seat-holds'
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

comment on function public.invoke_cron_route(text) is
  'Fires a GET at one of this app''s allow-listed cron routes via pg_net, authenticated with the Vault-stored CRON_SECRET. Called only by the scheduled jobs below — never exposed to application roles.';

revoke all on function public.invoke_cron_route(text) from public, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. The schedule. `cron.unschedule` first and swallow "job not found" so
--    this migration is safe to re-apply — pg_cron versions differ on
--    whether `cron.schedule` upserts an existing job name on its own.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_job record;
begin
  for v_job in
    select * from (values
      ('whatsapp-agent-jobs-drain',      '* * * * *',    '/api/cron/agent-jobs'),
      ('whatsapp-health-check',          '0 3 * * *',    '/api/cron/whatsapp-health'),
      ('whatsapp-billing-sync',          '0 4 * * *',    '/api/cron/whatsapp-billing-sync'),
      ('departure-ops-jobs-drain',       '*/15 * * * *', '/api/cron/departure-ops-jobs'),
      ('release-seat-holds',             '0 * * * *',    '/api/cron/release-seat-holds')
    ) as t(job_name, job_schedule, job_path)
  loop
    begin
      perform cron.unschedule(v_job.job_name);
    exception when others then
      null; -- job didn't exist yet — fine, this is the first apply
    end;

    perform cron.schedule(
      v_job.job_name,
      v_job.job_schedule,
      format('select public.invoke_cron_route(%L);', v_job.job_path)
    );
  end loop;
end $$;

comment on extension pg_cron is
  'Schedules the 5 jobs above via public.invoke_cron_route() — see docs/modules/whatsapp-meta-connection-implementation-plan.md §5 E6/E10 and docs/modules/whatsapp-ai-agent-implementation-plan.md §6.3. Run public.set_cron_http_config() once per environment before these do anything.';
