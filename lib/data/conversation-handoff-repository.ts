import "server-only";

import type { Db } from "@/lib/ai/db";
import { buildConversationHandoff, type DeterministicHandoff } from "@/lib/inbox/handoff/build";

export interface ConversationHandoffRecord extends DeterministicHandoff {
  id: string;
  conversationId: string;
  bookingId: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  customerExpectations: {
    items?: string[];
    source?: "RULES" | "LLM";
    confidence?: number;
    note?: string | null;
  };
  sentiment: string | null;
}

type BookingRow = {
  id: string;
  booking_reference: string;
  currency: string | null;
  outstanding_balance: number | null;
  departure_group_id: string;
  departure_groups: unknown;
};
const BOOKING_COLUMNS = "id, booking_reference, currency, outstanding_balance, departure_group_id, departure_groups(group_name, departure_date, return_date)";

/**
 * The confirmed booking this conversation's lead was converted into. The lead's own `booking_id` wins; only when it is
 * absent or not confirmed does the most recent confirmed booking of the lead stand in.
 */
async function findConfirmedBookingForLead(db: Db, agencyId: string, leadId: string): Promise<BookingRow | null> {
  const { data: lead, error: leadError } = await db.from("leads").select("booking_id").eq("agency_id", agencyId).eq("id", leadId).maybeSingle();
  if (leadError) throw new Error(`Could not read the lead: ${leadError.message}`);
  const linkedId = (lead as { booking_id: string | null } | null)?.booking_id ?? null;
  if (linkedId) {
    const { data, error } = await db.from("departure_group_bookings").select(BOOKING_COLUMNS).eq("agency_id", agencyId).eq("id", linkedId).eq("booking_status", "CONFIRMED").maybeSingle();
    if (error) throw new Error(`Could not read the confirmed booking: ${error.message}`);
    if (data) return data as unknown as BookingRow;
  }
  const { data, error } = await db.from("departure_group_bookings").select(BOOKING_COLUMNS).eq("agency_id", agencyId).eq("lead_id", leadId).eq("booking_status", "CONFIRMED").order("booked_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not read the confirmed booking: ${error.message}`);
  return (data as unknown as BookingRow | null) ?? null;
}

/** Loads only the operational facts needed to make a booking handoff. */
export async function buildHandoffForConversation(db: Db, agencyId: string, conversationId: string): Promise<{ bookingId: string; handoff: DeterministicHandoff; customerMessages: string[] } | null> {
  const { data: conversation, error: conversationError } = await db
    .from("conversations")
    .select("contact_name, contact_phone, lead_id")
    .eq("agency_id", agencyId)
    .eq("id", conversationId)
    .maybeSingle();
  if (conversationError) throw new Error(`Could not read the conversation: ${conversationError.message}`);
  if (!conversation || !conversation.lead_id) return null;
  const booking = await findConfirmedBookingForLead(db, agencyId, conversation.lead_id as string);
  if (!booking) return null;

  // Documents belong to individual travellers: only THIS booking's travellers count, never the rest of the group.
  const { data: travellers, error: travellerError } = await db.from("departure_group_pilgrims").select("id").eq("agency_id", agencyId).eq("booking_id", booking.id);
  if (travellerError) throw new Error(`Could not read the booking's travellers: ${travellerError.message}`);
  const travellerIds = ((travellers ?? []) as Array<{ id: string }>).map((row) => row.id);

  const [intelligence, readiness, documents, messages] = await Promise.all([
    db.from("conversation_intelligence").select("commercial_stage").eq("agency_id", agencyId).eq("conversation_id", conversationId).maybeSingle(),
    db.from("departure_group_readiness_items").select("label, status, required").eq("agency_id", agencyId).eq("departure_group_id", booking.departure_group_id),
    travellerIds.length > 0
      ? db.from("departure_group_pilgrim_documents").select("name, status, required").eq("agency_id", agencyId).eq("departure_group_id", booking.departure_group_id).in("pilgrim_id", travellerIds)
      : Promise.resolve({ data: [], error: null }),
    db.from("conversation_messages").select("content, created_at").eq("agency_id", agencyId).eq("conversation_id", conversationId).eq("direction", "INBOUND").order("created_at", { ascending: false }).limit(20),
  ]);
  if (intelligence.error) throw new Error(`Could not read commercial status: ${intelligence.error.message}`);
  if (readiness.error) throw new Error(`Could not read readiness items: ${readiness.error.message}`);
  if (documents.error) throw new Error(`Could not read pilgrim documents: ${documents.error.message}`);
  if (messages.error) throw new Error(`Could not read customer messages: ${messages.error.message}`);
  const group = (Array.isArray(booking.departure_groups) ? booking.departure_groups[0] : booking.departure_groups) as { group_name: string; departure_date: string | null; return_date: string | null } | null;
  const handoff = buildConversationHandoff({
    customer: { name: conversation.contact_name as string, phone: conversation.contact_phone as string | null },
    booking: { id: booking.id, reference: booking.booking_reference, currency: booking.currency ?? "LKR", outstandingBalance: Number(booking.outstanding_balance ?? 0) },
    selection: { groupName: group?.group_name ?? "Selected departure", departureDate: group?.departure_date ?? null, returnDate: group?.return_date ?? null },
    commercialStage: (intelligence.data as { commercial_stage: string | null } | null)?.commercial_stage ?? null,
    readiness: (readiness.data ?? []) as Array<{ label: string; status: string; required: boolean }>,
    documents: (documents.data ?? []) as Array<{ name: string; status: string; required: boolean }>,
  });
  const customerMessages = ((messages.data ?? []) as Array<{ content: string | null }>).map((message) => message.content?.trim()).filter((message): message is string => Boolean(message)).reverse();
  return { bookingId: booking.id, handoff, customerMessages };
}

export interface CreateConversationHandoffInput {
  agencyId: string;
  conversationId: string;
  bookingId: string;
  createdBy: string;
  handoff: DeterministicHandoff;
  customerExpectations?: Record<string, unknown>;
  sentiment?: string | null;
}

/** One handoff per booking. A repeat call — or a lost race with a second click — returns the stored one with `created: false`. */
export async function createConversationHandoff(db: Db, input: CreateConversationHandoffInput): Promise<{ record: ConversationHandoffRecord; created: boolean }> {
  const readExisting = async () => {
    const existing = await db.from("conversation_handoffs").select("*").eq("agency_id", input.agencyId).eq("booking_id", input.bookingId).maybeSingle();
    if (existing.error) throw new Error(`Could not check the existing handoff: ${existing.error.message}`);
    return existing.data ? mapHandoff(existing.data as Record<string, unknown>) : null;
  };
  const before = await readExisting();
  if (before) return { record: before, created: false };

  const { data, error } = await db.from("conversation_handoffs").insert({
    agency_id: input.agencyId, conversation_id: input.conversationId, booking_id: input.bookingId,
    created_by: input.createdBy, summary: input.handoff.summary, open_items: input.handoff.openItems,
    customer_expectations: input.customerExpectations ?? {}, sentiment: input.sentiment ?? null,
  }).select("*").single();
  if (error?.code === "23505") {
    const winner = await readExisting();
    if (winner) return { record: winner, created: false };
  }
  if (error || !data) throw new Error(`Could not save the handoff: ${error?.message ?? "no row returned"}`);
  return { record: mapHandoff(data as Record<string, unknown>), created: true };
}

/** True when a stored handoff still has no customer expectations and nobody has acknowledged it — so a later narration may fill them in. */
export function handoffNeedsNarration(record: ConversationHandoffRecord): boolean {
  return record.acknowledgedAt === null && !(record.customerExpectations.items && record.customerExpectations.items.length > 0);
}

/**
 * Fills in the prose half of an unacknowledged handoff whose narration was unavailable when it was created (the surface
 * was off, or the model failed). Runs on the trusted client after the caller's role check. It touches only the
 * expectations and sentiment — never the facts (`summary`, `open_items`) — and only while nobody has acknowledged it.
 */
export async function attachHandoffNarration(db: Db, input: { agencyId: string; handoffId: string; customerExpectations: Record<string, unknown>; sentiment: string | null }): Promise<ConversationHandoffRecord | null> {
  const current = await db.from("conversation_handoffs").select("*").eq("agency_id", input.agencyId).eq("id", input.handoffId).maybeSingle();
  if (current.error) throw new Error(`Could not read the handoff: ${current.error.message}`);
  if (!current.data || !handoffNeedsNarration(mapHandoff(current.data as Record<string, unknown>))) return null;
  const { data, error } = await db.from("conversation_handoffs")
    .update({ customer_expectations: input.customerExpectations, sentiment: input.sentiment })
    .eq("agency_id", input.agencyId).eq("id", input.handoffId).is("acknowledged_at", null)
    .select("*").maybeSingle();
  if (error) throw new Error(`Could not add the handoff narration: ${error.message}`);
  return data ? mapHandoff(data as Record<string, unknown>) : null;
}

/** The handoff already made for a conversation (newest first), so the Inbox can show it instead of offering to make another. */
export async function loadConversationHandoff(db: Db, agencyId: string, conversationId: string): Promise<ConversationHandoffRecord | null> {
  const { data, error } = await db.from("conversation_handoffs").select("*").eq("agency_id", agencyId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not read the conversation's handoff: ${error.message}`);
  return data ? mapHandoff(data as Record<string, unknown>) : null;
}

export async function acknowledgeConversationHandoff(db: Db, agencyId: string, handoffId: string, staffId: string): Promise<void> {
  const { data, error } = await db.from("conversation_handoffs").update({ acknowledged_by: staffId, acknowledged_at: new Date().toISOString() }).eq("agency_id", agencyId).eq("id", handoffId).is("acknowledged_at", null).select("id").maybeSingle();
  if (error) throw new Error(`Could not acknowledge the handoff: ${error.message}`);
  if (!data) throw new Error("Could not acknowledge the handoff because it is missing or already acknowledged.");
}

export async function listUnacknowledgedConversationHandoffs(db: Db, agencyId: string): Promise<ConversationHandoffRecord[]> {
  const { data, error } = await db.from("conversation_handoffs").select("*").eq("agency_id", agencyId).is("acknowledged_at", null).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(`Could not read unacknowledged handoffs: ${error.message}`);
  return (data ?? []).map((row) => mapHandoff(row as Record<string, unknown>));
}

function mapHandoff(row: Record<string, unknown>): ConversationHandoffRecord {
  return { id: String(row.id), conversationId: String(row.conversation_id), bookingId: String(row.booking_id), summary: (row.summary ?? {}) as Record<string, unknown>, openItems: (row.open_items ?? []) as DeterministicHandoff["openItems"], customerExpectations: (row.customer_expectations ?? {}) as ConversationHandoffRecord["customerExpectations"], sentiment: row.sentiment as string | null, createdAt: String(row.created_at), acknowledgedAt: row.acknowledged_at as string | null, acknowledgedBy: row.acknowledged_by as string | null };
}
