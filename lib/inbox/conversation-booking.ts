/**
 * Pure guard clauses and derivations for `createBookingFromConversation()`
 * (app/inbox/actions.ts), split out so they can be unit-tested
 * without a Supabase client — same split as `lead-link-decision.ts`.
 */

import type { LeadRoomPreference } from "@/lib/types/leads";

export interface ConversationBookingLead {
  booking_id: string | null;
  selected_departure_group_id: string | null;
  adults: number;
  children: number;
  room_preference: LeadRoomPreference;
}

export interface DerivedBookingInput {
  travellerCount: number;
  /** UNDECIDED falls back to TRIPLE — the group's own default tier, not a guess at what the traveller wants. */
  roomOccupancyPreference: Exclude<LeadRoomPreference, "UNDECIDED">;
}

export type DeriveBookingFromLeadOutcome =
  | { ok: true; result: DerivedBookingInput }
  | { ok: false; error: string };

/**
 * Checks a lead is actually ready for `createBookingFromConversation()` to
 * hand off to `createGroupBooking()`, and derives the two fields that need a
 * fallback rule rather than a plain pass-through.
 */
export function deriveBookingFromLead(lead: ConversationBookingLead | null): DeriveBookingFromLeadOutcome {
  if (!lead) return { ok: false, error: "The linked lead is no longer available." };
  if (lead.booking_id) return { ok: false, error: "This lead already has a booking." };
  if (!lead.selected_departure_group_id) {
    return { ok: false, error: "Select a departure group for this lead before creating a booking." };
  }

  const travellerCount = lead.adults + lead.children;
  if (travellerCount < 1) return { ok: false, error: "Add at least one traveller to the linked lead first." };

  const roomOccupancyPreference = lead.room_preference === "UNDECIDED" ? "TRIPLE" : lead.room_preference;
  return { ok: true, result: { travellerCount, roomOccupancyPreference } };
}
