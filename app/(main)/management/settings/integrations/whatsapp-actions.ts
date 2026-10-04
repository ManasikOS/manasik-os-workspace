"use server";

/**
 * The server-side half of WhatsApp connection: Meta Embedded Signup only (§5 E4 of
 * docs/modules/whatsapp-meta-connection-implementation-plan.md). The customer signs in to Meta, chooses their
 * WhatsApp Business Account and number, and Meta returns an authorization `code` (see
 * app/api/oauth/whatsapp/callback). Every Graph call and our app secret stay on the server.
 *
 * Every action re-checks `capabilitiesForSettings(role).editIntegrations`: the UI hiding a button is never the
 * security boundary.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import {
  generateConnectionKey,
  recordConnectionEvent,
} from "@/lib/data/whatsapp-connection-repository";
import {
  classifyWhatsAppError,
  debugToken,
  exchangeCodeForToken,
  getWaba,
  listPhoneNumbers,
  unsubscribeApp,
  verifyConnection,
  WhatsAppSendError,
} from "@/lib/whatsapp/client";
import { finishWhatsAppConnection, type WhatsAppConnectResult } from "@/lib/whatsapp/connect";
import { openPendingRef } from "@/lib/channels/pending-token-cookie";
import { WHATSAPP_PENDING_TOKEN_COOKIE } from "@/lib/whatsapp/embedded-signup-redirect";
import { deleteWhatsAppSecret, readWhatsAppToken, storeWhatsAppToken } from "@/lib/whatsapp/vault";
import { createAdminClient } from "@/utils/supabase/admin";

const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;

export type ConnectResult = WhatsAppConnectResult;

/** One WhatsApp Business Account granted by a signup, with its numbers, for the "which one?" picker. */
export interface WhatsAppChoice {
  wabaId: string;
  wabaName: string | null;
  numbers: Array<{ id: string; displayPhoneNumber: string; verifiedName: string | null; isMetaTestNumber: boolean }>;
}

/** Meta's sandbox numbers start +1 555; they cannot receive messages from ordinary WhatsApp users. */
function isMetaTestNumber(displayPhoneNumber: string): boolean {
  return displayPhoneNumber.replace(/[^\d]/g, "").startsWith("1555");
}

/* ─────────────────────────────────────────────────────────────────────────
 * Embedded Signup v4. §5 E4.
 *
 * F7/D4 — postMessage's waba_id/phone_number_id are a UX hint, never the
 * source of truth: debug_token on the exchanged token is what actually
 * confirms which WABA/assets Meta granted. A `hint` from the popup only
 * disambiguates when the token's granular scopes name more than one WABA
 * (a business with several) — it never substitutes for the check.
 * ───────────────────────────────────────────────────────────────────────── */

