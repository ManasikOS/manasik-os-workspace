/**
 * Records the phone number a Messenger or Instagram customer types (plan §7, findings F2/F14).
 *
 * Those channels carry no phone number, so a lead created from them starts with none. The assistant asks once
 * (preamble rule 9) and this records the answer — with one hard rule that is the reason this file exists:
 *
 *   A number a customer TYPES is unverified. It is never used to attach their conversation to an existing lead.
 *
 * If it did, anyone could type someone else's number into Instagram and be linked to that person's lead — and
 * the assistant's booking tools would then read that person's bookings back to them. So:
 *   - no other lead has the number  → it is saved on THIS customer's lead and their contact identity, with a
 *     note saying it was typed and is unverified;
 *   - another lead already has it   → nothing is merged or changed. A note and an AMBIGUOUS identity event go
 *     to staff, who confirm the person before linking (Inbox → link lead). The customer is told only that a
 *     colleague will confirm — never that a record exists.
 *
 * The safe direction of cross-channel linking happens elsewhere: when the same person later writes on WhatsApp,
 * Meta has verified that number, and the existing phone-match in lead-linking attaches that conversation to
 * this lead.
 */

import { COPILOT_NAME } from "@/lib/agent/identity";
import type { AgentContext } from "@/lib/agent/whatsapp/context";
import { normaliseMobile } from "@/lib/data/leads";

export type CaptureContactNumberResult =
  | { ok: false; reason: "NOT_NEEDED" | "INVALID_NUMBER" | "NO_LEAD" }
  | { ok: true; outcome: "RECORDED" | "ALREADY_KNOWN" | "NEEDS_STAFF_CONFIRMATION" };

/**
 * A nine-digit Sri Lankan subscriber number once normalised — the only shape the CRM stores, displays (+94 …)
 * and dials. The staff "add lead" form enforces the same rule. A foreign number would be stored as digits the
 * Leads screen then shows and dials as "+94 <digits>", so it is refused here and the customer is handed to staff.
 */
export function normaliseTypedNumber(input: string): string | null {
  const digits = normaliseMobile(input);
  return digits.length === 9 ? digits : null;
}

export async function captureContactNumber(
  ctx: Pick<AgentContext, "db" | "agencyId" | "conversationId" | "channel" | "profile">,
  input: { phone: string },
): Promise<CaptureContactNumberResult> {
  // WhatsApp's conversation id IS the customer's number; there is nothing to ask for.
  if (ctx.profile.identifiesByPhone) return { ok: false, reason: "NOT_NEEDED" };

  const mobile = normaliseTypedNumber(input.phone);
  if (!mobile) return { ok: false, reason: "INVALID_NUMBER" };

  const { data: conversation } = await ctx.db
    .from("conversations")
    .select("lead_id, external_conversation_id")
    .eq("id", ctx.conversationId)
    .eq("agency_id", ctx.agencyId)
    .maybeSingle();
  const conversationRow = conversation as { lead_id: string | null; external_conversation_id: string } | null;
  if (!conversationRow?.lead_id) return { ok: false, reason: "NO_LEAD" };
  const leadId = conversationRow.lead_id;

  const { data: lead } = await ctx.db.from("leads").select("id, mobile").eq("id", leadId).eq("agency_id", ctx.agencyId).maybeSingle();
  if (!lead) return { ok: false, reason: "NO_LEAD" };
  // Never overwrite a number a person or an earlier turn already put there.
  if (((lead as { mobile: string }).mobile ?? "").trim().length > 0) return { ok: true, outcome: "ALREADY_KNOWN" };

  const { data: others } = await ctx.db
    .from("leads")
    .select("id, reference")
    .eq("agency_id", ctx.agencyId)
    .eq("mobile", mobile)
    .neq("id", leadId)
    .limit(2);
  const matches = (others ?? []) as Array<{ id: string; reference: string }>;

  const { data: identity } = await ctx.db
    .from("contact_identities")
    .select("id")
    .eq("agency_id", ctx.agencyId)
    .eq("provider", ctx.channel)
    .eq("external_subject_id", conversationRow.external_conversation_id)
    .maybeSingle();
  const identityId = (identity as { id: string } | null)?.id ?? null;

  if (matches.length > 0) {
    // Do not merge. Tell staff, in words a person can act on; tell the customer nothing about the match.
    await ctx.db.from("lead_notes").insert({
      agency_id: ctx.agencyId,
      lead_id: leadId,
      body:
        `The customer typed a phone number in ${ctx.profile.displayName} (+${mobile}, unverified) that already belongs to ` +
        `${matches.length > 1 ? "more than one existing lead" : `lead ${matches[0].reference}`}. Nothing was merged. ` +
        `If this is the same person, confirm it with them and link the conversation to that lead from the Inbox.`,
      author_name: COPILOT_NAME,
    });
    if (identityId) {
      await ctx.db.from("identity_match_events").insert({
        agency_id: ctx.agencyId,
        contact_identity_id: identityId,
        action: "AMBIGUOUS",
        previous_lead_id: leadId,
        confidence: "UNRESOLVED",
        evidence: { reason: "TYPED_PHONE_MATCHES_EXISTING_LEAD", matched_lead_ids: matches.map((match) => match.id), provider: ctx.channel },
      });
    }
    return { ok: true, outcome: "NEEDS_STAFF_CONFIRMATION" };
  }

  // The `mobile = ''` filter makes this a compare-and-set: a concurrent turn that already saved a number wins.
  await ctx.db.from("leads").update({ mobile }).eq("id", leadId).eq("agency_id", ctx.agencyId).eq("mobile", "");
  if (identityId) {
    await ctx.db.from("contact_identities").update({ normalized_phone: mobile }).eq("id", identityId).eq("agency_id", ctx.agencyId);
  }
  await ctx.db.from("lead_notes").insert({
    agency_id: ctx.agencyId,
    lead_id: leadId,
    body: `Phone number given by the customer in ${ctx.profile.displayName} chat: +${mobile}. Typed by the customer, not verified.`,
    author_name: COPILOT_NAME,
  });
  return { ok: true, outcome: "RECORDED" };
}

/**
 * The number a held booking is created with: the primary traveller's own number, else the conversation's
 * (WhatsApp: the customer's number), else the lead's saved number (Messenger/Instagram, once the customer gave
 * one). Empty means there is nobody staff can call — the booking tool refuses rather than hold seats for them.
 */
export async function resolveBookingContactPhone(
  ctx: Pick<AgentContext, "db" | "agencyId">,
  input: { travellerPhone?: string | null; conversationPhone?: string | null; leadId?: string | null },
): Promise<string> {
  const direct = (input.travellerPhone || input.conversationPhone || "").trim();
  if (direct) return direct;
  if (!input.leadId) return "";
  const { data } = await ctx.db.from("leads").select("mobile").eq("id", input.leadId).eq("agency_id", ctx.agencyId).maybeSingle();
  return ((data as { mobile: string } | null)?.mobile ?? "").trim();
}
