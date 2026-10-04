/**
 * The facts every S4 detector reads, and what a detector returns — MI4.1 of docs/inbox/implementation-plan.md
 * (Architecture §6 S4). Pure and client-safe. A detector never touches the database: the caller loads `RiskFacts` once
 * (lib/data/inbox-risk-repository.ts) and every detector is a plain function of it, so each is tested with no setup.
 */

import type { Evidence, MatchedOfferSnapshot, OfferCheckState, SignalCode } from "@/lib/inbox/intelligence/contracts";

export interface RiskMessage {
  id: string;
  text: string;
  /** TEXT, IMAGE, DOCUMENT, AUDIO … as stored on the message. */
  type: string;
  createdAt: string;
  /** A file name the customer sent, when the channel gives one. */
  attachmentName: string | null;
}

export interface RiskPassenger {
  name: string;
  passportExpiry: string | null;
  dateOfBirth: string | null;
}

export interface RiskFacts {
  /** ISO time of this run. */
  now: string;
  /** The customer's newest message, if any. */
  latest: RiskMessage | null;
  /** The customer wrote last and we have not answered. */
  awaitingReply: boolean;
  /** Staff and AI messages, oldest first. */
  outbound: RiskMessage[];
  intentConfidence: number | null;
  matchedOffer: MatchedOfferSnapshot | null;
  /** The stored offer compared with the live group (R1). null = there is no offer, or it could not be checked. */
  offerCheck: OfferCheckState | null;
  /** How many people the customer is travelling with, when known. */
  partySize: number | null;
  /** What S2 read as accessibility needs. */
  accessibilityNeeds: string[];
  /** The departure the customer asked for (the lead's chosen group, else the matched offer's), read live. */
  requestedGroup: { name: string; availableSeats: number; sellable: boolean } | null;
  /** Payments on the conversation's booking; null when the conversation has no booking. Only COMPLETED payments are confirmed. */
  payments: { confirmedTotal: number; confirmedCount: number; pendingCount: number } | null;
  /** Digits of the accounts the agency has approved to receive money. Empty means none are on file. */
  approvedAccounts: string[];
  passengers: RiskPassenger[];
  departureDate: string | null;
  passportValidityMonths: number;
  serviceWindowExpiresAt: string | null;
  composing: { staffId: string; at: string } | null;
  /** Booking references the customer quoted, and whether the agency has a booking with that reference. */
  claimedReferences: Array<{ reference: string; exists: boolean }>;
}

/** What a detector found. `messageId` is the message that caused it (null for a finding about state, not a message). */
export interface RiskFinding {
  code: SignalCode;
  messageId: string | null;
  confidence: number;
  evidence: Evidence[];
}

export interface RiskDetector {
  code: SignalCode;
  detect: (facts: RiskFacts) => RiskFinding | null;
}

export const snippetOf = (text: string, max = 300): string => {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${Array.from(collapsed).slice(0, max - 1).join("")}…`;
};

/** Lower-cased, accents and repeated spaces removed: what the phrase rules read. */
export const normaliseText = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
