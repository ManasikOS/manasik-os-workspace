/**
 * Minimal Google Ads API client — OAuth exchange and campaign-level spend
 * metrics via GAQL. No SDK dependency, plain `fetch`, server-only.
 *
 * Requires `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` (a Google
 * Cloud OAuth client) and `GOOGLE_ADS_DEVELOPER_TOKEN` (issued by Google
 * once the agency's Google Ads manager account is approved for API access
 * — this approval step is entirely outside this codebase) — see
 * .env.example. Nothing here works until those are set; this module is the
 * client the OAuth/sync actions call once it is.
 *
 * Google's OAuth issues a short-lived access token AND a long-lived refresh
 * token in one exchange (with `access_type=offline`); every API call in
 * this file expects an already-fresh access token — refreshing it is the
 * caller's job via `refreshGoogleAdsAccessToken`, same as any other OAuth
 * client credential rotation.
 */

import "server-only";

const OAUTH_BASE = "https://oauth2.googleapis.com";
const ADS_API_BASE = "https://googleads.googleapis.com";
const API_VERSION = "v17";

export class GoogleAdsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "GoogleAdsError";
  }
}

export function buildGoogleAdsAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  // offline + consent so Google always returns a refresh token, even on a
  // re-connect where the agency previously granted access.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/adwords");
  return url.toString();
}

export async function exchangeGoogleAdsCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const response = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.refresh_token) {
    throw new GoogleAdsError(
      body?.error_description ?? "Google did not return a refresh token — was access_type=offline granted?",
      response.status,
      body,
    );
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in };
}

export async function refreshGoogleAdsAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    throw new GoogleAdsError(body?.error_description ?? "Failed to refresh Google Ads access token", response.status, body);
  }
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

function adsHeaders(accessToken: string, developerToken: string, loginCustomerId: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId.replace(/-/g, "");
  return headers;
}

export interface GoogleAdsCustomerOption {
  customerId: string;
  descriptiveName: string | null;
}

/** Accessible customer resource names (`customers/1234567890`), then resolved to a name via a GAQL query. */
export async function listAccessibleCustomers(accessToken: string, developerToken: string): Promise<GoogleAdsCustomerOption[]> {
  const response = await fetch(`${ADS_API_BASE}/${API_VERSION}/customers:listAccessibleCustomers`, {
    headers: adsHeaders(accessToken, developerToken, null),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new GoogleAdsError(body?.error?.message ?? `Google Ads API returned HTTP ${response.status}`, response.status, body);
  }
  const resourceNames = (body?.resourceNames ?? []) as string[];
  return resourceNames.map((name) => ({ customerId: name.replace("customers/", ""), descriptiveName: null }));
}

export interface GoogleAdsCampaignOption {
  id: string;
  name: string;
  status: string;
}

/** Campaigns on one customer account, for the "link to an external campaign" picker. */
export async function listCustomerCampaigns(input: {
  accessToken: string;
  developerToken: string;
  customerId: string;
  loginCustomerId: string | null;
}): Promise<GoogleAdsCampaignOption[]> {
  const query = `SELECT campaign.id, campaign.name, campaign.status FROM campaign ORDER BY campaign.id`;
  const response = await fetch(`${ADS_API_BASE}/${API_VERSION}/customers/${input.customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: adsHeaders(input.accessToken, input.developerToken, input.loginCustomerId),
    body: JSON.stringify({ query }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body) ? body[0]?.error?.message : body?.error?.message;
    throw new GoogleAdsError(message ?? `Google Ads API returned HTTP ${response.status}`, response.status, body);
  }

  const batches = (Array.isArray(body) ? body : [body]) as { results?: unknown[] }[];
  const campaigns: GoogleAdsCampaignOption[] = [];
  for (const batch of batches) {
    for (const result of batch.results ?? []) {
      const r = result as { campaign?: { id?: string; name?: string; status?: string } };
      if (!r.campaign?.id) continue;
      campaigns.push({ id: r.campaign.id, name: r.campaign.name ?? r.campaign.id, status: r.campaign.status ?? "UNKNOWN" });
    }
  }
  return campaigns;
}

export interface GoogleAdsDailyMetric {
  date: string; // YYYY-MM-DD
  costMicros: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

/**
 * Daily spend/impressions/clicks/conversions for one Google Ads campaign,
 * via `searchStream` + GAQL — read-only, never touches budget or bidding,
 * per the "AI/automation layer must not spend money" rule in
 * docs/modules/campaigns-command-center-implementation-plan.md. `cost_micros` is
 * Google's native unit (1,000,000 micros = 1 unit of account currency);
 * callers divide by 1e6 before treating it as money.
 */
export async function fetchCampaignDailyMetrics(input: {
  accessToken: string;
  developerToken: string;
  customerId: string;
  loginCustomerId: string | null;
  campaignId: string;
  since: string;
  until: string;
}): Promise<GoogleAdsDailyMetric[]> {
  const query = `
    SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign
    WHERE campaign.id = ${input.campaignId}
      AND segments.date BETWEEN '${input.since}' AND '${input.until}'
  `.trim();

  const response = await fetch(`${ADS_API_BASE}/${API_VERSION}/customers/${input.customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: adsHeaders(input.accessToken, input.developerToken, input.loginCustomerId),
    body: JSON.stringify({ query }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body) ? body[0]?.error?.message : body?.error?.message;
    throw new GoogleAdsError(message ?? `Google Ads API returned HTTP ${response.status}`, response.status, body);
  }

  // searchStream returns an array of batches, each with a `results` array.
  const batches = (Array.isArray(body) ? body : [body]) as { results?: unknown[] }[];
  const rows: GoogleAdsDailyMetric[] = [];
  for (const batch of batches) {
    for (const result of batch.results ?? []) {
      const r = result as {
        segments?: { date?: string };
        metrics?: { costMicros?: string; impressions?: string; clicks?: string; conversions?: number };
      };
      if (!r.segments?.date) continue;
      rows.push({
        date: r.segments.date,
        costMicros: Number(r.metrics?.costMicros ?? 0),
        impressions: Number(r.metrics?.impressions ?? 0),
        clicks: Number(r.metrics?.clicks ?? 0),
        conversions: Number(r.metrics?.conversions ?? 0),
      });
    }
  }
  return rows;
}
