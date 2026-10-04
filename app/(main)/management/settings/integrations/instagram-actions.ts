"use server";

/**
 * The server-side half of Instagram connection — its OWN onboarding, separate from WhatsApp and Messenger. The
 * agency signs in to Meta, shares the Facebook Page linked to their Instagram professional account, and Meta
 * returns an authorization `code` (see app/api/oauth/instagram/callback). Instagram messaging goes through that
 * Page's access token, so the Page is what the login shares and the Instagram account is found from it. Every
 * Graph call and our app secret stay on the server; the token goes straight to Vault.
 *
 * Disconnect, test and the assistant switch for Instagram are in messenger-actions.ts (one implementation for
 * both Page-backed channels). Every action re-checks `capabilitiesForSettings(role).editIntegrations`.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getLinkedInstagramAccount } from "@/lib/channels/instagram/client";
import { connectInstagramAccount } from "@/lib/channels/instagram/connect";
import { discoverInstagramAccounts, noInstagramAccountMessage, type InstagramCandidate } from "@/lib/channels/instagram/discover";
import { exchangeForLongLivedToken, exchangeInstagramLoginCode, getInstagramLoginProfile } from "@/lib/channels/instagram/login/client";
import { connectInstagramLoginAccount } from "@/lib/channels/instagram/login/connect";
import { instagramLoginRedirectUri } from "@/lib/channels/instagram/login/oauth";
import { INSTAGRAM_PENDING_TOKEN_COOKIE } from "@/lib/channels/instagram/oauth-redirect";
import { openPendingRef } from "@/lib/channels/pending-token-cookie";
import { listGrantedPages, pageIdsFromGranularScopes } from "@/lib/channels/messenger/client";
import { deleteChannelToken, readChannelToken, storeChannelToken } from "@/lib/channels/vault";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { getSiteUrl } from "@/lib/site-url";
import { instagramLoginCodeSchema } from "@/lib/validations/instagram-login";
import { buildInstagramConnectDeps, buildInstagramLoginConnectDeps } from "@/lib/meta/connect-deps";
import { debugToken, exchangeCodeForToken } from "@/lib/whatsapp/client";
import { createAdminClient } from "@/utils/supabase/admin";

export type InstagramConnectResult =
  | { ok: true; accountLabel: string }
  | {
      ok: false;
      error: string;
      /** Set when the login granted several Instagram accounts: the login token is parked in Vault under this ref until the agency picks one. */
      pendingRef?: string;
    };

/** One Instagram account a login can connect, for the "which one?" picker. No token ever leaves the server. */
export interface InstagramAccountChoice {
  instagramAccountId: string;
  label: string;
  pageName: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;
type Actor = { agencyId: string };

async function requireIntegrationEditor(): Promise<{ ok: true; actor: Actor } | { ok: false; error: string }> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editIntegrations) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };
  return { ok: true, actor: { agencyId } };
}

const labelOf = (account: { username: string | null; name: string | null; id: string }) => (account.username ? `@${account.username}` : (account.name ?? `Instagram account ${account.id}`));

/** The Instagram accounts a login token can connect, and the Pages it shared that have none. */
async function grantedInstagramAccounts(loginToken: string) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("META_APP_ID / META_APP_SECRET are not configured for this deployment.");
  const debug = await debugToken(loginToken, appId, appSecret);
  if (!debug.isValid) return { valid: false as const };
  const metaUserId = debug.userId;
  const pages = await listGrantedPages(loginToken, pageIdsFromGranularScopes(debug.granularScopes));
  const { candidates, pagesWithoutInstagram } = await discoverInstagramAccounts(pages, (page) => getLinkedInstagramAccount(page.id, page.accessToken));
  return { valid: true as const, pagesShared: pages.length, candidates, pagesWithoutInstagram, metaUserId };
}

async function finishConnection(admin: Admin, actor: Actor, candidate: InstagramCandidate, metaUserId: string | null): Promise<InstagramConnectResult> {
  const appId = process.env.META_APP_ID;
  if (!appId) return { ok: false, error: "META_APP_ID is not configured for this deployment." };

  const { account, page } = candidate;
  const result = await connectInstagramAccount(
    { id: account.id, username: account.username, name: account.name, pageId: page.id, pageName: page.name, pageToken: page.accessToken },
    appId,
    buildInstagramConnectDeps(admin, actor.agencyId, { metaUserId }),
  );
  if (result.ok) revalidatePath("/management/settings/integrations");
  return result.ok ? { ok: true, accountLabel: result.accountLabel } : result;
}

