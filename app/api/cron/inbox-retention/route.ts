import { NextResponse, type NextRequest } from "next/server";
import { forEachAgencyWithinBudget } from "@/lib/inbox/cron-agency-run";
import { runInboxHousekeeping } from "@/lib/inbox/retention/housekeeping";
import { runRetentionSweepForAgency } from "@/lib/inbox/retention/sweep";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";
import { createAdminClient } from "@/utils/supabase/admin";

/** Scheduled once a day, so the starting agency moves on by one each day. */
const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60_000;
/** Leaves room in the function limit for the unattributed purge and housekeeping that follow the agency loop. */
const RETENTION_AGENCY_BUDGET_MS = 30_000;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (!hasValidBearerSecret(request.headers.get("authorization"), expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  // A fixed order, so the rotation below moves through the same list each run.
  const { data: agencies, error } = await db.from("agencies").select("id").order("id");
  if (error) return NextResponse.json({ error: "Could not list agencies" }, { status: 500 });
  const result = { agencies: 0, rowsDeleted: 0, failures: 0, notReached: 0 };
  // Each run starts at a different agency and stops starting new ones when the budget is spent (BUG-11). The budget is shorter than
  // the other sweeps' because the purge and housekeeping below still have to run after it. An agency that throws is counted as a
  // failure and the rest still run, where before it ended the whole route.
  const outcome = await forEachAgencyWithinBudget((agencies ?? []) as Array<{ id: string }>, {
    sliceMs: RETENTION_SWEEP_INTERVAL_MS,
    budgetMs: RETENTION_AGENCY_BUDGET_MS,
    run: async (agency) => {
      const summaries = await runRetentionSweepForAgency(db, agency.id, { dryRun: false });
      result.agencies += 1;
      result.rowsDeleted += summaries.reduce((sum, item) => sum + item.rowsDeleted, 0);
      result.failures += summaries.filter((item) => item.error).length;
    },
    onError: (agency, cause) => console.error(`Retention sweep failed for agency ${agency.id}:`, cause instanceof Error ? cause.message : cause),
  });
  result.failures += outcome.failed;
  result.notReached = outcome.notReached;
  if (outcome.deadlineReached) console.warn(`Retention sweep ran out of time; ${outcome.notReached} agencies wait for the next run.`);
  // Raw deliveries that belong to no agency (unknown number or Page, rejected signature) are out of reach of the per-agency sweep above.
  // A failure here (for example before the D1 migration is applied) is counted, not fatal to the sweep that already ran.
  let unattributedDeleted = 0;
  for (let batch = 0; batch < 10; batch += 1) {
    const { data, error: purgeError } = await db.rpc("purge_unattributed_raw_events", { p_days: 30, p_batch: 2000 });
    if (purgeError) {
      result.failures += 1;
      break;
    }
    const deleted = Number(data ?? 0);
    unattributedDeleted += deleted;
    if (deleted < 2000) break;
  }
  // Staff files that were uploaded but never sent. Counted, not fatal, like the purge above.
  const housekeeping = await runInboxHousekeeping(db);
  result.failures += housekeeping.failures;
  return NextResponse.json(
    { ...result, unattributedDeleted, orphanUploadsRemoved: housekeeping.orphanUploadsRemoved },
    { status: result.failures > 0 ? 500 : 200 },
  );
}
