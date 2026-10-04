import { describe, expect, it } from "vitest";

import {
  CLOCK_PAUSED_QUEUE_CODES,
  COMMERCIAL_INTENT_CODES,
  COMMERCIAL_STAGES,
  INTELLIGENCE_STATES,
  INTENT_CODES,
  INTERVENTION_KINDS,
  INTERVENTION_STATUSES,
  JOB_KINDS,
  LANE_FOR_JOB_KIND,
  NEXT_ACTION_CODES,
  OPEN_INTERVENTION_STATUSES,
  QUEUE_CODES,
  RISK_LEVELS,
  RULE_ONLY_SIGNAL_CODES,
  SENTIMENTS,
  SIGNAL_CODES,
  SLA_INTERVENTION_QUEUE_CODES,
  URGENCIES,
  WORK_LANES,
  channelJobSchema,
  commercialStageSchema,
  conversationIntelligenceSchema,
  conversationSignalSchema,
  intentCodeSchema,
  interventionKindSchema,
  interventionSchema,
  isIntentCode,
  isQueueCode,
  isSignalCode,
  jobKindSchema,
  matchedOfferSnapshotSchema,
  nextActionCodeSchema,
  queueCodeSchema,
  riskLevelSchema,
  sentimentSchema,
  signalCodeSchema,
  travelIntentSchema,
  urgencySchema,
  workLaneSchema,
  type CommercialStage,
  type IntentCode,
  type InterventionKind,
  type JobKind,
  type NextActionCode,
  type QueueCode,
  type RiskLevel,
  type Sentiment,
  type SignalCode,
  type TravelIntent,
  type Urgency,
  type WorkLane,
} from "./contracts";

const UUID = "3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const UUID_B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

/** Compile-time exhaustiveness: adding a code to a list without handling it here fails `tsc`. */
function assertNever(value: never): never {
  throw new Error(`Unhandled code ${String(value)}`);
}

