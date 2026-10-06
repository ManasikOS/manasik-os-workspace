import { NextResponse, type NextRequest } from "next/server";

import { forEachAgencyWithinBudget } from "@/lib/inbox/cron-agency-run";
import { runTravellerRetentionForAgency } from "@/lib/data/traveller-data-retention";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Nightly erasure of traveller passport, contact and file details 24 months after a group's return date
 * (docs/tasks/TASK-037-departure-groups-security-and-flaw-remediation.md, SEC-12).
 *
 * SAFE BY DEFAULT: unless TRAVELLER_RETENTION_LIVE=true is set the route only reports what it WOULD erase
 * (a dry run), and `?dryRun=1` forces a dry run even then. Read the dry-run numbers before turning it live.
 * Erasure is permanent.
 */

const SWEEP_INTERVAL_MS = 24 * 60 * 60_000;
const AGENCY_BUDGET_MS = 40_000;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (!hasValidBearerSecret(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const live = process.env.TRAVELLER_RETENTION_LIVE === "true" && request.nextUrl.searchParams.get("dryRun") !== "1";

  const db = createAdminClient();
  const { data: agencies, error } = await db.from("agencies").select("id").order("id");
  if (error) return NextResponse.json({ error: "Could not list agencies" }, { status: 500 });

  const totals = { dryRun: !live, agencies: 0, travellersConsidered: 0, travellersErased: 0, travellersSkipped: 0, filesRemoved: 0, accessLogRowsRemoved: 0, failures: 0, notReached: 0 };

  const outcome = await forEachAgencyWithinBudget((agencies ?? []) as Array<{ id: string }>, {
    sliceMs: SWEEP_INTERVAL_MS,
    budgetMs: AGENCY_BUDGET_MS,
    run: async (agency) => {
      const summary = await runTravellerRetentionForAgency(db, agency.id, { dryRun: !live });
      totals.agencies += 1;
      totals.travellersConsidered += summary.travellersConsidered;
      totals.travellersErased += summary.travellersErased;
      totals.travellersSkipped += summary.travellersSkipped;
      totals.filesRemoved += summary.filesRemoved;
      totals.accessLogRowsRemoved += summary.accessLogRowsRemoved;
      totals.failures += summary.failures;
    },
    onError: (agency, cause) =>
      console.error(`Traveller retention failed for agency ${agency.id}:`, cause instanceof Error ? cause.message : cause),
  });
  totals.failures += outcome.failed;
  totals.notReached = outcome.notReached;

  return NextResponse.json(totals, { status: totals.failures > 0 ? 500 : 200 });
}
