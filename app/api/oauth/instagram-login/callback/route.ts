/**
 * Where Instagram Login lands after the agency approves (or cancels). Checks the state cookie set by
 * /api/oauth/instagram-login/start, validates the query, hands the single-use authorization code to
 * `connectInstagramWithLogin`, and returns to the Integrations screen with the result. The redirect URI must equal
 * the one registered on the Instagram product exactly: see lib/channels/instagram/login/oauth.ts.
 */

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { connectInstagramWithLogin } from "@/app/(main)/management/settings/integrations/instagram-actions";
import { INSTAGRAM_LOGIN_STATE_COOKIE } from "@/lib/channels/instagram/login/oauth";
import { requireUser } from "@/lib/dal";
import { secureSecretEquals } from "@/lib/security/secure-compare";
import { getSiteUrl } from "@/lib/site-url";
import { connectorRedirect } from "@/lib/setup/setup-return-server";
import { parseInstagramLoginCallback } from "@/lib/validations/instagram-login";

const INTEGRATIONS_PATH = "/management/settings/integrations";

async function backToIntegrations(status: "connected" | "error", message: string) {
  const origin = await getSiteUrl();
  return connectorRedirect({
    provider: "instagram",
    status,
    message,
    legacyUrl: `${origin}${INTEGRATIONS_PATH}?instagram=${status}&message=${encodeURIComponent(message)}`,
  });
}

export async function GET(request: NextRequest) {
  await requireUser();

  // The cookie is read and removed before anything else, so a state can never be replayed.
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(INSTAGRAM_LOGIN_STATE_COOKIE)?.value;
  cookieStore.delete(INSTAGRAM_LOGIN_STATE_COOKIE);

  const parsed = parseInstagramLoginCallback(request.nextUrl.searchParams);
  if (!parsed.success) {
    return backToIntegrations("error", "The connection request could not be verified. Please click Connect with Instagram again.");
  }
  const { code, state, error, error_description: errorDescription } = parsed.data;

  if (error) {
    return backToIntegrations("error", errorDescription || "The Instagram connection was cancelled or did not complete.");
  }
  if (!code || !state || !expectedState || !secureSecretEquals(state, expectedState)) {
    return backToIntegrations("error", "The connection request could not be verified. Please click Connect with Instagram again.");
  }

  const result = await connectInstagramWithLogin({ code });
  return backToIntegrations(result.ok ? "connected" : "error", result.ok ? `Connected: ${result.accountLabel}` : result.error);
}
