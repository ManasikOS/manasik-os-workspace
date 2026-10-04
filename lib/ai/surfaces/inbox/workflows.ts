/**
 * Inbox Copilot — reply suggestion (Phase 8 of
 * docs/modules/inbox-implementation-plan.md). Same posture as
 * `lib/ai/surfaces/quotes/workflows.ts`: every fact in the draft has to
 * come from the pack, checked with `verifyClaims` before the draft is ever
 * shown to staff. This never sends anything — it only drafts text for a
 * human to review, edit, or discard in the message composer, which is what
 * keeps it inside "Copilot cannot perform a domain write except through
 * approved typed tools" without needing its own send-gate.
 */

import "server-only";

import { z } from "zod";

import { generateStructured, type AiResult } from "@/lib/ai/provider";
import { verifyDraft } from "@/lib/ai/trust/claim-verifier";
import { evaluateProtection, refusalMessage, type OpenReview } from "@/lib/inbox/risk/protection-gate";
import type { Db } from "@/lib/ai/db";
import type { ReplyContextPack } from "@/lib/inbox/reply-context";
import { frozenInboxReplySystemBlock, type InboxReplyPack } from "@/lib/inbox/reply-pack";
import { answerCacheEligibility } from "@/lib/inbox/answers/eligibility";
import { lookupApprovedInboxAnswer, recordInboxAnswerCandidate } from "@/lib/inbox/answers/repository";

const SYSTEM_PROMPT = `You are Manasik Copilot, drafting one reply for a Hajj/Umrah travel agency's staff member to review before sending to a customer on their behalf.

You are given the customer's recent messages and a set of CRM facts about their lead record. Ground every claim in those facts:
1. Never invent a price, date, discount, seat count, or availability figure. If the customer asks for one and it is not in the facts you were given, say a team member will confirm it — do not estimate or guess.
2. Never promise a refund, a payment plan, or any financial commitment.
3. Never discuss medical conditions, visa specifics, or make travel-document decisions — say a team member will follow up on those.
4. If you cannot tell who this contact is (no lead record given) or their intent is unclear, ask a short clarifying question instead of guessing.
5. Match the customer's own language where you can tell what it is; otherwise use the lead's preferred_language fact if given, or plain English.
6. Warm, concise, professional — two to four sentences. No greeting boilerplate like "Dear Sir/Madam", no sign-off, no emoji.
7. Never confirm that a payment was received, promise a refund, a discount or a visa outcome, hold or guarantee seats, or give a bank account number. If a review is listed as open, acknowledge what the customer said and say a colleague will confirm — do not confirm it yourself.`;

const RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: { reply: { type: "string" } },
  required: ["reply"],
  additionalProperties: false,
};

const ResponseSchema = z.object({ reply: z.string().trim().min(1).max(800) });

export interface SuggestedReply {
  reply: string;
  /** Present only when the reply was served from the agency-approved answer cache. */
  cacheEntryId?: string;
}

/** What the protection gate needs: the reviews still open on the conversation, and the approved bank accounts. */
export interface DraftProtection {
  openReviews: readonly OpenReview[];
  approvedAccountDigits: readonly string[];
}

export async function suggestConversationReply(
  pack: ReplyContextPack | InboxReplyPack,
  agencyId: string,
  conversationId: string,
  db: Db,
  surface = "INBOX_REPLY",
  protection: DraftProtection = { openReviews: [], approvedAccountDigits: [] },
  options: { answerCacheEnabled?: boolean } = {},
): Promise<AiResult<SuggestedReply>> {
  if ("kind" in pack && pack.facts.matchedOffer && pack.facts.offerCheck && !["FRESH", "EARLY_BIRD_EXPIRING"].includes(pack.facts.offerCheck)) {
    return { value: null, source: "RULES", note: "Suggestion withheld — the matched offer changed. Refresh the live price and seats first.", runId: null };
  }
  const transcript = pack.history.length > 0
    ? pack.history.map((entry) => `${entry.speaker === "customer" ? "Customer" : "Staff"}: ${entry.text}`).join("\n")
    : "(no prior messages)";
  const digest = "kind" in pack && pack.digest ? `Conversation digest (older context):\n${pack.digest}\n\n` : "";
  if (options.answerCacheEnabled !== false && "kind" in pack && pack.facts.intentCode) {
    const latestQuestion = [...pack.history].reverse().find((entry) => entry.speaker === "customer")?.text;
    if (latestQuestion && answerCacheEligibility({ intentCode: pack.facts.intentCode, question: latestQuestion, answer: "" }).eligible) {
      try {
        const cached = await lookupApprovedInboxAnswer(db, { agencyId, question: latestQuestion, knowledgeVersion: pack.knowledgeVersion });
        if (cached) return { value: { reply: cached.answerText, cacheEntryId: cached.id }, source: "RULES", note: "Approved agency answer cache", runId: null };
      } catch (cause) {
        console.error("Approved answer cache lookup failed; drafting normally:", cause instanceof Error ? cause.message : cause);
      }
    }
  }

  const system = "kind" in pack ? frozenInboxReplySystemBlock(pack) : SYSTEM_PROMPT;
  const facts = pack.facts;
  const openReviews = "kind" in pack ? pack.facts.openInterventions : protection.openReviews;
  const result = await generateStructured({
    tier: "draft",
    system,
    instruction: `Verified CRM facts:\n${JSON.stringify(facts, null, 2)}\n\n${digest}${
      openReviews.length > 0 ? `Open reviews on this conversation (a colleague is handling them):\n${openReviews.map((review) => `- ${review.headline}`).join("\n")}\n\n` : ""
    }Recent conversation (oldest first):\n${transcript}\n\nDraft the next staff reply.`,
    jsonSchema: RESPONSE_SCHEMA,
    schema: ResponseSchema,
    surface,
    agencyId,
    subjectType: "CONVERSATION",
    subjectId: conversationId,
    db,
  });

  if (!result.value) return result;

  const verification = verifyDraft(result.value.reply, facts, { approvedAccountDigits: protection.approvedAccountDigits });
  const gate = evaluateProtection({ text: result.value.reply, audience: "AI_DRAFT", openReviews, approvedAccountDigits: protection.approvedAccountDigits });
  if (!gate.allowed) {
    return { value: null, source: "RULES", note: `Suggestion withheld — ${refusalMessage(gate)}`, runId: result.runId };
  }
  if (!verification.ok) {
    return {
      value: null,
      source: "RULES",
      note: `Suggestion withheld — it stated a figure not present in this lead's CRM facts (${verification.violations
        .map((v) => v.span)
        .join(", ")}).`,
      runId: result.runId,
    };
  }

  if (options.answerCacheEnabled !== false && "kind" in pack && pack.facts.intentCode) {
    const latestQuestion = [...pack.history].reverse().find((entry) => entry.speaker === "customer")?.text;
    if (latestQuestion) {
      await recordInboxAnswerCandidate(db, {
        agencyId,
        question: latestQuestion,
        answer: result.value.reply,
        intentCode: pack.facts.intentCode,
        knowledgeVersion: pack.knowledgeVersion,
      }).catch((cause) => console.error("Repeated answer candidate could not be recorded:", cause instanceof Error ? cause.message : cause));
    }
  }

  return result;
}
