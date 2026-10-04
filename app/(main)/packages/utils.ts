/**
 * Client-safe display and list helpers for the Packages module.
 *
 * No server imports here — mirrors `app/(main)/departure-groups/utils.ts`.
 * The list page fetches the whole role-scoped catalogue once
 * (`lib/data/packages-repository.ts`); everything below — saved views,
 * search, filters, sort — runs against that one array in the browser, so
 * changing a filter never costs a server round trip.
 */

import type { PackageListItem, PackageListKpis } from "@/lib/types/packages";

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

/** Recomputed on the client whenever the filters change, so the KPI row always describes what's on screen. */
export function computeListKpis(items: PackageListItem[]): PackageListKpis {
  return {
    openForSale: items.filter((p) => p.status === "Open for Sale").length,
    draftsInProgress: items.filter((p) => p.status === "Draft").length,
    liveGroups: items.reduce((sum, p) => sum + p.liveGroupCount, 0),
    seatsBooked: items.reduce((sum, p) => sum + p.seatsBooked, 0),
    seatsCapacity: items.reduce((sum, p) => sum + p.seatsCapacity, 0),
  };
}

/* ── Sorting ──────────────────────────────────────────────────────────────── */

export type PackageSortField =
  | "updatedAt"
  | "title"
  | "duration"
  | "groups"
  | "completeness"
  | "status";

export type SortDirection = "asc" | "desc";

export interface PackageSort {
  field: PackageSortField;
  direction: SortDirection;
}

export const DEFAULT_PACKAGE_SORT: PackageSort = {
  field: "updatedAt",
  direction: "desc",
};

export const PACKAGE_SORT_OPTIONS: {
  field: PackageSortField;
  label: string;
  defaultDirection: SortDirection;
}[] = [
  { field: "updatedAt", label: "Last updated", defaultDirection: "desc" },
  { field: "title", label: "Title", defaultDirection: "asc" },
  { field: "duration", label: "Duration", defaultDirection: "asc" },
  { field: "groups", label: "Departure groups", defaultDirection: "desc" },
  { field: "completeness", label: "Completeness", defaultDirection: "asc" },
  { field: "status", label: "Status", defaultDirection: "asc" },
];

function sortKey(item: PackageListItem, field: PackageSortField): string | number {
  switch (field) {
    case "updatedAt":
      return item.updatedAt;
    case "title":
      return item.title.toLowerCase();
    case "duration":
      return item.durationDays;
    case "groups":
      return item.liveGroupCount;
    case "completeness":
      return item.completeness;
    case "status":
      return item.status;
  }
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function sortPackages(
  items: PackageListItem[],
  sort: PackageSort,
): PackageListItem[] {
  const modifier = sort.direction === "asc" ? 1 : -1;

  return [...items].sort((a, b) => {
    const primary = compare(sortKey(a, sort.field), sortKey(b, sort.field));
    if (primary !== 0) return primary * modifier;
    return a.title.localeCompare(b.title);
  });
}

export function sortLabel(sort: PackageSort): string {
  const option = PACKAGE_SORT_OPTIONS.find((entry) => entry.field === sort.field);
  if (!option) return "Sort";
  return `${option.label} · ${sort.direction === "asc" ? "ascending" : "descending"}`;
}

/** Header-click behaviour: clicking the active column flips direction, a new one adopts its usual direction. */
export function toggleSort(current: PackageSort, field: PackageSortField): PackageSort {
  if (current.field === field) {
    return { field, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  const option = PACKAGE_SORT_OPTIONS.find((entry) => entry.field === field);
  return { field, direction: option?.defaultDirection ?? "asc" };
}

/* ── Saved views ──────────────────────────────────────────────────────────── */

export function applySavedView(
  items: PackageListItem[],
  view: string,
  currentUserId: string | null,
): PackageListItem[] {
  switch (view) {
    case "Open for Sale":
      return items.filter((p) => p.status === "Open for Sale");
    case "My Drafts":
      return currentUserId
        ? items.filter((p) => p.status === "Draft" && p.ownerId === currentUserId)
        : items.filter((p) => p.status === "Draft");
    case "Featured":
      return items.filter((p) => p.featured);
    case "Needs Attention":
      return items.filter(
        (p) =>
          p.completeness < 100 ||
          (p.status === "Open for Sale" && p.liveGroupCount === 0),
      );
    default:
      return items;
  }
}

/** The list page's free-text search: title, code, branch. */
export function matchesSearch(item: PackageListItem, query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return [item.title, item.code, item.branch, item.packageCategory]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}
