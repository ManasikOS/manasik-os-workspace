import { describe, expect, it } from "vitest";

import { FINANCE_METRICS, allGovernedMetricKeys, getFinanceMetric, getInboxOutcomeMetric, type FinanceMetricsInput } from "./registry";
import type {
  FinanceInvoiceRow,
  FinancePaymentRow,
  FinanceReceivableRow,
  FinanceRefundRequestRow,
  FinanceSupplierPayableRow,
} from "@/lib/types/finance";

const NOW = "2027-03-15T00:00:00.000Z";

function input(overrides: Partial<FinanceMetricsInput> = {}): FinanceMetricsInput {
  return {
    receivables: [],
    payments: [],
    invoices: [],
    supplierPayables: [],
    refundRequests: [],
    groupProfitability: [],
    nowIso: NOW,
    ...overrides,
  };
}

describe("getFinanceMetric", () => {
  it("finds a registered metric by key", () => {
    expect(getFinanceMetric("finance.total_invoiced")).not.toBeNull();
  });

  it("returns null for an unknown key", () => {
    expect(getFinanceMetric("finance.made_up_metric")).toBeNull();
  });

  it("registers exactly the 12 spec metrics, each with a unique key", () => {
    const keys = FINANCE_METRICS.map((m) => m.key);
    expect(keys).toHaveLength(12);
    expect(new Set(keys).size).toBe(12);
  });
});

describe("finance.total_invoiced", () => {
  const metric = getFinanceMetric("finance.total_invoiced")!;

  it("sums non-void, non-credit-note invoices by currency", () => {
    const invoices = [
      { amount: 100000, currency: "LKR", status: "ISSUED", invoice_type: "BOOKING" },
      { amount: 50000, currency: "LKR", status: "PAID", invoice_type: "DEPOSIT" },
      { amount: 2000, currency: "USD", status: "ISSUED", invoice_type: "BOOKING" },
      { amount: 999999, currency: "LKR", status: "VOID", invoice_type: "BOOKING" },
      { amount: 5000, currency: "LKR", status: "ISSUED", invoice_type: "REFUND_CREDIT_NOTE" },
    ] as FinanceInvoiceRow[];

    const result = metric.compute(input({ invoices }));
    expect(result.available).toBe(true);
    expect(result.byCurrency).toEqual({ LKR: 150000, USD: 2000 });
  });
});

describe("finance.outstanding_receivables", () => {
  const metric = getFinanceMetric("finance.outstanding_receivables")!;

  it("only counts positive outstanding balances, never a credit shown as negative debt", () => {
    const receivables = [
      { outstanding_balance: 50000, currency: "LKR" },
      { outstanding_balance: -2000, currency: "LKR" },
      { outstanding_balance: 0, currency: "LKR" },
    ] as FinanceReceivableRow[];

    expect(metric.compute(input({ receivables })).byCurrency).toEqual({ LKR: 50000 });
  });
});

describe("finance.unverified_payments", () => {
  const metric = getFinanceMetric("finance.unverified_payments")!;

  it("counts and sums only PENDING_VERIFICATION payments", () => {
    const payments = [
      { amount: 10000, currency: "LKR", status: "PENDING_VERIFICATION" },
      { amount: 20000, currency: "LKR", status: "COMPLETED" },
      { amount: 5000, currency: "USD", status: "PENDING_VERIFICATION" },
    ] as FinancePaymentRow[];

    const result = metric.compute(input({ payments }));
    expect(result.count).toBe(2);
    expect(result.byCurrency).toEqual({ LKR: 10000, USD: 5000 });
  });
});

describe("finance.refund_liability", () => {
  const metric = getFinanceMetric("finance.refund_liability")!;

  it("includes PENDING_APPROVAL and APPROVED, excludes PAID/REJECTED/CANCELLED", () => {
    const refundRequests = [
      { amount: 1000, currency: "LKR", status: "PENDING_APPROVAL" },
      { amount: 2000, currency: "LKR", status: "APPROVED" },
      { amount: 3000, currency: "LKR", status: "PAID" },
      { amount: 4000, currency: "LKR", status: "REJECTED" },
    ] as FinanceRefundRequestRow[];

    expect(metric.compute(input({ refundRequests })).byCurrency).toEqual({ LKR: 3000 });
  });
});

describe("finance.supplier_payables_due", () => {
  const metric = getFinanceMetric("finance.supplier_payables_due")!;

  it("includes commitments due within the window or with no due date, excludes far-future ones", () => {
    const supplierPayables = [
      { outstanding_amount: 1000, currency: "LKR", payment_due_at: "2027-03-20T00:00:00.000Z" }, // within 14d
      { outstanding_amount: 2000, currency: "LKR", payment_due_at: null }, // no due date -> included
      { outstanding_amount: 3000, currency: "LKR", payment_due_at: "2027-06-01T00:00:00.000Z" }, // far future -> excluded
      { outstanding_amount: 0, currency: "LKR", payment_due_at: null }, // zero -> excluded
    ] as FinanceSupplierPayableRow[];

    expect(metric.compute(input({ supplierPayables })).byCurrency).toEqual({ LKR: 3000 });
  });
});

describe("finance.net_cash_position", () => {
  const metric = getFinanceMetric("finance.net_cash_position")!;

  it("is total collected minus total paid to suppliers, per currency", () => {
    const payments = [{ amount: 100000, currency: "LKR", status: "COMPLETED" }] as FinancePaymentRow[];
    const supplierPayables = [{ amount_paid: 30000, currency: "LKR" }] as FinanceSupplierPayableRow[];

    expect(metric.compute(input({ payments, supplierPayables })).byCurrency).toEqual({ LKR: 70000 });
  });
});

describe("finance.agent_commissions_due / expected_vs_actual_margin", () => {
  it("honestly reports unavailable rather than fabricating a zero", () => {
    expect(getFinanceMetric("finance.agent_commissions_due")!.compute(input())).toEqual({
      available: false,
      byCurrency: {},
    });
    expect(getFinanceMetric("finance.expected_vs_actual_margin")!.compute(input())).toEqual({
      available: false,
      byCurrency: {},
    });
  });
});

describe("finance.upcoming_group_margin", () => {
  const metric = getFinanceMetric("finance.upcoming_group_margin")!;

  it("is unavailable when no profitability data was loaded (e.g. viewer lacks viewCostAndMargin)", () => {
    expect(metric.compute(input()).available).toBe(false);
  });
});

describe("one governed registry across finance and Inbox outcomes", () => {
  it("never reuses a metric key, so a drill-down or a saved card means exactly one number", () => {
    const keys = allGovernedMetricKeys();
    expect(keys.length).toBeGreaterThan(FINANCE_METRICS.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("resolves Inbox outcome metrics through the same registry module", () => {
    expect(getInboxOutcomeMetric("OVERDUE_CONVERSATIONS")?.key).toBe("OVERDUE_CONVERSATIONS");
    expect(getFinanceMetric("OVERDUE_CONVERSATIONS")).toBeNull();
  });
});
