/**
 * WhatsApp token/connection health — daily. See §5 E6 of
 * docs/modules/whatsapp-meta-connection-implementation-plan.md.
 *
 * D6 — token expiry is a scheduled concern, not a discovery. Two different
 * checks depending on `connection_mode`, because `debug_token` only works
 * when the checking app and the token's own app are the same (or related):
 *
 *  - EMBEDDED_SIGNUP (Mode B): the token is issued by OUR platform app, so
 *    `debug_token` with our own app id/secret works and is the source of
 *    truth for expiry/scopes.
 *  - OWN_APP_TOKEN (Mode A): the token belongs to the AGENCY'S own,
 *    unrelated Meta app — `debug_token` fails outright for this case (see
 *    the doc comment on `debugToken()` in lib/whatsapp/client.ts), so
 *    health here means making a real, permission-gated call WITH the
 *    agency's own token (`listSubscribedApps`) and reading TOKEN_DEAD off
 *    a thrown error via `classifyWhatsAppError`, exactly like the send
 *    paths do. No expiry date is available for this mode — most classic
 *    system-user tokens don't expire, and revocation is what this check
 *    (and every send attempt) actually catches.
 *
 * `listSubscribedApps` also catches silent revocation for BOTH modes (an
 * agency removing our app from Business Manager doesn't always fire
 * `account_update` reliably), and `listPhoneNumbers` refreshes
 * quality/throughput for both. A dead token found by a failed customer
 * message is a support ticket; found here it's a notification, raised at
 * T-7 days from expiry for the mode that has an expiry at all.
 *
 * Same auth posture as the other cron routes: `Authorization: Bearer
 * $CRON_SECRET`, reachable without a session via proxy.ts's MACHINE_ROUTES.
 */

import { hasValidBearerSecret } from "@/lib/security/secure-compare";
import { NextResponse, type NextRequest } from "next/server";

import { recordConnectionEvent, listActiveIntegrations } from "@/lib/data/whatsapp-connection-repository";
import { classifyWhatsAppError, debugToken, listPhoneNumbers, listSubscribedApps } from "@/lib/whatsapp/client";
import { readWhatsAppToken } from "@/lib/whatsapp/vault";
import { createAdminClient } from "@/utils/supabase/admin";
import type { WhatsAppIntegrationRow } from "@/lib/types/whatsapp";

const CRON_SECRET = process.env.CRON_SECRET;
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const EXPIRY_WARNING_DAYS = 7;