// Each switch below has no `default` other than assertNever, so the compiler proves it covers the whole union.
function labelIntent(code: IntentCode): string {
  switch (code) {
    case "PACKAGE_ENQUIRY": case "PRICE_REQUEST": case "BOOKING_REQUEST": case "PAYMENT_CLAIM": case "DOCUMENT_ISSUE":
    case "VISA_QUERY": case "ITINERARY_QUERY": case "COMPLAINT": case "CANCELLATION": case "GROUP_ENQUIRY":
    case "FAQ": case "SPAM": case "OTHER":
      return code;
    default:
      return assertNever(code);
  }
}
function labelUrgency(value: Urgency): string {
  switch (value) {
    case "LOW": case "NORMAL": case "HIGH": case "CRITICAL": return value;
    default: return assertNever(value);
  }
}
function labelSentiment(value: Sentiment): string {
  switch (value) {
    case "POSITIVE": case "NEUTRAL": case "CONCERNED": case "ANGRY": case "DISTRESSED": return value;
    default: return assertNever(value);
  }
}
function labelStage(value: CommercialStage): string {
  switch (value) {
    case "UNQUALIFIED": case "QUALIFYING": case "READY_TO_RECOMMEND": case "QUOTE_SENT": case "BOOKING_READY": case "BOOKED": case "LOST": return value;
    default: return assertNever(value);
  }
}
function labelRisk(value: RiskLevel): string {
  switch (value) {
    case "NONE": case "REVIEW": case "BLOCK": return value;
    default: return assertNever(value);
  }
}
function labelLane(value: WorkLane): string {
  switch (value) {
    case "REALTIME": case "STANDARD": case "BULK": return value;
    default: return assertNever(value);
  }
}
function labelJob(value: JobKind): string {
  switch (value) {
    case "ENRICH": case "IDENTITY_MATCH": case "OFFER_MATCH": case "RISK_SCAN": case "QUEUE_REFRESH": case "HANDOFF_SUMMARY":
    case "TRANSCRIBE_VOICE": case "READ_DOCUMENT": case "EXTRACT_RECEIPT": case "EMBED_KNOWLEDGE": case "RETENTION_SWEEP":
    case "USAGE_ROLLUP": case "REPLAY": case "REPLY":
      return value;
    default: return assertNever(value);
  }
}
function labelIntervention(value: InterventionKind): string {
  switch (value) {
    case "PAYMENT_CLAIM": case "BANK_DETAIL_MISMATCH": case "STALE_PRICE": case "GROUP_FULL": case "PASSPORT_EXPIRY":
    case "REFUND_REQUEST": case "DISTRESSED_CUSTOMER": case "COMPLAINT": case "FRAUD_CONCERN": case "MEDICAL_URGENCY":
    case "RELIGIOUS_RULING": case "SENSITIVE_DOCUMENT": case "ASSISTANCE_NEEDED": case "UNRECORDED_BOOKING": case "SLA_BREACH":
      return value;
    default: return assertNever(value);
  }
}
function labelNextAction(value: NextActionCode): string {
  switch (value) {
    case "DRAFT_REPLY": case "ASK_QUALIFYING_QUESTION": case "OPEN_DEPARTURE_GROUP": case "CREATE_QUOTE": case "SEND_BROCHURE":
    case "HOLD_SEATS": case "CREATE_BOOKING": case "REQUEST_DOCUMENTS": case "VERIFY_PAYMENT": case "REVIEW_IDENTITY_MATCH":
    case "ESCALATE_TO_HUMAN": case "ASSIGN_OWNER": case "FOLLOW_UP_LATER": case "RESOLVE_CONVERSATION": case "NO_ACTION":
      return value;
    default: return assertNever(value);
  }
}
function labelQueue(value: QueueCode): string {
  switch (value) {
    case "ALL": case "MINE": case "UNASSIGNED": case "NEEDS_REPLY": case "WAITING_CUSTOMER": case "WAITING_TEAM": case "RESOLVED":
    case "NEW_ENQUIRIES": case "QUALIFIED": case "BOOKING_READY": case "QUOTE_SENT": case "PAYMENT_DISCUSSIONS":
    case "DOCUMENTS": case "VISA_ISSUES": case "DEPARTURE_CHANGES": case "GROUP_CHANGES": case "COMPLAINTS": case "ESCALATIONS":
    case "NEARING_DEADLINE": case "SLA_BREACHED": case "WHATSAPP": case "INSTAGRAM": case "MESSENGER": case "EMAIL": case "SPAM":
      return value;
    default: return assertNever(value);
  }
}
function labelSignal(value: SignalCode): string {
  switch (value) {
    case "INSTALMENT_INTEREST": case "GROUP_BOOKING_12_PLUS": case "PRE_RAMADAN_DEADLINE": case "SEAT_RESERVATION_INTENT":
    case "PAYMENT_CLAIM_UNVERIFIED": case "BANK_DETAIL_MISMATCH": case "STALE_PRICE_QUOTED": case "GROUP_FULL_REQUESTED":
    case "PASSPORT_EXPIRY_RISK": case "WINDOW_CLOSING_SOON": case "CONCURRENT_COMPOSER": case "LOW_CONFIDENCE_DRAFT":
    case "SENSITIVE_DOC_RECEIVED": case "MINOR_OR_ASSISTANCE_NEEDED": case "UNRECORDED_BOOKING_CLAIM": case "REFUND_REQUEST":
    case "DISTRESS_LANGUAGE": case "COMPLAINT_ESCALATION": case "FRAUD_CONCERN": case "MEDICAL_URGENCY":
    case "RELIGIOUS_RULING_REQUEST": case "SLA_BREACHED":
      return value;
    default: return assertNever(value);
  }
}

