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
import type { TrendGranularity } from "@/lib/data/reports";
import type { Tone } from "@/lib/ui/tone";
import type { StatusLine } from "@/lib/types/dashboard";

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
  const delta = percentDelta(current, previous);
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
