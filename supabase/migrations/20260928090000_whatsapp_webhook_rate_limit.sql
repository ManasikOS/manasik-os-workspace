-- Rate limiting for the keyed WhatsApp webhook route — §5 E11 of
-- docs/modules/whatsapp-meta-connection-implementation-plan.md ("Rate-limit the
-- keyed webhook route by connection_key").
--
-- Only the KEYED route (`/api/webhooks/whatsapp/[connectionKey]`, Mode A)
-- needs this: `connection_key` is known from the URL alone, before any
-- signature check, so an attacker who finds or guesses a key can hammer it
-- with garbage POSTs to force wasted Vault reads and DB writes even though
-- every one fails signature verification. The UNKEYED route serves every
-- Mode B tenant behind one shared identity and Meta's own traffic patterns
-- there are far more predictable — out of scope here, matching the plan.
--
-- A small hits table rather than an in-memory counter: this app runs on
-- serverless functions with no shared memory between invocations, so an
-- in-process limiter resets on every cold start and undercounts badly.
-- Postgres is already the source of truth for everything else in this
-- webhook path (idempotency, tenant gate) — this is the same posture.

create table if not exists public.whatsapp_webhook_hits (
  id              bigint generated always as identity primary key,
  connection_key  text not null,
  hit_at          timestamptz not null default now()
);

comment on table public.whatsapp_webhook_hits is
  'Sliding-window hit log for rate-limiting the keyed WhatsApp webhook route by connection_key. Rows older than a few minutes are pruned opportunistically by check_webhook_rate_limit() itself — this table is never meant to grow unbounded.';

create index if not exists whatsapp_webhook_hits_key_time_idx
  on public.whatsapp_webhook_hits (connection_key, hit_at desc);

-- `security definer` so the keyed route (which calls this via the
-- service-role admin client before it has even decided whether the
-- connection_key is valid) always succeeds regardless of RLS — there is no
-- staff session behind an inbound webhook request. Revoked from every
-- application role below for the same reason `claim_agent_jobs` and the
-- Vault wrappers are: it must never be callable from a signed-in session.
create or replace function public.check_webhook_rate_limit(
  p_connection_key text,
  p_max_per_window integer default 120,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  v_count integer;
begin
  -- Opportunistic prune — cheap (index-only scan on this one key) and
  -- keeps the table from growing unbounded without needing a separate
  -- scheduled job just for housekeeping.
  delete from public.whatsapp_webhook_hits
    where connection_key = p_connection_key and hit_at < now() - interval '10 minutes';

  select count(*) into v_count
    from public.whatsapp_webhook_hits
    where connection_key = p_connection_key and hit_at >= v_window_start;

  if v_count >= p_max_per_window then
    return false; -- over budget — caller must not record this hit or process the request
  end if;

  insert into public.whatsapp_webhook_hits (connection_key) values (p_connection_key);
  return true;
end;
$$;

comment on function public.check_webhook_rate_limit(text, integer, integer) is
  'Sliding-window rate check for the keyed WhatsApp webhook route (E11). Returns false (and records nothing) once p_max_per_window hits land within p_window_seconds for this connection_key. service_role only.';

revoke all on function public.check_webhook_rate_limit(text, integer, integer) from public, authenticated, anon;

alter table public.whatsapp_webhook_hits enable row level security;
-- No policies granted to `authenticated`/`anon` — every access goes through
-- check_webhook_rate_limit() as service_role, which bypasses RLS entirely.
-- Enabling RLS here is belt-and-suspenders: even a future PostgREST
-- exposure of this table would default-deny rather than default-allow.
