import { describe, expect, it } from "vitest";

import {
  addDays,
  buildGroupCostEstimate,
  buildGroupPricing,
  daysBetween,
  isUuid,
  resolveDueAt,
  toPaymentMilestoneSnapshot,
  type GroupCostEstimateInput,
  type GroupPricingInput,
} from "./departure-groups-copy";
import type { PaymentMilestone } from "@/app/(main)/packages/create-package/types";

describe("addDays / daysBetween", () => {
  it("adds (and subtracts) whole days without drifting across month/year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("is a true inverse of daysBetween", () => {
    expect(daysBetween("2026-01-01", addDays("2026-01-01", 45))).toBe(45);
    expect(daysBetween("2026-06-15", addDays("2026-06-15", -10))).toBe(-10);
  });
});

describe("resolveDueAt", () => {
  const departureDate = "2026-09-20";

  it("resolves DAYS_BEFORE_DEPARTURE against the group's real departure date", () => {
    expect(resolveDueAt("DAYS_BEFORE_DEPARTURE", 30, departureDate)).toBe(
      "2026-08-21T17:00:00.000Z",
    );
  });

  it("returns null for DAYS_BEFORE_DEPARTURE when no day count is given", () => {
    expect(resolveDueAt("DAYS_BEFORE_DEPARTURE", null, departureDate)).toBeNull();
  });

  it("resolves the fixed-offset due types (1/30/21 days before departure)", () => {
    expect(resolveDueAt("BEFORE_DEPARTURE", null, departureDate)).toBe(
      "2026-09-19T17:00:00.000Z",
    );
    expect(resolveDueAt("BEFORE_VISA_SUBMISSION", null, departureDate)).toBe(
      "2026-08-21T17:00:00.000Z",
    );
    expect(resolveDueAt("BEFORE_FINAL_PAYMENT", null, departureDate)).toBe(
      "2026-08-30T17:00:00.000Z",
    );
  });

  it("returns null for gate-based due types that aren't real dates", () => {
    expect(resolveDueAt("BEFORE_GROUP_OPENS", null, departureDate)).toBeNull();
    expect(resolveDueAt("BEFORE_FIRST_BOOKING", null, departureDate)).toBeNull();
  });
});

describe("toPaymentMilestoneSnapshot", () => {
  const base: PaymentMilestone = {
    id: "m1",
    label: "Deposit",
    amountType: "Fixed Amount",
    amount: 500,
    dueRule: "On Booking",
    refundable: true,
  };

  it("copies scalar fields and coerces amount/daysBeforeDeparture to numbers", () => {
    const snapshot = toPaymentMilestoneSnapshot({
      ...base,
      daysBeforeDeparture: 14,
    });
    expect(snapshot).toEqual({
      id: "m1",
      label: "Deposit",
      amount_type: "Fixed Amount",
      amount: 500,
      due_rule: "On Booking",
      due_date: null,
      days_before_departure: 14,
      refundable: true,
    });
  });

  it("treats an empty-string amount or daysBeforeDeparture as null, not NaN or 0", () => {
    const snapshot = toPaymentMilestoneSnapshot({
      ...base,
      amount: "",
      daysBeforeDeparture: "",
    });
    expect(snapshot.amount).toBeNull();
    expect(snapshot.days_before_departure).toBeNull();
  });

  it("passes through an explicit due date when the rule is Fixed Date", () => {
    const snapshot = toPaymentMilestoneSnapshot({
      ...base,
      dueRule: "Fixed Date",
      dueDate: "2026-10-01",
    });
    expect(snapshot.due_date).toBe("2026-10-01");
  });
});

describe("buildGroupPricing", () => {
  const input: GroupPricingInput = {
    currency: "LKR",
    quadPrice: 450000,
    triplePrice: 480000,
    doublePrice: 520000,
    singlePrice: 650000,
    childPrice: 300000,
    infantPrice: 50000,
    earlyBirdPrice: null,
    advanceDeposit: 50000,
  };

  it("maps every price field through and marks the source as TEMPLATE", () => {
    const row = buildGroupPricing("group-1", input, [], "2026-01-01T00:00:00.000Z");
    expect(row.departure_group_id).toBe("group-1");
    expect(row.currency).toBe("LKR");
    expect(row.quad_price).toBe(450000);
    expect(row.price_source).toBe("TEMPLATE");
    expect(row.priced_by).toBeNull();
    expect(row.priced_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row.updated_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("copies the payment schedule as independent objects, not shared references", () => {
    const schedule = [
      {
        id: "m1",
        label: "Deposit",
        amount_type: "Fixed Amount" as const,
        amount: 500,
        due_rule: "On Booking" as const,
        due_date: null,
        days_before_departure: null,
        refundable: true,
      },
    ];
    const row = buildGroupPricing("group-1", input, schedule);
    expect(row.payment_milestones).toEqual(schedule);
    expect(row.payment_milestones[0]).not.toBe(schedule[0]);
  });
});

describe("buildGroupCostEstimate", () => {
  it("maps every per-pilgrim cost field and the fixed cost through unchanged", () => {
    const input: GroupCostEstimateInput = {
      flightCostPerPilgrim: 1000,
      accommodationCostPerPilgrim: 2000,
      transportCostPerPilgrim: 300,
      visaInsuranceCostPerPilgrim: 150,
      cateringCostPerPilgrim: 400,
      guideOperationsCostPerPilgrim: 100,
      contingencyCostPerPilgrim: 50,
      fixedCostPerDeparture: 5000,
    };
    const row = buildGroupCostEstimate("group-1", input, "2026-01-01T00:00:00.000Z");
    expect(row).toEqual({
      departure_group_id: "group-1",
      flight_cost_per_pilgrim: 1000,
      accommodation_cost_per_pilgrim: 2000,
      transport_cost_per_pilgrim: 300,
      visa_insurance_cost_per_pilgrim: 150,
      catering_cost_per_pilgrim: 400,
      guide_operations_cost_per_pilgrim: 100,
      contingency_cost_per_pilgrim: 50,
      fixed_cost_per_departure: 5000,
      updated_at: "2026-01-01T00:00:00.000Z",
      updated_by: null,
    });
  });
});

describe("isUuid", () => {
  it("accepts a real package id but rejects the built-in template library's readable keys", () => {
    expect(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe(true);
    expect(isUuid("pkg-umrah-standard-2026")).toBe(false);
  });
});
