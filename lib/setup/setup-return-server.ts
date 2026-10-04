import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getSiteUrl } from "@/lib/site-url";

import type { ConnectorId } from "./connector-availability";
import { recordOnboardingEvent } from "./setup-events-server";
import {
  SETUP_RETURN_COOKIE,
  SETUP_RETURN_TTL_SECONDS,
  createSetupReturnToken,
  resolveConnectorReturnUrl,
  verifySetupReturnToken,
} from "./setup-return";

/** Platform secret that signs the return cookie. Unset means the feature quietly stays off. */
function setupReturnSecret(): string {
  return process.env.SETUP_RETURN_SECRET?.trim() || process.env.META_APP_SECRET?.trim() || "";
}

/**
 * Marks the connector round-trip that is about to start as coming from setup.
 * Returns false (and sets nothing) when there is no signed-in user or no
 * signing secret — the callback then behaves exactly as it does from Settings.
 */
export async function beginSetupReturn(provider: ConnectorId): Promise<boolean> {
  const secret = setupReturnSecret();
  const user = await getSessionUser();
  if (!secret || !user) return false;

  (await cookies()).set(SETUP_RETURN_COOKIE, createSetupReturnToken({ userId: user.id, provider, secret }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SETUP_RETURN_TTL_SECONDS,
    path: "/",
  });
  return true;
}

/**
 * The single exit for every OAuth callback. Sends the owner back to /setup when
 * this round-trip was started from setup and has finished (connected or failed),
 * otherwise to `legacyUrl` — the Settings redirect the callback always used.
 *
 * The return cookie is consumed on every callback so a stale one can never
 * redirect a later connect. "choose" (pick one of several accounts) always goes
 * to Settings, where that picker lives.
 */
export async function connectorRedirect(input: {
  provider: ConnectorId;
  status: "connected" | "error" | "choose";
  message: string;
  legacyUrl: string;
}): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SETUP_RETURN_COOKIE)?.value;
  if (token) cookieStore.delete(SETUP_RETURN_COOKIE);

  if (token && input.status !== "choose") {
    const user = await getSessionUser();
    const secret = setupReturnSecret();
    if (user && verifySetupReturnToken(token, { userId: user.id, provider: input.provider, secret })) {
      const { agencyId } = await getCurrentStaffRole();
      if (agencyId) {
        await recordOnboardingEvent({
          agencyId,
          event: input.status === "connected" ? "CONNECTOR_SUCCEEDED" : "CONNECTOR_FAILED",
          connector: input.provider,
        });
        if (input.status === "connected") await recordOnboardingEvent({ agencyId, event: "STEP_COMPLETED", step: "channels" });
      }
      return NextResponse.redirect(
        resolveConnectorReturnUrl({
          origin: await getSiteUrl(),
          provider: input.provider,
          status: input.status,
          message: input.message,
        }),
      );
    }
  }

  return NextResponse.redirect(input.legacyUrl);
}
