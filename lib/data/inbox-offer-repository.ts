/**
 * S3's reads — MI3.2 of docs/inbox/implementation-plan.md. Two jobs, both scoped to one agency:
 *
 *   1. `matchOffersForConversation` — load the agency's live departure groups through the Sales Engine's own loader
 *      (`loadOfferCandidates`, the code behind /departure-groups and the Leads drawer) and run the matcher, so the seats and
 *      prices on the Inbox card are the ones every other screen shows;
 *   2. `checkStoredOffer` — read ONE group's live seats and price date and compare them with the stored snapshot (R1).
 *
 * The pipeline runs on the service-role client, which RLS does not filter. Every read here therefore names the agency:
 * candidates are filtered to it, and the live check looks the group up by (agency, id), so another agency's group is
 * never a candidate and never "still available".
 */

import "server-only";

import { DEAD_GROUP_STATUSES, loadOfferCandidates } from "@/lib/copilot/sales/knowledge-context";
import type { OfferMatchingResult, TravelIntent } from "@/lib/copilot/sales/types";
import type { Db } from "@/lib/ai/db";
import type { MatchedOfferSnapshot, OfferCheckState } from "@/lib/inbox/intelligence/contracts";
import { buildOfferSnapshot, matchConversationOffers, revalidateOffer, type LiveOfferFacts } from "@/lib/inbox/intelligence/offer";

export interface ConversationOfferMatch {
  result: OfferMatchingResult;
  /** null when nothing is bookable — including a waitlist-only outcome, which is never an offer. */
  snapshot: MatchedOfferSnapshot | null;
}

export async function matchOffersForConversation(
  db: Db,
  input: { agencyId: string; conversationId: string; intent: TravelIntent; now: string },
): Promise<ConversationOfferMatch> {
  const candidates = await loadOfferCandidates(db, input.intent.journeyType ?? "UMRAH", [], { agencyId: input.agencyId });
  const result = matchConversationOffers({ conversationId: input.conversationId, intent: input.intent, candidates, now: input.now });
  return { result, snapshot: buildOfferSnapshot(result, candidates, input.now) };
}

const SELLABLE_SALES_STATUSES = new Set(["SELLING", "LIMITED_AVAILABILITY"]);

/** The group as it is right now, or a "gone" reading when this agency has no such group. */
export async function loadLiveOfferFacts(db: Db, agencyId: string, departureGroupId: string, today: string): Promise<LiveOfferFacts> {
  const { data: group, error } = await db
    .from("departure_groups")
    .select("available_seats, group_status, sales_status, archived, departure_date")
    .eq("agency_id", agencyId)
    .eq("id", departureGroupId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the departure group: ${error.message}`);
  if (!group) return { available: false, availableSeats: 0, pricedAt: null, earlyBirdValidUntil: null };

  const row = group as { available_seats: number | null; group_status: string; sales_status: string; archived: boolean | null; departure_date: string };
  const { data: pricing, error: pricingError } = await db
    .from("departure_group_pricing")
    .select("priced_at, early_bird_valid_until")
    .eq("departure_group_id", departureGroupId)
    .maybeSingle();
  if (pricingError) throw new Error(`Could not read the group's price: ${pricingError.message}`);
  const priced = pricing as { priced_at: string | null; early_bird_valid_until: string | null } | null;

  return {
    available: !row.archived && !DEAD_GROUP_STATUSES.has(row.group_status) && SELLABLE_SALES_STATUSES.has(row.sales_status) && row.departure_date.slice(0, 10) >= today,
    availableSeats: row.available_seats ?? 0,
    pricedAt: priced?.priced_at ?? null,
    earlyBirdValidUntil: priced?.early_bird_valid_until ?? null,
  };
}

/** R1: is the stored offer still true? Reads the live group; the caller decides what a failed read means. */
export async function checkStoredOffer(db: Db, agencyId: string, snapshot: MatchedOfferSnapshot, now: string): Promise<OfferCheckState> {
  const live = await loadLiveOfferFacts(db, agencyId, snapshot.departureGroupId, now.slice(0, 10));
  return revalidateOffer(snapshot, live, now);
}
