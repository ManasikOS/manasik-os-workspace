/**
 * Assembles the bounded, redacted context a reply-suggestion AI call is
 * grounded in — Phase 8's "channel-neutral conversation context assembler
 * with role/PII redaction and bounded recent history" task
 * (docs/modules/inbox-implementation-plan.md).
 *
 * Facts come from the same lead columns `InboxCustomerContext` already
 * surfaces to the Customer Context panel, run through the shared
 * `redact()` backstop (lib/ai/trust/redaction.ts) rather than a
 * hand-picked `.select()` alone — `FORBIDDEN_KEYS` already lists
 * `outstanding_balance`/`amount_paid`, so a future column added to this
 * query without updating this file still can't leak a balance into a
 * customer-facing draft.
 */

import "server-only";

import { redact } from "@/lib/ai/trust/redaction";
import type { ConsentChannel } from "@/lib/types/consent";
import type { Db } from "@/lib/ai/db";

export interface ReplyContextLeadFacts {
  reference: string;
  stage: string;
  journey_type: string;
  adults: number;
  children: number;
  room_preference: string;
  desired_package_name: string | null;
  preferred_language: string;
  next_follow_up_at: string | null;
}

export interface ReplyContextFacts {
  contact_name: string | null;
  channel: string;
  lead: ReplyContextLeadFacts | null;
}

export interface ReplyHistoryEntry {
  speaker: "customer" | "staff";
  text: string;
}

export interface ReplyConsentFacts {
  consentStatus: "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";
  doNotContact: boolean;
  contactableChannels: ConsentChannel[];
  /** Only WhatsApp maps to a ConsentChannel today — other providers have no channel-specific consent model yet. */
  channel: ConsentChannel | null;
}

export interface ReplyContextPack {
  facts: ReplyContextFacts;
  /** Oldest first, bounded — never the full thread. */
  history: ReplyHistoryEntry[];
  consent: ReplyConsentFacts | null;
}

const HISTORY_LIMIT = 12;

export async function loadReplyContextPack(
  db: Db,
  conversationId: string,
  agencyId: string,
): Promise<ReplyContextPack | null> {
  const { data: conversation } = await db
    .from("conversations")
    .select("id, channel, contact_name, lead_id")
    .eq("id", conversationId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!conversation) return null;

  const { data: messageRows } = await db
    .from("conversation_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "staff"])
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  const history: ReplyHistoryEntry[] = ((messageRows ?? []) as { role: string; content: string }[])
    .reverse()
    .map((row) => ({ speaker: row.role === "staff" ? "staff" : "customer", text: row.content }));

  let lead: ReplyContextLeadFacts | null = null;
  let consent: ReplyConsentFacts | null = null;
  if (conversation.lead_id) {
    const { data: leadRow } = await db
      .from("leads")
      .select(
        "reference, stage, journey_type, adults, children, room_preference, desired_package_name, preferred_language, next_follow_up_at, consent_status, do_not_contact, contactable_channels",
      )
      .eq("id", conversation.lead_id)
      .eq("agency_id", agencyId)
      .maybeSingle();
    if (leadRow) {
      lead = {
        reference: leadRow.reference as string,
        stage: leadRow.stage as string,
        journey_type: leadRow.journey_type as string,
        adults: leadRow.adults as number,
        children: leadRow.children as number,
        room_preference: leadRow.room_preference as string,
        desired_package_name: (leadRow.desired_package_name as string | null) ?? null,
        preferred_language: leadRow.preferred_language as string,
        next_follow_up_at: (leadRow.next_follow_up_at as string | null) ?? null,
      };
      consent = {
        consentStatus: leadRow.consent_status as ReplyConsentFacts["consentStatus"],
        doNotContact: leadRow.do_not_contact as boolean,
        contactableChannels: (leadRow.contactable_channels as ConsentChannel[]) ?? [],
        channel: conversation.channel === "WHATSAPP" ? "WHATSAPP" : null,
      };
    }
  }

  const facts: ReplyContextFacts = {
    contact_name: (conversation.contact_name as string | null) ?? null,
    channel: conversation.channel as string,
    lead,
  };

  return { facts: redact(facts) as ReplyContextFacts, history, consent };
}
