/**
 * Pure aggregation behind the "Assistant performance" section of Manasik Copilot
 * (TASK-002, §14 of docs/modules/whatsapp-ai-agent-implementation-plan.md). No I/O: the data layer
 * hands in already-fetched rows so every business rule here is unit-testable.
 */

import { colomboDayKey } from "@/lib/date";

export const ANALYTICS_WINDOW_DAYS = 30;

/** The channels the assistant answers on. Every figure can be sliced by one of these. */
export const AGENT_CHANNELS = ["WHATSAPP", "MESSENGER", "INSTAGRAM"] as const;
export type AgentChannel = (typeof AGENT_CHANNELS)[number];

/** What the screens call each channel. Lives here, not in a component file, so server and client components share the one real object. */
export const CHANNEL_LABEL: Record<AgentChannel, string> = { WHATSAPP: "WhatsApp", MESSENGER: "Messenger", INSTAGRAM: "Instagram" };

export function isAgentChannel(value: string | null | undefined): value is AgentChannel {
  return Boolean(value && (AGENT_CHANNELS as readonly string[]).includes(value));
}

/** Meta's response-time rule for an automated Messenger/Instagram account (plan §14.1). */
export const RESPONSE_TIME_LIMIT_MS = 30_000;

/** The channel a stored row belongs to; rows written before the column existed are WhatsApp. */
function channelOf(row: { channel?: string | null }): AgentChannel {
  return isAgentChannel(row.channel) ? row.channel : "WHATSAPP";
}

export interface AgentRunInput {
  /** Absent or null on rows from before Messenger and Instagram: those are WhatsApp. */
  channel?: string | null;
  conversation_id: string | null;
  model: string | null;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
}

export interface AgentToolCallInput {
  tool_name: string;
  is_error: boolean;
}

export interface AgentConversationInput {
  id: string;
  state: string;
  channel?: string | null;
}

export interface AiModelRateInput {
  model: string;
  effective_from: string;
  input_rate_per_million: number;
  output_rate_per_million: number;
  cache_read_rate_per_million: number;
  cache_write_rate_per_million: number;
}

export interface AgentActivityInputs {
  runs: AgentRunInput[];
  toolCalls: AgentToolCallInput[];
  conversations: AgentConversationInput[];
  rates: AiModelRateInput[];
  leadsCaptured: number;
  bookingsHeld: number;
  /** True when a fetch hit its row cap, so every figure below is a lower bound. */
  truncated: boolean;
  /** Slice every reply-based figure to one channel; null or absent means all of them. */
  channel?: AgentChannel | null;
  now?: Date;
}

/** One channel's row in the comparison table. Always computed from ALL runs, so the table stays a comparison whichever channel is filtered. */
export interface AgentChannelSummary {
  channel: AgentChannel;
  replyCount: number;
  conversationCount: number;
  passedToPersonCount: number;
  handledWithoutPersonPercent: number | null;
  typicalLatencyMs: number | null;
  slowestTwentiethLatencyMs: number | null;
  /** Share of replies whose model turn took longer than Meta's 30-second rule; null with no timed replies. */
  overResponseLimitPercent: number | null;
}

export interface AgentDailyPoint {
  day: string;
  replies: number;
  costUsd: number;
}

export interface AgentToolReliability {
  toolName: string;
  calls: number;
  failures: number;
  failurePercent: number;
}

export interface AgentActivitySummary {
  windowDays: number;
  /** The channel the figures are sliced to; null means all channels. */
  channel: AgentChannel | null;
  byChannel: AgentChannelSummary[];
  replyCount: number;
  conversationCount: number;
  passedToPersonCount: number;
  handledWithoutPersonCount: number;
  handledWithoutPersonPercent: number | null;
  typicalLatencyMs: number | null;
  slowestTwentiethLatencyMs: number | null;
  cacheReusePercent: number | null;
  costUsd: number;
  unpricedRunCount: number;
  unpricedModels: string[];
  daily: AgentDailyPoint[];
  statusCounts: Record<string, number>;
  tools: AgentToolReliability[];
  leadsCaptured: number;
  bookingsHeld: number;
  truncated: boolean;
}

