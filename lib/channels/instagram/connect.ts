/**
 * Connecting one Instagram professional account to an agency, through the Facebook Page it is linked to. The
 * same rules as Messenger's connect (lib/channels/messenger/connect.ts), with collaborators injected so the
 * ordering and cleanup are unit tested without Meta or a database:
 *  1. An account already connected to ANOTHER agency is refused before any call to Meta.
 *  2. An agency that already has a different live Instagram account must disconnect it first (one per agency in v1).
 *  3. Subscribe the linked Page, then READ THE SUBSCRIPTION BACK — Instagram DMs are delivered through the
 *     Page's subscription, and "connected but silent" is the failure worst to diagnose later (plan F10).
 *  4. Only after Meta confirms is the token written to Vault, and if saving the connection then fails the
 *     just-written secret is deleted — no orphaned secret.
 *  5. The previous token of a reconnect is deleted only after the new one is saved.
 *
 * The token is the Page's access token, stored as this connection's OWN secret so disconnecting Messenger and
 * Instagram never deletes each other's credential.
 */

import "server-only";

import type { PageSubscription } from "@/lib/channels/messenger/client";
import { isSubscribedToMessages } from "@/lib/channels/messenger/client";
import type { SaveChannelConnectionInput, SaveChannelConnectionResult } from "@/lib/data/channel-connection-repository";

export interface InstagramConnectDeps {
  ownedByAnotherAgency: (instagramAccountId: string) => Promise<boolean>;
  activeConnectionAccountId: () => Promise<string | null>;
  subscribePage: (pageId: string, pageToken: string) => Promise<void>;
  listSubscriptions: (pageId: string, pageToken: string) => Promise<PageSubscription[]>;
  storeToken: (token: string) => Promise<string>;
  deleteToken: (credentialRef: string) => Promise<void>;
  saveConnection: (input: Omit<SaveChannelConnectionInput, "agencyId" | "provider">) => Promise<SaveChannelConnectionResult>;
}

export interface InstagramAccountToConnect {
  /** The Instagram professional account id — what every webhook for it carries. */
  id: string;
  username: string | null;
  name: string | null;
  pageId: string;
  pageName: string | null;
  /** The linked Page's access token. A secret: goes to Vault, never to a column or a log. */
  pageToken: string;
}

export type InstagramConnectResult = { ok: true; accountLabel: string; connectionId: string } | { ok: false; error: string };

export async function connectInstagramAccount(account: InstagramAccountToConnect, ourAppId: string, deps: InstagramConnectDeps): Promise<InstagramConnectResult> {
  const accountLabel = account.username ? `@${account.username}` : (account.name ?? `Instagram account ${account.id}`);

  if (await deps.ownedByAnotherAgency(account.id)) {
    return { ok: false, error: `${accountLabel} is already connected to another agency. An Instagram account can only be connected to one agency at a time.` };
  }
  const active = await deps.activeConnectionAccountId();
  if (active && active !== account.id) {
    return { ok: false, error: "This agency already has a different Instagram account connected. Disconnect it first, then connect this one." };
  }

  try {
    await deps.subscribePage(account.pageId, account.pageToken);
    const subscriptions = await deps.listSubscriptions(account.pageId, account.pageToken);
    if (!isSubscribedToMessages(subscriptions, ourAppId)) {
      return {
        ok: false,
        error: `Meta accepted the connection but is not sending ${accountLabel}'s messages to this app yet. Check that the app is live and has the Instagram messaging product set up, then try again.`,
      };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not subscribe to the Instagram account's messages." };
  }

  const credentialRef = await deps.storeToken(account.pageToken);
  const saved = await deps.saveConnection({
    accountId: account.id,
    displayName: accountLabel,
    credentialRef,
    credentialExpiresAt: null, // a Page token from Facebook Login for Business does not expire
    metadata: { instagram_account_id: account.id, username: account.username, page_id: account.pageId, page_name: account.pageName },
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
