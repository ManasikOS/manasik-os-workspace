/**
 * Meta's "Deauthorize Callback URL": a user removed the app from their Facebook settings. The request is a signed
 * form post; a forged one is a 400. What it does — disconnect the Messenger and Instagram connections that user
 * made and delete their stored tokens — is in lib/channels/meta-user-revocation.ts.
 *
 * proxy.ts exempts `/api/webhooks/*` from the session redirect, so Meta's unauthenticated POST reaches this handler.
 */

import type { NextRequest } from "next/server";

import { processDeauthorize } from "@/lib/meta/user-callbacks";
import { buildUserCallbackDeps, readSignedRequestField, toJsonResponse } from "@/lib/meta/user-callback-runtime";

export async function POST(request: NextRequest) {
  return toJsonResponse(await processDeauthorize(await readSignedRequestField(request), await buildUserCallbackDeps()));
}
