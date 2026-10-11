import { normaliseMobile } from "@/lib/data/leads";
import {
  isLeadDuplicateResolved,
  LEAD_DUPLICATE_BLOCKED_MESSAGE,
} from "@/lib/data/lead-duplicate-gate";

import type { AddLeadFormData } from "../../types";
import { localInputToIso } from "../../utils";

export interface ValidateLeadFormInput {
  formData: AddLeadFormData;
  /** An existing lead shares this mobile or email. */
  hasDuplicate: boolean;
  /** Set by the follow-up field's change handler; the clock is never read here. */
  pastFollowUp: string | null;
}

/**
 * Every problem with the form, by field key. Empty means it can be created.
 * Pure: whether the follow-up time has passed is answered by the caller (in an
 * event handler), because reading the clock during render is unstable.
 */
export function validateLeadForm({
  formData,
  hasDuplicate,
  pastFollowUp,
}: ValidateLeadFormInput): Record<string, string> {
  const found: Record<string, string> = {};

  if (!formData.fullName.trim()) {
    found.fullName = "Full name is required";
  }

  const mobile = normaliseMobile(formData.mobile);
  if (!mobile) {
    found.mobile = "Mobile number is required";
  } else if (mobile.length !== 9) {
    found.mobile = "Enter a nine-digit Sri Lankan number, e.g. 77 123 4567";
  }

  if (formData.email.trim()) {
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim());
    if (!valid) found.email = "Please enter a valid email address";
  }

  if (!localInputToIso(formData.nextFollowUpAt)) {
    found.nextFollowUpAt = "Next follow-up date and time is required";
  } else if (pastFollowUp) {
    found.nextFollowUpAt = pastFollowUp;
  }

  if (!isLeadDuplicateResolved(hasDuplicate, formData)) {
    found.duplicate = LEAD_DUPLICATE_BLOCKED_MESSAGE;
  }

  return found;
}
