import { describe, expect, it } from "vitest";

import {
  computeDepartureFinancialSafety,
  type DepartureFinancialSafetyGroup,
  type DepartureFinancialSafetyPayable,
  type DepartureFinancialSafetyReceivable,
} from "./departure-financial-safety";

const group = (overrides: Partial<DepartureFinancialSafetyGroup> = {}): DepartureFinancialSafetyGroup => ({
  departureGroupId: "group-1",
  groupName: "October Umrah",
  groupCode: "OCT-26",
  groupStatus: "CONFIRMED",
  departureDate: "2026-10-20",
  currency: "LKR",
  hasPackagePricingSnapshot: true,
  hasCompleteCosting: true,
  confirmedPax: 10,
  breakEvenHeadcount: 3,
  estimatedGrossMargin: 3_000,
  ...overrides,
});

const receivable = (overrides: Partial<DepartureFinancialSafetyReceivable> = {}): DepartureFinancialSafetyReceivable => ({
  departure_group_id: "group-1",
  booking_status: "CONFIRMED",
  total_booking_value: 10_000,
  amount_paid: 10_000,
  outstanding_balance: 0,
  currency: "LKR",
  ...overrides,
});

const payable = (overrides: Partial<DepartureFinancialSafetyPayable> = {}): DepartureFinancialSafetyPayable => ({
  departure_group_id: "group-1",
  amount: 2_500,
  outstanding_amount: 2_500,
  currency: "LKR",
  payment_due_at: "2026-10-10T00:00:00.000Z",
  ...overrides,
});

describe("computeDepartureFinancialSafety", () => {
  it("returns a source-linked healthy result when collected cash covers payable commitments due before departure", () => {
    const [result] = computeDepartureFinancialSafety({
      groups: [group()],
      receivables: [receivable()],
      supplierPayables: [payable()],
    });

    expect(result).toMatchObject({
      status: "HEALTHY",
      currency: "LKR",
      collectionCoverage: { booked: 10_000, collected: 10_000, outstanding: 0, percent: 100 },
      payableTiming: { dueBeforeDeparture: 2_500, undatedOutstanding: 0 },
      cashGap: { collected: 10_000, payablesDueBeforeDeparture: 2_500, amount: 0 },
      margin: { estimatedGrossMargin: 3_000, breakEvenHeadcount: 3, state: "POSITIVE" },
    });
    expect(result.sources.map((source) => source.href)).toEqual([
      "/departure-groups/group-1?tab=overview",
      "/finance?view=receivables&subview=balances",
      "/finance?view=payables",
      "/finance?view=departure-pnl",
    ]);
  });

  it("returns attention when a departure still has an outstanding collection balance", () => {
    const [result] = computeDepartureFinancialSafety({
      groups: [group()],
      receivables: [receivable({ amount_paid: 8_000, outstanding_balance: 2_000 })],
      supplierPayables: [payable({ outstanding_amount: 7_000 })],
    });

    expect(result.status).toBe("ATTENTION");
    expect(result.collectionCoverage).toMatchObject({ percent: 80, outstanding: 2_000 });
    expect(result.reasonCodes).toContain("COLLECTION_OUTSTANDING");
  });

  it("returns critical when payable commitments due before departure exceed collected cash", () => {
    const [result] = computeDepartureFinancialSafety({
      groups: [group()],
      receivables: [receivable({ amount_paid: 2_000, outstanding_balance: 8_000 })],
      supplierPayables: [payable({ outstanding_amount: 3_500 })],
    });

    expect(result.status).toBe("CRITICAL");
    expect(result.cashGap).toEqual({ collected: 2_000, payablesDueBeforeDeparture: 3_500, amount: 1_500 });
    expect(result.reasonCodes).toContain("PAYABLE_CASH_GAP");
  });

  it("returns insufficient data instead of inventing margin or a cash gap when costing is incomplete", () => {
    const [result] = computeDepartureFinancialSafety({
      groups: [group({ hasCompleteCosting: false })],
      receivables: [receivable()],
      supplierPayables: [payable()],
    });

    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.margin).toBeNull();
    expect(result.cashGap).toBeNull();
    expect(result.reasonCodes).toContain("COSTING_INCOMPLETE");
  });

  it("does not total mixed-currency source rows", () => {
    const [result] = computeDepartureFinancialSafety({
      groups: [group()],
      receivables: [receivable(), receivable({ currency: "USD", total_booking_value: 500, amount_paid: 500 })],
      supplierPayables: [payable()],
    });

    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.collectionCoverage).toBeNull();
    expect(result.cashGap).toBeNull();
    expect(result.reasonCodes).toContain("MIXED_CURRENCY");
  });

  it("refuses a cash-gap claim when an outstanding payable has no due date", () => {
    const [result] = computeDepartureFinancialSafety({
      groups: [group()],
      receivables: [receivable()],
      supplierPayables: [payable({ payment_due_at: null })],
    });

    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.payableTiming).toEqual({ dueBeforeDeparture: 0, undatedOutstanding: 2_500 });
    expect(result.cashGap).toBeNull();
    expect(result.reasonCodes).toContain("PAYABLE_DUE_DATE_UNAVAILABLE");
  });
});
