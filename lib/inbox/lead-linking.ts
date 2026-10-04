/**
 * Canonical Inbox → CRM lead binding.
 *
 * Every adapter calls this after it has persisted a conversation.  It makes
 * the conversation's `lead_id` the single bridge to the sales pipeline and
 * booking record; channel-specific code must not invent its own matcher.
 */
import "server-only";

/* eslint-disable @typescript-eslint/no-explicit-any -- service and session clients share this narrow data contract. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { waIdToMobile } from "@/lib/agent/whatsapp/phone";
import { colomboDayKey } from "@/lib/date";
import { leadChannelDefaults, mobileForNewLead } from "./lead-channel";
import { newChatLeadActivity, newChatLeadFollowUpFields } from "./lead-defaults";
import { ensureSubjectIdentity, lookUpGraph, recordProposals, type GraphLookup } from "@/lib/data/identity-graph-repository";
import { decideLeadLink, type LeadCandidate, type LeadLinkSource } from "./lead-link-decision";

type Db = SupabaseClient<any, "public", any>;

type Lead = LeadCandidate;

export type { LeadLinkSource };

export type LeadLinkResult = {
  lead: Lead | null;
  source: LeadLinkSource;
};

export type LeadLinkInput = {
  agencyId: string;
  conversationId: string;
  provider: "WHATSAPP" | "INSTAGRAM" | "MESSENGER" | "GMAIL" | "WEB_CHAT" | "SMS" | "OTHER";
  externalSubjectId: string;
  displayName?: string | null;
  normalizedPhone?: string | null;
  /** Only inbound capture and an explicit staff action may create a lead. */
  createIfMissing?: boolean;
  /** What the customer just wrote and their email, if any: extra evidence for the identity graph, never a reason to link by itself. */
  messageText?: string | null;
  email?: string | null;
  owner?: { id: string; name: string } | null;
};

