export interface PromotionEvidence {
  observedDays: number;
  decisions: number;
  triageAccuracy: number;
  paymentClaimPrecision: number;
  denyListViolations: number;
  rejectionRate: number;
  rejectionThreshold: number;
}

export interface PromotionDecision { eligible: boolean; blockers: string[] }

export type PromotableAutonomyLevel = "L0" | "L1" | "L2" | "L3";

export function evaluateAutonomyPromotion(evidence: PromotionEvidence): PromotionDecision {
  const blockers: string[] = [];
  if (evidence.observedDays < 7) blockers.push("At least 7 days of shadow or proposal evidence are required.");
  if (evidence.decisions < 200) blockers.push("At least 200 reviewed decisions are required.");
  if (evidence.triageAccuracy < 0.85) blockers.push("Triage accuracy must be at least 85%.");
  if (evidence.paymentClaimPrecision < 0.95) blockers.push("Payment-claim precision must be at least 95%.");
  if (evidence.denyListViolations > 0) blockers.push("There must be zero never-autonomous violations.");
  if (evidence.rejectionRate >= evidence.rejectionThreshold) blockers.push("Staff rejection rate is above the configured threshold.");
  return { eligible: blockers.length === 0, blockers };
}

/** Uses the exact promotion thresholds in reverse, one reversible step at a time. */
export function autonomyDemotionTarget(current: PromotableAutonomyLevel, evidence: PromotionEvidence): { level: PromotableAutonomyLevel; reasons: string[] } | null {
  const decision = evaluateAutonomyPromotion(evidence);
  if (decision.eligible || current === "L0" || current === "L1") return null;
  return { level: current === "L3" ? "L2" : "L1", reasons: decision.blockers };
}

export function narrowPromotionWindowAllows(input: { promotedAt: Date; now: Date; outsideOfficeHours: boolean; action: "ACKNOWLEDGEMENT" | "QUALIFYING_QUESTION" | "APPROVED_FAQ" | "OTHER" }): boolean {
  const narrow = input.now.getTime() - input.promotedAt.getTime() < 14 * 86_400_000;
  if (!narrow) return true;
  return input.outsideOfficeHours && ["ACKNOWLEDGEMENT", "QUALIFYING_QUESTION", "APPROVED_FAQ"].includes(input.action);
}
