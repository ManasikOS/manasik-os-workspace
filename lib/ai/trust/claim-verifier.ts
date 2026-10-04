/**
 * The claim verifier — Plan §3.6. Generalises the WhatsApp agent's
 * unattributed-number guard (`lib/agent/whatsapp/guardrails.ts`'s
 * `containsUnattributedNumber()`) into a shared check any surface's draft
 * output can run before it ever reaches a customer, pilgrim, agent or
 * supplier: every number, date, or currency amount in the draft must
 * appear somewhere in the facts that were actually given to the model.
 *
 * Deliberately pure and client-safe — no `server-only`, no Supabase — so
 * it is unit-testable (see `claim-verifier.test.ts`) and usable from a
 * Server Action's response-shaping step without a database round trip.
 *
 * This is NOT a semantic fact-checker. It cannot tell whether "3 seats"
 * is the *right* number, only whether "3" appears anywhere in the pack's
 * own facts. Semantic correctness is the pack's job (it must only contain
 * true, current data); this module's job is narrower and mechanical:
 * catch a number the model invented that has no source in the pack at
 * all — the same posture the WhatsApp guard already takes.
 */

import { findNeverPromise, type NeverPromiseMatch } from "@/lib/inbox/risk/never-promise";

export interface ClaimVerifierViolation {
  span: string;
  kind: "number" | "date" | "currency";
}

export interface ClaimVerifierResult {
  ok: boolean;
  violations: ClaimVerifierViolation[];
}

/** A draft's verdict: figures with no source in the facts, AND anything on the never-autonomous list (Architecture §10.3). */
export interface DraftVerification extends ClaimVerifierResult {
  forbidden: NeverPromiseMatch[];
}

/**
 * A run of 3+ digits, optionally comma-grouped, with an optional decimal
 * tail — prices, seat counts, dates written as numbers. The decimal group
 * requires an actual digit after the dot, so a sentence-ending period
 * right after a number (".. on the 15.") is never swept into the match —
 * the bug that motivated writing this as its own named pattern rather
 * than inlining a loose `[\d,.]` character class.
 */
const NUMBER_PATTERN = /\d[\d,]{2,}(?:\.\d+)?/g;

/**
 * Flattens every primitive value in a JSON-shaped object into a set of
 * normalised strings the verifier can match a draft's numbers against.
 * Numbers are stringified without thousands separators so "45,000" in a
 * draft matches a fact stored as `45000`.
 */
function collectFactStrings(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    out.add(String(value));
    return;
  }
  if (typeof value === "string") {
    out.add(value);
    // Also index any digit run inside the string on its own, so a fact like
    // "45 available seats" still matches a draft that just says "45".
    for (const match of value.matchAll(NUMBER_PATTERN)) {
      out.add(match[0].replace(/,/g, ""));
    }
    return;
  }
  if (typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (const item of value) collectFactStrings(item, out);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectFactStrings(v, out);
  }
}

/**
 * Verifies that every digit-run in `draftText` (length >= 3, i.e. a
 * plausible price/seat-count/date-as-number, not a small ordinal like
 * "3 days") appears somewhere in `facts`. Returns every unmatched span as
 * a violation; `ok` is true only when there are none.
 */
export function verifyClaims(draftText: string, facts: unknown): ClaimVerifierResult {
  const factStrings = new Set<string>();
  collectFactStrings(facts, factStrings);

  const violations: ClaimVerifierViolation[] = [];
  for (const match of draftText.matchAll(NUMBER_PATTERN)) {
    const normalised = match[0].replace(/,/g, "");
    if (!factStrings.has(normalised) && !factStrings.has(match[0])) {
      violations.push({ span: match[0], kind: "number" });
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * `verifyClaims` plus the never-promise phrase matcher, for a draft an AI wrote. `ok` needs BOTH: every figure grounded in the
 * facts and nothing the agency may never say automatically. The autonomy level is not an input, so no level can loosen it.
 */
export function verifyDraft(draftText: string, facts: unknown, options: { approvedAccountDigits?: readonly string[] } = {}): DraftVerification {
  const figures = verifyClaims(draftText, facts);
  const forbidden = findNeverPromise(draftText, options.approvedAccountDigits ?? []);
  return { ok: figures.ok && forbidden.length === 0, violations: figures.violations, forbidden };
}
