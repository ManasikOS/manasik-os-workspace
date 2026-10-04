/**
 * Manasik Sales Intelligence Engine — domain types.
 *
 * Client-safe: no server imports. Two layers of offer data are kept
 * deliberately separate:
 *
 *   * `CustomerSafeOfferFacts` — public prices, dates, standards, inclusions,
 *     and supplier details only once CONFIRMED. The only thing
 *     `SalesContentGenerationService` is allowed to read.
 *   * `InternalOfferSignals` — readiness and pricing provenance. Used by
 *     `OfferMatchingService` to avoid recommending a problematic group, and
 *     never passed to anything that writes customer-facing text.
 */

import type {
  AccommodationCity,
  GroupJourneyType,
  GroupReadinessStatus,
  GroupSalesStatus,
  PaymentMilestoneSnapshot,
} from "@/lib/types/departure-groups";
import type { LeadJourneyType, LeadRoomPreference, LeadStage } from "@/lib/types/leads";

/* ── Shared enums ─────────────────────────────────────────────────────────── */

export const OCCUPANCY_TYPES = ["QUAD", "TRIPLE", "DOUBLE", "SINGLE"] as const;
export type OccupancyType = (typeof OCCUPANCY_TYPES)[number];

export const JOURNEY_TYPES = ["UMRAH", "HAJJ", "EARLY_REGISTRATION"] as const;
export const FLEXIBILITY = ["FIXED", "FLEXIBLE", "UNKNOWN"] as const;
export const GROUP_TYPES = ["SOLO", "COUPLE", "FAMILY", "GROUP", "UNKNOWN"] as const;
export const ROOM_TYPES = ["QUAD", "TRIPLE", "DOUBLE", "SINGLE", "NOT_DECIDED"] as const;
export const HOTEL_TIERS = ["ECONOMY", "STANDARD", "PREMIUM", "VIP", "UNKNOWN"] as const;
export const HOTEL_DISTANCES = ["VERY_CLOSE", "WALKABLE", "FLEXIBLE", "UNKNOWN"] as const;
export const FLIGHT_PREFERENCES = ["DIRECT", "MINIMAL_TRANSIT", "FLEXIBLE", "UNKNOWN"] as const;
export const SENSITIVITY = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export const DECISION_STAGES = ["EXPLORING", "COMPARING", "READY_TO_BOOK", "UNKNOWN"] as const;

/** Where a result came from — shown to staff so nothing pretends to be AI. */
export type ReasoningSource = "RULES" | "LLM";

/* ── Travel Intent ────────────────────────────────────────────────────────── */

export type TravelIntent = {
  journeyType?: "UMRAH" | "HAJJ" | "EARLY_REGISTRATION";

  travelWindow: {
    preferredMonth?: string;
    earliestDate?: string | Date;
    latestDate?: string | Date;
    flexibility: "FIXED" | "FLEXIBLE" | "UNKNOWN";
  };

  travellers: {
    adults: number;
    children: number;
    infants: number;
    groupType: "SOLO" | "COUPLE" | "FAMILY" | "GROUP" | "UNKNOWN";
  };

  accommodationPreferences: {
    roomType?: "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE" | "NOT_DECIDED";
    hotelTier?: "ECONOMY" | "STANDARD" | "PREMIUM" | "VIP" | "UNKNOWN";
    hotelDistancePreference?: "VERY_CLOSE" | "WALKABLE" | "FLEXIBLE" | "UNKNOWN";
  };

  travelPreferences: {
    flightPreference?: "DIRECT" | "MINIMAL_TRANSIT" | "FLEXIBLE" | "UNKNOWN";
    mealPreference?: string;
    ziyarahInterest?: boolean;
    accessibilityNeeds?: string[];
  };

  commercialSignals: {
    /** Per person, in the agency currency. */
    statedBudget?: number;
    budgetRange?: "ECONOMY" | "STANDARD" | "PREMIUM" | "VIP" | "UNKNOWN";
    budgetSensitivity: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
    instalmentInterest: boolean;
    urgency: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
    decisionStage: "EXPLORING" | "COMPARING" | "READY_TO_BOOK" | "UNKNOWN";
  };

  objections: {
    price?: boolean;
    dates?: boolean;
    hotel?: boolean;
    roomType?: boolean;
    paymentPlan?: boolean;
    flight?: boolean;
    visa?: boolean;
    other?: string[];
  };

  unansweredQuestions: string[];
  extractedFacts: string[];
  confidence: number;
  updatedAt: string | Date;
};

/* ── Lead facts the engine reasons over (never the raw row) ───────────────── */

