import { describe, expect, it } from "vitest";

import { rankFinanceExceptionPriorities } from "./finance-exception-priority";
import { buildFinanceExceptionProjection } from "./finance-exception-projection";
import type { FinanceReceivableRow, FinanceRefundRequestRow, FinanceSupplierPayableRow } from "@/lib/types/finance";

const receivable = (overrides: Partial<FinanceReceivableRow> = {}): FinanceReceivableRow => ({
  booking_id: "booking-1", booking_reference: "BK-001", primary_contact_name: "Amina", primary_contact_phone: "", traveller_count: 1,
  booking_status: "CONFIRMED", total_booking_value: 200, amount_paid: 50, outstanding_balance: 150, next_due_at: "2026-10-03T00:00:00.000Z",
  finance_owner_name: null, departure_group_id: "group-1", group_name: "October Umrah", group_code: "OCT", branch: "Main", departure_date: "2026-10-20",
  advance_deposit: null, currency: "LKR", next_milestone_id: "milestone-1", next_milestone_label: "Balance", next_milestone_type: "FINAL_BALANCE",
  next_milestone_amount: 150, next_milestone_paid: 0, next_milestone_due_at: "2026-10-03T00:00:00.000Z", overdue_milestone_count: 0,
  overdue_amount: 0, open_refund_count: 0, ...overrides,
});

const refund = (overrides: Partial<FinanceRefundRequestRow> = {}): FinanceRefundRequestRow => ({
  id: "refund-1", reference: "RFD-001", booking_id: "booking-1", departure_group_id: "group-1", reason: "CANCELLATION", reason_note: null,
  amount: 50, currency: "USD", policy_snapshot: null, status: "PENDING_APPROVAL", requested_by: null, requested_by_name: null,
  requested_at: "2026-09-20T00:00:00.000Z", decided_by: null, decided_by_name: null, decided_at: null, decision_note: null, payout_payment_id: null,
  booking_reference: "BK-001", primary_contact_name: "Amina", group_name: "October Umrah", group_code: "OCT", ...overrides,
});

const supplier = (overrides: Partial<FinanceSupplierPayableRow> = {}): FinanceSupplierPayableRow => ({
  commitment_id: "supplier-1", reference_code: "SUP-001", service_category: "HOTEL", service_label: "Hotel", service_booking_reference: null,
  commitment_status: "DISPUTED", amount: 100, amount_paid: 0, outstanding_amount: 100, currency: "EUR", payment_due_at: null,
  owner_name: null, supplier_id: "supplier", supplier_name: "Hotel Partner", supplier_code: "HP", departure_group_id: "group-1",
  group_name: "October Umrah", group_code: "OCT", ...overrides,
});

describe("rankFinanceExceptionPriorities", () => {
  it("uses the approved fixed policy and never compares monetary values", () => {
    const ranked = rankFinanceExceptionPriorities([
      { id: "refund", signal: "PENDING_REFUND", currency: "USD", amount: 1_000_000 },
      { id: "overdue", signal: "OVERDUE_RECEIVABLE", overdueDays: 4, overdueMilestoneCount: 2, currency: "LKR", amount: 1 },
      { id: "disputed", signal: "DISPUTED_SUPPLIER", currency: "EUR", amount: 10 },
    ]);

    expect(ranked.map((item) => item.id)).toEqual(["overdue", "disputed", "refund"]);
    expect(ranked[0]).toMatchObject({ score: 106, reasonCodes: ["OVERDUE_RECEIVABLE", "MULTIPLE_OVERDUE_MILESTONES"] });
    expect(ranked[0].currency).toBe("LKR");
  });

  it("keeps incomplete due-date data actionable and explains what is missing", () => {
    const [item] = rankFinanceExceptionPriorities([
      { id: "unknown-date", signal: "OVERDUE_RECEIVABLE", overdueDays: null, overdueMilestoneCount: 1 },
    ]);

    expect(item.reasonCodes).toEqual(["OVERDUE_RECEIVABLE", "OVERDUE_DATE_UNAVAILABLE"]);
    expect(item.score).toBe(100);
  });

  it("orders equal priorities by stable source identity", () => {
    expect(
      rankFinanceExceptionPriorities([
        { id: "booking-b", signal: "DUE_SOON_RECEIVABLE" },
        { id: "booking-a", signal: "DUE_SOON_RECEIVABLE" },
      ]).map((item) => item.id),
    ).toEqual(["booking-a", "booking-b"]);
  });

  it("builds a source-linked, currency-separated projection without leaking redacted amounts", () => {
    const projection = buildFinanceExceptionProjection({
      receivables: [receivable({ overdue_milestone_count: 2, overdue_amount: 120, next_milestone_due_at: "2026-09-20T00:00:00.000Z" })],
      refundRequests: [refund()],
      supplierPayables: [supplier()],
      nowIso: "2026-09-27T00:00:00.000Z",
      includeAmounts: false,
    });

    expect(projection.items.map((item) => item.source)).toEqual(["RECEIVABLE", "SUPPLIER_PAYABLE", "REFUND"]);
    expect(projection.items.every((item) => item.amount === null)).toBe(true);
    expect(Object.keys(projection.byCurrency).sort()).toEqual(["EUR", "LKR", "USD"]);
    expect(projection.items[0]).toMatchObject({ href: "/finance?view=receivables&subview=balances", actionLabel: "Open receivable" });
  });
});
