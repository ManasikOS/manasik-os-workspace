/**
 * Customer-safe availability read model for the AI Sales Agent.
 *
 * Departure Groups are the source of truth for what can actually be sold, so
 * this module is the *only* surface the agent should read. Its job is to make
 * over-promising structurally impossible:
 *
 *   * Groups that are not sellable never appear (see `isGroupEligible`).
 *   * Hotel names, flight numbers and PNRs are omitted unless the supplier
 *     booking is CONFIRMED — an unconfirmed hotel is reported as a standard
 *     ("4-star within 500m"), never as a name the customer could hold us to.
 *   * Seat counts are the live `available_seats`, so the agent cannot offer a
 *     seat that does not exist.
 *   * Nothing here exposes supplier cost, margin, visa state or traveller PII.
 */

import {
  getGroupPricingRow,
  getPackageSnapshotRow,
  listConfirmedFlights,
  listConfirmedHotels,
  listDepartureGroups,
} from "@/lib/data/departure-groups";
import type { Db } from "@/lib/data/departure-groups-repository";
import { groupPrice } from "@/lib/data/departure-groups-money";
import type {
  DepartureGroupListItem,
  GroupJourneyType,
  GroupReadinessStatus,
  GroupSalesStatus,
} from "@/app/(main)/departure-groups/types";

export interface AiOccupancyOption {
  roomType: "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE";
  pricePerPerson: number;
}

export interface AiItineraryDay {
  dayNumber: number;
  title: string;
  location: string;
  description: string;
}

export interface AiGroupAvailability {
  groupId: string;
  groupName: string;
  groupCode: string;
  packageTemplateId: string;
  packageTemplateName: string;
  journeyType: GroupJourneyType;
  departureDate: string;
  returnDate: string;
  durationLabel: string;
  salesStatus: GroupSalesStatus;
  availableSeats: number;
  waitlistEnabled: boolean;
  currency: string;
  occupancyOptions: AiOccupancyOption[];
  advanceDeposit: number | null;
  /** Whether the price shown is a group-level override or the snapshot price. */
  priceSource: "GROUP_OVERRIDE" | "PACKAGE_SNAPSHOT";
  publicInclusions: string[];
  publicExclusions: string[];
  publicItinerary: AiItineraryDay[];
  /** Coarse operational signal only — never the internal score breakdown. */
  readinessSummary: Exclude<GroupReadinessStatus, "BLOCKED"> | "IN_PREPARATION";
  /**
   * Only populated for CONFIRMED suppliers. Absent means "not yet confirmed" —
   * the agent must describe the standard instead of naming a hotel or flight.
   */
  confirmedHotels: { city: string; hotelName: string; nights: number }[];
  confirmedFlights: {
    direction: "OUTBOUND" | "RETURN";
    airline: string;
    departureAt: string;
    arrivalAt: string;
  }[];
}

/**
 * The eligibility gate. A group must pass every clause to be offerable.
 */
export function isGroupEligible(
  group: DepartureGroupListItem,
  requestedTravellers: number,
): boolean {
  const sellable =
    group.salesStatus === "SELLING" ||
    group.salesStatus === "LIMITED_AVAILABILITY";
  const live =
    group.groupStatus !== "CANCELLED" &&
    group.groupStatus !== "COMPLETED" &&
    group.groupStatus !== "CLOSED";
  const hasSeats = group.availableSeats >= requestedTravellers;
  const notArchived = !group.archived;
  const notDeparted = group.daysUntilDeparture >= 0;

  return sellable && live && hasSeats && notArchived && notDeparted;
}

function readinessSummaryFor(
  group: DepartureGroupListItem,
): AiGroupAvailability["readinessSummary"] {
  if (group.readinessStatus === "READY") return "READY";
  if (group.readinessStatus === "NOT_STARTED") return "NOT_STARTED";
  // "At risk" and "blocked" are internal operational states — a customer-facing
  // agent says the group is still being prepared, and nothing more.
  return "IN_PREPARATION";
}

/**
 * Groups the AI Sales Agent may quote, newest departure first.
 *
 * @param requestedTravellers seats the customer needs; groups without capacity
 *   for the whole party are excluded rather than partially offered.
 * @param packageTemplateId optional filter once the agent has matched a package.
 * @param client admin client for callers with no session (the WhatsApp
 *   agent). Omit to use the signed-in staff session, as every UI call site
 *   already does — see docs/modules/whatsapp-ai-agent-implementation-plan.md F3.
 */
