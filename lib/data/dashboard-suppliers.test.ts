import { describe, expect, it } from "vitest";

import { PAYMENT_DUE_WINDOW_DAYS } from "./suppliers-copy";
import type { SupplierListItem } from "./suppliers";
import { buildSupplierPayables, SUPPLIER_PAYABLES_ROW_LIMIT } from "./dashboard-suppliers";

const NOW = "2026-10-13T09:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;

function inDays(days: number): string {
  return new Date(Date.parse(NOW) + days * DAY).toISOString();
}

let seq = 0;

function supplier(overrides: Partial<SupplierListItem> = {}): SupplierListItem {
  seq += 1;
  return {
    id: `s${seq}`,
    name: `Supplier ${seq}`,
    supplierType: "HOTEL",
    status: "ACTIVE",
    currency: "LKR",
    confirmedCount: 0,
    pendingCount: 0,
    issueCount: 0,
    outstandingAmount: 0,
    nextPaymentDueAt: null,
    ...overrides,
  } as SupplierListItem;
}

describe("buildSupplierPayables", () => {
  it("states totals with the suppliers module's own KPI definitions", () => {
    const data = buildSupplierPayables(
      [
        supplier({ outstandingAmount: 100_000, nextPaymentDueAt: inDays(3), pendingCount: 2, issueCount: 1 }),
        supplier({ outstandingAmount: 50_000, nextPaymentDueAt: inDays(10), pendingCount: 1 }),
        supplier({ outstandingAmount: 900_000, nextPaymentDueAt: inDays(40) }),
      ],
      NOW,
    );
    expect(data.paymentsDueByCurrency).toEqual({ LKR: 150_000 });
    expect(data.confirmationsPending).toBe(3);
    expect(data.supplierIssues).toBe(1);
    expect(data.dueSupplierCount).toBe(2);
  });

  it("keeps currencies separate - nothing is converted", () => {
    const data = buildSupplierPayables(
      [
        supplier({ currency: "LKR", outstandingAmount: 100_000, nextPaymentDueAt: inDays(2) }),
        supplier({ currency: "SAR", outstandingAmount: 5_000, nextPaymentDueAt: inDays(2) }),
      ],
      NOW,
    );
    expect(data.paymentsDueByCurrency).toEqual({ LKR: 100_000, SAR: 5_000 });
  });

  it("lists suppliers due inside the module's payment window, soonest first, overdue first of all", () => {
    const data = buildSupplierPayables(
      [
        supplier({ name: "Later", outstandingAmount: 10, nextPaymentDueAt: inDays(PAYMENT_DUE_WINDOW_DAYS - 1) }),
        supplier({ name: "Overdue", outstandingAmount: 10, nextPaymentDueAt: inDays(-4) }),
        supplier({ name: "Soon", outstandingAmount: 10, nextPaymentDueAt: inDays(2) }),
      ],
      NOW,
    );
    expect(data.suppliers.map((s) => s.name)).toEqual(["Overdue", "Soon", "Later"]);
    expect(data.suppliers[0].overdue).toBe(true);
    expect(data.suppliers[0].daysUntilDue).toBeLessThan(0);
    expect(data.suppliers[1].overdue).toBe(false);
  });

  it("leaves out suppliers with nothing owed, no due date, or a due date past the window", () => {
    const data = buildSupplierPayables(
      [
        supplier({ outstandingAmount: 0, nextPaymentDueAt: inDays(1) }),
        supplier({ outstandingAmount: 500, nextPaymentDueAt: null }),
        supplier({ outstandingAmount: 500, nextPaymentDueAt: inDays(PAYMENT_DUE_WINDOW_DAYS + 5) }),
      ],
      NOW,
    );
    expect(data.suppliers).toEqual([]);
    expect(data.dueSupplierCount).toBe(0);
  });

  it("limits the list but still reports how many suppliers are due", () => {
    const many = Array.from({ length: SUPPLIER_PAYABLES_ROW_LIMIT + 4 }, (_, i) =>
      supplier({ outstandingAmount: 100, nextPaymentDueAt: inDays(i + 1) }),
    );
    const data = buildSupplierPayables(many, NOW);
    expect(data.suppliers).toHaveLength(SUPPLIER_PAYABLES_ROW_LIMIT);
    expect(data.dueSupplierCount).toBe(SUPPLIER_PAYABLES_ROW_LIMIT + 4);
  });

  it("carries no contact details", () => {
    const data = buildSupplierPayables(
      [
        supplier({
          outstandingAmount: 100,
          nextPaymentDueAt: inDays(1),
          primaryContactName: "Mr. Contact",
          primaryContactPhone: "0771234567",
          primaryContactWhatsapp: "0779999999",
        }),
      ],
      NOW,
    );
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain("Mr. Contact");
    expect(serialised).not.toContain("0771234567");
    expect(serialised).not.toContain("0779999999");
  });

  it("returns zeros for an agency with no suppliers", () => {
    expect(buildSupplierPayables([], NOW)).toEqual({
      paymentsDueByCurrency: {},
      confirmationsPending: 0,
      supplierIssues: 0,
      dueSupplierCount: 0,
      suppliers: [],
      totalSuppliers: 0,
    });
  });
});
