/**
 * The protection gate — MI4.2 of docs/inbox/implementation-plan.md (Architecture §5.3, §10.3). Pure.
 *
 * Decides whether a piece of outbound text may go out (or be offered as a draft) right now. Three audiences, three rules:
 *
 *   AUTOMATED_SEND  the AI agent's own reply. Refused if it says anything on the never-autonomous list, and refused outright
 *                   while ANY blocking review is open on the conversation: a person owns it until they resolve it.
 *   AI_DRAFT        a Copilot draft a person will read. Refused if it says anything on the never-autonomous list, or says
 *                   something a blocking review guards (a draft that confirms a payment while the payment claim is open).
 *   STAFF_SEND      a person's own message. The never-autonomous list is about automation and does NOT apply. What applies is
 *                   the open review: while the payment claim is open, "we have received your payment" cannot be sent, by anyone,
 *                   until Finance resolves the review with a note. Resolving it is what unblocks.
 *
 * This is the pure decision. Each surface also calls it on the SERVER (the send action, the draft workflow, the agent's outbound
 * gate): hiding a button is never the boundary.
 */

import type { InterventionKind, InterventionSeverity } from "@/lib/inbox/intelligence/contracts";

import { findNeverPromise, type AutonomyLevel, type NeverAutonomousId, type NeverPromiseMatch } from "./never-promise";

export const PROTECTION_AUDIENCES = ["AUTOMATED_SEND", "AI_DRAFT", "STAFF_SEND"] as const;
export type ProtectionAudience = (typeof PROTECTION_AUDIENCES)[number];

/** A review that is still demanding attention (OPEN or ACKNOWLEDGED). Resolved and dismissed ones are not passed in. */
export interface OpenReview {
  kind: InterventionKind;
  severity: InterventionSeverity;
  headline: string;
}

/** Which deny-list entries each kind of review guards while it is open. A kind not listed guards nothing on its own. */
export const INTERVENTION_GUARDS: Readonly<Record<InterventionKind, readonly NeverAutonomousId[]>> = {
  PAYMENT_CLAIM: ["CONFIRM_PAYMENT"],
  BANK_DETAIL_MISMATCH: ["SEND_UNAPPROVED_BANK_DETAILS"],
  STALE_PRICE: [],
  GROUP_FULL: ["CONFIRM_UNAVAILABLE_INVENTORY"],
  PASSPORT_EXPIRY: [],
  REFUND_REQUEST: ["COMMIT_REFUND_OR_CANCELLATION"],
  DISTRESSED_CUSTOMER: [],
  COMPLAINT: ["CLOSE_COMPLAINT"],
  FRAUD_CONCERN: ["CONFIRM_PAYMENT", "SEND_UNAPPROVED_BANK_DETAILS"],
  MEDICAL_URGENCY: ["HEALTH_OR_SAFETY_ADVICE"],
  RELIGIOUS_RULING: ["RELIGIOUS_RULING"],
  SENSITIVE_DOCUMENT: [],
  ASSISTANCE_NEEDED: [],
  UNRECORDED_BOOKING: [],
  SLA_BREACH: [],
};

export type ProtectionReasonCode = "NEVER_AUTONOMOUS" | "OPEN_REVIEW_GUARD" | "OPEN_BLOCKING_REVIEW";

export interface ProtectionReason {
  code: ProtectionReasonCode;
  /** Said to the person in words they can act on. */
  message: string;
  /** The deny-list entry involved, when there is one. */
  entry?: NeverAutonomousId;
}

export interface ProtectionDecision {
  allowed: boolean;
  reasons: ProtectionReason[];
}

export interface ProtectionInput {
  text: string;
  audience: ProtectionAudience;
  openReviews: readonly OpenReview[];
  approvedAccountDigits?: readonly string[];
  /** Accepted, never consulted: no autonomy level can change the answer. */
  level?: AutonomyLevel;
}

const blockingReviews = (reviews: readonly OpenReview[]) => reviews.filter((review) => review.severity === "BLOCK");

const neverAutonomousReason = (match: NeverPromiseMatch): ProtectionReason => ({
  code: "NEVER_AUTONOMOUS",
  entry: match.id,
  message: `An automated reply may never ${match.label}. A person has to say this.`,
});

export function evaluateProtection(input: ProtectionInput): ProtectionDecision {
  void input.level;
  const reasons: ProtectionReason[] = [];
  const blockers = blockingReviews(input.openReviews);
  const matches = findNeverPromise(input.text, input.approvedAccountDigits ?? []);

  if (input.audience === "AUTOMATED_SEND") {
    for (const match of matches) reasons.push(neverAutonomousReason(match));
    if (blockers.length > 0) {
      reasons.push({ code: "OPEN_BLOCKING_REVIEW", message: `A review is open ("${blockers[0].headline}"). A person answers this customer until it is resolved.` });
    }
    return { allowed: reasons.length === 0, reasons };
  }

  if (input.audience === "AI_DRAFT") for (const match of matches) reasons.push(neverAutonomousReason(match));

  // A guard applies to whoever wrote the words: the review, not the author, is what is being protected.
  for (const review of blockers) {
    const guarded = INTERVENTION_GUARDS[review.kind];
    for (const match of matches.filter((candidate) => guarded.includes(candidate.id))) {
      if (reasons.some((reason) => reason.code === "OPEN_REVIEW_GUARD" && reason.entry === match.id)) continue;
      reasons.push({
        code: "OPEN_REVIEW_GUARD",
        entry: match.id,
        message: `This would ${match.label}, but a review is still open ("${review.headline}"). Resolve it first, with a note.`,
      });
    }
  }
  return { allowed: reasons.length === 0, reasons };
}

/** The first sentence to show a person when something is refused. */
export function refusalMessage(decision: ProtectionDecision): string {
  return decision.reasons[0]?.message ?? "This message cannot be sent right now.";
}
