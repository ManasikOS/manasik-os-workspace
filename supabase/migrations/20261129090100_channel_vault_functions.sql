-- Provider-neutral Vault helpers for Messenger / Instagram tokens (Phase 3 of
-- docs/modules/messenger-instagram-ai-agent-implementation-plan.md).
--
-- The existing whatsapp_store_token / whatsapp_read_token / whatsapp_delete_secret functions work on any Vault
-- secret, but they create secrets NAMED "whatsapp_token_…", which would mislabel a Messenger Page token for
-- whoever inspects Vault later. These three do the same job under an honest name. Same posture as the WhatsApp
-- ones: SECURITY DEFINER, pinned search_path, executable by service_role only (the vault schema is not exposed
-- over PostgREST, and a token must never be readable by an authenticated staff session).

-- A NEW, uniquely-named secret on every call (never updated in place by name) — the same race fix as
-- 20260929090000_whatsapp_secret_race_fix.sql.
create or replace function public.channel_store_token(p_agency_id uuid, p_provider text, p_token text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_secret_id uuid;
begin
  if p_provider not in ('MESSENGER', 'INSTAGRAM') then
    raise exception 'unsupported channel provider %', p_provider;
  end if;
  v_secret_id := vault.create_secret(
    p_token,
    'channel_' || lower(p_provider) || '_token_' || p_agency_id::text || '_' || gen_random_uuid()::text,
    initcap(p_provider) || ' access token for one agency'
  );
  return v_secret_id::text;
end;
$$;

create or replace function public.channel_read_token(p_credential_ref text)
returns text
language sql security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_credential_ref::uuid
$$;

create or replace function public.channel_delete_token(p_credential_ref text)
returns void
language sql security definer set search_path = public as $$
  delete from vault.secrets where id = p_credential_ref::uuid
$$;

comment on function public.channel_store_token(uuid, text, text) is
  'Writes one Messenger/Instagram access token into Supabase Vault as a new uniquely-named secret; returns its id, stored as channel_connections.credential_ref. service_role only.';
comment on function public.channel_read_token(text) is
  'Decrypts a token written by channel_store_token, by Vault secret id. service_role only.';
comment on function public.channel_delete_token(text) is
  'Permanently removes a token written by channel_store_token — used on disconnect. service_role only.';

revoke all on function public.channel_store_token(uuid, text, text) from public, authenticated, anon;
revoke all on function public.channel_read_token(text) from public, authenticated, anon;
revoke all on function public.channel_delete_token(text) from public, authenticated, anon;
