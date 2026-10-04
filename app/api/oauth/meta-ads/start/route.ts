/**
 * Starts the Meta Ads OAuth flow: sets a short-lived state cookie for CSRF
 * protection, then 302-redirects to Meta's authorization dialog. The
 * connect card links here rather than straight to Meta so the state value
 * is generated and stored server-side — a plain `<a href>` to Meta's own
 * URL couldn't set a cookie first.
 *
 * Requires sign-in (requireUser redirects to /login otherwise) — this route
 * itself does not check the `editIntegrations` capability because a denied
 * user is still allowed to start the OAuth handshake; the callback (which
 * actually persists a connection) re-checks it via `completeMetaAdsConnection`,
 * same "the UI hiding a button is never the security boundary" posture as
 * every other Settings action in this codebase.
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildMetaAdsAuthorizeUrl } from "@/lib/ads/meta-client";
import { requireUser } from "@/lib/dal";
import { getSiteUrl } from "@/lib/site-url";

export const STATE_COOKIE = "meta_ads_oauth_state";

/** NEXT_PUBLIC_SITE_URL when set, otherwise this request's own origin (never a hard-coded localhost). */
async function siteOrigin(): Promise<string> {
  return getSiteUrl();
}

export async function GET() {
  await requireUser();

  const appId = process.env.META_ADS_APP_ID;
  if (!appId) {
    return NextResponse.redirect(
      `${await siteOrigin()}/management/settings/integrations?meta_ads=error&message=${encodeURIComponent("META_ADS_APP_ID is not configured on this deployment.")}`,
    );
  }

  const state = randomBytes(24).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const authorizeUrl = buildMetaAdsAuthorizeUrl({
    appId,
    redirectUri: `${await siteOrigin()}/api/oauth/meta-ads/callback`,
    state,
  });
  return NextResponse.redirect(authorizeUrl);
}
