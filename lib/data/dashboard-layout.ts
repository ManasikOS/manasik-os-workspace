/**
 * Role → panel presence and order for the Dashboard's L2/L3 sections
 * (docs/modules/dashboard-module-implementation-plan.md §4.2).
 *
 * Pure, client-safe, no I/O — a role never sees a panel because it is
 * missing from its entry here, but *whether the underlying data is fetched
 * or gated* is still decided exclusively by the existing `capabilitiesFor*()`
 * functions in `lib/data/dashboard-repository.ts`. This file only decides
 * which of the already-permitted panels to show, and in what order.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";

export type DashboardPanelId =
  | "pipeline"

  | "my-day"
  | "upcoming-departures"
  | "attention-rail"
  | "approvals"
  | "seat-fill-pace"
  /** Renders Revenue Trend stacked above Receivables Aging as one grid cell — see page.tsx's `renderDashboardPanels`. */
  | "revenue-trend"
  | "readiness-heatmap"
  | "collections"
  | "team-performance"
  | "recent-activity";

/**
 * "Business Health" used to be one tabbed panel (revenue / collections /
 * receivables / margin) gated behind clicks. Split into always-visible
 * panels — `seat-fill-pace` as the headline forward-looking chart, paired
 * with `revenue-trend` (which itself stacks Revenue Trend above Receivables
 * Aging as one cell — see page.tsx) alongside it — so a role sees the shape
 * of the business at a glance instead of one tab at a time. Both still read
 * from the same `data.businessHealth` / `data.seatPace` sources the
 * repository already gates identically to before — this file only changed
 * which panels exist and their order, not what's fetched or who can see it.
 */
export const DASHBOARD_LAYOUTS: Record<StaffRole, DashboardPanelId[]> = {
  ADMIN: [
    "pipeline",
    "my-day",
    "revenue-trend",
    "attention-rail",
    "approvals",
    "upcoming-departures",
    "seat-fill-pace",
    "readiness-heatmap",
    "team-performance",
    "collections",
    "recent-activity",
  ],
  CEO: ["pipeline","seat-fill-pace", "revenue-trend", "upcoming-departures", "attention-rail",  "team-performance"],
  FINANCE: ["my-day", "collections", "attention-rail", "revenue-trend", "upcoming-departures"],
  MARKETING: ["my-day", "pipeline", "seat-fill-pace", "team-performance", "attention-rail"],
  OPERATIONS: [
    "my-day",
    "attention-rail",
    "approvals",
    "upcoming-departures",
    "seat-fill-pace",
    "readiness-heatmap",
    "recent-activity",
  ],
  VISA: ["my-day", "attention-rail", "upcoming-departures", "recent-activity"],
  GUIDE: ["my-day", "upcoming-departures", "recent-activity"],
};

export function resolveDashboardLayout(role: StaffRole): DashboardPanelId[] {
  return DASHBOARD_LAYOUTS[role] ?? DASHBOARD_LAYOUTS.GUIDE;
}
