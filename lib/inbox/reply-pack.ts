import { createHash } from "node:crypto";
import { redact } from "@/lib/ai/trust/redaction";
import type { IntentCode, MatchedOfferSnapshot, OfferCheckState } from "@/lib/inbox/intelligence/contracts";
import type { OpenReview } from "@/lib/inbox/risk/protection-gate";
import type { ReplyHistoryEntry } from "@/lib/inbox/reply-context";

export interface InboxReplyPack {
  kind: "INTELLIGENCE";
  facts: {
    contactName: string | null;
    intentCode: IntentCode | null;
    channel: string;
    matchedOffer: MatchedOfferSnapshot | null;
    offerCheck: OfferCheckState | null;
    policyThresholds: Record<string, string | number | boolean>;
    openInterventions: OpenReview[];
    channelState: { action: string; notice: string };
    approvedTemplates: Array<{ id: string; title: string; category: string }>;
  };
  /** Stored deterministic digest, kept separate from the recent turns below. */
  digest?: string | null;
  history: ReplyHistoryEntry[];
  agency: { brandVoice: string; sop: string };
  knowledgeVersion: number;
}

export function buildInboxReplyPack(input: InboxReplyPack): InboxReplyPack {
  return redact(input) as InboxReplyPack;
}

export function frozenInboxReplySystemBlock(pack: Pick<InboxReplyPack, "agency">): string {
  return [
    "You are Manasik Copilot. Draft one concise reply for agency staff to review.",
    "Only state facts present in the volatile fact pack. Never calculate or invent price, availability, dates, balances, eligibility, or policy.",
    "Never confirm payment, visa approval, inventory, refund, discount, booking changes, medical advice, or a religious ruling.",
    `Brand voice: ${pack.agency.brandVoice.trim()}`,
    `Agency SOP: ${pack.agency.sop.trim()}`,
  ].join("\n");
}

export function inboxReplySystemFingerprint(pack: Pick<InboxReplyPack, "agency">): string {
  return createHash("sha256").update(frozenInboxReplySystemBlock(pack)).digest("hex");
}
