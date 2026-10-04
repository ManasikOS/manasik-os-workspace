import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The turn itself is exercised in the agent tests; here it is replaced, so importing the reply job does not load the whole agent.
vi.mock("@/lib/agent/whatsapp/drain", () => ({ runAssistantTurn: vi.fn() }));

const { ReplyNotSentError } = await import("@/lib/agent/whatsapp/reply-delivery");
const { ReplyTurnBusyError, createReplyTurnGuard, findSupersedingReply, replyJobPayloadSchema, runReplyJob } = await import("./reply-job");
const { replyCoalesceKey } = await import("./reply-key");

const db = {} as never;
const base = { db, agencyId: "agency-1", conversationId: "conv-1", messageId: "msg-1", ownerToken: "token-a" };

function fakeOps(overrides: Record<string, unknown> = {}) {
  return {
    claim: vi.fn(async () => ({ action: "GENERATE" as const, intentId: "intent-1" })),
    beginSend: vi.fn(async () => true),
    finishSent: vi.fn(async () => undefined),
    finishSkipped: vi.fn(async () => undefined),
    revertToGenerated: vi.fn(async () => undefined),
    isSuperseded: vi.fn(async () => false),
    ...overrides,
  };
}
const guardWith = (ops: ReturnType<typeof fakeOps>) => createReplyTurnGuard(base, ops as never);

describe("createReplyTurnGuard.begin", () => {
  it("lets a fresh attempt run the model", async () => {
    expect(await guardWith(fakeOps()).begin()).toEqual({ action: "GENERATE" });
  });

  it("gives a retry the reply an earlier attempt already produced, so the model is not called again", async () => {
    const ops = fakeOps({ claim: vi.fn(async () => ({ action: "SEND_STORED" as const, intentId: "intent-1", reply: "Salaam", buttons: [{ id: "a", title: "A" }] })) });
    expect(await guardWith(ops).begin()).toEqual({ action: "SEND_STORED", reply: "Salaam", buttons: [{ id: "a", title: "A" }] });
  });

  it("stops when the reply was already sent or skipped, and reports an unknown outcome so staff are told", async () => {
    expect(await guardWith(fakeOps({ claim: vi.fn(async () => ({ action: "DONE" as const })) })).begin()).toEqual({ action: "STOP" });
    expect(await guardWith(fakeOps({ claim: vi.fn(async () => ({ action: "UNKNOWN" as const, intentId: "intent-1" })) })).begin()).toEqual({ action: "UNKNOWN" });
  });

  it("throws when another attempt holds the turn, so the job retries later instead of racing it", async () => {
    const guard = guardWith(fakeOps({ claim: vi.fn(async () => ({ action: "BUSY" as const })) }));
    await expect(guard.begin()).rejects.toBeInstanceOf(ReplyTurnBusyError);
  });

  it("claims for exactly this agency, conversation and inbound message", async () => {
    const ops = fakeOps();
    await guardWith(ops).begin();
    expect(ops.claim).toHaveBeenCalledWith(db, { agencyId: "agency-1", conversationId: "conv-1", inboundMessageId: "msg-1" }, "token-a");
  });
});

describe("createReplyTurnGuard.beforeSend", () => {
  it("records the reply and lets it go out", async () => {
    const ops = fakeOps();
    const guard = guardWith(ops);
    await guard.begin();
    expect(await guard.beforeSend({ text: "Salaam", buttons: [] })).toBe(true);
    expect(ops.beginSend).toHaveBeenCalledWith(db, { agencyId: "agency-1", intentId: "intent-1", ownerToken: "token-a" }, { text: "Salaam", buttons: [] });
  });

  it("does not send a reply the customer has already written past: the queued job answers every message at once", async () => {
    const ops = fakeOps({ isSuperseded: vi.fn(async () => true) });
    const guard = guardWith(ops);
    await guard.begin();
    expect(await guard.beforeSend({ text: "stale", buttons: [] })).toBe(false);
    expect(ops.finishSkipped).toHaveBeenCalledWith(db, expect.objectContaining({ intentId: "intent-1" }), "SUPERSEDED");
    expect(ops.beginSend).not.toHaveBeenCalled();
  });

  it("does not send when this attempt no longer owns the intent", async () => {
    const guard = guardWith(fakeOps({ beginSend: vi.fn(async () => false) }));
    await guard.begin();
    expect(await guard.beforeSend({ text: "late", buttons: [] })).toBe(false);
  });

  it("refuses to be used before begin()", async () => {
    await expect(guardWith(fakeOps()).beforeSend({ text: "x", buttons: [] })).rejects.toThrow(/before begin/);
  });
});

