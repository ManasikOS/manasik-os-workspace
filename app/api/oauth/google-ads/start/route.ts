/**
 * Starts the Google Ads OAuth flow — same state-cookie CSRF pattern as
 * `/api/oauth/meta-ads/start`, see that file's doc comment for the
 * reasoning.
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildGoogleAdsAuthorizeUrl } from "@/lib/ads/google-client";
import { requireUser } from "@/lib/dal";
import { getSiteUrl } from "@/lib/site-url";

export const STATE_COOKIE = "google_ads_oauth_state";

/** NEXT_PUBLIC_SITE_URL when set, otherwise this request's own origin (never a hard-coded localhost). */
async function siteOrigin(): Promise<string> {
  return getSiteUrl();
}

export async function GET() {
  await requireUser();

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      `${await siteOrigin()}/management/settings/integrations?google_ads=error&message=${encodeURIComponent("GOOGLE_ADS_CLIENT_ID is not configured on this deployment.")}`,
    );
  }

  const state = randomBytes(24).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const authorizeUrl = buildGoogleAdsAuthorizeUrl({
    clientId,
    redirectUri: `${await siteOrigin()}/api/oauth/google-ads/callback`,
    state,
  });
  return NextResponse.redirect(authorizeUrl);
}
