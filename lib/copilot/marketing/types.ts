/**
 * Types for "Manasik Marketing Intelligence" drafting — audience proposals
 * and content drafts. Both are DRAFTS ONLY: the caller must take an
 * explicit action (create the audience, copy the content into an asset) —
 * nothing here writes to the database. See
 * docs/modules/campaigns-command-center-implementation-plan.md §7.2 ("the agent
 * may draft, never execute").
 */

import type { LeadAudienceFilters, PilgrimAudienceFilters } from "@/lib/types/audiences";

export type MarketingReasoningSource = "RULES" | "LLM";

export interface AudienceProposalRequest {
  campaignName: string;
  campaignTypeLabel: string;
  objectiveLabel: string;
  /** Present only when the campaign links a real departure — grounds the proposal in real urgency/capacity, never invented. */
  linkedDeparture: { groupName: string; departureDate: string; availableSeats: number } | null;
}

export type AudienceProposalFilters =
  | { subjectType: "LEAD"; filters: LeadAudienceFilters }
  | { subjectType: "PILGRIM"; filters: PilgrimAudienceFilters };

export interface AudienceProposal {
  rationale: string;
  proposal: AudienceProposalFilters;
}

export interface AudienceProposalOutcome {
  proposal: AudienceProposal | null;
  source: MarketingReasoningSource;
  note: string | null;
}

export interface ContentDraftRequest {
  campaignName: string;
  campaignTypeLabel: string;
  objectiveLabel: string;
  channel: string;
  language: "English" | "Tamil" | "Sinhala";
  tone: "WARM" | "PROFESSIONAL" | "SHORT_WHATSAPP";
  /** Real facts the draft may cite — never invents a price, date or seat count beyond this. */
  knownFacts: string[];
}

export interface ContentDraftOutcome {
  draftText: string | null;
  source: MarketingReasoningSource;
  note: string | null;
}
