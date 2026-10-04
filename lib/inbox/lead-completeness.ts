/**
 * How much of what a sales conversation needs is known, worked out from fields the lead already stores. It is a plain
 * checklist, not a score: staff see exactly which details are missing and can ask for the next one.
 *
 * Journey type is deliberately not counted: a chat lead is created as Umrah by default, so it says nothing about what
 * the customer actually asked for.
 */

export type CompletenessKey = "PACKAGE" | "PERIOD" | "CONTACT" | "TRAVELLERS" | "ROOM";

export interface LeadCompletenessInput {
  desiredPackageName: string | null;
  preferredPeriod: string;
  mobile: string;
  email: string | null;
  adults: number;
  children: number;
  roomPreference: "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE" | "UNDECIDED";
}

export interface CompletenessItem {
  key: CompletenessKey;
  label: string;
  collected: boolean;
}

export interface LeadCompleteness {
  items: CompletenessItem[];
  collectedCount: number;
  totalCount: number;
  /** The first missing item, in the order staff should ask. Null when everything is known. */
  next: CompletenessItem | null;
}

/** Asked in the customer's terms. It goes into the message box for staff to read and edit — never sent by itself. */
const QUESTION: Record<CompletenessKey, string> = {
  PACKAGE: "Which package are you interested in?",
  PERIOD: "When would you like to travel?",
  CONTACT: "What is the best phone number or email to reach you on?",
  TRAVELLERS: "How many people will be travelling, and how many of them are children?",
  ROOM: "Which room type would you prefer: quad, triple, double or single?",
};

export function leadCompletenessFor(lead: LeadCompletenessInput): LeadCompleteness {
  const items: CompletenessItem[] = [
    { key: "PACKAGE", label: "Package interest", collected: Boolean(lead.desiredPackageName?.trim()) },
    { key: "PERIOD", label: "Travel period", collected: Boolean(lead.preferredPeriod.trim()) },
    { key: "CONTACT", label: "Contact details", collected: Boolean(lead.mobile.trim() || lead.email?.trim()) },
    { key: "TRAVELLERS", label: "Number of travellers", collected: lead.adults + lead.children >= 1 },
    { key: "ROOM", label: "Room preference", collected: lead.roomPreference !== "UNDECIDED" },
  ];
  return {
    items,
    collectedCount: items.filter((item) => item.collected).length,
    totalCount: items.length,
    next: items.find((item) => !item.collected) ?? null,
  };
}

export function nextQuestionDraft(key: CompletenessKey): string {
  return QUESTION[key];
}
