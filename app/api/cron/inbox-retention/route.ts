import { NextResponse, type NextRequest } from "next/server";
import { runInboxHousekeeping } from "@/lib/inbox/retention/housekeeping";
import { runRetentionSweepForAgency } from "@/lib/inbox/retention/sweep";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";
import { createAdminClient } from "@/utils/supabase/admin";

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (!hasValidBearerSecret(request.headers.get("authorization"), expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const { data: agencies, error } = await db.from("agencies").select("id");
  if (error) return NextResponse.json({ error: "Could not list agencies" }, { status: 500 });
  const result = { agencies: 0, rowsDeleted: 0, failures: 0 };
  for (const agency of (agencies ?? []) as Array<{ id: string }>) {
    const summaries = await runRetentionSweepForAgency(db, agency.id, { dryRun: false });
    result.agencies += 1;
    result.rowsDeleted += summaries.reduce((sum, item) => sum + item.rowsDeleted, 0);
    result.failures += summaries.filter((item) => item.error).length;
  }
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
