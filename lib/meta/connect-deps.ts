/**
 * The real collaborators the Messenger and Instagram connect flows use — Graph calls, Vault, and the connection
 * repository — wired into the injected-dependency shapes of lib/channels/messenger/connect.ts and
 * lib/channels/instagram/connect.ts. Each channel has its own onboarding; both build their dependencies here.
 *
 * This is a plain server module rather than a Server Action file on purpose: everything here takes a raw
 * access token, and a "use server" export would be callable from the browser.
 */

import "server-only";

import type { InstagramConnectDeps } from "@/lib/channels/instagram/connect";
import { listInstagramLoginSubscriptions, subscribeInstagramLoginAccount } from "@/lib/channels/instagram/login/client";
import type { InstagramLoginConnectDeps } from "@/lib/channels/instagram/login/connect";
import { listPageSubscriptions, subscribePageToApp } from "@/lib/channels/messenger/client";
import type { MessengerConnectDeps } from "@/lib/channels/messenger/connect";
import { deleteChannelToken, storeChannelToken } from "@/lib/channels/vault";
import {
  findConnectionOwnedByAnotherAgency,
  getActiveConnectionForAgency,
  saveChannelConnection,
} from "@/lib/data/channel-connection-repository";
import type { createAdminClient } from "@/utils/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Facts to keep on every connection saved by a login, on top of what the connect module records. Today that is
 * the Meta user who signed in, so Meta's deauthorize / data-deletion callbacks can find the connections that user
 * made (lib/channels/meta-user-revocation.ts). Never a secret.
 */
export interface ConnectionProvenance {
  metaUserId: string | null;
}

const withProvenance = (metadata: Record<string, unknown> | undefined, provenance: ConnectionProvenance | undefined) => ({
  ...(metadata ?? {}),
  ...(provenance?.metaUserId ? { meta_user_id: provenance.metaUserId } : {}),
});

export function buildMessengerConnectDeps(admin: Admin, agencyId: string, provenance?: ConnectionProvenance): MessengerConnectDeps {
  return {
    ownedByAnotherAgency: (pageId) => findConnectionOwnedByAnotherAgency(admin, "MESSENGER", pageId, agencyId),
    activeConnectionAccountId: async () => (await getActiveConnectionForAgency(admin, agencyId, "MESSENGER"))?.provider_account_id ?? null,
    subscribePage: subscribePageToApp,
    listSubscriptions: listPageSubscriptions,
    storeToken: (token) => storeChannelToken(admin, agencyId, "MESSENGER", token),
    deleteToken: (ref) => deleteChannelToken(admin, ref),
    saveConnection: (input) => saveChannelConnection(admin, { ...input, metadata: withProvenance(input.metadata, provenance), agencyId, provider: "MESSENGER" }),
  };
}

export function buildInstagramConnectDeps(admin: Admin, agencyId: string, provenance?: ConnectionProvenance): InstagramConnectDeps {
  return {
    ownedByAnotherAgency: (accountId) => findConnectionOwnedByAnotherAgency(admin, "INSTAGRAM", accountId, agencyId),
    activeConnectionAccountId: async () => (await getActiveConnectionForAgency(admin, agencyId, "INSTAGRAM"))?.provider_account_id ?? null,
    subscribePage: subscribePageToApp,
    listSubscriptions: listPageSubscriptions,
    // The Instagram connection keeps its OWN copy of the Page token so disconnecting one channel never deletes the other's credential.
    storeToken: (token) => storeChannelToken(admin, agencyId, "INSTAGRAM", token),
    deleteToken: (ref) => deleteChannelToken(admin, ref),
    saveConnection: (input) => saveChannelConnection(admin, { ...input, metadata: withProvenance(input.metadata, provenance), agencyId, provider: "INSTAGRAM" }),
  };
}

/** Instagram Login connection: the account's own token, subscribed on the account rather than on a Page. */
export function buildInstagramLoginConnectDeps(admin: Admin, agencyId: string, provenance?: ConnectionProvenance): InstagramLoginConnectDeps {
  return {
    ownedByAnotherAgency: (accountId) => findConnectionOwnedByAnotherAgency(admin, "INSTAGRAM", accountId, agencyId),
    activeConnectionAccountId: async () => (await getActiveConnectionForAgency(admin, agencyId, "INSTAGRAM"))?.provider_account_id ?? null,
    subscribeAccount: subscribeInstagramLoginAccount,
    listSubscriptions: listInstagramLoginSubscriptions,
    storeToken: (token) => storeChannelToken(admin, agencyId, "INSTAGRAM", token),
    deleteToken: (ref) => deleteChannelToken(admin, ref),
    saveConnection: (input) => saveChannelConnection(admin, { ...input, metadata: withProvenance(input.metadata, provenance), agencyId, provider: "INSTAGRAM" }),
  };
}
