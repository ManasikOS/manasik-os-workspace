/**
 * Conversation → workflow conversions (MI4.6, Architecture §11.3). Pure: what can be made from a conversation, what each needs,
 * what the person must choose, and — when one cannot be made yet — a plain reason, so the menu says "why not" instead of hiding
 * the option.
 *
 * Every conversion here is a proposal kind in the existing kernel (`lib/agent/kernel/proposals/kinds/conversation-*.ts`), so
 * approval, audit and execution are inherited. Three conversions that already have their own button in the panel (lead, quote,
 * booking, departure group) are not repeated here; they stamp the same source link (see `source-link.ts`).
 *
 * A conversion that needs a decision declares typed `fields`. The server supplies the choices for them (`choices.ts`) and the
 * kind's own Zod schema validates what comes back, so a choice is never trusted just because a form sent it.
 */

import { z } from "zod";

export const CONVERSION_KINDS = [
  "CONVERSATION_DOCUMENT_REQUEST",
  "CONVERSATION_VISA_TASK",
  "CONVERSATION_PAYMENT_FOLLOW_UP",
  "CONVERSATION_ROOMING_REQUEST",
  "CONVERSATION_TRANSPORT_REQUIREMENT",
  "CONVERSATION_GUIDE_ESCALATION",
  "CONVERSATION_COMPLAINT_CASE",
  "CONVERSATION_PILGRIM_PROFILE",
  "CONVERSATION_TRAVELLER_RELATIONSHIP",
  "CONVERSATION_SEAT_HOLD",
  "CONVERSATION_PACKAGE_RECOMMENDATION",
  "CONVERSATION_FEEDBACK_REQUEST",
] as const;
export type ConversionKind = (typeof CONVERSION_KINDS)[number];

export const conversionKindSchema = z.enum(CONVERSION_KINDS);

/** What a conversion needs true of the conversation before it can be made. Checked in the order listed. */
export type ConversionNeed =
  | "LEAD"
  | "DEPARTURE_GROUP"
  | "BOOKING"
  | "PILGRIM"
  | "TWO_TRAVELLERS"
  | "NO_BOOKING"
  | "NO_PROFILE"
  | "CONTACT_NUMBER";

/** The team task board category a task-shaped conversion lands on (`departure_group_tasks.category`). */
export type TaskBoardCategory = "OPERATIONS" | "VISA" | "FINANCE" | "GUIDE" | "MARKETING";

export type ConversionFieldType = "SELECT" | "NUMBER" | "BOOLEAN";

/** Something the person decides before the conversion is made. The choices themselves come from the server. */
export interface ConversionFieldSpec {
  name: string;
  label: string;
  type: ConversionFieldType;
}

export interface ConversionSpec {
  kind: ConversionKind;
  label: string;
  /** One plain sentence: what will be created. */
  description: string;
  needs: readonly ConversionNeed[];
  /** What the person must choose; empty for a one-tap conversion. */
  fields: readonly ConversionFieldSpec[];
  /** Set for the task-shaped conversions. */
  taskCategory?: TaskBoardCategory;
  /** The title prefix of the task or case that is created. */
  titlePrefix: string;
}

const NO_FIELDS: readonly ConversionFieldSpec[] = [];

