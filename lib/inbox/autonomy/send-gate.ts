import type { AutonomyLevel } from "@/lib/inbox/intelligence/contracts";
import { evaluateProtection, type OpenReview } from "@/lib/inbox/risk/protection-gate";
import { lowerAutonomyLevel } from "./level";

export function automatedInboxSendGate(input: {
  level: AutonomyLevel;
  text: string;
  source: "APPROVED_TEMPLATE" | "APPROVED_ANSWER" | "INTAKE_FLOW" | "GENERATED";
  openReviews: readonly OpenReview[];
  approvedAccountDigits?: readonly string[];
  /**
   * The agency's plan ceiling, re-applied here rather than trusted from the caller. `authorizeAutomatedInboxSend`
   * (runtime.ts) already caps `level` before calling this gate, so passing it again is a no-op there — but it
   * means this invariant ("never send above the plan's ceiling") holds even if a future call site forgets to cap
   * `level` itself first. Optional only so an older caller that has not resolved entitlements yet keeps working;
   * omitting it trusts `level` as given, exactly like before.
   */
  entitlementCeiling?: AutonomyLevel;
}): { allowed: boolean; reasons: string[] } {
  const level = input.entitlementCeiling ? lowerAutonomyLevel(input.level, input.entitlementCeiling) : input.level;
  const protection = evaluateProtection({ text: input.text, audience: "AUTOMATED_SEND", openReviews: input.openReviews, approvedAccountDigits: input.approvedAccountDigits, level });
  const reasons = protection.reasons.map((reason) => reason.message);
  if (level === "L0" || level === "L1") reasons.push("This autonomy level cannot send without human approval.");
  if (level === "L2" && input.source !== "APPROVED_TEMPLATE" && input.source !== "APPROVED_ANSWER") reasons.push("L2 may send only approved templates or approved cached answers.");
  return { allowed: reasons.length === 0, reasons };
}
