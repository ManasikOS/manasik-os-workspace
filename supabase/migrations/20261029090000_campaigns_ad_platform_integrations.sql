-- Campaigns V3 — Meta Ads / Google Ads OAuth connections + spend sync.
--
-- Mirrors the WhatsApp Business connection shape exactly
-- (supabase/migrations/20260825090000_whatsapp_channel.sql §A,
-- 20260925090000_whatsapp_connection_modes.sql §E,
-- 20260929090000_whatsapp_secret_race_fix.sql): never a plaintext token
-- column, only a Vault secret id (`credential_ref`) + a masked tail
-- (`credential_hint`) for the UI. `ads_store_secret` always creates a
-- brand-new, uniquely-named Vault secret per call (never updates one in
-- place) for the same reason the WhatsApp race-fix migration gives —
-- two concurrent connect attempts must never interleave writes to the
-- same secret row.
--
-- These tables are connection state only. They do NOT make this
-- integration work — that needs real Meta/Google Ads API credentials in
-- META_ADS_APP_ID/META_ADS_APP_SECRET and
-- GOOGLE_ADS_CLIENT_ID/GOOGLE_ADS_CLIENT_SECRET/GOOGLE_ADS_DEVELOPER_TOKEN
-- (see .env.example), plus Meta/Google approving the app for ads_read /
-- Google Ads API access. See docs/modules/campaigns-command-center-implementation-plan.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. meta_ads_integrations — one connected Meta (Facebook/Instagram) ad
--    account per agency.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.meta_ads_integrations (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies (id),

  ad_account_id       text,                     -- Meta act_<id>, null until connected
  ad_account_name     text,
  business_id         text,

  credential_ref      text,                     -- Supabase Vault secret id — never the token
  credential_hint     text,                     -- masked tail only, e.g. '…4f2a'
  token_expires_at    timestamptz,
  token_scopes        text[] not null default '{}',

  status              text not null default 'NOT_CONNECTED'
                        check (status in ('NOT_CONNECTED', 'CONNECTED', 'ERROR', 'DISCONNECTED')),
  last_error          text,
  last_synced_at      timestamptz,

  connected_by        uuid references auth.users (id) on delete set null,
  connected_by_name   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint meta_ads_integrations_one_per_agency unique (agency_id)
);

comment on table public.meta_ads_integrations is
  'One connected Meta Ads account per agency. Never stores a usable secret — credential_ref points at Supabase Vault. Connection state only; requires META_ADS_APP_ID/SECRET env vars and Meta app review (ads_read) to actually authorize.';

drop trigger if exists meta_ads_integrations_set_updated_at on public.meta_ads_integrations;
create trigger meta_ads_integrations_set_updated_at
  before update on public.meta_ads_integrations
  for each row execute function public.set_updated_at();

alter table public.meta_ads_integrations enable row level security;

drop policy if exists "staff read meta_ads_integrations" on public.meta_ads_integrations;
create policy "staff read meta_ads_integrations" on public.meta_ads_integrations
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

drop policy if exists "staff write meta_ads_integrations" on public.meta_ads_integrations;
create policy "staff write meta_ads_integrations" on public.meta_ads_integrations
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN'));

-- ─────────────────────────────────────────────────────────────────────────────
-- B. google_ads_integrations — one connected Google Ads customer account
--    per agency. Google's OAuth issues a long-lived refresh token (not a
--    long-lived access token like Meta) — credential_ref points at THAT.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.google_ads_integrations (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null references public.agencies (id),

  customer_id           text,                   -- Google Ads customer id (digits only), null until connected
  login_customer_id     text,                   -- manager account id, if the agency logs in under one
  account_name          text,

  credential_ref        text,                   -- Supabase Vault secret id holding the OAuth refresh token
  credential_hint       text,
  token_scopes          text[] not null default '{}',

  status                text not null default 'NOT_CONNECTED'
                          check (status in ('NOT_CONNECTED', 'CONNECTED', 'ERROR', 'DISCONNECTED')),
  last_error            text,
  last_synced_at        timestamptz,

  connected_by          uuid references auth.users (id) on delete set null,
  connected_by_name     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint google_ads_integrations_one_per_agency unique (agency_id)
);

comment on table public.google_ads_integrations is
  'One connected Google Ads customer account per agency. credential_ref points at the OAuth refresh token in Vault, never the token itself. Requires GOOGLE_ADS_CLIENT_ID/SECRET/DEVELOPER_TOKEN env vars and Google Ads API access to actually authorize.';

drop trigger if exists google_ads_integrations_set_updated_at on public.google_ads_integrations;
create trigger google_ads_integrations_set_updated_at
  before update on public.google_ads_integrations
  for each row execute function public.set_updated_at();

