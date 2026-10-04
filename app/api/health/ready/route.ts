/**
 * Readiness: can the web app reach what it needs to do real work? (TASK-028 P1.4.) It runs one trivial read against the database with
 * a three-second limit and answers 503 when that fails, so an uptime monitor or deploy gate can tell "up but cut off from its
 * database" from "healthy".
 *
 * Public by design (see /api/health). The body names which check failed and nothing more: no error text, host name or key can leak
 * through it. Failures are logged as a structured event and reported to Sentry with the same scrubbing as every other report.
 */

import { NextResponse } from "next/server";

import { logEvent } from "@/lib/observability/log";
import { reportHandledError } from "@/lib/observability/report-error";
import { createAdminClient } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

const DATABASE_TIMEOUT_MS = 3_000;
const NO_STORE = { "Cache-Control": "no-store" };

async function databaseIsReachable(): Promise<boolean> {
  try {
    const { error } = await createAdminClient().from("agencies").select("id").limit(1).abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
    if (error) {
      logEvent("error", "health.ready.database_failed", { code: error.code ?? null });
      reportHandledError("health.ready.database", new Error(error.message));
      return false;
    }
    return true;
  } catch (cause) {
    logEvent("error", "health.ready.database_unreachable");
    reportHandledError("health.ready.database", cause);
    return false;
  }
}

export async function GET() {
  const database = await databaseIsReachable();
  return NextResponse.json({ status: database ? "ready" : "not_ready", checks: { database } }, { status: database ? 200 : 503, headers: NO_STORE });
}
