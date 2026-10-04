/**
 * Package Template → Departure Group copy engine.
 *
 * The product rule this file enforces: a Package Template is a reusable
 * promise, a Departure Group is a live journey, and editing the former must
 * never rewrite the latter. So creation does two distinct things:
 *
 *   1. `buildPackageSnapshot()` freezes the template verbatim. Nothing ever
 *      writes to a snapshot again.
 *   2. `buildReadinessItems()` / `buildAccommodations()` / `buildTransports()`
 *      COPY the template's operational defaults into independent, editable
 *      group-level rows. From that moment they belong to the group.
 *
 * Used by both the seed and the create Server Action, so the two can never
 * drift apart.
 */

import {
  DEFAULT_DOCUMENT_REQUIREMENTS,
  DEFAULT_PAYMENT_MILESTONES,
  DEFAULT_READINESS_CHECKLIST,
  DEFAULT_TRANSPORT_REQUIREMENTS,
  INITIAL_PACKAGE_FORM_DATA,
  type GroupReadinessRequirement,
  type PaymentMilestone,
} from "@/app/(main)/packages/create-package/types";
import type {
  AccommodationCity,
  AccommodationStandardSnapshot,
  DepartureGroupAccommodationRow,
  DepartureGroupPackageSnapshotRow,
  DepartureGroupPricingRow,
  DepartureGroupCostEstimateRow,
  DepartureGroupFlightRow,
  DepartureGroupPilgrimDocumentRow,
  DepartureGroupReadinessItemRow,
  DepartureGroupTransportRow,
  DocumentStage,
  DocumentType,
  GroupJourneyType,
  ItinerarySnapshotItem,
  PaymentMilestoneSnapshot,
  PricingSnapshot,
  ReadinessAutoSource,
  ReadinessCategory,
  ReadinessDueType,
  ReadinessRequirementSnapshot,
  ResponsibleRole,
  TransportRequirementSnapshot,
  TravellerRequirementSnapshot,
  VehicleType,
} from "@/lib/types/departure-groups";
import type {
  PackageTemplateOption,
  TemplateCopyOptions,
} from "@/app/(main)/departure-groups/types";

/**
 * A template id is a `packages` primary key only when it is a uuid; the
 * built-in library uses readable keys like `pkg-umrah-standard-2026`, which the
 * foreign key cannot hold.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID.test(value);
}

/* ── Template definition ──────────────────────────────────────────────────── */

/**
 * The subset of a Package Template that a Departure Group actually copies.
 * Produced either from a `packages` row or from the seeded template library.
 */
export interface PackageTemplateDefinition {
  id: string;
  name: string;
  code: string;
  journeyType: GroupJourneyType;
  category: string;
  status: "Draft" | "Open for Sale" | "Sales Closed" | "Archived";
  overview: string;
  /**
   * The reusable payment SCHEDULE structure (milestone rules — percentages,
   * fixed amounts, days-before-departure timing). The actual prices those
   * rules apply to are NOT part of the template — see
   * `CreateDepartureGroupInput.pricing` / `buildGroupPricing()`. A template
   * genuinely is reusable across departures that sell at different prices,
   * so pricing, the internal cost estimate, and flight routing intent all
   * moved to explicit inputs collected when creating the group instead of
   * being read off the template (docs/architecture/package-departure-architecture-master-plan.md).
   */
  paymentSchedule: PaymentMilestoneSnapshot[];
  itinerary: ItinerarySnapshotItem[];
  inclusions: string[];
  exclusions: string[];
  accommodationStandards: AccommodationStandardSnapshot[];
  transportRequirements: TransportRequirementSnapshot[];
  travellerRequirements: TravellerRequirementSnapshot[];
  readinessRequirements: ReadinessRequirementSnapshot[];
  defaultCapacity: number;
  minGroupSize: number;
  durationDays: number;
  durationNights: number;
  waitlistEnabled: boolean;
  seatHoldExpiryHours: number;
  /**
   * The contractual terms a pilgrim actually books under — reusable POLICY
   * text, same posture as `paymentSchedule`. Previously collected by the
   * wizard (Step 2) but never copied into the group snapshot at all, so a
   * later template edit silently changed what an already-selling group's
   * cancellation/payment terms appeared to be. See finding C5 in
   * docs/modules/packages-production-readiness-plan.md.
   */
  cancellationPolicy: string;
  paymentTerms: string;
  latePaymentPolicy: string;
  priceChangeDisclaimer: string;
  /** Step 4's customer-facing "what's included" list, e.g. "Return air ticket". */
  includedServices: string[];
  /** Step 5's seat-reservation policy text and the communication templates selected for this program. */
  seatReservationRule: string;
  communicationTemplates: string[];
  /**
   * The `packages` row's current `published_version_id`, when the template
   * has been published at least once — threaded onto the group snapshot so
   * "compare with template" can compare against a specific, frozen version
   * instead of the live (possibly since-edited) row. `null` for a template
   * that has never been published (e.g. an ADMIN creating from a Draft) or
   * the seeded demo library, which has no publish history at all.
   */
  publishedVersionId: string | null;
}

export const DEFAULT_COPY_OPTIONS: TemplateCopyOptions = {
  itinerary: true,
  inclusionsAndExclusions: true,
  travellerRequirements: true,
  readinessChecklist: true,
  accommodation: true,
  transport: true,
  flights: true,
};

/* ── Mapping helpers from the wizard's own shapes ─────────────────────────── */

