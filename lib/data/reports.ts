/**
 * Client-safe derivations over Reports fact rows — KPIs, trend buckets and
 * table shapes. Pure functions, no Supabase import, importable from Client
 * Components (same convention as `lib/data/finance.ts`).
 *
 * Every KPI here is a straight `sum` / `count` / `avg` over a fact view's
 * own columns — nothing is re-derived from raw tables Reports doesn't own,
 * so a number here can never disagree with the module that owns the data.
 */

import { addDays, addMonths, endOfMonth, endOfWeek, format, isWithinInterval, startOfMonth, startOfWeek } from "date-fns";

import type { Tone } from "@/lib/ui/tone";
import { percentTone } from "@/lib/ui/tone";

import { percentDelta } from "@/lib/data/reports-period";
import { AT_RISK_READINESS_STATUSES, GROSS_MARGIN_TARGET_PERCENT } from "@/lib/data/reports-copy";
import type {
  ReportBookingFact,
  ReportGroupFact,
  ReportPaymentFact,
} from "@/lib/types/reports";

const ACTIVE_GROUP_STATUSES = new Set(["PLANNING", "PREPARING", "READY_TO_DEPART"]);

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function isLiveBooking(row: ReportBookingFact): boolean {
  return row.booking_status !== "CANCELLED";
}

/* ── Executive Business Summary ──────────────────────────────────────────── */

export interface ExecutiveSummary {
  revenue: number;
  revenueByCurrency: Record<string, number>;
  revenueDeltaPercent: number | null;
  bookingsCount: number;
  bookingsDeltaPercent: number | null;
  pilgrimsCount: number;
  activeGroupsCount: number;
  collectionRatePercent: number | null;
  avgGroupReadinessPercent: number;
  atRiskGroupCount: number;
  /** `null` when no group has any expected revenue yet — avoid a 0/0 "0% margin". */
  projectedGrossMarginPercent: number | null;
}

export function computeExecutiveSummary(
  bookingsCurrent: ReportBookingFact[],
  bookingsPrevious: ReportBookingFact[],
  groups: ReportGroupFact[],
): ExecutiveSummary {
  const liveCurrent = bookingsCurrent.filter(isLiveBooking);
  const livePrevious = bookingsPrevious.filter(isLiveBooking);

  const revenue = sum(liveCurrent, (b) => b.total_booking_value);
  const revenuePrevious = sum(livePrevious, (b) => b.total_booking_value);
  const currencyByGroup = new Map(groups.map((g) => [g.departure_group_id, g.currency ?? "LKR"]));
  const revenueByCurrency: Record<string, number> = {};
  for (const booking of liveCurrent) {
    const currency = currencyByGroup.get(booking.departure_group_id) ?? "LKR";
    revenueByCurrency[currency] = (revenueByCurrency[currency] ?? 0) + booking.total_booking_value;
  }
  const revenueCurrencies = Object.keys(revenueByCurrency);

  const activeGroups = groups.filter((g) => ACTIVE_GROUP_STATUSES.has(g.group_status));

  const expectedRevenue = sum(groups, (g) => g.expected_revenue);
  const collectedAmount = sum(groups, (g) => g.collected_amount);
  const supplierCostByCurrency = groups.reduce<Record<string, number>>((totals, g) => {
    const buckets = g.supplier_cost_by_currency;
    if (buckets && Object.keys(buckets).length > 0) {
      for (const [currency, amount] of Object.entries(buckets)) totals[currency] = (totals[currency] ?? 0) + amount;
    } else {
      const currency = g.currency ?? "LKR";
      totals[currency] = (totals[currency] ?? 0) + g.supplier_cost_mixed_currency;
    }
    return totals;
  }, {});
  const expectedByCurrency = groups.reduce<Record<string, number>>((totals, g) => {
    const currency = g.currency ?? "LKR";
    totals[currency] = (totals[currency] ?? 0) + g.expected_revenue;
    return totals;
  }, {});
  const collectedByCurrency = groups.reduce<Record<string, number>>((totals, g) => {
    const currency = g.currency ?? "LKR";
    totals[currency] = (totals[currency] ?? 0) + g.collected_amount;
    return totals;
  }, {});
  const singleCurrency = new Set([...Object.keys(expectedByCurrency), ...Object.keys(collectedByCurrency)]).size <= 1;
  const marginCurrency = Object.keys(supplierCostByCurrency).length <= 1 && revenueCurrencies.length <= 1;

  return {
    revenue,
    revenueByCurrency,
    revenueDeltaPercent: revenueCurrencies.length <= 1 ? percentDelta(revenue, revenuePrevious) : null,
    bookingsCount: liveCurrent.length,
    bookingsDeltaPercent: percentDelta(liveCurrent.length, livePrevious.length),
    pilgrimsCount: sum(activeGroups, (g) => g.booked_seats),
    activeGroupsCount: activeGroups.length,
    collectionRatePercent: singleCurrency && expectedRevenue > 0 ? (collectedAmount / expectedRevenue) * 100 : null,
    avgGroupReadinessPercent: groups.length > 0 ? sum(groups, (g) => g.readiness_score) / groups.length : 0,
    atRiskGroupCount: groups.filter((g) =>
      (AT_RISK_READINESS_STATUSES as readonly string[]).includes(g.readiness_status),
    ).length,
    projectedGrossMarginPercent: marginCurrency && expectedRevenue > 0 ? ((expectedRevenue - sum(Object.entries(supplierCostByCurrency).map(([, value]) => value), (value) => value)) / expectedRevenue) * 100 : null,
  };
}

