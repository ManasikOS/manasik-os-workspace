/**
 * Starts a connector round-trip from the guided setup. Marks it as coming from
 * setup (a short-lived signed cookie), then hands off to the connector's own
 * start route. The OAuth callback reads the mark and returns to /setup.
 * A deployment that cannot offer the connector never reaches the provider.
 */

import { NextResponse, type NextRequest } from "next/server";

import { capabilitiesForSetup } from "@/lib/access/setup-access";
import { getSessionUser } from "@/lib/dal";
import { recordOnboardingEvent } from "@/lib/setup/setup-events-server";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getSiteUrl } from "@/lib/site-url";
import { resolveConnectorAvailability, type ConnectorId } from "@/lib/setup/connector-availability";
import { beginSetupReturn } from "@/lib/setup/setup-return-server";

/** Each setup connector and the existing route that starts its OAuth flow. */
const START_PATHS: Record<ConnectorId, string> = {
  whatsapp: "/api/oauth/whatsapp/start",
  messenger: "/api/oauth/messenger/start",
  instagram: "/api/oauth/instagram-login/start",
  meta_ads: "/api/oauth/meta-ads/start",
  google_ads: "/api/oauth/google-ads/start",
};

const AVAILABILITY_KEY: Record<ConnectorId, "whatsapp" | "messenger" | "instagram" | "metaAds" | "googleAds"> = {
  whatsapp: "whatsapp",
  messenger: "messenger",
  instagram: "instagram",
  meta_ads: "metaAds",
  google_ads: "googleAds",
};

export async function GET(_request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const origin = await getSiteUrl();
  const [user, { role, agencyId }] = await Promise.all([getSessionUser(), getCurrentStaffRole()]);

  if (!user) return NextResponse.redirect(`${origin}/login`);
  if (!capabilitiesForSetup(role).editSetup) return NextResponse.redirect(`${origin}/dashboard`);

  const { provider } = await context.params;
  if (!Object.hasOwn(START_PATHS, provider)) return NextResponse.redirect(`${origin}/setup?step=channels`);
  const connector = provider as ConnectorId;

  const availability = resolveConnectorAvailability(process.env);
  if (!availability[AVAILABILITY_KEY[connector]]) return NextResponse.redirect(`${origin}/setup?step=channels`);

  const marked = await beginSetupReturn(connector);
  if (marked && agencyId) await recordOnboardingEvent({ agencyId, event: "CONNECTOR_STARTED", connector });
  return NextResponse.redirect(`${origin}${START_PATHS[connector]}`);
}
