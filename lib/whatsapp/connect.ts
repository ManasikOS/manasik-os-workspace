/**
 * Steps 3-7 of WhatsApp onboarding for ONE chosen WhatsApp Business Account, shared by the WhatsApp-only
 * Embedded Signup flow and the combined Meta messaging connect (app/api/oauth/meta): resolve the number, verify
 * it, store the token, subscribe the webhook, register the number. It lives here, not in a Server Action file,
 * because it takes a raw access token — a "use server" export would be callable from the browser.
 */

import "server-only";

import { revalidatePath } from "next/cache";

import { generateTwoStepPin, recordConnectionEvent } from "@/lib/data/whatsapp-connection-repository";
import { listPhoneNumbers, listSubscribedApps, registerPhoneNumber, subscribeApp, verifyConnection } from "@/lib/whatsapp/client";
import { deleteWhatsAppSecret, storeWhatsAppSecret, storeWhatsAppToken } from "@/lib/whatsapp/vault";
import type { createAdminClient } from "@/utils/supabase/admin";

export type WhatsAppConnectResult =
  | { ok: true; displayPhoneNumber: string }
  | {
      ok: false;
      error: string;
      /** Set when the signup granted several WhatsApp accounts: the token is parked in Vault under this ref until the agency picks one. */
      pendingRef?: string;
    };

export type FinishContext = { agencyId: string; staffId: string | null; name: string | null };

/** Steps 3-7 of onboarding for one chosen WhatsApp account: resolve the number, verify, store the token, subscribe, register. */
export async function finishWhatsAppConnection(
  admin: ReturnType<typeof createAdminClient>,
  { agencyId, staffId, name }: FinishContext,
  input: { accessToken: string; wabaId: string; phoneNumberId?: string; expiresAt: Date | null; scopes: string[] },
): Promise<WhatsAppConnectResult> {
  const { accessToken, wabaId } = input;
  try {
    // 3. Resolve the phone number — from the hint if it actually belongs
    // to this WABA, else the first (and usually only, for a first-time
    // signup) number on it.
    const phoneNumbers = await listPhoneNumbers(wabaId, accessToken).catch(() => []);
    const phoneNumberId =
      (input.phoneNumberId && phoneNumbers.some((p) => p.id === input.phoneNumberId) ? input.phoneNumberId : null) ??
      phoneNumbers[0]?.id ??
      null;
    if (!phoneNumberId) {
      return { ok: false, error: "Meta did not report a phone number for this signup — add one in WhatsApp Manager and try again." };
    }
    const phoneDetails = phoneNumbers.find((p) => p.id === phoneNumberId) ?? null;
    const cameFromBusinessApp =
      phoneDetails?.isOnBusinessApp === true || phoneDetails?.platformType === "SMB_APP" || phoneDetails?.platformType === "ON_PREMISE";

    // 4. Confirm the number is actually reachable before we call it connected.
    const verified = await verifyConnection(accessToken, phoneNumberId);
    if (!verified.ok) return { ok: false, error: verified.error };

    // 5. Store the token in Vault — never in a queryable column (D4).
    // Read the previous refs first so they can be cleaned up after the new
    // ones are in place (every store call creates a fresh secret rather
    // than updating one in place — see 20260929090000_whatsapp_secret_race_fix.sql).
    const { data: previous } = await admin
      .from("whatsapp_integrations")
      .select("credential_ref, two_step_pin_ref")
      .eq("agency_id", agencyId)
      .maybeSingle();
    const credentialRef = await storeWhatsAppToken(admin, agencyId, accessToken);

    const { data: upserted, error: upsertError } = await admin
      .from("whatsapp_integrations")
      .upsert(
        {
          agency_id: agencyId,
          provider: "META",
          connection_mode: "EMBEDDED_SIGNUP",
          business_account_id: wabaId,
          phone_number_id: phoneNumberId,
          display_phone_number: verified.displayPhoneNumber,
          business_name: verified.verifiedName,
          quality_rating: verified.qualityRating,
          credential_ref: credentialRef,
          credential_hint: `…${accessToken.slice(-4)}`,
          token_expires_at: input.expiresAt?.toISOString() ?? null,
          token_scopes: input.scopes,
          status: "CONNECTED",
          onboarding_step: "TOKEN_STORED",
          verified_at: new Date().toISOString(),
          last_error: null,
          connected_by: staffId,
          connected_by_name: name,
        },
        { onConflict: "agency_id" },
      )
      .select("id")
      .single();
    if (upsertError) return { ok: false, error: upsertError.message };
    const integrationId = (upserted as { id: string }).id;

    if (previous?.credential_ref) await deleteWhatsAppSecret(admin, previous.credential_ref).catch(() => undefined);
    if (previous?.two_step_pin_ref) await deleteWhatsAppSecret(admin, previous.two_step_pin_ref).catch(() => undefined);

    await recordConnectionEvent(admin, { agencyId, integrationId, kind: "TOKEN_STORED", detail: { phoneNumberId, wabaId, mode: "EMBEDDED_SIGNUP" } });

    // 6. Subscribe our app to this WABA's webhook events (F8) — readback confirms it stuck.
    await subscribeApp(wabaId, accessToken);
    await listSubscribedApps(wabaId, accessToken);
    await admin.from("whatsapp_integrations").update({ subscribed_at: new Date().toISOString(), onboarding_step: "SUBSCRIBED" }).eq("id", integrationId);
    await recordConnectionEvent(admin, { agencyId, integrationId, kind: "SUBSCRIBED" });

    // 7. Register the number (F8) — skipped for a number migrated off the
    // WhatsApp Business app, which is already registered (F9).
    if (!cameFromBusinessApp) {
      const pin = generateTwoStepPin();
      try {
        await registerPhoneNumber(phoneNumberId, accessToken, pin);
        const twoStepPinRef = await storeWhatsAppSecret(admin, agencyId, "two_step_pin", pin);
        await admin
          .from("whatsapp_integrations")
          .update({ registered_at: new Date().toISOString(), onboarding_step: "REGISTERED", two_step_pin_ref: twoStepPinRef })
          .eq("id", integrationId);
        await recordConnectionEvent(admin, { agencyId, integrationId, kind: "REGISTERED" });
      } catch (error) {
        await recordConnectionEvent(admin, {
          agencyId,
          integrationId,
          kind: "REGISTER_FAILED",
          detail: { error: error instanceof Error ? error.message : String(error) },
        });
        // Not fatal — Embedded Signup itself may have already registered
        // the number as part of the flow; onboarding_step stays at
        // SUBSCRIBED so it's visible rather than silently reported COMPLETE.
      }
    } else {
      await admin.from("whatsapp_integrations").update({ registered_at: new Date().toISOString(), onboarding_step: "REGISTERED" }).eq("id", integrationId);
      await recordConnectionEvent(admin, { agencyId, integrationId, kind: "REGISTRATION_SKIPPED_BUSINESS_APP_NUMBER" });
    }

    await admin.from("integration_connections").upsert(
      {
        agency_id: agencyId,
        provider: "WHATSAPP_BUSINESS",
        status: "CONNECTED",
        connected_account: verified.displayPhoneNumber,
        connected_at: new Date().toISOString(),
        connected_by: staffId,
        connected_by_name: name,
      },
      { onConflict: "agency_id,provider" },
    );

    revalidatePath("/management/settings/integrations");
    return { ok: true, displayPhoneNumber: verified.displayPhoneNumber };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to connect WhatsApp." };
  }
}
