-- Fixes a real, reproduced race condition in the Mode A connect wizard.
--
-- `whatsapp_store_secret()` / `whatsapp_store_token()` named their Vault
-- secret by `agency_id` (+ purpose) alone and updated that SAME secret
-- in place on every call. That's fine for a single connect attempt, but
-- two `connectWhatsAppOwnApp()` calls for the same agency close together
-- (a user retrying after a failed Meta verification — exactly what
-- happened debugging this: localhost, then ngrok, then a real deploy, in
-- quick succession) can interleave: call A's Vault write and call B's
-- Vault write both target the same secret row, so whichever writes LAST
-- wins — independent of which call's `whatsapp_integrations` row upsert
-- (which carries the matching `connection_key`) commits last. The result
-- observed in production: a `connection_key` from one attempt paired with
-- a verify-token VALUE from a different attempt, so Meta's webhook
-- verification failed with a token that had never actually been shown for
-- that key.
--
-- Fix: every call creates a brand-new, uniquely-named secret instead of
-- updating one shared slot. Two concurrent calls now each get their own
-- secret and can never stomp on each other's value. The trade-off is an
-- orphaned old secret left in Vault on every reconnect; both call sites in
-- application code now explicitly delete the previous refs (read off the
-- existing row before overwriting it) to keep Vault from accumulating
-- garbage — see the corresponding whatsapp-actions.ts changes.

create or replace function public.whatsapp_store_secret(p_agency_id uuid, p_purpose text, p_value text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_secret_id uuid;
begin
  -- Uniquely named per call (not just per agency+purpose) so concurrent or
  -- repeated connect attempts never share — and therefore never race on —
  -- the same underlying Vault row.
  v_secret_id := vault.create_secret(
    p_value,
    'whatsapp_' || p_purpose || '_' || p_agency_id::text || '_' || gen_random_uuid()::text,
    'WhatsApp ' || p_purpose || ' for one agency'
  );
  return v_secret_id::text;
end;
$$;

comment on function public.whatsapp_store_secret(uuid, text, text) is
  'Creates a NEW, uniquely-named secret in Vault every call (never updates an existing one by name — see this migration''s header for the race condition that caused) and returns its id. service_role only. D3/D5.';

create or replace function public.whatsapp_store_token(p_agency_id uuid, p_token text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_secret_id uuid;
begin
  v_secret_id := vault.create_secret(
    p_token,
    'whatsapp_token_' || p_agency_id::text || '_' || gen_random_uuid()::text,
    'WhatsApp Cloud API token for one agency'
  );
  return v_secret_id::text;
end;
$$;

comment on function public.whatsapp_store_token(uuid, text) is
  'Creates a NEW, uniquely-named secret in Vault every call (never updates an existing one by name — same race fix as whatsapp_store_secret). Returns the secret id to store as whatsapp_integrations.credential_ref. service_role only.';
