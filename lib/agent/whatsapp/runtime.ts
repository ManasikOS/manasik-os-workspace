/**
 * The agent loop — one WhatsApp turn in, one reply out. See §8 of
 * docs/modules/whatsapp-ai-agent-implementation-plan.md.
 *
 * Uses the SDK's tool runner (`client.beta.messages.toolRunner`) rather than
 * a hand-written `while (stop_reason === "tool_use")` loop — its per-turn
 * hooks are exactly what the telemetry/redaction wrapper in
 * lib/agent/kernel/telemetry.ts needs, and there is no control flow here the
 * runner doesn't already cover.
 *
 * Model id, the lazy client and `isAiConfigured()` live in
 * `lib/agent/kernel/runner.ts` now, shared with every agent — see that
 * module's header.
 */

import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import type { AgentContext } from "@/lib/agent/whatsapp/context";
import { checkOutboundReply, usedNumberBackingTool } from "@/lib/agent/whatsapp/guardrails";
import { loadProtectionContext } from "@/lib/data/inbox-risk-repository";
import {
  canRetryOnPaidModel,
  FREE_ATTEMPT_TIMEOUT_MS,
  freeChatModel,
  paidChatModel,
  shouldUseFreeChatModel,
} from "@/lib/agent/whatsapp/model-routing";
import { buildSystemPrompt } from "@/lib/agent/whatsapp/prompt";
import { modelTextForMessage } from "@/lib/inbox/media/voice-note";
import { chooseQuickReplies, type QuickReply } from "@/lib/agent/whatsapp/quick-replies";
import { buildToolSet, loadAiCapabilities } from "@/lib/agent/whatsapp/tools/registry";
import { getClient, isAiConfigured, MODEL_ID } from "@/lib/agent/kernel/runner";
import type { ToolTelemetry } from "@/lib/agent/kernel/telemetry";
import { listMessages } from "@/lib/data/whatsapp-repository";
import type { ConversationMessageRow, ConversationRow } from "@/lib/types/whatsapp";

export { MODEL_ID, isAiConfigured };

const HISTORY_TURNS = 20; // messages, not conversation turns — enough context without an unbounded prompt

export type AgentTurnOutcome =
  | { status: "OK"; reply: string; buttons: QuickReply[] }
  | { status: "GUARDRAIL_BLOCKED"; reason: string }
  | { status: "REFUSAL" }
  | { status: "TOOL_ERROR" | "MODEL_ERROR"; error: string };

interface RunResult {
  outcome: AgentTurnOutcome;
  model: string;
  effort: string;
  usage: { input: number; output: number; cacheRead: number; cacheCreation: number };
  latencyMs: number;
  stopReason: string | null;
  toolCalls: ToolTelemetry["calls"];
}

function toModelMessages(rows: ConversationMessageRow[]): Anthropic.Beta.Messages.BetaMessageParam[] {
  const turns = rows
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({
      role: row.role as "user" | "assistant",
      content: modelTextForMessage(row),
    }));
  // The history window is cut from the newest end, so it can start on an assistant reply; a chat has to
  // open with the customer's turn.
  const firstCustomerTurn = turns.findIndex((turn) => turn.role === "user");
  return firstCustomerTurn > 0 ? turns.slice(firstCustomerTurn) : turns;
}

/**
 * §8.3 — `effort` is set per call site, never globally: a short
 * conversational reply doesn't need the same depth as a booking review.
 */
function effortFor(conversation: ConversationRow): "low" | "medium" {
  return conversation.state === "AI_ACTIVE" || conversation.state === "AI_RESUMED" ? "low" : "medium";
}

