import type { ChargeType, DeviationType } from "../../../types";
import {
  BedDouble,
  Plane,
  Map,
  Wrench,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

export type DeviationFamily =
  | "accommodation"
  | "flight"
  | "itinerary"
  | "other";

export interface DeviationTypeEntry {
  type: DeviationType;
  family: DeviationFamily;
  label: string;
  suggestsCharge: boolean;
  suggestedChargeType: ChargeType | null;
  defaultBlocksDeparture: boolean;
}

export const DEVIATION_FAMILY_META: Record<
  DeviationFamily,
  { label: string; Icon: LucideIcon }
> = {
  accommodation: { label: "Accommodation", Icon: BedDouble },
  flight: { label: "Flight", Icon: Plane },
  itinerary: { label: "Itinerary & Services", Icon: Map },
  other: { label: "Other", Icon: HelpCircle },
};

const entry = (
  type: DeviationType,
  family: DeviationFamily,
  label: string,
  opts?: {
    suggestsCharge?: boolean;
    suggestedChargeType?: ChargeType;
    defaultBlocksDeparture?: boolean;
  },
): DeviationTypeEntry => ({
  type,
  family,
  label,
  suggestsCharge: opts?.suggestsCharge ?? false,
  suggestedChargeType: opts?.suggestedChargeType ?? null,
  defaultBlocksDeparture: opts?.defaultBlocksDeparture ?? false,
});

export const DEVIATION_REGISTRY: DeviationTypeEntry[] = [
  // Accommodation
  entry("EXTRA_NIGHTS", "accommodation", "Extra nights", {
    suggestsCharge: true,
    suggestedChargeType: "EXTRA_NIGHTS",
    defaultBlocksDeparture: true,
  }),
  entry("HOTEL_UPGRADE", "accommodation", "Different hotel", {
    suggestsCharge: true,
    suggestedChargeType: "ROOM_UPGRADE",
    defaultBlocksDeparture: true,
  }),
  entry("MEAL_PLAN", "accommodation", "Meal plan change"),
  entry("ROOMMATE_REQUEST", "accommodation", "Roommate request"),

  // Flight
  entry("OWN_FLIGHT", "flight", "Own flight", {
    suggestsCharge: true,
    suggestedChargeType: "FLIGHT_VARIATION",
    defaultBlocksDeparture: true,
  }),
  entry("LAND_ONLY", "flight", "Land only (no group ticket)", {
    suggestsCharge: true,
    suggestedChargeType: "FLIGHT_VARIATION",
    defaultBlocksDeparture: true,
  }),
  entry("CABIN_UPGRADE", "flight", "Cabin upgrade", {
    suggestsCharge: true,
    suggestedChargeType: "FLIGHT_VARIATION",
  }),
  entry("SEAT_PREFERENCE", "flight", "Seat preference"),
  entry("EXTENDED_STAY", "flight", "Extended stay / later return", {
    suggestsCharge: true,
    suggestedChargeType: "FLIGHT_VARIATION",
    defaultBlocksDeparture: true,
  }),

  // Itinerary & services
  entry("ITINERARY_OPT_OUT", "itinerary", "Opt out of itinerary day(s)"),
  entry("ITINERARY_ADDITION", "itinerary", "Add an activity"),
  entry("SERVICE_ADDON", "itinerary", "Service add-on", {
    suggestsCharge: true,
    suggestedChargeType: "ADDON",
  }),
  entry("PRIVATE_TRANSFER", "itinerary", "Private transfer", {
    suggestsCharge: true,
    suggestedChargeType: "TRANSPORT_VARIATION",
    defaultBlocksDeparture: true,
  }),
  entry("PICKUP_POINT", "itinerary", "Different pickup point"),

  // Other
  entry("DOCUMENT_REQUIREMENT", "other", "Document requirement", {
    defaultBlocksDeparture: true,
  }),
  entry("ASSISTANCE", "other", "Assistance / accessibility", {
    defaultBlocksDeparture: true,
  }),
  entry("OTHER", "other", "Other"),
];

export const DEVIATION_BY_TYPE = Object.fromEntries(
  DEVIATION_REGISTRY.map((e) => [e.type, e]),
) as Record<DeviationType, DeviationTypeEntry>;

export function entriesForFamily(family: DeviationFamily): DeviationTypeEntry[] {
  return DEVIATION_REGISTRY.filter((e) => e.family === family);
}
