/**
 * BANK_DETAIL_MISMATCH — the customer (or a forwarded message) gives a bank account that is not one the agency has approved.
 * Pure, no model. The number matching is the S0 gate's own (`mentionsUnapprovedBankDetails`), so the gate and S4 can never
 * disagree: a bank word plus a 6–20 digit run that is absent from the approved list. An approved account never fires.
 */

import { mentionsUnapprovedBankDetails } from "@/lib/inbox/intelligence/gate";

import { snippetOf, type RiskDetector, type RiskFacts, type RiskFinding } from "../types";

export function detectBankDetailMismatch(facts: RiskFacts): RiskFinding | null {
  const message = facts.latest;
  if (!message || !mentionsUnapprovedBankDetails(message.text, facts.approvedAccounts)) return null;
  return { code: "BANK_DETAIL_MISMATCH", messageId: message.id, confidence: 0.9, evidence: [{ messageId: message.id, snippet: snippetOf(message.text) }] };
}

export const bankDetailMismatch: RiskDetector = { code: "BANK_DETAIL_MISMATCH", detect: detectBankDetailMismatch };
