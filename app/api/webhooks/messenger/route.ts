/**
 * Meta Messenger webhook (`object: "page"`) — one endpoint for every agency's Facebook Page, verified against
 * OUR Meta app (`META_APP_SECRET` for signatures, `MESSENGER_VERIFY_TOKEN` for the subscription handshake).
 * The agency is resolved from the Page id in the payload; an unknown Page is recorded and dropped.
 *
 * proxy.ts exempts `/api/webhooks/*` from the session redirect, so Meta's unauthenticated POST reaches this
 * handler instead of a 302 to /login.
 */

import type { NextRequest } from "next/server";

import { handleMessengerDelivery, handleMessengerVerify } from "@/lib/channels/messenger/webhook-handler";

export async function GET(request: NextRequest) {
  return handleMessengerVerify(request);
}

export async function POST(request: NextRequest) {
  return handleMessengerDelivery(request);
}
