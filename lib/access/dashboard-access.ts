/**
 * Who may see which Dashboard block — pure, client-safe, no I/O
 * (docs/modules/dashboard-role-blocks-spec.md §3, §7).
 *
 * The layout registry (`lib/data/dashboard-layout.ts`) says which blocks a
 * role's page *prefers* and in what order; this file says whether the
 * signed-in person may see each one, from capabilities alone — never from
 * the role's name, so a custom role's saved overrides are honoured.
 * Resolving those capabilities (the database read) is
 * `lib/data/dashboard-capabilities.ts`.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";
import { capabilitiesFor, type DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";
import { capabilitiesForFinance, type FinanceCapabilities } from "@/lib/access/finance-access";
import { capabilitiesForLeads, type LeadCapabilities } from "@/lib/access/leads-access";
import { capabilitiesForOperations, type OperationsCapabilities } from "@/lib/access/operations-access";
import { capabilitiesForReports, type ReportsCapabilities } from "@/lib/access/reports-access";
import type { DashboardPanelId } from "@/lib/data/dashboard-layout";

/** The modules the Dashboard's blocks and loaders gate on. Extend alongside a block that needs another. */
export interface DashboardCapabilities {
  finance: FinanceCapabilities;
  leads: LeadCapabilities;
  operations: OperationsCapabilities;
  reports: ReportsCapabilities;
  departureGroups: DepartureGroupCapabilities;
}

/** A base role's built-in set, before any custom-role override is merged in. */
export function baseDashboardCapabilities(role: StaffRole): DashboardCapabilities {
  return {
    finance: capabilitiesForFinance(role),
    leads: capabilitiesForLeads(role),
    operations: capabilitiesForOperations(role),
    reports: capabilitiesForReports(role),
    departureGroups: capabilitiesFor(role),
  };
}

/**
 * One gate per block. A block is absent — and its data not fetched — when
 * its gate is false; there is no greyed-out teaser.
 *
 * `my-day`, `attention-rail` and `recent-activity` have no module gate of
 * their own: My Day is scoped to the signed-in staff member's tasks, and the
 * other two filter their individual rows by the capabilities above.
 */
export const BLOCK_GATES: Record<DashboardPanelId, (caps: DashboardCapabilities) => boolean> = {
  "my-day": () => true,
  "attention-rail": () => true,
  "recent-activity": () => true,
  "upcoming-departures": (c) => c.departureGroups.viewModule,
  "seat-fill-pace": (c) => c.departureGroups.viewModule,
  "readiness-heatmap": (c) => c.departureGroups.viewModule,
  approvals: (c) => c.operations.viewModule,
  collections: (c) => c.finance.viewLedger,
  "revenue-trend": (c) => c.reports.viewFinance,
  pipeline: (c) => c.reports.viewSales,
  "team-performance": (c) => c.reports.viewSales,
};

/** `preset` filtered to what `caps` allow, order preserved. */
export function visibleBlocks(preset: readonly DashboardPanelId[], caps: DashboardCapabilities): DashboardPanelId[] {
  return preset.filter((id) => BLOCK_GATES[id](caps));
}
