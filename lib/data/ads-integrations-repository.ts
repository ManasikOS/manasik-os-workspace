/**
 * Meta Ads / Google Ads connection lifecycle — mirrors
 * `lib/data/whatsapp-connection-repository.ts` exactly: every function here
 * takes the service-role admin client (Vault RPCs are revoked from every
 * other role) and filters on `agency_id` explicitly. See
 * `supabase/migrations/20261029090000_campaigns_ad_platform_integrations.sql`.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { GoogleAdsIntegrationRow, MetaAdsIntegrationRow } from "@/lib/types/ads-integrations";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A Supabase/PostgREST error is a plain `{ message, details, hint, code }`
 * object, not an `Error` instance — `String(cause)` on it yields the
 * useless "[object Object]", which is exactly what made this class's own
 * errors undiagnosable in practice. Pull `.message` (and `.code`, when
 * present — e.g. `42P01` for "relation does not exist", the signature of a
 * migration that hasn't been applied yet) before falling back to `String`.
 */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause) {
    const { message, code } = cause as { message: unknown; code?: unknown };
    return code ? `${String(message)} (code ${String(code)})` : String(message);
  }
  return String(cause);
}

export class AdsIntegrationError extends Error {
  constructor(table: string, op: string, cause: unknown) {
    super(`ads_integration.${table}.${op} failed: ${describeCause(cause)}`);
    this.name = "AdsIntegrationError";
  }
}

/** Masks all but the last 4 characters, for the connect card's credential_hint — never the token itself. */
export function maskCredentialTail(token: string): string {
  return `…${token.slice(-4)}`;
}

/* ── Meta Ads ─────────────────────────────────────────────────────────── */

export async function getMetaAdsIntegration(db: Db, agencyId: string): Promise<MetaAdsIntegrationRow | null> {
  const { data, error } = await db.from("meta_ads_integrations").select("*").eq("agency_id", agencyId).maybeSingle();
  if (error) throw new AdsIntegrationError("meta_ads_integrations", "select", error);
  return (data as MetaAdsIntegrationRow | null) ?? null;
}

export interface UpsertMetaAdsConnectionInput {
  agencyId: string;
  adAccountId: string;
  adAccountName: string | null;
  businessId: string | null;
  credentialRef: string;
  credentialHint: string;
  tokenExpiresAt: string | null;
  tokenScopes: string[];
  connectedBy: string | null;
  connectedByName: string | null;
}

export async function upsertMetaAdsConnection(db: Db, input: UpsertMetaAdsConnectionInput): Promise<void> {
  const { error } = await db.from("meta_ads_integrations").upsert(
    {
      agency_id: input.agencyId,
      ad_account_id: input.adAccountId,
      ad_account_name: input.adAccountName,
      business_id: input.businessId,
      credential_ref: input.credentialRef,
      credential_hint: input.credentialHint,
      token_expires_at: input.tokenExpiresAt,
      token_scopes: input.tokenScopes,
      status: "CONNECTED",
      last_error: null,
      connected_by: input.connectedBy,
      connected_by_name: input.connectedByName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "agency_id" },
  );
  if (error) throw new AdsIntegrationError("meta_ads_integrations", "upsert", error);
}

export async function markMetaAdsError(db: Db, agencyId: string, message: string): Promise<void> {
  const { error } = await db
    .from("meta_ads_integrations")
    .update({ status: "ERROR", last_error: message, updated_at: new Date().toISOString() })
    .eq("agency_id", agencyId);
  if (error) throw new AdsIntegrationError("meta_ads_integrations", "update", error);
}

export async function markMetaAdsSynced(db: Db, agencyId: string): Promise<void> {
  const { error } = await db
    .from("meta_ads_integrations")
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq("agency_id", agencyId);
  if (error) throw new AdsIntegrationError("meta_ads_integrations", "update", error);
}

export async function disconnectMetaAds(db: Db, agencyId: string): Promise<void> {
  const { error } = await db
    .from("meta_ads_integrations")
    .update({
      status: "DISCONNECTED",
      credential_ref: null,
      credential_hint: null,
      token_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("agency_id", agencyId);
  if (error) throw new AdsIntegrationError("meta_ads_integrations", "update", error);
}

/* ── Google Ads ───────────────────────────────────────────────────────── */

export async function getGoogleAdsIntegration(db: Db, agencyId: string): Promise<GoogleAdsIntegrationRow | null> {
  const { data, error } = await db.from("google_ads_integrations").select("*").eq("agency_id", agencyId).maybeSingle();
  if (error) throw new AdsIntegrationError("google_ads_integrations", "select", error);
  return (data as GoogleAdsIntegrationRow | null) ?? null;
}

export interface UpsertGoogleAdsConnectionInput {
  agencyId: string;
  customerId: string;
  loginCustomerId: string | null;
  accountName: string | null;
  credentialRef: string;
  credentialHint: string;
  tokenScopes: string[];
  connectedBy: string | null;
  connectedByName: string | null;
}

export async function upsertGoogleAdsConnection(db: Db, input: UpsertGoogleAdsConnectionInput): Promise<void> {
  const { error } = await db.from("google_ads_integrations").upsert(
    {
      agency_id: input.agencyId,
      customer_id: input.customerId,
      login_customer_id: input.loginCustomerId,
      account_name: input.accountName,
      credential_ref: input.credentialRef,
      credential_hint: input.credentialHint,
      token_scopes: input.tokenScopes,
      status: "CONNECTED",
      last_error: null,
      connected_by: input.connectedBy,
      connected_by_name: input.connectedByName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "agency_id" },
  );
  if (error) throw new AdsIntegrationError("google_ads_integrations", "upsert", error);
}

export async function markGoogleAdsError(db: Db, agencyId: string, message: string): Promise<void> {
  const { error } = await db
    .from("google_ads_integrations")
    .update({ status: "ERROR", last_error: message, updated_at: new Date().toISOString() })
    .eq("agency_id", agencyId);
  if (error) throw new AdsIntegrationError("google_ads_integrations", "update", error);
}

export async function markGoogleAdsSynced(db: Db, agencyId: string): Promise<void> {
  const { error } = await db
    .from("google_ads_integrations")
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq("agency_id", agencyId);
  if (error) throw new AdsIntegrationError("google_ads_integrations", "update", error);
}

export async function disconnectGoogleAds(db: Db, agencyId: string): Promise<void> {
  const { error } = await db
    .from("google_ads_integrations")
    .update({ status: "DISCONNECTED", credential_ref: null, credential_hint: null, updated_at: new Date().toISOString() })
    .eq("agency_id", agencyId);
  if (error) throw new AdsIntegrationError("google_ads_integrations", "update", error);
}
