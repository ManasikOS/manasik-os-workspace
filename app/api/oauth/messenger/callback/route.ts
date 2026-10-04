/**
 * Where Facebook Login for Business lands after the agency finishes (via the root-path redirect rule in
 * next.config.ts). Checks the state cookie set by /api/oauth/messenger/start, hands the authorization code to
 * `connectMessenger`, and returns to the Integrations screen with the result.
 */

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { connectMessenger } from "@/app/(main)/management/settings/integrations/messenger-actions";
import { MESSENGER_OAUTH_STATE_COOKIE, MESSENGER_PENDING_TOKEN_COOKIE } from "@/lib/channels/messenger/oauth-redirect";
import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { sealPendingRef } from "@/lib/channels/pending-token-cookie";
import { getSiteUrl } from "@/lib/site-url";
import { connectorRedirect } from "@/lib/setup/setup-return-server";
import { signupRedirectUri } from "@/lib/whatsapp/embedded-signup-redirect";

const INTEGRATIONS_PATH = "/management/settings/integrations";

async function backToIntegrations(status: "connected" | "error" | "choose", message: string) {
  const origin = await getSiteUrl();
  return connectorRedirect({
    provider: "messenger",
    status,
    message,
    legacyUrl: `${origin}${INTEGRATIONS_PATH}?messenger=${status}&message=${encodeURIComponent(message)}`,
  });
}

export async function GET(request: NextRequest) {
  await requireUser();

  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(MESSENGER_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(MESSENGER_OAUTH_STATE_COOKIE);

  if (params.get("error")) {
    return backToIntegrations("error", params.get("error_description") || "The Messenger connection was cancelled or did not complete.");
  }
  const code = params.get("code");
  if (!code || !expectedState || params.get("state") !== expectedState) {
    return backToIntegrations("error", "The connection request could not be verified. Please click Connect with Facebook again.");
  }

  const result = await connectMessenger({ code, redirectUri: signupRedirectUri(await getSiteUrl()) });

  if (!result.ok && result.pendingRef) {
    // The login shared several Pages: the Integrations screen asks which one to connect.
    const { agencyId } = await getCurrentStaffRole();
    if (!agencyId) return backToIntegrations("error", "No agency resolved for your account.");
    cookieStore.set(MESSENGER_PENDING_TOKEN_COOKIE, sealPendingRef(result.pendingRef, agencyId, process.env.META_APP_SECRET ?? ""), { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
    return backToIntegrations("choose", result.error);
  }
  return backToIntegrations(result.ok ? "connected" : "error", result.ok ? `Connected: ${result.pageName}` : result.error);
}