export interface LeadFacts {
  id: string;
  reference: string;
  fullName: string;
  firstName: string;
  stage: LeadStage;
  journeyType: LeadJourneyType;
  adults: number;
  children: number;
  roomPreference: LeadRoomPreference;
  preferredPeriod: string;
  budgetRange: string;
  preferredLanguage: string;
  packageId: string | null;
  packageName: string | null;
  selectedDepartureGroupId: string | null;
  /** Internal notes, newest first — read-only context. */
  notes: string[];
}

/* ── Offer candidates (built by CopilotKnowledgeContextService) ───────────── */

export interface OfferAccommodationStandard {
  city: AccommodationCity;
  /** Customer-facing wording, falling back to the internal standard label. */
  description: string;
  nights: number;
  mealPlan: string;
  distance: string;
}

export interface CustomerSafeOfferFacts {
  groupId: string;
  groupName: string;
  groupCode: string;
  packageTemplateId: string;
  packageName: string;
  journeyType: GroupJourneyType;
  departureDate: string;
  returnDate: string;
  durationDays: number;
  durationNights: number;
  availableSeats: number;
  salesStatus: GroupSalesStatus;
  waitlistEnabled: boolean;
  currency: string;
  occupancyPrices: Partial<Record<OccupancyType, number>>;
  childPrice: number | null;
  infantPrice: number | null;
  depositPerPerson: number | null;
  paymentSchedule: PaymentMilestoneSnapshot[];
  accommodation: OfferAccommodationStandard[];
  transportStandard: string | null;
  inclusions: string[];
  exclusions: string[];
  /** Only CONFIRMED hotels. Absent means "describe the standard, not a name". */
  confirmedHotels: { city: string; hotelName: string; nights: number }[];
  /** Only CONFIRMED/TICKETED flights. */
  confirmedFlights: { direction: "OUTBOUND" | "RETURN"; airline: string; departureAt: string; arrivalAt: string }[];
}

export interface InternalOfferSignals {
  readinessStatus: GroupReadinessStatus;
  /** A BLOCKED readiness state — demoted when a comparable safe group exists. */
  hasCriticalBlock: boolean;
  priceSource: "GROUP_OVERRIDE" | "PACKAGE_TEMPLATE";
  /** Linked package template is Open for Sale (or a built-in template). */
  packagePublished: boolean;
  /** Group status/sales status allow selling right now (seats checked separately). */
  isSellable: boolean;
  /** `departure_group_pricing.priced_at` — when the current price was last set. The Inbox's change-detection compares this. */
  pricedAt?: string | null;
  /** Last day of the group's early-bird price, when it has one. */
  earlyBirdValidUntil?: string | null;
}

export interface OfferCandidate {
  facts: CustomerSafeOfferFacts;
  internal: InternalOfferSignals;
}

/* ── Offer Match ──────────────────────────────────────────────────────────── */

export type OfferMatch = {
  id: string;
  leadId: string;
  packageTemplateId: string;
  departureGroupId: string;

  groupName: string;
  packageName: string;

  departureDate: string | Date;
  returnDate: string | Date;
  durationDays: number;

  availableSeats: number;
  roomType?: "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE";

  pricePerPerson: number;
  totalPrice: number;
  depositPerPerson?: number;
  totalDeposit?: number;

  hotelStandard?: string;
  transportStandard?: string;
  majorInclusions: string[];

  fitLevel: "STRONG" | "GOOD" | "PARTIAL" | "WEAK";
  fitScore: number;

  matchReasons: string[];
  tradeoffs: string[];
  missingInformation: string[];

  isRecommended: boolean;

  /* Extensions beyond the brief's shape — all customer-safe. */
  currency: string;
  adults: number;
  children: number;
  infants: number;
  paymentPlanSummary: string;
  /** True when the room type was assumed rather than requested. */
  roomTypeAssumed: boolean;
};

export interface OfferRequirement {
  journeyType: LeadJourneyType;
  adults: number;
  children: number;
  infants: number;
  travellers: number;
  roomType: OccupancyType | null;
  /** Zero-based month index the customer asked for, if any. */
  month: number | null;
  year: number | null;
  monthLabel: string | null;
  budgetPerPerson: number | null;
  usedIntent: boolean;
}

export interface WaitlistOption {
  groupId: string;
  groupName: string;
  departureDate: string;
  returnDate: string;
}

export interface OfferMatchingResult {
  requirement: OfferRequirement;
  /** Ranked; `offers[0]` is the recommendation when present. Max 5. */
  offers: OfferMatch[];
  /** Why the recommendation beat the alternatives — generated, not hardcoded. */
  recommendationReason: string | null;
  noMatch: { reason: string; waitlistOptions: WaitlistOption[] } | null;
}

/* ── Sales Strategy ───────────────────────────────────────────────────────── */