const CATEGORY_KEYWORDS: [RegExp, ReadinessCategory][] = [
  [/manifest/i, "MANIFEST"],
  [/rooming/i, "ROOMING"],
  [/visa|e-visa/i, "VISA"],
  [/passport|document/i, "DOCUMENT"],
  [/hotel|accommodation/i, "HOTEL"],
  [/transport|transfer|bus/i, "TRANSPORT"],
  [/catering|buffet|meal/i, "CATERING"],
  [/guide|mutawwif/i, "GUIDE"],
  [/payment|deposit|balance/i, "PAYMENT"],
  [/flight|ticket|pnr|seat/i, "FLIGHT"],
];

/**
 * Checklist labels that name a fact the system already holds.
 *
 * Order matters: `/ticket|pnr/` must be tried before the looser flight pattern,
 * and the two hotel cities before anything generic. A label that matches
 * nothing stays manual, which is the safe direction — an item wrongly treated
 * as derived would be un-tickable, whereas one wrongly left manual merely keeps
 * the behaviour the module already had.
 */
const AUTO_SOURCE_KEYWORDS: [RegExp, ReadinessAutoSource][] = [
  [/ticket\s*pnr|pnr\s*active|seats?\s*held.*ticket/i, "FLIGHT_TICKETED"],
  [/flight\s*route\s*confirmed|departure\s*date\s*&?\s*flight/i, "FLIGHT_OUTBOUND_CONFIRMED"],
  [/makkah\s*hotel/i, "HOTEL_MAKKAH_CONFIRMED"],
  [/madinah\s*hotel/i, "HOTEL_MADINAH_CONFIRMED"],
  [/airport\s*arrival\s*transport/i, "TRANSPORT_ARRIVAL_CONFIRMED"],
  [/intercity\s*transport/i, "TRANSPORT_INTERCITY_CONFIRMED"],
  [/airport\s*departure\s*transport/i, "TRANSPORT_DEPARTURE_CONFIRMED"],
  [/payment\s*threshold|payment.*100%/i, "PAYMENTS_COLLECTED_IN_FULL"],
  [/passport\s*&?\s*docs?\s*verified|all\s*pilgrim\s*document/i, "DOCUMENTS_ALL_VERIFIED"],
  [/visa[s]?\s*(issued|approved|received)/i, "VISAS_ALL_APPROVED"],
  [/rooming/i, "ROOMING_COMPLETE"],
  [/guide\s*assigned|mutawwif/i, "GUIDE_ASSIGNED"],
  [/manifest/i, "MANIFEST_READY"],
];

/**
 * The derivation rule for a checklist label, or null when the item is a
 * genuinely manual judgement (a buffet confirmed by phone, a briefing held).
 */
export function autoSourceFor(label: string): ReadinessAutoSource | null {
  for (const [pattern, source] of AUTO_SOURCE_KEYWORDS) {
    if (pattern.test(label)) return source;
  }
  return null;
}

function readinessCategoryFor(label: string): ReadinessCategory {
  for (const [pattern, category] of CATEGORY_KEYWORDS) {
    if (pattern.test(label)) return category;
  }
  return "OTHER";
}

/** `"21 days before departure"` → `{ dueType, days }`. */
function parseDueTiming(dueTiming: string): {
  dueType: ReadinessDueType;
  days: number | null;
} {
  const relative = dueTiming.match(/^(\d+)\s*days?\s+before\s+departure$/i);
  if (relative) {
    return {
      dueType: "DAYS_BEFORE_DEPARTURE",
      days: Number(relative[1]),
    };
  }
  if (/before\s+group\s+opens/i.test(dueTiming)) {
    return { dueType: "BEFORE_GROUP_OPENS", days: null };
  }
  if (/before\s+booking/i.test(dueTiming)) {
    return { dueType: "BEFORE_FIRST_BOOKING", days: null };
  }
  if (/before\s+visa/i.test(dueTiming)) {
    return { dueType: "BEFORE_VISA_SUBMISSION", days: null };
  }
  if (/final\s+payment/i.test(dueTiming)) {
    return { dueType: "BEFORE_FINAL_PAYMENT", days: null };
  }
  return { dueType: "BEFORE_DEPARTURE", days: null };
}

export function toResponsibleRole(role: string): ResponsibleRole {
  const upper = role.toUpperCase();
  const known: ResponsibleRole[] = [
    "ADMIN",
    "OPERATIONS",
    "VISA",
    "FINANCE",
    "GUIDE",
    "MARKETING",
  ];
  return known.includes(upper as ResponsibleRole)
    ? (upper as ResponsibleRole)
    : "OPERATIONS";
}

export function toReadinessRequirementSnapshot(
  requirement: GroupReadinessRequirement,
): ReadinessRequirementSnapshot {
  const { dueType, days } = parseDueTiming(requirement.dueTiming);
  return {
    id: requirement.id,
    label: requirement.label,
    required: requirement.required,
    responsible_role: toResponsibleRole(requirement.responsibleRole),
    category: readinessCategoryFor(requirement.label),
    due_type: dueType,
    due_days_before_departure: days,
  };
}

export function toPaymentMilestoneSnapshot(
  milestone: PaymentMilestone,
): PaymentMilestoneSnapshot {
  return {
    id: milestone.id,
    label: milestone.label,
    amount_type: milestone.amountType,
    amount: milestone.amount === "" ? null : Number(milestone.amount),
    due_rule: milestone.dueRule,
    due_date: milestone.dueDate ?? null,
    days_before_departure:
      milestone.daysBeforeDeparture === "" ||
      milestone.daysBeforeDeparture === undefined
        ? null
        : Number(milestone.daysBeforeDeparture),
    refundable: milestone.refundable,
  };
}

