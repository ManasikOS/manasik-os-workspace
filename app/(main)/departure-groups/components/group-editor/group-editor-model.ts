import { addDays, format } from "date-fns";

import type {
  GroupSalesStatus,
  PackageTemplateOption,
  TemplateCopyOptions,
} from "../../types";

// ---------------------------------------------------------------------------
// What the departure group editor holds, and the numbers worked out from it.
// ---------------------------------------------------------------------------

export const COPY_LABELS: { key: keyof TemplateCopyOptions; label: string }[] = [
  { key: "itinerary", label: "Journey itinerary" },
  { key: "inclusionsAndExclusions", label: "Inclusions and exclusions" },
  { key: "travellerRequirements", label: "Traveller requirements" },
  { key: "readinessChecklist", label: "Readiness checklist" },
  { key: "accommodation", label: "Accommodation requirements" },
  { key: "transport", label: "Transport requirements" },
  { key: "flights", label: "Flight routing (2 draft flights)" },
];

export const DEFAULT_COPY: TemplateCopyOptions = {
  itinerary: true,
  inclusionsAndExclusions: true,
  travellerRequirements: true,
  readinessChecklist: true,
  accommodation: true,
  transport: true,
  flights: true,
};

export const SALES_STATUSES: GroupSalesStatus[] = [
  "SELLING",
  "LIMITED_AVAILABILITY",
  "WAITLIST",
  "SALES_CLOSED",
];

export const SEAT_HOLD_CHOICES = [6, 12, 24, 48];
export const CURRENCIES = ["LKR", "USD", "SAR", "EUR", "GBP"];
export const CABIN_CLASSES = ["Economy", "Premium Economy", "Business"];

/** The form works with `Date` objects; the schema and server want `yyyy-MM-dd`. */
export const toIsoDate = (date: Date) => format(date, "yyyy-MM-dd");

export interface GroupDetailsState {
  groupName: string;
  groupCode: string;
  departureDate: Date;
  returnDate: Date;
  capacity: string;
  minimumGroupSize: string;
  salesStatus: GroupSalesStatus;
  branch: string;
  operationsOwnerName: string;
  primaryGuideName: string;
  waitlistEnabled: boolean;
  seatHoldExpiryHours: number;
}

/**
 * This departure's own commercial facts. A template carries none of these (see
 * docs/architecture/package-departure-architecture-master-plan.md), so they are
 * always entered fresh per group, never defaulted from the template.
 */
export interface PricingState {
  currency: string;
  quadPrice: number | "";
  triplePrice: number | "";
  doublePrice: number | "";
  singlePrice: number | "";
  childPrice: number | "";
  infantPrice: number | "";
  earlyBirdPrice: number | "";
  advanceDeposit: number | "";
}

export interface CostEstimateState {
  flightCostPerPilgrim: string;
  accommodationCostPerPilgrim: string;
  transportCostPerPilgrim: string;
  visaInsuranceCostPerPilgrim: string;
  cateringCostPerPilgrim: string;
  guideOperationsCostPerPilgrim: string;
  contingencyCostPerPilgrim: string;
  fixedCostPerDeparture: string;
}

export interface FlightRoutingState {
  flightsIncluded: boolean;
  departureOrigin: string;
  arrivalGateway: string;
  returnGateway: string;
  preferredAirline: string;
  cabinClass: string;
}

export const DEFAULT_PRICING: PricingState = {
  currency: "LKR",
  quadPrice: "",
  triplePrice: "",
  doublePrice: "",
  singlePrice: "",
  childPrice: "",
  infantPrice: "",
  earlyBirdPrice: "",
  advanceDeposit: "",
};

export const DEFAULT_COST_ESTIMATE: CostEstimateState = {
  flightCostPerPilgrim: "",
  accommodationCostPerPilgrim: "",
  transportCostPerPilgrim: "",
  visaInsuranceCostPerPilgrim: "",
  cateringCostPerPilgrim: "",
  guideOperationsCostPerPilgrim: "",
  contingencyCostPerPilgrim: "",
  fixedCostPerDeparture: "0",
};