type Db = ReturnType<typeof createAdminClient>;

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (!hasValidBearerSecret(authHeader, CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const integrations = await listActiveIntegrations(admin);

  let checked = 0;
  let flagged = 0;
  let expiringSoon = 0;

  for (const integration of integrations) {
    if (!integration.credential_ref) continue;
    checked++;

    try {
      const token = await readWhatsAppToken(admin, integration.credential_ref);
      if (!token) throw new Error("Vault returned no token for this credential_ref");

      const result =
        integration.connection_mode === "EMBEDDED_SIGNUP"
          ? await checkEmbeddedSignupHealth(admin, integration, token)
          : await checkOwnAppHealth(admin, integration, token);

      if (result.flagged) flagged++;
      if (result.expiringSoon) expiringSoon++;
    } catch (error) {
      flagged++;
      await recordConnectionEvent(admin, {
        agencyId: integration.agency_id,
        integrationId: integration.id,
        kind: "HEALTH_CHECK_FAILED",
        detail: { error: error instanceof Error ? error.message : String(error) },
      }).catch(() => undefined);
    }
  }

  return NextResponse.json({ checked, flagged, expiringSoon }, { status: 200 });
}

interface HealthResult {
  flagged: boolean;
  expiringSoon: boolean;
}

/** Mode B — the token is ours to introspect; debug_token is the source of truth. */
async function checkEmbeddedSignupHealth(admin: Db, integration: WhatsAppIntegrationRow, token: string): Promise<HealthResult> {
  if (!META_APP_ID || !META_APP_SECRET) {
    // Only Mode B needs these; a deployment missing them just can't refresh
    // Mode B expiry today — Mode A health (below) is unaffected.
    return { flagged: false, expiringSoon: false };
  }

  const debug = await debugToken(token, META_APP_ID, META_APP_SECRET);
  const patch: Record<string, unknown> = {
    token_expires_at: debug.expiresAt?.toISOString() ?? null,
    token_scopes: debug.scopes,
  };
  let flagged = false;
  let expiringSoon = false;

  if (!debug.isValid) {
    patch.status = "ERROR";
    patch.last_error = "The stored WhatsApp access token is no longer valid (debug_token reports invalid).";
    flagged = true;
    await recordConnectionEvent(admin, { agencyId: integration.agency_id, integrationId: integration.id, kind: "HEALTH_TOKEN_INVALID" });
  } else {
    const subResult = await refreshSubscriptionAndQuality(admin, integration, token);
    flagged = subResult.flagged;
  }

  if (debug.expiresAt) {
    const daysLeft = (debug.expiresAt.getTime() - Date.now()) / 86_400_000;
    if (daysLeft > 0 && daysLeft <= EXPIRY_WARNING_DAYS) {
      expiringSoon = true;
      await recordConnectionEvent(admin, {
        agencyId: integration.agency_id,
        integrationId: integration.id,
        kind: "TOKEN_EXPIRING_SOON",
        detail: { daysLeft: Math.floor(daysLeft) },
      });
    }
  }

  await admin.from("whatsapp_integrations").update(patch).eq("id", integration.id);
  return { flagged, expiringSoon };
}

/**
 * Mode A — no debug_token (see the file-level comment). Health here is
 * `listSubscribedApps` succeeding at all: it needs a live token with
 * whatsapp_business_management, so a thrown, TOKEN_DEAD-classified error
 * from it is exactly the same signal debug_token's `is_valid: false` would
 * have given, obtained a different way. No expiry to report — Mode A
 * tokens don't carry one this app can read. Delegates entirely to
 * `refreshSubscriptionAndQuality`, which does this same dead-token check
 * for Mode B too (a harmless, useful second signal alongside debug_token).
 */
async function checkOwnAppHealth(admin: Db, integration: WhatsAppIntegrationRow, token: string): Promise<HealthResult> {
  const result = await refreshSubscriptionAndQuality(admin, integration, token);
  return { flagged: result.flagged, expiringSoon: false };
}

/**
 * Shared by both modes: one `listSubscribedApps` call does double duty —
 * a TOKEN_DEAD-classified failure means the token itself is gone, an empty
 * result means the token is fine but the WABA was unsubscribed (agency
 * revoked access without necessarily invalidating the token) — then
 * `listPhoneNumbers` refreshes quality/throughput regardless.
 */
async function refreshSubscriptionAndQuality(admin: Db, integration: WhatsAppIntegrationRow, token: string): Promise<{ flagged: boolean }> {
  if (!integration.business_account_id) return { flagged: false };

  let flagged = false;
  const patch: Record<string, unknown> = {};

  try {
    const subs = await listSubscribedApps(integration.business_account_id, token);
    if (subs.length === 0) {
      patch.status = "ERROR";
      patch.last_error = "This app is no longer subscribed to the WABA's webhook events — the agency may have revoked access.";
      flagged = true;
      await recordConnectionEvent(admin, { agencyId: integration.agency_id, integrationId: integration.id, kind: "HEALTH_UNSUBSCRIBED" });
    }
  } catch (error) {
    if (classifyWhatsAppError(error) === "TOKEN_DEAD") {
      patch.status = "ERROR";
      patch.last_error = "The stored WhatsApp access token is no longer valid.";
      flagged = true;
      await recordConnectionEvent(admin, { agencyId: integration.agency_id, integrationId: integration.id, kind: "HEALTH_TOKEN_INVALID" });
    }
    // Anything else (rate limit, transient network) is ambiguous — don't
    // flag the integration on this alone.
  }

  if (integration.phone_number_id) {
    const numbers = await listPhoneNumbers(integration.business_account_id, token).catch(() => []);
    const mine = numbers.find((n) => n.id === integration.phone_number_id);
    if (mine) {
      if (mine.qualityRating) patch.quality_rating = mine.qualityRating;
      if (mine.throughputLevel) patch.messaging_limit_tier = mine.throughputLevel;
    }
  }

  if (Object.keys(patch).length > 0) {
    await admin.from("whatsapp_integrations").update(patch).eq("id", integration.id);
  }
  return { flagged };
}