const VEHICLE_TYPE_BY_STANDARD: Record<string, VehicleType> = {
  Bus: "COACH",
  "Private Car": "PRIVATE_CAR",
  Train: "TRAIN",
  Other: "OTHER",
};

/* ── Date helpers ─────────────────────────────────────────────────────────── */

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00.000Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000);
}

/** Resolves a template due rule against this group's real departure date. */
export function resolveDueAt(
  dueType: ReadinessDueType,
  daysBefore: number | null,
  departureDate: string,
): string | null {
  switch (dueType) {
    case "DAYS_BEFORE_DEPARTURE":
      return daysBefore === null
        ? null
        : `${addDays(departureDate, -daysBefore)}T17:00:00.000Z`;
    case "BEFORE_DEPARTURE":
      return `${addDays(departureDate, -1)}T17:00:00.000Z`;
    case "BEFORE_VISA_SUBMISSION":
      return `${addDays(departureDate, -30)}T17:00:00.000Z`;
    case "BEFORE_FINAL_PAYMENT":
      return `${addDays(departureDate, -21)}T17:00:00.000Z`;
    // "Before the group opens / takes its first booking" are gates, not dates.
    case "BEFORE_GROUP_OPENS":
    case "BEFORE_FIRST_BOOKING":
    default:
      return null;
  }
}

export const DUE_TYPE_LABELS: Record<ReadinessDueType, string> = {
  BEFORE_GROUP_OPENS: "Before group opens",
  BEFORE_FIRST_BOOKING: "Before first booking",
  BEFORE_VISA_SUBMISSION: "Before visa submission",
  BEFORE_FINAL_PAYMENT: "Before final payment",
  DAYS_BEFORE_DEPARTURE: "Before departure",
  BEFORE_DEPARTURE: "Before departure",
};

export function dueLabelFor(
  dueType: ReadinessDueType,
  daysBefore: number | null,
): string {
  if (dueType === "DAYS_BEFORE_DEPARTURE" && daysBefore !== null) {
    return `${daysBefore} days before departure`;
  }
  return DUE_TYPE_LABELS[dueType];
}

/* ── Copy operations ──────────────────────────────────────────────────────── */

/** A pricing-less snapshot placeholder — the template has no price of its own to freeze. */
function emptyPricingSnapshot(currency: string): PricingSnapshot {
  return {
    currency,
    quad_price: null,
    triple_price: null,
    double_price: null,
    single_price: null,
    child_price: null,
    infant_price: null,
    advance_deposit: null,
  };
}

/** 1. The immutable freeze. Honours the copy toggles the creator ticked. */
export function buildPackageSnapshot(
  template: PackageTemplateDefinition,
  groupId: string,
  options: TemplateCopyOptions = DEFAULT_COPY_OPTIONS,
  copiedAt: string = new Date().toISOString(),
  /** The group's own price, for the audit record — see `buildGroupPricing()`. */
  currency = "LKR",
): DepartureGroupPackageSnapshotRow {
  return {
    departure_group_id: groupId,
    // Null unless the id is a real `packages` row — the FK cannot hold a
    // built-in template key, and `source_template_key` records it instead.
    package_template_id: isUuid(template.id) ? template.id : null,
    source_template_key: template.id,
    package_name_snapshot: template.name,
    package_code_snapshot: template.code,
    overview_snapshot: template.overview,
    // The template itself carries no price (see `PackageTemplateDefinition`)
    // — this column is kept only because `departure_group_pricing` didn't
    // exist when it was added; it is never read as authoritative anywhere
    // in the module now. See `getGroupPricingRow()` / `groupPrice()`.
    pricing_snapshot: emptyPricingSnapshot(currency),
    payment_schedule_snapshot: template.paymentSchedule.map((m) => ({ ...m })),
    itinerary_snapshot: options.itinerary
      ? template.itinerary.map((i) => ({ ...i }))
      : [],
    inclusions_snapshot: options.inclusionsAndExclusions
      ? [...template.inclusions]
      : [],
    exclusions_snapshot: options.inclusionsAndExclusions
      ? [...template.exclusions]
      : [],
    accommodation_standards_snapshot: options.accommodation
      ? template.accommodationStandards.map((a) => ({ ...a }))
      : [],
    transport_requirements_snapshot: options.transport
      ? template.transportRequirements.map((t) => ({ ...t }))
      : [],
    traveller_requirements_snapshot: options.travellerRequirements
      ? template.travellerRequirements.map((t) => ({ ...t }))
      : [],
    readiness_requirements_snapshot: options.readinessChecklist
      ? template.readinessRequirements.map((r) => ({ ...r }))
      : [],
    copied_at: copiedAt,
    // Completed the snapshot (finding C5) — the contractual terms, the
    // included-services list, the template's own declared length, and the
    // traveller-facing seat/communication policy are now frozen alongside
    // everything above, instead of silently drifting with later template
    // edits.
    package_version_id: template.publishedVersionId,
    policy_snapshot: {
      cancellationPolicy: template.cancellationPolicy,
      paymentTerms: template.paymentTerms,
      latePaymentPolicy: template.latePaymentPolicy,
      priceChangeDisclaimer: template.priceChangeDisclaimer,
    },
    included_services_snapshot: [...template.includedServices],
    duration_days_snapshot: template.durationDays,
    duration_nights_snapshot: template.durationNights,
    seat_reservation_rule_snapshot: template.seatReservationRule,
    communication_templates_snapshot: [...template.communicationTemplates],
  };
}

