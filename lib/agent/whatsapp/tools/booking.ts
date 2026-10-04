/**
 * Booking tools — §9 of docs/modules/whatsapp-ai-agent-implementation-plan.md.
 *
 * The model conducts the conversation; `booking_sessions` decides what step
 * is actually permitted next. Every write here rides the SAME
 * `createGroupBooking()` / `mutate()` unit of work the Departure Groups UI
 * already uses (D8) — no parallel booking path — and always lands on
 * `bookingStatus: "HELD"`. Confirming a hold into a real booking (deposit,
 * `CONFIRMED`) stays a human act in Departure Groups; the agent's write
 * access ends the moment a seat is held.
 */

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

import { COPILOT_NAME } from "@/lib/agent/identity";
import { resolveBookingContactPhone } from "@/lib/agent/whatsapp/contact-number";
import type { AgentContext } from "@/lib/agent/whatsapp/context";
import { canHoldSeats, getSellableGroupForAi } from "@/lib/data/departure-groups-ai";
import { createGroupBooking } from "@/lib/data/departure-groups";
import type { CreateGroupBookingInput } from "@/app/(main)/departure-groups/types";
import type { GroupActor, RoomType } from "@/lib/types/departure-groups";

/**
 * `agencyId` has to come from the calling context, not a module-level
 * constant — the admin client this actor writes with has no session for
 * Postgres's own `agency_id default current_agency_id()` to fall back on, so
 * `persistStore()` (departure-groups-repository.ts) depends on this value to
 * stamp every row the booking creates.
 */
function aiActor(ctx: AgentContext): GroupActor {
  return { id: null, name: COPILOT_NAME, agencyId: ctx.agencyId };
}

interface BookingSessionRow {
  id: string;
  conversation_id: string;
  lead_id: string | null;
  departure_group_id: string | null;
  current_step: string;
  travellers: number | null;
  room_preference: string | null;
  collected: { travellers?: Array<Record<string, unknown>> };
  status: string;
}

interface AiSettingsFlags {
  booking_enabled: boolean;
  seat_hold_hours: number;
}

async function loadAiSettings(ctx: AgentContext): Promise<AiSettingsFlags> {
  const { data } = await ctx.db
    .from("ai_settings")
    .select("booking_enabled, seat_hold_hours")
    .eq("agency_id", ctx.agencyId)
    .maybeSingle();
  return (data as AiSettingsFlags | null) ?? { booking_enabled: false, seat_hold_hours: 24 };
}

