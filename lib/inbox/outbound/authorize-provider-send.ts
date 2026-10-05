import "server-only";

import type { Db } from "@/lib/ai/db";
import { checkStoredOffer } from "@/lib/data/inbox-offer-repository";
import { loadProtectionContext } from "@/lib/data/inbox-risk-repository";
import {
  authorizeAutomatedInboxSend,
  type AutomatedReplyAction,
  type AutomatedReplySource,
  type AutomatedSendAuthorization,
} from "@/lib/inbox/autonomy/runtime";
import { matchedOfferSnapshotSchema, type MatchedOfferSnapshot, type OfferCheckState } from "@/lib/inbox/intelligence/contracts";
import { evaluateProtection } from "@/lib/inbox/risk/protection-gate";
import { resolveChannelPolicyState } from "@/lib/channels/policy-state";
import { loadAgencyIsTest } from "@/lib/inbox/outbound/test-agency-send-guard";
import { outboundRecipientRefusal } from "@/lib/inbox/outbound/outbound-allowlist";

export type ProviderSendAuthor =
  | { kind: "AI"; source: AutomatedReplySource; action: AutomatedReplyAction }
  | { kind: "STAFF"; actorId: string };

export interface ProviderSendAuthorization {
  allowed: boolean;
  /** True for a disposable test agency: the send must go through the in-memory simulator, never a real provider (TASK-032). */
  simulated: boolean;
  reasons: string[];
  command: { text: string; metaTag?: "HUMAN_AGENT" };
  automatedAuthorization: AutomatedSendAuthorization | null;
}

interface ProviderSendFacts {
  /** `agencies.is_test`: a disposable test agency is sent through the simulator, never a real provider (TASK-032). */
  agencyIsTest: boolean;
  /** Why the outbound allow-list forbids this recipient, or null (TASK-032 S9). Ignored for a test agency, whose sends never leave the process. */
  recipientRefusal?: string | null;
  channel: string;
  state: string;
  handlingMode: string | null;
  assignedToId: string | null;
  serviceWindowExpiresAt: string | null;
  humanAgentWindowExpiresAt: string | null;
  hasOpenSupportCase: boolean;
  offer: MatchedOfferSnapshot | null;
  offerCheck: OfferCheckState | null;
  protection: Awaited<ReturnType<typeof loadProtectionContext>>;
}

const SUPPORT_REVIEW_KINDS = ["COMPLAINT", "DISTRESSED_CUSTOMER", "FRAUD_CONCERN", "MEDICAL_URGENCY", "REFUND_REQUEST"];

function numberAppears(text: string, value: number): boolean {
  const digits = String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return text.includes(String(Math.round(value))) || text.includes(digits);
}

export function mentionsStoredOfferFigure(text: string, offer: MatchedOfferSnapshot): boolean {
  if (numberAppears(text, offer.pricePerPerson) || (offer.totalPrice !== null && numberAppears(text, offer.totalPrice))) return true;
  return new RegExp(`\\b${offer.seatsMatched}\\s+(?:seat|seats|place|places)\\b`, "i").test(text);
}

export function evaluateProviderSend(input: {
  text: string;
  /** Everything the customer will read (email subject, file name as well as the text); the protection and offer-figure checks look at this. Defaults to `text`. */
  gateText?: string;
  author: ProviderSendAuthor;
  now: Date;
  facts: ProviderSendFacts;
  automatedAuthorization: AutomatedSendAuthorization | null;
}): ProviderSendAuthorization {
  const reasons: string[] = [];
  const { facts } = input;
  const humanActive = facts.state === "HUMAN_ACTIVE" || facts.handlingMode === "HUMAN_ACTIVE";

  if (!facts.agencyIsTest && facts.recipientRefusal) reasons.push(facts.recipientRefusal);

  if (input.author.kind === "STAFF") {
    if (!humanActive) reasons.push("Take control of this conversation before replying.");
    if (facts.assignedToId && facts.assignedToId !== input.author.actorId) reasons.push("This conversation is assigned to another staff member.");
    const protection = evaluateProtection({
      text: input.gateText ?? input.text,
      audience: "STAFF_SEND",
      openReviews: facts.protection.openReviews,
      approvedAccountDigits: facts.protection.approvedAccountDigits,
    });
    reasons.push(...protection.reasons.map((reason) => reason.message));
  } else if (!input.automatedAuthorization?.allowed) {
    reasons.push(...(input.automatedAuthorization?.reasons ?? ["The automated-send policy could not be confirmed."]));
  }

  const policy = resolveChannelPolicyState({
    channel: facts.channel,
    now: input.now,
    serviceWindowExpiresAt: facts.serviceWindowExpiresAt,
    humanAgentWindowExpiresAt: facts.humanAgentWindowExpiresAt,
    handlingMode: humanActive ? "HUMAN_ACTIVE" : (facts.handlingMode ?? facts.state),
    hasOpenSupportCase: facts.hasOpenSupportCase,
    author: input.author.kind === "STAFF" ? "HUMAN" : "AUTOMATION",
    projectedTemplateCharge: null,
    chargeCurrency: null,
  });
  if (policy.action === "BLOCKED" || policy.action === "APPROVED_TEMPLATE") reasons.push(policy.notice);

  if (facts.offer && mentionsStoredOfferFigure(input.gateText ?? input.text, facts.offer) && facts.offerCheck !== "FRESH") {
    reasons.push("The live offer changed or could not be verified. Refresh it before sending figures.");
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    allowed: reasons.length === 0,
    simulated: facts.agencyIsTest,
    reasons: uniqueReasons,
    command: { text: input.text, ...(policy.action === "HUMAN_AGENT" ? { metaTag: "HUMAN_AGENT" as const } : {}) },
    automatedAuthorization: input.automatedAuthorization
      ? { ...input.automatedAuthorization, allowed: uniqueReasons.length === 0, reasons: uniqueReasons }
      : null,
  };
}

