import "server-only";

import type { Db } from "@/lib/ai/db";
import { resolveChannelPolicyState } from "@/lib/channels/policy-state";
import { loadIntelligence } from "@/lib/data/conversation-intelligence-repository";
import { checkStoredOffer } from "@/lib/data/inbox-offer-repository";
import type { OpenReview } from "@/lib/inbox/risk/protection-gate";
import type { ReplyContextPack } from "@/lib/inbox/reply-context";
import { buildInboxReplyPack, type InboxReplyPack } from "@/lib/inbox/reply-pack";

/** Loads the volatile, agency-scoped half of a grounded Inbox reply prompt. */
export async function loadInboxReplyPack(
  db: Db,
  input: {
    agencyId: string;
    conversationId: string;
    fallback: ReplyContextPack;
    openInterventions: OpenReview[];
    now?: Date;
  },
): Promise<InboxReplyPack | null> {
  const intelligence = await loadIntelligence(db, input.agencyId, input.conversationId);
  if (!intelligence) return null;
  const [{ data: conversation }, { data: aiSettings }, { data: agencySettings }, { data: templates }] = await Promise.all([
    db.from("conversations").select("channel, state, handling_mode, service_window_expires_at, human_agent_window_expires_at").eq("id", input.conversationId).eq("agency_id", input.agencyId).maybeSingle(),
    db.from("ai_settings").select("agent_name, persona_instructions, tone, behaviour").eq("agency_id", input.agencyId).maybeSingle(),
    db.from("agency_settings").select("knowledge_version, passport_validity_months, offer_snapshot_max_age_minutes").eq("agency_id", input.agencyId).maybeSingle(),
    db.from("whatsapp_templates").select("id, name, category").eq("agency_id", input.agencyId).eq("status", "APPROVED").order("name").limit(50),
  ]);
  if (!conversation) return null;
  const now = input.now ?? new Date();
  const offerCheck = intelligence.matchedOffer ? await checkStoredOffer(db, input.agencyId, intelligence.matchedOffer, now.toISOString()) : null;
  const channelPolicy = resolveChannelPolicyState({
    channel: String(conversation.channel), now,
    serviceWindowExpiresAt: (conversation.service_window_expires_at as string | null) ?? null,
    humanAgentWindowExpiresAt: (conversation.human_agent_window_expires_at as string | null) ?? null,
    handlingMode: String(conversation.handling_mode ?? conversation.state ?? ""),
    hasOpenSupportCase: input.openInterventions.length > 0,
    author: "HUMAN", projectedTemplateCharge: null, chargeCurrency: null,
  });
  const settings = (agencySettings ?? {}) as Record<string, unknown>;
  const assistant = (aiSettings ?? {}) as Record<string, unknown>;
  return buildInboxReplyPack({
    kind: "INTELLIGENCE",
    facts: {
      contactName: input.fallback.facts.contact_name,
      intentCode: intelligence.intentCode,
      channel: String(conversation.channel),
      matchedOffer: intelligence.matchedOffer,
      offerCheck,
      policyThresholds: {
        passportValidityMonths: Number(settings.passport_validity_months ?? 6),
        offerSnapshotMaxAgeMinutes: Number(settings.offer_snapshot_max_age_minutes ?? 30),
      },
      openInterventions: input.openInterventions,
      channelState: { action: channelPolicy.action, notice: channelPolicy.notice },
      approvedTemplates: ((templates ?? []) as Array<{ id: string; name: string; category: string | null }>).map((template) => ({ id: template.id, title: template.name, category: template.category ?? "UTILITY" })),
    },
    digest: intelligence.digest,
    // The digest carries older context; keep only recent turns so the prompt
    // is bounded and does not repeat the same facts.
    history: input.fallback.history.slice(-6),
    agency: {
      brandVoice: [assistant.agent_name, assistant.tone].filter(Boolean).join(" · ") || "Clear, respectful and concise",
      sop: typeof assistant.persona_instructions === "string" && assistant.persona_instructions.trim() ? assistant.persona_instructions : "Escalate uncertainty to a staff member and never promise a protected outcome.",
    },
    knowledgeVersion: Number(settings.knowledge_version ?? 1),
  });
}
