/**
 * The one inbound path every channel shares: upsert the conversation → link the CRM lead → store the
 * message AND its required jobs in one transaction (docs/inbox/scaling.md §9). Extracted from the WhatsApp
 * webhook handler unchanged in behaviour (Phase 1 of
 * docs/modules/messenger-instagram-ai-agent-implementation-plan.md); Messenger and Instagram webhooks
 * call the same function, so a fix here is a fix on every channel.
 *
 * What stays with the caller, because it is channel-specific: parsing the provider payload, campaign
 * attribution, deciding the message text/type, billing rows, and echo handling.
 *
 * Like the webhook that calls it, this never runs the model — it does fast I/O and queues a job.
 */

import "server-only";

import type { ChannelProvider } from "@/lib/inbox/contracts";
import { linkConversationToLead } from "@/lib/inbox/lead-linking";
import {
  persistInboundMessageAtomic,
  setConversationState,
  upsertConversationForInbound,
  type Db,
} from "@/lib/data/whatsapp-repository";
import { settleDelaySeconds } from "@/lib/inbox/jobs/settle";
import type { ConversationMessageRow, ConversationRow, MessageType } from "@/lib/types/whatsapp";
import type { ResolvedCampaignAttribution } from "@/lib/whatsapp/campaign-attribution";
import { persistInboundMediaAttachments } from "@/lib/inbox/media/ingest";

export interface IngestInboundInput {
  agencyId: string;
  provider: ChannelProvider;
  /** The customer's id on the channel (`conversations.external_conversation_id`). */
  externalConversationId: string;
  contactName: string;
  /** The `channel_connections` row the thread arrives on. Required for Messenger/Instagram (no database trigger sets it for them). */
  connectionId?: string | null;
  /**
   * False when this channel's connection (or the agency) has the assistant switched off. The message is still
   * stored, but no agent job is queued and an AI-owned thread is put in front of staff instead of sitting
   * "AI active" with nobody answering. Defaults to true — WhatsApp is unchanged.
   */
  agentAllowed?: boolean;
  /** Null on Messenger/Instagram: those channels carry no phone number. */
  normalizedPhone: string | null;
  /** The sender's email, when the channel has one (email itself, or a future channel that captures it) — extra identity-graph evidence, never a reason to link by itself. */
  email?: string | null;
  externalMessageId: string;
  content: string;
  messageType: MessageType;
  metadata: Record<string, unknown>;
  attribution?: ResolvedCampaignAttribution | null;
  /** The normal reply job. Voice messages use a text placeholder and are never transcribed. */
  /** The conversation's first inbound message: triage is what the customer is waiting on, so it is not held for the settle delay. */
  firstContact?: boolean;
  agentJobKind: "PROCESS_INBOUND";
  /** Runs after the message is stored and before the job is queued (e.g. a billing row). Failures are the caller's to swallow. */
  afterMessageStored?: (stored: { conversation: ConversationRow; message: ConversationMessageRow }) => Promise<void>;
}

export type IngestInboundResult =
  | { status: "duplicate"; conversation: ConversationRow }
  | {
      status: "stored";
      conversation: ConversationRow;
      message: ConversationMessageRow;
      jobId: string | null;
      /** True when an ENRICH job (S0→S1 intelligence) was queued on the REALTIME lane, so the caller can kick a drain. */
      enrichQueued: boolean;
    };

export interface IngestDeps {
  upsertConversation: typeof upsertConversationForInbound;
  linkLead: typeof linkConversationToLead;
  /** Stores the message and its agent + ENRICH jobs in one transaction: all of it commits, or none. */
  persistInbound: typeof persistInboundMessageAtomic;
  setConversationState: typeof setConversationState;
  /** Stores attachment rows and queues BULK media work before an agent/model can inspect the message. */
  persistMedia?: (db: Db, input: { agencyId: string; messageId: string; metadata: Record<string, unknown> }) => Promise<void>;
}

const defaultDeps: IngestDeps = {
  upsertConversation: upsertConversationForInbound,
  linkLead: linkConversationToLead,
  persistInbound: persistInboundMessageAtomic,
  setConversationState,
  persistMedia: persistInboundMediaAttachments,
};

