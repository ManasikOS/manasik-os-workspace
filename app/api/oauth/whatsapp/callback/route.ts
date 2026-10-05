/**
 * Where Meta's Embedded Signup lands after the customer finishes (via the root-path redirect rule in
 * next.config.ts). Checks the state cookie set by /api/oauth/whatsapp/start, then hands the authorization code
 * to `connectWhatsApp` (the same server-side exchange the SDK flow used) and returns to the Integrations screen
 * with the result.
 */

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { connectWhatsApp } from "@/app/(main)/management/settings/integrations/whatsapp-actions";
import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { sealPendingRef } from "@/lib/channels/pending-token-cookie";
import { secureSecretEquals } from "@/lib/security/secure-compare";
import { getSiteUrl } from "@/lib/site-url";
import { hasOAuthProviderError, oauthProviderErrorMessage } from "@/lib/setup/oauth-callback-error";
import { connectorRedirect } from "@/lib/setup/setup-return-server";
import {
  signupRedirectUri,
  WHATSAPP_OAUTH_STATE_COOKIE,
  WHATSAPP_PENDING_TOKEN_COOKIE,
} from "@/lib/whatsapp/embedded-signup-redirect";

const INTEGRATIONS_PATH = "/management/settings/integrations";

async function backToIntegrations(status: "connected" | "error" | "choose", message: string) {
  const origin = await getSiteUrl();
  return connectorRedirect({
    provider: "whatsapp",
    status,
    message,
    legacyUrl: `${origin}${INTEGRATIONS_PATH}?whatsapp=${status}&message=${encodeURIComponent(message)}`,
  });
}

export async function GET(request: NextRequest) {
  await requireUser();

  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(WHATSAPP_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(WHATSAPP_OAUTH_STATE_COOKIE);

  if (hasOAuthProviderError({ error: params.get("error"), description: params.get("error_description") })) {
    // The description is written by whoever built the callback URL, so it goes to the log and a fixed sentence goes to the screen (SEC-10).
    return backToIntegrations("error", oauthProviderErrorMessage({ provider: "WhatsApp", error: params.get("error"), description: params.get("error_description") }));
  }
  const code = params.get("code");
  if (!code || code.length > 2048 || !secureSecretEquals(params.get("state"), expectedState)) {
    return backToIntegrations("error", "The connection request could not be verified. Please click Connect with Meta again.");
  }

  const result = await connectWhatsApp({ code, redirectUri: signupRedirectUri(await getSiteUrl()) });

  if (!result.ok && result.pendingRef) {
    // The signup granted several WhatsApp accounts: the Integrations screen asks which one to connect.
    const { agencyId } = await getCurrentStaffRole();
    if (!agencyId) return backToIntegrations("error", "No agency resolved for your account.");
    cookieStore.set(WHATSAPP_PENDING_TOKEN_COOKIE, sealPendingRef(result.pendingRef, agencyId, process.env.META_APP_SECRET ?? ""), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 900,
      path: "/",
    });
    return backToIntegrations("choose", result.error);
  }
  return backToIntegrations(result.ok ? "connected" : "error", result.ok ? `Connected: ${result.displayPhoneNumber}` : result.error);
}
