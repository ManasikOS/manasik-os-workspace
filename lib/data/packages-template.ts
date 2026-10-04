/**
 * Package → `PackageTemplateDefinition` mapper.
 *
 * This is the piece that was missing: `departure-groups-copy.ts` defines a
 * rich `PackageTemplateDefinition` shape and a `TEMPLATE_LIBRARY` of seeded
 * fixtures that satisfy it, but nothing ever built one of these from a real
 * `packages` row. `resolveTemplate()` in `lib/data/departure-groups.ts`
 * therefore silently fell back to the seeded library for every real package,
 * so every Departure Group was copying demo data regardless of which
 * package the user picked.
 *
 * `loadTemplateDefinition()` is the fix: it reads one `packages` row and maps
 * every field the copy engine needs, using the exact same wizard-shape →
 * snapshot-shape converters the packages module itself uses
 * (`toReadinessRequirementSnapshot`, `toPaymentMilestoneSnapshot`,
 * `toResponsibleRole`), so a package built in the wizard and a package read
 * here can never disagree about what a field means.
 */

import { cookies } from "next/headers";

import { createClient } from "@/utils/supabase/server";

import {
  toPaymentMilestoneSnapshot,
  toReadinessRequirementSnapshot,
  type PackageTemplateDefinition,
} from "@/lib/data/departure-groups-copy";
import type {
  AccommodationCity,
  AccommodationStandardSnapshot,
  GroupJourneyType,
  ItinerarySnapshotItem,
  TransportRequirementSnapshot,
  TravellerRequirementSnapshot,
} from "@/lib/types/departure-groups";
import type { PackageRow } from "@/lib/types/database";
import type {
  DocumentRequirement,
  ItineraryItem,
  PaymentMilestone,
  TransportRequirement,
} from "@/lib/types/packages";

import type { Db } from "@/lib/data/departure-groups-repository";

const JOURNEY_TYPE_BY_LABEL: Record<string, GroupJourneyType> = {
  Umrah: "UMRAH",
  Hajj: "HAJJ",
  "Early Registration": "EARLY_REGISTRATION",
};

/** `"24 hours"` → `24`. Falls back to a day-long hold on anything unparseable. */
export function parseSeatHoldHours(value: string): number {
  const match = value.match(/(\d+)/);
  return match ? Number(match[1]) : 24;
}

function toItinerarySnapshotItem(item: ItineraryItem): ItinerarySnapshotItem {
  return {
    id: item.id,
    day_number: item.dayNumber,
    title: item.title,
    location: item.location ?? "",
    description: item.description,
    category: item.category ?? "Other",
  };
}

function toTransportRequirementSnapshot(
  requirement: TransportRequirement,
): TransportRequirementSnapshot {
  return {
    id: requirement.id,
    route_label: requirement.routeLabel,
    origin: requirement.startLocation,
    destination: requirement.destination,
    required: requirement.required,
    vehicle_standard: requirement.vehicleStandard,
    vehicle_notes: requirement.vehicleNotes,
  };
}

function toTravellerRequirementSnapshot(
  requirement: DocumentRequirement,
): TravellerRequirementSnapshot {
  return {
    id: requirement.id,
    name: requirement.name,
    category: requirement.category,
    required: requirement.required,
    required_by_stage: requirement.requiredByStage,
    verified_by_role: requirement.verifiedByRole,
  };
}

/**
 * The wizard stores each city's accommodation standard as a flat set of
 * `makkah_*` / `madinah_*` columns rather than a nested object — this
 * reassembles both into the `AccommodationStandardSnapshot[]` the copy engine
 * expects. A city whose standard has zero nights is omitted: the group has
 * nothing to seed a hotel-chase row for.
 */
function buildAccommodationStandards(
  row: PackageRow,
): AccommodationStandardSnapshot[] {
  const cities: {
    city: AccommodationCity;
    standard: string;
    customerWording: string;
    nights: number;
    mealPlan: string;
    targetDistance: string;
    occupancies: string[];
  }[] = [
    {
      city: "MAKKAH",
      standard: row.makkah_accommodation_standard,
      customerWording: row.makkah_customer_wording,
      nights: row.makkah_nights,
      mealPlan: row.makkah_meal_plan,
      targetDistance: row.makkah_target_distance,
      occupancies: row.makkah_occupancies,
    },
    {
      city: "MADINAH",
      standard: row.madinah_accommodation_standard,
      customerWording: row.madinah_customer_wording,
      nights: row.madinah_nights,
      mealPlan: row.madinah_meal_plan,
      targetDistance: row.madinah_target_distance,
      occupancies: row.madinah_occupancies,
    },
  ];

  return cities
    .filter((c) => c.nights > 0)
    .map((c) => ({
      city: c.city,
      standard: c.standard,
      customer_wording: c.customerWording,
      nights: c.nights,
      meal_plan: c.mealPlan,
      target_distance: c.targetDistance,
      occupancies: c.occupancies,
    }));
}

/**
 * Maps one `packages` row to the shape `buildPackageSnapshot()` /
 * `buildReadinessItems()` / `buildAccommodations()` / `buildTransports()`
 * consume. Returns `null` when the id doesn't resolve to a row — the caller
 * decides whether that is a hard error (creating a group) or a soft miss
 * (a picker option that has since been deleted).
 */
export async function loadTemplateDefinition(
  packageId: string,
  client?: Db,
): Promise<PackageTemplateDefinition | null> {
  const supabase = client ?? createClient(await cookies());

  const { data, error } = await supabase
    .from("packages")
    .select("*")
    .eq("id", packageId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as PackageRow;

  const paymentMilestones = (row.payment_milestones ?? []) as PaymentMilestone[];

  return {
    id: row.id,
    name: row.title || "Untitled package",
    code: row.internal_code,
    journeyType: JOURNEY_TYPE_BY_LABEL[row.journey_type] ?? "UMRAH",
    category: row.category,
    status: row.status,
    overview: row.description,
    paymentSchedule: paymentMilestones.map(toPaymentMilestoneSnapshot),
    itinerary: (row.itinerary ?? []).map(toItinerarySnapshotItem),
    inclusions: row.inclusions ?? [],
    exclusions: row.exclusions ?? [],
    accommodationStandards: buildAccommodationStandards(row),
    transportRequirements: (row.transport_requirements ?? []).map(
      toTransportRequirementSnapshot,
    ),
    travellerRequirements: (row.document_requirements ?? []).map(
      toTravellerRequirementSnapshot,
    ),
    readinessRequirements: (row.group_readiness_checklist ?? []).map(
      toReadinessRequirementSnapshot,
    ),
    // Step 6 ("Group creation defaults") — previously authored and never
    // read. `default_group_capacity` is the field the wizard actually
    // exposes for this; `max_pilgrims` and a 40-seat floor are fallbacks for
    // packages saved before that field existed.
    defaultCapacity: row.default_group_capacity ?? row.max_pilgrims ?? 40,
    minGroupSize: row.min_group_size ?? 15,
    durationDays: row.days,
    durationNights: row.nights,
    waitlistEnabled: row.waitlist_enabled,
    seatHoldExpiryHours: parseSeatHoldHours(row.seat_hold_expiry),
    cancellationPolicy: row.cancellation_policy,
    paymentTerms: row.payment_terms,
    latePaymentPolicy: row.late_payment_policy,
    priceChangeDisclaimer: row.price_change_disclaimer,
    includedServices: row.included_services ?? [],
    seatReservationRule: row.seat_reservation_rule,
    communicationTemplates: row.selected_communication_templates ?? [],
    publishedVersionId: row.published_version_id ?? null,
  };
}
