/**
 * Starts the Instagram Login connect (no Facebook Page): sets a short-lived state cookie for CSRF protection and
 * sends the browser to Instagram's own login. The agency signs in with the Instagram account they want to
 * connect, approves messaging access, and comes back to /api/oauth/instagram-login/callback.
 * See lib/channels/instagram/login/oauth.ts and docs/tasks/TASK-006-instagram-login-connection.md.
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import {
  buildInstagramBusinessLoginUrl,
  INSTAGRAM_LOGIN_STATE_COOKIE,
  INSTAGRAM_LOGIN_STATE_PREFIX,
  instagramLoginRedirectUri,
} from "@/lib/channels/instagram/login/oauth";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { getSiteUrl } from "@/lib/site-url";

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

  const appId = process.env.INSTAGRAM_APP_ID?.trim();
  if (!appId || !process.env.INSTAGRAM_APP_SECRET?.trim()) {
    return backToIntegrations(origin, `Instagram connect is not configured on this deployment (${!appId ? "INSTAGRAM_APP_ID" : "INSTAGRAM_APP_SECRET"} is missing).`);
  }

  const state = `${INSTAGRAM_LOGIN_STATE_PREFIX}${randomBytes(24).toString("base64url")}`;
  const cookieStore = await cookies();
  cookieStore.set(INSTAGRAM_LOGIN_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  return NextResponse.redirect(buildInstagramBusinessLoginUrl({ appId, redirectUri: instagramLoginRedirectUri(origin), state }));
}