/** Called by the Instagram OAuth callback with the code Meta returned. */
export async function connectInstagram(input: { code: string; redirectUri: string }): Promise<InstagramConnectResult> {
  const gate = await requireIntegrationEditor();
  if (!gate.ok) return gate;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return { ok: false, error: "META_APP_ID / META_APP_SECRET are not configured for this deployment." };

  const admin = createAdminClient();
  try {
    // The code lives ~30 seconds and is single-use: exchange it first, before anything else.
    const { accessToken } = await exchangeCodeForToken(input.code, appId, appSecret, input.redirectUri);
    const granted = await grantedInstagramAccounts(accessToken);
    if (!granted.valid) return { ok: false, error: "Meta reports the login token is not valid. Please try again." };

    if (granted.candidates.length === 0) return { ok: false, error: noInstagramAccountMessage(granted.pagesShared, granted.pagesWithoutInstagram) };
    if (granted.candidates.length > 1) {
      // The code cannot be exchanged twice, so park the login token and let the agency choose in the Integrations screen.
      const pendingRef = await storeChannelToken(admin, gate.actor.agencyId, "INSTAGRAM", accessToken);
      return { ok: false, error: "You shared more than one Instagram account. Choose the one to connect.", pendingRef };
    }
    return await finishConnection(admin, gate.actor, granted.candidates[0], granted.metaUserId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to connect Instagram." };
  }
}

/**
 * Called by the Instagram Login callback with the code Instagram returned. The agency signed in with Instagram
 * itself, so there is no Page and no account picker: the login IS the account. The redirect URI is derived on the
 * server, never taken from the caller, so it always equals the one the login started with.
 */
export async function connectInstagramWithLogin(input: { code: string }): Promise<InstagramConnectResult> {
  const gate = await requireIntegrationEditor();
  if (!gate.ok) return gate;

  const parsed = instagramLoginCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The Instagram sign-in could not be verified. Please try again." };

  const appId = process.env.INSTAGRAM_APP_ID?.trim();
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
  if (!appId || !appSecret) return { ok: false, error: "INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET are not configured for this deployment." };

  const admin = createAdminClient();
  try {
    // The code is single-use: exchange it first, before anything else can fail.
    const { accessToken: shortToken } = await exchangeInstagramLoginCode({
      code: parsed.data.code,
      appId,
      appSecret,
      redirectUri: instagramLoginRedirectUri(await getSiteUrl()),
    });
    const longLived = await exchangeForLongLivedToken({ shortToken, appSecret });
    const profile = await getInstagramLoginProfile(longLived.accessToken);

    const result = await connectInstagramLoginAccount(
      { id: profile.userId, username: profile.username, name: profile.name, accessToken: longLived.accessToken, expiresInSeconds: longLived.expiresInSeconds },
      // The Instagram account id doubles as the "who signed in" fact Meta's deauthorize callback looks connections up by.
      buildInstagramLoginConnectDeps(admin, gate.actor.agencyId, { metaUserId: profile.userId }),
    );
    if (result.ok) revalidatePath("/management/settings/integrations");
    return result.ok ? { ok: true, accountLabel: result.accountLabel } : result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to connect Instagram." };
  }
}

async function pendingLoginToken(admin: Admin, agencyId: string): Promise<{ ref: string; token: string } | null> {
  // The cookie is sealed to the agency that started the login: a forged or another agency's cookie opens to nothing.
  const ref = openPendingRef((await cookies()).get(INSTAGRAM_PENDING_TOKEN_COOKIE)?.value, agencyId, process.env.META_APP_SECRET);
  if (!ref) return null;
  const token = await readChannelToken(admin, ref);
  return token ? { ref, token } : null;
}

/** The Instagram accounts a waiting login can connect, for the picker. Empty when no login is waiting. */
export async function getInstagramChoices(): Promise<InstagramAccountChoice[]> {
  const gate = await requireIntegrationEditor();
  if (!gate.ok) return [];
  const admin = createAdminClient();
  const pending = await pendingLoginToken(admin, gate.actor.agencyId).catch(() => null);
  if (!pending) return [];
  const granted = await grantedInstagramAccounts(pending.token).catch(() => null);
  if (!granted?.valid) return [];
  return granted.candidates.map(({ account, page }) => ({ instagramAccountId: account.id, label: labelOf(account), pageName: page.name }));
}

/** Finishes a login that granted several Instagram accounts, for the one the agency picked. */
export async function chooseInstagramAccount(input: { instagramAccountId: string }): Promise<InstagramConnectResult> {
  const gate = await requireIntegrationEditor();
  if (!gate.ok) return gate;

  const admin = createAdminClient();
  const pending = await pendingLoginToken(admin, gate.actor.agencyId).catch(() => null);
  if (!pending) return { ok: false, error: "This choice expired. Click Connect with Instagram to start again." };

  try {
    const granted = await grantedInstagramAccounts(pending.token);
    if (!granted.valid) return { ok: false, error: "Meta reports the login token is not valid. Please try again." };
    const candidate = granted.candidates.find((entry) => entry.account.id === input.instagramAccountId);
    if (!candidate) return { ok: false, error: "That Instagram account was not part of this login." };
    return await finishConnection(admin, gate.actor, candidate, granted.metaUserId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to connect Instagram." };
  } finally {
    // The parked login token is either used now or no longer wanted; either way it must not linger.
    await deleteChannelToken(admin, pending.ref).catch(() => undefined);
    (await cookies()).delete(INSTAGRAM_PENDING_TOKEN_COOKIE);
  }
}