export async function connectWhatsApp(input: {
  code: string;
  /** Set when the code came from the redirect flow; Meta requires the same redirect_uri at exchange time. */
  redirectUri?: string;
  wabaId?: string; // hint only — F7/D4
  phoneNumberId?: string; // hint only — F7/D4
}): Promise<ConnectResult> {
  await requireUser();
  const { role, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };
  if (!META_APP_ID || !META_APP_SECRET) {
    return { ok: false, error: "META_APP_ID / META_APP_SECRET are not configured for this deployment." };
  }

  const admin = createAdminClient();

  try {
    // 1. Exchange the authorization code for a business system-user token.
    // F6 — the code expires in ~30 seconds; this is the very first thing
    // the server does with it.
    const { accessToken } = await exchangeCodeForToken(input.code, META_APP_ID, META_APP_SECRET, input.redirectUri);

    // 2. debug_token — resolve the WABA from what Meta actually granted,
    // never from the popup's postMessage alone (F7/D4).
    const debug = await debugToken(accessToken, META_APP_ID, META_APP_SECRET);
    if (!debug.isValid) return { ok: false, error: "Meta reports the Embedded Signup token is not valid." };

    // The WABA ids Meta granted this token. Normally under whatsapp_business_management; some configurations
    // (Tech Provider / hosted) list them under whatsapp_business_messaging instead, so look at both.
    const wabaScopes = debug.granularScopes.filter(
      (g) => g.scope === "whatsapp_business_management" || g.scope === "whatsapp_business_messaging",
    );
    const candidates = [...new Set(wabaScopes.flatMap((g) => g.targetIds))];
    let wabaId = input.wabaId && candidates.includes(input.wabaId) ? input.wabaId : null;
    if (!wabaId) wabaId = candidates.length === 1 ? candidates[0] : (input.wabaId ?? null);
    if (!wabaId) {
      // Say exactly what Meta did grant, so a wrong configuration shows up in the message instead of a guess.
      const granted =
        debug.granularScopes.length > 0
          ? debug.granularScopes.map((g) => `${g.scope} (${g.targetIds.length} account${g.targetIds.length === 1 ? "" : "s"})`).join(", ")
          : `no per-account permissions; general permissions: ${debug.scopes.join(", ") || "none"}`;
      console.error("WhatsApp signup: no WABA in the token. Granted:", granted);
      if (candidates.length > 1) {
        const pendingRef = await storeWhatsAppToken(admin, agencyId, accessToken);
        return { ok: false, error: "This signup gave access to more than one WhatsApp account. Choose the one to connect.", pendingRef };
      }
      return {
        ok: false,
        error: `Meta did not attach a WhatsApp Business Account to this signup. Granted: ${granted}. Check that the sign-up configuration includes the WhatsApp Business Account asset, or use the standard sign-up configuration.`,
      };
    }

    if (candidates.length > 1 && !(input.wabaId && candidates.includes(input.wabaId))) {
      // Several WhatsApp accounts were granted (an agency with more than one). Park the token in Vault and let the
      // agency choose in the Integrations screen; the code is single-use, so it cannot be re-exchanged later.
      const pendingRef = await storeWhatsAppToken(admin, agencyId, accessToken);
      return { ok: false, error: "This signup gave access to more than one WhatsApp account. Choose the one to connect.", pendingRef };
    }

    return await finishWhatsAppConnection(
      admin,
      { agencyId, staffId, name },
      {
        accessToken,
        wabaId,
        phoneNumberId: input.phoneNumberId,
        expiresAt: debug.expiresAt,
        scopes: debug.scopes,
      },
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to connect WhatsApp." };
  }
}

async function pendingTokenFromCookie(admin: ReturnType<typeof createAdminClient>, agencyId: string) {
  // The cookie is sealed to the agency that started the signup: a forged or another agency's cookie opens to nothing.
  const ref = openPendingRef((await cookies()).get(WHATSAPP_PENDING_TOKEN_COOKIE)?.value, agencyId, process.env.META_APP_SECRET);
  if (!ref) return null;
  const token = await readWhatsAppToken(admin, ref);
  return token ? { ref, token } : null;
}

async function grantedWabaIds(accessToken: string): Promise<{ ids: string[]; expiresAt: Date | null; scopes: string[] }> {
  const debug = await debugToken(accessToken, META_APP_ID ?? "", META_APP_SECRET ?? "");
  const ids = [
    ...new Set(
      debug.granularScopes
        .filter((g) => g.scope === "whatsapp_business_management" || g.scope === "whatsapp_business_messaging")
        .flatMap((g) => g.targetIds),
    ),
  ];
  return { ids: debug.isValid ? ids : [], expiresAt: debug.expiresAt, scopes: debug.scopes };
}

/** The WhatsApp accounts (and their numbers) a signup granted, for the picker. Empty when no signup is waiting. */
export async function getWhatsAppChoices(): Promise<WhatsAppChoice[]> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations || !agencyId) return [];

  const admin = createAdminClient();
  const pending = await pendingTokenFromCookie(admin, agencyId).catch(() => null);
  if (!pending) return [];

  const { ids } = await grantedWabaIds(pending.token);
  return await Promise.all(
    ids.map(async (wabaId) => {
      const [waba, numbers] = await Promise.all([
        getWaba(wabaId, pending.token).catch(() => null),
        listPhoneNumbers(wabaId, pending.token).catch(() => []),
      ]);
      return {
        wabaId,
        wabaName: waba?.name ?? null,
        numbers: numbers.map((n) => ({
          id: n.id,
          displayPhoneNumber: n.displayPhoneNumber,
          verifiedName: n.verifiedName,
          isMetaTestNumber: isMetaTestNumber(n.displayPhoneNumber),
        })),
      };
    }),
  );
}

