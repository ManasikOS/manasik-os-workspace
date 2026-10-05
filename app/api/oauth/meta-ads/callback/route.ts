/**
 * Meta Ads OAuth callback. Validates the state cookie set by
 * `/api/oauth/meta-ads/start`, then hands the authorization code to
 * `completeMetaAdsConnection` (app/(main)/management/settings/integrations/ads-actions.ts)
 * for the actual token exchange + persistence — this route is deliberately
 * thin, same split as the WhatsApp connection's Server Action vs Route
 * Handler boundary.
 */

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { completeMetaAdsConnection } from "@/app/(main)/management/settings/integrations/ads-actions";

import { getSiteUrl } from "@/lib/site-url";
import { hasOAuthProviderError, oauthProviderErrorMessage } from "@/lib/setup/oauth-callback-error";
import { connectorRedirect } from "@/lib/setup/setup-return-server";

import { STATE_COOKIE } from "../start/route";

/** NEXT_PUBLIC_SITE_URL when set, otherwise this request's own origin (never a hard-coded localhost). */
async function siteOrigin(): Promise<string> {
  return getSiteUrl();
}

async function redirectWithResult(status: "connected" | "error", message?: string) {
  const url = new URL("/management/settings/integrations", await siteOrigin());
  url.searchParams.set("meta_ads", status);
  if (message) url.searchParams.set("message", message);
  return connectorRedirect({ provider: "meta_ads", status, message: message ?? "", legacyUrl: url.toString() });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const providerError = request.nextUrl.searchParams.get("error");
  const providerErrorDescription = request.nextUrl.searchParams.get("error_description");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  // The description is written by whoever built the callback URL, so it goes to the log and a fixed sentence goes to the screen (SEC-10).
  if (hasOAuthProviderError({ error: providerError, description: providerErrorDescription })) {
    return await redirectWithResult("error", oauthProviderErrorMessage({ provider: "Meta Ads", error: providerError, description: providerErrorDescription }));
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return await redirectWithResult("error", "The connection request could not be verified — please try connecting again.");
  }

  const result = await completeMetaAdsConnection({ code, redirectUri: `${await siteOrigin()}/api/oauth/meta-ads/callback` });
  if (!result.ok) return await redirectWithResult("error", result.error);
  return await redirectWithResult("connected");
}
