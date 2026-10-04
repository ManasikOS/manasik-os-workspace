-- WhatsApp connection modes — Basic Setup ("own app") alongside Embedded
-- Signup, per docs/modules/whatsapp-meta-connection-implementation-plan.md §5 E1.
--
-- Extends whatsapp_integrations (20260825090000) with everything a
-- production connection needs that the original schema didn't yet carry:
-- which mode connected it, a per-tenant webhook identity for Mode A (D3),
-- token lifecycle (D6), registration/PIN state (D5), funding and
-- onboarding-step tracking, and an append-only audit trail of what
-- happened during connection and afterwards (account_update, revocation,
-- quality changes — F10/F11).
--
-- Safe on a database with 20260808…20260924 applied. Every new column is
-- nullable or defaulted so existing rows (today: none in production, but
-- treat it as if there were) keep working unchanged.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. whatsapp_integrations — new columns.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.whatsapp_integrations
  add column if not exists connection_mode text not null default 'OWN_APP_TOKEN'
    check (connection_mode in ('OWN_APP_TOKEN', 'EMBEDDED_SIGNUP')),
  add column if not exists connection_key text,
  add column if not exists meta_business_id text,
  add column if not exists app_secret_ref text,
  add column if not exists verify_token_ref text,
  add column if not exists two_step_pin_ref text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists token_scopes text[],
  add column if not exists subscribed_at timestamptz,
  add column if not exists registered_at timestamptz,
  add column if not exists webhook_verified_at timestamptz,
  add column if not exists funding_status text not null default 'UNKNOWN'
    check (funding_status in ('UNKNOWN', 'FUNDED', 'UNFUNDED')),
  add column if not exists onboarding_step text not null default 'NOT_STARTED'
    check (onboarding_step in ('NOT_STARTED', 'TOKEN_STORED', 'SUBSCRIBED', 'REGISTERED', 'WEBHOOK_VERIFIED', 'COMPLETE')),
  add column if not exists platform_state jsonb not null default '{}'::jsonb;

-- D3 — the Mode A webhook path is looked up by this key, never by agency id
-- (the webhook has no session and must resolve identity from the URL
-- alone). Unique and sparse: Mode B integrations never populate it.
create unique index if not exists whatsapp_integrations_connection_key_idx
  on public.whatsapp_integrations (connection_key)
  where connection_key is not null;

-- Widen the status lifecycle: Meta can put a WABA under review or restrict
-- it without us disconnecting anything (F10) — collapsing that into ERROR
-- would throw away the one piece of information the agency actually needs.
alter table public.whatsapp_integrations drop constraint if exists whatsapp_integrations_status_check;
alter table public.whatsapp_integrations add constraint whatsapp_integrations_status_check
  check (status in ('NOT_CONNECTED', 'CONNECTED', 'UNFUNDED', 'ERROR', 'DISCONNECTED', 'PENDING_REVIEW', 'RESTRICTED'));

comment on column public.whatsapp_integrations.connection_mode is
  'OWN_APP_TOKEN (Basic Setup — the agency''s own Meta app) or EMBEDDED_SIGNUP (our app, Meta''s one-click flow). D1.';
comment on column public.whatsapp_integrations.connection_key is
  'Opaque unguessable slug for the Mode A keyed webhook route /api/webhooks/whatsapp/[connectionKey]. D3. Null for Mode B.';
comment on column public.whatsapp_integrations.app_secret_ref is
  'Vault ref to the AGENCY''S OWN Meta app secret (Mode A only) — never META_APP_SECRET, which only validates our own app''s signatures.';
comment on column public.whatsapp_integrations.two_step_pin_ref is
  'Vault ref to the 6-digit two-step-verification PIN we generate and register with Meta (D5). Never 000000, never absent.';
comment on column public.whatsapp_integrations.onboarding_step is
  'Where a connection attempt is in the Graph call sequence (F8). An integration is not truly usable until WEBHOOK_VERIFIED/COMPLETE — a stored token proves nothing on its own.';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. whatsapp_connection_events — append-only audit of connection and
