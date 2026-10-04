import "server-only";

import type { Db } from "@/lib/data/whatsapp-repository";

/**
 * Provider-neutral wrapper over the `channel_*_token` SQL functions
 * (supabase/migrations/20261129090100_channel_vault_functions.sql) — the only way application code reaches
 * Vault for Messenger/Instagram tokens. All three RPCs are revoked from every role except `service_role`, so
 * `db` must be the admin client. WhatsApp keeps its own wrapper (lib/whatsapp/vault.ts).
 */
export async function storeChannelToken(db: Db, agencyId: string, provider: "MESSENGER" | "INSTAGRAM", token: string): Promise<string> {
  const { data, error } = await db.rpc("channel_store_token", { p_agency_id: agencyId, p_provider: provider, p_token: token });
  if (error) throw new Error(`Failed to store the ${provider} token in Vault: ${error.message}`);
  return data as string;
}

export async function readChannelToken(db: Db, credentialRef: string): Promise<string | null> {
  const { data, error } = await db.rpc("channel_read_token", { p_credential_ref: credentialRef });
  if (error) throw new Error(`Failed to read a channel token from Vault: ${error.message}`);
  return (data as string | null) ?? null;
}

export async function deleteChannelToken(db: Db, credentialRef: string): Promise<void> {
  const { error } = await db.rpc("channel_delete_token", { p_credential_ref: credentialRef });
  if (error) throw new Error(`Failed to delete a channel token from Vault: ${error.message}`);
}
