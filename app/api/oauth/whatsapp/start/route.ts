/**
 * Starts WhatsApp Embedded Signup as a page redirect (no Facebook JS SDK): sets a short-lived state cookie for
 * CSRF protection and sends the browser to Meta's login dialog with our Embedded Signup configuration. See
 * lib/whatsapp/embedded-signup-redirect.ts for why this replaces the SDK popup.
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { getSiteUrl } from "@/lib/site-url";
import {
  buildEmbeddedSignupUrl,
  signupRedirectUri,
  WHATSAPP_OAUTH_STATE_COOKIE,
  WHATSAPP_OAUTH_STATE_PREFIX,
} from "@/lib/whatsapp/embedded-signup-redirect";

const INTEGRATIONS_PATH = "/management/settings/integrations";

function backToIntegrations(origin: string, message: string) {
  return NextResponse.redirect(`${origin}${INTEGRATIONS_PATH}?whatsapp=error&message=${encodeURIComponent(message)}`);
}

export async function GET() {
  await requireUser();
  const origin = await getSiteUrl();

  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) {
    return backToIntegrations(origin, "Your role cannot connect WhatsApp.");
  }

  const appId = process.env.META_APP_ID?.trim();
  const configId = process.env.META_CONFIG_ID?.trim();
  if (!appId || !configId) {
    return backToIntegrations(origin, `WhatsApp connect is not configured on this deployment (${!appId ? "META_APP_ID" : "META_CONFIG_ID"} is missing).`);
  }

  const state = `${WHATSAPP_OAUTH_STATE_PREFIX}${randomBytes(24).toString("base64url")}`;
  const cookieStore = await cookies();
  cookieStore.set(WHATSAPP_OAUTH_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  return NextResponse.redirect(
    buildEmbeddedSignupUrl({
      appId,
      configId,
      redirectUri: signupRedirectUri(origin),
      state,
      graphVersion: process.env.META_GRAPH_VERSION?.trim() || "v25.0",
      // On by default; set WHATSAPP_COEXISTENCE=false to offer only new numbers.
      coexistence: process.env.WHATSAPP_COEXISTENCE?.trim() !== "false",
    }),
  );
}
