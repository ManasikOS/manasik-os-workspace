import { describe, expect, it } from "vitest";

import {
  nearestRankPercentile,
  priceAgentRun,
  summariseAgentActivity,
  type AgentRunInput,
  type AiModelRateInput,
} from "./analytics";

const NOW = new Date("2026-09-18T10:00:00Z");

const OPUS_RATE: AiModelRateInput = {
  model: "claude-opus-5",
  effective_from: "2026-01-01",
  input_rate_per_million: 5,
  output_rate_per_million: 25,
  cache_read_rate_per_million: 0.5,
  cache_write_rate_per_million: 6.25,
};

function run(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    conversation_id: "c1",
    model: "claude-opus-5",
    status: "OK",
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    latency_ms: 1000,
    created_at: "2026-09-17T08:00:00Z",
    ...overrides,
  };
}

function summarise(overrides: Partial<Parameters<typeof summariseAgentActivity>[0]> = {}) {
  return summariseAgentActivity({
    runs: [],
    toolCalls: [],
    conversations: [],
    rates: [OPUS_RATE],
    leadsCaptured: 0,
    bookingsHeld: 0,
    truncated: false,
    now: NOW,
    ...overrides,
  });
}

describe("nearestRankPercentile", () => {
  it("returns null for an empty list instead of NaN or 0", () => {
    expect(nearestRankPercentile([], 50)).toBeNull();
  });

  it("uses nearest-rank so the result is always a real observed value", () => {
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(nearestRankPercentile(values, 50)).toBe(500);
    expect(nearestRankPercentile(values, 95)).toBe(1000);
  });

  it("handles a single observation", () => {
    expect(nearestRankPercentile([750], 95)).toBe(750);
  });
});

describe("priceAgentRun", () => {
  it("prices input, output, cache read and cache write at their own rates", () => {
    const cost = priceAgentRun(
      run({ input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_tokens: 1_000_000, cache_creation_tokens: 1_000_000 }),
      [OPUS_RATE],
    );
    expect(cost).toBeCloseTo(5 + 25 + 0.5 + 6.25, 6);
  });

  it("returns null, not 0, when no rate exists for the model", () => {
    expect(priceAgentRun(run({ model: "some-unpriced-model" }), [OPUS_RATE])).toBeNull();
  });

  it("returns null when the run recorded no model", () => {
    expect(priceAgentRun(run({ model: null }), [OPUS_RATE])).toBeNull();
  });

  it("uses the rate in force on the day of the run, not the latest one", () => {
    const newer: AiModelRateInput = { ...OPUS_RATE, effective_from: "2026-09-10", input_rate_per_million: 10 };
    const before = priceAgentRun(run({ created_at: "2026-09-05T00:00:00Z", input_tokens: 1_000_000, output_tokens: 0 }), [OPUS_RATE, newer]);
    const after = priceAgentRun(run({ created_at: "2026-09-12T00:00:00Z", input_tokens: 1_000_000, output_tokens: 0 }), [OPUS_RATE, newer]);
    expect(before).toBeCloseTo(5, 6);
    expect(after).toBeCloseTo(10, 6);
  });

  it("returns null for a run older than the first rate row", () => {
    expect(priceAgentRun(run({ created_at: "2025-12-31T00:00:00Z" }), [OPUS_RATE])).toBeNull();
  });

  it("treats missing token counts as zero", () => {
    const cost = priceAgentRun(run({ input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null }), [OPUS_RATE]);
    expect(cost).toBe(0);
  });
});

