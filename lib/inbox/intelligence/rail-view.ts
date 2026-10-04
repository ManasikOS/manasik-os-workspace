/**
 * What the Inbox context rail says about a conversation — MI2.5 of docs/inbox/implementation-plan.md
 * (Architecture §5.8: "what the UI may honestly say about a conversation's projection").
 *
 * Pure and client-safe: it turns the stored projection (or its absence) into plain-language rows, so the component is
 * a thin renderer and every honesty rule is tested here:
 *   - never an empty panel: with no reading yet, or one in progress, the rail still shows what is known for certain
 *     (the "deterministic half": channel, lead stage, the customer's language on file) plus "Copilot is reading this
 *     conversation";
 *   - a keyword reading is labelled as one — nothing rule-derived pretends to be AI;
 *   - a failed or skipped reading shows its note;
 *   - every model-derived fact carries the message it was read from, so staff can check it;
 *   - low confidence is said out loud.
 * A surface that is off and has no stored reading hides the rail entirely: the Inbox looks exactly as it did before.
 */

import { formatShortDate, OCCUPANCY_LABELS } from "@/lib/copilot/sales/format";
import { formatMoney } from "@/lib/copilot/sales/money";
import { canCloseIntervention } from "@/lib/inbox/risk/interventions";
import { canQuoteOffer, OFFER_CHECK_MESSAGES, RULE_ONLY_SIGNAL_CODES, TRAVEL_INTENT_FIELDS } from "@/lib/inbox/intelligence/contracts";
import type {
  ConversationIntelligence,
  Intervention,
  MatchedOfferSnapshot,
  OfferCheckState,
  TravelIntentField,
  ConversationSignal,
  Evidence,
  IntentCode,
  Sentiment,
  SignalCode,
  Urgency,
} from "@/lib/inbox/intelligence/contracts";

/** The rail's data, as loaded by `loadInboxIntelligence()`. */
export interface InboxIntelligenceData {
  /** `ai_surface_settings` for INBOX_TRIAGE: is the agency using it at all? */
  surfaceEnabled: boolean;
  intelligence: ConversationIntelligence | null;
  /** Live (not superseded) signals, newest first. */
  signals: ConversationSignal[];
  /** Reviews still demanding a person: OPEN or ACKNOWLEDGED (MI4.2). Absent in older callers. */
  interventions?: Intervention[];
  /** The customer message the reading was based on: the newest one at or before it was computed. */
  sourceMessage: { id: string; snippet: string; createdAt: string } | null;
  /**
   * R1: the stored offer compared with the live group, read when the rail loads. Absent when there is no offer;
   * `null` when there is one but the live group could not be read, which the card says out loud.
   */
  offerCheck?: OfferCheckState | null;
  /** Are the S4 risk detectors visible to staff? False while `INBOX_RISK` is in SHADOW (or off): their signals are recorded, not shown. */
  riskVisible?: boolean;
  /** How old the stored offer is, and the agency's limit (`offer_snapshot_max_age_minutes`). Display only (R1). */
  offerAge?: { minutes: number; limitMinutes: number } | null;
}

/** Facts that need no model: they come from the conversation and lead records. */
export interface RailDeterministicFacts {
  channelLabel: string | null;
  leadStage: string | null;
  preferredLanguage: string | null;
}

export type RailStatus = "PENDING" | "READY" | "STALE" | "SKIPPED" | "FAILED";

export interface RailEvidence {
  messageId: string | null;
  snippet: string;
}

export interface RailFact {
  key: "intent" | "urgency" | "sentiment" | "language";
  label: string;
  value: string;
  /** 0–100, or null when the stage does not report one. */
  confidencePercent: number | null;
  lowConfidence: boolean;
  /** Draws attention (urgent, angry, distressed). Drives the badge tone, never the wording. */
  attention: boolean;
  evidence: RailEvidence | null;
}

export interface RailSignal {
  code: SignalCode;
  label: string;
  evidence: RailEvidence[];
}

