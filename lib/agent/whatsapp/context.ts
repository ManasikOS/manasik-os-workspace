/**
 * AgentContext — the one thing every tool, every guardrail, and the prompt
 * assembler receive as their trusted identity source. It is built once, from
 * server-side state, and never from anything the model produced. See D1/D3
 * in docs/modules/whatsapp-ai-agent-implementation-plan.md.
 *
 * agencyId in particular is never supplied by a tool argument — a tool
 * schema that accepted `agencyId` as a model-settable field would let the
 * model choose which agency's data to touch, which is exactly the failure
 * mode this whole module exists to prevent.
 *
 * `channel` and `profile` come from the conversation row, so the same agent
 * runs unchanged on every channel; the profile is the only thing that varies
 * (see lib/channels/profile.ts).
 */

import "server-only";

import { getChannelProfile, type ChannelProfile } from "@/lib/channels/profile";
import type { Db } from "@/lib/data/whatsapp-repository";
import type { ChannelProvider } from "@/lib/inbox/contracts";
import { createAdminClient } from "@/utils/supabase/admin";
import { getConversation } from "@/lib/data/whatsapp-repository";
import type { ConversationRow } from "@/lib/types/whatsapp";

export interface AgentContext {
  agencyId: string;
  conversationId: string;
  leadId: string | null;
  channel: ChannelProvider;
  profile: ChannelProfile;
  locale: string;
  db: Db;
}

/** Builds the context for one job's turn — the admin client, scoped explicitly by hand. */
export async function buildAgentContext(conversationId: string): Promise<{
  context: AgentContext;
  conversation: ConversationRow;
} | null> {
  const db = createAdminClient();
  const conversation = await getConversation(db, conversationId);
  if (!conversation) return null;

  return {
    context: {
      agencyId: conversation.agency_id,
      conversationId: conversation.id,
      leadId: conversation.lead_id,
      channel: conversation.channel,
      profile: getChannelProfile(conversation.channel),
      locale: "en",
      db,
    },
    conversation,
  };
}
