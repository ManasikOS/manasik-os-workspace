import { describe, expect, it } from "vitest";

import type { CrossPilgrimSupportRow } from "@/lib/data/support-repository";

import {
  canViewSupportCases,
  filterSupportCases,
  isSupportCaseOverdue,
  restrictSupportCasesToGroups,
  summariseSupportCases,
} from "./support-cases";

const NOW = Date.parse("2026-09-27T12:00:00Z");

function supportCase(overrides: Partial<CrossPilgrimSupportRow> = {}): CrossPilgrimSupportRow {
  return {
    id: "case-1",
    pilgrimId: "pilgrim-1",
    pilgrimName: "Aisha Rahman",
    departureGroupId: "group-1",
    groupName: "Ramadan Umrah",
    groupCode: "RU-01",
    title: "Wheelchair needed at arrival",
    detail: null,
    category: "MOBILITY",
    priority: "NORMAL",
    status: "OPEN",
    assignedRole: "OPERATIONS",
    raisedByPortal: false,
    createdAt: "2026-09-20T08:00:00Z",
    resolvedAt: null,
    slaDueAt: null,
    escalatedAt: null,
    escalatedToRole: null,
    supplierId: null,
    supplierName: null,
    ...overrides,
  };
}

describe("canViewSupportCases", () => {
  it("allows a role that can view medical details or manage support requests", () => {
    expect(
      canViewSupportCases({ viewModule: true, viewMedical: true, manageSupportRequests: false }),
    ).toBe(true);
    expect(
      canViewSupportCases({ viewModule: true, viewMedical: false, manageSupportRequests: true }),
    ).toBe(true);
  });

  it("denies a role with neither capability, or without module access", () => {
    expect(
      canViewSupportCases({ viewModule: true, viewMedical: false, manageSupportRequests: false }),
    ).toBe(false);
    expect(
      canViewSupportCases({ viewModule: false, viewMedical: true, manageSupportRequests: true }),
    ).toBe(false);
  });
});

describe("isSupportCaseOverdue", () => {
  it("is overdue only when unresolved and past its SLA due time", () => {
    expect(isSupportCaseOverdue(supportCase({ slaDueAt: "2026-09-27T11:00:00Z" }), NOW)).toBe(true);
    expect(isSupportCaseOverdue(supportCase({ slaDueAt: "2026-09-27T13:00:00Z" }), NOW)).toBe(false);
    expect(isSupportCaseOverdue(supportCase({ slaDueAt: null }), NOW)).toBe(false);
  });

  it("never treats a resolved or cancelled case as overdue", () => {
    const pastDue = "2026-09-01T00:00:00Z";
    expect(isSupportCaseOverdue(supportCase({ status: "RESOLVED", slaDueAt: pastDue }), NOW)).toBe(false);
    expect(isSupportCaseOverdue(supportCase({ status: "CANCELLED", slaDueAt: pastDue }), NOW)).toBe(false);
  });
});

describe("filterSupportCases", () => {
  const cases = [
    supportCase({ id: "open", status: "OPEN" }),
    supportCase({ id: "working", status: "IN_PROGRESS", priority: "URGENT" }),
    supportCase({ id: "done", status: "RESOLVED" }),
    supportCase({ id: "portal", title: "Lost passport", pilgrimName: "Yusuf Khan", groupCode: "HJ-09" }),
  ];
  const noFilters = { search: "", status: "OPEN_ALL", priority: "ALL" } as const;

  it("defaults to open and in-progress cases", () => {
    expect(filterSupportCases(cases, noFilters).map((c) => c.id)).toEqual(["open", "working", "portal"]);
  });

  it("filters by an exact status, or shows every status", () => {
    expect(filterSupportCases(cases, { ...noFilters, status: "RESOLVED" }).map((c) => c.id)).toEqual(["done"]);
    expect(filterSupportCases(cases, { ...noFilters, status: "ALL" })).toHaveLength(4);
  });

  it("filters by priority", () => {
    expect(filterSupportCases(cases, { ...noFilters, priority: "URGENT" }).map((c) => c.id)).toEqual(["working"]);
  });

  it("searches title, pilgrim name and group code without regard to case", () => {
    expect(filterSupportCases(cases, { ...noFilters, search: "PASSPORT" }).map((c) => c.id)).toEqual(["portal"]);
    expect(filterSupportCases(cases, { ...noFilters, search: "yusuf" }).map((c) => c.id)).toEqual(["portal"]);
    expect(filterSupportCases(cases, { ...noFilters, search: "hj-09" }).map((c) => c.id)).toEqual(["portal"]);
  });
});

describe("summariseSupportCases", () => {
  it("counts each headline figure the queue shows", () => {
    const summary = summariseSupportCases(
      [
        supportCase({ id: "a", status: "OPEN" }),
        supportCase({ id: "b", status: "IN_PROGRESS", priority: "URGENT" }),
        supportCase({ id: "c", status: "RESOLVED", priority: "URGENT" }),
        supportCase({ id: "d", status: "OPEN", slaDueAt: "2026-09-26T00:00:00Z" }),
      ],
      NOW,
    );
    expect(summary).toEqual({ open: 2, urgentUnresolved: 1, inProgress: 1, resolved: 1, overdue: 1 });
  });
});

describe("restrictSupportCasesToGroups", () => {
  const cases = [
    supportCase({ id: "mine", departureGroupId: "group-1" }),
    supportCase({ id: "other", departureGroupId: "group-2" }),
    supportCase({ id: "ungrouped", departureGroupId: null }),
  ];

  it("keeps only cases of the assigned groups, dropping ungrouped cases", () => {
    expect(restrictSupportCasesToGroups(cases, ["group-1"]).map((c) => c.id)).toEqual(["mine"]);
  });

  it("returns nothing when the viewer has no assigned groups", () => {
    expect(restrictSupportCasesToGroups(cases, [])).toEqual([]);
  });
});
