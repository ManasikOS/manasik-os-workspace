import { describe, expect, it } from "vitest";

import { countBookingsForChannel, isAgentChannel, summariseAgentActivity, type AgentRunInput } from "./analytics";

const NOW = new Date("2026-09-19T12:00:00.000Z");

function run(over: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    channel: "WHATSAPP",
    conversation_id: "c-wa",
    model: "m",
    status: "OK",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    latency_ms: 4000,
    created_at: "2026-09-18T10:00:00.000Z",
    ...over,
  };
}

const conversations = [
  { id: "c-wa", state: "AI_ACTIVE", channel: "WHATSAPP" },
  { id: "c-ms", state: "HUMAN_REQUESTED", channel: "MESSENGER" },
  { id: "c-ig", state: "AI_ACTIVE", channel: "INSTAGRAM" },
  { id: "c-ig2", state: "HUMAN_ACTIVE", channel: "INSTAGRAM" },
];

const runs: AgentRunInput[] = [
  run({ conversation_id: "c-wa", latency_ms: 3000 }),
  run({ channel: "MESSENGER", conversation_id: "c-ms", latency_ms: 9000 }),
  run({ channel: "INSTAGRAM", conversation_id: "c-ig", latency_ms: 5000 }),
  run({ channel: "INSTAGRAM", conversation_id: "c-ig", latency_ms: 31_000 }),
  run({ channel: "INSTAGRAM", conversation_id: "c-ig2", latency_ms: 7000 }),
];

const summarise = (channel: Parameters<typeof summariseAgentActivity>[0]["channel"] = null) =>
  summariseAgentActivity({ runs, toolCalls: [], conversations, rates: [], leadsCaptured: 0, bookingsHeld: 0, truncated: false, channel, now: NOW });

describe("isAgentChannel", () => {
  it("accepts the three assistant channels and nothing else, so a URL filter cannot smuggle in a value", () => {
    expect(["WHATSAPP", "MESSENGER", "INSTAGRAM"].every(isAgentChannel)).toBe(true);
    for (const value of ["GMAIL", "whatsapp", "", null, undefined, "x' or 1=1"]) expect(isAgentChannel(value)).toBe(false);
  });
});

describe("summariseAgentActivity — channel slice", () => {
  it("covers every channel when no channel is chosen", () => {
    const summary = summarise();
    expect(summary.channel).toBeNull();
    expect(summary.replyCount).toBe(5);
    expect(summary.conversationCount).toBe(4);
  });

  it("slices replies, conversations, hand-off and latency to the chosen channel", () => {
    const summary = summarise("INSTAGRAM");
    expect(summary.channel).toBe("INSTAGRAM");
    expect(summary.replyCount).toBe(3);
    expect(summary.conversationCount).toBe(2);
    expect(summary.passedToPersonCount).toBe(1); // c-ig2 was handed to a person
    expect(summary.handledWithoutPersonPercent).toBe(50);
    expect(summary.typicalLatencyMs).toBe(7000);
    expect(summary.slowestTwentiethLatencyMs).toBe(31_000);
  });

  it("counts a row with no channel (written before Messenger and Instagram existed) as WhatsApp", () => {
    const legacy = summariseAgentActivity({
      runs: [run({ channel: null }), run({ channel: undefined })],
      toolCalls: [],
      conversations: [],
      rates: [],
      leadsCaptured: 0,
      bookingsHeld: 0,
      truncated: false,
      channel: "WHATSAPP",
      now: NOW,
    });
    expect(legacy.replyCount).toBe(2);
  });

  it("shows an empty slice as empty, not as the other channels' numbers", () => {
    const summary = summariseAgentActivity({
      runs: [run()],
      toolCalls: [],
      conversations,
      rates: [],
      leadsCaptured: 0,
      bookingsHeld: 0,
      truncated: false,
      channel: "MESSENGER",
      now: NOW,
    });
    expect(summary.replyCount).toBe(0);
    expect(summary.typicalLatencyMs).toBeNull();
    expect(summary.handledWithoutPersonPercent).toBeNull();
  });
});

describe("summariseAgentActivity — comparison by channel", () => {
  it("has one row per channel that has replies, in a fixed order, whichever channel is filtered", () => {
    for (const channel of [null, "MESSENGER", "WHATSAPP"] as const) {
      expect(summarise(channel).byChannel.map((row) => row.channel)).toEqual(["WHATSAPP", "MESSENGER", "INSTAGRAM"]);
    }
  });

  it("leaves out a channel with no replies rather than showing zeros", () => {
    const summary = summariseAgentActivity({ runs: [run()], toolCalls: [], conversations, rates: [], leadsCaptured: 0, bookingsHeld: 0, truncated: false, now: NOW });
    expect(summary.byChannel.map((row) => row.channel)).toEqual(["WHATSAPP"]);
  });

  it("reports each channel's own hand-off rate and latency", () => {
    const [wa, ms, ig] = summarise().byChannel;
    expect(wa).toMatchObject({ replyCount: 1, conversationCount: 1, handledWithoutPersonPercent: 100, typicalLatencyMs: 3000 });
    expect(ms).toMatchObject({ replyCount: 1, passedToPersonCount: 1, handledWithoutPersonPercent: 0, typicalLatencyMs: 9000 });
    expect(ig).toMatchObject({ replyCount: 3, conversationCount: 2, handledWithoutPersonPercent: 50 });
  });

  it("measures how many replies broke Meta's 30-second rule, counting only replies that were timed", () => {
    const summary = summariseAgentActivity({
      runs: [run({ channel: "INSTAGRAM", latency_ms: 31_000 }), run({ channel: "INSTAGRAM", latency_ms: 29_000 }), run({ channel: "INSTAGRAM", latency_ms: null })],
      toolCalls: [],
      conversations: [],
      rates: [],
      leadsCaptured: 0,
      bookingsHeld: 0,
      truncated: false,
      now: NOW,
    });
    expect(summary.byChannel[0].overResponseLimitPercent).toBe(50);
  });

  it("does not count exactly 30 seconds as over the limit", () => {
    const summary = summariseAgentActivity({ runs: [run({ latency_ms: 30_000 })], toolCalls: [], conversations: [], rates: [], leadsCaptured: 0, bookingsHeld: 0, truncated: false, now: NOW });
    expect(summary.byChannel[0].overResponseLimitPercent).toBe(0);
  });
});

describe("countBookingsForChannel", () => {
  const ids = ["c-wa", "c-ms", "c-ig", "c-ig", "gone"];

  it("counts all of them with no channel", () => {
    expect(countBookingsForChannel(ids, conversations, null)).toBe(5);
  });

  it("counts a booking under the channel of its conversation, and drops one whose conversation is unknown", () => {
    expect(countBookingsForChannel(ids, conversations, "INSTAGRAM")).toBe(2);
    expect(countBookingsForChannel(ids, conversations, "MESSENGER")).toBe(1);
    expect(countBookingsForChannel(ids, conversations, "WHATSAPP")).toBe(1);
  });
});