alter table public.google_ads_integrations enable row level security;

drop policy if exists "staff read google_ads_integrations" on public.google_ads_integrations;
create policy "staff read google_ads_integrations" on public.google_ads_integrations
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

drop policy if exists "staff write google_ads_integrations" on public.google_ads_integrations;
create policy "staff write google_ads_integrations" on public.google_ads_integrations
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN'));

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Generic Vault secret wrappers for ads integrations — same shape as
--    whatsapp_store_secret/whatsapp_read_secret/whatsapp_delete_secret
--    (20260925090000 §E, race-fixed by 20260929090000): every store call
--    creates a brand-new, uniquely-named secret rather than updating one in
--    place, so two concurrent connect attempts can never interleave writes
--    to the same Vault row. Named ads_* rather than reusing the
--    whatsapp_*-prefixed functions, even though whatsapp_read_secret /
--    whatsapp_delete_secret are already credential_ref-generic under the
--    hood — a shared name across two unrelated integration domains would
--    read as a coincidence, not a deliberate reuse.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ads_store_secret(p_agency_id uuid, p_purpose text, p_value text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_secret_id uuid;
begin
  v_secret_id := vault.create_secret(
    p_value,
    'ads_' || p_purpose || '_' || p_agency_id::text || '_' || gen_random_uuid()::text,
    'Ad platform ' || p_purpose || ' for one agency'
  );
  return v_secret_id::text;
end;
$$;

create or replace function public.ads_read_secret(p_credential_ref text)
returns text
language sql security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_credential_ref::uuid
$$;

create or replace function public.ads_delete_secret(p_credential_ref text)
returns void
language sql security definer set search_path = public as $$
  delete from vault.secrets where id = p_credential_ref::uuid
$$;

comment on function public.ads_store_secret(uuid, text, text) is
  'Creates a NEW, uniquely-named secret in Vault every call (never updates one in place — same race-condition fix as whatsapp_store_secret). service_role only.';
comment on function public.ads_read_secret(text) is
  'Decrypts a secret written by ads_store_secret, by its Vault secret id. service_role only.';
comment on function public.ads_delete_secret(text) is
  'Permanently removes a secret written by ads_store_secret — used on disconnect. service_role only.';

revoke all on function public.ads_store_secret(uuid, text, text) from public, authenticated, anon;
revoke all on function public.ads_read_secret(text) from public, authenticated, anon;
revoke all on function public.ads_delete_secret(text) from public, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. integration_connections — extend the closed provider set so the
--    generic Settings > Integrations status-card list can show Meta Ads /
--    Google Ads alongside WhatsApp, same as 20260821090000_agency_settings.sql.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in (
    'WHATSAPP_BUSINESS', 'EMAIL', 'SMS', 'PAYMENT_GATEWAY', 'FILE_STORAGE', 'ACCOUNTING', 'NUSUK',
    'META_ADS', 'GOOGLE_ADS'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- E. campaign_channels — link a channel row to the external ad-platform
--    campaign it corresponds to, so a spend/conversion sync knows which
--    internal campaign_channels row to credit.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.campaign_channels
  add column if not exists external_platform text,
  add column if not exists external_campaign_id text;

alter table public.campaign_channels drop constraint if exists campaign_channels_external_platform_check;
alter table public.campaign_channels add constraint campaign_channels_external_platform_check
  check (external_platform is null or external_platform in ('META_ADS', 'GOOGLE_ADS'));

create index if not exists campaign_channels_external_campaign_idx
  on public.campaign_channels (external_platform, external_campaign_id)
  where external_campaign_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. campaign_spend_entries — tag each entry with where it came from, and
--    carry the source platform's own id so a re-sync updates the same row
--    instead of double-counting. Manual entries (the only kind that existed
--    before this migration) are unaffected — source defaults to MANUAL and
--    external_id stays null.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.campaign_spend_entries
  add column if not exists source text not null default 'MANUAL',
  add column if not exists external_id text;

alter table public.campaign_spend_entries drop constraint if exists campaign_spend_entries_source_check;
alter table public.campaign_spend_entries add constraint campaign_spend_entries_source_check
  check (source in ('MANUAL', 'META_ADS', 'GOOGLE_ADS'));

-- One synced row per (campaign, source, external id, day) — a platform's
-- daily insight for one ad/campaign is the natural sync unit, so re-running
-- a sync for a date range upserts rather than duplicates.
create unique index if not exists campaign_spend_entries_sync_unique
  on public.campaign_spend_entries (campaign_id, source, external_id, spent_on)
  where source != 'MANUAL' and external_id is not null;

notify pgrst, 'reload schema';
