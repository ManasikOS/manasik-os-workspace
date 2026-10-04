/**
 * Where Instagram's Facebook Login for Business lands after the agency finishes (via the root-path redirect rule
 * in next.config.ts). Checks the state cookie set by /api/oauth/instagram/start, hands the authorization code to
 * `connectInstagram`, and returns to the Integrations screen with the result.
 */

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { connectInstagram } from "@/app/(main)/management/settings/integrations/instagram-actions";
import { INSTAGRAM_OAUTH_STATE_COOKIE, INSTAGRAM_PENDING_TOKEN_COOKIE } from "@/lib/channels/instagram/oauth-redirect";
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
    provider: "instagram",
    status,
    message,
    legacyUrl: `${origin}${INTEGRATIONS_PATH}?instagram=${status}&message=${encodeURIComponent(message)}`,
  });
}

export async function GET(request: NextRequest) {
  await requireUser();

  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(INSTAGRAM_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(INSTAGRAM_OAUTH_STATE_COOKIE);

  if (params.get("error")) {
    return backToIntegrations("error", params.get("error_description") || "The Instagram connection was cancelled or did not complete.");
  }
  const code = params.get("code");
  if (!code || !expectedState || params.get("state") !== expectedState) {
    return backToIntegrations("error", "The connection request could not be verified. Please click Connect with Instagram again.");
  }

  const result = await connectInstagram({ code, redirectUri: signupRedirectUri(await getSiteUrl()) });

  if (!result.ok && result.pendingRef) {
    // The login shared several Instagram accounts: the Integrations screen asks which one to connect.
    const { agencyId } = await getCurrentStaffRole();
    if (!agencyId) return backToIntegrations("error", "No agency resolved for your account.");
    cookieStore.set(INSTAGRAM_PENDING_TOKEN_COOKIE, sealPendingRef(result.pendingRef, agencyId, process.env.META_APP_SECRET ?? ""), { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
    return backToIntegrations("choose", result.error);
  }
  return backToIntegrations(result.ok ? "connected" : "error", result.ok ? `Connected: ${result.accountLabel}` : result.error);
}