/** Everything the create-group form collects for a departure's own price. */
export interface GroupPricingInput {
  currency: string;
  quadPrice: number | null;
  triplePrice: number | null;
  doublePrice: number | null;
  singlePrice: number | null;
  childPrice: number | null;
  infantPrice: number | null;
  earlyBirdPrice: number | null;
  advanceDeposit: number | null;
}

/**
 * 1b. Seeds the group's own, editable price row from what the CREATOR
 * entered when they created this departure — a template carries no price of
 * its own (see `PackageTemplateDefinition`), so there is nothing to default
 * from. `paymentSchedule` is still the template's — the milestone RULES
 * (percentages, timing) are genuinely reusable even though the amounts they
 * apply to are not. `price_source` starts as `TEMPLATE` (this is still the
 * group's first price, before any manual reprice); the first edit flips it
 * to `OVERRIDDEN`.
 */
export function buildGroupPricing(
  groupId: string,
  input: GroupPricingInput,
  paymentSchedule: PaymentMilestoneSnapshot[],
  copiedAt: string = new Date().toISOString(),
): DepartureGroupPricingRow {
  return {
    departure_group_id: groupId,
    currency: input.currency,
    quad_price: input.quadPrice,
    triple_price: input.triplePrice,
    double_price: input.doublePrice,
    single_price: input.singlePrice,
    child_price: input.childPrice,
    infant_price: input.infantPrice,
    early_bird_price: input.earlyBirdPrice,
    early_bird_valid_until: null,
    advance_deposit: input.advanceDeposit,
    payment_milestones: paymentSchedule.map((m) => ({ ...m })),
    price_source: "TEMPLATE",
    priced_by: null,
    priced_at: copiedAt,
    updated_at: copiedAt,
  };
}

/** Everything the create-group form collects for a departure's own cost sheet. */
export interface GroupCostEstimateInput {
  flightCostPerPilgrim: number | null;
  accommodationCostPerPilgrim: number | null;
  transportCostPerPilgrim: number | null;
  visaInsuranceCostPerPilgrim: number | null;
  cateringCostPerPilgrim: number | null;
  guideOperationsCostPerPilgrim: number | null;
  contingencyCostPerPilgrim: number | null;
  fixedCostPerDeparture: number;
}

/**
 * 1c. Seeds the group's own, editable cost sheet from what the creator
 * entered for this departure — costing, like pricing, is a per-departure
 * question (fixed costs don't shrink with headcount), so there is no
 * template default to copy from. Source for the `departure_group_costing`
 * view.
 */
export function buildGroupCostEstimate(
  groupId: string,
  input: GroupCostEstimateInput,
  now: string = new Date().toISOString(),
): DepartureGroupCostEstimateRow {
  return {
    departure_group_id: groupId,
    flight_cost_per_pilgrim: input.flightCostPerPilgrim,
    accommodation_cost_per_pilgrim: input.accommodationCostPerPilgrim,
    transport_cost_per_pilgrim: input.transportCostPerPilgrim,
    visa_insurance_cost_per_pilgrim: input.visaInsuranceCostPerPilgrim,
    catering_cost_per_pilgrim: input.cateringCostPerPilgrim,
    guide_operations_cost_per_pilgrim: input.guideOperationsCostPerPilgrim,
    contingency_cost_per_pilgrim: input.contingencyCostPerPilgrim,
    fixed_cost_per_departure: input.fixedCostPerDeparture,
    updated_at: now,
    updated_by: null,
  };
}

/** 2a. Checklist → live, independently editable readiness rows. */
export function buildReadinessItems(
  template: PackageTemplateDefinition,
  groupId: string,
  departureDate: string,
  idFactory: (index: number) => string,
): DepartureGroupReadinessItemRow[] {
  return template.readinessRequirements.map((requirement, index) => ({
    id: idFactory(index),
    departure_group_id: groupId,
    source_template_requirement_id: requirement.id,
    label: requirement.label,
    category: requirement.category,
    responsible_role: requirement.responsible_role,
    assigned_to_user_id: null,
    assigned_to_name: null,
    due_type: requirement.due_type,
    due_days_before_departure: requirement.due_days_before_departure,
    due_at: resolveDueAt(
      requirement.due_type,
      requirement.due_days_before_departure,
      departureDate,
    ),
    required: requirement.required,
    status: "NOT_STARTED",
    auto_source: autoSourceFor(requirement.label),
    evidence_url: null,
    notes: null,
    completed_at: null,
    completed_by: null,
    completed_by_name: null,
  }));
}

/**
 * 2a-bis. Traveller requirements → one live document row per pilgrim.
 *
 * The template describes each requirement by name, category, the stage it is
 * due at and the role that verifies it. Copying only the array length — which
 * is what the module used to do — reduced all of that to "8 documents" and made
 * "4 / 8" unresolvable. Expanding it per traveller is what lets the Visa team
 * see which document is outstanding, and what lets the visa gate know whether
 * the `BEFORE_VISA_SUBMISSION` set is actually in hand.
 */
/**
 * Machine key for a document requirement, derived from its free-text name.
 *
 * The Documents module's AI pipeline needs a stable key, not a string a
 * package author could rename at any time. Kept here, next to the snapshot
 * copy, because this is the one place a document row is created — everything
 * downstream reads `document_type` rather than re-deriving it.
 */