export const CONVERSION_CATALOGUE: Readonly<Record<ConversionKind, ConversionSpec>> = {
  CONVERSATION_DOCUMENT_REQUEST: {
    kind: "CONVERSATION_DOCUMENT_REQUEST",
    label: "Request documents",
    description: "Adds a task for the team to ask this customer for their travel documents.",
    needs: ["DEPARTURE_GROUP"],
    fields: NO_FIELDS,
    taskCategory: "OPERATIONS",
    titlePrefix: "Request documents",
  },
  CONVERSATION_VISA_TASK: {
    kind: "CONVERSATION_VISA_TASK",
    label: "Create visa task",
    description: "Adds a task for the visa team about this customer's visa.",
    needs: ["DEPARTURE_GROUP"],
    fields: NO_FIELDS,
    taskCategory: "VISA",
    titlePrefix: "Visa follow-up",
  },
  CONVERSATION_PAYMENT_FOLLOW_UP: {
    kind: "CONVERSATION_PAYMENT_FOLLOW_UP",
    label: "Follow up on payment",
    description: "Adds a task for Finance to follow up on this customer's payment.",
    needs: ["DEPARTURE_GROUP"],
    fields: NO_FIELDS,
    taskCategory: "FINANCE",
    titlePrefix: "Payment follow-up",
  },
  CONVERSATION_ROOMING_REQUEST: {
    kind: "CONVERSATION_ROOMING_REQUEST",
    label: "Rooming request",
    description: "Adds a task for Operations to handle this customer's room request.",
    needs: ["DEPARTURE_GROUP"],
    fields: NO_FIELDS,
    taskCategory: "OPERATIONS",
    titlePrefix: "Rooming request",
  },
  CONVERSATION_TRANSPORT_REQUIREMENT: {
    kind: "CONVERSATION_TRANSPORT_REQUIREMENT",
    label: "Transport requirement",
    description: "Adds a task for Operations to arrange transport this customer asked for.",
    needs: ["DEPARTURE_GROUP"],
    fields: NO_FIELDS,
    taskCategory: "OPERATIONS",
    titlePrefix: "Transport requirement",
  },
  CONVERSATION_GUIDE_ESCALATION: {
    kind: "CONVERSATION_GUIDE_ESCALATION",
    label: "Escalate to guide",
    description: "Adds a task for the group's guide about something this customer raised.",
    needs: ["DEPARTURE_GROUP"],
    fields: NO_FIELDS,
    taskCategory: "GUIDE",
    titlePrefix: "Guide escalation",
  },
  CONVERSATION_COMPLAINT_CASE: {
    kind: "CONVERSATION_COMPLAINT_CASE",
    label: "Open complaint case",
    description: "Opens a support case for this customer's complaint so the team can follow it up.",
    needs: ["PILGRIM"],
    fields: NO_FIELDS,
    titlePrefix: "Complaint",
  },
  CONVERSATION_PILGRIM_PROFILE: {
    kind: "CONVERSATION_PILGRIM_PROFILE",
    label: "Create traveller profile",
    description: "Creates this customer's traveller profile from their lead, so documents and support cases can be attached to them.",
    needs: ["LEAD", "NO_PROFILE"],
    fields: NO_FIELDS,
    titlePrefix: "Traveller profile",
  },
  CONVERSATION_TRAVELLER_RELATIONSHIP: {
    kind: "CONVERSATION_TRAVELLER_RELATIONSHIP",
    label: "Record family or mahram link",
    description: "Records how two travellers on this booking are related, so rooming and mahram checks can use it.",
    needs: ["BOOKING", "TWO_TRAVELLERS"],
    fields: [
      { name: "fromTravellerId", label: "This traveller", type: "SELECT" },
      { name: "relationship", label: "is the … of", type: "SELECT" },
      { name: "toTravellerId", label: "This traveller", type: "SELECT" },
      { name: "isMahram", label: "Counts as a mahram", type: "BOOLEAN" },
    ],
    titlePrefix: "Traveller relationship",
  },
  CONVERSATION_SEAT_HOLD: {
    kind: "CONVERSATION_SEAT_HOLD",
    label: "Hold seats",
    description: "Holds seats on the selected departure for a limited time. It is a hold, not a confirmed booking, and it releases itself when the time is up.",
    needs: ["LEAD", "DEPARTURE_GROUP", "NO_BOOKING", "CONTACT_NUMBER"],
    fields: [{ name: "seats", label: "Seats to hold", type: "NUMBER" }],
    titlePrefix: "Seat hold",
  },
  CONVERSATION_PACKAGE_RECOMMENDATION: {
    kind: "CONVERSATION_PACKAGE_RECOMMENDATION",
    label: "Recommend a package",
    description: "Records a package recommendation on the customer's lead. It does not change what the customer chose.",
    needs: ["LEAD"],
    fields: [{ name: "packageId", label: "Package to recommend", type: "SELECT" }],
    titlePrefix: "Package recommendation",
  },
  CONVERSATION_FEEDBACK_REQUEST: {
    kind: "CONVERSATION_FEEDBACK_REQUEST",
    label: "Request post-trip feedback",
    description: "Adds a task to send this customer a feedback survey after their trip.",
    needs: ["DEPARTURE_GROUP"],
    fields: [{ name: "surveyId", label: "Survey to send", type: "SELECT" }],
    taskCategory: "MARKETING",
    titlePrefix: "Post-trip feedback",
  },
};

