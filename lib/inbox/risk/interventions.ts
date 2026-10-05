/**
 * From a signal to a demand — MI4.2 of docs/inbox/implementation-plan.md (Architecture §5.3). Pure.
 *
 * A signal is an observation; an intervention is a "human review required" card with a headline, guidance, the one action that
 * clears it and the role that owns it. Which signals become interventions, and how they read, is decided here and nowhere else.
 * Signals about the clock and the composer (`WINDOW_CLOSING_SOON`, `CONCURRENT_COMPOSER`, `LOW_CONFIDENCE_DRAFT`) stay signals:
 * nothing about them needs a person to sign off.
 */

import type { InterventionKind, InterventionSeverity, NextActionCode, SignalCode } from "@/lib/inbox/intelligence/contracts";

export interface InterventionSpec {
  kind: InterventionKind;
  severity: InterventionSeverity;
  headline: string;
  guidance: string;
  requiredActionCode: NextActionCode;
  /** The staff role that owns the review. Notified when it opens. */
  assignedRole: "ADMIN" | "FINANCE" | "MARKETING" | "OPERATIONS" | "VISA";
}

export const INTERVENTION_FOR_SIGNAL: Readonly<Partial<Record<SignalCode, InterventionSpec>>> = {
  PAYMENT_CLAIM_UNVERIFIED: {
    kind: "PAYMENT_CLAIM",
    severity: "BLOCK",
    headline: "The customer says they paid, but no payment is recorded",
    guidance: "Do not confirm the payment. Check the bank statement and the payments list, record it if it is there, then resolve this with a note. Until then, acknowledge the message without confirming.",
    requiredActionCode: "VERIFY_PAYMENT",
    assignedRole: "FINANCE",
  },
  BANK_DETAIL_MISMATCH: {
    kind: "BANK_DETAIL_MISMATCH",
    severity: "BLOCK",
    headline: "A bank account was mentioned that is not on the approved list",
    guidance: "Do not send or confirm these details. Only accounts on the approved list may be given to a customer. If this account is genuine, Finance adds it to the list; if not, warn the customer.",
    requiredActionCode: "ESCALATE_TO_HUMAN",
    assignedRole: "FINANCE",
  },
  STALE_PRICE_QUOTED: {
    kind: "STALE_PRICE",
    severity: "REVIEW",
    headline: "A price we sent has changed since",
    guidance: "The price on this departure was updated after it was quoted. Check the group and tell the customer the current price before they act on the old one.",
    requiredActionCode: "OPEN_DEPARTURE_GROUP",
    assignedRole: "MARKETING",
  },
  GROUP_FULL_REQUESTED: {
    kind: "GROUP_FULL",
    severity: "REVIEW",
    headline: "The departure they want cannot take the whole party",
    guidance: "There are not enough seats, or the departure is closed. Do not promise seats. Offer the waitlist or another departure.",
    requiredActionCode: "OPEN_DEPARTURE_GROUP",
    assignedRole: "MARKETING",
  },
  PASSPORT_EXPIRY_RISK: {
    kind: "PASSPORT_EXPIRY",
    severity: "REVIEW",
    headline: "A passport may not be valid long enough",
    guidance: "A traveller's passport expires too soon after the departure date. Ask for a renewed passport before the booking goes further.",
    requiredActionCode: "REQUEST_DOCUMENTS",
    assignedRole: "OPERATIONS",
  },
  SENSITIVE_DOC_RECEIVED: {
    kind: "SENSITIVE_DOCUMENT",
    severity: "REVIEW",
    headline: "The customer sent an identity or financial document",
    guidance: "Handle this file with care. Move it to the traveller's record and do not forward or repeat its contents in the chat.",
    requiredActionCode: "REQUEST_DOCUMENTS",
    assignedRole: "OPERATIONS",
  },
  MINOR_OR_ASSISTANCE_NEEDED: {
    kind: "ASSISTANCE_NEEDED",
    severity: "REVIEW",
    headline: "A traveller is a minor or needs assistance",
    guidance: "Check the guardian and assistance arrangements before confirming. Do not promise services that have not been arranged.",
    requiredActionCode: "ESCALATE_TO_HUMAN",
    assignedRole: "OPERATIONS",
  },
  UNRECORDED_BOOKING_CLAIM: {
    kind: "UNRECORDED_BOOKING",
    severity: "REVIEW",
    headline: "The customer quoted a booking we cannot find",
    guidance: "Search by name and phone before replying. Do not say a booking exists until you have found it.",
    requiredActionCode: "ESCALATE_TO_HUMAN",
    assignedRole: "MARKETING",
  },
  REFUND_REQUEST: {
    kind: "REFUND_REQUEST",
    severity: "BLOCK",
    headline: "The customer is asking for a refund",
    guidance: "Do not promise or refuse a refund. Finance decides. Acknowledge the request and say a colleague will come back to them.",
    requiredActionCode: "ESCALATE_TO_HUMAN",
    assignedRole: "FINANCE",
  },
  COMPLAINT_ESCALATION: {
    kind: "COMPLAINT",
    severity: "REVIEW",
    headline: "The customer is making a complaint",
    guidance: "Answer personally and do not close the complaint yourself. Listen, apologise where it is due, and say who will follow up and when.",
    requiredActionCode: "ESCALATE_TO_HUMAN",
    assignedRole: "OPERATIONS",
  },
  FRAUD_CONCERN: {
    kind: "FRAUD_CONCERN",
    severity: "BLOCK",
    headline: "The customer is worried about fraud",
    guidance: "Reassure them with facts a person can stand behind: the agency's registration and its approved bank accounts. Do not send bank details in the chat, and do not confirm any payment until Finance has checked it.",
    requiredActionCode: "ESCALATE_TO_HUMAN",
    assignedRole: "FINANCE",
  },
  MEDICAL_URGENCY: {
    kind: "MEDICAL_URGENCY",
    severity: "BLOCK",
    headline: "Someone may be ill or in a medical emergency",
    guidance: "A person should answer now. Do not give medical advice. If it is an emergency, tell them to contact local emergency services, then involve Operations.",
    requiredActionCode: "ESCALATE_TO_HUMAN",
    assignedRole: "OPERATIONS",
  },
  RELIGIOUS_RULING_REQUEST: {
    kind: "RELIGIOUS_RULING",
    severity: "REVIEW",
    headline: "The customer is asking for a religious ruling",
    guidance: "Do not give a ruling. Point them to a qualified scholar or the group's Ustaz and say so kindly.",
    requiredActionCode: "ESCALATE_TO_HUMAN",
    assignedRole: "OPERATIONS",
  },
  DISTRESS_LANGUAGE: {
    kind: "DISTRESSED_CUSTOMER",
    severity: "BLOCK",
    headline: "The customer sounds distressed or in trouble",
    guidance: "A person should answer this now, kindly and personally. No automated reply.",
    requiredActionCode: "ESCALATE_TO_HUMAN",
    assignedRole: "OPERATIONS",
  },
};

