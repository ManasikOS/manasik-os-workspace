/**
 * The real collaborators and the shared request reading for Meta's deauthorize and data-deletion callbacks
 * (app/api/webhooks/meta/*). Kept out of the route files so the two routes cannot drift apart.
 */

import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { revokeConnectionsForMetaUser, type RevocableConnection } from "@/lib/channels/meta-user-revocation";
import { deleteChannelToken } from "@/lib/channels/vault";
import { markConnectionDisconnected } from "@/lib/data/channel-connection-repository";
import type { UserCallbackDeps, UserCallbackResponse } from "@/lib/meta/user-callbacks";
import { getSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/utils/supabase/admin";
import { deleteInboxConversations } from "@/lib/inbox/retention/sweep";

/** The secrets a callback may be signed with: the main app's, plus Instagram's own when it has one. */
function appSecrets(): string[] {
  return [process.env.META_APP_SECRET, process.env.INSTAGRAM_APP_SECRET].filter((secret): secret is string => Boolean(secret && secret.trim()));
}

export async function buildUserCallbackDeps(): Promise<UserCallbackDeps> {
  const admin = createAdminClient();
  const findConnections = async (userId: string, onlyLive: boolean) => {
    let query = admin
      .from("channel_connections")
      .select("id, agency_id, provider, credential_ref")
      .eq("provider_metadata->>meta_user_id", userId);
    if (onlyLive) query = query.neq("status", "DISCONNECTED");
    const { data, error } = await query;
    if (error) throw new Error(`Could not look up connections: ${error.message}`);
    return (data ?? []) as RevocableConnection[];
  };
  const revoke = async (metaUserId: string) => {
    const result = await revokeConnectionsForMetaUser(metaUserId, {
      findConnections: (userId) => findConnections(userId, true),
      deleteToken: (ref) => deleteChannelToken(admin, ref),
      markDisconnected: (id, agencyId) => markConnectionDisconnected(admin, id, agencyId),
    });
    // Counts only — never the Meta user id, which is personal data.
    console.info(`Meta user revocation: disconnected ${result.disconnected}, failed ${result.failed}.`);
    return result;
  };
  return {
    appSecrets: appSecrets(),
    siteUrl: await getSiteUrl(),
    now: () => new Date(),
    revoke,
    deleteData: async (metaUserId) => {
      // Resolve the scope before revocation changes connection status. It is
      // still looked up server-side from the signed Meta user id.
      const connections = await findConnections(metaUserId, false);
      const result = await revoke(metaUserId);
      let conversationsDeleted = 0;
      let messagesDeleted = 0;
      let objectsDeleted = 0;
      for (const connection of connections) {
        const { data, error } = await admin.from("conversations").select("id").eq("agency_id", connection.agency_id).eq("connection_id", connection.id);
        if (error) throw new Error(`Could not find channel conversations for deletion: ${error.message}`);
        const conversationIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
        if (conversationIds.length === 0) continue;
        const deleted = await deleteInboxConversations(admin, { agencyId: connection.agency_id, conversationIds });
        conversationsDeleted += deleted.conversationsDeleted;
        messagesDeleted += deleted.messagesDeleted;
        objectsDeleted += deleted.objectsDeleted;
      }
      console.info(`Meta data deletion: conversations ${conversationsDeleted}, messages ${messagesDeleted}, objects ${objectsDeleted}.`);
      return result;
    },
  };
}

/** Meta POSTs the request as a form (`signed_request`); anything else is refused by the pure handlers as an invalid request. */
export async function readSignedRequestField(request: NextRequest): Promise<string | null> {
  const form = await request.formData().catch(() => null);
  const value = form?.get("signed_request");
  return typeof value === "string" ? value : null;
}

export function toJsonResponse(response: UserCallbackResponse): NextResponse {
  return NextResponse.json(response.body, { status: response.status });
}
