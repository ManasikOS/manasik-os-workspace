/**
 * Queue drain, on a schedule. The guarantee that a job still runs even when
 * the webhook's opportunistic `after()` kick never fires (the process died,
 * the deployment restarted mid-request). See §6.3 of
 * docs/modules/whatsapp-ai-agent-implementation-plan.md.
 *
 * Wire this to Vercel Cron (or any scheduler that can hit a URL once a
 * minute) pointed at this route with `Authorization: Bearer $CRON_SECRET`.
 * proxy.ts's MACHINE_ROUTES entry (F1) keeps this reachable without a
 * Supabase session — CRON_SECRET is the only auth this route has.
 */

import { NextResponse, type NextRequest } from "next/server";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";

import { processDueJobs } from "@/lib/agent/whatsapp/drain";
import "@/lib/inbox/intelligence/register-handlers";
import { reconcileRawEvents } from "@/lib/inbox/reconcile/raw-events";
import { drainDeliveryEvents } from "@/lib/inbox/delivery/delivery-updates";
import { processDueInboxOutbox } from "@/lib/inbox/outbox/drain";
import { createAdminClient } from "@/utils/supabase/admin";
import { processAllLanes } from "@/lib/inbox/jobs/drain";

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

  // The three channel_jobs lanes (MI1.2) run alongside the two existing drains; their budgets sum to under BUDGET_MS.
  // Buffered delivery ticks (Q4): the safety net for the worker's own loop, so a tick is never left waiting because no worker is up.
  const [agent, outbox, lanes, deliveries, reconciled] = await Promise.all([
    processDueJobs({ budgetMs: BUDGET_MS }),
    processDueInboxOutbox({ budgetMs: BUDGET_MS }),
    processAllLanes({ totalBudgetMs: BUDGET_MS }),
    // Must not take the other drains down with it (for example before the Q4 migration is applied).
    drainDeliveryEvents(createAdminClient(), { budgetMs: 10_000 }).catch((error) => {
      console.error("delivery status drain failed:", error instanceof Error ? error.message : error);
      return { processed: 0, failed: 0, changed: 0 };
    }),
    // Repairs a delivery whose messages never landed (I2); also the safety net for the worker's own once-a-minute pass.
    reconcileRawEvents(createAdminClient()).catch((error) => {
      console.error("raw event reconcile failed:", error instanceof Error ? error.message : error);
      return { checked: 0, landed: 0, replayed: 0, failed: 0 };
    }),
  ]);
  return NextResponse.json({ agent, outbox, lanes, deliveries, reconciled }, { status: 200 });
}