export const DEFAULT_FLIGHT_ROUTING: FlightRoutingState = {
  flightsIncluded: true,
  departureOrigin: "",
  arrivalGateway: "",
  returnGateway: "",
  preferredAirline: "",
  cabinClass: "Economy",
};

export function emptyDetails(branch: string): GroupDetailsState {
  return {
    groupName: "",
    groupCode: "",
    departureDate: new Date(),
    returnDate: new Date(),
    capacity: "",
    minimumGroupSize: "",
    salesStatus: "SELLING",
    branch,
    operationsOwnerName: "",
    primaryGuideName: "",
    waitlistEnabled: true,
    seatHoldExpiryHours: 24,
  };
}

/**
 * Seeds the details with a template's defaults; they stay editable. The return
 * date is pre-filled from the template's own length (`departure + days - 1`)
 * rather than left at its untouched same-day default, which nothing flagged.
 */
export function applyTemplateDefaults(
  details: GroupDetailsState,
  template: PackageTemplateOption,
): GroupDetailsState {
  return {
    ...details,
    capacity: String(template.defaultCapacity),
    minimumGroupSize: String(template.minGroupSize),
    waitlistEnabled: template.waitlistEnabled,
    seatHoldExpiryHours: template.seatHoldExpiryHours,
    returnDate: addDays(
      details.departureDate,
      Math.max(template.durationDays - 1, 0),
    ),
  };
}

/** `""` → `null`, `number` → itself, string → parsed: what every price field on the server expects. */
export const toNullableNumber = (value: number | string | ""): number | null => {
  if (typeof value === "number") return value;
  return value.trim() === "" ? null : Number(value);
};

/** Duration always comes from the group's real dates, never the template. */
export function durationInDays(departureDate: Date, returnDate: Date): number | null {
  const days =
    Math.round(
      (Date.parse(`${toIsoDate(returnDate)}T00:00:00Z`) -
        Date.parse(`${toIsoDate(departureDate)}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  return days > 0 ? days : null;
}

export interface MarginPreview {
  costPerPax: number;
  marginPerPax: number | null;
  marginPercent: number | null;
  breakEvenHeadcount: number | null;
}

/**
 * Live margin preview: the same shape as the `departure_group_costing` view's
 * math, minus the actual supplier cost and confirmed-pax terms that only exist
 * once bookings do. See migration `20260909090000_departure_group_costing.sql`.
 */
export function computeMarginPreview(
  quadPrice: number | null,
  cost: CostEstimateState,
): MarginPreview {
  const costPerPax =
    (toNullableNumber(cost.flightCostPerPilgrim) ?? 0) +
    (toNullableNumber(cost.accommodationCostPerPilgrim) ?? 0) +
    (toNullableNumber(cost.transportCostPerPilgrim) ?? 0) +
    (toNullableNumber(cost.visaInsuranceCostPerPilgrim) ?? 0) +
    (toNullableNumber(cost.cateringCostPerPilgrim) ?? 0) +
    (toNullableNumber(cost.guideOperationsCostPerPilgrim) ?? 0) +
    (toNullableNumber(cost.contingencyCostPerPilgrim) ?? 0);
  const fixedCost = Number(cost.fixedCostPerDeparture) || 0;
  const marginPerPax = quadPrice !== null ? quadPrice - costPerPax : null;
  const marginPercent =
    marginPerPax !== null && quadPrice ? (marginPerPax / quadPrice) * 100 : null;
  const breakEvenHeadcount =
    marginPerPax !== null && marginPerPax > 0
      ? Math.ceil(fixedCost / marginPerPax)
      : null;
  return { costPerPax, marginPerPax, marginPercent, breakEvenHeadcount };
}