describe("closed enums are exhaustively switchable and match their Zod schema", () => {
  const cases: Array<[string, readonly string[], (code: never) => string, { safeParse: (v: unknown) => { success: boolean } }]> = [
    ["intent", INTENT_CODES, labelIntent as (code: never) => string, intentCodeSchema],
    ["urgency", URGENCIES, labelUrgency as (code: never) => string, urgencySchema],
    ["sentiment", SENTIMENTS, labelSentiment as (code: never) => string, sentimentSchema],
    ["commercial stage", COMMERCIAL_STAGES, labelStage as (code: never) => string, commercialStageSchema],
    ["risk level", RISK_LEVELS, labelRisk as (code: never) => string, riskLevelSchema],
    ["work lane", WORK_LANES, labelLane as (code: never) => string, workLaneSchema],
    ["job kind", JOB_KINDS, labelJob as (code: never) => string, jobKindSchema],
    ["intervention kind", INTERVENTION_KINDS, labelIntervention as (code: never) => string, interventionKindSchema],
    ["next action", NEXT_ACTION_CODES, labelNextAction as (code: never) => string, nextActionCodeSchema],
    ["queue", QUEUE_CODES, labelQueue as (code: never) => string, queueCodeSchema],
    ["signal", SIGNAL_CODES, labelSignal as (code: never) => string, signalCodeSchema],
  ];

  it.each(cases)("%s: every member is accepted, has no duplicate, and an unknown code is rejected", (_name, codes, label, schema) => {
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(schema.safeParse(code).success).toBe(true);
      expect(label(code as never)).toBe(code);
    }
    expect(schema.safeParse("NOT_A_REAL_CODE").success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
  });

  it("codes are case-sensitive: a model answering in lowercase is rejected, not coerced", () => {
    expect(intentCodeSchema.safeParse("package_enquiry").success).toBe(false);
    expect(queueCodeSchema.safeParse("Needs_Reply").success).toBe(false);
  });

  it("type guards agree with the schemas", () => {
    expect(isIntentCode("SPAM")).toBe(true);
    expect(isIntentCode("spam")).toBe(false);
    expect(isQueueCode("NEEDS_REPLY")).toBe(true);
    expect(isQueueCode(42)).toBe(false);
    expect(isSignalCode("SLA_BREACHED")).toBe(true);
    expect(isSignalCode("MADE_UP")).toBe(false);
  });
});

describe("derived lists stay inside their parent enum", () => {
  it("every commercial intent, rule-only signal, paused queue and SLA-intervention queue is a real code", () => {
    for (const code of COMMERCIAL_INTENT_CODES) expect(isIntentCode(code)).toBe(true);
    for (const code of RULE_ONLY_SIGNAL_CODES) expect(isSignalCode(code)).toBe(true);
    for (const code of CLOCK_PAUSED_QUEUE_CODES) expect(isQueueCode(code)).toBe(true);
    for (const code of SLA_INTERVENTION_QUEUE_CODES) expect(isQueueCode(code)).toBe(true);
  });

  it("R2: exactly four queues open an intervention on breach, and a paused queue is never one of them", () => {
    expect([...SLA_INTERVENTION_QUEUE_CODES].sort()).toEqual(["BOOKING_READY", "COMPLAINTS", "ESCALATIONS", "PAYMENT_DISCUSSIONS"]);
    for (const code of SLA_INTERVENTION_QUEUE_CODES) expect((CLOCK_PAUSED_QUEUE_CODES as readonly string[]).includes(code)).toBe(false);
  });

  it("only OPEN and ACKNOWLEDGED interventions count as open", () => {
    expect([...OPEN_INTERVENTION_STATUSES]).toEqual(["OPEN", "ACKNOWLEDGED"]);
    for (const status of OPEN_INTERVENTION_STATUSES) expect(INTERVENTION_STATUSES).toContain(status);
  });

  it("every job kind names a lane, and bulk work never sits on the REALTIME lane", () => {
    for (const kind of JOB_KINDS) expect(WORK_LANES).toContain(LANE_FOR_JOB_KIND[kind]);
    expect(LANE_FOR_JOB_KIND.ENRICH).toBe("REALTIME");
    expect(LANE_FOR_JOB_KIND.TRANSCRIBE_VOICE).toBe("BULK");
    expect(LANE_FOR_JOB_KIND.RETENTION_SWEEP).toBe("BULK");
  });

  it("intelligence states include the four the UI must render honestly", () => {
    expect([...INTELLIGENCE_STATES].sort()).toEqual(["FAILED", "FRESH", "PENDING", "SKIPPED", "STALE"]);
  });
});

