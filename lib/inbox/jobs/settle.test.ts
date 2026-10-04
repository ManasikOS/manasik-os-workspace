import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const enqueueChannelJob = vi.fn();
vi.mock("@/lib/inbox/jobs/queue", () => ({ enqueueChannelJob: (...args: unknown[]) => enqueueChannelJob(...args) }));

const { DEFAULT_SETTLE_DELAY_SECONDS, enqueueEnrichForConversation, enrichCoalesceKey, settleDelaySeconds } = await import("./settle");

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const CONVERSATION = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";
const fakeDb = {} as never;

beforeEach(() => {
  enqueueChannelJob.mockReset().mockResolvedValue({ ok: true, jobId: "job-1", lane: "REALTIME" });
});

describe("settleDelaySeconds", () => {
  it("waits 4 seconds by default so a burst of messages becomes one run", () => {
    expect(DEFAULT_SETTLE_DELAY_SECONDS).toBe(4);
    expect(settleDelaySeconds({ firstContact: false })).toBe(4);
  });

  it("never delays a first-contact message, even when the agency configured a delay", () => {
    expect(settleDelaySeconds({ firstContact: true, agencySettleSeconds: 30 })).toBe(0);
  });

  it.each([
    ["zero", 0, 0],
    ["exactly the 60 second ceiling", 60, 60],
    ["one above the ceiling", 61, 60],
    ["a negative number", -1, 0],
  ])("clamps an agency setting of %s", (_label, configured, expected) => {
    expect(settleDelaySeconds({ firstContact: false, agencySettleSeconds: configured })).toBe(expected);
  });

  it("drops the fraction of a fractional setting instead of rounding up", () => {
    expect(settleDelaySeconds({ firstContact: false, agencySettleSeconds: 9.9 })).toBe(9);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative Infinity", Number.NEGATIVE_INFINITY],
  ])("falls back to the default for a %s setting", (_label, configured) => {
    expect(settleDelaySeconds({ firstContact: false, agencySettleSeconds: configured })).toBe(DEFAULT_SETTLE_DELAY_SECONDS);
  });
});

describe("enrichCoalesceKey", () => {
  it("is stable per conversation and different between conversations", () => {
    expect(enrichCoalesceKey(CONVERSATION)).toBe(`enrich:${CONVERSATION}`);
    expect(enrichCoalesceKey(CONVERSATION)).toBe(enrichCoalesceKey(CONVERSATION));
    expect(enrichCoalesceKey("another")).not.toBe(enrichCoalesceKey(CONVERSATION));
  });
});

describe("enqueueEnrichForConversation", () => {
  it("enqueues one ENRICH job keyed by conversation, with the message id in the payload", async () => {
    await enqueueEnrichForConversation(fakeDb, { agencyId: AGENCY, conversationId: CONVERSATION, messageId: "msg-1", firstContact: false });

    expect(enqueueChannelJob).toHaveBeenCalledWith(fakeDb, {
      agencyId: AGENCY,
      kind: "ENRICH",
      coalesceKey: `enrich:${CONVERSATION}`,
      payload: { conversationId: CONVERSATION, messageId: "msg-1" },
      delaySeconds: 4,
    });
  });

  it("leaves the message id out of the payload when there is none", async () => {
    await enqueueEnrichForConversation(fakeDb, { agencyId: AGENCY, conversationId: CONVERSATION, firstContact: false });

    expect(enqueueChannelJob.mock.calls[0][1].payload).toEqual({ conversationId: CONVERSATION });
  });

  it("uses no delay for a first-contact message and the agency's delay otherwise", async () => {
    await enqueueEnrichForConversation(fakeDb, { agencyId: AGENCY, conversationId: CONVERSATION, firstContact: true, agencySettleSeconds: 20 });
    await enqueueEnrichForConversation(fakeDb, { agencyId: AGENCY, conversationId: CONVERSATION, firstContact: false, agencySettleSeconds: 20 });

    expect(enqueueChannelJob.mock.calls.map((call) => call[1].delaySeconds)).toEqual([0, 20]);
  });

  it("returns the queue's result unchanged, including a failure, so the webhook can still acknowledge", async () => {
    enqueueChannelJob.mockResolvedValue({ ok: false, error: "queue unavailable" });

    const result = await enqueueEnrichForConversation(fakeDb, { agencyId: AGENCY, conversationId: CONVERSATION, firstContact: false });

    expect(result).toEqual({ ok: false, error: "queue unavailable" });
  });
});
