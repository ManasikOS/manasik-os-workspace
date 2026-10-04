import type { ConversionKind } from "@/lib/inbox/conversions/catalogue";
import type { InboxIntelligenceData } from "@/lib/inbox/intelligence/rail-view";
import {
  canQuoteOffer,
  RULE_ONLY_SIGNAL_CODES,
  type IntentCode,
  type OfferCheckState,
  type SignalCode,
  type Urgency,
} from "@/lib/inbox/intelligence/contracts";

/**
 * The one thing staff most likely want to do next in a conversation, chosen from what Copilot has already read.
 * The composer shows this action first and tucks the rest behind "More actions", so staff are never handed every
 * option at once. It only ever suggests: each action still runs through its own server-side checks.
 */

export type NextActionPrimary = "DRAFT_REPLY" | "CREATE_QUOTE" | "CREATE_WORK" | "REVIEW_OFFER";

export type NextActionReasonCode =
  | "REPLY_RECOMMENDED"
  | "PAYMENT_REVIEW_REQUIRED"
  | "COMPLAINT_REQUIRES_OWNER"
  | "VISA_WORK_REQUIRED"
  | "DOCUMENT_WORK_REQUIRED"
  | "LIVE_OFFER_READY"
  | "OFFER_REVIEW_REQUIRED"
  | "OFFER_CHECK_REQUIRED"
  | "MATCHING_OFFER_REQUIRED";

export type NextActionDestination =
  | { kind: "COMPOSER_DRAFT" }
  | { kind: "QUOTE_DRAFT" }
  | { kind: "OFFER_REVIEW" }
  | { kind: "CONVERSION_REVIEW"; conversionKind: ConversionKind };

export interface NextBestAction {
  primary: NextActionPrimary;
  reasonCode: NextActionReasonCode;
  urgency: Urgency;
  destination: NextActionDestination;
  availability: { available: true; blocker: null } | { available: false; blocker: string };
  /** The conversion to highlight in "More actions" when the primary is CREATE_WORK, or as a secondary hint. */
  suggestedConversion: ConversionKind | null;
  /** The button words. */
  label: string;
  /** One plain sentence: why this is the suggestion. */
  reason: string;
}

export interface NextBestActionInput {
  intentCode: IntentCode | null;
  signalCodes: readonly SignalCode[];
  /** The stored offer's live check; null when there is no offer or it could not be checked. */
  offerCheck: OfferCheckState | null;
  hasOffer: boolean;
  urgency: Urgency;
}

const AVAILABLE = { available: true, blocker: null } as const;

function atLeastUrgency(urgency: Urgency, minimum: Urgency): Urgency {
  const rank: Record<Urgency, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };
  return rank[urgency] >= rank[minimum] ? urgency : minimum;
}

function draftAction(urgency: Urgency): NextBestAction {
  return {
    primary: "DRAFT_REPLY",
    reasonCode: "REPLY_RECOMMENDED",
    urgency,
    destination: { kind: "COMPOSER_DRAFT" },
    availability: AVAILABLE,
    suggestedConversion: null,
    label: "Draft with Copilot",
    reason: "Copilot can prepare a reply for you to edit before anything is sent.",
  };
}

function conversionAction(input: {
  reasonCode: NextActionReasonCode;
  urgency: Urgency;
  conversionKind: ConversionKind;
  label: string;
  reason: string;
}): NextBestAction {
  return {
    primary: "CREATE_WORK",
    reasonCode: input.reasonCode,
    urgency: input.urgency,
    destination: { kind: "CONVERSION_REVIEW", conversionKind: input.conversionKind },
    availability: AVAILABLE,
    suggestedConversion: input.conversionKind,
    label: input.label,
    reason: input.reason,
  };
}

const has = (codes: readonly SignalCode[], ...wanted: SignalCode[]) => wanted.some((code) => codes.includes(code));

function interventionSignalCodes(data: InboxIntelligenceData): SignalCode[] {
  const codes = new Set<SignalCode>();
  for (const intervention of data.interventions ?? []) {
    if (intervention.kind === "PAYMENT_CLAIM" || intervention.kind === "BANK_DETAIL_MISMATCH" || intervention.kind === "FRAUD_CONCERN") {
      codes.add("PAYMENT_CLAIM_UNVERIFIED");
    } else if (intervention.kind === "COMPLAINT" || intervention.kind === "REFUND_REQUEST" || intervention.kind === "DISTRESSED_CUSTOMER") {
      codes.add("COMPLAINT_ESCALATION");
    } else if (intervention.kind === "PASSPORT_EXPIRY") {
      codes.add("PASSPORT_EXPIRY_RISK");
    } else if (intervention.kind === "SENSITIVE_DOCUMENT") {
      codes.add("SENSITIVE_DOC_RECEIVED");
    }
  }
  return [...codes];
}