describe("summariseAgentActivity", () => {
  it("returns an all-empty summary with null ratios when there is no activity", () => {
    const summary = summarise();
    expect(summary.replyCount).toBe(0);
    expect(summary.conversationCount).toBe(0);
    expect(summary.handledWithoutPersonPercent).toBeNull();
    expect(summary.typicalLatencyMs).toBeNull();
    expect(summary.cacheReusePercent).toBeNull();
    expect(summary.costUsd).toBe(0);
    expect(summary.daily).toHaveLength(30);
    expect(summary.daily.every((point) => point.replies === 0)).toBe(true);
  });

  it("counts a conversation once however many replies it had", () => {
    const summary = summarise({
      runs: [run({ conversation_id: "c1" }), run({ conversation_id: "c1" }), run({ conversation_id: "c2" })],
      conversations: [
        { id: "c1", state: "AI_ACTIVE" },
        { id: "c2", state: "AI_ACTIVE" },
      ],
    });
    expect(summary.replyCount).toBe(3);
    expect(summary.conversationCount).toBe(2);
  });

  it("counts conversations a person owns or was asked to own as passed to a person", () => {
    const summary = summarise({
      runs: [run({ conversation_id: "c1" }), run({ conversation_id: "c2" }), run({ conversation_id: "c3" }), run({ conversation_id: "c4" })],
      conversations: [
        { id: "c1", state: "AI_ACTIVE" },
        { id: "c2", state: "HUMAN_REQUESTED" },
        { id: "c3", state: "HUMAN_ACTIVE" },
        { id: "c4", state: "CLOSED" },
      ],
    });
    expect(summary.passedToPersonCount).toBe(2);
    expect(summary.handledWithoutPersonCount).toBe(2);
    expect(summary.handledWithoutPersonPercent).toBe(50);
  });

  it("ignores conversations that have no assistant reply in the window", () => {
    const summary = summarise({
      runs: [run({ conversation_id: "c1" })],
      conversations: [
        { id: "c1", state: "AI_ACTIVE" },
        { id: "unrelated", state: "HUMAN_ACTIVE" },
      ],
    });
    expect(summary.conversationCount).toBe(1);
    expect(summary.passedToPersonCount).toBe(0);
  });

  it("sums cost across priced runs and reports unpriced runs separately instead of hiding them", () => {
    const summary = summarise({
      runs: [
        run({ input_tokens: 1_000_000, output_tokens: 0 }),
        run({ model: "some-unpriced-model", input_tokens: 9_000_000, output_tokens: 0 }),
      ],
    });
    expect(summary.costUsd).toBeCloseTo(5, 6);
    expect(summary.unpricedRunCount).toBe(1);
    expect(summary.unpricedModels).toEqual(["some-unpriced-model"]);
  });

  it("computes latency percentiles from runs that recorded latency only", () => {
    const summary = summarise({
      runs: [run({ latency_ms: 100 }), run({ latency_ms: 300 }), run({ latency_ms: null }), run({ latency_ms: 200 })],
    });
    expect(summary.typicalLatencyMs).toBe(200);
    expect(summary.slowestTwentiethLatencyMs).toBe(300);
  });

  it("computes cache reuse as cached reads over all input-side tokens", () => {
    const summary = summarise({
      runs: [run({ input_tokens: 200, cache_read_tokens: 800, cache_creation_tokens: 0 })],
    });
    expect(summary.cacheReusePercent).toBeCloseTo(80, 6);
  });

  it("counts how replies ended by status", () => {
    const summary = summarise({
      runs: [run({ status: "OK" }), run({ status: "OK" }), run({ status: "GUARDRAIL_BLOCKED" }), run({ status: "MODEL_ERROR" })],
    });
    expect(summary.statusCounts).toEqual({ OK: 2, GUARDRAIL_BLOCKED: 1, MODEL_ERROR: 1 });
  });

  it("ranks tools by failure rate, then failures, then usage", () => {
    const summary = summarise({
      toolCalls: [
        { tool_name: "steady", is_error: false },
        { tool_name: "steady", is_error: false },
        { tool_name: "flaky", is_error: true },
        { tool_name: "flaky", is_error: false },
        { tool_name: "broken", is_error: true },
      ],
    });
    expect(summary.tools.map((tool) => tool.toolName)).toEqual(["broken", "flaky", "steady"]);
    expect(summary.tools[0]).toMatchObject({ calls: 1, failures: 1, failurePercent: 100 });
    expect(summary.tools[1]).toMatchObject({ calls: 2, failures: 1, failurePercent: 50 });
  });

  it("buckets replies and cost into Colombo calendar days and zero-fills the rest", () => {
    // 2026-09-17T20:00Z is 01:30 on 18 Sep in Colombo (UTC+5:30), so it belongs to the 18th.
    const summary = summarise({
      runs: [run({ created_at: "2026-09-17T20:00:00Z", input_tokens: 1_000_000, output_tokens: 0 })],
    });
    const eighteenth = summary.daily.find((point) => point.day === "2026-09-18");
    const seventeenth = summary.daily.find((point) => point.day === "2026-09-17");
    expect(eighteenth?.replies).toBe(1);
    expect(eighteenth?.costUsd).toBeCloseTo(5, 6);
    expect(seventeenth?.replies).toBe(0);
    expect(summary.daily.at(-1)?.day).toBe("2026-09-18");
    expect(summary.daily[0].day).toBe("2026-08-20");
  });

  it("still counts a run outside the chart window in the totals but not on the chart", () => {
    const summary = summarise({ runs: [run({ created_at: "2026-07-01T00:00:00Z" })] });
    expect(summary.replyCount).toBe(1);
    expect(summary.daily.reduce((total, point) => total + point.replies, 0)).toBe(0);
  });

  it("passes outcomes and the truncation flag through untouched", () => {
    const summary = summarise({ leadsCaptured: 4, bookingsHeld: 2, truncated: true });
    expect(summary.leadsCaptured).toBe(4);
    expect(summary.bookingsHeld).toBe(2);
    expect(summary.truncated).toBe(true);
  });
});