async function loadActiveSession(ctx: AgentContext): Promise<BookingSessionRow | null> {
  const { data } = await ctx.db
    .from("booking_sessions")
    .select("*")
    .eq("conversation_id", ctx.conversationId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  return (data as BookingSessionRow | null) ?? null;
}

/** First unused `${groupCode}-BK###` reference for this agency's bookings on this group. */
async function nextBookingReferenceForAgency(ctx: AgentContext, groupCode: string): Promise<string> {
  const { data, error } = await ctx.db
    .from("departure_group_bookings")
    .select("booking_reference")
    .eq("agency_id", ctx.agencyId)
    .like("booking_reference", `${groupCode}-BK%`);
  if (error) throw new Error(`Failed to read booking references: ${error.message}`);

  const highest = ((data ?? []) as { booking_reference: string }[]).reduce((max, row) => {
    const parsed = Number.parseInt(row.booking_reference.slice(`${groupCode}-BK`.length), 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);

  return `${groupCode}-BK${String(highest + 1).padStart(3, "0")}`;
}

export function createBookingTools(ctx: AgentContext) {
  const startBooking = betaTool({
    name: "start_booking",
    description:
      "Begins a booking for a specific departure group and party size. Call this only after the customer " +
      "has clearly said they want to book (not just asked about a trip) and you know which groupId and how " +
      "many travellers. Fails if a booking is already in progress on this conversation, or if the group " +
      "cannot hold that many seats right now.",
    inputSchema: {
      type: "object",
      properties: {
        groupId: { type: "string" },
        travellers: { type: "integer", minimum: 1 },
      },
      required: ["groupId", "travellers"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const settings = await loadAiSettings(ctx);
      if (!settings.booking_enabled) {
        return JSON.stringify({ error: "Booking is not enabled for this agency. Offer to have a staff member follow up instead." });
      }

      const existing = await loadActiveSession(ctx);
      if (existing) {
        return JSON.stringify({
          error: "A booking is already in progress on this conversation.",
          sessionId: existing.id,
          currentStep: existing.current_step,
        });
      }

      const check = await canHoldSeats(args.groupId, args.travellers, ctx.db);
      if (!check.ok) return JSON.stringify({ error: check.reason });

      const { data: session, error } = await ctx.db
        .from("booking_sessions")
        .insert({
          agency_id: ctx.agencyId,
          conversation_id: ctx.conversationId,
          lead_id: ctx.leadId,
          departure_group_id: args.groupId,
          current_step: "COLLECT_LEAD",
          travellers: args.travellers,
          collected: {},
        })
        .select("id, current_step")
        .single();
      if (error) throw new Error(`Failed to start booking: ${error.message}`);

      return JSON.stringify({
        ok: true,
        sessionId: (session as { id: string }).id,
        currentStep: (session as { current_step: string }).current_step,
        next: "Make sure a lead exists for this customer (find_or_create_lead), then collect each traveller's details with record_traveller.",
      });
    },
  });

  const recordTraveller = betaTool({
    name: "record_traveller",
    description:
      "Records one traveller's details on the active booking. Call once per traveller, index 0 first " +
      "(the primary contact). Safe to call again for the same index to correct a detail.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        index: { type: "integer", minimum: 0 },
        fullName: { type: "string" },
        phone: { type: "string", description: "Only needed for the primary contact (index 0) if different from their WhatsApp number." },
        passportNumber: { type: "string" },
        roomPreference: { type: "string", enum: ["QUAD", "TRIPLE", "DOUBLE", "SINGLE"] },
      },
      required: ["sessionId", "index", "fullName"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const { data: session, error: loadError } = await ctx.db
        .from("booking_sessions")
        .select("*")
        .eq("id", args.sessionId)
        .eq("agency_id", ctx.agencyId)
        .eq("status", "ACTIVE")
        .maybeSingle();
      if (loadError || !session) return JSON.stringify({ error: "No active booking session found." });

      const row = session as BookingSessionRow;
      const travellers = [...(row.collected.travellers ?? [])];
      travellers[args.index] = {
        fullName: args.fullName,
        phone: args.phone ?? null,
        passportNumber: args.passportNumber ?? null,
      };

      const patch: Record<string, unknown> = {
        collected: { ...row.collected, travellers },
        current_step: row.current_step === "COLLECT_LEAD" ? "COLLECT_TRAVELLERS" : row.current_step,
      };
      if (args.roomPreference) patch.room_preference = args.roomPreference;

      const { error } = await ctx.db.from("booking_sessions").update(patch).eq("id", args.sessionId);
      if (error) throw new Error(`Failed to record traveller: ${error.message}`);

      const collectedCount = travellers.filter(Boolean).length;
      return JSON.stringify({
        ok: true,
        collectedCount,
        travellersNeeded: row.travellers,
        allCollected: row.travellers != null && collectedCount >= row.travellers,
      });
    },
  });

  const reviewBooking = betaTool({
    name: "review_booking",
    description:
      "Builds the booking summary — price, dates, room type, total — from live CRM data, once every " +
      "traveller has been recorded. Read this summary back to the customer verbatim before asking them to " +
      "confirm; do not restate the numbers from memory.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const { data: session, error: loadError } = await ctx.db
        .from("booking_sessions")
        .select("*")
        .eq("id", args.sessionId)
        .eq("agency_id", ctx.agencyId)
        .eq("status", "ACTIVE")
        .maybeSingle();
      if (loadError || !session) return JSON.stringify({ error: "No active booking session found." });

      const row = session as BookingSessionRow;
      if (!row.departure_group_id || !row.travellers) {
        return JSON.stringify({ error: "Booking session is missing a departure group or traveller count." });
      }

      const group = await getSellableGroupForAi(row.departure_group_id, row.travellers, ctx.db);
      if (!group) return JSON.stringify({ error: "That departure is no longer available for booking." });

      const roomType = (row.room_preference as RoomType | null) ?? "QUAD";
      const option = group.occupancyOptions.find((o) => o.roomType === roomType) ?? group.occupancyOptions[0];
      if (!option) return JSON.stringify({ error: "No price is set for this departure yet — a staff member needs to set pricing first." });

      const totalPrice = option.pricePerPerson * row.travellers;

      await ctx.db.from("booking_sessions").update({ current_step: "REVIEW" }).eq("id", args.sessionId);

      return JSON.stringify({
        groupName: group.groupName,
        departureDate: group.departureDate,
        returnDate: group.returnDate,
        durationLabel: group.durationLabel,
        travellers: row.travellers,
        roomType: option.roomType,
        pricePerPerson: option.pricePerPerson,
        totalPrice,
        currency: group.currency,
        advanceDeposit: group.advanceDeposit,
        travellersRecorded: row.collected.travellers?.filter(Boolean).length ?? 0,
      });
    },
  });

  const confirmAndHoldBooking = betaTool({
    name: "confirm_and_hold_booking",
    description:
      "Creates the booking as a seat HOLD, only after review_booking has been shown to the customer and " +
      "they have clearly said yes. Pass their exact confirming words in confirmationText — do not paraphrase " +
      "them. This does not confirm the booking or take payment; a staff member does that next.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        confirmationText: { type: "string", description: "The customer's own words confirming the booking." },
      },
      required: ["sessionId", "confirmationText"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      if (!args.confirmationText.trim()) {
        return JSON.stringify({ error: "confirmationText is required — quote what the customer actually said." });
      }

      const { data: session, error: loadError } = await ctx.db
        .from("booking_sessions")
        .select("*")
        .eq("id", args.sessionId)
        .eq("agency_id", ctx.agencyId)
        .eq("status", "ACTIVE")
        .maybeSingle();
      if (loadError || !session) return JSON.stringify({ error: "No active booking session found." });

      const row = session as BookingSessionRow;
      if (row.current_step !== "REVIEW") {
        return JSON.stringify({ error: "Call review_booking and show the customer the summary before confirming." });
      }
      if (!row.departure_group_id || !row.travellers) {
        return JSON.stringify({ error: "Booking session is incomplete." });
      }

      // Re-checked at the last possible moment — availability can have
      // changed between review_booking and this confirmation.
      const check = await canHoldSeats(row.departure_group_id, row.travellers, ctx.db);
      if (!check.ok) return JSON.stringify({ error: check.reason });

      const group = await getSellableGroupForAi(row.departure_group_id, row.travellers, ctx.db);
      if (!group) return JSON.stringify({ error: "That departure is no longer available for booking." });

      const roomType = (row.room_preference as RoomType | null) ?? "QUAD";
      const option = group.occupancyOptions.find((o) => o.roomType === roomType) ?? group.occupancyOptions[0];
      if (!option) return JSON.stringify({ error: "No price is set for this departure." });

      const settings = await loadAiSettings(ctx);
      const primary = row.collected.travellers?.[0] as { fullName?: string; phone?: string } | undefined;

      const { data: conversation } = await ctx.db
        .from("conversations")
        .select("contact_phone, contact_name")
        .eq("id", ctx.conversationId)
        .single();
      const conv = conversation as { contact_phone: string; contact_name: string } | null;

      // A held booking needs a number staff can call. WhatsApp always has one; Messenger and Instagram have none
      // until the customer gives it, so ask first rather than hold seats for someone nobody can reach.
      const contactPhone = await resolveBookingContactPhone(ctx, {
        travellerPhone: primary?.phone,
        conversationPhone: conv?.contact_phone,
        leadId: row.lead_id,
      });
      if (!contactPhone) {
        return JSON.stringify({
          error:
            "A phone number is required before seats can be held. Ask the customer for the best number to reach them on and record it with capture_contact_number, then confirm again — or hand the conversation to staff if they would rather not share one.",
        });
      }

      const bookingReference = await nextBookingReferenceForAgency(ctx, group.groupCode);
      const seatHoldExpiresAt = new Date(Date.now() + settings.seat_hold_hours * 60 * 60 * 1000).toISOString();

      const input: CreateGroupBookingInput = {
        departureGroupId: row.departure_group_id,
        leadId: row.lead_id,
        bookingReference,
        bookingStatus: "HELD",
        primaryContactName: primary?.fullName || conv?.contact_name || `${ctx.profile.displayName} customer`,
        primaryContactPhone: contactPhone,
        travellerCount: row.travellers,
        roomOccupancyPreference: option.roomType,
        packagePricePerPerson: option.pricePerPerson,
        amountPaid: 0,
        seatHoldExpiresAt,
        travellers: (row.collected.travellers ?? []).map((t) => ({
          fullName: (t as { fullName?: string }).fullName ?? "",
          phone: (t as { phone?: string }).phone ?? "",
          passportNumber: (t as { passportNumber?: string }).passportNumber ?? undefined,
        })),
      };

      const outcome = await createGroupBooking(input, { client: ctx.db, actor: aiActor(ctx), agencyId: ctx.agencyId });
      if (!outcome.ok) return JSON.stringify({ error: outcome.error });

      await ctx.db
        .from("booking_sessions")
        .update({
          current_step: "CREATED",
          status: "CREATED",
          confirmation_text: args.confirmationText,
          booking_id: outcome.result.bookingId,
        })
        .eq("id", args.sessionId);

      if (row.lead_id) {
        await ctx.db.from("leads").update({ booking_id: outcome.result.bookingId }).eq("id", row.lead_id);
      }

      return JSON.stringify({
        ok: true,
        bookingReference: outcome.result.bookingReference,
        seatHoldExpiresAt,
        note: "Seats are HELD, not confirmed. Tell the customer their seats are held until the hold expiry, and a staff member will confirm and follow up about payment.",
      });
    },
  });

  const getBookingStatus = betaTool({
    name: "get_booking_status",
    description: "Reads the current step and collected details of the active (or most recent) booking on this conversation.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } as const,
    run: async () => {
      const { data } = await ctx.db
        .from("booking_sessions")
        .select("id, current_step, status, travellers, room_preference, collected, booking_id")
        .eq("conversation_id", ctx.conversationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return JSON.stringify({ status: "NONE" });

      // `collected.travellers[].passportNumber` is camelCase and would slip
      // past the registry's snake_case FORBIDDEN_KEYS filter — summarized
      // here instead of returning the raw row, so a passport number never
      // re-enters the model's context once recorded.
      const row = data as BookingSessionRow & { status: string; booking_id: string | null };
      const travellerNames = (row.collected.travellers ?? [])
        .filter(Boolean)
        .map((t) => (t as { fullName?: string }).fullName ?? "(unnamed)");

      return JSON.stringify({
        id: row.id,
        currentStep: row.current_step,
        status: row.status,
        travellersNeeded: row.travellers,
        roomPreference: row.room_preference,
        travellersRecorded: travellerNames,
        bookingId: row.booking_id,
      });
    },
  });

  return [startBooking, recordTraveller, reviewBooking, confirmAndHoldBooking, getBookingStatus];
}
