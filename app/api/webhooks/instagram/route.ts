/**
 * Meta Instagram webhook (`object: "instagram"`) — one endpoint for every agency's Instagram professional
 * account, verified against OUR Meta app (`META_APP_SECRET` for signatures, `INSTAGRAM_VERIFY_TOKEN` — or the
 * Messenger one — for the subscription handshake). The agency is resolved from the Instagram account id in the
 * payload (`entry.id`); an unknown account is recorded and dropped.
 *
 * It is the Messenger handler serving the Instagram channel: the two share one implementation
 * (lib/channels/messenger/webhook-handler.ts), told which channel it is answering for.
 *
 * proxy.ts exempts `/api/webhooks/*` from the session redirect, so Meta's unauthenticated POST reaches this
 * handler instead of a 302 to /login.
 */

import type { NextRequest } from "next/server";

import { handleMessengerDelivery, handleMessengerVerify } from "@/lib/channels/messenger/webhook-handler";

export async function GET(request: NextRequest) {
  return handleMessengerVerify(request, "INSTAGRAM");
}

export async function POST(request: NextRequest) {
  return handleMessengerDelivery(request, "INSTAGRAM");
}