/** The final, fail-closed decision immediately before an Inbox provider send. */
export async function authorizeProviderSend(db: Db, input: {
  agencyId: string;
  conversationId: string;
  text: string;
  /** See `evaluateProviderSend`. */
  gateText?: string;
  author: ProviderSendAuthor;
  now?: Date;
}): Promise<ProviderSendAuthorization> {
  const now = input.now ?? new Date();
  const [{ data: conversation, error: conversationError }, { data: supportCases, error: supportError }, { data: intelligence, error: intelligenceError }, protection, agencyIsTest] = await Promise.all([
    db.from("conversations")
      .select("channel,state,handling_mode,assigned_to_id,service_window_expires_at,human_agent_window_expires_at,external_conversation_id")
      .eq("agency_id", input.agencyId)
      .eq("id", input.conversationId)
      .single(),
    db.from("conversation_interventions")
      .select("id")
      .eq("agency_id", input.agencyId)
      .eq("conversation_id", input.conversationId)
      .in("status", ["OPEN", "ACKNOWLEDGED"])
      .in("kind", SUPPORT_REVIEW_KINDS)
      .limit(1),
    db.from("conversation_intelligence")
      .select("matched_offer")
      .eq("agency_id", input.agencyId)
      .eq("conversation_id", input.conversationId)
      .maybeSingle(),
    loadProtectionContext(db, input.agencyId, input.conversationId),
    loadAgencyIsTest(db, input.agencyId),
  ]);
  if (conversationError || !conversation) throw new Error(`Could not authorize provider send: ${conversationError?.message ?? "conversation not found"}`);
  if (supportError) throw new Error(`Could not authorize provider send: ${supportError.message}`);
  if (intelligenceError) throw new Error(`Could not authorize provider send: ${intelligenceError.message}`);

  const storedOffer = (intelligence as { matched_offer?: unknown } | null)?.matched_offer;
  const parsedOffer = matchedOfferSnapshotSchema.safeParse(storedOffer);
  if (storedOffer !== null && storedOffer !== undefined && !parsedOffer.success) throw new Error("Could not authorize provider send: the stored offer is invalid.");
  const offer = parsedOffer.success ? parsedOffer.data : null;
  const [automatedAuthorization, offerCheck] = await Promise.all([
    input.author.kind === "AI"
      ? authorizeAutomatedInboxSend(db, {
          agencyId: input.agencyId,
          conversationId: input.conversationId,
          text: input.text,
          source: input.author.source,
          action: input.author.action,
          now,
        })
      : Promise.resolve(null),
    offer ? checkStoredOffer(db, input.agencyId, offer, now.toISOString()) : Promise.resolve(null),
  ]);

  const row = conversation as {
    channel: string;
    state: string;
    handling_mode: string | null;
    assigned_to_id: string | null;
    service_window_expires_at: string | null;
    human_agent_window_expires_at: string | null;
    external_conversation_id: string | null;
  };
  return evaluateProviderSend({
    text: input.text,
    gateText: input.gateText,
    author: input.author,
    now,
    automatedAuthorization,
    facts: {
      agencyIsTest,
      recipientRefusal: outboundRecipientRefusal(row.external_conversation_id),
      channel: row.channel,
      state: row.state,
      handlingMode: row.handling_mode,
      assignedToId: row.assigned_to_id,
      serviceWindowExpiresAt: row.service_window_expires_at,
      humanAgentWindowExpiresAt: row.human_agent_window_expires_at,
      hasOpenSupportCase: (supportCases?.length ?? 0) > 0,
      offer,
      offerCheck,
      protection,
    },
  });
}
