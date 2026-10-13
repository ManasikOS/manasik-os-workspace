/**
 * Which optional reads a Dashboard render needs
 * (docs/modules/dashboard-role-blocks-spec.md §5 C5).
 *
 * Pure and client-safe. A read runs only when (a) the person's capabilities
 * allow it AND (b) some block that is actually going to render consumes its
 * result — "a block absent from a role's layout is not fetched". Capability
 * is still the hard gate: asking for a block never widens what is read.
 *
 * Deliberately not here: the Operations snapshot, which every block and the
 * status line build on and is always read.
 */

import type { DashboardCapabilities } from "@/lib/access/dashboard-access";
import type { DashboardKpiId, DashboardPanelId } from "@/lib/data/dashboard-layout";

export interface DashboardFetchPlan {
  /** Lead facts — KPI "New Inquiries" and the Attention Rail's lead rows. */
  leads: boolean;
  /** Receivables — Outstanding KPI, Collections, and the briefing's overdue figure. */
  receivables: boolean;
  /** Completed payments — Collections (this month) and the Collections KPI. */
  payments: boolean;
  /** Pending refunds — Collections and the Attention Rail's refund row. */
  refunds: boolean;
  /** Agent proposals + the Copilot's daily summary — the Approvals block only. */
  proposals: boolean;
  /** Reports finance snapshot — Revenue Trend / Receivables Aging. */
  financeReport: boolean;
  /** Reports sales snapshot — Pipeline and Team Performance. */
  salesReport: boolean;
  /** Reports overview snapshot — the Revenue and Gross Margin KPI tiles. */
  overview: boolean;
  /** The signed-in person's own tasks — My Day and the My Open Tasks tile. */
  myTasks: boolean;
}

export function planDashboardFetch(
  blocks: readonly DashboardPanelId[],
  caps: DashboardCapabilities,
  who: { staffId: string | null; agencyId: string | null },
  /** The role's KPI tile order — a tile that needs its own read only asks for it when listed. */
  kpiIds: readonly DashboardKpiId[] = [],
): DashboardFetchPlan {
  const has = (id: DashboardPanelId): boolean => blocks.includes(id);
  const kpi = (id: DashboardKpiId): boolean => has("kpis") && kpiIds.includes(id);
  const ledger = caps.finance.viewLedger;

  return {
    leads: caps.leads.viewModule && (has("kpis") || has("attention-rail")),
    receivables: ledger && (has("collections") || has("kpis") || has("ai-briefing")),
    payments: ledger && (has("collections") || has("kpis")),
    refunds: ledger && (has("collections") || has("attention-rail") || kpi("refunds-pending")),
    proposals: caps.operations.viewModule && who.agencyId !== null && has("approvals"),
    financeReport: caps.reports.viewFinance && has("revenue-trend"),
    salesReport: caps.reports.viewSales && (has("pipeline") || has("team-performance")),
    overview: caps.reports.viewOverview && (kpi("revenue") || kpi("gross-margin")),
    myTasks: who.staffId !== null && (has("my-day") || kpi("my-open-tasks")),
  };
}
