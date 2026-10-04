/**
 * Minimal Meta Marketing API client — OAuth exchange, ad-account listing,
 * and campaign-level spend/conversion insights. No SDK dependency, same
 * posture as `lib/whatsapp/client.ts`: plain `fetch` calls against the
 * Graph API, server-only.
 *
 * Requires `META_ADS_APP_ID` / `META_ADS_APP_SECRET` (a Meta app with the
 * `ads_read` permission, approved by Meta for this business) — see
 * .env.example. Nothing here works until those are set and the app is
 * approved; this module is the client the OAuth/sync actions call once it
 * is. Deliberately reuses `META_GRAPH_VERSION` (already used by the
 * WhatsApp connection) rather than a second graph-version env var — it is
 * the same Graph API.
 */

import "server-only";

const GRAPH_BASE = "https://graph.facebook.com";
const DEFAULT_GRAPH_VERSION = "v25.0";

export class MetaAdsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "MetaAdsError";
  }
}

function graphVersion(): string {
  return process.env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
}

export function buildMetaAdsAuthorizeUrl(input: { appId: string; redirectUri: string; state: string }): string {
  const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  // ads_management would allow writes (pause/budget changes) — this
  // integration only ever reads spend/conversions, per the plan's rule that
  // the AI/automation layer here never spends money or changes a budget.
  url.searchParams.set("scope", "ads_read,business_management");
  url.searchParams.set("response_type", "code");
  return url.toString();
}

async function graphFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${graphVersion()}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url.toString(), { method: "GET", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new MetaAdsError(error instanceof Error ? error.message : "Network error contacting Meta");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message ?? `Meta returned HTTP ${response.status}`;
    throw new MetaAdsError(message, response.status, body);
  }
  return body as T;
}

/** Step 1 of the exchange — the short-lived token the authorization code trades for. */
export async function exchangeMetaAdsCode(input: {
  code: string;
  appId: string;
  appSecret: string;
  redirectUri: string;
}): Promise<{ accessToken: string; expiresIn: number | null }> {
  const data = await graphFetch<{ access_token: string; token_type: string; expires_in?: number }>("/oauth/access_token", {
    client_id: input.appId,
    client_secret: input.appSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? null };
}

/** Step 2 — trades the short-lived token for a long-lived one (~60 days), same as the WhatsApp connection does. */
export async function exchangeForLongLivedToken(input: {
  shortLivedToken: string;
  appId: string;
  appSecret: string;
}): Promise<{ accessToken: string; expiresIn: number | null }> {
  const data = await graphFetch<{ access_token: string; token_type: string; expires_in?: number }>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: input.appId,
    client_secret: input.appSecret,
    fb_exchange_token: input.shortLivedToken,
  });
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? null };
}

export interface MetaAdAccountOption {
  id: string; // "act_<id>"
  name: string;
  currency: string;
}

export async function listAdAccounts(accessToken: string): Promise<MetaAdAccountOption[]> {
  const data = await graphFetch<{ data: { id: string; name: string; currency: string }[] }>("/me/adaccounts", {
    access_token: accessToken,
    fields: "id,name,currency",
    limit: "200",
  });
  return data.data ?? [];
}

export interface MetaCampaignOption {
  id: string;
  name: string;
  status: string;
}

export async function listAdAccountCampaigns(accessToken: string, adAccountId: string): Promise<MetaCampaignOption[]> {
  const data = await graphFetch<{ data: MetaCampaignOption[] }>(`/${adAccountId}/campaigns`, {
    access_token: accessToken,
    fields: "id,name,status",
    limit: "200",
  });
  return data.data ?? [];
}

export interface MetaDailyInsight {
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  /** Sum of "lead"/"onsite_conversion.lead_grouped" actions when present — a rough proxy, not a guarantee of what Meta calls a "result". */
  leads: number;
}

/**
 * Daily spend/impressions/clicks/leads for one Meta campaign, for a date
 * range. Read-only — this never touches budget, targeting or delivery, per
 * the "AI/automation layer must not spend money" rule in
 * docs/modules/campaigns-command-center-implementation-plan.md.
 */
export async function fetchCampaignDailyInsights(
  accessToken: string,
  campaignId: string,
  since: string,
  until: string,
): Promise<MetaDailyInsight[]> {
  const data = await graphFetch<{
    data: { date_start: string; spend: string; impressions: string; clicks: string; actions?: { action_type: string; value: string }[] }[];
  }>(`/${campaignId}/insights`, {
    access_token: accessToken,
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    fields: "date_start,spend,impressions,clicks,actions",
    level: "campaign",
  });

  return (data.data ?? []).map((row) => {
    const leadAction = row.actions?.find((a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
    return {
      date: row.date_start,
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      leads: leadAction ? Number(leadAction.value) : 0,
    };
  });
}

/** A lightweight token check, mirroring `debugToken()` in the WhatsApp client — confirms the token is alive before trusting it. */
export async function debugMetaAdsToken(accessToken: string, appId: string, appSecret: string): Promise<{ valid: boolean; expiresAt: string | null; scopes: string[] }> {
  const data = await graphFetch<{ data: { is_valid: boolean; expires_at: number; scopes?: string[] } }>("/debug_token", {
    input_token: accessToken,
    access_token: `${appId}|${appSecret}`,
  });
  return {
    valid: data.data.is_valid,
    expiresAt: data.data.expires_at ? new Date(data.data.expires_at * 1000).toISOString() : null,
    scopes: data.data.scopes ?? [],
  };
}