const TRAVEL_INTENT: TravelIntent = {
  journeyType: "UMRAH",
  travelWindow: { preferredMonth: "December", earliestDate: "2026-12-01", latestDate: "2026-12-20", flexibility: "FLEXIBLE" },
  travellers: { adults: 4, children: 1, infants: 0, groupType: "FAMILY" },
  accommodationPreferences: { roomType: "QUAD", hotelTier: "STANDARD", hotelDistancePreference: "WALKABLE" },
  travelPreferences: { flightPreference: "DIRECT", ziyarahInterest: true, accessibilityNeeds: ["wheelchair"] },
  commercialSignals: { statedBudget: 450000, budgetRange: "STANDARD", budgetSensitivity: "MEDIUM", instalmentInterest: true, urgency: "HIGH", decisionStage: "COMPARING" },
  objections: { price: true, other: ["visa timing"] },
  unansweredQuestions: ["Is a wheelchair available in Madinah?"],
  extractedFacts: ["4 adults, quad, December"],
  confidence: 0.82,
  updatedAt: "2026-09-20T10:00:00.000Z",
};

const INTELLIGENCE_ROW = {
  conversationId: UUID,
  intentCode: "PACKAGE_ENQUIRY",
  intentConfidence: 0.91,
  travelIntent: TRAVEL_INTENT,
  urgency: "NORMAL",
  commercialStage: "QUALIFYING",
  sentiment: "NEUTRAL",
  estimatedValueCents: 180000000,
  estimatedValueCurrency: "LKR",
  riskLevel: "NONE",
  nextActionCode: "CREATE_QUOTE",
  languageCode: "en",
  summary: "Family of five asking about December Umrah.",
  openQuestions: ["Room type"],
  matchedOffer: {
    departureGroupId: UUID_B,
    packageId: null,
    seatsMatched: 5,
    roomType: "QUAD",
    pricePerPerson: 450000,
    currency: "LKR",
    pricedAt: "2026-09-19T08:00:00.000Z",
    asOf: "2026-09-20T10:00:00.000Z",
    inclusions: ["Visa", "Return flights"],
  },
  source: "RULES",
  state: "FRESH",
  note: null,
  pipelineVersion: 1,
  inputFingerprint: "abc123",
  computedAt: "2026-09-20T10:00:00.000Z",
  staleAt: null,
  aiRunId: null,
};

describe("TravelIntent jsonb round-trip", () => {
  it("survives JSON serialisation unchanged, as it does through conversation_intelligence.travel_intent", () => {
    const stored = JSON.parse(JSON.stringify(TRAVEL_INTENT));
    const parsed = travelIntentSchema.parse(stored);
    expect(parsed).toEqual(TRAVEL_INTENT);
  });

  it("is reused, not redefined: the intelligence row accepts the exact same shape", () => {
    const row = conversationIntelligenceSchema.parse(JSON.parse(JSON.stringify(INTELLIGENCE_ROW)));
    expect(row.travelIntent).toEqual(TRAVEL_INTENT);
  });

  it("rejects a travel intent with an out-of-enum field instead of trusting it", () => {
    const broken = { ...TRAVEL_INTENT, travellers: { ...TRAVEL_INTENT.travellers, groupType: "CONVOY" } };
    expect(travelIntentSchema.safeParse(broken).success).toBe(false);
  });
});

