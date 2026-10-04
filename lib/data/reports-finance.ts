/**
 * Client-safe derivations for the Finance report tab. Pure functions over
 * fact rows — no Supabase import (same convention as `lib/data/reports.ts`).
 */

import { AGING_BUCKETS, PAYMENT_METHOD_LABELS } from "@/lib/data/reports-copy";
import type { ReportBookingFact, ReportGroupFact, ReportMilestoneFact, ReportPaymentFact } from "@/lib/types/reports";

function isLive(booking: ReportBookingFact): boolean {
  return booking.booking_status !== "CANCELLED";
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/* ── Collections report ──────────────────────────────────────────────────── */

export interface CollectionsSummary {
  expected: number;
  expectedByCurrency: Record<string, number>;
  collected: number;
  collectedByCurrency: Record<string, number>;
  outstanding: number;
  outstandingByCurrency: Record<string, number>;
  overdue: number;
  overdueByCurrency: Record<string, number>;
  collectionRatePercent: number | null;
}

export function buildCollectionsSummary(
  bookings: ReportBookingFact[],
  payments: ReportPaymentFact[],
  groups: ReportGroupFact[],
): CollectionsSummary {
  const expected = sum(bookings.filter(isLive), (b) => b.total_booking_value);
  const currencyByGroup = new Map(groups.map((g) => [g.departure_group_id, g.currency ?? "LKR"]));
  const expectedByCurrency: Record<string, number> = {};
  for (const booking of bookings.filter(isLive)) {
    const currency = currencyByGroup.get(booking.departure_group_id) ?? "LKR";
    expectedByCurrency[currency] = (expectedByCurrency[currency] ?? 0) + booking.total_booking_value;
  }
  const collectedByCurrency: Record<string, number> = {};
  for (const payment of payments) {
    if (!(payment.status === "COMPLETED" || payment.status === "REFUNDED")) continue;
    collectedByCurrency[payment.currency] =
      (collectedByCurrency[payment.currency] ?? 0) + payment.amount;
  }
  const collected = Object.values(collectedByCurrency).reduce((total, amount) => total + amount, 0);
  const outstanding = sum(groups, (g) => g.outstanding_amount);
  const overdue = sum(groups, (g) => g.overdue_amount);
  const outstandingByCurrency: Record<string, number> = {};
  const overdueByCurrency: Record<string, number> = {};
  for (const group of groups) {
    const currency = group.currency ?? "LKR";
    outstandingByCurrency[currency] = (outstandingByCurrency[currency] ?? 0) + group.outstanding_amount;
    overdueByCurrency[currency] = (overdueByCurrency[currency] ?? 0) + group.overdue_amount;
  }
  const collectionCurrencies = new Set([...Object.keys(expectedByCurrency), ...Object.keys(collectedByCurrency)]);
  return {
    expected,
    expectedByCurrency,
    collected,
    collectedByCurrency,
    outstanding,
    outstandingByCurrency,
    overdue,
    overdueByCurrency,
    collectionRatePercent: collectionCurrencies.size <= 1 && expected > 0 ? (collected / expected) * 100 : null,
  };
}

export interface BreakdownRow {
  key: string;
  label: string;
  expected: number;
  collected: number;
}

export function buildCollectionsByBranch(bookings: ReportBookingFact[], payments: ReportPaymentFact[]): BreakdownRow[] {
  return groupCollections(
    bookings,
    payments,
    (b) => b.branch,
    (p) => p.branch,
  );
}

export function buildCollectionsByMethod(payments: ReportPaymentFact[]): BreakdownRow[] {
  const byMethod = new Map<string, number>();
  for (const p of payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
  return Array.from(byMethod.entries())
    .map(([method, collected]) => ({
      key: method,
      label: PAYMENT_METHOD_LABELS[method] ?? method,
      expected: 0,
      collected,
    }))
    .sort((a, b) => b.collected - a.collected);
}

function groupCollections(
  bookings: ReportBookingFact[],
  payments: ReportPaymentFact[],
  bookingKey: (b: ReportBookingFact) => string,
  paymentKey: (p: ReportPaymentFact) => string,
): BreakdownRow[] {
  const expectedByKey = new Map<string, number>();
  for (const b of bookings.filter(isLive)) {
    const key = bookingKey(b);
    expectedByKey.set(key, (expectedByKey.get(key) ?? 0) + b.total_booking_value);
  }
  const collectedByKey = new Map<string, number>();
  for (const p of payments) {
    const key = paymentKey(p);
    collectedByKey.set(key, (collectedByKey.get(key) ?? 0) + p.amount);
  }
  const keys = new Set([...expectedByKey.keys(), ...collectedByKey.keys()]);
  return Array.from(keys)
    .map((key) => ({
      key,
      label: key || "—",
      expected: expectedByKey.get(key) ?? 0,
      collected: collectedByKey.get(key) ?? 0,
    }))
    .sort((a, b) => b.expected - a.expected);
}

/* ── Receivables aging ────────────────────────────────────────────────────── */

export interface AgingBucketRow {
  key: string;
  label: string;
  amount: number;
  milestoneCount: number;
}

function daysOverdue(dueAtIso: string | null, nowIso: string): number {
  if (!dueAtIso) return -Infinity; // no due date yet → never overdue → Not Due
  // Reports use calendar-day buckets. Floor fractional elapsed days so every
  // balance belongs to exactly one contiguous bucket (e.g. 7.5 days maps to
  // day 7, while a due date later today remains Not Due).
  return Math.floor((new Date(nowIso).getTime() - new Date(dueAtIso).getTime()) / (1000 * 60 * 60 * 24));
}

export function buildReceivablesAging(milestones: ReportMilestoneFact[], nowIso: string): AgingBucketRow[] {
  return AGING_BUCKETS.map((bucket) => {
    const matches = milestones.filter((m) => {
      const overdue = daysOverdue(m.due_at, nowIso);
      return overdue >= bucket.minDays && overdue <= bucket.maxDays;
    });
    return {
      key: bucket.key,
      label: bucket.label,
      amount: sum(matches, (m) => m.outstanding_amount),
      milestoneCount: matches.length,
    };
  });
}

/* ── Package profitability ───────────────────────────────────────────────── */

export interface PackageProfitabilityRow {
  packageTemplateId: string;
  packageName: string;
  currency: string;
  revenue: number;
  estimatedCost: number;
  marginPercent: number | null;
}

export function buildPackageProfitability(groups: ReportGroupFact[]): PackageProfitabilityRow[] {
  const byPackageCurrency = new Map<string, { packageTemplateId: string; packageName: string; currency: string; revenue: number; estimatedCost: number }>();
  for (const g of groups) {
    const currency = g.currency ?? "LKR";
    const key = `${g.package_template_id}:${currency}`;
    const bucket = byPackageCurrency.get(key) ?? {
      packageTemplateId: g.package_template_id,
      packageName: g.package_name || "Untitled Package",
      currency,
      revenue: 0,
      estimatedCost: 0,
    };
    bucket.revenue += g.expected_revenue;
    const costBuckets = g.supplier_cost_by_currency;
    if (costBuckets && Object.keys(costBuckets).length > 0) {
      bucket.estimatedCost += costBuckets[currency] ?? 0;
    } else {
      // Compatibility with the pre-currency view: only attribute the legacy
      // value to the group's own contract currency.
      bucket.estimatedCost += g.supplier_cost_mixed_currency;
    }
    byPackageCurrency.set(key, bucket);
  }

  return Array.from(byPackageCurrency.values())
    .map((row) => {
      const { packageTemplateId, packageName, currency, revenue, estimatedCost } = row;
      return {
        packageTemplateId: `${packageTemplateId}:${currency}`,
        packageName,
        currency,
        revenue,
        estimatedCost,
        marginPercent: revenue > 0 ? ((revenue - estimatedCost) / revenue) * 100 : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}
