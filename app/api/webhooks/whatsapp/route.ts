/**
 * Meta WhatsApp Cloud API webhook — the UNKEYED route, verifying against
 * OUR platform Meta app (`META_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN`).
 * Serves every Mode B (Embedded Signup) tenant, since they all connect
 * through our one shared app — as a Tech Provider, one endpoint serves
 * every customer WABA on that app.
 *
 * A Mode A tenant (their own Meta app, their own app secret) is served by
 * the KEYED route instead — `[connectionKey]/route.ts` — because Meta signs
 * their webhook with a secret this route cannot validate. See D3 of
 * docs/modules/whatsapp-meta-connection-implementation-plan.md.
 *
 * proxy.ts's MACHINE_ROUTES entry (F1) is what makes an unauthenticated
 * request to this route reach this handler instead of a 302 to /login.
 */

import type { NextRequest } from "next/server";

import { handleVerifyRequest, handleWebhookDelivery } from "@/lib/whatsapp/webhook-handler";

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;

export async function GET(request: NextRequest) {
  return handleVerifyRequest(request, { verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET });
}

export async function POST(request: NextRequest) {
  return handleWebhookDelivery(request, { verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET });
}
