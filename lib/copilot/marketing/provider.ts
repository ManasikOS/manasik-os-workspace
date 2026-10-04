/**
 * The reasoning-provider boundary for Marketing Intelligence drafting —
 * same shape as `lib/copilot/sales/provider.ts`. The deterministic provider
 * is always available and returns "no proposal" honestly (it does not fake
 * a rule-based audience/content draft the way sales intent-extraction has a
 * real rule engine to fall back to — there is no equivalent deterministic
 * copywriting or segmentation heuristic worth pretending is AI). The
 * OpenRouter provider (`llm/openrouter-provider.ts`) is used when
 * `OPENROUTER_API_KEY` is set.
 */

import type {
  AudienceProposalOutcome,
  AudienceProposalRequest,
  ContentDraftOutcome,
  ContentDraftRequest,
} from "./types";

export interface MarketingReasoningProvider {
  readonly source: "RULES" | "LLM";
  proposeAudience(input: AudienceProposalRequest): Promise<AudienceProposalOutcome>;
  draftContent(input: ContentDraftRequest): Promise<ContentDraftOutcome>;
}

export const deterministicMarketingProvider: MarketingReasoningProvider = {
  source: "RULES",
  async proposeAudience() {
    return { proposal: null, source: "RULES", note: "AI drafting is not configured on this deployment (OPENROUTER_API_KEY unset)." };
  },
  async draftContent() {
    return { draftText: null, source: "RULES", note: "AI drafting is not configured on this deployment (OPENROUTER_API_KEY unset)." };
  },
};
