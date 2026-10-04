import type { PackageRow, PackageWritable } from "@/lib/types/database";

import { INITIAL_PACKAGE_FORM_DATA, type PackageFormData } from "./types";

/**
 * Translation layer between the wizard's `PackageFormData` and the `packages`
 * row shape.
 *
 * Two conversions carry all the risk:
 *  - Empty numeric inputs are `""` in the form but must be SQL NULL.
 *  - The two date fields are local `Date` objects in the form and `date`
 *    (YYYY-MM-DD) in Postgres. `toISOString()` is deliberately avoided: it
 *    converts to UTC, so a local midnight in UTC+5:30 (Sri Lanka) would slide
 *    back to the previous calendar day. `format`/`parseISO` stay local.
 */

/** `"" | number` (form) → `number | null` (column). */
const toNullableNumber = (value: number | "" | null | undefined) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** `number | null` (column) → `"" | number` (form). */
const toFormNumber = (value: number | null | undefined): number | "" =>
  value === null || value === undefined ? "" : Number(value);

/** Required integer column that the form always holds as a plain number. */
const toIntColumn = (value: number | "" | null | undefined, fallback = 0) => {
  const parsed = toNullableNumber(value);
  return parsed === null ? fallback : Math.trunc(parsed);
};

/** Defends against a JSONB column holding `null` or a non-array value. */
const toArray = <T>(value: unknown, fallback: T[] = []): T[] =>
  Array.isArray(value) ? (value as T[]) : fallback;

/**
 * Form → row. Used for both draft autosave and publish; `status` is decided by
 * the caller, never trusted from the form for publishing.
 */
export function formDataToRow(form: PackageFormData): PackageWritable {
  return {
    // Step 1
    title: form.title,
    internal_code: form.internalCode,
    description: form.description,
    journey_type: form.journeyType,
    category: form.category,
    package_category: form.package_category,
    branch: form.branch,
    visibility: form.visibility,
    status: form.status,
    featured: form.featured,
    default_capacity: toNullableNumber(form.defaultCapacity),
    min_group_size: toNullableNumber(form.minGroupSize),
    waitlist_enabled: form.waitlistEnabled,
    seat_hold_expiry: form.seatHoldExpiry,
    suggested_guide_ratio: toNullableNumber(form.suggestedGuideRatio),
    max_pilgrims: toNullableNumber(form.maxPilgrims),
    days: toIntColumn(form.days, 1),
    nights: toIntColumn(form.nights, 0),
    duration: form.duration,

    // Step 2 — pricing POLICY only; the prices themselves are per-departure now.
    payment_milestones: form.paymentMilestones,
    payment_terms: form.paymentTerms,
    cancellation_policy: form.cancellationPolicy,
    late_payment_policy: form.latePaymentPolicy,
    price_change_disclaimer: form.priceChangeDisclaimer,
    finance_role_view: form.financeRoleView,

    // Step 3 — itinerary only; routing moved to Departure Group creation.
    itinerary: form.itinerary,

    // Step 4
    included_services: form.includedServices,
    makkah_accommodation_standard: form.makkahAccommodationStandard,
    makkah_customer_wording: form.makkahCustomerWording,
    makkah_nights: toIntColumn(form.makkahNights),
    makkah_occupancies: form.makkahOccupancies,
    makkah_target_distance: form.makkahTargetDistance,
    makkah_meal_plan: form.makkahMealPlan,
    makkah_exact_hotel_guarantee: form.makkahExactHotelGuarantee,
    makkah_hotel: form.makkahHotel,
    makkah_exact_display_name: form.makkahExactDisplayName,
    madinah_accommodation_standard: form.madinahAccommodationStandard,
    madinah_customer_wording: form.madinahCustomerWording,
    madinah_nights: toIntColumn(form.madinahNights),
    madinah_occupancies: form.madinahOccupancies,
    madinah_target_distance: form.madinahTargetDistance,
    madinah_meal_plan: form.madinahMealPlan,
    madinah_exact_hotel_guarantee: form.madinahExactHotelGuarantee,
    madinah_hotel: form.madinahHotel,
    madinah_exact_display_name: form.madinahExactDisplayName,
    transport_type: form.transportType,
    transport_requirements: form.transportRequirements,
    inclusions: form.inclusions,
    exclusions: form.exclusions,

    // Step 5
    document_requirements: form.documentRequirements,
    seat_reservation_rule: form.seatReservationRule,
    selected_communication_templates: form.selectedCommunicationTemplates,

    // Step 6
    default_group_capacity: toNullableNumber(form.defaultGroupCapacity),
    default_group_status: form.defaultGroupStatus,
    group_readiness_checklist: form.groupReadinessChecklist,
  };
}

