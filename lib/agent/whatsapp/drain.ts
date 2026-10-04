/**
 * The queue drain — claims due `agent_jobs` and runs each to completion.
 * Called two ways (§6.3 of docs/modules/whatsapp-ai-agent-implementation-plan.md):
 * opportunistically via `after()` right after the webhook responds (D5, for
 * sub-second latency in the happy path), and on a schedule by the cron
 * route (the guarantee that a job still drains even if that `after()`
 * callback's process dies mid-request).
 *
 * Runs within a wall-clock budget rather than "until the queue is empty" —
 * a burst of inbound messages must not turn one invocation into an
 * unbounded background process.
 */

import "server-only";

import { buildAgentContext } from "@/lib/agent/whatsapp/context";
import { ensureLeadForConversation } from "@/lib/agent/whatsapp/lead-capture";
import { ingestKnowledgeDocument, markKnowledgeDocumentFailed } from "@/lib/agent/whatsapp/knowledge/ingest";
import { failedTurnNote, shouldHandOffAfterTurn } from "@/lib/agent/whatsapp/failed-turn-handoff";
import { deliverAgentReply, type DeliverReplyResult } from "@/lib/agent/whatsapp/reply-delivery";
import type { QuickReply } from "@/lib/agent/whatsapp/quick-replies";
import { assignOwner } from "@/lib/agent/whatsapp/tools/handoff";
import { runAgentTurn } from "@/lib/agent/whatsapp/runtime";
import { recordAgentRun, recordAgentToolCalls } from "@/lib/agent/kernel/telemetry";
import { getChannelAdapter } from "@/lib/channels/registry";
import { getChannelAdapterForAgency } from "@/lib/inbox/simulator/adapter-for-agency";
import { reconcileEcho, type EchoJobPayload } from "@/lib/channels/messenger/echo";
import {
  claimJobs,
  completeJob,
  failJob,
  releaseClaimedJobs,
  releaseStaleLocks,
} from "@/lib/data/whatsapp-repository";
import { createAdminClient } from "@/utils/supabase/admin";
import type { AgentContext } from "@/lib/agent/whatsapp/context";
import type { AgentJobRow, ConversationRow } from "@/lib/types/whatsapp";
import { runBoundedInboxIntake } from "@/lib/inbox/autonomy/intake-runtime";

const CLAIM_BATCH_SIZE = 10;

export interface DrainResult {
  processed: number;
  failed: number;
}

export async function processDueJobs(options: { budgetMs: number }): Promise<DrainResult> {
  const db = createAdminClient();
  const workerId = `${process.env.VERCEL_REGION ?? "local"}-${process.pid}-${Date.now()}`;
  const deadline = Date.now() + options.budgetMs;

  await releaseStaleLocks(db);

  let processed = 0;
  let failed = 0;

  while (Date.now() < deadline) {
    const jobs = await claimJobs(db, workerId, CLAIM_BATCH_SIZE);
    if (jobs.length === 0) break;

    for (const [index, job] of jobs.entries()) {
      if (Date.now() >= deadline) {
        // The rest of the claimed batch is handed straight back so another drain picks it up now, not after the stale-lock sweep.
        await releaseClaimedJobs(db, workerId, jobs.slice(index).map((unreached) => unreached.id)).catch((error) =>
          console.error("Could not hand back unprocessed agent jobs:", error instanceof Error ? error.message : error),
        );
        break;
      }
      try {
        await runJob(job);
        await completeJob(db, job.id);
        processed++;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await reportDeadKnowledgeJob(job, reason);
        await failJob(db, job, reason);
        failed++;
      }
    }
  }

  return { processed, failed };
}