export type SalesStrategy = {
  leadId: string;
  recommendedOfferId?: string;

  customerStage: "EXPLORING" | "COMPARING" | "READY_TO_BOOK";

  recommendedSalesAngle: string;
  likelyObjections: string[];
  objectionHandlingPoints: string[];
  bestNextConversationGoal: string;
  missingInformationToAsk: string[];
  suggestedMessageIntent: string;
};

/* ── Lead Copilot context / suggestions ───────────────────────────────────── */

export type CopilotSuggestion = {
  id: string;
  leadId: string;
  type:
    | "DATE_MISMATCH"
    | "CAPACITY_MISMATCH"
    | "ROOM_MISMATCH"
    | "BUDGET_MISMATCH"
    | "BETTER_GROUP_MATCH";
  message: string;
  actionLabel: string;
  actionType: "BUILD_OFFER" | "COMPARE_OPTIONS" | "ADJUST_PREFERENCES";
  createdAt: string | Date;
  dismissedAt?: string | Date;
};

export type CopilotSuggestionType = CopilotSuggestion["type"];

/** The offer staff explicitly chose — a snapshot, so later repricing can't rewrite it. */
export interface SelectedOfferSnapshot {
  offerId: string;
  packageTemplateId: string;
  departureGroupId: string;
  groupName: string;
  packageName: string;
  departureDate: string;
  returnDate: string;
  roomType: OccupancyType | null;
  pricePerPerson: number;
  totalPrice: number;
  currency: string;
}

export type LeadCopilotContext = {
  leadId: string;
  travelIntent?: TravelIntent;
  selectedOfferMatchId?: string;
  selectedPackageId?: string;
  selectedDepartureGroupId?: string;
  activeSuggestion?: CopilotSuggestion;
};

/* ── Quotes ───────────────────────────────────────────────────────────────── */

export const QUOTE_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "SENT",
  "VIEWED",
  "EXPIRED",
  "ACCEPTED",
  "DECLINED",
  "SUPERSEDED",
  "CANCELLED",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export interface QuoteMilestone {
  label: string;
  amount: number;
  /** `yyyy-mm-dd`, or null for "on booking". */
  dueDate: string | null;
  dueLabel: string;
}

export type QuoteDraft = {
  id: string;
  leadId: string;
  packageTemplateId: string;
  departureGroupId: string;
  occupancyType: "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE";
  adults: number;
  children: number;
  infants: number;
  pricePerPerson: number;
  totalAmount: number;
  depositAmount: number;
  paymentMilestones: QuoteMilestone[];
  discountAmount?: number;
  discountReason?: string;
  expiresAt: string | Date;
  status: QuoteStatus;
  createdAt: string | Date;
  createdByUserId: string;
};

/* ── Ask Manasik ──────────────────────────────────────────────────────────── */

export type AskIntent =
  | "WHY_BEST"
  | "ROOM_FOR_FAMILY"
  | "INSTALMENTS"
  | "COMPARE"
  | "MISSING_INFO"
  | "DRAFT_LANGUAGE"
  | "BETTER_DATE"
  | "FREEFORM";

export type AskFollowUp =
  | { action: "USE_IN_REPLY"; label: string }
  | { action: "BUILD_OFFER"; label: string }
  | { action: "CREATE_QUOTE"; label: string; offerId: string }
  | { action: "DRAFT_REPLY"; label: string; language: ReplyLanguage };

export interface CopilotAnswer {
  question: string;
  intent: AskIntent;
  answer: string;
  /** The scoped records the answer was built from. */
  sources: string[];
  followUps: AskFollowUp[];
  source: ReasoningSource;
}

/* ── Customer replies ─────────────────────────────────────────────────────── */

export const REPLY_PURPOSES = [
  "OFFER_RECOMMENDATION",
  "PACKAGE_EXPLANATION",
  "PRICE_AND_ROOMS",
  "INSTALMENT_PLAN",
  "COMPARISON",
  "DEPARTURE_DATE",
  "GENERAL",
] as const;
export type ReplyPurpose = (typeof REPLY_PURPOSES)[number];

export const REPLY_TONES = ["WARM", "PROFESSIONAL", "SHORT_WHATSAPP", "DETAILED"] as const;
export type ReplyTone = (typeof REPLY_TONES)[number];

/** Arabic is intentionally absent — the product has no Arabic language support yet. */
export const REPLY_LANGUAGES = ["EN", "SI", "TA"] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];

export interface ReplyIncludes {
  group: boolean;
  dates: boolean;
  room: boolean;
  price: boolean;
  paymentPlan: boolean;
  inclusions: boolean;
  comparison: boolean;
  missingQuestions: boolean;
}

export interface GeneratedReply {
  text: string;
  source: ReasoningSource;
  /** Safety-check findings; a non-empty list means staff should edit before sending. */
  warnings: string[];
}