/** One travel detail S2 read (MI3.1): what it is, where each word came from, and who read it — per field, not per conversation. */
export interface RailTravelDetail {
  key: TravelIntentField;
  label: string;
  value: string;
  /** Says a keyword rule, not the model, read this detail; null when the model did. */
  sourceLabel: string | null;
  evidence: RailEvidence[];
}

export const TRAVEL_FIELD_LABELS: Record<TravelIntentField, string> = {
  journey: "Journey",
  travellers: "Travellers",
  window: "Travelling in",
  room: "Room",
  hotelDistance: "Hotel distance",
  budget: "Budget",
  origin: "Travelling from",
};

/** The best departure for this customer (S3, MI3.2), in words staff can read, and whether its figures are safe to quote. */
export interface RailOffer {
  departureGroupId: string;
  title: string;
  departureLabel: string;
  roomLabel: string | null;
  priceLabel: string;
  totalLabel: string | null;
  seatsLabel: string;
  fitLabel: string | null;
  recommendationReason: string | null;
  inclusions: string[];
  /** What to be aware of before recommending it. */
  constraints: string[];
  /** What the customer has not told us yet. */
  missing: string[];
  alternatives: Array<{ departureGroupId: string; label: string; priceLabel: string; seatsLabel: string }>;
  /** When the offer was worked out; the card says how old it is. */
  asOf: string;
  check: { state: OfferCheckState | null; message: string | null; canQuote: boolean };
  /** Set when the offer is older than the agency's limit. A reminder to look, never a reason to block: age alone does not stop a send. */
  ageNote: string | null;
}

const FIT_LABELS = { STRONG: "Strong fit", GOOD: "Good fit", PARTIAL: "Partial fit", WEAK: "Weak fit" } as const;
const UNCHECKED_MESSAGE = "Could not check that the price and seats are still current. Look at the group before you quote it.";

function seatsWords(count: number): string {
  return `${count} seat${count === 1 ? "" : "s"} open`;
}

