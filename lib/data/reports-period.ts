/**
 * Period and comparison-window resolution — the one file that owns every
 * date boundary in the Reports module (plan D2). Nothing else in `reports/`
 * computes a period start/end.
 *
 * "Previous period" is the immediately preceding window of *equal length* —
 * `This Month` on the 13th compares days 1–13 this month against days 1–13
 * last month, not a partial month against a full one. `Same Period Last
 * Year` shifts the whole window back twelve months instead, which matters
 * more here than in most businesses: Ramadan Umrah only compares sensibly
 * against Ramadan Umrah.
 */

import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subMonths,
  subQuarters,
} from "date-fns";

import type { ComparisonMode, ReportPeriod, ResolvedPeriod } from "@/app/(main)/reports/types";

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  TODAY: "Today",
  THIS_WEEK: "This Week",
  THIS_MONTH: "This Month",
  THIS_QUARTER: "This Quarter",
  THIS_YEAR: "This Year",
  LAST_MONTH: "Last Month",
  LAST_QUARTER: "Last Quarter",
  CUSTOM: "Custom",
};

export function periodLabel(period: ReportPeriod): string {
  return PERIOD_LABELS[period];
}

/** Resolves the active period into an inclusive `[fromIso, toIso)` window. */
export function resolvePeriod(
  period: ReportPeriod,
  customFrom: string | null,
  customTo: string | null,
  nowIso: string,
): ResolvedPeriod {
  const now = new Date(nowIso);

  switch (period) {
    case "TODAY":
      return { fromIso: startOfDay(now).toISOString(), toIso: endOfDay(now).toISOString(), label: "Today" };
    case "THIS_WEEK":
      return {
        fromIso: startOfWeek(now, { weekStartsOn: 1 }).toISOString(),
        toIso: endOfWeek(now, { weekStartsOn: 1 }).toISOString(),
        label: "This Week",
      };
    case "THIS_MONTH":
      return { fromIso: startOfMonth(now).toISOString(), toIso: endOfDay(now).toISOString(), label: "This Month" };
    case "THIS_QUARTER":
      return {
        fromIso: startOfQuarter(now).toISOString(),
        toIso: endOfDay(now).toISOString(),
        label: "This Quarter",
      };
    case "THIS_YEAR":
      return { fromIso: startOfYear(now).toISOString(), toIso: endOfDay(now).toISOString(), label: "This Year" };
    case "LAST_MONTH": {
      const lastMonth = subMonths(now, 1);
      return {
        fromIso: startOfMonth(lastMonth).toISOString(),
        toIso: endOfMonth(lastMonth).toISOString(),
        label: "Last Month",
      };
    }
    case "LAST_QUARTER": {
      const lastQuarter = subQuarters(now, 1);
      return {
        fromIso: startOfQuarter(lastQuarter).toISOString(),
        toIso: endOfQuarter(lastQuarter).toISOString(),
        label: "Last Quarter",
      };
    }
    case "CUSTOM": {
      const from = customFrom ? startOfDay(new Date(customFrom)) : startOfMonth(now);
      const to = customTo ? endOfDay(new Date(customTo)) : endOfDay(now);
      return { fromIso: from.toISOString(), toIso: to.toISOString(), label: "Custom Range" };
    }
    default:
      return { fromIso: startOfMonth(now).toISOString(), toIso: endOfDay(now).toISOString(), label: "This Month" };
  }
}

/**
 * The comparison window for `mode` against `resolved`. `null` for `NONE` —
 * callers must treat that as "do not show a delta", not "delta is zero".
 */
export function resolveComparison(
  resolved: ResolvedPeriod,
  mode: ComparisonMode,
): (ResolvedPeriod & { label: string }) | null {
  if (mode === "NONE") return null;

  const from = new Date(resolved.fromIso);
  const to = new Date(resolved.toIso);

  if (mode === "SAME_PERIOD_LAST_YEAR") {
    return {
      fromIso: addYears(from, -1).toISOString(),
      toIso: addYears(to, -1).toISOString(),
      label: "Same Period Last Year",
    };
  }

  // PREVIOUS_PERIOD: shift the whole window back by its own length, so a
  // partial "This Month" never gets compared against a full prior month.
  const lengthDays = Math.max(differenceInCalendarDays(to, from), 0);
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -lengthDays);
  return {
    fromIso: startOfDay(previousFrom).toISOString(),
    toIso: endOfDay(previousTo).toISOString(),
    label: "Previous Period",
  };
}

/** `+14%` / `−8%` / `—` when the baseline is zero or comparison is off. */
export function percentDelta(current: number, previous: number | null): number | null {
  if (previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function addMonthsIso(iso: string, months: number): string {
  return addMonths(new Date(iso), months).toISOString();
}
