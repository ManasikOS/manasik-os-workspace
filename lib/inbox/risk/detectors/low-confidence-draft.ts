/**
 * LOW_CONFIDENCE_DRAFT — Copilot is not sure what this customer wants, so a draft built on it should be read carefully. Pure.
 * Fires when the reading's intent confidence is known and below the same threshold the rail uses to say "only N% sure".
 */

import { LOW_CONFIDENCE_BELOW } from "@/lib/inbox/intelligence/rail-view";

import { type RiskDetector, type RiskFacts, type RiskFinding } from "../types";

export function detectLowConfidenceDraft(facts: RiskFacts): RiskFinding | null {
  if (facts.intentConfidence === null || facts.intentConfidence >= LOW_CONFIDENCE_BELOW) return null;
  return { code: "LOW_CONFIDENCE_DRAFT", messageId: facts.latest?.id ?? null, confidence: 1, evidence: [{ messageId: facts.latest?.id ?? null, snippet: `Only ${Math.round(facts.intentConfidence * 100)}% sure what the customer wants` }] };
}

export const lowConfidenceDraft: RiskDetector = { code: "LOW_CONFIDENCE_DRAFT", detect: detectLowConfidenceDraft };
