/**
 * Lead-capture tools — the only place the agent is allowed to write into the
 * sales pipeline. Deliberately narrow (D7 in
 * docs/modules/whatsapp-ai-agent-implementation-plan.md): the agent may create a
 * lead, patch its own fields, and leave a note. It may never move `stage`
 * past QUALIFIED, set `estimated_value_lkr`, or touch anything a human
 * conversion decision should own.
 *
 * D6 — this is the CRM's "customer" entity. No parallel customer table.
 */

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

import { COPILOT_NAME } from "@/lib/agent/identity";
import type { AgentContext } from "@/lib/agent/whatsapp/context";
import { captureContactNumber } from "@/lib/agent/whatsapp/contact-number";
import { ensureLeadForConversation } from "@/lib/agent/whatsapp/lead-capture";

/** Pipeline stages the assistant may set, lowest first. It may only move a lead forward through these. */
const ASSISTANT_STAGE_ORDER = ["NEW_LEAD", "CONTACTED", "QUALIFIED"] as const;

const WRONG_LEAD_ERROR = JSON.stringify({
  error: "That lead is not the one linked to this conversation. Use the leadId returned by find_or_create_lead.",
});

/**
 * The model names a lead id, but it is only ever allowed to touch the lead linked to THIS conversation. The
 * link is read from the database at call time (find_or_create_lead may have just created it), never taken from
 * the argument — otherwise a customer message could steer the assistant into another lead's record.
 */
async function conversationLeadMatches(ctx: AgentContext, leadId: string): Promise<{ ok: true; stage: string | null } | { ok: false }> {
  const { data: conversation } = await ctx.db
    .from("conversations")
    .select("lead_id")
    .eq("id", ctx.conversationId)
    .eq("agency_id", ctx.agencyId)
    .maybeSingle();
  const linked = (conversation as { lead_id: string | null } | null)?.lead_id;
  if (!linked || linked !== leadId) return { ok: false };

  const { data: lead } = await ctx.db.from("leads").select("stage").eq("id", leadId).eq("agency_id", ctx.agencyId).maybeSingle();
  return { ok: true, stage: (lead as { stage: string } | null)?.stage ?? null };
}

