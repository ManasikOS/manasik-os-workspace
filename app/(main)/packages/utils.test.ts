import { describe, expect, it } from "vitest";

import type { PackageListItem } from "@/lib/types/packages";
import {
  applySavedView,
  computeListKpis,
  matchesSearch,
  sortPackages,
  toggleSort,
  DEFAULT_PACKAGE_SORT,
} from "./utils";

function makePackage(overrides: Partial<PackageListItem>): PackageListItem {
  return {
    id: "id-1",
    code: "PKG-1",
    title: "Ramadan Umrah",
    journeyType: "Umrah",
    category: "Umrah",
    packageCategory: "Standard",
    branch: "Colombo",
    status: "Draft",
    visibility: "Internal Only",
    featured: false,
    durationDays: 10,
    durationNights: 9,
    durationLabel: "10 Days / 9 Nights",
    itineraryDays: 10,
    completeness: 100,
    missingSteps: [],
    groupCount: 0,
    liveGroupCount: 0,
    seatsBooked: 0,
    seatsCapacity: 0,
    archived: false,
    updatedAt: "2026-01-01T00:00:00Z",
    ownerId: null,
    ...overrides,
  };
}

describe("applySavedView", () => {
  const packages = [
    makePackage({ id: "1", status: "Open for Sale", liveGroupCount: 3 }),
    makePackage({ id: "2", status: "Draft", ownerId: "user-a" }),
    makePackage({ id: "3", status: "Draft", ownerId: "user-b" }),
    makePackage({
      id: "4",
      featured: true,
      status: "Open for Sale",
      liveGroupCount: 1,
    }),
    makePackage({ id: "5", status: "Sales Closed", completeness: 60 }),
    makePackage({ id: "6", status: "Open for Sale", liveGroupCount: 0 }),
  ];

  it("'All Packages' (or any unknown view) returns everything unfiltered", () => {
    expect(applySavedView(packages, "All Packages", null)).toEqual(packages);
    expect(applySavedView(packages, "Nonexistent View", null)).toEqual(packages);
  });

  it("'Open for Sale' returns only packages with that status", () => {
    const result = applySavedView(packages, "Open for Sale", null);
    expect(result.map((p) => p.id)).toEqual(["1", "4", "6"]);
  });

  it("'My Drafts' scopes Draft packages to the current user when one is signed in", () => {
    const result = applySavedView(packages, "My Drafts", "user-a");
    expect(result.map((p) => p.id)).toEqual(["2"]);
  });

  it("'My Drafts' falls back to every Draft when there's no current user", () => {
    const result = applySavedView(packages, "My Drafts", null);
    expect(result.map((p) => p.id)).toEqual(["2", "3"]);
  });

  it("'Featured' returns only featured packages", () => {
    const result = applySavedView(packages, "Featured", null);
    expect(result.map((p) => p.id)).toEqual(["4"]);
  });

  it("'Needs Attention' catches incomplete packages and live-group-less Open for Sale packages", () => {
    const result = applySavedView(packages, "Needs Attention", null);
    expect(result.map((p) => p.id).sort()).toEqual(["5", "6"]);
  });
});

describe("matchesSearch", () => {
  const pkg = makePackage({ title: "Ramadan Umrah", code: "PKG-1", branch: "Colombo" });

  it("matches an empty query", () => {
    expect(matchesSearch(pkg, "")).toBe(true);
    expect(matchesSearch(pkg, "   ")).toBe(true);
  });

  it("matches title, code, branch and category case-insensitively", () => {
    expect(matchesSearch(pkg, "ramadan")).toBe(true);
    expect(matchesSearch(pkg, "PKG-1")).toBe(true);
    expect(matchesSearch(pkg, "colombo")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesSearch(pkg, "hajj")).toBe(false);
  });
});

describe("sortPackages", () => {
  const packages = [
    makePackage({ id: "1", title: "Zebra Umrah", updatedAt: "2026-01-01T00:00:00Z" }),
    makePackage({ id: "2", title: "Alpha Umrah", updatedAt: "2026-03-01T00:00:00Z" }),
    makePackage({ id: "3", title: "Mid Umrah", updatedAt: "2026-02-01T00:00:00Z" }),
  ];

  it("sorts by title ascending", () => {
    const sorted = sortPackages(packages, { field: "title", direction: "asc" });
    expect(sorted.map((p) => p.id)).toEqual(["2", "3", "1"]);
  });

  it("sorts by updatedAt descending (the default)", () => {
    const sorted = sortPackages(packages, DEFAULT_PACKAGE_SORT);
    expect(sorted.map((p) => p.id)).toEqual(["2", "3", "1"]);
  });

  it("breaks ties by title", () => {
    const tied = [
      makePackage({ id: "b", title: "Beta", completeness: 50 }),
      makePackage({ id: "a", title: "Alpha", completeness: 50 }),
    ];
    const sorted = sortPackages(tied, { field: "completeness", direction: "asc" });
    expect(sorted.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("toggleSort", () => {
  it("flips direction when clicking the already-active column", () => {
    const next = toggleSort({ field: "title", direction: "asc" }, "title");
    expect(next).toEqual({ field: "title", direction: "desc" });
  });

  it("adopts the new column's default direction when switching columns", () => {
    const next = toggleSort({ field: "title", direction: "desc" }, "groups");
    expect(next).toEqual({ field: "groups", direction: "desc" });
  });
});

describe("computeListKpis", () => {
  it("aggregates counts across the given packages", () => {
    const packages = [
      makePackage({ status: "Open for Sale", liveGroupCount: 2, seatsBooked: 10, seatsCapacity: 40 }),
      makePackage({ status: "Draft", liveGroupCount: 0, seatsBooked: 0, seatsCapacity: 0 }),
      makePackage({ status: "Open for Sale", liveGroupCount: 1, seatsBooked: 5, seatsCapacity: 20 }),
    ];
    expect(computeListKpis(packages)).toEqual({
      openForSale: 2,
      draftsInProgress: 1,
      liveGroups: 3,
      seatsBooked: 15,
      seatsCapacity: 60,
    });
  });
});