/** What the conversation is already connected to. Read on the server; the browser never supplies it. */
export interface ConversationConversionFacts {
  /** The customer message the new object will point back at. Null when the conversation has no messages at all. */
  sourceMessageId: string | null;
  leadId: string | null;
  departureGroupId: string | null;
  departureGroupName: string | null;
  bookingId: string | null;
  /** How many travellers the booking lists. */
  travellerCount: number;
  /** The traveller record a support case attaches to. */
  pilgrimId: string | null;
  /** True when a traveller profile already exists for this customer (from a booking, or created from this lead). */
  hasTravellerProfile: boolean;
  /** True when the lead (or the conversation) has a phone number staff could call. */
  hasContactNumber: boolean;
}

export interface OfferedConversion {
  kind: ConversionKind;
  label: string;
  description: string;
  /** What the person will be asked to choose; empty for a one-tap conversion. */
  fields: readonly ConversionFieldSpec[];
  available: boolean;
  /** Why it cannot be made yet, in words a salesperson can act on. Null when available. */
  reason: string | null;
}

const NEED_REASON: Record<ConversionNeed, string> = {
  LEAD: "Link this conversation to a lead first.",
  DEPARTURE_GROUP: "Select a departure group for this customer first.",
  BOOKING: "This customer has no booking yet.",
  PILGRIM: "This customer has no traveller record yet. It appears once their booking lists them as a traveller.",
  TWO_TRAVELLERS: "A relationship needs two travellers on the booking.",
  NO_BOOKING: "This customer already has a booking or a seat hold.",
  NO_PROFILE: "This customer already has a traveller record.",
  CONTACT_NUMBER: "Add the customer's phone number to their lead first.",
};

function needIsMet(need: ConversionNeed, facts: ConversationConversionFacts): boolean {
  switch (need) {
    case "LEAD": return facts.leadId !== null;
    case "DEPARTURE_GROUP": return facts.departureGroupId !== null;
    case "BOOKING": return facts.bookingId !== null;
    case "PILGRIM": return facts.pilgrimId !== null;
    case "TWO_TRAVELLERS": return facts.travellerCount >= 2;
    case "NO_BOOKING": return facts.bookingId === null;
    case "NO_PROFILE": return !facts.hasTravellerProfile;
    case "CONTACT_NUMBER": return facts.hasContactNumber;
  }
}

/** Reason a conversion cannot be made from these facts, or null when it can. */
export function conversionBlocker(kind: ConversionKind, facts: ConversationConversionFacts): string | null {
  if (!facts.sourceMessageId) return "This conversation has no messages to point back at.";
  for (const need of CONVERSION_CATALOGUE[kind].needs) {
    if (!needIsMet(need, facts)) return NEED_REASON[need];
  }
  return null;
}

export function offeredConversions(facts: ConversationConversionFacts): OfferedConversion[] {
  return CONVERSION_KINDS.map((kind) => {
    const spec = CONVERSION_CATALOGUE[kind];
    const reason = conversionBlocker(kind, facts);
    return { kind, label: spec.label, description: spec.description, fields: spec.fields, available: reason === null, reason };
  });
}

/** How long a new task is given before it is due, so it never opens already overdue. */
export const CONVERSION_TASK_DUE_HOURS = 24;

/** Title of the created task or case: "Request documents — Amina (LD-1042)". */
export function conversionTitle(kind: ConversionKind, customerName: string, reference: string | null): string {
  const who = customerName.trim() || "Customer";
  return `${CONVERSION_CATALOGUE[kind].titlePrefix} — ${who}${reference ? ` (${reference})` : ""}`;
}

/** What a chosen value is called in the "Check before creating" step. */
export type ConversionParams = Record<string, string | number | boolean>;

/** One option of a SELECT field. */
export interface ConversionChoiceOption {
  value: string;
  label: string;
}

/** The server's answer for one field: the options to pick from, or the bounds of a number. */
export interface ConversionFieldChoices {
  name: string;
  options?: ConversionChoiceOption[];
  min?: number;
  max?: number;
  defaultValue?: string | number | boolean;
}