function offerView(row: ConversationIntelligence | null, check: OfferCheckState | null | undefined, age: InboxIntelligenceData["offerAge"]): RailOffer | null {
  const offer: MatchedOfferSnapshot | null | undefined = row?.matchedOffer;
  if (!offer) return null;
  const state = check ?? null;
  const party = offer.party;
  const partyWords = party ? [`${party.adults} adult${party.adults === 1 ? "" : "s"}`, party.children ? `${party.children} child${party.children === 1 ? "" : "ren"}` : "", party.infants ? `${party.infants} infant${party.infants === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ") : null;
  return {
    departureGroupId: offer.departureGroupId,
    title: offer.groupName || "Best matching departure",
    departureLabel: [offer.departureDate ? `Departs ${formatShortDate(offer.departureDate)}` : null, offer.durationDays ? `${offer.durationDays} days` : null].filter(Boolean).join(" · "),
    roomLabel: offer.roomType ? OCCUPANCY_LABELS[offer.roomType] : null,
    priceLabel: `${formatMoney(offer.pricePerPerson, offer.currency)} per person`,
    totalLabel: offer.totalPrice !== null ? `${formatMoney(offer.totalPrice, offer.currency)}${partyWords ? ` for ${partyWords}` : " in total"}` : null,
    seatsLabel: seatsWords(offer.seatsMatched),
    fitLabel: offer.fitLevel ? FIT_LABELS[offer.fitLevel] : null,
    recommendationReason: offer.recommendationReason,
    inclusions: offer.inclusions,
    constraints: offer.constraints,
    missing: offer.missingInformation,
    alternatives: offer.alternatives.map((option) => ({
      departureGroupId: option.departureGroupId,
      label: [option.groupName, option.departureDate ? formatShortDate(option.departureDate) : null].filter(Boolean).join(" · "),
      priceLabel: `${formatMoney(option.pricePerPerson, offer.currency)} per person`,
      seatsLabel: seatsWords(option.seatsAvailable),
    })),
    asOf: offer.asOf,
    check: { state, message: state === null ? UNCHECKED_MESSAGE : OFFER_CHECK_MESSAGES[state], canQuote: state !== null && canQuoteOffer(state) },
    ageNote: age && age.minutes > age.limitMinutes ? `Worked out ${age.minutes >= 120 ? `${Math.round(age.minutes / 60)} hours` : `${age.minutes} minutes`} ago. Seats and price were checked again just now.` : null,
  };
}

/** A "human review required" card in words staff can act on (MI4.2). */
export interface RailIntervention {
  id: string;
  headline: string;
  guidance: string;
  /** The one thing that clears it, e.g. "Check the payment". */
  actionLabel: string;
  /** Who owns it, e.g. "Finance". */
  ownerLabel: string | null;
  /** Says who may close it when that is narrower than everyone. */
  closeHint: string | null;
  blocking: boolean;
  acknowledged: boolean;
}

const ACTION_LABELS: Partial<Record<string, string>> = {
  VERIFY_PAYMENT: "Check the payment",
  ESCALATE_TO_HUMAN: "Have a person handle this",
  OPEN_DEPARTURE_GROUP: "Check the departure",
  REQUEST_DOCUMENTS: "Ask for the documents",
  CREATE_BOOKING: "Check the booking",
};
const ROLE_LABELS: Record<string, string> = { ADMIN: "Admin", FINANCE: "Finance", MARKETING: "Sales", OPERATIONS: "Operations", VISA: "Visa" };

function interventionRows(reviews: readonly Intervention[] | undefined): RailIntervention[] {
  return (reviews ?? []).map((review) => ({
    id: review.id,
    headline: review.headline,
    guidance: review.guidance,
    actionLabel: ACTION_LABELS[review.requiredActionCode] ?? humaniseCode(review.requiredActionCode),
    ownerLabel: review.assignedRole ? (ROLE_LABELS[review.assignedRole] ?? humaniseCode(review.assignedRole)) : null,
    closeHint: canCloseIntervention("MARKETING", review.kind) ? null : "Only Finance or an Admin can close this.",
    blocking: review.severity === "BLOCK",
    acknowledged: review.status === "ACKNOWLEDGED",
  }));
}

export interface IntelligenceRailView {
  status: RailStatus;
  /** The one honest sentence at the top of the rail. */
  headline: string;
  /** Set when a rule, not the model, produced the reading. */
  sourceLabel: string | null;
  /** Why a reading is missing, weaker or rule-based. */
  note: string | null;
  facts: RailFact[];
  /** Travel details S2 read, in a fixed order; empty until S2 has run for this conversation. */
  travelDetails: RailTravelDetail[];
  /** The best departure (S3); null until S3 has found one. */
  offer: RailOffer | null;
  /** Reviews that need a person (MI4.2), blocking ones first. */
  interventions: RailIntervention[];
  signals: RailSignal[];
  deterministic: Array<{ label: string; value: string }>;
}

export const LOW_CONFIDENCE_BELOW = 0.6;

export const INTENT_LABELS: Record<IntentCode, string> = {
  PACKAGE_ENQUIRY: "Asking about packages",
  PRICE_REQUEST: "Asking for a price",
  BOOKING_REQUEST: "Wants to book",
  PAYMENT_CLAIM: "Says they have paid",
  DOCUMENT_ISSUE: "Passport or document question",
  VISA_QUERY: "Visa question",
  ITINERARY_QUERY: "Asking about the itinerary",
  COMPLAINT: "Complaint",
  CANCELLATION: "Wants to cancel or get a refund",
  GROUP_ENQUIRY: "Group enquiry",
  FAQ: "General question",
  SPAM: "Looks like spam",
  OTHER: "Something else",
};

export const URGENCY_LABELS: Record<Urgency, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", CRITICAL: "Critical" };

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  POSITIVE: "Positive",
  NEUTRAL: "Neutral",
  CONCERNED: "Concerned",
  ANGRY: "Angry",
  DISTRESSED: "Distressed",
};

const CHANNEL_LABELS: Record<string, string> = { WHATSAPP: "WhatsApp", MESSENGER: "Messenger", INSTAGRAM: "Instagram", EMAIL: "Email" };

export function channelLabelOf(channel: string | null | undefined): string | null {
  if (!channel) return null;
  return CHANNEL_LABELS[channel.toUpperCase()] ?? humaniseCode(channel);
}

const LANGUAGE_LABELS: Record<string, string> = { en: "English", si: "Sinhala", ta: "Tamil" };

/** Plain-language names for signals the pipeline can raise today; anything else is made readable from its code. */
export const SIGNAL_LABELS: Partial<Record<SignalCode, string>> = {
  REFUND_REQUEST: "Asked for a refund",
  DISTRESS_LANGUAGE: "Sounds distressed or in trouble",
  BANK_DETAIL_MISMATCH: "Mentioned a bank account we have not approved",
  PAYMENT_CLAIM_UNVERIFIED: "Says they paid, not yet checked",
  COMPLAINT_ESCALATION: "Complaint that needs escalating",
  FRAUD_CONCERN: "Worried about fraud",
  MEDICAL_URGENCY: "Medical urgency",
};

export function humaniseCode(code: string): string {
  const words = code.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function languageLabel(code: string | null): string | null {
  if (!code) return null;
  return LANGUAGE_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}

function evidenceFor(data: InboxIntelligenceData): RailEvidence | null {
  return data.sourceMessage ? { messageId: data.sourceMessage.id, snippet: data.sourceMessage.snippet } : null;
}

function deterministicRows(facts: RailDeterministicFacts): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (facts.channelLabel) rows.push({ label: "Channel", value: facts.channelLabel });
  if (facts.leadStage) rows.push({ label: "Lead stage", value: humaniseCode(facts.leadStage) });
  if (facts.preferredLanguage) rows.push({ label: "Language on file", value: languageLabel(facts.preferredLanguage) ?? facts.preferredLanguage });
  return rows;
}

function signalRows(signals: readonly ConversationSignal[]): RailSignal[] {
  const grouped = new Map<SignalCode, RailEvidence[]>();
  for (const signal of signals) {
    if (signal.supersededAt) continue;
    const list = grouped.get(signal.signalCode) ?? [];
    for (const item of signal.evidence as Evidence[]) list.push({ messageId: item.messageId, snippet: item.snippet });
    if (signal.evidence.length === 0 && signal.messageId) list.push({ messageId: signal.messageId, snippet: "" });
    grouped.set(signal.signalCode, list);
  }
  return [...grouped.entries()].map(([code, evidence]) => ({ code, label: SIGNAL_LABELS[code] ?? humaniseCode(code), evidence }));
}

/**
 * The S4 detectors (MI4.1) start in SHADOW: their signals are recorded so precision can be measured, but staff see them only
 * once the agency moves `INBOX_RISK` past SHADOW. The S0 red flags, and the bank-detail flag S0 has always raised, stay visible.
 */
export const SHADOW_HIDDEN_SIGNAL_CODES: readonly SignalCode[] = [
  ...RULE_ONLY_SIGNAL_CODES.filter((code) => code !== "BANK_DETAIL_MISMATCH"),
  // MI4.3: the four judgement flags start in shadow too.
  "COMPLAINT_ESCALATION",
  "FRAUD_CONCERN",
  "MEDICAL_URGENCY",
  "RELIGIOUS_RULING_REQUEST",
];

function visibleSignals(data: InboxIntelligenceData): ConversationSignal[] {
  if (data.riskVisible === true) return data.signals;
  // Anything the classifier (a model) raised stays out of sight in shadow, even under a code S0 also uses (distress).
  return data.signals.filter((signal) => !SHADOW_HIDDEN_SIGNAL_CODES.includes(signal.signalCode) && signal.detector !== "MODEL");
}

function travelDetailRows(row: ConversationIntelligence | null): RailTravelDetail[] {
  if (!row) return [];
  const details: RailTravelDetail[] = [];
  for (const key of TRAVEL_INTENT_FIELDS) {
    const reading = row.travelIntentEvidence[key];
    if (!reading) continue;
    details.push({
      key,
      label: TRAVEL_FIELD_LABELS[key],
      value: reading.value,
      sourceLabel: reading.source === "RULES" ? "Keyword match" : null,
      evidence: reading.evidence.map((item) => ({ messageId: item.messageId, snippet: item.snippet })),
    });
  }
  return details;
}

function factRows(row: ConversationIntelligence, evidence: RailEvidence | null): RailFact[] {
  const facts: RailFact[] = [];
  if (row.intentCode) {
    const confidence = row.intentConfidence;
    facts.push({
      key: "intent",
      label: "What they want",
      value: INTENT_LABELS[row.intentCode],
      confidencePercent: confidence === null ? null : Math.round(confidence * 100),
      lowConfidence: confidence !== null && confidence < LOW_CONFIDENCE_BELOW,
      attention: row.intentCode === "COMPLAINT" || row.intentCode === "CANCELLATION",
      evidence,
    });
  }
  facts.push({
    key: "urgency",
    label: "Urgency",
    value: URGENCY_LABELS[row.urgency],
    confidencePercent: null,
    lowConfidence: false,
    attention: row.urgency === "HIGH" || row.urgency === "CRITICAL",
    evidence,
  });
  facts.push({
    key: "sentiment",
    label: "How they feel",
    value: SENTIMENT_LABELS[row.sentiment],
    confidencePercent: null,
    lowConfidence: false,
    attention: row.sentiment === "ANGRY" || row.sentiment === "DISTRESSED",
    evidence,
  });
  const language = languageLabel(row.languageCode);
  if (language) {
    facts.push({ key: "language", label: "Writing in", value: language, confidencePercent: null, lowConfidence: false, attention: false, evidence });
  }
  return facts;
}

/** Null means "show nothing": the surface is off and there is no stored reading. */
export function buildIntelligenceRailView(data: InboxIntelligenceData, deterministic: RailDeterministicFacts): IntelligenceRailView | null {
  const row = data.intelligence;
  if (!row && !data.surfaceEnabled && !(data.interventions && data.interventions.length > 0)) return null;

  const base = { deterministic: deterministicRows(deterministic), signals: signalRows(visibleSignals(data)), travelDetails: travelDetailRows(row), offer: offerView(row, data.offerCheck, data.offerAge), interventions: interventionRows(data.interventions).sort((a, b) => Number(b.blocking) - Number(a.blocking)) };

  if (!row || row.state === "PENDING") {
    return { ...base, status: "PENDING", headline: "Copilot is reading this conversation", sourceLabel: null, note: null, facts: [] };
  }

  if (row.state === "FAILED") {
    return {
      ...base,
      status: "FAILED",
      headline: "Copilot could not read this conversation",
      sourceLabel: null,
      note: row.note ?? "The reading failed and no reason was recorded.",
      facts: [],
    };
  }

  if (row.state === "SKIPPED") {
    return {
      ...base,
      status: "SKIPPED",
      headline: "Copilot did not read this conversation",
      sourceLabel: null,
      note: row.note ?? "It was left out to save cost.",
      facts: [],
    };
  }

  const facts = factRows(row, evidenceFor(data));
  const isRules = row.source === "RULES";
  return {
    ...base,
    status: row.state === "STALE" ? "STALE" : "READY",
    headline: row.state === "STALE" ? "This reading may be out of date" : isRules ? "Keyword reading" : "Read by Copilot",
    sourceLabel: isRules ? "Keyword match, not the AI model" : null,
    note: row.note,
    facts,
  };
}
