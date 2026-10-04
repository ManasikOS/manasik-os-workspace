/**
 * Starts Instagram connect as a page redirect (no Facebook JS SDK): sets a short-lived state cookie for CSRF
 * protection and sends the browser to Facebook Login for Business with our Instagram configuration. See
 * lib/channels/instagram/oauth-redirect.ts.
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { buildInstagramLoginUrl, INSTAGRAM_OAUTH_STATE_COOKIE, INSTAGRAM_OAUTH_STATE_PREFIX } from "@/lib/channels/instagram/oauth-redirect";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { getSiteUrl } from "@/lib/site-url";
import { signupRedirectUri } from "@/lib/whatsapp/embedded-signup-redirect";

const INTEGRATIONS_PATH = "/management/settings/integrations";

function backToIntegrations(origin: string, message: string) {
  return NextResponse.redirect(`${origin}${INTEGRATIONS_PATH}?instagram=error&message=${encodeURIComponent(message)}`);
}

export async function GET() {
  await requireUser();
  const origin = await getSiteUrl();

  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) {
    return backToIntegrations(origin, "Your role cannot connect Instagram.");
  }

  const appId = process.env.META_APP_ID?.trim();
  const configId = process.env.META_INSTAGRAM_CONFIG_ID?.trim();
  if (!appId || !configId) {
    return backToIntegrations(origin, `Instagram connect is not configured on this deployment (${!appId ? "META_APP_ID" : "META_INSTAGRAM_CONFIG_ID"} is missing).`);
  }

  const state = `${INSTAGRAM_OAUTH_STATE_PREFIX}${randomBytes(24).toString("base64url")}`;
  const cookieStore = await cookies();
  cookieStore.set(INSTAGRAM_OAUTH_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  return NextResponse.redirect(
    buildInstagramLoginUrl({
      appId,
      configId,
      redirectUri: signupRedirectUri(origin),
      state,
      graphVersion: process.env.META_GRAPH_VERSION?.trim() || "v25.0",
    }),
  );
}
