/**
 * Pure decision logic for `linkConversationToLead()` (lead-linking.ts),
 * split out so it can be unit-tested without a Supabase client — mirrors how
 * `bank-statement-csv.ts` is split from `reconciliation-repository.ts`'s
 * `"server-only"` guard.
 *
 * Takes data the I/O layer has already fetched and decides, without
 * guessing: provider identity wins, then exactly one phone match; two or
 * more phone candidates are left for staff to resolve by hand rather than
 * picked between.
 */

export type LeadCandidate = {
  id: string;
  reference: string;
  full_name: string;
  mobile: string;
  stage: string;
};

export type LeadLinkSource = "EXISTING_CONVERSATION" | "EXACT_IDENTITY" | "EXACT_PHONE" | "CREATED" | "AMBIGUOUS" | "PROPOSED";

/** What the identity graph (lib/inbox/identity/graph.ts) found among the agency's existing leads. */
export interface GraphMatches {
  /** Leads with an exact normalized phone or email: the only match that may link without a person. */
  exact: LeadCandidate[];
  /** Leads that might be the same person (MEDIUM or HIGH band), best first. Never linked by themselves. */
  proposals: LeadCandidate[];
}

export interface DecideLeadLinkInput {
  /** The lead this conversation is already linked to, if any. */
  existingLead: LeadCandidate | null;
  /** A lead already matched to this exact provider+external-subject identity, if any. */
  identityMatchedLead: LeadCandidate | null;
  /** Leads whose mobile matches the conversation's normalized phone number, if one was derivable. */
  phoneCandidates: LeadCandidate[];
  /** Only inbound capture and an explicit staff action may create a lead. */
  createIfMissing: boolean;
  /** Absent for callers that do not consult the graph; then behaviour is exactly as before MI3.3. */
  graph?: GraphMatches;
}

export type LeadLinkDecision =
  /** Nothing to do — already linked. */
  | { action: "EXISTING"; lead: LeadCandidate; source: "EXISTING_CONVERSATION" }
  /** Attach using the matched identity. */
  | { action: "ATTACH"; lead: LeadCandidate; source: "EXACT_IDENTITY" | "EXACT_PHONE" }
  /** Create a new minimal lead and attach it. */
  | { action: "CREATE" }
  /** More than one phone candidate, or no candidate and creation wasn't requested — leave for staff review. */
  | { action: "AMBIGUOUS" }
  /** A person might already be a lead: show the "Possible existing lead found" card and create nothing yet. */
  | { action: "PROPOSE"; candidates: LeadCandidate[] };

/**
 * Resolve one CRM lead without guessing: provider identity wins, then one
 * exact normalized-phone match. Multiple phone candidates remain unlinked
 * for staff review. An unknown inbound contact can be captured as a minimal
 * lead only when the caller opts in via `createIfMissing`.
 */
export function decideLeadLink(input: DecideLeadLinkInput): LeadLinkDecision {
  if (input.existingLead) {
    return { action: "EXISTING", lead: input.existingLead, source: "EXISTING_CONVERSATION" };
  }

  if (input.identityMatchedLead) {
    return { action: "ATTACH", lead: input.identityMatchedLead, source: "EXACT_IDENTITY" };
  }

  if (input.phoneCandidates.length === 1) {
    return { action: "ATTACH", lead: input.phoneCandidates[0], source: "EXACT_PHONE" };
  }
  if (input.phoneCandidates.length > 1) {
    return { action: "AMBIGUOUS" };
  }

  if (!input.createIfMissing) {
    return { action: "AMBIGUOUS" };
  }

  // Beyond the exact phone: the graph. One exact email links; a mere resemblance never does.
  if (input.graph?.exact.length === 1) {
    return { action: "ATTACH", lead: input.graph.exact[0], source: "EXACT_IDENTITY" };
  }
  if (input.graph && input.graph.exact.length > 1) {
    return { action: "AMBIGUOUS" };
  }
  if (input.graph && input.graph.proposals.length > 0) {
    return { action: "PROPOSE", candidates: input.graph.proposals };
  }

  return { action: "CREATE" };
}
