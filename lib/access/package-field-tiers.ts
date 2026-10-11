/**
 * Which package fields are display-only and which change what bookings, payments, finance and departure groups do (TASK-043).
 *
 * A departure group copies its package when it is created, so an edit never rewrites groups that already exist. It does change every group created
 * afterwards, what leads can quote, what agents see, and what "compare with template" shows. That is why a package's name is harmless and its payment
 * plan is not.
 *
 *   0  Basic — display text only. Saved directly, no comparison.
 *   1  Money & contract — becomes the payment schedule and contractual terms every new group, booking and finance record inherits.
 *   2  Bookings & operations — drives seat counts, waitlists, what is promised to pilgrims, what staff must prepare, what is visible in portals, and the
 *      code that imports and reports match on.
 *
 * A column that is not listed is Tier 2 (fail safe). `itinerary` is Basic for wording changes and Tier 2 when the day structure changes
 * (see `itineraryStructureChanged`).
 *
 * The database holds the same table (`public.package_field_tier`, `public.package_content_columns` in
 * supabase/migrations/20270120090060_packages_content_columns_and_tiers.sql); lib/security/packages-change-requests-migration.test.ts fails if they differ.
 */

export type PackageFieldTier = 0 | 1 | 2;

/** Every column a publish or a sensitive-change request may write, in the order the database lists them. */
export const PACKAGE_CONTENT_COLUMNS = [
  "title", "internal_code", "description", "journey_type", "category", "package_category", "branch", "visibility",
  "default_capacity", "min_group_size", "waitlist_enabled", "seat_hold_expiry", "suggested_guide_ratio", "max_pilgrims",
  "days", "nights", "duration",
  "payment_milestones", "payment_terms", "cancellation_policy", "late_payment_policy", "price_change_disclaimer", "finance_role_view",
  "itinerary",
  "included_services",
  "makkah_accommodation_standard", "makkah_customer_wording", "makkah_nights", "makkah_occupancies", "makkah_target_distance",
  "makkah_meal_plan", "makkah_exact_hotel_guarantee", "makkah_hotel", "makkah_exact_display_name",
  "madinah_accommodation_standard", "madinah_customer_wording", "madinah_nights", "madinah_occupancies", "madinah_target_distance",
  "madinah_meal_plan", "madinah_exact_hotel_guarantee", "madinah_hotel", "madinah_exact_display_name",
  "transport_type", "transport_requirements", "inclusions", "exclusions",
  "document_requirements", "seat_reservation_rule", "selected_communication_templates",
  "default_group_capacity", "default_group_status", "group_readiness_checklist",
] as const;

export type PackageContentColumn = (typeof PACKAGE_CONTENT_COLUMNS)[number];

const BASIC_COLUMNS: ReadonlySet<string> = new Set([
  "title", "description", "branch", "package_category", "duration", "itinerary",
  "makkah_customer_wording", "madinah_customer_wording",
  "makkah_hotel", "madinah_hotel", "makkah_exact_display_name", "madinah_exact_display_name",
]);

const MONEY_AND_CONTRACT_COLUMNS: ReadonlySet<string> = new Set([
  "payment_milestones", "payment_terms", "cancellation_policy", "late_payment_policy", "price_change_disclaimer",
]);

export function packageFieldTier(column: string): PackageFieldTier {
  if (MONEY_AND_CONTRACT_COLUMNS.has(column)) return 1;
  if (BASIC_COLUMNS.has(column)) return 0;
  return 2;
}

export const PACKAGE_TIER_LABELS: Record<1 | 2, string> = {
  1: "Money & contract",
  2: "Bookings & operations",
};

interface ItineraryEntry {
  id?: unknown;
  dayNumber?: unknown;
  category?: unknown;
}

/** True when the days, their numbering or their categories differ — the part of the itinerary that is more than wording. */
export function itineraryStructureChanged(before: unknown, after: unknown): boolean {
  const shape = (value: unknown) =>
    JSON.stringify(
      (Array.isArray(value) ? (value as ItineraryEntry[]) : []).map((entry) => [entry?.id ?? null, entry?.dayNumber ?? null, entry?.category ?? null]),
    );
  return shape(before) !== shape(after);
}
