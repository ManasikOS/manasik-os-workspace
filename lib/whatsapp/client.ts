/**
 * Meta WhatsApp Cloud API — the outbound send path plus the handful of
 * Graph lookups the Embedded Signup flow (§6.0) needs. See
 * docs/modules/whatsapp-ai-agent-implementation-plan.md §6.2.
 *
 * Every function takes the agency's own access token directly (read from
 * Vault by the caller — see lib/whatsapp/vault.ts) rather than reaching
 * into Vault itself, so this module stays a pure HTTP client with no
 * database dependency.
 */

import "server-only";

import { graphBaseUrl, MetaGraphError, metaGraphFetch } from "@/lib/meta/graph";

// v25+ is required by Embedded Signup v4 (F6 of the connection plan); the
// fallback stays on the pre-existing default so a deployment that hasn't
// set this yet doesn't break outright, but every new call added below
// assumes v25 field/edge names.
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const GRAPH_TARGET = { host: "facebook", version: GRAPH_VERSION } as const;
const GRAPH_BASE = graphBaseUrl(GRAPH_TARGET);

export class WhatsAppSendError extends MetaGraphError {
  constructor(message: string, status: number, body: unknown) {
    super(message, status, body);
    this.name = "WhatsAppSendError";
  }
}

/**
 * The retry/backoff/error-body handling is shared with the other Meta channels (lib/meta/graph.ts);
 * this wrapper only pins the host/version and keeps `WhatsAppSendError` as the thrown type so every
 * existing `instanceof` check and `classifyWhatsAppError` keeps working.
 */
function graphFetch(
  path: string,
  token: string,
  init: RequestInit & { retries?: number } = {},
): Promise<unknown> {
  return metaGraphFetch(GRAPH_TARGET, path, token, { ...init, errorClass: WhatsAppSendError, label: "WhatsApp Graph API" });
}

export interface SendResult {
  externalMessageId: string;
}

/** Plain-text reply. Meta refuses this outside the 24h service window (F7) — check before calling. */
export async function sendText(
  phoneNumberId: string,
  token: string,
  to: string,
  body: string,
): Promise<SendResult> {
  const result = (await graphFetch(`/${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body, preview_url: false },
    }),
  })) as { messages?: Array<{ id: string }> };

  const externalMessageId = result.messages?.[0]?.id;
  if (!externalMessageId) throw new WhatsAppSendError("WhatsApp send returned no message id", 200, result);
  return { externalMessageId };
}

export interface WhatsAppMediaInput {
  kind: "image" | "document";
  /** A URL Meta can fetch. Short-lived and signed: it is handed to Meta and to nobody else. */
  link: string;
  /** WhatsApp allows 1,024 characters. The caller enforces it; this does not truncate silently. */
  caption?: string;
  /** Shown to the customer on a document. */
  filename?: string;
}

/** An image or a document, by link. Meta refuses it outside the 24h service window (F7): check before calling. */
export async function sendMedia(phoneNumberId: string, token: string, to: string, media: WhatsAppMediaInput): Promise<SendResult> {
  const object = {
    link: media.link,
    ...(media.caption ? { caption: media.caption } : {}),
    ...(media.kind === "document" && media.filename ? { filename: media.filename } : {}),
  };
  const result = (await graphFetch(`/${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: media.kind, [media.kind]: object }),
  })) as { messages?: Array<{ id: string }> };

  const externalMessageId = result.messages?.[0]?.id;
  if (!externalMessageId) throw new WhatsAppSendError("WhatsApp media send returned no message id", 200, result);
  return { externalMessageId };
}

export interface QuickReplyButton {
  /** Echoed back verbatim on `interactive.button_reply.id` when tapped — keep it a stable machine id, not display text. */
  id: string;
  /** WhatsApp caps button titles at 20 characters — truncated defensively rather than rejected. */
  title: string;
}

