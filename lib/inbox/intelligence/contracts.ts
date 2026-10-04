/**
 * Typed, provider-neutral contracts for the Inbox intelligence pipeline — MI0.2 of
 * docs/inbox/implementation-plan.md (Architecture §5, §6, §7).
 *
 * Every code that crosses a boundary (a model answer, a jsonb column, a queue name, a job kind) is a member
 * of a CLOSED `as const` list with a matching Zod enum, so:
 *   - a `switch` over one is exhaustively checked by the compiler;
 *   - an unknown code from a model or a stale row is rejected at the boundary, never trusted;
 *   - no later slice types an intent, signal or queue as a bare `string`.
 *
 * The lists mirror the SQL `check` constraints the Phase 2 migrations add. Extending one is additive:
 * add the code here, then in the migration that owns its column.
 *
 * Pure and client-safe — no server imports — because the rail, the queue list and the pipeline all share it.
 * `TravelIntent` is re-exported from `lib/copilot/sales/types.ts`, never redefined.
 */

import { z } from "zod";

import { travelIntentSchema } from "@/lib/copilot/sales/schemas";
import type { ReasoningSource, TravelIntent } from "@/lib/copilot/sales/types";

export type { ReasoningSource, TravelIntent };
export { travelIntentSchema };

/* ── Small helper so each list and its Zod enum can never drift apart ─────── */

/** Type guard built from a closed list. */
function isMemberOf<const Codes extends readonly string[]>(codes: Codes) {
  return (value: unknown): value is Codes[number] => typeof value === "string" && (codes as readonly string[]).includes(value);
}

/* ── S1 triage ────────────────────────────────────────────────────────────── */

export const INTENT_CODES = [
  "PACKAGE_ENQUIRY",
  "PRICE_REQUEST",
  "BOOKING_REQUEST",
  "PAYMENT_CLAIM",
  "DOCUMENT_ISSUE",
  "VISA_QUERY",
  "ITINERARY_QUERY",
  "COMPLAINT",
  "CANCELLATION",
  "GROUP_ENQUIRY",
  "FAQ",
  "SPAM",
  "OTHER",
] as const;
export type IntentCode = (typeof INTENT_CODES)[number];
export const intentCodeSchema = z.enum(INTENT_CODES);
export const isIntentCode = isMemberOf(INTENT_CODES);

/** The intents S2 (structured travel intent) runs for — Architecture §6 S2. */
export const COMMERCIAL_INTENT_CODES = ["PACKAGE_ENQUIRY", "PRICE_REQUEST", "BOOKING_REQUEST", "GROUP_ENQUIRY"] as const satisfies readonly IntentCode[];

export const URGENCIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type Urgency = (typeof URGENCIES)[number];
export const urgencySchema = z.enum(URGENCIES);

