/**
 * Client-safe pure derivations for the Dashboard — status line wording and
 * KPI trend formatting. No Supabase import (same convention as
 * `lib/data/reports.ts` and `lib/data/finance.ts`).
 *
 * Nothing here computes a number `lib/data/dashboard-repository.ts` doesn't
 * already have from the modules that own it — this file only ranks, words
 * and formats those numbers (docs/modules/dashboard-module-implementation-plan.md §7.1).
 */

import type { ReportPeriod } from "@/app/(main)/reports/types";
import { percentDelta } from "@/lib/data/reports-period";
import { marginBelowTarget, type ExecutiveSummary, type TrendGranularity } from "@/lib/data/reports";
import type { DashboardKpiId } from "@/lib/data/dashboard-layout";
import type { OperationsGroupSummary } from "@/lib/types/operations";
import type { Tone } from "@/lib/ui/tone";
import type { AdminKpi, StatusLine } from "@/lib/types/dashboard";

export type { StatusLine };

/* ── Period selector ──────────────────────────────────────────────────────── */

/**
 * Narrower than Reports' own period set (docs/modules/dashboard-module-implementation-plan.md
 * §6) — no custom range, no comparison-mode picker. Anyone who needs either
 * needs Reports.
 */
export const DASHBOARD_PERIODS = ["THIS_WEEK", "THIS_MONTH", "THIS_QUARTER", "THIS_YEAR"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriod, string> = {
  THIS_WEEK: "This Week",
  THIS_MONTH: "This Month",
  THIS_QUARTER: "This Quarter",
  THIS_YEAR: "This Year",
};

export function dashboardPeriodLabel(period: DashboardPeriod): string {
  return DASHBOARD_PERIOD_LABELS[period];
}

/**
 * Any unrecognised or absent `?period=` value falls back to `THIS_QUARTER`
 * — short enough windows (`THIS_WEEK`) leave Business Health's revenue
 * trend (§5.8) with too few buckets to read.
 */
export function resolveDashboardPeriod(raw: string | string[] | undefined): DashboardPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (DASHBOARD_PERIODS as readonly string[]).includes(value ?? "") ? (value as DashboardPeriod) : "THIS_QUARTER";
}

/** The dashboard's period is a strict subset of Reports' — reuse its resolver as-is. */
export function toReportPeriod(period: DashboardPeriod): ReportPeriod {
  return period;
}

/** A week-long or month-long window reads better bucketed by week; a quarter or year by month. */
export function trendGranularityFor(period: DashboardPeriod): TrendGranularity {
  return period === "THIS_WEEK" || period === "THIS_MONTH" ? "WEEK" : "MONTH";
}

/* ── KPI deltas ───────────────────────────────────────────────────────────── */

export interface KpiTrend {
  trend: string;
  trendType: "positive" | "neutral" | "negative";
}

/**
 * `current` vs `previous` over equal-length windows, worded for the KPI
 * trend badge `metrics.tsx` already renders. `null` whenever
 * `percentDelta()` itself returns `null` (no prior-period baseline to
 * compare against) — the card then shows no badge at all, never a
 * fabricated "0%".
 */
export function formatKpiDelta(current: number, previous: number, periodLabel: string): KpiTrend | undefined {
  return kpiTrendFromPercent(percentDelta(current, previous), periodLabel);
}

/** The same wording for a delta that is already a percentage (Reports' `revenueDeltaPercent`). */
export function kpiTrendFromPercent(delta: number | null, periodLabel: string): KpiTrend | undefined {
  if (delta === null) return undefined;
  const rounded = Math.round(delta);
  if (rounded === 0) return { trend: `Flat vs ${periodLabel}`, trendType: "neutral" };
  const sign = rounded > 0 ? "+" : "";
  return {
    trend: `${sign}${rounded}% vs ${periodLabel}`,
    trendType: rounded > 0 ? "positive" : "negative",
  };
}

/* ── Status line ──────────────────────────────────────────────────────────── */

/**
 * The five-second answer to "is everything okay?" — one sentence, always
 * built from counts a panel below can be opened to verify (§5.1). Never an
 * independent computation: every input here is already produced by
 * `dashboard-repository.ts` for the KPI row or the exceptions panels.
 */
export function buildStatusLine(input: {
  groupsAtRiskCount: number;
  groupsBlockedCount: number;
  overdueTaskCount: number;
  overdueBalanceLabel: string | null;
  overdueBalanceAmount: number;
}): StatusLine {
  const parts: string[] = [];

  if (input.groupsAtRiskCount > 0) {
    parts.push(`${input.groupsAtRiskCount} group${input.groupsAtRiskCount === 1 ? "" : "s"} need attention`);
  }
  if (input.overdueTaskCount > 0) {
    parts.push(`${input.overdueTaskCount} task${input.overdueTaskCount === 1 ? "" : "s"} overdue`);
  }
  if (input.overdueBalanceAmount > 0 && input.overdueBalanceLabel) {
    parts.push(`${input.overdueBalanceLabel} overdue`);
  }

  if (parts.length === 0) {
    return { tone: "success", message: "All clear — nothing needs attention right now." };
  }

  const tone: Tone = input.groupsBlockedCount > 0 || input.overdueBalanceAmount > 0 ? "danger" : "warning";
  return { tone, message: parts.join(" · ") };
}

