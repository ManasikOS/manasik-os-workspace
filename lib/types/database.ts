/**
 * Hand-maintained row types for the Supabase schema.
 *
 * Keep these in sync with `supabase/migrations/*`. Regenerate with
 * `npx supabase gen types typescript --project-id <id>` once the project is
 * linked, if you'd rather not maintain them by hand.
 */

import type {
  DocumentRequirement,
  GroupReadinessRequirement,
  ItineraryItem,
  PaymentMilestone,
  TransportRequirement,
} from "@/lib/types/packages";

export type PackageStatusRow =
  | "Draft"
  | "Open for Sale"
  | "Sales Closed"
  | "Archived";

export interface PackageRow {
  id: string;
  owner_id: string;

  // Step 1: Commercial identity
  title: string;
  internal_code: string;
  description: string;
  journey_type: "Umrah" | "Hajj" | "Early Registration";
  category: "Umrah" | "Hajj";
  package_category: "Economy" | "Standard" | "Premium" | "VIP" | "Custom";
  branch: string;
  visibility: "Internal Only" | "Pilgrim Portal" | "Website & Portal";
  status: PackageStatusRow;
  /**
   * The status this package held immediately before its most recent
   * lifecycle transition — written only by the lifecycle RPCs
   * (`publish_package`, `close_package_sales`, `reopen_package`,
   * `archive_package`, `restore_package`; see
   * supabase/migrations/20261006090000_packages_lifecycle_phase1.sql).
   * `restore_package()` reads this to reopen an archived package into
   * whatever state it actually held, instead of always resetting to Draft.
   */
  previous_status?: string | null;
  featured: boolean;
  default_capacity: number | null;
  min_group_size: number | null;
  waitlist_enabled: boolean;
  seat_hold_expiry: string;
  suggested_guide_ratio: number | null;
  max_pilgrims: number | null;

  // Pricing POLICY — reusable across departures, stays on the template.
  payment_milestones: PaymentMilestone[];
  payment_terms: string;
  cancellation_policy: string;
  late_payment_policy: string;
  price_change_disclaimer: string;
  finance_role_view: "Admin" | "CEO" | "Finance" | "Marketing";

  // Journey template — length is genuinely reusable; a departure's actual
  // routing (gateway, airline, flight numbers) is decided per departure —
  // that used to also be a set of columns here; both it and the Bucket-C
  // dead columns below (flight_type, airline, departure/arrival airport
  // and time, transit_*, flight_legs/routes/options,
  // makkah/madinah_hotel_rating/distance/exact_notes) were dropped
  // entirely in supabase/migrations/20261008090000_packages_drop_deprecated_columns.sql
  // once confirmed nothing read them — see
  // docs/modules/packages-production-readiness-plan.md, finding B8.
  days: number;
  nights: number;
  duration: string;
  itinerary: ItineraryItem[];

  // Step 4: Service standards
  included_services: string[];
  makkah_accommodation_standard: string;
  makkah_customer_wording: string;
  makkah_nights: number;
  makkah_occupancies: string[];
  makkah_target_distance: string;
  makkah_meal_plan: string;
  makkah_exact_hotel_guarantee: boolean;
  makkah_hotel: string;
  makkah_exact_display_name: string;
  madinah_accommodation_standard: string;
  madinah_customer_wording: string;
  madinah_nights: number;
  madinah_occupancies: string[];
  madinah_target_distance: string;
  madinah_meal_plan: string;
  madinah_exact_hotel_guarantee: boolean;
  madinah_hotel: string;
  madinah_exact_display_name: string;
  transport_type: string;
  transport_requirements: TransportRequirement[];
  inclusions: string[];
  exclusions: string[];

  // Step 5: Traveller requirements
  document_requirements: DocumentRequirement[];
  seat_reservation_rule: string;
  selected_communication_templates: string[];

  // Step 6: Group creation defaults
  default_group_capacity: number | null;
  default_group_status: string;
  group_readiness_checklist: GroupReadinessRequirement[];

  // Bookkeeping
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Generated column (`jsonb_array_length(itinerary)`) — added by
   * `supabase/migrations/<ts>_packages_module_v2.sql`. Lets the list query
   * report itinerary length without selecting the `itinerary` JSONB itself.
   * Optional until that migration has run against a given environment.
   */
  itinerary_days?: number;
  payment_milestones_count?: number;
  transport_requirements_count?: number;
  inclusions_count?: number;
  exclusions_count?: number;
  included_services_count?: number;
  document_requirements_count?: number;
  group_readiness_checklist_count?: number;
  archived_at?: string | null;
  duplicated_from?: string | null;
  /** The most recent package_versions row for this package — null if never published. See supabase/migrations/20261007090000_packages_versioning_and_snapshot.sql. */
  published_version_id?: string | null;
}

/** Columns the wizard writes. The database fills in the rest. */
export type PackageWritable = Omit<
  PackageRow,
  | "id"
  | "owner_id"
  | "created_at"
  | "updated_at"
  | "published_at"
  | "itinerary_days"
  | "archived_at"
  | "duplicated_from"
  // Lifecycle bookkeeping — written only by the lifecycle RPCs
  // (publish_package/close_package_sales/reopen_package/archive_package/
  // restore_package), never by the wizard's draft/publish writes.
  | "previous_status"
  // Written only by package_versions_create(), never by the wizard.
  | "published_version_id"
>;

/**
 * Trimmed projection used by the packages list page. Deliberately excludes
 * `itinerary` and `description` — the list only ever needs the day count and
 * a handful of scalars, not the full JSONB body of every package.
 */
export type PackageListRow = Pick<
  PackageRow,
  | "id"
  | "title"
  | "internal_code"
  | "description"
  | "journey_type"
  | "category"
  | "package_category"
  | "branch"
  | "status"
  | "visibility"
  | "featured"
  | "duration"
  | "days"
  | "nights"
  | "max_pilgrims"
  | "default_capacity"
  | "cancellation_policy"
  | "itinerary_days"
  | "payment_milestones_count"
  | "transport_requirements_count"
  | "inclusions_count"
  | "exclusions_count"
  | "included_services_count"
  | "document_requirements_count"
  | "group_readiness_checklist_count"
  | "archived_at"
  | "created_at"
  | "updated_at"
  | "owner_id"
>;
