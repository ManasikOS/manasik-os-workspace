"use server";

/**
 * The server-side half of Messenger connection (Phase 3 of
 * docs/modules/messenger-instagram-ai-agent-implementation-plan.md). The agency signs in to Facebook, picks the
 * Page(s) to share, and Meta returns an authorization `code` (see app/api/oauth/messenger/callback). Every Graph
 * call and our app secret stay on the server; the Page token goes straight to Vault.
 *
 * Each channel has its OWN onboarding: this file connects Messenger only; Instagram's connect is in
 * instagram-actions.ts. The disconnect, test and assistant-switch actions for both Page-backed channels live
 * here because they share one implementation. Every action re-checks
 * `capabilitiesForSettings(role).editIntegrations`: the UI hiding a button is never the security boundary.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getInstagramAccountLabel } from "@/lib/channels/instagram/client";
import { getInstagramLoginLabel, unsubscribeInstagramLoginAccount } from "@/lib/channels/instagram/login/client";
import { isInstagramLoginMetadata } from "@/lib/channels/instagram/login/oauth";
import {
  getPageName,
  listGrantedPages,
  pageIdsFromGranularScopes,
  unsubscribePageFromApp,
  type GrantedPage,
} from "@/lib/channels/messenger/client";
import { connectMessengerPage } from "@/lib/channels/messenger/connect";
import { MESSENGER_PENDING_TOKEN_COOKIE } from "@/lib/channels/messenger/oauth-redirect";
import { openPendingRef } from "@/lib/channels/pending-token-cookie";
import { deleteChannelToken, readChannelToken, storeChannelToken } from "@/lib/channels/vault";
import {
  getActiveConnectionForAgency,
  markConnectionDisconnected,
  setConnectionAiEnabled,
} from "@/lib/data/channel-connection-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { buildMessengerConnectDeps } from "@/lib/meta/connect-deps";
import { debugToken, exchangeCodeForToken } from "@/lib/whatsapp/client";
import { createAdminClient } from "@/utils/supabase/admin";

export type MessengerConnectResult =
  | { ok: true; pageName: string }
  | {
      ok: false;
      error: string;
      /** Set when the login granted several Pages: the login token is parked in Vault under this ref until the agency picks one. */
      pendingRef?: string;
    };

/** One Page a login granted, for the "which one?" picker. No token ever leaves the server. */
export interface MessengerPageChoice {
  pageId: string;
  pageName: string | null;
}

/** The two channels that live on a Facebook Page. */
type PageChannel = "MESSENGER" | "INSTAGRAM";

type Admin = ReturnType<typeof createAdminClient>;
type Actor = { agencyId: string; staffId: string | null; name: string | null };

async function requireIntegrationEditor(): Promise<{ ok: true; actor: Actor } | { ok: false; error: string }> {
  await requireUser();
  const { role, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };
  return { ok: true, actor: { agencyId, staffId, name } };
}

/** The Pages a login token was granted, each with its own Page token. */
async function grantedPages(userToken: string): Promise<{ valid: boolean; pages: GrantedPage[]; metaUserId: string | null }> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("META_APP_ID / META_APP_SECRET are not configured for this deployment.");
  const debug = await debugToken(userToken, appId, appSecret);
  if (!debug.isValid) return { valid: false, pages: [], metaUserId: null };
  return { valid: true, pages: await listGrantedPages(userToken, pageIdsFromGranularScopes(debug.granularScopes)), metaUserId: debug.userId };
}

async function finishConnection(admin: Admin, actor: Actor, page: GrantedPage, metaUserId: string | null): Promise<MessengerConnectResult> {
  const appId = process.env.META_APP_ID;
  if (!appId) return { ok: false, error: "META_APP_ID is not configured for this deployment." };

  const result = await connectMessengerPage(page, appId, buildMessengerConnectDeps(admin, actor.agencyId, { metaUserId }));
  if (result.ok) revalidatePath("/management/settings/integrations");
  return result.ok ? { ok: true, pageName: result.pageName } : result;
}

