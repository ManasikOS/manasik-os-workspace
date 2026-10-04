/**
 * Context Pack loader for `subjectType: "CONVERSATION"` — MI4.6. Backs every proposal kind in `kinds/conversation-*.ts`.
 *
 * It reads the conversation, the lead it is linked to, that lead's booking and travellers, whether the customer already has a
 * traveller profile, and the customer's latest message. Every query names the agency: the pack is read on the trusted client,
 * which RLS does not filter. The group, booking and traveller are always re-read here, never taken from a proposal's payload, so
 * an approval acts on what is true now, and each kind's dependency hash supersedes a proposal whose facts moved. The source
 * message is deliberately NOT part of any hash: a customer writing again while staff review the request must not void it.
 */

import "server-only";

import { hashObject } from "@/lib/agent/kernel/hash";
import { buildContextPack, type ContextPack, type Db } from "@/lib/agent/kernel/proposals/context-pack";
import type { ConversationConversionFacts } from "@/lib/inbox/conversions/catalogue";

export interface ConversationPackFacts extends ConversationConversionFacts {
  conversationId: string;
  customerName: string;
  leadReference: string | null;
  leadFullName: string | null;
  /** The number staff can reach the customer on: the lead's, else the conversation's. */
  contactPhone: string | null;
  leadEmail: string | null;
  leadJourneyType: string | null;
  leadRoomPreference: string | null;
  /** Adults + children on the lead; the default size of a seat hold. */
  leadPartySize: number;
}

export type ConversationContextPack = ContextPack<ConversationPackFacts>;

type Row = Record<string, unknown>;

function failed(what: string, error: { message: string }): never {
  throw new Error(`Could not read ${what}: ${error.message}`);
}

/**
 * The message a newly created object points back at: the customer's latest, or — in a conversation the staff started, where
 * the customer has not written — the latest message of any kind. Null when the conversation has no messages at all.
 */
export async function findSourceMessageId(db: Db, agencyId: string, conversationId: string): Promise<string | null> {
  const inbound = await db.from("conversation_messages").select("id").eq("agency_id", agencyId).eq("conversation_id", conversationId).eq("direction", "INBOUND").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (inbound.error) failed("the customer's latest message", inbound.error);
  const inboundId = ((inbound.data as Row | null)?.id as string | undefined) ?? null;
  if (inboundId) return inboundId;
  const any = await db.from("conversation_messages").select("id").eq("agency_id", agencyId).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (any.error) failed("the latest message", any.error);
  return ((any.data as Row | null)?.id as string | undefined) ?? null;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** The facts a conversion is judged and executed against. Null when the conversation is not in this agency. */
export async function loadConversationConversionFacts(db: Db, agencyId: string, conversationId: string): Promise<ConversationPackFacts | null> {
  const { data: conversation, error } = await db
    .from("conversations")
    .select("id, contact_name, contact_phone, lead_id")
    .eq("agency_id", agencyId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) failed("the conversation", error);
  if (!conversation) return null;
  const convo = conversation as Row;

  const sourceMessageId = await findSourceMessageId(db, agencyId, conversationId);

  const leadId = (convo.lead_id as string | null) ?? null;
  let leadReference: string | null = null;
  let leadFullName: string | null = null;
  let leadMobile: string | null = null;
  let leadEmail: string | null = null;
  let leadJourneyType: string | null = null;
  let leadRoomPreference: string | null = null;
  let leadPartySize = 1;
  let bookingId: string | null = null;
  let departureGroupId: string | null = null;
  if (leadId) {
    const { data: lead, error: leadError } = await db
      .from("leads")
      .select("reference, full_name, mobile, email, journey_type, room_preference, adults, children, booking_id, selected_departure_group_id")
      .eq("agency_id", agencyId)
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) failed("the lead", leadError);
    const leadRow = (lead as Row | null) ?? null;
    leadReference = text(leadRow?.reference);
    leadFullName = text(leadRow?.full_name);
    leadMobile = text(leadRow?.mobile);
    leadEmail = text(leadRow?.email);
    leadJourneyType = text(leadRow?.journey_type);
    leadRoomPreference = text(leadRow?.room_preference);
    leadPartySize = Math.max(1, Number(leadRow?.adults ?? 0) + Number(leadRow?.children ?? 0));
    bookingId = (leadRow?.booking_id as string | null | undefined) ?? null;
    departureGroupId = (leadRow?.selected_departure_group_id as string | null | undefined) ?? null;
  }

  let pilgrimId: string | null = null;
  let travellerCount = 0;
  if (bookingId) {
    const { data: booking, error: bookingError } = await db.from("departure_group_bookings").select("departure_group_id").eq("agency_id", agencyId).eq("id", bookingId).maybeSingle();
    if (bookingError) failed("the booking", bookingError);
    // The booking's group is the one the customer is actually travelling with; it outranks a group merely selected on the lead.
    departureGroupId = ((booking as Row | null)?.departure_group_id as string | undefined) ?? departureGroupId;

    const { data: travellers, error: travellerError } = await db.from("departure_group_pilgrims").select("pilgrim_id").eq("agency_id", agencyId).eq("booking_id", bookingId);
    if (travellerError) failed("the booking's travellers", travellerError);
    const rows = (travellers ?? []) as Row[];
    travellerCount = rows.length;
    pilgrimId = ((rows.find((row) => row.pilgrim_id) ?? null)?.pilgrim_id as string | undefined) ?? null;
  }

  // A profile already exists when the booking lists a traveller, or one was created from this lead.
  let hasTravellerProfile = pilgrimId !== null;
  if (!hasTravellerProfile && leadId) {
    const { data: existing, error: profileError } = await db.from("pilgrims").select("id").eq("agency_id", agencyId).eq("origin_lead_id", leadId).limit(1).maybeSingle();
    if (profileError) failed("the traveller profile", profileError);
    hasTravellerProfile = Boolean(existing);
  }

  let departureGroupName: string | null = null;
  if (departureGroupId) {
    const { data: group, error: groupError } = await db.from("departure_groups").select("group_name").eq("agency_id", agencyId).eq("id", departureGroupId).maybeSingle();
    if (groupError) failed("the departure group", groupError);
    // A group that is not this agency's, or is gone, is treated as no group: nothing can be created against it.
    if (!group) departureGroupId = null;
    departureGroupName = ((group as Row | null)?.group_name as string | undefined) ?? null;
  }

  const contactPhone = leadMobile ?? text(convo.contact_phone);

  return {
    conversationId,
    customerName: ((convo.contact_name as string | null) ?? "").trim(),
    leadId,
    leadReference,
    leadFullName,
    contactPhone,
    leadEmail,
    leadJourneyType,
    leadRoomPreference,
    leadPartySize,
    bookingId,
    travellerCount,
    sourceMessageId,
    departureGroupId,
    departureGroupName,
    pilgrimId,
    hasTravellerProfile,
    hasContactNumber: contactPhone !== null,
  };
}

export async function loadConversationPack(subjectId: string, agencyId: string, db: Db): Promise<ConversationContextPack | null> {
  const facts = await loadConversationConversionFacts(db, agencyId, subjectId);
  if (!facts) return null;
  return buildContextPack({
    subject: { type: "CONVERSATION", id: subjectId, label: facts.customerName || "Conversation", href: `/inbox?conversation=${subjectId}` },
    facts,
    fingerprint: hashObject(facts),
  });
}
