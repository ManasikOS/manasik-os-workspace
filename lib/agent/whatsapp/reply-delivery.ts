/**
 * Sends one approved AI reply through the conversation's channel and records it. This is the send half
 * of `runProcessInbound`, moved out of lib/agent/whatsapp/drain.ts unchanged in behaviour so it can be
 * tested on its own and so every channel shares it (Phase 1 of
 * docs/modules/messenger-instagram-ai-agent-implementation-plan.md).
 *
 * The rules it keeps, all inherited from the WhatsApp path:
 *  - a known-bad connection (dead token, unfunded, restricted) is not something immediate retries fix:
 *    the job completes without sending and a human sees the state in the Inbox;
 *  - a dead token or unfunded account is reflected on the connection at once, never retried;
 *  - only a rate limit is worth the bounded retry (it rethrows);
 *  - any other send failure is logged and swallowed rather than retried blind;
 *  - a successful send that follows an earlier funding failure clears it.
 */

import "server-only";

import type { ChannelRuntimeAdapter } from "@/lib/channels/adapter";
import type { QuickReply } from "@/lib/agent/whatsapp/quick-replies";
import { explainSendFailure } from "@/lib/channels/send-failure-explanation";
import { insertMessage, type Db } from "@/lib/data/whatsapp-repository";
import type { ConversationRow } from "@/lib/types/whatsapp";
import { recordAutomatedSendDecision, type AutomatedReplyAction, type AutomatedReplySource } from "@/lib/inbox/autonomy/runtime";
import { authorizeProviderSend } from "@/lib/inbox/outbound/authorize-provider-send";
import { assertSendMatchesAdapter } from "@/lib/inbox/simulator/adapter-for-agency";

/**
 * Thrown when a reply certainly did NOT reach the customer: it failed before the provider was called, or the provider
 * refused it as rate limited. Callers that guard against double-sending may retry after this; any other throw from
 * `deliverAgentReply` can come after the provider accepted the message and must not be retried blind.
 */
export class ReplyNotSentError extends Error {
  constructor(message: string, readonly reason: unknown = undefined) {
    super(message);
    this.name = "ReplyNotSentError";
  }
}

export type DeliverReplyResult =
  | { status: "SENT"; externalMessageId: string }
  | { status: "SKIPPED"; reason: "CONNECTION_NOT_READY" | "TOKEN_DEAD" | "UNFUNDED" | "SEND_FAILED" | "AUTONOMY_REFUSED" };

export interface DeliverReplyDeps {
  insertMessage: typeof insertMessage;
  touchLastOutbound: (db: Db, conversationId: string) => Promise<void>;
  authorize: typeof authorizeProviderSend;
  recordDecision: typeof recordAutomatedSendDecision;
}

const defaultDeps: DeliverReplyDeps = {
  insertMessage,
  touchLastOutbound: async (db, conversationId) => {
    await db.from("conversations").update({ last_outbound_at: new Date().toISOString() }).eq("id", conversationId);
  },
  authorize: authorizeProviderSend,
  recordDecision: recordAutomatedSendDecision,
};

