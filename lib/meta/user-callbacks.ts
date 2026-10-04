/**
 * Meta's two user-revocation callbacks, as pure request → response decisions:
 *  - Deauthorize: a user removed the app. Answered 200 with an empty object.
 *  - Data deletion: a user asked Meta to delete their data. Answered with JSON `{ url, confirmation_code }`,
 *    where `url` is a page the user can open to see the request's status.
 * Both verify the signed request first (a forged one is a 400 that changes nothing) and both revoke the
 * connections that user made. The route files only read the form and hand the fields here.
 */

import type { RevocationResult } from "@/lib/channels/meta-user-revocation";
import { makeDeletionConfirmationCode, parseSignedRequest } from "@/lib/meta/signed-request";

export type UserCallbackResponse = { status: 400; body: { error: string } } | { status: 200; body: Record<string, unknown> };

export interface UserCallbackDeps {
  /** The app secrets deliveries may be signed with; the main app's, plus Instagram's when it has its own. */
  appSecrets: string[];
  revoke: (metaUserId: string) => Promise<RevocationResult>;
  /** Data-deletion callback: revoke credentials and remove the linked channel data. */
  deleteData?: (metaUserId: string) => Promise<RevocationResult>;
  siteUrl: string;
  now: () => Date;
}

const REFUSED: UserCallbackResponse = { status: 400, body: { error: "Invalid signed request." } };

export async function processDeauthorize(signedRequest: string | null, deps: UserCallbackDeps): Promise<UserCallbackResponse> {
  const payload = parseSignedRequest(signedRequest, deps.appSecrets);
  if (!payload) return REFUSED;
  await deps.revoke(payload.user_id);
  return { status: 200, body: {} };
}

export async function processDataDeletion(signedRequest: string | null, deps: UserCallbackDeps): Promise<UserCallbackResponse> {
  const payload = parseSignedRequest(signedRequest, deps.appSecrets);
  if (!payload) return REFUSED;
  await (deps.deleteData ?? deps.revoke)(payload.user_id);

  // The code is signed with the first (main app) secret, and the status page checks it with the same one.
  const code = makeDeletionConfirmationCode(deps.appSecrets[0], deps.now());
  return {
    status: 200,
    body: { url: `${deps.siteUrl.replace(/\/+$/, "")}/legal/data-deletion/status?code=${encodeURIComponent(code)}`, confirmation_code: code },
  };
}