/** How many replies the assistant has sent in this conversation, over its whole life. */
async function countAssistantReplies(db: AgentContext["db"], agencyId: string, conversationId: string): Promise<number> {
  const { count, error } = await db
    .from("conversation_messages")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agencyId)
    .eq("conversation_id", conversationId)
    .eq("role", "assistant");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function runAgentTurn(ctx: AgentContext, conversation: ConversationRow): Promise<RunResult> {
  const startedAt = Date.now();
  const telemetry: ToolTelemetry = { calls: [] };

  if (!isAiConfigured()) {
    return {
      outcome: { status: "MODEL_ERROR", error: "OPENROUTER_API_KEY is not configured for this environment." },
      model: MODEL_ID,
      effort: "low",
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      latencyMs: Date.now() - startedAt,
      stopReason: null,
      toolCalls: [],
    };
  }

  const [systemPrompt, capabilities, history] = await Promise.all([
    buildSystemPrompt(ctx),
    loadAiCapabilities(ctx),
    listMessages(ctx.db, ctx.conversationId, HISTORY_TURNS),
  ]);

  const tools = buildToolSet(ctx, capabilities, telemetry);
  const useFreeFirst = shouldUseFreeChatModel(conversation, history);
  const paidModel = paidChatModel();
  const effort = useFreeFirst ? "none" : effortFor(conversation);

  const usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let finalText = "";
  let stopReason: string | null = null;
  let modelUsed = (useFreeFirst ? freeChatModel() : null) ?? paidModel;

  /** One pass of the tool loop on one model. Throws on a model or network error. */
  const attempt = async (model: string, free: boolean) => {
    finalText = "";
    const runner = getClient().beta.messages.toolRunner(
      {
        model,
        max_tokens: free ? 700 : 4096,
        // A free model answers fastest without a thinking step; the paid model keeps adaptive thinking.
        ...(free ? {} : { thinking: { type: "adaptive" as const }, output_config: { effort: effortFor(conversation) } }),
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        tools: tools as Anthropic.Beta.Messages.BetaToolUnion[],
        messages: toModelMessages(history),
        max_iterations: 8,
      },
      free ? { signal: AbortSignal.timeout(FREE_ATTEMPT_TIMEOUT_MS) } : undefined,
    );

    for await (const message of runner) {
      stopReason = message.stop_reason ?? stopReason;
      usage.input += message.usage.input_tokens;
      usage.output += message.usage.output_tokens;
      usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheCreation += message.usage.cache_creation_input_tokens ?? 0;

      const textBlock = message.content.find((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === "text");
      if (textBlock) finalText = textBlock.text;
    }
  };

  try {
    let needPaid = !useFreeFirst;
    if (useFreeFirst) {
      try {
        await attempt(modelUsed, true);
        // A free model sometimes returns nothing at all; that is a failed attempt, not an answer.
        if (finalText.trim().length === 0 && stopReason !== "refusal") throw new Error("The free model returned an empty reply.");
      } catch (freeError) {
        if (!canRetryOnPaidModel(telemetry.calls)) throw freeError;
        console.warn(`Free chat model failed, retrying on ${paidModel}:`, freeError instanceof Error ? freeError.message : freeError);
        telemetry.calls.length = 0;
        needPaid = true;
      }
    }
    if (needPaid) {
      modelUsed = paidModel;
      await attempt(paidModel, false);
    }
  } catch (error) {
    return {
      outcome: { status: "MODEL_ERROR", error: error instanceof Error ? error.message : String(error) },
      model: modelUsed,
      effort,
      usage,
      latencyMs: Date.now() - startedAt,
      stopReason,
      toolCalls: telemetry.calls,
    };
  }

  if (stopReason === "refusal") {
    return {
      outcome: { status: "REFUSAL" },
      model: modelUsed,
      effort,
      usage,
      latencyMs: Date.now() - startedAt,
      stopReason,
      toolCalls: telemetry.calls,
    };
  }

  if (telemetry.calls.some((call) => call.isError)) {
    return {
      outcome: { status: "TOOL_ERROR", error: telemetry.calls.find((call) => call.isError)?.resultSummary ?? "Unknown tool error" },
      model: modelUsed,
      effort,
      usage,
      latencyMs: Date.now() - startedAt,
      stopReason,
      toolCalls: telemetry.calls,
    };
  }

  // Fail closed: if the open reviews or the approved accounts cannot be read, the reply is held for a person, not sent.
  let protection: Awaited<ReturnType<typeof loadProtectionContext>>;
  try {
    protection = await loadProtectionContext(ctx.db, ctx.agencyId, ctx.conversationId);
  } catch (error) {
    return {
      outcome: { status: "GUARDRAIL_BLOCKED", reason: `protection gate: could not check open reviews (${error instanceof Error ? error.message : "unknown error"})` },
      model: modelUsed,
      effort,
      usage,
      latencyMs: Date.now() - startedAt,
      stopReason,
      toolCalls: telemetry.calls,
    };
  }

  // The limit counts every reply the assistant has sent in this conversation, not the (at most 20) messages the model was shown.
  let repliesSent: number;
  try {
    repliesSent = await countAssistantReplies(ctx.db, ctx.agencyId, ctx.conversationId);
  } catch (error) {
    return {
      outcome: { status: "GUARDRAIL_BLOCKED", reason: `could not count the assistant's replies (${error instanceof Error ? error.message : "unknown error"})` },
      model: modelUsed,
      effort,
      usage,
      latencyMs: Date.now() - startedAt,
      stopReason,
      toolCalls: telemetry.calls,
    };
  }

  const guardrail = checkOutboundReply(finalText, {
    protection,
    aiEnabled: conversation.ai_enabled,
    conversation,
    turnCount: repliesSent,
    maxTurns: capabilities.max_turns_per_conversation,
    usedNumberBackingToolThisTurn: usedNumberBackingTool(telemetry.calls),
    profile: ctx.profile,
  });

  if (!guardrail.ok) {
    return {
      outcome: { status: "GUARDRAIL_BLOCKED", reason: guardrail.reason ?? "blocked" },
      model: modelUsed,
      effort,
      usage,
      latencyMs: Date.now() - startedAt,
      stopReason,
      toolCalls: telemetry.calls,
    };
  }

  const buttons: QuickReply[] = chooseQuickReplies({ bookingEnabled: capabilities.booking_enabled, calls: telemetry.calls });

  return {
    outcome: { status: "OK", reply: finalText, buttons },
    model: modelUsed,
    effort,
    usage,
    latencyMs: Date.now() - startedAt,
    stopReason,
    toolCalls: telemetry.calls,
  };
}
