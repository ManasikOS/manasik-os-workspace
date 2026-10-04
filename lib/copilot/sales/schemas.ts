/**
 * Zod schemas for everything that crosses a trust boundary: a TravelIntent
 * coming back from an LLM, or edited by staff in the browser and sent to a
 * Server Action. Nothing reaches the database or the matcher unvalidated.
 */

import { z } from "zod";

import {
  DECISION_STAGES,
  FLEXIBILITY,
  FLIGHT_PREFERENCES,
  GROUP_TYPES,
  HOTEL_DISTANCES,
  HOTEL_TIERS,
  JOURNEY_TYPES,
  OCCUPANCY_TYPES,
  REPLY_LANGUAGES,
  REPLY_PURPOSES,
  REPLY_TONES,
  ROOM_TYPES,
  SENSITIVITY,
  type TravelIntent,
} from "./types";

const count = z.number().int().min(0).max(60);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Expected an ISO date");

export const travelIntentSchema = z.object({
  journeyType: z.enum(JOURNEY_TYPES).optional(),
  travelWindow: z.object({
    preferredMonth: z.string().max(40).optional(),
    earliestDate: isoDate.optional(),
    latestDate: isoDate.optional(),
    flexibility: z.enum(FLEXIBILITY),
  }),
  travellers: z.object({
    adults: count,
    children: count,
    infants: count,
    groupType: z.enum(GROUP_TYPES),
  }),
  accommodationPreferences: z.object({
    roomType: z.enum(ROOM_TYPES).optional(),
    hotelTier: z.enum(HOTEL_TIERS).optional(),
    hotelDistancePreference: z.enum(HOTEL_DISTANCES).optional(),
  }),
  travelPreferences: z.object({
    flightPreference: z.enum(FLIGHT_PREFERENCES).optional(),
    mealPreference: z.string().max(120).optional(),
    ziyarahInterest: z.boolean().optional(),
    accessibilityNeeds: z.array(z.string().max(120)).max(10).optional(),
  }),
  commercialSignals: z.object({
    statedBudget: z.number().min(0).max(100_000_000).optional(),
    budgetRange: z.enum(HOTEL_TIERS).optional(),
    budgetSensitivity: z.enum(SENSITIVITY),
    instalmentInterest: z.boolean(),
    urgency: z.enum(SENSITIVITY),
    decisionStage: z.enum(DECISION_STAGES),
  }),
  objections: z.object({
    price: z.boolean().optional(),
    dates: z.boolean().optional(),
    hotel: z.boolean().optional(),
    roomType: z.boolean().optional(),
    paymentPlan: z.boolean().optional(),
    flight: z.boolean().optional(),
    visa: z.boolean().optional(),
    other: z.array(z.string().max(200)).max(10).optional(),
  }),
  unansweredQuestions: z.array(z.string().max(200)).max(20),
  extractedFacts: z.array(z.string().max(300)).max(40),
  confidence: z.number().min(0).max(1),
  updatedAt: z.string(),
});

/** Compile-time proof the schema and the domain type agree. */
export function parseTravelIntent(value: unknown): TravelIntent | null {
  const parsed = travelIntentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const INTENT_LEAD_FIELDS = [
  "journeyType",
  "adults",
  "children",
  "roomPreference",
  "preferredPeriod",
  "budgetRange",
] as const;
export type IntentLeadField = (typeof INTENT_LEAD_FIELDS)[number];

export const applyIntentSchema = z.object({
  leadId: z.uuid(),
  intent: travelIntentSchema,
  fields: z.array(z.enum(INTENT_LEAD_FIELDS)).max(INTENT_LEAD_FIELDS.length),
});

export const replyIncludesSchema = z.object({
  group: z.boolean(),
  dates: z.boolean(),
  room: z.boolean(),
  price: z.boolean(),
  paymentPlan: z.boolean(),
  inclusions: z.boolean(),
  comparison: z.boolean(),
  missingQuestions: z.boolean(),
});

export const draftReplySchema = z.object({
  leadId: z.uuid(),
  offerId: z.string().max(120).nullable(),
  purpose: z.enum(REPLY_PURPOSES),
  tone: z.enum(REPLY_TONES),
  language: z.enum(REPLY_LANGUAGES),
  include: replyIncludesSchema,
  intentOverride: travelIntentSchema.nullable(),
});

export const saveReplyDraftSchema = z.object({
  leadId: z.uuid(),
  body: z.string().trim().min(1, "The draft is empty.").max(6000),
  purpose: z.enum(REPLY_PURPOSES),
  tone: z.enum(REPLY_TONES),
  language: z.enum(REPLY_LANGUAGES),
  offerId: z.string().max(120).nullable(),
});

export const saveQuoteDraftSchema = z.object({
  leadId: z.uuid(),
  departureGroupId: z.uuid(),
  occupancyType: z.enum(OCCUPANCY_TYPES),
  adults: z.number().int().min(1).max(60),
  children: count,
  infants: count,
  discountAmount: z.number().min(0).max(100_000_000),
  discountReason: z.string().trim().max(300),
  expiresInDays: z.number().int().min(1).max(60),
  inclusions: z.array(z.string().max(300)).max(60),
  exclusions: z.array(z.string().max(300)).max(60),
});