/** Finishes a signup that granted several accounts, for the one the agency picked. */
export async function chooseWhatsAppAccount(input: { wabaId: string; phoneNumberId?: string }): Promise<ConnectResult> {
  await requireUser();
  const { role, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  const admin = createAdminClient();
  const pending = await pendingTokenFromCookie(admin, agencyId).catch(() => null);
  if (!pending) return { ok: false, error: "This choice expired. Click Connect with Meta to start again." };

  const granted = await grantedWabaIds(pending.token);
  if (!granted.ids.includes(input.wabaId)) return { ok: false, error: "That account was not part of this signup." };

  const result = await finishWhatsAppConnection(
    admin,
    { agencyId, staffId, name },
    {
      accessToken: pending.token,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      expiresAt: granted.expiresAt,
      scopes: granted.scopes,
    },
  );

  // The parked token is either stored properly now or no longer wanted; either way it must not linger.
  await deleteWhatsAppSecret(admin, pending.ref).catch(() => undefined);
  (await cookies()).delete(WHATSAPP_PENDING_TOKEN_COOKIE);
  return result;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shared — disconnect and test, both modes.
 * ───────────────────────────────────────────────────────────────────────── */

export async function disconnectWhatsApp(): Promise<ConnectResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("whatsapp_integrations")
    .select("id, business_account_id, credential_ref, app_secret_ref, verify_token_ref, two_step_pin_ref")
    .eq("agency_id", agencyId)
    .maybeSingle();

  if (integration?.business_account_id && integration.credential_ref) {
    try {
      const { readWhatsAppToken } = await import("@/lib/whatsapp/vault");
      const token = await readWhatsAppToken(admin, integration.credential_ref);
      if (token) await unsubscribeApp(integration.business_account_id, token);
    } catch {
      // Best-effort — proceeding to mark DISCONNECTED regardless keeps the
      // CRM's own state honest even if Meta's unsubscribe call fails.
    }
  }

  // D3 — every secret this integration ever stored, gone. A Mode A
  // reconnect generates fresh ones; nothing here is ever reused.
  for (const ref of [integration?.app_secret_ref, integration?.verify_token_ref, integration?.two_step_pin_ref]) {
    if (ref) await deleteWhatsAppSecret(admin, ref).catch(() => undefined);
  }

  await admin
    .from("whatsapp_integrations")
    .update({
      status: "DISCONNECTED",
      credential_ref: null,
      credential_hint: null,
      app_secret_ref: null,
      verify_token_ref: null,
      two_step_pin_ref: null,
      connection_key: null,
      onboarding_step: "NOT_STARTED",
    })
    .eq("agency_id", agencyId);
  await admin
    .from("integration_connections")
    .update({ status: "NOT_CONNECTED", connected_account: null })
    .eq("agency_id", agencyId)
    .eq("provider", "WHATSAPP_BUSINESS");

  if (integration?.id) {
    await recordConnectionEvent(admin, { agencyId, integrationId: integration.id, kind: "DISCONNECTED" });
  }

  revalidatePath("/management/settings/integrations");
  return { ok: true, displayPhoneNumber: "" };
}

export async function testWhatsAppConnection(): Promise<ConnectResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("whatsapp_integrations")
    .select("phone_number_id, credential_ref, funding_status")
    .eq("agency_id", agencyId)
    .maybeSingle();

  if (!integration?.phone_number_id || !integration.credential_ref) {
    return { ok: false, error: "WhatsApp is not connected." };
  }

  const { readWhatsAppToken } = await import("@/lib/whatsapp/vault");
  const token = await readWhatsAppToken(admin, integration.credential_ref);
  if (!token) return { ok: false, error: "Could not read the stored access token." };

  const result = await verifyConnection(token, integration.phone_number_id);
  if (!result.ok) {
    await admin.from("whatsapp_integrations").update({ status: "ERROR", last_error: result.error }).eq("agency_id", agencyId);
    return { ok: false, error: result.error };
  }

  // E9 — verifyConnection only reads number metadata; it says nothing about
  // billing. A known UNFUNDED state must not be quietly overwritten back to
  // CONNECTED by this — that's what an actual successful send is for.
  if (integration.funding_status !== "UNFUNDED") {
    await admin
      .from("whatsapp_integrations")
      .update({ status: "CONNECTED", last_error: null, verified_at: new Date().toISOString() })
      .eq("agency_id", agencyId);
  } else {
    await admin.from("whatsapp_integrations").update({ verified_at: new Date().toISOString() }).eq("agency_id", agencyId);
  }
  return { ok: true, displayPhoneNumber: result.displayPhoneNumber };
}

/** Step 4 of the wizard (§5 E2) — sends one real message so the agency can confirm the number actually works end to end, independent of the webhook-received check. */
export async function sendWhatsAppTestMessage(toE164NoPlus: string): Promise<ConnectResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  const to = toE164NoPlus.replace(/[^\d]/g, "");
  if (!to) return { ok: false, error: "Enter a phone number in international format, digits only." };

  const admin = createAdminClient();
  const { testAgencySendRefusal } = await import("@/lib/inbox/outbound/test-agency-send-guard");
  const { outboundRecipientRefusal } = await import("@/lib/inbox/outbound/outbound-allowlist");
  const outboundRefusal = outboundRecipientRefusal(to);
  if (outboundRefusal) return { ok: false, error: outboundRefusal };
  const testAgencyRefusal = await testAgencySendRefusal(admin, agencyId);
  if (testAgencyRefusal) return { ok: false, error: testAgencyRefusal };
  const { data: integration } = await admin
    .from("whatsapp_integrations")
    .select("phone_number_id, credential_ref, status")
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!integration?.phone_number_id || !integration.credential_ref || integration.status !== "CONNECTED") {
    return { ok: false, error: "WhatsApp is not connected." };
  }

  const { readWhatsAppToken } = await import("@/lib/whatsapp/vault");
  const { sendText } = await import("@/lib/whatsapp/client");
  const token = await readWhatsAppToken(admin, integration.credential_ref);
  if (!token) return { ok: false, error: "Could not read the stored access token." };

  try {
    await sendText(integration.phone_number_id, token, to, "This is a test message from your CRM's WhatsApp connection setup. If you received this, the connection works.");
    return { ok: true, displayPhoneNumber: to };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to send the test message." };
  }
}
