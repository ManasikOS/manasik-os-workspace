import { describe, expect, it } from "vitest";

import { INITIAL_PACKAGE_FORM_DATA, type PackageFormData } from "@/app/(main)/packages/create-package/types";
import { PACKAGE_CONTENT_COLUMNS } from "@/lib/access/package-field-tiers";

import {
  changesToContent,
  computePackageChanges,
  diffRowsById,
  diffStringLists,
  diffWords,
  groupChangesByTier,
  jsonEqual,
  PACKAGE_COLUMN_LABELS,
} from "./change-diff";

const base: PackageFormData = {
  ...INITIAL_PACKAGE_FORM_DATA,
  title: "Ramadan Umrah",
  paymentTerms: "Pay in full 30 days before departure.",
  cancellationPolicy: "No refund within 14 days.",
  itinerary: [{ id: "d1", dayNumber: 1, title: "Fly", description: "Depart Colombo", category: "Flight" }],
  paymentMilestones: [
    { id: "m1", label: "Deposit", amountType: "Fixed Amount", amount: 50000, dueRule: "On Booking", refundable: false },
  ],
};

describe("computePackageChanges", () => {
  it("returns nothing when nothing changed", () => {
    expect(computePackageChanges(base, { ...base })).toEqual([]);
  });

  it("puts a name change in Basic and a payment-terms change in Tier 1", () => {
    const changes = computePackageChanges(base, { ...base, title: "Ramadan Umrah 2027", paymentTerms: "Pay in full 45 days before departure." });
    const groups = groupChangesByTier(changes);
    expect(groups.basic.map((change) => change.column)).toEqual(["title"]);
    expect(groups.moneyAndContract.map((change) => change.column)).toEqual(["payment_terms"]);
    expect(groups.bookingsAndOperations).toEqual([]);
  });

  it("treats a capacity change as Tier 2", () => {
    const changes = computePackageChanges(base, { ...base, defaultCapacity: 55 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ column: "default_capacity", tier: 2, label: "Planned capacity" });
  });

  it("treats itinerary wording as Basic and an added day as Tier 2", () => {
    const reworded = computePackageChanges(base, { ...base, itinerary: [{ ...base.itinerary[0], title: "Fly out" }] });
    expect(reworded).toMatchObject([{ column: "itinerary", tier: 0 }]);

    const extraDay = computePackageChanges(base, {
      ...base,
      itinerary: [...base.itinerary, { id: "d2", dayNumber: 2, title: "Check in", description: "", category: "Hotel" }],
    });
    expect(extraDay).toMatchObject([{ column: "itinerary", tier: 2 }]);
  });

  it("ignores key order and missing optional keys inside lists", () => {
    const sameButReordered = {
      ...base,
      paymentMilestones: [
        { refundable: false, dueRule: "On Booking", amountType: "Fixed Amount", amount: 50000, label: "Deposit", id: "m1", notes: undefined },
      ] as PackageFormData["paymentMilestones"],
    };
    expect(computePackageChanges(base, sameButReordered)).toEqual([]);
  });

  it("never reports status or featured, which are not content", () => {
    expect(computePackageChanges(base, { ...base, status: "Archived", featured: true })).toEqual([]);
  });

  it("only ever reports columns the database accepts, and every one has a label", () => {
    const everything = computePackageChanges(INITIAL_PACKAGE_FORM_DATA, {
      ...INITIAL_PACKAGE_FORM_DATA,
      title: "x", internalCode: "x", description: "x", branch: "x", defaultCapacity: 1, paymentTerms: "x", seatReservationRule: "x",
    });
    for (const change of everything) expect(PACKAGE_CONTENT_COLUMNS as readonly string[]).toContain(change.column);
    for (const column of PACKAGE_CONTENT_COLUMNS) expect(PACKAGE_COLUMN_LABELS[column], column).toBeTruthy();
  });

  it("builds the content to send from the changes", () => {
    const changes = computePackageChanges(base, { ...base, title: "New", paymentTerms: "Changed" });
    expect(changesToContent(changes)).toEqual({ title: "New", payment_terms: "Changed" });
  });
});

describe("jsonEqual", () => {
  it("compares deeply and ignores key order", () => {
    expect(jsonEqual({ a: 1, b: [{ c: 2 }] }, { b: [{ c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual(null, undefined)).toBe(true);
    expect(jsonEqual("", null)).toBe(false);
  });
});

describe("diffWords", () => {
  it("marks only the words that changed", () => {
    const parts = diffWords("Pay in full 30 days before departure.", "Pay in full 45 days before departure.");
    expect(parts.filter((part) => part.type === "removed").map((part) => part.text)).toEqual(["30"]);
    expect(parts.filter((part) => part.type === "added").map((part) => part.text)).toEqual(["45"]);
    expect(parts.filter((part) => part.type === "same").map((part) => part.text).join("")).toContain("Pay in full ");
  });

  it("rebuilds both sides exactly from the parts", () => {
    const before = "No refund within 14 days of departure.";
    const after = "Refund of 50% up to 14 days before departure.";
    const parts = diffWords(before, after);
    expect(parts.filter((part) => part.type !== "added").map((part) => part.text).join("")).toBe(before);
    expect(parts.filter((part) => part.type !== "removed").map((part) => part.text).join("")).toBe(after);
  });

  it("handles empty sides", () => {
    expect(diffWords("", "new text")).toEqual([{ type: "added", text: "new text" }]);
    expect(diffWords("old text", "")).toEqual([{ type: "removed", text: "old text" }]);
    expect(diffWords("", "")).toEqual([]);
  });
});

describe("list diffs", () => {
  it("reports added, removed, changed and unchanged rows by id", () => {
    const rows = diffRowsById(
      [{ id: "a", label: "Deposit" }, { id: "b", label: "Final" }, { id: "c", label: "Old" }],
      [{ id: "a", label: "Deposit" }, { id: "b", label: "Final payment" }, { id: "d", label: "New" }],
    );
    expect(rows.map((row) => [row.type, (row.after ?? row.before)?.id])).toEqual([
      ["same", "a"], ["changed", "b"], ["removed", "c"], ["added", "d"],
    ]);
  });

  it("reports string list changes", () => {
    expect(diffStringLists(["Visa", "Meals"], ["Visa", "Transport"]).map((row) => [row.type, row.before ?? row.after])).toEqual([
      ["same", "Visa"], ["removed", "Meals"], ["added", "Transport"],
    ]);
  });
});
