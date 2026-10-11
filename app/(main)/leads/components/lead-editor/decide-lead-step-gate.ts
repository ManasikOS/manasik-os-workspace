import type { AddLeadFormData } from "../../types";

import { isLeadDuplicateResolved } from "@/lib/data/lead-duplicate-gate";

export type LeadEditorStepId =
  "duplicate" | "contact" | "sales" | "travel" | "action" | "review";

export interface LeadStepGate {
  canContinue: boolean;
  /** Plain-words reason shown while Continue is blocked; null when it is not. */
  reason: string | null;
}

interface DecideLeadStepGateInput {
  stepId: LeadEditorStepId;
  formData: AddLeadFormData;
  hasDuplicate: boolean;
  /** The duplicate lookup is still running. Optional: the dialog looks up synchronously. */
  isCheckingDuplicate?: boolean;
  /** Result of `validateLeadForm`, by field key. */
  errors: Record<string, string>;
}

const OPEN: LeadStepGate = { canContinue: true, reason: null };

/**
 * Whether the person may leave a step by pressing Continue, and if not, why.
 * Steps without hard requirements (sales setup, travel interest, review)
 * always continue.
 */
export function decideLeadStepGate({
  stepId,
  formData,
  hasDuplicate,
  isCheckingDuplicate = false,
  errors,
}: DecideLeadStepGateInput): LeadStepGate {
  switch (stepId) {
    case "duplicate": {
      // The mobile must have been entered (nine digits or more) so the check
      // has run, and any match must be answered before moving on.
      const digits = formData.mobile.replace(/\D/g, "");
      if (digits.length < 9) {
        return {
          canContinue: false,
          reason: "Enter the mobile number first to check for duplicates",
        };
      }
      if (isCheckingDuplicate) {
        return { canContinue: false, reason: "Checking for an existing lead…" };
      }
      if (isLeadDuplicateResolved(hasDuplicate, formData)) return OPEN;
      return {
        canContinue: false,
        reason: !formData.duplicateReason
          ? "Select a reason for the duplicate before continuing"
          : "Confirm you want to create a separate lead",
      };
    }
    case "contact": {
      const reason = errors.fullName ?? errors.mobile ?? errors.email ?? null;
      return { canContinue: reason === null, reason };
    }
    case "action": {
      const reason = errors.nextFollowUpAt ?? null;
      return { canContinue: reason === null, reason };
    }
    default:
      return OPEN;
  }
}