describe("createReplyTurnGuard after the send", () => {
  it("records the provider's message id when the reply was sent", async () => {
    const ops = fakeOps();
    const guard = guardWith(ops);
    await guard.begin();
    await guard.afterDelivery({ status: "SENT", externalMessageId: "wamid.out" });
    expect(ops.finishSent).toHaveBeenCalledWith(db, expect.objectContaining({ intentId: "intent-1" }), "wamid.out");
  });

  it("records why a reply was not sent, so a retry stands down", async () => {
    const ops = fakeOps();
    const guard = guardWith(ops);
    await guard.begin();
    await guard.afterDelivery({ status: "SKIPPED", reason: "TOKEN_DEAD" });
    expect(ops.finishSkipped).toHaveBeenCalledWith(db, expect.objectContaining({ intentId: "intent-1" }), "TOKEN_DEAD");
  });

  it("keeps the reply for a retry only when the send provably did not reach the customer", async () => {
    const ops = fakeOps();
    const guard = guardWith(ops);
    await guard.begin();
    await guard.afterSendFailure(new ReplyNotSentError("rate limited"));
    expect(ops.revertToGenerated).toHaveBeenCalledTimes(1);
  });

  it("leaves any other send failure as an unknown outcome: it could have failed AFTER the provider accepted the message", async () => {
    const ops = fakeOps();
    const guard = guardWith(ops);
    await guard.begin();
    await guard.afterSendFailure(new Error("database write failed after the send"));
    expect(ops.revertToGenerated).not.toHaveBeenCalled();
    expect(ops.finishSkipped).not.toHaveBeenCalled();
  });

  it("records a turn that produced nothing, so it is not re-run", async () => {
    const ops = fakeOps();
    const guard = guardWith(ops);
    await guard.begin();
    await guard.withoutReply("MODEL_ERROR");
    expect(ops.finishSkipped).toHaveBeenCalledWith(db, expect.objectContaining({ intentId: "intent-1" }), "MODEL_ERROR");
  });
});

describe("findSupersedingReply", () => {
  /** A database answering the two reads: the customer's newest message, and whether a REPLY job is queued. */
  function readsDb(input: { latestMessageId: string | null; queuedReply: boolean }) {
    const chain = (data: unknown) => {
      const c: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) c[method] = () => c;
      c.maybeSingle = async () => ({ data, error: null });
      return c;
    };
    return {
      from: (table: string) =>
        table === "conversation_messages" ? chain(input.latestMessageId ? { id: input.latestMessageId } : null) : chain(input.queuedReply ? { id: "job-2" } : null),
    } as never;
  }
  const args = { agencyId: "agency-1", conversationId: "conv-1", messageId: "msg-1" };

  it("is false when this turn answers the customer's newest message", async () => {
    expect(await findSupersedingReply(readsDb({ latestMessageId: "msg-1", queuedReply: true }), args)).toBe(false);
  });

  it("is true only when a newer message exists AND a REPLY job is queued to answer it", async () => {
    expect(await findSupersedingReply(readsDb({ latestMessageId: "msg-2", queuedReply: true }), args)).toBe(true);
    // A newer message with no queued job (e.g. the assistant was off for it) must NOT cause this reply to be dropped.
    expect(await findSupersedingReply(readsDb({ latestMessageId: "msg-2", queuedReply: false }), args)).toBe(false);
  });
});

describe("runReplyJob", () => {
  it("runs the assistant turn with the guard and no agent-job id (agent_runs.job_id references agent_jobs)", async () => {
    const runTurn = vi.fn(async () => undefined);
    await runReplyJob({ db, agencyId: "agency-1", conversationId: "conv-1", messageId: "msg-1" }, { runTurn: runTurn as never, ops: fakeOps() as never, newToken: () => "token-x" });
    expect(runTurn).toHaveBeenCalledTimes(1);
    const [input, guard] = runTurn.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(input).toEqual({ conversationId: "conv-1", messageId: "msg-1", jobId: null });
    expect(typeof guard.begin).toBe("function");
  });
});

describe("payload and key", () => {
  it("accepts the payload the database function writes and rejects anything else", () => {
    const ok = replyJobPayloadSchema.safeParse({
      conversationId: "3f1d2c4e-5a6b-4c7d-8e9f-000000000001",
      messageId: "3f1d2c4e-5a6b-4c7d-8e9f-000000000002",
      sequenceNumber: 8,
    });
    expect(ok.success).toBe(true);
    expect(replyJobPayloadSchema.safeParse({ conversationId: "not-a-uuid", messageId: "x" }).success).toBe(false);
    expect(replyJobPayloadSchema.safeParse({}).success).toBe(false);
  });

  it("merges on reply:<conversation>, the string the inbound database function builds", () => {
    expect(replyCoalesceKey("conv-1")).toBe("reply:conv-1");
  });
});