export function nextBestActionFor(input: NextBestActionInput): NextBestAction {
  const { intentCode, signalCodes } = input;

  // Risk first: a payment claim or a complaint is never answered as if it were an ordinary enquiry.
  if (intentCode === "PAYMENT_CLAIM" || has(signalCodes, "PAYMENT_CLAIM_UNVERIFIED")) {
    return conversionAction({ reasonCode: "PAYMENT_REVIEW_REQUIRED", urgency: atLeastUrgency(input.urgency, "HIGH"), conversionKind: "CONVERSATION_PAYMENT_FOLLOW_UP", label: "Follow up on payment", reason: "The customer says they paid. Finance must check it before anyone confirms." });
  }
  if (intentCode === "COMPLAINT" || intentCode === "CANCELLATION" || has(signalCodes, "COMPLAINT_ESCALATION", "REFUND_REQUEST")) {
    return conversionAction({ reasonCode: "COMPLAINT_REQUIRES_OWNER", urgency: atLeastUrgency(input.urgency, "HIGH"), conversionKind: "CONVERSATION_COMPLAINT_CASE", label: "Open a complaint case", reason: "The customer is unhappy or asking for a refund. Give the issue an owner and review it before creation." });
  }
  if (intentCode === "VISA_QUERY" || has(signalCodes, "PASSPORT_EXPIRY_RISK")) {
    return conversionAction({ reasonCode: "VISA_WORK_REQUIRED", urgency: atLeastUrgency(input.urgency, "NORMAL"), conversionKind: "CONVERSATION_VISA_TASK", label: "Create a visa task", reason: "This is a visa matter for the visa team. Review the task details before creation." });
  }
  if (intentCode === "DOCUMENT_ISSUE" || has(signalCodes, "SENSITIVE_DOC_RECEIVED")) {
    return conversionAction({ reasonCode: "DOCUMENT_WORK_REQUIRED", urgency: atLeastUrgency(input.urgency, "NORMAL"), conversionKind: "CONVERSATION_DOCUMENT_REQUEST", label: "Request documents", reason: "Documents are involved. Review what is missing before creating the request." });
  }

  // Commercial: a quote only when the price and seats behind it are current.
  if (intentCode === "PRICE_REQUEST") {
    if (!input.hasOffer) {
      return {
        primary: "CREATE_QUOTE",
        reasonCode: "MATCHING_OFFER_REQUIRED",
        urgency: input.urgency,
        destination: { kind: "QUOTE_DRAFT" },
        availability: { available: false, blocker: "Find a matching departure with live price and seats before creating a quote." },
        suggestedConversion: null,
        label: "Create quote",
        reason: "The customer wants a price, but there is no matching departure to quote safely.",
      };
    }
    if (input.hasOffer && input.offerCheck !== null && canQuoteOffer(input.offerCheck)) {
      return { primary: "CREATE_QUOTE", reasonCode: "LIVE_OFFER_READY", urgency: input.urgency, destination: { kind: "QUOTE_DRAFT" }, availability: AVAILABLE, suggestedConversion: null, label: "Create quote", reason: "The customer wants a price, and the departure's price and seats are current." };
    }
    if (input.offerCheck === null) {
      return {
        primary: "CREATE_QUOTE",
        reasonCode: "OFFER_CHECK_REQUIRED",
        urgency: atLeastUrgency(input.urgency, "HIGH"),
        destination: { kind: "QUOTE_DRAFT" },
        availability: { available: false, blocker: "Check the matching departure's live price and seats before creating a quote." },
        suggestedConversion: null,
        label: "Create quote",
        reason: "The customer wants a price, but the matching departure has not passed a live safety check.",
      };
    }
    return {
      primary: "REVIEW_OFFER",
      reasonCode: "OFFER_REVIEW_REQUIRED",
      urgency: atLeastUrgency(input.urgency, "HIGH"),
      destination: { kind: "OFFER_REVIEW" },
      availability: AVAILABLE,
      suggestedConversion: null,
      label: "Review changed offer",
      reason: "The price, seats, or availability changed. Review the live departure before quoting anything.",
    };
  }

  return draftAction(input.urgency);
}

/** Reads the inputs off Copilot's stored reading. Null while it is still loading, so the composer shows its plain default. */
export function nextBestActionFromIntelligence(data: InboxIntelligenceData | null): NextBestAction | null {
  if (!data) return null;
  // While the risk detectors are only being recorded (shadow mode), staff must not be steered by what they cannot see.
  const visibleSignals = data.riskVisible === false
    ? data.signals.filter((signal) => !(RULE_ONLY_SIGNAL_CODES as readonly SignalCode[]).includes(signal.signalCode))
    : data.signals;
  const signalCodes = [
    ...visibleSignals.map((signal) => signal.signalCode),
    ...interventionSignalCodes(data),
  ];
  return nextBestActionFor({
    intentCode: data.intelligence?.intentCode ?? null,
    signalCodes,
    offerCheck: data.offerCheck ?? null,
    hasOffer: Boolean(data.intelligence?.matchedOffer),
    urgency: data.intelligence?.urgency ?? "NORMAL",
  });
}
