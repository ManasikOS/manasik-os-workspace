/**
 * Liveness: is the web app process up and serving? (TASK-028 P1.4.) Deliberately depends on nothing: no database, no secrets. A
 * database blip must not make an orchestrator restart a healthy app, so that question is answered separately by /api/health/ready.
 *
 * Public by design, like /api/webhooks and /api/cron in proxy.ts (a load balancer or uptime monitor carries no session). The body is
 * a status word and the short build id; nothing about configuration, customers or agencies.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", build: (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 7) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