/** Called by the Messenger OAuth callback with the code Meta returned. */
export async function connectMessenger(input: { code: string; redirectUri: string }): Promise<MessengerConnectResult> {
  const gate = await requireIntegrationEditor();
  if (!gate.ok) return gate;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return { ok: false, error: "META_APP_ID / META_APP_SECRET are not configured for this deployment." };

  const admin = createAdminClient();
  try {
    // The code lives ~30 seconds and is single-use: exchange it first, before anything else.
    const { accessToken } = await exchangeCodeForToken(input.code, appId, appSecret, input.redirectUri);
    const { valid, pages, metaUserId } = await grantedPages(accessToken);
    if (!valid) return { ok: false, error: "Meta reports the login token is not valid. Please try again." };

    if (pages.length === 0) {
      return {
        ok: false,
        error: "Meta did not share any Facebook Page with this app. Try again and tick the Page you want to connect, and make sure you manage that Page.",
      };
    }
    if (pages.length > 1) {
      // The code cannot be exchanged twice, so park the login token and let the agency choose in the Integrations screen.
      const pendingRef = await storeChannelToken(admin, gate.actor.agencyId, "MESSENGER", accessToken);
      return { ok: false, error: "You shared more than one Facebook Page. Choose the one to connect.", pendingRef };
    }
    return await finishConnection(admin, gate.actor, pages[0], metaUserId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to connect Messenger." };
  }
}

async function pendingLoginToken(admin: Admin, agencyId: string): Promise<{ ref: string; token: string } | null> {
  // The cookie is sealed to the agency that started the login: a forged or another agency's cookie opens to nothing.
  const ref = openPendingRef((await cookies()).get(MESSENGER_PENDING_TOKEN_COOKIE)?.value, agencyId, process.env.META_APP_SECRET);
  if (!ref) return null;
  const token = await readChannelToken(admin, ref);
  return token ? { ref, token } : null;
}

/** The Pages a waiting login granted, for the picker. Empty when no login is waiting. */
export async function getMessengerChoices(): Promise<MessengerPageChoice[]> {
  const gate = await requireIntegrationEditor();
  if (!gate.ok) return [];
  const admin = createAdminClient();
  const pending = await pendingLoginToken(admin, gate.actor.agencyId).catch(() => null);
  if (!pending) return [];
  const { pages } = await grantedPages(pending.token).catch(() => ({ pages: [] as GrantedPage[] }));
  return pages.map((page) => ({ pageId: page.id, pageName: page.name }));
}

/** Finishes a login that granted several Pages, for the one the agency picked. */
export async function chooseMessengerPage(input: { pageId: string }): Promise<MessengerConnectResult> {
  const gate = await requireIntegrationEditor();
  if (!gate.ok) return gate;

  const admin = createAdminClient();
  const pending = await pendingLoginToken(admin, gate.actor.agencyId).catch(() => null);
  if (!pending) return { ok: false, error: "This choice expired. Click Connect with Facebook to start again." };

  try {
    const { pages, metaUserId } = await grantedPages(pending.token);
    const page = pages.find((candidate) => candidate.id === input.pageId);
    if (!page) return { ok: false, error: "That Page was not part of this login." };
    return await finishConnection(admin, gate.actor, page, metaUserId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to connect Messenger." };
  } finally {
    // The parked login token is either used now or no longer wanted; either way it must not linger.
    await deleteChannelToken(admin, pending.ref).catch(() => undefined);
    (await cookies()).delete(MESSENGER_PENDING_TOKEN_COOKIE);
  }
}

/* ── Disconnect, test and the assistant switch — one implementation for both Page channels ───────────── */

/**
 * Whether the OTHER channel on this Page still needs the Page's webhook subscription. Messenger and Instagram
 * share one subscription, so disconnecting one must not unsubscribe the Page while the other still uses it.
 */
async function otherChannelStillUsesPage(admin: Admin, agencyId: string, channel: PageChannel, pageId: string): Promise<boolean> {
  const other: PageChannel = channel === "MESSENGER" ? "INSTAGRAM" : "MESSENGER";
  const { data } = await admin
    .from("channel_connections")
    .select("provider_account_id, provider_metadata")
    .eq("agency_id", agencyId)
    .eq("provider", other)
    .neq("status", "DISCONNECTED")
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  const row = data as { provider_account_id: string | null; provider_metadata: { page_id?: string } | null };
  return other === "MESSENGER" ? row.provider_account_id === pageId : row.provider_metadata?.page_id === pageId;
}

/** The connection's `provider_metadata` (never a secret), agency-scoped. It says which connect method an Instagram connection used. */
async function connectionMetadata(admin: Admin, agencyId: string, connectionId: string): Promise<{ page_id?: string; connect_method?: string } | null> {
  const { data } = await admin.from("channel_connections").select("provider_metadata").eq("id", connectionId).eq("agency_id", agencyId).maybeSingle();
  return (data as { provider_metadata: { page_id?: string; connect_method?: string } | null } | null)?.provider_metadata ?? null;
}

async function disconnectPageChannel(channel: PageChannel): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireIntegrationEditor();
  if (!gate.ok) return gate;

  const admin = createAdminClient();
  const connection = await getActiveConnectionForAgency(admin, gate.actor.agencyId, channel);
  if (!connection) return { ok: true };

  if (connection.credential_ref) {
    try {
      const token = await readChannelToken(admin, connection.credential_ref);
      const metadata = await connectionMetadata(admin, gate.actor.agencyId, connection.id);
      if (channel === "INSTAGRAM" && isInstagramLoginMetadata(metadata)) {
        // An Instagram Login connection is subscribed on the account itself: there is no Page, and nothing else shares it.
        if (token) await unsubscribeInstagramLoginAccount(token);
      } else {
        const pageId = channel === "MESSENGER" ? connection.provider_account_id : (metadata?.page_id ?? null);
        if (token && pageId && !(await otherChannelStillUsesPage(admin, gate.actor.agencyId, channel, pageId))) {
          await unsubscribePageFromApp(pageId, token);
        }
      }
    } catch {
      // Best effort — marking DISCONNECTED regardless keeps the CRM's own state honest even if Meta's call fails.
    }
    await deleteChannelToken(admin, connection.credential_ref).catch(() => undefined);
  }
  // Conversations are business records and are kept; only the connection and its secret go.
  await markConnectionDisconnected(admin, connection.id, gate.actor.agencyId);

  revalidatePath("/management/settings/integrations");
  return { ok: true };
}

/** Proves the stored Page token still works, and clears an ERROR left by an earlier rejected token. */
async function testPageChannel(channel: PageChannel): Promise<MessengerConnectResult> {
  const gate = await requireIntegrationEditor();
  if (!gate.ok) return gate;

  const admin = createAdminClient();
  const connection = await getActiveConnectionForAgency(admin, gate.actor.agencyId, channel);
  if (!connection?.provider_account_id || !connection.credential_ref) {
    return { ok: false, error: `${channel === "MESSENGER" ? "Messenger" : "Instagram"} is not connected.` };
  }

  try {
    const token = await readChannelToken(admin, connection.credential_ref);
    if (!token) return { ok: false, error: "Could not read the stored access token." };
    const label =
      channel === "MESSENGER"
        ? await getPageName(connection.provider_account_id, token)
        : isInstagramLoginMetadata(await connectionMetadata(admin, gate.actor.agencyId, connection.id))
          ? await getInstagramLoginLabel(token)
          : await getInstagramAccountLabel(connection.provider_account_id, token);
    await admin
      .from("channel_connections")
      .update({ status: "CONNECTED", last_error: null, health_checked_at: new Date().toISOString() })
      .eq("id", connection.id)
      .eq("agency_id", gate.actor.agencyId);
    revalidatePath("/management/settings/integrations");
    return { ok: true, pageName: label ?? connection.display_name };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The connection test failed.";
    await admin
      .from("channel_connections")
      .update({ status: "ERROR", last_error: message, health_checked_at: new Date().toISOString() })
      .eq("id", connection.id)
      .eq("agency_id", gate.actor.agencyId);
    revalidatePath("/management/settings/integrations");
    return { ok: false, error: message };
  }
}

/** The per-channel switch: may the assistant reply on this channel? (Off until the agency opts in — plan D6.) */
async function setPageChannelAssistantEnabled(channel: PageChannel, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireIntegrationEditor();
  if (!gate.ok) return gate;

  const admin = createAdminClient();
  const connection = await getActiveConnectionForAgency(admin, gate.actor.agencyId, channel);
  if (!connection) return { ok: false, error: channel === "MESSENGER" ? "Connect a Facebook Page first." : "Connect an Instagram account first." };

  await setConnectionAiEnabled(admin, connection.id, gate.actor.agencyId, Boolean(enabled));
  revalidatePath("/management/settings/integrations");
  return { ok: true };
}

export async function disconnectMessenger() {
  return disconnectPageChannel("MESSENGER");
}
export async function testMessengerConnection() {
  return testPageChannel("MESSENGER");
}
export async function setMessengerAssistantEnabled(enabled: boolean) {
  return setPageChannelAssistantEnabled("MESSENGER", enabled);
}
export async function disconnectInstagram() {
  return disconnectPageChannel("INSTAGRAM");
}
export async function testInstagramConnection() {
  return testPageChannel("INSTAGRAM");
}
export async function setInstagramAssistantEnabled(enabled: boolean) {
  return setPageChannelAssistantEnabled("INSTAGRAM", enabled);
}