export function marginBelowTarget(marginPercent: number | null): boolean {
  return marginPercent !== null && marginPercent < GROSS_MARGIN_TARGET_PERCENT;
}

/* ── Revenue & collections trend ─────────────────────────────────────────── */

export type TrendGranularity = "MONTH" | "WEEK";

export interface RevenueTrendPoint {
  bucketStart: string;
  bucketLabel: string;
  bookedValue: number;
  cashCollected: number;
}

/**
 * Buckets booked value (by `booked_at`) and cash collected (by `paid_at`)
 * across `[fromIso, toIso]`. Outstanding receivables and supplier payables
 * are live, point-in-time totals (they describe a balance, not an event on a
 * date), so they render as reference lines against `groups` rather than a
 * bucketed series — bucketing a balance would silently invent a trend.
 */
export function buildRevenueTrend(
  bookings: ReportBookingFact[],
  payments: ReportPaymentFact[],
  fromIso: string,
  toIso: string,
  granularity: TrendGranularity,
): RevenueTrendPoint[] {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const buckets: { start: Date; end: Date; label: string }[] = [];

  if (granularity === "MONTH") {
    let cursor = startOfMonth(from);
    while (cursor <= to) {
      buckets.push({ start: cursor, end: endOfMonth(cursor), label: format(cursor, "MMM yyyy") });
      cursor = addMonths(cursor, 1);
    }
  } else {
    let cursor = startOfWeek(from, { weekStartsOn: 1 });
    while (cursor <= to) {
      const end = endOfWeek(cursor, { weekStartsOn: 1 });
      buckets.push({ start: cursor, end, label: format(cursor, "d MMM") });
      cursor = addDays(cursor, 7);
    }
  }

  return buckets.map((bucket) => ({
    bucketStart: bucket.start.toISOString(),
    bucketLabel: bucket.label,
    bookedValue: sum(
      bookings.filter(
        (b) => isLiveBooking(b) && b.booked_at && isWithinInterval(new Date(b.booked_at), { start: bucket.start, end: bucket.end }),
      ),
      (b) => b.total_booking_value,
    ),
    cashCollected: sum(
      payments.filter((p) => isWithinInterval(new Date(p.paid_at), { start: bucket.start, end: bucket.end })),
      (p) => p.amount,
    ),
  }));
}

/* ── Group health summary ────────────────────────────────────────────────── */

export interface GroupHealthRow {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  readinessPercent: number;
  bookedSeats: number;
  capacity: number;
  revenue: number;
  riskLabel: string;
  riskTone: Tone;
  departureDate: string;
}

const RISK_LABELS: Record<ReportGroupFact["readiness_status"], string> = {
  READY: "On Track",
  AT_RISK: "At Risk",
  BLOCKED: "Blocked",
  NOT_STARTED: "Not Started",
};

const RISK_TONES: Record<ReportGroupFact["readiness_status"], Tone> = {
  READY: "success",
  AT_RISK: "warning",
  BLOCKED: "danger",
  NOT_STARTED: "neutral",
};

export function buildGroupHealthRows(groups: ReportGroupFact[]): GroupHealthRow[] {
  return groups
    .filter((g) => g.group_status !== "CANCELLED" && g.group_status !== "CLOSED")
    .map((g) => ({
      departureGroupId: g.departure_group_id,
      groupName: g.group_name,
      groupCode: g.group_code,
      readinessPercent: g.readiness_score,
      bookedSeats: g.booked_seats,
      capacity: g.capacity,
      revenue: g.expected_revenue,
      riskLabel: RISK_LABELS[g.readiness_status],
      riskTone: RISK_TONES[g.readiness_status],
      departureDate: g.departure_date,
    }))
    .sort((a, b) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());
}

export function readinessTone(percent: number): Tone {
  return percentTone(percent);
}
