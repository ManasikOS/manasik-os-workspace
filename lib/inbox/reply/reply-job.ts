/**
 * The REPLY job: the assistant's answer to a customer, run from `channel_jobs` (Q1, docs/inbox/scale-inngest-implementation-plan.md §5.1).
 *
 * The turn itself is `runAssistantTurn`, the same function the legacy `agent_jobs` path runs. What this file adds is the guard
 * around it, backed by `reply_intents` (see reply-intent.ts):
 *   - a retry of a job whose reply was already produced sends THAT reply and never calls the model again;
 *   - a retry of a job whose reply was already sent does nothing;
 *   - a reply whose send may or may not have reached the customer is never sent again automatically: staff are told;
 *   - a reply is not sent when the customer wrote again meanwhile and a newer REPLY job is already queued for that message, so a
 *     burst of messages ends in one answer to all of them, not one answer per message;
 *   - an attempt whose lease was taken over cannot send.
 * The queue serialises REPLY jobs per conversation (the claim skips a conversation whose reply is running), so these guards are
 * the second line: they hold even when a handler outlives its job.
 */

import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { Db } from "@/lib/ai/db";
import { runAssistantTurn, type ReplyTurnGuard } from "@/lib/agent/whatsapp/drain";
import { ReplyNotSentError, type DeliverReplyResult } from "@/lib/agent/whatsapp/reply-delivery";
import type { LaneJobHandler } from "@/lib/inbox/jobs/drain";
import { replyCoalesceKey } from "@/lib/inbox/reply/reply-key";
import {
  beginReplySend,
  claimReplyIntent,
  finishReplySent,
  finishReplySkipped,
  revertReplyToGenerated,
} from "@/lib/inbox/reply/reply-intent";

/** Another attempt holds this turn. The job fails and is retried with backoff, once that attempt has finished or its lease expired. */
export class ReplyTurnBusyError extends Error {
  constructor() {
    super("Another attempt is already answering this message; retrying later.");
    this.name = "ReplyTurnBusyError";
  }
}

const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid UUID");

export const replyJobPayloadSchema = z.object({
  conversationId: idSchema,
  /** The newest inbound message when the job was queued (later messages merge into the same job and replace it). */
  messageId: idSchema,
  sequenceNumber: z.union([z.number(), z.string()]).optional(),
});
export type ReplyJobPayload = z.infer<typeof replyJobPayloadSchema>;

/** The database operations the guard uses, injectable so the guard is tested without a database. */
export interface ReplyGuardOps {
  claim: typeof claimReplyIntent;
  beginSend: typeof beginReplySend;
  finishSent: typeof finishReplySent;
  finishSkipped: typeof finishReplySkipped;
  revertToGenerated: typeof revertReplyToGenerated;
  /** True when the customer wrote after `messageId` AND a REPLY job for the conversation is already waiting to answer it. */
  isSuperseded(db: Db, input: { agencyId: string; conversationId: string; messageId: string }): Promise<boolean>;
}

/**
 * A reply that arrived after the one this turn answers, with its own job already queued, makes this reply stale: the queued job
 * will answer both messages. Without the queued job the reply must still go out, so both conditions are required.
 */
