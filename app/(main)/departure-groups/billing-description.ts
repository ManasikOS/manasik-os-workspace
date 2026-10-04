/**
 * Turns a charge line — plus the deviation that explains it, if there is one
 * — into a human-readable billing description. Every surface that shows a
 * charge to a person (the booking detail dialog, an invoice line item, the
 * invoice PDF) calls this, so the screen and the customer's document can
 * never word the same charge differently.
 *
 * A charge's own `label` is free text and often terse ("Hotel upgrade").
 * The rich facts — which hotel, which nights, which flight — live on the
 * paired deviation's `detail` (see `deviation.charge_id`). This is the one
 * place that joins them.
 */

import type {
  ChargeType,
  DepartureGroupAccommodation,
  DepartureGroupFlight,
  DepartureGroupPackageSnapshot,
  DepartureGroupTransport,
  DeviationDetail,
  PilgrimCharge,
  PilgrimDeviation,
  ServiceAddon,
} from "./types";
import { ROOM_TYPE_LABELS, formatDate } from "./utils";

export const CHARGE_TYPE_LABELS: Record<ChargeType, string> = {
  BASE_FARE: "Package base fare",
  ROOM_UPGRADE: "Room upgrade",
  EXTRA_NIGHTS: "Extra nights",
  FLIGHT_VARIATION: "Flight variation",
  TRANSPORT_VARIATION: "Transport variation",
  ADDON: "Add-on",
  DISCOUNT: "Discount",
  SURCHARGE: "Surcharge",
  PRICE_CORRECTION: "Price correction",
  CANCELLATION_FEE: "Cancellation fee",
};

export interface ChargeDescriptionContext {
  accommodations: DepartureGroupAccommodation[];
  flights: DepartureGroupFlight[];
  transports: DepartureGroupTransport[];
  addons: ServiceAddon[];
  itinerary: DepartureGroupPackageSnapshot["itinerary"];
}

export interface ChargeDescription {
  /** One-line title. Never empty. */
  title: string;
  /** Supporting facts, already formatted for display. May be empty. */
  details: string[];
}

const EMPTY_CONTEXT: ChargeDescriptionContext = {
  accommodations: [],
  flights: [],
  transports: [],
  addons: [],
  itinerary: [],
};