export async function listSellableGroupsForAi(
  requestedTravellers = 1,
  packageTemplateId?: string,
  client?: Db,
): Promise<AiGroupAvailability[]> {
  const groups = await listDepartureGroups({ client });

  const eligible = groups
    .filter((group) => isGroupEligible(group, requestedTravellers))
    .filter(
      (group) =>
        !packageTemplateId || group.packageTemplateId === packageTemplateId,
    );

  // Each group needs its own snapshot and confirmed-supplier reads, so they go
  // out together rather than one group at a time.
  const rows = await Promise.all(
    eligible.map(async (group) => {
      const [snapshot, pricingRow, confirmedHotels, confirmedFlights] =
        await Promise.all([
          getPackageSnapshotRow(group.id, client),
          getGroupPricingRow(group.id, client),
          listConfirmedHotels(group.id, client),
          listConfirmedFlights(group.id, client),
        ]);
      const pricing = groupPrice(pricingRow, snapshot?.pricing_snapshot);
      const currency = pricing.currency;

      const occupancyOptions: AiOccupancyOption[] = (
        [
          ["QUAD", pricing.quadPrice],
          ["TRIPLE", pricing.triplePrice],
          ["DOUBLE", pricing.doublePrice],
          ["SINGLE", pricing.singlePrice],
        ] as const
      )
        .filter((entry): entry is [AiOccupancyOption["roomType"], number] =>
          typeof entry[1] === "number",
        )
        .map(([roomType, pricePerPerson]) => ({ roomType, pricePerPerson }));

      return {
        groupId: group.id,
        groupName: group.groupName,
        groupCode: group.groupCode,
        packageTemplateId: group.packageTemplateId,
        packageTemplateName: group.packageTemplateName,
        journeyType: group.journeyType,
        departureDate: group.departureDate,
        returnDate: group.returnDate,
        durationLabel: `${group.durationDays} days / ${group.durationNights} nights`,
        salesStatus: group.salesStatus,
        availableSeats: group.availableSeats,
        waitlistEnabled: group.waitlistEnabled,
        currency,
        occupancyOptions,
        advanceDeposit: pricing.advanceDeposit,
        priceSource:
          pricing.priceSource === "OVERRIDDEN"
            ? ("GROUP_OVERRIDE" as const)
            : ("PACKAGE_SNAPSHOT" as const),
        publicInclusions: snapshot?.inclusions_snapshot ?? [],
        publicExclusions: snapshot?.exclusions_snapshot ?? [],
        // No demo-library fallback here — see finding C9 in
        // docs/modules/packages-production-readiness-plan.md. `findTemplate()`
        // only ever resolved the seeded demo library's non-uuid keys, so
        // for every real, customer-created group (a real uuid
        // `packageTemplateId`) it was already a silent no-op; the one case
        // it did anything was a genuinely empty snapshot, where it would
        // have shown the AI a demo itinerary instead of the honest "no
        // published itinerary" this array being empty now represents.
        publicItinerary: (snapshot?.itinerary_snapshot ?? []).map((item) => ({
          dayNumber: item.day_number,
          title: item.title,
          location: item.location,
          description: item.description,
        })),
        readinessSummary: readinessSummaryFor(group),
        confirmedHotels,
        confirmedFlights,
      };
    }),
  );

  return rows.sort((a, b) => a.departureDate.localeCompare(b.departureDate));
}

/** Single-group lookup used once the customer has picked a departure. */
export async function getSellableGroupForAi(
  groupId: string,
  requestedTravellers = 1,
  client?: Db,
): Promise<AiGroupAvailability | null> {
  const groups = await listSellableGroupsForAi(requestedTravellers, undefined, client);
  return groups.find((group) => group.groupId === groupId) ?? null;
}

/**
 * Guard for the booking hand-off: re-checks eligibility at the moment a seat
 * hold is requested, so a group that sold out mid-conversation is rejected.
 */
export async function canHoldSeats(
  groupId: string,
  travellers: number,
  client?: Db,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const groups = await listDepartureGroups({ client });
  const group = groups.find((g) => g.id === groupId);

  if (!group) return { ok: false, reason: "That departure group no longer exists." };
  if (!isGroupEligible(group, travellers)) {
    return {
      ok: false,
      reason:
        group.availableSeats < travellers
          ? `Only ${group.availableSeats} seat(s) remain on ${group.groupName}.`
          : `${group.groupName} is not open for sale.`,
    };
  }
  return { ok: true };
}
