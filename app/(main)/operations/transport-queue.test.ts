import { describe, expect, it } from "vitest";

import type { OperationsTransportItem } from "@/lib/types/operations";

import { filterTransportQueue } from "./transport-queue";

function movement(overrides: Partial<OperationsTransportItem> = {}): OperationsTransportItem {
  return {
    id: "t-1",
    groupId: "g-1",
    groupName: "Ramadan Umrah",
    routeLabel: "Jeddah Airport → Makkah",
    supplierName: "Al Safa Coaches",
    status: "CONFIRMED",
    warnings: [],
    ...overrides,
  } as OperationsTransportItem;
}

describe("filterTransportQueue", () => {
  const movements = [
    movement({ id: "ok", status: "CONFIRMED" }),
    movement({ id: "no-driver", status: "CONFIRMED", warnings: ["No driver contact recorded"] }),
    movement({ id: "asked", status: "REQUESTED" }),
    movement({ id: "done", status: "COMPLETED", routeLabel: "Makkah → Madinah", supplierName: null }),
  ];

  it("shows every movement for the all view", () => {
    expect(filterTransportQueue(movements, { view: "ALL", search: "" })).toHaveLength(4);
  });

  it("keeps only movements with warnings for the needs-attention view", () => {
    expect(
      filterTransportQueue(movements, { view: "NEEDS_ATTENTION", search: "" }).map((m) => m.id),
    ).toEqual(["no-driver"]);
  });

  it("filters by an exact supplier status", () => {
    expect(filterTransportQueue(movements, { view: "REQUESTED", search: "" }).map((m) => m.id)).toEqual(["asked"]);
    expect(filterTransportQueue(movements, { view: "COMPLETED", search: "" }).map((m) => m.id)).toEqual(["done"]);
  });

  it("combines the view with a search over group, route and supplier", () => {
    expect(
      filterTransportQueue(movements, { view: "ALL", search: "madinah" }).map((m) => m.id),
    ).toEqual(["done"]);
    expect(
      filterTransportQueue(movements, { view: "CONFIRMED", search: "al safa" }).map((m) => m.id),
    ).toEqual(["ok", "no-driver"]);
  });
});
