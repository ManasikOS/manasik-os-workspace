/**
 * Seat hold conversion (MI4.6). Native v2, `module: "leads"`, `requiredCapability: "convertToBooking"` — the same capability
 * that gates "Create booking" — `subjectType: "CONVERSATION"`, risk MEDIUM.
 *
 * It rides the SAME unit of work the Departure Groups screen and the WhatsApp booking agent use (`createGroupBooking()`, which
 * carries the capacity guard and the atomic write), and always lands on `bookingStatus: "HELD"`: seats are set aside for the
 * group's own hold period (`departure_groups.seat_hold_expiry_hours`) and the hourly sweep releases them if nobody confirms.
 * Confirming a hold into a booking, taking a deposit or promising anything to the customer stays a human act elsewhere.
 *
 * Refused when the customer already has a booking or hold, when the departure is not open, when fewer seats remain than asked,
 * or when the room type has no price. The price comes from the same Sales Engine loader every other screen uses, never from
 * the browser or a model.
 */

import { z } from "zod";

import type { CreateGroupBookingInput } from "@/app/(main)/departure-groups/types";
import { loadConversationPack, type ConversationContextPack } from "@/lib/agent/kernel/proposals/conversation-pack";
import type { ProposalExecutor } from "@/lib/agent/kernel/proposals/executor";
import {
  ConversationConversionPayloadSchema,
  conversionFingerprint,
  verifyConversionTarget,
} from "@/lib/agent/kernel/proposals/kinds/conversation-shared";
import { loadOfferCandidates } from "@/lib/copilot/sales/knowledge-context";
import { createGroupBooking } from "@/lib/data/departure-groups";
import { stampConversationSource } from "@/lib/inbox/conversions/source-link";
import type { LeadJourneyType } from "@/lib/types/leads";

const KIND = "CONVERSATION_SEAT_HOLD";

/** The most seats one hold may ask for from a conversation; a bigger party is booked in Departure Groups. */
export const MAX_SEATS_PER_HOLD = 20;

export const SeatHoldPayloadSchema = ConversationConversionPayloadSchema.extend({
  seats: z.number().int().min(1, "Hold at least one seat.").max(MAX_SEATS_PER_HOLD, `Hold at most ${MAX_SEATS_PER_HOLD} seats from a conversation.`),
});
export type SeatHoldPayload = z.infer<typeof SeatHoldPayloadSchema>;

type HoldRoom = "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE";
const HOLD_ROOMS: readonly HoldRoom[] = ["QUAD", "TRIPLE", "DOUBLE", "SINGLE"];

/** A lead that has not chosen a room falls back to the group's own default tier (TRIPLE), exactly as "Create booking" does. */
export function roomForHold(preference: string | null): HoldRoom {
  return HOLD_ROOMS.find((room) => room === preference) ?? "TRIPLE";
}

export const conversationSeatHoldExecutor: ProposalExecutor<SeatHoldPayload, ConversationContextPack> = {
  kind: KIND,
  module: "leads",
  subjectType: "CONVERSATION",
  schema: SeatHoldPayloadSchema,
  requiredCapability: "convertToBooking",
  risk: "MEDIUM",
  ttlHours: 12,
  loadPack: loadConversationPack,
  fingerprint: (payload) => conversionFingerprint(KIND, payload),
  // The group the seats come out of, and that the customer still has no booking: either moving supersedes the request.
  dependencySnapshot: (_payload, pack) => ({ departureGroupId: pack.facts.departureGroupId, bookingId: pack.facts.bookingId }),
  describe: (payload, pack) => ({
    humanDiff: [
      { field: "seats held", from: null, to: payload.seats },
      { field: "departure group", from: null, to: pack.facts.departureGroupName ?? "Selected group" },
      { field: "room type", from: null, to: roomForHold(pack.facts.leadRoomPreference).toLowerCase() },
      { field: "status", from: null, to: "Held — not a confirmed booking" },
    ],
  }),
  execute: async (payload, ctx) => {
    const target = await verifyConversionTarget(KIND, payload, ctx);
    if (!target.ok) return target;
    const { facts } = target;
    const groupId = facts.departureGroupId!;

    // The live offer for this group, read for THIS agency only.
    const journey = (facts.leadJourneyType ?? "UMRAH") as LeadJourneyType;
    const candidates = await loadOfferCandidates(ctx.db, journey, [groupId], { agencyId: ctx.agencyId });
    const candidate = candidates.find((item) => item.facts.groupId === groupId);
    if (!candidate || !candidate.internal.isSellable) return { ok: false, error: "That departure is not open for sale right now." };
    if (candidate.facts.availableSeats < payload.seats) {
      return { ok: false, error: `Only ${candidate.facts.availableSeats} seat(s) remain on ${candidate.facts.groupName}.` };
    }
    const room = roomForHold(facts.leadRoomPreference);
    const price = candidate.facts.occupancyPrices[room];
    if (typeof price !== "number") return { ok: false, error: `No price is set for a ${room.toLowerCase()} room on this departure.` };

    // The hold lasts as long as THIS group's own rule says.
    const { data: groupRow, error: groupError } = await ctx.db.from("departure_groups").select("seat_hold_expiry_hours").eq("agency_id", ctx.agencyId).eq("id", groupId).maybeSingle();
    if (groupError) return { ok: false, error: `Could not read the group's hold period: ${groupError.message}` };
    const holdHours = Number((groupRow as { seat_hold_expiry_hours?: number } | null)?.seat_hold_expiry_hours ?? 24) || 24;

    const input: CreateGroupBookingInput = {
      departureGroupId: groupId,
      leadId: facts.leadId,
      bookingReference: `LD-${(facts.leadReference ?? payload.conversationId.slice(0, 8)).replace(/^LD-/, "")}`,
      bookingStatus: "HELD",
      primaryContactName: facts.leadFullName ?? (facts.customerName || "Customer"),
      primaryContactPhone: facts.contactPhone ?? "",
      travellerCount: payload.seats,
      roomOccupancyPreference: room,
      packagePricePerPerson: price,
      amountPaid: 0,
      seatHoldExpiresAt: new Date(Date.now() + holdHours * 3_600_000).toISOString(),
    };

    const outcome = await createGroupBooking(input, {
      client: ctx.db,
      actor: { id: ctx.actor.id, name: ctx.actor.name, agencyId: ctx.agencyId },
      agencyId: ctx.agencyId,
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };

    // The hold exists from here on. Linking it to the lead and to the conversation is best effort and logged: failing the
    // request now would report a failure for seats that ARE held, and a retry could not hold them a second time.
    const bookingId = outcome.result.bookingId;
    const link = await ctx.db.from("leads").update({ booking_id: bookingId }).eq("agency_id", ctx.agencyId).eq("id", facts.leadId).is("booking_id", null);
    if (link.error) console.error("Could not link the seat hold to its lead:", link.error.message);
    await stampConversationSource(ctx.db, { agencyId: ctx.agencyId, table: "departure_group_bookings", by: { column: "id", value: bookingId }, conversationId: payload.conversationId, messageId: payload.sourceMessageId });
    return { ok: true };
  },
};
