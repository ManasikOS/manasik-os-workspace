/**
 * Works out what a person changed on a package, split by tier, for the comparison dialog and for the Save action (TASK-043).
 *
 * Pure functions, no server imports: the same code runs in the browser (to show the comparison) and on the server (to decide what to send). The database
 * recomputes the difference itself and is the authority; this only has to agree with it closely enough to show the right thing.
 */

import {
  itineraryStructureChanged,
  PACKAGE_CONTENT_COLUMNS,
  packageFieldTier,
  type PackageContentColumn,
  type PackageFieldTier,
} from "@/lib/access/package-field-tiers";
import { formDataToDraftRow } from "@/app/(main)/packages/create-package/mappers";
import type { PackageFormData } from "@/app/(main)/packages/create-package/types";

export const PACKAGE_COLUMN_LABELS: Record<PackageContentColumn, string> = {
  title: "Package name",
  internal_code: "Package code",
  description: "Overview",
  journey_type: "Journey type",
  category: "Category",
  package_category: "Package class",
  branch: "Branch",
  visibility: "Visibility",
  default_capacity: "Planned capacity",
  min_group_size: "Minimum group size",
  waitlist_enabled: "Waitlist",
  seat_hold_expiry: "Seat hold expiry",
  suggested_guide_ratio: "Suggested guide ratio",
  max_pilgrims: "Maximum pilgrims",
  days: "Number of days",
  nights: "Number of nights",
  duration: "Duration label",
  payment_milestones: "Payment milestones",
  payment_terms: "Payment terms",
  cancellation_policy: "Cancellation policy",
  late_payment_policy: "Late payment policy",
  price_change_disclaimer: "Price change disclaimer",
  finance_role_view: "Finance role view",
  itinerary: "Itinerary",
  included_services: "Included services",
  makkah_accommodation_standard: "Makkah accommodation standard",
  makkah_customer_wording: "Makkah customer wording",
  makkah_nights: "Makkah nights",
  makkah_occupancies: "Makkah room types",
  makkah_target_distance: "Makkah target distance",
  makkah_meal_plan: "Makkah meal plan",
  makkah_exact_hotel_guarantee: "Makkah exact-hotel guarantee",
  makkah_hotel: "Makkah hotel",
  makkah_exact_display_name: "Makkah hotel display name",
  madinah_accommodation_standard: "Madinah accommodation standard",
  madinah_customer_wording: "Madinah customer wording",
  madinah_nights: "Madinah nights",
  madinah_occupancies: "Madinah room types",
  madinah_target_distance: "Madinah target distance",
  madinah_meal_plan: "Madinah meal plan",
  madinah_exact_hotel_guarantee: "Madinah exact-hotel guarantee",
  madinah_hotel: "Madinah hotel",
  madinah_exact_display_name: "Madinah hotel display name",
  transport_type: "Transport type",
  transport_requirements: "Transport requirements",
  inclusions: "Customer inclusions",
  exclusions: "Customer exclusions",
  document_requirements: "Document requirements",
  seat_reservation_rule: "Seat reservation rule",
  selected_communication_templates: "Communication templates",
  default_group_capacity: "Default group capacity",
  default_group_status: "Default group status",
  group_readiness_checklist: "Group readiness checklist",
};

/** Equality that ignores object key order (Postgres JSONB reorders keys) and treats `undefined` as absent. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] === undefined && right[key] === undefined) continue;
    if (!jsonEqual(left[key], right[key])) return false;
  }
  return true;
}

export interface PackageColumnChange {
  column: PackageContentColumn;
  label: string;
  /** 0 Basic, 1 Money & contract, 2 Bookings & operations. */
  tier: PackageFieldTier;
  before: unknown;
  after: unknown;
}

/** Every content column whose value differs between two form states, in the order the database lists them. */
export function computePackageChanges(base: PackageFormData, next: PackageFormData): PackageColumnChange[] {
  const before = formDataToDraftRow(base) as Record<string, unknown>;
  const after = formDataToDraftRow(next) as Record<string, unknown>;
  const changes: PackageColumnChange[] = [];

  for (const column of PACKAGE_CONTENT_COLUMNS) {
    if (jsonEqual(before[column], after[column])) continue;
    let tier = packageFieldTier(column);
    if (column === "itinerary" && itineraryStructureChanged(before[column], after[column])) tier = 2;
    changes.push({ column, label: PACKAGE_COLUMN_LABELS[column], tier, before: before[column], after: after[column] });
  }
  return changes;
}

export interface PackageChangeGroups {
  basic: PackageColumnChange[];
  moneyAndContract: PackageColumnChange[];
  bookingsAndOperations: PackageColumnChange[];
}

export function groupChangesByTier(changes: PackageColumnChange[]): PackageChangeGroups {
  return {
    basic: changes.filter((change) => change.tier === 0),
    moneyAndContract: changes.filter((change) => change.tier === 1),
    bookingsAndOperations: changes.filter((change) => change.tier === 2),
  };
}

/** The content to send for a set of changes: column -> new value. */
export function changesToContent(changes: PackageColumnChange[]): Record<string, unknown> {
  return Object.fromEntries(changes.map((change) => [change.column, change.after]));
}

export interface WordDiffPart {
  type: "same" | "added" | "removed";
  text: string;
}

/**
 * Word-level difference between two texts (longest common subsequence on words, whitespace kept). Long texts are compared line by line first so the
 * quadratic step stays small.
 */
export function diffWords(before: string, after: string): WordDiffPart[] {
  const tokenise = (text: string) => text.match(/\s+|[^\s]+/g) ?? [];
  const a = tokenise(before);
  const b = tokenise(after);
  const MAX_TOKENS = 4000;
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return [
      ...(before ? [{ type: "removed" as const, text: before }] : []),
      ...(after ? [{ type: "added" as const, text: after }] : []),
    ];
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }

  const parts: WordDiffPart[] = [];
  const push = (type: WordDiffPart["type"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      push("removed", a[i++]);
    } else {
      push("added", b[j++]);
    }
  }
  while (i < a.length) push("removed", a[i++]);
  while (j < b.length) push("added", b[j++]);
  return parts;
}

export interface ListRowDiff<T> {
  type: "added" | "removed" | "changed" | "same";
  before?: T;
  after?: T;
}

/** Row-by-row difference between two lists of objects that carry an `id` (payment milestones, requirements, itinerary days...). */
export function diffRowsById<T extends { id?: string }>(before: T[], after: T[]): ListRowDiff<T>[] {
  const beforeById = new Map(before.map((row) => [row.id ?? JSON.stringify(row), row]));
  const afterById = new Map(after.map((row) => [row.id ?? JSON.stringify(row), row]));
  const result: ListRowDiff<T>[] = [];

  for (const [id, row] of beforeById) {
    const match = afterById.get(id);
    if (!match) result.push({ type: "removed", before: row });
    else result.push({ type: jsonEqual(row, match) ? "same" : "changed", before: row, after: match });
  }
  for (const [id, row] of afterById) {
    if (!beforeById.has(id)) result.push({ type: "added", after: row });
  }
  return result;
}

/** Difference between two lists of plain strings. */
export function diffStringLists(before: string[], after: string[]): ListRowDiff<string>[] {
  const result: ListRowDiff<string>[] = [];
  for (const item of before) result.push({ type: after.includes(item) ? "same" : "removed", before: item, after: after.includes(item) ? item : undefined });
  for (const item of after) if (!before.includes(item)) result.push({ type: "added", after: item });
  return result;
}
