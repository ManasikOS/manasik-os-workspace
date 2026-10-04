/**
 * Queue drain, on a schedule — the Departure Operations Agent's own cron
 * route, mirroring `app/api/cron/agent-jobs/route.ts` exactly (same
 * `CRON_SECRET` bearer auth, same budgeted-drain shape), pointed at
 * `departure_ops_jobs` instead. See §10.2 of
 * docs/modules/departure-operations-agent-implementation-plan.md.
 *
 * Wire this to a scheduler (Vercel Cron or equivalent) hitting it every 15
 * minutes with `Authorization: Bearer $CRON_SECRET`. `proxy.ts`'s
 * `MACHINE_ROUTES` entry already covers every path under `/api/cron`, so
 * this route needs no additional proxy change.
 */

import { NextResponse, type NextRequest } from "next/server";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";

import { processDueDepartureOpsJobs } from "@/lib/agent/departure-ops/drain";

const CRON_SECRET = process.env.CRON_SECRET;
const BUDGET_MS = 50_000; // stays under most serverless function timeouts with headroom to spare

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!hasValidBearerSecret(authHeader, CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processDueDepartureOpsJobs({ budgetMs: BUDGET_MS });
  return NextResponse.json(result, { status: 200 });
}
