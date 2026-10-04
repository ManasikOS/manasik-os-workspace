/**
 * Seat Fill Pace (§5.6) — the one genuinely new derivation this dashboard
 * introduces, rather than reassembling a number a module already computes.
 * No completed-season dataset exists anywhere in this schema yet (§12), so
 * the "expected fill" curve is an explicit, editable target — a straight
 * line from 0% at `PACE_WINDOW_DAYS` out to 100% at departure — never
 * something inferred from history.
 *
 * The curve is a code constant for now, not a per-agency setting: doing
 * that properly needs a new `agency_settings` column (there is no existing
 * generic/JSON bucket to piggyback on — checked before writing this), which
 * is a schema migration this phase does not make unasked. See the open
 * question this leaves in docs/modules/dashboard-module-implementation-plan.md §13.1.
 */

import type { Tone } from "@/lib/ui/tone";

/** T-180 → 0% sold, T-0 → 100% sold. The default line every group is judged against. */
export const PACE_WINDOW_DAYS = 180;

export function expectedFillPercentAt(daysUntilDeparture: number): number {
  if (daysUntilDeparture <= 0) return 100;
  if (daysUntilDeparture >= PACE_WINDOW_DAYS) return 0;
  return Math.round(((PACE_WINDOW_DAYS - daysUntilDeparture) / PACE_WINDOW_DAYS) * 100);
}

export interface SeatPacePoint {
  groupId: string;
  groupName: string;
  groupCode: string;
  daysUntilDeparture: number;
  fillPercent: number;
  expectedFillPercent: number;
  paceTone: Tone;
  destination: string;
}

/** How far below the target line a group has to fall before it's "at risk" rather than merely "watch." */
const WARNING_GAP_POINTS = 15;

function paceToneFor(fillPercent: number, expectedFillPercent: number): Tone {
  const gap = expectedFillPercent - fillPercent;
  if (gap <= 0) return "success";
  if (gap <= WARNING_GAP_POINTS) return "warning";
  return "danger";
}

/**
 * One point per active, not-yet-departed group — `bookedSeats / capacity`
 * against the target line for that group's `daysUntilDeparture`. Sorted
 * soonest-departing first and capped, same progressive-disclosure rule as
 * every other panel: top N plus a link to the full list.
 */
export function buildSeatPacePoints(
  groups: { id: string; groupName: string; groupCode: string; daysUntilDeparture: number; bookedSeats: number; capacity: number }[],
  limit = 20,
): SeatPacePoint[] {
  return groups
    .filter((g) => g.daysUntilDeparture >= 0 && g.capacity > 0)
    .sort((a, b) => a.daysUntilDeparture - b.daysUntilDeparture)
    .slice(0, limit)
    .map((g) => {
      const fillPercent = Math.round((g.bookedSeats / g.capacity) * 100);
      const expectedFillPercent = expectedFillPercentAt(g.daysUntilDeparture);
      return {
        groupId: g.id,
        groupName: g.groupName,
        groupCode: g.groupCode,
        daysUntilDeparture: g.daysUntilDeparture,
        fillPercent,
        expectedFillPercent,
        paceTone: paceToneFor(fillPercent, expectedFillPercent),
        destination: `/departure-groups/${g.id}`,
      };
    });
}