/**
 * Text plus up to three tappable reply buttons (e.g. "Book Now"). WhatsApp
 * has no button that dials a phone directly — a `tel:` scheme is not a valid
 * `cta_url` target on the Cloud API — so "Call Now" is not a button here.
 * Instead the agency's contact number, written in the reply body in
 * international format, is auto-linked to a dialer by every WhatsApp client
 * on its own; see `formatCallNowLine()` below.
 *
 * A tap sends an ordinary `interactive` message back with the button's id
 * and title — the webhook (see extractMessageText in the route handler)
 * folds that into the conversation as if the customer had typed the title,
 * so the SAME tool-calling loop handles a tap exactly like a typed reply.
 * No separate server-side button handler exists, or is needed.
 */
export async function sendInteractiveButtons(
  phoneNumberId: string,
  token: string,
  to: string,
  body: string,
  buttons: QuickReplyButton[],
): Promise<SendResult> {
  const result = (await graphFetch(`/${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    }),
  })) as { messages?: Array<{ id: string }> };

  const externalMessageId = result.messages?.[0]?.id;
  if (!externalMessageId) throw new WhatsAppSendError("WhatsApp interactive send returned no message id", 200, result);
  return { externalMessageId };
}

/**
 * WhatsApp auto-links a bare E.164 number in message text to the device's
 * dialer — no interactive component involved. Appended to a reply as the
 * "Call Now" affordance the plan's brief asked for.
 */
export function formatCallNowLine(displayPhoneNumber: string): string {
  const digits = displayPhoneNumber.replace(/[^\d+]/g, "");
  return `📞 Call us: ${digits.startsWith("+") ? digits : `+${digits}`}`;
}

/** Approved template send — the only outbound shape allowed outside the service window. */
export async function sendTemplate(
  phoneNumberId: string,
  token: string,
  to: string,
  input: { templateName: string; languageCode: string; components?: unknown[] },
): Promise<SendResult> {
  const result = (await graphFetch(`/${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.languageCode },
        components: input.components ?? [],
      },
    }),
  })) as { messages?: Array<{ id: string }> };

  const externalMessageId = result.messages?.[0]?.id;
  if (!externalMessageId) throw new WhatsAppSendError("WhatsApp template send returned no message id", 200, result);
  return { externalMessageId };
}

export async function markRead(phoneNumberId: string, token: string, externalMessageId: string): Promise<void> {
  await graphFetch(`/${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: externalMessageId,
    }),
  });
}

/**
 * Shows the "typing…" bubble to the customer (and marks their message read). WhatsApp keeps it up for up
 * to 25 seconds or until the next message is sent, whichever is first.
 */
export async function sendTypingIndicator(phoneNumberId: string, token: string, externalMessageId: string): Promise<void> {
  await graphFetch(`/${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: externalMessageId,
      typing_indicator: { type: "text" },
    }),
  });
}

/** Media download — Phase 10 (voice). Returns the raw bytes and MIME type Meta reports. */
export async function downloadMedia(
  token: string,
  mediaId: string,
): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const meta = (await graphFetch(`/${mediaId}`, token)) as { url?: string; mime_type?: string };
  if (!meta.url) throw new WhatsAppSendError("WhatsApp media lookup returned no URL", 200, meta);

  const response = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new WhatsAppSendError(`WhatsApp media download failed (${response.status})`, response.status, null);

  return { bytes: await response.arrayBuffer(), mimeType: meta.mime_type ?? "application/octet-stream" };
}

