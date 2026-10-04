/**
 * The consent gate — Plan §3.6. A pure, shared reach-eligibility check:
 * whether one specific person may be contacted through one specific
 * channel right now.
 *
 * Extracted so every future Class 2 proposal that ends in a message
 * (payment reminders, referral/loyalty outreach, guide announcements) can
 * re-check consent at *execute* time through the same rule
 * `lib/data/announcements-repository.ts`'s reach computation already
 * uses, rather than each proposal kind growing its own copy of "is this
 * person opted out." `announcements-repository.ts` itself is left calling
 * its existing inline logic unchanged in this slice — adopting this
 * shared module there is a follow-up, not a behaviour change bundled into
 * Phase 0.
 *
 * Deliberately pure and client-safe (no `server-only`, no Supabase) — the
 * caller fetches the person's consent columns and passes them in; this
 * module only holds the (still non-trivial) decision logic, so it stays
 * unit-testable.
 */

import type { ConsentChannel, ConsentStatus } from "@/lib/types/consent";

export interface ConsentFacts {
  consentStatus: ConsentStatus;
  doNotContact: boolean;
  contactableChannels: ConsentChannel[];
}

export type ConsentExclusionReason =
  | "OPTED_OUT"
  | "DO_NOT_CONTACT"
  | `NO_CHANNEL_CONSENT:${ConsentChannel}`
  | "NO_CONTACT_VALUE";

export type ConsentCheckResult =
  | { allowed: true }
  | { allowed: false; reason: ConsentExclusionReason };

/**
 * `hasContactValue` is passed in rather than inferred — a lead/pilgrim can
 * have `contactableChannels` including WHATSAPP but no phone number on
 * file (e.g. a walk-in registered by email only); that is a data gap, not
 * a consent decision, so it gets its own distinct reason.
 */
export function checkConsent(
  facts: ConsentFacts,
  channel: ConsentChannel,
  hasContactValue: boolean,
): ConsentCheckResult {
  if (facts.doNotContact) return { allowed: false, reason: "DO_NOT_CONTACT" };
  if (facts.consentStatus === "OPTED_OUT") return { allowed: false, reason: "OPTED_OUT" };
  if (!facts.contactableChannels.includes(channel)) {
    return { allowed: false, reason: `NO_CHANNEL_CONSENT:${channel}` };
  }
  if (!hasContactValue) return { allowed: false, reason: "NO_CONTACT_VALUE" };
  return { allowed: true };
}
