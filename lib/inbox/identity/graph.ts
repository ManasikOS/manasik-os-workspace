/**
 * Cross-channel identity candidates — MI3.3 of docs/inbox/implementation-plan.md (Architecture §5.5, G5). Pure.
 *
 * Question answered: "this new conversation's contact is not any lead we know by an exact phone — could they be a lead we
 * already have?" It ranks existing leads and gives each a confidence BAND, so the Inbox can show the "Possible existing
 * lead found" card instead of quietly creating a duplicate. It never decides: nothing here links or merges anything.
 *
 * Signals (weights add up, capped at 0.99):
 *   - EXACT phone or email ................ EXACT_IDENTITY, the only band that may link without a person
 *   - same last nine digits, prefix differs  0.60  (0771234567 and +94771234567 are the same line; no country-code guessing)
 *   - same full name (two or more words) ..  0.50
 *   - mostly the same name ................  0.30
 *   - same first-and-only word ............  0.15  (never enough alone)
 *   - the month they mention matches ......  0.20
 * Bands: HIGH ≥ 0.75 · MEDIUM ≥ 0.50 · LOW below (LOW is not proposed: a name alone is not evidence, and a wrong link
 * exposes one person's history to another).
 */

import { parseMonthMention } from "@/lib/copilot/sales/intent-extraction";
import { normalizeEmail, normalizePhone } from "@/lib/inbox/identity";

export const CONFIDENCE_BANDS = ["EXACT_IDENTITY", "HIGH", "MEDIUM", "LOW"] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

export const HIGH_CONFIDENCE_FROM = 0.75;
export const PROPOSE_FROM = 0.5;
const PHONE_TAIL_DIGITS = 9;

/** What is known about the contact who just wrote in. */
export interface IdentitySubject {
  displayName: string;
  phone: string | null;
  email: string | null;
  /** Text the customer wrote, used only to read a travel month. Optional. */
  messageText?: string | null;
}

/** An existing lead, as much as the ranking needs. */
export interface LeadForMatching {
  leadId: string;
  fullName: string;
  mobile: string | null;
  email: string | null;
  /** The lead's own words for when they want to travel ("December", "school holidays"). */
  preferredPeriod: string | null;
}

export type IdentitySignal = "EXACT_PHONE" | "EXACT_EMAIL" | "PHONE_TAIL" | "NAME_EXACT" | "NAME_OVERLAP" | "NAME_SINGLE" | "TRAVEL_MONTH";

export interface IdentityCandidate {
  leadId: string;
  score: number;
  band: ConfidenceBand;
  signals: IdentitySignal[];
  /** Plain sentences for the card: why these two might be the same person. */
  reasons: string[];
  /** Only an exact phone or email. Everything else waits for a human. */
  autoConfirm: boolean;
}

/** One open suggestion for the "Possible existing lead found" card. Client-safe: it carries only what the card shows. */
export interface IdentityProposalView {
  linkId: string;
  band: "HIGH" | "MEDIUM";
  leadId: string;
  leadReference: string;
  leadName: string;
  leadMobile: string;
  leadStage: string;
  reasons: string[];
}

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "haji", "hajji", "hajj", "hajjah", "sheikh", "shaikh", "moulavi", "maulavi", "alhaj", "alhaji"]);

/** Lower-case words of a name, without accents, punctuation or titles. */
export function nameTokens(value: string | null | undefined): string[] {
  const words = (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !HONORIFICS.has(word));
  return [...new Set(words)];
}

/** The last nine digits of a phone number: enough to tell 0771234567 from +94771234567, with no country-code guessing. */
export function phoneTail(value: string | null | undefined): string | null {
  const digits = normalizePhone(value);
  return digits && digits.length >= PHONE_TAIL_DIGITS ? digits.slice(-PHONE_TAIL_DIGITS) : null;
}

