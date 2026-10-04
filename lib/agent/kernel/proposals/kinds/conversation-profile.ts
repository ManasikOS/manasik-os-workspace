/**
 * Traveller profile and family/mahram conversions (MI4.6). Native v2, `subjectType: "CONVERSATION"`, each running under the
 * capability of the module that owns what it writes (`pilgrims.createPilgrim`, `pilgrims.manageTravelAndRooming`) — so a role
 * that may not create a traveller profile or edit rooming by hand cannot do it from a chat either. (The `bookings` module's
 * capability set is still a placeholder that grants writes to Admin/CEO only, so it is not used here.)
 *
 * Each is one insert carrying both source columns.
 */

import { z } from "zod";

import { loadConversationPack, type ConversationContextPack } from "@/lib/agent/kernel/proposals/conversation-pack";
import type { ProposalExecutor } from "@/lib/agent/kernel/proposals/executor";
import {
  ConversationConversionPayloadSchema,
  conversionFingerprint,
  sourceColumns,
  verifyConversionTarget,
  type ConversationConversionPayload,
} from "@/lib/agent/kernel/proposals/kinds/conversation-shared";

/* ── CONVERSATION_PILGRIM_PROFILE ─────────────────────────────────────────── */

const PROFILE = "CONVERSATION_PILGRIM_PROFILE";
const REFERENCE_ATTEMPTS = 5;

/**
 * Creates the customer's traveller profile from their lead. A profile is normally made when a booking lists a traveller; this
 * is for the customer who is not booked yet but whose documents or support case need somewhere to live. It never creates a
 * booking, and it refuses when a profile already exists for the lead or for this agency's own record of the same number.
 */
export const conversationPilgrimProfileExecutor: ProposalExecutor<ConversationConversionPayload, ConversationContextPack> = {
  kind: PROFILE,
  module: "pilgrims",
  subjectType: "CONVERSATION",
  schema: ConversationConversionPayloadSchema,
  requiredCapability: "createPilgrim",
  risk: "LOW",
  ttlHours: 24,
  loadPack: loadConversationPack,
  fingerprint: (payload) => conversionFingerprint(PROFILE, payload),
  dependencySnapshot: (_payload, pack) => ({ leadId: pack.facts.leadId, hasTravellerProfile: pack.facts.hasTravellerProfile }),
  describe: (_payload, pack) => ({
    humanDiff: [
      { field: "traveller profile", from: null, to: pack.facts.leadFullName ?? (pack.facts.customerName || "Customer") },
      { field: "phone", from: null, to: pack.facts.contactPhone ?? "—" },
      { field: "email", from: null, to: pack.facts.leadEmail ?? "—" },
    ],
  }),
  execute: async (payload, ctx) => {
    const target = await verifyConversionTarget(PROFILE, payload, ctx);
    if (!target.ok) return target;
    const { facts } = target;

    // This agency's own record of the same number counts as an existing profile (never another agency's).
    if (facts.contactPhone) {
      const { data: sameNumber, error: lookupError } = await ctx.db.from("pilgrims").select("id").eq("agency_id", ctx.agencyId).eq("whatsapp_number", facts.contactPhone).limit(1).maybeSingle();
      if (lookupError) return { ok: false, error: `Could not check for an existing profile: ${lookupError.message}` };
      if (sameNumber) return { ok: false, error: "A traveller profile with this phone number already exists." };
    }

    // References are unique across the whole table, so the count that seeds one is global; a race is absorbed by retrying.
    const year = new Date().getFullYear();
    let lastError = "no attempt was made";
    for (let attempt = 1; attempt <= REFERENCE_ATTEMPTS; attempt++) {
      const { count, error: countError } = await ctx.db.from("pilgrims").select("id", { count: "exact", head: true });
      if (countError) return { ok: false, error: `Could not read the next reference: ${countError.message}` };
      const { error } = await ctx.db.from("pilgrims").insert({
        agency_id: ctx.agencyId,
        reference: `PL-${year}-${String((count ?? 0) + attempt).padStart(4, "0")}`,
        full_name: facts.leadFullName ?? (facts.customerName || "Traveller"),
        whatsapp_number: facts.contactPhone ?? "",
        mobile_number: facts.contactPhone,
        email: facts.leadEmail,
        origin_lead_id: facts.leadId,
        ...sourceColumns(payload),
      });
      if (!error) return { ok: true };
      lastError = error.message;
      const isReferenceClash = (error as { code?: string }).code === "23505" && error.message.includes("pilgrims_reference_key");
      if (!isReferenceClash) break;
    }
    return { ok: false, error: `Could not create the traveller profile: ${lastError}` };
  },
};