/** Used by Settings > Integrations "Test Connection" and after Embedded Signup completes (§6.0 step 2). */
export async function verifyConnection(
  token: string,
  phoneNumberId: string,
): Promise<{ ok: true; displayPhoneNumber: string; qualityRating: string | null; verifiedName: string | null } | { ok: false; error: string }> {
  try {
    const result = (await graphFetch(
      `/${phoneNumberId}?fields=display_phone_number,quality_rating,verified_name`,
      token,
      { method: "GET", retries: 0 },
    )) as { display_phone_number?: string; quality_rating?: string; verified_name?: string };

    if (!result.display_phone_number) {
      return { ok: false, error: "Meta returned no display phone number for this id." };
    }
    return {
      ok: true,
      displayPhoneNumber: result.display_phone_number,
      qualityRating: result.quality_rating ?? null,
      verifiedName: result.verified_name ?? null,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error verifying connection." };
  }
}

/** Subscribes our app to a WABA's events — Embedded Signup §6.0 step 4. */
export async function subscribeApp(wabaId: string, token: string): Promise<void> {
  await graphFetch(`/${wabaId}/subscribed_apps`, token, { method: "POST", body: "{}" });
}

export async function unsubscribeApp(wabaId: string, token: string): Promise<void> {
  await graphFetch(`/${wabaId}/subscribed_apps`, token, { method: "DELETE" });
}

/** Activates the phone number on the Cloud API — §6.0 step 5. Requires a two-step-verification PIN. */
export async function registerPhoneNumber(phoneNumberId: string, token: string, pin: string): Promise<void> {
  await graphFetch(`/${phoneNumberId}/register`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
}

/** Exchanges the Embedded Signup authorization code for a long-lived business token — §6.0 step 1. */
export async function exchangeCodeForToken(
  code: string,
  appId: string,
  appSecret: string,
  /** Required when the code came from a page redirect (not the JS SDK popup): must equal the redirect_uri used to get it. */
  redirectUri?: string,
): Promise<{ accessToken: string }> {
  const url =
    `${GRAPH_BASE}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}` +
    (redirectUri ? `&redirect_uri=${encodeURIComponent(redirectUri)}` : "");
  const response = await fetch(url, { method: "GET" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    throw new WhatsAppSendError("Failed to exchange Embedded Signup code for a token", response.status, body);
  }
  return { accessToken: body.access_token as string };
}

/* ─────────────────────────────────────────────────────────────────────────
 * §5 E3 of docs/modules/whatsapp-meta-connection-implementation-plan.md — the
 * additional Graph calls both connection modes need to survive contact
 * with a real tenant: token introspection, WABA/phone resolution,
 * registration completeness, templates, and cost analytics.
 * ───────────────────────────────────────────────────────────────────────── */

/** Meta error-code taxonomy (E3) — classifies a WhatsAppSendError so callers
 * never retry a dead token and always know what UI state to show. */
export type WhatsAppErrorClass =
  | "TOKEN_DEAD"
  | "OUTSIDE_SERVICE_WINDOW"
  | "NOT_REGISTERED"
  | "RATE_LIMITED"
  | "UNFUNDED"
  | "UNKNOWN";

export function classifyWhatsAppError(error: unknown): WhatsAppErrorClass {
  if (!(error instanceof WhatsAppSendError)) return "UNKNOWN";
  const code = (error.body as { error?: { code?: number } } | null)?.error?.code;
  if (code === 190 || code === 102) return "TOKEN_DEAD";
  if (code === 131047) return "OUTSIDE_SERVICE_WINDOW";
  if (code === 133010) return "NOT_REGISTERED";
  // F5/E9 — "Business Eligibility Payment Issue": the WABA's payment
  // method is missing, expired or declined. Meta's documented code for it.
  if (code === 131042) return "UNFUNDED";
  if (code === 4 || code === 80007 || error.status === 429) return "RATE_LIMITED";
  return "UNKNOWN";
}

export interface DebugTokenResult {
  appId: string | null;
  /** The Facebook user (or system user) the token belongs to. What Meta's deauthorize and data-deletion callbacks name. */
  userId: string | null;
  isValid: boolean;
  expiresAt: Date | null;
  scopes: string[];
  /** WABA ids (and other asset ids) this specific token was granted, per-permission. F7/D4. */
  granularScopes: Array<{ scope: string; targetIds: string[] }>;
}

/**
 * The source of truth for what a token can actually do (F7/D4) — never
 * trust `postMessage` data alone. Requires an app access token
 * (`{appId}|{appSecret}`, Graph's documented shape for this one endpoint)
 * to introspect someone else's user/system-user token.
 *
 * **Only reliable when `appId`/`appSecret` belong to the SAME app that
 * issued `inputToken`, or an app Meta considers related to it** (shared
 * Business Manager ownership, typically). Meta's Embedded Signup tokens
 * (Mode B) are issued by OUR platform app, so this always works there.
 * Mode A tokens are issued by the AGENCY'S OWN, unrelated Meta app —
 * calling this with our app id/secret against one of those fails outright
 * ("Failed to debug_token the WhatsApp access token"), which is expected,
 * not a bug to retry around. `connectWhatsAppOwnApp()` in
 * app/(main)/management/settings/integrations/whatsapp-actions.ts does
 * NOT call this function for exactly this reason — it verifies a Mode A
 * token by making real, permission-gated calls WITH that token instead.
 */
export async function debugToken(inputToken: string, appId: string, appSecret: string): Promise<DebugTokenResult> {
  const appAccessToken = `${appId}|${appSecret}`;
  const url = `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(inputToken)}&access_token=${encodeURIComponent(appAccessToken)}`;
  const response = await fetch(url, { method: "GET" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.data) {
    throw new WhatsAppSendError("Failed to debug_token the WhatsApp access token", response.status, body);
  }
  const data = body.data as {
    app_id?: string;
    user_id?: string;
    is_valid?: boolean;
    expires_at?: number;
    scopes?: string[];
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  };
  return {
    appId: data.app_id ?? null,
    userId: data.user_id ?? null,
    isValid: Boolean(data.is_valid),
    // Meta returns 0 for a token that never expires (system-user tokens).
    expiresAt: data.expires_at ? new Date(data.expires_at * 1000) : null,
    scopes: data.scopes ?? [],
    granularScopes: (data.granular_scopes ?? []).map((g) => ({ scope: g.scope, targetIds: g.target_ids ?? [] })),
  };
}

/** WABAs the given business portfolio has shared with our app/client — used to disambiguate when debug_token's granular scopes name more than one. */
export async function listSharedWabas(businessId: string, token: string): Promise<Array<{ id: string; name: string }>> {
  const result = (await graphFetch(
    `/${businessId}/client_whatsapp_business_accounts?fields=id,name`,
    token,
    { method: "GET", retries: 0 },
  )) as { data?: Array<{ id: string; name: string }> };
  return result.data ?? [];
}

export interface WabaDetails {
  id: string;
  name: string | null;
  timezoneId: string | null;
  currency: string | null;
  accountReviewStatus: string | null;
  businessVerificationStatus: string | null;
  messageTemplateNamespace: string | null;
}

export async function getWaba(wabaId: string, token: string): Promise<WabaDetails> {
  const result = (await graphFetch(
    `/${wabaId}?fields=id,name,timezone_id,currency,account_review_status,business_verification_status,message_template_namespace`,
    token,
    { method: "GET", retries: 0 },
  )) as {
    id: string;
    name?: string;
    timezone_id?: string;
    currency?: string;
    account_review_status?: string;
    business_verification_status?: string;
    message_template_namespace?: string;
  };
  return {
    id: result.id,
    name: result.name ?? null,
    timezoneId: result.timezone_id ?? null,
    currency: result.currency ?? null,
    accountReviewStatus: result.account_review_status ?? null,
    businessVerificationStatus: result.business_verification_status ?? null,
    messageTemplateNamespace: result.message_template_namespace ?? null,
  };
}

export interface WabaPhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  /** Present when this number is (or was) live on the WhatsApp Business *app* — F9's migration case. */
  platformType: string | null;
  /** True when the number is also live in the WhatsApp Business app (coexistence). It is already registered; never register it again. */
  isOnBusinessApp: boolean;
  throughputLevel: string | null;
}

export async function listPhoneNumbers(wabaId: string, token: string): Promise<WabaPhoneNumber[]> {
  const result = (await graphFetch(
    `/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,is_on_biz_app,throughput`,
    token,
    { method: "GET", retries: 0 },
  )) as {
    data?: Array<{
      id: string;
      display_phone_number: string;
      verified_name?: string;
      quality_rating?: string;
      code_verification_status?: string;
      platform_type?: string;
      is_on_biz_app?: boolean;
      throughput?: { level?: string };
    }>;
  };
  return (result.data ?? []).map((p) => ({
    id: p.id,
    displayPhoneNumber: p.display_phone_number,
    verifiedName: p.verified_name ?? null,
    qualityRating: p.quality_rating ?? null,
    codeVerificationStatus: p.code_verification_status ?? null,
    platformType: p.platform_type ?? null,
    isOnBusinessApp: p.is_on_biz_app === true,
    throughputLevel: p.throughput?.level ?? null,
  }));
}

/** Sets (or resets) the two-step-verification PIN on an already-registered number — distinct from the PIN passed to registerPhoneNumber on first registration. D5. */
export async function setTwoStepPin(phoneNumberId: string, token: string, pin: string): Promise<void> {
  await graphFetch(`/${phoneNumberId}`, token, {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

/** Readback confirmation that our app is (still) subscribed to a WABA's webhook events — used right after subscribeApp() and by the health cron (E6) to catch silent revocation. */
export async function listSubscribedApps(wabaId: string, token: string): Promise<Array<{ whatsappBusinessApiDataId?: string }>> {
  const result = (await graphFetch(`/${wabaId}/subscribed_apps`, token, { method: "GET", retries: 0 })) as {
    data?: Array<{ whatsapp_business_api_data?: { id?: string } }>;
  };
  return (result.data ?? []).map((d) => ({ whatsappBusinessApiDataId: d.whatsapp_business_api_data?.id }));
}

export interface BusinessProfile {
  about: string | null;
  address: string | null;
  description: string | null;
  email: string | null;
  websites: string[];
  profilePictureUrl: string | null;
}

export async function getBusinessProfile(phoneNumberId: string, token: string): Promise<BusinessProfile> {
  const result = (await graphFetch(
    `/${phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,websites,profile_picture_url`,
    token,
    { method: "GET", retries: 0 },
  )) as { data?: Array<Record<string, unknown>> };
  const p = result.data?.[0] ?? {};
  return {
    about: (p.about as string) ?? null,
    address: (p.address as string) ?? null,
    description: (p.description as string) ?? null,
    email: (p.email as string) ?? null,
    websites: (p.websites as string[]) ?? [],
    profilePictureUrl: (p.profile_picture_url as string) ?? null,
  };
}

export async function updateBusinessProfile(
  phoneNumberId: string,
  token: string,
  patch: Partial<{ about: string; address: string; description: string; email: string; websites: string[] }>,
): Promise<void> {
  await graphFetch(`/${phoneNumberId}/whatsapp_business_profile`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", ...patch }),
  });
}

/* ── Message templates (E8) ──────────────────────────────────────────────── */

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
  rejected_reason?: string;
}

export async function listTemplates(wabaId: string, token: string): Promise<WhatsAppTemplate[]> {
  const result = (await graphFetch(
    `/${wabaId}/message_templates?fields=id,name,language,category,status,components,rejected_reason&limit=100`,
    token,
    { method: "GET", retries: 0 },
  )) as { data?: WhatsAppTemplate[] };
  return result.data ?? [];
}

export async function createTemplate(
  wabaId: string,
  token: string,
  input: { name: string; language: string; category: "MARKETING" | "UTILITY" | "AUTHENTICATION"; components: unknown[] },
): Promise<{ id: string; status: string }> {
  const result = (await graphFetch(`/${wabaId}/message_templates`, token, {
    method: "POST",
    body: JSON.stringify(input),
  })) as { id: string; status: string };
  return result;
}

export async function deleteTemplate(wabaId: string, token: string, name: string): Promise<void> {
  await graphFetch(`/${wabaId}/message_templates?name=${encodeURIComponent(name)}`, token, { method: "DELETE" });
}

/* ── Analytics (E10) — field expansions on the WABA node, not separate
 * edges. Timestamps are UNIX seconds. See F14 of the connection plan. ── */

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function clampToOneYear(startUnix: number): number {
  const floor = Math.floor(Date.now() / 1000) - ONE_YEAR_SECONDS;
  return Math.max(startUnix, floor);
}

/**
 * `pricing_analytics` buckets report `start`/`end` as unix seconds for
 * intraday granularities, but as `YYYY-MM-DD` strings for `DAILY`/`MONTHLY`
 * — undocumented, found by a production sync throwing "Invalid time value"
 * the first time this ran against a real WABA. Accepts either.
 */
export function toUnixSeconds(value: number | string, field: "start" | "end"): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(parsed)) {
    throw new Error(`pricing_analytics bucket has an unparseable "${field}" value: ${JSON.stringify(value)}`);
  }
  return Math.floor(parsed / 1000);
}

export interface PricingAnalyticsBucket {
  start: number;
  end: number;
  cost: number;
  volume: number;
  country: string | null;
  phoneNumber: string | null;
  pricingCategory: string | null;
  pricingType: string | null;
  tier: string | null;
  currency: string | null;
}

/**
 * `GET /{waba-id}?fields=pricing_analytics.start(…).end(…).granularity(…)…`
 * — a field expansion, not an edge. Requires `whatsapp_business_management`.
 * Costs are Meta's own and approximate (F14) — never treat this as the
 * invoice; it is the closest available estimate of it.
 */
export async function getPricingAnalytics(
  wabaId: string,
  token: string,
  params: {
    startUnix: number;
    endUnix: number;
    granularity: "HALF_HOUR" | "DAILY" | "MONTHLY";
    metricTypes?: Array<"COST" | "VOLUME">;
    pricingCategories?: string[];
    pricingTypes?: string[];
    dimensions?: string[];
    phoneNumbers?: string[];
    countryCodes?: string[];
  },
): Promise<PricingAnalyticsBucket[]> {
  const start = clampToOneYear(params.startUnix);
  const field = [
    "pricing_analytics",
    `.start(${start})`,
    `.end(${params.endUnix})`,
    `.granularity(${params.granularity})`,
    params.metricTypes ? `.metric_types([${params.metricTypes.map((m) => `"${m}"`).join(",")}])` : "",
    params.pricingCategories ? `.pricing_categories([${params.pricingCategories.map((c) => `"${c}"`).join(",")}])` : "",
    params.pricingTypes ? `.pricing_types([${params.pricingTypes.map((t) => `"${t}"`).join(",")}])` : "",
    params.dimensions ? `.dimensions([${params.dimensions.map((d) => `"${d}"`).join(",")}])` : "",
    params.phoneNumbers ? `.phone_numbers([${params.phoneNumbers.map((p) => `"${p}"`).join(",")}])` : "",
    params.countryCodes ? `.country_codes([${params.countryCodes.map((c) => `"${c}"`).join(",")}])` : "",
  ].join("");

  const result = (await graphFetch(`/${wabaId}?fields=${encodeURIComponent(field)}`, token, {
    method: "GET",
    retries: 1,
  })) as {
    pricing_analytics?: {
      data?: Array<{
        start: number | string;
        end: number | string;
        cost?: { value?: number; currency?: string };
        volume?: number;
        dimensions?: { country?: string; phone_number?: string; pricing_category?: string; pricing_type?: string; tier?: string };
      }>;
    };
  };

  return (result.pricing_analytics?.data ?? []).map((row) => ({
    start: toUnixSeconds(row.start, "start"),
    end: toUnixSeconds(row.end, "end"),
    cost: row.cost?.value ?? 0,
    volume: row.volume ?? 0,
    country: row.dimensions?.country ?? null,
    phoneNumber: row.dimensions?.phone_number ?? null,
    pricingCategory: row.dimensions?.pricing_category ?? null,
    pricingType: row.dimensions?.pricing_type ?? null,
    tier: row.dimensions?.tier ?? null,
    currency: row.cost?.currency ?? null,
  }));
}
