/**
 * Read side of the "Assistant performance" section (TASK-002). Runs on the ordinary SESSION client,
 * so RLS decides who gets rows (ADMIN and CEO for agent_runs / agent_tool_calls) and every query is
 * also explicitly filtered by agency, matching the other lib/data read models.
 */

import "server-only";

import {
  ANALYTICS_WINDOW_DAYS,
  countBookingsForChannel,
  summariseAgentActivity,
  type AgentChannel,
  type AgentActivitySummary,
  type AgentConversationInput,
  type AgentRunInput,
  type AgentToolCallInput,
  type AiModelRateInput,
} from "@/lib/agent/whatsapp/analytics";
import type { Db } from "@/lib/data/whatsapp-billing-view";

/** Row caps keep one page load bounded; hitting one is reported, never silently ignored. */
const RUN_ROW_CAP = 5000;
const TOOL_CALL_ROW_CAP = 20000;
const CONVERSATION_ROW_CAP = 5000;

function failed(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

/** `leads.source` for a lead the assistant captured on each channel (see lib/inbox/lead-channel.ts). */
const LEAD_SOURCE_BY_CHANNEL: Record<AgentChannel, string> = { WHATSAPP: "WHATSAPP", MESSENGER: "FACEBOOK", INSTAGRAM: "INSTAGRAM" };

/**
 * `channel` slices the reply-based figures to one channel; omit it for all of them. The per-channel comparison
 * table is always across every channel.
 */
export async function getAgentActivitySummary(db: Db, agencyId: string, channel: AgentChannel | null = null): Promise<AgentActivitySummary> {
  const since = new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [runsResult, toolCallsResult, conversationsResult, ratesResult, leadsResult, bookingsResult] = await Promise.all([
    db
      .from("agent_runs")
      .select("channel, conversation_id, model, status, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, latency_ms, created_at")
      .eq("agency_id", agencyId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(RUN_ROW_CAP),
    db
      .from("agent_tool_calls")
      .select("tool_name, is_error")
      .eq("agency_id", agencyId)
      .gte("created_at", since)
      .limit(TOOL_CALL_ROW_CAP),
    db
      .from("conversations")
      .select("id, state, channel")
      .eq("agency_id", agencyId)
      .gte("updated_at", since)
      .limit(CONVERSATION_ROW_CAP),
    db.from("ai_model_rates").select("model, effective_from, input_rate_per_million, output_rate_per_million, cache_read_rate_per_million, cache_write_rate_per_million"),
    db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", agencyId)
      .in("source", channel ? [LEAD_SOURCE_BY_CHANNEL[channel]] : Object.values(LEAD_SOURCE_BY_CHANNEL))
      .gte("created_at", since),
    // A booking session has no channel of its own — its conversation does — so the ids are counted per channel below.
    db.from("booking_sessions").select("conversation_id").eq("agency_id", agencyId).eq("current_step", "CREATED").gte("created_at", since).limit(RUN_ROW_CAP),
  ]);

  if (runsResult.error) failed("assistant replies", runsResult.error);
  if (toolCallsResult.error) failed("assistant tool usage", toolCallsResult.error);
  if (conversationsResult.error) failed("conversations", conversationsResult.error);
  if (ratesResult.error) failed("model prices", ratesResult.error);
  if (leadsResult.error) failed("captured leads", leadsResult.error);
  if (bookingsResult.error) failed("held bookings", bookingsResult.error);

  const runs = (runsResult.data ?? []) as AgentRunInput[];
  const toolCalls = (toolCallsResult.data ?? []) as AgentToolCallInput[];
  const conversations = (conversationsResult.data ?? []) as AgentConversationInput[];

  return summariseAgentActivity({
    runs,
    toolCalls,
    conversations,
    rates: (ratesResult.data ?? []) as AiModelRateInput[],
    leadsCaptured: leadsResult.count ?? 0,
    bookingsHeld: countBookingsForChannel(
      ((bookingsResult.data ?? []) as Array<{ conversation_id: string }>).map((row) => row.conversation_id),
      conversations,
      channel,
    ),
    channel,
    truncated: runs.length >= RUN_ROW_CAP || toolCalls.length >= TOOL_CALL_ROW_CAP || conversations.length >= CONVERSATION_ROW_CAP,
  });
}