export const SENTIMENTS = ["POSITIVE", "NEUTRAL", "CONCERNED", "ANGRY", "DISTRESSED"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
export const sentimentSchema = z.enum(SENTIMENTS);

export const COMMERCIAL_STAGES = ["UNQUALIFIED", "QUALIFYING", "READY_TO_RECOMMEND", "QUOTE_SENT", "BOOKING_READY", "BOOKED", "LOST"] as const;
export type CommercialStage = (typeof COMMERCIAL_STAGES)[number];
export const commercialStageSchema = z.enum(COMMERCIAL_STAGES);

/** `BLOCK` means no Copilot draft is offered at all (Architecture §5.1). */
export const RISK_LEVELS = ["NONE", "REVIEW", "BLOCK"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const riskLevelSchema = z.enum(RISK_LEVELS);

/** Where a value came from. Staff always see which — nothing rule-derived pretends to be AI. */
export const REASONING_SOURCES = ["RULES", "LLM"] as const satisfies readonly ReasoningSource[];
export const reasoningSourceSchema = z.enum(REASONING_SOURCES);

/** What the UI may honestly say about a conversation's projection (Architecture §5.8). */
export const INTELLIGENCE_STATES = ["PENDING", "FRESH", "STALE", "SKIPPED", "FAILED"] as const;
export type IntelligenceState = (typeof INTELLIGENCE_STATES)[number];
export const intelligenceStateSchema = z.enum(INTELLIGENCE_STATES);

/**
 * One value per action button the rail can show (Architecture §5.1: "closed enum mapping 1:1 to an action
 * button"). The four PDF actions on an offer card are OPEN_DEPARTURE_GROUP, CREATE_QUOTE, SEND_BROCHURE and
 * HOLD_SEATS.
 */
export const NEXT_ACTION_CODES = [
  "DRAFT_REPLY",
  "ASK_QUALIFYING_QUESTION",
  "OPEN_DEPARTURE_GROUP",
  "CREATE_QUOTE",
  "SEND_BROCHURE",
  "HOLD_SEATS",
  "CREATE_BOOKING",
  "REQUEST_DOCUMENTS",
  "VERIFY_PAYMENT",
  "REVIEW_IDENTITY_MATCH",
  "ESCALATE_TO_HUMAN",
  "ASSIGN_OWNER",
  "FOLLOW_UP_LATER",
  "RESOLVE_CONVERSATION",
  "NO_ACTION",
] as const;
export type NextActionCode = (typeof NEXT_ACTION_CODES)[number];
export const nextActionCodeSchema = z.enum(NEXT_ACTION_CODES);

/* ── S2 structured travel intent ──────────────────────────────────────────── */

/**
 * The facts S2 reads out of a conversation, each stored with the words it came from and who read it (Architecture §6 S2).
 * `TravelIntent` itself has no slot for where the customer is travelling from, and it carries evidence only as loose text,
 * so the Inbox keeps this per-field map beside it.
 */
export const TRAVEL_INTENT_FIELDS = ["journey", "travellers", "window", "room", "hotelDistance", "budget", "origin"] as const;
export type TravelIntentField = (typeof TRAVEL_INTENT_FIELDS)[number];
export const travelIntentFieldSchema = z.enum(TRAVEL_INTENT_FIELDS);

/** One fact, in plain words, with its source. `RULES` = a keyword rule read it; `LLM` = the model did, and quoted the customer. */
export const travelFieldReadingSchema = z.object({
  source: z.enum(["RULES", "LLM"]),
  value: z.string().min(1).max(120),
  evidence: z.array(z.object({ messageId: z.string().uuid().nullable(), snippet: z.string().max(300) })).max(4),
});
export type TravelFieldReading = z.infer<typeof travelFieldReadingSchema>;

export const travelIntentEvidenceSchema = z.partialRecord(travelIntentFieldSchema, travelFieldReadingSchema);
export type TravelIntentEvidence = z.infer<typeof travelIntentEvidenceSchema>;

/* ── S0 gate ─────────────────────────────────────────────────────────────── */

/** Why the gate let a message through to enrichment. */
export const GATE_ENRICH_REASONS = ["ENRICH_NEW_CONVERSATION", "ENRICH_NEW_MESSAGE"] as const;

/** Why the gate skipped enrichment — every skip carries exactly one (Architecture §6 S0). */
export const GATE_SKIP_REASONS = [
  "SKIP_SURFACE_OFF",
  "SKIP_ENTITLEMENT_EXHAUSTED",
  "SKIP_SPAM",
  "SKIP_CLOSED",
  "SKIP_HUMAN_ACTIVE",
  "SKIP_UNCHANGED_INPUT",
  "SKIP_ACKNOWLEDGEMENT",
] as const;

export const GATE_REASONS = [...GATE_ENRICH_REASONS, ...GATE_SKIP_REASONS] as const;
export type GateReason = (typeof GATE_REASONS)[number];
export const gateReasonSchema = z.enum(GATE_REASONS);

/** Signals a rule can raise from message text alone, which force a risk scan even when enrichment is skipped. */
export const GATE_RED_FLAGS = ["REFUND_REQUEST", "DISTRESS_LANGUAGE", "BANK_DETAIL_MISMATCH"] as const satisfies readonly SignalCode[];
export type GateRedFlag = (typeof GATE_RED_FLAGS)[number];

/* ── S4 signals and interventions ─────────────────────────────────────────── */

export const SIGNAL_DETECTORS = ["RULE", "MODEL"] as const;
export type SignalDetector = (typeof SIGNAL_DETECTORS)[number];
export const signalDetectorSchema = z.enum(SIGNAL_DETECTORS);

/** Architecture §5.2 plus the fifteen S4 detectors (§6) and the SLA clock (§16 R2). */
export const SIGNAL_CODES = [
  // commercial
  "INSTALMENT_INTEREST",
  "GROUP_BOOKING_12_PLUS",
  "PRE_RAMADAN_DEADLINE",
  "SEAT_RESERVATION_INTENT",
  // rule-only risk detectors
  "PAYMENT_CLAIM_UNVERIFIED",
  "BANK_DETAIL_MISMATCH",
  "STALE_PRICE_QUOTED",
  "GROUP_FULL_REQUESTED",
  "PASSPORT_EXPIRY_RISK",
  "WINDOW_CLOSING_SOON",
  "CONCURRENT_COMPOSER",
  "LOW_CONFIDENCE_DRAFT",
  "SENSITIVE_DOC_RECEIVED",
  "MINOR_OR_ASSISTANCE_NEEDED",
  "UNRECORDED_BOOKING_CLAIM",
  // S0 rule-level red flags
  "REFUND_REQUEST",
  "DISTRESS_LANGUAGE",
  // the four judgement cases that need language understanding
  "COMPLAINT_ESCALATION",
  "FRAUD_CONCERN",
  "MEDICAL_URGENCY",
  "RELIGIOUS_RULING_REQUEST",
  // clock
  "SLA_BREACHED",
] as const;
export type SignalCode = (typeof SIGNAL_CODES)[number];
export const signalCodeSchema = z.enum(SIGNAL_CODES);
export const isSignalCode = isMemberOf(SIGNAL_CODES);

/** Signals a rule must be able to raise with no model call at all (Architecture §6 S4: "eleven detectors"; plus the S0 red flags). */
export const RULE_ONLY_SIGNAL_CODES = [
  "PAYMENT_CLAIM_UNVERIFIED",
  "BANK_DETAIL_MISMATCH",
  "STALE_PRICE_QUOTED",
  "GROUP_FULL_REQUESTED",
  "PASSPORT_EXPIRY_RISK",
  "WINDOW_CLOSING_SOON",
  "CONCURRENT_COMPOSER",
  "LOW_CONFIDENCE_DRAFT",
  "SENSITIVE_DOC_RECEIVED",
  "MINOR_OR_ASSISTANCE_NEEDED",
  "UNRECORDED_BOOKING_CLAIM",
] as const satisfies readonly SignalCode[];

/** A signal is an observation; an intervention is a demand (Architecture §5.3). */
export const INTERVENTION_KINDS = [
  "PAYMENT_CLAIM",
  "BANK_DETAIL_MISMATCH",
  "STALE_PRICE",
  "GROUP_FULL",
  "PASSPORT_EXPIRY",
  "REFUND_REQUEST",
  "DISTRESSED_CUSTOMER",
  "COMPLAINT",
  "FRAUD_CONCERN",
  "MEDICAL_URGENCY",
  "RELIGIOUS_RULING",
  "SENSITIVE_DOCUMENT",
  "ASSISTANCE_NEEDED",
  "UNRECORDED_BOOKING",
  "SLA_BREACH",
] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];
export const interventionKindSchema = z.enum(INTERVENTION_KINDS);

export const INTERVENTION_SEVERITIES = ["REVIEW", "BLOCK"] as const;
export type InterventionSeverity = (typeof INTERVENTION_SEVERITIES)[number];
export const interventionSeveritySchema = z.enum(INTERVENTION_SEVERITIES);

export const INTERVENTION_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"] as const;
export type InterventionStatus = (typeof INTERVENTION_STATUSES)[number];
export const interventionStatusSchema = z.enum(INTERVENTION_STATUSES);

/** An intervention still demanding attention. The protection gate keys off exactly these. */
export const OPEN_INTERVENTION_STATUSES = ["OPEN", "ACKNOWLEDGED"] as const satisfies readonly InterventionStatus[];

/* ── Queues (Architecture §5.4, §16 R2) ───────────────────────────────────── */

export const QUEUE_GROUPS = ["INBOX", "COMMERCIAL", "OPERATIONS", "CHANNELS"] as const;
export type QueueGroup = (typeof QUEUE_GROUPS)[number];

export const QUEUE_CODES = [
  // Inbox
  "ALL",
  "MINE",
  "UNASSIGNED",
  "NEEDS_REPLY",
  "WAITING_CUSTOMER",
  "WAITING_TEAM",
  "RESOLVED",
  // Commercial
  "NEW_ENQUIRIES",
  "QUALIFIED",
  "BOOKING_READY",
  "QUOTE_SENT",
  "PAYMENT_DISCUSSIONS",
  // Operations
  "DOCUMENTS",
  "VISA_ISSUES",
  "DEPARTURE_CHANGES",
  "GROUP_CHANGES",
  "COMPLAINTS",
  "ESCALATIONS",
  // Deadline views (MI2.6)
  "NEARING_DEADLINE",
  "SLA_BREACHED",
  // Channels
  "WHATSAPP",
  "INSTAGRAM",
  "MESSENGER",
  "EMAIL",
  // Legacy views that must map onto a queue code (MI2.2): a lead marked spam
  "SPAM",
] as const;
export type QueueCode = (typeof QUEUE_CODES)[number];
export const queueCodeSchema = z.enum(QUEUE_CODES);
export const isQueueCode = isMemberOf(QUEUE_CODES);

/** Queues whose clock is paused — a conversation parked on the customer or the team never breaches (§16 R2 rule 2). */
export const CLOCK_PAUSED_QUEUE_CODES = ["WAITING_CUSTOMER", "WAITING_TEAM", "RESOLVED"] as const satisfies readonly QueueCode[];

/** The only queues whose breach opens an intervention (§16 R2 rule 3). */
export const SLA_INTERVENTION_QUEUE_CODES = ["ESCALATIONS", "COMPLAINTS", "PAYMENT_DISCUSSIONS", "BOOKING_READY"] as const satisfies readonly QueueCode[];

/* ── Work lanes and jobs (Architecture §5.7, §7.2) ────────────────────────── */

/**
 * The autonomy ladder from Architecture §10.1: L0 observe, L1 assist, L2 safe automate, L3 bounded autonomous intake. The
 * never-autonomous list is refused at every level, so no level can unlock it. MI6.1 builds the ladder's controls on this type.
 */
export const AUTONOMY_LEVELS = ["L0", "L1", "L2", "L3"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const WORK_LANES = ["REALTIME", "STANDARD", "BULK"] as const;
export type WorkLane = (typeof WORK_LANES)[number];
export const workLaneSchema = z.enum(WORK_LANES);

export const CHANNEL_JOB_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED", "DEAD"] as const;
export type ChannelJobStatus = (typeof CHANNEL_JOB_STATUSES)[number];

/**
 * Every job the lane workers may run. ENRICH is the S0→S1 pipeline (MI2.4); the others are added by the slice
 * that owns their handler, and each names its lane in `LANE_FOR_JOB_KIND` so a kind can never land on the wrong one.
 */
export const JOB_KINDS = [
  "ENRICH",
  "IDENTITY_MATCH",
  "OFFER_MATCH",
  "RISK_SCAN",
  "QUEUE_REFRESH",
  "HANDOFF_SUMMARY",
  "TRANSCRIBE_VOICE",
  "READ_DOCUMENT",
  "EXTRACT_RECEIPT",
  "EMBED_KNOWLEDGE",
  "RETENTION_SWEEP",
  "USAGE_ROLLUP",
  "REPLAY",
  /** The assistant's reply to a customer (Q1). REALTIME: the customer is waiting on it. */
  "REPLY",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const jobKindSchema = z.enum(JOB_KINDS);

export const LANE_FOR_JOB_KIND: Record<JobKind, WorkLane> = {
  ENRICH: "REALTIME",
  IDENTITY_MATCH: "REALTIME",
  OFFER_MATCH: "STANDARD",
  RISK_SCAN: "STANDARD",
  QUEUE_REFRESH: "STANDARD",
  HANDOFF_SUMMARY: "STANDARD",
  TRANSCRIBE_VOICE: "BULK",
  READ_DOCUMENT: "BULK",
  EXTRACT_RECEIPT: "BULK",
  EMBED_KNOWLEDGE: "BULK",
  RETENTION_SWEEP: "BULK",
  USAGE_ROLLUP: "BULK",
  REPLAY: "BULK",
  REPLY: "REALTIME",
};

/* ── Row shapes ───────────────────────────────────────────────────────────── */

/** `numeric(3,2)` in SQL: a confidence is 0..1, shown to staff and never hidden. */
export const confidenceSchema = z.number().min(0).max(1);

const isoTimestampSchema = z.string().min(1);

/** A message the fact was read from — every fact shown to staff links back to one. */
export const evidenceSchema = z.object({
  messageId: z.string().uuid().nullable(),
  snippet: z.string().max(300),
});
export type Evidence = z.infer<typeof evidenceSchema>;

/** A runner-up the offer card lists under the best option. */
export const offerAlternativeSchema = z.object({
  departureGroupId: z.string().uuid(),
  groupName: z.string(),
  departureDate: z.string().nullable(),
  roomType: z.enum(["QUAD", "TRIPLE", "DOUBLE", "SINGLE"]).nullable(),
  pricePerPerson: z.number().nonnegative(),
  seatsAvailable: z.number().int().nonnegative(),
});
export type OfferAlternative = z.infer<typeof offerAlternativeSchema>;

/**
 * The matched-offer snapshot. `pricedAt` and `seatsMatched` (with `asOf`) are what R1's change-detection compares
 * (Architecture §16 R1). Everything after `inclusions` is what the offer card shows; each has a default so a snapshot
 * written before MI3.2 still parses.
 */
export const matchedOfferSnapshotSchema = z.object({
  departureGroupId: z.string().uuid(),
  packageId: z.string().uuid().nullable(),
  seatsMatched: z.number().int().nonnegative(),
  roomType: z.enum(["QUAD", "TRIPLE", "DOUBLE", "SINGLE"]).nullable(),
  pricePerPerson: z.number().nonnegative(),
  currency: z.string().length(3),
  pricedAt: isoTimestampSchema,
  asOf: isoTimestampSchema,
  inclusions: z.array(z.string()),
  groupName: z.string().default(""),
  departureDate: z.string().nullable().default(null),
  returnDate: z.string().nullable().default(null),
  durationDays: z.number().int().nullable().default(null),
  totalPrice: z.number().nonnegative().nullable().default(null),
  /** Who the price was worked out for; the seat check compares the live seats with this. */
  party: z.object({ adults: z.number().int().nonnegative(), children: z.number().int().nonnegative(), infants: z.number().int().nonnegative() }).nullable().default(null),
  fitLevel: z.enum(["STRONG", "GOOD", "PARTIAL", "WEAK"]).nullable().default(null),
  recommendationReason: z.string().nullable().default(null),
  /** Why it fits (matchReasons), what to be aware of (tradeoffs), and what the customer has not told us yet. */
  reasons: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
  alternatives: z.array(offerAlternativeSchema).default([]),
  /** The early-bird price's last day, when the group has one; the seven-day warning reads this. */
  earlyBirdValidUntil: z.string().nullable().default(null),
});
export type MatchedOfferSnapshot = z.infer<typeof matchedOfferSnapshotSchema>;

/** What a stored offer is worth right now, compared with the live group (R1). */
export const OFFER_CHECK_STATES = ["FRESH", "PRICE_CHANGED", "SEATS_INSUFFICIENT", "EARLY_BIRD_EXPIRING", "NO_LONGER_AVAILABLE"] as const;
export type OfferCheckState = (typeof OFFER_CHECK_STATES)[number];

/** Plain words for the offer card's banner. `null` for FRESH: nothing to warn about. */
export const OFFER_CHECK_MESSAGES: Record<OfferCheckState, string | null> = {
  FRESH: null,
  PRICE_CHANGED: "The price changed after this offer was worked out. Refresh before you quote it.",
  SEATS_INSUFFICIENT: "There are not enough seats left for this party. Check the group before you promise anything.",
  EARLY_BIRD_EXPIRING: "The early-bird price ends soon. Tell the customer the deadline.",
  NO_LONGER_AVAILABLE: "This departure is no longer open for sale.",
};

/** Figures may be put in front of a customer only while the offer is current. */
export function canQuoteOffer(state: OfferCheckState): boolean {
  return state === "FRESH" || state === "EARLY_BIRD_EXPIRING";
}

/** One row of `conversation_intelligence` — the projection the whole UI reads (Architecture §5.1). */
export const conversationIntelligenceSchema = z.object({
  conversationId: z.string().uuid(),
  intentCode: intentCodeSchema.nullable(),
  intentConfidence: confidenceSchema.nullable(),
  travelIntent: travelIntentSchema.nullable(),
  urgency: urgencySchema,
  commercialStage: commercialStageSchema,
  sentiment: sentimentSchema,
  estimatedValueCents: z.number().int().nonnegative().nullable(),
  estimatedValueCurrency: z.string().length(3).nullable(),
  riskLevel: riskLevelSchema,
  nextActionCode: nextActionCodeSchema,
  languageCode: z.string().min(2).max(8).nullable(),
  summary: z.string().nullable(),
  /** Rolling ~400-token digest S1 reads instead of the thread (MI2.4). Model input only — never shown to staff as a fact. */
  digest: z.string().nullable().default(null),
  /** Per-field S2 readings with evidence and source (MI3.1). Empty until S2 has run. */
  travelIntentEvidence: travelIntentEvidenceSchema.default({}),
  openQuestions: z.array(z.string()),
  matchedOffer: matchedOfferSnapshotSchema.nullable(),
  source: reasoningSourceSchema,
  state: intelligenceStateSchema,
  /** Populated whenever `source = 'RULES'` because a model failed, or `state = 'FAILED'`. */
  note: z.string().nullable(),
  pipelineVersion: z.number().int().positive(),
  inputFingerprint: z.string().min(1),
  computedAt: isoTimestampSchema,
  staleAt: isoTimestampSchema.nullable(),
  aiRunId: z.string().uuid().nullable(),
});
export type ConversationIntelligence = z.infer<typeof conversationIntelligenceSchema>;

/** One row of `conversation_signals` (Architecture §5.2). Append-only; superseded, never deleted. */
export const conversationSignalSchema = z.object({
  conversationId: z.string().uuid(),
  signalCode: signalCodeSchema,
  messageId: z.string().uuid().nullable(),
  detector: signalDetectorSchema,
  confidence: confidenceSchema,
  evidence: z.array(evidenceSchema),
  supersededAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
});
export type ConversationSignal = z.infer<typeof conversationSignalSchema>;

/** One row of `conversation_interventions` (Architecture §5.3). */
export const interventionSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  kind: interventionKindSchema,
  severity: interventionSeveritySchema,
  headline: z.string().min(1),
  guidance: z.string().min(1),
  requiredActionCode: nextActionCodeSchema,
  assignedRole: z.string().nullable(),
  assignedToId: z.string().uuid().nullable(),
  status: interventionStatusSchema,
  resolvedBy: z.string().uuid().nullable(),
  resolutionNote: z.string().nullable(),
  sourceSignalIds: z.array(z.string().uuid()),
  createdAt: isoTimestampSchema,
  resolvedAt: isoTimestampSchema.nullable(),
});
export type Intervention = z.infer<typeof interventionSchema>;

/** Architecture §5.9. `summary` and `openItems` are computed from CRM state; the model only narrates expectations and sentiment. */
export const handoffSummarySchema = z.object({
  conversationId: z.string().uuid(),
  bookingId: z.string().uuid().nullable(),
  fromTeam: z.string().min(1),
  toTeam: z.string().min(1),
  summary: z.record(z.string(), z.unknown()),
  openItems: z.array(z.object({ code: z.string().min(1), label: z.string().min(1), count: z.number().int().nonnegative() })),
  customerExpectations: z.array(z.string()),
  sentiment: sentimentSchema.nullable(),
});
export type HandoffSummary = z.infer<typeof handoffSummarySchema>;

/** A queued unit of pipeline work. `coalesceKey` collapses a burst into one row (Architecture §7.3). */
export const channelJobSchema = z.object({
  agencyId: z.string().uuid(),
  lane: workLaneSchema,
  kind: jobKindSchema,
  coalesceKey: z.string().min(1).nullable(),
  payload: z.record(z.string(), z.unknown()),
  priority: z.number().int(),
  runAfter: isoTimestampSchema,
});
export type ChannelJobInput = z.infer<typeof channelJobSchema>;
