/**
 * CopilotKnowledgeContextService — the only place the Sales Intelligence
 * Engine reads data. Server-only.
 *
 * Builds, for one lead:
 *   * `LeadFacts` from the lead row and its internal notes;
 *   * the staff-approved TravelIntent and alert dismissals;
 *   * `OfferCandidate`s for every live group of the journey type, each split
 *     into customer-safe facts and internal signals.
 *
 * Availability is the live `departure_groups.available_seats` — a generated
 * column: capacity − confirmed bookings − held seats. Expired holds are
 * released by the scheduled sweep; until then they still count as held,
 * which errs on the side of never offering a seat that may not exist.
 */

import "server-only";

import {
  getGroupPricingRow,
  getPackageSnapshotRow,
  listConfirmedFlights,
  listConfirmedHotels,
  listDepartureGroups,
} from "@/lib/data/departure-groups";
import { groupPrice } from "@/lib/data/departure-groups-money";
import { copilotContextFor, toLeadFacts } from "@/lib/data/leads-copilot";
import { loadLeadStore, type Db, type LeadStore } from "@/lib/data/leads-repository";
import type { LeadCopilotContextRow, LeadJourneyType, LeadRow } from "@/lib/types/leads";

import { parseTravelIntent } from "./schemas";
import type { LeadFacts, OccupancyType, OfferCandidate, TravelIntent } from "./types";

export interface CopilotKnowledgeContext {
  store: LeadStore;
  leadRow: LeadRow;
  lead: LeadFacts;
  contextRow: LeadCopilotContextRow | null;
  /** The approved intent on file, or the unsaved one staff is working with. */
  intent: TravelIntent | null;
  hasSavedIntent: boolean;
  candidates: OfferCandidate[];
  selectedCandidate: OfferCandidate | null;
  dismissedFingerprints: string[];
}

export const DEAD_GROUP_STATUSES = new Set(["CANCELLED", "COMPLETED", "CLOSED", "DEPARTED"]);

/**
 * Live groups of one journey type (sellable, or sold out with a waitlist),
 * plus any explicitly requested group ids regardless of status.
 *
 * `options.agencyId` keeps only that agency's groups. The session client is already scoped by RLS, so the Leads drawer
 * passes nothing; a caller on the service-role client (the Inbox pipeline) MUST pass it, or every agency's groups
 * become candidates.
 */