function nameSignal(subject: string[], lead: string[]): { signal: IdentitySignal; weight: number } | null {
  if (subject.length === 0 || lead.length === 0) return null;
  const shared = subject.filter((word) => lead.includes(word));
  if (shared.length === 0) return null;
  const sameSet = shared.length === subject.length && shared.length === lead.length;
  if (sameSet) return subject.length >= 2 ? { signal: "NAME_EXACT", weight: 0.5 } : { signal: "NAME_SINGLE", weight: 0.15 };
  const overlap = shared.length / Math.max(subject.length, lead.length);
  return shared.length >= 2 && overlap >= 0.66 ? { signal: "NAME_OVERLAP", weight: 0.3 } : null;
}

function monthOf(text: string | null | undefined, nowIso: string): number | null {
  return text ? (parseMonthMention(text, nowIso)?.month ?? null) : null;
}

export function bandOf(score: number): ConfidenceBand {
  return score >= HIGH_CONFIDENCE_FROM ? "HIGH" : score >= PROPOSE_FROM ? "MEDIUM" : "LOW";
}

/** Scores one lead against the contact. Pure; `now` only anchors "next month" style phrases. */
export function scoreCandidate(subject: IdentitySubject, lead: LeadForMatching, nowIso: string): IdentityCandidate {
  const signals: IdentitySignal[] = [];
  const reasons: string[] = [];

  const subjectPhone = normalizePhone(subject.phone);
  const leadPhone = normalizePhone(lead.mobile);
  const subjectEmail = normalizeEmail(subject.email);
  const leadEmail = normalizeEmail(lead.email);

  if (subjectPhone && leadPhone && subjectPhone === leadPhone) {
    return { leadId: lead.leadId, score: 1, band: "EXACT_IDENTITY", signals: ["EXACT_PHONE"], reasons: ["Same phone number."], autoConfirm: true };
  }
  if (subjectEmail && leadEmail && subjectEmail === leadEmail) {
    return { leadId: lead.leadId, score: 1, band: "EXACT_IDENTITY", signals: ["EXACT_EMAIL"], reasons: ["Same email address."], autoConfirm: true };
  }

  let score = 0;
  const subjectTail = phoneTail(subject.phone);
  if (subjectTail && subjectTail === phoneTail(lead.mobile)) {
    score += 0.6;
    signals.push("PHONE_TAIL");
    reasons.push("The phone numbers end the same way (only the country prefix differs).");
  }

  const byName = nameSignal(nameTokens(subject.displayName), nameTokens(lead.fullName));
  if (byName) {
    score += byName.weight;
    signals.push(byName.signal);
    reasons.push(byName.signal === "NAME_EXACT" ? "Same full name." : byName.signal === "NAME_OVERLAP" ? "Very similar name." : "Same first name.");
  }

  const wantedMonth = monthOf(subject.messageText, nowIso);
  if (wantedMonth !== null && wantedMonth === monthOf(lead.preferredPeriod, nowIso)) {
    score += 0.2;
    signals.push("TRAVEL_MONTH");
    reasons.push("Both want to travel in the same month.");
  }

  const capped = Math.min(0.99, Math.round(score * 100) / 100);
  return { leadId: lead.leadId, score: capped, band: bandOf(capped), signals, reasons, autoConfirm: false };
}

/**
 * The leads worth showing a person, best first. LOW candidates are dropped, and any lead the person already said "no" to
 * for this contact (`rejectedLeadIds`) is never proposed again.
 */
export function proposeCandidates(input: {
  subject: IdentitySubject;
  leads: readonly LeadForMatching[];
  rejectedLeadIds?: readonly string[];
  now: string;
}): IdentityCandidate[] {
  const rejected = new Set(input.rejectedLeadIds ?? []);
  return input.leads
    .filter((lead) => !rejected.has(lead.leadId))
    .map((lead) => scoreCandidate(input.subject, lead, input.now))
    .filter((candidate) => candidate.band !== "LOW")
    .sort((a, b) => b.score - a.score || a.leadId.localeCompare(b.leadId));
}