export async function findSupersedingReply(db: Db, input: { agencyId: string; conversationId: string; messageId: string }): Promise<boolean> {
  const latest = await db
    .from("conversation_messages")
    .select("id")
    .eq("agency_id", input.agencyId)
    .eq("conversation_id", input.conversationId)
    .eq("role", "user")
    .order("sequence_number", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw new Error(`Could not check for newer messages: ${latest.error.message}`);
  const latestId = (latest.data as { id: string } | null)?.id;
  if (!latestId || latestId === input.messageId) return false;

  const queued = await db
    .from("channel_jobs")
    .select("id")
    .eq("agency_id", input.agencyId)
    .eq("kind", "REPLY")
    .eq("status", "QUEUED")
    .eq("coalesce_key", replyCoalesceKey(input.conversationId))
    .limit(1)
    .maybeSingle();
  if (queued.error) throw new Error(`Could not check for a queued reply: ${queued.error.message}`);
  return queued.data !== null;
}

const defaultOps: ReplyGuardOps = {
  claim: claimReplyIntent,
  beginSend: beginReplySend,
  finishSent: finishReplySent,
  finishSkipped: finishReplySkipped,
  revertToGenerated: revertReplyToGenerated,
  isSuperseded: findSupersedingReply,
};

export function createReplyTurnGuard(
  params: { db: Db; agencyId: string; conversationId: string; messageId: string; ownerToken: string },
  ops: ReplyGuardOps = defaultOps,
): ReplyTurnGuard {
  const { db, agencyId, conversationId, messageId, ownerToken } = params;
  let intentId: string | null = null;
  const ids = () => {
    if (!intentId) throw new Error("The reply turn used its guard before begin().");
    return { agencyId, intentId, ownerToken };
  };

  return {
    async begin() {
      const claim = await ops.claim(db, { agencyId, conversationId, inboundMessageId: messageId }, ownerToken);
      switch (claim.action) {
        case "GENERATE":
          intentId = claim.intentId;
          return { action: "GENERATE" };
        case "SEND_STORED":
          intentId = claim.intentId;
          return { action: "SEND_STORED", reply: claim.reply, buttons: claim.buttons };
        case "UNKNOWN":
          return { action: "UNKNOWN" };
        case "DONE":
          return { action: "STOP" };
        case "BUSY":
          throw new ReplyTurnBusyError();
      }
    },

    async beforeSend(reply) {
      if (await ops.isSuperseded(db, { agencyId, conversationId, messageId })) {
        await ops.finishSkipped(db, ids(), "SUPERSEDED");
        return false;
      }
      // Only the attempt that still owns the intent may send: one whose lease was taken over stands down here.
      return ops.beginSend(db, ids(), { text: reply.text, buttons: reply.buttons });
    },

    async afterDelivery(result: DeliverReplyResult) {
      if (result.status === "SENT") await ops.finishSent(db, ids(), result.externalMessageId);
      else await ops.finishSkipped(db, ids(), result.reason);
    },

    async afterSendFailure(error) {
      // Only a failure that provably did not reach the customer (before the provider was called, or a rate limit) keeps the reply
      // for a retry. Any other failure could have happened AFTER the provider accepted it, so the intent stays SENDING and, once its
      // lease expires, becomes UNKNOWN and goes to staff rather than being sent twice.
      if (error instanceof ReplyNotSentError) await ops.revertToGenerated(db, ids());
    },

    async withoutReply(reason) {
      await ops.finishSkipped(db, ids(), reason);
    },
  };
}

/** One REPLY job: the guarded assistant turn. Injectable for tests. */
export async function runReplyJob(
  params: { db: Db; agencyId: string } & ReplyJobPayload,
  deps: { runTurn?: typeof runAssistantTurn; ops?: ReplyGuardOps; newToken?: () => string } = {},
): Promise<void> {
  const runTurn = deps.runTurn ?? runAssistantTurn;
  const guard = createReplyTurnGuard(
    {
      db: params.db,
      agencyId: params.agencyId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      ownerToken: (deps.newToken ?? randomUUID)(),
    },
    deps.ops,
  );
  // `jobId` is null: agent_runs.job_id references agent_jobs, and this job lives in channel_jobs.
  await runTurn({ conversationId: params.conversationId, messageId: params.messageId, jobId: null }, guard);
}

export const replyLaneJobHandler: LaneJobHandler = async (job, context) => {
  const payload = replyJobPayloadSchema.safeParse(job.payload);
  if (!payload.success) throw new Error(`REPLY job payload is invalid: ${payload.error.issues[0]?.message ?? "unknown"}`);
  await runReplyJob({ db: context.db, agencyId: job.agencyId, ...payload.data });
};