function detailLines(
  detail: DeviationDetail,
  context: ChargeDescriptionContext,
): string[] {
  switch (detail.kind) {
    case "ROOM_TYPE":
      return [`New occupancy: ${ROOM_TYPE_LABELS[detail.roomType]}`];

    case "EXTRA_NIGHTS": {
      const acc = context.accommodations.find(
        (a) => a.id === detail.accommodationId,
      );
      const lines = [
        `${detail.nights} night(s) in ${cityLabel(detail.city)}, ${detail.side.toLowerCase()} the group's dates`,
      ];
      if (acc) lines.push(acc.hotelName);
      if (detail.checkInDate || detail.checkOutDate) {
        lines.push(
          `Check-in ${formatDate(detail.checkInDate ?? null)} · Check-out ${formatDate(detail.checkOutDate ?? null)}`,
        );
      }
      return lines;
    }

    case "HOTEL_UPGRADE": {
      const from = context.accommodations.find(
        (a) => a.id === detail.fromAccommodationId,
      );
      const lines = [
        `${detail.hotelName}${from ? ` (replaces ${from.hotelName})` : ""}`,
      ];
      if (detail.checkInDate || detail.checkOutDate) {
        lines.push(
          `Check-in ${formatDate(detail.checkInDate ?? null)} · Check-out ${formatDate(detail.checkOutDate ?? null)}`,
        );
      }
      if (detail.distanceDescription) lines.push(detail.distanceDescription);
      if (detail.supplierName) lines.push(`Supplier: ${detail.supplierName}`);
      return lines;
    }

    case "MEAL_PLAN":
      return [`Meal plan: ${detail.mealPlan}`];

    case "ROOMMATE_REQUEST":
      return [
        `Roommate request (${detail.withPilgrimIds.length} traveller(s))`,
        ...(detail.note ? [detail.note] : []),
      ];

    case "OWN_FLIGHT": {
      const lines = [
        `${detail.airline}${detail.flightNumber ? ` ${detail.flightNumber}` : ""} · ${detail.direction.toLowerCase()}`,
      ];
      if (detail.originAirportCode || detail.destinationAirportCode) {
        lines.push(
          `${detail.originAirportCode ?? "—"} → ${detail.destinationAirportCode ?? "—"}`,
        );
      }
      if (!detail.arrivesWithGroup) {
        lines.push("Does not arrive with the group");
      }
      return lines;
    }

    case "LAND_ONLY":
      return ["No group flight", ...(detail.note ? [detail.note] : [])];

    case "CABIN_UPGRADE": {
      const flight = context.flights.find((f) => f.id === detail.flightId);
      return [
        `${detail.fromCabin} → ${detail.toCabin}`,
        ...(flight ? [flightLabel(flight)] : []),
      ];
    }

    case "SEAT_PREFERENCE": {
      const flight = context.flights.find((f) => f.id === detail.flightId);
      return [
        `Seat preference: ${detail.preference.replace(/_/g, " ").toLowerCase()}`,
        ...(flight ? [flightLabel(flight)] : []),
        ...(detail.note ? [detail.note] : []),
      ];
    }

    case "EXTENDED_STAY":
      return [
        `Returns ${formatDate(detail.newReturnDate)}`,
        detail.onwardArrangement,
      ];

    case "ITINERARY_OPT_OUT": {
      const items = context.itinerary.filter((i) =>
        detail.itineraryItemIds.includes(i.id),
      );
      return [
        items.length > 0
          ? `Opts out of: ${items.map((i) => `Day ${i.dayNumber} — ${i.title}`).join(", ")}`
          : `Opts out of ${detail.itineraryItemIds.length} itinerary day(s)`,
        ...(detail.reason ? [detail.reason] : []),
      ];
    }

    case "ITINERARY_ADDITION":
      return [
        `${detail.location}${detail.dayNumber ? ` · Day ${detail.dayNumber}` : ""}`,
        ...(detail.description ? [detail.description] : []),
      ];

    case "SERVICE_ADDON": {
      const addon = context.addons.find((a) => a.id === detail.addonId);
      return [
        addon ? addon.name : (detail.addonCode ?? "Service add-on"),
        ...(detail.quantity > 1 ? [`Quantity: ${detail.quantity}`] : []),
        ...(detail.note ? [detail.note] : []),
      ];
    }

    case "PRIVATE_TRANSFER": {
      const transport = context.transports.find(
        (t) => t.id === detail.transportId,
      );
      return [
        `${detail.route} (${detail.vehicleType.toLowerCase().replace(/_/g, " ")})`,
        ...(transport ? [transport.routeLabel] : []),
      ];
    }

    case "PICKUP_POINT":
      return [`Pickup: ${detail.pickupLocation}`];

    case "DOCUMENT_REQUIREMENT":
      return [
        `${detail.documentName} — required by ${detail.requiredByStage.replace(/_/g, " ").toLowerCase()}`,
      ];

    case "ASSISTANCE":
      return [
        `${detail.assistanceType.charAt(0) + detail.assistanceType.slice(1).toLowerCase()}: ${detail.details}`,
      ];

    case "OTHER":
      return [detail.note];

    default:
      return [];
  }
}

function cityLabel(city: string): string {
  return city.charAt(0) + city.slice(1).toLowerCase();
}

function flightLabel(f: DepartureGroupFlight): string {
  return `${f.airline}${f.flightNumber ? ` ${f.flightNumber}` : ""} · ${f.originAirportCode}→${f.destinationAirportCode}`;
}

/** Does `label` say anything a bare charge-type fallback wouldn't already say? */
function isSpecificLabel(label: string, chargeType: ChargeType): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;
  return trimmed.toLowerCase() !== CHARGE_TYPE_LABELS[chargeType].toLowerCase();
}

/**
 * Describes one charge line for display. `deviation` is the paired
 * deviation when `charge.id === deviation.chargeId` for some deviation on
 * the same traveller — pass `undefined` when there isn't one (most base
 * fares, most manual adjustments).
 */
export function describeCharge(
  charge: PilgrimCharge,
  deviation: PilgrimDeviation | undefined,
  context: ChargeDescriptionContext = EMPTY_CONTEXT,
): ChargeDescription {
  if (charge.chargeType === "BASE_FARE") {
    return {
      title: CHARGE_TYPE_LABELS.BASE_FARE,
      details: charge.pricedRoomType
        ? [`${ROOM_TYPE_LABELS[charge.pricedRoomType]} occupancy`]
        : [],
    };
  }

  const title = isSpecificLabel(charge.label, charge.chargeType)
    ? charge.label.trim()
    : (deviation?.summary?.trim() ?? CHARGE_TYPE_LABELS[charge.chargeType]);

  const details =
    deviation && deviation.detail && "kind" in deviation.detail
      ? detailLines(deviation.detail as DeviationDetail, context)
      : [];

  if (charge.reason && !details.includes(charge.reason)) {
    details.push(charge.reason);
  }

  return { title, details };
}