export async function ingestInboundMessage(
  db: Db,
  input: IngestInboundInput,
  deps: IngestDeps = defaultDeps,
): Promise<IngestInboundResult> {
  // True when another request created this conversation a moment before us (a customer's first two messages arriving
  // together). That request is already linking the lead, so this one must not also create one.
  let lostCreateRace = false;
  const conversation = await deps.upsertConversation(db, {
    agencyId: input.agencyId,
    channel: input.provider,
    externalConversationId: input.externalConversationId,
    contactName: input.contactName,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    attribution: input.attribution ?? null,
    onLostCreateRace: () => {
      lostCreateRace = true;
    },
  });

  // Before the inbound message and the agent job: charges, lead context and every later booking or
  // follow-up action must all see the same canonical lead link. The shared resolver never guesses across
  // duplicate phone numbers.
  const leadLink = await deps.linkLead(db, {
    agencyId: input.agencyId,
    conversationId: conversation.id,
    provider: input.provider,
    externalSubjectId: input.externalConversationId,
    displayName: input.contactName,
    normalizedPhone: input.normalizedPhone,
    email: input.email ?? null,
    createIfMissing: !lostCreateRace,
    messageText: input.messageType === "TEXT" ? input.content : null,
  });
  if (leadLink.lead && conversation.lead_id !== leadLink.lead.id) {
    conversation.lead_id = leadLink.lead.id;
  }

  // Decided BEFORE the write so the agent job can commit with the message. Nobody answers automatically when the
  // assistant is off for this connection, so an AI-owned thread is put in front of staff after the message is stored.
  const agentAllowed = input.agentAllowed ?? true;
  const aiOwnsThread = conversation.state === "AI_ACTIVE" || conversation.state === "AI_RESUMED";
  const shouldRunAgent = agentAllowed && conversation.state !== "HUMAN_ACTIVE" && conversation.ai_enabled;
  const firstContact = input.firstContact ?? isFirstContact(conversation.created_at, new Date().toISOString());

  // One transaction: the canonical message and every job it requires. It cannot commit half of them, and a provider
  // retry of a committed message comes back as a duplicate carrying the canonical ids. A failure here throws, so the
  // webhook answers with a retryable status instead of acknowledging a message that has no work queued.
  const stored = await deps.persistInbound(db, {
    agencyId: input.agencyId,
    conversationId: conversation.id,
    externalMessageId: input.externalMessageId,
    content: input.content,
    messageType: input.messageType,
    metadata: input.metadata,
    agentJobKind: shouldRunAgent ? input.agentJobKind : null,
    // Queued whether or not the agent will answer: the S0 gate decides what is worth a model call, and a
    // human-owned thread is a gate skip, not a reason to leave the message unread by triage.
    enrichDelaySeconds: settleDelaySeconds({ firstContact }),
  });
  if (stored.duplicate) return { status: "duplicate", conversation }; // duplicate delivery (F8) — already recorded

  const message = {
    id: stored.messageId,
    agency_id: input.agencyId,
    conversation_id: conversation.id,
    external_message_id: input.externalMessageId,
    role: "user",
    actor_kind: "CUSTOMER",
    actor_id: null,
    actor_name_snapshot: null,
    content: input.content,
    message_type: input.messageType,
    media_path: null,
    delivery_status: "PENDING",
    delivery_error: null,
    metadata: input.metadata,
    created_at: new Date().toISOString(),
  } satisfies ConversationMessageRow;

  if (deps.persistMedia) {
    await deps.persistMedia(db, { agencyId: input.agencyId, messageId: message.id, metadata: input.metadata }).catch((cause) => {
      // Persist-and-ack remains the webhook contract; the message is visible
      // even if its optional media analysis could not be scheduled.
      console.error("Inbound media could not be persisted:", cause instanceof Error ? cause.message : cause);
    });
  }

  if (input.afterMessageStored) await input.afterMessageStored({ conversation, message });

  if (!agentAllowed && aiOwnsThread) {
    // Nobody is going to answer this automatically: make it visible as waiting for a person.
    await deps.setConversationState(db, conversation.id, "HUMAN_REQUESTED");
    conversation.state = "HUMAN_REQUESTED";
  }

  return { status: "stored", conversation, message, jobId: stored.agentJobId, enrichQueued: stored.enrichJobId !== null };
}

/** The conversation row and its first message are written within moments of each other; a later message is far from it. */
export function isFirstContact(conversationCreatedAt: string | null | undefined, messageCreatedAt: string | null | undefined): boolean {
  if (!conversationCreatedAt || !messageCreatedAt) return false;
  const gap = new Date(messageCreatedAt).getTime() - new Date(conversationCreatedAt).getTime();
  return Number.isFinite(gap) && gap >= 0 && gap < 5_000;
}