export function deriveDocumentType(name: string): DocumentType {
  const n = name.toLowerCase();
  if (/passport.*valid|valid.*\d+\s*month/.test(n)) return "PASSPORT_ADDITIONAL";
  if (/passport/.test(n)) return "PASSPORT_BIO";
  if (/photo/.test(n)) return "PASSPORT_PHOTO";
  if (/\bnic\b|national id|identity card/.test(n)) return "NATIONAL_ID";
  if (/visa/.test(n)) return "VISA_COPY";
  if (/insurance/.test(n)) return "INSURANCE";
  if (/vaccin|meningitis/.test(n)) return "VACCINATION";
  if (/medical/.test(n)) return "MEDICAL";
  if (/emergency.*contact|next of kin/.test(n)) return "EMERGENCY_CONTACT";
  if (/deposit|payment/.test(n)) return "PAYMENT_PROOF";
  if (/ticket/.test(n)) return "FLIGHT_TICKET";
  if (/hotel.*voucher/.test(n)) return "HOTEL_VOUCHER";
  return "OTHER";
}

export function buildPilgrimDocuments(
  requirements: TravellerRequirementSnapshot[],
  groupId: string,
  pilgrimId: string,
  idFactory: (index: number) => string,
  now: string,
): DepartureGroupPilgrimDocumentRow[] {
  return requirements.map((requirement, index) => ({
    id: idFactory(index),
    departure_group_id: groupId,
    pilgrim_id: pilgrimId,
    requirement_id: requirement.id || `req-${index + 1}`,
    name: requirement.name || `Requirement ${index + 1}`,
    category: requirement.category || "Other",
    document_type: deriveDocumentType(requirement.name || ""),
    required: requirement.required,
    required_by_stage: parseDocumentStage(requirement.required_by_stage),
    verified_by_role: toResponsibleRole(requirement.verified_by_role),
    status: "NOT_SUBMITTED",
    file_path: null,
    file_name: null,
    file_size_bytes: null,
    rejection_reason: null,
    submitted_at: null,
    verified_at: null,
    verified_by: null,
    verified_by_name: null,
    notes: null,
    created_at: now,
  }));
}

/**
 * `"Before Visa Submission"` → `BEFORE_VISA_SUBMISSION`.
 *
 * The template stores the stage as prose the wizard renders. Turning it into a
 * value at copy time is what makes it a gate the code can branch on rather than
 * a label nothing reads — which is how "Passport Validity (Minimum 6 Months)"
 * ended up being required "before visa submission" while nothing checked it
 * before a visa submission.
 */
export function parseDocumentStage(stage: string): DocumentStage {
  if (/visa/i.test(stage)) return "BEFORE_VISA_SUBMISSION";
  if (/final\s*payment|balance/i.test(stage)) return "BEFORE_FINAL_PAYMENT";
  if (/depart|travel/i.test(stage)) return "BEFORE_DEPARTURE";
  return "ON_BOOKING";
}

/** 2b. Hotel *standards* → unconfirmed hotel *bookings* to be chased. */
/**
 * Orders accommodation standards by which city the group actually lands in
 * first, instead of assuming Makkah-then-Madinah unconditionally. A group
 * arriving into Madinah (`arrivalGateway` names it) stays there before the
 * transfer to Makkah; everything else — Jeddah, Taif, Riyadh, "Either" —
 * defaults to Makkah first, since Jeddah's own gateway is the Makkah side.
 * This does not know a REAL flight's arrival time (the seeded flight is a
 * placeholder — see `buildFlights()`), only the template's routing intent,
 * so it fixes the common case, not every itinerary.
 */
function orderByArrivalCity(
  standards: PackageTemplateDefinition["accommodationStandards"],
  arrivalGateway: string,
): PackageTemplateDefinition["accommodationStandards"] {
  const arrivesInMadinah = /madinah/i.test(arrivalGateway);
  const rank = (city: AccommodationCity): number => {
    if (city === "MADINAH") return arrivesInMadinah ? 0 : 1;
    if (city === "MAKKAH") return arrivesInMadinah ? 1 : 0;
    return 2;
  };
  return [...standards].sort((a, b) => rank(a.city) - rank(b.city));
}

export function buildAccommodations(
  template: PackageTemplateDefinition,
  groupId: string,
  departureDate: string,
  idFactory: (index: number) => string,
  /** From the group's own flight-routing input — the template has no gateway of its own. */
  arrivalGateway: string = "",
): DepartureGroupAccommodationRow[] {
  let cursor = departureDate;
  const ordered = orderByArrivalCity(
    template.accommodationStandards,
    arrivalGateway,
  );

  return ordered.map((standard, index) => {
    const checkIn = cursor;
    const checkOut = addDays(checkIn, standard.nights);
    cursor = checkOut;

    return {
      id: idFactory(index),
      departure_group_id: groupId,
      city: standard.city,
      // The group has not picked a hotel yet — only a standard to meet.
      hotel_name: "",
      supplier_name: null,
      supplier_id: null,
      booking_reference: null,
      status: "NOT_REQUESTED",
      check_in_date: checkIn,
      check_out_date: checkOut,
      nights: standard.nights,
      room_capacity: 0,
      rooms_reserved: 0,
      rooms_allocated: 0,
      meal_plan: standard.meal_plan,
      distance_description: standard.target_distance,
      voucher_url: null,
      internal_cost: null,
      notes: standard.customer_wording,
    };
  });
}

/** 2c. Transport requirements → live execution cards. */
export function buildTransports(
  template: PackageTemplateDefinition,
  groupId: string,
  idFactory: (index: number) => string,
): DepartureGroupTransportRow[] {
  return template.transportRequirements.map((requirement, index) => ({
    id: idFactory(index),
    departure_group_id: groupId,
    template_transport_requirement_id: requirement.id,
    route_label: requirement.route_label,
    origin: requirement.origin,
    destination: requirement.destination,
    status: "NOT_REQUESTED",
    supplier_name: null,
    supplier_id: null,
    booking_reference: null,
    vehicle_type:
      VEHICLE_TYPE_BY_STANDARD[requirement.vehicle_standard] ?? "COACH",
    vehicle_capacity: null,
    passenger_count: null,
    pickup_at: null,
    pickup_location: null,
    driver_name: null,
    driver_phone: null,
    coordinator_name: null,
    coordinator_phone: null,
    internal_cost: null,
    confirmation_url: null,
    notes: requirement.vehicle_notes,
  }));
}

