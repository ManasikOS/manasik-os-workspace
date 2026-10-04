/**
 * The choices offered for a conversion that needs a decision (MI4.6): which traveller, which package, how many seats, which
 * survey. Read on the trusted client, so every query names the agency and only ever offers this agency's own records.
 */

import "server-only";

import type { Db } from "@/lib/agent/kernel/proposals/context-pack";
import type { ConversationPackFacts } from "@/lib/agent/kernel/proposals/conversation-pack";
import { MAX_SEATS_PER_HOLD } from "@/lib/agent/kernel/proposals/kinds/conversation-seat-hold";
import { PACKAGE_OPEN_STATUS } from "@/lib/agent/kernel/proposals/kinds/conversation-recommendation";
import { TRAVELLER_RELATIONSHIPS } from "@/lib/agent/kernel/proposals/kinds/conversation-profile";
import type { ConversionFieldChoices, ConversionKind } from "@/lib/inbox/conversions/catalogue";

type Row = Record<string, unknown>;

const RELATIONSHIP_LABELS: Record<(typeof TRAVELLER_RELATIONSHIPS)[number], string> = {
  MAHRAM: "mahram",
  SPOUSE: "spouse",
  PARENT: "parent",
  CHILD: "child",
  SIBLING: "sibling",
  COMPANION: "travelling companion",
  OTHER: "other relative",
};

/** How many options one list offers; a longer list is a search problem, not a menu. */
const MAX_OPTIONS = 50;

function failed(what: string, error: { message: string }): never {
  throw new Error(`Could not read ${what}: ${error.message}`);
}

export async function loadConversionChoices(db: Db, agencyId: string, facts: ConversationPackFacts, kind: ConversionKind): Promise<ConversionFieldChoices[]> {
  switch (kind) {
    case "CONVERSATION_TRAVELLER_RELATIONSHIP": {
      const { data, error } = await db.from("departure_group_pilgrims").select("id, full_name_snapshot").eq("agency_id", agencyId).eq("booking_id", facts.bookingId).limit(MAX_OPTIONS);
      if (error) failed("the booking's travellers", error);
      const travellers = ((data ?? []) as Row[]).map((row, index) => ({ value: String(row.id), label: String(row.full_name_snapshot ?? "").trim() || `Traveller ${index + 1}` }));
      return [
        { name: "fromTravellerId", options: travellers },
        { name: "relationship", options: TRAVELLER_RELATIONSHIPS.map((value) => ({ value, label: RELATIONSHIP_LABELS[value] })) },
        { name: "toTravellerId", options: travellers },
        { name: "isMahram", defaultValue: false },
      ];
    }
    case "CONVERSATION_SEAT_HOLD": {
      const { data, error } = await db.from("departure_groups").select("available_seats").eq("agency_id", agencyId).eq("id", facts.departureGroupId).maybeSingle();
      if (error) failed("the departure group's seats", error);
      const available = Math.max(0, Number((data as Row | null)?.available_seats ?? 0));
      const max = Math.min(MAX_SEATS_PER_HOLD, available);
      return [{ name: "seats", min: 1, max, defaultValue: Math.min(Math.max(1, facts.leadPartySize), Math.max(1, max)) }];
    }
    case "CONVERSATION_PACKAGE_RECOMMENDATION": {
      const { data, error } = await db.from("packages").select("id, title, internal_code").eq("agency_id", agencyId).eq("status", PACKAGE_OPEN_STATUS).order("title", { ascending: true }).limit(MAX_OPTIONS);
      if (error) failed("the open packages", error);
      const options = ((data ?? []) as Row[]).map((row) => ({ value: String(row.id), label: [String(row.title ?? "Package"), row.internal_code ? `(${String(row.internal_code)})` : ""].filter(Boolean).join(" ") }));
      return [{ name: "packageId", options }];
    }
    case "CONVERSATION_FEEDBACK_REQUEST": {
      const { data, error } = await db.from("surveys").select("id, title").eq("agency_id", agencyId).eq("is_active", true).order("created_at", { ascending: false }).limit(MAX_OPTIONS);
      if (error) failed("the active surveys", error);
      return [{ name: "surveyId", options: ((data ?? []) as Row[]).map((row) => ({ value: String(row.id), label: String(row.title) })) }];
    }
    default:
      return [];
  }
}
