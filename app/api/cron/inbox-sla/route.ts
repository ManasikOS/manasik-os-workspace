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

import { forEachAgencyWithinBudget } from "@/lib/inbox/cron-agency-run";
import { repairMissingEnrichJobs, repairMissingMediaJobs } from "@/lib/inbox/jobs/repair";
import { runSlaSweepForAgency } from "@/lib/inbox/sla/sweep";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";
import { createAdminClient } from "@/utils/supabase/admin";

/** How often the sweep is scheduled (every two minutes), so the starting agency moves on by one each run. */
const SLA_SWEEP_INTERVAL_MS = 2 * 60_000;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!hasValidBearerSecret(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  // A fixed order, so the rotation below moves through the same list each run.
  const { data: agencies, error } = await db.from("agencies").select("id").order("id");
  if (error) {
    console.error("SLA sweep could not list agencies:", error.message);
    return NextResponse.json({ error: "Could not list agencies" }, { status: 500 });
  }

  const totals = { agencies: 0, examined: 0, deadlinesWritten: 0, queuesRefreshed: 0, breached: 0, interventionsOpened: 0, enrichJobsRepaired: 0, mediaJobsRepaired: 0, failed: 0, failedAgencies: 0, notReached: 0 };
  // Each run starts at a different agency and stops starting new ones when the budget is spent, so a growing list can neither
  // outlast the function limit nor leave the same agencies at the end unswept every time (BUG-11).
  const outcome = await forEachAgencyWithinBudget((agencies ?? []) as Array<{ id: string }>, {
    sliceMs: SLA_SWEEP_INTERVAL_MS,
    run: async (agency) => {
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
    },
    onError: (agency, cause) => console.error(`SLA sweep failed for agency ${agency.id}:`, cause instanceof Error ? cause.message : cause),
  });
  totals.failedAgencies = outcome.failed;
  totals.notReached = outcome.notReached;
  if (outcome.deadlineReached) console.warn(`SLA sweep ran out of time; ${outcome.notReached} agencies wait for the next run.`);
  return NextResponse.json(totals, { status: totals.failedAgencies > 0 ? 500 : 200 });
}