/**
 * Fills a role's KPI row: walks `order`, takes each tile that was built, and
 * stops at `cap`. A tile that was not built (its read was gated off, or it
 * has no builder yet) is skipped so the next one takes its slot — the row
 * shrinks rather than showing a zero it cannot source.
 */
export function selectKpis(
  order: readonly string[],
  built: Readonly<Record<string, AdminKpi | undefined>>,
  cap: number,
): AdminKpi[] {
  const row: AdminKpi[] = [];
  for (const id of order) {
    const tile = built[id];
    if (!tile) continue;
    row.push(tile);
    if (row.length >= cap) break;
  }
  return row;
}

/* ── Money formatting ─────────────────────────────────────────────────────── */

const numberFormatter = new Intl.NumberFormat("en-US");

/** `5_200_000` -> `LKR 5.2M`. Same shape as every other money KPI on the Dashboard. */
export function formatCurrencyCompact(code: string, value: number): string {
  if (!Number.isFinite(value) || value <= 0) return `${code} 0`;
  if (value >= 1_000_000) {
    return `${code} ${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    return `${code} ${(value / 1_000).toFixed(0)}K`;
  }
  return `${code} ${numberFormatter.format(value)}`;
}

export function formatCurrencyLKR(value: number): string {
  return formatCurrencyCompact("LKR", value);
}

/* ── KPI tiles ────────────────────────────────────────────────────────────── */

/** A figure over the selected period and the comparison window before it. */
export interface PeriodCount {
  current: number;
  previous: number;
}

const INACTIVE_GROUP_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "CLOSED", "CANCELLED"]);

/**
 * Every KPI tile this render *can* build, keyed by id. Which of them a
 * person sees, and in what order, is `DASHBOARD_KPI_ORDER` + `selectKpis`.
 * This function only answers "what could be built from the reads that ran":
 * a figure whose read did not run arrives here as `null` and is left out of
 * the record — never rendered as a zero it cannot source.
 *
 * Every number is a figure its owning module already derived
 * (`computeOperationsKpis`, `computeExecutiveSummary`, the receivables
 * ledger); this only words and places them.
 */
export function buildKpiCandidates(input: {
  groups: OperationsGroupSummary[];
  outstandingBalance: number;
  periodLabel: string;
  newInquiries: PeriodCount | null;
  collections: PeriodCount | null;
  /** `computeOperationsKpis().groupsAtRisk`. */
  groupsAtRisk: number;
  /** `computeOperationsKpis().supplierConfirmationsPending`. */
  supplierConfirmationsPending: number;
  /** Incomplete tasks across the groups this person can see. */
  openTaskCount: number;
  /** This person's own open tasks; `null` when they were not read. */
  myOpenTaskCount: number | null;
  /** Sum of overdue receivables; `null` when the ledger was not read. */
  overdueBalance: number | null;
  /** Pending refunds; `null` when they were not read. */
  refundsPending: number | null;
  /** `null` when the Reports overview was not read. `showMargin` is `reports.viewCostAndMargin`. */
  executive: { summary: ExecutiveSummary; showMargin: boolean } | null;
}): Partial<Record<DashboardKpiId, AdminKpi>> {
  const kpis: Partial<Record<DashboardKpiId, AdminKpi>> = {};
  const activeGroups = input.groups.filter((g) => !INACTIVE_GROUP_STATUSES.has(g.groupStatus));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  if (input.newInquiries) {
    const trend = formatKpiDelta(input.newInquiries.current, input.newInquiries.previous, "previous period");
    kpis["new-inquiries"] = {
      id: "new-inquiries",
      title: "New Inquiries",
      value: String(input.newInquiries.current),
      supportingText: input.periodLabel,
      trend: trend?.trend,
      trendType: trend?.trendType,
      destination: "/leads",
    };
  }

  kpis["active-pilgrims"] = {
    id: "active-pilgrims",
    title: "Active Pilgrims",
    value: String(activeGroups.reduce((sum, g) => sum + g.pilgrimCount, 0)),
    supportingText: `Across ${plural(activeGroups.length, "active group")}`,
    destination: "/pilgrims",
  };

  const departingSoon = activeGroups.filter((g) => g.daysUntilDeparture >= 0 && g.daysUntilDeparture <= 30);
  kpis["departing-30"] = {
    id: "departing-30",
    title: "Departing in 30 Days",
    value: String(departingSoon.reduce((sum, g) => sum + g.pilgrimCount, 0)),
    supportingText: `Across ${plural(departingSoon.length, "departure group")}`,
    destination: "/departure-groups",
  };

  if (input.collections) {
    const trend = formatKpiDelta(input.collections.current, input.collections.previous, "previous period");
    kpis["collections-period"] = {
      id: "collections-period",
      title: `Collections (${input.periodLabel})`,
      value: formatCurrencyLKR(input.collections.current),
      trend: trend?.trend,
      trendType: trend?.trendType,
      destination: "/finance?view=receivables&subview=payments",
    };
    kpis["outstanding-balance"] = {
      id: "outstanding-balance",
      title: "Outstanding Balance",
      value: formatCurrencyLKR(input.outstandingBalance),
      // Point-in-time balance - no historical snapshot to diff against, so
      // no delta rather than a fabricated one.
      destination: "/finance?view=receivables&subview=balances",
    };
  }

  const readyCount = activeGroups.filter((g) => g.readinessStatus === "READY").length;
  kpis["group-readiness"] = {
    id: "group-readiness",
    title: "Group Readiness",
    value: `${readyCount} Ready`,
    supportingText: "Next 30 days departures",
    destination: "/departure-groups",
  };

  kpis["groups-at-risk"] = {
    id: "groups-at-risk",
    title: "Groups at Risk",
    value: String(input.groupsAtRisk),
    supportingText: `Of ${plural(activeGroups.length, "active group")}`,
    destination: "/operations",
  };

  kpis["open-tasks"] = {
    id: "open-tasks",
    title: "Open Tasks",
    value: String(input.openTaskCount),
    supportingText: "Across active groups",
    destination: "/operations",
  };

  kpis["supplier-confirmations-pending"] = {
    id: "supplier-confirmations-pending",
    title: "Supplier Confirmations",
    value: String(input.supplierConfirmationsPending),
    supportingText: "Awaiting a supplier",
    destination: "/operations",
  };

  if (input.myOpenTaskCount !== null) {
    kpis["my-open-tasks"] = {
      id: "my-open-tasks",
      title: "My Open Tasks",
      value: String(input.myOpenTaskCount),
      supportingText: "Assigned to you",
      destination: "/operations",
    };
  }

  kpis["my-groups"] = {
    id: "my-groups",
    title: "My Groups",
    value: String(activeGroups.length),
    supportingText: "Active departures",
    destination: "/departure-groups",
  };

  const upcoming = activeGroups.filter((g) => g.daysUntilDeparture >= 0 && g.capacity > 0);
  const capacity = upcoming.reduce((sum, g) => sum + g.capacity, 0);
  if (capacity > 0) {
    const booked = upcoming.reduce((sum, g) => sum + g.bookedSeats, 0);
    kpis["avg-seat-fill"] = {
      id: "avg-seat-fill",
      title: "Avg Seat Fill",
      value: `${Math.round((booked / capacity) * 100)}%`,
      supportingText: `Across ${plural(upcoming.length, "upcoming group")}`,
      destination: "/departure-groups",
    };
  }

  if (input.overdueBalance !== null) {
    kpis["overdue-balance"] = {
      id: "overdue-balance",
      title: "Overdue Balance",
      value: formatCurrencyLKR(input.overdueBalance),
      destination: "/finance?view=receivables&subview=balances",
    };
  }

  if (input.refundsPending !== null) {
    kpis["refunds-pending"] = {
      id: "refunds-pending",
      title: "Refunds Pending",
      value: String(input.refundsPending),
      supportingText: "Awaiting approval",
      destination: "/finance?view=receivables&subview=adjustments",
    };
  }

  if (input.executive) {
    const { summary, showMargin } = input.executive;
    const currencies = Object.keys(summary.revenueByCurrency);

    // Several currencies cannot be added into one honest number - Reports
    // itself shows them separately - so the tile is absent, not wrong.
    if (currencies.length <= 1) {
      const trend = kpiTrendFromPercent(summary.revenueDeltaPercent, "previous period");
      kpis.revenue = {
        id: "revenue",
        title: `Revenue (${input.periodLabel})`,
        value: formatCurrencyCompact(currencies[0] ?? "LKR", summary.revenue),
        trend: trend?.trend,
        trendType: trend?.trendType,
        destination: "/reports",
      };
    }

    // `stripGroupCostFields` zeroes supplier cost for a role without
    // `viewCostAndMargin`, which would read as a flattering 100% margin, so
    // the tile is omitted for that role instead of shown wrong.
    if (showMargin) {
      const margin = summary.projectedGrossMarginPercent;
      kpis["gross-margin"] = {
        id: "gross-margin",
        title: "Gross Margin",
        value: margin === null ? "\u2014" : `${Math.round(margin)}%`,
        supportingText: "Projected, all groups",
        trend: marginBelowTarget(margin) ? "Below target" : undefined,
        trendType: marginBelowTarget(margin) ? "negative" : undefined,
        destination: "/reports",
      };
    }
  }

  return kpis;
}
