/**
 * The Inbox SLA sweep, every two minutes (pg_cron → public.invoke_cron_route, see
 * supabase/migrations/20261202091100_mi2_6_inbox_sla_policies.sql). For each agency it recomputes reply deadlines for
 * waiting conversations, refreshes the deadline queues, and records breaches (lib/inbox/sla/sweep.ts). Idempotent: an
 * overlapping or repeated run rewrites nothing that has not changed.
 *
 * Authenticated by `Authorization: Bearer $CRON_SECRET` alone; proxy.ts lets /api/cron/* through without a session.
 * The response carries counts only. One agency failing does not stop the others.
 */

import { NextResponse, type NextRequest } from "next/server";

import { repairMissingEnrichJobs, repairMissingMediaJobs } from "@/lib/inbox/jobs/repair";
import { runSlaSweepForAgency } from "@/lib/inbox/sla/sweep";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";
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
  const { data: agencies, error } = await db.from("agencies").select("id");
  if (error) {
    console.error("SLA sweep could not list agencies:", error.message);
    return NextResponse.json({ error: "Could not list agencies" }, { status: 500 });
  }

  const totals = { agencies: 0, examined: 0, deadlinesWritten: 0, queuesRefreshed: 0, breached: 0, interventionsOpened: 0, enrichJobsRepaired: 0, mediaJobsRepaired: 0, failed: 0, failedAgencies: 0 };
  for (const agency of (agencies ?? []) as Array<{ id: string }>) {
    try {
      const summary = await runSlaSweepForAgency(db, agency.id);
      totals.agencies += 1;
      totals.examined += summary.examined;
      totals.deadlinesWritten += summary.deadlinesWritten;
      totals.queuesRefreshed += summary.queuesRefreshed;
      totals.breached += summary.breached;
      totals.interventionsOpened += summary.interventionsOpened;
      totals.failed += summary.failed;
      // The SC1 guarantee's repair path: a recent customer message with no reading and no live enrichment job gets one.
      totals.enrichJobsRepaired += await repairMissingEnrichJobs(db, agency.id);
      totals.mediaJobsRepaired += await repairMissingMediaJobs(db, agency.id);
    } catch (cause) {
      totals.failedAgencies += 1;
      console.error(`SLA sweep failed for agency ${agency.id}:`, cause instanceof Error ? cause.message : cause);
    }
  }
  return NextResponse.json(totals, { status: totals.failedAgencies > 0 ? 500 : 200 });
}
