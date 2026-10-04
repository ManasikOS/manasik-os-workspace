/**
 * Finds or creates the CRM lead for a WhatsApp conversation. Shared by the `find_or_create_lead` tool
 * (the model asks for it once it knows a name) and by the inbound job, which runs it before the model
 * is called so that every customer who writes in has a lead in the CRM even if the model never gets
 * around to asking for one. Idempotent per phone number: it never creates a second lead for the same
 * number, it links the conversation to the one that exists.
 */

import { COPILOT_NAME } from "@/lib/agent/identity";
import type { AgentContext } from "@/lib/agent/whatsapp/context";
import { waIdToMobile } from "@/lib/agent/whatsapp/phone";
import { addCampaignTouchpoint } from "@/lib/data/campaigns-repository";
import { colomboDayKey } from "@/lib/date";
import { leadChannelDefaults, mobileForNewLead } from "@/lib/inbox/lead-channel";
import { newChatLeadActivity, newChatLeadFollowUpFields } from "@/lib/inbox/lead-defaults";

export interface LeadRow {
  id: string;
  reference: string;
  full_name: string;
  mobile: string;
  stage: string;
}

export interface EnsureLeadInput {
  fullName: string;
  journeyType?: "UMRAH" | "HAJJ" | "EARLY_REGISTRATION";
  interestedIn?: string;
  city?: string;
}

/**
 * The customer's stored mobile, when this channel gives us one. On WhatsApp the conversation id IS the phone
 * number; on Messenger and Instagram it is a channel id and there is no number — returning null there is what
 * keeps a lookup by mobile from matching every other phone-less customer's placeholder lead (which stores '').
 */
export function mobileForConversation(profile: { identifiesByPhone: boolean }, contactPhone: string): string | null {
  if (!profile.identifiesByPhone) return null;
  const mobile = waIdToMobile(contactPhone);
  return mobile.length > 0 ? mobile : null;
}

