/**
 * Connecting one chosen Facebook Page to an agency — the orchestration behind the Integrations "Connect"
 * flow, with its collaborators injected so the ordering and cleanup rules are unit tested without Meta or a
 * database. The Server Actions (app/(main)/management/settings/integrations/messenger-actions.ts) supply the
 * real ones.
 *
 * The rules, each earned by something that goes wrong otherwise:
 *  1. A Page already connected to ANOTHER agency is refused before any call to Meta.
 *  2. An agency that already has a different live Page must disconnect it first (one Page per agency in v1).
 *  3. Subscribe, then READ THE SUBSCRIPTION BACK. A subscribe that returns success but delivers nothing is
 *     "connected but silent" — the failure worst to diagnose later (plan F10).
 *  4. Only after Meta confirms is the token written to Vault, and if saving the connection then fails the
 *     just-written secret is deleted — no orphaned secret.
 *  5. The previous token of a reconnect is deleted only after the new one is saved.
 */

import "server-only";

import type { GrantedPage, PageSubscription } from "@/lib/channels/messenger/client";
import { isSubscribedToMessages } from "@/lib/channels/messenger/client";
import type { SaveChannelConnectionInput, SaveChannelConnectionResult } from "@/lib/data/channel-connection-repository";

export interface MessengerConnectDeps {
  ownedByAnotherAgency: (pageId: string) => Promise<boolean>;
  activeConnectionAccountId: () => Promise<string | null>;
  subscribePage: (pageId: string, pageToken: string) => Promise<void>;
  listSubscriptions: (pageId: string, pageToken: string) => Promise<PageSubscription[]>;
  storeToken: (token: string) => Promise<string>;
  deleteToken: (credentialRef: string) => Promise<void>;
  saveConnection: (input: Omit<SaveChannelConnectionInput, "agencyId" | "provider">) => Promise<SaveChannelConnectionResult>;
}

export type MessengerConnectResult = { ok: true; pageName: string; connectionId: string } | { ok: false; error: string };

export async function connectMessengerPage(page: GrantedPage, ourAppId: string, deps: MessengerConnectDeps): Promise<MessengerConnectResult> {
  const pageName = page.name ?? `Page ${page.id}`;

  if (await deps.ownedByAnotherAgency(page.id)) {
    return { ok: false, error: `${pageName} is already connected to another agency. A Facebook Page can only be connected to one agency at a time.` };
  }
  const active = await deps.activeConnectionAccountId();
  if (active && active !== page.id) {
    return { ok: false, error: "This agency already has a different Facebook Page connected. Disconnect it first, then connect this one." };
  }

  try {
    await deps.subscribePage(page.id, page.accessToken);
    const subscriptions = await deps.listSubscriptions(page.id, page.accessToken);
    if (!isSubscribedToMessages(subscriptions, ourAppId)) {
      return {
        ok: false,
        error: `Meta accepted the connection but is not sending ${pageName}'s messages to this app yet. Check that the app is live and has the Messenger product set up, then try again.`,
      };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not subscribe to the Page's messages." };
  }

  const credentialRef = await deps.storeToken(page.accessToken);
  const saved = await deps.saveConnection({
    accountId: page.id,
    displayName: pageName,
    credentialRef,
    credentialExpiresAt: null, // a Page token from Facebook Login for Business does not expire
    metadata: { page_id: page.id, page_name: page.name },
  });

  if (!saved.ok) {
    await deps.deleteToken(credentialRef).catch(() => undefined); // no orphaned secret
    return { ok: false, error: saved.reason === "ALREADY_CONNECTED_ELSEWHERE" ? `${pageName} is already connected to another agency.` : `Could not save the connection: ${saved.message}` };
  }

  if (saved.previousCredentialRef && saved.previousCredentialRef !== credentialRef) {
    await deps.deleteToken(saved.previousCredentialRef).catch(() => undefined);
  }
  return { ok: true, pageName, connectionId: saved.id };
}
