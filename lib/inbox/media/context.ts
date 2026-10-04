import "server-only";

import type { Db } from "@/lib/ai/db";

export interface MediaContextTraveller {
  id: string;
  fullName: string;
  passportNumber: string | null;
}

export interface InboxMediaContext {
  leadId: string | null;
  bookingId: string | null;
  travellers: MediaContextTraveller[];
  departureDate: string | null;
  /** The departure group the chat is linked to through its booking or its selected group; always from the caller's agency. */
  departureGroupId: string | null;
  passportValidityMonths: number;
}

const DEFAULT_PASSPORT_VALIDITY_MONTHS = 6;

/** Loads every fact used to review one attachment, always constrained to its agency. */
export async function loadInboxMediaContext(db: Db, input: { agencyId: string; conversationId: string }): Promise<InboxMediaContext> {
  const { data: conversation, error: conversationError } = await db
    .from("conversations")
    .select("lead_id")
    .eq("agency_id", input.agencyId)
    .eq("id", input.conversationId)
    .maybeSingle();
  if (conversationError) throw new Error(`Could not read the attachment conversation: ${conversationError.message}`);

  const leadId = (conversation as { lead_id?: string | null } | null)?.lead_id ?? null;
  const [{ data: lead, error: leadError }, { data: settings, error: settingsError }] = await Promise.all([
    leadId
      ? db.from("leads").select("booking_id,selected_departure_group_id").eq("agency_id", input.agencyId).eq("id", leadId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("agency_settings").select("passport_validity_months").eq("agency_id", input.agencyId).maybeSingle(),
  ]);
  if (leadError) throw new Error(`Could not read the attachment lead: ${leadError.message}`);
  if (settingsError) throw new Error(`Could not read passport validity settings: ${settingsError.message}`);

  const leadRow = lead as { booking_id?: string | null; selected_departure_group_id?: string | null } | null;
  const bookingId = leadRow?.booking_id ?? null;
  const [{ data: booking, error: bookingError }, { data: travellerRows, error: travellerError }] = await Promise.all([
    bookingId
      ? db.from("departure_group_bookings").select("departure_group_id").eq("agency_id", input.agencyId).eq("id", bookingId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    bookingId
      ? db.from("departure_group_pilgrims").select("id,full_name_snapshot,passport_number_snapshot").eq("agency_id", input.agencyId).eq("booking_id", bookingId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (bookingError) throw new Error(`Could not read the attachment booking: ${bookingError.message}`);
  if (travellerError) throw new Error(`Could not read booking travellers: ${travellerError.message}`);

  const bookingGroupId = (booking as { departure_group_id?: string | null } | null)?.departure_group_id ?? null;
  const groupIds = [...new Set([bookingGroupId, leadRow?.selected_departure_group_id ?? null].filter((id): id is string => Boolean(id)))];
  const { data: groups, error: groupError } = groupIds.length > 0
    ? await db.from("departure_groups").select("id,departure_date").eq("agency_id", input.agencyId).in("id", groupIds)
    : { data: [], error: null };
  if (groupError) throw new Error(`Could not read the attachment departure: ${groupError.message}`);
  const departureById = new Map(((groups ?? []) as Array<{ id: string; departure_date: string | null }>).map((group) => [group.id, group.departure_date]));

  const linkedGroupId = [bookingGroupId, leadRow?.selected_departure_group_id ?? null].find((id): id is string => Boolean(id) && departureById.has(id as string)) ?? null;
  return {
    leadId,
    bookingId,
    travellers: ((travellerRows ?? []) as Array<{ id: string; full_name_snapshot: string; passport_number_snapshot: string | null }>).map((traveller) => ({
      id: traveller.id,
      fullName: traveller.full_name_snapshot,
      passportNumber: traveller.passport_number_snapshot,
    })),
    departureGroupId: linkedGroupId,
    departureDate: departureById.get(bookingGroupId ?? "") ?? departureById.get(leadRow?.selected_departure_group_id ?? "") ?? null,
    passportValidityMonths: Number((settings as { passport_validity_months?: number | null } | null)?.passport_validity_months ?? DEFAULT_PASSPORT_VALIDITY_MONTHS),
  };
}
