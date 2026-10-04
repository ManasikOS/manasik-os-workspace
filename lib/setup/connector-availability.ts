/**
 * Which connectors this deployment can offer, decided from the platform
 * credentials in its environment (docs/onboarding/plan.md D10). Shared by the
 * Integrations settings page and the guided setup so both agree — a deployment
 * missing a connector's platform credentials shows an honest "not available yet"
 * instead of a broken button.
 *
 * Agencies never see these values: only the booleans (and, for WhatsApp, the
 * two ids that already travel in the OAuth URL) leave the server.
 */

export type ConnectorId = "whatsapp" | "messenger" | "instagram" | "meta_ads" | "google_ads";

export interface ConnectorAvailability {
  whatsapp: boolean;
  messenger: boolean;
  /** Instagram sign-in with Instagram itself (its own app id and secret). */
  instagram: boolean;
  /** The older route to Instagram through a Facebook Page; a secondary option. */
  instagramPageFlow: boolean;
  metaAds: boolean;
  googleAds: boolean;
  /** Custom SMTP needs nothing from the platform environment. */
  email: true;
  whatsappAppId: string | null;
  whatsappConfigId: string | null;
}

/**
 * Env vars pasted into a dashboard (Vercel's included) sometimes pick up a
 * stray leading/trailing space or a pair of quote characters the person
 * copying the value didn't mean to include — invisible in most UIs, but
 * `FB.init({ version: '"v25.0"' })` throws "invalid version specified" for
 * exactly that reason, and a malformed app id/config id fails just as
 * silently. Trims whitespace and one layer of matching quotes; returns
 * null for an empty/unset value so callers' own `?? fallback` still works.
 */
export function cleanEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const unquoted = trimmed.replace(/^['"](.*)['"]$/, "$1").trim();
  return unquoted || null;
}

export function resolveConnectorAvailability(env: Record<string, string | undefined>): ConnectorAvailability {
  const has = (key: string) => cleanEnvValue(env[key]) !== null;

  const metaAppId = cleanEnvValue(env.META_APP_ID);
  const whatsappConfigId = cleanEnvValue(env.META_CONFIG_ID);

  return {
    whatsapp: metaAppId !== null && whatsappConfigId !== null,
    // Each Meta channel has its own Login configuration: it connects only when
    // the app id and THAT channel's configuration id are set.
    messenger: metaAppId !== null && has("META_MESSENGER_CONFIG_ID"),
    instagram: has("INSTAGRAM_APP_ID") && has("INSTAGRAM_APP_SECRET"),
    instagramPageFlow: metaAppId !== null && has("META_INSTAGRAM_CONFIG_ID"),
    metaAds: has("META_ADS_APP_ID"),
    googleAds: has("GOOGLE_ADS_CLIENT_ID") && has("GOOGLE_ADS_DEVELOPER_TOKEN"),
    email: true,
    whatsappAppId: metaAppId,
    whatsappConfigId,
  };
}