/** `"Colombo (CMB)"` → `{ code: "CMB", name: "Colombo" }`. */
function parseAirport(label: string): { code: string; name: string } {
  const match = label.match(/^(.*?)\s*\(([A-Za-z]{3})\)\s*$/);
  if (match) return { code: match[2].toUpperCase(), name: match[1].trim() };
  return { code: "", name: label.trim() };
}

/**
 * 2d. Routing intent → two DRAFT flights (OUTBOUND, RETURN) to book against.
 *
 * A template only ever describes intent — origin, gateway, preferred
 * airlines — never a specific flight number, PNR or departure time, so these
 * rows start deliberately incomplete: `DRAFT` status, zero seats, no PNR.
 * They exist so the Flights tab is never empty on a group that includes
 * flights, and so there is a row to attach a ticketing deadline and a real
 * booking to once one is made. `departure_at`/`arrival_at` are placeholders
 * (midnight on the group's own dates) until a real schedule is booked.
 */
/**
 * Routing intent for a single departure, entered when the group is created —
 * a template carries no flight routing of its own (see
 * `PackageTemplateDefinition`), because the airport a departure actually
 * flies from is a fact about that departure, not the reusable program.
 */
export interface GroupFlightRoutingInput {
  flightsIncluded: boolean;
  departureOrigin: string;
  arrivalGateway: string;
  returnGateway: string;
  preferredAirline: string;
  cabinClass: string;
}

export function buildFlights(
  groupId: string,
  departureDate: string,
  returnDate: string,
  routing: GroupFlightRoutingInput,
  idFactory: (index: number) => string,
): DepartureGroupFlightRow[] {
  if (!routing.flightsIncluded) return [];

  const origin = parseAirport(routing.departureOrigin);
  const outboundDestination = parseAirport(routing.arrivalGateway);
  const returnOrigin = parseAirport(routing.returnGateway);
  const airline = routing.preferredAirline;
  const ticketingDeadline = `${addDays(departureDate, -21)}T17:00:00.000Z`;

  return [
    {
      id: idFactory(0),
      departure_group_id: groupId,
      direction: "OUTBOUND",
      status: "DRAFT",
      airline,
      flight_number: null,
      pnr: null,
      booking_reference: null,
      origin_airport_code: origin.code,
      origin_airport_name: origin.name,
      destination_airport_code: outboundDestination.code,
      destination_airport_name: outboundDestination.name,
      departure_at: `${departureDate}T00:00:00.000Z`,
      arrival_at: `${departureDate}T06:00:00.000Z`,
      cabin_class: routing.cabinClass || "Economy",
      seat_capacity: 0,
      seats_held: 0,
      seats_ticketed: 0,
      ticketing_deadline: ticketingDeadline,
      supplier_name: null,
      supplier_id: null,
      notes: null,
    },
    {
      id: idFactory(1),
      departure_group_id: groupId,
      direction: "RETURN",
      status: "DRAFT",
      airline,
      flight_number: null,
      pnr: null,
      booking_reference: null,
      origin_airport_code: returnOrigin.code,
      origin_airport_name: returnOrigin.name,
      destination_airport_code: origin.code,
      destination_airport_name: origin.name,
      departure_at: `${returnDate}T00:00:00.000Z`,
      arrival_at: `${returnDate}T06:00:00.000Z`,
      cabin_class: routing.cabinClass || "Economy",
      seat_capacity: 0,
      seats_held: 0,
      seats_ticketed: 0,
      ticketing_deadline: ticketingDeadline,
      supplier_name: null,
      supplier_id: null,
      notes: null,
    },
  ];
}

export function templateToOption(
  template: PackageTemplateDefinition,
): PackageTemplateOption {
  return {
    id: template.id,
    name: template.name,
    code: template.code,
    journeyType: template.journeyType,
    category: template.category,
    status: template.status,
    defaultCapacity: template.defaultCapacity,
    minGroupSize: template.minGroupSize,
    durationDays: template.durationDays,
    durationNights: template.durationNights,
    durationLabel: `${template.durationDays} days / ${template.durationNights} nights`,
    waitlistEnabled: template.waitlistEnabled,
    seatHoldExpiryHours: template.seatHoldExpiryHours,
    isOpenForSale: template.status === "Open for Sale",
    // A seeded fixture, not a real wizard-authored row — always presented
    // as complete rather than pretending to measure completeness against a
    // shape it was never actually validated against.
    completeness: 100,
  };
}

/* ── The seeded template library ──────────────────────────────────────────── */

const UMRAH_ITINERARY: ItinerarySnapshotItem[] = [
  ...INITIAL_PACKAGE_FORM_DATA.itinerary.map((item) => ({
    id: item.id,
    day_number: item.dayNumber,
    title: item.title,
    location: item.location ?? "",
    description: item.description,
    category: item.category ?? "Other",
  })),
  {
    id: "it-4",
    day_number: 6,
    title: "Transfer to Madinah",
    location: "Makkah → Madinah",
    description:
      "Intercity VIP coach transfer to Madinah, hotel check-in and evening prayer at Masjid an-Nabawi.",
    category: "Transfer",
  },
  {
    id: "it-5",
    day_number: 9,
    title: "Madinah Ziyarah",
    location: "Madinah Al-Munawwarah",
    description:
      "Guided visits to Quba, Uhud, Qiblatain and the date plantations.",
    category: "Ziyarah",
  },
  {
    id: "it-6",
    day_number: 11,
    title: "Return to Colombo",
    location: "Madinah / Jeddah / Colombo",
    description: "Departure transfer, airport check-in and return flight.",
    category: "Departure",
  },
];

