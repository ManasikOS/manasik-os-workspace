/**
 * What happens to our Messenger and Instagram connections when the Meta user who made them removes the app or
 * asks for their data to be deleted (Meta's deauthorize and data-deletion callbacks — plan Phase 8).
 *
 * Every connection records the Meta user who signed in to create it (`provider_metadata.meta_user_id`). When
 * that user revokes us, their tokens are dead or about to be: we disconnect what they connected and delete the
 * stored Page tokens, so no credential outlives the permission that created it.
 *
 * This primitive is deliberately about CREDENTIALS and CONNECTIONS. A deauthorization callback stops here. The
 * data-deletion callback composes it with the Inbox retention deletion primitive so connection-owned conversations,
 * messages, attachments, and AI runs are removed too. A user id that matches nothing — most system-user tokens, or a
 * person who never connected anything — is a normal no-op, never an error. The collaborators are injected so the
 * rules are unit tested.
 */

export interface RevocableConnection {
  id: string;
  agency_id: string;
  provider: string;
  credential_ref: string | null;
}

export interface RevocationDeps {
  /** Every live connection whose recorded Meta user is this one — across agencies, since the user removed the app for all of them. */
  findConnections: (metaUserId: string) => Promise<RevocableConnection[]>;
  deleteToken: (credentialRef: string) => Promise<void>;
  markDisconnected: (connectionId: string, agencyId: string) => Promise<void>;
}

export interface RevocationResult {
  disconnected: number;
  failed: number;
}

export async function revokeConnectionsForMetaUser(metaUserId: string, deps: RevocationDeps): Promise<RevocationResult> {
  const connections = await deps.findConnections(metaUserId);
  let disconnected = 0;
  let failed = 0;

  for (const connection of connections) {
    try {
      // Token first: if disconnecting then fails, the credential is already gone and a retry finishes the job.
      if (connection.credential_ref) await deps.deleteToken(connection.credential_ref).catch(() => undefined);
      await deps.markDisconnected(connection.id, connection.agency_id);
      disconnected += 1;
    } catch {
      failed += 1; // one connection failing must not stop the others being revoked
    }
  }
  return { disconnected, failed };
}
