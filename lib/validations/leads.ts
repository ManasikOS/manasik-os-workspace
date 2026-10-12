import { z } from "zod";

import { QUOTE_STATUSES } from "@/lib/copilot/sales/types";

/**
 * Single validation source for the Add Lead screen, shared by the client (for
 * instant feedback) and `createLeadAction` (the real gate). Mirrors the
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

/** Field-level errors keyed the same way the Add Lead screen renders them. */
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
  summary: z.string().trim().min(1, "Add a short note describing the contact.").max(1000),
  nextFollowUpAt: z.string().nullable(),
  followUpType: z.enum(FOLLOW_UP_TYPES).nullable(),
});

export const addNoteSchema = z.object({
  leadId: z.string().min(1),
  note: z.string().trim().min(1, "The note is empty.").max(2000),
});

const LOST_REASONS = [
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
] as const;

export const markLostSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1),
  lostReason: z.enum(LOST_REASONS),
  lostNote: z.string(),
});

/* ── Server Action inputs ─────────────────────────────────────────────────────
 * The Server Actions in app/(main)/leads/actions.ts take their arguments from the browser. A TypeScript parameter type is erased at runtime, so
 * every action parses its input with one of these first: ids are UUIDs, enums are enums, text has a ceiling, lists have a ceiling. Names and
 * labels are never accepted from the caller — the server looks them up. */

/** The most leads one bulk action may touch. The UI selects a page at a time. */
export const MAX_BULK_LEADS = 100;

const leadIdSchema = z.uuid();
const staffIdSchema = z.string().trim().min(1).max(64);
const isoDateSchema = z
  .string()
  .max(40)
  .refine((value) => /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value)), "Enter a valid date.");

const CONSENT_STATUSES = ["UNKNOWN", "OPTED_IN", "OPTED_OUT"] as const;
const CONSENT_CHANNELS = ["WHATSAPP", "EMAIL", "SMS", "CALL"] as const;

export const changeStageActionSchema = z.object({
  leadIds: z.array(leadIdSchema).min(1).max(MAX_BULK_LEADS),
  stage: z.enum(STAGES),
  lostReason: z.enum(LOST_REASONS).optional(),
  lostNote: z.string().trim().max(500).optional(),
  postponedUntil: isoDateSchema.nullable().optional(),
});

export const assignLeadsActionSchema = z.object({
  leadIds: z.array(leadIdSchema).min(1).max(MAX_BULK_LEADS),
  staffId: staffIdSchema,
});

export const logContactActionSchema = z.object({
  leadId: leadIdSchema,
  summary: z.string().trim().min(1, "Add a short note describing the contact.").max(1000),
  nextFollowUpAt: isoDateSchema.nullable(),
  followUpType: z.enum(FOLLOW_UP_TYPES).nullable(),
  followUpOwnerId: staffIdSchema.optional(),
  advanceToStage: z.enum(STAGES).optional(),
});

export const setFollowUpActionSchema = z.object({
  leadId: leadIdSchema,
  nextFollowUpAt: isoDateSchema,
  followUpType: z.enum(FOLLOW_UP_TYPES),
  followUpOwnerId: staffIdSchema,
});

export const completeFollowUpActionSchema = z.object({ leadId: leadIdSchema });

export const addNoteActionSchema = z.object({
  leadId: leadIdSchema,
  note: z.string().trim().min(1, "The note is empty.").max(2000),
});

/** The group's label is looked up from the group itself, so none is accepted here. */
export const selectDepartureGroupActionSchema = z.object({
  leadId: leadIdSchema,
  departureGroupId: z.uuid(),
});

export const findAvailableGroupsActionSchema = z.object({
  journeyType: z.enum(JOURNEY_TYPES),
  packageId: z.uuid().nullable(),
  requiredSeats: z.number().int().min(1).max(60),
});

export const updateConsentActionSchema = z.object({
  leadId: leadIdSchema,
  consentStatus: z.enum(CONSENT_STATUSES),
  doNotContact: z.boolean(),
  contactableChannels: z.array(z.enum(CONSENT_CHANNELS)).max(CONSENT_CHANNELS.length),
  source: z.string().trim().min(1, "Say where this decision came from (e.g. WhatsApp reply, verbal at walk-in).").max(200),
  note: z.string().trim().max(500).optional(),
});

/** Free text in, a stable code out: "Mosque Event" → `MOSQUE_EVENT`. */
function toSourceCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export const leadSourceActionSchema = z.object({
  code: z
    .string()
    .max(60)
    .transform(toSourceCode)
    .refine((code) => /^[A-Z0-9_]{2,30}$/.test(code), "A source code is 2–30 letters, numbers or spaces."),
  label: z.string().trim().min(1, "A source needs a label.").max(60),
  active: z.boolean(),
});

export const updateQuoteStatusActionSchema = z.object({
  quoteId: z.uuid(),
  status: z.enum(QUOTE_STATUSES),
});

export const convertToBookingActionSchema = z.object({
  leadId: leadIdSchema,
  departureGroupId: z.uuid(),
  primaryContactName: z.string().trim().max(120),
  primaryContactPhone: z.string().trim().max(32),
  adults: z.number().int().min(1).max(60),
  children: z.number().int().min(0).max(60),
  roomOccupancyPreference: z.enum(["QUAD", "TRIPLE", "DOUBLE", "SINGLE", "OTHER"]),
  packagePricePerPerson: z.number().positive().max(100_000_000),
  depositAmount: z.number().min(0).max(100_000_000),
});

/* ── CSV import ───────────────────────────────────────────────────────────── */

/** Rows per import. The import dialog already caps the file at 2 MB; this is the server's own ceiling. */
export const MAX_IMPORT_ROWS = 500;

/**
 * One imported row. Owner names are not accepted: the server resolves `assignedToId` against the agency's active staff and writes the real name.
 * Stage is limited to the early pipeline — an import cannot create a Booked, Duplicate or Spam lead.
 */
export const importLeadRowSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  mobile: z.string().trim().min(1).max(40),
  email: z.string().trim().max(254),
  city: z.string().trim().max(80),
  preferredLanguage: z.string().trim().max(40),
  preferredChannel: z.enum(CONTACT_CHANNELS),
  journeyType: z.enum(JOURNEY_TYPES),
  interestedIn: z.string().trim().max(200),
  packageId: z.uuid().nullable(),
  preferredPeriod: z.string().trim().max(120),
  adults: z.number().int().min(1).max(60),
  children: z.number().int().min(0).max(60),
  roomPreference: z.enum(ROOM_PREFERENCES),
  departureCity: z.string().trim().max(80),
  budgetRange: z.string().trim().max(80),
  quotaWaitlistInterest: z.boolean(),
  source: z.enum(SOURCES),
  campaignReference: z.string().trim().max(120),
  referralName: z.string().trim().max(120),
  assignedToId: staffIdSchema,
  stage: z.enum(STAGES),
  temperature: z.enum(TEMPERATURES),
  nextFollowUpAt: isoDateSchema.nullable(),
  followUpType: z.enum(FOLLOW_UP_TYPES),
  followUpOwnerId: staffIdSchema,
  notes: z.string().trim().max(2000),
});

export const importLeadsActionSchema = z.array(importLeadRowSchema).min(1).max(MAX_IMPORT_ROWS);

/** Stages an import may set. */
export const IMPORTABLE_STAGES = ["NEW_LEAD", "CONTACTED", "QUALIFIED"] as const;
