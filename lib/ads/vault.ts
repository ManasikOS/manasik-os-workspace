import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Thin wrapper over the `ads_store_secret` / `ads_read_secret` /
 * `ads_delete_secret` SQL functions
 * (supabase/migrations/20261029090000_campaigns_ad_platform_integrations.sql
 * §C) — the only way application code reaches Supabase Vault for Meta Ads /
 * Google Ads credentials, mirroring `lib/whatsapp/vault.ts` exactly. Every
 * RPC here is revoked from every role except `service_role`, so `db` must
 * always be the admin client (see `createAdminClient` in
 * `utils/supabase/admin.ts`).
 */
export type AdsSecretPurpose = "meta_access_token" | "google_refresh_token";

export async function storeAdsSecret(db: Db, agencyId: string, purpose: AdsSecretPurpose, value: string): Promise<string> {
  const { data, error } = await db.rpc("ads_store_secret", { p_agency_id: agencyId, p_purpose: purpose, p_value: value });
  if (error) throw new Error(`Failed to store ${purpose} in Vault: ${error.message}`);
  return data as string;
}

export async function readAdsSecret(db: Db, credentialRef: string): Promise<string | null> {
  const { data, error } = await db.rpc("ads_read_secret", { p_credential_ref: credentialRef });
  if (error) throw new Error(`Failed to read ad platform secret from Vault: ${error.message}`);
  return (data as string | null) ?? null;
}

export async function deleteAdsSecret(db: Db, credentialRef: string): Promise<void> {
  const { error } = await db.rpc("ads_delete_secret", { p_credential_ref: credentialRef });
  if (error) throw new Error(`Failed to delete ad platform secret from Vault: ${error.message}`);
}
