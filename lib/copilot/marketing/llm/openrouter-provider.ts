/**
 * MarketingReasoningProvider backed by OpenRouter — reuses the exact same
 * low-level client as the Leads sales copilot
 * (`lib/copilot/sales/llm/openrouter.ts`), not a second LLM integration.
 *
 * Guardrails (see docs/modules/campaigns-command-center-implementation-plan.md §7.2):
 *   * Audience proposals are validated against `audienceProposalSchema`;
 *     any failure falls back to "no proposal" rather than a guess. The
 *     model is only ever asked to pick from the REAL enum values passed in
 *     the prompt — it cannot invent a lead stage or consent status that
 *     doesn't exist.
 *   * Content drafts may only use `knownFacts` supplied by the caller
 *     (real campaign data) — the system prompt explicitly forbids
 *     inventing a price, date, discount or seat count.
 *   * Neither function ever writes anything — the caller (a Server Action)
 *     decides whether to act on the draft, and only on an explicit human
 *     click (create the audience / save the content asset).
 */

import "server-only";

import { z } from "zod";

import { isOpenRouterConfigured, openRouterChat, openRouterJson } from "@/lib/copilot/sales/llm/openrouter";
import type { ConsentStatus } from "@/lib/types/consent";
import type { LeadSource, LeadStage } from "@/lib/types/leads";
import type { PilgrimJourneyStatus } from "@/lib/types/pilgrims";

import { deterministicMarketingProvider, type MarketingReasoningProvider } from "../provider";
import type { AudienceProposal, AudienceProposalRequest, ContentDraftRequest } from "../types";

// Kept in sync with the LeadStage / LeadSource / PilgrimJourneyStatus /
// ConsentStatus unions (lib/types/leads.ts, lib/types/pilgrims.ts,
// lib/types/consent.ts) — the model is only ever offered these exact
// values, so it structurally cannot propose a filter value that doesn't
// exist.
const LEAD_STAGES: LeadStage[] = [
  "NEW_LEAD", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "DEPOSIT_PENDING", "BOOKED",
  "LOST", "POSTPONED", "DUPLICATE", "SPAM",
];
const LEAD_SOURCES: LeadSource[] = [
  "WHATSAPP", "PHONE_CALL", "WALK_IN", "FACEBOOK", "INSTAGRAM", "WEBSITE", "GOOGLE",
  "REFERRAL", "REPEAT_CUSTOMER", "COMMUNITY_EVENT", "OTHER",
];
const PILGRIM_JOURNEY_STATUSES: PilgrimJourneyStatus[] = [
  "PENDING_DETAILS", "ONBOARDING", "DOCUMENTS_PENDING", "VISA_PROCESSING",
];
const CONSENT_STATUSES: ConsentStatus[] = ["UNKNOWN", "OPTED_IN", "OPTED_OUT"];

const audienceProposalSchema = z.object({
  rationale: z.string().min(10).max(600),
  subjectType: z.enum(["LEAD", "PILGRIM"]),
  filters: z.object({
    stages: z.array(z.enum(LEAD_STAGES as [LeadStage, ...LeadStage[]])).optional(),
    sources: z.array(z.enum(LEAD_SOURCES as [LeadSource, ...LeadSource[]])).optional(),
    journeyStatuses: z.array(z.enum(PILGRIM_JOURNEY_STATUSES as [PilgrimJourneyStatus, ...PilgrimJourneyStatus[]])).optional(),
    consentStatus: z.array(z.enum(CONSENT_STATUSES as [ConsentStatus, ...ConsentStatus[]])).optional(),
    doNotContact: z.boolean().optional(),
  }),
});

const AUDIENCE_SYSTEM = `You propose a targeting audience for one marketing campaign at a Hajj/Umrah travel agency in Sri Lanka.
Rules:
- Pick subjectType LEAD (existing enquiries) or PILGRIM (past travellers) based on the campaign's objective.
- filters may ONLY use these exact values — never invent a new one:
  lead stages: ${LEAD_STAGES.join(", ")}
  lead sources: ${LEAD_SOURCES.join(", ")}
  pilgrim journey statuses: ${PILGRIM_JOURNEY_STATUSES.join(", ")}
  consent status: ${CONSENT_STATUSES.join(", ")}
- Leave a filter field out entirely if it isn't relevant — do not force every field.
- rationale explains WHY this audience fits the campaign in at most 3 sentences, referencing only the campaign facts given, never inventing a headcount or statistic (the real count is computed separately, not by you).
Reply with ONE JSON object matching this JSON Schema, nothing else:
${JSON.stringify(z.toJSONSchema(audienceProposalSchema))}`;

