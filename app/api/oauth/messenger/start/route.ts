/**
 * Starts Messenger connect as a page redirect (no Facebook JS SDK): sets a short-lived state cookie for CSRF
 * protection and sends the browser to Facebook Login for Business with our Messenger configuration. See
 * lib/channels/messenger/oauth-redirect.ts.
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { buildMessengerLoginUrl, MESSENGER_OAUTH_STATE_COOKIE, MESSENGER_OAUTH_STATE_PREFIX } from "@/lib/channels/messenger/oauth-redirect";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { getSiteUrl } from "@/lib/site-url";
import { signupRedirectUri } from "@/lib/whatsapp/embedded-signup-redirect";

const INTEGRATIONS_PATH = "/management/settings/integrations";

function backToIntegrations(origin: string, message: string) {
  return NextResponse.redirect(`${origin}${INTEGRATIONS_PATH}?messenger=error&message=${encodeURIComponent(message)}`);
}

export async function GET() {
  await requireUser();
  const origin = await getSiteUrl();

  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) {
    return backToIntegrations(origin, "Your role cannot connect Messenger.");
  }

  const appId = process.env.META_APP_ID?.trim();
  const configId = process.env.META_MESSENGER_CONFIG_ID?.trim();
  if (!appId || !configId) {
    return backToIntegrations(origin, `Messenger connect is not configured on this deployment (${!appId ? "META_APP_ID" : "META_MESSENGER_CONFIG_ID"} is missing).`);
  }

  const state = `${MESSENGER_OAUTH_STATE_PREFIX}${randomBytes(24).toString("base64url")}`;
  const cookieStore = await cookies();
  cookieStore.set(MESSENGER_OAUTH_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  return NextResponse.redirect(
    buildMessengerLoginUrl({
      appId,
      configId,
      redirectUri: signupRedirectUri(origin),
      state,
      graphVersion: process.env.META_GRAPH_VERSION?.trim() || "v25.0",
    }),
  );
}