/** Conversation states where a person owns, or has been asked to own, the conversation. */
const PERSON_STATES = new Set(["HUMAN_REQUESTED", "HUMAN_ACTIVE"]);

/** Nearest-rank percentile of an ascending-sorted list; null when there is nothing to rank. */
export function nearestRankPercentile(sortedAscending: number[], percent: number): number | null {
  if (sortedAscending.length === 0) return null;
  const rank = Math.ceil((percent / 100) * sortedAscending.length);
  return sortedAscending[Math.min(sortedAscending.length, Math.max(1, rank)) - 1];
}

/**
 * Dollar cost of one run at the rate in force on the day it ran. `null` — never `0` — when the run
 * has no model or no rate row covers it, so an unpriced model shows up as "unknown" instead of
 * silently making the assistant look free.
 */
export function priceAgentRun(
  run: Pick<AgentRunInput, "model" | "created_at" | "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_creation_tokens">,
  rates: AiModelRateInput[],
): number | null {
  if (!run.model) return null;
  const runDay = run.created_at.slice(0, 10);
  const applicable = rates
    .filter((rate) => rate.model === run.model && rate.effective_from <= runDay)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))
    .at(-1);
  if (!applicable) return null;

  return (
    ((run.input_tokens ?? 0) / 1_000_000) * Number(applicable.input_rate_per_million) +
    ((run.output_tokens ?? 0) / 1_000_000) * Number(applicable.output_rate_per_million) +
    ((run.cache_read_tokens ?? 0) / 1_000_000) * Number(applicable.cache_read_rate_per_million) +
    ((run.cache_creation_tokens ?? 0) / 1_000_000) * Number(applicable.cache_write_rate_per_million)
  );
}

/** The last `days` Colombo calendar days ending today, oldest first. */
function recentColomboDays(now: Date, days: number): string[] {
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    keys.push(colomboDayKey(new Date(now.getTime() - offset * 24 * 60 * 60 * 1000)));
  }
  return keys;
}

/**
 * Held bookings for one channel, given the conversation each booking session belongs to. A booking session
 * has no channel of its own; its conversation does. `null` counts them all.
 */
export function countBookingsForChannel(
  bookingConversationIds: string[],
  conversations: Array<{ id: string; channel?: string | null }>,
  channel: AgentChannel | null,
): number {
  if (!channel) return bookingConversationIds.length;
  const channelById = new Map(conversations.map((conversation) => [conversation.id, channelOf(conversation)]));
  return bookingConversationIds.filter((id) => channelById.get(id) === channel).length;
}

function summariseByChannel(runs: AgentRunInput[], conversations: AgentConversationInput[]): AgentChannelSummary[] {
  const statesById = new Map(conversations.map((conversation) => [conversation.id, conversation.state]));
  return AGENT_CHANNELS.flatMap((channel) => {
    const channelRuns = runs.filter((run) => channelOf(run) === channel);
    if (channelRuns.length === 0) return [];

    const conversationIds = new Set(channelRuns.map((run) => run.conversation_id).filter((id): id is string => Boolean(id)));
    let passedToPersonCount = 0;
    for (const id of conversationIds) if (PERSON_STATES.has(statesById.get(id) ?? "")) passedToPersonCount++;

    const latencies = channelRuns.map((run) => run.latency_ms).filter((value): value is number => value !== null).sort((a, b) => a - b);
    return [
      {
        channel,
        replyCount: channelRuns.length,
        conversationCount: conversationIds.size,
        passedToPersonCount,
        handledWithoutPersonPercent: conversationIds.size === 0 ? null : ((conversationIds.size - passedToPersonCount) / conversationIds.size) * 100,
        typicalLatencyMs: nearestRankPercentile(latencies, 50),
        slowestTwentiethLatencyMs: nearestRankPercentile(latencies, 95),
        overResponseLimitPercent: latencies.length === 0 ? null : (latencies.filter((value) => value > RESPONSE_TIME_LIMIT_MS).length / latencies.length) * 100,
      },
    ];
  });
}