--    platform-state transitions. What support (and, if ever asked, Meta)
--    gets shown when an agency asks "why did my number stop working".
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_connection_events (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies (id),
  integration_id  uuid references public.whatsapp_integrations (id) on delete set null,
  kind            text not null,          -- e.g. 'TOKEN_EXCHANGED', 'SUBSCRIBED', 'REGISTERED',
                                           -- 'WEBHOOK_VERIFIED', 'CANCELLED', 'ACCOUNT_UPDATE',
                                           -- 'REVOKED', 'SYNC_FAILED', 'QUALITY_CHANGED'
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.whatsapp_connection_events is
  'Append-only audit trail for WhatsApp connection onboarding and platform-state changes. See docs/modules/whatsapp-meta-connection-implementation-plan.md §5 E1/E5.';

create index if not exists whatsapp_connection_events_agency_id_idx
  on public.whatsapp_connection_events (agency_id, created_at desc);
create index if not exists whatsapp_connection_events_integration_id_idx
  on public.whatsapp_connection_events (integration_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. whatsapp_templates — synced with Meta's message_templates edge (E8).
--    Required evidence for App Review (video 2) and required for any
--    outbound message outside the 24-hour service window.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_templates (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null references public.agencies (id),
  name                  text not null,
  language              text not null,
  category              text not null check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  status                text not null default 'PENDING'
                          check (status in ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED')),
  components            jsonb not null default '[]'::jsonb,
  external_template_id  text,
  rejected_reason       text,
  created_by            uuid references auth.users (id) on delete set null,
  created_by_name       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint whatsapp_templates_name_language_unique unique (agency_id, name, language)
);

comment on table public.whatsapp_templates is
  'Message templates mirrored to/from the agency''s WABA. See docs/modules/whatsapp-meta-connection-implementation-plan.md §5 E8.';

create index if not exists whatsapp_templates_agency_id_idx on public.whatsapp_templates (agency_id);

drop trigger if exists whatsapp_templates_set_updated_at on public.whatsapp_templates;
create trigger whatsapp_templates_set_updated_at
  before update on public.whatsapp_templates
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Row Level Security — same posture as 20260825090000 §F.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.whatsapp_connection_events enable row level security;
alter table public.whatsapp_templates enable row level security;

drop policy if exists "staff read whatsapp_connection_events" on public.whatsapp_connection_events;
create policy "staff read whatsapp_connection_events" on public.whatsapp_connection_events
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

drop policy if exists "staff read whatsapp_templates" on public.whatsapp_templates;
create policy "staff read whatsapp_templates" on public.whatsapp_templates
  for select to authenticated
  using (agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS'));

drop policy if exists "staff write whatsapp_templates" on public.whatsapp_templates;
create policy "staff write whatsapp_templates" on public.whatsapp_templates
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Generic Vault secret wrappers (D3/D5) — whatsapp_store_token /
--    whatsapp_read_token (20260825090000 §G) only ever store ONE secret per
--    agency, named by agency id alone. Mode A needs several distinct
--    secrets per agency (the access token, the agency's own app secret,
--    a generated verify token, a generated two-step PIN) so these generic
--    versions key the Vault secret name by agency id *and* purpose.
--
--    whatsapp_store_token/whatsapp_read_token are untouched and keep
--    serving the access-token column exactly as before — no call site
--    changes. These are additive.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.whatsapp_store_secret(p_agency_id uuid, p_purpose text, p_value text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_secret_name text := 'whatsapp_' || p_purpose || '_' || p_agency_id::text;
  v_existing_id uuid;
  v_secret_id uuid;
begin
  select id into v_existing_id from vault.secrets where name = v_secret_name;

  if v_existing_id is not null then
    perform vault.update_secret(v_existing_id, p_value);
    v_secret_id := v_existing_id;
  else
    v_secret_id := vault.create_secret(p_value, v_secret_name, 'WhatsApp ' || p_purpose || ' for one agency');
  end if;

  return v_secret_id::text;
end;
$$;

create or replace function public.whatsapp_read_secret(p_credential_ref text)
returns text
language sql security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_credential_ref::uuid
$$;

create or replace function public.whatsapp_delete_secret(p_credential_ref text)
returns void
language sql security definer set search_path = public as $$
  delete from vault.secrets where id = p_credential_ref::uuid
$$;

comment on function public.whatsapp_store_secret(uuid, text, text) is
  'Writes (or rotates) one purpose-named secret (app_secret, verify_token, two_step_pin, …) into Vault for one agency; returns the secret id. service_role only. D3/D5.';
comment on function public.whatsapp_read_secret(text) is
  'Decrypts a secret written by whatsapp_store_secret, by its Vault secret id. service_role only.';
comment on function public.whatsapp_delete_secret(text) is
  'Permanently removes a secret written by whatsapp_store_secret — used on disconnect. service_role only.';

revoke all on function public.whatsapp_store_secret(uuid, text, text) from public, authenticated, anon;
revoke all on function public.whatsapp_read_secret(text) from public, authenticated, anon;
revoke all on function public.whatsapp_delete_secret(text) from public, authenticated, anon;