export async function loadOfferCandidates(
  db: Db,
  journeyType: LeadJourneyType,
  alsoGroupIds: readonly string[] = [],
  options: { agencyId?: string } = {},
): Promise<OfferCandidate[]> {
  const listed = await listDepartureGroups({ client: db, agencyId: options.agencyId });
  // Scoped in the query above; filtered again here so a loader change can never widen the candidates.
  const groups = options.agencyId === undefined ? listed : listed.filter((group) => group.agencyId === options.agencyId);
  const wanted = groups.filter((group) => {
    if (alsoGroupIds.includes(group.id)) return true;
    const live = !group.archived && group.daysUntilDeparture >= 0 && !DEAD_GROUP_STATUSES.has(group.groupStatus);
    const sellable = group.salesStatus === "SELLING" || group.salesStatus === "LIMITED_AVAILABILITY";
    const waitlist = group.salesStatus === "WAITLIST" && group.waitlistEnabled;
    return group.journeyType === journeyType && live && (sellable || waitlist);
  });
  if (wanted.length === 0) return [];

  const packageIds = [...new Set(wanted.map((group) => group.packageTemplateId).filter(Boolean))];
  const { data: packageRows } = await db.from("packages").select("id, status").in("id", packageIds);
  const packageStatus = new Map(
    ((packageRows ?? []) as { id: string; status: string }[]).map((row) => [row.id, row.status]),
  );

  return Promise.all(
    wanted.map(async (group): Promise<OfferCandidate> => {
      const [snapshot, pricingRow, confirmedHotels, confirmedFlights] = await Promise.all([
        getPackageSnapshotRow(group.id, db),
        getGroupPricingRow(group.id, db),
        listConfirmedHotels(group.id, db),
        listConfirmedFlights(group.id, db),
      ]);
      const pricing = groupPrice(pricingRow, snapshot?.pricing_snapshot);

      const occupancyPrices: Partial<Record<OccupancyType, number>> = {};
      const priced: [OccupancyType, number | null][] = [
        ["QUAD", pricing.quadPrice],
        ["TRIPLE", pricing.triplePrice],
        ["DOUBLE", pricing.doublePrice],
        ["SINGLE", pricing.singlePrice],
      ];
      for (const [room, price] of priced) {
        if (typeof price === "number") occupancyPrices[room] = Number(price);
      }

      const transport = [
        ...new Set(
          (snapshot?.transport_requirements_snapshot ?? [])
            .filter((entry) => entry.required && entry.vehicle_standard)
            .map((entry) => entry.vehicle_standard),
        ),
      ];

      // A built-in template has no `packages` row; its frozen snapshot is the
      // source of truth, so it counts as published.
      const status = packageStatus.get(group.packageTemplateId);
      const packagePublished = status === undefined || status === "Open for Sale";

      return {
        facts: {
          groupId: group.id,
          groupName: group.groupName,
          groupCode: group.groupCode,
          packageTemplateId: group.packageTemplateId,
          packageName: group.packageTemplateName,
          journeyType: group.journeyType,
          departureDate: group.departureDate,
          returnDate: group.returnDate,
          durationDays: group.durationDays,
          durationNights: group.durationNights,
          availableSeats: group.availableSeats,
          salesStatus: group.salesStatus,
          waitlistEnabled: group.waitlistEnabled,
          currency: pricing.currency,
          occupancyPrices,
          childPrice: pricing.childPrice === null ? null : Number(pricing.childPrice),
          infantPrice: pricing.infantPrice === null ? null : Number(pricing.infantPrice),
          depositPerPerson: pricing.advanceDeposit === null ? null : Number(pricing.advanceDeposit),
          paymentSchedule: snapshot?.payment_schedule_snapshot ?? [],
          accommodation: (snapshot?.accommodation_standards_snapshot ?? []).map((stay) => ({
            city: stay.city,
            description: stay.customer_wording?.trim() || stay.standard,
            nights: stay.nights,
            mealPlan: stay.meal_plan,
            distance: stay.target_distance,
          })),
          transportStandard: transport.length > 0 ? transport.join(" · ") : null,
          inclusions: snapshot?.inclusions_snapshot ?? [],
          exclusions: snapshot?.exclusions_snapshot ?? [],
          confirmedHotels,
          confirmedFlights,
        },
        internal: {
          readinessStatus: group.readinessStatus,
          hasCriticalBlock: group.readinessStatus === "BLOCKED",
          priceSource: pricing.priceSource === "OVERRIDDEN" ? "GROUP_OVERRIDE" : "PACKAGE_TEMPLATE",
          packagePublished,
          pricedAt: pricingRow?.priced_at ?? null,
          earlyBirdValidUntil: pricingRow?.early_bird_valid_until ?? null,
          isSellable:
            (group.salesStatus === "SELLING" || group.salesStatus === "LIMITED_AVAILABILITY") &&
            !group.archived &&
            group.daysUntilDeparture >= 0 &&
            !DEAD_GROUP_STATUSES.has(group.groupStatus),
        },
      };
    }),
  );
}

/**
 * Everything the engine needs to reason about one lead.
 * `intentOverride` is an unsaved intent staff is still editing (e.g. "Find
 * Best Group" straight from the Analyse dialog) — it wins over the saved one.
 */
export async function loadCopilotKnowledgeContext(
  db: Db,
  leadId: string,
  intentOverride: TravelIntent | null = null,
): Promise<CopilotKnowledgeContext | null> {
  const store = await loadLeadStore(db);
  const leadRow = store.leads.find((lead) => lead.id === leadId);
  if (!leadRow) return null;

  const lead = toLeadFacts(leadRow, store);
  const contextRow = copilotContextFor(store, leadId);
  const savedIntent = contextRow?.travel_intent ? parseTravelIntent(contextRow.travel_intent) : null;
  const intent = intentOverride ?? savedIntent;
  const journeyType = intent?.journeyType ?? lead.journeyType;

  const selectedId = lead.selectedDepartureGroupId;
  const candidates = await loadOfferCandidates(db, journeyType, selectedId ? [selectedId] : []);
  const selectedCandidate = selectedId ? (candidates.find((entry) => entry.facts.groupId === selectedId) ?? null) : null;

  return {
    store,
    leadRow,
    lead,
    contextRow,
    intent,
    hasSavedIntent: savedIntent !== null,
    // The selected group is loaded for alerts even when it is off-journey or
    // no longer live; the matcher's own gates keep it out of the offers.
    candidates,
    selectedCandidate,
    dismissedFingerprints: store.copilotDismissals
      .filter((row) => row.lead_id === leadId)
      .map((row) => row.fingerprint),
  };
}