export function summariseAgentActivity(inputs: AgentActivityInputs): AgentActivitySummary {
  const { toolCalls, conversations, rates } = inputs;
  const channel = inputs.channel ?? null;
  const byChannel = summariseByChannel(inputs.runs, conversations);
  // Everything below is scoped to the chosen channel; `byChannel` above deliberately is not.
  const runs = channel ? inputs.runs.filter((run) => channelOf(run) === channel) : inputs.runs;
  const now = inputs.now ?? new Date();

  const daily = new Map<string, AgentDailyPoint>(
    recentColomboDays(now, ANALYTICS_WINDOW_DAYS).map((day) => [day, { day, replies: 0, costUsd: 0 }]),
  );

  let costUsd = 0;
  let unpricedRunCount = 0;
  const unpricedModels = new Set<string>();
  const statusCounts: Record<string, number> = {};
  const latencies: number[] = [];
  let cacheRead = 0;
  let cacheDenominator = 0;

  for (const run of runs) {
    statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;
    if (run.latency_ms !== null) latencies.push(run.latency_ms);

    cacheRead += run.cache_read_tokens ?? 0;
    cacheDenominator += (run.input_tokens ?? 0) + (run.cache_read_tokens ?? 0) + (run.cache_creation_tokens ?? 0);

    const cost = priceAgentRun(run, rates);
    if (cost === null) {
      unpricedRunCount++;
      unpricedModels.add(run.model ?? "unknown model");
    } else {
      costUsd += cost;
    }

    const point = daily.get(colomboDayKey(new Date(run.created_at)));
    if (point) {
      point.replies++;
      point.costUsd += cost ?? 0;
    }
  }

  latencies.sort((a, b) => a - b);

  const runConversationIds = new Set(runs.map((run) => run.conversation_id).filter((id): id is string => Boolean(id)));
  const statesById = new Map(conversations.map((conversation) => [conversation.id, conversation.state]));
  let passedToPersonCount = 0;
  for (const id of runConversationIds) {
    if (PERSON_STATES.has(statesById.get(id) ?? "")) passedToPersonCount++;
  }
  const conversationCount = runConversationIds.size;
  const handledWithoutPersonCount = conversationCount - passedToPersonCount;

  const toolTotals = new Map<string, { calls: number; failures: number }>();
  for (const call of toolCalls) {
    const totals = toolTotals.get(call.tool_name) ?? { calls: 0, failures: 0 };
    totals.calls++;
    if (call.is_error) totals.failures++;
    toolTotals.set(call.tool_name, totals);
  }
  const tools: AgentToolReliability[] = [...toolTotals.entries()]
    .map(([toolName, totals]) => ({
      toolName,
      ...totals,
      failurePercent: (totals.failures / totals.calls) * 100,
    }))
    .sort((a, b) => b.failurePercent - a.failurePercent || b.failures - a.failures || b.calls - a.calls || a.toolName.localeCompare(b.toolName));

  return {
    windowDays: ANALYTICS_WINDOW_DAYS,
    channel,
    byChannel,
    replyCount: runs.length,
    conversationCount,
    passedToPersonCount,
    handledWithoutPersonCount,
    handledWithoutPersonPercent: conversationCount === 0 ? null : (handledWithoutPersonCount / conversationCount) * 100,
    typicalLatencyMs: nearestRankPercentile(latencies, 50),
    slowestTwentiethLatencyMs: nearestRankPercentile(latencies, 95),
    cacheReusePercent: cacheDenominator === 0 ? null : (cacheRead / cacheDenominator) * 100,
    costUsd,
    unpricedRunCount,
    unpricedModels: [...unpricedModels].sort(),
    daily: [...daily.values()],
    statusCounts,
    tools,
    leadsCaptured: inputs.leadsCaptured,
    bookingsHeld: inputs.bookingsHeld,
    truncated: inputs.truncated,
  };
}
