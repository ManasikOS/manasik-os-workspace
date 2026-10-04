import { z } from "zod";

/**
 * Single validation source for the Add Lead sheet, shared by the client (for
 * instant feedback) and `leadCreateAction` (the real gate). Mirrors the
 * pattern in `lib/validations/packages.ts` / `lib/validations/departure-groups.ts`.
 *
 * The spec's five hard requirements — owner, next follow-up, source, mobile,
 * journey interest — are enforced here, not left to individual call sites.
 */

const JOURNEY_TYPES = ["UMRAH", "HAJJ", "EARLY_REGISTRATION"] as const;
const ROOM_PREFERENCES = ["QUAD", "TRIPLE", "DOUBLE", "SINGLE", "UNDECIDED"] as const;
const CONTACT_CHANNELS = ["WHATSAPP", "CALL", "EMAIL", "SMS", "IN_PERSON", "INSTAGRAM", "MESSENGER"] as const;
const SOURCES = [
  "WHATSAPP",
  "PHONE_CALL",
  "WALK_IN",
  "FACEBOOK",
  "INSTAGRAM",
  "WEBSITE",
  "GOOGLE",
  "REFERRAL",
  "REPEAT_CUSTOMER",
  "COMMUNITY_EVENT",
  "OTHER",
] as const;
const STAGES = [
  "NEW_LEAD",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "DEPOSIT_PENDING",
  "BOOKED",
  "LOST",
  "POSTPONED",
  "DUPLICATE",
  "SPAM",
] as const;
const TEMPERATURES = ["HOT", "WARM", "COLD"] as const;
export const FOLLOW_UP_TYPES = [
  "CALL",
  "WHATSAPP_MESSAGE",
  "SEND_QUOTE",
  "SEND_BROCHURE",
  "IN_PERSON_VISIT",
  "DEPOSIT_REMINDER",
] as const;

export const createLeadSchema = z.object({
  fullName: z.string().trim().min(1, "Enter the customer's name."),
  mobile: z.string().min(1, "A WhatsApp / mobile number is required."),
  email: z.string(),
  city: z.string(),
  preferredLanguage: z.string(),
  preferredChannel: z.enum(CONTACT_CHANNELS).default("WHATSAPP"),

  journeyType: z.enum(JOURNEY_TYPES),
  interestedIn: z.string().trim().min(1, "Select what the lead is interested in."),
  packageId: z.string().nullable(),
  preferredPeriod: z.string(),
  adults: z.number().int().min(1, "A lead needs at least one adult traveller."),
  children: z.number().int().min(0),
  roomPreference: z.enum(ROOM_PREFERENCES).default("UNDECIDED"),
  departureCity: z.string(),
  budgetRange: z.string(),
  quotaWaitlistInterest: z.boolean(),

  source: z.enum(SOURCES, { error: "Select where this lead came from." }),
  campaignReference: z.string(),
  referralName: z.string(),
  assignedToId: z.string().trim().min(1, "Assign a sales owner."),
  stage: z.enum(STAGES).default("NEW_LEAD"),
  temperature: z.enum(TEMPERATURES).default("WARM"),

  nextFollowUpAt: z
    .string()
    .nullable()
    .refine((value) => value !== null && value !== "", {
      message: "A next follow-up is required for every new lead.",
    }),
  followUpType: z.enum(FOLLOW_UP_TYPES),
  followUpOwnerId: z.string(),
  notes: z.string(),

  duplicateReason: z.string(),
  createAnyway: z.boolean(),
});

export type CreateLeadFormInput = z.infer<typeof createLeadSchema>;

/** Field-level errors keyed the same way the Add Lead sheet renders them. */
export function toLeadFieldErrors(
  error: z.ZodError,
): Partial<Record<keyof CreateLeadFormInput, string>> {
  const out: Partial<Record<keyof CreateLeadFormInput, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof CreateLeadFormInput | undefined;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

export const logContactSchema = z.object({
  leadId: z.string().min(1),
  summary: z.string().trim().min(1, "Add a short note describing the contact."),
  nextFollowUpAt: z.string().nullable(),
  followUpType: z.enum(FOLLOW_UP_TYPES).nullable(),
});

export const addNoteSchema = z.object({
  leadId: z.string().min(1),
  note: z.string().trim().min(1, "The note is empty."),
});

export const markLostSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1),
  lostReason: z.enum([
    "PRICE_TOO_HIGH",
    "DATE_UNAVAILABLE",
    "NO_SEATS",
    "COMPETITOR",
    "VISA_CONCERN",
    "NO_RESPONSE",
    "POSTPONED_TRAVEL",
    "PAYMENT_ISSUE",
    "DUPLICATE",
    "OTHER",
  ]),
  lostNote: z.string(),
});
