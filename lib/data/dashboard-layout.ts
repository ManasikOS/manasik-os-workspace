/**
 * Role → block presence and order for the whole Dashboard
 * (docs/modules/dashboard-role-blocks-spec.md §2,
 * docs/modules/dashboard-module-implementation-plan.md §4.2).
 *
 * Pure, client-safe, no I/O — a role never sees a block because it is
 * missing from its entry here, but *whether it may* is decided by
 * `BLOCK_GATES` (lib/access/dashboard-access.ts) from capabilities, and
 * whether its data is fetched or gated is decided by
 * `lib/data/dashboard-repository.ts`. This file only decides which blocks a
 * role's page prefers, and in what order.
 *
 * A custom role has no entry of its own: `StaffRole` is its *base* role, so
 * it starts from that role's preset and `visibleBlocks()` then prunes it to
 * what its saved permissions allow.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Runtime list of every block id — `BLOCK_GATES` is a `Record` over this
 * union, so a block cannot be added here without also declaring who may see
 * it. "revenue-trend" renders Revenue Trend stacked above Receivables Aging
 * as one grid cell — see page.tsx's `renderDashboardPanels`.
 */
export const DASHBOARD_PANEL_IDS = [
  // Full-width banner blocks, stacked above the grid.
  "ai-briefing", // carries the status line
  "kpis",
  "inbox-owner",
  // Grid panels.
  "pipeline",
  "my-day",
  "upcoming-departures",
  "attention-rail",
  "approvals",
  "seat-fill-pace",
  "revenue-trend",
  "readiness-heatmap",
  "collections",
  "team-performance",
  "recent-activity",
  "visa-queue",
  "document-review",
] as const;

export type DashboardPanelId = (typeof DASHBOARD_PANEL_IDS)[number];

/** Blocks rendered full-width above the 12-column grid, in preset order. Everything else is a grid panel. */
export const DASHBOARD_BANNER_BLOCKS = ["ai-briefing", "kpis", "inbox-owner"] as const;
export type DashboardBannerBlockId = (typeof DASHBOARD_BANNER_BLOCKS)[number];
export type DashboardGridPanelId = Exclude<DashboardPanelId, DashboardBannerBlockId>;

const BANNER_SET: ReadonlySet<string> = new Set(DASHBOARD_BANNER_BLOCKS);

export function isBannerBlock(id: DashboardPanelId): id is DashboardBannerBlockId {
  return BANNER_SET.has(id);
}

/** Splits a resolved block list into the full-width banners and the grid panels, each keeping its order. */
export function splitDashboardBlocks(ids: readonly DashboardPanelId[]): {
  banners: DashboardBannerBlockId[];
  panels: DashboardGridPanelId[];
} {
  const banners: DashboardBannerBlockId[] = [];
  const panels: DashboardGridPanelId[] = [];
  for (const id of ids) {
    if (isBannerBlock(id)) banners.push(id);
    else panels.push(id);
  }
  return { banners, panels };
}

/**
 * Order follows the Answer → Act → Understand layers (spec §2 rule 5: the
 * hero is the role's job). Every role opens with the briefing and KPI row;
 * only ADMIN and CEO get the inbox owner panel.
 *
 * Non-ADMIN presets stay at ≤ 8 grid panels (tested). ADMIN owns every
 * module and is the one exception.
 */