const UMRAH_ACCOMMODATION_STANDARDS: AccommodationStandardSnapshot[] = [
  {
    city: "MAKKAH",
    standard: INITIAL_PACKAGE_FORM_DATA.makkahAccommodationStandard,
    customer_wording: INITIAL_PACKAGE_FORM_DATA.makkahCustomerWording,
    nights: INITIAL_PACKAGE_FORM_DATA.makkahNights,
    meal_plan: INITIAL_PACKAGE_FORM_DATA.makkahMealPlan,
    target_distance: INITIAL_PACKAGE_FORM_DATA.makkahTargetDistance,
    occupancies: INITIAL_PACKAGE_FORM_DATA.makkahOccupancies,
  },
  {
    city: "MADINAH",
    standard: INITIAL_PACKAGE_FORM_DATA.madinahAccommodationStandard,
    customer_wording: INITIAL_PACKAGE_FORM_DATA.madinahCustomerWording,
    nights: INITIAL_PACKAGE_FORM_DATA.madinahNights,
    meal_plan: INITIAL_PACKAGE_FORM_DATA.madinahMealPlan,
    target_distance: INITIAL_PACKAGE_FORM_DATA.madinahTargetDistance,
    occupancies: INITIAL_PACKAGE_FORM_DATA.madinahOccupancies,
  },
];

const TRANSPORT_REQUIREMENTS: TransportRequirementSnapshot[] =
  DEFAULT_TRANSPORT_REQUIREMENTS.map((requirement) => ({
    id: requirement.id,
    route_label: requirement.routeLabel,
    origin: requirement.startLocation,
    destination: requirement.destination,
    required: requirement.required,
    vehicle_standard: requirement.vehicleStandard,
    vehicle_notes: requirement.vehicleNotes,
  }));

const TRAVELLER_REQUIREMENTS: TravellerRequirementSnapshot[] =
  DEFAULT_DOCUMENT_REQUIREMENTS.map((requirement) => ({
    id: requirement.id,
    name: requirement.name,
    category: requirement.category,
    required: requirement.required,
    required_by_stage: requirement.requiredByStage,
    verified_by_role: requirement.verifiedByRole,
  }));

const READINESS_REQUIREMENTS: ReadinessRequirementSnapshot[] =
  DEFAULT_READINESS_CHECKLIST.map(toReadinessRequirementSnapshot);

const UMRAH_TEMPLATE: PackageTemplateDefinition = {
  id: "pkg-umrah-standard-2026",
  name: INITIAL_PACKAGE_FORM_DATA.title,
  code: INITIAL_PACKAGE_FORM_DATA.internalCode,
  journeyType: "UMRAH",
  category: "Standard",
  status: "Open for Sale",
  overview: INITIAL_PACKAGE_FORM_DATA.description,
  paymentSchedule: DEFAULT_PAYMENT_MILESTONES.Umrah.map(
    toPaymentMilestoneSnapshot,
  ),
  itinerary: UMRAH_ITINERARY,
  inclusions: INITIAL_PACKAGE_FORM_DATA.inclusions,
  exclusions: INITIAL_PACKAGE_FORM_DATA.exclusions,
  accommodationStandards: UMRAH_ACCOMMODATION_STANDARDS,
  transportRequirements: TRANSPORT_REQUIREMENTS,
  travellerRequirements: TRAVELLER_REQUIREMENTS,
  readinessRequirements: READINESS_REQUIREMENTS,
  defaultCapacity: 40,
  minGroupSize: 15,
  durationDays: 11,
  durationNights: 10,
  waitlistEnabled: true,
  seatHoldExpiryHours: 24,
  cancellationPolicy: INITIAL_PACKAGE_FORM_DATA.cancellationPolicy,
  paymentTerms: INITIAL_PACKAGE_FORM_DATA.paymentTerms,
  latePaymentPolicy: INITIAL_PACKAGE_FORM_DATA.latePaymentPolicy,
  priceChangeDisclaimer: INITIAL_PACKAGE_FORM_DATA.priceChangeDisclaimer,
  includedServices: INITIAL_PACKAGE_FORM_DATA.includedServices,
  seatReservationRule: INITIAL_PACKAGE_FORM_DATA.seatReservationRule,
  communicationTemplates: INITIAL_PACKAGE_FORM_DATA.selectedCommunicationTemplates,
  // The seeded demo library has no publish history of its own — see
  // TEMPLATE_LIBRARY's own comment.
  publishedVersionId: null,
};

const RAMADAN_TEMPLATE: PackageTemplateDefinition = {
  ...UMRAH_TEMPLATE,
  id: "pkg-umrah-ramadan-2027",
  name: "Ramadan Umrah Package 2027",
  code: "RF-PKG-2027-UM-RAM",
  category: "Premium",
  overview:
    "A spiritually focused Ramadan Umrah journey with organised accommodation, transport, guidance and a planned Makkah and Madinah itinerary.",
  defaultCapacity: 40,
  durationDays: 15,
  durationNights: 14,
};

