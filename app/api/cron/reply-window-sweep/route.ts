import { NextResponse, type NextRequest } from "next/server";

import { runWindowReminderSweepForAgency } from "@/lib/inbox/window-sweep";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";
import { createAdminClient } from "@/utils/supabase/admin";

const BUDGET_MS = 50_000; // stays under the 55 s pg_net timeout

/**
 * Reminds the owner of a person-owned chat whose reply window closes within two hours and has not been answered (decision R9; replaces the
 * Inngest reply-window reminder). Run by pg_cron every five minutes through `invoke_cron_route`. Idempotent: the follow-up ledger makes the
 * reminder exactly-once per unanswered customer message, so an overlapping or repeated run sends nothing extra. Counts only in the answer.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (!hasValidBearerSecret(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deadline = Date.now() + BUDGET_MS;
  const db = createAdminClient();
  const { data: agencies, error } = await db.from("agencies").select("id");
  if (error) {
    console.error("Reply-window sweep could not list agencies:", error.message);
    return NextResponse.json({ error: "Could not list agencies" }, { status: 500 });
  }

  const totals = { agencies: 0, failedAgencies: 0, examined: 0, reminded: 0, alreadyHandled: 0, skipped: 0, notified: 0, failed: 0 };
  for (const agency of (agencies ?? []) as Array<{ id: string }>) {
    if (Date.now() >= deadline) break; // the rest wait for the next run
    try {
      const summary = await runWindowReminderSweepForAgency(db, agency.id, { deadlineMs: deadline });
      totals.agencies += 1;
      totals.examined += summary.examined;
      totals.reminded += summary.reminded;
      totals.alreadyHandled += summary.alreadyHandled;
      totals.skipped += summary.skipped;
      totals.notified += summary.notified;
      totals.failed += summary.failed;
    } catch (cause) {
      totals.failedAgencies += 1;
      console.error(`Reply-window sweep failed for agency ${agency.id}:`, cause instanceof Error ? cause.message : "unknown error");
    }
  }
  return NextResponse.json(totals, { status: totals.failedAgencies > 0 || totals.failed > 0 ? 500 : 200 });
}