async function nextLeadReferenceForAgency(ctx: AgentContext): Promise<string> {
  const year = colomboDayKey().slice(0, 4);
  const prefix = `LD-${year}-`;

  const { data, error } = await ctx.db
    .from("leads")
    .select("reference")
    .eq("agency_id", ctx.agencyId)
    .like("reference", `${prefix}%`);
  if (error) throw new Error(`Failed to read lead references: ${error.message}`);

  const highest = ((data ?? []) as { reference: string }[]).reduce((max, row) => {
    const parsed = Number.parseInt(row.reference.slice(prefix.length), 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);

  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

async function defaultLeadOwner(ctx: AgentContext): Promise<{ id: string; name: string }> {
  const { data: settings } = await ctx.db
    .from("ai_settings")
    .select("default_lead_owner_id")
    .eq("agency_id", ctx.agencyId)
    .maybeSingle();

  const explicit = (settings as { default_lead_owner_id: string | null } | null)?.default_lead_owner_id;

  const { data: candidate } = await ctx.db
    .from("staff_profiles")
    .select("id, full_name")
    .eq("agency_id", ctx.agencyId)
    .eq("status", "ACTIVE")
    .in("id", explicit ? [explicit] : [])
    .maybeSingle();

  if (candidate) return { id: candidate.id as string, name: (candidate as { full_name: string }).full_name };

  // F4 — fall back to the first ACTIVE MARKETING staff, then the first ACTIVE ADMIN.
  for (const role of ["MARKETING", "ADMIN"]) {
    const { data: fallback } = await ctx.db
      .from("staff_profiles")
      .select("id, full_name")
      .eq("agency_id", ctx.agencyId)
      .eq("status", "ACTIVE")
      .eq("role", role)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (fallback) return { id: fallback.id as string, name: (fallback as { full_name: string }).full_name };
  }

  throw new Error("No active staff member exists to own this lead.");
}

export async function ensureLeadForConversation(
  ctx: AgentContext,
  input: EnsureLeadInput,
): Promise<{ created: boolean; lead: LeadRow }> {
  const { data: conversation, error: conversationError } = await ctx.db
    .from("conversations")
    .select(
      "lead_id, contact_phone, attributed_campaign_id, attribution_channel, attribution_tracking_code, attribution_source_detail, attribution_confidence",
    )
    .eq("id", ctx.conversationId)
    .single();
  if (conversationError || !conversation) {
    throw new Error("Could not load the conversation to resolve the customer's phone number.");
  }
  const conversationRow = conversation as {
    lead_id: string | null;
    contact_phone: string;
    attributed_campaign_id: string | null;
    attribution_channel: string | null;
    attribution_tracking_code: string | null;
    attribution_source_detail: string | null;
    attribution_confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" | null;
  };
  const contactMobile = mobileForConversation(ctx.profile, conversationRow.contact_phone);

  let existing: unknown = null;
  if (contactMobile) {
    // A channel with a phone number: one lead per number, as it has always been.
    ({ data: existing } = await ctx.db
      .from("leads")
      .select("id, reference, full_name, mobile, stage")
      .eq("agency_id", ctx.agencyId)
      .eq("mobile", contactMobile)
      .maybeSingle());
  } else if (conversationRow.lead_id) {
    // No phone number to look up (Messenger/Instagram): this customer's lead is the one already linked to the
    // conversation by the inbound path. Never search by an empty mobile — that would match another customer.
    ({ data: existing } = await ctx.db
      .from("leads")
      .select("id, reference, full_name, mobile, stage")
      .eq("id", conversationRow.lead_id)
      .eq("agency_id", ctx.agencyId)
      .maybeSingle());
  }

  if (existing) {
    await ctx.db
      .from("conversations")
      .update({ lead_id: (existing as LeadRow).id })
      .eq("id", ctx.conversationId);
    return { created: false, lead: existing as LeadRow };
  }

  const owner = await defaultLeadOwner(ctx);
  const reference = await nextLeadReferenceForAgency(ctx);
  const channelDefaults = leadChannelDefaults(ctx.channel);

  const { data: created, error } = await ctx.db
    .from("leads")
    .insert({
      agency_id: ctx.agencyId,
      reference,
      full_name: input.fullName,
      mobile: mobileForNewLead(contactMobile),
      city: input.city ?? "",
      preferred_channel: channelDefaults.preferredChannel,
      journey_type: input.journeyType ?? "UMRAH",
      interested_in: input.interestedIn ?? "",
      source: channelDefaults.source,
      assigned_to_id: owner.id,
      assigned_to_name: owner.name,
      stage: "NEW_LEAD",
      ...newChatLeadFollowUpFields(owner),
    })
    .select("id, reference, full_name, mobile, stage")
    .single();
  if (error) throw new Error(`Failed to create lead: ${error.message}`);

  await ctx.db.from("conversations").update({ lead_id: (created as LeadRow).id }).eq("id", ctx.conversationId);
  await ctx.db
    .from("lead_activity")
    .insert(newChatLeadActivity(ctx.agencyId, (created as LeadRow).id, `Lead captured by ${COPILOT_NAME} on ${ctx.profile.displayName}.`, COPILOT_NAME));

  // Automatic campaign attribution (docs/modules/campaigns-command-center-implementation-plan.md
  // §9) — only when the opening message actually matched a registered
  // click-to-chat tracking code/QR (captured on the conversation at
  // webhook time, see lib/whatsapp/campaign-attribution.ts). Never a
  // guess: no match on the conversation means no touchpoint at all.
  if (conversationRow.attributed_campaign_id) {
    await addCampaignTouchpoint(ctx.db, {
      agencyId: ctx.agencyId,
      campaignId: conversationRow.attributed_campaign_id,
      leadId: (created as LeadRow).id,
      bookingId: null,
      touchType: "FIRST",
      channel: conversationRow.attribution_channel ?? ctx.profile.displayName.toUpperCase(),
      sourceDetail: conversationRow.attribution_source_detail,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      trackingCode: conversationRow.attribution_tracking_code,
      attributionConfidence: conversationRow.attribution_confidence ?? "HIGH",
      occurredAt: null,
    }).catch((error) => console.error(`${ctx.profile.displayName} lead capture: failed to record campaign touchpoint:`, error));
  }

  return { created: true, lead: created as LeadRow };
}
