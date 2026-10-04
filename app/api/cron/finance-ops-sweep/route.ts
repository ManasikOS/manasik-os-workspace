/**
 * The nightly Finance review agent's cron entrypoint — Phase 1 (P1.7).
 * Mirrors `app/api/cron/departure-ops-jobs/route.ts`'s auth shape exactly
 * (same `CRON_SECRET` bearer check). Wire this to run hourly — the sweep
 * itself is cheap for every agency that isn't due yet (`sweepOneAgency`
 * exits after one `ai_runs` lookup), and the 06:00-agency-time cadence
 * means only agencies actually crossing that local hour do any real work
 * on a given invocation.
 */

import { NextResponse, type NextRequest } from "next/server";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";

import { sweepFinanceOpsAgencies } from "@/lib/ai/surfaces/finance/agent/scheduler";
import { createAdminClient } from "@/utils/supabase/admin";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!hasValidBearerSecret(authHeader, CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const results = await sweepFinanceOpsAgencies(db);
  return NextResponse.json({ agencies: results.length, results }, { status: 200 });
}
