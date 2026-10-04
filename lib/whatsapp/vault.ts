import "server-only";

import type { Db } from "@/lib/data/whatsapp-repository";

/**
 * Thin wrapper over the `whatsapp_store_token` / `whatsapp_read_token` SQL
 * functions (supabase/migrations/20260825090000_whatsapp_channel.sql §G) —
 * the only way application code reaches Supabase Vault, since the `vault`
 * schema itself is not exposed over PostgREST. Both RPCs are revoked from
 * every role except `service_role`, so `db` here must always be the admin
 * client (see D4 in docs/modules/whatsapp-ai-agent-implementation-plan.md).
 */
export async function storeWhatsAppToken(db: Db, agencyId: string, token: string): Promise<string> {
  const { data, error } = await db.rpc("whatsapp_store_token", { p_agency_id: agencyId, p_token: token });
  if (error) throw new Error(`Failed to store WhatsApp token in Vault: ${error.message}`);
  return data as string;
}

export async function readWhatsAppToken(db: Db, credentialRef: string): Promise<string | null> {
  const { data, error } = await db.rpc("whatsapp_read_token", { p_credential_ref: credentialRef });
  if (error) throw new Error(`Failed to read WhatsApp token from Vault: ${error.message}`);
  return (data as string | null) ?? null;
}

/**
 * Generic purpose-named secret storage (D3/D5) — Mode A needs several
 * distinct secrets per agency (the agency's own Meta app secret, a
 * generated verify token, a generated two-step PIN) beyond the single
 * access-token slot `storeWhatsAppToken` covers. Backed by
 * `whatsapp_store_secret` / `whatsapp_read_secret` / `whatsapp_delete_secret`
 * — see 20260925090000_whatsapp_connection_modes.sql §E.
 */
export type WhatsAppSecretPurpose = "app_secret" | "verify_token" | "two_step_pin";

export async function storeWhatsAppSecret(db: Db, agencyId: string, purpose: WhatsAppSecretPurpose, value: string): Promise<string> {
  const { data, error } = await db.rpc("whatsapp_store_secret", { p_agency_id: agencyId, p_purpose: purpose, p_value: value });
  if (error) throw new Error(`Failed to store WhatsApp ${purpose} in Vault: ${error.message}`);
  return data as string;
}

export async function readWhatsAppSecret(db: Db, credentialRef: string): Promise<string | null> {
  const { data, error } = await db.rpc("whatsapp_read_secret", { p_credential_ref: credentialRef });
  if (error) throw new Error(`Failed to read WhatsApp secret from Vault: ${error.message}`);
  return (data as string | null) ?? null;
}

export async function deleteWhatsAppSecret(db: Db, credentialRef: string): Promise<void> {
  const { error } = await db.rpc("whatsapp_delete_secret", { p_credential_ref: credentialRef });
  if (error) throw new Error(`Failed to delete WhatsApp secret from Vault: ${error.message}`);
}