const HAJJ_TEMPLATE: PackageTemplateDefinition = {
  id: "pkg-hajj-standard-2027",
  name: "Standard Hajj 2027",
  code: "RF-PKG-2027-HJ01",
  journeyType: "HAJJ",
  category: "Standard",
  status: "Open for Sale",
  overview:
    "A comprehensive Hajj pilgrimage package including Aziziyah / Makkah hotel stay, Mina & Arafat tent arrangements, full board catering, Mutawwif guidance and transfers.",
  paymentSchedule: DEFAULT_PAYMENT_MILESTONES.Hajj.map(
    toPaymentMilestoneSnapshot,
  ),
  itinerary: [
    {
      id: "hj-it-1",
      day_number: 1,
      title: "Departure from Colombo & Arrival in Madinah",
      location: "Colombo / Madinah",
      description:
        "Flight from Colombo to Madinah, transfer to hotel and orientation briefing.",
      category: "Arrival",
    },
    {
      id: "hj-it-2",
      day_number: 6,
      title: "Ihram & Transfer to Makkah",
      location: "Madinah → Makkah",
      description:
        "Ihram at Dhul-Hulayfah, coach transfer to Makkah and arrival Umrah.",
      category: "Ritual",
    },
    {
      id: "hj-it-3",
      day_number: 18,
      title: "Days of Hajj — Mina, Arafat, Muzdalifah",
      location: "Mina / Arafat / Muzdalifah",
      description:
        "Full Hajj rites with Mutawwif guidance, camp catering and medical support.",
      category: "Ritual",
    },
  ],
  inclusions: [
    "Ministry Hajj quota registration",
    "Return Air Ticket (Colombo ↔ Jeddah/Madinah)",
    "Makkah, Madinah & Aziziyah accommodation",
    "Mina & Arafat tent allocation",
    "Full board catering during Hajj days",
    "Mutawwif & religious scholar guidance",
    "All ground transfers",
  ],
  exclusions: [
    "Personal & Shopping Expenses",
    "Qurbani / Hady payment",
    "Excess Baggage Charges",
    "Optional Private Transport",
  ],
  accommodationStandards: [
    {
      city: "MADINAH",
      standard: "4-star",
      customer_wording: "4-star accommodation near the Prophet's Mosque",
      nights: 5,
      meal_plan: "Full Board",
      target_distance: "Within 300m",
      occupancies: ["Quad", "Triple", "Double"],
    },
    {
      city: "MAKKAH",
      standard: "4-star",
      customer_wording: "4-star Aziziyah / Makkah accommodation",
      nights: 20,
      meal_plan: "Full Board",
      target_distance: "Shuttle serviced",
      occupancies: ["Quad", "Triple", "Double"],
    },
    {
      city: "MINA",
      standard: "Category B tents",
      customer_wording: "Air-conditioned Mina camp, Category B",
      nights: 4,
      meal_plan: "Full Board",
      target_distance: "Zone 3",
      occupancies: ["Quad"],
    },
  ],
  transportRequirements: TRANSPORT_REQUIREMENTS,
  travellerRequirements: TRAVELLER_REQUIREMENTS,
  readinessRequirements: READINESS_REQUIREMENTS,
  defaultCapacity: 50,
  minGroupSize: 25,
  durationDays: 30,
  durationNights: 29,
  waitlistEnabled: true,
  seatHoldExpiryHours: 48,
  cancellationPolicy:
    "Full refund 60+ days prior to departure. 50% refund 30-59 days prior. Non-refundable within 30 days of departure.",
  paymentTerms:
    "Initial registration deposit on booking, first instalment on ministry quota allocation, balance settled before visa stamping.",
  latePaymentPolicy:
    "Bookings with unpaid balances 21 days prior to departure are subject to auto-cancellation and quota forfeiture.",
  priceChangeDisclaimer:
    "Prices are subject to Ministry of Hajj quota fees, flight availability and Mina/Arafat camp allocation changes.",
  includedServices: [
    "Ministry Hajj quota registration",
    "Return air ticket",
    "Makkah, Madinah & Aziziyah accommodation",
    "Mina & Arafat tent allocation",
    "Full board catering during Hajj days",
    "Mutawwif & religious scholar guidance",
    "All ground transfers",
  ],
  seatReservationRule: "Registration deposit must be received before a quota seat is reserved.",
  communicationTemplates: [
    "On Booking Confirmation",
    "Ministry Quota Allocation Notice",
    "Payment Due Reminder",
    "7-Day Pre-Departure Briefing",
  ],
  // The seeded demo library has no publish history of its own — see
  // TEMPLATE_LIBRARY's own comment.
  publishedVersionId: null,
};

/**
 * Seeded, non-uuid-keyed demo templates — for seed scripts and evals
 * (`lib/agent/departure-ops/__evals__/fixtures.ts`) only. Never a runtime
 * fallback: `listPackageTemplateOptions()` (the live create-group picker)
 * only ever reads real `packages` rows, and `resolveTemplate()` (used by
 * `createDepartureGroup()`) refuses any non-uuid id outright rather than
 * looking it up here — a real Departure Group must always be built from a
 * real package. See docs/modules/packages-production-readiness-plan.md, finding
 * C9, for why that distinction matters: this library previously *was*
 * reachable from both, and a real customer-facing group could silently end
 * up built from this placeholder content instead of the package the
 * creator actually picked.
 */
export const TEMPLATE_LIBRARY: PackageTemplateDefinition[] = [
  UMRAH_TEMPLATE,
  RAMADAN_TEMPLATE,
  HAJJ_TEMPLATE,
];

export function findTemplate(
  templateId: string,
): PackageTemplateDefinition | undefined {
  return TEMPLATE_LIBRARY.find((template) => template.id === templateId);
}
