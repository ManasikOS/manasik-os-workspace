/**
 * Releases expired seat holds, on a schedule.
 *
 * `releaseGroupExpiredSeatHolds()` (lib/data/departure-groups.ts) has always
 * existed and is correct, but the only caller was the group screen's own
 * "release expired holds" Server Action — a staff member has to actually
 * open the group and click it. Nothing ever swept holds on its own, so a
 * `HELD` booking whose `seat_hold_expiry_hours` window passed simply stayed
 * held indefinitely (seats gone from `available_seats`, nobody paying for
 * them, no error anywhere) until someone happened to look.
 *
 * Same posture as `app/api/cron/agent-jobs/route.ts`: wire this to a
 * scheduler that can hit a URL periodically (hourly is enough — a hold's
 * granularity is `seat_hold_expiry_hours`, not minutes), pointed here with
 * `Authorization: Bearer $CRON_SECRET`. `proxy.ts`'s MACHINE_ROUTES entry
 * already covers `/api/cron` as a prefix, so no change was needed there.
 */

import { NextResponse, type NextRequest } from "next/server";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";

import {
  listGroupIdsWithExpiredSeatHolds,
  releaseGroupExpiredSeatHolds,
} from "@/lib/data/departure-groups";
import type { GroupActor } from "@/lib/types/departure-groups";
import { createAdminClient } from "@/utils/supabase/admin";

const CRON_SECRET = process.env.CRON_SECRET;

// No new row is ever inserted by this sweep — it only flips existing
// bookings/pilgrims/rooms to CANCELLED/UNASSIGNED — so there is no tenant to
// stamp and `agencyId: null` is correct rather than a gap (see `persistStore`
// in departure-groups-repository.ts: agency stamping only ever applies to
// inserts).
const SWEEPER_ACTOR: GroupActor = { id: null, name: "Seat Hold Sweeper", agencyId: null };

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!hasValidBearerSecret(authHeader, CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const groupIds = await listGroupIdsWithExpiredSeatHolds(db);

  let releasedBookings = 0;
  let releasedSeats = 0;
  const failures: { groupId: string; error: string }[] = [];

  for (const groupId of groupIds) {
    try {
      const outcome = await releaseGroupExpiredSeatHolds(groupId, {
        client: db,
        actor: SWEEPER_ACTOR,
      });
      releasedBookings += outcome.result.releasedBookings;
      releasedSeats += outcome.result.releasedSeats;
    } catch (error) {
      // One group's failure must not stop the sweep for every other group
      // waiting behind it in the same run.
      failures.push({
        groupId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json(
    { groupsChecked: groupIds.length, releasedBookings, releasedSeats, failures },
    { status: 200 },
  );
}
