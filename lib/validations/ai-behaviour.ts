import { z } from "zod";

/**
 * Conversation style for the WhatsApp assistant. Stored as `ai_settings.behaviour` and turned into
 * prompt instructions by `lib/agent/whatsapp/behaviour-prompt.ts`. Every field has a default, so an
 * empty object (a never-customised agency) behaves as the assistant did before this existed.
 */

export const REPLY_LENGTHS = ["SHORT", "BALANCED", "DETAILED"] as const;
export const EMOJI_LEVELS = ["NONE", "LIGHT", "FREE"] as const;
export const MESSAGE_FORMATS = ["PLAIN", "BULLETS"] as const;
export const PACKAGE_ENQUIRY_STYLES = ["ASK_FIRST", "SHORT_SUMMARY", "FULL_DETAILS"] as const;
export const HANDOFF_STYLES = ["AFTER_ENQUIRY", "WHEN_ASKED", "OFFER_ALWAYS"] as const;

export const PACKAGE_DETAIL_OPTIONS = [
  { key: "dates", label: "Travel dates" },
  { key: "duration", label: "Duration" },
  { key: "prices", label: "Price per person" },
  { key: "roomTypes", label: "All room types (quad, triple, double, single)" },
  { key: "seatsLeft", label: "Seats left" },
  { key: "hotels", label: "Hotels" },
  { key: "flights", label: "Flights" },
  { key: "meals", label: "Meals" },
  { key: "transport", label: "Transport" },
  { key: "ziyarah", label: "Ziyarah (guided visits)" },
  { key: "visa", label: "Visa support" },
  { key: "insurance", label: "Insurance" },
  { key: "inclusions", label: "What is included and not included" },
] as const;

export const ENQUIRY_QUESTION_OPTIONS = [
  { key: "travellers", label: "How many travellers" },
  { key: "roomPreference", label: "Room type" },
  { key: "name", label: "Their name" },
  { key: "city", label: "Their city" },
  { key: "travelMonth", label: "When they want to travel" },
  { key: "budget", label: "Their budget" },
] as const;

const detailKeys = PACKAGE_DETAIL_OPTIONS.map((option) => option.key) as [string, ...string[]];
const questionKeys = ENQUIRY_QUESTION_OPTIONS.map((option) => option.key) as [string, ...string[]];

export const aiBehaviourSchema = z.object({
  replyLength: z.enum(REPLY_LENGTHS).default("BALANCED"),
  emoji: z.enum(EMOJI_LEVELS).default("LIGHT"),
  format: z.enum(MESSAGE_FORMATS).default("BULLETS"),
  packageEnquiry: z.enum(PACKAGE_ENQUIRY_STYLES).default("FULL_DETAILS"),
  detailsToShow: z.array(z.enum(detailKeys)).max(20).default(["dates", "duration", "prices", "roomTypes", "inclusions"]),
  questionsToAsk: z.array(z.enum(questionKeys)).max(10).default(["travellers", "roomPreference", "name", "city"]),
  oneQuestionAtATime: z.boolean().default(false),
  greeting: z.string().trim().max(400).default(""),
  closing: z.string().trim().max(400).default(""),
  handoff: z.enum(HANDOFF_STYLES).default("AFTER_ENQUIRY"),
  extraRules: z.string().trim().max(2000).default(""),
});

export type AiBehaviour = z.infer<typeof aiBehaviourSchema>;

/** Never throws: a stored value that no longer fits the schema falls back to the defaults. */
export function parseAiBehaviour(raw: unknown): AiBehaviour {
  const parsed = aiBehaviourSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : aiBehaviourSchema.parse({});
}
