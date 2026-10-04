-- Let signed-in staff READ the status of a Messenger / Instagram / WhatsApp connection (Integrations cards).
--
-- 20260916073247_unified_inbox_core.sql revoked every privilege on channel_connections from anon and authenticated
-- and created a select policy (channel_connections_select: same agency, ADMIN / CEO / MARKETING / OPERATIONS) but
-- never granted SELECT, so under the session client every read failed with "permission denied". The Integrations
-- screen then showed "Not Connected" for a connection that was saved and working.
--
-- The fix keeps the original intent — a credential is never readable by a staff session — by granting SELECT on
-- the safe columns ONLY. credential_ref and refresh_credential_ref (Vault references), provider_metadata (account
-- and user ids), capability_snapshot and sync_cursor stay unreadable; the row policy still limits every read to the
-- caller's own agency and the four roles above. Writes are unchanged: service_role only.

grant select (
  id,
  agency_id,
  provider,
  provider_account_id,
  display_name,
  status,
  ai_enabled,
  last_inbound_at,
  last_outbound_at,
  health_checked_at,
  last_error,
  credential_expires_at,
  created_at,
  updated_at
) on table public.channel_connections to authenticated;
