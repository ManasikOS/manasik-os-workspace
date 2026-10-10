import { describe, expect, it } from "vitest";

import { computeListStepGaps, listCompletenessPercent } from "./packages";

const COMPLETE_ROW = {
  title: "Ramadan Umrah 2026",
  internal_code: "RF-PKG-2026-UM01",
  description: "A full-service Umrah package.",
  package_category: "Standard",
  default_capacity: 40,
  min_group_size: 15,
  days: 10,
  cancellation_policy: "Non-refundable within 14 days.",
  payment_milestones_count: 2,
  itinerary_days: 10,
  duration: "10 Days / 9 Nights",
  transport_requirements_count: 2,
  inclusions_count: 5,
  exclusions_count: 2,
  included_services_count: 4,
  document_requirements_count: 3,
  group_readiness_checklist_count: 4,
  default_group_capacity: 40,
};

describe("computeListStepGaps", () => {
  it("reports no gaps for a fully populated row", () => {
    expect(computeListStepGaps(COMPLETE_ROW)).toEqual([]);
  });

  it("flags step 1 when title, code, category or capacity are missing", () => {
    expect(computeListStepGaps({ ...COMPLETE_ROW, title: "" })).toContain(1);
    expect(computeListStepGaps({ ...COMPLETE_ROW, internal_code: "  " })).toContain(1);
    expect(computeListStepGaps({ ...COMPLETE_ROW, default_capacity: 0 })).toContain(1);
    expect(computeListStepGaps({ ...COMPLETE_ROW, default_capacity: null })).toContain(1);
    expect(computeListStepGaps({ ...COMPLETE_ROW, min_group_size: null })).toContain(1);
  });

  it("does not flag step 1 for a missing description when the column wasn't selected at all", () => {
    // The CSV export row shape (and a few other narrow projections) never
    // selects `description` — `undefined` means "not fetched", not "empty",
    // so it must not read as incomplete. See the function's own comment.
    const { description: _description, ...withoutDescription } = COMPLETE_ROW;
    expect(computeListStepGaps(withoutDescription)).not.toContain(1);
  });

  it("flags step 1 when description was selected but is blank", () => {
    expect(computeListStepGaps({ ...COMPLETE_ROW, description: "   " })).toContain(1);
  });

  it("flags step 2 when the cancellation policy or payment milestones are missing", () => {
    expect(computeListStepGaps({ ...COMPLETE_ROW, cancellation_policy: "" })).toContain(2);
    expect(computeListStepGaps({ ...COMPLETE_ROW, payment_milestones_count: 0 })).toContain(2);
  });

  it("flags step 3 when duration or itinerary days are missing", () => {
    expect(computeListStepGaps({ ...COMPLETE_ROW, duration: "" })).toContain(3);
    expect(computeListStepGaps({ ...COMPLETE_ROW, itinerary_days: 0 })).toContain(3);
  });

  it("flags step 4 when any of the service-standard counts are zero", () => {
    expect(computeListStepGaps({ ...COMPLETE_ROW, inclusions_count: 0 })).toContain(4);
    expect(computeListStepGaps({ ...COMPLETE_ROW, transport_requirements_count: 0 })).toContain(4);
  });

  it("flags step 5 when there are no document requirements", () => {
    expect(computeListStepGaps({ ...COMPLETE_ROW, document_requirements_count: 0 })).toContain(5);
  });

  it("flags step 6 when group defaults are missing", () => {
    expect(computeListStepGaps({ ...COMPLETE_ROW, default_group_capacity: 0 })).toContain(6);
    expect(computeListStepGaps({ ...COMPLETE_ROW, group_readiness_checklist_count: 0 })).toContain(6);
  });
});

describe("listCompletenessPercent", () => {
  it("is 100 when nothing is missing", () => {
    expect(listCompletenessPercent([])).toBe(100);
  });

  it("is 0 when every step is missing", () => {
    expect(listCompletenessPercent([1, 2, 3, 4, 5, 6])).toBe(0);
  });

  it("rounds to the nearest whole percent for a partial gap", () => {
    // 4 of 6 steps complete = 66.67%, rounds to 67.
    expect(listCompletenessPercent([1, 2])).toBe(67);
  });
});