export function createLeadTools(ctx: AgentContext) {
  const findOrCreateLead = betaTool({
    name: "find_or_create_lead",
    description:
      "Finds the existing lead for this WhatsApp contact, or creates one. Call this once you know the " +
      "customer's name and what they're interested in — before capturing any traveller or booking " +
      "detail. Safe to call more than once; it will not create a duplicate for the same phone number.",
    inputSchema: {
      type: "object",
      properties: {
        fullName: { type: "string" },
        journeyType: { type: "string", enum: ["UMRAH", "HAJJ", "EARLY_REGISTRATION"] },
        interestedIn: { type: "string", description: "Free-text summary of what the customer is asking about." },
        city: { type: "string" },
      },
      required: ["fullName"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const result = await ensureLeadForConversation(ctx, {
        fullName: args.fullName,
        journeyType: args.journeyType,
        interestedIn: args.interestedIn,
        city: args.city,
      });
      return JSON.stringify(result);
    },
  });

  const updateLead = betaTool({
    name: "update_lead",
    description:
      "Updates fields on the lead already linked to this conversation — preferred period, room " +
      "preference, budget range, desired package. Cannot move the lead's pipeline stage past QUALIFIED " +
      "or set its estimated value — those are staff-only decisions (D7).",
    inputSchema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        fullName: { type: "string", description: "The customer's real name, once they have typed it." },
        city: { type: "string" },
        departureCity: { type: "string", description: "The city they will fly from, if they said." },
        email: { type: "string" },
        preferredLanguage: { type: "string", enum: ["English", "Sinhala", "Tamil"] },
        interestedIn: { type: "string" },
        preferredPeriod: { type: "string" },
        roomPreference: { type: "string", enum: ["QUAD", "TRIPLE", "DOUBLE", "SINGLE", "UNDECIDED"] },
        budgetRange: { type: "string" },
        adults: { type: "integer", minimum: 1 },
        children: { type: "integer", minimum: 0 },
        stage: { type: "string", enum: ["NEW_LEAD", "CONTACTED", "QUALIFIED"] },
      },
      required: ["leadId"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const target = await conversationLeadMatches(ctx, args.leadId);
      if (!target.ok) return WRONG_LEAD_ERROR;

      const patch: Record<string, unknown> = {};
      if (args.fullName?.trim()) patch.full_name = args.fullName.trim();
      if (args.city !== undefined) patch.city = args.city;
      if (args.departureCity !== undefined) patch.departure_city = args.departureCity;
      if (args.email?.trim()) patch.email = args.email.trim();
      if (args.preferredLanguage !== undefined) patch.preferred_language = args.preferredLanguage;
      if (args.interestedIn !== undefined) patch.interested_in = args.interestedIn;
      if (args.preferredPeriod !== undefined) patch.preferred_period = args.preferredPeriod;
      if (args.roomPreference !== undefined) patch.room_preference = args.roomPreference;
      if (args.budgetRange !== undefined) patch.budget_range = args.budgetRange;
      if (args.adults !== undefined) patch.adults = args.adults;
      if (args.children !== undefined) patch.children = args.children;
      // The schema caps the stage at QUALIFIED; this also stops it moving a lead backwards, or overriding a
      // stage staff set later (PROPOSAL_SENT, BOOKED, …), which is not in the list at all.
      if (args.stage !== undefined) {
        const current = ASSISTANT_STAGE_ORDER.indexOf(target.stage as (typeof ASSISTANT_STAGE_ORDER)[number]);
        const requested = ASSISTANT_STAGE_ORDER.indexOf(args.stage);
        if (current !== -1 && requested > current) patch.stage = args.stage;
      }

      if (Object.keys(patch).length === 0) return JSON.stringify({ ok: true, changed: false });

      const { error } = await ctx.db
        .from("leads")
        .update(patch)
        .eq("id", args.leadId)
        .eq("agency_id", ctx.agencyId);
      if (error) throw new Error(`Failed to update lead: ${error.message}`);
      return JSON.stringify({ ok: true, changed: true });
    },
  });

  const addLeadNote = betaTool({
    name: "add_lead_note",
    description: "Leaves an internal note on the lead — never shown to the customer. Use this for context a staff member should see when they take over.",
    inputSchema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        note: { type: "string" },
      },
      required: ["leadId", "note"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const target = await conversationLeadMatches(ctx, args.leadId);
      if (!target.ok) return WRONG_LEAD_ERROR;

      const { error } = await ctx.db.from("lead_notes").insert({
        agency_id: ctx.agencyId,
        lead_id: args.leadId,
        body: args.note,
        author_name: COPILOT_NAME,
      });
      if (error) throw new Error(`Failed to add lead note: ${error.message}`);
      return JSON.stringify({ ok: true });
    },
  });

  // Only on channels whose customer id is not a phone number (Messenger, Instagram). WhatsApp already has it.
  const captureNumber = betaTool({
    name: "capture_contact_number",
    description:
      "Records the phone or WhatsApp number the customer has just typed, so staff can reach them. Call it once " +
      "after the customer gives a number — never with a number you inferred, completed or found anywhere else. " +
      "It saves the number on their lead; if it cannot be saved directly it tells you a colleague will confirm, " +
      "and that is all you should say about it. Call find_or_create_lead first if the customer has no lead yet.",
    inputSchema: {
      type: "object",
      properties: { phone: { type: "string", description: "Exactly as the customer typed it." } },
      required: ["phone"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const result = await captureContactNumber(ctx, { phone: args.phone });
      if (!result.ok) {
        const hint =
          result.reason === "INVALID_NUMBER"
            ? "That is not a Sri Lankan mobile number (nine digits after the leading 0 or +94). Ask the customer to type it again. If they are outside Sri Lanka, add a lead note and hand the conversation to staff instead."
            : result.reason === "NO_LEAD"
              ? "There is no lead for this customer yet — call find_or_create_lead first, then try again."
              : "This channel already has the customer's number.";
        return JSON.stringify({ ok: false, reason: result.reason, hint });
      }
      // Deliberately the same wording for a saved number and a number that needs confirming: what it matched is never disclosed.
      return JSON.stringify({ ok: true, note: "Number noted. Thank the customer; a colleague may follow up to confirm details." });
    },
  });

  return ctx.profile.identifiesByPhone ? [findOrCreateLead, updateLead, addLeadNote] : [findOrCreateLead, updateLead, addLeadNote, captureNumber];
}