async function runJob(job: AgentJobRow): Promise<void> {
  switch (job.kind) {
    case "PROCESS_INBOUND":
      return runProcessInbound(job);
    case "TRANSCRIBE_AUDIO":
      // Retired: voice notes are retained for staff playback but never sent to a transcription model.
      return;
    case "EMBED_DOCUMENT":
      return runEmbedDocument(job);
    case "RECONCILE_ECHO":
      return runReconcileEcho(job);
    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}

/**
 * A Messenger echo the webhook could not tell from our own send at the time (plan F6). By now an in-flight AI
 * or staff send has saved its message id, so an echo that is STILL unknown is a person typing in the Page
 * inbox: record it and hand the conversation to staff so the assistant never speaks over them.
 */
async function runReconcileEcho(job: AgentJobRow): Promise<void> {
  const payload = job.payload as Partial<EchoJobPayload>;
  if (!payload.psid || !payload.mid || !payload.connectionId) throw new Error("RECONCILE_ECHO job is missing psid, mid or connectionId");
  await reconcileEcho(createAdminClient(), job.agency_id, payload as EchoJobPayload);
}

async function runEmbedDocument(job: AgentJobRow): Promise<void> {
  const payload = job.payload as { documentId?: string };
  if (!payload.documentId) throw new Error("EMBED_DOCUMENT job is missing documentId");
  await ingestKnowledgeDocument(createAdminClient(), job.agency_id, payload.documentId);
}

/**
 * A knowledge document whose job ran out of retries would otherwise sit at "processing" forever.
 * Surface it on the knowledge screen, where staff will see it, instead of only in the job table.
 */
async function reportDeadKnowledgeJob(job: AgentJobRow, reason: string): Promise<void> {
  const payload = job.payload as { documentId?: string };
  if (job.kind !== "EMBED_DOCUMENT" || !payload.documentId || job.attempts + 1 < job.max_attempts) return;
  await markKnowledgeDocumentFailed(
    createAdminClient(),
    job.agency_id,
    payload.documentId,
    "We couldn't prepare this document after several tries. Try re-indexing it, or upload it again.",
  ).catch(() => undefined);
  console.error(`Knowledge document ${payload.documentId} failed permanently: ${reason}`);
}

/** Tells the channel to show the typing bubble against the customer's latest message, where it has one. Never throws. */
async function showTypingIndicator(
  db: ReturnType<typeof createAdminClient>,
  adapter: ReturnType<typeof getChannelAdapter>,
  agencyId: string,
  conversation: Pick<ConversationRow, "id" | "external_conversation_id">,
): Promise<void> {
  if (!adapter.sendTyping) return;
  try {
    const { data: latest } = await db
      .from("conversation_messages")
      .select("external_message_id")
      .eq("conversation_id", conversation.id)
      .eq("role", "user")
      .not("external_message_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const externalMessageId = (latest as { external_message_id: string | null } | null)?.external_message_id;
    if (!externalMessageId) return;

    const connection = await adapter.resolveConnection(db, agencyId);
    if (!connection || connection.status !== "CONNECTED" || !connection.accountId || !connection.credentialRef) return;
    const token = await adapter.readToken(db, connection);
    if (!token) return;

    await adapter.sendTyping(connection, token, { to: conversation.external_conversation_id, customerMessageId: externalMessageId });
  } catch (error) {
    console.warn(`${adapter.profile.displayName} typing indicator failed:`, error instanceof Error ? error.message : error);
  }
}

/** Creates (or links) the CRM lead for this conversation when lead capture is on. Never throws: the reply matters more. */
async function ensureLeadWhenEnabled(context: AgentContext, conversation: ConversationRow): Promise<void> {
  if (conversation.lead_id) return;
  try {
    const { data: settings } = await context.db
      .from("ai_settings")
      .select("lead_capture_enabled")
      .eq("agency_id", context.agencyId)
      .maybeSingle();
    if (!(settings as { lead_capture_enabled: boolean } | null)?.lead_capture_enabled) return;

    const profileName = conversation.contact_name?.trim();
    const { lead } = await ensureLeadForConversation(context, {
      fullName: profileName && profileName.length > 0 ? profileName : `${context.profile.displayName} customer`,
    });
    context.leadId = lead.id;
  } catch (error) {
    console.error(`${context.profile.displayName} lead capture before reply failed:`, error instanceof Error ? error.message : error);
  }
}

/**
 * Puts the chat in front of staff after a turn the assistant could not answer. The update only applies while the
 * assistant still owns the chat, so it never overrides a person who took over meanwhile, or a handoff the model
 * already made this turn. Best effort: a failure here is logged, never thrown, so it cannot cause a second run.
 */
async function handOffFailedTurn(context: AgentContext, outcome: Parameters<typeof failedTurnNote>[0]): Promise<void> {
  try {
    const owner = await assignOwner(context);
    const { data: updated, error } = await context.db
      .from("conversations")
      .update({ state: "HUMAN_REQUESTED", assigned_to_id: owner.id, assigned_to_name: owner.name })
      .eq("id", context.conversationId)
      .eq("agency_id", context.agencyId)
      .in("state", ["AI_ACTIVE", "AI_RESUMED"])
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0) return; // someone else already owns it

    await context.db.from("conversation_messages").insert({
      agency_id: context.agencyId,
      conversation_id: context.conversationId,
      role: "system",
      actor_kind: "SYSTEM",
      content: failedTurnNote(outcome),
      message_type: "SYSTEM",
      metadata: { source: "assistant_turn_failed", status: outcome.status },
    });
  } catch (error) {
    console.error("Handing a failed assistant turn to staff failed:", error instanceof Error ? error.message : error);
  }
}

async function runProcessInbound(job: AgentJobRow): Promise<void> {
  const payload = job.payload as { conversationId?: string; messageId?: string };
  if (!payload.conversationId) throw new Error("PROCESS_INBOUND job is missing conversationId");
  await runAssistantTurn({ conversationId: payload.conversationId, messageId: payload.messageId, jobId: job.id });
}

/**
 * Wraps the reply so a retry of a queued REPLY job can neither re-call the model nor send twice (Q1). Absent for the legacy
 * `agent_jobs` path, which behaves exactly as it always has. The implementation is in lib/inbox/reply/reply-job.ts.
 */
export interface ReplyTurnGuard {
  /**
   * Before the model runs. GENERATE: run it. SEND_STORED: an earlier attempt already produced this reply, send it without
   * the model. UNKNOWN: an earlier attempt may already have sent it, so tell staff instead. STOP: nothing to do.
   * Throws when another attempt holds the turn, so the job retries later.
   */
  begin(): Promise<
    | { action: "GENERATE" }
    | { action: "SEND_STORED"; reply: string; buttons: QuickReply[] }
    | { action: "UNKNOWN" }
    | { action: "STOP" }
  >;
  /** After a reply exists, before it is sent. False = do not send (this attempt lost the turn, or a newer message supersedes it). */
  beforeSend(reply: { text: string; buttons: QuickReply[] }): Promise<boolean>;
  afterDelivery(result: DeliverReplyResult): Promise<void>;
  /** `deliverAgentReply` threw. Whether the customer could have received the message depends on the error. */
  afterSendFailure(error: unknown): Promise<void>;
  /** The turn ended with nothing to send (a blocked, refused or failed model turn). */
  withoutReply(reason: string): Promise<void>;
}

/**
 * One assistant turn: the model runs, the reply is sent. Shared by the legacy `agent_jobs` path (no guard) and the queued
 * REPLY path (guarded). `jobId` is the `agent_jobs` id used for run telemetry, or null for a queued job (`agent_runs.job_id`
 * references `agent_jobs`).
 */
export async function runAssistantTurn(
  input: { conversationId: string; messageId?: string; jobId: string | null },
  guard?: ReplyTurnGuard,
): Promise<void> {
  const built = await buildAgentContext(input.conversationId);
  if (!built) throw new Error(`Conversation ${input.conversationId} no longer exists`);
  const { context, conversation } = built;

  // §6.1 step 8 restated defensively: state can have changed between
  // enqueue and claim (a staff member took over in the meantime).
  if (conversation.state === "HUMAN_ACTIVE" || !conversation.ai_enabled) return;

  // Resolved before the model runs: a channel with no adapter fails the job here instead of after a paid turn.
  const adapter = await getChannelAdapterForAgency(context.db, context.agencyId, conversation.channel);

  // Show "typing…" right away so the customer sees something is happening while the model works; and make
  // sure this customer has a lead in the CRM before the model is even called. Both are best effort.
  const typingShown = showTypingIndicator(context.db, adapter, context.agencyId, conversation);
  // The bounded intake flow sends its own reply and is not covered by `guard` (as before this slice).
  if (input.messageId && await runBoundedInboxIntake({ context, conversation, adapter, messageId: input.messageId })) {
    await typingShown;
    return;
  }
  await ensureLeadWhenEnabled(context, conversation);
  await typingShown;

  const begun = guard ? await guard.begin() : ({ action: "GENERATE" } as const);
  if (begun.action === "STOP") return;
  if (begun.action === "UNKNOWN") {
    await handOffUnknownReply(context);
    return;
  }

  let reply: string;
  let buttons: QuickReply[];
  if (begun.action === "SEND_STORED") {
    reply = begun.reply;
    buttons = begun.buttons;
  } else {
    const result = await runAgentTurn(context, conversation);

    const runId = await recordAgentRun(context.db, {
      agencyId: context.agencyId,
      conversationId: context.conversationId,
      channel: context.channel === "WHATSAPP" || context.channel === "MESSENGER" || context.channel === "INSTAGRAM" ? context.channel : undefined,
      jobId: input.jobId ?? undefined,
      model: result.model,
      effort: result.effort,
      usage: result.usage,
      latencyMs: result.latencyMs,
      status: result.outcome.status,
      stopReason: result.stopReason,
      error: result.outcome.status === "MODEL_ERROR" || result.outcome.status === "TOOL_ERROR" ? result.outcome.error : null,
    });

    await recordAgentToolCalls(context.db, context.agencyId, runId, result.toolCalls);

    if (result.outcome.status !== "OK") {
      // A blocked/refused/errored turn produces no outbound message — silence
      // is safer than a half-formed reply. But the customer is still waiting, so staff are told: the chat moves
      // to "waiting for staff" and the unanswered-handoff alerts take over. The run row above says why.
      if (shouldHandOffAfterTurn(result.outcome)) await handOffFailedTurn(context, result.outcome);
      await guard?.withoutReply(`MODEL_${result.outcome.status}`);
      return;
    }
    reply = result.outcome.reply;
    buttons = result.outcome.buttons;
  }

  if (guard && !(await guard.beforeSend({ text: reply, buttons }))) return;

  let delivered: DeliverReplyResult;
  try {
    delivered = await deliverAgentReply({
      db: context.db,
      adapter,
      agencyId: context.agencyId,
      conversation,
      reply,
      buttons,
    });
  } catch (error) {
    await guard?.afterSendFailure(error);
    throw error;
  }
  await guard?.afterDelivery(delivered);
}

/**
 * An earlier attempt to send this reply never reported back, so it may already be in front of the customer. Sending it again
 * could double-message them; leaving it could leave them unanswered. Neither is decided automatically: the chat is put in front
 * of staff with a note saying exactly this. Only applies while the assistant still owns the chat. Best effort, never throws.
 */
async function handOffUnknownReply(context: AgentContext): Promise<void> {
  try {
    const owner = await assignOwner(context);
    const { data: updated, error } = await context.db
      .from("conversations")
      .update({ state: "HUMAN_REQUESTED", assigned_to_id: owner.id, assigned_to_name: owner.name })
      .eq("id", context.conversationId)
      .eq("agency_id", context.agencyId)
      .in("state", ["AI_ACTIVE", "AI_RESUMED"])
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0) return; // a person already owns it

    await context.db.from("conversation_messages").insert({
      agency_id: context.agencyId,
      conversation_id: context.conversationId,
      role: "system",
      actor_kind: "SYSTEM",
      content: "The assistant's reply to the customer's last message may or may not have been delivered. Check the conversation in the customer's app before replying, so they are not sent it twice.",
      message_type: "SYSTEM",
      metadata: { source: "assistant_reply_outcome_unknown" },
    });
  } catch (error) {
    console.error("Handing an unknown-outcome reply to staff failed:", error instanceof Error ? error.message : error);
  }
}
