"use server";

/**
 * The server-side half of Meta Ads / Google Ads connection — resolving the
 * OAuth callback into a stored connection, disconnecting, and testing. The
 * redirect legs themselves (start + callback) are plain Next.js Route
 * Handlers under app/api/oauth/{meta-ads,google-ads}/ — Server Actions can't
 * be the target of an external OAuth redirect — which call the functions
 * here once they have a `code`.
 *
 * Mirrors `whatsapp-actions.ts`: every action re-checks
 * `capabilitiesForSettings(role).editIntegrations` — the UI hiding a button
 * is never the security boundary.
 */

import { revalidatePath } from "next/cache";

import {
  debugMetaAdsToken,
  exchangeForLongLivedToken,
  exchangeMetaAdsCode,
  listAdAccounts,
  MetaAdsError,
} from "@/lib/ads/meta-client";
import {
  exchangeGoogleAdsCode,
  GoogleAdsError,
  listAccessibleCustomers,
} from "@/lib/ads/google-client";
import { deleteAdsSecret, storeAdsSecret } from "@/lib/ads/vault";
import { capabilitiesForSettings } from "@/lib/access/settings-access";
import {
  disconnectGoogleAds as disconnectGoogleAdsRow,
  disconnectMetaAds as disconnectMetaAdsRow,
  getGoogleAdsIntegration,
  getMetaAdsIntegration,
  maskCredentialTail,
  upsertGoogleAdsConnection,
  upsertMetaAdsConnection,
} from "@/lib/data/ads-integrations-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { createAdminClient } from "@/utils/supabase/admin";

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function requireCanManage() {
  await requireUser();
  const { role, agencyId, staffId, name } = await getCurrentStaffRole();
  const ok = capabilitiesForSettings(role).editIntegrations;
  return { ok, agencyId, staffId, name };
}

/**
 * Runs after `/api/oauth/meta-ads/callback` receives `code` — separate from
 * the route handler so the OAuth-mechanics and the connection-persistence
 * halves stay independently testable, same split as `connectWhatsApp`.
 */
export async function completeMetaAdsConnection(input: { code: string; redirectUri: string }): Promise<ActionResult> {
  const { ok, agencyId, staffId, name } = await requireCanManage();
  if (!ok || !agencyId) return { ok: false, error: "Your role cannot connect ad platform accounts." };

  const appId = process.env.META_ADS_APP_ID;
  const appSecret = process.env.META_ADS_APP_SECRET;
  if (!appId || !appSecret) {
    return { ok: false, error: "META_ADS_APP_ID / META_ADS_APP_SECRET are not configured on this deployment." };
  }

  const admin = createAdminClient();
  try {
    const shortLived = await exchangeMetaAdsCode({ code: input.code, appId, appSecret, redirectUri: input.redirectUri });
    const longLived = await exchangeForLongLivedToken({ shortLivedToken: shortLived.accessToken, appId, appSecret });
    const debug = await debugMetaAdsToken(longLived.accessToken, appId, appSecret);
    if (!debug.valid) return { ok: false, error: "Meta rejected the resulting access token." };

    const accounts = await listAdAccounts(longLived.accessToken);
    if (accounts.length === 0) {
      return { ok: false, error: "This Meta account has no ad accounts to connect. Ask an admin of the ad account to grant access first." };
    }
    // First account by default — the agency can relink to a different one
    // later; nothing here picks silently on an agency's behalf beyond an
    // initial reasonable default.
    const account = accounts[0];

    const credentialRef = await storeAdsSecret(admin, agencyId, "meta_access_token", longLived.accessToken);
    await upsertMetaAdsConnection(admin, {
      agencyId,
      adAccountId: account.id,
      adAccountName: account.name,
      businessId: null,
      credentialRef,
      credentialHint: maskCredentialTail(longLived.accessToken),
      tokenExpiresAt: debug.expiresAt,
      tokenScopes: debug.scopes,
      connectedBy: staffId,
      connectedByName: name,
    });
    await admin.from("integration_connections").upsert(
      {
        agency_id: agencyId,
        provider: "META_ADS",
        status: "CONNECTED",
        connected_account: account.name,
        connected_at: new Date().toISOString(),
        connected_by: staffId,
        connected_by_name: name,
      },
      { onConflict: "agency_id,provider" },
    );

    revalidatePath("/management/settings/integrations");
    return { ok: true };
  } catch (error) {
    const message = error instanceof MetaAdsError ? error.message : error instanceof Error ? error.message : "Failed to connect Meta Ads.";
    return { ok: false, error: message };
  }
}