/* ── CONVERSATION_TRAVELLER_RELATIONSHIP ──────────────────────────────────── */

const RELATIONSHIP = "CONVERSATION_TRAVELLER_RELATIONSHIP";
export const TRAVELLER_RELATIONSHIPS = ["MAHRAM", "SPOUSE", "PARENT", "CHILD", "SIBLING", "COMPANION", "OTHER"] as const;

export const TravellerRelationshipPayloadSchema = ConversationConversionPayloadSchema.extend({
  fromTravellerId: z.string().uuid(),
  toTravellerId: z.string().uuid(),
  relationship: z.enum(TRAVELLER_RELATIONSHIPS),
  isMahram: z.boolean().default(false),
}).refine((payload) => payload.fromTravellerId !== payload.toTravellerId, { message: "Pick two different travellers." });
export type TravellerRelationshipPayload = z.infer<typeof TravellerRelationshipPayloadSchema>;

/**
 * Records how two travellers on the customer's booking are related, in the booking's own relationships table (the one rooming
 * and mahram checks read). Both travellers must belong to THIS booking of THIS agency; a pair is recorded once.
 */
export const conversationTravellerRelationshipExecutor: ProposalExecutor<TravellerRelationshipPayload, ConversationContextPack> = {
  kind: RELATIONSHIP,
  module: "pilgrims",
  subjectType: "CONVERSATION",
  schema: TravellerRelationshipPayloadSchema,
  // Relationships drive rooming and mahram checks; the people who manage rooming are the people who record them.
  requiredCapability: "manageTravelAndRooming",
  risk: "LOW",
  ttlHours: 24,
  loadPack: loadConversationPack,
  fingerprint: (payload) => conversionFingerprint(RELATIONSHIP, payload, payload.fromTravellerId, payload.toTravellerId),
  dependencySnapshot: (_payload, pack) => ({ bookingId: pack.facts.bookingId, travellerCount: pack.facts.travellerCount }),
  describe: (payload) => ({
    humanDiff: [
      { field: "traveller", from: null, to: payload.labels.fromTravellerId ?? "—" },
      { field: "relationship", from: null, to: `${payload.relationship.toLowerCase()} of` },
      { field: "of traveller", from: null, to: payload.labels.toTravellerId ?? "—" },
      { field: "counts as mahram", from: null, to: payload.isMahram ? "Yes" : "No" },
    ],
  }),
  execute: async (payload, ctx) => {
    const target = await verifyConversionTarget(RELATIONSHIP, payload, ctx);
    if (!target.ok) return target;
    const { facts } = target;

    const { data: travellers, error: lookupError } = await ctx.db
      .from("departure_group_pilgrims")
      .select("id")
      .eq("agency_id", ctx.agencyId)
      .eq("booking_id", facts.bookingId)
      .in("id", [payload.fromTravellerId, payload.toTravellerId]);
    if (lookupError) return { ok: false, error: `Could not check the travellers: ${lookupError.message}` };
    if ((travellers ?? []).length !== 2) return { ok: false, error: "Both travellers must be on this customer's booking." };

    const { error } = await ctx.db.from("booking_traveller_relationships").insert({
      agency_id: ctx.agencyId,
      departure_group_id: facts.departureGroupId,
      booking_id: facts.bookingId,
      from_pilgrim_id: payload.fromTravellerId,
      to_pilgrim_id: payload.toTravellerId,
      relationship: payload.relationship,
      is_mahram: payload.isMahram || payload.relationship === "MAHRAM",
      note: payload.note || null,
      created_by_name: ctx.actor.name,
      ...sourceColumns(payload),
    });
    if (error?.code === "23505") return { ok: false, error: "That relationship is already recorded for these two travellers." };
    if (error) return { ok: false, error: `Could not record the relationship: ${error.message}` };
    return { ok: true };
  },
};