import { INITIAL_PACKAGE_FORM_DATA } from "@/app/(main)/packages/create-package/types";

import { PACKAGE_LIMITS, packageFormSchema } from "./packages";

describe("packageFormSchema limits (TASK-043)", () => {
  const valid = () => ({ ...INITIAL_PACKAGE_FORM_DATA });

  it("accepts the wizard's starting form", () => {
    expect(packageFormSchema.safeParse(valid()).success).toBe(true);
  });

  it("rejects fields the form does not have", () => {
    expect(packageFormSchema.safeParse({ ...valid(), owner_id: "x" }).success).toBe(false);
  });

  it("caps text length", () => {
    expect(packageFormSchema.safeParse({ ...valid(), title: "a".repeat(PACKAGE_LIMITS.title) }).success).toBe(true);
    expect(packageFormSchema.safeParse({ ...valid(), title: "a".repeat(PACKAGE_LIMITS.title + 1) }).success).toBe(false);
    expect(packageFormSchema.safeParse({ ...valid(), cancellationPolicy: "a".repeat(PACKAGE_LIMITS.longText + 1) }).success).toBe(false);
    expect(packageFormSchema.safeParse({ ...valid(), internalCode: "a".repeat(PACKAGE_LIMITS.code + 1) }).success).toBe(false);
  });

  it("caps list sizes", () => {
    expect(packageFormSchema.safeParse({ ...valid(), inclusions: Array.from({ length: PACKAGE_LIMITS.textListItems + 1 }, (_, i) => `item ${i}`) }).success).toBe(false);
    const day = (i: number) => ({ id: `d${i}`, dayNumber: i, title: "", description: "" });
    expect(packageFormSchema.safeParse({ ...valid(), itinerary: Array.from({ length: PACKAGE_LIMITS.itineraryDays }, (_, i) => day(i + 1)) }).success).toBe(true);
    expect(packageFormSchema.safeParse({ ...valid(), itinerary: Array.from({ length: PACKAGE_LIMITS.itineraryDays + 1 }, (_, i) => day(i + 1)) }).success).toBe(false);
  });

  it("keeps counts whole and in range, and still lets an empty or NaN number through as empty", () => {
    expect(packageFormSchema.safeParse({ ...valid(), defaultCapacity: 12.5 }).success).toBe(false);
    expect(packageFormSchema.safeParse({ ...valid(), defaultCapacity: -1 }).success).toBe(false);
    expect(packageFormSchema.safeParse({ ...valid(), defaultCapacity: 1e12 }).success).toBe(false);
    expect(packageFormSchema.safeParse({ ...valid(), defaultCapacity: 40 }).success).toBe(true);
    expect(packageFormSchema.safeParse({ ...valid(), defaultCapacity: "" }).success).toBe(true);
    expect(packageFormSchema.safeParse({ ...valid(), defaultCapacity: Number.NaN }).success).toBe(true);
  });

  it("checks payment milestone amounts and dates", () => {
    const milestone = { id: "m1", label: "Deposit", amountType: "Fixed Amount", amount: 5000, dueRule: "Fixed Date", dueDate: "2027-01-15", refundable: false };
    expect(packageFormSchema.safeParse({ ...valid(), paymentMilestones: [milestone] }).success).toBe(true);
    expect(packageFormSchema.safeParse({ ...valid(), paymentMilestones: [{ ...milestone, amount: -5 }] }).success).toBe(false);
    expect(packageFormSchema.safeParse({ ...valid(), paymentMilestones: [{ ...milestone, amount: 1e12 }] }).success).toBe(false);
    expect(packageFormSchema.safeParse({ ...valid(), paymentMilestones: [{ ...milestone, dueDate: "next week" }] }).success).toBe(false);
    expect(packageFormSchema.safeParse({ ...valid(), paymentMilestones: [{ ...milestone, id: "" }] }).success).toBe(false);
  });

  it("requires itinerary days to be whole numbers", () => {
    const day = { id: "d1", dayNumber: 1.5, title: "", description: "" };
    expect(packageFormSchema.safeParse({ ...valid(), itinerary: [day] }).success).toBe(false);
  });
});