async function nextLeadReferenceForAgency(db: Db, agencyId: string): Promise<string> {
  const prefix = `LD-${colomboDayKey().slice(0, 4)}-`;
  const { data, error } = await db
    .from("leads")
    .select("reference")
    .eq("agency_id", agencyId)
    .like("reference", `${prefix}%`);
  if (error) throw new Error(`Could not allocate a lead reference: ${error.message}`);

  const highest = ((data ?? []) as { reference: string }[]).reduce((maximum, row) => {
    const number = Number.parseInt(row.reference.slice(prefix.length), 10);
    return Number.isFinite(number) ? Math.max(maximum, number) : maximum;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

/**
 * Takes back a lead this call created when its identity could not be saved. Without that, a channel with no phone number (Instagram,
 * Messenger) has nothing to find the stranded lead by, and the retry would create a second one. Only ever called for a lead created
 * in the same call and only before anything refers to it; if the removal fails, the lead is named in the log and the original error
 * is still the one thrown.
 */
async function removeUnlinkedNewLead(db: Db, agencyId: string, leadId: string): Promise<void> {
  const { error } = await db.from("leads").delete().eq("id", leadId).eq("agency_id", agencyId);
  if (error) console.error(`Could not remove lead ${leadId} after its identity failed to save:`, error.message);
}

async function defaultLeadOwner(db: Db, agencyId: string): Promise<{ id: string; name: string } | null> {
  const { data: settings } = await db
    .from("ai_settings")
    .select("default_lead_owner_id")
    .eq("agency_id", agencyId)
    .maybeSingle();
  const configuredId = (settings as { default_lead_owner_id: string | null } | null)?.default_lead_owner_id;

  if (configuredId) {
    const { data } = await db
      .from("staff_profiles")
      .select("id, full_name")
      .eq("agency_id", agencyId)
      .eq("id", configuredId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (data) return { id: data.id as string, name: data.full_name as string };
  }

  for (const role of ["MARKETING", "ADMIN"]) {
    const { data } = await db
      .from("staff_profiles")
      .select("id, full_name")
      .eq("agency_id", agencyId)
      .eq("status", "ACTIVE")
      .eq("role", role)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) return { id: data.id as string, name: data.full_name as string };
  }
  return null;
}

/**
 * Three writes, ordered so that a failure between them heals on the next message instead of leaving the link half-made:
 *   1. the contact identity (idempotent upsert) — from here on, the next message from this contact finds this lead;
 *   2. the conversation's `lead_id`;
 *   3. the match-history entry — it records a link that has actually happened, so it comes last.
 * The old order linked the conversation first: if saving the identity then failed, the conversation counted as already linked, the
 * identity was never looked for again, and it was never saved.
 */
async function attach(
  db: Db,
  input: LeadLinkInput,
  lead: Lead,
  confidence: "EXACT_IDENTITY" | "VERIFIED_CONTACT",
  /** Runs when the identity could not be saved, before the error is thrown: nothing refers to the lead yet, so a caller that just created it can take it back. */
  onIdentityNotSaved?: () => Promise<void>,
) {
  const { data: identity, error: identityError } = await db
    .from("contact_identities")
    .upsert({
      agency_id: input.agencyId,
      provider: input.provider,
      external_subject_id: input.externalSubjectId,
      normalized_phone: input.normalizedPhone ?? null,
      display_name: input.displayName?.trim() || "",
      lead_id: lead.id,
      match_confidence: confidence,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "agency_id,provider,external_subject_id" })
    .select("id")
    .single();
  if (identityError) {
    await onIdentityNotSaved?.();
    throw new Error(`Could not save this contact identity: ${identityError.message}`);
  }

  const { error: conversationError } = await db
    .from("conversations")
    .update({ lead_id: lead.id })
    .eq("id", input.conversationId)
    .eq("agency_id", input.agencyId);
  if (conversationError) throw new Error(`Could not link this conversation to its lead: ${conversationError.message}`);

  // The link is already made; a lost history row must not fail the inbound message (and a retry could not rewrite it, because
  // the conversation now counts as linked). Say so loudly instead.
  const { error: historyError } = await db.from("identity_match_events").insert({
    agency_id: input.agencyId,
    contact_identity_id: identity.id as string,
    action: "LINKED",
    next_lead_id: lead.id,
    confidence,
    evidence: { provider: input.provider, external_subject_id: input.externalSubjectId },
  });
  if (historyError) console.error("Could not record the identity match history:", historyError.message);
}

/**
 * Resolve one CRM lead without guessing: provider identity wins, then one
 * exact normalized phone match. Multiple phone candidates remain unlinked for
 * staff review. An unknown inbound contact can be captured as a minimal lead.
 */
export async function linkConversationToLead(db: Db, input: LeadLinkInput): Promise<LeadLinkResult> {
  const { data: conversation, error: conversationError } = await db
    .from("conversations")
    .select("lead_id")
    .eq("id", input.conversationId)
    .eq("agency_id", input.agencyId)
    .maybeSingle();
  if (conversationError || !conversation) throw new Error("Conversation was not found for this agency.");

  let existingLead: Lead | null = null;
  if (conversation.lead_id) {
    const { data: current } = await db.from("leads").select("id, reference, full_name, mobile, stage")
      .eq("id", conversation.lead_id).eq("agency_id", input.agencyId).maybeSingle();
    existingLead = (current as Lead | null) ?? null;
  }

  let identityMatchedLead: Lead | null = null;
  if (!existingLead) {
    const { data: identity } = await db.from("contact_identities").select("lead_id")
      .eq("agency_id", input.agencyId).eq("provider", input.provider)
      .eq("external_subject_id", input.externalSubjectId).not("lead_id", "is", null).maybeSingle();
    if (identity?.lead_id) {
      const { data: matched } = await db.from("leads").select("id, reference, full_name, mobile, stage")
        .eq("id", identity.lead_id as string).eq("agency_id", input.agencyId).maybeSingle();
      identityMatchedLead = (matched as Lead | null) ?? null;
    }
  }

  const mobile = input.normalizedPhone ?? (input.provider === "WHATSAPP" ? waIdToMobile(input.externalSubjectId) : null);
  let phoneCandidates: Lead[] = [];
  if (!existingLead && !identityMatchedLead && mobile) {
    const { data: candidates, error } = await db.from("leads").select("id, reference, full_name, mobile, stage")
      .eq("agency_id", input.agencyId).eq("mobile", mobile).limit(2);
    if (error) throw new Error(`Could not search existing leads: ${error.message}`);
    phoneCandidates = (candidates ?? []) as Lead[];
  }

  // No exact phone and no known identity: before a duplicate lead is created, ask the identity graph whether this contact
  // might already be a lead. A failed lookup falls back to the old behaviour rather than blocking the inbound message.
  let lookup: GraphLookup | undefined;
  let subjectIdentityId: string | undefined;
  if (!existingLead && !identityMatchedLead && phoneCandidates.length === 0 && (input.createIfMissing ?? false)) {
    try {
      subjectIdentityId = await ensureSubjectIdentity(db, { agencyId: input.agencyId, provider: input.provider, externalSubjectId: input.externalSubjectId, displayName: input.displayName ?? null, normalizedPhone: mobile });
      lookup = await lookUpGraph(db, {
        agencyId: input.agencyId,
        subject: { displayName: input.displayName ?? "", phone: mobile, email: input.email ?? null, messageText: input.messageText ?? null },
        subjectIdentityId,
        now: new Date().toISOString(),
      });
    } catch (cause) {
      console.error("Identity graph lookup failed; continuing without it:", cause instanceof Error ? cause.message : cause);
      lookup = undefined;
    }
  }

  const decision = decideLeadLink({
    existingLead,
    identityMatchedLead,
    phoneCandidates,
    createIfMissing: input.createIfMissing ?? false,
    graph: lookup?.graph,
  });

  switch (decision.action) {
    case "EXISTING":
      return { lead: decision.lead, source: decision.source };

    case "ATTACH": {
      const confidence = decision.source === "EXACT_IDENTITY" ? "EXACT_IDENTITY" : "VERIFIED_CONTACT";
      await attach(db, { ...input, normalizedPhone: mobile }, decision.lead, confidence);
      return { lead: decision.lead, source: decision.source };
    }

    case "AMBIGUOUS":
      return { lead: null, source: "AMBIGUOUS" };

    case "PROPOSE": {
      // Suggest, never link: the conversation stays without a lead until a person decides on the "Possible existing lead found" card.
      if (lookup && subjectIdentityId) {
        await recordProposals(db, { agencyId: input.agencyId, subjectIdentityId, candidates: lookup.candidates.filter((candidate) => !candidate.autoConfirm) });
      }
      return { lead: null, source: "PROPOSED" };
    }

    case "CREATE": {
      const owner = input.owner ?? await defaultLeadOwner(db, input.agencyId);
      if (!owner) throw new Error("No active staff member is available to own this new lead.");
      const reference = await nextLeadReferenceForAgency(db, input.agencyId);
      const channelDefaults = leadChannelDefaults(input.provider);
      const { data: created, error: createError } = await db.from("leads").insert({
        agency_id: input.agencyId,
        reference,
        full_name: input.displayName?.trim() || (mobile ? `+${mobile}` : "New inbox contact"),
        // A channel with no phone number stores '' — never the channel's own id (plan F2).
        mobile: mobileForNewLead(mobile),
        city: "",
        preferred_channel: channelDefaults.preferredChannel,
        journey_type: "UMRAH",
        interested_in: "",
        source: channelDefaults.source,
        assigned_to_id: owner.id,
        assigned_to_name: owner.name,
        stage: "NEW_LEAD",
        ...newChatLeadFollowUpFields(owner),
      }).select("id, reference, full_name, mobile, stage").single();
      if (createError) throw new Error(`Could not create the inbox lead: ${createError.message}`);

      const lead = created as Lead;
      await attach(db, { ...input, normalizedPhone: mobile }, lead, "VERIFIED_CONTACT", () => removeUnlinkedNewLead(db, input.agencyId, lead.id));
      const { error: activityError } = await db
        .from("lead_activity")
        .insert(newChatLeadActivity(input.agencyId, lead.id, `Lead captured from ${input.provider.replaceAll("_", " ")} Inbox conversation.`, "Inbox"));
      // The lead exists and is linked; the activity feed is a convenience, so a failure is reported, not thrown.
      if (activityError) console.error("Could not log the new lead's activity:", activityError.message);
      return { lead, source: "CREATED" };
    }
  }
}
