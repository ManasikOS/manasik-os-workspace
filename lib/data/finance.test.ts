import { describe, expect, it } from "vitest";

import { derivePlanStatus, isRescheduledPlan } from "./finance";
import type { FinanceMilestoneRow } from "@/lib/types/finance";

function milestone(overrides: Partial<FinanceMilestoneRow> = {}): FinanceMilestoneRow {
  return {
    id: "m1",
    booking_id: "b1",
    departure_group_id: "g1",
    sequence: 1,
    label: "Deposit",
    milestone_type: "DEPOSIT",
    amount: 1000,
    due_at: "2026-01-10T00:00:00.000Z",
    paid_amount: 0,
    paid_at: null,
    waived: false,
    due_at_previous: null,
    due_at_changed_at: null,
    due_at_change_reason: null,
    note: null,
    booking_reference: "BK-0001",
    primary_contact_name: "A. Traveller",
    booking_status: "CONFIRMED",
    group_name: "Umrah Jan Group",
    group_code: "UJ01",
    currency: "LKR",
    ...overrides,
  };
}

const NOW = "2026-01-10T09:00:00.000Z";

describe("derivePlanStatus", () => {
  it("is CANCELLED whenever the booking is cancelled, regardless of due date or waiver", () => {
    expect(derivePlanStatus(milestone({ booking_status: "CANCELLED" }), NOW)).toBe("CANCELLED");
  });

  it("is WAIVED even if unpaid and overdue", () => {
    expect(
      derivePlanStatus(milestone({ waived: true, due_at: "2020-01-01T00:00:00.000Z" }), NOW),
    ).toBe("WAIVED");
  });

  it("is COMPLETED once paid_amount reaches amount", () => {
    expect(derivePlanStatus(milestone({ paid_amount: 1000 }), NOW)).toBe("COMPLETED");
    expect(derivePlanStatus(milestone({ paid_amount: 1200 }), NOW)).toBe("COMPLETED");
  });

  it("is NO_DUE_DATE when unpaid with no due date", () => {
    expect(derivePlanStatus(milestone({ due_at: null }), NOW)).toBe("NO_DUE_DATE");
  });

  it("buckets by whole calendar days, not by <7-day/<0-day arithmetic on timestamps", () => {
    expect(derivePlanStatus(milestone({ due_at: "2026-01-05T00:00:00.000Z" }), NOW)).toBe("OVERDUE");
    expect(derivePlanStatus(milestone({ due_at: NOW }), NOW)).toBe("DUE_TODAY");
    expect(derivePlanStatus(milestone({ due_at: "2026-01-14T00:00:00.000Z" }), NOW)).toBe("DUE_THIS_WEEK");
    expect(derivePlanStatus(milestone({ due_at: "2026-02-01T00:00:00.000Z" }), NOW)).toBe("UPCOMING");
  });
});

describe("isRescheduledPlan", () => {
  it("is true only once a milestone has ever had a previous due date recorded", () => {
    expect(isRescheduledPlan(milestone())).toBe(false);
    expect(isRescheduledPlan(milestone({ due_at_previous: "2026-01-01T00:00:00.000Z" }))).toBe(true);
  });
});
