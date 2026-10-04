/**
 * Connecting one Instagram professional account to an agency through Instagram Login (no Facebook Page). The same
 * rules as the Page connection (lib/channels/instagram/connect.ts), with collaborators injected so the ordering and
 * the cleanup are unit tested without Meta or a database:
 *  1. An account already connected to ANOTHER agency is refused before any call to Meta.
 *  2. An agency that already has a different live Instagram account must disconnect it first (one per agency in v1).
 *  3. Subscribe the account, then READ THE SUBSCRIPTION BACK. "Connected but silent" is the failure worst to
 *     diagnose later.
 *  4. Only after Meta confirms is the token written to Vault, and if saving the connection then fails the
 *     just-written secret is deleted, so no secret is orphaned.
 *  5. The previous token of a reconnect is deleted only after the new one is saved.
 *
 * The token is the account's own long-lived Instagram user token (60 days). It is stored as this connection's
 * secret, and its expiry is recorded so a refresh can be scheduled.
 */

import "server-only";

import { INSTAGRAM_LOGIN_CONNECT_METHOD } from "@/lib/channels/instagram/login/oauth";
import { isSubscribedToLoginMessages, type InstagramLoginSubscription } from "@/lib/channels/instagram/login/client";
import type { SaveChannelConnectionInput, SaveChannelConnectionResult } from "@/lib/data/channel-connection-repository";

export interface InstagramLoginConnectDeps {
  ownedByAnotherAgency: (instagramAccountId: string) => Promise<boolean>;
  activeConnectionAccountId: () => Promise<string | null>;
  subscribeAccount: (token: string) => Promise<void>;
  listSubscriptions: (token: string) => Promise<InstagramLoginSubscription[]>;
  storeToken: (token: string) => Promise<string>;
  deleteToken: (credentialRef: string) => Promise<void>;
  saveConnection: (input: Omit<SaveChannelConnectionInput, "agencyId" | "provider">) => Promise<SaveChannelConnectionResult>;
}

export interface InstagramLoginAccountToConnect {
  /** The Instagram professional account id (`user_id` from `/me`), the `entry.id` of every webhook for it. */
  id: string;
  username: string | null;
  name: string | null;
  /** The account's long-lived Instagram user token. A secret: goes to Vault, never to a column or a log. */
  accessToken: string;
  /** Seconds until it expires (about 60 days), or null when Meta did not say. */
  expiresInSeconds: number | null;
}

export type InstagramLoginConnectResult = { ok: true; accountLabel: string; connectionId: string } | { ok: false; error: string };

export async function connectInstagramLoginAccount(
  account: InstagramLoginAccountToConnect,
  deps: InstagramLoginConnectDeps,
  now: () => Date = () => new Date(),
): Promise<InstagramLoginConnectResult> {
  const accountLabel = account.username ? `@${account.username}` : (account.name ?? `Instagram account ${account.id}`);

  if (await deps.ownedByAnotherAgency(account.id)) {
    return { ok: false, error: `${accountLabel} is already connected to another agency. An Instagram account can only be connected to one agency at a time.` };
  }
  const active = await deps.activeConnectionAccountId();
  if (active && active !== account.id) {
    return { ok: false, error: "This agency already has a different Instagram account connected. Disconnect it first, then connect this one." };
  }

  try {
    await deps.subscribeAccount(account.accessToken);
    const subscriptions = await deps.listSubscriptions(account.accessToken);
    if (!isSubscribedToLoginMessages(subscriptions)) {
      return {
        ok: false,
        error: `Meta accepted the sign-in but is not sending ${accountLabel}'s messages to this app yet. Check that the app is live and the Instagram messaging permission is set up, then try again.`,
      };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not subscribe to the Instagram account's messages." };
  }

  const issuedAt = now();
  const credentialRef = await deps.storeToken(account.accessToken);
  const saved = await deps.saveConnection({
    accountId: account.id,
    displayName: accountLabel,
    credentialRef,
    credentialExpiresAt: account.expiresInSeconds === null ? null : new Date(issuedAt.getTime() + account.expiresInSeconds * 1000).toISOString(),
    metadata: {
      connect_method: INSTAGRAM_LOGIN_CONNECT_METHOD,
      instagram_account_id: account.id,
      username: account.username,
      token_issued_at: issuedAt.toISOString(),
    },
  });

  if (!saved.ok) {
    await deps.deleteToken(credentialRef).catch(() => undefined); // no orphaned secret
    return {
      ok: false,
      error: saved.reason === "ALREADY_CONNECTED_ELSEWHERE" ? `${accountLabel} is already connected to another agency.` : `Could not save the connection: ${saved.message}`,
    };
  }

  if (saved.previousCredentialRef && saved.previousCredentialRef !== credentialRef) {
    await deps.deleteToken(saved.previousCredentialRef).catch(() => undefined);
  }
  return { ok: true, accountLabel, connectionId: saved.id };
}