describe("row schemas", () => {
  it("accepts a well-formed intelligence row and rejects unknown codes and out-of-range confidence", () => {
    expect(conversationIntelligenceSchema.safeParse(INTELLIGENCE_ROW).success).toBe(true);
    expect(conversationIntelligenceSchema.safeParse({ ...INTELLIGENCE_ROW, intentCode: "MADE_UP" }).success).toBe(false);
    expect(conversationIntelligenceSchema.safeParse({ ...INTELLIGENCE_ROW, intentConfidence: 1.4 }).success).toBe(false);
    expect(conversationIntelligenceSchema.safeParse({ ...INTELLIGENCE_ROW, source: "MAGIC" }).success).toBe(false);
    expect(conversationIntelligenceSchema.safeParse({ ...INTELLIGENCE_ROW, state: "READY" }).success).toBe(false);
  });

  it("a matched offer must carry priced_at and the matched seat count, which R1's change-detection compares", () => {
    const withoutPricedAt: Record<string, unknown> = { ...INTELLIGENCE_ROW.matchedOffer };
    delete withoutPricedAt.pricedAt;
    const withoutSeats: Record<string, unknown> = { ...INTELLIGENCE_ROW.matchedOffer };
    delete withoutSeats.seatsMatched;
    expect(matchedOfferSnapshotSchema.safeParse(INTELLIGENCE_ROW.matchedOffer).success).toBe(true);
    expect(matchedOfferSnapshotSchema.safeParse(withoutPricedAt).success).toBe(false);
    expect(matchedOfferSnapshotSchema.safeParse(withoutSeats).success).toBe(false);
  });

  it("a signal must name a real code and a detector", () => {
    const signal = { conversationId: UUID, signalCode: "REFUND_REQUEST", messageId: UUID_B, detector: "RULE", confidence: 1, evidence: [{ messageId: UUID_B, snippet: "I want a refund" }], supersededAt: null, createdAt: "2026-09-20T10:00:00.000Z" };
    expect(conversationSignalSchema.safeParse(signal).success).toBe(true);
    expect(conversationSignalSchema.safeParse({ ...signal, signalCode: "REFUNDISH" }).success).toBe(false);
    expect(conversationSignalSchema.safeParse({ ...signal, detector: "GUESS" }).success).toBe(false);
  });

  it("an intervention must name a kind, a status and a required action", () => {
    const intervention = {
      id: UUID,
      conversationId: UUID_B,
      kind: "PAYMENT_CLAIM",
      severity: "BLOCK",
      headline: "Customer says they paid",
      guidance: "Ask Finance to check the bank statement.",
      requiredActionCode: "VERIFY_PAYMENT",
      assignedRole: "FINANCE",
      assignedToId: null,
      status: "OPEN",
      resolvedBy: null,
      resolutionNote: null,
      sourceSignalIds: [],
      createdAt: "2026-09-20T10:00:00.000Z",
      resolvedAt: null,
    };
    expect(interventionSchema.safeParse(intervention).success).toBe(true);
    expect(interventionSchema.safeParse({ ...intervention, status: "PENDING" }).success).toBe(false);
    expect(interventionSchema.safeParse({ ...intervention, requiredActionCode: "PAY_THEM" }).success).toBe(false);
    expect(interventionSchema.safeParse({ ...intervention, severity: "INFO" }).success).toBe(false);
  });

  it("a job must name a lane and a kind from the closed lists", () => {
    const job = { agencyId: UUID, lane: "REALTIME", kind: "ENRICH", coalesceKey: `enrich:${UUID_B}`, payload: {}, priority: 0, runAfter: "2026-09-20T10:00:00.000Z" };
    expect(channelJobSchema.safeParse(job).success).toBe(true);
    expect(channelJobSchema.safeParse({ ...job, lane: "FAST" }).success).toBe(false);
    expect(channelJobSchema.safeParse({ ...job, kind: "DO_MAGIC" }).success).toBe(false);
  });
});
