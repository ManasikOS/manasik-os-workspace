/**
 * Lead retention sweep, every 10 minutes (pg_cron → public.invoke_cron_route, see
 * supabase/migrations/20261201090000_lead_retention_followups.sql). For each agency, in turn:
 *   1. Phase 1 — notify staff about customers waiting on a person too long;
 *   2. Phase 2 — nudge quiet customers (only when the agency switched it on; dry-run first).
 *
 * Authenticated by `Authorization: Bearer $CRON_SECRET` alone; proxy.ts lets /api/cron/* through without a
 * session. The response carries counts only — never names, messages or ids. Agencies are processed one at a
 * time and one agency failing never stops the rest, so no query ever spans tenants.
 */

import { NextResponse, type NextRequest } from "next/server";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";

import { runHandoffAlertSweep } from "@/lib/followups/handoff-alert-sweep";
import { runQuietLeadSweep } from "@/lib/followups/quiet-lead-sweep";
import { createAdminClient } from "@/utils/supabase/admin";

const BUDGET_MS = 50_000; // stays under the 55 s pg_net timeout

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!hasValidBearerSecret(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deadline = Date.now() + BUDGET_MS;
  const db = createAdminClient();

  const { data: agencies, error } = await db.from("agencies").select("id");
  if (error) {
    console.error("Lead follow-up sweep could not list agencies:", error.message);
    return NextResponse.json({ error: "Could not list agencies" }, { status: 500 });
  }

  const summary = { agencies: 0, failedAgencies: 0, alertsSent: 0, escalationsSent: 0, nudgesSent: 0, nudgesDryRun: 0, nudgesSkipped: 0, nudgesFailed: 0 };
  for (const agency of (agencies ?? []) as { id: string }[]) {
    if (Date.now() >= deadline) break;
    summary.agencies += 1;
    try {
      const alerts = await runHandoffAlertSweep(db, agency.id);
      summary.alertsSent += alerts.alertsSent;
      summary.escalationsSent += alerts.escalationsSent;
    } catch (cause) {
      summary.failedAgencies += 1;
      console.error(`Handoff alert sweep failed for agency ${agency.id}:`, cause instanceof Error ? cause.message : "unknown error");
    }
    try {
      const nudges = await runQuietLeadSweep(db, agency.id, { deadlineMs: deadline });
      summary.nudgesSent += nudges.sent;
      summary.nudgesDryRun += nudges.dryRun;
      summary.nudgesSkipped += nudges.skipped;
      summary.nudgesFailed += nudges.failed;
    } catch (cause) {
      summary.failedAgencies += 1;
      console.error(`Quiet-lead sweep failed for agency ${agency.id}:`, cause instanceof Error ? cause.message : "unknown error");
    }
  }
  return NextResponse.json(summary, { status: 200 });
}