const CONTENT_SYSTEM = `You draft ONE short marketing message for a Hajj/Umrah travel agency campaign, in the requested language and tone.
Rules:
- Use ONLY the facts listed under KNOWN FACTS. Never invent a price, discount, date, seat count, hotel name, flight detail or visa outcome.
- Keep an appropriate Islamic greeting/closing for a Hajj/Umrah audience.
- Keep it short enough for a WhatsApp broadcast (under 500 characters) unless the tone is explicitly DETAILED.
- Output only the message text, nothing else (no preamble, no quotes around it).`;

export const openRouterMarketingProvider: MarketingReasoningProvider = {
  source: "LLM",

  async proposeAudience(input: AudienceProposalRequest) {
    if (!isOpenRouterConfigured()) {
      return { proposal: null, source: "RULES" as const, note: "AI drafting is not configured on this deployment." };
    }
    try {
      const facts = [
        `Campaign: ${input.campaignName}`,
        `Type: ${input.campaignTypeLabel}`,
        `Objective: ${input.objectiveLabel}`,
        input.linkedDeparture
          ? `Linked departure: ${input.linkedDeparture.groupName}, departs ${input.linkedDeparture.departureDate}, ${input.linkedDeparture.availableSeats} seats available`
          : "No linked departure",
      ].join("\n");

      const parsed = await openRouterJson(
        audienceProposalSchema,
        [
          { role: "system", content: AUDIENCE_SYSTEM },
          { role: "user", content: facts },
        ],
        { maxTokens: 700 },
      );

      const proposal: AudienceProposal =
        parsed.subjectType === "LEAD"
          ? { rationale: parsed.rationale, proposal: { subjectType: "LEAD", filters: { stages: parsed.filters.stages, sources: parsed.filters.sources, consentStatus: parsed.filters.consentStatus, doNotContact: parsed.filters.doNotContact } } }
          : { rationale: parsed.rationale, proposal: { subjectType: "PILGRIM", filters: { journeyStatuses: parsed.filters.journeyStatuses, consentStatus: parsed.filters.consentStatus, doNotContact: parsed.filters.doNotContact } } };

      return { proposal, source: "LLM" as const, note: null };
    } catch (error) {
      return {
        proposal: null,
        source: "RULES" as const,
        note: `AI audience suggestion unavailable (${error instanceof Error ? error.message : "unknown error"}).`,
      };
    }
  },

  async draftContent(input: ContentDraftRequest) {
    if (!isOpenRouterConfigured()) {
      return { draftText: null, source: "RULES" as const, note: "AI drafting is not configured on this deployment." };
    }
    try {
      const facts = [
        `Campaign: ${input.campaignName}`,
        `Type: ${input.campaignTypeLabel}`,
        `Objective: ${input.objectiveLabel}`,
        `Channel: ${input.channel}`,
        `Language: ${input.language}`,
        `Tone: ${input.tone}`,
        `KNOWN FACTS:\n${input.knownFacts.length > 0 ? input.knownFacts.map((f) => `- ${f}`).join("\n") : "(none supplied — keep the draft generic, do not invent specifics)"}`,
      ].join("\n");

      const text = await openRouterChat(
        [
          { role: "system", content: CONTENT_SYSTEM },
          { role: "user", content: facts },
        ],
        { maxTokens: 500 },
      );
      return { draftText: text, source: "LLM" as const, note: null };
    } catch (error) {
      return {
        draftText: null,
        source: "RULES" as const,
        note: `AI content draft unavailable (${error instanceof Error ? error.message : "unknown error"}).`,
      };
    }
  },
};

/** Same selection rule as the Leads sales copilot's `getReasoningProvider()` — LLM when configured, deterministic otherwise. */
export function getMarketingReasoningProvider(): MarketingReasoningProvider {
  return isOpenRouterConfigured() ? openRouterMarketingProvider : deterministicMarketingProvider;
}
