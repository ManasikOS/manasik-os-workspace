import type { ReportTabId } from "@/lib/access/reports-access";

export type { ReportTabId };

/** The spec's `Period` chip. `CUSTOM` pairs with `customFrom`/`customTo`. */
export const REPORT_PERIODS = [
  "TODAY",
  "THIS_WEEK",
  "THIS_MONTH",
  "THIS_QUARTER",
  "THIS_YEAR",
  "LAST_MONTH",
  "LAST_QUARTER",
  "CUSTOM",
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** The spec's `Compare With` chip. */
export const COMPARISON_MODES = ["PREVIOUS_PERIOD", "SAME_PERIOD_LAST_YEAR", "NONE"] as const;
export type ComparisonMode = (typeof COMPARISON_MODES)[number];

/**
 * The six global filters. Lives in `searchParams`, never in React state —
 * see plan D1. `branch` / `journey` / `packageId` / `departureGroupId` are
 * `null` for "All".
 */
export interface ReportFilters {
  period: ReportPeriod;
  customFrom: string | null;
  customTo: string | null;
  compare: ComparisonMode;
  branch: string | null;
  journey: string | null;
  packageId: string | null;
  departureGroupId: string | null;
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  period: "THIS_MONTH",
  customFrom: null,
  customTo: null,
  compare: "PREVIOUS_PERIOD",
  branch: null,
  journey: null,
  packageId: null,
  departureGroupId: null,
};

/** A resolved date window, with a human label for the KPI captions. */
export interface ResolvedPeriod {
  fromIso: string;
  toIso: string;
  label: string;
}

/**
 * Parses the six global filters out of `searchParams`. Lives in this
 * (non-`"use client"`) file rather than `report-filter-bar.tsx` so the
 * Server Component page can call it directly — a client-marked file's
 * exports can only be rendered as components from a Server Component, never
 * invoked as plain functions.
 */
export function periodParamsFromSearchParams(params: URLSearchParams): ReportFilters {
  const period = (params.get("period") as ReportPeriod) || "THIS_MONTH";
  const compare = (params.get("compare") as ComparisonMode) || "PREVIOUS_PERIOD";
  return {
    period: REPORT_PERIODS.includes(period) ? period : "THIS_MONTH",
    customFrom: params.get("from"),
    customTo: params.get("to"),
    compare: COMPARISON_MODES.includes(compare) ? compare : "PREVIOUS_PERIOD",
    branch: params.get("branch"),
    journey: params.get("journey"),
    packageId: params.get("package"),
    departureGroupId: params.get("group"),
  };
}
