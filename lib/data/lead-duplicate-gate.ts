/**
 * The rule for creating a lead that looks like one already in the CRM.
 *
 * A match is allowed through only when the person chose a reason and confirmed
 * a separate lead is wanted. Kept as one pure function so the Add Lead screen
 * (to block Continue) and `createLeadAction` (the real gate) cannot drift.
 */

export interface LeadDuplicateOverride {
  duplicateReason: string;
  createAnyway: boolean;
}

/** True when there is no match, or the match has been answered with a reason and a confirmation. */
export function isLeadDuplicateResolved(
  hasMatch: boolean,
  override: LeadDuplicateOverride,
): boolean {
  if (!hasMatch) return true;
  return override.duplicateReason.trim() !== "" && override.createAnyway;
}

export const LEAD_DUPLICATE_BLOCKED_MESSAGE =
  "This looks like an existing lead. Choose a reason and confirm, or open the existing lead.";
