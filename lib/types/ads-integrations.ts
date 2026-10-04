/**
 * Row types for Meta Ads / Google Ads connections.
 *
 * Keep in sync with
 * `supabase/migrations/20261029090000_campaigns_ad_platform_integrations.sql`.
 */

export type AdsIntegrationStatus = "NOT_CONNECTED" | "CONNECTED" | "ERROR" | "DISCONNECTED";

export interface MetaAdsIntegrationRow {
  id: string;
  agency_id: string;
  ad_account_id: string | null;
  ad_account_name: string | null;
  business_id: string | null;
  credential_ref: string | null;
  credential_hint: string | null;
  token_expires_at: string | null;
  token_scopes: string[];
  status: AdsIntegrationStatus;
  last_error: string | null;
  last_synced_at: string | null;
  connected_by: string | null;
  connected_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleAdsIntegrationRow {
  id: string;
  agency_id: string;
  customer_id: string | null;
  login_customer_id: string | null;
  account_name: string | null;
  credential_ref: string | null;
  credential_hint: string | null;
  token_scopes: string[];
  status: AdsIntegrationStatus;
  last_error: string | null;
  last_synced_at: string | null;
  connected_by: string | null;
  connected_by_name: string | null;
  created_at: string;
  updated_at: string;
}
