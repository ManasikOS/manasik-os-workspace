/**
 * Meta's "Data Deletion Request Callback URL": a user asked Meta to delete the data an app holds about them. The
 * request is a signed form post; a forged one is a 400. The answer Meta requires is JSON with a status `url` and a
 * `confirmation_code` — see lib/meta/user-callbacks.ts and app/legal/data-deletion/status.
 *
 * proxy.ts exempts `/api/webhooks/*` from the session redirect, so Meta's unauthenticated POST reaches this handler.
 */

import type { NextRequest } from "next/server";

import { processDataDeletion } from "@/lib/meta/user-callbacks";
import { buildUserCallbackDeps, readSignedRequestField, toJsonResponse } from "@/lib/meta/user-callback-runtime";

export async function POST(request: NextRequest) {
  return toJsonResponse(await processDataDeletion(await readSignedRequestField(request), await buildUserCallbackDeps()));
}
