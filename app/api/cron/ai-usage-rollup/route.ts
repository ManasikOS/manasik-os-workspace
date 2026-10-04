/**
 * AI usage rollup, hourly at :15 (pg_cron → public.invoke_cron_route, see
 * supabase/migrations/20261202090000_mi0_1_ai_usage_daily.sql). Recomputes `ai_usage_daily` for yesterday and
 * today (UTC) from ai_runs + agent_runs. The SQL function is idempotent, so overlapping or repeated runs are safe.
 *
 * Authenticated by `Authorization: Bearer $CRON_SECRET` alone; proxy.ts lets /api/cron/* through without a
 * session. The response carries counts only.
 */

import { NextResponse, type NextRequest } from "next/server";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";

import { rollupDaysFor } from "@/lib/ai/usage-rollup";
import { createAdminClient } from "@/utils/supabase/admin";

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!hasValidBearerSecret(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const summary = { days: 0, rowsWritten: 0, failedDays: 0 };
  for (const day of rollupDaysFor(new Date())) {
    const { data, error } = await db.rpc("rollup_ai_usage_daily", { p_day: day });
    if (error) {
      summary.failedDays += 1;
      console.error(`AI usage rollup failed for ${day}:`, error.message);
      continue;
    }
    summary.days += 1;
    summary.rowsWritten += typeof data === "number" ? data : 0;
  }
  return NextResponse.json(summary, { status: summary.failedDays > 0 ? 500 : 200 });
}