export async function disconnectMetaAdsAction(): Promise<ActionResult> {
  const { ok, agencyId } = await requireCanManage();
  if (!ok || !agencyId) return { ok: false, error: "Your role cannot disconnect ad platform accounts." };

  const admin = createAdminClient();
  const integration = await getMetaAdsIntegration(admin, agencyId);
  if (integration?.credential_ref) {
    try {
      await deleteAdsSecret(admin, integration.credential_ref);
    } catch {
      // Vault delete failing must never block disconnect — an orphaned
      // secret is a cleanup nuisance, a stuck "connected" state is a
      // security problem.
    }
  }
  await disconnectMetaAdsRow(admin, agencyId);
  await admin
    .from("integration_connections")
    .update({ status: "DISCONNECTED" })
    .eq("agency_id", agencyId)
    .eq("provider", "META_ADS");

  revalidatePath("/management/settings/integrations");
  return { ok: true };
}

export async function completeGoogleAdsConnection(input: { code: string; redirectUri: string }): Promise<ActionResult> {
  const { ok, agencyId, staffId, name } = await requireCanManage();
  if (!ok || !agencyId) return { ok: false, error: "Your role cannot connect ad platform accounts." };

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!clientId || !clientSecret || !developerToken) {
    return { ok: false, error: "GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN are not configured on this deployment." };
  }

  const admin = createAdminClient();
  try {
    const tokens = await exchangeGoogleAdsCode({ code: input.code, clientId, clientSecret, redirectUri: input.redirectUri });
    const customers = await listAccessibleCustomers(tokens.accessToken, developerToken);
    if (customers.length === 0) {
      return { ok: false, error: "This Google account has no accessible Google Ads customer accounts to connect." };
    }
    const customer = customers[0];

    const credentialRef = await storeAdsSecret(admin, agencyId, "google_refresh_token", tokens.refreshToken);
    await upsertGoogleAdsConnection(admin, {
      agencyId,
      customerId: customer.customerId,
      loginCustomerId: null,
      accountName: customer.descriptiveName,
      credentialRef,
      credentialHint: maskCredentialTail(tokens.refreshToken),
      tokenScopes: ["https://www.googleapis.com/auth/adwords"],
      connectedBy: staffId,
      connectedByName: name,
    });
    await admin.from("integration_connections").upsert(
      {
        agency_id: agencyId,
        provider: "GOOGLE_ADS",
        status: "CONNECTED",
        connected_account: customer.customerId,
        connected_at: new Date().toISOString(),
        connected_by: staffId,
        connected_by_name: name,
      },
      { onConflict: "agency_id,provider" },
    );

    revalidatePath("/management/settings/integrations");
    return { ok: true };
  } catch (error) {
    const message = error instanceof GoogleAdsError ? error.message : error instanceof Error ? error.message : "Failed to connect Google Ads.";
    return { ok: false, error: message };
  }
}

export async function disconnectGoogleAdsAction(): Promise<ActionResult> {
  const { ok, agencyId } = await requireCanManage();
  if (!ok || !agencyId) return { ok: false, error: "Your role cannot disconnect ad platform accounts." };

  const admin = createAdminClient();
  const integration = await getGoogleAdsIntegration(admin, agencyId);
  if (integration?.credential_ref) {
    try {
      await deleteAdsSecret(admin, integration.credential_ref);
    } catch {
      // Same reasoning as disconnectMetaAdsAction — never block on Vault cleanup.
    }
  }
  await disconnectGoogleAdsRow(admin, agencyId);
  await admin
    .from("integration_connections")
    .update({ status: "DISCONNECTED" })
    .eq("agency_id", agencyId)
    .eq("provider", "GOOGLE_ADS");

  revalidatePath("/management/settings/integrations");
  return { ok: true };
}