export function interventionForSignal(code: SignalCode): InterventionSpec | null {
  return INTERVENTION_FOR_SIGNAL[code] ?? null;
}

/**
 * Roles that may close a review. The money and refund reviews belong to Finance (and Admin). The rest belong to the people who answer customers in
 * the Inbox (Admin, Marketing, Operations): Finance cannot reply there, so it does not decide a complaint or a medical-urgency review.
 */
const FINANCE_KINDS: readonly InterventionKind[] = ["PAYMENT_CLAIM", "BANK_DETAIL_MISMATCH", "REFUND_REQUEST", "FRAUD_CONCERN"];
const FINANCE_RESOLVERS = ["ADMIN", "FINANCE"];
const INBOX_RESOLVERS = ["ADMIN", "MARKETING", "OPERATIONS"];

export function canCloseIntervention(role: string, kind: InterventionKind): boolean {
  return (FINANCE_KINDS.includes(kind) ? FINANCE_RESOLVERS : INBOX_RESOLVERS).includes(role);
}

/**
 * The Inbox permission a role must also hold, in Roles & Permissions, to close this review: seeing the Inbox for a money review (Finance does not
 * reply there), replying in it for the others. A custom role can be narrowed by it; the role tiers above stay the ceiling.
 */
export function closingCapability(kind: InterventionKind): "viewModule" | "sendMessage" {
  return FINANCE_KINDS.includes(kind) ? "viewModule" : "sendMessage";
}