export async function deliverAgentReply(
  input: {
    db: Db;
    adapter: ChannelRuntimeAdapter;
    agencyId: string;
    conversation: Pick<ConversationRow, "id" | "external_conversation_id">;
    reply: string;
    buttons: QuickReply[];
    /** Extra message metadata recorded with the reply (e.g. `source: "quiet_followup"`). */
    metadata?: Record<string, unknown>;
  },
  overrides: Partial<DeliverReplyDeps> = {},
): Promise<DeliverReplyResult> {
  const deps = { ...defaultDeps, ...overrides };
  const { db, adapter, agencyId, conversation, buttons } = input;
  const channelName = adapter.profile.displayName;

  const declaredSource = String(input.metadata?.autonomy_source ?? "GENERATED");
  const source: AutomatedReplySource = ["APPROVED_TEMPLATE", "APPROVED_ANSWER", "INTAKE_FLOW", "GENERATED"].includes(declaredSource)
    ? declaredSource as AutomatedReplySource
    : "GENERATED";
  const declaredAction = String(input.metadata?.autonomy_action ?? "OTHER");
  const action: AutomatedReplyAction = ["ACKNOWLEDGEMENT", "QUALIFYING_QUESTION", "APPROVED_FAQ", "OTHER"].includes(declaredAction)
    ? declaredAction as AutomatedReplyAction
    : "OTHER";
  const connection = await adapter.resolveConnection(db, agencyId);
  if (!connection || connection.accountId === null || connection.credentialRef === null) {
    throw new ReplyNotSentError(`No connected ${channelName} integration for this agency — cannot send the reply.`);
  }
  // E9 — a known-bad integration is not something 3 immediate retries will fix. Complete the job without
  // sending rather than burn the retry budget against Meta for nothing; the conversation stays visible in
  // the Inbox for a human to pick up.
  if (connection.status !== "CONNECTED") {
    console.warn(`${channelName} send skipped for agency ${agencyId}: integration status is ${connection.status}.`);
    return { status: "SKIPPED", reason: "CONNECTION_NOT_READY" };
  }

  const token = await adapter.readToken(db, connection);
  if (!token) throw new ReplyNotSentError(`Could not read the ${channelName} access token from Vault.`);

  const hasButtons = buttons.length > 0;
  const replyText = adapter.decorateReplyText(input.reply, buttons, connection);
  const authorization = await deps.authorize(db, {
    agencyId,
    conversationId: conversation.id,
    text: replyText,
    author: { kind: "AI", source, action },
  });
  if (!authorization.allowed) {
    if (authorization.automatedAuthorization) {
      await deps.recordDecision(db, { agencyId, conversationId: conversation.id, authorization: authorization.automatedAuthorization, source, decision: "REFUSED" })
        .catch((cause) => console.error("Could not audit the refused automated reply:", cause));
    }
    return { status: "SKIPPED", reason: "AUTONOMY_REFUSED" };
  }

  assertSendMatchesAdapter(authorization, adapter);

  let sendResult;
  try {
    sendResult = await adapter.sendReply(connection, token, {
      to: conversation.external_conversation_id,
      ...authorization.command,
      buttons: hasButtons ? buttons : undefined,
    });
  } catch (error) {
    const errorClass = adapter.classifyError(error);
    if (errorClass === "TOKEN_DEAD" || errorClass === "UNFUNDED") {
      await adapter.reflectSendFailure(db, connection, agencyId, errorClass, error);
      return { status: "SKIPPED", reason: errorClass }; // no retry — a human sees the state in the Inbox
    }
    if (errorClass === "RATE_LIMITED") throw new ReplyNotSentError(error instanceof Error ? error.message : String(error), error); // worth the bounded retry/backoff
    // Anything else (outside service window, not registered, unknown) is logged and swallowed rather than retried blind.
    console.error(`${channelName} send failed for agency ${agencyId} (${errorClass}):`, error);
    // Messenger and Instagram: say so in the conversation, or staff see an assistant that just never answers.
    // (WhatsApp is left exactly as it was: its failures are surfaced on its own connection card.)
    if (adapter.provider !== "WHATSAPP") {
      await deps
        .insertMessage(db, {
          agencyId,
          conversationId: conversation.id,
          role: "system",
          actorKind: "SYSTEM",
          content: `The assistant's reply could not be delivered on ${channelName}. ${explainSendFailure(error, errorClass)}`,
          messageType: "SYSTEM",
          metadata: { source: "send_failed", error_class: errorClass },
        })
        .catch(() => undefined); // never let the note itself fail the job
    }
    return { status: "SKIPPED", reason: "SEND_FAILED" };
  }

  await adapter.reflectSendSuccess(db, connection);

  await deps.insertMessage(db, {
    agencyId,
    conversationId: conversation.id,
    externalMessageId: sendResult.externalMessageId,
    role: "assistant",
    actorKind: "AI",
    content: replyText,
    messageType: hasButtons ? "INTERACTIVE" : "TEXT",
    metadata: {
      ...(input.metadata ?? {}),
      ...(hasButtons ? { interactive_buttons: buttons } : {}),
      // Recorded so an echo of any part is recognised as our own send (see SendReplyResult.partMessageIds).
      ...(sendResult.partMessageIds && sendResult.partMessageIds.length > 1 ? { part_mids: sendResult.partMessageIds } : {}),
    },
    deliveryStatus: "SENT",
  });
  await deps.touchLastOutbound(db, conversation.id);
  if (authorization.automatedAuthorization) {
    await deps.recordDecision(db, { agencyId, conversationId: conversation.id, authorization: authorization.automatedAuthorization, source, decision: "SENT" })
      .catch((cause) => console.error("Could not audit the sent automated reply:", cause));
  }

  return { status: "SENT", externalMessageId: sendResult.externalMessageId };
}