/**
 * Columns the DRAFT autosave path (`saveDraftAction` / `savePackagePatchAction`)
 * may write. `status` and `featured` are excluded — they are lifecycle
 * columns that must only change through the dedicated, capability-checked
 * lifecycle actions (`publishPackageAction`, `setPackageFeaturedAction`,
 * `archivePackageAction`, ...), never through autosave. Before this existed,
 * `formDataToRow()`'s output (which does include both) was written directly
 * by autosave, so anyone who could edit a package could publish, close sales
 * on, or archive it just by changing the wizard's Status field — no publish
 * validation and no `publishPackage`/`toggleFeatured` capability check ever
 * ran. See docs/modules/packages-production-readiness-plan.md, finding A1.
 */
export function formDataToDraftRow(
  form: PackageFormData,
): Omit<PackageWritable, "status" | "featured"> {
  const { status, featured, ...draftRow } = formDataToRow(form);
  void status;
  void featured;
  return draftRow;
}

/**
 * Row → form. Fields the schema intentionally does not persist (dead legacy
 * fields and the transient custom-inclusion text buffers) are refilled from
 * the wizard's defaults so the returned object is always a complete
 * `PackageFormData`.
 */
export function rowToFormData(row: PackageRow): PackageFormData {
  const defaults = INITIAL_PACKAGE_FORM_DATA;

  return {
    // Step 1
    title: row.title,
    internalCode: row.internal_code,
    description: row.description,
    journeyType: row.journey_type,
    category: row.category,
    year: defaults.year,
    package_category: row.package_category,
    branch: row.branch,
    visibility: row.visibility,
    status: row.status,
    featured: row.featured,
    defaultCapacity: toFormNumber(row.default_capacity),
    minGroupSize: toFormNumber(row.min_group_size),
    waitlistEnabled: row.waitlist_enabled,
    seatHoldExpiry: row.seat_hold_expiry as PackageFormData["seatHoldExpiry"],
    suggestedGuideRatio: toFormNumber(row.suggested_guide_ratio),
    maxPilgrims: toFormNumber(row.max_pilgrims),
    days: row.days,
    nights: row.nights,
    duration: row.duration,

    // Step 2 — pricing POLICY only.
    paymentMilestones: toArray(row.payment_milestones),
    paymentTerms: row.payment_terms,
    cancellationPolicy: row.cancellation_policy,
    latePaymentPolicy: row.late_payment_policy,
    priceChangeDisclaimer: row.price_change_disclaimer,
    financeRoleView: row.finance_role_view,

    // Step 3 — itinerary only.
    itinerary: toArray(row.itinerary),

    // Step 4
    includedServices: toArray<string>(row.included_services),
    makkahAccommodationStandard: row.makkah_accommodation_standard,
    makkahCustomerWording: row.makkah_customer_wording,
    makkahNights: row.makkah_nights,
    makkahOccupancies: toArray<string>(row.makkah_occupancies),
    makkahTargetDistance: row.makkah_target_distance,
    makkahMealPlan: row.makkah_meal_plan,
    makkahExactHotelGuarantee: row.makkah_exact_hotel_guarantee,
    makkahHotel: row.makkah_hotel,
    makkahExactDisplayName: row.makkah_exact_display_name,
    madinahAccommodationStandard: row.madinah_accommodation_standard,
    madinahCustomerWording: row.madinah_customer_wording,
    madinahNights: row.madinah_nights,
    madinahOccupancies: toArray<string>(row.madinah_occupancies),
    madinahTargetDistance: row.madinah_target_distance,
    madinahMealPlan: row.madinah_meal_plan,
    madinahExactHotelGuarantee: row.madinah_exact_hotel_guarantee,
    madinahHotel: row.madinah_hotel,
    madinahExactDisplayName: row.madinah_exact_display_name,
    transportType: row.transport_type,
    transportRequirements: toArray(row.transport_requirements),
    inclusions: toArray<string>(row.inclusions),
    exclusions: toArray<string>(row.exclusions),
    customInclusionInput: "",
    customExclusionInput: "",

    // Step 5
    documentRequirements: toArray(row.document_requirements),
    seatReservationRule: row.seat_reservation_rule,
    selectedCommunicationTemplates: toArray<string>(
      row.selected_communication_templates,
    ),

    // Step 6
    defaultGroupCapacity: toFormNumber(row.default_group_capacity),
    defaultGroupStatus: row.default_group_status,
    groupReadinessChecklist: toArray(row.group_readiness_checklist),

    // Not persisted — no UI edits these.
    startDate: defaults.startDate,
    endDate: defaults.endDate,
    guide: defaults.guide,
  };
}
