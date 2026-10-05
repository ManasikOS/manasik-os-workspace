/**
 * Inbound email poll (EM2, docs/inbox/email-channel-implementation-plan.md, Phase 2).
 *
 *   GET /api/cron/inbox-email-poll — polls every agency with a CONNECTED GMAIL channel connection, one
 *   IMAP session per agency. One agency's failure never blocks another's.
 *
 * Authenticated by `Authorization: Bearer $CRON_SECRET` alone, same as every other Inbox cron route
 * (`proxy.ts` already lets `/api/cron/*` through without a session).
 */

import { NextResponse, type NextRequest } from "next/server";

import { pollAgencyMailbox } from "@/lib/channels/email/imap-poll";
import { forEachAgencyWithinBudget } from "@/lib/inbox/cron-agency-run";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";
import { createAdminClient } from "@/utils/supabase/admin";

/** Stays inside Vercel's function limit even when several mailboxes are slow to answer. */
const POLL_BUDGET_MS = 45_000;
/** How often the poll is scheduled (every two minutes), so the starting mailbox moves on by one each tick. */
const POLL_INTERVAL_MS = 2 * 60_000;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (!hasValidBearerSecret(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const { data: connections, error } = await db.from("channel_connections").select("agency_id").eq("provider", "GMAIL").eq("status", "CONNECTED").order("agency_id");
  if (error) return NextResponse.json({ error: `Could not list connected mailboxes: ${error.message}` }, { status: 500 });

  // The deadline alone would cut off the same mailboxes at the end of the list every tick, so each tick also starts at a different one (BUG-11).
  const results: Array<Awaited<ReturnType<typeof pollAgencyMailbox>>> = [];
  await forEachAgencyWithinBudget(
    (connections ?? []).map((row) => ({ id: String((row as { agency_id: string }).agency_id) })),
    {
      sliceMs: POLL_INTERVAL_MS,
      budgetMs: POLL_BUDGET_MS,
      run: async ({ id: agencyId }) => {
        try {
          results.push(await pollAgencyMailbox(db, agencyId));
        } catch (cause) {
          // pollAgencyMailbox reports its own failures as a value and should never throw; this is a last resort
          // so one agency's unexpected error can never take down the tick for every other agency.
          console.error(`Inbox email poll crashed for agency ${agencyId}:`, cause instanceof Error ? cause.message : cause);
          results.push({ agencyId, status: "error", processed: 0, skipped: 0, error: cause instanceof Error ? cause.message : String(cause) });
        }
      },
    },
  );

  const polled = results.length;
  const errors = results.filter((result) => result.status === "error" || result.status === "auth_failed").length;
  return NextResponse.json({ mailboxes: connections?.length ?? 0, polled, errors, results }, { status: 200 });
}