export const DASHBOARD_LAYOUTS: Record<StaffRole, DashboardPanelId[]> = {
  ADMIN: [
    "ai-briefing",
    "kpis",
    "inbox-owner",
    "my-day",
    "attention-rail",
    "approvals",
    "upcoming-departures",
    "revenue-trend",
    "seat-fill-pace",
    "readiness-heatmap",
    "pipeline",
    "collections",
    "team-performance",
    "recent-activity",
  ],
  CEO: [
    "ai-briefing",
    "kpis",
    "inbox-owner",
    "revenue-trend",
    "seat-fill-pace",
    "upcoming-departures",
    "attention-rail",
    "pipeline",
    "team-performance",
  ],
  FINANCE: ["ai-briefing", "kpis", "my-day", "collections", "attention-rail", "revenue-trend", "upcoming-departures"],
  MARKETING: ["ai-briefing", "kpis", "my-day", "pipeline", "attention-rail", "seat-fill-pace", "team-performance"],
  OPERATIONS: [
    "ai-briefing",
    "kpis",
    "my-day",
    "attention-rail",
    "approvals",
    "visa-queue",
    "upcoming-departures",
    "readiness-heatmap",
    "seat-fill-pace",
    "recent-activity",
  ],
  VISA: [
    "ai-briefing",
    "kpis",
    "visa-queue",
    "document-review",
    "my-day",
    "attention-rail",
    "upcoming-departures",
    "recent-activity",
  ],
  GUIDE: ["ai-briefing", "kpis", "upcoming-departures", "my-day", "recent-activity"],
};

export function resolveDashboardLayout(role: StaffRole): DashboardPanelId[] {
  return DASHBOARD_LAYOUTS[role] ?? DASHBOARD_LAYOUTS.GUIDE;
}

/**
 * KPI tiles (spec section 4). The row is the role's own list, filled in
 * order: a tile whose figure cannot be built for this person (its read was
 * gated off, or the tile has no builder yet) is skipped and the next one
 * takes the slot — never rendered as `0`.
 *
 * Ids without a builder are skipped until one lands (T5b); the lists are
 * data and are final.
 */
export type DashboardKpiId =
  | "new-inquiries"
  | "active-pilgrims"
  | "departing-30"
  | "collections-period"
  | "outstanding-balance"
  | "group-readiness"
  | "revenue"
  | "gross-margin"
  | "overdue-balance"
  | "refunds-pending"
  | "supplier-payments-due"
  | "open-quotes"
  | "quote-booking-rate"
  | "avg-seat-fill"
  | "groups-at-risk"
  | "open-tasks"
  | "supplier-confirmations-pending"
  | "visa-pending"
  | "docs-awaiting-review"
  | "my-open-tasks"
  | "my-groups";

/** One row of tiles never carries more than this — five-second readability, spec section 2. */
export const DASHBOARD_KPI_CAP = 6;

export const DASHBOARD_KPI_ORDER: Record<StaffRole, DashboardKpiId[]> = {
  ADMIN: [
    "new-inquiries",
    "active-pilgrims",
    "departing-30",
    "collections-period",
    "outstanding-balance",
    "group-readiness",
  ],
  CEO: ["revenue", "collections-period", "outstanding-balance", "gross-margin", "group-readiness", "new-inquiries"],
  FINANCE: [
    "collections-period",
    "outstanding-balance",
    "overdue-balance",
    "refunds-pending",
    "supplier-payments-due",
    "departing-30",
  ],
  MARKETING: [
    "new-inquiries",
    "open-quotes",
    "quote-booking-rate",
    "active-pilgrims",
    "departing-30",
    "avg-seat-fill",
  ],
  OPERATIONS: [
    "groups-at-risk",
    "group-readiness",
    "departing-30",
    "open-tasks",
    "supplier-confirmations-pending",
    "active-pilgrims",
  ],
  VISA: ["visa-pending", "docs-awaiting-review", "departing-30", "my-open-tasks"],
  GUIDE: ["my-open-tasks", "my-groups", "departing-30"],
};

export function resolveDashboardKpiOrder(role: StaffRole): DashboardKpiId[] {
  return DASHBOARD_KPI_ORDER[role] ?? DASHBOARD_KPI_ORDER.GUIDE;
}

/**
 * Shown when a person's role resolves to no renderable block at all - every
 * built-in preset opens with the briefing and KPI row, so today this needs a
 * hand-edited preset or a future block-level restriction, but a blank page
 * with no explanation is the one outcome we never want.
 */
export function emptyDashboardMessage(role: StaffRole): string {
  const label = role.charAt(0) + role.slice(1).toLowerCase();
  return `No dashboard blocks are available for the ${label} role. Ask an administrator to review your access.`;
}
